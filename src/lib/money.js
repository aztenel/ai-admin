// @ts-check
// Деньги: чистые функции без ввода-вывода (CLAUDE.md §5.1, слой lib).

/**
 * Сумма в тенге для текста клиенту: целое число с пробелами между тысячами («12 500»).
 * Нечисловое значение — 0, чтобы в ответ не попало «NaN». Number(n) — то же, что прежнее +n, для этих типов.
 * @param {number | string | null | undefined} n
 * @returns {string}
 */
export const money = n => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
