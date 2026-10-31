// @ts-check
// Пульт: служебные ключи KV (ТЗ v2.0): номера каналов компании (ln:), имена сотрудников, которые работали в пульте (ops:).
/** @import { Env } from "../../lib/types.js" */

/** @param {Env} env @param {string} cid @returns {Promise<Record<string, any> | null>} */
export async function linesRead(env, cid) { try { return JSON.parse((await env.KV.get("ln:" + cid)) || "null"); } catch (e) { return null; } }
/** @param {Env} env @param {string} cid @param {Record<string, any>} v */
export async function linesSave(env, cid, v) { await env.KV.put("ln:" + cid, JSON.stringify(v), { expirationTtl: 7 * 86400 }); }

/** @param {Env} env @param {string} cid @returns {Promise<{ n: string, at: number }[]>} */
export async function opsRead(env, cid) { try { const v = JSON.parse((await env.KV.get("ops:" + cid)) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
// не чаще раза в час на имя: список нужен только для выбора «кому назначить»
/** @param {Env} env @param {string} cid @param {string} name @param {number} now */
export async function opsTouch(env, cid, name, now) {
  if (!name) return;
  const cur = await opsRead(env, cid), was = cur.find(x => x.n === name);
  if (was && now - was.at < 3600e3) return;
  const next = [{ n: name, at: now }, ...cur.filter(x => x.n !== name)].slice(0, 20);
  try { await env.KV.put("ops:" + cid, JSON.stringify(next), { expirationTtl: 90 * 86400 }); } catch (e) { console.log("ops", String(e)); }
}
