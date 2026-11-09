// @ts-check
// «Звонок» от Altegio (вебхук /alt/<компания>, ТЗ v4, 08.11.2026). Событие только оставляет отметку, как читать журнал: "fast" — изменённые
// записи, "bonus" — и бонусы визитов за 8 часов (оплата без изменения записи), "full" — весь журнал (удалённую запись видно только по нему).
// Журнал читает и сообщения отправляет фоновая проверка раз в минуту (journal.js): берёт самую сильную непрочитанную отметку, читает журнал
// и отмечает прочитанным всё, что пришло до начала её прохода — событие во время прохода остаётся на следующую минуту.
// Почему не отправлять прямо по событию (находка проверки 08.11.2026): каждое событие запускало свой проход с отправкой — 8 сообщений за
// 4,5 с с неофициального номера вместо 2 в минуту; проходы по событию и по расписанию затирали очередь друг друга; проход в ctx.waitUntil
// (около 30 с после ответа) мог оборваться между отметкой попытки и отправкой — сообщение терялось.
// Хранилище: у адреса с базой D1 — sync_state (source 'althook'; db/d1/sync.js), без базы — KV jrw:/jrwd: (db/kv/reminders.js).
/** @import { Env } from "../../lib/types.js" */
import { d1Ready } from "../../db/d1/status.js";
import { kickWantD1, kickRowsD1, kickDoneD1 } from "../../db/d1/sync.js";
import { kickWantKv, kickRowsKv, kickDoneKv } from "../../db/kv/reminders.js";
import { kvKey } from "../../lib/kv-id.js";

export const KICK_MODES = ["fast", "bonus", "full"];
const RANK = /** @type {Record<string, number>} */ ({ fast: 1, bonus: 2, full: 3 });
/** что покрывает удачный проход: полное чтение — всё; по событию об оплате — и изменённые записи (он читает и их) */
export const KICK_COVERS = /** @type {Record<string, string[]>} */ ({ full: ["full", "bonus", "fast"], bonus: ["bonus", "fast"], fast: ["fast"] });
const KV_GAP = 2000; // без D1: один ключ KV — не чаще раза в секунду (иначе 429); событие того же вида за 2 с уже отмечено
/** @type {WeakMap<object, Map<string, number>>} */
const LAST = new WeakMap();

/** база D1 адреса: есть привязка — только она (не готова — ошибка: отметку не потеряем, Altegio повторит событие); нет — null (KV)
 *  @param {Env} env @param {number} now */
async function dbOf(env, now) {
  if (!env.DB) return null;
  const db = await d1Ready(env, now, true);
  if (!db) throw new Error("D1 не готова");
  return db;
}

/** отметить событие. Не записалось — ошибка (вебхук ответит 503, Altegio повторит) @param {Env} env @param {string} cid @param {string} mode @param {number} now */
export async function kickWant(env, cid, mode, now) {
  if (!RANK[mode]) return;
  const db = await dbOf(env, now);
  if (db) return kickWantD1(db, cid, mode, now);
  const store = /** @type {object} */ (kvKey(env.KV) || env);
  let m = LAST.get(store);
  if (!m) { m = new Map(); LAST.set(store, m); }
  const k = cid + ":" + mode;
  if (now - (m.get(k) || 0) < KV_GAP) return;
  await kickWantKv(env, cid, mode, now);
  m.set(k, now);
}

/** непрочитанные отметки → самый сильный вид и все непрочитанные @param {Env} env @param {string} cid @param {number} now
 *  @returns {Promise<{ mode: string, pending: Set<string> }>} */
export async function kickPending(env, cid, now) {
  const db = await dbOf(env, now);
  const rows = db ? await kickRowsD1(db, cid) : await kickRowsKv(env, cid, KICK_MODES);
  const pending = new Set(rows.filter(r => RANK[r.mode] && r.want > r.done).map(r => r.mode));
  let mode = "";
  for (const m of pending) if (RANK[m] > (RANK[mode] || 0)) mode = m;
  return { mode, pending };
}

/** прочитано всё, что пришло до начала прохода at @param {Env} env @param {string} cid @param {string[]} modes @param {number} at */
export async function kickDone(env, cid, modes, at) {
  if (!modes.length) return;
  const db = await dbOf(env, at);
  return db ? kickDoneD1(db, cid, modes, at) : kickDoneKv(env, cid, modes, at);
}
