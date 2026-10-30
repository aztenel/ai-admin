// @ts-check
// Сколько ключей в KV и каких групп — для страницы владельца «Хранилища» и плана переноса в D1. Читаются только имена
// ключей (list), значения — никогда; наружу уходят группы, а не имена: в именах номера телефонов и метки сессий.
/** @import { Env } from "../../lib/types.js" */

const CH = new Set(["wa", "ga", "web", "wz"]);

/**
 * Группа ключа: первое слово с двоеточием; дальше — канал и компания, если они известны («h:wa:winchester:»,
 * «optout:winchester:»). Остальные части (номера, даты, метки) в группу не попадают.
 * @param {string} name
 * @param {(id: string) => boolean} isId
 */
export function kvGroup(name, isId) {
  const p = name.split(":");
  if (p.length < 2) return /^[a-z][a-z0-9_]{0,30}$/i.test(name) ? name : "прочее";
  if (!/^[a-z][a-z0-9_]{0,30}$/i.test(p[0])) return "прочее";
  let g = p[0] + ":", i = 1;
  if (CH.has(p[i]) && i < p.length - 1) g += p[i++] + ":";
  if (i < p.length - 1 && isId(p[i])) g += p[i] + ":";
  return g;
}

/**
 * @param {Env} env
 * @param {(id: string) => boolean} isId
 * @param {number} [maxPages] по 1000 ключей; больше — подсчёт останавливается (complete: false)
 */
export async function kvStats(env, isId, maxPages = 100) {
  /** @type {Map<string, number>} */
  const groups = new Map();
  let total = 0, pages = 0, complete = false, /** @type {string|undefined} */ cursor;
  while (pages < maxPages) {
    const r = await env.KV.list({ limit: 1000, ...(cursor ? { cursor } : {}) });
    pages++;
    for (const k of (r && r.keys) || []) { total++; const g = kvGroup(String(k.name), isId); groups.set(g, (groups.get(g) || 0) + 1); }
    if (!r || r.list_complete || !r.cursor) { complete = true; break; }
    cursor = r.cursor;
  }
  return { total, complete, pages, groups: [...groups].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)) };
}
