// Перенос: сбои на каждом шаге. Что сказано клиенту, что — администратору, что осталось в чате и в Altegio.
import { chat, showState, tag, title, check, summary, ALT, TG, days, prof, leads, env } from "./harness.mjs";
const { D1, D2 } = days();
let loc = 3800, n = 0;
async function setup(name) {
  env.ALTEGIO_LOC_ALT = String(++loc); ALT.records.length = 0; ALT.deleted.length = 0; n++;
  const sid = "m" + n;
  await chat(sid, `${name}, +7 705 111 ${10 + n} 33, мужская стрижка завтра в 10:00`, "Записала.\n" + tag(name, "10:00"), { quiet: true });
  TG.length = 0;
  return sid;
}
const tgHead = () => JSON.stringify(TG.map(x => x.split("\n").join(" | ").slice(0, 170)));
const move = (name, time) => "Перенесла вашу запись.\n[ОТМЕНА]\n" + tag(name, time);

let sid = await setup("Марат"); title("1. новое время занято (код 433)");
ALT.taken = true;
let d = await chat(sid, "Перенесите на 11:00", move("Марат", "11:00"));
ALT.taken = false; showState(sid);
check("старая запись цела, клиенту сказано «Прежняя запись остаётся», ИИ-текст «Перенесла» не дошёл", ALT.deleted.length === 0 && /Прежняя запись остаётся/.test(d.reply) && !/Перенесла/.test(d.reply) && prof(sid).bookings.length === 1);

sid = await setup("Марат"); title("2. POST book_record → 500");
ALT.postFail = 500;
d = await chat(sid, "Перенесите на 11:00", move("Марат", "11:00"));
ALT.postFail = 0; showState(sid); console.log("   Telegram:", tgHead());
check("старая цела; заявка администратору с пометкой про перенос; клиенту «Прежняя запись остаётся»", ALT.deleted.length === 0 && !!d.lead && /перенос/.test(d.lead.note) && /Прежняя запись остаётся/.test(d.reply) && TG.some(x => /клиент просил перенос/.test(x)));
const tgN = TG.length, leadsN = leads().length;
ALT.postFail = 500;
d = await chat(sid, "Так перенесли?", move("Марат", "11:00"));
d = await chat(sid, "Алло, перенесли или нет?", move("Марат", "11:00"));
ALT.postFail = 0;
check("повтор той же просьбы трижды — вторая и третья заявки не создаются", leads().length === leadsN && TG.length === tgN, `заявок +${leads().length - leadsN}, уведомлений +${TG.length - tgN}`);

sid = await setup("Марат"); title("3. POST book_record — обрыв связи (исключение fetch)");
ALT.postThrow = true;
d = await chat(sid, "Перенесите на 11:00", move("Марат", "11:00"));
ALT.postThrow = false; showState(sid); console.log("   Telegram:", tgHead());
check("старая цела; заявка администратору; клиенту честно", ALT.deleted.length === 0 && !!d.lead && /НЕ записан/.test(d.lead.note) && /Прежняя запись остаётся/.test(d.reply));

sid = await setup("Марат"); title("4. новая создана, DELETE старой → 500");
ALT.delFail = 500;
d = await chat(sid, "Перенесите на 11:00", move("Марат", "11:00"));
ALT.delFail = 0; showState(sid); console.log("   Telegram:", tgHead());
check("клиенту: новая создана, старую отменит администратор (с её временем); администратору: «НЕ удалена — удалите вручную»",
  /Записала вас/.test(d.reply) && /10:00/.test(d.reply) && /отменит администратор/.test(d.reply) && TG.some(x => /НЕ удалена/.test(x) && /10:00/.test(x)) && d.cancelDone === false);
check("в уведомлении «удалите вручную» есть телефон клиента или номер записи", TG.some(x => /НЕ удалена/.test(x) && (/\+7705/.test(x) || /5550\d\d/.test(x))), "нет ни телефона, ни № записи: " + JSON.stringify(TG.find(x => /НЕ удалена/.test(x))));
console.log("   на /leads:", JSON.stringify(leads().filter(l => l.name === "Марат").slice(-2).map(l => [l.time, l.status || "", l.note])));

sid = await setup("Марат"); title("5. новая создана, DELETE старой → 404");
ALT.delFail = 404;
d = await chat(sid, "Перенесите на 11:00", move("Марат", "11:00"));
ALT.delFail = 0; showState(sid);
check("404 считается «записи уже нет»: клиенту «Перенесла»", /Перенесла вашу запись/.test(d.reply) && d.cancelDone === true);

sid = await setup("Марат"); title("6. новая создана, DELETE старой — обрыв связи");
ALT.delThrow = true;
d = await chat(sid, "Перенесите на 11:00", move("Марат", "11:00"));
ALT.delThrow = false; showState(sid); console.log("   Telegram:", tgHead());
check("как при 500: клиент и администратор знают, что старая не удалена", /отменит администратор/.test(d.reply) && TG.some(x => /НЕ удалена/.test(x)));
d = await chat(sid, "Так старую отменили? Отмените запись на 10:00", `Отменяю.\n[ОТМЕНА] Имя: Марат; Дата: ${D1}; Время: 10:00`);
console.log("   (после сбоя старая запись из чата убрана, повторная отмена из чата невозможна — уходит администратору)");

sid = await setup("Марат"); title("7. Altegio вернул 201 с пустым телом (номер записи неизвестен)");
ALT.emptyBody = true;
d = await chat(sid, "Перенесите на 11:00", move("Марат", "11:00"));
ALT.emptyBody = false; showState(sid); console.log("   Telegram:", tgHead());
check("клиенту не сказано «записала»; старая цела; администратор предупреждён", !/Записала|Перенесла/.test(d.reply) && ALT.deleted.length === 0 && TG.length > 0);

sid = await setup("Марат"); title("8. перенос при 4 активных записях в чате (лимит на чат)");
for (const [i, t] of [["11:00", D1], ["13:00", D1], ["10:00", D2]].entries()) await chat(sid, "ещё", "Записала.\n" + tag("Марат", t[0], { date: t[1] }), { quiet: true });
TG.length = 0;
d = await chat(sid, "Завтрашнюю на 10:00 перенесите на послезавтра 11:00", `Переношу.\n[ОТМЕНА] Имя: Марат; Дата: ${D1}; Время: 10:00\n` + tag("Марат", "11:00", { date: D2 }));
showState(sid);
check("перенос при 4 записях выполняется автоматически (число записей не растёт)", ALT.deleted.length === 1, "перенос ушёл администратору: «" + d.reply + "»");

sid = await setup("Марат"); title("9. перенос на другой день, которого нет в ближайших датах");
d = await chat(sid, "Перенесите на 15 октября", "Перенесла.\n[ОТМЕНА]\n" + tag("Марат", "11:00", { date: "2026-10-15" }));
check("старая цела, клиенту предложены доступные дни и сказано, что прежняя остаётся", ALT.deleted.length === 0 && /ближайшие дни/.test(d.reply) && /Прежняя запись остаётся/.test(d.reply));

sid = await setup("Марат"); title("10. [ОТМЕНА] + [ЗАЯВКА] без имени/с шуточным именем");
d = await chat(sid, "Перенесите на 11:00", "Перенесла.\n[ОТМЕНА]\n" + tag("тест", "11:00"));
check("старая цела; бот просит имя", ALT.deleted.length === 0 && /настоящее имя/.test(d.reply));
showState(sid);
summary();
