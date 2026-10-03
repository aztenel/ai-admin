// Altegio недоступен, у клиента есть запись в чате. ИИ действует строго по подсказке («Свободных окон нет — предложи оставить имя и телефон для обратного звонка»).
import { chat, showState, tag, title, check, summary, ALT, TG, days, prof, leads, env } from "./harness.mjs";
const { D1 } = days();
env.ALTEGIO_LOC_ALT = "3111";
title("1. Altegio работает: Серик записан на 10:00");
await chat("cb1", "Серик, +7 709 222 22 33, мужская стрижка завтра в 10:00", "Записала.\n" + tag("Серик", "10:00"), { quiet: true });
ALT.down = true; TG.length = 0; const n0 = leads().length;
title("2. Altegio упал. Клиент хочет записать ещё и жену — ИИ предлагает обратный звонок, клиент соглашается");
let d = await chat("cb1", "Хочу ещё жену записать на послезавтра", "Сейчас не вижу расписание. Оставьте, пожалуйста, имя и телефон — администратор перезвонит и запишет.");
d = await chat("cb1", "Айгуль, тот же номер, +7 709 222 22 33", "Спасибо! Администратор перезвонит вам в ближайшее время.");
console.log("   Telegram (кроме «Altegio не отвечает»):", JSON.stringify(TG.filter(x => !/Altegio не отвечает/.test(x))), "| новых заявок:", leads().length - n0);
check("клиенту обещан звонок → администратор получил заявку на звонок", leads().length > n0 || TG.some(x => /Перезвоните/.test(x)), "клиенту: «" + d.reply + "», а администратор ничего не получил");
ALT.down = false;

env.ALTEGIO_LOC_ALT = "3112";
title("3. контроль: записи в чате нет (отменена раньше) — заявка на звонок создаётся");
await chat("cb2", "Марат, +7 705 111 22 33, мужская стрижка завтра в 10:00", "Записала.\n" + tag("Марат", "10:00"), { quiet: true });
await chat("cb2", "Отмените", "Отменяю.\n[ОТМЕНА]", { quiet: true });
ALT.down = true; TG.length = 0; const n1 = leads().length;
d = await chat("cb2", "Запишите меня снова, на послезавтра в 11:00", "Забронировала вас на послезавтра в 11:00. Администратор подтвердит запись.\n[ЗАЯВКА] Имя: Марат; Телефон: указан; Услуга: стрижка; Время: послезавтра, 11:00");
console.log("   заявка:", JSON.stringify(d.lead && { service: d.lead.service, time: d.lead.time, note: d.lead.note }), "| Telegram:", JSON.stringify(TG.filter(x => !/Altegio не отвечает/.test(x)).map(x => x.split("\n")[0])));
check("администратор получил хоть что-то", leads().length > n1);
check("в заявке есть то, о чём просил клиент (послезавтра, 11:00)", !!d.lead && /11:00/.test(d.lead.time + d.lead.service), "в заявке только «" + (d.lead && d.lead.service) + " / " + (d.lead && d.lead.time) + "», а клиенту сказано: «" + d.reply + "»");
ALT.down = false;
summary();
