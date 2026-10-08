// Сценарии независимых проверок кода: около 130 скриптов, которые писали проверяющие, чтобы повторить найденные ошибки.
// В npm test не входят (идут около двух минут). Запуск: node test/review/run.mjs [часть имени]. Вывод каждого сценария — в test/review/out/.
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

const HERE = import.meta.dirname + "/", ROOT = new URL("../..", import.meta.url).pathname;
const V73 = "e1a5fdc"; // версия 7.3: с ней сценарии сравнивают поведение для клиентов без Altegio
const old = execFileSync("git", ["-C", ROOT, "show", V73 + ":worker.js"], { maxBuffer: 1 << 26 });
for (const f of ["3a/worker_main.js", "3b/worker73.mjs", "4a/worker_main.mjs", "4b/worker.main.mjs"]) writeFileSync(HERE + f, old);
for (const d of ["3a", "3b", "4a", "4b"]) writeFileSync(HERE + d + "/pult.gen.js", readFileSync(ROOT + "pult.gen.js")); // копии бота в папках сценариев подключают пульт рядом с собой
spawnSync(process.execPath, ["mkx.mjs"], { cwd: HERE + "4b", stdio: "ignore" }); // копии бота с открытыми внутренними функциями
mkdirSync(HERE + "out", { recursive: true });

const SKIP = /^(harness|lib|h|corpus|b_lists|mkx|worker.*)$/, filter = process.argv.slice(2).find(a => !a.startsWith("--")) || "";
const MARKS = { "дефект": /\[ДЕФЕКТ\]/g, "нарушение": /\[НАРУШЕНИЕ\]/g, "не та услуга или мастер": /^\s*WRONG\b/gm, "ложная фраза дошла": /\[ДОШЛО\]/g, "необработанная ошибка": /UNHANDLED EXCEPTION|THROWS /g };
const known = existsSync(HERE + "known.json") ? JSON.parse(readFileSync(HERE + "known.json", "utf8")) : {};
const now = {}, news = [];
for (const d of ["3a", "3b", "4a", "4b"]) for (const f of readdirSync(HERE + d).filter(x => x.endsWith(".mjs")).sort()) {
  const b = f.slice(0, -4), id = d + "/" + b;
  if (SKIP.test(b) || !id.includes(filter)) continue;
  const r = spawnSync(process.execPath, [f], { cwd: HERE + d, encoding: "utf8", timeout: 170000, maxBuffer: 1 << 27 });
  const out = (r.stdout || "") + (r.stderr || "");
  writeFileSync(`${HERE}out/${d}_${b}.txt`, out);
  const c = {};
  for (const [k, re] of Object.entries(MARKS)) { const n = (out.match(re) || []).length; if (n) c[k] = n; }
  if (r.status !== 0) c["сценарий упал"] = 1;
  if (Object.keys(c).length) now[id] = c;
  for (const [k, n] of Object.entries(c)) if (n > ((known[id] || {})[k] || 0)) news.push(`${id}: ${k} — ${n} (было ${(known[id] || {})[k] || 0})`);
  process.stdout.write(Object.keys(c).length ? "x" : ".");
}
console.log("");
if (process.argv.includes("--save")) { writeFileSync(HERE + "known.json", JSON.stringify(now, null, 1) + "\n"); console.log("Текущие числа сохранены в known.json как известные."); }
else if (news.length) { console.log("Новое по сравнению с known.json (разберите вывод в test/review/out/):\n  " + news.join("\n  ")); process.exitCode = 1; }
else console.log("Нового нет: всё, что отмечено в сценариях, уже известно (см. known.json и README.md).");
