// @ts-check
// Журнал событий Green-API на время записи переписки в D1 (01.11.2026). Вебхук отвечает Green-API «OK» сразу, а сообщение записывает
// уже после ответа — если D1 в эту минуту не ответила, сообщение пропало бы: Green-API его больше не пришлёт. Поэтому событие компании
// с переписками в D1 сначала кладётся в KV (ibq:<компания>:<номер события>), а после удачной записи убирается. Не записалось —
// остаётся и проигрывается снова (replay — мимо отметки «уже видели»): раз в минуту фоновой задачей, у стенда без неё — при запросах
// пульта и следующих вебхуках. Второй раз то же сообщение не появится: у него в D1 устойчивый ключ (номер сообщения у Green-API).
/** @import { Env } from "../../lib/types.js" */
import { CLIENTS } from "../../config/builtin-clients.js";
import { chatMode, chatStats, chatEnv, erasedAt } from "./index.js";

const TYPES = new Set(["incomingMessageReceived", "outgoingMessageReceived", "outgoingMessageStatus"]);
const KEEP = 3 * 86400;     // сколько живёт запись журнала — от прихода события; повторы срок не продлевают (отметка «данные удалены» живёт дольше — 4 дня)
const WAIT = 45_000;        // моложе — ещё обрабатывается, не трогаем
const MAX_TRIES = 30;       // потом — сигнал владельцу, запись остаётся до срока
/** @param {Env} env */
const raw = env => { const w = /** @type {any} */ (env.KV); return (w && w.__chat && w.__chat.raw) || w; };
/** Все ключи журнала компании — по страницам списка KV до конца (повторная проверка безопасности 01.11.2026: одной страницы мало).
 *  Список оборвался — ошибка, а не «часть»: удаление данных клиента не должно считаться законченным. @param {any} kv @param {string} cid @returns {Promise<string[]>} */
async function walKeys(kv, cid) {
  const out = [];
  for (let cursor, page = 0; page < 100; page++) {
    /** @type {any} */ const r = await kv.list({ prefix: `ibq:${cid}:`, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const x of (r && r.keys) || []) out.push(String(x.name));
    if (!r || r.list_complete || !r.cursor) return out;
    cursor = r.cursor;
  }
  throw new Error("журнал вебхуков слишком большой — дочитать не удалось");
}
/** номер чата события цифрами @param {any} b */
const chatOf = b => String((b && b.senderData && b.senderData.chatId) || (b && b.chatId) || "").replace(/\D/g, "");

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
  /** @type {string[]} */ let names; try { names = await walKeys(kv, cid); } catch (e) { console.log("wal list", String(e).slice(0, 120)); return out; }
  for (const name of names) {
    const x = { name };
    let v; try { v = JSON.parse((await kv.get(x.name)) || "null"); } catch (e) { v = null; }
    if (!v || !v.body) { try { await kv.delete(x.name); } catch (e) {} continue; }
    // старше срока журнала — не проигрываем (третья проверка безопасности 01.11.2026: иначе событие пережило бы отметку «данные удалены»)
    const ends = (+v.at || now) + KEEP * 1000;
    if (ends - now <= 60_000) { console.log("wal expired", x.name.slice(0, 60)); try { await kv.delete(x.name); } catch (e) {} continue; }
    // данные этого клиента удалили после того, как событие легло в журнал: в переписку его не возвращаем
    let er = 0; try { er = await erasedAt(env, cid, "ga", chatOf(v.body)); } catch (e) { console.log("wal erased", String(e).slice(0, 120)); continue; }
    if (er && er >= (+v.at || 0)) { try { await kv.delete(x.name); } catch (e) {} continue; }
    out.pending++;
    if (!o.force && now - (+v.at || 0) < WAIT) continue;
    const e2 = chatEnv(/** @type {Env} */ ({ ...env, KV: kv })), st = chatStats(e2), before = st ? st.fails : 0;
    let threw = false; try { await handle(v.body, e2); } catch (e) { threw = true; console.log("wal replay", String(e).slice(0, 120)); }
    if (!threw && !(st && st.fails > before)) { try { await kv.delete(x.name); out.done++; } catch (e) {} continue; }
    out.failed++;
    v.n = (+v.n || 0) + 1;
    try { await kv.put(x.name, JSON.stringify(v), { expiration: Math.floor(ends / 1000) }); } catch (e) {} // срок — прежний, от прихода события
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
  let n = 0;
  for (const name of await walKeys(kv, cid)) { // список не дочитался — ошибка наверх: удаление не закончено
    let v; try { v = JSON.parse((await kv.get(name)) || "null"); } catch (e) { v = null; }
    if (!v || chatOf(v.body) === digits) { await kv.delete(name); n++; }
  }
  return n;
}
/** Сколько событий ждёт записи (для «Хранилищ»). @param {Env} env @param {string} cid */
export async function walPending(env, cid) {
  try { return (await walKeys(raw(env), cid)).length; } catch (e) { return -1; }
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
