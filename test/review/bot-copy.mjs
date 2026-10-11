// Общее для обвязок test/review/4a/h.mjs и test/review/4b/mkx.mjs (имя не «worker…»: такие файлы — копии бота, их скрывает .gitignore): копия worker.js кладётся в папку сценариев,
// поэтому относительные подключения бота (./src/…, ./pult.gen.js) переводятся в абсолютные,
// а функции, перенесённые в src/ и подключённые в worker.js, считаются «есть в версии» (их можно экспортировать дальше).
import { pathToFileURL } from "node:url";

export function workerCopy(src, file) {
  const base = new URL("./", pathToFileURL(file)).href;
  // import … from "./x", export … from "./x", import "./x", import("./x")
  const out = src.replace(/(\bfrom\s*|^[ \t]*import\s*|\bimport\s*\(\s*)(["'])\.\//gm, `$1$2${base}`);
  const imported = [...out.matchAll(/^[ \t]*import\s*\{([^}]*)\}\s*from/gm)].flatMap(m => m[1].split(",").map(x => x.trim().split(/\s+as\s+/).pop()).filter(Boolean));
  const has = n => imported.includes(n) || new RegExp("(^|\\n)(async function|function|const|let) " + n + "\\b").test(out);
  return { src: out, has };
}
