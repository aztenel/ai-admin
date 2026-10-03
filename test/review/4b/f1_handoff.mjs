// F. wantsHuman (dev) vs HANDOFF (main): false negatives introduced by the new exception, remaining false positives.
// Unit level (worker.x.mjs = worker.js + export line) and end-to-end through /api/chat on the real worker.js.
import * as dev from "./worker.x.mjs";
import * as main from "./worker.main.x.mjs";

const real = [ // the client really asks for a human
  "Позовите человека, я хочу записаться",
  "Позовите человека, хочу записаться на стрижку",
  "Позовите человека, бот не понимает. Мне нужно отменить бронь",
  "Дайте человека, я уже записывался и хочу перенести",
  "Можно человека? У меня вопрос по записи",
  "Нужен человек, а не бот! Запишите меня нормально",
  "Нужен человек, хочу уточнить по услугам",
  "Хочу человека, вопрос по моей брони на 5 октября",
  "Переключите на человека, запись не та",
  "Соедините меня с человеком по поводу записи",
  "Хочу поговорить с человеком по поводу записи",
  "Позовите живого человека, я по записи",
  "Позовите человека",
  "человек",
  "Позовите администратора, хочу записаться",
  "Дайте оператора",
  "Можно человека к телефону? Я записан на 15:00",
  "Позовите человека, я записана на 4 октября на 11:00 и опаздываю",
  "Нужно поговорить с человеком",
  "Мне нужен человек, стрижка получилась ужасная",
  "Позовите, пожалуйста, человека — у вас стрижка стоила 6000, а взяли 9000",
  "Хочу человека, на 3 человек столик... шучу, просто позовите человека",
  "адаммен сөйлескім келеді, жазылу керек",
  "I want to talk to a human about my booking",
];
const notHuman = [ // booking talk, not a handoff
  "Хочу записать человека на стрижку",
  "Можно человека на стрижку записать?",
  "Нужно записать 3 человека",
  "Нужно 3 человека записать на завтра",
  "Можно записать ещё одного человека?",
  "Хочу привести человека на консультацию",
  "Можно человеку 70 лет на имплантацию?",
  "Можно прийти с человеком?",
  "Нужна живая музыка на свадьбу",
  "Можно живую музыку?",
  "Мне нужно реально быстро подстричься",
  "Хочу реально короткую стрижку",
  "Хочу узнать, менеджер может показать зал?",
  "А менеджер может показать зал в субботу?",
  "У меня жалобы на зубную боль уже неделю, можно записаться?",
  "Можно оператору Kaspi оплатить?",
  "Нужен администратор в салон? Ищу работу",
  "Можно к администратору подойти оплатить?",
  "Той на 200 человек, можно?",
  "Нужно на 5 человек",
];
const row = (t, want) => {
  const m = main.HANDOFF.test(t), d = dev.wantsHuman(t);
  const tag = want ? (d ? "ok  " : (m ? "FALSE NEGATIVE (regression vs main)" : "false negative (same as main)")) : (d ? (m ? "false positive (same as main)" : "FALSE POSITIVE (new)") : (m ? "fixed false positive" : "ok  "));
  console.log(`${tag.padEnd(38)} main=${m ? "handoff" : "bot    "} dev=${d ? "handoff" : "bot    "} | ${t}`);
};
console.log("--- real requests for a human");
real.forEach(t => row(t, true));
console.log("\n--- not a request for a human");
notHuman.forEach(t => row(t, false));

// end-to-end: the real worker, non-Altegio client
console.log("\n--- end-to-end on worker.js (client dent, stubbed LLM)");
const worker = (await import(new URL("../../../worker.js", import.meta.url).pathname)).default;
const mem = new Map(), tg = [];
const KV = { get: async k => mem.get(k) ?? null, put: async (k, v) => { mem.set(k, v); }, delete: async k => { mem.delete(k); } };
const env = { KV, GEMINI_KEY: "k", VERIFY_TOKEN: "vt", LEADS_KEY: "lk", TG_TOKEN: "tg", TG_CHAT: "1" };
globalThis.fetch = async (u, init = {}) => {
  const url = String(u);
  if (url.includes("generativelanguage")) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Конечно! На какую услугу вас записать?" }] }, finishReason: "STOP" }] }));
  if (url.includes("telegram")) { tg.push(JSON.parse(init.body).text); return new Response("{}"); }
  throw new Error("unexpected " + url);
};
let n = 0;
for (const t of ["Позовите человека, я хочу записаться", "Позовите человека, бот не понимает. Мне нужно отменить бронь", "Нужен человек, хочу уточнить по услугам"]) {
  tg.length = 0;
  const r = await (await worker.fetch(new Request("https://x.test/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "10.9.0." + (++n) }, body: JSON.stringify({ c: "dent", sid: "h" + n, text: t }) }), env, {})).json();
  console.log(`client: ${t}\n  → handoff=${!!r.handoff} | admin notified: ${tg.length ? JSON.stringify(tg[0].slice(0, 60)) : "NO"} | reply: ${r.reply}`);
}
