// @ts-check
// Напоминания о записи и просьба об отзыве по журналу Altegio со второго номера (Green-API), без бота (30.10.2026, решение владельца:
// второй номер Winchester — только исходящие сообщения с 10:00 до 21:00). remindPlan (plan.js) знает только записи, которые бот сделал
// в чате; здесь — все записи журнала: администратор, сайт, онлайн-запись. Настройки — c.jr = { from, to, eve, h2, rv, cap }.
// Раз в 15 минут — журнал на вчера, сегодня и завтра → очередь jrq:<клиент> (db/kv/reminders.js). Перед отправкой запись перечитывается
// (журнал её дня): удалена, перенесена, «не пришёл», уже пришёл — напоминание не уходит; отзыв — только с отметкой «пришёл» (attendance 1).
// Вживую не проверено: какие отметки ставят администраторы Winchester (без «пришёл» просьб об отзыве не будет), поле create_date в журнале.
/** @import { Env, Client } from "../../lib/types.js" */
import { CLIENTS } from "../../config/builtin-clients.js";
import { REMIND_LATE } from "../../config/constants.js";
import { TZ, local, isoDay } from "../../lib/time.js";
import { normPhone } from "../../lib/phone.js";
import { altText } from "../integrations/altegio/client.js";
import { altRecordsRange } from "../integrations/altegio/records-api.js";
import { gaRoute } from "../integrations/greenapi/webhook.js";
import { gaKind, gaWhy } from "../integrations/greenapi/client.js";
import { notify } from "../integrations/telegram/client.js";
import { sendGreen } from "../channels/greenapi.js";
import { altUserKey } from "../booking/journal.js";
import { altLoc } from "../booking/book.js";
import { logTurns } from "../../db/kv/chats.js";
import { jrqLoad, jrqSave, jrSyncAt, jrSyncMark, jrCount, jrCountSave, jrCapNote, jrHold, jrHoldSet, jrReviewed, jrReviewMark, optedOut, rmTry, rmUntry, rmOk } from "../../db/kv/reminders.js";
import { atLocal, remindText } from "./plan.js";

const SYNC_MS = 15 * 60e3;   // журнал — не чаще раза в 15 минут: у Altegio предел 5 запросов в секунду на всех
const PAGES = 3;             // 3 дня одной локации — одна страница (200 записей), больше трёх не читаем
const PER_MIN = 2;           // сообщений в минуту со второго номера: неофициальный номер, частые сообщения подряд — повод для блокировки
const H2_LATE = 45 * 60e3;   // «за 2 часа» позже чем через 45 минут уже не к месту
const QUEUE_MAX = 600;

/** @param {Client} c */
const opts = c => ({ from: 10, to: 21, eve: "18:00", h2: true, rv: true, cap: 150, ...(c.jr || {}) });
/** до какого опоздания ещё шлём: накануне — до конца часов отправки, за 2 часа — 45 минут, отзыв — 3 часа
 *  @param {any} o @param {string} k @param {number} at */
function late(o, k, at) {
  if (k === "h2") return H2_LATE;
  if (k === "rv") return REMIND_LATE;
  const L = local(at), end = Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate(), o.to - TZ, 0);
  return Math.max(0, end - at);
}

// запись журнала → то, что нужно для сообщения; null — удалена, без клиента (перерыв мастера), скрытый или неверный номер
/** @param {any} r */
export function jrRec(r) {
  if (!r || typeof r !== "object" || r.deleted === true || r.deleted === 1 || !r.client || typeof r.client !== "object") return null;
  const dt = String(r.datetime || ""), date = dt.slice(0, 10), time = dt.slice(11, 16);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const p = normPhone(String(r.client.phone ?? "")).slice(1);
  if (!p) return null;
  const att = +r.attendance === -1 || +r.visit_attendance === -1 ? -1 : +r.attendance === 1 || +r.visit_attendance === 1 ? 1 : 0;
  return { id: String(r.id), date, time, p, att, made: Date.parse(String(r.create_date || "")) || 0, n: altText(r.client.name || "", 60),
    staff: altText((r.staff && r.staff.name) || "", 40),
    svc: (Array.isArray(r.services) ? r.services : []).map(/** @param {any} s */ s => altText(s && s.title, 60)).filter(Boolean).join(", ") };
}

/** что и когда отправить по этим записям (чистая функция). Накануне — в eve, если запись сделана раньше чем за час до этого;
 *  за 2 часа — только если это время в часах отправки и запись сделана раньше чем за 4 часа; отзыв — через 3 часа после начала,
 *  вне часов отправки — утром (from + 1). Уже прошедшее и опоздавшее больше допустимого — не планируем.
 *  @param {Client} c @param {any[]} records @param {number} now */
export function jrPlan(c, records, now) {
  const o = opts(c), out = /** @type {any[]} */ ([]);
  for (const r of records) {
    const v = jrRec(r);
    if (!v || v.att === -1) continue;
    const t = atLocal(v.date, v.time), base = { rec: v.id, p: v.p, n: v.n, date: v.date, time: v.time, staff: v.staff, svc: v.svc };
    const add = (/** @type {string} */ k, /** @type {number} */ at) => { if (now - at <= late(o, k, at)) out.push({ ...base, k, at }); };
    if (o.eve && v.att !== 1) {
      const eve = atLocal(v.date, o.eve, -1);
      if (t - eve >= 12 * 3600e3 && !(v.made && v.made > eve - 3600e3)) add("d1", eve);
    }
    if (o.h2 && v.att !== 1) {
      const h2 = t - 2 * 3600e3, hr = local(h2).getUTCHours();
      if (hr >= o.from && hr < o.to && !(v.made && t - v.made < 4 * 3600e3)) add("h2", h2);
    }
    if (o.rv && c.review) {
      let rv = t + 3 * 3600e3;
      const L = local(rv), lh = L.getUTCHours();
      if (lh >= o.to || lh < o.from) rv = Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate() + (lh >= o.to ? 1 : 0), o.from + 1 - TZ, 0);
      add("rv", rv);
    }
  }
  return out;
}

/** @param {any} x */
const key = x => x.rec + ":" + x.k;

/** фоновая задача раз в минуту: компании с c.jr, ключом журнала и номером Green-API @param {Env} env @param {number} now */
export async function jrRun(env, now) {
  let n = 0;
  for (const c of Object.values(CLIENTS)) {
    if (!c || !c.jr) continue;
    try { n += await jrClient(env, c, now); } catch (/** @type {any} */ e) { console.log("jr", c.id, String((e && e.stack) || e)); }
  }
  return n;
}

/** @param {Env} env @param {Client} c @param {number} now */
async function jrClient(env, c, now) {
  const user = altUserKey(env, c), loc = altLoc(env, c), route = gaRoute(env, c.id);
  if (!env.ALTEGIO_PARTNER || !user || !(loc > 0) || !route) return 0;
  const o = opts(c);
  let q = await jrqLoad(env, c.id), dirty = false;
  if (now - (await jrSyncAt(env, c.id)) >= SYNC_MS) {
    try { await jrSyncMark(env, c.id, now); } catch (e) { console.log("jr sync mark", String(e)); } // не записалась — прочитаем журнал ещё раз через минуту
    try {
      const { list } = await altRecordsRange(env, user, loc, isoDay(now - 86400e3), isoDay(now + 86400e3), PAGES);
      const seen = new Set(list.map(r => String(r && r.id))), plan = new Map(jrPlan(c, list, now).map(x => [key(x), x]));
      // записи из прочитанного журнала — по свежему плану (перенесли — новое время, удалили — нет в плане); остальные — как были
      q = q.filter(x => !seen.has(x.rec) && now - x.at <= late(o, x.k, x.at)).concat([...plan.values()]).slice(-QUEUE_MAX);
      dirty = true;
    } catch (/** @type {any} */ e) { console.log("jr journal", c.id, String((e && e.message) || e).slice(0, 160)); }
  }
  const drop = new Set(), due = [];
  for (const x of q) { if (now - x.at > late(o, x.k, x.at)) drop.add(key(x)); else if (x.at <= now) due.push(x); }
  due.sort((a, b) => a.at - b.at);
  const hr = local(now).getUTCHours(), quiet = hr < o.from || hr >= o.to;
  let sent = 0;
  if (due.length && !quiet && !(await jrHold(env, c.id))) {
    const day = isoDay(now), cnt0 = await jrCount(env, c.id, day), st = { cnt: cnt0, cache: new Map() };
    for (const x of due) {
      if (sent >= PER_MIN) break;
      const r = await jrSend(env, c, o, x, now, { route, user, loc }, st);
      if (r === "sent") { sent++; drop.add(key(x)); }
      else if (r === "drop") drop.add(key(x));
      else if (r === "stop") break; // предел, пауза номера или временный отказ — в следующую минуту
    }
    if (st.cnt !== cnt0) await jrCountSave(env, c.id, day, st.cnt);
  }
  if (drop.size) { q = q.filter(x => !drop.has(key(x))); dirty = true; }
  if (dirty) await jrqSave(env, c.id, q);
  return sent;
}

/** одно сообщение → "sent" | "drop" (не шлём и не будем) | "wait" (отзыв: ждём отметку «пришёл») | "stop" (в эту минуту больше не шлём)
 *  @param {Env} env @param {Client} c @param {any} o @param {any} x @param {number} now @param {{ route: any, user: string, loc: number }} ctx @param {{ cnt: number, cache: Map<string, any[]> }} st */
async function jrSend(env, c, o, x, now, ctx, st) {
  if (await optedOut(env, c.id, x.p)) return "drop";
  if (x.k === "rv" && await jrReviewed(env, c.id, x.p)) return "drop";
  let list = st.cache.get(x.date);
  if (!list) {
    try { list = (await altRecordsRange(env, ctx.user, ctx.loc, x.date, x.date, PAGES)).list; }
    catch (/** @type {any} */ e) { console.log("jr recheck", c.id, String((e && e.message) || e).slice(0, 160)); return "stop"; }
    st.cache.set(x.date, list);
  }
  const r = list.find(/** @param {any} v */ v => String(v && v.id) === x.rec), v = r && jrRec(r);
  if (!v || v.date !== x.date || v.time !== x.time || v.p !== x.p || v.att === -1) return "drop"; // удалена, перенесена, другой клиент, не пришёл
  if (x.k === "rv" && v.att !== 1) return "wait";
  if (x.k !== "rv" && v.att === 1) return "drop"; // уже пришёл
  if (st.cnt >= o.cap) {
    try { if (await jrCapNote(env, c.id, isoDay(now))) await notify(env, `⚠️ ${c.name}: предел ${o.cap} сообщений в сутки со второго номера — остальные напоминания сегодня не отправлены.`, c.id); }
    catch (e) { console.log("jr cap note", String(e)); }
    return "stop";
  }
  if (!(await rmTry(env, c.id, x.rec, x.k))) return "drop";
  const text = remindText(c, { time: x.time, services: x.svc, staffName: x.staff }, x.k);
  /** @type {Record<string, any>} */ let res;
  try { res = await sendGreen(env, x.p + "@c.us", text, ctx.route, true); } catch (e) { res = { ok: false, status: 0, code: "ga:net", error: String(e) }; }
  if (!res.ok) {
    const kind = gaKind(res.code);
    console.log("jr send", c.id, x.k, res.code);
    if (kind === "temp") { await rmUntry(env, c.id, x.rec, x.k); return "stop"; }
    if (kind === "stop") {
      await rmUntry(env, c.id, x.rec, x.k);
      const why = gaWhy(res, ctx.route);
      await jrHoldSet(env, c.id, why, now);
      await notify(env, `⛔ ${c.name}: напоминания со второго номера остановлены на 6 часов.\nGreen-API: ${why}\nПроверьте, не заблокирован ли номер.`, c.id);
      return "stop";
    }
    return "drop"; // номера нет в WhatsApp (400) или связь оборвалась (могло уйти — второй раз не шлём)
  }
  st.cnt++;
  try { await rmOk(env, c.id, x.rec, x.k); } catch (e) { console.log("jr ok mark", String(e)); }
  if (x.k === "rv") { try { await jrReviewMark(env, c.id, x.p, now); } catch (e) { console.log("jr review mark", String(e)); } }
  try { await logTurns(env.KV, `h:ga:${c.id}:${x.p}`, [{ role: "model", text, t: now, rm: x.k }], /** @param {any} p */ p => { if (!p.waName && x.n) p.waName = x.n; }); }
  catch (e) { console.log("jr log", String(e)); }
  return "sent";
}
