// Общие правила CRM: этапы воронки и оценка лида. Этот файл подключают и сервер (src/worker.js), и приложение (public/app.js) —
// оценка в форме и в базе считается одним и тем же кодом.
// Оценка — по трём группам признаков, которые выбрал владелец (18.11.2026): отзывы и рейтинг 2ГИС, мастера и филиалы,
// Instagram и личное впечатление. Система записи (Altegio, zapis.kz…) в оценку не входит — это отдельная метка и фильтр.

/** этапы: [код, название, вид метки] */
export const STAGES = [
  ["new", "Новый", "new"], ["nd", "Не дозвонился", "mid"], ["cb", "Перезвонить", "mid"], ["lpr", "Контакт ЛПР", "good"],
  ["meet", "Встреча назначена", "good"], ["met", "Встреча проведена", "good"], ["think", "Думает", "mid"],
  ["paid", "Предоплата", "good"], ["won", "Клиент", "good"], ["lost", "Отказ", "neg"], ["bad", "Не целевой", "neg"]
];
export const STAGE_IDS = STAGES.map(s => s[0]);
/** этапы «в работе»: по ним есть следующий шаг */
export const ACTIVE = ["nd", "cb", "lpr", "meet", "met", "think"];
/** итоги звонка, которые можно выбрать одной кнопкой */
export const CALL_RESULTS = ["nd", "cb", "lpr", "meet", "think", "lost", "bad", "paid"];
/** после этих итогов следующий шаг не нужен */
export const CLOSED = ["lost", "bad", "paid", "won"];
/** итоги, где разговор был с тем, кто решает */
export const LPR_RESULTS = ["lpr", "meet", "think", "paid"];
export const BOOKINGS = ["Altegio", "zapis.kz", "dikidi", "YClients", "Другая", "Нет"];
export const IMPRESSIONS = [[1, "Слабый"], [2, "Нормальный"], [3, "Сильный"]];

/** @param {any} v @returns {number | null} */
const num = v => (v === null || v === undefined || v === "" || Number.isNaN(+v) ? null : +v);
/** баллы по ступеням: [[от, баллы], …] @param {number} v @param {number[][]} table */
const step = (v, table) => { let p = 0; for (const [from, pts] of table) if (v >= from) p = pts; return p; };

/**
 * Оценка лида: 0–100 и буква. Пустое поле даёт 0 баллов и не считается заполненным;
 * меньше трёх заполненных признаков из семи — буквы нет («?»): данных мало, чтобы судить.
 * @param {Record<string, any>} l поля лида (reviews, rating, masters, branches, ig_followers, ig_alive, impression)
 * @returns {{ score: number, grade: "A" | "B" | "C" | "", filled: number, parts: { reviews: number, team: number, insta: number } }}
 */
export function score(l) {
  const reviews = num(l.reviews), rating = num(l.rating), masters = num(l.masters), branches = num(l.branches);
  const ig = num(l.ig_followers), alive = num(l.ig_alive), imp = num(l.impression);
  let r = 0, t = 0, i = 0;
  if (reviews !== null) r += step(reviews, [[30, 10], [100, 22], [300, 35]]);
  if (rating !== null) r += rating >= 4.7 ? 5 : rating < 4 ? -5 : 0;
  if (masters !== null) t += step(masters, [[3, 12], [5, 20], [8, 25]]);
  if (branches !== null) t += step(branches, [[2, 8], [3, 15]]);
  if (ig !== null) i += step(ig, [[500, 5], [2000, 10], [10000, 15]]);
  if (alive !== null) i += alive ? 5 : -5;
  if (imp !== null) i += imp >= 3 ? 15 : imp === 2 ? 5 : -5;
  const filled = [reviews, rating, masters, branches, ig, alive, imp].filter(v => v !== null).length;
  const total = Math.max(0, Math.min(100, r + t + i));
  const grade = filled < 3 ? "" : total >= 55 ? "A" : total >= 30 ? "B" : "C";
  return { score: total, grade, filled, parts: { reviews: r, team: t, insta: i } };
}

/** цифры номера для поиска повторов: последние 10 цифр (без «8» и «+7») @param {any} s @returns {string} */
export const phoneKey = s => { const d = String(s || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
/** все номера из строки «+7 701…; 8 705…» @param {any} s @returns {string[]} */
export const phoneKeys = s => [...new Set(String(s || "").split(/[;,\n]/).map(phoneKey).filter(Boolean))];
