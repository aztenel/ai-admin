// Обычный клиент без Altegio (барбершоп) и ветка «Altegio недоступен»: служебная строка в другом регистре.
// strip() (worker.js:837) вырезает строку без учёта регистра, а разбор в ветке else (worker.js:959, 972) — с учётом.
import { chat, showState, title, check, summary, ALT, TG, leads, env, prof } from "./harness.mjs";
import mainWorker from "./worker_main.js";
import { KV } from "./harness.mjs";

title("A. dev, барбершоп: ИИ написал «[Заявка]» вместо «[ЗАЯВКА]»");
TG.length = 0;
await chat("r1", "Хочу стрижку завтра в 12:00", "Завтра в 12:00 свободно. Как вас зовут?", { c: "barber" });
let d = await chat("r1", "Азамат, 8 777 123 45 67",
  "Забронировала вас на завтра в 12:00. Администратор подтвердит запись.\n[Заявка] Имя: Азамат; Телефон: указан; Услуга: мужская стрижка; Время: завтра, 12:00", { c: "barber" });
console.log("   Telegram:", JSON.stringify(TG), "| заявок барбершопа:", leads("barber").length);
check("заявка создана (или хотя бы служебная строка видна, как в main)", !!d.lead || /\[Заявка\]/.test(d.reply), "клиенту: «" + d.reply + "», заявки нет, уведомления нет");

title("A-main. то же на версии main (7.3) — для сравнения");
{
  const res = await mainWorker.fetch(new Request("https://x.test/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "10.77.0.1" }, body: JSON.stringify({ c: "barber", sid: "rm1", text: "Азамат, 8 777 123 45 67, стрижка завтра в 12:00" }) }), env, { waitUntil() {} });
  const j = await res.json();
  console.log("   main → бот: " + JSON.stringify(j.reply) + " | lead: " + JSON.stringify(j.lead));
}

title("B. dev, барбершоп: «[Отмена]» в другом регистре после созданной заявки");
TG.length = 0;
await chat("r2", "Азамат, 8 777 123 45 68, стрижка завтра в 12:00", "Забронировала вас на завтра в 12:00. Администратор подтвердит запись.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: мужская стрижка; Время: завтра, 12:00", { c: "barber", quiet: true });
TG.length = 0;
d = await chat("r2", "Отмените мою запись", "Передала администратору, он подтвердит отмену.\n[Отмена]", { c: "barber" });
console.log("   Telegram:", JSON.stringify(TG), "| статус заявки:", JSON.stringify(leads("barber").filter(l => l.phone === "+77771234568").map(l => l.status || "активна")));
check("отмена дошла до администратора", d.cancel === true && TG.length > 0, "клиенту: «" + d.reply + "», cancel=" + d.cancel + ", уведомлений " + TG.length);

title("C. клиент с Altegio, расписание недоступно: «[Отмена]» в другом регистре, в чате есть запись");
env.ALTEGIO_LOC_ALT = "3501";
import { tag } from "./harness.mjs";
await chat("r3", "Серик, +7 709 222 22 44, мужская стрижка завтра в 10:00", "Записала.\n" + tag("Серик", "10:00"), { quiet: true });
ALT.down = true; TG.length = 0;
d = await chat("r3", "Отмените мою запись", "Передала администратору, он подтвердит отмену.\n[Отмена]");
console.log("   Telegram:", JSON.stringify(TG.map(x => x.split("\n")[0])));
check("администратор получил «удалите вручную»", TG.some(x => /удалите вручную/.test(x)), "клиенту: «" + d.reply + "», а уведомления об отмене нет");
ALT.down = false;

title("D. контроль: клиент с Altegio, расписание работает — регистр не важен");
env.ALTEGIO_LOC_ALT = "3502"; TG.length = 0;
await chat("r4", "Серик, +7 709 222 22 55, мужская стрижка завтра в 10:00", "Записала.\n" + tag("Серик", "10:00").replace("[ЗАЯВКА]", "[заявка]"), { quiet: true });
d = await chat("r4", "Отмените", "Отменяю.\n[отмена]");
check("в ветке Altegio «[отмена]» распознаётся", d.cancelDone === true);
summary();
