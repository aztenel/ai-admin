// @ts-check
// Служебные строки ИИ: разбор [ЗАЯВКА]/[ОТМЕНА] (tidyTags, tagFields, tagsOf), даты из них (altDateOf), метка реквизитов [РЕКВИЗИТЫ].
// Чистые функции: время передаётся явно (nowMs).
import { lowE } from "../../lib/text.js";
import { local, isoDay } from "../../lib/time.js";

export const PAY_TAG = /\[\s*РЕКВИЗИТЫ\s*\]/i, PAY_TAG_G = /[ \t]*\[\s*РЕКВИЗИТЫ\s*\][ \t]*\n?/gi;
// поля служебной строки: «Имя: …; Телефон: …; Услуга: …». ИИ пишет её по-разному: через «;», «,», «.», без знаков, с «—» или «=» вместо «:», с ключами на английском или казахском
/** @type {Record<string, string>} */
const TAG_KEYS = { "имя": "имя", "имя клиента": "имя", "клиент": "имя", "фио": "имя", "name": "имя", "client": "имя", "аты": "имя", "есімі": "имя",
  "телефон": "телефон", "телефоны": "телефон", "phone": "телефон",
  "услуга": "услуга", "услуги": "услуга", "service": "услуга", "services": "услуга", "қызмет": "услуга", "қызметі": "услуга",
  "мастер": "мастер", "специалист": "мастер", "врач": "мастер", "доктор": "мастер", "master": "мастер", "specialist": "мастер", "staff": "мастер", "barber": "мастер", "doctor": "мастер", "шебер": "мастер", "шебері": "мастер",
  "дата": "дата", "день": "дата", "date": "дата", "day": "дата", "күні": "дата",
  "комментарий": "заметка", "примечание": "заметка", "пожелание": "заметка", "пожелания": "заметка", "comment": "заметка", "note": "заметка",
  "время": "время", "когда": "время", "time": "время", "when": "время", "уақыты": "время", "уақыт": "время", "қашан": "время", "дата и время": "время", "день и время": "время", "date and time": "время" };
/** @param {string} sep */
const tagKeyRe = sep => new RegExp("(^[\\s:—–-]*|[;|]\\s*|[,.]\\s*|\\s)(" + Object.keys(TAG_KEYS).sort((a, b) => b.length - a.length).map(k => k.replace(/ /g, "\\s+")).join("|") + ")\\s*" + sep, "gi");
const TAG_RE = tagKeyRe("[:=]"), TAG_RE2 = tagKeyRe("(?:[—–]|\\s-\\s)");
// plain — заявка обычного клиента: «услуга, мастер: Арман» и «время, дата: 14 ноября» остаются частью услуги и времени, как их написал ИИ
/** @param {any} line @param {boolean} [plain] @returns {Record<string, string>} */
export function tagFields(line, plain) {
  const s = String(line || "").replace(/：/g, ":").replace(/；/g, ";").replace(/，/g, ","), /** @type {Record<string, string>} */ o = {}, /** @type {Record<string, string>} */ labels = {};
  const scan = /** @param {RegExp} re */ re => [...s.matchAll(re)].map(m => ({ k: TAG_KEYS[m[2].toLowerCase().replace(/\s+/g, " ")], label: m[2], strong: m.index === 0 || /[;|]/.test(m[1]), at: m.index, from: m.index + m[0].length }));
  let marks = scan(TAG_RE);
  if (!marks.length) marks = scan(TAG_RE2); // «Имя — Тимур; Услуга — стрижка»
  if (plain) marks = marks.filter(x => x.strong || (x.k !== "мастер" && x.k !== "дата"));
  // «Услуга: Уход. Время: 30 минут; Время: 10:00»: если ключ есть и после «;», то тот же ключ после точки или запятой — часть значения, а не поле
  const strongKeys = new Set(marks.filter(x => x.strong).map(x => x.k)), live = marks.filter(x => x.strong || !strongKeys.has(x.k));
  live.forEach((x, i) => {
    const v = s.slice(x.from, i + 1 < live.length ? live[i + 1].at : s.length).replace(/[;,|.\s]+$/, "").trim();
    const same = live.filter(y => y.k === x.k);
    if (x.k === "услуга" && same.length > 1 && same.every(y => y.strong)) { o[x.k] = o[x.k] ? o[x.k] + " | " + v : v; return; } // «Услуга: А; Услуга: Б» — обе услуги
    if (x !== (x.k === "время" || x.k === "дата" ? same[same.length - 1] : same[0])) return; // повтор ключа: день и время берём последние, остальное — первое
    o[x.k] = v; labels[x.k] = x.label;
  });
  Object.defineProperty(o, "labels", { value: labels }); // как ключ назвал ИИ («Врач», «Master») — для заявки обычного клиента
  return o;
}
/** @param {any} line @param {string} k */
export const tagField = (line, k) => tagFields(line)[k.toLowerCase()] || "";

// дата из служебной строки: «2026-10-04», «04.10», «04/10/2026», «4 октября», «4 окт.», «4 қазан», «October 4», «завтра», «в воскресенье»
export const MON_RU = "(январ[яь]|янв|феврал[яь]|фев|март[ае]?|мар|апрел[яь]|апр|ма[йяе]|июн[яь]|июн|июл[яь]|июл|август[ае]?|авг|сентябр[яь]|сент?|октябр[яь]|окт|ноябр[яь]|нояб?|декабр[яь]|дек)\\.?(?![а-яё])";
const MON_RU3 = ["янв", "фев", "мар", "апр", "ма", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MON_EN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export const MON_EN_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?(?![a-z])";
export const MON_KK = ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"];
// дни недели, названные в тексте: 0 — воскресенье
const DOW_RE = ["воскресень|жексенбі|sunday", "понедельник|дүйсенбі|monday", "вторник|сейсенбі|tuesday", "сред[ауые]|сәрсенбі|wednesday", "четверг|бейсенбі|thursday", "пятниц|жұма|friday", "суббот|сенбі|saturday"]
  .map(x => new RegExp("(?<![а-яёәғқңөұүһіa-z])(" + x + ")", "i"));
/** @param {string} s */
export const dowsIn = s => DOW_RE.map((re, i) => re.test(s) ? i : -1).filter(i => i >= 0);
/** @param {string} s */
const relDay = s => /послезавтра|бүрсігүні|day after tomorrow/.test(s) ? 2 : /завтра|ертең|tomorrow/.test(s) ? 1 : /сегодня|бүгін|today/.test(s) ? 0 : -1;
/** @param {any} s @param {number} nowMs */
export function altDateOf(s, nowMs) {
  s = lowE(s);
  const ok = /** @param {number} y @param {number} mo @param {number} d */ (y, mo, d) => { const t = new Date(Date.UTC(y, mo - 1, d)); return mo >= 1 && mo <= 12 && d >= 1 && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : ""; };
  const today = isoDay(nowMs), y = +today.slice(0, 4);
  const near = /** @param {number} mo @param {number} d */ (mo, d) => { const a = ok(y, mo, d); return a && a >= today ? a : ok(y + 1, mo, d); }; // день уже прошёл — значит, следующий год
  let m = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/), r;
  if (m) return ok(+m[1], +m[2], +m[3]);
  if ((m = s.match(/(?:^|[^\d])(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}|\d{2})(?!\d)/))) {
    // день, месяц, год; если такая дата уже прошла, а «месяц, день» — впереди, значит, дата написана по-американски
    const yy = m[3].length === 2 ? 2000 + +m[3] : +m[3], a = ok(yy, +m[2], +m[1]), b = ok(yy, +m[1], +m[2]);
    if ((r = a && (a >= today || !b || b < today) ? a : b)) return r;
  }
  if ((m = s.match(new RegExp("(\\d{1,2})(?:-?(?:го|ое|е))?\\s+" + MON_RU))) && (r = near(MON_RU3.findIndex(x => m[2].startsWith(x)) + 1, +m[1]))) return r;
  if ((m = s.match(new RegExp("(\\d{1,2})[\\s-]*(" + MON_KK.join("|") + ")"))) && (r = near(MON_KK.indexOf(m[2]) + 1, +m[1]))) return r;
  if ((m = s.match(new RegExp("(?:^|[^\\d:])(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?" + MON_EN_RE))) && (r = near(MON_EN.indexOf(m[2].slice(0, 3)) + 1, +m[1]))) return r;
  if ((m = s.match(new RegExp("(?:^|[^a-z])" + MON_EN_RE + "\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:])"))) && (r = near(MON_EN.indexOf(m[1].slice(0, 3)) + 1, +m[2]))) return r;
  const rel = relDay(s);
  if (rel >= 0) return isoDay(nowMs + rel * 86400e3); // «завтра в 10.05»: день назван словом, а «10.05» — время
  // «04.10» — день и месяц (месяц двумя цифрами). «в 10.05» — время, «1.5 часа» — не дата
  for (const x of s.matchAll(/(^|[^\d:.])(\d{1,2})\.(\d{2})(?!\d|:|\.\d)/g)) {
    if (/(^|[^а-яёa-z])(в|к|at|сағат)\s*$/.test(s.slice(0, x.index + x[1].length))) continue;
    if ((r = near(+x[3], +x[2]))) return r;
  }
  if ((m = s.match(/(?:^|[^\d\/])(\d{1,2})\/(\d{1,2})(?![\d\/])/)) && (r = near(+m[2], +m[1]))) return r;
  const dw = dowsIn(s); // день недели — ближайший такой день, не сегодня
  if (dw.length === 1) return isoDay(nowMs + (((dw[0] - local(nowMs).getUTCDay() + 7) % 7) || 7) * 86400e3);
  return "";
}
// ---- служебные строки ИИ приводим к одному виду: «(ЗАЯВКА)», «ЗАЯВКА: …», «[БРОНЬ]», «[BOOKING]», «[ЗАЯВК]» → «[ЗАЯВКА]»; поля столбиком — в одну строку.
// Служебная строка не должна дойти до клиента, что бы ИИ ни дописал к метке: номер («[ЗАЯВКА 1]»), пояснение («[ОТМЕНА записи]», «[BOOKING REQUEST]»), поля внутри скобок
// («[ЗАЯВКА: Имя: …]»), JSON, жирный шрифт, кавычки, слова перед меткой («Служебная строка: [ЗАЯВКА] …»). Обычная фраза со словом «заявка», «запись» или «отмена»
// («Ваша заявка принята», «Отмена бесплатна») служебной строкой не становится: без скобок метка — это слово заглавными буквами либо слово с двоеточием, после которого идёт поле («Имя: …»)
const TAGW_BOOK = "ЗАЯВК[АИУ]?|ЗАПИСЬ|БРОНЬ|БРОНИРОВАНИЕ|BOOKING|BOOK|ORDER|REQUEST|APPOINTMENT|ӨТІНІМ|ӨТІНІШ|ТАПСЫРЫС|ЖАЗЫЛУ";
const TAGW_CANCEL = "ОТМЕН[АЫУ]?|ОТМЕНИТЬ|CANCEL|CANCELLATION|CANCELATION|БОЛДЫРМАУ";
// без скобок «ОТМЕНИТЬ» и «CANCELLATION» меткой не были и раньше: это слова обычной фразы («Напишите одно слово: ПЕРЕНЕСТИ или ОТМЕНИТЬ»)
const TAGW_BARE = TAGW_BOOK + "|ОТМЕН[АЫУ]?|CANCEL|БОЛДЫРМАУ";
const TAGW = TAGW_BOOK + "|" + TAGW_CANCEL, TAG_LT = "A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі";
/** @param {(k: string) => boolean} pick */
const tagKeyAlt = pick => Object.keys(TAG_KEYS).filter(pick).sort((a, b) => b.length - a.length).map(k => k.replace(/ /g, "\\s+")).join("|");
const TAG_KEY_ALT = tagKeyAlt(() => true), TAG_NAME_ALT = tagKeyAlt(k => TAG_KEYS[k] === "имя");
const TAG_NUM = "(?:\\s*(?:(?:№|#|N)\\s*)?\\d{1,3})?";                                                 // номер после метки: «ЗАЯВКА 1», «ЗАЯВКА №2»
const TAG_OPEN = "\\\\?\\[\\s*(?:(?:НОВАЯ|НОВЫЙ|NEW|СЛУЖЕБНАЯ\\s+СТРОКА|СТРОКА|МЕТКА|TAG)[\\s:—–-]+)?(" + TAGW + ")(?![" + TAG_LT + "])" + TAG_NUM;
// метка в квадратных скобках — в любом регистре, с номером и пояснением: «[Заявка]», «[ЗАЯВКА №1]», «[BOOKING REQUEST]», «[ОТМЕНА ЗАПИСИ]», «[НОВАЯ ЗАЯВКА]», «\[ЗАЯВКА\]»
const TAG_SQ = new RegExp(TAG_OPEN + "(?:\\s+(?:ЗАПИСИ|ЗАПИСЬ|ЗАЯВКИ|БРОНИ|КЛИЕНТА|НА\\s+ЗАПИСЬ|REQUEST|BOOKING|LINE))?" + TAG_NUM + "\\s*\\\\?\\]", "gi");
const TAG_SQ_IN = new RegExp(TAG_OPEN + "\\s*(?:([:=—–])\\s*|(?<=\\s)(?=(?:" + TAG_KEY_ALT + ")\\s*[:=]))", "gi"); // поля внутри скобок: «[ЗАЯВКА: Имя: …]», «[ЗАЯВКА Имя: …]»
const TAG_SQ_ANY = new RegExp("\\\\?\\[([^\\[\\]\\n]*?)(?<![" + TAG_LT + "])(ЗАЯВКА|ОТМЕНА)(?![" + TAG_LT + "])([^\\[\\]\\n]*)\\]", "g"); // метка заглавными где угодно в скобках: «[ОТМЕНА записи на 15:00]»
const TAG_MARK = "[\\s*_`~>«\"“„'-]*";                                                                  // разметка и кавычки перед меткой
// в других скобках и без скобок — только заглавными, в начале строки: «(ЗАЯВКА) …», «ЗАЯВКА: …», «**ЗАЯВКА №1:** …»
const TAG_BARE = new RegExp("^[\\s*_`~>\"“„'-]*(?:[(<{【«]\\s*(" + TAGW + ")" + TAG_NUM + "\\s*[)>}】»]|«?(" + TAGW_BARE + ")(?![" + TAG_LT + "])" + TAG_NUM + ")[*_`]*\\s*[:—–-]?\\s*[*_`]*\\s*(.*)$");
// слово «Заявка», «Отмена», «Booking» не заглавными — метка, только если после него двоеточие или тире, а дальше поле «Имя: …» («Отмена: Время: за два часа до визита» — рассказ о правилах, а не отмена)
const TAG_SOFT = new RegExp("^" + TAG_MARK + "(" + TAGW_BARE + ")(?![" + TAG_LT + "])" + TAG_NUM + "[*_`]*\\s*[:—–=-]\\s*[*_`]*\\s*(.*)$", "i");
const TAG_ITEM = "(?:(?:[-•*·]|\\d{1,2}[.)])\\s*)?";                                                    // пункт списка перед полем: «- Имя: …», «1. Имя: …»
const TAG_KEY_START = new RegExp("^\\s*" + TAG_ITEM + "(?:" + TAG_KEY_ALT + ")\\s*(?:[:=]|[—–]|\\s-\\s)", "i");
const TAG_KEY_COLON = new RegExp("^\\s*" + TAG_ITEM + "(?:" + TAG_KEY_ALT + ")\\s*[:=]", "i"), TAG_NAME_COLON = new RegExp("^\\s*" + TAG_ITEM + "(?:" + TAG_NAME_ALT + ")\\s*[:=]", "i");
const TAG_FIELD_LINE = new RegExp("^\\s*" + TAG_ITEM + "[" + TAG_LT + "][^:=\\n]{0,30}[:=]\\s*\\S");     // «Возраст: 30» — строка похожа на поле, хотя ключ незнакомый
const TAG_ITEM_HEAD = /^\s*(?:[-•*·]|\d{1,2}[.)])\s*/;
const TAG_ITEM_IN = new RegExp("(\\]\\s*(?:[:—–-]\\s*)?|[;|]\\s*)\\d{1,2}[.)]\\s*(?=(?:" + TAG_KEY_ALT + ")\\s*[:=])", "gi"); // «[ЗАЯВКА] 1) Имя: …; 2) Телефон: …» — номера полей в одной строке
const TAG_IS_CANCEL = new RegExp("^(?:" + TAGW_CANCEL + ")$", "i");
const TAG_JSON = new RegExp("\\{\\s*\"(" + TAGW + ")\"\\s*:\\s*\\{([^{}]*)\\}\\s*\\}", "gi");             // {"ЗАЯВКА": {"Имя": "…", …}} — одной строкой или столбиком
const TAG_JSON_AFTER = new RegExp("(\\[\\s*(?:" + TAGW + ")\\s*\\][*_`]*\\s*(?::\\s*)?)\\{([^{}]*)\\}", "gi"); // [ЗАЯВКА] {"Имя": "…", …}
const TAG_LABEL = /(?:служебн[а-яё]*\s+строк[а-яё]*|строка\s+для\s+(?:системы|администратора)|service\s+line|system\s+line|метка|tag)\s*[:—–-]?/gi; // слова, которыми ИИ подписывает метку
const TAG_HAS = /\[(?:ЗАЯВКА|ОТМЕНА)\]/, TAG_ONLY = /^\[(?:ЗАЯВКА|ОТМЕНА)\]$/, TAG_JSON_START = /^\{\s*"/;
const TAG_PLAIN = new RegExp("^[\\s*_`>-]*(?:" + TAGW_BARE + ")\\s*[:—–-]?\\s*$"), TAG_LINE_START = /^[\s*_`~>«"“„'-]*(?:\\?\[|\{)/; // «ОТМЕНА», «ЗАЯВКА:» — слово без разметки после него; строка, которая начинается со скобки
const TAG_TRAIL = " \t\r*_`~\\", TAG_PAIRS = [["[", "]"], ["«", "»"], ["(", ")"], ["{", "}"], ["“", "”"]]; // разметка в конце служебной строки; скобки и кавычки, которые могут остаться без пары
// знаки из набора в конце строки — без регулярного выражения: «[…]+$» на длинной строке работает за квадрат её длины
/** @param {string} s @param {string} set */
const rtrimSet = (s, set) => { let e = s.length; while (e > 0 && set.includes(s[e - 1])) e--; return e < s.length ? s.slice(0, e) : s; };
// поля из JSON: «"Имя": "Азамат", "Время": "завтра, 12:00"» → «Имя: Азамат; Время: завтра, 12:00»
/** @param {any} body */
const tagJson = body => [...String(body).matchAll(/"([^"\n]{1,40})"\s*:\s*(?:"([^"]*)"|\[([^\]]*)\]|([^,"{}\n]+))/g)]
  .map(m => m[1].trim() + ": " + (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3].replace(/"\s*,\s*"/g, " | ").replace(/"/g, "") : m[4]).trim().replace(/;/g, ",")).join("; ");
/** @param {any} raw */
export function tidyTags(raw) {
  const canon = /** @param {string} w */ w => TAG_IS_CANCEL.test(w.trim()) ? "[ОТМЕНА]" : "[ЗАЯВКА]";
  const lines = String(raw || "").replace(/：/g, ":").replace(/；/g, ";")
    .replace(TAG_JSON, (m, w, body) => "\n" + canon(w) + " " + tagJson(body) + "\n")
    .replace(TAG_JSON_AFTER, (m, head, body) => /"\s*:/.test(body) ? head + tagJson(body) : m)
    .replace(/^[ \t]*```[a-zA-Z]*[ \t]*$/gm, "") // границы блока кода клиенту не нужны
    .split("\n"), out = [];
  const nextText = /** @param {number} i */ i => { let k = i + 1; while (k < lines.length && !lines[k].trim()) k++; return k < lines.length ? lines[k] : ""; };
  const tagNext = /** @param {number} i */ i => { const nx = nextText(i); return !nx || TAG_KEY_START.test(nx) || TAG_LINE_START.test(nx); }; // дальше — конец ответа, поле («Имя: …») или другая служебная строка
  for (let i = 0; i < lines.length; i++) {
    let ln = lines[i];
    if (ln.includes("[")) ln = ln.replace(TAG_SQ, (m, w) => canon(w))
      .replace(TAG_SQ_IN, (m, w, sep, at, s) => sep && w !== w.toUpperCase() && !TAG_KEY_COLON.test(s.slice(at + m.length)) ? m : canon(w) + " ") // «[Запись: завтра в 12:00]» — не метка
      .replace(TAG_SQ_ANY, (m, a, w, b) => { const rest = (a + " " + b).replace(/\\+$/, "").replace(/^[\s:—–=№#\d-]+/, "").trim(); return rest ? `[${w}] ${rest}` : `[${w}]`; });
    const m = ln.match(TAG_BARE);
    // слово заглавными без полей — метка, как и раньше («ОТМЕНА», «ЗАЯВКА:»). С разметкой или номером («**ОТМЕНА**», «ЗАЯВКА №1») — только если дальше нет обычного текста: так выглядит и заголовок в рассказе о правилах
    if (m && (m[1] || TAG_KEY_START.test(m[3]) || TAG_JSON_START.test(m[3]) || (!m[3] && (TAG_PLAIN.test(ln) || tagNext(i))))) ln = canon(m[1] || m[2]) + (m[3] ? " " + (TAG_JSON_START.test(m[3]) ? tagJson(m[3]) : m[3]) : "");
    else if (!TAG_HAS.test(ln)) {
      const s = ln.match(TAG_SOFT);
      if (s && (TAG_NAME_COLON.test(s[2] || nextText(i)) || TAG_JSON_START.test(s[2]))) ln = canon(s[1]) + (s[2] ? " " + (TAG_JSON_START.test(s[2]) ? tagJson(s[2]) : s[2]) : "");
    }
    if (TAG_HAS.test(ln)) {
      const at = ln.search(TAG_HAS);
      // «[ЗАЯВКА] [ЗАЯВКА] …» — одна метка. Повтор «[ОТМЕНА]» не трогаем: строки отмены бот исполняет по одной, менять их число и порядок нельзя
      let head = ln.slice(0, at), tail = ln.slice(at).replace(/(\[ЗАЯВКА\])(?:[\s:—–*_`-]*\[ЗАЯВКА\])+/g, "$1").replace(TAG_ITEM_IN, "$1");
      // перед меткой только разметка, номер пункта или слова «служебная строка» — это часть служебной строки, а не ответа клиенту; кавычка или скобка, открытая перед меткой, — тоже
      if (!head.replace(TAG_LABEL, "").replace(/[\s*_`~>«"“„'(\[{:.—–#•·\d)\\-]/g, "")) head = "";
      else { const h = rtrimSet(head, TAG_TRAIL + "«\"“„'([{"); if (h.length < head.length) head = h + " "; }
      // в конце строки — разметка и закрывающая скобка или кавычка без пары: они остались от «[ЗАЯВКА: …]», ««[ЗАЯВКА] …»», «**[ЗАЯВКА] …**»
      const cnt = /** @param {string} ch */ ch => tail.split(ch).length - 1, over = TAG_PAIRS.map(([o, c]) => cnt(c) - cnt(o));
      let end = tail.length, odd = cnt('"') % 2;
      for (let go = true; go;) {
        while (end > 0 && TAG_TRAIL.includes(tail[end - 1])) end--;
        const p = TAG_PAIRS.findIndex(([, c], k) => over[k] > 0 && tail[end - 1] === c);
        go = p >= 0 || (odd === 1 && tail[end - 1] === '"');
        if (p >= 0) over[p]--; else if (go) odd = 0;
        if (go) end--;
      }
      tail = tail.slice(0, end);
      // поля столбиком: за меткой идут строки «Ключ: значение» — с номерами, после пустой строки, с незнакомым полем между знакомыми
      let j = i + 1;
      if (TAG_ONLY.test(tail)) { let k = j; while (k < lines.length && !lines[k].trim()) k++; if (k < lines.length && TAG_KEY_START.test(lines[k])) j = k; }
      const extra = [], isKey = /** @param {any} x */ x => TAG_KEY_START.test(x || ""), isField = /** @param {any} x */ x => TAG_FIELD_LINE.test(x || "");
      for (; j < lines.length; j++) {
        if (isKey(lines[j])) tail += (/\]$/.test(tail) ? " " : "; ") + lines[j].replace(TAG_ITEM_HEAD, "").trim();
        else if (isField(lines[j]) && (isKey(lines[j + 1]) || (isField(lines[j + 1]) && isKey(lines[j + 2])))) extra.push(lines[j].replace(TAG_ITEM_HEAD, "").trim());
        else break;
      }
      if (extra.length) tail += "; Комментарий: " + extra.join(", "); // незнакомые поля не теряются: администратор увидит их в заявке
      i = j - 1;
      ln = head + tail;
    }
    out.push(ln);
  }
  // «[ЗАЯВКА]» без полей, а строкой ниже «[ЗАЯВКА] Имя: …» — это одна служебная строка. С «[ОТМЕНА]» так не делаем: строка отмены без подробностей — отдельная просьба
  for (let k = out.length - 2; k >= 0; k--) {
    if (!/^\s*\[ЗАЯВКА\]\s*$/.test(out[k])) continue;
    let n = k + 1; while (n < out.length && !out[n].trim()) n++;
    if (n < out.length && out[n].trimStart().startsWith("[ЗАЯВКА]")) out.splice(k, 1);
  }
  return out.join("\n");
}
// служебные строки: от метки до конца строки или до следующей метки; пометки вида ** и ` не мешают
/** @param {any} s @param {string} name */
export const tagsOf = (s, name) => [...new Set([...String(s || "").replace(/\*\*|__|`/g, "").matchAll(new RegExp("\\[\\s*" + name + "\\s*\\]((?:(?!\\[\\s*(?:ЗАЯВКА|ОТМЕНА)\\s*\\])[^\\n])*)", "gi"))].map(m => m[1].trim()))];
