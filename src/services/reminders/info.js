// @ts-check
// Сервисные сообщения для пульта (вкладка «Сервисные · номер бота», 19.10.2026): что бот шлёт сам, без администратора (напоминание
// накануне в 18:00, за 2 часа, просьба об отзыве через 3 часа — только по записям, которые клиент сделал в чате с ботом), что стоит
// в очереди и сколько ушло за 3 дня. Номера — только маской: очередь хранит цифры номера (id чата), браузеру они целиком не уходят.
/** @import { Env, Client } from "../../lib/types.js" */
import { maskPhone } from "../../lib/phone.js";
import { botOff } from "../channels/index.js";

const QUEUE_MAX = 50;

/** @param {Env} env @param {Client} c @param {number} now */
export async function serviceInfo(env, c, now) {
  const remind = c.remind !== "off", h2 = remind && c.remind !== "day";
  const kinds = [
    { k: "d1", label: "Накануне в 18:00 — напоминание о записи", on: remind },
    { k: "h2", label: "За 2 часа — напоминание о записи", on: h2 },
    { k: "rv", label: "Через 3 часа после визита — просьба оставить отзыв", on: !!c.review, ...(c.review ? { link: String(c.review) } : {}) },
  ];
  /** @type {any[]} */ let q = [];
  try { q = JSON.parse((await env.KV.get("rmq:" + c.id)) || "[]") || []; } catch (e) { console.log("service queue", String(e)); }
  const on = /** @type {Record<string, boolean>} */ ({ d1: remind, h2, rv: !!c.review });
  const due = q.filter(x => x && on[x.k] && x.at > now - 3600e3).sort((a, b) => a.at - b.at);
  // имена — из строк списка чатов (метаданные ключей h:<канал>:<клиент>:<id>), без чтения каждой переписки
  /** @type {Map<string, string>} */ const names = new Map();
  for (const ch of [...new Set(due.slice(0, QUEUE_MAX).map(x => x.ch))]) {
    try { const r = await env.KV.list({ prefix: `h:${ch}:${c.id}:`, limit: 1000 }); for (const k of (r && r.keys) || []) if (k.metadata && k.metadata.nm) names.set(k.name, String(k.metadata.nm)); } catch (e) {}
  }
  const queue = due.slice(0, QUEUE_MAX).map(x => ({ k: x.k, at: x.at, ch: x.ch, phone: maskPhone(x.id), name: names.get(`h:${x.ch}:${c.id}:${x.id}`) || "", date: x.date, time: x.time }));
  // отметка «отправлено» (rms:<клиент>:<запись>:<вид>) живёт 3 дня — по ней и число за 3 дня
  let sent3d = 0;
  try { const r = await env.KV.list({ prefix: `rms:${c.id}:`, limit: 1000 }); sent3d = ((r && r.keys) || []).length; } catch (e) {}
  return { kinds, queue, total: due.length, sent3d, botOff: botOff(env, c, "ga") };
}
