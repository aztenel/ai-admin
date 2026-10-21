// @ts-check
// Онлайн-запись на сайте: фото мастера — GET /api/site/<клиент>/photo/<мастер>?v=<версия>. Форма рисует круг с фото, как виджет Altegio;
// нет фото — букву имени. Адрес картинки сервер берёт только из своего каталога (book_staff Altegio), а не из запроса (SSRF);
// загрузку и проверки картинки делает адаптер (integrations/altegio/photo-api.js). Кэш: память экземпляра → KV на сутки (sph:) →
// Altegio; браузер хранит картинку день (cache-control). v — версия адреса фото в Altegio: по нему картинка находится в кэше даже
// на холодном экземпляре, без запроса мастеров к Altegio; не совпал — берём адрес из каталога заново.
/** @import { Env } from "../../lib/types.js" */
/** @import { SiteConf } from "./config.js" */
/** @import { Out } from "./texts.js" */
import { altPhotoFetch, altPhotoUrl } from "../integrations/altegio/photo-api.js";
import { altStaffRaw } from "../integrations/altegio/site-api.js";
import { photoGet, photoPut } from "../../db/kv/site.js";
import { logSafe } from "../../lib/phone.js";
import { cacheGet, cachePut, ck, altGate, once, stop, stopped, altLog, staffOk, photoVer } from "./base.js";
import { fail } from "./texts.js";

// max — предел размера картинки (фото 220×220 — десятки КБ); maxAge — сколько браузер хранит картинку; failMs — сколько помним неудачу
// (Altegio не дёргаем на каждый показ страницы); memBytes — сколько картинок держит память экземпляра
export const PHOTO = { max: 512 * 1024, maxAge: 86400, failMs: 600e3, memBytes: 4 * 1024 * 1024 };

// память экземпляра: ключ «клиент:лок:мастер:версия» → { at, img } (img null — неудача, помним failMs)
/** @type {Map<string, { at: number, img: { bytes: Uint8Array, type: string } | null }>} */
export const photoMem = new Map();
/** @param {string} k @param {number} nowMs */
const memGet = (k, nowMs) => {
  const h = photoMem.get(k);
  if (!h) return undefined;
  if (Math.abs(nowMs - h.at) > (h.img ? PHOTO.maxAge * 1000 : PHOTO.failMs)) { photoMem.delete(k); return undefined; }
  return h.img;
};
/** @param {string} k @param {{ bytes: Uint8Array, type: string } | null} img @param {number} nowMs */
function memPut(k, img, nowMs) {
  photoMem.delete(k); photoMem.set(k, { at: nowMs, img });
  let total = 0;
  for (const v of photoMem.values()) total += v.img ? v.img.bytes.length : 0;
  for (const [key, v] of photoMem) { if (total <= PHOTO.memBytes && photoMem.size <= 200) break; total -= v.img ? v.img.bytes.length : 0; photoMem.delete(key); } // самые старые — первыми
}

// адреса фото мастеров { [мастер]: адрес в Altegio }: из каталога, а без него — один запрос мастеров (book_staff) через очередь сайта,
// кэш 10 минут; одновременные запросы картинок холодного экземпляра — один запрос к Altegio
/** @param {Env} env @param {SiteConf} conf @param {number} nowMs @returns {Promise<Record<string, string>>} */
async function loadPics(env, conf, nowMs) {
  const cat = cacheGet(ck(conf, "sc"), nowMs);
  if (cat) return cat.pics;
  const k = ck(conf, "sp"), hit = cacheGet(k, nowMs);
  if (hit) return hit;
  return once(k, async () => {
    await altGate(conf);
    /** @type {any[]} */ let list;
    try { list = await altStaffRaw(env, conf.loc); } catch (e) { altLog("photo staff", e); throw stop(fail("altegio", conf)); }
    /** @type {Record<string, string>} */
    const pics = {};
    for (const m of list.filter(staffOk)) { const u = altPhotoUrl(m); if (u) pics[m.id] = u; }
    cachePut(k, pics, nowMs, 600e3);
    return pics;
  });
}

// картинка из памяти или KV (сбой KV — как промах)
/** @param {Env} env @param {SiteConf} conf @param {number} staffId @param {string} v @param {number} nowMs */
async function cached(env, conf, staffId, v, nowMs) {
  const k = [conf.id, conf.loc, staffId, v].join(":"), m = memGet(k, nowMs);
  if (m !== undefined) return { k, img: m, known: true };
  let img = null;
  try { img = await photoGet(env.KV, conf.id, conf.loc, staffId, v); } catch (e) { console.log("site photo kv", logSafe(String(e)).slice(0, 200)); }
  if (img) memPut(k, img, nowMs);
  return { k, img, known: !!img };
}

/**
 * GET photo: { img } — картинка ({ bytes, type }) или { out } — ответ-ошибка (no_photo — фото нет или не загрузилось; форма рисует букву)
 * @param {Env} env @param {SiteConf} conf @param {number} staffId @param {string} vRaw @param {number} nowMs
 * @returns {Promise<{ img: { bytes: Uint8Array, type: string }, out?: undefined } | { out: Out, img?: undefined }>}
 */
export async function sitePhoto(env, conf, staffId, vRaw, nowMs) {
  try {
    const v0 = /^[0-9a-f]{8}$/.test(vRaw) ? vRaw : "";
    if (v0) { const h = await cached(env, conf, staffId, v0, nowMs); if (h.img) return { img: h.img }; }
    const url = (await loadPics(env, conf, nowMs))[staffId];
    if (!url) return { out: fail("no_photo", conf) };
    const v = photoVer(url), h = v === v0 ? { k: [conf.id, conf.loc, staffId, v].join(":"), img: null, known: false } : await cached(env, conf, staffId, v, nowMs);
    if (h.img) return { img: h.img };
    if (memGet(h.k, nowMs) === null) return { out: fail("no_photo", conf) }; // недавно не загрузилось
    const img = await once("photo:" + h.k, async () => {
      try { return await altPhotoFetch(url, PHOTO.max); } catch (e) { altLog("photo " + staffId, e); return null; }
    });
    memPut(h.k, img, nowMs);
    if (!img) return { out: fail("no_photo", conf) };
    try { await photoPut(env.KV, conf.id, conf.loc, staffId, v, img); } catch (e) { console.log("site photo kv put", logSafe(String(e)).slice(0, 200)); }
    return { img };
  } catch (e) { const o = stopped(e); if (o) return { out: o }; throw e; }
}
