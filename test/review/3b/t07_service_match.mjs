// Service matching in altBook / duplicate titles in altBase.
import { mk, show, D1 } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4070" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
let n = 0;
const S = (id, title, cat = 1, price = 5000, len = 3600) => ({ id, title, category_id: cat, price_min: price, price_max: price, active: 1, seance_length: len });
async function attempt(loc, svcField, note = "") {
  h.env.ALTEGIO_LOC_ALT = loc; h.ALT.records.length = 0; n++;
  h.gemini = ["Записала.\n" + h.tag("Дана", svcField, "любой", D1, "10:00")];
  const d = await h.chat("alt", "s" + n, `Дана, +7 702 3${String(10 + n).padStart(2, "0")} 22 33, запишите завтра в 10:00`);
  const ap = h.ALT.records[0] ? h.ALT.records[0].appointments[0] : null;
  _log(`  Услуга: «${svcField}» ${note}\n     → ${ap ? "BOOKED services=" + JSON.stringify(ap.services) : "not booked"} | reply: ${d.reply.slice(0, 230)}`);
  return d;
}
const titles = loc => (h.sys().match(/Услуги для записи[^\n]*\n((?:  ·[^\n]*\n)+)/) || ["", ""])[1];

_log("=== A. services: 1 «Мужская стрижка», 2 «Мужская стрижка + борода», 3 «Камуфляж седины»");
let D = h.dataFor("4071"); D.services = [S(1, "Мужская стрижка", 1, 6000), S(2, "Мужская стрижка + борода", 1, 9000, 5400), S(3, "Камуфляж седины", 1, 5000)];
await attempt("4071", "Мужская стрижка + борода", "(exact)");
await attempt("4071", "Мужская стрижка и борода", "(LLM paraphrase of the combo → expected: ask, or id 2)");
await attempt("4071", "Мужская стрижка с бородой", "(paraphrase)");
await attempt("4071", "Мужская стрижка, борода", "");
await attempt("4071", "мужская стрижка", "(case)");
await attempt("4071", "Стрижка", "(ambiguous → ask)");
await attempt("4071", "Мужская стрижка | Камуфляж седины", "(two services)");

_log("\n=== B. a title that contains «|»: 1 «Стрижка», 2 «Стрижка | Fade», 3 «Борода»");
D = h.dataFor("4072"); D.services = [S(1, "Стрижка", 1, 6000), S(2, "Стрижка | Fade", 1, 8000), S(3, "Борода", 1, 4000)];
await attempt("4072", "Стрижка | Fade", "(exact title of id 2 → expected services=[2])");
_log("  prompt:\n" + titles());

_log("=== C. duplicate titles longer than ~60 chars in two categories");
const long = "Комплекс: стрижка, мытьё головы, укладка и массаж головы с маслами";
D = h.dataFor("4073"); D.services = [S(1, long, 1, 9000), S(2, long, 2, 12000), S(3, "Борода", 1, 4000)]; D.category = [{ id: 1, title: "Мужской зал — барберы" }, { id: 2, title: "Премиум зал — топ-барберы" }];
await attempt("4073", "Борода", "(control)");
const t = titles(); _log("  prompt:\n" + t);
const full = t.split("\n")[1].replace(/^\s*·\s*/, "").replace(/ — от.*$/, "");
_log(`  exact title #2 as shown to the LLM (${full.length} chars): ${full}`);
await attempt("4073", full, "(the LLM copies the exact title of id 2 → expected services=[2])");

_log("\n=== D. duplicates without categories + an existing «… №1»");
D = h.dataFor("4074"); D.services = [S(1, "Стрижка", 0, 6000), S(2, "Стрижка", 0, 4000), S(3, "Стрижка №1", 0, 9000)]; D.category = [];
await attempt("4074", "Стрижка №1", "(which id?)");
_log("  prompt:\n" + titles());

_log("=== E. emoji / zero-width / ё in titles");
D = h.dataFor("4075"); D.services = [S(1, "💈 Мужская стрижка", 1, 6000), S(2, "💈 Мужская стрижка + борода", 1, 9000), S(3, "Чёрная маска", 1, 3000), S(4, "Укладка​", 1, 2000)];
await attempt("4075", "Мужская стрижка", "(LLM dropped the emoji, rule 16 says no emoji)");
await attempt("4075", "Черная маска", "(е instead of ё)");
await attempt("4075", "Укладка", "(title has a zero-width space)");
