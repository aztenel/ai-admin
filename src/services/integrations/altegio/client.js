// @ts-check
// Altegio: HTTP-вызов API (ключ разработчика + ключ пользователя), разбор ошибок и очистка текстов из Altegio.
/** @import { Env } from "../../../lib/types.js" */
import { clean } from "../../../lib/text.js";
import { ALT_API } from "../../../config/constants.js";

// названия и имена из Altegio попадают в подсказку ИИ и в служебные строки — убираем знаки, которые ломают их разбор
/** @param {any} s @param {number} [n] */
export const altText = (s, n = 80) => clean(String(s ?? "").replace(/[\[{<]/g, "(").replace(/[\]}>]/g, ")").replace(/;/g, ",").replace(/\|/g, "/")
  .replace(/(\d{1,2}):(\d{2})/g, "$1.$2").replace(/\s*:\s*/g, " — "), n);

/**
 * @param {number} status
 * @param {string} [message]
 * @param {any} [code]
 */
export function altError(status, message, code) { return Object.assign(new Error(message || ("Altegio " + status)), { status, code: +code || 0 }); }

/**
 * @param {Env} env
 * @param {string} method
 * @param {string} path
 * @param {any} [body]
 * @param {any} [user]
 * @returns {Promise<any>}
 */
export async function altCall(env, method, path, body, user) { // user — ключ пользователя салона (журнал записей, клиенты); без него — только онлайн-запись
  if (!env.ALTEGIO_PARTNER) throw altError(0, "не задан ключ ALTEGIO_PARTNER");
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController();
    let timer, /** @type {any} */ r, /** @type {any} */ txt;
    const req = (async () => {
      r = await fetch(ALT_API + path, { method, signal: ac.signal,
        headers: { authorization: "Bearer " + env.ALTEGIO_PARTNER + (user ? ", User " + user : ""), accept: "application/vnd.api.v2+json", "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined });
      txt = await r.text();
    })();
    req.catch(() => {});
    // срок общий — на ответ целиком, вместе с телом
    try { await Promise.race([req, new Promise((_, rej) => { timer = setTimeout(() => { ac.abort(); rej(new Error("timeout")); }, 8000); })]); }
    catch (e) { throw altError(0, "нет связи с Altegio"); }
    finally { clearTimeout(timer); }
    if (r.status === 429 && attempt === 0) { await new Promise(s => setTimeout(s, 1100)); continue; } // лимит запросов — одна повторная попытка
    let j = null;
    if (txt && txt.trim()) { try { j = JSON.parse(txt); } catch (e) { if (r.ok) throw altError(r.status, "Altegio ответил не в формате JSON"); } }
    if (!r.ok || (j && j.success === false)) {
      const m = (j && j.meta) || {};
      let er = m.errors ?? (j && j.errors); // бывает списком, объектом {code, message} или словарём «поле → ошибки»
      if (Array.isArray(er)) er = er[0];
      else if (er && typeof er === "object" && !("code" in er) && !("message" in er)) er = Object.values(er)[0];
      if (Array.isArray(er)) er = er[0];
      if (typeof er === "string") er = { message: er };
      if (!er || typeof er !== "object") er = {};
      throw altError(r.status, clean(er.message || m.message || "", 200) || ("Altegio " + r.status), er.code || m.code);
    }
    return j ? j.data : null;
  }
}
