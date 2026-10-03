// Сбои хранилища (KV) на разных шагах сохранения: заявки → история → уведомления.
import { chat, showState, showLeads, tag, title, check, summary, ALT, TG, G, days, prof, hist, leads, env, at, tick, mem, KVFAIL, kvLog } from "./h.mjs";
const { D1, D2 } = days();
const noTG = () => { delete env.TG_TOKEN; };
const withTG = () => { env.TG_TOKEN = "tg"; };
const t0 = () => performance.now();

title("A. Telegram НЕ настроен; KV.put leads:alt падает; одна строка [ЗАЯВКА], Altegio требует код из SMS (заявка администратору)");
noTG(); env.ALTEGIO_LOC_ALT = "3301"; ALT.needCode = true;
KVFAIL.put = k => k === "leads:alt";
let r = await chat("i1", "Тимур, +7 702 111 22 33, стрижка завтра в 10:00", "Записала.\n" + tag("Тимур", "10:00"));
KVFAIL.put = null;
check("клиенту честно: «Не получилось сохранить заявку»", /Не получилось сохранить заявку/.test(r.reply), r.reply);
check("lead в ответе нет (карточка «Новая заявка передана администратору» не рисуется)", !r.lead && !r.leads, JSON.stringify({ lead: r.lead, leads: r.leads }));
showState("i1");
check("pend пуст, adminLeads не вырос → клиент может повторить", (prof("i1").pend || []).length === 0 && !prof("i1").adminLeads, JSON.stringify(prof("i1")));
r = await chat("i1", "Тимур, +7 702 111 22 33, стрижка завтра в 10:00", "Записала.\n" + tag("Тимур", "10:00"));
check("повтор: заявка создана", leads().length === 1 && /Передала вашу запись администратору/.test(r.reply), r.reply);
ALT.needCode = false;

title("B. Telegram НЕ настроен; KV.put leads:alt падает; ДВЕ строки: первая записана в Altegio, вторая — заявка администратору (лимит чата не при чём: код 432 только для второй)");
env.ALTEGIO_LOC_ALT = "3302";
let postN = 0;
ALT.hook = (m, p) => { if (m === "POST" && /book_record/.test(p) && ++postN === 2) return new Response(JSON.stringify({ success: false, data: null, meta: { message: "Ошибка", errors: [{ code: 432, message: "Incorrect SMS verification code" }] } }), { status: 422, headers: { "content-type": "application/json" } }); };
KVFAIL.put = k => k === "leads:alt";
r = await chat("i2", "Тимур и сын Алихан, +7 702 111 22 44: стрижка завтра в 10:00 и детская в 11:00", "Записала обоих.\n" + tag("Тимур", "10:00") + "\n" + tag("Алихан", "11:00", { service: "Детская стрижка" }));
KVFAIL.put = null; ALT.hook = null;
console.log("   lead:", JSON.stringify(r.lead && r.lead.name), "| leads:", JSON.stringify((r.leads || []).map(l => `${l.name}${l.altegio ? " (запись №" + l.altegio.record_id + ")" : " (заявка админу)"}`)));
check("в тексте нет противоречия «Передала … администратору» + «Не получилось сохранить заявку»", !(/Передала вашу запись администратору/.test(r.reply) && /Не получилось сохранить/.test(r.reply)), r.reply);
check("в leads для браузера нет несохранённой заявки (иначе карточка «Новая заявка передана администратору»)", !(r.leads || []).some(l => !l.altegio), JSON.stringify((r.leads || []).map(l => l.name + (l.altegio ? "+altegio" : ""))));
showState("i2");

title("C. Telegram настроен; KV.put leads:alt падает → администратор всё получает в Telegram + предупреждение");
withTG(); env.ALTEGIO_LOC_ALT = "3303"; ALT.needCode = true;
KVFAIL.put = k => k === "leads:alt";
r = await chat("i3", "Тимур, +7 702 111 22 55, стрижка завтра в 10:00", "Записала.\n" + tag("Тимур", "10:00"));
KVFAIL.put = null; ALT.needCode = false;
check("клиенту «Передала…», администратору — заявка и предупреждение", /Передала вашу запись администратору/.test(r.reply) && r.tg.some(t => /Заявка без записи/.test(t)) && r.tg.some(t => /не сохранилась в списке заявок/.test(t)), JSON.stringify(r.tg.map(t => t.split("\n")[0])));

title("D. KV.put истории чата падает дважды после созданной записи");
env.ALTEGIO_LOC_ALT = "3304";
KVFAIL.put = k => k.startsWith("h:web:alt:i4");
r = await chat("i4", "Тимур, +7 702 111 22 66, стрижка завтра в 10:00", "Записала.\n" + tag("Тимур", "10:00"));
KVFAIL.put = null;
check("ответ клиенту есть, исключения нет", /Записала вас/.test(r.reply), JSON.stringify(r));
check("администратор предупреждён, что история не сохранилась", r.tg.some(t => /Не сохранилась история чата/.test(t)), JSON.stringify(r.tg.map(t => t.split("\n")[0])));
check("заявка о записи есть на /leads", leads().some(l => l.phone === "+77021112266" && l.altegio));
r = await chat("i4", "Тимур, +7 702 111 22 66, стрижка завтра в 10:00", "Записала.\n" + tag("Тимур", "10:00"));
console.log("   повтор той же просьбы (бот о записи не помнит): записей в Altegio для этого номера =", ALT.records.filter(x => x.phone === "+77021112266").length, "| ответ:", r.reply);

title("E. KV.get истории внутри putHist падает (чтение перед записью), сама запись в KV работает");
env.ALTEGIO_LOC_ALT = "3305";
let gets = 0;
KVFAIL.get = k => k.startsWith("h:web:alt:i5") && ++gets > 2; // чтения в tooMany и в начале think проходят, чтения в putHist падают
r = await chat("i5", "Тимур, +7 702 111 22 77, стрижка завтра в 10:00", "Записала.\n" + tag("Тимур", "10:00"));
KVFAIL.get = null;
console.log("   чтений истории: " + gets + " | записей истории: " + kvLog.filter(x => x[0] === "put" && x[1].startsWith("h:web:alt:i5")).length);
check("история сохранена несмотря на сбой чтения перед записью (сама запись в KV работает)", !!hist("i5"), "история чата: " + JSON.stringify(hist("i5")) + " | Telegram: " + JSON.stringify(r.tg.map(t => t.split("\n")[0])));

title("F. KV.get в самом начале (чтение истории) падает → что получает клиент");
KVFAIL.get = k => k.startsWith("h:web:alt:i6");
r = await chat("i6", "Здравствуйте", "Здравствуйте!");
KVFAIL.get = null;
check("клиент получает ответ, а не ошибку 500", !r.thrown && !r.httpStatus, JSON.stringify(r).slice(0, 300));

title("G. KV.put счётчика сессий ip:* падает (tooMany) → что получает клиент");
KVFAIL.put = k => k.startsWith("ip:");
r = await chat("i7", "Здравствуйте", "Здравствуйте!");
KVFAIL.put = null;
check("клиент получает ответ, а не ошибку 500", !r.thrown && !r.httpStatus, JSON.stringify(r).slice(0, 300));

title("H. KV.get leads:alt падает при сохранении (обе попытки), Telegram настроен; отмена записи");
env.ALTEGIO_LOC_ALT = "3306";
await chat("i8", "Тимур, +7 702 111 22 88, стрижка завтра в 10:00", "Записала.\n" + tag("Тимур", "10:00"), { quiet: true });
KVFAIL.get = k => k === "leads:alt";
const s0 = t0();
r = await chat("i8", "Отмените запись", "Отменяю.\n[ОТМЕНА]");
KVFAIL.get = null;
console.log(`   время ответа: ${Math.round(t0() - s0)} мс`);
check("запись удалена, клиенту «Отменила»", /Отменила вашу запись/.test(r.reply) && ALT.deleted.length >= 1, r.reply);
showLeads();

title("I. счётчики лимитов bk:* не пишутся (KV.put падает) → запись создаётся, клиент получает ответ");
env.ALTEGIO_LOC_ALT = "3307";
KVFAIL.put = k => k.startsWith("bk:");
r = await chat("i9", "Тимур, +7 702 111 22 99, стрижка завтра в 10:00", "Записала.\n" + tag("Тимур", "10:00"));
KVFAIL.put = null;
check("ответ есть, запись числится в чате и на /leads", /Записала вас/.test(r.reply) && prof("i9").bookings.length === 1 && leads().some(l => l.phone === "+77021112299"), r.reply);

title("J. Telegram НЕ настроен; обычный клиент (барбершоп, без Altegio); KV.put leads:barber падает");
noTG();
KVFAIL.put = k => k === "leads:barber";
r = await chat("i10", "Азамат, 8 777 123 45 67, стрижка завтра в 12:00", "Забронировала вас на завтра в 12:00. Администратор подтвердит запись.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: мужская стрижка; Время: завтра, 12:00", { c: "barber" });
KVFAIL.put = null;
check("клиенту честно сказано, что заявка не сохранилась", /Не получилось сохранить заявку/.test(r.reply) && !r.lead, r.reply);
r = await chat("i10", "Азамат, 8 777 123 45 67, стрижка завтра в 12:00", "Забронировала вас на завтра в 12:00. Администратор подтвердит запись.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: мужская стрижка; Время: завтра, 12:00", { c: "barber" });
check("повтор: заявка создана", leads("barber").length === 1 && !!r.lead, r.reply);
withTG();
summary();
