// @ts-check
// мастера, чьим клиентам не пишем (22.11.2026: клиент ответил на рассылку «Ваш мастер Айдос будет рад» — «Айдос же в отпуске»).
// Список — в рассылке (галочки в мастере рассылки — полные имена из Altegio; старые рассылки — первое слово через запятую).
// Сравнение — по полному имени без регистра, «ё» и лишних пробелов; одно слово в списке — по первому слову имени мастера.
// До 26.11.2026 сравнивалось только первое слово: два мастера с одним именем исключались оба (проверка 26.11.2026)
/** @param {any} s */
const norm = s => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/[()«»"'.,]/g, " ").replace(/\s+/g, " ").trim();
/** @param {any} v @returns {string[]} */
export const awayList = v => (Array.isArray(v) ? v : String(v || "").split(/[,;\n]/)).map(norm).filter(x => x.length >= 2).slice(0, 20);
/** @param {any} staff @param {string[]} away */
export const staffAway = (staff, away) => {
  const full = norm(staff), first = full.split(" ")[0] || "";
  return !!full && away.some(a => a === full || (!a.includes(" ") && a === first));
};
