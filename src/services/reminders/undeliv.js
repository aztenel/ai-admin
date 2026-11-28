// @ts-check
// Сервисные сообщения, которые не доходят (28.11.2026, Алекс: подтверждение, два напоминания, перенос, бонусы и благодарность — всё
// «не доставлено», в отписавшихся Pushon его нет: номер заблокирован или без WhatsApp). Два недоставленных подряд — следующие сервисные
// этому номеру 7 дней не шлём: деньги за сообщения и оценка номера у Meta не тратятся впустую; администратор видит «ответ не дошёл»
// и звонит. Доставленное или прочитанное сообщение этому номеру снимает паузу.
/** @import { Env } from "../../lib/types.js" */
import { waFailAdd, waFailClear, waFailCount } from "../../db/kv/reminders.js";

export const UNDELIV_LIMIT = 2;
export const UNDELIV_WHY = "сообщения этому клиенту не доходят (два раза подряд): сервисные на паузе 7 дней, позвоните клиенту";

/** отчёт о доставке нашего сообщения основного номера. turn — реплика в переписке (rm — сервисное по журналу Altegio)
 * @param {Env} env @param {string} cid @param {string} to @param {string} status @param {any} turn @param {number} now */
export async function undelivNote(env, cid, to, status, turn, now) {
  if (status === "delivered" || status === "read") return waFailClear(env, cid, to);
  if (status === "failed" && turn && turn.rm) await waFailAdd(env, cid, to, now);
}
/** @param {Env} env @param {string} cid @param {string} p @returns {Promise<boolean>} */
export async function undelivHold(env, cid, p) { return (await waFailCount(env, cid, p)) >= UNDELIV_LIMIT; }
