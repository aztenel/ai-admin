// @ts-check
// Паспорт бота: разбор списка услуг и цен («Мужская стрижка — 6000 — 60»).
import { lowE } from "../../lib/text.js";
import { altText } from "../integrations/altegio/client.js";

// ---- разбор услуг: по строке на услугу — «Мужская стрижка — 6000 — 60», «Чистка от 20 000 ₸», «Окрашивание 15000-30000, 2 часа», «Консультация — бесплатно»
/** @param {any} s */
export const numOf = s => { let t = String(s || "").replace(/[\s ]/g, ""); const k = /(к|k|тыс\.?)$/i.test(t); t = t.replace(/(к|k|тыс\.?)$/i, "").replace(/[.,](?=\d{3}(\D|$))/g, ""); const f = parseFloat(t.replace(",", ".")); const n = Math.round(k ? f * 1000 : f); return isFinite(n) ? n : NaN; };
/** @param {any} src */
export function parseServices(src) {
  const /** @type {any[]} */ list = [], /** @type {string[]} */ errors = [], seen = new Set();
  const lines = String(src || "").replace(/\r/g, "").split("\n").map(x => x.replace(/^\s*(?:[-•*·]|\d{1,2}[.)])\s+/, "").trim()).filter(Boolean);
  lines.forEach((line, i) => {
    const no = i + 1;
    // длительность в конце: «60 мин», «1 час», «1,5 часа», «2 ч», либо третье число после тире
    let rest = line, minutes = 0;
    const dm = /[\s,;—–-]+(\d+(?:[.,]\d)?)\s*(минут[аы]?|мин\.?|м\.?|час(?:а|ов)?|ч\.?)\s*$/i.exec(rest);
    if (dm) { const v = parseFloat(dm[1].replace(",", ".")); minutes = /^(ч|час)/i.test(dm[2]) ? Math.round(v * 60) : Math.round(v); rest = rest.slice(0, dm.index); }
    else { const d3 = /\s+[—–-]\s+(\d{1,3})\s*$/.exec(rest); if (d3 && /\d[\d\s ]*(?:₸|тг|тенге|т\.?)?\s*$/i.test(rest.slice(0, d3.index)) && /[—–-]\s*(?:от\s*)?\d/.test(rest.slice(0, d3.index))) { minutes = +d3[1]; rest = rest.slice(0, d3.index); } }
    if (!minutes) { const g = /^(.*\S\s+\d{3,}(?:\s*(?:₸|тг|тенге))?)\s+(\d{2,3})\s*$/i.exec(rest); if (g && !/\d[\s\u00a0]\d{3}\s*$/.test(g[1].slice(-8)) && +g[2] >= 10 && +g[2] <= 360) { minutes = +g[2]; rest = g[1]; } }
    rest = rest.replace(/[\s,;—–-]+$/, "");
    // цена в конце: «6000», «от 6 000 ₸», «6000–8000 тг», «6к», «бесплатно»
    let min = null, max = null, from = false, name = rest, unit = "";
    const noPrice = /\s+[—–-]\s+(?:цен|по\s+договор|уточн|индивидуальн|договорн)[^—–]*$/i.exec(rest); // «Укладка — цену называет мастер»
    if (noPrice) rest = name = rest.slice(0, noPrice.index);
    const um = /\d\s*(?:₸|тг\.?|тенге|kzt)?\s+((?:за|в)\s+[\p{L}\d ]{2,24}|\/\s*[\p{L}]{2,12})\s*$/iu.exec(rest); // «от 300 000 ₸ за зуб», «5000 в месяц», «3000/час»
    if (um && !/^(?:за|в)\s+\d+\s*(?:мин|час|ч)/i.test(um[1])) { unit = um[1].replace(/\s+/g, " ").trim(); rest = rest.slice(0, rest.length - um[1].length).trim(); name = rest; }
    const free = /[\s—–:-]+(бесплатно|free|0\s*(?:₸|тг|тенге)?)\s*$/i.exec(rest);
    const pm = /(?:^|[\s—–:=-]+)(от\s*)?(\d{1,3}(?:[\s\u00a0]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:к|k|тыс\.?)?|\d{1,3}(?:[\s\u00a0]\d{3})+\s*(?:к|k|тыс\.?))\s*(?:₸|тг\.?|тенге|kzt|т\.?)?(?:\s*(?:[–—-]|до)\s*(\d{1,3}(?:[\s\u00a0]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:к|k|тыс\.?)?|\d{1,3}(?:[\s\u00a0]\d{3})+\s*(?:к|k|тыс\.?))\s*(?:₸|тг\.?|тенге|kzt|т\.?)?)?\s*$/i.exec(rest);
    if (free) { min = 0; max = 0; name = rest.slice(0, free.index); }
    else if (pm && pm.index > 0) {
      min = numOf(pm[2]); max = pm[3] ? numOf(pm[3]) : min; from = !!pm[1];
      name = rest.slice(0, pm.index);
      if (!isFinite(min) || !isFinite(max)) { errors.push(`услуги, строка ${no}: не понял цену в «${line}»`); return; }
      if (max < min) [min, max] = [max, min];
    }
    name = altText(name.replace(/[\s—–:=-]+$/, ""), 80);
    if (!name || !/\p{L}/u.test(name)) { errors.push(`услуги, строка ${no}: не вижу названия услуги в «${line}»`); return; }
    if (min === null && !noPrice && /\d{3,}/.test(name)) { errors.push(`услуги, строка ${no}: не понял цену в «${line}» — напишите «Название — цена» (например «Уборка — от 300 ₸»)`); return; }
    if (min !== null && min > 0 && min < 100) { errors.push(`услуги, строка ${no}: цена ${min} ₸ выглядит ошибкой — «${line}»`); return; }
    if (minutes && (minutes < 5 || minutes > 720)) { errors.push(`услуги, строка ${no}: длительность ${minutes} мин выглядит ошибкой`); return; }
    const key = lowE(name);
    if (seen.has(key)) { errors.push(`услуги, строка ${no}: «${name}» уже есть в списке`); return; }
    seen.add(key);
    list.push({ name, min, max, from, minutes, ...(unit && min ? { unit } : {}) });
  });
  return { list, errors };
}
