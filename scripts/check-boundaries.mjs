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
// разбор идёт в дочернем процессе с этим флагом. import() в src/ не используем: его цель не всегда видна до запуска —
// каждое «import(» в коде идёт в отчёт (строки-комментарии и JSDoc {import("…").T} не считаются).
const PARSE = 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.stringify({ok:new (require("vm").SourceTextModule)(s).dependencySpecifiers}))}catch(e){process.stdout.write(JSON.stringify({err:String(e.message||e)}))}})';
function staticSpecs(src) {
  if (vm.SourceTextModule) { try { return { ok: new vm.SourceTextModule(src).dependencySpecifiers }; } catch (e) { return { err: String(e.message || e) }; } }
  const r = spawnSync(process.execPath, ["--experimental-vm-modules", "--no-warnings", "-e", PARSE], { input: src, encoding: "utf8" });
  try { return JSON.parse(r.stdout); } catch (e) { return { err: "разбор не удался: " + String(r.stderr || r.error || "").slice(0, 200) }; }
}
export function importsOf(src) {
  const lines = src.split("\n"), out = [];
  const lineOf = spec => { const i = lines.findIndex(l => l.includes(`"${spec}"`) || l.includes(`'${spec}'`)); return i + 1; };
  const r = staticSpecs(src);
  if (r.err) out.push({ spec: null, line: 0, why: "файл не разбирается: " + r.err });
  for (const spec of r.ok || []) out.push({ spec: spec || null, line: lineOf(spec), ...(spec ? {} : { why: "пустое подключение" }) });
  lines.forEach((l, i) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(l)) return; // строка-комментарий, JSDoc
    if (/(^|[^\w$.])import\s*\(/.test(l)) out.push({ spec: null, line: i + 1, why: "import() — в src/ только import … from (цель import() проверить нельзя)" });
  });
  return out;
}
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
function declaredPackages(srcRoot) {
  let dir = srcRoot;
  for (;;) { // ближайший package.json выше src/
    const f = join(dir, "package.json");
    if (existsSync(f)) { const pj = JSON.parse(readFileSync(f, "utf8")); return new Set(Object.keys(pj.dependencies || {})); } // испорченный package.json — ошибка, а не «пакетов нет»
    const up = dirname(dir); if (up === dir) return new Set(); dir = up;
  }
}
const pkgName = spec => spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
const lineAt = (s, i) => s.slice(0, i).split("\n").length;

export function checkBoundaries(srcDir) {
  const root = resolve(srcDir), problems = [];
  if (!existsSync(root)) return { problems: [`нет папки ${srcDir}`], files: 0 };
  const files = walk(root), graph = new Map(), pkgs = declaredPackages(root);
  for (const f of files) {
    const rel = relative(root, f), from = layerOf(rel), deps = [];
    graph.set(f, deps);
    if (!from) { problems.push(`${rel}: файл вне известных слоёв (routes, controllers, services, db, jobs, config, lib, index.js)`); continue; }
    for (const { spec, line, why } of importsOf(readFileSync(f, "utf8"))) {
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
