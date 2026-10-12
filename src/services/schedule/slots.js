// @ts-check
// Свободные окна: названия дней и месяцев, подписи времени, расчёт окон демо-клиента (freeSlots) и getSlots (окна Altegio из ctx или демо).
/** @import { Client, Ctx } from "../../lib/types.js" */
/** @typedef {{ rel: string, label: string, times: string[], date?: string }} Slot */
import { local, mins } from "../../lib/time.js";
import { hash } from "../../lib/crypto.js";

export const DOW = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
export const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
/** @param {Date} d */
export const dayLabel = d => `${DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
/** @param {number} h */
export const hStr = h => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`; // час работы → «9:00», «9:30»

// свободные окна: реальный график минус «занятые» (для демо — псевдослучайно, стабильно на день)
/** @param {Client} c @param {number} nowMs @returns {Slot[]} */
export function freeSlots(c, nowMs) {
  const n = local(nowMs), /** @type {Slot[]} */ out = [];
  for (let i = 0; i < 10 && out.length < (c.real ? c.bookDays || 3 : 3); i++) {
    const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + i));
    const dow = d.getUTCDay(), iso = d.toISOString().slice(0, 10);
    const times = (c.slots[dow] || []).filter(/** @param {string} t */ t => {
      if (i === 0 && mins(t) < n.getUTCHours() * 60 + n.getUTCMinutes() + 60) return false; // прошедшее и ближайший час
      return c.real || hash(c.id + iso + t) % 3 !== 0; // у настоящего клиента (паспорт бота) занятость знает администратор: бот предлагает всё время из графика, заявку подтверждает человек
    }).slice(0, c.real ? 40 : 4);
    if (times.length) out.push({ rel: i === 0 ? "сегодня" : i === 1 ? "завтра" : i === 2 ? "послезавтра" : "", label: dayLabel(d), times, ...(c.real ? { date: iso } : {}) });
  }
  return out;
}

// свободные окна: из расписания Altegio (ctx.slots), иначе демо-график клиента
/** @param {Client} c @param {Ctx} ctx @returns {Slot[]} */
export const getSlots = (c, ctx) => ctx.slots || freeSlots(c, ctx.nowMs);

/** @param {Client} c @param {number} nowMs */
export function openNow(c, nowMs) {
  const n = local(nowMs), h = c.hours[n.getUTCDay()];
  if (!h) return false;
  const m = n.getUTCHours() * 60 + n.getUTCMinutes();
  return m >= h[0] * 60 && m < h[1] * 60;
}
