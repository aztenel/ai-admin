// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Сравнение имён и названий услуг: казахские буквы и латиница приводятся к русским, названия услуг — к одному виду (nameToks, svTrim).
import { clean, lowE } from "./text.js";

// имя для сравнения: без знаков и кавычек, казахские буквы — как русские («Айгүл» = «Айгуль»), латиница — как кириллица («Timur» = «Тимур»)
const KK_RU = { ә: "а", ғ: "г", қ: "к", ң: "н", ө: "о", ұ: "у", ү: "у", һ: "х", і: "и" };
const LAT = [["shch", "щ"], ["zh", "ж"], ["kh", "х"], ["ch", "ч"], ["sh", "ш"], ["ts", "ц"], ["yu", "ю"], ["ya", "я"], ["yo", "е"], ["ye", "е"],
  ["a", "а"], ["b", "б"], ["c", "к"], ["d", "д"], ["e", "е"], ["f", "ф"], ["g", "г"], ["h", "х"], ["i", "и"], ["j", "ж"], ["k", "к"], ["l", "л"], ["m", "м"], ["n", "н"], ["o", "о"], ["p", "п"], ["q", "к"],
  ["r", "р"], ["s", "с"], ["t", "т"], ["u", "у"], ["v", "в"], ["w", "в"], ["x", "кс"], ["y", "й"], ["z", "з"]];
const LAT_RE = new RegExp(LAT.map(x => x[0]).join("|"), "g"), LAT_MAP = Object.fromEntries(LAT);
const LOOK = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у" }; // латинская буква среди русских («Aйгуль») — похожая по виду
const translit = w => {
  if (!/[a-z]/.test(w)) return w;
  if (/[а-я]/.test(w)) return w.replace(/[a-z]/g, ch => LOOK[ch] || LAT_MAP[ch] || ch);
  return w.replace(/([bcdfghjklmnpqrstvwxz])y$/, "$1ий").replace(/([bcdfghjklmnpqrstvwxz])y(?=[bcdfghjklmnpqrstvwxz])/g, "$1ы").replace(/(iia|iya|ia)$/, "ия") // Dmitry, Shyngys, Maria
    .replace(LAT_RE, x => LAT_MAP[x]);
};
export const nameToks = s => lowE(clean(s, 160)).replace(/[әғқңөұүһі]/g, ch => KK_RU[ch]).replace(/[^a-zа-я0-9\s-]/g, " ").split(/\s+/).map(w => w.replace(/^-+|-+$/g, "")).filter(Boolean).map(translit);

// название для сравнения: без эмодзи, кавычек и невидимых знаков, тире одного вида
const svTrim0 = s => lowE(s).replace(/[^\p{L}\p{N}\s+\-()\/.,№&—–]/gu, " ").replace(/\s*[—–]\s*/g, " - ").replace(/\s+-\s+/g, " - ").replace(/\s+/g, " ").trim().slice(0, 160).replace(/[\s.,]+$/, "").trim();
const SV_CACHE = new Map(); // названия услуг локации сравниваются на каждое сообщение — считаем один раз
export const svTrim = s0 => {
  const s = String(s0 ?? "");
  if (s.length > 300) return svTrim0(s.slice(0, 600));
  let v = SV_CACHE.get(s);
  if (v === undefined) { if (SV_CACHE.size > 3000) SV_CACHE.clear(); v = svTrim0(s); SV_CACHE.set(s, v); }
  return v;
};
