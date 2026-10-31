// @ts-check
// Отправка из пульта со второго номера (Green-API), «Полноценные чаты» P0 (31.10.2026): файлы (sendFileByUpload), ответ на
// конкретное сообщение (цитата), защита от двойной отправки по rid.
// Правило CLAUDE.md §5.2: отправку, на которую не пришёл ответ (обрыв, срок, 5xx), сами не повторяем — сообщение могло уйти.
// Реплика остаётся со статусом «unknown», сотрудник проверяет в WhatsApp. Официальный номер (Meta) и чат сайта файлов из пульта
// не отправляют: у них этого нет, и пульт не делает вид, что есть.
/** @import { Env } from "../../lib/types.js" */
import { clean, snip } from "../../lib/text.js";
import { logSafe } from "../../lib/phone.js";
import { gaRoute, gaShared } from "../integrations/greenapi/webhook.js";
import { gaUpload, gaCode, gaWhy } from "../integrations/greenapi/client.js";
import { sendMarkGet, sendMarkPut, sendMarkDrop } from "../../db/kv/inbox.js";
import { RISKY, fileName } from "./media.js";

export const FILE_MAX = 25 * 1024 * 1024;
export const UNKNOWN_SENT = "Не знаем, ушло ли сообщение. Проверьте в WhatsApp, прежде чем отправлять ещё раз.";
export const NO_FILES = "С этого номера файлы из пульта не отправляются.";
export const TOO_BIG = "Файл больше 25 МБ. Уменьшите его или отправьте с телефона.";
export const QUOTE_GONE = "Сообщение, на которое вы отвечаете, не найдено в переписке. Обновите переписку.";
export const BUSY = "Это сообщение уже отправляется. Обновите переписку через минуту.";

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
/** Что не так с файлом: пусто — можно отправлять. @param {{ name: string, size: number }} f */
export function fileProblem(f) {
  if (!(f.size > 0)) return "Файл пустой. Выберите другой.";
  if (f.size > FILE_MAX) return TOO_BIG;
  if (RISKY.test(String(f.name || "").trim())) return "Такой файл отправить нельзя: программы, страницы и скрипты из пульта не отправляются.";
  return "";
}
/** Имя для WhatsApp: без путей, с расширением (Green-API узнаёт вид файла по расширению). @param {string} name @param {string} mime @param {string} kind */
export function uploadName(name, mime, kind) {
  let n = fileName(name, kind);
  const e = EXT[String(mime || "").split(";")[0].trim().toLowerCase()];
  if (!/\.[a-z0-9]{1,8}$/i.test(n) && e) n += "." + e;
  return n;
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
/** Цитата в пульте: сама реплика, если она ещё в переписке, иначе — то, что запомнили при ответе. @param {any[]} turns @param {any} t */
export function quoteView(turns, t) {
  const q = t && t.qt;
  if (!q || !q.mid) return null;
  return quoteOf(turns, String(q.mid)) || { mid: String(q.mid).slice(0, 80), x: snip(q.x || "", 120), r: q.r === "u" || q.r === "b" ? q.r : "a" };
}

// ---- отправка файла
/**
 * Файл клиенту со второго номера (Green-API, sendFileByUpload на хосте media).
 * @param {Env} env @param {string} cid @param {string} chatDigits @param {{ blob: Blob, name: string }} f @param {string} caption @param {string} [quote] номер сообщения, на которое ответ
 * @returns {Promise<{ ok: true, id?: string, url?: string, unknown?: boolean } | { ok: false, error: string }>}
 */
export async function gaSendFile(env, cid, chatDigits, f, caption, quote) {
  const gr = gaRoute(env, cid) || gaShared(env);
  if (!gr) return { ok: false, error: "Green-API не настроен." };
  const form = new FormData();
  form.set("chatId", chatDigits + "@c.us");
  form.set("file", f.blob, f.name);
  form.set("fileName", f.name);
  if (caption) form.set("caption", caption);
  if (quote) form.set("quotedMessageId", quote);
  const x = await gaUpload(gr, "sendFileByUpload", form);
  const mid = String((x.j && x.j.idMessage) || ""), url = String((x.j && x.j.urlFile) || "");
  if (x.ok && mid) return { ok: true, id: mid.slice(0, 80), ...(/^https:\/\//.test(url) ? { url: url.slice(0, 500) } : {}) };
  if (x.ok || !x.status || x.status >= 500) return { ok: true, unknown: true }; // ответа нет или сбой у них: файл мог уйти — сам не повторяется
  console.log("GA file", x.status, logSafe(x.text.slice(0, 300)));
  return { ok: false, error: `Green-API не принял файл: ${gaWhy({ code: gaCode(x), status: x.status, error: clean((x.j && x.j.message) || x.text || "", 160) }, gr)}.` };
}

// ---- одна отправка на rid
const RID = /^[A-Za-z0-9_-]{6,64}$/;
// в памяти экземпляра — rid, которые сейчас уходят или уже ушли: KV согласован не сразу, а двойное нажатие приходит за миллисекунды
/** @type {Map<string, { st: "busy" | "done", id?: string, unknown?: boolean, at: number }>} */
const live = new Map();
const LIVE_MS = 600e3;
/**
 * Повтор того же rid (двойное нажатие, повтор запроса браузером после обрыва) не отправляет клиенту второй раз:
 * → { dup: "busy" } (первая отправка ещё идёт) или { dup: "done", id, unknown } (уже ушло). Без rid — просто отправка.
 * Отказ провайдера (ничего не ушло) отметку снимает: «Повторить» в пульте отправит заново.
 * @template {{ ok: boolean, id?: string, unknown?: boolean }} R
 * @param {Env} env @param {string} cid @param {string} ch @param {string} chat @param {string} rid @param {() => Promise<R>} fn
 * @returns {Promise<R | { dup: "busy" | "done", ok: true, id?: string, unknown?: boolean }>}
 */
export async function sendOnce(env, cid, ch, chat, rid, fn) {
  if (!RID.test(rid || "")) return fn();
  const k = `${cid}:${ch}:${chat}:${rid}`, now = Date.now();
  if (live.size > 500) for (const [key, v] of live) if (now - v.at > LIVE_MS) live.delete(key);
  const mem = live.get(k);
  if (mem && now - mem.at < LIVE_MS) return { dup: mem.st, ok: true, ...(mem.id ? { id: mem.id } : {}), ...(mem.unknown ? { unknown: true } : {}) };
  const was = await sendMarkGet(env, cid, ch, chat, rid);
  if (was && (was.st === "busy" || was.st === "done")) return { dup: was.st, ok: true, ...(was.id ? { id: String(was.id) } : {}), ...(was.unknown ? { unknown: true } : {}) };
  live.set(k, { st: "busy", at: now });
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
