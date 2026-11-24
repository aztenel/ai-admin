// @ts-check
// Пульт: служебные ключи KV (ТЗ v2.0): номера каналов компании (ln:), имена сотрудников, которые работали в пульте (ops:),
// отметки отправки из пульта (snd:) — защита от двойной отправки.
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

// отметка отправки из пульта: snd:<компания>:<канал>:<чат>:<rid> — «идёт» ({ st: "busy" }) или «готово» ({ st: "done", id, unknown }),
// 10 минут. rid присылает пульт на каждое сообщение и каждый файл: двойное нажатие и повтор запроса браузером после обрыва связи
// не отправляют клиенту второй раз (как sb: у записи с сайта)
/** @param {string} cid @param {string} ch @param {string} chat @param {string} rid */
const sndKey = (cid, ch, chat, rid) => `snd:${cid}:${ch}:${chat}:${rid}`;
/** @param {Env} env @param {string} cid @param {string} ch @param {string} chat @param {string} rid @returns {Promise<any>} */
export async function sendMarkGet(env, cid, ch, chat, rid) { try { return JSON.parse((await env.KV.get(sndKey(cid, ch, chat, rid))) || "null"); } catch (e) { return null; } }
/** @param {Env} env @param {string} cid @param {string} ch @param {string} chat @param {string} rid @param {any} v */
export async function sendMarkPut(env, cid, ch, chat, rid, v) { await env.KV.put(sndKey(cid, ch, chat, rid), JSON.stringify(v), { expirationTtl: 600 }); }
/** @param {Env} env @param {string} cid @param {string} ch @param {string} chat @param {string} rid */
export async function sendMarkDrop(env, cid, ch, chat, rid) { await env.KV.delete(sndKey(cid, ch, chat, rid)); }

// последнее событие вебхука Pushon (21.11.2026: вебхук подключили, а в пульте пусто — нужно видеть, доходят ли события и разбираются ли):
// только вид события, имена полей и решение кода — без номеров и текстов. 14 дней
/** @param {Env} env @param {string} cid @param {Record<string, any>} v */
export async function poLastSave(env, cid, v) { await env.KV.put("pol:" + cid, JSON.stringify(v), { expirationTtl: 14 * 86400 }); }
/** последний файл от клиента через Pushon — какие поля в событии (22.11.2026: фото клиента не дошло до пульта) @param {Env} env @param {string} cid @param {any} v */
export async function poFileSave(env, cid, v) { await env.KV.put("polm:" + cid, JSON.stringify(v), { expirationTtl: 30 * 86400 }); }
/** @param {Env} env @param {string} cid */
export async function poFileRead(env, cid) { try { return JSON.parse((await env.KV.get("polm:" + cid)) || "null"); } catch (e) { return null; } }
/** @param {Env} env @param {string} cid @returns {Promise<Record<string, any> | null>} */
export async function poLastRead(env, cid) { try { return JSON.parse((await env.KV.get("pol:" + cid)) || "null"); } catch (e) { return null; } }

// файл из пульта для Pushon (25.11.2026): Pushon берёт файл по ссылке, поэтому он лежит у нас час под случайным номером
/** @param {Env} env @param {string} token @param {ArrayBuffer} buf @param {{ t: string, n: string }} meta */
export async function poOutPut(env, token, buf, meta) { await env.KV.put("pout:" + token, buf, { expirationTtl: 3600, metadata: meta }); }
/** @param {Env} env @param {string} token @returns {Promise<{ value: any, metadata: any } | null>} */
export async function poOutGet(env, token) { try { return await env.KV.getWithMetadata("pout:" + token, "arrayBuffer"); } catch (e) { return null; } }
