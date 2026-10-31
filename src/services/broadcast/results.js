// @ts-check
// Итоги рассылки для пульта (ТЗ v3.0 P0 «Рассылки и доступная аудитория», 31.10.2026): по получателям — ушло, доставлено, прочитано,
// не дошло, ответили и «записались после» (запись в Altegio создана после сообщения и не позже 14 дней). «Записались после» — только
// совпадение по времени, пульт так и пишет. Источник — база D1 (events с номером рассылки и bookings). Нет базы или по рассылке в ней
// нет ни одного отчёта — null: настоящие рассылки пока не пишут отчёты с номером рассылки (у демо-рассылок черновика они есть).
/** @import { Env } from "../../lib/types.js" */
import { d1Ready } from "../../db/d1/status.js";
import { campaignResults } from "../../db/d1/campaigns.js";

export const BOOKED_WINDOW_DAYS = 14;

/** @param {Env} env @param {string} cid @param {Record<string, any>} b рассылка @param {number} now */
export async function bcResults(env, cid, b, now) {
  try {
    const db = await d1Ready(env, now);
    if (!db || !b || !b.id) return null;
    const r = await campaignResults(db, cid, String(b.id), BOOKED_WINDOW_DAYS * 86400e3);
    if (!(r.sent || r.failed || r.delivered || r.read || r.replied)) return null;
    return { ...r, window: BOOKED_WINDOW_DAYS };
  } catch (e) { console.log("bc results", String(e).slice(0, 120)); return null; }
}
