// @ts-check
// Сравнение имён и названий услуг: казахские буквы и латиница приводятся к русским, названия услуг — к одному виду (nameToks, svTrim).
import { clean, lowE } from "./text.js";

// имя для сравнения: без знаков и кавычек, казахские буквы — как русские («Айгүл» = «Айгуль»), латиница — как кириллица («Timur» = «Тимур»)
/** @type {Record<string, string>} */
const KK_RU = { ә: "а", ғ: "г", қ: "к", ң: "н", ө: "о", ұ: "у", ү: "у", һ: "х", і: "и" };
const LAT = [["shch", "щ"], ["zh", "ж"], ["kh", "х"], ["ch", "ч"], ["sh", "ш"], ["ts", "ц"], ["yu", "ю"], ["ya", "я"], ["yo", "е"], ["ye", "е"],
  ["a", "а"], ["b", "б"], ["c", "к"], ["d", "д"], ["e", "е"], ["f", "ф"], ["g", "г"], ["h", "х"], ["i", "и"], ["j", "ж"], ["k", "к"], ["l", "л"], ["m", "м"], ["n", "н"], ["o", "о"], ["p", "п"], ["q", "к"],
  ["r", "р"], ["s", "с"], ["t", "т"], ["u", "у"], ["v", "в"], ["w", "в"], ["x", "кс"], ["y", "й"], ["z", "з"]];
const LAT_RE = new RegExp(LAT.map(x => x[0]).join("|"), "g"), LAT_MAP = Object.fromEntries(LAT);
/** @type {Record<string, string>} */
const LOOK = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у" }; // латинская буква среди русских («Aйгуль») — похожая по виду
/** @param {string} w @returns {string} */
const translit = w => {
  if (!/[a-z]/.test(w)) return w;
  if (/[а-я]/.test(w)) return w.replace(/[a-z]/g, ch => LOOK[ch] || LAT_MAP[ch] || ch);
  return w.replace(/([bcdfghjklmnpqrstvwxz])y$/, "$1ий").replace(/([bcdfghjklmnpqrstvwxz])y(?=[bcdfghjklmnpqrstvwxz])/g, "$1ы").replace(/(iia|iya|ia)$/, "ия") // Dmitry, Shyngys, Maria
    .replace(LAT_RE, x => LAT_MAP[x]);
};
/** @param {any} s @returns {string[]} */
export const nameToks = s => lowE(clean(s, 160)).replace(/[әғқңөұүһі]/g, ch => KK_RU[ch]).replace(/[^a-zа-я0-9\s-]/g, " ").split(/\s+/).map(w => w.replace(/^-+|-+$/g, "")).filter(Boolean).map(translit);

// название для сравнения: без эмодзи, кавычек и невидимых знаков, тире одного вида
/** @param {string} s @returns {string} */
const svTrim0 = s => lowE(s).replace(/[^\p{L}\p{N}\s+\-()\/.,№&—–]/gu, " ").replace(/\s*[—–]\s*/g, " - ").replace(/\s+-\s+/g, " - ").replace(/\s+/g, " ").trim().slice(0, 160).replace(/[\s.,]+$/, "").trim();
/** @type {Map<string, string>} */
const SV_CACHE = new Map(); // названия услуг локации сравниваются на каждое сообщение — считаем один раз
/** @param {any} s0 @returns {string} */
export const svTrim = s0 => {
  const s = String(s0 ?? "");
  if (s.length > 300) return svTrim0(s.slice(0, 600));
  let v = SV_CACHE.get(s);
  if (v === undefined) { if (SV_CACHE.size > 3000) SV_CACHE.clear(); v = svTrim0(s); SV_CACHE.set(s, v); }
  return v;
};

// слова названия услуги и их основы (общее для подбора услуги и проверки «другая ли запись»)
export const SV_STOP = new Set(["для", "или", "без", "при", "под", "над", "кроме", "the", "and", "for", "with", "without", "except"]);
/** @param {string} s @returns {string[]} */
export const svWords = s => (s.match(/[\p{L}\p{N}]+/gu) || []).filter(w => (w.length >= 3 || /\d/.test(w)) && !SV_STOP.has(w));
/** @param {string} w @returns {string} */
export const svStem = w => /\d/.test(w) || w.length <= 4 ? w : w.slice(0, Math.max(4, w.length - 2));
/** @param {string} s @returns {string[]} */
export const svParts = s => s.replace(/\([^()]*\)/g, " ").split(/\s*(?:\+|&|,|\sи\s|\sand\s)\s*/).map(x => x.trim()).filter(Boolean); // составные части: «стрижка + борода»; пояснение в скобках — не часть

// Имя человека из строки ИИ попадает в подсказку ИИ и в расписание, поэтому от поля «Имя» остаётся только имя: до трёх слов из букв
// (русских, казахских, латинских; дефис и апостроф — внутри слова), не длиннее 40 знаков. Всё после точки, запятой, цифры, скобки и любого другого знака отбрасывается.
// «А. Иванов», «Иванов А.С.» — точка после одной буквы считается инициалом. many — имён может быть несколько («Тимур, Алихан», «Тимур + Алихан»): они остаются через запятую
const NAME_CH = "A-Za-zÀ-ÖØ-öø-ɏА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі";

const NAME_HEAD = new RegExp("^[^" + NAME_CH + "]+"), NAME_INITIAL = new RegExp("(^|[ ,+&])([" + NAME_CH + "])\\.(?=[ " + NAME_CH + "]|$)", "g");

const NAME_ONE = new RegExp("^[" + NAME_CH + "'’ʼ\\s-]*"), NAME_MANY = new RegExp("^[" + NAME_CH + "'’ʼ\\s,+&-]*");

/** @param {any} s @param {boolean} [many] @returns {string} */
export function cleanName(s, many) {
  const t = clean(s, 200).replace(NAME_HEAD, "").replace(NAME_INITIAL, "$1$2 ").replace(NAME_INITIAL, "$1$2 "); // второй проход — для инициалов подряд: «А.С. Иванов»
  /** @param {string} x @returns {string} */
  const one = x => { // слова до первого «слова» без букв: «Тимур - постоянный клиент» → «Тимур»
    const out = [];
    for (const w0 of x.trim().split(/\s+/)) { const w = w0.replace(/^['’ʼ-]+|['’ʼ-]+$/g, ""); if (!w || out.push(w) === 3) break; }
    return out.join(" ").slice(0, 40).replace(/[\s'’ʼ-]+$/, "");
  };
  const body = /** @type {RegExpMatchArray} */ (t.match(many ? NAME_MANY : NAME_ONE))[0];
  return many ? body.split(/\s*[,+&]\s*/).map(one).filter(Boolean).slice(0, 3).join(", ").slice(0, 60).replace(/[\s,'’ʼ-]+$/, "") : one(body);
}
