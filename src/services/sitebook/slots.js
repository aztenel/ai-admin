// @ts-check
// Онлайн-запись на сайте: открытые дни и свободное время. Логика та же, что у бота (services/booking/fit.js): Altegio без услуги отдаёт
// свободные начала мастера сеткой (30 мин), а помещается ли услуга, считает код — начало подходит, если мастер свободен всю длительность
// выбранных услуг подряд (живой показ Winchester, 18.10.2026: Premium на 16:30 при записи у Тони в 17:30). Время не по сетке
// («12:05», «20:40») не показываем; сегодня — не раньше чем через minLead минут.
/** @import { Env, Client } from "../../lib/types.js" */
/** @import { SiteConf } from "./config.js" */
/** @import { Cat } from "./base.js" */
/** @import { Out } from "./texts.js" */
import { altDates, altTimes, altTimesHit } from "../integrations/altegio/booking-api.js";
import { altDatesRaw } from "../integrations/altegio/site-api.js";
import { settledBy } from "../booking/book.js";
import { fitStarts, tStr } from "../booking/fit.js";
import { isoDay, local, mins } from "../../lib/time.js";
import { cacheGet, cachePut, ck, altGate, gateCheck, loadCat, pickServices, staffPool, sumOf, stop, stopped, altLog, once } from "./base.js";
import { fail, badField } from "./texts.js";

/** @param {string} t «9:00» → «09:00» */
export const pad = t => t.padStart(5, "0");
// потолок горизонта записи: сегодня … сегодня + days − 1 (по Астане, days — до 120). Сам горизонт — сколько дней отдаёт Altegio
/** @param {SiteConf} conf @param {number} nowMs */
export const dayRange = (conf, nowMs) => ({ from: isoDay(nowMs), to: isoDay(nowMs + (conf.days - 1) * 864e5) });

// открытые дни мастера на весь горизонт онлайн-записи (book_dates по мастеру, без услуг и без дат — как виджет Altegio), кэш 5 минут;
// одинаковые запросы в полёте — один. Помещаются ли выбранные услуги, решает сетка времени (staffStarts): с номерами услуг каждый
// набор был бы своим запросом к Altegio — 78 наборов давали 390 запросов (проба 21.10.2026). Месяцы календаря формы — из этого же
// ответа: листание месяцев к Altegio не ходит
/** @param {Env} env @param {SiteConf} conf @param {number} staffId @param {number} nowMs @returns {Promise<string[]>} */
export async function openDates(env, conf, staffId, nowMs) {
  const { from, to } = dayRange(conf, nowMs), k = ck(conf, "sd", staffId, from), hit = cacheGet(k, nowMs);
  if (hit) return hit;
  return once(k, async () => {
    await altGate(conf);
    const v = altDates(await altDatesRaw(env, conf.loc, staffId), nowMs).filter(d => d >= from && d <= to);
    cachePut(k, v, nowMs, 300e3);
    return v;
  });
}

// Свободные начала мастера на день, где помещаются need минут: { starts: ["ЧЧ:ММ"], free: начал сетки за день (у кого день свободнее) }.
// fresh — мимо кэша и без очереди (перед записью)
/** @param {Env} env @param {SiteConf} conf @param {number} staffId @param {string} date @param {number} need @param {number} nowMs @param {boolean} [fresh] */
export async function staffStarts(env, conf, staffId, date, need, nowMs, fresh) {
  let list = fresh ? null : altTimesHit(conf.loc, staffId, date, null, nowMs);
  if (!list) { if (!fresh) await altGate(conf); list = /** @type {any[]} */ (await altTimes(env, conf.loc, staffId, date, null, nowMs, fresh)); }
  const grid = [...new Set(list.map(x => String(x.time)))].filter(t => mins(t) % conf.step === 0).sort((a, b) => mins(a) - mins(b));
  let starts = fitStarts(grid, need, conf.step);
  if (date === isoDay(nowMs)) { const n = local(nowMs), lim = n.getUTCHours() * 60 + n.getUTCMinutes() + conf.minLead; starts = starts.filter(t => mins(t) >= lim); }
  return { starts: starts.map(pad), free: grid.length };
}

// время дня по мастерам pool: у каждого начала — назначенный мастер: дешевле сумма, потом у кого день свободнее, потом порядок Altegio
// (клиент до записи видит, кто будет мастером и сколько стоит; шеф-барбера вместо барбера молча не подставляем).
// Мастер, по которому Altegio не ответил, пропускается; не ответил никто — ответ «расписание не отвечает»
/** @param {Env} env @param {SiteConf} conf @param {Cat} cat @param {any[]} pool @param {string[]} keys @param {string} date @param {number} nowMs @param {boolean} [fresh] */
export async function daySlots(env, conf, cat, pool, keys, date, nowMs, fresh) {
  if (!pool.length) return [];
  const res = await settledBy(pool.map(m => () => staffStarts(env, conf, m.id, date, sumOf(cat, m.id, keys).min, nowMs, fresh)), 3);
  gateCheck(res);
  /** @type {Map<string, any>} */
  const best = new Map();
  let got = 0;
  res.forEach((r, i) => {
    if (r.status === "rejected") { altLog("times " + pool[i].id, r.reason); return; }
    got++;
    const m = pool[i], sum = sumOf(cat, m.id, keys), idx = cat.staff.indexOf(m);
    for (const t of r.value.starts) {
      const cur = best.get(t), c = { time: t, staff: m.id, price: sum.price, min: sum.min, free: r.value.free, idx };
      if (!cur || c.price < cur.price || (c.price === cur.price && (c.free > cur.free || (c.free === cur.free && c.idx < cur.idx)))) best.set(t, c);
    }
  });
  if (!got) throw stop(fail("altegio", conf));
  return [...best.values()].sort((a, b) => mins(a.time) - mins(b.time)).map(x => ({ time: x.time, end: pad(tStr(mins(x.time) + x.min)), staff: x.staff, price: x.price, min: x.min }));
}

// открытые дни каждого мастера из pool: Map мастер → дни; мастер, по которому Altegio не ответил, пропускается (не ответил никто — ошибка)
/** @param {Env} env @param {SiteConf} conf @param {any[]} pool @param {number} nowMs */
export async function poolDates(env, conf, pool, nowMs) {
  const res = await settledBy(pool.map(m => () => openDates(env, conf, m.id, nowMs)), 3);
  gateCheck(res);
  /** @type {Map<number, string[]>} */
  const out = new Map();
  res.forEach((r, i) => { if (r.status === "fulfilled") out.set(pool[i].id, r.value); else altLog("dates " + pool[i].id, r.reason); });
  if (!out.size) throw stop(fail("altegio", conf));
  return out;
}
/** @param {Map<number, string[]>} per */
const unionOf = per => [...new Set([...per.values()].flat())].sort();

// разбор запроса dates/times: услуги и мастер → { cat, keys, pool } или готовый ответ-ошибка. noServices — у dates можно без параметра
// services (мастер выбран, услуги ещё нет: форма заранее берёт дни мастера); пустой services= — ошибка, как раньше
/** @param {Env} env @param {SiteConf} conf @param {URLSearchParams} q @param {number} nowMs @param {boolean} [noServices] */
async function parse(env, conf, q, nowMs, noServices) {
  const cat = await loadCat(env, conf, nowMs);
  const sv = noServices && !q.has("services") ? { keys: /** @type {string[]} */ ([]) } : pickServices(cat, conf, q.get("services") || "");
  if (!sv.keys) return { out: badField("services", conf, sv.why) };
  const st = staffPool(cat, q.get("staff") ?? "", sv.keys);
  if (!st.pool) return { out: badField(st.field, conf, st.why) };
  return { cat, keys: sv.keys, pool: st.pool };
}

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
// month=ГГГГ-ММ или from=…&to=… (оба) → { lo, hi, month } | { out } (ошибка поля month или range); без них — весь горизонт
/** @param {SiteConf} conf @param {URLSearchParams} q */
function rangeOf(conf, q) {
  if (q.has("month")) {
    const m = String(q.get("month"));
    return MONTH.test(m) ? { lo: m + "-01", hi: m + "-31", month: m } : { out: badField("month", conf) };
  }
  if (!q.has("from") && !q.has("to")) return { lo: "", hi: "", month: null };
  const lo = String(q.get("from") || ""), hi = String(q.get("to") || "");
  return DAY.test(lo) && DAY.test(hi) && lo <= hi ? { lo, hi, month: null } : { out: badField("range", conf) };
}
// месяцы календаря «ГГГГ-ММ»: от месяца сегодня до месяца последнего открытого дня
/** @param {string} from @param {string | null} to */
export function monthsOf(from, to) {
  const out = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const end = (to || from).slice(0, 7);
  for (let i = 0; i < 13; i++) { const s = `${y}-${String(m).padStart(2, "0")}`; out.push(s); if (s >= end) break; if (++m > 12) { m = 1; y++; } }
  return out;
}

// GET dates: открытые дни мастера (или объединение по всем, кто делает выбранные услуги; без services — по всем мастерам) на весь
// горизонт онлайн-записи Altegio (до 120 дней). from — сегодня, to — последний открытый день, months — месяцы календаря; dates —
// открытые дни, а с month (или from/to) — только в этом месяце (периоде). Всё из одного ответа Altegio на мастера (кэш 5 минут)
/** @param {Env} env @param {Client} c @param {SiteConf} conf @param {URLSearchParams} q @param {number} nowMs @returns {Promise<Out>} */
export async function siteDates(env, c, conf, q, nowMs) {
  try {
    const rg = rangeOf(conf, q);
    if (rg.out) return rg.out;
    const p = await parse(env, conf, q, nowMs, true);
    if (p.out) return p.out;
    const all = unionOf(await poolDates(env, conf, p.pool, nowMs)), from = isoDay(nowMs), to = all.length ? all[all.length - 1] : null;
    const dates = all.filter(d => (!rg.lo || d >= rg.lo) && (!rg.hi || d <= rg.hi));
    return { http: 200, res: { ok: true, dates, from, to, months: monthsOf(from, to), month: rg.month } };
  } catch (e) { const o = stopped(e); if (o) return o; throw e; }
}

// GET times: свободное время на день (date) или на первый из ближайших трёх открытых дней, где оно есть. next — ближайший следующий
// день, где время есть (смотрим до AHEAD открытых дней; не нашли — следующий открытый): кнопка «Ближайший день» вела на рабочий день
// без свободного времени, и так подряд (проверка формы 21.10.2026)
const AHEAD = 4;
/** @param {Env} env @param {Client} c @param {SiteConf} conf @param {URLSearchParams} q @param {number} nowMs @returns {Promise<Out>} */
export async function siteTimes(env, c, conf, q, nowMs) {
  try {
    const want = q.get("date") || "";
    if (want && !/^\d{4}-\d{2}-\d{2}$/.test(want)) return badField("date", conf);
    const p = await parse(env, conf, q, nowMs);
    if (p.out) return p.out;
    const per = await poolDates(env, conf, p.pool, nowMs), days = unionOf(per);
    const on = /** @param {string} d */ d => p.pool.filter(m => (per.get(m.id) || []).includes(d));
    const slotsOn = /** @param {string} d */ d => daySlots(env, conf, p.cat, on(d), p.keys, d, nowMs);
    let date = want || null, slots = /** @type {any[]} */ ([]);
    if (want) { if (days.includes(want)) slots = await slotsOn(want); }
    else {
      for (const d of days.slice(0, 3)) { const s = await slotsOn(d); if (s.length) { date = d; slots = s; break; } }
      if (!slots.length) date = days[0] || null;
    }
    const later = date ? days.filter(d => d > /** @type {string} */ (date)) : [];
    let next = later[0] || null;
    if (date && !slots.length) {
      next = later[AHEAD] || null;
      for (const d of later.slice(0, AHEAD)) if ((await slotsOn(d)).length) { next = d; break; }
    }
    return { http: 200, res: { ok: true, date, next, slots } };
  } catch (e) { const o = stopped(e); if (o) return o; throw e; }
}
