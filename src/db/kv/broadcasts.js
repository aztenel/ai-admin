// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Рассылки в KV: имена ключей, метаданные для списка, чтение и запись одной рассылки (сам запуск рассылок — в worker.js).
import { snip } from "../../lib/text.js";
import { kvRetry } from "./retry.js";

export const bcKey = (cid, id) => `bc:${cid}:${id}`, bcChunkKey = (cid, id, k) => `bcr:${cid}:${id}:${k}`;
export const bcMeta = b => ({ name: snip(b.name, 60), status: b.status, total: b.total, pos: b.pos, sent: b.sent, failed: b.failed, skipped: b.skipped, created: b.created, ...(b.ch ? { ch: b.ch } : {}) });
export const bcPut = (env, cid, b) => kvRetry(() => env.KV.put(bcKey(cid, b.id), JSON.stringify(b), { expirationTtl: 180 * 86400, metadata: bcMeta(b) }));
export const bcGet = async (env, cid, id) => JSON.parse((await env.KV.get(bcKey(cid, id))) || "null");
