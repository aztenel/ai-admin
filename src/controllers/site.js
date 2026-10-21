// @ts-check
// API онлайн-записи на сайте клиента: /api/site/<клиент>/<действие> — catalog, nearest, dates, times (GET) и book (POST).
// Сайт клиента статичный и лежит у другого хостинга (winchester.kz — hoster.kz), поэтому запросы идут с чужого источника:
// отвечаем только сайтам из настроек клиента (CORS с точным источником, без cookie). Порядок проверок:
//   клиент с блоком site → источник → предзапрос OPTIONS → действие и метод → режим (выключено) → предел чтения с адреса → обработчик.
// Любой сбой — ответ 500 с CORS здесь же: общий перехват (src/index.js) ответил бы без CORS, и браузер на сайте увидел бы
// «ошибку CORS» вместо понятного текста.
/** @import { Env } from "../lib/types.js" */
import { CLIENTS, hasClient } from "../config/builtin-clients.js";
import { jsonP, withCors } from "../lib/http.js";
import { logSafe } from "../lib/phone.js";
import { ipKey } from "../services/booking/limits.js";
import { siteConf, siteCatalog, siteNearest, siteDates, siteTimes, siteBook, fail } from "../services/sitebook/index.js";

const READ = new Set(["catalog", "nearest", "dates", "times"]), WRITE = new Set(["book"]);
const READ_MAX = 90, BODY_MAX = 4096;

// предел запросов с одного адреса (все действия сайта): в памяти экземпляра, 90 в минуту — форма делает несколько запросов на шаг,
// а перебор расписания скриптом нагрузил бы Altegio (у него 5 запросов в секунду на всех)
/** @type {Map<string, number[]>} */
const hits = new Map();
/** @param {string} ip @param {number} now @returns {number} 0 — можно, иначе через сколько секунд */
function readWait(ip, now) {
  const b = (hits.get(ip) || []).filter(t => now - t < 60e3);
  if (b.length >= READ_MAX) { hits.set(ip, b); return Math.max(1, Math.ceil((b[0] + 60e3 - now) / 1000)); }
  b.push(now); hits.set(ip, b);
  if (hits.size > 5000) hits.clear();
  return 0;
}

// тело запроса строкой, не длиннее max байт: по content-length или по мере чтения потока; длиннее — null (дальше не читаем).
// request.text() прочитал бы целиком тело любой длины, а длина строки — в знаках, не в байтах (проверка 21.10.2026)
/** @param {any} request @param {number} max @returns {Promise<string | null>} */
async function bodyText(request, max) {
  const len = request.headers.get("content-length");
  if (len !== null && !(+len <= max)) return null;
  if (!request.body) return "";
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
  return new TextDecoder().decode(all);
}

/** @param {any} request @param {Env} env @param {any} ctx @param {URL} url @returns {Promise<Response>} */
export async function siteApi(request, env, ctx, url) {
  const m = /^\/api\/site\/([^/]*)\/([^/]*)$/.exec(url.pathname), cid = m ? m[1] : "";
  const c = /^[a-z0-9_-]{1,40}$/.test(cid) && hasClient(cid) ? CLIENTS[cid] : null, conf = c ? siteConf(env, c) : null;
  /** @param {{ http: number, res: any }} o @param {string} [origin] @param {Record<string, string>} [extra] */
  const send = (o, origin, extra = {}) => { const r = jsonP(o.res, o.http); for (const [k, v] of Object.entries(extra)) r.headers.set(k, v); return origin ? withCors(r, origin) : r; };
  if (!m || !c || !conf) return send(fail("not_found", {})); // без CORS: чужим сайтам незачем знать, у кого запись есть
  const M = request.method === "HEAD" ? "GET" : request.method, origin = request.headers.get("origin") || "";
  if (origin ? !conf.origins.includes(origin) : M !== "GET") return send(fail("origin", conf)); // без Origin — только чтение (проверка ссылкой), запись — нет
  try {
    const act = m[2], known = READ.has(act) || WRITE.has(act);
    if (M === "OPTIONS") return known ? withCors(new Response(null, { status: 204, headers: { "cache-control": "no-store" } }), origin, true) : send(fail("not_found", conf), origin);
    if (!known) return send(fail("not_found", conf), origin);
    if (READ.has(act) ? M !== "GET" : M !== "POST") return send(fail("method", conf), origin, { allow: READ.has(act) ? "GET, HEAD, OPTIONS" : "POST, OPTIONS" });
    if (conf.mode === "off") return send(fail("off", conf), origin);
    const ip = String(request.headers.get("cf-connecting-ip") || ""), now = Date.now(), wait = readWait(ipKey(ip || "local"), now);
    if (wait) return send(fail("rate", conf, { retry: wait }), origin);
    const q = url.searchParams;
    if (act === "catalog") return send(await siteCatalog(env, c, conf, now), origin);
    if (act === "nearest") return send(await siteNearest(env, c, conf, now), origin);
    if (act === "dates") return send(await siteDates(env, c, conf, q, now), origin);
    if (act === "times") return send(await siteTimes(env, c, conf, q, now), origin);
    // book: тело не больше 4 КБ в байтах — длинное не дочитываем (и без content-length: передача по частям)
    const raw = await bodyText(request, BODY_MAX);
    const defer = ctx && typeof ctx.waitUntil === "function" ? /** @param {() => Promise<any>} f */ f => ctx.waitUntil(f()) : null;
    return send(await siteBook(env, c, conf, raw, { ip }, now, defer), origin);
  } catch (e) {
    console.log("site api", logSafe(String((e && /** @type {any} */ (e).stack) || e)).slice(0, 600));
    return send(fail("server", conf), origin);
  }
}
