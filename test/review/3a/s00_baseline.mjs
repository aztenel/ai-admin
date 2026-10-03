// Базовая проверка обвязки: запись → вторая запись → отмена одной → перенос другой.
import { chat, showState, tag, title, check, summary, ALT, TG, days, prof, leads, env } from "./harness.mjs";
const { D1 } = days();
env.ALTEGIO_LOC_ALT = "3000";

title("запись Тимура на 10:00");
let d = await chat("b1", "Тимур, +7 702 111 22 33, мужская стрижка завтра в 10:00", "Записала вас.\n" + tag("Тимур", "10:00"));
check("запись создана и клиенту сказано «Записала вас»", ALT.records.length === 1 && /Записала вас: Мужская стрижка/.test(d.reply));
check("record_hash не ушёл в браузер", !JSON.stringify(d).includes("hash"));
showState("b1");

title("запись сына Алихана на 11:00");
d = await chat("b1", "И сына Алихана на детскую стрижку завтра в 11:00", "Записала.\n" + tag("Алихан", "11:00", { service: "Детская стрижка" }));
check("вторая запись создана", ALT.records.length === 2 && /У вас также есть запись/.test(d.reply));
showState("b1");

title("отмена записи Тимура по имени");
d = await chat("b1", "Отмените мою запись, Тимура", `Отменяю.\n[ОТМЕНА] Имя: Тимур`);
check("удалена именно запись Тимура", ALT.deleted.length === 1 && ALT.deleted[0].startsWith("555001/") && d.cancelDone === true);
showState("b1");

title("перенос записи Алихана на 13:00");
d = await chat("b1", "Алихана перенесите на 13:00", "Перенесла.\n[ОТМЕНА]\n" + tag("Алихан", "13:00", { service: "Детская стрижка" }));
check("новая создана, старая удалена", ALT.records.length === 3 && ALT.deleted.length === 2 && ALT.deleted[1].startsWith("555002/") && /Перенесла вашу запись/.test(d.reply));
showState("b1");
const p = prof("b1");
check("в чате числится одна запись — новая", p.bookings.length === 1 && p.bookings[0].record_id === 555003 && p.pending == null);
console.log("   заявки:", JSON.stringify(leads().map(l => [l.name, l.time, l.status || "", l.note])));
console.log("   Telegram:", JSON.stringify(TG.map(x => x.split("\n")[0])));
summary();
