// Проверка границ модулей src/ (CLAUDE.md §4): кто кого может подключать.
//   routes → controllers → services → (services/integrations | db) → lib;  config и lib доступны всем.
//   services не подключают controllers/routes; integrations не подключают services и db; db не подключает services.
// Ещё запрещено: подключать из src/ что-либо вне src/ (worker.js, pult.gen.js — старый код зависит от нового, не наоборот),
// модули Node (node:fs и просто fs, events — их нет в Cloudflare Worker без флага nodejs_compat), пакеты не из dependencies,
// несуществующие файлы и папки, другой регистр букв в пути, import(), циклы.
// Запуск: node scripts/check-boundaries.mjs [папка src]. Код выхода 1 — есть нарушения.
import { readdirSync, readFileSync, statSync, existsSync, realpathSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

// слой файла по его месту в src/
export function layerOf(rel) {
  const p = rel.split(sep).join("/");
  if (p === "index.js") return "entry";
  if (p.startsWith("routes/middleware/")) return "middleware";
  if (p.startsWith("routes/")) return "routes";
  if (p.startsWith("controllers/")) return "controllers";
  if (p.startsWith("services/integrations/")) return "integrations";
  if (p.startsWith("services/")) return "services";
  if (p.startsWith("db/")) return "db";
  if (p.startsWith("jobs/")) return "jobs";
  if (p.startsWith("config/")) return "config";
  if (p.startsWith("lib/")) return "lib";
  return null;
}

// что может подключать каждый слой (свой слой — всегда можно)
export const ALLOWED = {
  entry: ["routes", "middleware", "jobs", "config", "lib"],
  routes: ["routes", "middleware", "controllers", "config", "lib"],
  middleware: ["middleware", "services", "config", "lib"],
  controllers: ["controllers", "services", "config", "lib"],
  jobs: ["jobs", "services", "config", "lib"],
  services: ["services", "integrations", "db", "config", "lib"],
  integrations: ["integrations", "config", "lib"],
  db: ["db", "config", "lib"],
  config: ["config", "lib"],
  lib: ["lib", "config"] // CLAUDE.md §4: config и lib доступны всем (константы в lib — можно; цикл config ↔ lib поймает проверка циклов)
};

const isCode = f => /\.(m?js)$/.test(f);
function walk(dir, out = []) {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (isCode(n)) out.push(p);
  }
  return out;
}

// подключения файла. Статические (import … from, export … from, import "x") находит сам V8 — тот же разбор, что у Node
// и у сборки: комментарии, строки, шаблоны и регулярные выражения ему не мешают. Без флага --experimental-vm-modules
// разбор идёт в одном дочернем процессе с этим флагом (на все файлы сразу).
// import() в src/ не используем: его цель не всегда видна до запуска. Любое «import(» в файле — в отчёт, даже в строке
// или комментарии (лучше лишнее предупреждение, чем пропуск). Типы в JSDoc — тегом /** @import { T } from "./x.js" */.
const PARSE = 'process.stdin.setEncoding("utf8");let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(JSON.parse(s).map(t=>{try{return{ok:new (require("vm").SourceTextModule)(t).dependencySpecifiers}}catch(e){return{err:String(e.message||e)}}}))))';
function staticSpecs(srcs) {
  if (vm.SourceTextModule) return srcs.map(t => { try { return { ok: new vm.SourceTextModule(t).dependencySpecifiers }; } catch (e) { return { err: String(e.message || e) }; } });
  const r = spawnSync(process.execPath, ["--experimental-vm-modules", "--no-warnings", "-e", PARSE], { input: JSON.stringify(srcs), encoding: "utf8", maxBuffer: 1 << 26 });
  try { return JSON.parse(r.stdout); } catch (e) { return srcs.map(() => ({ err: "разбор не удался: " + String(r.stderr || r.error || "").slice(0, 200) })); }
}
const DYNAMIC = /\bimport(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*\(/g; // import(, import (, import\n(, import /* … */ (
function importsFrom(src, parsed) {
  const lines = src.split("\n"), out = [], esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (parsed.err) out.push({ spec: null, line: 0, why: "файл не разбирается: " + parsed.err });
  for (const spec of parsed.ok || []) {
    if (!spec) { out.push({ spec: null, line: 0, why: "пустое подключение" }); continue; }
    // строки, где это подключение написано (V8 повторы склеивает — показываем все места); не нашли — строка 0
    const at = new RegExp(`(\\bfrom\\s*|^\\s*import\\s*)(["'])${esc(spec)}\\2`);
    const found = lines.map((l, i) => at.test(l) ? i + 1 : 0).filter(Boolean);
    for (const line of found.length ? found : [0]) out.push({ spec, line });
  }
  for (const m of src.matchAll(DYNAMIC)) out.push({ spec: null, line: src.slice(0, m.index).split("\n").length, why: "import() — в src/ только import … from (цель import() проверить нельзя; типы в JSDoc — тегом @import)" });
  return out;
}
export const importsOf = src => importsFrom(src, staticSpecs([src])[0]);
// файл есть и каждая часть пути совпадает с точностью до регистра (macOS и Windows регистр не различают, а Linux и сборка — различают)
const isExactFile = (root, p) => {
  try {
    if (!statSync(p).isFile()) return false;
    let dir = root;
    for (const part of relative(root, p).split(sep)) { if (!readdirSync(dir).includes(part)) return false; dir = join(dir, part); }
    return true;
  } catch (e) { return false; }
};
// пакеты npm — только из dependencies в package.json (devDependencies — для проверок и сборки, не для Worker);
// модулей Node (fs, events, buffer… и node:*) в Worker без nodejs_compat нет
function declaredPackages(srcRoot, problems) { // package.json рядом с папкой src/
  const f = join(srcRoot, "..", "package.json");
  if (!existsSync(f)) { problems.push("нет package.json рядом с src/ — пакеты npm считаются необъявленными"); return new Set(); }
  try { return new Set(Object.keys(JSON.parse(readFileSync(f, "utf8")).dependencies || {})); }
  catch (e) { problems.push("package.json не читается: " + String(e.message || e).slice(0, 120)); return new Set(); }
}
const pkgName = spec => spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];

export function checkBoundaries(srcDir) {
  const root = resolve(srcDir), problems = [];
  if (!existsSync(root)) return { problems: [`нет папки ${srcDir}`], files: 0 };
  const files = walk(root), graph = new Map(), pkgs = declaredPackages(root, problems);
  const texts = files.map(f => readFileSync(f, "utf8")), parsed = staticSpecs(texts);
  for (const [k, f] of files.entries()) {
    const rel = relative(root, f), from = layerOf(rel), deps = [];
    graph.set(f, deps);
    if (!from) { problems.push(`${rel}: файл вне известных слоёв (routes, controllers, services, db, jobs, config, lib, index.js)`); continue; }
    for (const { spec, line, why } of importsFrom(texts[k], parsed[k])) {
      const at = `${rel}:${line}`;
      if (spec === null) { problems.push(`${at}: ${why}`); continue; }
      if (!spec.startsWith(".") && !spec.startsWith("/")) {
        const name = pkgName(spec);
        if (pkgs.has(name) && !spec.startsWith("node:")) continue; // объявленный пакет npm: слой не определить, решает ревью
        problems.push(`${at}: «${spec}» — ${spec.startsWith("node:") ? "модулей Node в Worker нет" : "пакета нет в dependencies package.json (модулей Node — fs, events, buffer… — в Worker нет)"}`);
        continue;
      }
      const target = resolve(dirname(f), spec);
      if (!target.startsWith(root + sep)) { problems.push(`${at}: «${spec}» — вне src/ (новый код не зависит от worker.js и старых файлов)`); continue; }
      if (!isExactFile(root, target)) { problems.push(`${at}: «${spec}» — файла нет (или это папка, или другой регистр букв)`); continue; }
      const to = layerOf(relative(root, target));
      if (!to) { problems.push(`${at}: «${spec}» — файл вне известных слоёв`); continue; }
      if (!ALLOWED[from].includes(to)) problems.push(`${at}: ${from} → ${to} запрещено («${spec}»)`);
      deps.push(target);
    }
  }
  // циклы: обход в глубину, цикл печатается один раз
  const state = new Map(), stack = [], seen = new Set();
  const visit = f => {
    state.set(f, 1); stack.push(f);
    for (const d of graph.get(f) || []) {
      if (state.get(d) === 1) {
        const cyc = stack.slice(stack.indexOf(d)).concat(d).map(x => relative(root, x));
        const key = [...cyc.slice(0, -1)].sort().join("|");
        if (!seen.has(key)) { seen.add(key); problems.push(`цикл: ${cyc.join(" → ")}`); }
      } else if (!state.get(d)) visit(d);
    }
    stack.pop(); state.set(f, 2);
  };
  for (const f of files) if (!state.get(f)) visit(f);
  return { problems, files: files.length };
}

const self = fileURLToPath(import.meta.url);
const real = p => { try { return realpathSync(p); } catch (e) { return null; } };
const argv1 = process.argv[1] ? resolve(process.argv[1]) : "";
if (argv1 && [argv1, argv1 + ".mjs"].some(p => real(p) === real(self))) { // запуск командой (в том числе через ссылку на папку), а не import
  const dir = process.argv[2] || join(dirname(self), "..", "src");
  const { problems, files } = checkBoundaries(dir);
  if (problems.length) { console.log(`Границы модулей: нарушений ${problems.length}\n  ` + problems.join("\n  ")); process.exitCode = 1; }
  else console.log(`Границы модулей: нарушений нет (файлов в src/: ${files})`);
}
