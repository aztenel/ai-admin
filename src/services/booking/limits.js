// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Защита от накрутки записей: не больше ALT_MAX_DAY записей в сутки с телефона, IP и локации.
import { ALT_MAX_DAY, ALT_MAX_DAY_IP, ALT_MAX_LOC_DAY } from "../../config/constants.js";
import { isoDay } from "../../lib/time.js";

// защита от накрутки: не больше ALT_MAX_DAY автоматических записей в сутки с одного телефона и с одного IP. IPv6 считаем по подсети /64
export const ipKey = ip => {
  ip = String(ip || "").trim().toLowerCase();
  if (!ip.includes(":")) return ip;
  const v4 = ip.match(/^(?:0*:)*(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) return v4[1];
  const hx = ip.match(/^(?:0*:)*ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/); // тот же IPv4 в шестнадцатеричной записи
  if (hx) { const a = parseInt(hx[1], 16), b = parseInt(hx[2], 16); return [a >> 8, a & 255, b >> 8, b & 255].join("."); }
  const [head, tail] = ip.split("::"), h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const full = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return full.slice(0, 4).map(x => x.replace(/^0+(?=.)/, "")).join(":");
};
export const altLimKeys = (loc, ids, nowMs) => [[ids.ip, ALT_MAX_DAY_IP], [ids.phone, ALT_MAX_DAY], ["all", ALT_MAX_LOC_DAY]].filter(x => x[0]).map(([x, max]) => [`bk:${loc}:${x}:${isoDay(nowMs)}`, max]);
export async function altOverLimit(store, loc, ids, nowMs) { for (const [k, max] of altLimKeys(loc, ids, nowMs)) if (+(await store.get(k) || 0) >= max) return true; return false; }
export async function altCount(store, loc, ids, nowMs) { for (const [k] of altLimKeys(loc, ids, nowMs)) await store.put(k, String(+(await store.get(k) || 0) + 1), { expirationTtl: 2 * 86400 }); }
