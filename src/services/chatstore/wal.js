// @ts-check
// Журнал событий Green-API на время записи переписки в D1 (01.11.2026). Вебхук отвечает Green-API «OK» сразу, а сообщение записывает
// уже после ответа — если D1 в эту минуту не ответила, сообщение пропало бы: Green-API его больше не пришлёт. Поэтому событие компании
// с переписками в D1 сначала кладётся в KV (ibq:<компания>:<номер события>), а после удачной записи убирается. Не записалось —
// остаётся и проигрывается снова (replay — мимо отметки «уже видели»): раз в минуту фоновой задачей, у стенда без неё — при запросах
// пульта и следующих вебхуках. Второй раз то же сообщение не появится: у него в D1 устойчивый ключ (номер сообщения у Green-API).
/** @import { Env } from "../../lib/types.js" */
import { CLIENTS } from "../../config/builtin-clients.js";
import { chatMode, chatStats, chatEnv } from "./index.js";

const TYPES = new Set(["incomingMessageReceived", "outgoingMessageReceived", "outgoingMessageStatus"]);
const KEEP = 3 * 86400;     // сколько живёт запись журнала
const WAIT = 45_000;        // моложе — ещё обрабатывается, не трогаем
const MAX_TRIES = 30;       // потом — сигнал владельцу, запись остаётся до срока
/** @param {Env} env */
const raw = env => { const w = /** @type {any} */ (env.KV); return (w && w.__chat && w.__chat.raw) || w; };

/** Записать событие в журнал до обработки. → ключ записи или null (журнал не нужен). @param {Env} env @param {string} cid @param {any} body */
export async function walOpen(env, cid, body) {
  if (!cid || chatMode(env, cid) !== "d1" || !body || !TYPES.has(body.typeWebhook)) return null;
  const id = String(body.idMessage || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  if (!id) return null;
  const kind = body.typeWebhook === "outgoingMessageStatus" ? "s" + String(body.status || "").slice(0, 12) : body.typeWebhook === "incomingMessageReceived" ? "in" : "out";
  const key = `ibq:${cid}:${id}:${kind}`;
  try { await raw(env).put(key, JSON.stringify({ at: Date.now(), n: 0, body }), { expirationTtl: KEEP }); return key; }
  catch (e) { console.log("wal open", String(e).slice(0, 120)); return null; }
}
/** Обработка закончилась: без сбоев записи переписки — убрать из журнала. @param {Env} env @param {string | null} key @param {number} failsBefore @param {boolean} threw */
export async function walClose(env, key, failsBefore, threw) {
  if (!key) return;
  const st = chatStats(env);
  if (threw || (st && st.fails > failsBefore)) return; // не записалось — останется в журнале и проиграется позже
  try { await raw(env).delete(key); } catch (e) { console.log("wal close", String(e).slice(0, 120)); }
}

const lastRun = new Map();
/** Проиграть события журнала, которые не записались (не чаще раза в минуту на компанию в экземпляре Worker).
 *  handle(body, env) — обработка события тем же кодом, что у вебхука (replay — без отметки «уже видели»).
 *  @param {Env} env @param {string} cid @param {(body: any, env: Env) => Promise<any>} handle @param {{ now?: number, force?: boolean }} [o]
 *  @returns {Promise<{ pending: number, done: number, failed: number }>} */
export async function walReplay(env, cid, handle, o = {}) {
  const now = o.now || Date.now(), out = { pending: 0, done: 0, failed: 0 };
  if (chatMode(env, cid) !== "d1") return out;
  if (!o.force && now - (lastRun.get(cid) || 0) < 60_000) return out;
  lastRun.set(cid, now);
  const kv = raw(env);
  let r; try { r = await kv.list({ prefix: `ibq:${cid}:`, limit: 200 }); } catch (e) { console.log("wal list", String(e).slice(0, 120)); return out; }
  for (const x of (r && r.keys) || []) {
    let v; try { v = JSON.parse((await kv.get(x.name)) || "null"); } catch (e) { v = null; }
    if (!v || !v.body) { try { await kv.delete(x.name); } catch (e) {} continue; }
    out.pending++;
    if (!o.force && now - (+v.at || 0) < WAIT) continue;
    const e2 = chatEnv(/** @type {Env} */ ({ ...env, KV: kv })), st = chatStats(e2), before = st ? st.fails : 0;
    let threw = false; try { await handle(v.body, e2); } catch (e) { threw = true; console.log("wal replay", String(e).slice(0, 120)); }
    if (!threw && !(st && st.fails > before)) { try { await kv.delete(x.name); out.done++; } catch (e) {} continue; }
    out.failed++;
    v.n = (+v.n || 0) + 1;
    try { await kv.put(x.name, JSON.stringify(v), { expirationTtl: KEEP }); } catch (e) {}
    if (v.n === MAX_TRIES) console.log("wal stuck", cid, x.name.slice(0, 60));
  }
  return out;
}
/** «Удалить данные клиента» (services/inbox/erase.js): события этого чата, ждущие записи, — тоже. В записи журнала — номер и текст
 *  сообщения; без этого после восстановления базы проигрыш вернул бы удалённое (находка проверки безопасности 01.11.2026).
 *  → сколько удалено. @param {Env} env @param {string} cid @param {string} digits номер чата цифрами */
export async function walForget(env, cid, digits) {
  if (!digits) return 0;
  const kv = raw(env);
  let r, n = 0; try { r = await kv.list({ prefix: `ibq:${cid}:`, limit: 1000 }); } catch (e) { console.log("wal forget", String(e).slice(0, 120)); return 0; }
  for (const x of (r && r.keys) || []) {
    let v; try { v = JSON.parse((await kv.get(x.name)) || "null"); } catch (e) { v = null; }
    const b = (v && v.body) || {}, chat = String((b.senderData && b.senderData.chatId) || b.chatId || "").replace(/\D/g, "");
    if (!v || chat === digits) { try { await kv.delete(x.name); n++; } catch (e) { console.log("wal forget", String(e).slice(0, 120)); } }
  }
  return n;
}
/** Сколько событий ждёт записи (для «Хранилищ»). @param {Env} env @param {string} cid */
export async function walPending(env, cid) {
  try { const r = await raw(env).list({ prefix: `ibq:${cid}:`, limit: 1000 }); return ((r && r.keys) || []).length; } catch (e) { return -1; }
}

// обработчик события — тот же, что у вебхука; его подключает controllers/webhooks/greenapi.js (сервис контроллеры не подключает)
/** @type {null | ((body: any, env: Env, cid: string) => Promise<any>)} */
let handler = null;
/** @param {(body: any, env: Env, cid: string) => Promise<any>} f */
export const walHandle = f => { handler = f; };
/** Фоновая задача раз в минуту: проиграть журнал у компаний с переписками в D1. @param {Env} env @param {number} now */
export async function walCron(env, now) {
  const h = handler;
  if (!h) return;
  for (const cid of Object.keys(CLIENTS)) {
    if (chatMode(env, cid) !== "d1") continue;
    try { await walReplay(env, cid, (body, e2) => h(body, e2, cid), { now }); } catch (e) { console.log("wal cron", String(e).slice(0, 120)); }
  }
}
/** Проиграть журнал компании сейчас (пульт стенда без фоновой задачи, следующий вебхук). @param {Env} env @param {string} cid @param {{ now?: number, force?: boolean }} [o] */
export async function walKick(env, cid, o = {}) {
  const h = handler;
  if (!h) return { pending: 0, done: 0, failed: 0 };
  return walReplay(env, cid, (body, e2) => h(body, e2, cid), o);
}
