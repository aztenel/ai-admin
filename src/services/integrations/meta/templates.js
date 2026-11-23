// @ts-check
// Отправка шаблона Meta (рассылки): один вызов Graph API.
/** @import { Env } from "../../../lib/types.js" */
import { clean } from "../../../lib/text.js";
import { GRAPH } from "../../../config/constants.js";
import { waCreds } from "./client.js";
import { isPreview, PREVIEW_SEND } from "../../../lib/stage.js";

/** @param {any} t @param {any} [name] @param {any} [fallback] @returns {string} */
// слово после числа дней: 1 день, 3 дня, 5 дней, 21 день
/** @param {number} n */
export const daysWord = n => { const a = Math.abs(n) % 100, b = a % 10; return `${n} ${a >= 11 && a <= 14 ? "дней" : b === 1 ? "день" : b >= 2 && b <= 4 ? "дня" : "дней"}`; };
// подстановка в шаблон: {имя}, а для рассылки по базе Altegio ещё {мастер}, {услуга}, {дней} (сколько прошло с визита) — из строки базы
/** @param {any} t @param {any} [name] @param {any} [fallback] @param {{ staff?: any, svc?: any, days?: any }} [x] @returns {string} */
export const bcParam = (t, name, fallback, x) => clean(String(t).replace(/\{\s*(имя|name)\s*\}/gi, name || fallback || "клиент")
  .replace(/\{\s*мастер\s*\}/gi, String((x && x.staff) || "ваш мастер")).replace(/\{\s*услуга\s*\}/gi, String((x && x.svc) || "стрижка"))
  .replace(/\{\s*дней\s*\}/gi, x && Number.isFinite(+x.days) && +x.days > 0 ? daysWord(+x.days) : "несколько недель")
  .replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   "), 300) || "—"; // Meta не принимает пустые подстановки, переводы строк и 4+ пробела подряд
// шапка шаблона с медиа: вид — по расширению ссылки (видео mp4/3gp, документ pdf, иначе картинка). 23.11.2026: Кайрат — рекламный шаблон
// с коротким видео в шапке; вид шапки должен совпасть с одобренным шаблоном, иначе Meta откажет (132012)
/** @param {string} link */
export function headerMedia(link) {
  const path = String(link).split(/[?#]/)[0].toLowerCase();
  const kind = /\.(mp4|3gp)$/.test(path) ? "video" : /\.pdf$/.test(path) ? "document" : "image";
  return { type: "header", parameters: [{ type: kind, [kind]: { link } }] };
}

/**
 * @param {Env} env
 * @param {any} to
 * @param {any} b
 * @param {any} name
 * @param {any} route
 * @param {{ staff?: any, svc?: any, days?: any }} [x] данные строки базы для {мастер}, {услуга}, {дней}
 * @returns {Promise<{ ok: boolean, id?: string, status?: number, code?: number, error?: string }>}
 */
export async function sendTemplate(env, to, b, name, route, x) {
  if (isPreview(env)) return { ok: false, status: 409, code: 409, error: PREVIEW_SEND }; // черновик клиентам не пишет (lib/stage.js)
  const cr = waCreds(env, route), params = (b.params || []).map(/** @param {any} t */ t => ({ type: "text", text: bcParam(t, name, b.fallback, x) }));
  const comps = /** @type {any[]} */ ([]).concat(b.img ? [headerMedia(b.img)] : [], params.length ? [{ type: "body", parameters: params }] : []);
  let r;
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 15000);
  try {
    r = await fetch(`${GRAPH}/${cr.pnid}/messages`, { method: "POST", headers: { authorization: "Bearer " + cr.token, "content-type": "application/json" }, signal: ac.signal,
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name: b.tpl, language: { code: b.lang }, ...(comps.length ? { components: comps } : {}) } }) });
  } catch (e) { return { ok: false, code: 0, error: "Meta не ответила" }; } // ушло сообщение или нет — неизвестно
  finally { clearTimeout(timer); }
  if (r.ok) { let id = ""; try { id = String(((/** @type {any} */ (await r.json())).messages || [])[0]?.id || ""); } catch (e) {} return { ok: true, id }; }
  /** @type {any} */
  let e = {}; try { e = (await r.json()).error || {}; } catch (x) {}
  return { ok: false, status: r.status, code: +e.code || r.status, error: clean(e.message || "", 160) };
}
