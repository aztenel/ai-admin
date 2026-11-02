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
  ...(b.by ? { by: snip(b.by, 8) } : {}), ...(b.src ? { src: snip(b.src, 8) } : {}), ...(b.seg ? { seg: snip(b.seg, 60) } : {}), ...(b.tpl ? { tpl: snip(b.tpl, 60) } : {}),
  ...(b.tplId ? { tplId: snip(b.tplId, 16) } : {}), ...(b.approvedAt ? { approved: true } : {}), ...(b.demo ? { demo: 1 } : {}), ...(b.at ? { at: b.at } : {}) }); // tplId — текст библиотеки, approved — одобрил владелец (ТЗ v3.0), demo — рассылка демо-базы черновика
/** @param {Env} env @param {string} cid @param {Record<string, any>} b */
export const bcPut = (env, cid, b) => kvRetry(() => env.KV.put(bcKey(cid, b.id), JSON.stringify(b), { expirationTtl: 180 * 86400, metadata: bcMeta(b) }));
/** Строки списка рассылок компании из метаданных (без чтения каждой рассылки). @param {Env} env @param {string} cid @param {number} [limit] */
export async function bcList(env, cid, limit = 300) {
  const r = await env.KV.list({ prefix: `bc:${cid}:`, limit });
  return ((r && r.keys) || []).map((/** @type {any} */ k) => ({ id: String(k.name).split(":").pop(), ...(k.metadata || {}) }));
}
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
// кому рассылка со второго номера по базе ушла (или могла уйти): [цифры, когда, номер сообщения, статус] — для итогов рассылки
// (финальное ТЗ рассылок 02.11.2026: «записались после», «отказались»). bcs:<клиент>:<id>, 180 дней, как сама рассылка. Дописывает
// одна фоновая отправка (замок рассылки), по сообщению в минуту — гонок нет. Номера наружу не уходят: итоги — только числа
/** @param {Env} env @param {string} cid @param {string} id @returns {Promise<any[][]>} */
export const bcSentRead = async (env, cid, id) => { try { const v = JSON.parse((await env.KV.get(`bcs:${cid}:${id}`)) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
/** @param {Env} env @param {string} cid @param {string} id @param {any[][]} add */
export async function bcSentAdd(env, cid, id, add) {
  if (!add.length) return;
  // чтение не прочиталось или не разобралось — ошибка, а не пустой список: иначе запись поверх стёрла бы, кому уже ушло (находка проверки 02.11.2026)
  await kvRetry(async () => {
    const raw = await env.KV.get(`bcs:${cid}:${id}`), cur = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(cur)) throw new Error("bcs: не список");
    await env.KV.put(`bcs:${cid}:${id}`, JSON.stringify(cur.concat(add).slice(-5000)), { expirationTtl: 180 * 86400 });
  });
}
// удалить рассылку вместе со списком получателей (демо-база черновика: «Убрать демо-базу»)
/** @param {Env} env @param {string} cid @param {string} id @param {number} total */
export async function bcDrop(env, cid, id, total) {
  for (let k = 0; k * BC_CHUNK < Math.max(1, total); k++) await env.KV.delete(bcChunkKey(cid, id, k));
  await env.KV.delete(`bcs:${cid}:${id}`);
  await kvRetry(() => env.KV.delete(bcKey(cid, id)));
}
