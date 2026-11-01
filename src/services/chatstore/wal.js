// @ts-check
// Журнал вебхуков на время записи переписки в D1 (01.11.2026). Вебхук отвечает провайдеру «OK» сразу, а сообщение записывает уже после
// ответа — если D1 в эту минуту не ответила, сообщение пропало бы: провайдер его больше не пришлёт. Поэтому событие компании с переписками
// в D1 сначала кладётся в KV (ibq:<компания>:<номер события>:<вид>), а после удачной записи убирается. Не записалось — остаётся и
// проигрывается снова (replay — мимо отметки «уже видели»): раз в минуту фоновой задачей, у стенда без неё — при запросах пульта и
// следующих вебхуках. Второй раз то же сообщение не появится: у него в D1 устойчивый ключ (номер сообщения у провайдера).
// Источники (src записи): ga — Green-API (второй номер); wa и wa0 — основной номер (с 01.11.2026): Meta своего номера компании (/wa/<id>)
// и Wazzapo (/wz/<id>: его события ложатся сюда уже в формате Meta), wa0 — общий номер Meta (POST /, WA_CLIENT). Обработчик каждого
// источника — тот же код, что у вебхука; его подключает контроллер вебхука (walHandle: сервис контроллеры не подключает).
/** @import { Env } from "../../lib/types.js" */
import { CLIENTS } from "../../config/builtin-clients.js";
import { chatMode, chatStats, chatEnv, erasedAt } from "./index.js";

const TYPES = new Set(["incomingMessageReceived", "outgoingMessageReceived", "outgoingMessageStatus"]);
const KEEP = 3 * 86400;     // сколько живёт запись журнала — от прихода события; повторы срок не продлевают (отметка «данные удалены» живёт дольше — 32 дня)
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
/** номер чата события Green-API цифрами @param {any} b */
const chatOf = b => String((b && b.senderData && b.senderData.chatId) || (b && b.chatId) || "").replace(/\D/g, "");
/** часть номера события в ключе KV @param {any} v */
const clip = v => String(v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
const dig = (/** @type {any} */ v) => String(v || "").replace(/\D/g, "");
const arr = (/** @type {any} */ v) => (Array.isArray(v) ? v : []);
/** @param {any} v запись журнала */
const srcOf = v => String((v && v.src) || "ga");

/** Часть уведомления Meta (и Wazzapo в формате Meta), которая пишется в переписку: сообщения клиентов (field messages → messages[]),
 *  ответы с телефона (smb_message_echoes) и история чатов (history). Отчёты о доставке и сигналы Meta переписку не пишут (только KV:
 *  счётчики рассылок, «стоп» из настроек WhatsApp) — сбой D1 их не теряет, в журнал они не идут. drop — без сообщений этих клиентов
 *  (удаление данных). → тело в формате Meta, номера сообщений (ins — входящие: у них отметка «уже видели»), номера чатов цифрами;
 *  null — писать в переписку нечего. @param {any} body @param {Set<string>} [drop]
 *  @returns {{ body: any, ids: string[], ins: string[], chats: string[] } | null} */
export function waPart(body, drop) {
  const keep = (/** @type {any} */ v) => !!dig(v) && !(drop && drop.has(dig(v)));
  /** @type {string[]} */ const ids = [], ins = [];
  /** @type {Set<string>} */ const chats = new Set();
  /** @type {any[]} */ const changes = [];
  for (const entry of arr(body && body.entry)) for (const ch of arr(entry && entry.changes)) {
    const val = (ch && ch.value) || {}, field = String((ch && ch.field) || "messages"), base = { messaging_product: val.messaging_product, metadata: val.metadata };
    if (field === "messages") {
      const msgs = arr(val.messages).filter(m => m && m.id && keep(m.from));
      if (!msgs.length) continue;
      for (const m of msgs) { ids.push(String(m.id)); ins.push(String(m.id)); chats.add(dig(m.from)); }
      const who = new Set(msgs.map(m => String(m.from)));
      changes.push({ field, value: { ...base, contacts: arr(val.contacts).filter(k => k && who.has(String(k.wa_id))), messages: msgs } });
    } else if (field === "smb_message_echoes") {
      const list = arr(val.message_echoes).filter(m => m && keep(m.to));
      if (!list.length) continue;
      for (const m of list) { if (m.id) ids.push(String(m.id)); chats.add(dig(m.to)); }
      changes.push({ field, value: { ...base, message_echoes: list } });
    } else if (field === "history") {
      const parts = arr(val.history).map(p => ({ ...p, threads: arr(p && p.threads).filter(th => th && keep(th.id)) })).filter(p => p.threads.length);
      if (!parts.length) continue;
      for (const p of parts) for (const th of p.threads) chats.add(dig(th.id));
      changes.push({ field, value: { ...base, history: parts } });
    }
  }
  return changes.length ? { body: { object: body.object, entry: [{ changes }] }, ids, ins, chats: [...chats] } : null;
}

/** Записать событие в журнал до обработки. → ключ записи или null (журнал не нужен). Журнал нужен, а KV не записал — ошибка: тогда вебхук
 *  обрабатывается сразу и отвечает провайдеру только после записи в базу (controllers/webhooks/greenapi.js, meta.js; проверка владельца 01.11.2026).
 *  src — источник: ga (тело Green-API), wa / wa0 (уведомление Meta; в журнал — только то, что пишется в переписку, waPart).
 *  @param {Env} env @param {string} cid @param {any} body @param {string} [src] */
export async function walOpen(env, cid, body, src = "ga") {
  if (!cid || chatMode(env, cid) !== "d1" || !body) return null;
  /** @type {string} */ let key;
  let saved = body;
  if (src === "ga") {
    if (!TYPES.has(body.typeWebhook)) return null;
    const id = clip(body.idMessage);
    if (!id) return null;
    const kind = body.typeWebhook === "outgoingMessageStatus" ? "s" + String(body.status || "").slice(0, 12) : body.typeWebhook === "incomingMessageReceived" ? "in" : "out";
    key = `ibq:${cid}:${id}:${kind}`;
  } else {
    const part = waPart(body);
    if (!part) return null;
    // у каждой доставки своя запись: Meta присылает одно и то же уведомление повторно («These retries can result in duplicate webhook
    // notifications»), и повтор, отсечённый отметкой «уже видели», с общим ключом убрал бы из журнала ещё не записанную первую доставку
    key = `ibq:${cid}:${clip(part.ids[0]) || "wa"}:w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    saved = part.body;
  }
  await raw(env).put(key, JSON.stringify({ at: Date.now(), n: 0, ...(src === "ga" ? {} : { src }), body: saved }), { expirationTtl: KEEP });
  return key;
}
/** Обработка закончилась: без сбоев записи переписки — убрать из журнала. @param {Env} env @param {string | null} key @param {number} failsBefore @param {boolean} threw */
export async function walClose(env, key, failsBefore, threw) {
  if (!key) return;
  const st = chatStats(env);
  if (threw || (st && st.fails > failsBefore)) return; // не записалось — останется в журнале и проиграется позже
  try { await raw(env).delete(key); } catch (e) { console.log("wal close", String(e).slice(0, 120)); }
}

/** Что из события ещё можно записать: данные клиента удалили после того, как событие легло в журнал, — в переписку его не возвращаем.
 *  У уведомления Meta — по каждому клиенту (в одном уведомлении бывают сообщения разных). → тело или null — записывать нечего.
 *  @param {Env} env @param {string} cid @param {any} v запись журнала */
async function notErased(env, cid, v) {
  const at = +v.at || 0;
  if (srcOf(v) === "ga") { const er = await erasedAt(env, cid, "ga", chatOf(v.body)); return er && er >= at ? null : v.body; }
  /** @type {Set<string>} */ const gone = new Set();
  for (const d of (waPart(v.body) || { chats: [] }).chats) { const er = await erasedAt(env, cid, "wa", d); if (er && er >= at) gone.add(d); }
  if (!gone.size) return v.body;
  const rest = waPart(v.body, gone);
  return rest ? rest.body : null;
}

const lastRun = new Map();
/** Проиграть события журнала, которые не записались (не чаще раза в минуту на компанию в экземпляре Worker). Каждое — обработчиком
 *  своего источника (walHandle): тем же кодом, что у вебхука, мимо отметки «уже видели».
 *  @param {Env} env @param {string} cid @param {{ now?: number, force?: boolean }} [o]
 *  @returns {Promise<{ pending: number, done: number, failed: number }>} */
export async function walReplay(env, cid, o = {}) {
  const now = o.now || Date.now(), out = { pending: 0, done: 0, failed: 0 };
  if (chatMode(env, cid) !== "d1") return out;
  if (!o.force && now - (lastRun.get(cid) || 0) < 60_000) return out;
  lastRun.set(cid, now);
  const kv = raw(env);
  /** @type {string[]} */ let names; try { names = await walKeys(kv, cid); } catch (e) { console.log("wal list", String(e).slice(0, 120)); return out; }
  for (const name of names) {
    let v; try { v = JSON.parse((await kv.get(name)) || "null"); } catch (e) { v = null; }
    if (!v || !v.body) { try { await kv.delete(name); } catch (e) {} continue; }
    // старше срока журнала — не проигрываем (третья проверка безопасности 01.11.2026: иначе событие пережило бы отметку «данные удалены»)
    const ends = (+v.at || now) + KEEP * 1000;
    if (ends - now <= 60_000) { console.log("wal expired", name.slice(0, 60)); try { await kv.delete(name); } catch (e) {} continue; }
    const handle = handlers.get(srcOf(v));
    if (!handle) { out.pending++; continue; } // обработчик этого источника не подключён — запись ждёт до срока
    // данные этого клиента удалили после того, как событие легло в журнал: в переписку его не возвращаем
    let body; try { body = await notErased(env, cid, v); } catch (e) { console.log("wal erased", String(e).slice(0, 120)); continue; }
    if (!body) { try { await kv.delete(name); } catch (e) {} continue; }
    out.pending++;
    if (!o.force && now - (+v.at || 0) < WAIT) continue;
    // данные этого события — с его прихода: удалили данные клиента позже (в том числе прямо во время проигрыша, в другом Worker) —
    // запись не пройдёт, проверка в той же пачке D1, что и запись (threadCommit, проверка владельца 01.11.2026)
    const e2 = chatEnv(/** @type {Env} */ ({ ...env, KV: kv }), { since: +v.at || now }), st = chatStats(e2), before = st ? st.fails : 0;
    let threw = false; try { await handle(body, e2, cid); } catch (e) { threw = true; console.log("wal replay", String(e).slice(0, 120)); }
    if (!threw && !(st && st.fails > before)) { try { await kv.delete(name); out.done++; } catch (e) {} continue; }
    out.failed++;
    v.n = (+v.n || 0) + 1; v.body = body;
    try { await kv.put(name, JSON.stringify(v), { expiration: Math.floor(ends / 1000) }); } catch (e) {} // срок — прежний, от прихода события
    if (v.n === MAX_TRIES) console.log("wal stuck", cid, name.slice(0, 60));
  }
  return out;
}
/** «Удалить данные клиента» (services/inbox/erase.js): события этого клиента, ждущие записи, — тоже. В записи журнала — номер и текст
 *  сообщения; без этого после восстановления базы проигрыш вернул бы удалённое (находка проверки безопасности 01.11.2026). По номеру
 *  клиента на любом номере компании — как заявки и согласия при удалении. Уведомление Meta с сообщениями нескольких клиентов
 *  остаётся без сообщений этого (срок записи — прежний). → сколько записей удалено или изменено.
 *  @param {Env} env @param {string} cid @param {string} digits номер чата цифрами */
export async function walForget(env, cid, digits) {
  if (!digits) return 0;
  const kv = raw(env), now = Date.now();
  let n = 0;
  for (const name of await walKeys(kv, cid)) { // список не дочитался — ошибка наверх: удаление не закончено
    let v; try { v = JSON.parse((await kv.get(name)) || "null"); } catch (e) { v = null; }
    if (!v || srcOf(v) === "ga") { if (!v || chatOf(v.body) === digits) { await kv.delete(name); n++; } continue; }
    const part = waPart(v.body);
    if (part && !part.chats.includes(digits)) continue;
    const rest = part && waPart(v.body, new Set([digits])), ends = (+v.at || now) + KEEP * 1000;
    if (!rest || ends - now <= 60_000) await kv.delete(name);
    else await kv.put(name, JSON.stringify({ ...v, body: rest.body }), { expiration: Math.floor(ends / 1000) });
    n++;
  }
  return n;
}
/** Сколько событий ждёт записи (для «Хранилищ»). @param {Env} env @param {string} cid */
export async function walPending(env, cid) {
  try { return (await walKeys(raw(env), cid)).length; } catch (e) { return -1; }
}

// обработчики событий — те же, что у вебхуков; их подключают controllers/webhooks/greenapi.js и meta.js (сервис контроллеры не подключает)
/** @type {Map<string, (body: any, env: Env, cid: string) => Promise<any>>} */
const handlers = new Map();
/** @param {string} src источник событий журнала (ga, wa, wa0) @param {(body: any, env: Env, cid: string) => Promise<any>} f */
export const walHandle = (src, f) => { handlers.set(src, f); };
/** Фоновая задача раз в минуту: проиграть журнал у компаний с переписками в D1. @param {Env} env @param {number} now */
export async function walCron(env, now) {
  if (!handlers.size) return;
  for (const cid of Object.keys(CLIENTS)) {
    if (chatMode(env, cid) !== "d1") continue;
    try { await walReplay(env, cid, { now }); } catch (e) { console.log("wal cron", String(e).slice(0, 120)); }
  }
}
/** Проиграть журнал компании сейчас (пульт стенда без фоновой задачи, следующий вебхук). @param {Env} env @param {string} cid @param {{ now?: number, force?: boolean }} [o] */
export async function walKick(env, cid, o = {}) {
  if (!handlers.size) return { pending: 0, done: 0, failed: 0 };
  return walReplay(env, cid, o);
}
