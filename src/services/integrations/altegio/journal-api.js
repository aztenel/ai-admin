// @ts-check
// Altegio: чтение журнала записей по ключу пользователя (только HTTP и разбор; записи чата собирает worker.js).
/** @import { Env } from "../../../lib/types.js" */
import { normPhone } from "../../../lib/phone.js";
import { local, hhmm, mins, isoDay, hm } from "../../../lib/time.js";
import { ALT_JOURNAL_DAYS } from "../../../config/constants.js";
import { altCall, altText } from "./client.js";

/**
 * @param {Env} env
 * @param {any} user
 * @param {any} loc
 * @param {any} phone
 * @param {number} nowMs
 * @returns {Promise<any[] | null>}
 */
export async function altJournal(env, user, loc, phone, nowMs) { // → [{ name, date, time, services, staffName, loc, record_id, j: 1 }]
  const want = normPhone(phone);
  if (!want || !loc || loc < 0) return null;
  const from = isoDay(nowMs), to = isoDay(nowMs + ALT_JOURNAL_DAYS * 86400e3), nowT = hhmm(local(nowMs)), out = [];
  for (let pg = 1; pg <= 3; pg++) { // 200 записей на страницу; у салона больше 600 записей на месяц вперёд — бывает редко
    const d = await altCall(env, "GET", `/records/${loc}?start_date=${from}&end_date=${to}&count=200&page=${pg}`, null, user);
    const arr = Array.isArray(d) ? d : [];
    for (const r of arr) {
      if (!r || typeof r !== "object" || r.deleted === true || r.deleted === 1 || +r.attendance === -1) continue; // удалена или клиент не пришёл
      if (normPhone(String((r.client && r.client.phone) || "")) !== want) continue;
      const dt = String(r.datetime || ""), date = dt.slice(0, 10), time = hm(dt.slice(11, 16));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || (date === from && mins(time) <= mins(nowT))) continue;
      out.push({ name: altText((r.client && r.client.name) || "", 60), date, time, services: (Array.isArray(r.services) ? r.services : []).map(/** @param {any} x */ x => altText(x && x.title, 90)).filter(Boolean).join(" + "),
        staffName: altText((r.staff && r.staff.name) || "", 60), loc, record_id: r.id, j: 1 });
    }
    if (arr.length < 200) break;
  }
  return out.sort((a, b) => (a.date + String(mins(a.time)).padStart(4, "0")).localeCompare(b.date + String(mins(b.time)).padStart(4, "0")));
}
