// @ts-check
// Push-уведомления (ТЗ v2.0 §3, 31.10.2026), хранилище:
//   wp:<компания>:<отпечаток адреса подписки> — подписка устройства: адрес и ключи браузера, имя сотрудника, роль, настройки,
//     когда подписался и какой браузер (120 дней; пульт обновляет при каждом открытии);
//   push:vapid — ключи VAPID сервера, если их нет в переменных Cloudflare (создаются сами при первом push);
//   wpd:<компания>:<отпечаток события> — «уже отправляли» (10 минут): повтор вебхука не даёт второго уведомления.

const SUB_TTL = 120 * 86400, SEEN_TTL = 600;

/** @param {any} env @returns {Promise<any>} */
export async function pushVapidGet(env) { try { return JSON.parse((await env.KV.get("push:vapid")) || "null"); } catch (e) { return null; } }
/** @param {any} env @param {any} v */
export const pushVapidPut = (env, v) => env.KV.put("push:vapid", JSON.stringify(v));

/** Отпечаток адреса подписки (часть ключа KV): сам адрес в имени ключа не лежит. @param {string} endpoint */
export async function pushSubId(endpoint) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
  return [...d.slice(0, 12)].map(b => b.toString(16).padStart(2, "0")).join("");
}
/** @param {any} env @param {string} cid @param {string} id @returns {Promise<any>} */
export async function pushSubGet(env, cid, id) { try { return JSON.parse((await env.KV.get(`wp:${cid}:${id}`)) || "null"); } catch (e) { return null; } }
/** @param {any} env @param {string} cid @param {string} id @param {any} v */
export const pushSubPut = (env, cid, id, v) => env.KV.put(`wp:${cid}:${id}`, JSON.stringify(v), { expirationTtl: SUB_TTL });
/** @param {any} env @param {string} cid @param {string} id */
export const pushSubDel = (env, cid, id) => env.KV.delete(`wp:${cid}:${id}`);
/** Подписки компании (не больше max). → [{ id, ...подписка }] @param {any} env @param {string} cid @param {number} [max] */
export async function pushSubs(env, cid, max = 60) {
  const pre = `wp:${cid}:`, names = [];
  let cursor;
  do {
    /** @type {any} */
    const r = await env.KV.list({ prefix: pre, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const k of (r && r.keys) || []) names.push(String(k.name));
    cursor = r && !r.list_complete ? r.cursor : undefined;
  } while (cursor && names.length < max);
  const out = [];
  for (const n of names.slice(0, max)) {
    let v = null; try { v = JSON.parse((await env.KV.get(n)) || "null"); } catch (e) {}
    if (v && typeof v === "object") out.push({ ...v, id: n.slice(pre.length) });
  }
  return out;
}
/** Событие уже отправляли (за 10 минут)? Если нет — отмечает. @param {any} env @param {string} cid @param {string} key */
export async function pushSeen(env, cid, key) {
  const k = `wpd:${cid}:${key}`;
  if (await env.KV.get(k)) return true;
  await env.KV.put(k, "1", { expirationTtl: SEEN_TTL });
  return false;
}
