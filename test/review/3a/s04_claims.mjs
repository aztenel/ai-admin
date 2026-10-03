// ИИ пишет «записала / отменила / перенесла» без служебной строки. Какие формулировки проходят к клиенту как есть?
import { chat, showState, tag, title, check, summary, ALT, TG, days, prof, leads, env } from "./harness.mjs";
const { D1 } = days();
env.ALTEGIO_LOC_ALT = "3401";
let n = 0;
const passed = [], blocked = [];
async function probe(kind, llm, userText, withBooking) {
  const sid = "c" + (++n);
  if (withBooking) { // у каждого чата свой телефон, иначе сработает лимит «5 записей в сутки на телефон»
    const b = await chat(sid, `Ерболат, +7 705 555 ${String(10 + n)} 33, мужская стрижка завтра в 10:00`, "Записала.\n" + tag("Ерболат", "10:00"), { quiet: true });
    if (!b.lead || !b.lead.altegio) throw new Error("подготовка: запись не создана: " + b.reply);
  }
  const recN = ALT.records.length, delN = ALT.deleted.length;
  const d = await chat(sid, userText, llm, { quiet: true });
  const changed = ALT.records.length !== recN || ALT.deleted.length !== delN;
  const through = d.reply === llm; // текст ИИ дошёл до клиента без изменений
  (through ? passed : blocked).push(`[${kind}] ИИ: «${llm}»` + (through ? "" : `  → заменено на: «${d.reply.slice(0, 70)}…»`) + (changed ? "  (!!! расписание изменилось)" : ""));
}
const bookUser = "Данияр, +7 705 333 22 33, мужская стрижка завтра в 11:00";
// --- ложное «записала» (записей в чате нет, в Altegio ничего не создано)
for (const llm of [
  "Записала вас на завтра в 11:00, ждём!",                       // контроль: должно блокироваться
  "Готово, я вас записала на завтра в 11:00, ждём!",
  "Данияр, вас записала: мужская стрижка, завтра в 11:00.",
  "Записала Данияра на мужскую стрижку завтра в 11:00.",
  "Вы успешно записаны на завтра в 11:00.",
  "Запись на завтра в 11:00 оформлена, ждём вас!",
  "Ваша бронь на завтра в 11:00 подтверждена.",
  "Забронировала для вас завтра 11:00, мужская стрижка.",
  "Записал вас на завтра, 11:00.",                               // контроль
  "Отлично, записываю вас на завтра в 11:00. До встречи!",
  "Данияр, если мастер не важен, то записала вас на завтра в 11:00 к любому свободному.",
  "Готово! Ждём вас завтра в 11:00 на мужскую стрижку.",
]) await probe("запись", llm, bookUser, false);
for (const llm of [
  "You're booked for a men's haircut tomorrow at 11:00.",        // контроль
  "I've booked you for a men's haircut tomorrow at 11:00.",
  "Done! I have booked you in for tomorrow at 11:00.",
  "Your appointment is confirmed for tomorrow at 11:00.",
]) await probe("запись, en", llm, "Daniyar, +7 705 333 22 33, men's haircut tomorrow at 11:00 please", false);
for (const llm of [
  "Сізді ертең сағат 11:00-ге жаздым.",                          // контроль
  "Сізді ертең сағат 11:00-ге жаздық, күтеміз!",
  "Ертең сағат 11:00-ге жазылдыңыз.",                            // контроль
  "Жазба ертең сағат 11:00-ге рәсімделді.",
]) await probe("запись, kk", llm, "Сәлеметсіз бе, атым Данияр, +7 705 333 22 33, ертең сағат 11:00-ге шаш қиюға жазыңызшы", false);
// --- ложное «отменила / перенесла» (в чате есть запись на 10:00, в Altegio ничего не удалено)
for (const llm of [
  "Отменила вашу запись.",                                       // контроль
  "Готово, отменила.",
  "Запись на завтра в 10:00 отменена.",
  "Ваша запись на 10:00 удалена.",
  "Отмена оформлена, будем рады видеть вас в другой раз.",
  "Запись Ерболата отменена.",
  "Я отменила её.",
]) await probe("отмена", llm, "Отмените мою запись", true);
for (const llm of [
  "Перенесла вашу запись на 13:00.",                             // контроль
  "Готово, перенесла.",
  "Теперь вы записаны на 13:00 вместо 10:00.",
  "Изменила время вашей записи на 13:00.",
  "Запись на завтра перенесена на 13:00.",
  "Перенос оформлен: завтра в 13:00.",
]) await probe("перенос", llm, "Перенесите мою запись на 13:00", true);
for (const llm of ["I've cancelled it for you.", "Your booking has been cancelled.", "Done, I moved it to 1 pm.", "I've cancelled your booking."]) await probe("отмена, en", llm, "Please cancel my booking", true);

title("Текст ИИ дошёл до клиента БЕЗ изменений (в расписании при этом ничего не произошло)");
passed.forEach(x => console.log("   " + x));
title("Заменено кодом (защита сработала)");
blocked.forEach(x => console.log("   " + x));
console.log(`\nИтого: прошло к клиенту как есть ${passed.length}, заменено ${blocked.length}`);
