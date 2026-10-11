// @ts-check
// Ответы HTTP и проверка источника: html, json, jsonP, page (заголовки безопасности и CSP), forbid, sameOrigin.
/** @param {string} s @returns {Response} */
export function html(s) { return new Response(s, { headers: { "content-type": "text/html; charset=utf-8" } }); }
/** @param {any} o @param {number} [status] @returns {Response} */
export function json(o, status = 200) { return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
export function forbid() { return new Response("Forbidden: неверный ?key=", { status: 403 }); }
/** @param {any} o @param {number} [status] @returns {Response} */
export const jsonP = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
// запросы, которые что-то меняют, принимаем только со своей страницы (cookie сама по себе — не доказательство намерения)
/** @param {Request} request @param {URL} url @returns {boolean} */
export const sameOrigin = (request, url) => { const o = request.headers.get("origin"); return !o || o === url.origin; };
/** @param {string} body @param {number} [status] @param {Record<string, string>} [extra] @returns {Response} */
export function page(body, status = 200, extra = {}) { // страницы с личными данными: не кэшировать, не встраивать в чужие сайты, скрипты — только свои
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "same-origin", "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'", ...extra } }); // второй забор: даже если в страницу попадёт чужой текст, данные на чужой сайт не уйдут // referrer-policy: адрес страницы не уходит на чужие сайты, а своя форма входа по-прежнему присылает заголовок Origin
}
