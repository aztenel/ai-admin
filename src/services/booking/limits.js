// @ts-check
// Защита от накрутки записей: не больше ALT_MAX_DAY записей в сутки с телефона, IP и локации.
import { ALT_MAX_DAY, ALT_MAX_DAY_IP, ALT_MAX_LOC_DAY, ALT_MAX_ACTIVE } from "../../config/constants.js";
import { isoDay } from "../../lib/time.js";

// защита от накрутки: не больше ALT_MAX_DAY автоматических записей в сутки с одного телефона и с одного IP. IPv6 считаем по подсети /64
/** @param {any} ip @returns {string} */
export const ipKey = ip => {
  ip = String(ip || "").trim().toLowerCase();
  if (!ip.includes(":")) return ip;
  const v4 = ip.match(/^(?:0*:)*(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) return v4[1];
  const hx = ip.match(/^(?:0*:)*ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/); // тот же IPv4 в шестнадцатеричной записи
  if (hx) { const a = parseInt(hx[1], 16), b = parseInt(hx[2], 16); return [a >> 8, a & 255, b >> 8, b & 255].join("."); }
  const [head, tail] = ip.split("::"), h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const full = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return full.slice(0, 4).map(/** @param {string} x */ x => x.replace(/^0+(?=.)/, "")).join(":");
};
// пределы клиента (altegio.limits: { active, day, ip, locDay, cx }) важнее общих: у Winchester — строже (просьба владельца 19.10.2026: защита от спама записями).
// cx — отмен и переносов своих записей с одного номера (в веб-чате — из одного чата) за сутки, сверх — просьба администратору; без настройки
// не ограничено (перенос лимиты не тратит). trial — пробных записей (веб-чат в пробном режиме) на локацию за сутки
/** @param {any} c @returns {{ active: number, day: number, ip: number, locDay: number, cx: number, trial: number }} */
export const altLimits = c => {
  const l = (c && c.altegio && c.altegio.limits) || {}, n = /** @param {any} v @param {number} d */ (v, d) => +v > 0 ? +v : d;
  return { active: n(l.active, ALT_MAX_ACTIVE), day: n(l.day, ALT_MAX_DAY), ip: n(l.ip, ALT_MAX_DAY_IP), locDay: n(l.locDay, ALT_MAX_LOC_DAY), cx: n(l.cx, Infinity), trial: n(l.trial, 5) };
};
// пробные записи считаются отдельно: они не тратят пределы живых клиентов (номер в веб-чате набирает посетитель — по нему не считаем)
/** @param {string} loc @param {Record<string, any>} ids @param {number} nowMs @param {any} [lim] */
export const altLimKeys = (loc, ids, nowMs, lim) => {
  const L = lim || altLimits(null);
  if (ids.trial) return [[`bk:${loc}:trial:${isoDay(nowMs)}`, L.trial]];
  return [[ids.ip, L.ip], [ids.phone, L.day], ["all", L.locDay]].filter(x => x[0]).map(([x, max]) => [`bk:${loc}:${x}:${isoDay(nowMs)}`, max]);
};
/** @param {any} store @param {string} loc @param {Record<string, any>} ids @param {number} nowMs @param {any} [lim] */
export async function altOverLimit(store, loc, ids, nowMs, lim) { for (const [k, max] of altLimKeys(loc, ids, nowMs, lim)) if (+(await store.get(k) || 0) >= max) return true; return false; }
// отмены и переносы своих записей за сутки — в хранилище, а не в профиле чата: «сброс» и новый чат счётчик не обнуляют (проверка 19.10.2026)
/** @param {any} store @param {string} loc @param {string} who @param {number} nowMs */
export async function altCxGet(store, loc, who, nowMs) { return +(await store.get(`bk:${loc}:cx:${who}:${isoDay(nowMs)}`) || 0); }
/** @param {any} store @param {string} loc @param {string} who @param {number} nowMs @param {number} n */
export async function altCxPut(store, loc, who, nowMs, n) { await store.put(`bk:${loc}:cx:${who}:${isoDay(nowMs)}`, String(n), { expirationTtl: 2 * 86400 }); }
/** @param {any} store @param {string} loc @param {Record<string, any>} ids @param {number} nowMs */
export async function altCount(store, loc, ids, nowMs) { for (const [k] of altLimKeys(loc, ids, nowMs)) await store.put(k, String(+(await store.get(k) || 0) + 1), { expirationTtl: 2 * 86400 }); }
