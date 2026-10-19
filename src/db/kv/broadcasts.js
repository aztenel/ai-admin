// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Рассылки в KV: имена ключей, метаданные для списка, чтение и запись одной рассылки (сам запуск рассылок — в worker.js).
/** @import { Env } from "../../lib/types.js" */
import { snip } from "../../lib/text.js";
import { kvRetry } from "./retry.js";
import { BC_CHUNK } from "../../config/constants.js";

export const bcKey = /** @param {string} cid @param {string} id */ (cid, id) => `bc:${cid}:${id}`, bcChunkKey = /** @param {string} cid @param {string} id @param {string | number} k */ (cid, id, k) => `bcr:${cid}:${id}:${k}`;
// строка списка рассылок в пульте (/api/bc/list) — без чтения каждой рассылки. Кто создал (by: owner/staff/auto), откуда получатели
// (src: crm — база Altegio), сегмент и шаблон — новый пульт показывает их в истории (19.10.2026). Предел метаданных KV — 1024 байта:
// название, сегмент и шаблон обрезаются (шаблон может быть до 512 знаков)
/** @param {Record<string, any>} b */
export const bcMeta = b => ({ name: snip(b.name, 60), status: b.status, total: b.total, pos: b.pos, sent: b.sent, failed: b.failed, skipped: b.skipped, ...(b.excl ? { excl: b.excl } : {}), created: b.created, ...(b.ch ? { ch: b.ch } : {}),
  ...(b.by ? { by: snip(b.by, 8) } : {}), ...(b.src ? { src: snip(b.src, 8) } : {}), ...(b.seg ? { seg: snip(b.seg, 60) } : {}), ...(b.tpl ? { tpl: snip(b.tpl, 60) } : {}) });
/** @param {Env} env @param {string} cid @param {Record<string, any>} b */
export const bcPut = (env, cid, b) => kvRetry(() => env.KV.put(bcKey(cid, b.id), JSON.stringify(b), { expirationTtl: 180 * 86400, metadata: bcMeta(b) }));
/** @param {Env} env @param {string} cid @param {string} id */
export const bcGet = async (env, cid, id) => JSON.parse((await env.KV.get(bcKey(cid, id))) || "null");
// текст последней запущенной рассылки (bclast:<клиент>, 7 дней): его видят ИИ (клиент может ответить на рассылку) и администратор в пульте
/** @param {Env} env @param {string} cid @param {{ at: number, name: string, text: string }} v */
export const bcLastSave = (env, cid, v) => env.KV.put("bclast:" + cid, JSON.stringify(v), { expirationTtl: 7 * 86400 });
// получатели рассылки частями по BC_CHUNK (bcr:<клиент>:<id>:<k>), 180 дней — как сама рассылка
/** @param {Env} env @param {string} cid @param {string} id @param {any[]} list */
export async function bcChunksSave(env, cid, id, list) {
  for (let k = 0; k * BC_CHUNK < list.length; k++) await env.KV.put(bcChunkKey(cid, id, k), JSON.stringify(list.slice(k * BC_CHUNK, (k + 1) * BC_CHUNK)), { expirationTtl: 180 * 86400 });
}
