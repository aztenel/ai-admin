// Перенос: режимы «swap» (прежняя запись найдена до создания новой → лимиты не тратятся) и «move».
import { chat, showState, showLeads, tag, title, check, summary, ALT, TG, G, days, prof, hist, leads, env, at, tick, mem, call } from "./h.mjs";
const { D0, D1, D2 } = days();
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const cnt = (loc, what) => +(mem.get(`bk:${loc}:${what}:${D0}`) || 0);
const live = loc => ALT.records.filter(x => x.loc === loc && !x.deleted).map(x => `${x.fullname} ${x.appointments[0].datetime.slice(5, 16)}`);

title("1. swap не тратит лимиты: 1 запись + 10 переносов подряд");
env.ALTEGIO_LOC_ALT = "3601";
const slots = ["9:30", "10:00", "11:00", "13:00", "15:00", "16:00"];
await chat("s1", "Тимур, +7 702 111 22 33, завтра 10:00", "Записала.\n" + tag("Тимур", "10:00"), { quiet: true });
let r, cur = "10:00";
for (let i = 0; i < 10; i++) { const t = slots.filter(x => x !== cur)[i % 5]; r = await chat("s1", `Перенесите на ${t}`, "Переношу.\n[ОТМЕНА]\n" + tag("Тимур", t), { quiet: true }); cur = t; }
console.log("   последний ответ:", r.reply);
console.log(`   в Altegio создано ${ALT.records.filter(x => x.loc === "3601").length}, живых ${live("3601").length}; счётчики суток: телефон=${cnt("3601", "+77021112233")}, локация=${cnt("3601", "all")}`);
check("все 10 переносов выполнены автоматически, живая запись одна", live("3601").length === 1 && ALT.records.filter(x => x.loc === "3601").length === 11);

title("2. swap, но старую запись Altegio удалить не дал (DELETE → 403): каждая попытка = +1 живая запись без учёта в лимитах");
env.ALTEGIO_LOC_ALT = "3602";
await chat("s2", "Тимур, +7 702 111 22 44, завтра 10:00", "Записала.\n" + tag("Тимур", "10:00"), { quiet: true });
ALT.delFail = 403; cur = "10:00";
for (let i = 0; i < 8; i++) { const t = slots.filter(x => x !== cur)[i % 5]; const d = i < 5 ? D1 : D2; r = await chat("s2", `Перенесите на ${t}`, "Переношу.\n[ОТМЕНА]\n" + tag("Тимур", t, { date: d }), { quiet: true }); cur = t; }
ALT.delFail = 0;
console.log("   последний ответ:", r.reply);
console.log(`   живых записей в Altegio на этот телефон: ${live("3602").length}; в чате числится: ${prof("s2").bookings.length}; счётчик телефона за сутки: ${cnt("3602", "+77021112244")} (лимит 5)`);
check("при несработавшем удалении лимит 5 записей в сутки на телефон соблюдается", live("3602").length <= 5, `живых записей ${live("3602").length}: ${JSON.stringify(live("3602"))}`);

title("3. то же, если Altegio не прислал record_hash (удалить нечем)");
env.ALTEGIO_LOC_ALT = "3603"; ALT.noHash = true;
await chat("s3", "Тимур, +7 702 111 22 55, завтра 10:00", "Записала.\n" + tag("Тимур", "10:00"), { quiet: true });
cur = "10:00";
for (let i = 0; i < 8; i++) { const t = slots.filter(x => x !== cur)[i % 5]; const d = i < 5 ? D1 : D2; r = await chat("s3", `Перенесите на ${t}`, "Переношу.\n[ОТМЕНА]\n" + tag("Тимур", t, { date: d }), { quiet: true }); cur = t; }
ALT.noHash = false;
console.log("   последний ответ:", r.reply);
check("без record_hash лимит 5 записей в сутки на телефон соблюдается", live("3603").length <= 5, `живых записей ${live("3603").length}; счётчик телефона ${cnt("3603", "+77021112255")}`);

title("4. swap: новое время занято (soft) → старая запись цела, ничего не удалено");
env.ALTEGIO_LOC_ALT = "3604";
await chat("s4", "Тимур, +7 702 111 22 66, завтра 10:00", "Записала.\n" + tag("Тимур", "10:00"), { quiet: true });
ALT.taken = true;
r = await chat("s4", "Перенесите на 11:00", "Переношу.\n[ОТМЕНА]\n" + tag("Тимур", "11:00"));
ALT.taken = false;
check("старая цела, «Прежняя запись остаётся»", live("3604").length === 1 && /Прежняя запись остаётся/.test(r.reply) && !r.cancel, r.reply);

title("5. swap: новая запись — жёсткий отказ (код 432) → заявка администратору, старая цела");
ALT.needCode = true;
r = await chat("s4", "Перенесите на 13:00", "Переношу.\n[ОТМЕНА]\n" + tag("Тимур", "13:00"));
ALT.needCode = false;
check("старая цела, заявка с пометкой про перенос", live("3604").length === 1 && leads().some(l => /клиент просил перенос — прежняя запись не отменена/.test(l.note || "")), r.reply);

title("6. swap, где «новая» запись уже существует (same), а в строке отмены — другая запись этого же человека");
env.ALTEGIO_LOC_ALT = "3605";
await chat("s5", "Тимур, +7 702 111 22 77, завтра 10:00", "Записала.\n" + tag("Тимур", "10:00"), { quiet: true });
await chat("s5", "и ещё на 13:00", "Записала.\n" + tag("Тимур", "13:00"), { quiet: true });
r = await chat("s5", "Перенесите запись с 10:00 на 13:00", "Переношу.\n[ОТМЕНА] Имя: Тимур; Дата: " + D1 + "; Время: 10:00\n" + tag("Тимур", "13:00"));
check("запись на 10:00 удалена, на 13:00 осталась одна", JSON.stringify(live("3605")) === JSON.stringify([`Тимур ${D1.slice(5)}T13:00`]), JSON.stringify(live("3605")) + " | " + r.reply);

title("7. swap: [ОТМЕНА] указывает на запись ДРУГОГО человека, [ЗАЯВКА] — на нового: «отмените Алихана, запишите Данияра»");
env.ALTEGIO_LOC_ALT = "3606";
await chat("s6", "Тимур и Алихан, +7 702 111 22 88", "Записала.\n" + tag("Тимур", "10:00") + "\n" + tag("Алихан", "11:00", { service: "Детская стрижка" }), { quiet: true });
r = await chat("s6", "Алихана отмените, вместо него запишите Данияра на 13:00", "Хорошо.\n[ОТМЕНА] Имя: Алихан\n" + tag("Данияр", "13:00"));
console.log("   живые:", JSON.stringify(live("3606")));
check("Алихан удалён, Данияр записан, Тимур цел", live("3606").length === 2 && live("3606").some(x => /Данияр/.test(x)) && live("3606").some(x => /Тимур/.test(x)), r.reply);

title("8. move: в чате нет записи того, кого переносят (записывали по телефону) → новая создаётся с учётом лимитов, администратору «отмените вручную»");
env.ALTEGIO_LOC_ALT = "3607";
r = await chat("s7", "Я Марат, +7 702 111 22 99. Перенесите мою запись с 10:00 на 13:00", "Переношу.\n[ОТМЕНА] Имя: Марат; Время: 10:00\n" + tag("Марат", "13:00"));
check("новая создана, счётчик вырос, клиенту «Прежнюю запись отменит администратор»", live("3607").length === 1 && cnt("3607", "+77021112299") === 1 && /отменит администратор/.test(r.reply) && r.tg.some(t => /отмените её вручную/.test(t)), r.reply);
check("cancel в ответе: отмена передана администратору (карточка в чате)", r.cancel === true && r.cancelDone === false, `cancel=${r.cancel} cancelDone=${r.cancelDone}`);

title("9. swap при 4 активных записях и исчерпанном суточном лимите телефона → перенос всё равно автоматический");
env.ALTEGIO_LOC_ALT = "3608";
await chat("s8", "четверо, +7 702 111 23 00", "Записала.\n" + tag("Тимур", "9:30") + "\n" + tag("Алихан", "10:00") + "\n" + tag("Данияр", "11:00"), { quiet: true });
await chat("s8", "и Марата", "Записала.\n" + tag("Марат", "13:00"), { quiet: true });
mem.set(`bk:3608:+77021112300:${D0}`, "5");
r = await chat("s8", "Марата перенесите на 15:00", "Переношу.\n[ОТМЕНА] Имя: Марат\n" + tag("Марат", "15:00"));
check("перенос выполнен", /Перенесла вашу запись/.test(r.reply), r.reply);

title("10. перенос, когда прежняя запись уже началась 20 минут назад (ещё «активна» 30 минут)");
env.ALTEGIO_LOC_ALT = "3609";
ALT.loc["3609"] = { dates: [D0, D1], times: { 0: ["12:30", "15:00", "16:00"] } };
at(2026, 10, 3, 11, 0);
await chat("s9", "Тимур, +7 702 111 23 01, сегодня 12:30", "Записала.\n" + tag("Тимур", "12:30", { date: D0 }), { quiet: true });
at(2026, 10, 3, 12, 50); tick(0);
r = await chat("s9", "Перенесите на 15:00", "Переношу.\n[ОТМЕНА]\n" + tag("Тимур", "15:00", { date: D0 }));
console.log("   12:50, запись была на 12:30 →", r.reply);
at(2026, 10, 3, 13, 5);
r = await chat("s9", "Отмените запись", "Отменяю.\n[ОТМЕНА]");
console.log("   13:05 →", r.reply, "| живые:", JSON.stringify(live("3609")));
at(2026, 10, 3, 12, 0);
summary();
