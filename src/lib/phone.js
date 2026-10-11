// @ts-check
// Телефоны Казахстана: нормализация, поиск в тексте, скрытие ИИН/карт и номеров.
/** @param {any} s @returns {string} */
export function normPhone(s) {
  let d = String(s || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
  if (d.length === 10 && d[0] === "7") d = "7" + d;
  return /^7[3-9]\d{9}$/.test(d) ? "+" + d : ""; // после 7 идёт код оператора или города: с 0, 1 и 2 он не начинается («8 000 000 10 15» — не телефон)
}
// номер с 7 или 8 в начале и любыми знаками между цифрами («8.777.123.45.67», «8 777 1234 567») либо десять цифр мобильного без 7 и 8
const PHONE_RE = /(?<!\d)(?:\+?[78])[\s(.–—-]*\d{3}(?:[\s().–—-]*\d){7}(?!\d)|(?<![\d+])7(?:0[0-8]|47|71|7[5-8])[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g;
const INTL_RE = /\+(?![78][\s(.–—-]*\d{3})\d(?:[\s().–—-]*\d){9,13}(?!\d)/g; // номер другой страны — только с «+» и кодом: +998 90 123 45 67
const ORDER_CTX = /(заказ\S*|чек\S*|код\S*|накладн\S*|договор\S*|квитанци\S*|order|ticket|№|#)\s*(номер\S*\s*)?[:№#]?\s*$/i; // «заказ 7001234567» — не телефон
// телефоны в тексте по порядку: [{ at, len, phone }]
/** @param {any} text @returns {{ at: number, len: number, phone: string }[]} */
export function phonesIn(text) {
  const s = String(text || ""), out = [];
  for (const m of s.matchAll(PHONE_RE)) {
    const p = normPhone(m[0]);
    if (!p || (m[0].replace(/\D/g, "").length === 10 && ORDER_CTX.test(s.slice(Math.max(0, m.index - 24), m.index)))) continue;
    out.push({ at: m.index, len: m[0].length, phone: p });
  }
  for (const m of s.matchAll(INTL_RE)) out.push({ at: m.index, len: m[0].length, phone: "+" + m[0].replace(/\D/g, "") });
  return out.sort((a, b) => a.at - b.at);
}

// ИИН (12 цифр) и номера карт (13–19 цифр) не храним и не отправляем в ИИ. Телефон рядом с другим числом («завтра в 10:00 87771234567»,
// «8 705 111 22 33 15:00», «ИИН 990101300123 87051112233») остаётся телефоном: в цепочке цифр ищем номер, который состоит из целых групп
/** @param {any} text @returns {string} */
export function redact(text) {
  /** @param {string} s @returns {boolean} */
  const long = s => s.replace(/\D/g, "").length >= 12;
  return String(text).replace(/(\+?)(\d(?:[\s-]?\d){11,})/g, (all, plus, run) => {
    if (plus && !/^[78]/.test(run) && run.replace(/\D/g, "").length <= 15) return all; // «+998 90 123 45 67» — номер другой страны
    const parts = run.split(/([\s-]+)/), n = (parts.length + 1) / 2;              // группы цифр стоят на чётных местах, между ними разделители
    for (let i = 0; i < n; i++) {
      let d = "";
      for (let j = i; j < n && d.length < 11; j++) {
        d += parts[2 * j];
        const phone = (d.length === 11 && /^[78]/.test(d) && normPhone(d)) || (d.length === 10 && /^7(0[0-8]|47|71|7[5-8])/.test(d) && (j + 1 === n || d.length + parts[2 * j + 2].length > 11));
        if (!phone) continue;
        // то, что стоит до и после телефона, — отдельные числа: короткие (время, дата, размер) оставляем, длинные (ИИН, карта) прячем
        const left = plus + parts.slice(0, 2 * i).join(""), mid = parts.slice(2 * i, 2 * j + 1).join(""), right = parts.slice(2 * j + 1).join("");
        return (long(left) ? "[скрыто] " : left) + mid + (long(right) ? redact(right) : right);
      }
    }
    return plus + "[скрыто] ";
  });
}
/** @param {any} p @returns {string} */
export const fmtPhone = p => { const d = String(p || "").replace(/\D/g, ""); return d.length === 11 ? `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}` : String(p || ""); };
/** @param {any} s @returns {string} */
export const maskPhones = s => { s = String(s); let out = "", at = 0; for (const p of phonesIn(s)) { if (p.at < at) continue; out += s.slice(at, p.at) + "[телефон указан]"; at = p.at + p.len; } return out + s.slice(at); };
