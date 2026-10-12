// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 1)
// Рассылки: сегменты списка (bcSeg) и список отказавшихся от рассылок (bcOptouts).
/** @import { Env } from "../../lib/types.js" */
import { local } from "../../lib/time.js";
// сегмент списка: «idle» — последний визит дольше days дней назад, «bday» — день рождения в ближайшие days дней (сегодня — тоже)
/** @param {any} r @param {string} seg @param {number} days @param {number} now */
export function bcSeg(r, seg, days, now) {
  if (seg !== "idle" && seg !== "bday") return { list: r.list, out: 0, noDate: 0, label: "" };
  const L = local(now), t0 = Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate()), list = /** @type {any[]} */ ([]);
  let noDate = 0;
  r.list.forEach((/** @type {any} */ x, /** @type {number} */ i) => {
    const m = r.info[i] || {};
    if (seg === "idle") { if (m.v == null) { noDate++; return; } if ((t0 - m.v) / 86400e3 > days) list.push(x); return; }
    if (!m.b) { noDate++; return; }
    let next = Date.UTC(L.getUTCFullYear(), m.b[0] - 1, m.b[1]); if (next < t0) next = Date.UTC(L.getUTCFullYear() + 1, m.b[0] - 1, m.b[1]);
    if ((next - t0) / 86400e3 <= days) list.push(x);
  });
  return { list, out: r.list.length - list.length, noDate, label: seg === "idle" ? `не были больше ${days} дн.` : `день рождения в ближайшие ${days} дн.` };
}
/** @param {Env} env @param {string} cid */
export async function bcOptouts(env, cid) { // все, кому писать нельзя: написали «стоп» боту или запретили рекламу в WhatsApp
  const out = new Set(), prefix = `optout:${cid}:`;
  for (let cursor, page = 0; page < 20; page++) {
    /** @type {any} */
    const r = await env.KV.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const k of (r && r.keys) || []) out.add(String(k.name).slice(prefix.length));
    if (!r || r.list_complete || !r.cursor) break;
    cursor = r.cursor;
  }
  return out;
}
