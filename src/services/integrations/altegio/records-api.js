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

/**
 * Записи, изменённые (созданные, перенесённые, отмеченные «пришёл») после этого времени — для быстрого чтения раз в минуту (ТЗ v4,
 * 08.11.2026: «Запись подтверждена» уходит за 1–2 минуты, а не раз в 15). Фильтр changed_after проверен чтением 30.10.2026. Время —
 * без пояса (UTC): если Altegio читает его как время Астаны, окно лишь шире на 5 часов — записей больше, пропусков нет.
 * Удалённые записи журнал не отдаёт: отмену по-прежнему замечает полное чтение раз в 15 минут.
 * @param {Env} env @param {string} user @param {number} loc @param {number} afterMs @param {number} beforeMs @param {number} [maxPages]
 * @returns {Promise<{ list: any[], pages: number, cut: boolean }>}
 */
export async function altRecordsChanged(env, user, loc, afterMs, beforeMs, maxPages = 2) {
  const iso = (/** @type {number} */ ms) => new Date(ms).toISOString().slice(0, 19), list = [];
  for (let pg = 1; pg <= maxPages; pg++) {
    if (pg > 1) await new Promise(s => setTimeout(s, GAP_MS));
    const d = await altCall(env, "GET", `/records/${loc}?changed_after=${iso(afterMs)}&changed_before=${iso(beforeMs)}&count=${PER_PAGE}&page=${pg}`, null, user);
    const arr = Array.isArray(d) ? d : [];
    for (const r of arr) if (r && typeof r === "object") list.push(r);
    if (arr.length < PER_PAGE) return { list, pages: pg, cut: false };
  }
  return { list, pages: maxPages, cut: true };
}
