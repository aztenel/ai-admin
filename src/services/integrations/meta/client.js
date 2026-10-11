// @ts-check
// Адаптер Meta Cloud API: токен и номер клиента (waCreds), подсказки по кодам ошибок (WA_HINT), запись последней ошибки (waErr).
/** @import { Env } from "../../../lib/types.js" */
import { hasClient, CLIENTS } from "../../../config/builtin-clients.js";

// токен и номер, с которого отвечаем: у клиента со своим вебхуком (/wa/<id>) — его секрет WA_TOKEN_<ID> и номер, на который написали; иначе общие WA_TOKEN и PHONE_NUMBER_ID
/** @param {Env} env @param {any} [wx] */
export const waCreds = (env, wx) => {
  const cid = wx && wx.client, up = cid ? String(cid).toUpperCase() : "";
  return cid ? { token: env["WA_TOKEN_" + up] || "", pnid: (wx.pnid || env["PHONE_NUMBER_ID_" + up] || (hasClient(cid) && CLIENTS[cid].waPhoneId) || "") }
    : { token: env.WA_TOKEN || "", pnid: env.PHONE_NUMBER_ID || (wx && wx.pnid) || "" };
};
// коды ошибок Meta, которые встречаются на старте, — подсказка человеческим языком
/** @type {Record<string, string>} */
export const WA_HINT = {
  190: "токен истёк или неверный — временный токен живёт около суток, нужен постоянный токен системного пользователя",
  131030: "номер получателя не в списке тестового номера — API Setup → To → Manage phone number list",
  131047: "прошло больше 24 часов с последнего сообщения клиента — свободным текстом писать нельзя",
  133010: "номер не зарегистрирован в Cloud API — WhatsApp Manager → номер → Register",
  131031: "аккаунт WhatsApp Business ограничен Meta — проверьте Business Support Home",
  100: "неверный параметр — чаще всего не тот PHONE_NUMBER_ID"
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
  try { await env.KV.put("wa:lastErr", line, { expirationTtl: 7 * 86400 }); } catch (e) {}
}
