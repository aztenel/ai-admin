// @ts-check
// Люди в записи: «тот же человек» (имена в падежах, казахские и латинские написания), родство в сообщениях клиента, «клиент говорит о другой записи?» (altOther).
/** @import { Client } from "../../lib/types.js" */
import { nameToks, svWords, svTrim, svStem, svParts } from "../../lib/names.js";
import { lowE } from "../../lib/text.js";
import { mins, hm, isoDay, local } from "../../lib/time.js";
import { altDateOf, MON_RU, MON_KK, MON_EN_RE, dowsIn } from "../conversation/tags.js";

// падежные формы имени: «Тимур» → Тимура, Тимуру…; «Мария» → Марии, Марию…; казахское «Арманға».
// sure — без формы на «-а / -я» у мужских имён: «Александра» — это и «нет Александра», и женское имя
/** @param {string} n @param {boolean} [sure] */
export function nameForms(n, sure) {
  const f = new Set([n]), add = /** @param {string} b @param {string[]} ends */ (b, ends) => ends.forEach(e => f.add(b + e));
  if (n.length < 2) return f;
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(n)) add(n, sure ? ["у", "ом", "е"] : ["а", "у", "ом", "е"]);
  else if (/ия$/.test(n)) add(n.slice(0, -1), ["и", "ю", "ей"]);
  else if (/[гкхжчшщ]а$/.test(n)) add(n.slice(0, -1), ["и", "е", "у", "ой"]);
  else if (/а$/.test(n)) add(n.slice(0, -1), ["ы", "е", "у", "ой"]);
  else if (/я$/.test(n)) add(n.slice(0, -1), ["и", "е", "ю", "ей"]);
  else if (/й$/.test(n)) add(n.slice(0, -1), sure ? ["ю", "ем", "е"] : ["я", "ю", "ем", "е"]);
  else if (/ь$/.test(n)) add(n.slice(0, -1), sure ? ["ю", "ем", "е", "и"] : ["я", "ю", "ем", "е", "и"]);
  add(n, ["га", "ге", "ка", "ке", "нын", "нин", "дын", "дин", "тын", "тин", "ды", "ди", "ты", "ти", "ны", "ни"]); // казахские окончания (буквы уже приведены к русским): Арманға, Арманның, Арманды
  return f;
}

/** @param {string} x */
const tokNorm = x => x.replace(/ь/g, "").replace(/й/g, "и").replace(/э/g, "е").replace(/ия$/, "я"); // «Айгүл» = «Айгуль», «Эльдар» = «Eldar», «Наталья» = «Наталия»
/** @param {string} x @param {string} y */
const tokEq = (x, y) => tokNorm(x) === tokNorm(y);
/** @param {any} s */
export const nameKey = s => tokNorm(nameToks(s)[0] || "");
// один и тот же человек: «Тимур» = «Тимур Ахметов» = «Ахметов Тимур» = «Тимур Ахметов Серикович»; «Тимур Ахметов» ≠ «Тимур Иванов»; «Жанар» ≠ «Жанат», «Али» ≠ «Алихан»
/** @param {any} a @param {any} b */
export const samePerson = (a, b) => {
  const x = nameToks(a), y = nameToks(b);
  if (!x.length || !y.length) return false;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x], glue = /** @param {string[]} v */ v => tokNorm(v.join("").replace(/-/g, ""));
  return s.every(t => l.some(u => tokEq(t, u))) || glue(x) === glue(y); // все слова более короткого имени есть в более длинном; «Анна-Мария» = «Анна Мария»
};
// слово w — имя n в каком-нибудь падеже («Тимура», «Арманға»); сравниваем без «ь» и «й»
// формы имени считаем один раз: мастеров в локации десятки, а сверяется с ними каждое слово клиента
/** @type {Map<string, Set<string>>} */
const FORMS = new Map();
/** @param {string} n @param {boolean} [sure] */
const formSet = (n, sure) => {
  const k = (sure ? "1" : "0") + n;
  let v = FORMS.get(k);
  if (!v) { if (FORMS.size > 4000) FORMS.clear(); v = new Set([...nameForms(n, sure)].map(tokNorm)); FORMS.set(k, v); }
  return v;
};
/** @param {string} n @param {string} w @param {boolean} [sure] */
export const isForm = (n, w, sure) => formSet(n, sure).has(tokNorm(w));
// то же имя в другом падеже: «Тимура» = «Тимур», «Тимура Ахметова» = «Тимур Ахметов»; «Тимур Иванов» ≠ «Тимур Ахметов» (все слова более короткого имени должны найтись в длинном).
// Само по себе не доказательство: «Александра» — и женское имя (sure — только формы, которые женским именем быть не могут)
/** @param {any} a @param {any} b @param {boolean} [sure] */
export const caseName = (a, b, sure) => {
  const x = nameToks(a), y = nameToks(b);
  if (!x.length || !y.length) return false;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.every(p => l.some(q => isForm(p, q, sure) || isForm(q, p, sure)));
};

// ---- клиент говорит о другой записи? rec — запись этого чата { name, date, time, services, staffName }.
// Возвращает причину («время», «день», «человек», «имя», «услуга», «мастер») или пустую строку. Не уверены — считаем, что о другой:
// тогда бот переспросит, а не удалит. o: { nowMs, services (названия услуг локации), staff (мастера локации), skip (слова, которые именем не считаются) },
// mode: "ai" — текст ответа ИИ или служебной строки (только время, день и имя после слова «запись»), "person" — только люди,
// "move" — перенос: люди, а время и день — только сказанные о прежней записи («с 10:00», «запись на 15:00 перенесите»); услуга и мастер — о новой записи.
// o.booking — что записывают этим же сообщением: [{ name, date, time }]
/** @type {Record<string, number>} */
const NUM_RU = { час: 1, один: 1, одного: 1, два: 2, двух: 2, три: 3, трех: 3, четыре: 4, четырех: 4, пять: 5, пяти: 5, шесть: 6, шести: 6, семь: 7, семи: 7, восемь: 8, восьми: 8, девять: 9, девяти: 9, десять: 10, десяти: 10, одиннадцать: 11, одиннадцати: 11, двенадцать: 12, двенадцати: 12 };
const KIN = /(^|[^а-яё])(жен[аыуе]|женой|супруг[а-я]*|муж(а|у|ем)?|сын[а-я]*|доч[а-я]+|реб[её]н[а-я]+|дет(ей|ям|и)|мам[а-я]+|пап[а-я]+|брат[а-я]*|сестр[а-я]+|друг(а|у|ом)?|подруг[а-я]+|коллег[а-я]+|девушк[а-я]+|парн[а-я]+|бабушк[а-я]+|дедушк[а-я]+|отц[а-я]+|отец|матер[а-я]+|внук[а-я]*|внучк[а-я]+|племянни[а-я]+|знаком(ого|ой|ому|ых)|товарищ[а-я]*|начальник[а-я]*|чуж(ую|ая|ой)|не\s+мо[юяе]|друг(ую|ой|ая)\s+запис[а-я]*|втор(ую|ая|ой)\s+запис[а-я]*)(?![а-яё])|(^|[^a-z])(wife|husband|son|daughter|mom|mother|dad|father|friend|brother|sister|kid|child|someone\s+else|(his|her|their)\s+(booking|appointment))(?![a-z])|әйелі?м|күйеуім|ұлым|қызым|анам|әкем|досым|балам|інім|ағам|апам|сіңлім|жолдасым/i;
// «она не придёт», «он заболел»: о себе клиент пишет «не приду», «не смогу»
const THIRD = /(^|[^а-яё])(он|она|они)\s+(не\s+)?(прид|смож|успе|заболе|передума|хоч|будет|может)|(^|[^а-яё])не\s+(прид[её]т|сможет|успеет|придут|смогут|хочет)(?![а-яё])/i;
// какое родство названо: «сына», «жену», «ребёнка»… Запись помнит, как клиент назвал человека, когда записывал его («сына Алихана» → kin: ["son"]):
// тогда «сына перенесите» — о ней же, а «запись жены» — о другой
const KIN_G = new RegExp(KIN.source, "gi");
/** @param {string} w0 */
const kinClass = w0 => { const w = lowE(w0).replace(/^[^a-zа-яәғқңөұүһі]+/, "");
  return /^жен|^wife|^әйел/.test(w) ? "wife" : /^муж|^husband|^күйеу|^жолдас/.test(w) ? "husband" : /^супруг/.test(w) ? "spouse" : /^сын|^son$|^ұл/.test(w) ? "son" : /^доч|^daughter|^қыз/.test(w) ? "daughter"
    : /^реб|^дет|^kid|^child|^бала/.test(w) ? "child" : /^мам|^матер|^mom|^mother|^ана/.test(w) ? "mother" : /^пап|^отц|^отец|^dad|^father|^әке/.test(w) ? "father" : /^брат|^brother|^іні|^аға/.test(w) ? "brother"
    : /^сестр|^sister|^апа|^сіңлі/.test(w) ? "sister" : /^друг(а|у|ом)?$|^подруг|^friend|^дос/.test(w) ? "friend" : /^бабушк/.test(w) ? "grandma" : /^дедушк/.test(w) ? "grandpa" : /^внук|^внучк/.test(w) ? "grandchild"
    : /^племянни/.test(w) ? "nephew" : /^коллег/.test(w) ? "colleague" : /^девушк/.test(w) ? "girl" : /^парн/.test(w) ? "guy" : /^знаком/.test(w) ? "known" : /^товарищ/.test(w) ? "mate" : /^начальник/.test(w) ? "boss" : "other"; };
/** @type {Record<string, string[]>} */
const KIN_WIDE = { child: ["son", "daughter"], spouse: ["wife", "husband"] };
/** @param {string} a @param {string} b */
const kinSame = (a, b) => a === b || (KIN_WIDE[a] || []).includes(b) || (KIN_WIDE[b] || []).includes(a);
// слова о родстве в тексте: k — какое родство, nw и pw — слово сразу после и сразу перед («сына Алихана», «Алихан — мой сын»)
const KIN_L = "A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі";
const KIN_NEXT = new RegExp("^\\s+(?:(?:зовут|по\\s+имени|моего|мою|моей|нашего|нашу|нашей|my|our)\\s+)*([" + KIN_L + "][" + KIN_L + "-]+)");
const KIN_PREV = new RegExp("([" + KIN_L + "][" + KIN_L + "-]+)\\s*[,—–-]?\\s*(?:(?:это|мой|моя|мое|моё|наш|наша|is|my)\\s+)*$", "i");
const KIN_HEAD = new RegExp("^[^" + KIN_L + "]+");
/** @param {any} text */
function kinHits(text) {
  const raw = String(text || ""), /** @type {{ k: string, nw: string, pw: string }[]} */ out = [];
  for (const m of raw.matchAll(KIN_G)) {
    const word = m[0].replace(KIN_HEAD, ""), at = m.index + m[0].length - word.length;
    out.push({ k: kinClass(word), nw: (raw.slice(at + word.length).match(KIN_NEXT) || [])[1] || "", pw: (raw.slice(0, at).match(KIN_PREV) || [])[1] || "" });
  }
  return out;
}
/** @param {any} t */
const kinsIn = t => [...new Set(kinHits(t).map(h => h.k))];
// родство рядом с именем в сообщениях клиента: «сына Алихана», «жену зовут Айгуль», «Алихан — мой сын». others — другие имена этого чата;
// wide — если рядом с именем слова нет, годится единственное родство, названное в этих сообщениях («Запишите сына» → «Алихан»)
/** @param {any[]} texts @param {string} name @param {string[]} [others] @param {boolean} [wide] */
export function kinNear(texts, name, others = [], wide = false) {
  /** @type {Set<string>} */
  const near = new Set(), all = new Set();
  for (const t of texts) for (const h of kinHits(t)) {
    if (h.k === "other") continue;
    all.add(h.k);
    if (h.nw && caseName(name, h.nw)) near.add(h.k);
    else if (h.pw && caseName(name, h.pw) && !(h.nw && others.some(o => caseName(o, h.nw)))) near.add(h.k);
  }
  return near.size ? [...near] : wide && all.size === 1 ? [...all] : [];
}
export const AFTER_STOP = new Set("пожалуйста плиз пж мою моя моей мне я вы вас вам эту эта эти ту та свою нашу наша которую которая которые что если а и но не уже больше была будет было были нужно надо можно хочу сделал сделала делал делала оформлял оформляла вчера сегодня завтра послезавтра утром днем вечером ночью сюда онлайн через там тут тоже еще полностью совсем срочно спасибо прошу отмените отменить отмена отменяю удалите удалить перенесите перенести уберите убрать снимите есть нет так как в к у с по за до от из на для о об же бы ли или либо то это этот здесь сейчас потом позже раньше очень вообще лучше просто the my our for on at to please is was tomorrow today me myself this that and or".split(" "));
/** @type {[RegExp, number, number][]} */
const PART_DAY = [[/(^|[^а-яё])(утром|с\s+утра|на\s+утро|утренн[а-я]+)(?![а-яё])/i, 0, 720], [/(^|[^а-яё])(дн[её]м|после\s+обеда|в\s+обед|на\s+обед|дневн[а-я]+)(?![а-яё])/i, 720, 1020], [/(^|[^а-яё])(вечером|на\s+вечер|вечерн[а-я]+)(?![а-яё])/i, 1020, 1440]];
const MOVE_SRC = /(?:^|[^а-яёa-z])(?:с|со|from)\s+([^,.;!?\n]{1,30}?)(?=\s+(?:на|to|в|к)\s|[,.;!?\n]|$)|(?:запис[ьи]|записью|бронь|брони|визит)\s+(?:[^\s,.;!?]+\s+){0,3}?(?:на|в|во|к)\s+([^,.;!?\n]{1,30}?)\s+(?=(?:(?:можно|нужно|надо|хочу|прошу|пожалуйста)\s+)?(?:перенес|перенос|сдвин|передвин|поменя|измени|отмен|удал|убер|убрат))/g;
/** @param {string} s */
const moveSrc = s => [...s.matchAll(MOVE_SRC)].map(m => "на " + (m[1] || m[2])).join(" , ");
/** @param {Record<string, any> | null | undefined} rec @param {any} text @param {Record<string, any>} [o] @param {string} [mode] */
export function altOther(rec, text, o = {}, mode = "") {
  const raw = String(text || ""), s = lowE(raw), nowMs = o.nowMs ?? Date.now();
  if (!s.trim() || !rec) return "";
  const own = svWords(svTrim([rec.services, rec.staffName].filter(Boolean).join(" "))); // слова услуги и мастера этой записи
  const ownWord = /** @param {string} w */ w => { const x = lowE(w); return own.some(/** @param {string} z */ z => svStem(z) === svStem(x)) || caseName(rec.staffName || "", x); };
  const isName = /** @param {string} w */ w => caseName(rec.name || "", w);
  // слова о родстве и «он не придёт» — о другой записи, если эта сделана на самого клиента. Если она на другого человека — о ней же, когда
  // названо его имя («запись сына, Алихана») или то же родство, что и при записи («сына Алихана» → «сына перенесите»);
  // «он не придёт» без родства — когда других людей, кроме клиента, в записях чата нет
  // o.booking — кого и на какое время записывают этим же сообщением («перенесите на 13:00 и сына Алихана запишите на 11:00»): эти имена, время и дни — не о другой записи
  const bkAll = Array.isArray(o.booking) ? o.booking : [], bk = mode === "move" ? [] : bkAll, bkNames = bkAll.map(x => x.name).filter(n => n && !samePerson(n, rec.name || ""));
  const bkTimes = bk.map(x => x.time).filter(Boolean).map(mins), bkDay = /** @param {string} d */ d => bk.some(x => x.date && x.date === d);
  const kins = [...new Set(kinHits(raw).filter(h => !bkNames.some(n => (h.nw && caseName(n, h.nw)) || (h.pw && caseName(n, h.pw) && !(h.nw && isName(h.nw))))).map(h => h.k))];
  const named = nameToks(raw).some(t => t.length >= 3 && isName(t));
  const notOwn = (Array.isArray(rec.kin) && rec.kin.length > 0) || (!!rec.name && !!o.owner && !samePerson(rec.name, o.owner));
  const kinFit = kins.length > 0 && !kins.includes("other") && Array.isArray(rec.kin) && kins.every(k => rec.kin.some(/** @param {string} z */ z => kinSame(k, z)));
  const solo = Array.isArray(o.recs) && !o.recs.some(x => x && x.name && !samePerson(x.name, rec.name || "") && !(o.owner && samePerson(x.name, o.owner)));
  const kinOk = notOwn && (named || kinFit), thirdOk = kinOk || (notOwn && !kins.length && solo);
  const when = /** @param {string} s */ s => {
    // ---- время: каждое названное время должно подходить к записи («в 3» — это и 3:00, и 15:00)
    const rt = mins(rec.time || "0:00"), okT = [rt, ...bkTimes], fits = /** @param {number} h @param {number} mi */ (h, mi) => okT.some(x => h * 60 + mi === x || (h < 12 && (h + 12) * 60 + mi === x));
    const is = /** @param {string} t */ t => !!t && okT.includes(mins(t));
    for (const m of s.matchAll(/(?<![\d:\/-]|\d\.)(\d{1,2})([:.])(\d{2})(?![\d:\/-]|\.\d)/g)) {
      const h = +m[1], mi = +m[3];
      if (h > 23 || mi > 59) continue;
      const tail = s.slice(m.index + m[0].length).match(/^\s*(утра|дня|вечера|ночи|a\.?m|p\.?m)/);
      if (tail ? is(hm(m[0].replace(".", ":") + " " + tail[1])) : fits(h, mi)) continue;
      if (m[2] === "." && mi >= 1 && mi <= 12 && h >= 1 && altDateOf(m[0], nowMs) === rec.date) continue; // «04.10» — день этой записи, а не время
      return "время";
    }
    for (const m of s.matchAll(/(?:^|[^а-яёa-z\d])(?:в|во|на|к|с|до|после|at)\s+(\d{1,2})\s+(\d{2})(?![\d.:])/g)) if (+m[1] < 24 && +m[2] < 60 && !fits(+m[1], +m[2])) return "время"; // «на 15 00»
    for (const m of s.matchAll(/(?<![\d.:,\/-])(\d{1,2})\s*(?:ч(?![а-яё])|час[а-я]*)?\s*(утра|вечера|ночи|a\.?m(?![a-z])|p\.?m(?![a-z]))/g)) if (!is(hm(m[0]))) return "время";             // «в 7 вечера», «7 pm»
    for (const m of s.matchAll(/(?:(?:^|[^а-яё])(?:в|к|до|после|около)\s+(\d{1,2})\s*(?:ч(?![а-яё])|час[а-я]*)?|(?<![\d.:,\/-])(\d{1,2})\s*час[а-я]*)\s+дня(?![а-яё])/g)) if (!is(hm((m[1] || m[2]) + " дня"))) return "время"; // «в 3 часа дня»; «через 2 дня» — не время
    for (const m of s.matchAll(/(?<![\d.:,\/-])(?<!(?:через|за|около|примерно|минимум|занимает|длится|на)\s)(\d{1,2})\s*(?:ч(?![а-яё])|час(?:а|ов)?(?![а-яё]))(?!\s*(?:утра|дня|вечера|ночи|назад|позже|раньше|до))/g)) if (+m[1] < 24 && !fits(+m[1], 0)) return "время"; // «в 15 часов»
    for (const m of s.matchAll(/(?:^|[^а-яёa-z\d])на\s+(\d{1,2})\s*(?:ч(?![а-яё])|час(?:ов)(?![а-яё]))/g)) if (+m[1] < 24 && !fits(+m[1], 0)) return "время"; // «на 15 часов» (но не «на 2 часа позже»)
    for (const m of s.matchAll(/(?:^|[^а-яё])(?:в|на|к)\s+(час|один|одного|два|двух|три|трех|четыре|четырех|пять|пяти|шесть|шести|семь|семи|восемь|восьми|девять|девяти|десять|десяти|одиннадцать|одиннадцати|двенадцать|двенадцати)(?![а-яё])(\s+час[а-я]*)?(?:\s+(утра|дня|вечера|ночи))?/g)) {
      if (m[1] !== "час" && !m[2] && !m[3]) continue; // «на два человека» — не время
      if (/^\s*(позже|раньше|попозже|пораньше|назад|впер[её]д)/.test(s.slice(m.index + m[0].length))) continue; // «на час позже», «на два часа раньше» — сдвиг, а не время
      const h = NUM_RU[m[1]];
      if (m[3] ? !is(hm(`${h} ${m[3]}`)) : !fits(h, 0)) return "время";
    }
    // число после предлога в конце фразы: «завтра в 15», «на 15» — час либо число месяца
    const domOk = /** @param {number} n */ n => (rec.date && +rec.date.slice(8, 10) === n) || bk.some(x => x.date && +x.date.slice(8, 10) === n);
    for (const m of s.matchAll(/(?:^|[^а-яёa-z\d])(в|на|к|at)\s+(\d{1,2})(?=\s*(?:$|[,!?;)]|\.(?!\d)))/g)) if (!fits(+m[2], 0) && !(m[1] === "на" && domOk(+m[2]))) return "время";
    const noHello = s.replace(/добр(ый|ое|ого|ой)\s+\S+/g, " ");
    for (const [re, from, to] of PART_DAY) if (re.test(noHello) && !okT.some(x => x >= from && x < to)) return "время"; // «на вечер», а запись утром
    // ---- день: если дни названы, один из них должен быть днём записи
    if (rec.date) {
      /** @type {number[]} */
      const rels = [];
      const g = s.replace(/послезавтра|бүрсігүні|day after tomorrow/g, () => { rels.push(2); return " "; }).replace(/завтра|ертең|tomorrow/g, () => { rels.push(1); return " "; }).replace(/сегодня|бүгін|today/g, () => { rels.push(0); return " "; });
      // названные дни: один из них — день этой записи; при переносе — либо так, либо все они — дни новой записи («перенесите на послезавтра»)
      const relDays = rels.map(r => isoDay(nowMs + r * 86400e3));
      if (rels.length && !relDays.includes(rec.date) && !(bk.length && relDays.every(bkDay))) return "день";
      const dates = [], day = /** @param {string} x */ (x) => dates.push(altDateOf(x, nowMs) || "?");
      for (const m of g.matchAll(/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|(?<![\d.:])\d{1,2}[\/.-]\d{1,2}[\/.-](?:\d{4}|\d{2})(?!\d)|(?<![\d\/])\d{1,2}\/\d{1,2}(?![\d\/])/g)) day(m[0]);
      for (const m of g.matchAll(/(?<![\d:\/-]|\d\.)(\d{1,2})\.(\d{2})(?![\d:\/-]|\.\d)/g)) if (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && !fits(+m[1], +m[2])) day(m[0]); // «05.10»; время с точкой уже проверено выше
      for (const m of g.matchAll(new RegExp("(\\d{1,2})(?:-?(?:го|ое|е))?\\s+" + MON_RU + "|(\\d{1,2})[\\s-]*(?:" + MON_KK.join("|") + ")|(?<![a-z\\d])(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?" + MON_EN_RE + "|(?<![a-z])" + MON_EN_RE + "\\s+(\\d{1,2})(?!\\d)", "g"))) day(m[0]);
      if (!dates.length && /(?<![а-яё])(январ[яь]|феврал[яь]|марта|апрел[яь]|мая|июн[яь]|июл[яь]|августа|сентябр[яь]|октябр[яь]|ноябр[яь]|декабр[яь])(?![а-яё])/.test(g)) dates.push("?"); // «пятое октября»: день назван, но не разобран — считаем другим
      if (dates.length && !dates.includes(rec.date) && !(bk.length && dates.every(bkDay))) return "день";
      const dom = [...g.matchAll(/(?<![\d.:])(\d{1,2})(?:-?го|\s*числ[а-я]*)(?![а-яё])/g)].map(m => +m[1]);
      if (dom.length && !dom.includes(+rec.date.slice(8, 10)) && !(bk.length && dom.every(n => bk.some(x => x.date && +x.date.slice(8, 10) === n)))) return "день";
      const dw = dowsIn(g), dowOf = /** @param {string} d */ d => new Date(d + "T00:00:00Z").getUTCDay();
      if (dw.length && !dw.includes(dowOf(rec.date)) && !(bk.length && dw.every(n => bk.some(x => x.date && dowOf(x.date) === n)))) return "день";
      if (/следующ[а-я]*\s+недел|next\s+week|келесі\s+апта/.test(g)) { // запись должна стоять на следующей неделе (с понедельника)
        const n = local(nowMs), mon = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + ((8 - n.getUTCDay()) % 7 || 7)), inWeek = /** @param {string} d */ d => { const t = Date.parse(d + "T00:00:00Z"); return t >= mon && t < mon + 7 * 86400e3; };
        if (!inWeek(rec.date) && !bk.some(x => x.date && inWeek(x.date))) return "день";
      }
    }
    return "";
  };
  // при переносе время и день в сообщении чаще новые («на 14:30 или на 15:00»); о прежней записи говорят только «с 10:00», «с пятницы», «запись на 15:00 перенесите»
  if (mode !== "person") { const r = when(mode === "move" ? moveSrc(s) : s); if (r) return r; }
  // ---- другой человек: слово сразу после «запись» («запись Айгуль», «запись жены»), родство, третье лицо, имя с большой буквы в середине фразы
  for (const m of raw.matchAll(/(?<![а-яёa-z])(?:запис[ьи]|записью|бронь|брони|визит)\s+(?:(?:на\s+имя|на|для|моей|моего|нашей|нашего|от)\s+)*([a-zа-яёәғқңөұүһі][a-zа-яёәғқңөұүһі-]{2,})/gi)) {
    const w = lowE(m[1]);
    if (mode === "ai" && !/^[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]/.test(m[1])) continue; // ИИ пишет имена с большой буквы
    if (AFTER_STOP.has(w) || ownWord(w) || isName(w) || dowsIn(w).length || new RegExp("^" + MON_RU).test(w) || /^(утро|утра|вечер|вечера|день|дня|обед|час|часа|часов|числ[а-я]*|недел[а-я]*|стрижк[а-я]*|услуг[а-я]*|мастер[а-я]*|врач[а-я]*|прием[а-я]*|сеанс[а-я]*|процедур[а-я]*|клиент[а-я]*)$/.test(w)) continue;
    if (KIN.test(w)) { if (kinOk) continue; return "человек"; }
    if (mode !== "person" && (o.services || []).some(/** @param {string} t */ t => svWords(svTrim(t)).some(/** @param {string} z */ z => svStem(z) === svStem(w)))) return "услуга";
    return "имя";
  }
  for (const m of s.matchAll(/(?:booking|appointment|reservation)\s+(?:for|of)\s+([a-z]{3,})/g)) if (!AFTER_STOP.has(m[1]) && !isName(m[1]) && !ownWord(m[1])) return "имя";
  for (const m of raw.matchAll(/([a-zа-яёәғқңөұүһі]{3,}?)(?:дың|дің|тың|тің|ның|нің)\s+жазба/gi)) if (!/^(мен|біз|өзім|сіз|менің|біздің)$/i.test(m[1]) && !isName(m[1])) return "имя"; // «Айгүлдің жазбасын»
  if (mode === "ai") return "";
  if (kins.length ? !kinOk : THIRD.test(s) && !thirdOk) return "человек";
  const skip = new Set((o.skip || []).map(lowE));
  for (const sent of raw.split(/[.!?\n]+/)) for (const w0 of sent.trim().split(/\s+/).slice(1)) { // слова с большой буквы в середине фразы — скорее всего имена
    const w = w0.replace(/[^A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі-]/g, ""), lw = lowE(w);
    if (w.length < 3 || !/^[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]/.test(w) || w === w.toUpperCase()) continue; // «ОТМЕНИТЕ ЗАПИСЬ» заглавными — не имена
    if (NOT_NAME.test(w) || AFTER_STOP.has(lw) || skip.has(lw) || CX_WORD(lw) || /^(запис[а-я]*|отмен[а-я]*|перенес[а-я]*|перенос[а-я]*|стрижк[а-я]*|услуг[а-я]*|мастер[а-я]*)$/.test(lw) || ownWord(w) || isName(w)) continue;
    if ((o.staff || []).some(/** @param {any} m */ m => caseName(m.base || m.name || "", w))) continue; // имя мастера: другой ли это мастер, проверяется ниже
    if (bkNames.some(n => caseName(n, w))) continue;                              // того, кого записывают этим же сообщением
    return "имя";
  }
  if (mode === "person" || mode === "move") return ""; // при переносе мастер и услуга в сообщении — о новой записи
  // ---- другой мастер или другая услуга из списка локации
  const toks = nameToks(raw);
  for (const m of o.staff || []) {
    const ns = nameToks(m.base || m.name || "").filter(w => !STAFF_POS.has(w) && w.length >= 3);
    if (toks.some(t => t.length >= 3 && ns.some(n => isForm(n, t)) && !isName(t)) && !samePerson(m.name || "", rec.staffName || "") && !caseName(m.base || m.name || "", rec.staffName || "")) return "мастер";
  }
  const others = (o.services || []).filter(/** @param {string} t */ t => !svParts(svTrim(rec.services || "")).includes(svTrim(t))).flatMap(/** @param {string} t */ t => svWords(svTrim(t))).filter(/** @param {string} z */ z => z.length >= 4 && !SV_GENERIC.has(z));
  for (const w of svWords(svTrim(raw))) if (w.length >= 4 && !SV_GENERIC.has(w) && !ownWord(w) && others.some(/** @param {string} z */ z => svStem(z) === svStem(w))) return "услуга";
  return "";
}
export const NOT_NAME = /^(вы|вас|вам|вами|ваш\S*|спасибо|пожалуйста|здравствуйте|добрый|доброе|доброй|привет|извините|простите|понедельник\S*|вторник\S*|сред[ауые]|четверг\S*|пятниц\S*|суббот\S*|воскресень\S*|январ\S*|феврал\S*|март\S*|апрел\S*|ма[йяе]|июн\S*|июл\S*|август\S*|сентябр\S*|октябр\S*|ноябр\S*|декабр\S*|monday|tuesday|wednesday|thursday|friday|saturday|sunday|please|thanks|thank|sorry|hello|whatsapp|altegio|kaspi|астан\S*|алмат\S*)$/i;
const SV_GENERIC = new Set(["запись", "записи", "отмена", "отмену", "отмените", "отменить", "перенос", "перенести", "время", "день", "мастер", "мастера", "мастеру", "услуга", "услугу", "пожалуйста", "завтра", "сегодня", "послезавтра", "здравствуйте", "спасибо", "можно", "нужно", "хочу", "прийти", "смогу", "получится", "администратор"]);

export const CX_YES = new Set(["да", "ага", "угу", "конечно", "верно", "подтверждаю", "точно", "давай", "давайте", "хорошо", "ладно", "yes", "yep", "yeah", "sure", "ok", "okay", "ок", "окей", "иә", "ия", "иа", "ие", "жарайды", "болады"]);
export const CX_DO = /^(отмен(а|и|ить|ите|яй|яйте|им|яем)|удал(и|ить|ите|яй|яйте)|убер(и|ите)|убрать|cancel|delete|remove|болдырма(у|ңыз|ңызшы|йық)?|жой(ыңыз)?|өшір(іңіз)?)$/;
const CX_FILL = new Set("пожалуйста пж плиз ее эту ту мою запись бронь визит please pls it the my booking appointment that one жазбаны жазбамды өтінемін спасибо рахмет thanks все и а ну же именно тогда now then в на к у с от по за for on at to of сағат мастер мастеру мастера услугу услуга утра дня вечера утром днем вечером час часа часов сегодня завтра послезавтра today tomorrow бүгін ертең числа число".split(" "));
/** @param {string} w */
export const CX_WORD = w => CX_YES.has(w) || CX_DO.test(w) || CX_FILL.has(w);

export const STAFF_POS = new Set(["барбер", "мастер", "стилист", "парикмахер", "топ", "старший", "младший", "врач", "доктор", "косметолог", "администратор", "barber", "master", "stylist", "шебер"]); // должность в имени мастера — не имя
/** @param {any[]} staff */
export const staffNames = staff => staff.map(/** @param {any} m */ m => nameToks(m.base).filter(/** @param {string} w */ w => !STAFF_POS.has(w) && w.length >= 2));
