// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Время и разбор времени: чистые функции (часовой пояс Астаны, чтение «10 утра», «в 10:30» и т. п.).
export const TZ = 5; // Астана, UTC+5
export const local = ms => new Date(ms + TZ * 3600e3); // читать через getUTC*
export const hhmm = d => `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
export const mins = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export const isoDay = ms => local(ms).toISOString().slice(0, 10);
// время из любого вида: «09:00» → «9:00», «в 10:00», «11.00», «09:30:00», «10 утра», «7:30 вечера» → «19:30», «с 10.00 до 11.00» → начало
export const hm = t => {
  const s = String(t ?? "").toLowerCase();
  let h = -1, mi = "00", end = -1;
  const take = (m, hh, mm) => { h = +hh; mi = mm || "00"; end = m.index + m[0].length; };
  let m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) take(m, m[1], m[2]);
  else {
    // «11.00», «10.30» — время. «04.10» читается и как 4 октября: такую пару считаем временем, только если она стоит после «в» или «к» либо перед ней уже есть дата
    const all = [...s.matchAll(/(?:^|[^\d.])(\d{1,2})\.(\d{2})(?!\d|\.\d)/g)].filter(x => +x[1] < 24 && +x[2] < 60);
    const dateLike = x => +x[2] >= 1 && +x[2] <= 12 && +x[1] >= 1;
    const x = all.find(v => !dateLike(v)) || all.find(v => /(^|[^а-яёa-z])(в|к|at|сағат)\s*$/.test(s.slice(0, v.index + v[0].length - v[1].length - v[2].length - 1))) || (all.length > 1 ? all[all.length - 1] : null);
    if (x) take(x, x[1], x[2]);
    else if ((m = s.match(/(?:^|[^\d:.])(\d{1,2})\s*(?:ч|час[а-я]*)?\s*(?=утра|дня|вечера|ночи|[ap]\.?m)/))) take(m, m[1]);             // «10 утра», «7 pm», «3 часа дня»
    else if ((m = s.match(/(?:^|[^а-яёa-z])(?:в|на|к|at|сағат)\s*(\d{1,2})(?:\s*(?:ч|час[а-я]*))?(?![\d:.\/-])(?!\s*(?:числ|янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек|-?го|\d))/))) take(m, m[1]); // «в 10»
    else if ((m = s.match(/^\D*?(\d{1,2})\s*(?:ч|час[а-я]*)?\s*$/))) take(m, m[1]);                                                    // «10», «10ч»
    else if ((m = s.match(/(?:^|[^\d])(\d{1,2})[\s-](00|30)(?!\d)/))) take(m, m[1], m[2]);                                          // «10-00», «10 30»
    else if (/полдень/.test(s)) return "12:00";
    else if (/полночь/.test(s)) return "0:00";
  }
  if (h < 0) return "";
  const tail = s.slice(end).match(/^\s*(?:ч|час[а-я]*)?\s*(утра|дня|вечера|ночи|a\.?m|p\.?m)/);
  if (tail) { const w = tail[1][0]; if ((w === "в" || w === "p" || (w === "д" && h <= 6)) && h < 12) h += 12; else if ((w === "у" || w === "a" || w === "н") && h === 12) h = 0; }
  return h < 24 && +mi < 60 ? `${h}:${mi}` : "";
};
