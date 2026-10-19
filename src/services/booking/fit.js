// @ts-check
// Помещается ли услуга в свободное время мастера. Живой показ Winchester, 18.10.2026: у Тони запись в 17:30, а бот на Premium
// (1 ч 30 мин) отвечал «16:30 свободно» — длительность услуги он узнавал по названию, а «премиум» в Altegio записан латиницей.
// Поэтому считает код, а не ИИ и не угадывание названия: Altegio без услуги отдаёт свободные начала мастера сеткой (шаг 30 мин —
// у Тони 11:00, 12:30, 14:00 … 17:00 при записях 11:30, 13:00, 17:30). Начало подходит услуге на m минут, если следующие начала
// сетки до конца услуги тоже свободны. ИИ получает готовые списки для каждой длительности и вывод по времени, которое назвал клиент.
import { mins } from "../../lib/time.js";
import { nameToks, svStem, SV_STOP } from "../../lib/names.js";

// Длительность услуг из кода (altegio.durations клиента: { "название": минуты }) важнее Altegio. Живой показ Winchester, 18.10.2026:
// бот четыре раза подряд называл Premium (1 ч 30 мин) на 16:30 у Тони свободным при записи в 17:30 — длительность из Altegio
// не та или не приходит. Ключ подходит, если все его слова есть в названии (без пояснения в скобках); из нескольких — где слов больше.
// Чего нет в таблице — как в Altegio. altMinutes — длительность из Altegio (для /altegio)
/** @param {string} s @returns {string[]} */
const durToks = s => nameToks(String(s).replace(/\([^()]*\)/g, " ")).flatMap(w => w.split("-")).filter(w => w.length >= 2 && !SV_STOP.has(w)).map(svStem);
/** @param {any[]} services @param {Record<string, number> | undefined} table @returns {any[]} */
export function withDurations(services, table) {
  if (!table) return services;
  const keys = Object.entries(table).map(([k, m]) => ({ w: durToks(k), m: +m })).filter(k => k.w.length && k.m > 0).sort((a, b) => b.w.length - a.w.length);
  return services.map(x => {
    const t = new Set(durToks(x.title)), k = keys.find(k => k.w.every(w => t.has(w)));
    return k ? { ...x, minutes: k.m, altMinutes: +x.minutes || 0 } : x;
  });
}

/** @param {number} m */
export const tStr = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
/** @param {number} m */
export const durStr = m => m >= 60 ? `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ""}` : `${m} мин`;

// шаг сетки: самый короткий промежуток между соседними началами во всех списках. Нет данных — 30 мин (так считать осторожнее:
// длинная услуга тогда не «поместится» в одиночное начало)
/** @param {string[][]} lists @returns {number} */
export function gridStep(lists) {
  let step = Infinity;
  for (const l of lists) { const a = [...new Set(l.map(mins))].sort((x, y) => x - y); for (let i = 1; i < a.length; i++) step = Math.min(step, a[i] - a[i - 1]); }
  return step >= 5 && step <= 60 ? step : 30;
}

// начала, с которых мастер свободен m минут подряд
/** @param {string[]} times @param {number} m @param {number} step @returns {string[]} */
export function fitStarts(times, m, step) {
  if (!m || m <= step) return times.slice();
  const set = new Set(times.map(mins));
  return times.filter(t => { const s = mins(t); for (let k = step; k < m; k += step) if (!set.has(s + k)) return false; return true; });
}

// Списки свободных начал мастеров ({ мастер: { день: начала } }), где время своих записей клиента считается свободным: spans —
// [{ staffId, date, from, to }] (минуты). Нужно при переносе записи на время, которое пересекается с ней самой: «пн 12:00 к Рауану» →
// «на 12:30» — 12:00–13:00 занято самой переносимой записью, и бот отвечал «не получится» (живая проверка владельца 19.10.2026).
// Списка мастера на этот день нет (время не читалось) — не придумываем его
/** @param {Record<string, Record<string, string[]>>} lists @param {{ staffId: string, date: string, from: number, to: number }[]} spans @param {number} step */
export function withFreed(lists, spans, step) {
  if (!spans.length) return lists;
  /** @type {Record<string, Record<string, string[]>>} */
  const out = { ...lists };
  for (const s of spans) {
    const day = s.staffId && lists[s.staffId] && lists[s.staffId][s.date];
    if (!day) continue;
    const add = []; for (let t = s.from; t < s.to; t += step) add.push(tStr(t));
    out[s.staffId] = { ...out[s.staffId], [s.date]: [...new Set([...out[s.staffId][s.date], ...add])].sort((a, b) => mins(a) - mins(b)) };
  }
  return out;
}

// с какого времени у мастера дальше занято, если начать в t (t свободно); "" — t само занято
/** @param {string[]} times @param {string} t @param {number} step @returns {string} */
export function busyFrom(times, t, step) {
  const set = new Set(times.map(mins)); let s = mins(t);
  if (!set.has(s)) return "";
  while (set.has(s + step)) s += step;
  return tStr(s + step);
}

// n ближайших к t начал (сначала самые близкие, при равенстве — раньше), по порядку времени
/** @param {string[]} list @param {string} t @param {number} [n] @returns {string[]} */
export function nearest(list, t, n = 3) {
  const x = mins(t);
  return list.filter(v => v !== t).map(v => ({ v, d: Math.abs(mins(v) - x), m: mins(v) })).sort((a, b) => a.d - b.d || a.m - b.m).slice(0, n).sort((a, b) => a.m - b.m).map(o => o.v);
}

// длительности услуг: всё, что не длиннее шага сетки, — одна строка «до N мин», остальные — каждая своей строкой
/** @param {any[]} services @param {number} step @returns {{ m: number, label: string, titles: string[] }[]} */
export function durGroups(services, step) {
  /** @type {Map<number, string[]>} */
  const by = new Map();
  for (const x of services) { const m = +x.minutes || 0; if (!m) continue; const k = m <= step ? 0 : m; const t = by.get(k) || []; if (!t.includes(x.title)) t.push(x.title); by.set(k, t); }
  const short = Math.max(0, ...services.map(x => +x.minutes || 0).filter(m => m <= step));
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([k, titles]) => ({ m: k || short, label: k ? durStr(k) : `до ${durStr(short)}`, titles }));
}

// время, которое клиент назвал в сообщении: «в 16:30», «16.30», «в 16 30», «в 5 вечера», «к 12», «в 17ч». «19.10» — это дата,
// не время (через точку и пробел — только :00/:15/:30/:45); голое число без «в/к/на…» — не время («2 человека», «14 000 тг»);
// без «утра» часы 1–8 — вечер (барбершоп открыт с 10)
const NOT_TIME = /^\s*(человек|чел|мин|тг|тенге|₸|%|руб|год|лет|числ|янв|фев|мар|апр|мая|июн|июл|авг|сен|окт|ноя|дек|раз|штук|шт)/;
/** @param {string} text @returns {string[]} */
export function askedTimes(text) {
  const s = " " + String(text || "").toLowerCase().replace(/ё/g, "е") + " ", out = /** @type {string[]} */ ([]);
  for (const m of s.matchAll(/(?<![\d.,:])(\d{1,2})(?:\s*([:.])\s*(\d{2})|\s+(\d{2}))?(?!\d)(\s*(?:утра|вечера|дня|ночи))?/g)) {
    let h = +m[1], mm = 0;
    const min = m[3] ?? m[4], idx = m.index || 0, before = s.slice(0, idx), after = s.slice(idx + m[0].length);
    if (min != null) { mm = +min; if (mm > 59 || ((m[2] === "." || m[4] != null) && mm % 15)) continue; }
    if (NOT_TIME.test(after)) continue;
    if (min == null && /^\s*час/.test(after) && /(^|\s)на\s*$/.test(before)) continue; // «на 2 часа» — длительность, не время
    if (min == null && !m[5] && !/(^|[\s(])(в|к|на|с|до|после|около|часов|час)\s*$/.test(before) && !/^\s*ч(?![а-я])/.test(after)) continue;
    const tail = (m[5] || "").trim();
    if ((tail === "вечера" || tail === "дня") && h < 12) h += 12;
    else if (!tail && h >= 1 && h <= 8) h += 12;
    if (h > 23) continue;
    const t = tStr(h * 60 + mm);
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, 2);
}

// Блок для ИИ: по мастеру (или по всем мастерам, если клиент мастера не назвал) — с какого времени можно начать услугу каждой
// длительности, и вывод по времени, которое назвал клиент: помещается или нет, почему и ближайшее подходящее.
// days: [{ date, rel, label, lists: string[][] }] — lists: свободные начала каждого мастера (один список — один мастер)
// names — имена мастеров по порядку списков (d.lists[i] — время мастера names[i]): кто в этот день не работает и кто свободен в названное время.
// Живая проверка владельца 19.10.2026: у мастера выходной, а бот назвал его свободным — «не помещается» в каждой строке ИИ не понял,
// а «Любой мастер» не говорил, у кого именно свободно
/** @param {{ who: string, one: boolean, days: any[], groups: any[], step: number, asked: string[], show: (t: string[], keep: string[]) => string[], names?: string[] }} o */
export function fitBlock(o) {
  const { who, one, days, groups, step, asked, show, names = [] } = o;
  if (!days.length || !groups.length) return "";
  const dayName = /** @param {any} d */ d => `${d.rel ? d.rel[0].toUpperCase() + d.rel.slice(1) + ", " : ""}${d.label}`;
  /** @param {any} d @param {number} m */
  const startsFor = (d, m) => [...new Set(d.lists.flatMap(/** @param {string[]} l */ l => fitStarts(l, m, step)))].sort((a, b) => mins(a) - mins(b));
  const offOf = /** @param {any} d */ d => names.filter((n, i) => !(d.lists[i] || []).length); // ни одного свободного начала — выходной или всё занято
  let out = `\n\nПроверка длительности — считает система по свободному времени ${one ? "мастера" : "мастеров"}; если она расходится со списками выше, верь ей.\n${who} — с какого времени можно начать услугу:`;
  for (const d of days) {
    const off = offOf(d);
    if (one && off.length) { out += `\n- ${dayName(d)} (${d.date}): у мастера ${off[0]} в этот день нет свободного времени (выходной или всё занято) — на этот день к нему не записывай.`; continue; }
    out += `\n- ${dayName(d)} (${d.date}):${off.length ? ` нет свободного времени весь день у мастеров: ${off.join(", ")} — их на этот день не предлагай.` : ""}`;
    for (const g of groups) {
      const s = startsFor(d, g.m), titles = g.titles.slice(0, 4).join(", ") + (g.titles.length > 4 ? ", …" : "");
      out += `\n  · ${g.label} (${titles}): ${s.length ? show(s, asked).join(", ") : "не помещается"}`;
    }
  }
  if (asked.length) {
    out += `\nКлиент назвал ${asked.join(" и ")}:`;
    for (const t of asked) for (const d of days) {
      if (one && offOf(d).length) { out += `\n- ${t}, ${dayName(d)}: у мастера в этот день нет свободного времени (выходной или всё занято).`; continue; }
      const parts = groups.map(g => {
        const s = startsFor(d, g.m), free = one ? [] : names.filter((n, i) => fitStarts(d.lists[i] || [], g.m, step).includes(t));
        if (s.includes(t)) return `${g.label} — можно${free.length ? ` (свободны: ${free.join(", ")})` : ""}`;
        const near = nearest(s, t, 2), why = one ? (b => b ? `в ${b} у мастера уже занято` : `в ${t} мастер уже занят`)(busyFrom(d.lists[0] || [], t, step)) : "ни у одного мастера не помещается";
        return `${g.label} — нельзя: ${why}; ${near.length ? "ближайшее подходящее — " + near.join(" или ") : "в этот день подходящего времени нет"}`;
      });
      out += `\n- ${t}, ${dayName(d)}: ${parts.join("; ")}.`;
    }
  }
  out += `\nПравило: время для услуги бери только из строки её длительности (сколько длится услуга — в «Услугах для записи»). Если клиент назвал время, на которое его услуга не помещается, не говори «свободно»: скажи, сколько длится услуга и что в это время она не поместится, потому что дальше у мастера занято, и предложи ближайшее подходящее время из её строки (сначала самое близкое к названному). Имена и услуги других клиентов не называй.`;
  return out;
}
