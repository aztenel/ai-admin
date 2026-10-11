// Проверка границ модулей src/ (CLAUDE.md §4): кто кого может подключать.
//   routes → controllers → services → (services/integrations | db) → lib;  config и lib доступны всем.
//   services не подключают controllers/routes; integrations не подключают services и db; db не подключает services.
// Ещё запрещено: подключать из src/ что-либо вне src/ (worker.js, pult.gen.js — старый код зависит от нового, не наоборот),
// модули node:* (их нет в Cloudflare Worker без флага nodejs_compat), несуществующие файлы, import() не строкой, циклы.
// Запуск: node scripts/check-boundaries.mjs [папка src]. Код выхода 1 — есть нарушения.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { pathToFileURL } from "node:url";

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
  lib: ["lib"]
};

const isCode = f => /\.(m?js)$/.test(f);
function walk(dir, out = []) {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (isCode(n)) out.push(p);
  }
  return out;
}

// подключения файла: import … from "x", export … from "x", import "x", import("x")
export function importsOf(src) {
  const out = [];
  for (const m of src.matchAll(/^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom\s*(["'])([^"']+)\1/gm)) out.push({ spec: m[2], line: lineAt(src, m.index) });
  for (const m of src.matchAll(/^[ \t]*import\s*(["'])([^"']+)\1/gm)) out.push({ spec: m[2], line: lineAt(src, m.index) });
  for (const m of src.matchAll(/\bimport\s*\(\s*([^)]*)\)/g)) {
    const lit = /^(["'])([^"']+)\1$/.exec(m[1].trim());
    out.push(lit ? { spec: lit[2], line: lineAt(src, m.index) } : { spec: null, line: lineAt(src, m.index) });
  }
  return out;
}
const lineAt = (s, i) => s.slice(0, i).split("\n").length;

export function checkBoundaries(srcDir) {
  const root = resolve(srcDir), problems = [];
  if (!existsSync(root)) return { problems: [`нет папки ${srcDir}`], files: 0 };
  const files = walk(root), graph = new Map();
  for (const f of files) {
    const rel = relative(root, f), from = layerOf(rel), deps = [];
    graph.set(f, deps);
    if (!from) { problems.push(`${rel}: файл вне известных слоёв (routes, controllers, services, db, jobs, config, lib, index.js)`); continue; }
    for (const { spec, line } of importsOf(readFileSync(f, "utf8"))) {
      const at = `${rel}:${line}`;
      if (spec === null) { problems.push(`${at}: import() не строкой — проверить нельзя`); continue; }
      if (spec.startsWith("node:")) { problems.push(`${at}: «${spec}» — модулей Node в Worker нет`); continue; }
      if (!spec.startsWith(".") && !spec.startsWith("/")) continue; // пакет npm: слой не определить, решает ревью
      const target = resolve(dirname(f), spec);
      if (!target.startsWith(root + sep)) { problems.push(`${at}: «${spec}» — вне src/ (новый код не зависит от worker.js и старых файлов)`); continue; }
      if (!existsSync(target)) { problems.push(`${at}: «${spec}» — файла нет`); continue; }
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

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const dir = process.argv[2] || new URL("../src", import.meta.url).pathname;
  const { problems, files } = checkBoundaries(dir);
  if (problems.length) { console.log(`Границы модулей: нарушений ${problems.length}\n  ` + problems.join("\n  ")); process.exitCode = 1; }
  else console.log(`Границы модулей: нарушений нет (файлов в src/: ${files})`);
}
