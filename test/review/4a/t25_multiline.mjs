// Несколько строк [ЗАЯВКА] в одном ответе (до 3), смешанные исходы, общий текст, lead / leads в JSON, лимиты по строкам.
import { chat, showState, showLeads, tag, title, check, summary, ALT, TG, G, days, prof, hist, leads, env, at, tick, mem, call } from "./h.mjs";
const { D1, D2 } = days();
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const bad = s => /undefined|null|NaN|\[object|: \.|, \.|:\s*$|  /.test(s);

title("1. три строки: все записаны");
env.ALTEGIO_LOC_ALT = "3501";
let r = await chat("m1", "Нас трое: Тимур, Алихан и Данияр, +7 702 111 22 33. Завтра 10:00, 11:00 и 13:00", "Записала всех.\n" + tag("Тимур", "10:00") + "\n" + tag("Алихан", "11:00", { service: "Детская стрижка" }) + "\n" + tag("Данияр", "13:00"));
check("3 записи, lead = последняя, leads = 3", ALT.records.length === 3 && r.leads && r.leads.length === 3 && r.lead.name === "Данияр", JSON.stringify({ lead: r.lead && r.lead.name, leads: (r.leads || []).map(l => l.name) }));
check("текст без мусора", !bad(r.reply), r.reply);
check("record_hash и note не уходят в браузер", !JSON.stringify(r).includes("hash5") && !JSON.stringify(r).includes("note"), JSON.stringify(r).slice(0, 300));

title("2. три строки: записан / занято / нужен администратор (код из SMS только для третьей)");
env.ALTEGIO_LOC_ALT = "3502";
let n = 0;
ALT.hook = (m, p) => { if (m === "POST" && /book_record/.test(p)) { n++; if (n === 2) return J({ success: false, data: null, meta: { message: "Ошибка", errors: [{ code: 433, message: "taken" }] } }, 422); if (n === 3) return J({ success: false, data: null, meta: { message: "Ошибка", errors: [{ code: 432, message: "sms" }] } }, 422); } };
r = await chat("m2", "Нас трое: Тимур, Алихан и Данияр, +7 702 111 22 44. Завтра 10:00, 11:00 и 13:00", "Записала всех.\n" + tag("Тимур", "10:00") + "\n" + tag("Алихан", "11:00", { service: "Детская стрижка" }) + "\n" + tag("Данияр", "13:00"));
ALT.hook = null;
check("lead = заявка администратору (последняя), leads = 2 (запись + заявка)", r.leads && r.leads.length === 2, JSON.stringify({ lead: r.lead && r.lead.name, leads: (r.leads || []).map(l => l.name + (l.altegio ? "+запись" : "")) }));
check("текст без мусора и с тремя исходами", !bad(r.reply) && /Записала вас/.test(r.reply) && /занято/.test(r.reply) && /администратору/.test(r.reply), r.reply);
showState("m2");

title("3. четыре строки: четвёртая отбрасывается молча?");
env.ALTEGIO_LOC_ALT = "3503";
r = await chat("m3", "Нас четверо, +7 702 111 22 55", "Записала всех.\n" + tag("Тимур", "9:30") + "\n" + tag("Алихан", "10:00") + "\n" + tag("Данияр", "11:00") + "\n" + tag("Ерлан", "13:00"));
check("клиенту сказано, что четвёртый не записан", /Ерлан|ещё|остальн|четв/i.test(r.reply), r.reply);

title("4. лимит чата (4 активные): в чате 3 записи, приходит 2 строки → 4-я создаётся, 5-я — заявка администратору");
env.ALTEGIO_LOC_ALT = "3504";
await chat("m4", "трое, +7 702 111 22 66", "Записала.\n" + tag("Тимур", "9:30") + "\n" + tag("Алихан", "10:00") + "\n" + tag("Данияр", "11:00"), { quiet: true });
r = await chat("m4", "и ещё двоих", "Записала.\n" + tag("Марат", "13:00") + "\n" + tag("Олжас", "15:00"));
check("4 записи в Altegio, 5-я — заявка", ALT.records.filter(x => x.loc === "3504").length === 4 && /администратору/.test(r.reply), r.reply);
check("в заявке причина — лимит", leads().some(l => l.name === "Олжас" && /лимит/.test(l.note || "")), JSON.stringify(leads().filter(l => l.name === "Олжас").map(l => l.note)));

title("5. лимит на телефон (5 в сутки) считается по каждой строке: 4 записи в чате 1, в чате 2 (тот же телефон) — три строки");
env.ALTEGIO_LOC_ALT = "3505";
await chat("m5", "четверо, +7 702 111 22 77", "Записала.\n" + tag("Тимур", "9:30") + "\n" + tag("Алихан", "10:00") + "\n" + tag("Данияр", "11:00"), { quiet: true });
await chat("m5", "и ещё", "Записала.\n" + tag("Марат", "13:00"), { quiet: true });
r = await chat("m5b", "ещё трое, +7 702 111 22 77", "Записала.\n" + tag("Олжас", "15:00") + "\n" + tag("Серик", "16:00") + "\n" + tag("Бауыржан", "9:30", { date: D2 }));
check("в Altegio 5 записей на этот телефон, остальные — заявки", ALT.records.filter(x => x.phone === "+77021112277").length === 5, String(ALT.records.filter(x => x.phone === "+77021112277").length) + " | " + r.reply);

title("6. две строки: один и тот же человек, то же время (ИИ повторил строку) и второй человек");
env.ALTEGIO_LOC_ALT = "3506";
r = await chat("m6", "Тимур и Алихан, +7 702 111 22 88, завтра 10:00 и 11:00", "Записала.\n" + tag("Тимур", "10:00") + "\n" + tag("Тимур", "10:00") + "\n" + tag("Алихан", "11:00", { service: "Детская стрижка" }));
check("нет «Вы уже записаны» про только что созданную запись", !/Вы уже записаны/.test(r.reply), r.reply);

title("7. вторая запись при существующей: текст «также есть запись» и повтор той же строки");
env.ALTEGIO_LOC_ALT = "3507";
await chat("m7", "Тимур, +7 702 111 22 99, завтра 10:00", "Записала.\n" + tag("Тимур", "10:00"), { quiet: true });
r = await chat("m7", "и сына Алихана на 11:00, и меня не забудьте", "Записала.\n" + tag("Тимур", "10:00") + "\n" + tag("Алихан", "11:00", { service: "Детская стрижка" }));
check("запись Тимура упомянута один раз", (r.reply.match(/в 10:00/g) || []).length === 1, r.reply);

title("8. строка без услуги при превышенном лимите → в тексте нет «: , завтра»");
env.ALTEGIO_LOC_ALT = "3508";
mem.set(`bk:3508:all:${days().D0}`, "60");
r = await chat("m8", "Тимур, +7 702 111 23 00, завтра 10:00", "Записала.\n[ЗАЯВКА] Имя: Тимур; Телефон: указан; Мастер: любой; Дата: " + D1 + "; Время: 10:00");
check("текст без «: ,»", !/: ,/.test(r.reply), r.reply);
console.log("   заявка:", JSON.stringify(leads().filter(l => l.phone === "+77021112300").map(l => [l.service, l.time])));

title("9. Altegio недоступен, строка без услуги (ИИ пишет по обычным правилам, но пропустил поле)");
env.ALTEGIO_LOC_ALT = "3509"; ALT.down = true;
r = await chat("m9", "Тимур, +7 702 111 23 01, завтра в 11:00", "Забронировала.\n[ЗАЯВКА] Имя: Тимур; Телефон: указан; Время: завтра, 11:00");
ALT.down = false;
check("текст без «: ,»", !/: ,/.test(r.reply), r.reply);

title("10. [ЗАЯВКА] и [ОТМЕНА] + ещё одна [ЗАЯВКА]: перенос + «остальное следующим сообщением»");
env.ALTEGIO_LOC_ALT = "3510";
await chat("m10", "Тимур, +7 702 111 23 02, завтра 10:00", "Записала.\n" + tag("Тимур", "10:00"), { quiet: true });
r = await chat("m10", "перенесите на 13:00 и сына Алихана запишите на 11:00", "Переношу.\n[ОТМЕНА]\n" + tag("Тимур", "13:00") + "\n" + tag("Алихан", "11:00", { service: "Детская стрижка" }));
check("перенос выполнен, про сына сказано «следующим сообщением»", /Перенесла вашу запись/.test(r.reply) && /следующим сообщением/.test(r.reply) && !ALT.records.some(x => x.fullname === "Алихан" && x.loc === "3510"), r.reply);
summary();
