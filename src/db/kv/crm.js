// @ts-check
// База клиентов из журнала Altegio в KV: снимок одним значением, ошибка последнего обновления, отметки «писали маркетинг».
//   crm:<клиент>:snap — { at, from, to, records, visits, clients, masked, bad, att, cut, list }, 30 дней. ≈1 120 клиентов ≈ 150 КБ —
//     одно значение (предел KV — 25 МБ): одно чтение на запрос пульта вместо сотен ключей. Номера только здесь, в журнал сервера — через logSafe
//   crm:<клиент>:err — { at, error } последнего неудачного обновления, 7 дней (пульт покажет, почему база старая)
//   bcm:<клиент>:<день> — цифры номеров, кому в этот день ушёл маркетинговый шаблон (JSON-массив), 15 дней: сегменты не берут их 14 дней
//   bcauto:<клиент> — настройки автосценария «Пора на стрижку» (services/crm/auto.js), без срока; bca:<клиент>:<день> — отметка «сегодня уже был», 3 дня
/** @import { Env } from "../../lib/types.js" */
import { kvRetry } from "./retry.js";

/** @param {string} cid */
export const crmKey = cid => `crm:${cid}:snap`;
/** @param {string} cid @param {string} day ГГГГ-ММ-ДД по Астане */
export const bcmKey = (cid, day) => `bcm:${cid}:${day}`;

/** @param {Env} env @param {string} cid @param {Record<string, any>} snap */
export const crmSave = (env, cid, snap) => kvRetry(() => env.KV.put(crmKey(cid), JSON.stringify(snap), { expirationTtl: 30 * 86400 }));
/** @param {Env} env @param {string} cid @returns {Promise<any>} */
export const crmLoad = async (env, cid) => JSON.parse((await env.KV.get(crmKey(cid))) || "null");

/** @param {Env} env @param {string} cid @param {string} error @param {number} at */
export const crmErrSave = (env, cid, error, at) => env.KV.put(`crm:${cid}:err`, JSON.stringify({ at, error }), { expirationTtl: 7 * 86400 });
/** @param {Env} env @param {string} cid @returns {Promise<{ at: number, error: string } | null>} */
export const crmErrLoad = async (env, cid) => JSON.parse((await env.KV.get(`crm:${cid}:err`)) || "null");

// идёт ли сейчас обновление (кнопка и ночная задача не читают журнал вдвоём: у Altegio предел 5 запросов в секунду). KV хранит не меньше 60 с
/** @param {Env} env @param {string} cid */
export const crmBusy = async (env, cid) => !!(await env.KV.get(`crm:${cid}:busy`));
/** @param {Env} env @param {string} cid @param {boolean} on */
export const crmBusySet = (env, cid, on) => on ? env.KV.put(`crm:${cid}:busy`, "1", { expirationTtl: 180 }) // снять — с повтором: короткий журнал читается быстрее секунды, а KV пишет ключ не чаще раза в секунду
  : kvRetry(() => env.KV.delete(`crm:${cid}:busy`));

// дневная отметка ночного обновления crmd:<клиент>:<день>: ставится до работы (сбой не повторяется каждую минуту — есть кнопка «обновить»).
// true — отметки не было, обновлять сегодня можно
/** @param {Env} env @param {string} cid @param {string} day */
export async function crmDayMark(env, cid, day) {
  const k = `crmd:${cid}:${day}`;
  if (await env.KV.get(k)) return false;
  await env.KV.put(k, "1", { expirationTtl: 3 * 86400 });
  return true;
}

// номера (цифры без «+»), кому писали маркетинг в эти дни. Сбой чтения — ошибка, а не «никому не писали»: иначе напишем второй раз
/** @param {Env} env @param {string} cid @param {string[]} days @returns {Promise<Set<string>>} */
export async function bcmRead(env, cid, days) {
  const out = new Set();
  const all = await Promise.all(days.map(d => env.KV.get(bcmKey(cid, d))));
  for (const v of all) { try { for (const p of JSON.parse(v || "[]")) out.add(String(p)); } catch (e) {} }
  return out;
}
// дописать номера в отметку дня (для отправки рассылок: раз за порцию, не за каждое сообщение — KV не чаще раза в секунду на ключ)
/** @param {Env} env @param {string} cid @param {string} day @param {string[]} phones цифры без «+» */
export async function bcmAdd(env, cid, day, phones) {
  if (!phones.length) return;
  const k = bcmKey(cid, day);
  await kvRetry(async () => { // чтение внутри повтора: вторая попытка — по свежим данным
    const had = JSON.parse((await env.KV.get(k)) || "[]");
    const all = [...new Set([...(Array.isArray(had) ? had : []).map(String), ...phones.map(p => String(p).replace(/\D/g, ""))])].filter(Boolean);
    await env.KV.put(k, JSON.stringify(all), { expirationTtl: 15 * 86400 });
  });
}

/** @param {Env} env @param {string} cid @returns {Promise<Record<string, any> | null>} */
export const autoLoad = async (env, cid) => JSON.parse((await env.KV.get(`bcauto:${cid}`)) || "null");
/** @param {Env} env @param {string} cid @param {Record<string, any>} cfg */
export const autoSave = (env, cid, cfg) => kvRetry(() => env.KV.put(`bcauto:${cid}`, JSON.stringify(cfg)));
// дневная отметка автосценария bca:<клиент>:<день> — до работы, как у ночного снимка: сбой не повторяется каждую минуту и рассылка
// не создаётся дважды. true — сегодня ещё не было
/** @param {Env} env @param {string} cid @param {string} day */
export async function autoDayMark(env, cid, day) {
  const k = `bca:${cid}:${day}`;
  if (await env.KV.get(k)) return false;
  await env.KV.put(k, "1", { expirationTtl: 3 * 86400 });
  return true;
}
