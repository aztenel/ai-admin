// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 1)
// Напоминания о записи и просьба об отзыве: расписание (remindPlan) и тексты (remindText).
/** @import { Env, Client } from "../../lib/types.js" */
import { TZ, local } from "../../lib/time.js";
import { kvRetry } from "../../db/kv/retry.js";
// ===== Напоминания о записи и просьба об отзыве =====
// Только о записях, которые бот сам создал в Altegio (у записей, сделанных администратором напрямую в Altegio, бот не знает о клиенте).
// Очередь клиента — ключ rmq:<клиент> (список { k, at, ch, id, rec, date, time }), список клиентов с очередью — rmidx.
// Перед отправкой бот перечитывает чат: запись должна быть на месте, без просьбы об отмене или переносе, клиент не писал «стоп».
// Через официальный WhatsApp (Meta) — только в 24-часовом окне (иначе нужен шаблон). Отметка «отправлено» ставится до отправки
/** @param {string} date @param {string} time @param {number} [dayShift] */
export const atLocal = (date, time, dayShift = 0) => { const [y, mo, d] = date.split("-").map(Number), [hh, mm] = time.split(":").map(Number); return Date.UTC(y, mo - 1, d + dayShift, hh - TZ, mm); };
/** @param {Env} env @param {Client} c @param {string} hk @param {any[]} books @param {number} made */
export async function remindPlan(env, c, hk, books, made) {
  const m = /^h:(wa|ga):([^:]+):(\d+)$/.exec(hk); if (!m) return;
  /** @type {any[]} */
  const items = [];
  for (const b of books) {
    if (!b || !b.record_id || !/^\d{4}-\d{2}-\d{2}$/.test(b.date || "") || !/^\d{1,2}:\d{2}$/.test(b.time || "")) continue;
    const t = atLocal(b.date, b.time), base = { ch: m[1], id: m[3], rec: String(b.record_id), date: b.date, time: b.time };
    if (c.remind !== "off") {
      const eve = atLocal(b.date, "18:00", -1); // накануне в 18:00
      if (eve - made >= 3600e3 && t - eve >= 12 * 3600e3) items.push({ ...base, k: "d1", at: eve });
      const h2 = t - 2 * 3600e3; // за 2 часа — не раньше 8:00 и только если запись сделана заранее
      if (c.remind !== "day" && t - made >= 4 * 3600e3 && local(h2).getUTCHours() >= 8) items.push({ ...base, k: "h2", at: h2 });
    }
    if (c.review) { // через 3 часа после начала; вечером и ночью — на следующее утро в 11:00
      let rv = t + 3 * 3600e3; const L = local(rv), lh = L.getUTCHours();
      if (lh >= 21 || lh < 10) rv = Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate() + (lh >= 21 ? 1 : 0), 11 - TZ, 0);
      items.push({ ...base, k: "rv", at: rv });
    }
  }
  if (!items.length) return;
  await kvRetry(async () => { const q = JSON.parse((await env.KV.get("rmq:" + c.id)) || "[]"); for (const x of items) if (!q.some(/** @param {any} y */ y => y.rec === x.rec && y.k === x.k)) q.push(x); await env.KV.put("rmq:" + c.id, JSON.stringify(q.slice(-500))); });
  await kvRetry(async () => { const ix = JSON.parse((await env.KV.get("rmidx")) || "[]"); if (!ix.includes(c.id)) { ix.push(c.id); await env.KV.put("rmidx", JSON.stringify(ix)); } });
}
/** @param {Client} c @param {any} b @param {string} k @param {any} [lang] */
export function remindText(c, b, k, lang) {
  const svc = [b.services, b.staffName].filter(Boolean).join(" · "), name = c.name, adr = c.address || "";
  if (lang === "kk") return k === "d1" ? `Еске салу: «${name}» сізді ертең сағат ${b.time}-де күтеді${svc ? " — " + svc : ""}. Жоспарыңыз өзгерсе, осында жазыңыз.`
    : k === "h2" ? `«${name}» сізді бүгін сағат ${b.time}-де күтеді${svc ? " (" + svc + ")" : ""}.${adr ? " Мекенжай: " + adr + "." : ""} Кешіксеңіз немесе келе алмасаңыз, осында жазыңыз.`
    : `Бізге келгеніңізге рахмет! «${name}» туралы пікір қалдырсаңыз, қуанамыз: ${c.review}\nБірдеңе ұнамаса, осында жазыңыз — әкімшіге жеткіземіз.`;
  if (lang === "en") return k === "d1" ? `Reminder: «${name}» is expecting you tomorrow at ${b.time}${svc ? " — " + svc : ""}. If your plans change, just write here.`
    : k === "h2" ? `We're expecting you today at ${b.time} at «${name}»${svc ? " (" + svc + ")" : ""}.${adr ? " Address: " + adr + "." : ""} If you're running late or can't make it, write here.`
    : `Thank you for visiting «${name}»! We'd be grateful for a review: ${c.review}\nIf something wasn't right, write here and we'll pass it to the administrator.`;
  return k === "d1" ? `Напоминаем: завтра в ${b.time} вас ждут в «${name}»${svc ? " — " + svc : ""}. Если планы изменились, напишите сюда.`
    : k === "h2" ? `Ждём вас сегодня в ${b.time} в «${name}»${svc ? " (" + svc + ")" : ""}.${adr ? " Адрес: " + adr + "." : ""} Если опаздываете или не сможете прийти — напишите сюда.`
    : `Спасибо, что были у нас в «${name}»! Будем благодарны за отзыв: ${c.review}\nЕсли что-то не понравилось — напишите сюда, передадим администратору.`;
}
