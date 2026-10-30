// @ts-check
// Сервисные сообщения для пульта (вкладка «Сервисные · номер бота», 19.10.2026): что бот шлёт сам, без администратора (напоминание
// накануне в 18:00, за 2 часа, просьба об отзыве через 3 часа — только по записям, которые клиент сделал в чате с ботом), что стоит
// в очереди и сколько ушло за 3 дня. Номера — только маской: очередь хранит цифры номера (id чата), браузеру они целиком не уходят.
/** @import { Env, Client } from "../../lib/types.js" */
import { maskPhone } from "../../lib/phone.js";
import { botOff } from "../channels/index.js";
import { altLoc } from "../booking/book.js";
import { altUserKey } from "../booking/journal.js";
import { jrqLoad, jrHold } from "../../db/kv/reminders.js";
import { jrOn } from "./journal.js";
import { remindLive } from "./plan.js";

const QUEUE_MAX = 50;
// сколько переписок читаем, чтобы убрать из очереди то, что бот не отправит (запись отменена, перенесена, «стоп»): очередь бывает
// до 500 сообщений — дальше этих переписок сообщения показываем как есть
const CHAT_READS = 50;

// напоминания по журналу Altegio со второго номера (c.jr, journal.js, 30.10.2026): все записи журнала, без бота. Очередь jrq: хранит
// имя из Altegio и цифры номера; в силе ли запись, проверяет отправка (журнал её дня) — здесь показываем очередь как есть
/** @param {Env} env @param {Client} c @param {number} now */
async function journalInfo(env, c, now) {
  const o = { from: 10, to: 21, eve: "18:00", h2: true, rv: true, ...c.jr }, altegio = altLoc(env, c) > 0 && !!altUserKey(env, c), enabled = jrOn(env, c);
  const go = altegio && enabled, rv = go && o.rv && !!c.review;
  const kinds = [
    { k: "d1", label: `Накануне в ${o.eve} — напоминание о записи`, on: go && !!o.eve },
    { k: "h2", label: `За 2 часа — напоминание (только с ${o.from}:00 до ${o.to}:00)`, on: go && !!o.h2 },
    { k: "rv", label: "Через 3 часа после визита с отметкой «пришёл» — просьба об отзыве (одному клиенту — раз в 60 дней)", on: rv, ...(c.review ? { link: String(c.review) } : {}) },
  ];
  const on = /** @type {Record<string, boolean>} */ ({ d1: kinds[0].on, h2: kinds[1].on, rv });
  const soon = (await jrqLoad(env, c.id)).filter(x => x && on[x.k] && x.at > now - 3600e3).sort((a, b) => a.at - b.at);
  const queue = soon.slice(0, QUEUE_MAX).map(x => ({ k: x.k, at: x.at, ch: "ga", phone: maskPhone(x.p), name: String(x.n || ""), date: x.date, time: x.time }));
  let sent3d = 0;
  try { const r = await env.KV.list({ prefix: `rmok:${c.id}:`, limit: 1000 }); sent3d = ((r && r.keys) || []).length; } catch (e) {}
  return { kinds, queue, total: soon.length, sent3d, botOff: false, altegio, journal: true, enabled, hold: await jrHold(env, c.id) };
}

/** @param {Env} env @param {Client} c @param {number} now */
export async function serviceInfo(env, c, now) {
  if (c.jr) return journalInfo(env, c, now);
  // напоминания и отзыв бот строит только по своим записям в Altegio (remindPlan в orchestrator.js): без Altegio они не уходят никогда
  const altegio = altLoc(env, c) > 0;
  const remind = altegio && c.remind !== "off", h2 = remind && c.remind !== "day", rv = altegio && !!c.review;
  const kinds = [
    { k: "d1", label: "Накануне в 18:00 — напоминание о записи", on: remind },
    { k: "h2", label: "За 2 часа — напоминание о записи", on: h2 },
    { k: "rv", label: "Через 3 часа после визита — просьба оставить отзыв", on: rv, ...(c.review ? { link: String(c.review) } : {}) },
  ];
  /** @type {any[]} */ let q = [];
  try { q = JSON.parse((await env.KV.get("rmq:" + c.id)) || "[]") || []; } catch (e) { console.log("service queue", String(e)); }
  const on = /** @type {Record<string, boolean>} */ ({ d1: remind, h2, rv });
  const soon = q.filter(x => x && on[x.k] && x.at > now - 3600e3).sort((a, b) => a.at - b.at);
  // в силе ли: те же правила, что у отправки (remindLive). Переписку читаем одну на клиента; не прочиталась — показываем как есть
  const keys = [...new Set(soon.map(x => `h:${x.ch}:${c.id}:${x.id}`))].slice(0, CHAT_READS);
  /** @type {Map<string, any>} */ const prof = new Map();
  await Promise.all(keys.map(async k => { try { const h = JSON.parse((await env.KV.get(k)) || "null"); prof.set(k, (h && h.profile) || {}); } catch (e) { console.log("service chat", String(e)); } }));
  const due = soon.filter(x => { const p = prof.get(`h:${x.ch}:${c.id}:${x.id}`); return p === undefined || !!remindLive(p, x); });
  // имена — из строк списка чатов (метаданные ключей h:<канал>:<клиент>:<id>), без чтения каждой переписки
  /** @type {Map<string, string>} */ const names = new Map();
  for (const ch of [...new Set(due.slice(0, QUEUE_MAX).map(x => x.ch))]) {
    try { const r = await env.KV.list({ prefix: `h:${ch}:${c.id}:`, limit: 1000 }); for (const k of (r && r.keys) || []) if (k.metadata && k.metadata.nm) names.set(k.name, String(k.metadata.nm)); } catch (e) {}
  }
  const queue = due.slice(0, QUEUE_MAX).map(x => ({ k: x.k, at: x.at, ch: x.ch, phone: maskPhone(x.id), name: names.get(`h:${x.ch}:${c.id}:${x.id}`) || "", date: x.date, time: x.time }));
  // «ушло» — отметка rmok:<клиент>:<запись>:<вид> (3 дня), её ставит удачная отправка; rms: — только попытка (могла не дойти)
  let sent3d = 0;
  try { const r = await env.KV.list({ prefix: `rmok:${c.id}:`, limit: 1000 }); sent3d = ((r && r.keys) || []).length; } catch (e) {}
  return { kinds, queue, total: due.length, sent3d, botOff: botOff(env, c, "ga"), altegio };
}
