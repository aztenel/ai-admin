// @ts-check
// Статус исходящего сообщения в переписке (ТЗ v2.0 §2.3, 31.10.2026). У реплики в истории чата: mid — номер сообщения у
// провайдера (idMessage Green-API, id Meta/Wazzapo), st — статус, se — короткая причина ошибки.
// queued — ещё не отправлено; sent — провайдер принял и отправил (одна галочка); delivered — доставлено (две серые);
// read — прочитано (две синие); failed — не доставлено (у Green-API ещё noAccount, notInGroup, suspended, yellowCard);
// unknown — ответа на отправку нет (обрыв, сбой сервера): могло уйти, само не повторяется.
// Статус только растёт: вебхуки Green-API приходят в любом порядке, и поздний «sent» не опускает «read». Ошибка заменяет
// queued/sent/unknown (провайдер поправил), но не «доставлено» и не «прочитано»: уже доставленное не становится недоставленным.
/** @type {Record<string, number>} */
export const RANK = { queued: 0, unknown: 1, sent: 2, delivered: 3, read: 4 };
const FAIL = new Set(["failed", "noAccount", "notInGroup", "suspended", "yellowCard"]);

/** Статус провайдера → наш. @param {string} s @returns {string} */
export function stOf(s) {
  const v = String(s || "");
  if (v === "pending") return "queued";
  if (FAIL.has(v)) return "failed";
  return v in RANK ? v : "";
}
/** Что станет со статусом реплики после события. → новый статус или null (не меняется). @param {string | undefined} cur @param {string} next */
export function stNext(cur, next) {
  const n = stOf(next);
  if (!n || n === cur) return null;
  if (n === "failed") return !cur || cur === "queued" || cur === "sent" || cur === "unknown" ? "failed" : null;
  if (cur === "failed") return n === "delivered" || n === "read" ? n : null; // Green-API сначала ошибся, потом доставил — верим доставке
  return !cur || (RANK[n] ?? -1) > (RANK[cur] ?? -1) ? n : null;
}
/** Причина ошибки — коротко и без номеров. @param {string} status @param {string} [desc] */
export const stErr = (status, desc) => String(status === "failed" ? desc || "failed" : status).replace(/\+?\d[\d\s()-]{6,}\d/g, "…").slice(0, 80);
