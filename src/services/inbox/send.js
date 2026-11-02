// @ts-check
// Отправка из пульта со второго номера (Green-API), «Полноценные чаты» P0 (31.10.2026): файлы (sendFileByUpload), ответ на
// конкретное сообщение (цитата), защита от двойной отправки по rid.
// Правило CLAUDE.md §5.2: отправку, на которую не пришёл ответ (обрыв, срок, 5xx), сами не повторяем — сообщение могло уйти.
// Реплика остаётся со статусом «unknown», сотрудник проверяет в WhatsApp. Официальный номер (Meta) и чат сайта файлов из пульта
// не отправляют: у них этого нет, и пульт не делает вид, что есть.
/** @import { Env } from "../../lib/types.js" */
import { clean, snip } from "../../lib/text.js";
import { logSafe } from "../../lib/phone.js";
import { gaRoute } from "../integrations/greenapi/webhook.js";
import { gaUpload, gaCode, gaWhy, gaUnsure, edgeMiss } from "../integrations/greenapi/client.js";
import { sendMarkGet, sendMarkPut, sendMarkDrop } from "../../db/kv/inbox.js";
import { d1Ready, d1Status } from "../../db/d1/status.js";
import { claimSend, finishSend, releaseSend, sendTableReady } from "../../db/d1/sends.js";
import { RISKY, fileName } from "./media.js";

export const FILE_MAX = 25 * 1024 * 1024;
export const UNKNOWN_SENT = "Не знаем, ушло ли сообщение. Проверьте в WhatsApp, прежде чем отправлять ещё раз.";
export const NO_FILES = "С этого номера файлы из пульта не отправляются.";
export const TOO_BIG = "Файл больше 25 МБ. Уменьшите его или отправьте с телефона.";
export const QUOTE_GONE = "Сообщение, на которое вы отвечаете, не найдено в переписке. Обновите переписку.";
export const BUSY = "Это сообщение уже отправляется. Обновите переписку через минуту.";
export const NO_RID = "Обновите страницу пульта: у сообщения нет номера отправки, поэтому оно не отправлено.";
export const NO_DB = "Отправка со второго номера сейчас недоступна: не отвечает база, которая защищает от двойной отправки. Сообщение не отправлено, попробуйте через минуту.";
// база есть, но без таблицы отметок (миграция 0005) или к адресу не подключена — это настройка сайта, а не сбой связи (ревью PR №2, F1)
export const NO_SETUP = "Отправка со второго номера не настроена: у сайта нет базы, которая защищает от двойной отправки. Сообщение не отправлено. Сообщите тому, кто настраивает сайт.";
// отметка попытки могла записаться, а ответ базы потерялся и освободить её не удалось (ревью PR №2, F7): до Green-API запрос не дошёл,
// но повтор с тем же номером может пару минут отвечать «уже отправляется»
export const CLAIM_UNKNOWN = "Результат неизвестен: база не ответила, и попытка отправки могла сохраниться. Обновите переписку через минуту и проверьте, прежде чем отправлять снова.";

/** @type {Record<string, string>} */
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov", "video/3gpp": "3gp", "video/webm": "webm",
  "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/aac": "aac", "audio/wav": "wav", "application/pdf": "pdf" };
/** @type {Record<string, string>} */
export const FILE_WORD = { image: "фото", video: "видео", audio: "аудио", document: "файл" };

/** Вид файла для пузыря в пульте и подписи в истории. @param {string} mime @param {string} name @returns {"image" | "video" | "audio" | "document"} */
export function fileKind(mime, name) {
  const t = String(mime || "").split(";")[0].trim().toLowerCase(), n = String(name || "").toLowerCase();
  if (/^image\/(jpeg|png|webp|gif)$/.test(t) || (!t && /\.(jpe?g|png|webp|gif)$/.test(n))) return "image";
  if (/^video\/(mp4|quicktime|3gpp|webm)$/.test(t) || (!t && /\.(mp4|mov|3gp|webm)$/.test(n))) return "video";
  if (/^audio\//.test(t) || (!t && /\.(mp3|ogg|opus|m4a|aac|wav|amr)$/.test(n))) return "audio";
  return "document";
}
// тип файла от браузера: страницы, картинки svg, скрипты и программы — как и по расширению, не отправляем
const RISKY_MIME = /^(text\/(html|javascript|ecmascript)|application\/(xhtml\+xml|(x-)?javascript|ecmascript|x-(msdownload|msdos-program|msi|sh|bat|httpd-php|java-archive)|vnd\.android\.package-archive|vnd\.microsoft\.portable-executable|java-archive)|image\/svg\+xml)\b/i;
const BLOCKED = "Такой файл отправить нельзя: программы, страницы и скрипты из пульта не отправляются.";
/** @param {any} s */
const noTail = s => String(s || "").replace(/[.\s]+$/, ""); // «evil.html.» и «evil.html » — это тоже .html (Windows отбрасывает точку и пробел в конце)
/** Имя для WhatsApp: без путей, без точек и пробелов в конце, с расширением (Green-API узнаёт вид файла по расширению).
 *  @param {string} name @param {string} mime @param {string} kind */
export function uploadName(name, mime, kind) {
  let n = noTail(fileName(noTail(name), kind)) || fileName("", kind);
  const e = EXT[String(mime || "").split(";")[0].trim().toLowerCase()];
  if (!/\.[a-z0-9]{1,8}$/i.test(n) && e) n += "." + e;
  return n;
}
/**
 * Можно ли отправить файл и как он уйдёт. Опасный тип проверяется по ИТОГОВОМУ имени (тому, что уйдёт в WhatsApp и откроется
 * в пульте), по исходному имени и по типу от браузера: иначе «evil.ht"ml» после чистки имени стал бы «evil.html» (ревью безопасности 31.10.2026).
 * @param {{ name: string, size: number, mime: string }} f
 * @returns {{ ok: true, kind: "image" | "video" | "audio" | "document", name: string } | { ok: false, status: number, error: string }}
 */
export function filePlan(f) {
  if (!(f.size > 0)) return { ok: false, status: 400, error: "Файл пустой. Выберите другой." };
  if (f.size > FILE_MAX) return { ok: false, status: 413, error: TOO_BIG };
  const kind = fileKind(f.mime, noTail(f.name)), name = uploadName(f.name, f.mime, kind);
  if (RISKY.test(name) || RISKY.test(noTail(f.name)) || RISKY_MIME.test(String(f.mime || "").trim())) return { ok: false, status: 400, error: BLOCKED };
  return { ok: true, kind, name };
}

// ---- ответ на сообщение (цитата)
/** @type {Record<string, string>} */
const MEDIA_NAME = { audio: "Голосовое", image: "Фото", video: "Видео", document: "Файл", sticker: "Стикер", location: "Геолокация", contact: "Контакт" };
/** Коротко, о чём реплика: текст или «Фото», «Файл «Прайс.pdf»» вместо служебной подписи. @param {any} t */
export function quoteText(t) {
  const x = String((t && t.text) || "");
  if (t && t.m && t.m.k && (!x.trim() || /^\[[^\]]{1,60}\]$/.test(x.trim()))) return (MEDIA_NAME[t.m.k] || "Файл") + (t.m.name ? ` «${snip(t.m.name, 60)}»` : "");
  return snip(x, 120);
}
/** @param {any} t @returns {"u" | "a" | "b"} */
const whoOf = t => t.role === "user" ? "u" : t.by === "admin" ? "a" : "b";
/** Реплика этой переписки по номеру у провайдера → блок цитаты { mid, x, r } или null (чужой номер не цитируем). @param {any[]} turns @param {string} mid */
export function quoteOf(turns, mid) {
  if (!mid) return null;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t && t.mid === mid) return { mid: String(mid).slice(0, 80), x: quoteText(t), r: whoOf(t) };
  }
  return null;
}
/** Цитата в пульте: сама реплика, если она ещё в переписке, иначе — то, что запомнили при ответе (сервер собрал это из нашей же
 *  переписки: quoteOf). Автора не додумываем: без него цитаты нет — иначе у клиента появилась бы цитата «от сотрудника».
 *  @param {any[]} turns @param {any} t */
export function quoteView(turns, t) {
  const q = t && t.qt;
  if (!q || !q.mid) return null;
  const live = quoteOf(turns, String(q.mid));
  if (live) return live;
  return q.r === "u" || q.r === "a" || q.r === "b" ? { mid: String(q.mid).slice(0, 80), x: snip(q.x || "", 120), r: q.r } : null;
}

// ---- отправка файла
/**
 * Файл клиенту со второго номера (Green-API, sendFileByUpload на хосте media).
 * @param {Env} env @param {string} cid @param {string} chatDigits @param {{ blob: Blob, name: string }} f @param {string} caption @param {string} [quote] номер сообщения, на которое ответ
 * @returns {Promise<{ ok: true, id?: string, url?: string, unknown?: boolean, se?: string } | { ok: false, error: string }>}
 */
export async function gaSendFile(env, cid, chatDigits, f, caption, quote) {
  const gr = gaRoute(env, cid); // только свой номер компании или общий, закреплённый за ней (аудит 31.10.2026)
  if (!gr) return { ok: false, error: "Green-API не настроен." };
  const form = new FormData();
  form.set("chatId", chatDigits + "@c.us");
  form.set("file", f.blob, f.name);
  form.set("fileName", f.name);
  if (caption) form.set("caption", caption);
  if (quote) form.set("quotedMessageId", quote);
  const x = await gaUpload(gr, "sendFileByUpload", form);
  const mid = String((x.j && x.j.idMessage) || ""), url = String((x.j && x.j.urlFile) || ""), said = clean(String((x.j && x.j.message) || ""), 160);
  if (x.ok && mid) return { ok: true, id: mid.slice(0, 80), ...(/^https:\/\//.test(url) ? { url: url.slice(0, 500) } : {}) };
  // 200 без номера сообщения, но с текстом ошибки: по документации Green-API так приходит «failed to upload file» — файл не ушёл, «Повторить» можно
  if (x.ok && said) { console.log("GA file 200", logSafe(said)); return { ok: false, error: `Green-API не принял файл: ${logSafe(said)}.` }; }
  // Cloudflare не нашёл адрес Green-API для файлов или не смог к нему подключиться (530 и т. п., edgeMiss) — и через общий адрес тоже:
  // запрос до Green-API не дошёл, файл точно не ушёл — отказ, «Повторить» можно (это не «не знаем, ушло ли»)
  if (edgeMiss(x.status)) { console.log("GA file edge", x.status); return { ok: false, error: `Файл не ушёл: адрес Green-API для файлов не отвечает (ошибка ${x.status}). Повторите через минуту.` }; }
  if (x.ok || gaUnsure(x)) { // ответа нет, обрыв, срок или сбой у них: файл мог уйти — сам не повторяется; причина — в переписку и в журнал
    const se = fileUnsure(x);
    console.log("GA file unsure", x.status, se);
    return { ok: true, unknown: true, se };
  }
  console.log("GA file", x.status, logSafe(x.text.slice(0, 300)));
  return { ok: false, error: `Green-API не принял файл: ${gaWhy({ code: gaCode(x), status: x.status, error: clean((x.j && x.j.message) || x.text || "", 160) }, gr)}.` };
}

/** Почему неизвестно, ушёл ли файл, — коротко и без номеров (видна в пульте под сообщением). @param {{ ok?: boolean, status: number, j?: any, err?: string }} x */
export function fileUnsure(x) {
  const said = clean(String((x.j && x.j.message) || ""), 80);
  const why = !x.status ? `нет связи с Green-API${x.err ? " (" + x.err + ")" : ""}` : x.ok ? "Green-API ответил без номера сообщения"
    : `Green-API ответил ${x.status}${said ? ": " + said : ""}`;
  return logSafe(why).slice(0, 140);
}

// ---- одна отправка на rid
const RID = /^[A-Za-z0-9_-]{6,64}$/;
const OLD_PENDING_MS = 120e3; // «отправляется» дольше 2 минут — результат так и не записался: считаем «неизвестно», не отправляем
/**
 * Одно нажатие «Отправить» — не больше одного сообщения клиенту.
 * Второй номер (Green-API) — атомарная отметка в D1 (claimSend, аудит 31.10.2026): из одновременных запросов с тем же rid — в одном
 * экземпляре Worker или в разных — отправит только тот, чья вставка прошла. Без rid или без базы — отказ ДО обращения к Green-API
 * (blocked): лучше «не отправлено, попробуйте ещё раз», чем два одинаковых сообщения. Ответа Green-API нет (unknown) или итог не
 * записался (строка осталась pending) — повторно сами не отправляем никогда; отказ Green-API (ничего не ушло) — «Повторить» можно.
 * Основной номер (Meta) — как раньше: память экземпляра и KV (на боевом сайте базы D1 пока нет).
 * → результат fn, { dup: "busy" | "done", … } (уже отправляется или отправлено) или { blocked: { status, code, error } }.
 * @template {{ ok: boolean, id?: string, unknown?: boolean }} R
 * @param {Env} env @param {string} cid @param {string} ch @param {string} chat @param {string} rid @param {() => Promise<R>} fn
 * @returns {Promise<R | { dup: "busy" | "done", ok: true, id?: string, unknown?: boolean } | { blocked: { status: number, code: string, error: string } }>}
 */
export async function sendOnce(env, cid, ch, chat, rid, fn) {
  return ch === "ga" ? sendOnceD1(env, cid, ch, chat, rid, fn) : sendOnceKV(env, cid, ch, chat, rid, fn);
}

/** @type {WeakMap<object, number>} */
const tableSeen = new WeakMap(); // база, где таблица отметок уже нашлась (время проверки): не спрашиваем её о каждом сообщении
/**
 * Готова ли база отметок: ok — да; nosetup — к адресу не подключена своя D1, у неё не та отметка окружения или нет таблицы
 * send_claims (миграция 0005); nodb — база не ответила. → { state, db? }
 * @param {Env} env @param {number} now @returns {Promise<{ state: "ok", db: any } | { state: "nodb" | "nosetup" }>}
 */
export async function sendDb(env, now) {
  if (!env.DB || typeof env.DB.prepare !== "function") return { state: "nosetup" };
  /** @type {any} */ let db = null;
  try { db = await d1Ready(env, now, true); } catch (e) { db = null; }
  if (!db) {
    /** @type {any} */ let st = null;
    try { st = await d1Status(env); } catch (e) { st = null; }
    return { state: !st || st.error ? "nodb" : "nosetup" }; // ответила, но не та база или без миграций — настройка
  }
  const seen = tableSeen.get(db);
  if (seen && now - seen < 60e3) return { state: "ok", db };
  try {
    if (!(await sendTableReady(db))) return { state: "nosetup" };
    tableSeen.set(db, now);
    return { state: "ok", db };
  } catch (e) { return { state: "nodb" }; }
}
/** Почему со второго номера сейчас не отправить: "" — можно; иначе текст для пульта. @param {Env} env @param {number} now */
export async function sendDbOff(env, now) {
  const x = await sendDb(env, now);
  return x.state === "ok" ? "" : x.state === "nosetup" ? NO_SETUP : NO_DB;
}

/**
 * @template {{ ok: boolean, id?: string, unknown?: boolean }} R
 * @param {Env} env @param {string} cid @param {string} ch @param {string} chat @param {string} rid @param {() => Promise<R>} fn
 * @returns {Promise<R | { dup: "busy" | "done", ok: true, id?: string, unknown?: boolean } | { blocked: { status: number, code: string, error: string } }>}
 */
async function sendOnceD1(env, cid, ch, chat, rid, fn) {
  if (!RID.test(rid || "")) return { blocked: { status: 400, code: "rid", error: NO_RID } };
  const now = Date.now(), k = { ws: cid, ch, chat, rid }, owner = crypto.randomUUID();
  const base = await sendDb(env, now);
  if (base.state !== "ok") return { blocked: base.state === "nosetup" ? { status: 503, code: "nosetup", error: NO_SETUP } : { status: 503, code: "nodb", error: NO_DB } };
  const db = base.db;
  /** @param {any} row */
  const dupOf = row => !row || (row.state === "pending" && now - row.updated_at < OLD_PENDING_MS) ? /** @type {const} */ ({ dup: "busy", ok: true })
    : { dup: /** @type {const} */ ("done"), ok: /** @type {const} */ (true), ...(row.state === "sent" && row.mid ? { id: row.mid } : {}), ...(row.state === "sent" ? {} : { unknown: true }) };
  /** @type {any} */ let c;
  try { c = await claimSend(db, k, now, owner); }
  catch (e) {
    // вставка могла пройти, а ответ потеряться. Green-API ещё не вызывали: освобождаем свою строку, и «Повторить» отправит (F7)
    console.log("send claim", String(e).slice(0, 160));
    try {
      const rel = await releaseSend(db, k, owner, Date.now());
      return rel.mine ? { blocked: { status: 503, code: "nodb", error: NO_DB } } : dupOf(rel.row);
    } catch (e2) { return { blocked: { status: 503, code: "claim_unknown", error: CLAIM_UNKNOWN } }; }
  }
  if (!c.own) return dupOf(c.row);
  /** @type {any} */ let r;
  try { r = await fn(); }
  catch (e) { console.log("send", String(e).slice(0, 160)); r = { ok: true, unknown: true }; } // непредвиденный сбой после начала отправки: могло уйти
  const state = r && r.ok ? (r.unknown ? "unknown" : "sent") : "refused";
  try { await finishSend(db, k, state, r && r.id ? String(r.id).slice(0, 80) : "", Date.now(), owner); }
  catch (e) { console.log("send claim finish", String(e).slice(0, 160)); } // строка осталась pending: повтор этого rid ничего не отправит
  return r;
}

// Основной номер (Meta): в памяти экземпляра — rid, которые сейчас уходят или уже ушли, и отметка в KV. KV согласован не сразу,
// поэтому одновременные запросы в разных экземплярах эта защита не ловит (P1 аудита 31.10.2026: перевести на D1 вместе с боевой базой)
/** @type {Map<string, { st: "busy" | "done", id?: string, unknown?: boolean, at: number }>} */
const live = new Map();
const LIVE_MS = 600e3;
/**
 * @template {{ ok: boolean, id?: string, unknown?: boolean }} R
 * @param {Env} env @param {string} cid @param {string} ch @param {string} chat @param {string} rid @param {() => Promise<R>} fn
 * @returns {Promise<R | { dup: "busy" | "done", ok: true, id?: string, unknown?: boolean }>}
 */
async function sendOnceKV(env, cid, ch, chat, rid, fn) {
  if (!RID.test(rid || "")) return fn();
  const k = `${cid}:${ch}:${chat}:${rid}`, now = Date.now();
  if (live.size > 500) for (const [key, v] of live) if (now - v.at > LIVE_MS) live.delete(key);
  const mem = live.get(k);
  if (mem && now - mem.at < LIVE_MS) return { dup: mem.st, ok: true, ...(mem.id ? { id: mem.id } : {}), ...(mem.unknown ? { unknown: true } : {}) };
  live.set(k, { st: "busy", at: now }); // до чтения KV: двойное нажатие в этом экземпляре приходит за миллисекунды
  const was = await sendMarkGet(env, cid, ch, chat, rid);
  if (was && (was.st === "busy" || was.st === "done")) { live.set(k, { st: was.st, ...(was.id ? { id: String(was.id) } : {}), ...(was.unknown ? { unknown: true } : {}), at: now }); return { dup: was.st, ok: true, ...(was.id ? { id: String(was.id) } : {}), ...(was.unknown ? { unknown: true } : {}) }; }
  try { await sendMarkPut(env, cid, ch, chat, rid, { st: "busy", at: now }); } catch (e) { console.log("send mark", String(e)); } // хранилище не ответило — защита в памяти остаётся
  /** @type {any} */ let r;
  try { r = await fn(); }
  catch (e) { console.log("send", String(e).slice(0, 160)); r = { ok: true, unknown: true }; } // непредвиденный сбой после начала отправки: могло уйти
  if (r && r.ok) {
    const v = { st: /** @type {const} */ ("done"), ...(r.id ? { id: String(r.id) } : {}), ...(r.unknown ? { unknown: true } : {}), at: Date.now() };
    live.set(k, v);
    try { await sendMarkPut(env, cid, ch, chat, rid, v); } catch (e) { console.log("send mark", String(e)); }
  } else {
    live.delete(k);
    try { await sendMarkDrop(env, cid, ch, chat, rid); } catch (e) { console.log("send mark", String(e)); }
  }
  return r;
}
/** Для проверок: забыть отметки в памяти (как новый экземпляр Worker). */
export const sendOnceReset = () => live.clear();
