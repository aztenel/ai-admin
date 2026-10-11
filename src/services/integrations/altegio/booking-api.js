// @ts-check
// Altegio: онлайн-запись по HTTP — услуги и мастера, даты, свободное время, создание и отмена записи; кэш в памяти изолята.
/** @import { Env } from "../../../lib/types.js" */
import { isoDay, local, hm } from "../../../lib/time.js";
import { nameToks, svTrim } from "../../../lib/names.js";
import { ALT_TTL, ALT_BASE_TTL, ALT_MAX_SERVICES, ALT_MAX_STAFF } from "../../../config/constants.js";
import { altCall, altText } from "./client.js";

/** @type {Map<string, any>} */
export const altCache = new Map(); // память изолята: у Altegio лимит 5 запросов в секунду

// одинаковые названия различаем подписью (категория, специализация), а если и она совпала — номером: иначе бот запишет не туда
/**
 * @param {any[]} list
 * @param {string} key
 * @param {(x: any) => any} hint
 * @param {(s: any) => any} norm
 */
export function altUniq(list, key, hint, norm) { // norm — как названия сравниваются при подборе: «Стрижка» и «Стрижка.» для бота одно и то же
  /** @param {any} x */
  const k = x => norm(x[key]);
  const count = () => { const n = new Map(); for (const x of list) n.set(k(x), (n.get(k(x)) || 0) + 1); return n; };
  let n = count();
  for (const x of list) if (n.get(k(x)) > 1 && hint(x)) x[key] = `${x[key]} (${hint(x)})`;
  n = count();
  const used = new Set(list.map(k)), seq = new Map();
  for (const x of list) if (n.get(k(x)) > 1) {
    const b = x[key], kb = k(x); let i = seq.get(kb) || 0, t;
    do { i++; t = `${b} №${i}`; } while (used.has(norm(t)));
    seq.set(kb, i); used.add(norm(t)); x[key] = t;
  }
}

// услуги и мастера меняются редко — держим 10 минут
/**
 * @param {Env} env
 * @param {any} loc
 * @param {number} nowMs
 * @returns {Promise<any>}
 */
export async function altBase(env, loc, nowMs) {
  const k = "base:" + loc, hit = altCache.get(k);
  if (hit && Math.abs(nowMs - hit.at) < ALT_BASE_TTL) return hit.v;
  const [sv, st] = await Promise.all([altCall(env, "GET", `/book_services/${loc}`), altCall(env, "GET", `/book_staff/${loc}`)]);
  const cats = new Map(((sv && Array.isArray(sv.category) && sv.category) || []).map(/** @param {any} x */ x => [x.id, altText(x.title, 40)]));
  const allSv = ((sv && Array.isArray(sv.services) && sv.services) || []).filter(/** @param {any} x */ x => x && x.id && altText(x.title) && x.active !== 0 && x.active !== false);
  const services = allSv.slice(0, ALT_MAX_SERVICES)
    .map(/** @param {any} x */ x => ({ id: x.id, title: altText(x.title, 90), min: +x.price_min || 0, max: +x.price_max || 0, minutes: Math.round((+x.seance_length || 0) / 60), cat: cats.get(x.category_id) || "" }));
  altUniq(services, "title", /** @param {any} x */ x => x.cat, svTrim);
  // bookable=false у Altegio значит «сейчас нет свободного времени», а не «мастера нет» — такого мастера оставляем в списке
  const allSt = (Array.isArray(st) ? st : []).filter(/** @param {any} m */ m => m && m.id && altText(m.name) && !+m.fired && !+m.hidden);
  const staff = allSt.slice(0, ALT_MAX_STAFF)
    .map(/** @param {any} m */ m => ({ id: m.id, base: altText(m.name, 60), name: altText(m.name, 60), spec: altText(m.specialization || (m.position && m.position.title) || "", 50), busy: m.bookable === false }));
  altUniq(staff, "name", /** @param {any} m */ m => m.spec, /** @param {any} x */ x => nameToks(x).join(" "));
  const v = { services, staff, cut: allSv.length > services.length || allSt.length > staff.length, total: { services: allSv.length, staff: allSt.length } };
  if (altCache.size > 400) altCache.clear();
  altCache.set(k, { at: nowMs, v });
  return v;
}

// ответ book_dates → список дат «ГГГГ-ММ-ДД» начиная с сегодня
/**
 * @param {any} d
 * @param {number} nowMs
 * @returns {string[]}
 */
export function altDates(d, nowMs) {
  const today = isoDay(nowMs), out = new Set();
  const bd = d && d.booking_dates, arr = Array.isArray(bd) ? bd : bd && typeof bd === "object" ? Object.values(bd).flat() : [];
  for (const x of arr) out.add(typeof x === "number" ? isoDay(x * 1000) : String(x).slice(0, 10));
  if (!out.size && d && d.booking_days && typeof d.booking_days === "object") {
    const n = local(nowMs), y = n.getUTCFullYear(), cm = n.getUTCMonth() + 1;
    for (const [mo, days] of Object.entries(d.booking_days)) for (const day of Array.isArray(days) ? days : [])
      out.add(`${+mo < cm ? y + 1 : y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return [...out].filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x) && x >= today).sort();
}

/** @param {any} loc */
export const altDropTimes = loc => { for (const k of [...altCache.keys()]) if (k.startsWith(`t:${loc}:`)) altCache.delete(k); };

/**
 * @param {Env} env
 * @param {any} loc
 * @param {any} staffId
 * @param {string} date
 * @param {any[] | null | undefined} serviceIds
 * @param {number} nowMs
 * @param {boolean} [fresh]
 * @returns {Promise<any>}
 */
export async function altTimes(env, loc, staffId, date, serviceIds, nowMs, fresh) {
  const q = (serviceIds || []).map(/** @param {any} id */ id => "service_ids%5B%5D=" + encodeURIComponent(id)).join("&");
  const k = `t:${loc}:${staffId}:${date}:${q}`, hit = altCache.get(k);
  if (!fresh && hit && Math.abs(nowMs - hit.at) < ALT_TTL) return hit.v;
  let d;
  try { d = await altCall(env, "GET", `/book_times/${loc}/${staffId}/${date}${q ? "?" + q : ""}`); }
  catch (e) { if (/** @type {any} */ (e).status !== 404) throw e; d = []; } // 404 здесь — «на этот день свободного времени нет»
  const v = (Array.isArray(d) ? d : []).map(x => ({ time: hm(x && x.time), datetime: (x && x.datetime) || "" })).filter(x => x.time);
  if (altCache.size > 400) altCache.clear();
  altCache.set(k, { at: nowMs, v });
  return v;
}

// Запрос на создание записи. Проверено на настоящем Altegio: без поля email он отвечает 422 «The required parameter email was not passed» —
// передаём его пустым (почты клиента у бота нет). Номер идёт с «+», как в справочнике; если формат не принят (431) — повторяем цифрами.
/**
 * @param {Env} env
 * @param {any} loc
 * @param {any} body
 * @returns {Promise<{ data: any, sent: any }>}
 */
export async function altRecord(env, loc, body) {
  const sent = { email: "", ...body }, post = () => altCall(env, "POST", `/book_record/${loc}`, sent);
  try { return { data: await post(), sent }; }
  catch (e) {
    if (/** @type {any} */ (e).code !== 431 || !/^\+/.test(String(sent.phone))) throw e;
    sent.phone = String(sent.phone).replace(/\D/g, ""); // запись при 431 не создана — повтор безопасен
    return { data: await post(), sent };
  }
}

/**
 * @param {Env} env
 * @param {any} a
 */
export async function altCancel(env, a) {
  await altCall(env, "DELETE", `/user/records/${a.record_id}/${a.record_hash}`);
  altDropTimes(a.loc);
}
