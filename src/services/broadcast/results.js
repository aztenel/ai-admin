// @ts-check
// Итоги рассылки для пульта (ТЗ v3.0 P0, 31.10.2026; финальное ТЗ рассылок Winchester, 02.11.2026 §9): выбрано (в аудитории),
// допущено (можно писать рекламу), ушло, не знаем (сбой во время отправки), ошибки, доставлено, прочитано, ответили, хотят записаться,
// записались после, отказались. «Записались после» — только совпадение по времени (визит или запись в Altegio после сообщения, не
// позже 14 дней), пульт так и пишет: это не доказательство, что записались из-за сообщения.
// Откуда числа: ушло, ошибки, пропущено — из самой рассылки; доставлено, прочитано, ответили, хотят записаться — отчёты Green-API
// и ответы в D1 (events с номером рассылки: stats.js); записались после и отказались — по свежей базе Altegio и отказам для тех,
// кому сообщение ушло (bcs:, sender.js). Демо-рассылки черновика — из D1 (events и bookings), как раньше. Без данных — null.
/** @import { Env } from "../../lib/types.js" */
import { d1Ready } from "../../db/d1/status.js";
import { campaignResults } from "../../db/d1/campaigns.js";
import { bcSentRead } from "../../db/kv/broadcasts.js";
import { CLIENTS } from "../../config/builtin-clients.js";
import { isoDay } from "../../lib/time.js";
import { crmView } from "../crm/segments.js";

export const BOOKED_WINDOW_DAYS = 14;
const WIN = BOOKED_WINDOW_DAYS * 86400e3;
const REFUSED = new Set(["block", "stop", "review", "denied"]);

/** @param {Env} env @param {string} cid @param {Record<string, any>} b рассылка @param {number} now */
export async function bcResults(env, cid, b, now) {
  if (!b || !b.id) return null;
  if (b.ch === "ga" && b.src === "crm" && !b.demo) return gaResults(env, cid, b, now);
  try {
    const db = await d1Ready(env, now);
    if (!db) return null;
    const r = await campaignResults(db, cid, String(b.id), WIN);
    if (!(r.sent || r.failed || r.delivered || r.read || r.replied)) return null;
    return { ...r, selected: +(b.sel ?? b.total) || 0, admitted: +b.total || 0, window: BOOKED_WINDOW_DAYS };
  } catch (e) { console.log("bc results", String(e).slice(0, 120)); return null; }
}

// Пульт опрашивает итоги раз в 5 с (находка проверки 02.11.2026): база клиентов и отказы — это снимок, 30 отметок KV и запрос согласий
// D1 по всей базе, — поэтому они считаются не чаще раза в 5 минут, отчёты D1 — раз в 30 секунд (память экземпляра Worker; ключ —
// компания и рассылка)
const CACHE = new Map(), BASE_TTL = 5 * 60e3, D1_TTL = 30e3, CACHE_MAX = 200;
/** @template T @param {string} k @param {number} ttl @param {number} now @param {() => Promise<T>} make @returns {Promise<T>} */
async function cached(k, ttl, now, make) {
  const hit = CACHE.get(k);
  if (hit && now - hit.at < ttl) return hit.v;
  const v = await make();
  CACHE.set(k, { at: now, v });
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  return v;
}
/** записались после и отказались — по свежей базе Altegio и отказам для тех, кому ушло → null, если данных нет
 *  @param {Env} env @param {string} cid @param {Record<string, any>} b @param {number} now */
async function baseResults(env, cid, b, now) {
  const sent = await bcSentRead(env, cid, String(b.id));
  if (!sent.length) return null;
  const view = await crmView(env, CLIENTS[cid], now);
  if (!view.snap) return null;
  const rows = new Map(view.rows.map(x => [x.p, x])), seen = new Set(), fut = view.futOnly || new Set();
  let booked = 0, refused = 0;
  for (const [p0, t] of sent) {
    const p = String(p0);
    if (seen.has(p)) continue;
    seen.add(p);
    const x = /** @type {any} */ (rows.get(p)), at = +t || 0, from = isoDay(at), to = isoDay(at + WIN), fresh = view.snap.at - at <= WIN;
    // будущая запись — если база собрана не позже 14 дней после сообщения (и у тех, чей визит уже старше 90 дней: futOnly); визит в эти 14 дней
    if ((x && ((x.fut && fresh) || (x.last && x.last >= from && x.last <= to))) || (!x && fut.has(p) && fresh)) booked++;
    const r = (view.reasons && view.reasons.get(p)) || "";
    if ((view.stop && view.stop.has(p)) || REFUSED.has(r)) refused++;
  }
  return { booked, refused };
}

/** @param {Env} env @param {string} cid @param {Record<string, any>} b @param {number} now */
async function gaResults(env, cid, b, now) {
  const key = `${cid}:${b.id}`;
  /** @type {any} */ let d1 = null, base = null;
  try { d1 = await cached("d1:" + key, D1_TTL, now, async () => { const db = await d1Ready(env, now); return db ? campaignResults(db, cid, String(b.id), WIN) : null; }); }
  catch (e) { console.log("bc results d1", String(e).slice(0, 120)); }
  try { base = await cached("base:" + key, BASE_TTL, now, () => baseResults(env, cid, b, now)); }
  catch (e) { console.log("bc results base", String(e).slice(0, 120)); }
  return { selected: +(b.sel ?? b.total) || 0, admitted: +b.total || 0, sent: +b.sent || 0, unsure: +b.unsure || 0, failed: +b.failed || 0,
    skipped: (+b.skipped || 0) + (+b.excl || 0), delivered: d1 ? d1.delivered : null, read: d1 ? d1.read : null, replied: d1 ? d1.replied : null,
    want: d1 ? d1.want : null, booked: base ? base.booked : null,
    // нет ни базы, ни отчётов — «нет данных», а не 0 (находка проверки 02.11.2026)
    refused: base || d1 ? Math.max(base ? base.refused : 0, d1 ? d1.stop : 0) : null, window: BOOKED_WINDOW_DAYS, reports: !!d1 };
}
/** только для проверок: забыть кэш итогов */
export const bcResultsReset = () => CACHE.clear();
