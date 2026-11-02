// @ts-check
// Удаление сообщения из пульта (02.11.2026, финальная доработка пульта Winchester, п. 4). Чат целиком здесь не удаляется — это
// «Удалить данные клиента» (erase.js); «стоп», отметки удаления данных и защита D1 не трогаются.
//   «Удалить у меня» (hide) — сообщение скрыто в пульте у всех сотрудников компании: отметка hid у реплики хранится вместе с
//   перепиской (у Winchester — в D1), поэтому после перезагрузки и на втором устройстве — так же. У клиента в WhatsApp оно остаётся,
//   к Green-API ничего не уходит; «Вернуть» (unhide) снимает отметку. Скрыть можно и сообщение клиента.
//   «Удалить у всех» (delete) — только наше сообщение со второго номера (Green-API deleteMessage по номеру сообщения idMessage):
//   сообщение клиента у него не удалить. WhatsApp разрешает удалить у всех около 60 часов после отправки; позже Green-API удалил бы
//   его только у нас, а клиент видел бы его дальше — поэтому после 59 часов отказ. Запрос уходит один раз: номер запроса
//   del-<номер сообщения> — в той же отметке D1 (send_claims), что у отправки, и общий для всех устройств: двойное нажатие, повтор
//   после обрыва связи, второй сотрудник — второго запроса к Green-API нет. Нет ответа, обрыв, 5xx — «не знаем, удалилось ли»
//   (отметка dlu), сами не повторяем: как у отправки (CLAUDE.md §5.2).
/** @import { Env } from "../../lib/types.js" */
import { gaCall, gaUnsure, gaCode, GA_HINT } from "../integrations/greenapi/client.js";
import { gaRoute } from "../integrations/greenapi/webhook.js";

/** дольше — «удалить у всех» нельзя (у WhatsApp — около 60 часов, час запаса) */
export const DEL_ALL_MS = 59 * 3600e3;

/** Какую реплику имеет в виду пульт: по номеру сообщения у провайдера, у реплик без номера — по времени и автору (u — клиент,
 *  a — сотрудник, b — бот). Ищем с конца: свежие сообщения удаляют чаще. → номер реплики или -1
 *  @param {any[]} turns @param {{ mid?: string, at?: number, r?: string }} sel */
export function findTurn(turns, sel) {
  const mid = String(sel.mid || ""), at = +(sel.at || 0), r = String(sel.r || "");
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (!t) continue;
    if (mid) { if (String(t.mid || "") === mid) return i; continue; }
    const who = t.role === "user" ? "u" : t.by === "admin" ? "a" : "b";
    if (at && +t.t === at && (!r || r === who)) return i;
  }
  return -1;
}
/** Что пульт прислал о реплике: номер сообщения или время и автор. Пустой выбор — null. @param {any} b */
export function turnSel(b) {
  const mid = String((b && b.mid) || "").slice(0, 80), at = Math.round(+((b && b.at) || 0)), r = String((b && b.r) || "");
  if (mid) return { mid };
  return at > 0 ? { at, ...(/^[uab]$/.test(r) ? { r } : {}) } : null;
}

/** Почему это сообщение нельзя удалить у всех: "" — можно, иначе код причины (тексты — DEL_WHY) @param {any} t @param {number} now */
export function delAllWhy(t, now) {
  if (!t) return "nomsg";
  if (t.role === "user") return "inbound";
  if (t.del || t.dl) return "deleted";
  if (!t.mid) return "nomid";
  if (t.st === "failed") return "failed";
  if (now - (+t.t || 0) > DEL_ALL_MS) return "old";
  return "";
}
/** @type {Record<string, string>} */
export const DEL_WHY = {
  nomsg: "Сообщение не найдено. Обновите чат.",
  inbound: "Сообщение клиента у него удалить нельзя. Скрыть его в пульте можно: «Удалить у меня».",
  deleted: "Это сообщение уже удалено.",
  nomid: "Это сообщение у клиента удалить нельзя: WhatsApp не сообщил его номер. Скрыть его в пульте можно: «Удалить у меня».",
  failed: "Сообщение не дошло до клиента, у него удалять нечего. Скрыть его в пульте можно: «Удалить у меня».",
  old: "Удалить у всех уже нельзя: WhatsApp разрешает это около 2,5 суток после отправки. Скрыть сообщение в пульте можно: «Удалить у меня».",
  channel: "Удалить у клиента можно только сообщения второго номера.",
  busy: "Сообщение уже удаляется. Подождите несколько секунд.",
};
export const DEL_UNKNOWN = "Не знаем, удалилось ли сообщение у клиента: Green-API не ответил. Проверьте в WhatsApp на телефоне — второй раз пульт удалять не будет.";

/** номер запроса удаления — общий для всех устройств: второй сотрудник и повтор после обрыва не удаляют второй раз @param {string} mid */
export function delRid(mid) {
  const s = String(mid || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
  if (s.length >= 2) return "del-" + s;
  let h = 5381; for (let i = 0; i < mid.length; i++) h = ((h * 33) ^ mid.charCodeAt(i)) >>> 0;
  return "del-x" + h.toString(36);
}

/** Green-API deleteMessage → { ok: true } удалено; { ok: true, unknown: true } — неизвестно; { ok: false, error, gone? } — не удалено.
 *  @param {Env} env @param {string} cid @param {string} chat цифры номера клиента @param {string} mid
 *  @returns {Promise<{ ok: boolean, unknown?: boolean, gone?: boolean, error?: string }>} */
export async function gaDeleteMsg(env, cid, chat, mid) {
  const r = gaRoute(env, cid);
  if (!r) return { ok: false, error: "Второй номер этой компании не подключён к пульту." };
  const x = await gaCall(r, "deleteMessage", { chatId: chat + "@c.us", idMessage: mid });
  if (x.ok) return { ok: true };
  if (x.preview) return { ok: false, error: String((x.j && x.j.message) || "Это тестовая версия: отсюда сообщения у клиентов не удаляются.") };
  if (gaUnsure(x)) return { ok: true, unknown: true };
  if (x.status === 400 && /not\s*found/i.test(String((x.j && x.j.message) || x.text || ""))) return { ok: false, gone: true, error: "WhatsApp не нашёл это сообщение: возможно, его уже удалили с телефона." };
  const code = gaCode(x);
  return { ok: false, error: `Green-API не удалил сообщение: ${GA_HINT[code] || "ответ " + x.status}.` };
}
