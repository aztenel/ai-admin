// @ts-check
// Напоминания по журналу Altegio со второго номера (services/reminders/journal.js, 30.10.2026) — хранилище KV:
//   jrq:<клиент> — очередь [{ k, at, rec, p, n, date, time, staff, svc }], 3 дня; p — цифры номера (в браузер — только маской)
//   jrs:<клиент> — когда журнал читали последний раз (мс), 1 день
//   jrc:<клиент>:<день> — сколько сообщений ушло за сутки (по Астане), 2 дня
//   jrcn:<клиент>:<день> — о пределе за сутки уже сообщили в Telegram, 2 дня
//   jrhold:<клиент> — { at, why }: Green-API отказал (номер заблокирован, ключ не подходит) — 6 часов не шлём
//   jrv:<клиент>:<номер> — просили отзыв, 60 дней: постоянному клиенту — не после каждой стрижки
//   rms:/rmok:<клиент>:<запись>:<вид> — попытка и удачная отправка, 3 дня; общие с напоминаниями бота (services/reminders/send.js).
//     Значение rms: — версия записи, по которой ушло (у бота и прежнего кода — «1»)
//   rms:<клиент>:ga:<запись>:<вид>:<версия> — попытка по журналу для этой версии записи (время, мастер, услуги), 3 дня: перенос с тем
//     же номером записи — другая версия, новое напоминание уходит (ТЗ v2.0 §4, 31.10.2026)
//   jrl:<клиент> — последние 100 решений по очереди { t, k, rec, p, n, date, time, st, why } (ушло, отменено, пропущено, задача), 3 дня
//   jrns:<клиент>:<запись> — о неявке уже поставили задачу администратору, 3 дня
//   svtpl:<клиент> — тексты, одобренные владельцем: { S03: { v, at } }, без срока; новая версия текста — заново
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

// попытка по журналу с версией записи. Общая отметка rms:<клиент>:<запись>:<вид>: «1» — уже отправил бот или прежний код (без
// версии — считаем, что ушло: при переходе лучше пропустить одно напоминание после переноса, чем прислать второе), версия — та же
// версия уже ушла; другая версия — запись перенесли, можно. Значение общей отметки — новая версия: бот по этой записи не пошлёт ещё раз
/** @param {Env} env @param {string} cid @param {string} rec @param {string} k @param {string} v @returns {Promise<"" | "legacy" | "same">} */
export async function jrTried(env, cid, rec, k, v) {
  const old = await env.KV.get(`rms:${cid}:${rec}:${k}`);
  if (old === "1") return "legacy";
  if (old === v || await env.KV.get(`rms:${cid}:ga:${rec}:${k}:${v}`)) return "same";
  return "";
}
/** @param {Env} env @param {string} cid @param {string} rec @param {string} k @param {string} v */
export async function jrTry(env, cid, rec, k, v) {
  if (await jrTried(env, cid, rec, k, v)) return false;
  await env.KV.put(`rms:${cid}:ga:${rec}:${k}:${v}`, "1", { expirationTtl: 3 * DAY });
  await env.KV.put(`rms:${cid}:${rec}:${k}`, v, { expirationTtl: 3 * DAY });
  return true;
}
/** не ушло наверняка — попытку снимаем @param {Env} env @param {string} cid @param {string} rec @param {string} k @param {string} v */
export async function jrUntry(env, cid, rec, k, v) {
  await kvRetry(() => env.KV.delete(`rms:${cid}:ga:${rec}:${k}:${v}`));
  if ((await env.KV.get(`rms:${cid}:${rec}:${k}`)) === v) await kvRetry(() => env.KV.delete(`rms:${cid}:${rec}:${k}`));
}

/** @param {Env} env @param {string} cid @returns {Promise<any[]>} */
export async function jrLogLoad(env, cid) {
  try { const l = JSON.parse((await env.KV.get("jrl:" + cid)) || "[]"); return Array.isArray(l) ? l : []; } catch (e) { return []; }
}
/** дописать решения одной записью @param {Env} env @param {string} cid @param {any[]} add */
export async function jrLogAdd(env, cid, add) {
  if (!add.length) return;
  await kvRetry(async () => { const l = await jrLogLoad(env, cid); await env.KV.put("jrl:" + cid, JSON.stringify(l.concat(add).slice(-100)), { expirationTtl: 3 * DAY }); });
}

/** неявка: true — задачи ещё не было (и отметка поставлена) @param {Env} env @param {string} cid @param {string} rec */
export async function jrNoShowMark(env, cid, rec) {
  const k = `jrns:${cid}:${rec}`;
  if (await env.KV.get(k)) return false;
  await env.KV.put(k, "1", { expirationTtl: 3 * DAY });
  return true;
}

/** одобренные владельцем тексты @param {Env} env @param {string} cid @returns {Promise<Record<string, { v: number, at: number }>>} */
export async function svApprovals(env, cid) {
  try { const o = JSON.parse((await env.KV.get("svtpl:" + cid)) || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
}
/** @param {Env} env @param {string} cid @param {string} id @param {number} v @param {boolean} on @param {number} now */
export const svApprove = (env, cid, id, v, on, now) => kvRetry(async () => {
  const o = await svApprovals(env, cid);
  if (on) o[id] = { v, at: now }; else delete o[id];
  await env.KV.put("svtpl:" + cid, JSON.stringify(o));
});
