// @ts-check
// мастера, чьим клиентам не пишем (22.11.2026: клиент ответил на рассылку «Ваш мастер Айдос будет рад» — «Айдос же в отпуске»).
// Список — в рассылке (поле «Не писать клиентам мастеров», через запятую); сравнение по первому слову имени, без регистра и «ё»
/** @param {any} v @returns {string[]} */
export const awayList = v => (Array.isArray(v) ? v : String(v || "").split(/[,;\n]/)).map(x => String(x).toLowerCase().replace(/ё/g, "е").trim().split(/\s+/)[0] || "").filter(x => x.length >= 2).slice(0, 20);
/** @param {any} staff @param {string[]} away */
export const staffAway = (staff, away) => { const w = String(staff || "").toLowerCase().replace(/ё/g, "е").trim().split(/\s+/)[0] || ""; return !!w && away.includes(w); };
