// @ts-check
// Green-API: HTTP-клиент (gaCall), коды и причины ошибок (gaCode, GA_HINT, gaWhy, gaKind), сведения о номере (gaInfo).
/** @import { Env } from "../../../lib/types.js" */
import { GA_BASE } from "../../../config/constants.js";
import { fmtPhone } from "../../../lib/phone.js";
import { gaSecret, gaHook } from "./webhook.js";
import { PREVIEW_SEND } from "../../../lib/stage.js";

// На черновике (route.preview) Green-API только читаем: состояние, настройки, журналы, скачивание файла. Всё остальное — отправка,
// setSettings (вебхук настоящего номера ушёл бы на черновик), перезапуск — не уходит (аудит 31.10.2026, lib/stage.js).
const GA_READ = new Set(["getStateInstance", "getSettings", "downloadFile", "lastIncomingMessages", "lastOutgoingMessages", "getChatHistory", "getMessage"]);
/** @param {any} r @param {string} op */
const blocked = (r, op) => !!(r && r.preview) && !GA_READ.has(op);
const PREVIEW_RES = () => ({ ok: false, status: 409, j: { message: PREVIEW_SEND }, text: "", preview: true });

// запрос к Green-API → { ok, status, j, text }; status 0 — Green-API не ответил
/**
 * @param {any} r
 * @param {string} op
 * @param {any} [body]
 * @param {number} [ms]
 * @param {string} [query] после токена: «minutes=60» (журналы lastIncomingMessages / lastOutgoingMessages)
 * @returns {Promise<{ ok: boolean, status: number, j: any, text: string, preview?: boolean }>}
 */
export async function gaCall(r, op, body, ms = 15000, query = "") {
  if (blocked(r, op)) return PREVIEW_RES();
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(`${String(r.base || GA_BASE).replace(/\/+$/, "")}/waInstance${r.id}/${op}/${r.token}${query ? "?" + query : ""}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal } : { signal: ac.signal });
    const text = await res.text().catch(() => "");
    let j = {}; try { j = JSON.parse(text) || {}; } catch (e) {}
    return { ok: res.ok, status: res.status, j: typeof j === "object" ? j : {}, text };
  } catch (e) { return { ok: false, status: 0, j: {}, text: "" }; }
  finally { clearTimeout(timer); }
}
// Файлы Green-API принимает на отдельном хосте media: apiUrl https://1103.api.green-api.com → https://1103.media.green-api.com,
// https://api.green-api.com → https://media.green-api.com (кабинет Green-API показывает оба адреса рядом; вживую не проверено)
/** @param {string} [base] @returns {string} */
export function gaMediaBase(base) {
  try { const u = new URL(String(base || GA_BASE)); u.hostname = u.hostname.replace(/(^|\.)api\./, "$1media."); return u.origin; }
  catch (e) { return GA_BASE.replace("//api.", "//media."); }
}
// запрос к Green-API с файлом (multipart/form-data, например sendFileByUpload) → как у gaCall. Сам не повторяется: файл мог уйти,
// а второй раз клиент получил бы его дважды (CLAUDE.md §5.2). status 0 — Green-API не ответил (обрыв, срок вышел)
/** @param {any} r @param {string} op @param {FormData} form @param {number} [ms] @returns {Promise<{ ok: boolean, status: number, j: any, text: string, preview?: boolean }>} */
export async function gaUpload(r, op, form, ms = 60000) {
  if (blocked(r, op)) return PREVIEW_RES();
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(`${gaMediaBase(r.base)}/waInstance${r.id}/${op}/${r.token}`, { method: "POST", body: form, signal: ac.signal });
    const text = await res.text().catch(() => "");
    let j = {}; try { j = JSON.parse(text) || {}; } catch (e) {}
    return { ok: res.ok, status: res.status, j: typeof j === "object" ? j : {}, text };
  } catch (e) { return { ok: false, status: 0, j: {}, text: "" }; }
  finally { clearTimeout(timer); }
}
// Неизвестно, ушло ли сообщение: ответа нет, обрыв (499), срок (408), сбой у них (5xx), а ещё любой отказ, в котором Green-API вернул
// номер созданного сообщения (idMessage). Такую отправку сами не повторяем — она могла дойти (CLAUDE.md §5.2): доказать, что сообщение
// не принято, может только подтверждённый отказ (остальные 4xx без idMessage) — тогда «Повторить» можно (ревью PR №2, F3, 01.11.2026;
// 5xx в напоминаниях и рассылках — 01.11.2026, перед приёмкой Winchester)
/** @param {{ ok?: boolean, status: number, preview?: boolean, j?: any }} x */
export const gaUnsure = x => !x.ok && !x.preview && (!x.status || x.status === 408 || x.status === 499 || x.status >= 500 || !!(x.j && x.j.idMessage));
// причина «неизвестно» для переписки и журнала — коротко (до 80 знаков), без номеров. res — ответ sendGreen ({ status }) или gaCall
/** @param {{ status?: number }} res @returns {string} */
export function gaUnsureNote(res) {
  const s = Number((res && res.status) || 0);
  const what = !s ? "Green-API не ответил" : s === 408 ? "Green-API не дождался запроса (408)" : s === 499 ? "связь с Green-API оборвалась (499)"
    : s >= 500 ? `Green-API ответил ошибкой ${s}` : `Green-API ответил ${s}, но сообщение создал`;
  return what + ": сообщение могло уйти";
}
// ответ Green-API → код причины (подсказки — в GA_HINT)
/** @param {any} x @returns {string} */
export function gaCode(x) {
  if (x.preview) return "ga:preview";
  const s = x.status, t = String((x.j && x.j.message) || x.text || "");
  if (!s || s === 499 || s === 408) return "ga:net"; // ответа нет, обрыв (499) или срок вышел (408): дошло ли сообщение, неизвестно
  if (!x.ok && s < 500 && x.j && x.j.idMessage) return "ga:net"; // отказ, но с номером созданного сообщения — не доказано, что не ушло
  if (s === 400) return /expired/i.test(t) ? "ga:expired" : /starting process/i.test(t) ? "ga:starting" : /not authorized/i.test(t) ? "ga:auth" : /deleted/i.test(t) ? "ga:deleted" : "ga:400";
  if ([401, 403, 429, 466].includes(s)) return "ga:" + s;
  return s >= 500 ? "ga:5xx" : "ga:" + s;
}
/** @type {Record<string, string>} */
export const GA_HINT = {
  "ga:net": "Green-API не ответил — дошло ли сообщение, неизвестно", "ga:401": "неверный токен Green-API", "ga:403": "неверный номер инстанса Green-API", "ga:429": "слишком частые запросы к Green-API",
  "ga:466": "закончился лимит тарифа Green-API (бесплатный тариф пишет только нескольким номерам) — оплатите тариф в кабинете Green-API",
  "ga:expired": "оплаченный срок инстанса Green-API закончился — оплатите его в кабинете Green-API", "ga:auth": "WhatsApp не привязан к Green-API — отсканируйте QR-код в кабинете Green-API",
  "ga:starting": "Green-API перезапускает инстанс", "ga:deleted": "инстанс Green-API удалён", "ga:400": "Green-API не принял номер или текст (неверные данные)", "ga:5xx": "сбой у Green-API — дошло ли сообщение, неизвестно",
  "ga:noAccount": "у номера нет WhatsApp", "ga:failed": "WhatsApp не доставил сообщение", "ga:preview": "это тестовая версия, отсюда сообщения клиентам не отправляются"
};
// причина отказа человеческим языком, с именем переменной, которую нужно проверить
/** @param {any} res @param {any} r @returns {string} */
export const gaWhy = (res, r) => (GA_HINT[res.code] || `Green-API ответил ${res.status}${res.error ? ": " + res.error : ""}`) + (res.code === "ga:401" ? ` — проверьте секрет ${gaSecret(r, "GA_TOKEN")} в Cloudflare` : res.code === "ga:403" ? ` — проверьте ${gaSecret(r, "GA_ID")} и ${gaSecret(r, "GA_URL")} в Cloudflare` : "");
// сведения о номере: состояние, номер, настроен ли вебхук на этот бот → { state, phone, hook, host, other, error }.
// origin — адрес текущего Worker (откуда пришёл запрос). Вебхук «наш», только если совпадают и адрес (протокол, хост, порт), и путь,
// и пароль: у черновика и боевого сайта один токен, а значит, и один пароль — без сверки адреса вебхук, ведущий на черновик, боевой
// сайт считал своим, и «стоп» клиентов уходил мимо него (ревью PR №2, F2, 01.11.2026). other — куда вебхук ведёт вместо этого адреса.
// Без origin вебхук не подтверждается (hook: false).
/**
 * @param {Env} env
 * @param {any} r
 * @param {string} [origin]
 * @returns {Promise<any>}
 */
export async function gaInfo(env, r, origin) {
  const [s, g] = await Promise.all([gaCall(r, "getStateInstance", null, 10000), gaCall(r, "getSettings", null, 10000)]);
  if (!s.ok) return { error: s.status === 401 || s.status === 403 ? `Green-API не пускает: ${gaWhy({ code: "ga:" + s.status }, r)}.` : "Green-API не отвечает — попробуйте через минуту." };
  const st = (g.ok && g.j) || {}, wid = String(st.wid || "").replace(/\D/g, "");
  let hook = false, host = "", other = "";
  try {
    const u = new URL(String(st.webhookUrl || "")), want = r.shared ? ["/ga", env.GA_HOOK || ""] : ["/ga/" + r.client, await gaHook(r)];
    const ours = /^https?:$/.test(u.protocol) && u.pathname === want[0] && !!want[1] && u.searchParams.get("t") === want[1] && st.incomingWebhook === "yes";
    let here = false; try { here = !!origin && u.origin === new URL(origin).origin; } catch (e) { here = false; }
    hook = ours && here; host = hook ? u.host : ""; other = ours && !here ? u.host : "";
  } catch (e) {}
  return { state: String(s.j.stateInstance || ""), phone: wid ? fmtPhone(wid) : "", hook, host, other };
}

// как поступать с ошибкой Green-API: net — неизвестно, ушло ли (ответа нет, обрыв, срок, 5xx): получатель не повторяется; temp — Green-API
// точно не принял (429, перезапуск инстанса): подождать, получатель в очереди; one — дело в этом номере; stop — пауза. 5xx раньше был temp:
// сообщение, которое Green-API принял и ответил 500, напоминание через минуту, а рассылка через 10 минут отправляли второй раз (01.11.2026)
/** @param {string} code @returns {string} */
export const gaKind = code => code === "ga:net" || code === "ga:5xx" ? "net" : ["ga:429", "ga:starting"].includes(code) ? "temp" : code === "ga:400" ? "one" : "stop";
