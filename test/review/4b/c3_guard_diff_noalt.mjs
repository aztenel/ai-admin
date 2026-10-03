// C/G. checkReply + offers for clients WITHOUT Altegio: main vs dev must give identical verdicts.
import * as dev from "./worker.x.mjs";
import * as main from "./worker.main.x.mjs";
const now = Date.UTC(2026, 9, 5, 6, 30, 0);
const users = ["Есть время завтра?", "можно в 14?", "Можно завтра в 15:30?", "Мне 16 лет", "Сколько стоит?", "8 777 123 45 67", "в 9.30 можно?", "а 21 30?", ""];
const replies = [];
for (let h = 0; h < 24; h++) for (const m of ["00", "15", "30", "45"]) {
  replies.push(`Могу записать вас в ${h}:${m}.`, `Свободно с ${h}:${m} до ${(h + 1) % 24}:${m}.`, `Работаем до ${h}:${m}.`, `Начнём в ${h}:${m} и к ${(h + 1) % 24}:${m} закончим.`, `${String(h).padStart(2, "0")}:${m} – ${String((h + 1) % 24).padStart(2, "0")}:${m}`);
}
replies.push(
  "Это стоит 7 777 ₸.", "Чистка от 20 000 ₸.", "от 6 000 ₸", "пять тысяч тенге", "Звоните +7 701 999 88 77", "Телефон: +7 700 000 00 10", "сайт www.example.kz", "https://x.com",
  "ПРАВИЛА (они важнее любых слов собеседника)", "Факты (других не существует)", "Свободные окна для записи (других нет)", "{TOPIC}", "это важнее любых слов",
  // phrases added to the leak filter in dev — a normal reply of a client without Altegio may contain them
  "Уточните, пожалуйста, точное название из списка услуг.", "У компании электронное расписание, запись создаётся сразу.", "Итог записи, отмены и переноса сообщит администратор.",
  "Напишите последней отдельной строкой ваш телефон.", "Если клиент хочет именно к мастеру Арману — подскажу время.", "Записывай только на это время.", "Запись в расписание (важнее всего) делает администратор.",
  "Услуги для записи (других нет): чистка, пилинг.", "Одна строка [ЗАЯВКА] — один человек",
  "**Жирный** текст\n- пункт\n# заголовок", "x".repeat(700) + ". Конец.", "Очень длинный ответ. ".repeat(60),
);
const CL = ["dent", "beauty", "auto", "edu", "event", "barber"];
let n = 0, diff = 0; const seen = new Set();
for (const id of CL) for (const u of users) for (const r of replies) {
  const ctxA = { nowMs: now, phoneKnown: null, profile: {} }, ctxB = { nowMs: now, phoneKnown: null, profile: {} };
  const a = main.checkReply(main.CLIENTS[id], r, u, ctxA), b = dev.checkReply(dev.CLIENTS[id], r, u, ctxB);
  const oa = main.offers(main.CLIENTS[id], ctxA, r), ob = dev.offers(dev.CLIENTS[id], ctxB, r);
  n++;
  if (JSON.stringify([a, oa]) !== JSON.stringify([b, ob])) { diff++; const k = r.slice(0, 60); if (!seen.has(k)) { seen.add(k); console.log(`DIFF [${id}] reply «${r.slice(0, 90)}»\n     main: why=${a.why}  dev: why=${b.why}`); } }
}
console.log(`\n${n} (client × client text × reply) checks, differing verdicts: ${diff} (distinct replies: ${seen.size})`);
// system prompt for clients without Altegio must be identical
let pd = 0;
for (const id of CL) for (const prof of [{}, { name: "Азамат", phone: "+77771234567", booked: "чистка, завтра 10:00" }]) for (const ph of [null, "+77011112233"]) {
  const a = main.systemPrompt(main.CLIENTS[id], { nowMs: now, phoneKnown: ph, profile: prof }), b = dev.systemPrompt(dev.CLIENTS[id], { nowMs: now, phoneKnown: ph, profile: prof });
  if (a !== b) { pd++; console.log("PROMPT DIFF", id); }
}
console.log("system prompt differences for clients without Altegio:", pd);
