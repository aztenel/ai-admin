// @ts-check
// Адаптер Meta Cloud API: токен и номер клиента (waCreds), номер, WABA и ключ компании (metaIds), подсказки по кодам ошибок (WA_HINT),
// запись последней ошибки (waErr).
/** @import { Env } from "../../../lib/types.js" */
import { hasClient, CLIENTS } from "../../../config/builtin-clients.js";
import { varName } from "../../../config/env.js";
import { logSafe } from "../../../lib/phone.js";

// токен и номер, с которого отвечаем: у клиента со своим вебхуком (/wa/<id>) — его секрет WA_TOKEN_<ID> и номер, на который написали; иначе общие WA_TOKEN и PHONE_NUMBER_ID
/** @param {Env} env @param {any} [wx] */
export const waCreds = (env, wx) => {
  const cid = wx && wx.client, up = cid ? String(cid).toUpperCase() : "";
  return cid ? { token: env["WA_TOKEN_" + up] || "", pnid: (wx.pnid || env["PHONE_NUMBER_ID_" + up] || (hasClient(cid) && CLIENTS[cid].waPhoneId) || "") }
    : { token: env.WA_TOKEN || "", pnid: env.PHONE_NUMBER_ID || (wx && wx.pnid) || "" };
};
/**
 * Номер Meta компании для адаптеров Graph (план Meta, шаг 2, 09.11.2026): ключ WA_TOKEN_<ID>, номер PHONE_NUMBER_ID_<ID> (или
 * waPhoneId паспорта, как у waCreds), WABA_ID_<ID>, есть ли секрет приложения, через кого номер (WA_VIA_<ID>: wazzapo). Только
 * переменные этой компании: общих WA_TOKEN / PHONE_NUMBER_ID здесь нет — иначе компания без своего номера читала бы шаблоны и
 * сведения чужого. Ключ — неперечисляемое поле: адаптер берёт его как ids.token, а JSON.stringify(ids) и {...ids} его не содержат —
 * случайный ответ пульту или строка журнала с ids ключ не покажут.
 * @param {Env} env @param {string} cid
 * @returns {{ cid: string, up: string, pnid: string, waba: string, hasToken: boolean, hasSecret: boolean, via: string, token: string }}
 */
export function metaIds(env, cid) {
  const id = String(cid || ""), v = (/** @type {string} */ n) => String(env[varName(n, id)] || "").trim();
  const token = v("WA_TOKEN_<ID>");
  const ids = { cid: id, up: id.toUpperCase(), pnid: v("PHONE_NUMBER_ID_<ID>") || String((hasClient(id) && CLIENTS[id].waPhoneId) || ""), waba: v("WABA_ID_<ID>"),
    hasToken: !!token, hasSecret: !!v("APP_SECRET_<ID>"), via: v("WA_VIA_<ID>").toLowerCase() };
  Object.defineProperty(ids, "token", { value: token, enumerable: false });
  return /** @type {any} */ (ids);
}
// коды ошибок Meta, которые встречаются на старте, — подсказка человеческим языком
/** @type {Record<string, string>} */
export const WA_HINT = {
  190: "токен истёк или неверный — временный токен живёт около суток, нужен постоянный токен системного пользователя",
  131030: "номер получателя не в списке тестового номера — API Setup → To → Manage phone number list",
  131047: "прошло больше 24 часов с последнего сообщения клиента — свободным текстом писать нельзя",
  133010: "номер не зарегистрирован в Cloud API — WhatsApp Manager → номер → Register",
  131031: "аккаунт WhatsApp Business ограничен Meta — проверьте Business Support Home",
  100: "неверный параметр — чаще всего не тот PHONE_NUMBER_ID",
  // план Meta, шаг 2 (09.11.2026): список и подача шаблонов, сведения WABA — ключу нужно право whatsapp_business_management
  10: "у ключа нет нужного разрешения — системному пользователю нужны права whatsapp_business_messaging и whatsapp_business_management на этот аккаунт",
  200: "нет доступа — у ключа нет разрешения на это действие или на этот аккаунт WhatsApp Business",
  80008: "слишком много запросов к этому аккаунту WhatsApp Business — подождите и повторите позже"
};
/**
 * @param {Env} env
 * @param {string} where
 * @param {any} [code]
 * @param {any} [msg]
 * @param {any} [details]
 */
export async function waErr(env, where, code, msg, details) {
  const hint = WA_HINT[code] ? " → " + WA_HINT[code] : "";
  const line = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${where}: ${code || ""} ${msg || ""}${details ? " (" + String(details).slice(0, 150) + ")" : ""}${hint}`;
  try { await env.KV.put("wa:lastErr", logSafe(line), { expirationTtl: 7 * 86400 }); } catch (e) {} // строку видно на /diag: номер получателя скрыт
}
