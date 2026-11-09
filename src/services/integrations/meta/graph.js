// @ts-check
// Обращение к Meta Graph API (план Meta, шаг 2, 09.11.2026): чтение metaGet и запись metaWrite — единственный путь к Graph у новых
// адаптеров номера, WABA и шаблонов (phone.js, waba.js, templates-api.js). Зачем отдельный слой:
// - срок ответа у каждого запроса: прежнее чтение номера (bcHealth) шло без срока, зависший Graph держал запрос пульта и фоновую задачу;
// - повтор — только у чтения и только при 429 и 5xx, один раз с паузой (CLAUDE.md §5.2). Запись не повторяется никогда: подача
//   шаблона или подписка приложения могли уже примениться, а ответ потерян — такой итог «неизвестно» (unsure), его решает вызвавший;
// - запись на черновике (STAGE=preview) не уходит вовсе — 409 preview, как смена вебхука Green-API (lib/stage.js): подача шаблона и
//   подписка приложения меняют настройки боевого номера, и необратимо;
// - ключ — только в заголовке authorization: адрес запроса попадает в журналы. Абсолютные адреса (paging.next у Graph несёт ключ в
//   access_token) metaGet не принимает — следующая страница строится по курсору after;
// - причина ошибки — русскими словами (why), текст Meta (error, user) — без ключа и с номерами под маской (logSafe): ответы Graph с
//   ошибкой бывают с номером получателя.
// Вживую не проверено: коды и тексты ошибок — по документации Meta, проверки — на заглушке test/meta.mjs.
/** @import { Env } from "../../../lib/types.js" */
import { GRAPH } from "../../../config/constants.js";
import { clean } from "../../../lib/text.js";
import { logSafe } from "../../../lib/phone.js";
import { isPreview, PREVIEW_HOOK } from "../../../lib/stage.js";
import { WA_HINT } from "./client.js";

export const META_MS = 8000, META_WRITE_MS = 15000, META_PAUSE = 300;

/**
 * Итог обращения к Graph. ok — j (тело ответа). Ошибка — status (0 — нет ответа), code (код Meta, иначе код ответа; строкой — наш:
 * notoken, nopnid, nowaba, badid, preview, method, path, badjson), sub (подкод Meta), error и user (текст Meta без ключа), why
 * (причина словами), unsure (только у записи: Meta могла выполнить запрос — повторять вслепую нельзя)
 * @typedef {{ ok: boolean, status: number, j?: any, code?: number | string, sub?: number, error?: string, user?: string, why?: string, unsure?: boolean }} MetaRes
 */
/** номер и ключ компании для адаптера (metaIds или waCreds): up — id компании заглавными, для имён переменных в причинах
 * @typedef {{ token: string, pnid?: string, waba?: string, up?: string }} MetaCreds */
/** @typedef {{ ms?: number, pause?: number, ctx?: "phone" | "waba" | "", up?: string, preview?: string }} MetaOpts */

/** ключ и access_token=… → «***», номера — маской (logSafe) @param {any} s @param {string} token */
const scrub = (s, token) => {
  let x = String(s ?? "");
  if (token && token.length >= 6) x = x.split(token).join("***");
  return logSafe(x.replace(/access_token=[^&\s"'<>]+/gi, "access_token=***"));
};
/** @param {any} e */
const isTimeout = e => !!e && (e.name === "TimeoutError" || e.name === "AbortError");
/** @param {number} ms */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RATE = new Set([4, 17, 32, 613, 80007, 80008, 130429]);
const TEMP = new Set([1, 2, 131000, 131016]);

/**
 * Причина ошибки Graph словами. ctx — что спрашивали (номер или WABA): «объект не найден» (100/33) Meta отвечает и на неверный id,
 * и на ключ без доступа к нему — причина называет переменную, которую стоит проверить
 * @param {number | string} code @param {{ status?: number, sub?: number, ctx?: string, up?: string, timeout?: boolean, ms?: number, user?: string }} [o]
 */
export function metaWhy(code, o = {}) {
  const U = "_" + (o.up || "<ID>"), user = o.user ? `: ${o.user}` : "";
  if (code === 0) return o.timeout ? `Meta не отвечает: нет ответа за ${Math.round((o.ms || META_MS) / 100) / 10} с` : "нет связи с Meta";
  if (code === "badjson") return "Meta не отвечает как обычно: ответ не разобрать";
  if (code === 190) return `ключ WA_TOKEN${U} не подошёл: ${WA_HINT[190]}`;
  if (code === 10 || code === 200) return `Meta не дала доступ (код ${code}): ${WA_HINT[code]}`;
  if (code === 100 && o.sub === 33) {
    if (o.ctx === "waba") return `Meta не нашла аккаунт WhatsApp Business: проверьте WABA_ID${U} и что ключ системного пользователя выдан на этот аккаунт`;
    if (o.ctx === "phone") return `Meta не нашла номер: проверьте PHONE_NUMBER_ID${U} и что ключ системного пользователя выдан на этот номер`;
    return "Meta не нашла объект: проверьте ID и права ключа";
  }
  if (code === 100) return o.ctx === "phone" ? `Meta ответила ошибкой 100: ${WA_HINT[100]}${user}` : `Meta не приняла запрос: неверный параметр (код 100)${user}`;
  if (typeof code === "number" && RATE.has(code)) return `слишком много запросов к Meta (код ${code}): ${WA_HINT[code] || "подождите и повторите позже"}`;
  if (typeof code === "number" && WA_HINT[code]) return `Meta ответила ошибкой ${code}: ${WA_HINT[code]}${user}`;
  if ((o.status || 0) >= 500 || (typeof code === "number" && TEMP.has(code))) return `временный сбой у Meta (${o.status ? "ответ " + o.status : "код " + code}) — повторите позже`;
  if (o.status === 429) return "слишком много запросов к Meta — подождите и повторите позже";
  return `Meta ответила ошибкой ${code}${user}`;
}

/** один запрос к Graph, без повторов. Сбой связи, срок и непонятное тело — status 0 или код ответа, code 0 / badjson
 * @param {string} token @param {string} method @param {string} path @param {any} body @param {number} ms */
async function call(token, method, path, body, ms) {
  const send = body !== undefined && body !== null;
  /** @type {Response} */ let r;
  try {
    r = await fetch(`${GRAPH}/${path}`, { method, headers: { authorization: "Bearer " + token, ...(send ? { "content-type": "application/json" } : {}) },
      ...(send ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(ms) });
  } catch (e) { return { ok: false, status: 0, code: /** @type {number|string} */ (0), timeout: isTimeout(e) }; }
  let text = "";
  try { text = await r.text(); } catch (e) { return { ok: false, status: r.ok ? 0 : r.status, code: r.ok ? 0 : r.status, timeout: isTimeout(e) }; } // тело оборвалось
  /** @type {any} */ let j = null;
  try { j = text ? JSON.parse(text) : {}; } catch (e) {}
  if (r.ok && j && typeof j === "object" && !j.error) return { ok: true, status: r.status, j };
  if (r.ok) return { ok: false, status: r.status, code: /** @type {number|string} */ ("badjson") };
  const e = (j && typeof j === "object" && j.error) || {};
  return { ok: false, status: r.status, code: /** @type {number|string} */ (+e.code || r.status), sub: +e.error_subcode || 0, msg: e.message, user: e.error_user_msg || e.error_user_title };
}

/** итог для вызвавшего: ошибка — без ключа, с причиной словами @param {any} raw @param {string} token @param {MetaOpts & { write?: boolean, ms: number }} o @returns {MetaRes} */
function finish(raw, token, o) {
  if (raw.ok) return { ok: true, status: raw.status, j: raw.j };
  const error = clean(scrub(raw.msg, token), 300), user = clean(scrub(raw.user, token), 300);
  /** @type {MetaRes} */
  const out = { ok: false, status: raw.status, code: raw.code, ...(raw.sub ? { sub: raw.sub } : {}), error, ...(user ? { user } : {}),
    why: metaWhy(raw.code, { status: raw.status, sub: raw.sub, ctx: o.ctx, up: o.up, timeout: raw.timeout, ms: o.ms, user }) };
  // запись: нет ответа, срок, 408, 499, 5xx и непонятное тело — Meta могла запрос выполнить
  if (o.write) out.unsure = raw.status === 0 || raw.status === 408 || raw.status === 499 || raw.status >= 500 || raw.code === "badjson";
  return out;
}

/** путь относительно версии Graph: без адреса целиком (paging.next несёт ключ) и без «..» @param {string} path */
const pathOk = path => typeof path === "string" && !!path && !/^[a-z][a-z0-9+.-]*:/i.test(path) && !path.startsWith("/") && !/(^|\/)\.\.(\/|\?|$)/.test(path.split("?")[0] + "?");

/** @param {string} code @param {string} why @param {number} [status] @returns {MetaRes} */
export const metaFail = (code, why, status = 0) => ({ ok: false, status, code, error: "", why });

/**
 * Чтение Graph: GET {GRAPH}/{path}, ключ заголовком, срок o.ms (8 с). 429 и 5xx — один повтор через o.pause мс; срок и обрыв связи не
 * повторяются (ожидание удвоилось бы, а пульт ждёт ответа).
 * @param {Env} env @param {string} token @param {string} path «900333?fields=…», «800333/message_templates?limit=100» @param {MetaOpts} [o]
 * @returns {Promise<MetaRes>}
 */
export async function metaGet(env, token, path, o = {}) {
  const ms = o.ms || META_MS;
  if (!token) return metaFail("notoken", `нет ключа Meta: задайте секрет WA_TOKEN_${o.up || "<ID>"}`);
  if (!pathOk(path)) return metaFail("path", "неверный адрес запроса к Meta");
  let raw = await call(token, "GET", path, undefined, ms);
  if (!raw.ok && (raw.status === 429 || raw.status >= 500)) {
    if (o.pause !== 0) await sleep(o.pause || META_PAUSE);
    raw = await call(token, "GET", path, undefined, ms);
  }
  return finish(raw, token, { ...o, ms });
}

/**
 * Запись в Graph (POST или DELETE) — подача шаблона, подписка приложения. На черновике — 409 preview, запрос не уходит. Без повтора:
 * ответ потерян — unsure (Meta могла выполнить), повторять — только после чтения (список шаблонов, подписанные приложения).
 * @param {Env} env @param {string} token @param {string} method @param {string} path @param {any} [body] @param {MetaOpts} [o]
 * @returns {Promise<MetaRes>}
 */
export async function metaWrite(env, token, method, path, body, o = {}) {
  const m = String(method || "").toUpperCase(), ms = o.ms || META_WRITE_MS;
  if (m !== "POST" && m !== "DELETE") return { ...metaFail("method", "запись в Meta — только POST или DELETE; чтение — metaGet"), unsure: false };
  if (isPreview(env)) { const t = o.preview || PREVIEW_HOOK; return { ok: false, status: 409, code: "preview", error: t, why: t, unsure: false }; }
  if (!token) return { ...metaFail("notoken", `нет ключа Meta: задайте секрет WA_TOKEN_${o.up || "<ID>"}`), unsure: false };
  if (!pathOk(path)) return { ...metaFail("path", "неверный адрес запроса к Meta"), unsure: false };
  return finish(await call(token, m, path, body, ms), token, { ...o, ms, write: true });
}

/**
 * Номер, WABA, ключ на месте и похожи на правду — до обращения к Graph. id — только цифры: значение подставляется в путь запроса
 * @param {any} ids @param {Array<"token" | "pnid" | "waba">} keys @returns {MetaRes | null}
 */
export function metaNeed(ids, keys) {
  const U = (ids && ids.up) || "<ID>";
  for (const k of keys) {
    const v = String((ids && ids[k]) || "");
    if (k === "token" && !v) return metaFail("notoken", `нет ключа Meta: задайте секрет WA_TOKEN_${U}`);
    if (k === "pnid" && !v) return metaFail("nopnid", `нет номера Meta: задайте PHONE_NUMBER_ID_${U} (WhatsApp Manager → номер → Phone number ID)`);
    if (k === "waba" && !v) return metaFail("nowaba", `нет ID аккаунта WhatsApp Business: задайте WABA_ID_${U} (WhatsApp Manager → настройки аккаунта)`);
    if (k !== "token" && !/^\d{1,32}$/.test(v)) return metaFail("badid", `${k === "pnid" ? "PHONE_NUMBER_ID" : "WABA_ID"}_${U} — должно быть число из кабинета Meta`);
  }
  return null;
}

/**
 * Узел Graph с полями (номер, WABA, список шаблонов). Поле, которого нет в этой версии API (код 100 «nonexisting field (x)»), убирается,
 * вместо него — запасное из o.alt, и запрос повторяется; поле не названо — следующая ступень o.ladder (как прежний bcHealth: новое
 * поле предела → старое → без предела). «Объект не найден» (100/33) и другие коды — сразу ошибка.
 * @param {Env} env @param {string} token @param {string} node @param {string[]} fields
 * @param {MetaOpts & { alt?: Record<string, string>, ladder?: string[][], query?: Record<string, string> }} [o]
 * @returns {Promise<MetaRes & { fields: string[] }>}
 */
export async function metaNode(env, token, node, fields, o = {}) {
  let f = fields.slice();
  const alt = { ...(o.alt || {}) }, ladder = (o.ladder || []).map(x => x.slice()), gone = new Set();
  const qs = o.query ? "&" + new URLSearchParams(o.query).toString() : "";
  /** @type {MetaRes} */ let r = metaFail("path", "");
  for (let i = 0; i < 6; i++) {
    r = await metaGet(env, token, `${node}?fields=${f.join(",")}${qs}`, o);
    if (r.ok || r.code !== 100 || r.sub === 33) break;
    const bad = (/nonexisting field \(([a-z_]+)\)/i.exec(r.error || "") || [])[1];
    /** @type {string[] | null} */ let next = null;
    if (bad && f.includes(bad)) {
      gone.add(bad); next = f.filter(x => x !== bad);
      const a = alt[bad]; delete alt[bad];
      if (a && !next.includes(a) && !gone.has(a)) next.push(a);
    } else {
      while (ladder.length && !next) { const s = /** @type {string[]} */ (ladder.shift()).filter(x => !gone.has(x)); if (s.length && s.join() !== f.join()) next = s; }
    }
    if (!next || !next.length) break;
    f = next;
  }
  return { ...r, fields: f };
}
