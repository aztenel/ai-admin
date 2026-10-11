// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Рассылки в KV: имена ключей, метаданные для списка, чтение и запись одной рассылки (сам запуск рассылок — в worker.js).
/** @import { Env } from "../../lib/types.js" */
import { snip } from "../../lib/text.js";
import { kvRetry } from "./retry.js";

export const bcKey = /** @param {string} cid @param {string} id */ (cid, id) => `bc:${cid}:${id}`, bcChunkKey = /** @param {string} cid @param {string} id @param {string | number} k */ (cid, id, k) => `bcr:${cid}:${id}:${k}`;
/** @param {Record<string, any>} b */
export const bcMeta = b => ({ name: snip(b.name, 60), status: b.status, total: b.total, pos: b.pos, sent: b.sent, failed: b.failed, skipped: b.skipped, created: b.created, ...(b.ch ? { ch: b.ch } : {}) });
/** @param {Env} env @param {string} cid @param {Record<string, any>} b */
export const bcPut = (env, cid, b) => kvRetry(() => env.KV.put(bcKey(cid, b.id), JSON.stringify(b), { expirationTtl: 180 * 86400, metadata: bcMeta(b) }));
/** @param {Env} env @param {string} cid @param {string} id */
export const bcGet = async (env, cid, id) => JSON.parse((await env.KV.get(bcKey(cid, id))) || "null");
