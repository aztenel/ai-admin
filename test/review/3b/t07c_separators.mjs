// Characters in Altegio titles that the tag parser uses as separators: «;» (fields), «|» (several services), «Время:» etc.
import { mk, show, D1 } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4078" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
const S = (id, title, price = 5000, len = 3600) => ({ id, title, category_id: 1, price_min: price, price_max: price, active: 1, seance_length: len });
let n = 0;
async function attempt(loc, svcField, expect) {
  h.env.ALTEGIO_LOC_ALT = loc; h.ALT.records.length = 0; n++;
  h.gemini = ["Записала.\n" + h.tag("Дана", svcField, "любой", D1, "10:00")];
  const d = await h.chat("alt", "sep" + n, `Дана, +7 702 5${String(10 + n).padStart(2, "0")} 44 33, запишите завтра в 10:00`);
  const ap = h.ALT.records[0] ? h.ALT.records[0].appointments[0] : null;
  _log(`  LLM copies the exact title «${svcField}» (expected ${expect})\n     → ${ap ? "BOOKED services=" + JSON.stringify(ap.services) : d.lead ? "ADMIN LEAD: " + d.lead.note : "not booked"} | reply: ${d.reply.slice(0, 170)}`);
}
_log("=== services: 1 «Стрижка», 2 «Стрижка; борода», 3 «Стрижка | Fade», 4 «Экспресс-уход. Время: 30 минут», 5 «Борода»");
const D = h.dataFor("4078"); D.services = [S(1, "Стрижка", 6000), S(2, "Стрижка; борода", 9000, 5400), S(3, "Стрижка | Fade", 8000), S(4, "Экспресс-уход. Время: 30 минут", 3000, 1800), S(5, "Борода", 4000, 1800)];
await attempt("4078", "Стрижка; борода", "services=[2]");
await attempt("4078", "Стрижка | Fade", "services=[3]");
await attempt("4078", "Экспресс-уход. Время: 30 минут", "services=[4]");
await attempt("4078", "Борода", "services=[5]");
