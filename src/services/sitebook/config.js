// @ts-check
// Онлайн-запись на сайте клиента: настройки (блок site клиента + переменные SITE_BOOKING_<ID>, SITE_ORIGINS_<ID>) и ключ услуги.
// Сайт статичный (winchester.kz лежит на hoster.kz, своего сервера нет), поэтому API — в этом Worker, а отвечает он только сайтам
// из списка клиента (CORS). Без блока site клиента API для него нет вовсе: иначе любой посетитель мог бы читать Altegio других клиентов.
/** @import { Env, Client } from "../../lib/types.js" */
import { altLoc } from "../booking/book.js";

// Ключ услуги — нормализованное название: одна и та же услуга у шеф-барбера и у барберов (две строки прайса Altegio, две категории
// «Мужские стрижки и бритьё») для клиента одна; строку прайса мастера выбирает сервер. Смена мастера в виджете Altegio сбрасывала
// выбор услуг — по ключу выбор переносится. Порядок: строчные и ё → е; без пояснения в скобках, кавычек и слова «комплекс»;
// остальное, кроме букв и цифр, — дефис
/** @param {any} title @returns {string} */
export const svKey = title => String(title || "").toLowerCase().replace(/ё/g, "е")
  .replace(/\([^()]*\)/g, " ").replace(/[«»"“”„'`]/g, "")
  .replace(/(^|[^a-zа-я0-9])комплекс(?=$|[^a-zа-я0-9])/g, "$1 ")
  .replace(/[^a-zа-я0-9]+/g, "-").replace(/^-+|-+$/g, "");

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/;
// Сайты, с которых принимаем запросы. Text SITE_ORIGINS_<ID> (через запятую) заменяет список из кода целиком: для проверки на
// своей машине (devserver, e2e) или нового адреса сайта без правки кода. Неверно записанный источник пропускается
/** @param {Env} env @param {Client} c @returns {string[]} */
export function siteOrigins(env, c) {
  const v = env["SITE_ORIGINS_" + String(c.id).toUpperCase()];
  const raw = v != null && String(v).trim() !== "" ? String(v).split(",") : ((c.site && c.site.origins) || []);
  return [...new Set(raw.map(/** @param {any} s */ s => String(s).trim().toLowerCase().replace(/\/+$/, "")).filter(/** @param {string} s */ s => ORIGIN.test(s)))];
}

// режим: Text SITE_BOOKING_<ID> важнее site.booking из кода. "0" — выключено, "1" — настоящая запись, остальное — проверка без записи
// (book_check + заявка администратору): настоящую запись владелец включает переменной после живой проверки и слова Кайрата
/** @param {any} v @returns {"off" | "dry" | "live"} */
const modeOf = v => { const s = String(v ?? "").trim().toLowerCase(); return s === "0" ? "off" : s === "1" ? "live" : "dry"; };

/**
 * Настройки онлайн-записи на сайте клиента или null (у клиента её нет). mode "off" — выключено переменной, нет ключа Altegio,
 * локации или ключа владельца LEADS_KEY (им подписана метка формы ft)
 * @param {Env} env @param {Client} c
 */
export function siteConf(env, c) {
  const s = c && c.site;
  if (!s) return null;
  const v = env["SITE_BOOKING_" + String(c.id).toUpperCase()];
  let mode = modeOf(v != null && String(v).trim() !== "" ? v : s.booking);
  const loc = altLoc(env, c);
  if (!env.ALTEGIO_PARTNER || loc <= 0 || !env.LEADS_KEY) mode = "off";
  const n = /** @param {any} x @param {number} d @param {number} lo @param {number} hi */ (x, d, lo, hi) => +x >= lo && +x <= hi ? Math.round(+x) : d;
  return {
    mode, origins: siteOrigins(env, c), loc, id: String(c.id), name: String(c.name || ""),
    days: n(s.days, 30, 1, 60), step: n(s.step, 30, 5, 60), minLead: n(s.minLead, 30, 0, 240), maxServices: n(s.maxServices, 5, 1, 10),
    dayMax: n(s.dayMax, 15, 1, 500),
    address: String(s.address || ""), phone: String(s.phone || ""), tel: "+" + String(s.phone || "").replace(/\D/g, ""), wa: String(s.wa || ""),
    hours: String(c.hoursText || ""), near: String(s.near || ""),
    groups: /** @type {{ title: string, keys: string[] }[]} */ (Array.isArray(s.groups) ? s.groups : []),
    names: /** @type {Record<string, string>} */ (s.names || {}), descs: /** @type {Record<string, string>} */ (s.descs || {}),
    durations: /** @type {Record<string, number> | undefined} */ (c.altegio && c.altegio.durations)
  };
}
/** @typedef {NonNullable<ReturnType<typeof siteConf>>} SiteConf */
