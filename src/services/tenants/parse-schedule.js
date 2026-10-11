// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Паспорт бота: разбор графика работы («Пн–Пт 10:00–20:00; Сб 10:00–18:00; Вс выходной»).
import { lowE } from "../../lib/text.js";
import { hStr } from "../schedule/slots.js";

const DAY_KEYS = [["вс", "воскр", "sun"], ["пн", "понед", "mon"], ["вт", "вторн", "tue"], ["ср", "сред", "wed"], ["чт", "четв", "thu"], ["пт", "пятн", "fri"], ["сб", "субб", "sat"]];
export const DAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const dayIdx = w => { w = lowE(w).replace(/[^a-zа-я]/g, ""); return w ? DAY_KEYS.findIndex(ks => ks.some(k => w === k || (k.length > 2 && w.startsWith(k)))) : -1; };
export function parseSchedule(src) {
  const hours = [undefined, undefined, undefined, undefined, undefined, undefined, undefined], errors = [];
  const T = "(\\d{1,2})(?:[:.](\\d{2}))?", RANGE = new RegExp("(?:(?<![а-яё])с\\s+)?" + T + "\\s*(?:[–—-]|до|по)\\s*" + T, "i");
  const text = String(src || "").replace(/\r/g, "").trim().replace(/(\d(?::\d{2})?)\s+(?=(?:пн|вт|ср|чт|пт|сб|вс|пон|втор|сред|четв|пятн|субб|воскр|будн|выходн)[а-яё]*(?![а-яё]))/gi, "$1; ");
  if (!text) return { hours: hours.map(() => null), text: "", errors: ["график работы не указан"], missing: [] };
  // куски: по «;» и переводам строк; запятая делит, только если после неё снова идут дни («Пн–Пт 10–20, Сб 10–18»)
  const parts = [], DAYW = /^\s*(?:с\s+)?(?:пн|вт|ср|чт|пт|сб|вс|пон|втор|сред|четв|пятн|субб|воскр|будн|выходн|ежедн|кажд)/i, DONE = /выходн(ой|ые|ых)?\s*$|закрыт|круглосуточно/;
  for (const p of text.split(/[;\n]+/)) {
    let cur = "";
    for (const piece of p.split(",")) {
      if (cur && (RANGE.test(lowE(cur)) || DONE.test(lowE(cur))) && DAYW.test(piece)) { parts.push(cur.trim()); cur = piece; }
      else cur = cur ? cur + "," + piece : piece;
    }
    if (cur.trim()) parts.push(cur.trim());
  }
  for (const part of parts) {
    const low = lowE(part), m = RANGE.exec(low), off = /выходн(ой|ые|ых)?\s*$|закрыт|не\s+работа/.test(low.replace(/^\s*выходные\s+(?=\S)/, "")) && !m, all = /круглосуточно|24\s*часа|24\/7/.test(low);
    if (!m && !off && !all) { errors.push(`не понял время в «${part}» — напишите, например, «Пн–Пт 10:00–20:00»`); continue; }
    const daysText = (m ? low.slice(0, m.index) : low.replace(/выходн(ой|ые|ых)?\s*$|закрыто?|не\s+работа\S*|круглосуточно|24\s*часа|24\/7/g, " ")).replace(/[\s:,–—-]+$/, "").trim();
    let days = [];
    const kr = /кроме\s+([а-яё\s,и]+)$/.exec(daysText);
    if (kr) { const ex = kr[1].split(/[\s,]+и\s+|[\s,]+/).filter(Boolean).map(dayIdx); if (ex.some(d => d < 0)) { errors.push(`не понял дни после «кроме» в «${part}»`); continue; } days = [0, 1, 2, 3, 4, 5, 6].filter(d => !ex.includes(d)); }
    else if (!daysText || /ежедневно|каждый\s+день|без\s+выходных|все\s+дни/.test(daysText)) days = [0, 1, 2, 3, 4, 5, 6];
    else if (/будн/.test(daysText)) days = [1, 2, 3, 4, 5];
    else if (/^выходн/.test(daysText)) days = [6, 0];
    else {
      for (const tok of daysText.split(/[,\s]+и\s+|[,]+|\s+и\s+/)) {
        const r = tok.trim().split(/\s*[–—-]\s*|\s+по\s+/).map(x => x.replace(/^с\s+/, ""));
        if (r.length === 2) {
          const a = dayIdx(r[0]), b = dayIdx(r[1]);
          if (a < 0 || b < 0) { errors.push(`не понял дни недели в «${part}»`); days = []; break; }
          for (let d = a; ; d = (d + 1) % 7) { days.push(d); if (d === b) break; }
        } else {
          const ds = tok.trim().split(/\s+/).map(dayIdx);
          if (!ds.length || ds.some(d => d < 0)) { errors.push(`не понял дни недели в «${part}»`); days = []; break; }
          days.push(...ds);
        }
      }
    }
    if (!days.length) continue;
    let val = null;
    if (all) val = [0, 24];
    else if (m) {
      const a = +m[1] + (+(m[2] || 0)) / 60, b = +m[3] + (+(m[4] || 0)) / 60;
      if (a > 24 || b > 24 || +(m[2] || 0) > 59 || +(m[4] || 0) > 59) { errors.push(`странное время в «${part}»`); continue; }
      if (b <= a) { errors.push(`в «${part}» закрытие не позже открытия — график через полночь бот не поддерживает`); continue; }
      val = [a, b];
    }
    for (const d of days) hours[d] = val;
  }
  const missing = hours.map((h, d) => h === undefined ? d : -1).filter(d => d >= 0);
  const out = hours.map(h => h || null);
  // обратно в текст — одинаковые дни подряд собираем: «Пн–Пт 10:00–20:00, Сб 10:00–18:00, Вс выходной»
  const order = [1, 2, 3, 4, 5, 6, 0], same = (a, b) => JSON.stringify(a) === JSON.stringify(b), groups = [];
  for (const d of order) { const g = groups[groups.length - 1]; if (g && same(g.h, out[d])) g.to = d; else groups.push({ from: d, to: d, h: out[d] }); }
  const label = g => (g.from === g.to ? DAY_SHORT[g.from] : `${DAY_SHORT[g.from]}–${DAY_SHORT[g.to]}`) + " " + (g.h ? (g.h[0] === 0 && g.h[1] === 24 ? "круглосуточно" : `${hStr(g.h[0])}–${hStr(g.h[1])}`) : "выходной");
  const txt = groups.length === 1 && groups[0].h ? "ежедневно " + label(groups[0]).replace(/^\S+\s/, "") : groups.map(label).join(", ");
  return { hours: out, text: txt, errors, missing };
}
