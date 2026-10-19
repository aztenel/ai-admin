// @ts-check
// Слой 3 — защита ответа ИИ: цены только из фактов, время только из свободных окон, телефоны и ссылки только из фактов (checkReply), кнопки-подсказки времени (offers).
/** @import { Client, Ctx } from "../../lib/types.js" */
import { local, mins } from "../../lib/time.js";
import { lowE } from "../../lib/text.js";
import { normPhone, phonesIn } from "../../lib/phone.js";
import { hStr, getSlots } from "../schedule/slots.js";
import { altNamed } from "../booking/pick.js";
import { fitStarts, nearest } from "../booking/fit.js";
import { altDateOf, dowsIn, tagsOf, tagFields } from "./tags.js";

/** @param {any} s @returns {string} */
export const findPhone = s => (phonesIn(s)[0] || {}).phone || "";

/** @param {any} s @returns {string[]} */
const digits = s => (String(s).match(/\d[\d\s ]*\d|\d/g) || []).map(x => x.replace(/[\s ]/g, ""));
const NUMWORDS = /(один|два|три|четыре|пять|шесть|семь|восемь|девять|десять|двадцать|тридцать|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто|сто|двести|триста|четыреста|пятьсот|шестьсот|семьсот|восемьсот|девятьсот|полтор)[а-я]*\s+(тысяч|миллион|тенге|тг)/i;
// то же по-казахски и по-английски — только вместе с валютой: «жиырма мың теңге», «twenty thousand tenge» («екі мың жиырма алтыншы жыл» — это год)
const NUMWORDS_KK = /(?<![а-яёәғқңөұүһі])(бір|екі|үш|төрт|бес|алты|жеті|сегіз|тоғыз|он|жиырма|отыз|қырық|елу|алпыс|жетпіс|сексен|тоқсан|жүз)\s+(мың\s+(\S+\s+){0,2}?)?(теңге|тг(?![а-яёәғқңөұүһі])|₸)/i;
const NUMWORDS_EN = /(?<![a-z])(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\s+((thousand|million)\s+(\S+\s+){0,2}?)?(tenge|kzt|₸)/i;

// ---- цены в ответе ИИ. Цену пишут по-разному: «20 000 ₸», «20,000 KZT», «20.000 тг», «20 тыс. тенге», «20к», «стоит 20 000» — число сверяем с фактами в любой записи.
// Число: разряды через пробел, запятую или точку либо слитно; дробная часть — одна-две цифры («9,5 тыс.»). После времени («10:00 100 ₸») разряды не склеиваем
const NUM_G = /(?<![\d:])([1-9]\d{0,2}(?:[\x20\u00a0\u202f.,]\d{3})+)(?!\d)(?:[.,](\d{1,2})(?!\d))?|(\d+)(?:[.,](\d{1,2})(?!\d))?/g;
/** @param {any} s */
function numsIn(s) {
  /** @type {{ at: number, end: number, raw: string, n: string, v: number }[]} */
  const out = [];
  for (const m of String(s).matchAll(NUM_G)) {
    const int = (m[1] || m[3]).replace(/\D/g, ""), frac = (m[2] || m[4] || "").replace(/0+$/, "");
    out.push({ at: m.index, end: m.index + m[0].length, raw: m[0], n: frac ? int + "." + frac : int, v: +(frac ? int + "." + frac : int) });
  }
  return out;
}
const P_SP = "[ \\u00a0\\u202f]";
const P_CUR_SRC = "₸|₽|\\$|€|тенге|теңге|тңг|тнг(?![а-яёәғқңөұүһі])|тг(?![а-яёәғқңөұүһі])|kzt(?![a-z])|tenge|tg(?![a-z])|руб(?:\\.|л[а-яё]*)?(?![а-яё])|usd(?![a-z])|доллар|евро(?![а-яё])|eur(?:os?)?(?![a-z])";
const P_CUR = new RegExp("^" + P_SP + "*(?:" + P_CUR_SRC + ")", "i");
// «12 000 т.» — тенге, но только после числа от тысячи («5 т» — это тонны, «т.е.» и «т.к.» — не валюта)
const P_CUR_T = new RegExp("^" + P_SP + "*т(?![а-яёәғқңөұүһіa-z])(?!\\.[а-яё])", "i");
// знак валюты перед числом: «$50», «KZT 12,000». Если перед знаком уже стоит число («6,000 KZT 60 minutes»), знак относится к нему
const P_CUR_PRE = new RegExp("(?:^|[^\\d \\u00a0\\u202f])" + P_SP + "*(?:[$€]|(?<![a-zа-яё])(?:kzt|usd|eur))" + P_SP + "*$", "i");
// множитель: «тыс.», «тысяч», «мың», «млн». «к» и «k» — когда стоят вплотную к числу («12к»; «дом 10к2» — корпус, «12кг» — мера) либо через пробел,
// но дальше не слово и не число: «12 к.» — цена, а «в 10 к мастеру», «к 22:00 к Ерлану» и «2 к 1» — предлог
const P_MULT = new RegExp("^(?:" + P_SP + "*(тыс[а-яё]*\\.?|мың[а-яёәғқңөұүһі]*|thousand)|" + P_SP + "*(млн\\.?|миллион[а-яё]*|million|mln(?![a-z]))|([кk])(?![а-яёәғқңөұүһіa-z\\d])|" + P_SP + "+([кk])(?=" + P_SP + "*(?:$|[.,;:!?)»\"”\\n—–-]|" + P_CUR_SRC + ")))", "i");
// после числа стоит не валюта, а мера: «10 тыс. км», «от 1000 гостей», «каждые 7 500 км», «2019 года», «1600 или 2000 кубов» — это не цена.
// Часов, дней и месяцев в списке нет: цену называют и «за месяц»
const P_UNIT_SRC = "(?:%|км|кв\\.|м²|м2|мл|кг|шт|лет(?![а-яё])|год|г\\.|гост|человек|чел\\.|персон|мест(?![а-яё])|балл|раз(?![а-яё])|слов(?![а-яё])|знак|клиент|ученик|адам|қонақ|жыл"
  + "|куб|см³|см3|л\\.с|метр|мм(?![а-яё])|ккал|оборот|вспыш|импульс|бонус|пациент|студент|посетител|участник|подписчик|отзыв|km(?![a-z])|kg(?![a-z])|ml(?![a-z])|guests?(?![a-z])|people|persons?(?![a-z])|years?(?![a-z])|seats?(?![a-z]))";
const P_UNIT = new RegExp("^" + P_SP + "*" + P_UNIT_SRC, "i");
const P_UNIT_NEXT = new RegExp("^" + P_SP + "*(?:[–—-]|до|to|или|or)" + P_SP + "*(\\d[\\d \\u00a0\\u202f.,]*?)" + P_SP + "*" + P_UNIT_SRC, "i");
// мера после числа v: сразу («10 000 км») или у следующего числа того же ряда («7 500–10 000 км», «1600 или 2000 кубов»). Ряд идёт по возрастанию: «13 000 — 150 гостей» — это цена и число гостей
/** @param {string} after @param {number} v */
const unitAfter = (after, v) => { if (P_UNIT.test(after)) return true; const m = P_UNIT_NEXT.exec(after); return !!m && +m[1].replace(/\D/g, "") >= v; };
const P_RANGE = new RegExp("^" + P_SP + "*(?:[–—-]|до|to)" + P_SP + "*$", "i"); // «от 4 000 до 5 000 ₸», «4 000 — 5 000 ₸»: цена — оба числа
const P_RANGE_SMALL = new RegExp("^(?:[–—-]|" + P_SP + "+(?:до|to)" + P_SP + "+)$", "i"); // «6–8 тыс.», «от 6 до 8 тыс.»: тире — только вплотную к числам
// слова о цене перед числом без знака валюты. «от», «всего» и «from» — только вплотную к числу, после остальных — не больше пяти слов без цифр в том же предложении («стоимость мужской стрижки у нас — 12 000»)
const P_WORD_G = /(?<![а-яёәғқңөұүһіa-z])(от|всего|from|сто(?:ит|ят|ить|ил[аои]?)|стоимост[а-яё]*|цен[аыуе]?|ценой|ценник[а-яё]*|обойд[её]тся|обойдутся|выйдет|составит|составляет|итого|сумм[аыуе]|бағасы|құны|costs?|priced?|prices|total)(?![а-яёәғқңөұүһіa-z])/gi;
const P_WORD_ADJ = /^(от|всего|from)$/i, P_WORD_ONE = new RegExp("^(?:" + P_WORD_G.source + ")$", "i");
const P_AFTER = new RegExp("^" + P_SP + "*-?(?:нан|нен|дан|ден|тан|тен)?" + P_SP + "*(?:тұрады|турады|бастап|басталады)", "i"); // по-казахски слово о цене стоит после числа: «12 000 тұрады»
const P_NUMBER_OF = /(?:№|#|n°|номер[а-яё]*|код[а-яё]*|заказ[а-яё]*)[ \u00a0]*[:№#]?[ \u00a0]*$/i; // «запись № 777001» — номер, а не цена
const P_MODEL = /(?:^|[^A-Za-zА-Яа-яЁё0-9-])([A-Z][A-Za-z0-9-]*|[А-ЯЁ]{2,})[ \u00a0]+$/;                 // «Peugeot 3008», «ВАЗ 2114» — модель, которую назвал клиент
const P_MODEL_RU = /(?:^|[^а-яё])(?:лад[аыуе]|ваз|газ|газел[ьи]|нив[аыуе]|приор[аыуе]|грант[аыуе]|вест[аыуе]|калин[аыуе]|волг[аиу]|жигули|уаз|камаз|москвич[а-яё]*|пежо)[ \u00a0]+$/i; // то же строчными и по-русски: «ваз 2114», «Лада 2107», «Газель 3302»
/** @param {string} s @param {any} t */
const isModel = (s, t) => { const b = s.slice(Math.max(0, t.at - 40), t.at), m = P_MODEL.exec(b); return (!!m && !P_WORD_ONE.test(m[1])) || P_MODEL_RU.test(b); }; // число сразу после названия машины
// что за число стоит в тексте на месте t: множитель k (1 — цена без множителя) либо 0 — не цена по знаку валюты
/** @param {string} s @param {any} t @returns {number} */
function priceMark(s, t) {
  const after = s.slice(t.end, t.end + 28), m = P_MULT.exec(after), rest = m ? after.slice(m[0].length) : after;
  if (P_CUR.test(rest) || (!m && t.v >= 1000 && P_CUR_T.test(rest)) || P_CUR_PRE.test(s.slice(Math.max(0, t.at - 8), t.at))) return m ? (m[2] ? 1e6 : 1e3) : 1;
  return m && !P_UNIT.test(rest) ? (m[2] ? 1e6 : 1e3) : 0;
}
// год («2026», «с 2020 по 2024»: десять лет назад — пять вперёд), цифры телефона и номер записи или заказа — не цена, даже если рядом стоит слово о цене или знак «—» перед ценой
/** @param {string} s @param {any} t @param {number} year @param {any[]} spans */
const notPrice = (s, t, year, spans) => (/^\d{4}$/.test(t.raw) && t.v >= year - 10 && t.v <= year + 5) || spans.some(x => t.at >= x[0] && t.end <= x[1]) || P_NUMBER_OF.test(s.slice(Math.max(0, t.at - 24), t.at));
// число от 1000 без знака валюты: цена, если рядом слово о цене. Мера («км», «гостей») и модель машины — не цена
/** @param {string} s @param {any} t @param {number} year @param {any[]} spans */
function barePrice(s, t, year, spans) {
  if (t.v < 1000 || t.n.includes(".") || notPrice(s, t, year, spans)) return false;
  const before = s.slice(Math.max(0, t.at - 96), t.at), after = s.slice(t.end, t.end + 40);
  if (unitAfter(after, t.v)) return false;
  if (P_AFTER.test(after)) return true;
  if (isModel(s, t)) return false;
  const sent = /** @type {string} */ (before.split(/[.!?\n]/).pop());
  for (const m of sent.matchAll(P_WORD_G)) {
    const gap = sent.slice(m.index + m[0].length), words = (gap.match(/[A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]+/g) || []).length;
    if (!/\d/.test(gap) && words <= (P_WORD_ADJ.test(m[1]) ? 0 : 5)) return true;
  }
  return false;
}
// цены в тексте по порядку: [{ n — число строкой, как его сверять с фактами }]
/** @param {string} s @param {number} year @param {any[]} spans */
function pricesIn(s, year, spans) {
  const toks = numsIn(s), marks = toks.map(t => priceMark(s, t)), /** @type {{ n: string }[]} */ out = [];
  toks.forEach((t, i) => {
    let k = marks[i];
    // начало промежутка: «4 000–5 000 ₸» — цена и первое число; «6–8 тыс.», «от 6 до 8 тыс.» — множитель общий (тире здесь без пробелов: «в 10:00 — 6 тыс. ₸», «Вариант 1 — 6 тыс. ₸» — не промежуток);
    // «10–15 000 ₸» — первое число не трогаем; «Peugeot 3008 — 8 000 ₸» — модель и цена
    if (!k && marks[i + 1] && !notPrice(s, t, year, spans) && !isModel(s, t)) {
      const gap = s.slice(t.end, toks[i + 1].at);
      if (t.v >= 1000) k = P_RANGE.test(gap) ? 1 : 0;
      else if (marks[i + 1] > 1 && P_RANGE_SMALL.test(gap)) k = marks[i + 1];
    }
    if (!k && barePrice(s, t, year, spans)) k = 1;
    if (k) out.push({ n: k > 1 ? String(Math.round(t.v * k)) : t.n });
  });
  return out;
}
// числа из фактов, с которыми сверяется цена: и как написаны («6 000»), и с множителем («6 тыс.» → 6000)
/** @param {string} facts */
function factNums(facts) {
  const set = new Set(digits(facts));
  for (const t of numsIn(facts)) set.add(t.n);
  for (const p of pricesIn(facts, 0, [])) set.add(p.n);
  return set;
}
const PHONE_LOOSE = /(?:\+?[78])[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g; // всё, что похоже на номер телефона, даже с несуществующим кодом («+7 000 000 00 00»)
// адреса сайтов и почты в тексте: «demo-dent.kz», «kaspi.kz/pay/…», «info@demo.kz» — целиком, строчными буквами
/** @param {string} s */
function siteToks(s) {
  const low = lowE(s), /** @type {string[]} */ out = [];
  for (const m of low.matchAll(/\.(?:kz|com|ru)\b/g)) {
    const left = /** @type {RegExpMatchArray} */ (low.slice(Math.max(0, m.index - 80), m.index).match(/[^\s,;()«»"“”<>]*$/))[0], right = /** @type {RegExpMatchArray} */ (low.slice(m.index + m[0].length, m.index + m[0].length + 80).match(/^(?:\/[^\s,;()«»"“”<>]*)?/))[0];
    out.push((left + m[0] + right).replace(/[.!?:]+$/, ""));
  }
  return out;
}
// есть ли в ответе адрес, которого нет в фактах. Не ссылка: адрес, который слово в слово стоит в фактах («hello@salon.kz»), и название сервиса из фактов
// с «.kz» без пути («Kaspi.kz», когда в фактах есть Kaspi). Слово, которое в фактах стоит только внутри адреса, названием сервиса не считается: «info@salon.kz» и «salon.kz» — выдумка
/** @param {string} r @param {string} facts */
function siteIn(r, facts) {
  const found = siteToks(r);
  if (!found.length) return false;
  const own = new Set(siteToks(facts)), words = new Set();
  for (const chunk of lowE(facts).split(/\s+/)) if (!/@|\.(?:kz|com|ru)\b/.test(chunk)) for (const w of chunk.match(/[a-zа-яәғқңөұүһі0-9]+/g) || []) words.add(w);
  return found.some(t => !own.has(t) && !(/^[a-zа-яәғқңөұүһі0-9-]{3,}\.(?:kz|com|ru)$/.test(t) && words.has(t.replace(/\.[a-z]+$/, ""))));
}

/** @param {Client} c @param {Ctx} ctx @param {string} userText */
function allowedTimes(c, ctx, userText) {
  const t = new Set();
  for (const s of getSlots(c, ctx)) s.times.forEach(x => t.add(x));
  for (const x of ctx.extraTimes || []) t.add(x);
  const prof = ctx.profile || {}; // время собственных записей и заявок клиента — не выдумка
  for (const b of [...(prof.bookings || []), ...(prof.pend || []), ...(prof.leads || [])]) if (b && b.time) t.add(b.time); // leads — заявки чата обычного клиента: за час до визита их времени уже нет в свободных окнах
  // часы работы: у клиента с расписанием Altegio они проходят только как «с 9:00 до 21:00» (см. checkReply), иначе ИИ мог бы предложить запись на 21:00
  if (!ctx.softTimes) for (const h of c.hours) if (h) { t.add(hStr(h[0])); t.add(hStr(h[1])); }
  for (const m of userText.matchAll(/(?:^|[^\d])(\d{1,2})(?:\s*[:.\s]\s*(\d{2}))?(?!\d)/g)) {
    const h = +m[1]; if (h > 23) continue; t.add(`${h}:${m[2] || "00"}`); t.add(`${h}:00`); t.add(`${h}:30`);
  }
  return t;
}

// «не поместится», «занято», «к сожалению» — бот как раз говорит, что время не подходит
const FIT_NO = /не\s*(поме|получ|успе|подой|подход|свобод|выйдет|может|сможем)|нельзя|занят|к\s+сожалению|увы|unfortunately|won['’]t|not\s+(fit|available|free)|болмайды|сыймайды|бос\s+емес/i;
// о мастере сказано, что он не работает: «у Тони выходной», «Тони не работает», «Тони демалыста»
const STAFF_OFF = /выходн|не\s*работа|не\s*выход|отдыха|в\s+отпуске|демалыс|жұмыс\s+істемей|day\s*off|is\s+off|not\s+working|doesn['’]?t\s+work|isn['’]?t\s+working/i;
// бот говорит, что нельзя, другими словами: «нет свободного времени», «окна нет», «уже есть запись», «не сможет», «не могу», «бос уақыты жоқ»,
// «no free slots» (проверка 19.10.2026: такие верные ответы защита отклоняла, а потом отвечала кодом «на 15:00 не получится»)
const NEG_MORE = /нет\s+(свобод|окон|окна|окош|времени|мест)|(окон|окна|окошка|времени|мест)\s+(уже\s+)?нет|уже\s+(есть\s+)?запис|не\s*смож|не\s*мог|(уақыт|орын|терезе)\S*\s+жоқ|\bno\s+(free|open|available)?\s*(slots?|time|availability|windows?)\b|has\s+no\s+free|fully\s+booked/i;
// о мастере в его части предложения сказано, что у него нельзя («Тони не сможет», «у Тони уже есть запись», «Тони работает только до обеда»)
const STAFF_NO = new RegExp(FIT_NO.source + "|" + NEG_MORE.source + "|работа\\S*\\s+только\\s+до", "i");
// перед именем — «кроме», «вместо»: «свободны все, кроме Тони», «вместо Тони могу к Рауану» — Тони не предложение
const PRE_NO = /(кроме|вместо|помимо|except|instead\s+of|apart\s+from|other\s+than)\s+(у\s+|к\s+|как\s+у\s+)?$/i;
// «к любому свободному», «у других барберов» — мастера выберет система, имя не предложение
const STAFF_ANY = /(^|[^а-яё])любо(й|го|му)(?![а-яё])|(^|[^a-z])any(one)?(?![a-z])|кез\s+келген|(^|[^а-яё])друг(ой|ая|ие|их|им|ими|ому|ого)\s+(мастер|барбер)|other\s+(barber|master|specialist)|басқа\s+шебер/i;
// где в предложении названы мастера: [{ x, at, end }] по порядку
/** @param {any[]} staff @param {string} s */
// Казахские местный и исходный падежи («Тониде бос уақыт бар», «Рауаннан», «Айдоста») имя не узнаёт — пробуем без окончания (проверка 19.10.2026)
const KK_CASE = /(да|де|та|те|дан|ден|тан|тен|нан|нен)$/i;
/** @param {any[]} staff @param {string} s */
const staffAt = (staff, s) => [...s.matchAll(/[\p{L}]+/gu)].flatMap(w => staff.filter(/** @param {any} x */ x => altNamed([x], w[0]) || (KK_CASE.test(w[0]) && altNamed([x], w[0].replace(KK_CASE, ""))))
  .map(/** @param {any} x */ x => ({ x, at: w.index || 0, end: (w.index || 0) + w[0].length })));
// у мастера ms[i] в предложении s нельзя (выходной, занят, «нет свободного», «кроме Тони») — он не предложение
/** @param {string} s @param {any[]} ms @param {number} i @param {number} tEnd */
const staffNo = (s, ms, i, tEnd) => { const seg = staffSeg(s, ms, i, tEnd); return STAFF_OFF.test(seg) || STAFF_NO.test(seg) || PRE_NO.test(s.slice(Math.max(0, ms[i].at - 30), ms[i].at)); };
// что сказано о мастере ms[i] в предложении s: от начала его части (запятая, тире), но не раньше прошлого имени и времени (конец времени — tEnd,
// нет — -1), — до следующего имени. «У Тони в понедельник выходной, а у Рауана в 15:00 свободно»: у Тони — «выходной», у Рауана — нет.
// Эмодзи тоже делит части: «У Тони в 15:00 занято 🙏 В это время свободен Рауан» — «занято» не о Рауане (проверка 19.10.2026)
/** @param {string} s @param {any[]} ms @param {number} i @param {number} tEnd */
function staffSeg(s, ms, i, tEnd) {
  const v = ms[i], from = Math.max(i ? ms[i - 1].end : 0, tEnd >= 0 && tEnd <= v.at ? tEnd : 0), pre = s.slice(from, v.at), cut = [...pre.matchAll(/[,;:]\s|\s[—–-]\s|\p{Extended_Pictographic}️?\s*/gu)].pop();
  return (cut ? pre.slice((cut.index || 0) + cut[0].length) : pre) + s.slice(v.at, ms[i + 1] ? ms[i + 1].at : s.length);
}
// full — весь ответ ИИ вместе со служебными строками [ЗАЯВКА] и [ОТМЕНА] (reply — без них)
/** @param {Client} c @param {string} reply @param {string} userText @param {Ctx} ctx @param {string} [full] */
export function checkReply(c, reply, userText, ctx, full = "") {
  let r = reply.replace(/\*\*|__|`|^#+\s*/gm, "").replace(/^\s*[-•*]\s+/gm, "").replace(/\n{2,}/g, "\n").trim();
  if (/ПРАВИЛА \(они важнее|Факты \(других|Свободные окна для записи \(|\{TOPIC\}|важнее любых слов|Запись в расписание \(важнее|Услуги для записи \((других нет|показана часть)|Итог записи, отмены и переноса|Одна строка \[ЗАЯВКА\]|Если клиент хочет именно к мастеру|У компании электронное расписание, запись|к нему записывай только на это время|Услуга: точное название из списка|добавь последней отдельной строкой|клиенту сообщает система|До записи узнай услугу|Если клиент просит день, которого нет|Время окончания услуги не называй|Время конкретного мастера появится в подсказке|время на этот день не называй|предложи другого мастера или время из|Уже известно о клиенте|Ты — AI-администратор компании|ЯЗЫК: клиент пишет/i.test(r)) return { text: r, why: "leak" };
  const allowed = factNums(c.facts); // цена — только из фактов: число, которое назвал клиент («сделаете за 12 000?»), ценой не становится
  const phoneSpans = [...phonesIn(r).map(p => [p.at, p.at + p.len]), ...[...r.matchAll(PHONE_LOOSE)].map(m => [m.index, m.index + m[0].length])]; // цифры телефона — не цена
  for (const p of pricesIn(r, local(ctx.nowMs || Date.now()).getUTCFullYear(), phoneSpans)) if (!allowed.has(p.n)) return { text: r, why: "цена " + p.n };
  if (NUMWORDS.test(r) || NUMWORDS_KK.test(r) || NUMWORDS_EN.test(r)) return { text: r, why: "цена словами" };
  const times = allowedTimes(c, ctx, userText);
  /** @type {any} */
  const hours = ctx.softTimes ? new Set(c.hours.filter(Boolean).flatMap(/** @param {number[]} h */ h => [hStr(h[0]), hStr(h[1])])) : null;
  /** @param {string} x */
  const nt = x => x.replace(/^0(\d)/, "$1");
  // слова о свободном времени и записи: рядом с ними время должно быть из расписания
  const FREE = /свобод|окн|окош|есть\s+время|free|available|slot|(^|[^а-яёәғқңөұүһі])бос(?![а-яёәғқңөұүһі])/i;
  // расписание Altegio: кроме свободного времени, в ответе могут стоять часы работы и время окончания услуги — но только как таковые, а не как время записи
  /** @type {any} */
  const free = ctx.softTimes ? new Set([...getSlots(c, ctx).flatMap(s => s.times), ...(ctx.extraTimes || [])]) : null;
  const durKnown = !!(ctx.durations && ctx.durations.size);
  const RANGE = "(?:[–—-]|до|по|to|till|until|-?(?:ден|дан|тен|тан|нен|нан))";
  const WORK = /работа|открыт|открыва|откро|закрыт|закрыва|закро|график|режим|ежедневно|без\s+выходных|круглосуточно|open|clos|hours|daily|жұмыс|ашық|ашыла|жабыл|жабық/i;
  const BOOKW = /запис|запиш|могу|можем|можно|подойд[её]т|удобн|предлага|вариант|ближайш|приход|подход|подъезжа|жд[её]м|book|come|arrive|how\s+about|жаз|кел/i;
  const OFFER = /свобод|окн|окош|(^|[^а-яё])есть\s+(время|окн|мест|вариант|запис|\d)|выбира|вариант|могу|можем|можно|запиш|запис|предлага|подойд|(^|\s)или\s|либо|free|available|slot|choose|either|\sor\s|(^|[^а-яёәғқңөұүһі])бос(?![а-яёәғқңөұүһі])/i;
  const DURW = /законч|освобод|будете\s+свободн|займ[её]т|занима|длится|продлится|finish|done\s+by|takes|lasts|until|бітеді|аяқтала|алады/i;
  const replyTimes = ctx.softTimes ? (r.match(/\d{1,2}:\d{2}/g) || []).map(nt) : [];
  // где стоит время m: предложение до него, часть предложения, начало промежутка «T1 – T» и конец «T – T2»
  /** @param {RegExpMatchArray} m */
  const spot = m => {
    const before = r.slice(0, m.index), after = r.slice((m.index || 0) + m[0].length), head = /** @type {string} */ (before.split(/[.!?\n]/).pop());
    const clause = head.split(/[,;:]\s|\s[—–-]\s/).pop() + m[0] + after.split(/[.!?\n]|[,;:]\s|\s[—–-]\s/)[0]; // часть предложения, в которой стоит это время
    const p = before.match(new RegExp("(\\d{1,2}:\\d{2})\\s*" + RANGE + "\\s*$", "i")), t1 = p ? nt(p[1]) : "";               // «T1 – T», «с T1 до T», «T1-ден T-ге дейін»
    const q = after.match(new RegExp("^(?:-?(?:ден|дан|тен|тан|нен|нан))?\\s*" + RANGE + "\\s*(\\d{1,2}:\\d{2})", "i")), t2 = q ? nt(q[1]) : ""; // «T – T2»
    return { before, after, head, clause, p, t1, t2 };
  };
  // часы работы: «с 9:00 до 21:00» целиком либо оборот о работе («открыты с 9:00», «к 21:00 закрываемся»), в котором нет слов о записи
  /** @param {string} t @param {ReturnType<typeof spot>} x */
  const workHours = (t, x) => !!hours && hours.has(t) && ((x.t1 && hours.has(x.t1)) || (x.t2 && hours.has(x.t2)) || (WORK.test(x.clause) && !BOOKW.test(x.clause) && !FREE.test(x.clause)));
  for (const m of r.matchAll(/\d{1,2}:\d{2}/g)) {
    const t = nt(m[0]);
    if (times.has(t)) continue;
    if (ctx.softTimes) {
      const sp = spot(m), { before, after, clause, p, t1 } = sp;
      const list = (p && /[–—-]\s*$/.test(before.slice(0, p.index))) || /^\s*[–—-]\s*\d{1,2}:\d{2}/.test(after);               // «9:30 - 10:00 - 10:30» — перечень, а не промежуток
      if (workHours(t, sp)) continue;
      // время окончания услуги: начало свободно, а разница равна длительности услуги (если Altegio её не отдаёт — не больше четырёх часов).
      // «Свободно с 13:00 до 14:30», «есть 10:00–11:30», «в 10:00 или в 10:30» — это уже предложение времени, оно не проходит
      const span = /** @param {string} x */ x => { const d = mins(t) - mins(x); return x !== t && free.has(x) && (durKnown ? ctx.durations.has(d) : d > 0 && d <= 240); };
      const offer = OFFER.test(clause.replace(/(будете|будешь|буду)\s+свободн\S*|освобод\S*|(you['’]ll|you\s+will)\s+be\s+free/gi, " "));
      if ((!durKnown || ctx.softTimes.has(t)) && !offer && ((t1 && !list && span(t1)) || (DURW.test(clause) && replyTimes.some(span)))) continue;
    }
    return { text: r, why: "время " + m[0] };
  }
  // время из строки [ЗАЯВКА] не судим: запись проверяет само расписание с услугой из этой строки (altBook, при переносе — с временем прежней
  // записи свободным), а слова ИИ рядом заменит ответ кода
  const booked = new Set(tagsOf(full, "ЗАЯВКА").map(l => (String(tagFields(l)["время"] || "").match(/(\d{1,2})[:.](\d{2})/) || []).slice(1)).filter(a => a.length).map(a => `${+a[0]}:${a[1]}`));
  // время своей записи или заявки клиента — не предложение: после записи «завтра в 15:00 к Рауану» ответ «ждём вас завтра в 15:00»
  // заменялся ответом кода «на 15:00 не получится — у мастера уже занято» (занято как раз этой записью; проверка 19.10.2026)
  const prof = ctx.profile || {}, ownT = new Set([...(prof.bookings || []), ...(prof.pend || [])].map(/** @param {any} b */ b => b && b.time).filter(Boolean));
  // ИИ предлагает другого мастера вместо выбранного клиентом — в этом ответе или в прошлом, на который клиент ответил, не назвав мастера
  // («свободен Рауан — записать к нему?» → «Да, давайте» → «Записываю вас на 15:00»): фразы без имени — не о выбранном мастере
  // (проверка 19.10.2026: клиент согласился на Рауана, а ответ кода — «у мастера Тони уже занято»)
  const fw0 = ctx.fitWho;
  /** @param {string} x */
  const offersOther = x => !!fw0 && !!fw0.named && x.split(/[.!?\n]/).some(sn => { const ms = staffAt(fw0.staff, sn); return ms.some((v, i) => String(v.x.id) !== fw0.named && !staffNo(sn, ms, i, -1)); });
  const swapped = offersOther(r) || (!!fw0 && !!ctx.lastBot && offersOther(ctx.lastBot) && !staffAt(fw0.staff, ctx.lastUser || "").length);
  // клиент назвал услугу (или не назвал — тогда основную, стрижку), а ИИ называет свободным время, на которое она не помещается
  // (дальше у мастера запись) — переписать ответ.
  // «В 16:30 не поместится», «занято» — можно (живой показ Winchester, 18.10.2026: Premium 1 ч 30 мин на 16:30 при записи в 17:30)
  if (ctx.fitBad && ctx.fitBad.size) for (const m of r.matchAll(/\d{1,2}:\d{2}/g)) {
    const t = nt(m[0]), bad = ctx.fitBad.get(t);
    if (!bad || booked.has(t) || ownT.has(t)) continue;
    const sent = /** @type {string} */ (r.slice(0, m.index).split(/[.!?\n]/).pop()) + m[0] + r.slice((m.index || 0) + m[0].length).split(/[.!?\n]/)[0];
    if (FIT_NO.test(sent) || NEG_MORE.test(sent)) continue; // «занято», «уже есть запись», «нет свободного времени»
    // fitBad при мастере, которого назвал клиент, посчитан по его времени: предложение о другом мастере или «к любому» — не о нём, его судит
    // fitWho (проверка 19.10.2026: «у Тони выходной, могу к Айдосу в 15:00» заменялось ответом кода «у мастера Тони окна нет»)
    if (bad.staff && ctx.fitWho && (swapped || staffAt(ctx.fitWho.staff, sent).some(/** @param {any} v */ v => v.x.name !== bad.staff) || STAFF_ANY.test(sent))) continue;
    if (OFFER.test(sent) || FREE.test(sent) || BOOKW.test(sent)) return { text: r, why: `время ${t}: услуга «${bad.service}» идёт ${bad.long} и в ${t} не помещается — дальше у мастера занято${bad.free.length ? "; ближайшее подходящее время — " + bad.free.join(" или ") : ""}${bad.svc ? ". Клиент услугу точно не назвал, обычно это она: не называй это время подходящим; нужна другая услуга — уточни какая" : ""}`, fit: bad };
  }
  // мастер и время: у мастера, названного в этом предложении (не назван — выбранного клиентом), это время в этот день должно быть свободно.
  // «Свободные окна» — время, когда свободен хоть кто-то. Живая проверка владельца 19.10.2026 (пробный веб-чат Winchester): у мастера выходной,
  // бот назвал его свободным, а на просьбу записать ответил, что мастер не свободен. О мастере на этот день данных нет — не судим
  const fw = ctx.fitWho;
  if (fw) {
    // время из строки [ЗАЯВКА] не судим (booked выше). Длительность в fitWho — из сообщений клиента: перенос стрижки после записи «Отец и сын»
    // судился как «Отец и сын» и не выполнялся (проверка 19.10.2026)
    // день предложения: дата, «завтра», день недели — такой день из прочитанных; named — день назван (даже если о нём данных нет)
    /** @param {string} sn */
    const dayOf = sn => { const iso = altDateOf(sn, ctx.nowMs || Date.now()), dw = dowsIn(sn);
      return { named: !!(iso || dw.length), day: fw.days.includes(iso) ? iso : dw.length === 1 ? fw.days.find(/** @param {string} d */ d => new Date(d + "T00:00:00Z").getUTCDay() === dw[0]) || "" : "" }; };
    // мастера, которого выбрал клиент, ИИ сам назвал не работающим («У Тони в понедельник выходной. В понедельник в 15:00 есть время»):
    // фразы без имени на этот день — не о нём. Дни таких фраз («» — день не назван, значит любой). Фраза о нём без времени, что у него нельзя
    // («У Тони завтра нет свободного времени. Завтра можно в 11:00 или 13:00 — к кому записать?», «Тони завтра весь день занят») — тоже
    // (проверка 19.10.2026: верный ответ заменялся ответом кода «у мастера Тони окна нет», а время других мастеров терялось)
    const offDays = !fw.named ? [] : r.split(/[.!?\n]/).filter(sn => { const ms = staffAt(fw.staff, sn); return ms.some((v, i) => { const seg = staffSeg(sn, ms, i, -1); return String(v.x.id) === fw.named && (STAFF_OFF.test(seg) || (!/\d{1,2}:\d{2}/.test(sn) && STAFF_NO.test(seg))); }); }).map(sn => dayOf(sn).day);
    for (const m of r.matchAll(/\d{1,2}:\d{2}/g)) {
      const t = nt(m[0]), sp = spot(m);
      if (booked.has(t)) continue;
      let sent = sp.head + m[0] + sp.after.split(/[.!?\n]/)[0];
      // перечень столбиком: «в 15:00 свободны мастера:», дальше строки с именами — одно предложение
      if (/:\s*$/.test(sent)) for (const ln of sp.after.split("\n").slice(1)) { if (/\d{1,2}:\d{2}/.test(ln) || !staffAt(fw.staff, ln).length) break; sent += "\n" + ln; }
      // строка столбика без слов о записи («15:00 — Тони, Рауан», «Тони — 15:00»): о ней говорит заголовок над столбиком («Завтра свободно:»)
      let hdr = "";
      for (const ln of sp.before.split("\n").slice(0, -1).reverse()) { if (/:\s*$/.test(ln)) { hdr = ln; break; } if (!/\d{1,2}:\d{2}/.test(ln) && !staffAt(fw.staff, ln).length) break; }
      const offerOf = /** @param {string} x */ x => OFFER.test(x) || FREE.test(x) || BOOKW.test(x), ms = staffAt(fw.staff, sent);
      // «занято», «нет свободного» — бот как раз говорит, что нельзя. Если в предложении названы мастера, судим каждого по его части:
      // «К сожалению, у Рауана выходной, но в 15:00 свободен Тони» — о Тони это предложение (проверка 19.10.2026)
      if ((!ms.length && (FIT_NO.test(sent) || NEG_MORE.test(sent))) || !(offerOf(sent) || (hdr && offerOf(hdr) && !FIT_NO.test(hdr) && !NEG_MORE.test(hdr)))) continue;
      // конец промежутка («с 15:00 до 17:00», «по 17:00», «15:00-ден 17:00-ге дейін», «можно прийти до 17:00») и часы работы — не время записи
      if (sp.t1 || /(^|[^а-яёa-z])(до|по|until|till|up\s+to)\s*$/i.test(sp.head) || /^\s*-?(ге|ға|ке|қа|не|на)?\s*дейін/i.test(sp.after) || workHours(t, sp)) continue;
      // день — из этого предложения, не назван — любой из прочитанных. День назван, а время мастеров на него не читалось («послезавтра»,
      // когда прочитано только «завтра»; Altegio не ответил по другому мастеру), — не судим
      // в предложении дня нет — день, названный раньше в ответе («В понедельник есть время. В 15:00 свободен Тони», заголовок столбика)
      let { named, day } = dayOf(sent);
      if (!named) { const prev = sp.before.split(/[.!?\n]/).reverse().map(dayOf).find(x => x.named); if (prev) ({ named, day } = prev); }
      if (!day && named) continue;
      // мастера этого предложения, кроме тех, о ком сказано «выходной», «не работает»; ни одного — «к любому», «у других барберов» или
      // выбранный клиентом (если ИИ не назвал его самого не работающим в этот день)
      const live = [...new Set(ms.filter((v, i) => !staffNo(sent, ms, i, sp.head.length + m[0].length)).map(v => v.x))];
      const namedOff = offDays.some(d => !d || !day || d === day);
      const who = live.length ? live : ms.length || namedOff || swapped || STAFF_ANY.test(sent) ? [] : fw.staff.filter(/** @param {any} x */ x => String(x.id) === fw.named);
      if (!who.length) continue;
      const days = day ? [day] : fw.days;
      if (!days.length || [...(prof.bookings || []), ...(prof.pend || [])].some(/** @param {any} b */ b => b && b.time === t && (!day || b.date === day))) continue; // своя запись или заявка клиента — не предложение
      /** @type {(x: any, d: string) => string[] | undefined} */
      const list = (x, d) => (fw.lists[String(x.id)] || {})[d];
      const known = who.filter(/** @param {any} x */ x => days.every(/** @param {string} d */ d => list(x, d))); // о мастере на эти дни есть данные
      /** @param {any} x */
      const freeAt = x => days.some(/** @param {string} d */ d => fitStarts(list(x, d) || [], fw.need, fw.step).includes(t));
      // каждый названный мастер должен быть свободен («в 15:00 свободны Тони, Рауан и Айдос» при выходном Тони — неправда о Тони);
      // в предложении несколько времён («в 15:00 Рауан, в 16:00 Тони») — чьё какое, не разобрать: хватит одного свободного
      const many = new Set((sent.match(/\d{1,2}:\d{2}/g) || []).map(nt)).size > 1;
      const bad = many ? (known.length === who.length && !known.some(freeAt) ? known[0] : null) : known.find(/** @param {any} x */ x => !freeAt(x));
      if (!bad) continue;
      const free = day ? nearest(fitStarts(list(bad, day) || [], fw.need, fw.step), t, 2) : [];
      // клиент этого мастера не выбирал — кто свободен в это время: ответ кода называет их, а не «на 15:00 не получится» (проверка 19.10.2026)
      const others = String(bad.id) === fw.named || !day ? [] : fw.staff.filter(/** @param {any} x */ x => x !== bad && fitStarts(list(x, day) || [], fw.need, fw.step).includes(t)).map(/** @param {any} x */ x => x.name);
      return { text: r, why: `время ${t}: у мастера ${bad.name} ${day ? "в этот день " : ""}в ${t} нет свободного времени (не работает или занято)${free.length ? "; его ближайшее время в этот день — " + free.join(" или ") : day ? "; в этот день у него свободного времени нет — предложи другой день или другого мастера" : ""}${others.length ? `; в ${t} свободны: ${others.join(", ")}` : ""}. Время мастера бери только из «Проверки длительности»`,
        fit: { time: t, staff: bad.name, free, long: fw.long, service: fw.service, svc: "", others } };
    }
  }
  // телефон — только из фактов. Номер в фактах и в ответе ищем одинаково (phonesIn): «8 (701) 123-45-67» и «+7-701-123-45-67» — тот же номер, что «+7 701 123 45 67»
  const factPhones = new Set([...phonesIn(c.facts).map(p => p.phone), ...(c.facts.match(/\+7[\d\s]{10,16}/g) || []).map(normPhone), findPhone(userText), ctx.phoneKnown].filter(Boolean));
  if (phonesIn(r).some(p => !factPhones.has(p.phone))) return { text: r, why: "телефон" };
  for (const m of r.matchAll(PHONE_LOOSE)) if (!factPhones.has(normPhone(m[0]))) return { text: r, why: "телефон" };
  if ((/https?:\/\/|www\./i.test(r) || siteIn(r, c.facts)) && !/https?:\/\/|www\./.test(c.facts)) return { text: r, why: "ссылка" };
  if (r.length > 600) r = (r.slice(0, 600).match(/^[\s\S]*[.!?]/) || [r.slice(0, 600)])[0];
  return { text: r, why: null };
}

// какие из предложенных времён показать кнопками
/** @param {Client} c @param {Ctx} ctx @param {string} reply */
export function offers(c, ctx, reply) {
  const free = new Set([...getSlots(c, ctx).flatMap(s => s.times), ...(ctx.extraTimes || [])]);
  return [...new Set((reply.match(/\d{1,2}:\d{2}/g) || []).map(t => t.replace(/^0(\d)/, "$1")).filter(t => free.has(t) && !(ctx.noOffer && ctx.noOffer.has(t))))].slice(0, 3);
}
