// @ts-check
// Altegio для онлайн-записи на сайте клиента (services/sitebook): сырые ответы онлайн-записи — мастера, услуги (все и одного мастера),
// открытые дни мастера, проверка записи без создания (book_check). Только HTTP через altCall, решений здесь нет.
// book_services?staff_id= и book_dates?staff_id= — как в виджете онлайн-записи Altegio (разведка 21.10.2026); с ключом разработчика
// через api.alteg.io вживую не проверено.
/** @import { Env } from "../../../lib/types.js" */
import { altCall } from "./client.js";

/** @param {Env} env @param {number} loc @returns {Promise<any[]>} */
export async function altStaffRaw(env, loc) {
  const d = await altCall(env, "GET", `/book_staff/${loc}`);
  return Array.isArray(d) ? d : [];
}

// staffId — только услуги этого мастера (и его длительности seance_length); без него — весь прайс с категориями
/** @param {Env} env @param {number} loc @param {number} [staffId] @returns {Promise<{ services: any[], category: any[] }>} */
export async function altServicesRaw(env, loc, staffId) {
  const d = await altCall(env, "GET", `/book_services/${loc}${staffId ? "?staff_id=" + encodeURIComponent(staffId) : ""}`);
  return { services: (d && Array.isArray(d.services) && d.services) || [], category: (d && Array.isArray(d.category) && d.category) || [] };
}

// открытые дни мастера (без услуг: помещаются ли услуги, считает код по сетке времени — наборы услуг не умножают запросы, проба
// 21.10.2026); ответ разбирает altDates (booking-api.js)
/** @param {Env} env @param {number} loc @param {number} staffId @param {string} from @param {string} to @returns {Promise<any>} */
export function altDatesRaw(env, loc, staffId, from, to) {
  return altCall(env, "GET", `/book_dates/${loc}?staff_id=${encodeURIComponent(staffId)}&date_from=${from}&date_to=${to}`);
}

// проверка записи без создания: свободно ли время мастера под эти услуги (ошибка — исключение altCall с .status и .code)
/** @param {Env} env @param {number} loc @param {any[]} appointments */
export async function altCheck(env, loc, appointments) {
  await altCall(env, "POST", `/book_check/${loc}`, { appointments });
}
