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
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { decl: "1.0.0" }, devDependencies: { devonly: "1.0.0" } }));
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
      /lib\/p\.js:2: import\(\) — в src\/ только import … from/, /lib\/p\.js:3: «fs» — пакета нет в dependencies/, /lib\/p\.js:4: .*папка/, /lib\/p\.js:5: .*регистр/, /lib\/q\.js:1: lib → routes/, /цикл: lib\/c1\.js → lib\/c2\.js → lib\/c1\.js|цикл: lib\/c2\.js → lib\/c1\.js → lib\/c2\.js/, /misc\/odd\.js: файл вне известных слоёв/])
      assert.match(p, re);
    assert.doesNotMatch(p, /lib → config/); // CLAUDE.md §4: config доступен всем
  } finally { t.done(); }
});

const specs = src => importsOf(src).map(x => x.spec ?? "<" + x.why.split(" ")[0] + ">").sort();

test("разбор подключений (V8): многострочный import, export from, import без имён, комментарии с кавычками в списке имён", () => {
  const s = 'import {\n  a, // it\'s a\n  b /* don\'t */\n} from "./a.js";\nexport { c } from \'./c.js\';\nexport * from "./d.js";\nimport "./side.js";\n';
  assert.deepEqual(specs(s), ["./a.js", "./c.js", "./d.js", "./side.js"]);
  assert.equal(importsOf(s).find(x => x.spec === "./c.js").line, 5);
});

test("строки, шаблоны, регулярные выражения и деление не прячут и не выдумывают статических подключений", () => {
  const s = 'let k = i++ / 2;\nexport { b } from "../routes/b.js";\nif (ok) /\'/.test(s);\nconst css = `\n/* header\n`;\nexport { a } from "../routes/a.js";\nconst c = p.replace(/\\/*$/, "");\nconst tpl = `\nimport { q } from "./q.js";\n`;\nconst z = "*/";\n';
  assert.deepEqual(specs(s), ["../routes/a.js", "../routes/b.js"]);
});

test("любой import() в коде — в отчёт (многострочный, с параметрами, после «{», в шаблоне); JSDoc и строки-комментарии — нет", () => {
  const s = 'const m = await import(\n  "../routes/r.js"\n);\nconst j = await import("./d.json", { with: { type: "json" } });\nif (a) {import("./x.js")}\nconst t = `${import("./y.js")}`;\n/** @param {import("../controllers/x.js").T} a */\n// import("./gone.js")\n/**\n * import("./w.js")\n */\nexport const f = a => a;\n';
  const r = importsOf(s);
  assert.deepEqual(r.map(x => x.line), [1, 4, 5, 6]);
  assert.ok(r.every(x => x.spec === null && /import\(\)/.test(x.why)));
});

test("файл с ошибкой разбора — в отчёт; пустое подключение — в отчёт", () => {
  assert.match(importsOf("export const = ;\n")[0].why, /не разбирается/);
  assert.match(importsOf('import x from "";\n')[0].why, /пустое/);
});

test("пакеты: модуль Node (events, buffer) и пакет не из dependencies (в том числе devDependencies) — ошибка; объявленный — можно; папка в другом регистре — ошибка", () => {
  const t = tree({ "lib/b.js": 'import { x } from "decl";\nimport { y } from "devonly";\nexport const b = [x, y];\n', "lib/a.js": 'import { Buffer } from "buffer";\nimport { EventEmitter } from "events";\nimport { q } from "../db/Repositories/q.js";\nimport z from "zod";\nexport const a = [Buffer, EventEmitter, q, z];\n', "db/repositories/q.js": "export const q = 1;\n" });
  try {
    const p = checkBoundaries(t.src).problems.join("\n");
    assert.match(p, /lib\/a\.js:1: «buffer» — пакета нет в dependencies package\.json \(модулей Node/);
    assert.match(p, /lib\/a\.js:2: «events» — пакета нет/);
    assert.match(p, /lib\/a\.js:3: .*регистр/);
    assert.match(p, /lib\/a\.js:4: «zod» — пакета нет в dependencies/);
    assert.doesNotMatch(p, /«decl»/);
    assert.match(p, /lib\/b\.js:2: «devonly» — пакета нет в dependencies/);
  } finally { t.done(); }
});

// единственное место, где настоящая src/ проверяется в npm test (а значит, и перед выкладкой Cloudflare); CI отдельно её не гоняет
test("настоящая папка src/ — без нарушений", () => {
  assert.deepEqual(checkBoundaries(fileURLToPath(new URL("../../src", import.meta.url))).problems, []);
});
