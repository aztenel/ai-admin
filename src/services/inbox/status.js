// @ts-check
// Статус исходящего сообщения в переписке (ТЗ v2.0 §2.3, 31.10.2026). У реплики в истории чата: mid — номер сообщения у
// провайдера (idMessage Green-API, id Meta/Wazzapo), st — статус, se — короткая причина ошибки.
// queued — ещё не отправлено; sent — провайдер принял и отправил (одна галочка); delivered — доставлено (две серые);
// read — прочитано (две синие); failed — не доставлено (у Green-API ещё noAccount, notInGroup, suspended, yellowCard);
// unknown — ответа на отправку нет (обрыв, сбой сервера): могло уйти, само не повторяется.
// Статус только растёт: вебхуки Green-API приходят в любом порядке, и поздний «sent» не опускает «read». Ошибка заменяет
// queued/sent/unknown (провайдер поправил), но не «доставлено» и не «прочитано»: уже доставленное не становится недоставленным.
/** @import { Env } from "../../lib/types.js" */
import { readHist, putHist } from "../../db/kv/chats.js";
import { kvRetry } from "../../db/kv/retry.js";
import { d1Ready } from "../../db/d1/status.js";
import { msgEventKeys } from "../../db/d1/stats.js";

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

// ---- статус из вебхука провайдера → реплика в переписке (одна запись в KV только при смене статуса: повтор вебхука ничего не пишет)

/** Найти реплику по номеру сообщения у провайдера и поменять её; запись — только если fn вернул true.
 *  ours — только наши (сотрудник, бот, напоминание), иначе — только клиента. → «changed» | «same» | «nochat» | «nomsg».
 *  @param {Env} env @param {string} hk @param {string} mid @param {boolean} ours @param {(t: any) => boolean} fn */
export async function patchTurn(env, hk, mid, ours, fn) {
  if (!mid) return "nomsg";
  return kvRetry(async () => {
    const h = await readHist(env, hk);
    if (!h) return "nochat";
    const turns = h.turns || [];
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      if (!t || t.mid !== mid || (t.role === "user") === ours) continue;
      if (!fn(t)) return "same";
      await putHist(env.KV, hk, h);
      return "changed";
    }
    return "nomsg";
  });
}
/** Статус нашего сообщения из вебхука. seen(t) — реплика нашлась (для счётчиков, и при повторе: там повтор не считается).
 *  @param {Env} env @param {string} hk @param {string} mid @param {string} status @param {string} [desc] @param {(t: any) => void} [seen] */
export function applyStatus(env, hk, mid, status, desc, seen) {
  return patchTurn(env, hk, mid, true, t => {
    if (seen) seen(t);
    const next = stNext(t.st, status);
    if (!next) return false;
    t.st = next;
    if (next === "failed") t.se = stErr(status, desc); else delete t.se;
    return true;
  });
}

/** Галочки открытого чата ещё и из D1 (живая проверка стенда ai-admin-test, 01.11.2026). Отчёты Green-API о доставке принимает одна
 *  точка сети Cloudflare, пульт читает другая: копия переписки в KV там ещё до 30 с без них, а D1 согласована сразу — события msg_*
 *  пишет statStatus при каждом отчёте. Только повышаем статус наших последних сообщений до «доставлено» и «прочитано» (как stNext),
 *  ничего не записываем; без D1 или при сбое — статусы как в копии. → номер сообщения у провайдера → статус.
 *  @param {Env} env @param {string} cid @param {string} ch @param {any[]} turns @param {number} now @returns {Promise<Map<string, string>>} */
export async function stFresh(env, cid, ch, turns, now) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const mine = (turns || []).slice(-40).filter(t => t && t.role !== "user" && t.mid && t.st !== "read").slice(-10);
  if (!mine.length || ch === "web") return out;
  try {
    const db = await d1Ready(env, now);
    if (!db) return out;
    const key = (/** @type {any} */ t, /** @type {string} */ s) => `msg:${cid}:${ch}:${t.mid}:${s}`.slice(0, 200); // как в statStatus → msgEventAdd
    const got = await msgEventKeys(db, cid, mine.flatMap(t => [key(t, "delivered"), key(t, "read")]));
    for (const t of mine) {
      const s = got.has(key(t, "read")) ? "read" : got.has(key(t, "delivered")) ? "delivered" : "";
      const next = s ? stNext(t.st, s) : null;
      if (next) out.set(String(t.mid), next);
    }
  } catch (e) { console.log("st fresh", String(e).slice(0, 120)); }
  return out;
}
