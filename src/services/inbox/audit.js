// @ts-check
// Журнал действий в чате (ТЗ v2.0 §2.5 «в каждой операции аудит»): кто, что и когда сделал — в профиле чата, последние 30.
// Хранится вместе с перепиской (KV, 7 дней после последнего сообщения); в D1 не пишем: в черновике там не должно быть
// настоящих номеров (решение владельца 30.10.2026).
/** @import { Env, Profile } from "../../lib/types.js" */
import { opsTouch } from "../../db/kv/inbox.js";

/** @param {Profile} p @param {number} at @param {string} who @param {string} act @param {string} [to] */
export function chatAudit(p, at, who, act, to) {
  p.audit = [...(p.audit || []), { t: at, w: String(who || "").slice(0, 32), a: act, ...(to ? { to: String(to).slice(0, 32) } : {}) }].slice(-30);
}
/** Запомнить имя сотрудника для списка «Назначить». @param {Env} env @param {string} cid @param {string} op @param {number} now */
export async function chatTouchOp(env, cid, op, now) { try { await opsTouch(env, cid, op, now); } catch (e) { console.log("ops", String(e)); } }
