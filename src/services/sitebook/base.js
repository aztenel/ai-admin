// @ts-check
// Онлайн-запись на сайте: данные каталога из Altegio (мастера, услуги каждого мастера, цены и длительности у мастера), кэш в памяти
// экземпляра Worker и проверка выбора клиента (услуги по ключу, мастер). Общая часть для catalog.js, slots.js и book.js.
/** @import { Env } from "../../lib/types.js" */
/** @import { SiteConf } from "./config.js" */
/** @import { Out } from "./texts.js" */
import { altText } from "../integrations/altegio/client.js";
import { altStaffRaw, altServicesRaw } from "../integrations/altegio/site-api.js";
import { altPhotoUrl } from "../integrations/altegio/photo-api.js";
import { settledBy } from "../booking/book.js";
import { withDurations } from "../booking/fit.js";
import { ALT_MAX_STAFF, ALT_MAX_SERVICES } from "../../config/constants.js";
import { clean } from "../../lib/text.js";
import { logSafe } from "../../lib/phone.js";
import { hash } from "../../lib/crypto.js";
import { svKey } from "./config.js";
import { fail } from "./texts.js";

// ---- кэш сайта в памяти экземпляра: sc (каталог, 10 мин), sd (открытые дни мастера, 5 мин), sn (ближайшее время, 2 мин); ключ —
// «вид:клиент:локация:…» (CLAUDE.md §5.3 п.5). Свой, а не общий с ботом altCache: тот при переполнении очищается целиком, и наборы
// услуг с сайта сбрасывали кэш бота (проба 21.10.2026). Переполнен — уходят самые старые записи. Свободное время мастеров — t: из
// altTimes, общий с ботом (ключей не больше, чем мастеров × дней)
/** @type {Map<string, { at: number, v: any, ttl: number }>} */
export const siteCache = new Map();
const CACHE_MAX = 300;
/** @param {SiteConf} conf @param {string} kind @param {...(string | number)} rest */
export const ck = (conf, kind, ...rest) => [kind, conf.id, conf.loc, ...rest].join(":");
/** @param {string} k @param {number} nowMs */
export const cacheGet = (k, nowMs) => { const h = siteCache.get(k); return h && Math.abs(nowMs - h.at) < h.ttl ? h.v : null; };
/** @param {string} k @param {any} v @param {number} nowMs @param {number} ttl */
export const cachePut = (k, v, nowMs, ttl) => {
  siteCache.delete(k); siteCache.set(k, { at: nowMs, v, ttl });
  if (siteCache.size > CACHE_MAX) for (const key of siteCache.keys()) { siteCache.delete(key); if (siteCache.size <= CACHE_MAX - 50) break; }
};
/** @param {string} k */
export const cacheDrop = k => { siteCache.delete(k); };

// одинаковые запросы в полёте — один запрос к Altegio: холодный экземпляр получает каталог, дни и пять фото почти одновременно
// (без этого — по набору запросов на каждый: 3 одновременных каталога = 21 запрос к Altegio при пределе 5 в секунду)
/** @type {Map<string, Promise<any>>} */
const flying = new Map();
/** @template T @param {string} k @param {() => Promise<T>} f @returns {Promise<T>} */
export function once(k, f) {
  const cur = flying.get(k);
  if (cur) return cur;
  const p = f().finally(() => { if (flying.get(k) === p) flying.delete(k); });
  flying.set(k, p);
  return p;
}

// готовый ответ вместо результата: бросается из глубины (сбой Altegio при чтении) и превращается в ответ в siteCatalog/siteTimes/…
/** @param {Out} out */
export const stop = out => Object.assign(new Error("site:" + out.res.code), { out });
/** @param {any} e @returns {Out | null} */
export const stopped = e => e && e.out && e.out.res ? e.out : null;
// среди результатов settledBy есть «слишком много запросов» (очередь к Altegio) — весь ответ такой же: иначе мастер молча пропал бы
// из каталога или списка времени
/** @param {PromiseSettledResult<any>[]} res */
export const gateCheck = res => { for (const r of res) if (r.status === "rejected" && stopped(r.reason)) throw r.reason; };

// ---- очередь запросов сайта к Altegio (не из кэша): Altegio принимает 5 запросов в секунду на ключ разработчика — на бота и сайт
// вместе. Сайт — не больше rate в секунду на локацию в пределах экземпляра, burst — запас на холодный кэш (каталог и ближайшее
// время — ≈ 20 запросов); ждать дольше wait мс не заставляем — ответ «слишком много запросов» (перебор расписания скриптом).
// Запись (свежее время, book_check, book_record) очередь не ждёт: её ограничивают попытки с адреса и пределы записей
export const GATE = { rate: 4, burst: 24, wait: 6000 };
/** @type {Map<number, { t: number, at: number }>} */
const buckets = new Map();
/** @param {SiteConf} conf */
export async function altGate(conf) {
  const now = Date.now(), b = buckets.get(conf.loc) || { t: GATE.burst, at: now };
  b.t = Math.min(GATE.burst, b.t + Math.max(0, now - b.at) * GATE.rate / 1000); b.at = now;
  buckets.set(conf.loc, b);
  const wait = b.t >= 1 ? 0 : (1 - b.t) / GATE.rate * 1000;
  if (wait > GATE.wait) throw stop(fail("rate", conf, { retry: Math.max(1, Math.ceil(wait / 1000)) }));
  b.t -= 1;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

// срок ответа на запись (мс от начала): форма ждёт ответ 30 с. Новый шаг кандидата (свежее время, book_check) — не позже cands,
// book_record — не позже record; позже — «расписание не отвечает» (запись не создана, можно повторить)
export const BUDGET = { cands: 9000, record: 12000 };
/** @param {string} where @param {any} e */
export const altLog = (where, e) => console.log("site " + where, logSafe(String((e && e.message) || e)).slice(0, 200), (e && e.status) || "", (e && e.code) || "");

/**
 * Каталог для сайта (внутренний вид):
 *   staff    — [{ id, name (без скобок), full, role, rating, reviews, services: [ключи], has_photo, photo }] в порядке Altegio;
 *   services — [{ key, name, desc, min, price: { from, to }, by: { [мастер]: { price, max, min } } }];
 *   sv       — те же услуги по ключу; ids — { [мастер]: { [ключ]: номер услуги Altegio } }, pics — { [мастер]: адрес фото в Altegio }
 *              (ids и pics наружу не отдаются: у мастера только has_photo и photo — наш адрес /api/site/<клиент>/photo/<мастер>?v=<версия>)
 * @typedef {{ staff: any[], services: any[], sv: Record<string, any>, ids: Record<string, Record<string, number>>, pics: Record<string, string>, partial: boolean }} Cat
 */

// пояснение услуги из Altegio («- Стрижка\n- SPA…») → «Стрижка, SPA…»
/** @param {any} s */
const descOf = s => clean(String(s || "").split(/\n+/).map(x => x.replace(/^[\s\-–—•*]+/, "").trim()).filter(Boolean).join(", "), 200);

// Каталог: мастера (book_staff), весь прайс (book_services — пояснения) и услуги каждого мастера (book_services?staff_id= — только его строки
// прайса, его цены и длительности). Длительность у мастера = больше из кода (altegio.durations — главный источник, как у бота) и Altegio:
// Altegio сам считает занятость по своей длительности (детская стрижка у Айдына — 45 мин), и с меньшей клиент получил бы «занято» в конце.
// Мастер, по которому Altegio не ответил, в каталог не попадает, а каталог хранится 60 с вместо 10 минут
/** @param {Env} env @param {SiteConf} conf @param {number} nowMs @returns {Promise<Cat>} */
export async function loadCat(env, conf, nowMs) {
  const k = ck(conf, "sc"), hit = cacheGet(k, nowMs);
  if (hit) return hit;
  return once(k, () => fetchCat(env, conf, nowMs, k));
}
// фото мастеров из ответа book_staff: { [мастер]: адрес в Altegio } (без фото — нет ключа)
/** @param {any[]} staff0 @returns {Record<string, string>} */
function picsOf(staff0) {
  /** @type {Record<string, string>} */
  const o = {};
  for (const m of staff0) { const u = altPhotoUrl(m); if (u) o[m.id] = u; }
  return o;
}
// версия фото для адреса картинки: другое фото в Altegio — другой адрес, браузер не покажет старое из своего кэша
/** @param {string} url */
export const photoVer = url => hash(url).toString(16).padStart(8, "0");
/** @param {any} m */
export const staffOk = m => m && m.id && altText(m.name) && !+m.fired && !+m.hidden;
/** @param {Env} env @param {SiteConf} conf @param {number} nowMs @param {string} k @returns {Promise<Cat>} */
async function fetchCat(env, conf, nowMs, k) {
  const [st, all] = await Promise.allSettled([altGate(conf).then(() => altStaffRaw(env, conf.loc)), altGate(conf).then(() => altServicesRaw(env, conf.loc))]);
  gateCheck([st, all]);
  if (st.status === "rejected") { altLog("staff", st.reason); throw stop(fail("altegio", conf)); }
  const staff0 = st.value.filter(staffOk).slice(0, ALT_MAX_STAFF), pics = picsOf(staff0);
  cachePut(ck(conf, "sp"), pics, nowMs, 600e3); // фото мастеров — и отдельно: картинке на холодном экземпляре не нужен весь каталог
  const per = await settledBy(staff0.map(/** @param {any} m */ m => async () => { await altGate(conf); return altServicesRaw(env, conf.loc, m.id); }), 3);
  gateCheck(per);
  const notes = new Map((all.status === "fulfilled" ? all.value.services : []).map(/** @param {any} x */ x => [String(x && x.id), x && x.comment]));
  /** @type {Record<string, any>} */
  const sv = {};
  /** @type {any[]} */
  const services = [];
  /** @type {any[]} */
  const staff = [];
  /** @type {Record<string, Record<string, number>>} */
  const ids = {};
  per.forEach((r, i) => {
    const m = staff0[i];
    if (r.status === "rejected") { altLog("services " + m.id, r.reason); return; }
    /** @type {Record<string, number>} */
    const own = {};
    for (const x of r.value.services.slice(0, ALT_MAX_SERVICES)) {
      if (!x || !x.id || x.active === 0 || x.active === false || !altText(x.title)) continue;
      const key = svKey(x.title);
      if (!key || key.length > 60 || own[key]) continue; // у мастера два номера с одним ключом — берём первый
      own[key] = +x.id;
      let s = sv[key];
      if (!s) {
        const code = +withDurations([{ title: String(x.title), minutes: 0 }], conf.durations)[0].minutes || 0;
        s = sv[key] = { key, name: conf.names[key] || altText(x.title, 90), desc: conf.descs[key] || descOf(x.comment || notes.get(String(x.id))), code, by: {} };
        services.push(s);
      }
      const altMin = Math.round((+x.seance_length || 0) / 60), price = Math.max(0, Math.round(+x.price_min || 0));
      s.by[m.id] = { price, max: Math.max(price, Math.round(+x.price_max || 0)), min: Math.max(s.code, altMin) || 60 };
    }
    if (!Object.keys(own).length) return;
    ids[m.id] = own;
    const rated = +m.show_rating > 0 && +m.rating > 0;
    staff.push({ id: +m.id, name: altText(m.name, 60).replace(/\s*\([^()]*\)\s*/g, " ").trim() || altText(m.name, 60), full: altText(m.name, 60),
      role: clean(m.specialization || (m.position && m.position.title) || "", 50), rating: rated ? Math.round(+m.rating * 100) / 100 : null,
      reviews: rated ? Math.max(0, Math.round(+m.comments_count || 0)) : null, services: Object.keys(own),
      has_photo: !!pics[m.id], photo: pics[m.id] ? `/api/site/${conf.id}/photo/${+m.id}?v=${photoVer(pics[m.id])}` : null });
  });
  if (!staff.length) throw stop(fail("altegio", conf)); // не ответил никто
  for (const s of services) {
    const by = Object.values(s.by);
    s.min = s.code || Math.min(...by.map(/** @param {any} v */ v => v.min));
    s.price = { from: Math.min(...by.map(/** @param {any} v */ v => v.price)), to: Math.max(...by.map(/** @param {any} v */ v => v.max)) };
    delete s.code;
  }
  const partial = per.some(r => r.status === "rejected") || all.status === "rejected";
  /** @type {Cat} */
  const cat = { staff, services, sv, ids, pics, partial };
  cachePut(k, cat, nowMs, partial ? 60e3 : 600e3);
  return cat;
}

// услуги из запроса (массив или «к1,к2») → { keys } | { why } (ключ текста FIELD)
/** @param {Cat} cat @param {SiteConf} conf @param {any} raw @returns {{ keys: string[], why?: undefined } | { why: string, keys?: undefined }} */
export function pickServices(cat, conf, raw) {
  const list = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : []).map(/** @param {any} s */ s => String(s ?? "").trim()).filter(Boolean);
  if (!list.length) return { why: "services" };
  if (list.length > conf.maxServices) return { why: "servicesMax" };
  if (new Set(list).size !== list.length || list.some(/** @param {string} k */ k => k.length > 60 || !Object.hasOwn(cat.sv, k))) return { why: "servicesGone" };
  return { keys: list };
}
/** @param {Cat} cat @param {any} m @param {string[]} keys */
export const doesAll = (cat, m, keys) => keys.every(k => !!(cat.ids[m.id] && cat.ids[m.id][k]));
// мастер из запроса: id — один мастер, 0 — «любой» (все, кто делает все выбранные услуги) → { pool } | { field, why }
/** @param {Cat} cat @param {any} raw @param {string[]} keys @param {boolean} [anyOk] @returns {{ pool: any[], field?: undefined, why?: undefined } | { field: string, why?: string, pool?: undefined }} */
export function staffPool(cat, raw, keys, anyOk = true) {
  const id = typeof raw === "number" ? raw : /^\d{1,12}$/.test(String(raw ?? "").trim()) ? +String(raw).trim() : NaN;
  if (!Number.isInteger(id) || id < 0 || (id === 0 && !anyOk)) return { field: "staff" };
  if (id === 0) { const pool = cat.staff.filter(m => doesAll(cat, m, keys)); return pool.length ? { pool } : { field: "services", why: "servicesStaff" }; }
  const m = cat.staff.find(x => x.id === id);
  if (!m) return { field: "staff" };
  return doesAll(cat, m, keys) ? { pool: [m] } : { field: "services", why: "servicesStaff" };
}
// сумма выбранных услуг у мастера: цена (от), минуты
/** @param {Cat} cat @param {number} staffId @param {string[]} keys */
export const sumOf = (cat, staffId, keys) => keys.reduce((a, k) => { const b = cat.sv[k].by[staffId]; return { price: a.price + b.price, min: a.min + b.min }; }, { price: 0, min: 0 });
