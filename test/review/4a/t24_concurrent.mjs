// Два сообщения одного чата обрабатываются одновременно: слияние при сохранении (mergeProfile).
import { chat, showState, showLeads, tag, title, check, summary, ALT, TG, TGCFG, G, days, prof, hist, leads, env, at, tick, mem, KVFAIL, kvLog } from "./h.mjs";
const { D1, D2 } = days();
const last = body => body.contents.at(-1).parts[0].text;
const sleep = ms => new Promise(s => setTimeout(s, ms));
const state = sid => { const p = prof(sid) || {}; return `bookings=${JSON.stringify((p.bookings || []).map(b => b.name + " " + b.time))} pend=${JSON.stringify((p.pend || []).map(x => x.key))} n=${(hist(sid) || {}).n}`; };
const turnsOf = sid => (hist(sid) || { turns: [] }).turns.map(t => (t.role === "user" ? "К: " : "Б: ") + t.text.slice(0, 40));

title("1. A = запись (ИИ думает 300 мс), B = вопрос (ИИ 50 мс), B стартует и сохраняется раньше A");
env.ALTEGIO_LOC_ALT = "3401";
await chat("j1", "Здравствуйте, я Тимур, +7 702 111 22 33", "Здравствуйте! На какую услугу записать?", { quiet: true });
G.fn = b => /запишите/.test(last(b)) ? "Записала.\n" + tag("Тимур", "10:00") : "Оплата Kaspi или наличными.";
G.delay = b => /запишите/.test(last(b)) ? 300 : 50;
let [a, b] = await Promise.all([chat("j1", "запишите на стрижку завтра в 10:00", undefined, { quiet: true }), (async () => { await sleep(20); return chat("j1", "а как оплатить?", undefined, { quiet: true }); })()]);
console.log("   A:", a.reply, "\n   B:", b.reply, "\n  ", state("j1"), "\n   история:", JSON.stringify(turnsOf("j1")));
check("запись из A числится в чате", prof("j1").bookings.length === 1);
check("в истории оба обмена, без дублей", turnsOf("j1").length === 6 && new Set(turnsOf("j1")).size === 6, JSON.stringify(turnsOf("j1")));

title("2. A = отмена (DELETE в Altegio 300 мс), B = вопрос, стартовал до сохранения A, сохраняется ПОСЛЕ A → отменённая запись не воскресает");
env.ALTEGIO_LOC_ALT = "3402";
G.fn = null; G.delay = 0;
await chat("j2", "Тимур, +7 702 111 22 44, стрижка завтра в 10:00", "Записала.\n" + tag("Тимур", "10:00"), { quiet: true });
ALT.delDelay = 200;
G.fn = b => /отмените/i.test(last(b)) ? "Отменяю.\n[ОТМЕНА]" : "Оплата Kaspi или наличными.";
G.delay = b => /отмените/i.test(last(b)) ? 10 : 500;
[a, b] = await Promise.all([chat("j2", "Отмените запись", undefined, { quiet: true }), (async () => { await sleep(20); return chat("j2", "а как оплатить?", undefined, { quiet: true }); })()]);
ALT.delDelay = 0;
console.log("   A:", a.reply, "\n   B:", b.reply, "\n  ", state("j2"));
check("отменённая запись не воскресла", prof("j2").bookings.length === 0, state("j2"));

title("3. A = запись (300 мс), B = «стоп» (без ИИ; уведомление в Telegram идёт 600 мс) → B сохраняет историю ПОСЛЕ A обычным put без слияния");
env.ALTEGIO_LOC_ALT = "3403";
G.fn = null; G.delay = 0;
await chat("j3", "Здравствуйте, я Тимур, +7 702 111 22 55", "Здравствуйте! На какую услугу записать?", { quiet: true });
G.fn = () => "Записала.\n" + tag("Тимур", "10:00"); G.delay = 300;
// Telegram «зависает» только для сообщения про «стоп»
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => { if (String(u).includes("api.telegram.org") && /попросил не писать/.test(init.body)) await sleep(600); return realFetch(u, init); };
[a, b] = await Promise.all([chat("j3", "запишите на стрижку завтра в 10:00", undefined, { quiet: true }), (async () => { await sleep(20); return chat("j3", "стоп", undefined, { quiet: true }); })()]);
globalThis.fetch = realFetch;
console.log("   A:", a.reply, "\n   B:", b.reply, "\n  ", state("j3"), "| pausedUntil:", !!prof("j3").pausedUntil);
console.log("   в Altegio записей для чата:", ALT.records.filter(x => x.phone === "+77021112255" && !x.deleted).length);
check("запись, созданная сообщением A, числится в чате после сохранения B", (prof("j3").bookings || []).length === 1, state("j3"));

title("3б. то же с «позовите администратора» (handoff)");
env.ALTEGIO_LOC_ALT = "3404";
G.fn = null; G.delay = 0;
await chat("j4", "Здравствуйте, я Тимур, +7 702 111 22 66", "Здравствуйте! На какую услугу записать?", { quiet: true });
G.fn = () => "Записала.\n" + tag("Тимур", "10:00"); G.delay = 300;
globalThis.fetch = async (u, init) => { if (String(u).includes("api.telegram.org") && /просит администратора/.test(init.body)) await sleep(600); return realFetch(u, init); };
[a, b] = await Promise.all([chat("j4", "запишите на стрижку завтра в 10:00", undefined, { quiet: true }), (async () => { await sleep(20); return chat("j4", "позовите администратора", undefined, { quiet: true }); })()]);
globalThis.fetch = realFetch;
console.log("   A:", a.reply, "\n   B:", b.reply, "\n  ", state("j4"), "| pausedUntil:", !!prof("j4").pausedUntil);
check("запись, созданная сообщением A, числится в чате после сохранения B", (prof("j4").bookings || []).length === 1, state("j4"));

title("4. A = удачная запись, которая снимает старую заявку из pend («заменена»); B = вопрос, сохранился раньше → pend воскресает");
env.ALTEGIO_LOC_ALT = "3405";
G.fn = null; G.delay = 0; ALT.needCode = true;
await chat("j5", "Тимур, +7 702 111 22 77, стрижка завтра в 11:00", "Записала.\n" + tag("Тимур", "11:00"), { quiet: true });
ALT.needCode = false;
console.log("   до:", state("j5"));
G.fn = b => /13:00/.test(last(b)) ? "Записала.\n" + tag("Тимур", "13:00") : "Оплата Kaspi или наличными.";
G.delay = b => /13:00/.test(last(b)) ? 300 : 50;
[a, b] = await Promise.all([chat("j5", "тогда давайте в 13:00", undefined, { quiet: true }), (async () => { await sleep(20); return chat("j5", "а как оплатить?", undefined, { quiet: true }); })()]);
console.log("   A:", a.reply, "\n   B:", b.reply, "\n   после:", state("j5"));
showLeads();
check("заявка, помеченная «заменена», убрана из pend", (prof("j5").pend || []).length === 0, state("j5"));
G.fn = null; G.delay = 0;
const r = await chat("j5", "А на 11:00 меня тоже запишите", "Записала.\n" + tag("Тимур", "11:00"));
console.log("   (если pend воскрес — клиенту скажут «Ваша заявка у администратора», хотя заявка помечена «заменена»)");

title("5. три сообщения разом: две записи разным людям и вопрос");
env.ALTEGIO_LOC_ALT = "3406";
await chat("j6", "Здравствуйте, я Тимур, +7 702 111 22 88", "Здравствуйте!", { quiet: true });
G.fn = b => /Алихан/.test(last(b)) ? "Записала.\n" + tag("Алихан", "11:00", { service: "Детская стрижка" }) : /меня/.test(last(b)) ? "Записала.\n" + tag("Тимур", "10:00") : "Оплата Kaspi.";
G.delay = b => /Алихан/.test(last(b)) ? 200 : /меня/.test(last(b)) ? 100 : 300;
await Promise.all([chat("j6", "запишите меня на 10:00 завтра", undefined, { quiet: true }), chat("j6", "и сына Алихана на 11:00", undefined, { quiet: true }), chat("j6", "как оплатить?", undefined, { quiet: true })]);
console.log("  ", state("j6"), "| история:", JSON.stringify(turnsOf("j6")));
check("обе записи числятся в чате", prof("j6").bookings.length === 2, state("j6"));
check("в истории 2 + 6 реплик", turnsOf("j6").length === 8, String(turnsOf("j6").length));
summary();
