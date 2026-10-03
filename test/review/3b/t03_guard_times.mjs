// Guard for Altegio clients: which NOT-free times can the LLM name and still pass?
// Free times in Altegio (any master): 9:30, 10:00, 11:00, 13:00. Service lengths: 60, 30, 45 min.
import { mk, show, D1 } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4003" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
let n = 0;
async function probe(userText, llm) {
  h.gemini = [llm, llm];
  const d = await h.chat("alt", "g" + (++n), userText);
  const passed = d.reply === llm.replace(/\n?\[(ЗАЯВКА|ОТМЕНА)\][^\n]*/gi, "").trim();
  _log(`${passed ? "PASSED GUARD" : "rejected    "} | guard=${JSON.stringify(d.guard)} | LLM: ${llm}\n               reply: ${d.reply}\n               chips: ${JSON.stringify(d.offer)}`);
  return d;
}
_log("--- control: invented time must be rejected");
await probe("Есть время завтра?", "Могу записать вас завтра в 12:00. Подойдёт?");
await probe("Есть время завтра?", "Могу записать вас завтра в 15:30. Подойдёт?");
_log("--- softTimes: 12:00 = 11:00 + 60 мин, allowed 'only as end of a range'");
await probe("Is there any time tomorrow?", "Sorry, the morning is busy, but I can move you to 12:00 tomorrow. Shall I book it?");
await probe("Is there any time tomorrow?", "We have a free slot tomorrow. Would you like to come to 12:00?");
await probe("Есть время завтра?", "Завтра свободно: 9:30 - 10:00 - 10:30 - 11:00 - 11:30 - 12:00 - 13:00. Какое время выбрать?");
await probe("Есть время завтра?", "Завтра могу записать вас до 12:00 или по 13:45. Что выбираете?");
await probe("Есть время завтра?", "Завтра есть окна (10:30, 11:45), а ещё 10:00 – 12:00. Записать?");
_log("--- opening hours of the client config (alt: 9..21) are always allowed");
await probe("Есть время завтра?", "Могу записать вас завтра в 9:00 или вечером в 21:00. Что удобнее?");
_log("--- any number typed by the client becomes an allowed time (same as v7.3)");
await probe("Мне 16 лет, можно на стрижку завтра?", "Конечно! Завтра свободно в 16:00 и 16:30. Записать?");
_log("--- time written with a dot is not checked at all (same as v7.3)");
await probe("Есть время завтра?", "Могу записать вас завтра в 15.30 или в 17.45. Подойдёт?");
_log("--- date is not checked");
await probe("Есть время?", "Свободно в субботу, 17 октября, в 10:00. Записать?");
_log("--- master/day mix-up: Арман is free only at 11:00 and 13:00");
await probe("Хочу к Арману завтра", "У Армана завтра свободно в 9:30 и 10:00. Какое время?");
