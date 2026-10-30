// @ts-check
// Altegio: журнал записей локации за период (ключ пользователя) — для базы клиентов (services/crm/snapshot.js).
// Только HTTP и страницы: записи отдаются как пришли (id, datetime, deleted, attendance, visit_attendance, staff, client, services),
// разбирает их слой services. Вживую 30.10.2026: журнал Winchester за 150 дней — 2 175 записей, 11 страниц (проверка без записи).
/** @import { Env } from "../../../lib/types.js" */
import { altCall } from "./client.js";

// Altegio принимает не больше 5 запросов в секунду: страницы читаем по одной с паузой (не чаще 4 в секунду), 429 повторяет altCall
const PER_PAGE = 200, GAP_MS = 250;

/**
 * @param {Env} env
 * @param {string} user ключ пользователя салона (ALTEGIO_USER_<ID>)
 * @param {number} loc номер локации
 * @param {string} from первый день, ГГГГ-ММ-ДД
 * @param {string} to последний день, ГГГГ-ММ-ДД
 * @param {number} [maxPages] больше страниц не читаем (40 × 200 = 8 000 записей); не хватило — cut: true
 * @returns {Promise<{ list: any[], pages: number, cut: boolean }>}
 */
export async function altRecordsRange(env, user, loc, from, to, maxPages = 40) {
  const list = [];
  for (let pg = 1; pg <= maxPages; pg++) {
    if (pg > 1) await new Promise(s => setTimeout(s, GAP_MS));
    const d = await altCall(env, "GET", `/records/${loc}?start_date=${from}&end_date=${to}&count=${PER_PAGE}&page=${pg}`, null, user);
    const arr = Array.isArray(d) ? d : [];
    for (const r of arr) if (r && typeof r === "object") list.push(r);
    if (arr.length < PER_PAGE) return { list, pages: pg, cut: false }; // неполная страница — последняя
  }
  return { list, pages: maxPages, cut: true };
}
