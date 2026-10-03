// B. whole-string stem match: a combo title that merely CONTAINS all stems wins, although it has extra components the client did not ask for.
import { mk, D1 } from "./lib.mjs";
import { BARBER, BEAUTY } from "./b_lists.mjs";
const h = await mk(); const log = h.quiet();
let n = 0, locN = 8100;
async function book(list, clientText, service) {
  const loc = ++locN;
  h.loc(loc, d => { d.services = list.services; d.category = list.category; d.times = { 0: ["10:00", "11:00"], 11: ["10:00", "11:00"], 12: ["10:00", "11:00"] }; });
  h.ALT.records.length = 0;
  h.gemini = ["Записала вас.\n" + h.tag("Дана", service, "любой", D1, "11:00")];
  const d = await h.chat("alt", "c" + (++n), `${clientText} Дана, ${h.phone()}`);
  const ap = h.ALT.records[0] ? h.ALT.records[0].appointments[0] : null;
  log(`client : ${clientText}\nLLM    : Услуга: ${service}\nreply  : ${d.reply}\nAltegio: ${ap ? "services=" + JSON.stringify(ap.services.map(id => list.services.find(x => x.id === id).title)) : "no record"}\n`);
}
await book(BARBER, "Стрижку и камуфляж седины завтра в 11:00.", "Стрижка и камуфляж");
await book(BARBER, "Стрижку и чёрную маску завтра в 11:00.", "Стрижка и маска");
await book(BARBER, "Стрижку и чёрную маску завтра в 11:00.", "Стрижка + чёрная маска");
await book(BARBER, "Подровнять бороду и усы воском завтра в 11:00.", "Борода и воск");
await book(BEAUTY, "Массаж шеи и спины завтра в 11:00.", "Массаж шеи и спины");
process.exit(0);
