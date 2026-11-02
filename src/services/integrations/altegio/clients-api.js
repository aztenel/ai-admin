// @ts-check
// Altegio: справочник клиентов локации — поиск «Get a list of clients» (POST /locations/{локация}/clients/search, до 200 на
// страницу, meta.total_count; поля — из списка Altegio: id, name, surname, phone, first_visit_date, last_visit_date, visits_count…).
// Только чтение (altRead). Не путать с POST /clients/{локация} — это «Добавить клиента» (ошибка 30.10.2026, см. altRead).
/** @import { Env } from "../../../lib/types.js" */
import { altRead } from "./client.js";

/**
 * @param {Env} env
 * @param {string} user ключ пользователя салона
 * @param {number} loc номер локации
 * @param {{ page: number, page_size: number, fields: string[], order_by?: string, order_by_direction?: string, filters?: any[] }} body
 * @returns {Promise<{ list: any[], total: number }>}
 */
export async function altClientsSearch(env, user, loc, body) {
  const j = await altRead(env, "POST", `/locations/${loc}/clients/search`, body, user, true);
  return { list: (Array.isArray(j.data) ? j.data : []).filter((/** @type {any} */ x) => x && typeof x === "object"), total: +((j.meta && j.meta.total_count) || 0) };
}
