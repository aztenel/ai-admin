// @ts-check
// Онлайн-запись на сайте: каталог для формы (мастера, услуги по ключу с ценой и длительностью у каждого мастера, группы как в меню
// сайта, метка формы ft) и ближайшее свободное время мастеров для карточек первого шага. Номера услуг Altegio наружу не уходят.
/** @import { Env, Client } from "../../lib/types.js" */
/** @import { SiteConf } from "./config.js" */
/** @import { Out } from "./texts.js" */
import { settledBy } from "../booking/book.js";
import { isoDay, local } from "../../lib/time.js";
import { cacheGet, cachePut, ck, gateCheck, loadCat, stopped, altLog } from "./base.js";
import { openDates, staffStarts, monthsOf } from "./slots.js";
import { ftMake } from "./token.js";
import { NOTIFY } from "./config.js";

// GET catalog
/** @param {Env} env @param {Client} c @param {SiteConf} conf @param {number} nowMs @returns {Promise<Out>} */
export async function siteCatalog(env, c, conf, nowMs) {
  try {
    const cat = await loadCat(env, conf, nowMs), have = new Set(cat.services.map(s => s.key)), used = new Set();
    // группы — как в меню сайта; ключи вне групп — «Другие услуги» в конце (новая услуга в Altegio не пропадёт с сайта)
    const groups = conf.groups.map(g => ({ title: String(g.title), keys: (g.keys || []).filter(k => have.has(k) && !used.has(k) && used.add(k)) })).filter(g => g.keys.length);
    const rest = cat.services.map(s => s.key).filter(k => !used.has(k));
    if (rest.length) groups.push({ title: "Другие услуги", keys: rest });
    const n = local(nowMs);
    return { http: 200, res: {
      ok: true, mode: conf.mode,
      company: { name: conf.name, address: conf.address, phone: conf.phone, tel: conf.tel, wa: conf.wa, hours: conf.hours },
      today: isoDay(nowMs), now: `${String(n.getUTCHours()).padStart(2, "0")}:${String(n.getUTCMinutes()).padStart(2, "0")}`,
      // days — потолок горизонта записи (120 дней); сам горизонт — сколько дней отдал Altegio: to и months в ответах dates и nearest
      days: conf.days, step: conf.step, maxServices: conf.maxServices,
      // напоминание о визите — варианты виджета Altegio (часы до визита, 0 — не напоминать), по умолчанию — за 1 час, как у него
      notify: { def: 1, options: NOTIFY },
      staff: cat.staff, groups,
      services: cat.services.map(s => ({ key: s.key, name: s.name, desc: s.desc, min: s.min, price: s.price, by: s.by })),
      ft: await ftMake(env, c, nowMs) } };
  } catch (e) { const o = stopped(e); if (o) return o; throw e; }
}

// открытые дни каждого мастера на весь горизонт (кэш дней — 5 минут, обычно уже прогрет): календарь формы считает дни «любого мастера»
// и мастера сам, без запроса на каждый выбор. Сбой у мастера — null (форма тогда спросит dates). from — сегодня, to — последний
// открытый день, months — месяцы календаря
/** @param {Env} env @param {SiteConf} conf @param {any[]} staff @param {number} nowMs */
async function staffDays(env, conf, staff, nowMs) {
  const res = await settledBy(staff.map(m => () => openDates(env, conf, m.id, nowMs)), 3);
  gateCheck(res);
  /** @type {Record<string, string[] | null>} */
  const days = {};
  let to = "";
  res.forEach((r, i) => { if (r.status === "rejected") altLog("days " + staff[i].id, r.reason); const v = r.status === "fulfilled" ? r.value : null; days[staff[i].id] = v; if (v && v.length && v[v.length - 1] > to) to = v[v.length - 1]; });
  const from = isoDay(nowMs);
  return { days, from, to: to || null, months: monthsOf(from, to || null) };
}

// GET nearest: у каждого мастера — первый из двух ближайших открытых дней, где есть время на основную услугу (site.near), до 3 времён.
// Плюс открытые дни всех мастеров (staffDays). Кэш — весь ответ, 2 минуты (сбрасывается после записи): из кэша — без каталога и дней
// (ревью 22.10.2026: каталог истёк, Altegio лежит или очередь к нему полна — вместо сохранённого ответа была ошибка). Сбой у мастера —
// null, у остальных ответ есть; тогда ответ хранится 30 с
/** @param {Env} env @param {Client} c @param {SiteConf} conf @param {number} nowMs @returns {Promise<Out>} */
export async function siteNearest(env, c, conf, nowMs) {
  try {
    const k = ck(conf, "sn"), hit = cacheGet(k, nowMs);
    if (hit) return { http: 200, res: { ok: true, ...hit } };
    const cat = await loadCat(env, conf, nowMs), near = conf.near;
    const res = await settledBy(cat.staff.map(m => async () => {
      if (!near || !cat.sv[near] || !cat.sv[near].by[m.id]) return null;
      for (const d of (await openDates(env, conf, m.id, nowMs)).slice(0, 2)) {
        const r = await staffStarts(env, conf, m.id, d, cat.sv[near].by[m.id].min, nowMs);
        if (r.starts.length) return { date: d, times: r.starts.slice(0, 3) };
      }
      return null;
    }), 3);
    gateCheck(res); // очередь к Altegio переполнена — 429, а не «нет свободного времени» у мастера
    /** @type {Record<string, any>} */
    const staff = {};
    res.forEach((r, i) => { if (r.status === "rejected") altLog("nearest " + cat.staff[i].id, r.reason); staff[cat.staff[i].id] = r.status === "fulfilled" ? r.value : null; });
    const all = { staff, ...(await staffDays(env, conf, cat.staff, nowMs)) };
    cachePut(k, all, nowMs, res.some(r => r.status === "rejected") || Object.values(all.days).includes(null) ? 30e3 : 120e3); // сбой у мастера — ненадолго
    return { http: 200, res: { ok: true, ...all } };
  } catch (e) { const o = stopped(e); if (o) return o; throw e; }
}
