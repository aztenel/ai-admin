// B. When the service (or master) is ambiguous, which options does the bot offer to the client?
import { mk, D1 } from "./lib.mjs";
import { BARBER, BEAUTY } from "./b_lists.mjs";
const h = await mk(); const log = h.quiet();
let n = 0, locN = 8200;
async function ask(list, staff, clientText, service, master = "любой") {
  const loc = ++locN;
  h.loc(loc, d => { d.services = list.services; d.category = list.category; if (staff) d.staff = staff; d.times = { 0: ["10:00", "11:00"] }; });
  h.gemini = ["Записала вас.\n" + h.tag("Дана", service, master, D1, "11:00")];
  const d = await h.chat("alt", "q" + (++n), `${clientText} Дана, ${h.phone()}`);
  log(`client: ${clientText}\nLLM   : Услуга: ${service}; Мастер: ${master}\nreply : ${d.reply}\n`);
}
await ask(BARBER, null, "Камуфляж завтра в 11:00.", "Камуфляж");          // really ambiguous: «Камуфляж бороды» / «Камуфляж седины»
await ask(BEAUTY, null, "Массаж завтра в 11:00.", "Массаж");               // 5 massage services
await ask(BEAUTY, null, "Шугаринг бикини завтра в 11:00.", "Шугаринг бикини");
const staff = ["Арман", "Ерлан", "Даурен", "Тимур", "Али", "Алихан", "Нурлан", "Айгерим", "Айгерим", "Жанар"].map((name, i) => ({ id: 11 + i, name, bookable: true, specialization: i === 7 ? "стилист" : i === 8 ? "колорист" : "" }));
await ask(BARBER, staff, "Мужская стрижка к Айгерим завтра в 11:00.", "Мужская стрижка", "Айгерим");
process.exit(0);
