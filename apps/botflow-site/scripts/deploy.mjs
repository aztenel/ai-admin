// Единственная разрешённая выкладка сайта TAYVENO. Workers Builds (Deploy command): npm run deploy:cf
//   node scripts/deploy.mjs           — проверки, затем wrangler deploy с явным конфигом и именем
//   node scripts/deploy.mjs --check   — только проверки (CI), без выкладки
// Зачем: 01.11.2026 коммиты сайта в main/dev запускали сборки ботов ai-admin и ai-admin-test. Код ботов не
// изменился, но выкладка сайта обязана идти только в Worker «tayveno» и только этим конфигом.
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET = "tayveno";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = resolve(root, "wrangler.jsonc");
const die = (m) => { console.error(`ВЫКЛАДКА ОСТАНОВЛЕНА: ${m}`); process.exit(1); };

if (basename(root) !== "botflow-site" || basename(dirname(root)) !== "apps") die(`скрипт не в apps/botflow-site (${root})`);
if (resolve(process.cwd()) !== root) die(`запуск не из apps/botflow-site, а из ${process.cwd()} — проверьте Root directory сборки`);
if (!existsSync(config)) die("нет apps/botflow-site/wrangler.jsonc");
const text = readFileSync(config, "utf8").replace(/^\s*\/\/.*$/gm, "");
let cfg;
try { cfg = JSON.parse(text); } catch (e) { die(`wrangler.jsonc не читается: ${e.message}`); }
if (cfg.name !== TARGET) die(`в wrangler.jsonc name = «${cfg.name}», нужен «${TARGET}»`);
for (const k of ["main", "kv_namespaces", "d1_databases", "r2_buckets", "durable_objects", "services", "queues", "triggers", "vars", "routes", "route", "env"]) {
  if (cfg[k] !== undefined) die(`в wrangler.jsonc есть «${k}» — у сайта только статические файлы, без скрипта, данных и маршрутов`);
}
if (cfg.assets?.directory !== "./dist") die("assets.directory должен быть ./dist");
const index = resolve(root, "dist/index.html");
if (!existsSync(index)) die("нет dist/index.html — сначала npm run build");
if (!readFileSync(index, "utf8").includes("<title>TAYVENO")) die("dist/index.html — не сайт TAYVENO");
console.log(`Проверки пройдены: конфиг ${config}, Worker «${TARGET}», только статические файлы.`);
if (process.argv.includes("--check")) process.exit(0);

const r = spawnSync("npx", ["wrangler", "deploy", "--config", config, "--name", TARGET], { stdio: "inherit", cwd: root });
process.exit(r.status ?? 1);
