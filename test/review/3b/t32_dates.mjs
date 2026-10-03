// Date field of the booking tag.
import { mk, show, D0, D1, D2, D3, J, iso } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4320" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
const D = h.dataFor("4320"); D.dates = [D1, D2, D3, iso(Date.now() + 4 * 86400e3)];
let n = 0;
for (const [label, date] of [["tomorrow ISO", D1], ["3rd open day", D3], ["4th day (beyond ALT_DAYS=3)", iso(Date.now() + 4 * 86400e3)], ["today (not in dates)", D0], ["yesterday", iso(Date.now() - 86400e3)], ["dd.mm.yyyy", D1.split("-").reverse().join(".")], ["«завтра»", "завтра"], ["empty", ""], ["2026-13-45", "2026-13-45"], ["with time inside", D1 + " 10:00"], ["ISO with slashes", D1.replace(/-/g, "/")]]) {
  h.ALT.records.length = 0; n++; h.calls.tg.length = 0;
  h.gemini = ["Записала вас на завтра в 10:00.\n" + h.tag("Тимур", "Мужская стрижка", "любой", date, "10:00")];
  const d = await h.chat("alt", "d" + n, `Тимур, +7 702 9${String(10 + n).padStart(2, "0")} 22 33, мужская стрижка завтра в 10:00`);
  _log(`${label.padEnd(28)} «${date}» → ${h.ALT.records.length ? "BOOKED " + h.ALT.records[0].appointments[0].datetime : d.lead ? "ADMIN LEAD: time=«" + d.lead.time + "» note=" + d.lead.note : "asks"} | ${d.reply.slice(0, 110)}`);
}
