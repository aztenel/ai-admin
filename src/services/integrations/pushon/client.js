// @ts-check
// Pushon (pushon365.kz) — технический провайдер Meta (через Gupshup / ODCEM): номер клиента подключён к WhatsApp Cloud API в его
// портфолио Meta, оплата сообщений — кредитная линия Pushon. API у Pushon свой (не Graph API Meta). Здесь только HTTP к их API.
// Почему так (15.11.2026): Winchester подключил новый номер через кабинет Pushon — портфолио на аккаунтах владельца были с ограничениями.
//
// Настройка клиента в Cloudflare — те же имена, что у Meta и Wazzapo, плюс переключатель канала:
//   Text   WA_VIA_<ID>          = pushon
//   Secret WA_TOKEN_<ID>        = API-ключ Pushon (заголовок x-api-key)
//   Text   PHONE_NUMBER_ID_<ID> = channelId канала в Pushon
//   Secret APP_SECRET_<ID>      = свой пароль вебхука (любая длинная строка): адрес вебхука в кабинете Pushon —
//                                 https://<воркер>/po/<id>?t=<APP_SECRET_<ID>>
// Документация — pushon365.kz/apipushon (сохранена 15.11.2026): send-session-message, send-template-message, вебхук
// { type: "message" | "status" }. Вживую не проверено: подпись вебхука, нажатия кнопок, файлы — в документации не описаны.
/** @import { Env } from "../../../lib/types.js" */
import { clean } from "../../../lib/text.js";
import { isPreview, PREVIEW_SEND } from "../../../lib/stage.js";

export const PO_BASE = "https://api.pushon365.ru/api/v1";

// канал клиента — Pushon?
/** @param {Env} env @param {any} cid @returns {boolean} */
export const poOn = (env, cid) => !!cid && String(env["WA_VIA_" + String(cid).toUpperCase()] || "").trim().toLowerCase() === "pushon";
/** @param {Env} env @returns {string} */
const base = env => String(env.PO_URL || PO_BASE).replace(/\/+$/, "");

// коды приложения Pushon → код ошибки Meta: по нему рассылки, напоминания и пульт уже решают, что делать
// (130429 — подождать; 190, 131031, 132001 — пауза рассылки; 100 — подстановки; 131047 — прошло 24 часа)
/** @type {Record<string, number>} */
const PO_META = { SESSION_WINDOW_CLOSED: 131047, RATE_LIMITED: 130429, UNAUTHORIZED: 190, FORBIDDEN: 131031, NOT_FOUND: 132001, BAD_REQUEST: 100 };
/** @type {Record<number, number>} */
const HTTP_META = { 400: 100, 401: 190, 403: 131031, 404: 132001, 429: 130429 };

// текст ошибки Pushon человеческим языком (по документации)
/** @type {Record<string, string>} */
export const PO_HINT = {
  401: "API-ключ Pushon неверный — проверьте секрет WA_TOKEN_<ID>",
  403: "ключ не привязан к каналу или канал отключён — проверьте PHONE_NUMBER_ID_<ID> (channelId) в кабинете Pushon",
  404: "канал или шаблон не найден в Pushon — шаблон должен быть одобрен и «подключён» к номеру",
  429: "превышен предел запросов Pushon",
  400: "Pushon не принял параметры (номер, язык, имя шаблона или подстановки)"
};

/**
 * Один POST к API Pushon с таймаутом. → { ok, status, j, text }
 * @param {Env} env @param {string} key @param {string} path @param {any} body @param {number=} ms
 * @returns {Promise<{ ok: boolean, status: number, j: any, text: string }>}
 */
export async function poCall(env, key, path, body, ms = 15000) {
  if (isPreview(env)) return { ok: false, status: 409, j: { status: "error", message: PREVIEW_SEND }, text: PREVIEW_SEND }; // черновик клиентам не пишет (lib/stage.js)
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(base(env) + path, { method: "POST", signal: ac.signal, headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body) });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch (e) {}
    return { ok: r.ok, status: r.status, j, text };
  } catch (e) { return { ok: false, status: 0, j: null, text: String(e) }; }
  finally { clearTimeout(timer); }
}

/** ответ Pushon → { ok, id } или { ok: false, status, code, error } (code — код Meta, где он понятен)
 * @param {{ ok: boolean, status: number, j: any, text: string }} x @returns {Record<string, any>} */
function poResult(x) {
  if (x.status === 0) return { ok: false, status: 0, code: 0, error: "Pushon не ответил" }; // ушло сообщение или нет — неизвестно
  const j = x.j || {};
  if (x.ok && String(j.status || "ok").toLowerCase() !== "error") return { ok: true, id: String(j.messageId || j.message_id || j.id || "") };
  const app = String(j.code || "").toUpperCase();
  const code = PO_META[app] || HTTP_META[x.status] || x.status;
  return { ok: false, status: x.status, code, error: clean(String(j.message || j.error || x.text || ""), 200) };
}

// номер получателя в формате Pushon: «+» и цифры
/** @param {any} to */
const phone = to => "+" + String(to || "").replace(/\D/g, "");

/** Текст в окне 24 часа (ответ клиенту); quote — номер сообщения, на которое это ответ (contextMessageId, коллекция Pushon 25.11.2026).
 * @param {Env} env @param {string} key @param {string} channel @param {string} to @param {string} text @param {string=} quote */
export const poSendText = async (env, key, channel, to, text, quote) =>
  poResult(await poCall(env, key, "/send-session-message", { toPhone: phone(to), text: String(text || "").slice(0, 4000), channelId: channel, ...(quote ? { contextMessageId: String(quote) } : {}) }));

/**
 * Файл в окне 24 часа (коллекция методов Pushon, 25.11.2026): файл Pushon скачивает сам по ссылке mediaUrl и загружает в WhatsApp;
 * text и mediaUrl вместе нельзя — текст при файле только подписью. Ждём дольше: скачивание и загрузка идут внутри запроса.
 * @param {Env} env @param {string} key @param {string} channel @param {string} to
 * @param {{ url: string, type: "image" | "video" | "audio" | "document", mime: string, name?: string, caption?: string, size?: number }} f @param {string=} quote
 */
export const poSendMedia = async (env, key, channel, to, f, quote) =>
  poResult(await poCall(env, key, "/send-session-message", { toPhone: phone(to), channelId: channel, mediaUrl: f.url, mediaType: f.type, mimeType: f.mime,
    ...(f.type === "document" && f.name ? { filename: String(f.name).slice(0, 200) } : {}), ...(f.caption && f.type !== "audio" ? { caption: String(f.caption).slice(0, 1024) } : {}),
    ...(f.size ? { fileSize: f.size } : {}), ...(quote ? { contextMessageId: String(quote) } : {}) }, 60000));

/**
 * Шаблон (рассылка, напоминание): components — как у Meta (body, header, button).
 * @param {Env} env @param {string} key @param {string} channel @param {string} to @param {string} name @param {string} lang @param {any[]} components
 */
export const poSendTemplate = async (env, key, channel, to, name, lang, components) =>
  poResult(await poCall(env, key, "/send-template-message", { toPhone: phone(to), channelId: channel, templateName: name, templateLanguage: lang || "ru", ...(components && components.length ? { components } : {}) }));
