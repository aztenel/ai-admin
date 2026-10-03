// WhatsApp (Meta, с подписью): запись, перенос, отмена; телефон, который расписание не принимает.
import { showLeads, tag, title, check, summary, ALT, TG, G, days, leads, env, at, tick, mem, wa, waOn, waHist } from "./h.mjs";
const { D0, D1, D2 } = days();
const live = loc => ALT.records.filter(x => x.loc === loc && !x.deleted).map(x => `${x.fullname} ${x.phone} ${x.appointments[0].datetime.slice(5, 16)}`);
waOn("alt");

title("1. запись → перенос → отмена в WhatsApp");
env.ALTEGIO_LOC_ALT = "3901";
let w = await wa("77071110001", "Здравствуйте", "Здравствуйте! На какую услугу записать?");
w = await wa("77071110001", "Тимур, стрижка завтра в 10:00", "Записала.\n" + tag("Тимур", "10:00"));
check("запись создана на номер WhatsApp", live("3901").some(x => /\+77071110001/.test(x)), JSON.stringify(live("3901")));
w = await wa("77071110001", "Перенесите на 13:00", "Переношу.\n[ОТМЕНА]\n" + tag("Тимур", "13:00"));
w = await wa("77071110001", "Отмените", "Отменяю.\n[ОТМЕНА]");
check("после отмены записей нет", live("3901").length === 0, JSON.stringify(live("3901")));

title("2. Altegio не принимает номер WhatsApp (код 431): клиент пишет другой номер, но бот снова отправляет номер WhatsApp");
env.ALTEGIO_LOC_ALT = "3902";
ALT.hook = (m, p, init) => { if (m === "POST" && /book_record/.test(p) && JSON.parse(init.body).phone === "+998901234567") return new Response(JSON.stringify({ success: false, data: null, meta: { message: "Ошибка", errors: [{ code: 431, message: "Wrong phone format" }] } }), { status: 422, headers: { "content-type": "application/json" } }); };
w = await wa("998901234567", "Здравствуйте", "Здравствуйте! На какую услугу записать?");
w = await wa("998901234567", "Тимур, стрижка завтра в 10:00", "Записала.\n" + tag("Тимур", "10:00"));
w = await wa("998901234567", "+7 702 111 22 33", "Спасибо! Записала.\n" + tag("Тимур", "10:00"));
check("после того как клиент прислал другой номер, запись создана (или заявка ушла администратору)", live("3902").length === 1 || leads().some(l => /998901234567|77021112233/.test(l.phone)), `ответ: ${JSON.stringify(w.out)}; записей ${live("3902").length}, заявок ${leads().length}`);
w = await wa("998901234567", "Я же написал номер: +7 702 111 22 33", "Записала.\n" + tag("Тимур", "10:00"));
console.log("   третья попытка →", JSON.stringify(w.out));
ALT.hook = null;

title("3. «меню» / «сброс» в WhatsApp стирает историю чата вместе с записями (в Altegio запись остаётся)");
env.ALTEGIO_LOC_ALT = "3903";
await wa("77071110003", "Здравствуйте", "Здравствуйте!");
await wa("77071110003", "Тимур, стрижка завтра в 10:00", "Записала.\n" + tag("Тимур", "10:00"));
await wa("77071110003", "меню", undefined);
w = await wa("77071110003", "Отмените мою запись", "Отменяю.\n[ОТМЕНА]");
check("после «меню» клиент может отменить свою запись из чата", live("3903").length === 0, `ответ: ${JSON.stringify(w.out)}; живые записи: ${JSON.stringify(live("3903"))}`);
summary();
