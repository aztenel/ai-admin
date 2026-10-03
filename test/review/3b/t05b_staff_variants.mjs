// Master field wording variants (unique phone per attempt so that the 5/day phone limit does not interfere).
import { mk, show, D1 } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4055" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
let n = 0;
const ph = () => `+7 701 2${String(10 + n).padStart(2, "0")} ${String(10 + (n % 80)).padStart(2, "0")} 11`;
async function variant(loc, v, userText) {
  h.env.ALTEGIO_LOC_ALT = loc; h.ALT.records.length = 0; n++;
  h.gemini = ["Записала.\n" + h.tag("Дана", "Мужская стрижка", v, D1, "10:00")];
  const d = await h.chat("alt", "v" + n, `Дана, ${ph()}, ${userText}`);
  _log(`  Мастер: «${v}» → ${h.ALT.records[0] ? "booked staff_id=" + h.ALT.records[0].appointments[0].staff_id : "NOT booked: " + d.reply.slice(0, 100)}`);
}
_log("=== C. «any master» wording variants (staff: Арман id 11, Ерлан id 12; expected staff_id=0)");
for (const v of ["любой", "Любой свободный", "к любому", "не важен", "неважно", "не важно", "без разницы", "любой мастер", "свободный мастер", "ближайший свободный", "кез келген", "кез-келген", "any", "any available", "no preference", "...", "нет", "не указан", ""])
  await variant("4055", v, "мужская стрижка завтра в 10:00, мастер не важен");
_log("\n=== D. staff: Татьяна 21, Яна 22, Любовь 23, Анна 24");
const D = h.dataFor("4056"); D.staff = [{ id: 21, name: "Татьяна", bookable: true }, { id: 22, name: "Яна", bookable: true }, { id: 23, name: "Любовь", bookable: true }, { id: 24, name: "Анна", bookable: true }];
D.times = { 0: ["10:00", "11:00"], 21: ["10:00", "11:00"], 22: ["10:00", "11:00"], 23: ["10:00", "11:00"], 24: ["10:00", "11:00"] };
for (const v of ["Татьяна", "Татьяне", "татьяна (стилист)", "Яна", "Яне", "Любовь", "Любови", "любой", "Любой", "Анна", "Анне", "Аня", "Татьяна или Яна", "Светлана"])
  await variant("4056", v, "мужская стрижка завтра в 10:00");
_log("\n=== E. staff: Арман 51, Арманбек 52, Али 53, Алина 54, Алихан 55");
const E = h.dataFor("4057"); E.staff = [{ id: 51, name: "Арман", bookable: true }, { id: 52, name: "Арманбек", bookable: true }, { id: 53, name: "Али", bookable: true }, { id: 54, name: "Алина", bookable: true }, { id: 55, name: "Алихан", bookable: true }];
E.times = { 0: ["10:00"], 51: ["10:00"], 52: ["10:00"], 53: ["10:00"], 54: ["10:00"], 55: ["10:00"] };
for (const v of ["Арман", "Арману", "Арманбек", "Арманбеку", "Али", "Алина", "Алине", "Алихан", "Алихану", "Алия"])
  await variant("4057", v, "мужская стрижка завтра в 10:00");
