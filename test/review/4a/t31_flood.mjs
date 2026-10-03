// Уведомления администратору без ограничения частоты + заявки по многим сессиям.
import { chat, showState, showLeads, tag, title, check, summary, ALT, TG, G, days, prof, hist, leads, env, at, tick, mem, call, LOG } from "./h.mjs";
const { D0, D1, D2 } = days();
LOG.quiet = true;

title("1. один чат без записей: 20 раз «отмените запись» (ИИ каждый раз ставит [ОТМЕНА]) → сколько уведомлений в Telegram");
env.ALTEGIO_LOC_ALT = "3801";
let tg0 = TG.length;
for (let i = 0; i < 20; i++) await chat("p1", "Отмените мою запись", "Передала администратору.\n[ОТМЕНА]");
console.log("   уведомлений администратору:", TG.length - tg0, "| пример:", JSON.stringify((TG.at(-1) || "уведомлений нет").split("\n")[0]));
check("уведомлений об одной и той же просьбе не больше 2 за 20 сообщений", TG.length - tg0 <= 2, String(TG.length - tg0));

title("1б. то же для обычного клиента без Altegio (барбершоп)");
tg0 = TG.length;
for (let i = 0; i < 20; i++) await chat("p2", "Отмените мою запись", "Передала администратору, он подтвердит отмену.\n[ОТМЕНА]", { c: "barber" });
console.log("   уведомлений администратору:", TG.length - tg0);

title("2. ИИ отвечает «запись может быть отменена» на вопрос о правилах (ложное срабатывание) — 10 раз подряд в одном чате");
tg0 = TG.length;
for (let i = 0; i < 10; i++) await chat("p3", "А запись можно отменить, если что?", "Да, запись может быть отменена в любой момент.");
console.log("   уведомлений администратору:", TG.length - tg0);

title("3. превышен лимит на телефон: один IP, 10 новых сессий, в каждой 6 просьб → заявок администратору");
env.ALTEGIO_LOC_ALT = "3802";
mem.set(`bk:3802:+77021112233:${D0}`, "5");
const l0 = leads().length; tg0 = TG.length;
for (let s = 0; s < 10; s++) for (const t of ["9:30", "10:00", "11:00", "13:00", "15:00", "16:00"]) await chat("p4s" + s, `Тимур, +7 702 111 22 33, завтра в ${t}`, "Записала.\n" + tag("Тимур", t), { ip: "10.9.9.9" });
console.log("   заявок администратору:", leads().length - l0, "| уведомлений:", TG.length - tg0);
summary();
