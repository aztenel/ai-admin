// Проверка самой проверки границ: на временной папке с нарушениями она их находит, а на правильной — молчит.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { checkBoundaries, importsOf } from "../../scripts/check-boundaries.mjs";

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "bnd-")), src = join(root, "src");
  for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(src, p)), { recursive: true }); writeFileSync(join(src, p), body); }
  writeFileSync(join(root, "worker.js"), "export const old = 1;\n");
  return { src, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("правильные зависимости — нарушений нет", () => {
  const t = tree({
    "index.js": 'import { r } from "./routes/index.js";\nexport default r;\n',
    "routes/index.js": 'import { c } from "../controllers/inbox.js";\nimport { m } from "./middleware/auth.js";\nexport const r = [c, m];\n',
    "routes/middleware/auth.js": 'import { s } from "../../services/auth/session.js";\nexport const m = s;\n',
    "controllers/inbox.js": 'import { s } from "../services/inbox/act.js";\nimport { json } from "../lib/http.js";\nexport const c = [s, json];\n',
    "services/inbox/act.js": 'import { call } from "../integrations/meta/client.js";\nimport { repo } from "../../db/repositories/chats.js";\nimport { MAX } from "../../config/constants.js";\nexport const s = [call, repo, MAX];\n',
    "services/auth/session.js": "export const s = 1;\n",
    "services/integrations/meta/client.js": 'import { json } from "../../../lib/http.js";\nexport const call = json;\n',
    "db/repositories/chats.js": 'export const repo = 1;\n',
    "config/constants.js": 'import { json } from "../lib/http.js";\nexport const MAX = json;\n',
    "lib/http.js": "export const json = 1;\n"
  });
  try { assert.deepEqual(checkBoundaries(t.src).problems, []); } finally { t.done(); }
});

test("обратные зависимости, выход из src/, node:*, нет файла, цикл — найдены", () => {
  const t = tree({
    "services/a.js": 'import { c } from "../controllers/x.js";\nimport { old } from "../../worker.js";\nimport fs from "node:fs";\nimport { z } from "./nope.js";\nexport const a = [c, old, fs, z];\n',
    "controllers/x.js": 'import { q } from "../db/repositories/q.js";\nexport const c = q;\n',
    "services/integrations/alt/client.js": 'import { a } from "../../a.js";\nexport const k = a;\n',
    "db/repositories/q.js": 'import { a } from "../../services/a.js";\nexport const q = a;\n',
    "lib/p.js": 'import { k } from "../config/c.js";\nconst m = await import(k);\nimport { readFileSync } from "fs";\nimport { d } from "./dir";\nimport { M } from "./Money.js";\nexport const p = [m, readFileSync, d, M];\n',
    "lib/dir/index.js": "export const d = 1;\n",
    "lib/money.js": "export const M = 1;\n",
    "lib/q.js": 'import { R } from "../routes/r.js";\nexport const q = R;\n',
    "routes/r.js": "export const R = 1;\n",
    "lib/c1.js": 'import { y } from "./c2.js";\nexport const x = y;\n',
    "lib/c2.js": 'import { x } from "./c1.js";\nexport const y = x;\n',
    "config/c.js": "export const k = 1;\n",
    "misc/odd.js": "export const o = 1;\n"
  });
  try {
    const p = checkBoundaries(t.src).problems.join("\n");
    for (const re of [/services\/a\.js:1: services → controllers/, /services\/a\.js:2: .*вне src/, /services\/a\.js:3: .*node:fs/, /services\/a\.js:4: .*файла нет/,
      /controllers\/x\.js:1: controllers → db/, /alt\/client\.js:1: integrations → services/, /q\.js:1: db → services/,
      /lib\/p\.js:2: подключение не строкой/, /lib\/p\.js:3: .*«fs» — модулей Node/, /lib\/p\.js:4: .*папка/, /lib\/p\.js:5: .*регистр/, /lib\/q\.js:1: lib → routes/, /цикл: lib\/c1\.js → lib\/c2\.js → lib\/c1\.js|цикл: lib\/c2\.js → lib\/c1\.js → lib\/c2\.js/, /misc\/odd\.js: файл вне известных слоёв/])
      assert.match(p, re);
    assert.doesNotMatch(p, /lib → config/); // CLAUDE.md §4: config доступен всем
  } finally { t.done(); }
});

test("разбор подключений: многострочный import, export from, import без имён, import() строкой", () => {
  const s = 'import {\n  a,\n  b\n} from "./a.js";\nexport { c } from \'./c.js\';\nimport "./side.js";\nconst x = await import("./lazy.js");\nconst t = "from \\"./not-import.js\\"";\n';
  assert.deepEqual(importsOf(s).map(x => x.spec).sort(), ["./a.js", "./c.js", "./lazy.js", "./side.js"]);
});

test("комментарии с начала строки и JSDoc — не подключения; пустое подключение — в отчёт", () => {
  const s = '/** @param {import("../controllers/x.js").T} a */\n// не import(x)\n/* import { q } from "./q.js"; */\n/**\n * import { w } from "./w.js";\n */\nexport const f = a => a;\n';
  assert.deepEqual(importsOf(s), []);
  assert.deepEqual(importsOf('import x from "";\n').map(x => x.spec), [null]);
});

test("код с регулярными выражениями и делением не прячет подключения на следующих строках", () => {
  const s = 'let k = i++ / 2;\nexport { b } from "../routes/b.js";\nif (ok) /\'/.test(s);\nexport { a } from "../routes/a.js";\nconst c = p.replace(/\\/*$/, "");\nconst m = await import("../routes/r.js");\n';
  assert.deepEqual(importsOf(s).map(x => x.spec).sort(), ["../routes/a.js", "../routes/b.js", "../routes/r.js"]);
});

test("пакеты: модуль Node без node: (events, buffer) — ошибка; пакет не из package.json — ошибка; папка в другом регистре — ошибка", () => {
  const t = tree({ "lib/a.js": 'import { Buffer } from "buffer";\nimport { EventEmitter } from "events";\nimport { q } from "../db/Repositories/q.js";\nimport z from "zod";\nexport const a = [Buffer, EventEmitter, q, z];\n', "db/repositories/q.js": "export const q = 1;\n" });
  try {
    const p = checkBoundaries(t.src).problems.join("\n");
    assert.match(p, /lib\/a\.js:1: «buffer» — модулей Node/);
    assert.match(p, /lib\/a\.js:2: «events» — модулей Node/);
    assert.match(p, /lib\/a\.js:3: .*регистр/);
    assert.match(p, /lib\/a\.js:4: «zod» — пакета нет в package.json/);
  } finally { t.done(); }
});

// единственное место, где настоящая src/ проверяется в npm test (а значит, и перед выкладкой Cloudflare); CI отдельно её не гоняет
test("настоящая папка src/ — без нарушений", () => {
  assert.deepEqual(checkBoundaries(fileURLToPath(new URL("../../src", import.meta.url))).problems, []);
});
