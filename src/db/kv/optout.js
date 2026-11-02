// @ts-check
// «Стоп» в KV (этап 1, 31.10.2026): зеркало запрета optout:<компания>:<номер> (его читают бот, старые рассылки и напоминания),
// отметка syncerr:<компания>:<номер> — «стоп» записан в KV, а в D1 нет (дописывает фоновая починка), и состояние сверки «стопов»
// по журналу входящих Green-API stopsw:<компания>.

/** @param {any} env @param {string} ws @param {string} phone */
export const optoutGet = (env, ws, phone) => env.KV.get(`optout:${ws}:${phone}`);
/** @param {any} env @param {string} ws @param {string} phone @param {string} value */
export const optoutPut = (env, ws, phone, value) => env.KV.put(`optout:${ws}:${phone}`, value);
/** @param {any} env @param {string} ws @param {string} phone */
export const optoutDel = (env, ws, phone) => env.KV.delete(`optout:${ws}:${phone}`);

/** Все ключи с префиксом (постранично). → [{ name, value? }]; values — читать и значения. @param {any} env @param {string} prefix @param {boolean} [values] @param {number} [max] */
export async function kvKeys(env, prefix, values = false, max = 20000) {
  /** @type {{ name: string, value?: string|null }[]} */
  const out = [];
  let cursor;
  do {
    /** @type {any} */
    const r = await env.KV.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const k of (r && r.keys) || []) out.push({ name: String(k.name) });
    cursor = r && !r.list_complete ? r.cursor : undefined;
  } while (cursor && out.length < max);
  if (values) for (const k of out) k.value = await env.KV.get(k.name);
  return out;
}
/** Номера с «стопом» компании (для чтения «запрещено, если запрещено хоть где-то»). @param {any} env @param {string} ws */
export async function optoutPhones(env, ws) {
  return (await kvKeys(env, `optout:${ws}:`)).map(k => k.name.slice(`optout:${ws}:`.length)).filter(p => /^\d{8,15}$/.test(p));
}

/** @param {any} env @param {string} ws @param {string} phone @param {any} info */
export const syncerrPut = (env, ws, phone, info) => env.KV.put(`syncerr:${ws}:${phone}`, JSON.stringify(info), { expirationTtl: 30 * 86400 });
/** @param {any} env @param {string} key */
export const syncerrDel = (env, key) => env.KV.delete(key);

/** @param {any} env @param {string} ws */
export async function sweepGet(env, ws) { try { return JSON.parse((await env.KV.get(`stopsw:${ws}`)) || "null"); } catch (e) { return null; } }
/** @param {any} env @param {string} ws @param {any} st */
export const sweepPut = (env, ws, st) => env.KV.put(`stopsw:${ws}`, JSON.stringify(st), { expirationTtl: 30 * 86400 });
