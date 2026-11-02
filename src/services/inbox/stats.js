// @ts-check
// Аналитика исходящих (ТЗ v2.0 §8, 31.10.2026): сколько напоминаний, просьб об отзыве, рассылок и ответов сотрудников
// отправлено, доставлено, прочитано, не дошло и сколько раз клиент ответил. Источник — отчёты Green-API о доставке
// (outgoingMessageStatus: sent, delivered, read, failed) и входящие после нашего автоматического сообщения.
// Считается в базе D1 (событие на сообщение и статус, повтор вебхука не считается). Без базы (боевой сайт сейчас) — числа
// не копятся, экран говорит об этом прямо. Green-API не обещает каждый статус: «доставлено» или «прочитано» может не прийти
// (у клиента выключены отчёты о прочтении), поэтому «прочитано» — не меньше, чем пришло отчётов, а не точное число.
/** @import { Env } from "../../lib/types.js" */
import { d1Ready } from "../../db/d1/status.js";
import { msgEventAdd, msgEventCounts } from "../../db/d1/stats.js";
import { replyTo } from "./queue.js";

export const SOURCES = ["service", "review", "campaign", "admin"];
const EVENTS = ["sent", "delivered", "read", "failed", "replied"];

/** Чьё сообщение: напоминание, просьба об отзыве, рассылка, ответ сотрудника. Бот — не считаем. @param {any} t */
export function srcOf(t) {
  if (!t) return "";
  if (t.rm) return t.rm === "rv" || t.rm === "s12" ? "review" : "service"; // rv — просьба об отзыве (S12), остальное — подтверждения и напоминания
  if (t.bc) return "campaign";
  if (t.by === "admin") return "admin";
  return "";
}

/** Отчёт о доставке нашего сообщения. «Отправлено» — по любому отчёту (sent, delivered или read: sent мог не прийти первым).
 *  @param {Env} env @param {string} cid @param {string} ch @param {string} mid @param {any} turn @param {string} status наш статус (stOf) @param {number} now */
export async function statStatus(env, cid, ch, mid, turn, status, now) {
  const src = srcOf(turn);
  if (!src || !mid || !status) return;
  try {
    const db = await d1Ready(env, now);
    if (!db) return;
    if (status === "failed" && turn.st !== "failed") return; // уже доставлено — поздняя ошибка Green-API не считается (как у галочек, status.js)
    const at = +turn.t || now, d = { ch, src };
    if (status === "sent" || status === "delivered" || status === "read") await msgEventAdd(db, cid, `msg:${cid}:${ch}:${mid}:sent`, "msg_sent", d, at);
    if (status !== "sent") await msgEventAdd(db, cid, `msg:${cid}:${ch}:${mid}:${status}`, "msg_" + status, d, now);
  } catch (e) { console.log("stat", String(e).slice(0, 120)); }
}

// ключ события без номера клиента: короткий отпечаток (номера в D1-журнал событий не пишем)
const tag = (/** @type {string} */ s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619); return (x >>> 0).toString(36); };

/** Клиент ответил на наше автоматическое сообщение (напоминание, отзыв, рассылка) — один раз на сообщение.
 *  @param {Env} env @param {string} cid @param {string} ch @param {string} digits @param {any[]} turns история С входящим @param {number} now */
export async function statReply(env, cid, ch, digits, turns, now) {
  const i = (turns || []).map(t => t && t.role).lastIndexOf("user");
  if (i < 0) return;
  const src = replyTo(turns.slice(0, i), now);
  if (!src) return;
  const our = turns.slice(0, i).reverse().find(t => t && (t.rm || t.bc));
  try {
    const db = await d1Ready(env, now);
    if (!db) return;
    await msgEventAdd(db, cid, `rep:${cid}:${ch}:${tag(digits)}:${src.k}:${src.id}:${src.at}`, "msg_replied", { ch, src: srcOf(our) || "service" }, now);
  } catch (e) { console.log("stat reply", String(e).slice(0, 120)); }
}

/** Числа для пульта: за последние N дней (по умолчанию 7), по источникам. @param {Env} env @param {string} cid @param {number} now @param {number} [days] */
export async function statsOf(env, cid, now, days = 7) {
  const n = Math.max(1, Math.min(90, Math.round(+days) || 7)), from = now - n * 86400e3;
  /** @type {Record<string, Record<string, number>>} */
  const by = Object.fromEntries(SOURCES.map(s => [s, Object.fromEntries(EVENTS.map(e => [e, 0]))]));
  const db = await d1Ready(env, now);
  if (!db) return { available: false, why: "Счётчики копятся в базе D1 — на этом адресе её нет. Числа появятся после подключения базы.", days: n, from, to: now, by };
  for (const r of await msgEventCounts(db, cid, from, now + 1)) {
    const e = String(r.kind).replace(/^msg_/, ""), s = String(r.src || "");
    if (by[s] && e in by[s]) by[s][e] += +r.n || 0;
  }
  return { available: true, days: n, from, to: now, by };
}
