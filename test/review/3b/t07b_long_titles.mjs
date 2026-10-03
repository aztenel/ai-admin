// Titles of 80+ characters: (1) identical in two categories, (2) two different services whose names differ only after the 80th character.
import { mk, show, D1 } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4076" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
const S = (id, title, cat = 1, price = 5000, len = 3600) => ({ id, title, category_id: cat, price_min: price, price_max: price, active: 1, seance_length: len });
let n = 0;
const titles = () => (h.sys().match(/Услуги для записи[^\n]*\n((?:  ·[^\n]*\n)+)/) || ["", ""])[1];
async function attempt(loc, svcField) {
  h.env.ALTEGIO_LOC_ALT = loc; h.ALT.records.length = 0; n++;
  h.gemini = ["Записала.\n" + h.tag("Дана", svcField, "любой", D1, "10:00")];
  const d = await h.chat("alt", "L" + n, `Дана, +7 702 4${String(10 + n).padStart(2, "0")} 22 33, запишите завтра в 10:00`);
  const ap = h.ALT.records[0] ? h.ALT.records[0].appointments[0] : null;
  _log(`  Услуга: «${svcField}»\n     → ${ap ? "BOOKED services=" + JSON.stringify(ap.services) : "not booked"} | reply: ${d.reply.slice(0, 260)}\n`);
}
const base = "Комплекс «Всё включено»: стрижка, оформление бороды, мытьё головы, укладка, массаж лица"; // 86 chars
_log("base title length: " + base.length);
_log("=== 1. same 86-char title in two categories (ids 1 and 2)");
let D = h.dataFor("4076"); D.services = [S(1, base, 1, 15000), S(2, base, 2, 20000), S(3, "Борода", 1, 4000)]; D.category = [{ id: 1, title: "Барбер" }, { id: 2, title: "Топ-барбер" }];
await attempt("4076", "Борода");
const t = titles(); _log("  prompt:\n" + t);
for (const line of t.trim().split("\n").slice(0, 2)) await attempt("4076", line.replace(/^\s*·\s*/, "").replace(/ — от \d.*$/, ""));

_log("=== 2. two different services, names differ after the 80th char: «… (короткие волосы)» id 1 / «… (длинные волосы)» id 2");
D = h.dataFor("4077"); D.services = [S(1, base + " (короткие волосы)", 1, 15000), S(2, base + " (длинные волосы)", 1, 20000), S(3, "Борода", 1, 4000)];
await attempt("4077", "Борода");
_log("  prompt:\n" + titles());
