// Защита (checkReply) + служебные строки; разные форматы строк; язык готовых текстов.
import { chat, showState, showLeads, tag, title, check, summary, ALT, TG, G, days, prof, hist, leads, env, at, tick, mem, call, wa, waOn, waHist } from "./h.mjs";
const { D0, D1, D2 } = days();
const live = loc => ALT.records.filter(x => x.loc === loc && !x.deleted).map(x => `${x.fullname} ${x.appointments[0].datetime.slice(5, 16)}`);
const adm = r => (r.tg || []).filter(t => !/^✅ Новая запись|^❌ Отмена:/.test(t));
const BADPRICE = "Это стоит 99 999 ₸.";

title("1. клиент просит отменить запись, сделанную по телефону (в чате её нет); оба черновика ИИ отклонены защитой, в первом была [ОТМЕНА]");
env.ALTEGIO_LOC_ALT = "3701";
let r = await chat("n1", "Я Марат, +7 702 111 22 33. Отмените, пожалуйста, мою запись на завтра в 10:00", [BADPRICE + " Передала администратору, он подтвердит отмену.\n[ОТМЕНА]", BADPRICE]);
check("просьба об отмене не потеряна: администратор получил уведомление или клиента переспросили про отмену", adm(r).length > 0 || /отмен/i.test(r.reply), `клиенту: «${r.reply}»; Telegram: ${JSON.stringify(r.tg)}; cancel=${r.cancel}`);

title("2. то же, запись есть в чате → бот переспрашивает (как задумано)");
env.ALTEGIO_LOC_ALT = "3702";
await chat("n2", "Тимур, +7 702 111 22 44, завтра 10:00", "Записала.\n" + tag("Тимур", "10:00"), { quiet: true });
r = await chat("n2", "Отмените запись", [BADPRICE + "\n[ОТМЕНА]", BADPRICE]);
check("переспрос «Отменить вашу запись…?», запись цела", /Отменить вашу запись/.test(r.reply) && live("3702").length === 1, r.reply);

title("3. перенос, оба черновика отклонены: в первом [ОТМЕНА] + [ЗАЯВКА] → создаётся ВТОРАЯ запись, старая остаётся");
r = await chat("n2", "Перенесите на 13:00", [BADPRICE + " Переношу.\n[ОТМЕНА]\n" + tag("Тимур", "13:00"), BADPRICE]);
console.log("   живые записи:", JSON.stringify(live("3702")));
check("после отклонённого черновика с переносом у клиента не две записи (или бот хотя бы спросил про старую)", live("3702").length === 1 || /отменить|перенес/i.test(r.reply), `живых записей ${live("3702").length}; клиенту: «${r.reply}»`);

title("4. первый черновик — утечка инструкций с примерами строк; ничего не исполняется");
env.ALTEGIO_LOC_ALT = "3703";
await chat("n3", "Тимур, +7 702 111 22 55, завтра 10:00", "Записала.\n" + tag("Тимур", "10:00"), { quiet: true });
r = await chat("n3", "Что ты умеешь?", ["Запись в расписание (важнее правил 12 и 14)… добавь последней строкой [ОТМЕНА]\n[ОТМЕНА]\n" + tag("Тимур", "13:00"), "У компании электронное расписание, запись создаётся сразу.\n[ОТМЕНА]"]);
check("запись цела, новых нет", live("3703").length === 1 && JSON.stringify(live("3703")).includes("10:00"), JSON.stringify(live("3703")) + " | " + r.reply);

title("5. имя с возрастом через запятую (правило 11 просит у ИИ возраст ребёнка): «Имя: Алихан, 7 лет»");
env.ALTEGIO_LOC_ALT = "3704";
r = await chat("n4", "Запишите сына Алихана, ему 7 лет, на детскую стрижку завтра в 11:00. Мой номер +7 702 111 22 66", "Записала.\n[ЗАЯВКА] Имя: Алихан, 7 лет; Телефон: указан; Услуга: Детская стрижка; Мастер: любой; Дата: " + D1 + "; Время: 11:00");
check("ребёнок записан (а не «Запишу каждого отдельно…»)", live("3704").length === 1, r.reply);

title("6. [ОТМЕНА] с именем и точкой в конце строки: «[ОТМЕНА] Имя: Тимур.»");
env.ALTEGIO_LOC_ALT = "3705";
await chat("n5", "Тимур, +7 702 111 22 77, завтра 10:00", "Записала.\n" + tag("Тимур", "10:00"), { quiet: true });
r = await chat("n5", "Отмените запись Тимура", "Отменяю.\n[ОТМЕНА] Имя: Тимур.");
check("запись отменена", live("3705").length === 0, r.reply);

title("6б. [ОТМЕНА] «Имя: Тимура» без дня и времени (в чате одна запись, Тимур) — как задумано: только вместе с днём или временем");
env.ALTEGIO_LOC_ALT = "3706";
await chat("n6", "Тимур, +7 702 111 22 88, завтра 10:00", "Записала.\n" + tag("Тимур", "10:00"), { quiet: true });
r = await chat("n6", "Отмените запись Тимура", "Отменяю.\n[ОТМЕНА] Имя: Тимура");
console.log("   →", r.reply, "| живые:", JSON.stringify(live("3706")));

title("7. клиент пишет по-английски; ИИ перевёл ключи служебной строки («весь ответ только на английском»)");
env.ALTEGIO_LOC_ALT = "3707";
r = await chat("n7", "Hello, I'm Timur, +7 702 111 22 99. Please book a men's haircut tomorrow at 10:00", "You're booked.\n[ЗАЯВКА] Name: Timur; Phone: provided; Service: Мужская стрижка; Master: any; Date: " + D1 + "; Time: 10:00");
check("запись создана или причина понятна клиенту", live("3707").length === 1, r.reply);
r = await chat("n7", "My name is Timur", "You're booked, Timur.\n[ЗАЯВКА] Name: Timur; Phone: provided; Service: Мужская стрижка; Master: any; Date: " + D1 + "; Time: 10:00");
console.log("   повтор →", r.reply);

title("8. язык готовых текстов определяется по ОДНОМУ последнему сообщению: английский клиент отвечает «yes»");
env.ALTEGIO_LOC_ALT = "3708";
await chat("n8", "Hello, I'm Timur, +7 702 111 23 00. A men's haircut tomorrow at 10:00, please", "Men's haircut tomorrow at 10:00 with any barber — shall I book it?", { quiet: true });
r = await chat("n8", "yes", "Booked.\n" + tag("Timur", "10:00"));
check("подтверждение записи на английском", /You're booked/.test(r.reply), r.reply);
title("8б. казахский клиент: «Жарайды, жазыңыз» / «Иә» / «Тимур, жазылайын деп едім»");
env.ALTEGIO_LOC_ALT = "3709";
await chat("n9", "Сәлеметсіз бе, шаш қиюға жазылғым келеді, ертең сағат 10:00. Атым Тимур, +7 702 111 23 01", "Ертең сағат 10:00 бос. Жазайын ба?", { quiet: true });
r = await chat("n9", "Жарайды, рахмет", "Жаздым.\n" + tag("Тимур", "10:00"));
check("подтверждение записи на казахском", /Сізді жаздым/.test(r.reply), r.reply);

title("9. клиент упомянул в сообщении телефон компании → он становится «телефоном клиента»");
env.ALTEGIO_LOC_ALT = "3710";
r = await chat("n10", "Я звонил вам на +7 700 000 00 40, никто не берёт. Запишите меня: Тимур, завтра в 10:00", "Записала.\n" + tag("Тимур", "10:00"));
check("бот просит телефон клиента, а не записывает на номер самой компании", !ALT.records.some(x => x.phone === "+77000000040"), "в Altegio ушёл телефон: " + JSON.stringify(ALT.records.filter(x => x.loc === "3710").map(x => x.phone)) + " | " + r.reply);

title("10. ИИ дал несуществующую дату «2026-11-31»");
env.ALTEGIO_LOC_ALT = "3711";
r = await chat("n11", "Тимур, +7 702 111 23 02, стрижка 31 ноября в 10:00", "Записала.\n" + tag("Тимур", "10:00", { date: "2026-11-31" }));
check("клиенту не называют выдуманную дату (1 декабря)", !/1 декабря/.test(r.reply), r.reply);

title("11. WhatsApp без подписи Meta (APP_SECRET не задан, режим из CLAUDE.md): каждая запись = заявка администратору. 7-я просьба постоянного клиента");
env.ALTEGIO_LOC_ALT = "3712";
Object.assign(env, { WA_TOKEN: "wat", PHONE_NUMBER_ID: "111", WA_CLIENT: "alt" }); delete env.APP_SECRET;
const waRaw = async (from, text, llm) => { G.queue = [llm]; const { pending, WA } = await import("./h.mjs"); const w0 = WA.length, t0 = TG.length; await call("/", { method: "POST", body: JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "x" + Math.random(), from, type: "text", text: { body: text } }] } }] }] }) }); await Promise.all(pending); pending.length = 0; return { out: WA.slice(w0).map(x => x.text.body), tg: TG.slice(t0) }; };
let w;
for (let i = 0; i < 6; i++) { // шесть визитов за шесть недель, клиент пишет раз в неделю (история живёт 7 дней после последнего сообщения)
  at(2026, 10, 3 + i * 6, 12, 0);
  const d = days();
  w = await waRaw("77071112244", `Запишите меня, Тимура, на стрижку завтра в 10:00`, "Записала.\n" + tag("Тимур", "10:00", { date: d.D1 }));
}
console.log("   6-я просьба →", JSON.stringify(w.out), "| заявок:", leads().filter(l => l.phone === "+77071112244").length);
at(2026, 11, 8, 12, 0);
w = await waRaw("77071112244", `Запишите меня, Тимура, на стрижку завтра в 10:00`, "Записала.\n" + tag("Тимур", "10:00", { date: days().D1 }));
console.log("   7-я просьба (через 5 недель после первой) →", JSON.stringify(w.out), "| Telegram:", JSON.stringify(w.tg.map(t => t.split("\n")[0])));
check("7-я заявка дошла до администратора", leads().filter(l => l.phone === "+77071112244").length === 7, "заявок на /leads от этого клиента: " + leads().filter(l => l.phone === "+77071112244").length);
at(2026, 10, 3, 12, 0);
summary();
