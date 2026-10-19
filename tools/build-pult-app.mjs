// Собирает новый пульт (apps/pult: React + Vite) и кладёт файлы сборки в один модуль pult-app.gen.js в корне.
// Его подключает worker.js, Worker раздаёт пульт по адресу /app/ (src/controllers/pult.js → pultApp) — так же, как старый пульт
// идёт через tools/build-pult.mjs → pult.gen.js. Workers Static Assets не нужны, wrangler.jsonc не меняется.
//
// Запуск (из корня):        npm run build:app          (или из apps/pult: npm run embed)
// Проверка свежести:       node tools/build-pult-app.mjs --check   — без сборки: сверяет отпечаток исходников apps/pult
//                          с записанным в pult-app.gen.js (в npm test не входит: npm run check:app в корне)
// Нужны зависимости пульта: cd apps/pult && npm install. Сборка Vite воспроизводима: те же исходники — тот же файл.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const app = path.join(root, "apps", "pult");
const dist = path.join(app, "dist");
const target = path.join(root, "pult-app.gen.js");
const LIMIT = 2 * 1024 * 1024; // предел модуля: весь Worker после сжатия — до 3 МБ на бесплатном тарифе (10 МБ на платном)

// какие файлы apps/pult влияют на сборку (scripts/ — проверки и dev-сервер, README — текст: на сборку не влияют)
const INPUT_FILE = /^(index\.html|package-lock\.json|tsconfig(\.[\w-]+)?\.json|vite\.config\.[cm]?[jt]s)$/;
const INPUT_DIR = ["src", "public"];
/** @param {string} dir @returns {string[]} пути относительно dir, через «/», по алфавиту */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue; // .DS_Store и т. п. — не исходники
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name)).map(f => e.name + "/" + f));
    else if (e.isFile()) out.push(e.name);
  }
  return out.sort();
}
/** Отпечаток исходников пульта: меняется, только если поменялось то, из чего собирается пульт. */
function fingerprint() {
  const files = [
    ...fs.readdirSync(app).filter(f => INPUT_FILE.test(f) && fs.statSync(path.join(app, f)).isFile()),
    ...INPUT_DIR.flatMap(d => walk(path.join(app, d)).map(f => d + "/" + f)),
  ].sort();
  const h = crypto.createHash("sha256");
  for (const f of files) {
    const raw = fs.readFileSync(path.join(app, f));
    // переводы строк Windows (\r\n) не меняют отпечаток: иначе проверка свежести ломалась бы от настроек git
    const body = /\.(png|jpe?g|webp|gif|ico|woff2?)$/i.test(f) ? raw : Buffer.from(raw.toString("utf8").replace(/\r\n/g, "\n"));
    h.update(f + "\0" + body.length + "\0").update(body);
  }
  return h.digest("hex");
}

if (process.argv.includes("--check")) {
  const cur = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  const was = (/^\/\/ Исходники: ([0-9a-f]{64})$/m.exec(cur) || [])[1];
  if (was !== fingerprint()) {
    console.error("pult-app.gen.js устарел: пульт apps/pult поменялся, а собранная копия для сайта — нет. Запустите npm run build:app");
    process.exit(1);
  }
  console.log("pult-app.gen.js свежий");
  process.exit(0);
}

// 1. сборка Vite (с проверкой типов, как npm run build в apps/pult)
if (!fs.existsSync(path.join(app, "node_modules"))) {
  console.error("Нет зависимостей пульта. Сначала: cd apps/pult && npm install");
  process.exit(1);
}
const src = fingerprint(); // до сборки: сборка исходников не меняет
fs.rmSync(dist, { recursive: true, force: true }); // старые файлы с другими хэшами в модуль не попадают
const b = spawnSync("npm", ["run", "build"], { cwd: app, stdio: "inherit", shell: process.platform === "win32" });
if (b.status !== 0) { console.error("Сборка пульта не удалась (см. выше)"); process.exit(1); }

// 2. файлы сборки → { "<путь>": { type, body } }; картинки и шрифты — base64 с отметкой b64
/** @type {Record<string, string>} */
const TYPES = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  svg: "image/svg+xml", json: "application/json; charset=utf-8", webmanifest: "application/manifest+json; charset=utf-8", txt: "text/plain; charset=utf-8",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", ico: "image/x-icon", woff2: "font/woff2", woff: "font/woff",
};
const TEXT = /\.(html|m?js|css|svg|json|webmanifest|txt)$/;
const files = walk(dist).filter(f => !f.endsWith(".map"));
if (!files.includes("index.html")) { console.error("В сборке нет index.html"); process.exit(1); }
/** @type {Record<string, { type: string, body: string, b64?: boolean, csp?: string[] }>} */
const out = {};
for (const f of files) {
  const ext = (/\.([a-z0-9]+)$/i.exec(f) || [])[1]?.toLowerCase() || "";
  const type = TYPES[ext];
  if (!type) { console.error(`Неизвестный вид файла в сборке: ${f} — добавьте его в TYPES (tools/build-pult-app.mjs)`); process.exit(1); }
  const raw = fs.readFileSync(path.join(dist, f));
  out[f] = TEXT.test(f) ? { type, body: raw.toString("utf8") } : { type, body: raw.toString("base64"), b64: true };
}
// 3. index.html: адреса файлов — относительные (base "./" в vite.config.ts), иначе под /app/ пульт не найдёт свои файлы;
//    встроенные скрипты (тема до первой отрисовки) разрешаются политикой безопасности по хэшу, а не 'unsafe-inline'
const index = out["index.html"];
const abs = /\b(?:src|href)="\/(?!app\/)[^"]*"/.exec(index.body);
if (abs) { console.error(`index.html ссылается на ${abs[0]}: под /app/ так не найдётся. Оставьте base: "./" в apps/pult/vite.config.ts`); process.exit(1); }
index.csp = [...index.body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => "sha256-" + crypto.createHash("sha256").update(m[1], "utf8").digest("base64"));

const gen = "// Сгенерировано командой `npm run build:app` (tools/build-pult-app.mjs) из apps/pult. Руками не править: правки пропадут при следующей сборке.\n" +
  "// Новый пульт по адресу /app/: worker.js передаёт PULT_APP в createWorker, раздаёт src/controllers/pult.js (pultApp).\n" +
  `// Исходники: ${src}\n` +
  "export const PULT_APP = {\n" + Object.keys(out).sort().map(k => JSON.stringify(k) + ": " + JSON.stringify(out[k])).join(",\n") + "\n};\n";
const bytes = Buffer.byteLength(gen);
if (bytes > LIMIT) { console.error(`pult-app.gen.js вышел ${(bytes / 1024).toFixed(0)} КБ — больше предела ${LIMIT / 1024} КБ: Worker может не выложиться`); process.exit(1); }
fs.writeFileSync(target, gen);
const gz = zlib.gzipSync(gen).length;
console.log(`pult-app.gen.js собран: ${files.length} файлов, ${(bytes / 1024).toFixed(0)} КБ (сжатый ≈ ${(gz / 1024).toFixed(0)} КБ)`);
