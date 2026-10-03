// Проверка обвязки: базовый путь записи, отмены, переноса.
import { chat, showState, showLeads, tag, title, check, summary, ALT, TG, days, prof, leads, env } from "./h.mjs";
const { D1, D2 } = days();
console.log("сегодня:", days());
title("запись");
let r = await chat("a1", "Тимур, +7 702 111 22 33, мужская стрижка завтра в 10:00", "Записала вас.\n" + tag("Тимур", "10:00"));
check("запись создана", ALT.records.length === 1 && /Записала вас: Мужская стрижка — завтра/.test(r.reply), r.reply);
showState("a1");
title("перенос");
r = await chat("a1", "Перенесите на 13:00", "Переношу.\n[ОТМЕНА]\n" + tag("Тимур", "13:00"));
check("перенос", /Перенесла вашу запись/.test(r.reply) && ALT.deleted.length === 1, r.reply);
showState("a1");
title("отмена");
r = await chat("a1", "Отмените запись", "Отменяю.\n[ОТМЕНА]");
check("отмена", /Отменила вашу запись/.test(r.reply) && ALT.deleted.length === 2 && r.cancelDone === true, r.reply);
showState("a1"); showLeads();
summary();
