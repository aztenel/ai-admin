// @ts-check
// «Автоматические сообщения» со второго номера (services/automsg, задание владельца 02.11.2026) — хранилище KV:
//   msgset:<клиент> — настройки, без срока: { s: { <сценарий>: { on, at, by, t } }, tx: { <сценарий>: { ru, kk, v, at, by } },
//     win: { from, to }, cap, test: { p, at, by } }. on — выключатель (по умолчанию выключен), at — когда включили или выключили
//     (что должно было уйти раньше включения, не уходит), t — время отправки сценария, tx — тексты рекламных сценариев (тексты
//     сервисных — варианты svtpl:<клиент>:var, db/kv/reminders.js), test.p — цифры номера владельца для проверок
//   msgn:<клиент>:<день> — счётчики за сутки по Астане: { <сценарий>: { s, f, u, k, c } } — ушло, не ушло (задача администратору),
//     неизвестно (могло уйти), пропущено, отменено; 8 дней
//   mst:<клиент>:<час> — проверочных отправок за час (не больше 20), 2 часа
//   jrb:<клиент> — записи журнала Altegio, которые видели: { <запись>: { v, d, t, p, n, s, sv, mk, fs, ls, sent } } — чтобы узнать
//     о переносе и отмене, даже если по записи не стояло ни одного напоминания; 30 дней
//   mka:<клиент>:<сценарий>:<день> — рекламный сценарий сегодня уже собрал получателей, 3 дня; mkq:<клиент>:<сценарий> — его очередь
//     на сегодня [{ p, n, … }], 2 дня; bdg:<клиент>:<номер>:<год> — поздравили с днём рождения в этом году, 400 дней
/** @import { Env } from "../../lib/types.js" */
import { kvRetry } from "./retry.js";

const DAY = 86400;

/** @param {string} raw @returns {Record<string, any>} */
const obj = raw => { try { const o = JSON.parse(raw || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } };

/** настройки как лежат в хранилище (без значений по умолчанию — их добавляет catalog.js) @param {Env} env @param {string} cid */
export const autoLoad = async (env, cid) => obj(/** @type {string} */ (await env.KV.get("msgset:" + cid)));
/** изменить настройки: прочитать и записать подряд, с повтором @param {Env} env @param {string} cid @param {(o: Record<string, any>) => void} edit */
export const autoEdit = (env, cid, edit) => kvRetry(async () => {
  const o = await autoLoad(env, cid);
  edit(o);
  await env.KV.put("msgset:" + cid, JSON.stringify(o));
  return o;
});

/** @param {string} cid @param {string} day */
const countKey = (cid, day) => `msgn:${cid}:${day}`;
/** счётчики за дни @param {Env} env @param {string} cid @param {string[]} days @returns {Promise<Record<string, any>[]>} */
export const autoCounts = (env, cid, days) => Promise.all(days.map(async d => obj(/** @type {string} */ (await env.KV.get(countKey(cid, d))))));
/** прибавить к счётчикам дня. add — { <сценарий>: { s?, f?, u?, k?, c? } }. Фоновая задача одна на минуту — гонок почти нет, а счётчик
 *  не решает, слать ли: ошибся на единицу при совпадении двух запусков — не страшно @param {Env} env @param {string} cid @param {string} day @param {Record<string, Record<string, number>>} add */
export async function autoCountAdd(env, cid, day, add) {
  if (!Object.keys(add).length) return;
  await kvRetry(async () => {
    const o = obj(/** @type {string} */ (await env.KV.get(countKey(cid, day))));
    for (const [id, d] of Object.entries(add)) {
      const cur = o[id] && typeof o[id] === "object" ? o[id] : {};
      for (const [k, n] of Object.entries(d)) cur[k] = (+cur[k] || 0) + n;
      o[id] = cur;
    }
    await env.KV.put(countKey(cid, day), JSON.stringify(o), { expirationTtl: 8 * DAY });
  });
}

/** проверочная отправка: сколько уже было за этот час (и +1) @param {Env} env @param {string} cid @param {number} now */
export async function autoTestHit(env, cid, now) {
  const k = `mst:${cid}:${Math.floor(now / 3600e3)}`, n = +((await env.KV.get(k)) || 0) || 0;
  try { await env.KV.put(k, String(n + 1), { expirationTtl: 2 * 3600 }); } catch (e) { console.log("msg test mark", String(e)); }
  return n;
}

/** @param {Env} env @param {string} cid @returns {Promise<Record<string, any>>} */
export const jrbLoad = async (env, cid) => obj(/** @type {string} */ (await env.KV.get("jrb:" + cid)));
/** @param {Env} env @param {string} cid @param {Record<string, any>} st */
export const jrbSave = (env, cid, st) => kvRetry(() => Object.keys(st).length ? env.KV.put("jrb:" + cid, JSON.stringify(st), { expirationTtl: 30 * DAY }) : env.KV.delete("jrb:" + cid));

/** рекламный сценарий: true — сегодня ещё не собирал получателей (и отметка поставлена) @param {Env} env @param {string} cid @param {string} id @param {string} day */
export async function mkDayMark(env, cid, id, day) {
  const k = `mka:${cid}:${id}:${day}`;
  if (await env.KV.get(k)) return false;
  await env.KV.put(k, "1", { expirationTtl: 3 * DAY });
  return true;
}
/** @param {Env} env @param {string} cid @param {string} id @returns {Promise<{ day: string, list: any[] }>} */
export async function mkqLoad(env, cid, id) {
  const o = obj(/** @type {string} */ (await env.KV.get(`mkq:${cid}:${id}`)));
  return { day: String(o.day || ""), list: Array.isArray(o.list) ? o.list : [] };
}
/** @param {Env} env @param {string} cid @param {string} id @param {string} day @param {any[]} list */
export const mkqSave = (env, cid, id, day, list) => kvRetry(() => list.length ? env.KV.put(`mkq:${cid}:${id}`, JSON.stringify({ day, list }), { expirationTtl: 2 * DAY }) : env.KV.delete(`mkq:${cid}:${id}`));

/** @param {Env} env @param {string} cid @param {string} p @param {string} year */
export const bdGreeted = async (env, cid, p, year) => !!(await env.KV.get(`bdg:${cid}:${p}:${year}`));
/** @param {Env} env @param {string} cid @param {string} p @param {string} year @param {number} now */
export const bdGreetMark = (env, cid, p, year, now) => env.KV.put(`bdg:${cid}:${p}:${year}`, String(now), { expirationTtl: 400 * DAY });
