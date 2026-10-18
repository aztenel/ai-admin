// @ts-check
// Слой 3 — защита ответа ИИ: цены только из фактов, время только из свободных окон, телефоны и ссылки только из фактов (checkReply), кнопки-подсказки времени (offers).
/** @import { Client, Ctx } from "../../lib/types.js" */
import { local, mins } from "../../lib/time.js";
import { lowE } from "../../lib/text.js";
import { normPhone, phonesIn } from "../../lib/phone.js";
import { hStr, getSlots } from "../schedule/slots.js";

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
/** @param {Client} c @param {string} reply @param {string} userText @param {Ctx} ctx */
export function checkReply(c, reply, userText, ctx) {
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
  for (const m of r.matchAll(/\d{1,2}:\d{2}/g)) {
    const t = nt(m[0]);
    if (times.has(t)) continue;
    if (ctx.softTimes) {
      const before = r.slice(0, m.index), after = r.slice(m.index + m[0].length), head = /** @type {string} */ (before.split(/[.!?\n]/).pop());
      const clause = head.split(/[,;:]\s|\s[—–-]\s/).pop() + m[0] + after.split(/[.!?\n]|[,;:]\s|\s[—–-]\s/)[0]; // часть предложения, в которой стоит это время
      const p = before.match(new RegExp("(\\d{1,2}:\\d{2})\\s*" + RANGE + "\\s*$", "i")), t1 = p ? nt(p[1]) : "";               // «T1 – T», «с T1 до T», «T1-ден T-ге дейін»
      const q = after.match(new RegExp("^(?:-?(?:ден|дан|тен|тан|нен|нан))?\\s*" + RANGE + "\\s*(\\d{1,2}:\\d{2})", "i")), t2 = q ? nt(q[1]) : ""; // «T – T2»
      const list = (p && /[–—-]\s*$/.test(before.slice(0, p.index))) || /^\s*[–—-]\s*\d{1,2}:\d{2}/.test(after);               // «9:30 - 10:00 - 10:30» — перечень, а не промежуток
      // часы работы: «с 9:00 до 21:00» целиком либо оборот о работе («открыты с 9:00», «к 21:00 закрываемся»), в котором нет слов о записи
      if (hours.has(t) && ((t1 && hours.has(t1)) || (t2 && hours.has(t2)) || (WORK.test(clause) && !BOOKW.test(clause) && !FREE.test(clause)))) continue;
      // время окончания услуги: начало свободно, а разница равна длительности услуги (если Altegio её не отдаёт — не больше четырёх часов).
      // «Свободно с 13:00 до 14:30», «есть 10:00–11:30», «в 10:00 или в 10:30» — это уже предложение времени, оно не проходит
      const span = /** @param {string} x */ x => { const d = mins(t) - mins(x); return x !== t && free.has(x) && (durKnown ? ctx.durations.has(d) : d > 0 && d <= 240); };
      const offer = OFFER.test(clause.replace(/(будете|будешь|буду)\s+свободн\S*|освобод\S*|(you['’]ll|you\s+will)\s+be\s+free/gi, " "));
      if ((!durKnown || ctx.softTimes.has(t)) && !offer && ((t1 && !list && span(t1)) || (DURW.test(clause) && replyTimes.some(span)))) continue;
    }
    return { text: r, why: "время " + m[0] };
  }
  // клиент назвал услугу (или не назвал — тогда основную, стрижку), а ИИ называет свободным время, на которое она не помещается
  // (дальше у мастера запись) — переписать ответ.
  // «В 16:30 не поместится», «занято» — можно (живой показ Winchester, 18.10.2026: Premium 1 ч 30 мин на 16:30 при записи в 17:30)
  if (ctx.fitBad && ctx.fitBad.size) for (const m of r.matchAll(/\d{1,2}:\d{2}/g)) {
    const t = nt(m[0]), bad = ctx.fitBad.get(t);
    if (!bad) continue;
    const sent = /** @type {string} */ (r.slice(0, m.index).split(/[.!?\n]/).pop()) + m[0] + r.slice((m.index || 0) + m[0].length).split(/[.!?\n]/)[0];
    if (FIT_NO.test(sent)) continue;
    if (OFFER.test(sent) || FREE.test(sent) || BOOKW.test(sent)) return { text: r, why: `время ${t}: услуга «${bad.service}» идёт ${bad.long} и в ${t} не помещается — дальше у мастера занято${bad.free.length ? "; ближайшее подходящее время — " + bad.free.join(" или ") : ""}${bad.svc ? ". Клиент услугу точно не назвал, обычно это она: не называй это время подходящим; нужна другая услуга — уточни какая" : ""}`, fit: bad };
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
