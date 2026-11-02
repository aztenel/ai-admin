// @ts-check
// Ответы HTTP и проверка источника: html, json, jsonP, page (заголовки безопасности и CSP), csp, forbid, sameOrigin, withCors.
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
/**
 * Политика безопасности страниц (CSP): всё только со своего сайта. script — что ещё разрешить скриптам: по умолчанию встроенные
 * в страницу скрипты ('unsafe-inline'); новый пульт /app/ разрешает свой единственный встроенный скрипт по хэшу ('sha256-…').
 * @param {string} [script] @returns {string}
 */
export const csp = (script = "'unsafe-inline'") =>
  `default-src 'self'; script-src ${["'self'", script].filter(Boolean).join(" ")}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
/** @param {string} body @param {number} [status] @param {Record<string, string>} [extra] @returns {Response} */
export function page(body, status = 200, extra = {}) { // страницы с личными данными: не кэшировать, не встраивать в чужие сайты, скрипты — только свои
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "same-origin", "x-content-type-options": "nosniff",
    "content-security-policy": csp(), ...extra } }); // второй забор: даже если в страницу попадёт чужой текст, данные на чужой сайт не уйдут // referrer-policy: адрес страницы не уходит на чужие сайты, а своя форма входа по-прежнему присылает заголовок Origin
}
/** @param {string} s @returns {Response} */
export function text(s) { return new Response(s, { headers: { "content-type": "text/plain; charset=utf-8" } }); }
// CORS для API онлайн-записи на сайте клиента (/api/site/…, controllers/site.js): только точный разрешённый источник, без cookie
// (Allow-Credentials не ставим — данные и запись идут без входа). preflight — ответ на предзапрос OPTIONS: методы, заголовки, кэш на 10 минут
/** @param {Response} res @param {string} origin @param {boolean} [preflight] @returns {Response} */
export function withCors(res, origin, preflight = false) {
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", origin);
  h.append("vary", "Origin");
  if (preflight) { h.set("access-control-allow-methods", "GET, POST, OPTIONS"); h.set("access-control-allow-headers", "content-type"); h.set("access-control-max-age", "600"); }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

/**
 * Тело запроса байтами, но не больше max: читаем поток и обрываем на пределе (Content-Length может не прийти или солгать).
 * null — больше предела.
 * @param {Request} request @param {number} max @returns {Promise<Uint8Array | null>}
 */
export async function readCapped(request, max) {
  const len = request.headers.get("content-length");
  if (len !== null && !(+len <= max)) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader(), parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { try { await reader.cancel(); } catch (e) {} return null; }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.byteLength; }
  return all;
}
