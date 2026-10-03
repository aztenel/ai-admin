// Master matching in altBook.
import { mk, show, D1 } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4005" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
let n = 0;
async function book(loc, userText, tagLine, llmText = "Записала вас.") {
  h.env.ALTEGIO_LOC_ALT = loc; h.ALT.records.length = 0;
  h.gemini = [llmText + "\n" + tagLine];
  const d = await h.chat("alt", "m" + (++n), userText);
  const ap = h.ALT.records[0] ? h.ALT.records[0].appointments[0] : null;
  _log(`  client: ${userText}\n  LLM tag: ${tagLine}\n  → reply: ${d.reply}\n  → Altegio record: ${ap ? `staff_id=${ap.staff_id} services=${JSON.stringify(ap.services)} datetime=${ap.datetime}` : "none"}\n`);
  return d;
}

_log("=== A. two masters with exactly the same name: id 31 (стилист) and id 32 (барбер). Client wants the barber.");
let D = h.dataFor("4051");
D.staff = [{ id: 31, name: "Айгерим", bookable: true, specialization: "стилист" }, { id: 32, name: "Айгерим", bookable: true, specialization: "барбер" }];
D.times = { 0: ["10:00", "11:00"], 31: ["10:00", "11:00"], 32: ["10:00", "11:00"] };
await book("4051", "Дана, +7 701 111 00 01, мужская стрижка к Айгерим, которая барбер, завтра в 11:00", h.tag("Дана", "Мужская стрижка", "Айгерим (барбер)", D1, "11:00"));
_log("  prompt staff line: " + (h.sys().match(/- Мастера[^\n]*/) || [""])[0]);
_log("  prompt master block: " + (h.sys().match(/Свободное время мастера[^\n]*/) || ["(none)"])[0] + "\n");

_log("=== A2. same, but the barber (id 32) is free at 11:00 and the stylist (id 31) is not");
D = h.dataFor("4052");
D.staff = [{ id: 31, name: "Айгерим", bookable: true, specialization: "стилист" }, { id: 32, name: "Айгерим", bookable: true, specialization: "барбер" }];
D.times = { 0: ["10:00", "11:00"], 31: ["10:00"], 32: ["11:00"] };
await book("4052", "Дана, +7 701 111 00 02, мужская стрижка к Айгерим, которая барбер, завтра в 11:00", h.tag("Дана", "Мужская стрижка", "Айгерим (барбер)", D1, "11:00"));

_log("=== B. only prefix match: list has «Арман» and «Ерлан»; the client asks for «Арманбек» (not in the list)");
await book("4053", "Дана, +7 701 111 00 03, мужская стрижка к Арманбеку завтра в 11:00", h.tag("Дана", "Мужская стрижка", "Арманбек", D1, "11:00"));
_log("=== B2. list has «Жан»; LLM writes «Жанна»");
D = h.dataFor("4054"); D.staff = [{ id: 41, name: "Жан", bookable: true }, { id: 42, name: "Ерлан", bookable: true }]; D.times = { 0: ["10:00", "11:00"], 41: ["11:00"], 42: ["10:00"] };
await book("4054", "Дана, +7 701 111 00 04, мужская стрижка к Жанне завтра в 11:00", h.tag("Дана", "Мужская стрижка", "Жанна", D1, "11:00"));

_log("=== C. «any master» wording variants (should mean staff_id 0)");
for (const v of ["любой", "Любой свободный", "к любому", "не важен", "неважно", "без разницы", "любой мастер", "свободный мастер", "ближайший свободный", "кез келген", "кез-келген", "any", "any available", "no preference", "...", "нет", ""]) {
  h.env.ALTEGIO_LOC_ALT = "4055"; h.ALT.records.length = 0;
  h.gemini = ["Записала.\n" + h.tag("Дана", "Мужская стрижка", v, D1, "10:00")];
  const d = await h.chat("alt", "m" + (++n), "Дана, +7 701 111 00 05, мужская стрижка завтра в 10:00, мастер не важен");
  _log(`  Мастер: «${v}» → ${h.ALT.records[0] ? "booked staff_id=" + h.ALT.records[0].appointments[0].staff_id : "NOT booked: " + d.reply.slice(0, 70)}`);
}
_log("\n=== D. names: Татьяна/Яна, Любовь/любой, declensions");
D = h.dataFor("4056"); D.staff = [{ id: 21, name: "Татьяна", bookable: true }, { id: 22, name: "Яна", bookable: true }, { id: 23, name: "Любовь", bookable: true }, { id: 24, name: "Анна", bookable: true }];
D.times = { 0: ["10:00", "11:00"], 21: ["10:00", "11:00"], 22: ["10:00", "11:00"], 23: ["10:00", "11:00"], 24: ["10:00", "11:00"] };
for (const v of ["Татьяна", "Татьяне", "Яна", "Яне", "Любовь", "Любови", "любой", "Любой", "Анна", "Анне", "Аня", "Татьяна или Яна"]) {
  h.env.ALTEGIO_LOC_ALT = "4056"; h.ALT.records.length = 0;
  h.gemini = ["Записала.\n" + h.tag("Дана", "Мужская стрижка", v, D1, "10:00")];
  const d = await h.chat("alt", "m" + (++n), "Дана, +7 701 111 00 06, мужская стрижка завтра в 10:00");
  _log(`  Мастер: «${v}» → ${h.ALT.records[0] ? "booked staff_id=" + h.ALT.records[0].appointments[0].staff_id : "NOT booked: " + d.reply.slice(0, 90)}`);
}
