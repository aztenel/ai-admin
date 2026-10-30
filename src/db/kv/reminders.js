// @ts-check
// Напоминания по журналу Altegio со второго номера (services/reminders/journal.js, 30.10.2026) — хранилище KV:
//   jrq:<клиент> — очередь [{ k, at, rec, p, n, date, time, staff, svc }], 3 дня; p — цифры номера (в браузер — только маской)
//   jrs:<клиент> — когда журнал читали последний раз (мс), 1 день
//   jrc:<клиент>:<день> — сколько сообщений ушло за сутки (по Астане), 2 дня
//   jrcn:<клиент>:<день> — о пределе за сутки уже сообщили в Telegram, 2 дня
//   jrhold:<клиент> — { at, why }: Green-API отказал (номер заблокирован, ключ не подходит) — 6 часов не шлём
//   jrv:<клиент>:<номер> — просили отзыв, 60 дней: постоянному клиенту — не после каждой стрижки
//   rms:/rmok:<клиент>:<запись>:<вид> — попытка и удачная отправка, 3 дня; общие с напоминаниями бота (services/reminders/send.js)
/** @import { Env } from "../../lib/types.js" */
import { kvRetry } from "./retry.js";

const DAY = 86400;

/** @param {Env} env @param {string} cid @returns {Promise<any[]>} */
export async function jrqLoad(env, cid) {
  try { const q = JSON.parse((await env.KV.get("jrq:" + cid)) || "[]"); return Array.isArray(q) ? q : []; } catch (e) { console.log("jrq", String(e)); return []; }
}
/** @param {Env} env @param {string} cid @param {any[]} q */
export const jrqSave = (env, cid, q) => kvRetry(() => q.length ? env.KV.put("jrq:" + cid, JSON.stringify(q), { expirationTtl: 3 * DAY }) : env.KV.delete("jrq:" + cid));

/** @param {Env} env @param {string} cid @returns {Promise<number>} */
export const jrSyncAt = async (env, cid) => +((await env.KV.get("jrs:" + cid)) || 0) || 0;
/** @param {Env} env @param {string} cid @param {number} now */
export const jrSyncMark = (env, cid, now) => env.KV.put("jrs:" + cid, String(now), { expirationTtl: DAY });

/** @param {Env} env @param {string} cid @param {string} day */
export const jrCount = async (env, cid, day) => +((await env.KV.get(`jrc:${cid}:${day}`)) || 0) || 0;
/** @param {Env} env @param {string} cid @param {string} day @param {number} n */
export const jrCountSave = (env, cid, day, n) => kvRetry(() => env.KV.put(`jrc:${cid}:${day}`, String(n), { expirationTtl: 2 * DAY }));

// true — сегодня о пределе ещё не сообщали (и отметка поставлена): иначе сигнал повторялся бы каждые 10 минут до конца дня
/** @param {Env} env @param {string} cid @param {string} day */
export async function jrCapNote(env, cid, day) {
  const k = `jrcn:${cid}:${day}`;
  if (await env.KV.get(k)) return false;
  await env.KV.put(k, "1", { expirationTtl: 2 * DAY });
  return true;
}

/** @param {Env} env @param {string} cid @returns {Promise<{ at: number, why: string } | null>} */
export async function jrHold(env, cid) { try { return JSON.parse((await env.KV.get("jrhold:" + cid)) || "null"); } catch (e) { return null; } }
/** @param {Env} env @param {string} cid @param {string} why @param {number} now */
export const jrHoldSet = (env, cid, why, now) => kvRetry(() => env.KV.put("jrhold:" + cid, JSON.stringify({ at: now, why: String(why).slice(0, 200) }), { expirationTtl: 6 * 3600 }));

/** @param {Env} env @param {string} cid @param {string} p */
export const jrReviewed = async (env, cid, p) => !!(await env.KV.get(`jrv:${cid}:${p}`));
/** @param {Env} env @param {string} cid @param {string} p @param {number} now */
export const jrReviewMark = (env, cid, p, now) => env.KV.put(`jrv:${cid}:${p}`, String(now), { expirationTtl: 60 * DAY });

/** клиент писал «стоп» (optout: ставят ответы бота, пульт и Meta) @param {Env} env @param {string} cid @param {string} p */
export const optedOut = async (env, cid, p) => !!(await env.KV.get(`optout:${cid}:${p}`));

// отметка попытки ставится до отправки (две фоновые задачи одновременно не отправят одно и то же); false — уже пробовали
/** @param {Env} env @param {string} cid @param {string} rec @param {string} k */
export async function rmTry(env, cid, rec, k) {
  const key = `rms:${cid}:${rec}:${k}`;
  if (await env.KV.get(key)) return false;
  await env.KV.put(key, "1", { expirationTtl: 3 * DAY });
  return true;
}
/** не ушло наверняка (429, 5xx, номер отключён) — попытку снимаем @param {Env} env @param {string} cid @param {string} rec @param {string} k */
export const rmUntry = (env, cid, rec, k) => kvRetry(() => env.KV.delete(`rms:${cid}:${rec}:${k}`));
/** @param {Env} env @param {string} cid @param {string} rec @param {string} k */
export const rmOk = (env, cid, rec, k) => env.KV.put(`rmok:${cid}:${rec}:${k}`, "1", { expirationTtl: 3 * DAY });
