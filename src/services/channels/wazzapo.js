// @ts-check
// Канал WhatsApp через Wazzapo (официальный партнёр Meta). Для бота это тот же официальный канал Meta («wa»):
// вебхук Wazzapo перекладывается в формат вебхука Meta и идёт в общий обработчик — запись в Altegio, пауза бота,
// «стоп», пульт, напоминания и рассылки работают без отдельной ветки кода.
/** @import { Env } from "../../lib/types.js" */
import { wzOn, wzSend, wzCall, WZ_HINT } from "../integrations/wazzapo/client.js";
import { hash } from "../../lib/crypto.js";

export { wzOn };

// свои отправленные сообщения: Wazzapo присылает о них событие message.outgoing — его нельзя принять за ответ администратора с телефона
/** @param {Env} env @param {string[]} ids */
export async function wzMarkOwn(env, ids) {
  for (const id of ids || []) { try { await env.KV.put("wzout:" + id, "1", { expirationTtl: 3600 }); } catch (e) { console.log("wz own", String(e)); } }
}
/** @param {Env} env @param {string} id @returns {Promise<boolean>} */
async function isOwn(env, id) { try { return !!id && !!(await env.KV.get("wzout:" + id)); } catch (e) { return false; } }
// отметка по тексту ставится ДО отправки: событие message.outgoing может прийти раньше, чем Wazzapo ответит на отправку,
// и без id в ответе (или с другим id) бот принял бы свой ответ за ответ человека и замолчал на 2 часа
/** @param {string} to @param {string} text */
const ownKey = (to, text) => `wzt:${digits(to)}:${hash(String(text || "").trim())}`;
/** @param {Env} env @param {string} to @param {string} text @returns {Promise<boolean>} */
async function isOwnText(env, to, text) { try { return !!String(text || "").trim() && !!(await env.KV.get(ownKey(to, text))); } catch (e) { return false; } }

/**
 * Отправка через Wazzapo с отметкой «это сообщение бота». payload — как в документации Wazzapo.
 * @param {Env} env @param {string} key @param {Record<string, any>} payload
 */
export async function wzSendOwn(env, key, payload) {
  const body = payload.text && payload.text.body;
  if (body) { try { await env.KV.put(ownKey(payload.to, body), "1", { expirationTtl: 600 }); } catch (e) { console.log("wz own", String(e)); } }
  const r = await wzSend(env, key, payload);
  if (r.ok) await wzMarkOwn(env, r.ids || []);
  return r;
}

// кто отправил исходящее (поле sender.type): бот, рассылка, автоматика Wazzapo — не человек. Значения в документации не перечислены;
// всё остальное (оператор в кабинете, приложение на телефоне) — ответ человека: бот в этом чате замолкает
const BOT_SENDERS = /^(api|bot|integration|system|automation|workflow|broadcast|campaign|template|external)$/i;

/** @param {any} v @returns {string} */
const digits = v => String(v || "").replace(/\D/g, "");

// Удаление и правка сообщения клиентом. 16.10.2026, живой показ Winchester: бот ответил дважды — второй раз «Ничего страшного,
// если сообщение удалили» — и дважды «Передала администратору, он подтвердит отмену». Как Wazzapo присылает удаление и правку,
// в документации нет, поэтому отсекаем все правдоподобные виды: тип, флаг, служебный текст WhatsApp. Ответ бота на исходное
// сообщение уже ушёл; исправленный текст администратор видит в приложении WhatsApp Business на телефоне
const GONE_TYPE = /^(revoked|revoke|deleted?|protocol|unsupported|system|notification|edit|edited|message_edit|message_changed|reaction|ephemeral)$/i;
const GONE_TEXT = /^\W*(this message was deleted|you deleted this message|это сообщение (было )?удалено|сообщение (было )?удалено|вы удалили это сообщение|данное сообщение удалено|бұл хабарлама жойылды|хабарлама жойылды)\W*$/i;
/** @param {any} m @param {any} d @returns {boolean} */
const goneOrEdited = (m, d) => GONE_TYPE.test(String(m.type || "")) || !!(m.deleted || m.is_deleted || m.revoked || m.is_revoked || m.edited || m.is_edited || m.edited_at || d.deleted || d.edited)
  || (typeof m.text === "string" ? GONE_TEXT.test(m.text) : !!(m.text && GONE_TEXT.test(String(m.text.body || ""))));

// то же сообщение с другим id (тот же отправитель, тот же текст, то же время отправки): Wazzapo мог прислать его дважды — отвечаем один раз.
// Тот же текст в другое время («да» на два разных вопроса) — не повтор
/** @type {WeakMap<object, Map<string, number>>} */
const twinsOf = new WeakMap(); // память экземпляра Worker — отдельно для каждого хранилища (как в seenBefore)
/** @param {Env} env @param {any} m @param {string} from @returns {Promise<boolean>} */
async function twin(env, m, from) {
  const text = typeof m.text === "string" ? m.text : (m.text && m.text.body) || "";
  if (!m.timestamp || !text) return false;
  const k = `wzc:${from}:${String(m.timestamp).slice(0, 20)}:${hash(String(text))}`, now = Date.now(), twins = twinsOf.get(env.KV) || new Map();
  twinsOf.set(env.KV, twins);
  if ((twins.get(k) || 0) > now - 600e3) return true;
  if (twins.size > 5000) twins.clear();
  twins.set(k, now);
  try { if (await env.KV.get(k)) return true; await env.KV.put(k, "1", { expirationTtl: 3600 }); } catch (e) { console.log("wz twin", String(e)); }
  return false;
}

// сообщение Wazzapo → сообщение в формате Meta (как его ждёт handleWAMessage)
/** @param {any} m @param {string} from @returns {Record<string, any> | null} */
export function wzMsg(m, from) {
  if (!m || !m.id) return null;
  const type = String(m.type || "text").toLowerCase(), ts = String(m.timestamp || Math.floor(Date.now() / 1000));
  const text = typeof m.text === "string" ? m.text : (m.text && m.text.body) || m.body || "";
  if (type === "text") return { from, id: String(m.id), timestamp: ts, type: "text", text: { body: String(text) } };
  if (type === "button" || type === "interactive") return { from, id: String(m.id), timestamp: ts, type: "text", text: { body: String(text || (m.button && (m.button.text || m.button.payload)) || "") } };
  const kinds = ["audio", "voice", "image", "video", "document", "sticker", "location", "contacts"];
  if (kinds.includes(type)) {
    const o = m[type] && typeof m[type] === "object" ? m[type] : {};
    return { from, id: String(m.id), timestamp: ts, type, [type]: { id: String(o.id || m.media_id || ""), mime_type: String(o.mime_type || m.mime_type || ""), caption: String(o.caption || m.caption || text || "") } };
  }
  return { from, id: String(m.id), timestamp: ts, type, [type]: {} }; // реакции и прочее — общий обработчик их пропускает
}

/**
 * Событие вебхука Wazzapo → тело вебхука в формате Meta (или null — событие не для бота).
 * @param {Env} env @param {any} body
 * @returns {Promise<Record<string, any> | null>}
 */
export async function wzToMeta(env, body) {
  const ev = String((body && body.event) || ""), d = (body && body.data) || {};
  if (d.channel && String(d.channel).toLowerCase() !== "whatsapp") return null; // Telegram, Instagram, OLX и др. из кабинета Wazzapo бот не обслуживает
  const meta = { phone_number_id: String(d.phone_number_id || "") };
  const wrap = (/** @type {string} */ field, /** @type {any} */ value) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field, value: { messaging_product: "whatsapp", metadata: meta, ...value } }] }] });
  if (ev === "message.incoming") {
    const m = d.message || {}, from = digits(m.from || (d.contact && d.contact.phone));
    if (!from || goneOrEdited(m, d) || await twin(env, m, from)) return null;
    const msg = wzMsg({ ...m, id: m.id || d.message_id || d.provider_message_id }, from); // где лежит id, документация не уточняет: без id сообщение терялось бы
    return msg ? wrap("messages", { contacts: [{ wa_id: from, profile: { name: String((d.contact && d.contact.name) || "") } }], messages: [msg] }) : null;
  }
  if (ev === "message.outgoing") { // ответ человека — с телефона или из кабинета Wazzapo: в чат как ответ администратора, бот замолкает
    const m = d.message || {}, sender = d.sender || m.sender || {}, id = String(m.id || d.message_id || "");
    if (BOT_SENDERS.test(String(sender.type || ""))) return null;
    if (await isOwn(env, id) || (d.provider_message_id && await isOwn(env, String(d.provider_message_id)))) return null;
    const to = digits(m.to || (d.contact && d.contact.phone));
    if (!to) return null;
    const echo = wzMsg(m, digits(m.from)) || { type: "text", text: { body: "" } };
    if (echo.type === "text" && await isOwnText(env, to, echo.text.body)) return null;
    return wrap("smb_message_echoes", { message_echoes: [{ ...echo, to, id }] });
  }
  if (ev === "message.status") { // недоставленные — как статус failed у Meta (пометка в рассылках и сигнал администратору)
    const st = String(d.status || "").toLowerCase();
    if (!/^(failed|error|undelivered)$/.test(st)) return null;
    const e = d.error && typeof d.error === "object" ? d.error : { message: d.error };
    return wrap("messages", { statuses: [{ id: String(d.message_id || ""), status: "failed", recipient_id: digits(d.to || (d.contact && d.contact.phone)), errors: [{ code: +(e.code || 0), title: String(e.title || e.message || "не доставлено") }] }] });
  }
  return null;
}

// сведения о номере (качество, предел Meta) — как bcHealth для Meta. Поля ответа Wazzapo в документации не описаны: берём, что есть
/** @param {Env} env @param {string} key @param {string} pnid @returns {Promise<Record<string, any>>} */
export async function wzHealth(env, key, pnid) {
  if (!pnid) return { error: "Не указан PHONE_NUMBER_ID — номер в кабинете Wazzapo (раздел API → номера)." };
  const x = await wzCall(env, key, "GET", "/phone-numbers/" + encodeURIComponent(pnid));
  if (!x.ok) return { error: x.status ? `Wazzapo не отдал сведения о номере (ошибка ${x.status}${WZ_HINT[x.status] ? ": " + WZ_HINT[x.status] : ""}).` : "Wazzapo не отвечает — сведения о номере получить не удалось." };
  const j = (x.j && (x.j.data || x.j)) || {}, n = Array.isArray(j) ? j[0] || {} : j;
  const tier = String(n.messaging_limit_tier || n.messaging_limit || n.whatsapp_business_manager_messaging_limit || ""), m = /(?:TIER_)?(\d+)(K)?/i.exec(tier);
  return { phone: String(n.display_phone_number || n.phone || ""), name: String(n.verified_name || n.name || ""), quality: String(n.quality_rating || "").toUpperCase(), limit: /UNLIMITED/i.test(tier) ? -1 : m ? +m[1] * (m[2] ? 1000 : 1) : 0 };
}

// файл из чата (голосовое, фото): GET /media/{id}. Что отвечает Wazzapo — сам файл или ссылку на него, — в документации не сказано: понимаем оба
/** @param {Env} env @param {string} key @param {string} id @returns {Promise<Response | null>} */
export async function wzMedia(env, key, id) {
  const base = String(env.WZ_URL || "https://wazzapo.kz/api/v2/external").replace(/\/+$/, "");
  const r = await fetch(base + "/media/" + encodeURIComponent(id), { headers: { "x-api-key": key } });
  if (!r.ok) return null;
  if (!/json/i.test(r.headers.get("content-type") || "")) return r;
  const j = /** @type {any} */ (await r.json().catch(() => ({}))), u = String((j && (j.url || (j.data && j.data.url))) || "");
  if (!/^https:\/\//.test(u)) return null;
  const f = await fetch(u, { headers: { "x-api-key": key } });
  return f.ok ? f : null;
}

// номера в кабинете Wazzapo (GET /phone-numbers): чтобы владелец увидел phone_number_id на странице проверки запуска
/** @param {Env} env @param {string} key @returns {Promise<{ id: string, phone: string }[] | null>} */
export async function wzNumbers(env, key) {
  const x = await wzCall(env, key, "GET", "/phone-numbers");
  if (!x.ok) return null;
  const list = (x.j && (x.j.data || x.j.phone_numbers || x.j)) || [];
  return (Array.isArray(list) ? list : []).map((/** @type {any} */ n) => ({ id: String((n && (n.phone_number_id || n.id)) || ""), phone: String((n && (n.display_phone_number || n.phone)) || "") })).filter(n => n.id);
}
