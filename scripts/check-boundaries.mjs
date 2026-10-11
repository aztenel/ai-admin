// Проверка границ модулей src/ (CLAUDE.md §4): кто кого может подключать.
//   routes → controllers → services → (services/integrations | db) → lib;  config и lib доступны всем.
//   services не подключают controllers/routes; integrations не подключают services и db; db не подключает services.
// Ещё запрещено: подключать из src/ что-либо вне src/ (worker.js, pult.gen.js — старый код зависит от нового, не наоборот),
// модули Node (node:fs и просто fs — их нет в Cloudflare Worker без флага nodejs_compat), несуществующие файлы и папки,
// имя файла с другим регистром букв, import() не строкой, циклы. Комментарии и строки (в том числе JSDoc {import("…").T}) не считаются.
// Запуск: node scripts/check-boundaries.mjs [папка src]. Код выхода 1 — есть нарушения.
import { readdirSync, readFileSync, statSync, existsSync, realpathSync } from "node:fs";
import { join, relative, resolve, dirname, basename, sep } from "node:path";
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

// текст без комментариев (keepStrings: строки остаются) или ещё и без содержимого строк; переносы строк и длина сохраняются
// Ограничение: регулярные выражения /…/ не разбираются — кавычка внутри них может сбить разбор этого файла (тогда смотреть глазами).
export function blank(src, keepStrings) {
  let out = "", i = 0;
  const sp = t => t.replace(/[^\n]/g, " ");
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { const j = src.indexOf("\n", i); const e = j < 0 ? src.length : j; out += sp(src.slice(i, e)); i = e; }
    else if (c === "/" && d === "*") { const j = src.indexOf("*/", i + 2); const e = j < 0 ? src.length : j + 2; out += sp(src.slice(i, e)); i = e; }
    else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      const e = Math.min(j + 1, src.length);
      out += keepStrings ? src.slice(i, e) : c + sp(src.slice(i + 1, e - 1)) + (e - i > 1 ? c : ""); i = e;
    } else { out += c; i++; }
  }
  return out;
}

// подключения файла: import … from "x", export … from "x", import "x", import("x")
export function importsOf(src) {
  const code = blank(src, true), bare = blank(src, false), out = [];
  for (const m of code.matchAll(/^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom\s*(["'])([^"']+)\1/gm)) out.push({ spec: m[2], line: lineAt(src, m.index) });
  for (const m of code.matchAll(/^[ \t]*import\s*(["'])([^"']+)\1/gm)) out.push({ spec: m[2], line: lineAt(src, m.index) });
  for (const m of bare.matchAll(/\bimport\s*\(/g)) { // где import( — ищем без строк, аргумент читаем со строками
    const arg = /^\s*([^)]*)\)/.exec(code.slice(m.index + m[0].length));
    const lit = arg && /^(["'])([^"']+)\1$/.exec(arg[1].trim());
    out.push({ spec: lit ? lit[2] : null, line: lineAt(src, m.index) });
  }
  return out;
}
// файл есть и имя совпадает с точностью до регистра (macOS и Windows регистр не различают, а Linux и сборка — различают)
const isExactFile = p => { try { return statSync(p).isFile() && readdirSync(dirname(p)).includes(basename(p)); } catch (e) { return false; } };
const NODE = new Set(builtinModules.flatMap(m => [m, m.split("/")[0]]));
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
      if (spec.startsWith("node:") || NODE.has(spec) || NODE.has(spec.split("/")[0])) { problems.push(`${at}: «${spec}» — модулей Node в Worker нет`); continue; }
      if (!spec.startsWith(".") && !spec.startsWith("/")) continue; // пакет npm: слой не определить, решает ревью
      const target = resolve(dirname(f), spec);
      if (!target.startsWith(root + sep)) { problems.push(`${at}: «${spec}» — вне src/ (новый код не зависит от worker.js и старых файлов)`); continue; }
      if (!isExactFile(target)) { problems.push(`${at}: «${spec}» — файла нет (или это папка, или другой регистр букв)`); continue; }
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
const real = p => { try { return realpathSync(p); } catch (e) { return p; } };
if (process.argv[1] && real(resolve(process.argv[1])) === real(self)) { // запуск командой (в том числе через ссылку на папку), а не import
  const dir = process.argv[2] || join(dirname(self), "..", "src");
  const { problems, files } = checkBoundaries(dir);
  if (problems.length) { console.log(`Границы модулей: нарушений ${problems.length}\n  ` + problems.join("\n  ")); process.exitCode = 1; }
  else console.log(`Границы модулей: нарушений нет (файлов в src/: ${files})`);
}
