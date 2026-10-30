// @ts-check
// Green-API: HTTP-клиент (gaCall), коды и причины ошибок (gaCode, GA_HINT, gaWhy, gaKind), сведения о номере (gaInfo).
/** @import { Env } from "../../../lib/types.js" */
import { GA_BASE } from "../../../config/constants.js";
import { fmtPhone } from "../../../lib/phone.js";
import { gaSecret, gaHook } from "./webhook.js";

// запрос к Green-API → { ok, status, j, text }; status 0 — Green-API не ответил
/**
 * @param {any} r
 * @param {string} op
 * @param {any} [body]
 * @param {number} [ms]
 * @param {string} [query] после токена: «minutes=60» (журналы lastIncomingMessages / lastOutgoingMessages)
 * @returns {Promise<{ ok: boolean, status: number, j: any, text: string }>}
 */
export async function gaCall(r, op, body, ms = 15000, query = "") {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(`${String(r.base || GA_BASE).replace(/\/+$/, "")}/waInstance${r.id}/${op}/${r.token}${query ? "?" + query : ""}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal } : { signal: ac.signal });
    const text = await res.text().catch(() => "");
    let j = {}; try { j = JSON.parse(text) || {}; } catch (e) {}
    return { ok: res.ok, status: res.status, j: typeof j === "object" ? j : {}, text };
  } catch (e) { return { ok: false, status: 0, j: {}, text: "" }; }
  finally { clearTimeout(timer); }
}
// ответ Green-API → код причины (подсказки — в GA_HINT)
/** @param {any} x @returns {string} */
export function gaCode(x) {
  const s = x.status, t = String((x.j && x.j.message) || x.text || "");
  if (!s || s === 499) return "ga:net";
  if (s === 400) return /expired/i.test(t) ? "ga:expired" : /starting process/i.test(t) ? "ga:starting" : /not authorized/i.test(t) ? "ga:auth" : /deleted/i.test(t) ? "ga:deleted" : "ga:400";
  if ([401, 403, 429, 466].includes(s)) return "ga:" + s;
  return s >= 500 ? "ga:5xx" : "ga:" + s;
}
/** @type {Record<string, string>} */
export const GA_HINT = {
  "ga:net": "Green-API не ответил — дошло ли сообщение, неизвестно", "ga:401": "неверный токен Green-API", "ga:403": "неверный номер инстанса Green-API", "ga:429": "слишком частые запросы к Green-API",
  "ga:466": "закончился лимит тарифа Green-API (бесплатный тариф пишет только нескольким номерам) — оплатите тариф в кабинете Green-API",
  "ga:expired": "оплаченный срок инстанса Green-API закончился — оплатите его в кабинете Green-API", "ga:auth": "WhatsApp не привязан к Green-API — отсканируйте QR-код в кабинете Green-API",
  "ga:starting": "Green-API перезапускает инстанс", "ga:deleted": "инстанс Green-API удалён", "ga:400": "Green-API не принял номер или текст (неверные данные)", "ga:5xx": "временный сбой Green-API",
  "ga:noAccount": "у номера нет WhatsApp", "ga:failed": "WhatsApp не доставил сообщение"
};
// причина отказа человеческим языком, с именем переменной, которую нужно проверить
/** @param {any} res @param {any} r @returns {string} */
export const gaWhy = (res, r) => (GA_HINT[res.code] || `Green-API ответил ${res.status}${res.error ? ": " + res.error : ""}`) + (res.code === "ga:401" ? ` — проверьте секрет ${gaSecret(r, "GA_TOKEN")} в Cloudflare` : res.code === "ga:403" ? ` — проверьте ${gaSecret(r, "GA_ID")} и ${gaSecret(r, "GA_URL")} в Cloudflare` : "");
// сведения о номере: состояние, номер, настроен ли вебхук на этот бот (и на какой сайт) → { state, phone, hook, host, error }
/**
 * @param {Env} env
 * @param {any} r
 * @returns {Promise<any>}
 */
export async function gaInfo(env, r) {
  const [s, g] = await Promise.all([gaCall(r, "getStateInstance", null, 10000), gaCall(r, "getSettings", null, 10000)]);
  if (!s.ok) return { error: s.status === 401 || s.status === 403 ? `Green-API не пускает: ${gaWhy({ code: "ga:" + s.status }, r)}.` : "Green-API не отвечает — попробуйте через минуту." };
  const st = (g.ok && g.j) || {}, wid = String(st.wid || "").replace(/\D/g, "");
  let hook = false, host = "";
  try {
    const u = new URL(String(st.webhookUrl || "")), want = r.shared ? ["/ga", env.GA_HOOK || ""] : ["/ga/" + r.client, await gaHook(r)];
    hook = /^https?:$/.test(u.protocol) && u.pathname === want[0] && !!want[1] && u.searchParams.get("t") === want[1] && st.incomingWebhook === "yes"; host = hook ? u.host : "";
  } catch (e) {}
  return { state: String(s.j.stateInstance || ""), phone: wid ? fmtPhone(wid) : "", hook, host };
}

// как поступать с ошибкой Green-API: temp — подождать 10 минут (получатель в очереди), net — неизвестно, ушло ли (получатель не повторяется), one — дело в этом номере, stop — пауза
/** @param {string} code @returns {string} */
export const gaKind = code => code === "ga:net" ? "net" : ["ga:429", "ga:5xx", "ga:starting"].includes(code) ? "temp" : code === "ga:400" ? "one" : "stop";
