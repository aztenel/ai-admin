// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// История чата в KV (один ключ на чат): TTL, метаданные для списка пульта, запись, дописывание реплик, слияние профиля.
/** @import { Env, Profile, Hist } from "../../lib/types.js" */
import { HIST_KEEP } from "../../config/constants.js";
import { snip } from "../../lib/text.js";
import { kvRetry } from "./retry.js";

// история чата с паузой («стоп» — 30 дней) живёт не меньше, чем сама пауза
/** @param {Profile | null | undefined} prof */
export const histTtl = prof => Math.max(7 * 86400, prof && prof.pausedUntil > Date.now() ? Math.ceil((prof.pausedUntil - Date.now()) / 1000) + 86400 : 0);
// ---- история чата: один ключ на чат — { n, turns: [{ role, text, t, by?, m? }], profile }.
// В ИИ уходят последние MAX_TURNS реплик, хранится HIST_KEEP: их видит администратор в пульте чатов.
// Метаданные ключа — строка списка чатов в пульте (весь список читается одним запросом KV.list, без чтения самих чатов)
/** @param {Hist | Record<string, any> | null | undefined} h */
export function histMeta(h) {
  const p = (h && h.profile) || {}, ts = (h && h.turns) || [], last = ts[ts.length - 1] || null, now = Date.now();
  /** @type {Record<string, any>} */
  const m = { t: now };
  if (p.li) m.li = p.li;
  if (last) { m.s = snip(last.text, 70); m.d = last.role === "user" ? "u" : last.by === "admin" ? "a" : "b"; }
  const nm = p.name || p.waName; if (nm) m.nm = snip(nm, 40);
  if (p.phone) m.ph = String(p.phone).slice(0, 20);
  if (p.need && p.need.why) m.nd = String(p.need.why).slice(0, 12);
  if (p.pausedUntil > now) m.pu = p.pausedUntil;
  if (p.stop) m.st = 1;
  const bk = (p.bookings || []).length + (p.pend || []).length; if (bk) m.bk = bk;
  return m;
}
/** @param {any} store @param {string} key @param {Hist | Record<string, any>} h */
export async function putHist(store, key, h) { await store.put(key, JSON.stringify(h), { expirationTtl: histTtl(h.profile), metadata: histMeta(h) }); }
// дописать реплики в историю чата помимо think(): голосовое или фото клиента, ответ администратора из пульта. n растёт — think(), который в это время отвечает в том же чате, сольёт свои изменения с этими
/** @param {any} store @param {string} key @param {any[] | undefined} add @param {((profile: Profile, h: Hist) => void) | undefined} [patch] @returns {Promise<Hist>} */
export async function logTurns(store, key, add, patch) {
  return kvRetry(async () => {
    const h = JSON.parse((await store.get(key)) || "null") || { n: 0, turns: [], profile: {} };
    h.profile = h.profile || {}; h.turns = (h.turns || []).concat(add || []).slice(-HIST_KEEP); h.n = (h.n || 0) + 1;
    if (patch) patch(h.profile, h);
    await putHist(store, key, h);
    return h;
  });
}
// два сообщения одного чата обработаны одновременно: к состоянию, которое успело сохраниться (cur), добавляем то, что изменило это сообщение.
// base — профиль, каким его увидело это сообщение в начале: поле, которое оно не меняло, берём из cur (иначе отмена из соседнего сообщения откатится)
/** @param {Profile} cur @param {Profile} mine @param {Profile | null | undefined} base @param {any[]} added @param {any[]} removed @param {any[] | null | undefined} [droppedPend] @returns {Profile} */
export function mergeProfile(cur, mine, base, added, removed, droppedPend) {
  const out = { ...cur }, same = /** @param {any} a @param {any} b */ (a, b) => JSON.stringify(a) === JSON.stringify(b), goneIds = new Set(removed), noPend = new Set(droppedPend || []);
  for (const k of new Set([...Object.keys(mine), ...Object.keys(base || {})])) {
    if (k === "bookings" || k === "pend" || (base && same(mine[k], base[k]))) continue;
    if (k in mine) out[k] = mine[k]; else delete out[k];
  }
  const list = (cur.bookings || []).filter(/** @param {any} b */ b => !goneIds.has(b.leadId));
  for (const b of added) if (!list.some(/** @param {any} x */ x => x.leadId === b.leadId)) list.push(b);
  if (list.length || cur.bookings || mine.bookings) out.bookings = list;
  const pend = [...(cur.pend || []), ...(mine.pend || [])].filter(p => !noPend.has(p.key));
  if (pend.length || cur.pend || mine.pend) out.pend = pend.filter((p, i) => pend.findIndex(q => q.key === p.key) === i).slice(-5);
  if ((cur.pausedUntil || 0) > (out.pausedUntil || 0)) out.pausedUntil = cur.pausedUntil;
  return out;
}
/** @param {Env} env @param {string} hk */
export async function readHist(env, hk) { return JSON.parse((await env.KV.get(hk)) || "null"); }
