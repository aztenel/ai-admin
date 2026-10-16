// @ts-check
// Wazzapo — официальный партнёр Meta (Tech Provider) из Казахстана: номер клиента подключён к WhatsApp Business API
// в режиме «сосуществование» (приложение WhatsApp Business на телефоне продолжает работать). Здесь только HTTP к их API.
// Почему так (15.10.2026): подключить старый номер к Meta, не отключая приложение на телефоне, Meta разрешает только своим партнёрам.
//
// Настройка клиента в Cloudflare — те же имена, что у Meta, плюс переключатель канала:
//   Text   WA_VIA_<ID>          = wazzapo
//   Secret WA_TOKEN_<ID>        = ключ API из кабинета Wazzapo (раздел API, начинается с wz_live_)
//   Secret APP_SECRET_<ID>      = секрет вебхука из кабинета Wazzapo (API → Вебхуки)
//   Text   PHONE_NUMBER_ID_<ID> = phone_number_id номера (кабинет Wazzapo или GET /phone-numbers)
// Вебхук в кабинете Wazzapo: https://<воркер>/wz/<id>, события message.incoming, message.outgoing, message.status.
/** @import { Env } from "../../../lib/types.js" */
import { clean } from "../../../lib/text.js";

export const WZ_BASE = "https://wazzapo.kz/api/v2/external";

// канал клиента — Wazzapo?
/** @param {Env} env @param {any} cid @returns {boolean} */
export const wzOn = (env, cid) => !!cid && String(env["WA_VIA_" + String(cid).toUpperCase()] || "").trim().toLowerCase() === "wazzapo";
/** @param {Env} env @returns {string} */
const base = env => String(env.WZ_URL || WZ_BASE).replace(/\/+$/, "");

/**
 * Один запрос к API Wazzapo с таймаутом. → { ok, status, j, text }
 * @param {Env} env @param {string} key @param {string} method @param {string} path @param {any=} body @param {number=} ms
 * @returns {Promise<{ ok: boolean, status: number, j: any, text: string }>}
 */
export async function wzCall(env, key, method, path, body, ms = 15000) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(base(env) + path, { method, signal: ac.signal, headers: { "x-api-key": key, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch (e) {}
    return { ok: r.ok, status: r.status, j, text };
  } catch (e) { return { ok: false, status: 0, j: null, text: String(e) }; }
  finally { clearTimeout(timer); }
}

// текст ошибки Wazzapo человеческим языком (коды из их документации, 15.10.2026)
/** @type {Record<string, string>} */
export const WZ_HINT = {
  401: "ключ API Wazzapo неверный, выключен или удалён — проверьте секрет WA_TOKEN_<ID>",
  404: "номер или шаблон не найден в кабинете Wazzapo — проверьте PHONE_NUMBER_ID_<ID> и название шаблона",
  429: "превышен предел запросов в минуту по тарифу Wazzapo",
  501: "этот способ отправки не поддерживается для номера",
  502: "Meta не приняла сообщение (часто: клиент писал больше 24 часов назад — свободным текстом писать нельзя)"
};

// Код ошибки Meta внутри ошибки Wazzapo. От него зависит решение: 131050 — человек запретил рекламу (больше не писать),
// 131031/131048 — ограничение номера (рассылки на паузу), 131047 — прошло 24 часа. Wazzapo может отдать свой код (502, «META_ERROR»),
// а код Meta — в отдельном поле или только в тексте: «(#131050) …». Формат в документации не описан (16.10.2026) — ищем везде
/** @param {any} e @param {any=} j @returns {number} */
export function metaCode(e, j) {
  const o = e && typeof e === "object" ? e : {}, top = j && typeof j === "object" ? j : {};
  for (const v of [o.meta_code, o.provider_code, o.error_code, o.error_data && o.error_data.code, o.meta && o.meta.code, top.meta_code, top.provider_code, o.code, top.code]) {
    const n = +(v || 0); if (Number.isInteger(n) && n >= 100 && n !== 400 && n !== 401 && n !== 403 && n !== 404 && n !== 429 && !(n >= 500 && n <= 599)) return n;
  }
  const t = [typeof e === "string" ? e : o.message || o.title || o.details || "", typeof top.error === "string" ? top.error : "", top.message || ""].join(" ");
  const m = /\(#(\d{3,6})\)|#(\d{3,6})\b|\b(13\d{4})\b/.exec(t);
  return m ? +(m[1] || m[2] || m[3]) : 0;
}

/**
 * Отправка сообщения: payload — как в документации Wazzapo (phone_number_id, to, type, text | template | image…).
 * → { ok, id, ids } или { ok: false, status, code, error }
 * @param {Env} env @param {string} key @param {Record<string, any>} payload
 * @returns {Promise<Record<string, any>>}
 */
export async function wzSend(env, key, payload) {
  const x = await wzCall(env, key, "POST", "/messages/send", payload);
  if (x.status === 0) return { ok: false, status: 0, code: 0, error: "Wazzapo не ответил" }; // ушло сообщение или нет — неизвестно
  const j = x.j || {};
  if (x.ok && j.status !== "failed" && j.status !== "error") {
    const ids = [j.message_id, j.provider_message_id, j.id].filter(Boolean).map(String);
    return { ok: true, id: ids[0] || "", ids };
  }
  const e = j.error && typeof j.error === "object" ? j.error : {};
  const code = metaCode(typeof j.error === "string" ? j.error : e, j) || +(e.code || j.code || x.status) || x.status;
  return { ok: false, status: x.status, code, error: clean(String(e.message || (typeof j.error === "string" ? j.error : "") || j.message || j.detail || x.text || ""), 200) };
}
