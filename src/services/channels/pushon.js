// @ts-check
// Канал WhatsApp через Pushon (технический провайдер Meta). Для бота это тот же официальный канал Meta («wa»): вебхук Pushon
// перекладывается в формат вебхука Meta и идёт в общий обработчик — пульт, «стоп», «Нужен ответ», бот и итоги рассылок работают
// без отдельной ветки кода (так же сделан Wazzapo, services/channels/wazzapo.js).
// Исходящие эхо Pushon не присылает (только статусы): ответ человека из кабинета Pushon в пульт не попадает.
import { poOn } from "../integrations/pushon/client.js";

export { poOn };

/** @param {any} v @returns {string} */
const digits = v => String(v || "").replace(/\D/g, "");
/** ISO-время Pushon → секунды Unix (как у Meta) @param {any} ts @returns {string} */
const unix = ts => { const t = Date.parse(String(ts || "")); return String(Math.floor((Number.isFinite(t) ? t : Date.now()) / 1000)); };

// вид вложения Pushon → вид Meta (handleWAMessage)
/** @type {Record<string, string>} */
const KINDS = { image: "image", document: "document", audio: "audio", voice: "audio", video: "video", sticker: "sticker", location: "location", contacts: "contacts" };

/** входящее сообщение Pushon → сообщение в формате Meta, или null @param {any} m @returns {Record<string, any> | null} */
export function poMsg(m) {
  if (!m || !m.id || !m.from) return null;
  const from = digits(m.from), id = String(m.id), timestamp = unix(m.timestamp), kind = String(m.payload_type || m.type || "text").toLowerCase();
  // текст и нажатие кнопки быстрого ответа («Записаться», «Отписаться»): во вебхуке Pushon они описаны только как text — берём всё,
  // где есть слова (вид button / interactive / quick_reply — на случай, если Pushon пришлёт их отдельно)
  const text = typeof m.text === "string" ? m.text : (m.text && m.text.body) || (m.button && (m.button.text || m.button.payload)) || m.payload || "";
  if (kind === "text" || kind === "button" || kind === "interactive" || kind === "quick_reply") return text ? { from, id, timestamp, type: "text", text: { body: String(text) } } : null;
  if (KINDS[kind]) { const k = KINDS[kind]; return { from, id, timestamp, type: k, [k]: { id: String(m.mediaId || m.media_id || ""), mime_type: String(m.mime_type || ""), caption: String(m.caption || text || "") } }; }
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
