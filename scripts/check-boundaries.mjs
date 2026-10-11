// Проверка границ модулей src/ (CLAUDE.md §4): кто кого может подключать.
//   routes → controllers → services → (services/integrations | db) → lib;  config и lib доступны всем.
//   services не подключают controllers/routes; integrations не подключают services и db; db не подключает services.
// Ещё запрещено: подключать из src/ что-либо вне src/ (worker.js, pult.gen.js — старый код зависит от нового, не наоборот),
// модули Node (node:fs и просто fs, events — их нет в Cloudflare Worker без флага nodejs_compat), пакеты не из package.json,
// несуществующие файлы и папки, другой регистр букв в пути, import() не строкой, циклы.
// Запуск: node scripts/check-boundaries.mjs [папка src]. Код выхода 1 — есть нарушения.
import { readdirSync, readFileSync, statSync, existsSync, realpathSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

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

// подключения файла: import … from "x", export … from "x", import "x", import("x").
// Убираются только комментарии, которые начинаются с начала строки (// … и /* … */, в том числе JSDoc с {import("…").T}):
// так не нужно разбирать строки и регулярные выражения, а подключения пишутся с начала строки. Всё сомнительное — в отчёт, а не мимо.
export function importsOf(src) {
  const sp = m => m.replace(/[^\n]/g, " ");
  const code = src.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, sp).replace(/^[ \t]*\/\/.*$/gm, sp);
  const out = [];
  for (const m of code.matchAll(/^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom\s*(["'])([^"'\n]*)\1/gm)) out.push({ spec: m[2] || null, line: lineAt(src, m.index) });
  for (const m of code.matchAll(/^[ \t]*import\s*(["'])([^"'\n]*)\1/gm)) out.push({ spec: m[2] || null, line: lineAt(src, m.index) });
  for (const m of code.matchAll(/(?<![\w$.{])import\s*\(\s*([^)\n]*)\)/g)) {
    const lit = /^(["'])([^"']+)\1$/.exec(m[1].trim());
    out.push({ spec: lit ? lit[2] : null, line: lineAt(src, m.index) });
  }
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
// пакеты npm: только объявленные в package.json; модули Node (fs, events, buffer… и node:*) — нет в Worker без nodejs_compat,
// разве что в package.json объявлен одноимённый пакет-замена
const NODE = new Set(builtinModules.map(m => m.replace(/^node:/, "").split("/")[0]));
function declaredPackages(srcRoot) {
  try { const pj = JSON.parse(readFileSync(join(srcRoot, "..", "package.json"), "utf8")); return new Set(Object.keys({ ...pj.dependencies, ...pj.devDependencies, ...pj.optionalDependencies })); } catch (e) { return new Set(); }
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
    for (const { spec, line } of importsOf(readFileSync(f, "utf8"))) {
      const at = `${rel}:${line}`;
      if (spec === null) { problems.push(`${at}: подключение не строкой или пустое — проверить нельзя`); continue; }
      if (!spec.startsWith(".") && !spec.startsWith("/")) {
        const name = pkgName(spec);
        if (pkgs.has(name) && !spec.startsWith("node:")) continue; // объявленный пакет npm: слой не определить, решает ревью
        problems.push(NODE.has(name.replace(/^node:/, "")) ? `${at}: «${spec}» — модулей Node в Worker нет` : `${at}: «${spec}» — пакета нет в package.json`);
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
