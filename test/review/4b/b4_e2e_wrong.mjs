// B. End-to-end (real worker.js, /api/chat, stubbed Gemini + Altegio): a wrong service / wrong master is booked without asking.
import { mk, D1, sv } from "./lib.mjs";
import { BARBER, BEAUTY, BARBER_PRICED } from "./b_lists.mjs";
const h = await mk(); const log = h.quiet();
let n = 0, locN = 8000;
async function book(list, staff, clientText, service, master, time = "11:00") {
  const loc = ++locN;
  h.loc(loc, d => { d.services = list.services; d.category = list.category; if (staff) d.staff = staff; d.times = { 0: ["10:00", "11:00", "12:00"] }; for (const m of d.staff) d.times[m.id] = ["10:00", "11:00", "12:00"]; });
  h.ALT.records.length = 0;
  const tag = h.tag("Дана", service, master, D1, time);
  h.gemini = ["Записала вас.\n" + tag];
  const d = await h.chat("alt", "b" + (++n), `${clientText} Дана, ${h.phone()}`);
  const rec = h.ALT.records[0], ap = rec ? rec.appointments[0] : null;
  const title = id => (list.services.find(x => x.id === id) || {}).title;
  const st = ap ? (ap.staff_id ? (h.dataFor(String(loc)).staff.find(m => m.id === ap.staff_id) || {}).name : "0 (любой свободный)") : "";
  log(`client : ${clientText}\nLLM tag: ${tag}\nreply  : ${d.reply}\nAltegio: ${ap ? `POST book_record services=${JSON.stringify(ap.services.map(title))} staff=${st} ${ap.datetime}` : "no record"}\n`);
}
log("===== wrong SERVICE");
await book(BEAUTY, null, "Хочу массаж ног и спины завтра в 11:00.", "Массаж ног и спины", "любой");
await book(BEAUTY, null, "Хочу эпиляцию ног и бикини завтра в 11:00.", "Эпиляция ног и бикини", "любой");
await book(BEAUTY, null, "Массаж спины и шеи завтра в 11:00.", "Массаж спины и шеи", "любой");
await book(BEAUTY, null, "Маникюр завтра в 11:00.", "Маникюр, 60 мин", "любой");
await book(BARBER, null, "Стрижку и усы подровнять завтра в 11:00.", "Мужская стрижка и усы", "любой");
await book(BARBER, null, "Бороду подстричь завтра в 11:00.", "Стрижка бороды, 30 мин", "любой");
await book(BARBER, null, "Стрижку у топ-барбера завтра в 11:00.", "Мужская стрижка, у топ-барбера", "любой");
await book(BARBER, null, "Бороду и усы завтра в 11:00.", "Стрижка бороды и усов", "любой");
await book(BARBER_PRICED, null, "Мужская стрижка завтра в 11:00.", "Мужская стрижка, 60 мин", "любой");
await book(BARBER_PRICED, null, "Окрашивание в один тон завтра в 11:00.", "Окрашивание в 1 тон, 60 мин", "любой");
log("===== control: the same lists, exact titles");
await book(BEAUTY, null, "Маникюр завтра в 11:00.", "Маникюр", "любой");
await book(BARBER, null, "Стрижка завтра в 11:00.", "Мужская стрижка", "любой");

log("===== wrong MASTER: the client excludes Арман");
const staff = [{ id: 11, name: "Арман", bookable: true, specialization: "топ-барбер" }, { id: 12, name: "Ерлан", bookable: true, specialization: "барбер" }, { id: 13, name: "Даурен", bookable: true, specialization: "барбер" }];
const simple = { services: [sv(101, "Мужская стрижка", 6000, 60)], category: [] };
await book(simple, staff, "Мужская стрижка завтра в 11:00, только не к Арману.", "Мужская стрижка", "не Арман");
await book(simple, staff, "Мужская стрижка завтра в 11:00, к кому угодно, кроме Армана.", "Мужская стрижка", "кроме Армана");
await book(simple, staff, "Мужская стрижка завтра в 11:00, к любому, кроме Армана.", "Мужская стрижка", "любой, кроме Армана");
