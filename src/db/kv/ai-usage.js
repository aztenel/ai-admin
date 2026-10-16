// @ts-check
// Расходы на ИИ в KV: один ключ на бизнес и день — aiu:<клиент>:<YYYY-MM-DD> = { n, in, out, usd, m: { модель: ответов } }.
// Счёт приблизительный: два ответа в одну секунду могут потерять один прибавок (KV не атомарен) — для оценки расходов этого хватает.
import { kvRetry } from "./retry.js";

/** @param {string} client @param {string} day */
const key = (client, day) => `aiu:${client}:${day}`;

/** @param {any} store @param {string} client @param {string} day @param {{ in: number, out: number, usd: number, model: string }} d */
export async function addUsage(store, client, day, d) {
  return kvRetry(async () => {
    const u = JSON.parse((await store.get(key(client, day))) || "null") || { n: 0, in: 0, out: 0, usd: 0, m: {} };
    u.n++; u.in += d.in; u.out += d.out; u.usd = Math.round((u.usd + d.usd) * 1e6) / 1e6; u.m[d.model] = (u.m[d.model] || 0) + 1;
    await store.put(key(client, day), JSON.stringify(u), { expirationTtl: 120 * 86400 });
  });
}
/** @param {any} store @param {string} client @param {string} day @returns {Promise<{ n: number, in: number, out: number, usd: number, m: Record<string, number> } | null>} */
export async function readUsage(store, client, day) { return JSON.parse((await store.get(key(client, day))) || "null"); }
