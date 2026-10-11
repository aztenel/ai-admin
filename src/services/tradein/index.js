// @ts-check
// Trade-In: место для оценки по прайсу паспорта (ниша `repair`, поле `repairs`,
// см. src/services/tenants/parse-repairs.js) и заявки администратору.
// Реализация — после фазы 2, отдельной задачей; сейчас только интерфейс, без логики.

/**
 * Запрос оценки.
 * @typedef {{ device: string, condition: string }} TradeInQuery
 */

/**
 * Результат оценки: вилка цены и пояснение клиенту.
 * @typedef {{ min: number, max: number, note: string }} TradeInEstimate
 */

/**
 * Оценить устройство клиента по прайсу паспорта.
 * @param {{ passport: object }} ctx
 * @param {TradeInQuery} query
 * @returns {TradeInEstimate}
 */
export function estimate(ctx, query) {
  throw new Error("tradein.estimate: не реализовано (см. REFACTORING.md, фаза 1, пункт 17)");
}
