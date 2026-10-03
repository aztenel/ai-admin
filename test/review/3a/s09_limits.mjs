// Лимиты автоматических записей: 4 активных на чат, 5 в сутки на телефон и на IP (IPv6 — по /64), 60 в сутки на локацию.
import { chat, showState, tag, title, check, summary, ALT, TG, days, prof, leads, env, mem, iso } from "./harness.mjs";
const { D1, D2 } = days();
const T = [["09:30", D1], ["10:00", D1], ["11:00", D1], ["13:00", D1], ["09:30", D2], ["10:00", D2], ["11:00", D2], ["13:00", D2]];
const reset = loc => { env.ALTEGIO_LOC_ALT = String(loc); ALT.records.length = 0; ALT.deleted.length = 0; TG.length = 0; };

reset(3901); title("1. один чат: 4 записи создаются, 5-я → заявка администратору");
let d;
for (let i = 0; i < 5; i++) d = await chat("L1", i ? "ещё одну" : "Тимур, +7 707 000 11 01, мужская стрижка", "Записала.\n" + tag("Тимур", T[i][0], { date: T[i][1] }), { quiet: true });
check("в Altegio ровно 4 записи, 5-я ушла администратору с пометкой про лимит", ALT.records.length === 4 && !!d.lead && !d.lead.altegio && /лимит/.test(d.lead.note), JSON.stringify([ALT.records.length, d.reply]));
console.log("   5-й ответ клиенту:", d.reply);
title("1б. отменил одну → место освободилось → 5-я (по счёту суток на телефон — тоже 5-я) создаётся");
d = await chat("L1", "Отмените запись на завтра в 9:30", `Отменяю.\n[ОТМЕНА] Дата: ${D1}; Время: 09:30`, { quiet: true });
d = await chat("L1", "А теперь запишите на послезавтра 10:00", "Записала.\n" + tag("Тимур", "10:00", { date: D2 }), { quiet: true });
check("после отмены одной записи новая создаётся (5-я за сутки на телефон)", ALT.records.length === 5 && !!(d.lead && d.lead.altegio), d.reply);
d = await chat("L1", "Отмените запись на завтра в 10:00", `Отменяю.\n[ОТМЕНА] Дата: ${D1}; Время: 10:00`, { quiet: true });
d = await chat("L1", "И ещё на послезавтра 11:00", "Записала.\n" + tag("Тимур", "11:00", { date: D2 }), { quiet: true });
check("6-я за сутки с одного телефона → администратору, хотя активных в чате только 3", ALT.records.length === 5 && !!d.lead && !d.lead.altegio, JSON.stringify([ALT.records.length, d.reply]));
console.log("   счётчики KV:", JSON.stringify([...mem.entries()].filter(([k]) => k.startsWith("bk:3901"))));

reset(3902); title("2. один телефон, разные чаты и разные IP: 5 записей, 6-я → администратору");
for (let i = 0; i < 6; i++) d = await chat("L2" + i, `Клиент${i}, +7 707 000 11 02, мужская стрижка`, "Записала.\n" + tag("Арсен", T[i][0], { date: T[i][1] }), { quiet: true });
check("ровно 5 записей на телефон за сутки", ALT.records.length === 5 && !d.lead.altegio, String(ALT.records.length));

reset(3903); title("3. один IPv4, разные телефоны и чаты: 5 записей, 6-я → администратору");
for (let i = 0; i < 6; i++) d = await chat("L3" + i, `Арсен, +7 707 000 12 0${i}, мужская стрижка`, "Записала.\n" + tag("Арсен", T[i][0], { date: T[i][1] }), { quiet: true, ip: "203.0.113.9" });
check("ровно 5 записей на IP за сутки", ALT.records.length === 5 && !d.lead.altegio, String(ALT.records.length));

reset(3904); title("4. IPv6: одна подсеть /64, полная запись адреса (2a03:d000:1:2:…)");
for (let i = 0; i < 6; i++) d = await chat("L4" + i, `Арсен, +7 707 000 13 0${i}, мужская стрижка`, "Записала.\n" + tag("Арсен", T[i][0], { date: T[i][1] }), { quiet: true, ip: `2a03:d000:1:2:${i + 1}::${i + 7}` });
check("адреса одной подсети /64 считаются одним источником", ALT.records.length === 5, String(ALT.records.length));

reset(3905); title("5. IPv6: одна подсеть /64, но в префиксе есть нулевые группы — адрес приходит в сжатом виде (2001:db8::<хост>)");
// 2001:db8:0:0:a:b:c:N — все шесть адресов из одной подсети 2001:db8:0:0::/64; по RFC 5952 они пишутся как 2001:db8::a:b:c:N
for (let i = 0; i < 7; i++) d = await chat("L5" + i, `Арсен, +7 707 000 14 0${i}, мужская стрижка`, "Записала.\n" + tag("Арсен", T[i][0], { date: T[i][1] }), { quiet: true, ip: `2001:db8::${i + 1}:b:c:d` });
check("сжатая запись IPv6: 6-я и 7-я записи из той же /64 не создаются", ALT.records.length === 5, "создано " + ALT.records.length + " записей; ключи: " + JSON.stringify([...mem.keys()].filter(k => k.startsWith("bk:3905:2001"))));

reset(3906); title("6. потолок на локацию: 60 в сутки");
mem.set(`bk:3906:all:${iso(Date.now())}`, "59");
d = await chat("L60", "Ринат, +7 709 777 22 01, мужская стрижка завтра в 10:00", "Записала.\n" + tag("Ринат", "10:00"), { quiet: true });
const d2 = await chat("L61", "Ринат, +7 709 777 22 02, мужская стрижка завтра в 11:00", "Записала.\n" + tag("Ринат", "11:00"), { quiet: true });
check("60-я создаётся, 61-я → администратору", !!d.lead.altegio && !d2.lead.altegio && ALT.records.length === 1, JSON.stringify([d.lead.note, d2.lead.note]));

reset(3907); title("7. сверх лимита: каждая новая просьба = новая заявка и новое уведомление (потолка нет)");
for (let i = 0; i < 4; i++) await chat("L7", i ? "ещё" : "Тимур, +7 707 000 15 01, мужская стрижка", "Записала.\n" + tag("Тимур", T[i][0], { date: T[i][1] }), { quiet: true });
TG.length = 0; const ln = leads().length;
for (let i = 0; i < 10; i++) await chat("L7", "и ещё одну", "Записала.\n" + tag("Тимур" + i, "10:00", { date: D2 }), { quiet: true });
console.log(`   10 просьб сверх лимита в одном чате → заявок +${leads().length - ln}, уведомлений в Telegram +${TG.length}`);

reset(3908); title("8. перенос считается новой записью: 1 запись + 4 переноса = лимит на телефон исчерпан");
d = await chat("L8", "Тимур, +7 707 000 16 01, мужская стрижка завтра в 9:30", "Записала.\n" + tag("Тимур", "09:30"), { quiet: true });
const seq = ["10:00", "11:00", "13:00", "09:30", "10:00"];
for (const t of seq) d = await chat("L8", "перенесите на " + t, "Переношу.\n[ОТМЕНА]\n" + tag("Тимур", t), { quiet: true });
console.log("   после 1 записи и 5 переносов:", d.reply);
check("5-й перенос за день выполняется автоматически", /Перенесла/.test(d.reply), "ушёл администратору");
summary();
