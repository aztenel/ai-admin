// @ts-check
// Канал WhatsApp через Pushon (технический провайдер Meta). Для бота это тот же официальный канал Meta («wa»): вебхук Pushon
// перекладывается в формат вебхука Meta и идёт в общий обработчик — пульт, «стоп», «Нужен ответ», бот и итоги рассылок работают
// без отдельной ветки кода (так же сделан Wazzapo, services/channels/wazzapo.js).
// Исходящие эхо Pushon не присылает (только статусы): ответ человека из кабинета Pushon в пульт не попадает.
import { poOn } from "../integrations/pushon/client.js";
import { poLastSave, poLastRead, poFileSave, poFileRead } from "../../db/kv/inbox.js";
import { kvKey } from "../../lib/kv-id.js";
/** @import { Env } from "../../lib/types.js" */

export { poOn, poLastRead, poFileRead };

/** почему событие вебхука не стало сообщением или статусом (для «Проверки запуска»; без номеров и текстов)
 *  @param {any} body @param {string} channel @param {any} meta @returns {string} */
export function poWhy(body, channel, meta) {
  if (meta) return "";
  if (!body || typeof body !== "object") return "тело не JSON";
  const type = String(body.type || "");
  if (type === "message.outgoing") return "исходящее сообщение (не от клиента)";
  if (type === "message.incoming") return "входящее без отправителя (contactPhone) или номера сообщения";
  if (/^message\./.test(type)) return `событие «${type.slice(0, 40)}» без статуса доставлено/прочитано/ошибка или без номера сообщения`;
  if (type !== "message" && type !== "status") return `неизвестный вид события «${type.slice(0, 40) || "нет поля type"}»`;
  if (type === "message") {
    const m = body.message || {};
    if (String(body.direction || "inbound") !== "inbound") return "исходящее сообщение (не от клиента)";
    if (channel && m.channelId && String(m.channelId) !== channel) return "channelId сообщения не совпал с PHONE_NUMBER_ID";
    return "сообщение без отправителя или вида, который код понимает";
  }
  if (channel && body.channelId && String(body.channelId) !== channel) return "channelId статуса не совпал с PHONE_NUMBER_ID";
  return "статус без номера сообщения или неизвестный статус";
}
// запись «неверный пароль» — не чаще раза в минуту на компанию в экземпляре: иначе посторонний мог бы засыпать KV записями
/** @type {WeakMap<object, Map<string, number>>} */
const badAt = new WeakMap();
/** последнее событие вебхука @param {Env} env @param {string} cid @param {Record<string, any>} v */
export async function poNote(env, cid, v) {
  const now = Date.now();
  if (v.bad) { // память — по хранилищу (как seenBefore): у разных KV свой счёт
    const store = /** @type {object} */ (kvKey(env.KV) || env);
    let m = badAt.get(store); if (!m) { m = new Map(); badAt.set(store, m); }
    if (now - (m.get(cid) || 0) < 60e3) return;
    m.set(cid, now);
  }
  try { await poLastSave(env, cid, { at: now, ...v }); } catch (e) { console.log("po note", String(e)); }
}

// Файл от клиента через Pushon (22.11.2026: фото клиента не дошло до пульта — «Файл не сохранился»). Где Pushon кладёт файл, в
// документации нет: запоминаем «форму» последнего такого события — имена полей (и вложенных), у строк — ссылка ли это (только хост)
// и длина. Ни текста, ни номеров, ни самих ссылок.
/** @param {any} v @param {number} [depth] @returns {any} */
function shape(v, depth = 0) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") { const m = /^https?:\/\/([^/?#]+)/i.exec(v); return m ? "ссылка " + m[1].slice(0, 60) : /^\+?\d[\d\s()-]{6,}$/.test(v) ? "номер" : "строка " + v.length; }
  if (typeof v !== "object") return typeof v;
  if (depth > 2) return "объект";
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1)] : [];
  /** @type {Record<string, any>} */ const o = {};
  for (const k of Object.keys(v).slice(0, 25)) o[k.slice(0, 40)] = shape(v[k], depth + 1);
  return o;
}
/** событие вебхука — файл от клиента? Тогда запомнить его форму @param {Env} env @param {string} cid @param {any} body */
export async function poFileNote(env, cid, body) {
  const m = body && body.message && typeof body.message === "object" ? body.message : null;
  const kind = String((m && (m.messageType || m.type)) || "").toLowerCase();
  if (String(body && body.type) !== "message.incoming" || !m || !kind || kind === "text") return;
  try { await poFileSave(env, cid, { at: Date.now(), kind: kind.slice(0, 30), shape: shape({ ...body, contactPhone: undefined, contactName: undefined, channelPhone: undefined }) }); } catch (e) { console.log("po file", String(e)); }
}

/** @param {any} v @returns {string} */
const digits = v => String(v || "").replace(/\D/g, "");
/** ISO-время Pushon → секунды Unix (как у Meta) @param {any} ts @returns {string} */
const unix = ts => { const t = Date.parse(String(ts || "")); return String(Math.floor((Number.isFinite(t) ? t : Date.now()) / 1000)); };

// вид вложения Pushon → вид Meta (handleWAMessage)
/** @type {Record<string, string>} */
const KINDS = { image: "image", document: "document", audio: "audio", voice: "audio", video: "video", sticker: "sticker", location: "location", contacts: "contacts" };

// ссылка на файл из вебхука: только https на имя хоста (не IP, не localhost, без порта и логина) — пульт её потом скачивает сервером
/** @param {string} v */
const okLink = v => { try { const u = new URL(v); return u.protocol === "https:" && !u.port && !u.username && !u.password && /\.[a-z]{2,}$/i.test(u.hostname) && !/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname); } catch (e) { return false; } };
/** входящее сообщение Pushon → сообщение в формате Meta, или null @param {any} m @returns {Record<string, any> | null} */
export function poMsg(m) {
  if (!m || !m.id || !m.from) return null;
  const from = digits(m.from), id = String(m.id), timestamp = unix(m.timestamp), kind = String(m.payload_type || m.type || "text").toLowerCase();
  // текст и нажатие кнопки быстрого ответа («Записаться», «Отписаться»): во вебхуке Pushon они описаны только как text — берём всё,
  // где есть слова (вид button / interactive / quick_reply — на случай, если Pushon пришлёт их отдельно)
  const text = typeof m.text === "string" ? m.text : (m.text && m.text.body) || (m.button && (m.button.text || m.button.payload)) || m.payload || "";
  if (kind === "text" || kind === "button" || kind === "interactive" || kind === "quick_reply") return text ? { from, id, timestamp, type: "text", text: { body: String(text) } } : null;
  if (KINDS[kind]) {
    // файл клиента: Pushon кладёт ссылку на скачивание в text (ответ поддержки Pushon 22.11.2026: «передаётся ссылка, где надо файл
    // скачать»; других полей в событии нет). Ссылка — в m.link (пульт открывает файл по ней), остальной текст — подпись
    const k = KINDS[kind], raw = String(m.url || m.mediaUrl || m.link || m.fileUrl || "") || String(text || "");
    const found = (/https:\/\/[^\s<>"']+/i.exec(raw) || [""])[0], link = okLink(found) ? found : "", cap = String(m.caption || (text && !m.caption ? String(text).replace(link, "") : "")).trim();
    return { from, id, timestamp, type: k, [k]: { id: String(m.mediaId || m.media_id || ""), mime_type: String(m.mime_type || ""), caption: cap, ...(link ? { link: link.slice(0, 1000) } : {}) } };
  }
  return { from, id, timestamp, type: kind, [kind]: {} }; // реакции и прочее — общий обработчик их пропускает
}

/**
 * Событие вебхука Pushon → тело вебхука в формате Meta (или null — событие не для бота).
 * @param {any} body @param {string} channel channelId канала клиента: событие чужого канала того же ключа не принимаем
 * @returns {Record<string, any> | null}
 */
export function poToMeta(body, channel) {
  if (!body || typeof body !== "object") return null;
  const type = String(body.type || "");
  const wrap = (/** @type {string} */ field, /** @type {any} */ value) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field, value: { messaging_product: "whatsapp", metadata: { phone_number_id: channel }, ...value } }] }] });
  // Настоящий формат Pushon (живая проверка 21.11.2026, «Проверка запуска»): type «message.incoming» (и, видимо, «message.outgoing»,
  // «message.status»), поля верхнего уровня id, type, message, version, accountId, occurredAt, contactName, channelPhone, contactPhone;
  // в message — id, text, replyTo, direction, externalRef, messageType. Документация описывала другой вид (type «message»), он ниже
  if (/^message\./.test(type)) {
    const m = body.message && typeof body.message === "object" ? body.message : {};
    const ids = [m.externalRef, m.id, body.messageId].filter(Boolean).map(String), mid = ids.find(x => /^wamid\./.test(x)) || ids[0] || "";
    if (type === "message.incoming") {
      const msg = poMsg({ id: mid, from: body.contactPhone || m.from, payload_type: m.messageType || m.type || "text", text: m.text, caption: m.caption,
        mediaId: m.mediaId || m.media_id, mime_type: m.mimeType || m.mime_type, timestamp: body.occurredAt || m.timestamp });
      return msg ? wrap("messages", { contacts: [{ wa_id: msg.from, profile: { name: String(body.contactName || "") } }], messages: [msg] }) : null;
    }
    // статус исходящего: вид события («message.delivered») или поле status — доставлено, прочитано, ошибка («отправлено» Pushon не шлёт)
    const st = String(body.status || m.status || type.slice(8)).toLowerCase().replace(/^delivery$/, "delivered");
    if (/^(sent|delivered|read|failed|error)$/.test(st) && mid) {
      const ok = st === "error" ? "failed" : st, er = body.error || m.error, e = er && typeof er === "object" ? er : er ? { message: String(er) } : null;
      return wrap("messages", { statuses: [{ id: mid, status: ok, timestamp: unix(body.occurredAt), recipient_id: digits(body.contactPhone),
        ...(ok === "failed" ? { errors: [{ code: +((e && e.code) || 0) || 0, title: String((e && (e.title || e.message)) || "не доставлено") }] } : {}) }] });
    }
    return null; // исходящие (наши же и из кабинета Pushon) и прочее — боту не нужны
  }
  if (type === "message") {
    const m = body.message || {};
    if (String(body.direction || "inbound") !== "inbound") return null;
    if (channel && m.channelId && String(m.channelId) !== channel) return null;
    const msg = poMsg({ ...m, timestamp: m.timestamp || body.timestamp });
    return msg ? wrap("messages", { contacts: [{ wa_id: msg.from, profile: { name: String(m.name || m.profileName || "") } }], messages: [msg] }) : null;
  }
  if (type === "status") {
    if (channel && body.channelId && String(body.channelId) !== channel) return null;
    const st = String(body.status || "").toLowerCase();
    if (!/^(sent|delivered|read|failed)$/.test(st) || !body.messageId) return null;
    const e = body.error && typeof body.error === "object" ? body.error : body.error ? { message: String(body.error) } : null;
    return wrap("messages", { statuses: [{ id: String(body.messageId), status: st, timestamp: unix(body.timestamp), recipient_id: digits(body.to),
      ...(st === "failed" ? { errors: [{ code: +((e && e.code) || 0) || 0, title: String((e && (e.title || e.message)) || "не доставлено") }] } : {}) }] });
  }
  return null;
}
