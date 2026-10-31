// @ts-check
// Подстановка данных клиента в рекламный текст (ТЗ Winchester v3.0, 31.10.2026). Чистые функции: ни хранилища, ни сети.
// Вставки — именованные: {{client.first_name}}, {{staff.name}}, {{service.name}}, {{visit.days_since}}, {{company.name}},
// {{booking.url}}, {{company.address}}. Старые {имя}, {мастер}, {услуга}, {дней}, {компания}, {ссылка} принимаются и при сохранении
// переводятся в новые (toCanonical). Правила:
// - имя — единственная необязательная вставка: нет имени (или в базе не имя: «Клиент», «Без имени», номер) — обращение убирается
//   аккуратно: «Здравствуйте, {{client.first_name}}!» → «Здравствуйте!», «{{client.first_name}}, добрый день!» → «Добрый день!»;
// - нет мастера, услуги, даты визита, ссылки или адреса — текст не уходит (blocked): выдуманных фактов клиентам не пишем;
// - [квадратные скобки] — условия, которые владелец ещё не вписал: текст не уходит;
// - значения подставляются за один проход и второй раз не разбираются: имя «{{booking.url}}» или «}}» в данных — просто текст,
//   а скобки из данных убираются. В готовом тексте не бывает { } [ ] и управляющих символов; длина — до 1000 знаков.
import { lowE, isJoke } from "../../lib/text.js";
import { bcName, bcNoteWord, bcSurname } from "./parse.js";

export const NAME = "client.first_name";
/** вставки для чипов в редакторе: ключ, подпись, пример @type {{ key: string, label: string, sample: string }[]} */
export const VARS = [
  { key: NAME, label: "Имя клиента", sample: "Арман" },
  { key: "staff.name", label: "Мастер", sample: "Данияр" },
  { key: "service.name", label: "Услуга", sample: "Мужская стрижка" },
  { key: "visit.days_since", label: "Дней после визита", sample: "28" },
  { key: "company.name", label: "Название барбершопа", sample: "Барбершоп" },
  { key: "booking.url", label: "Ссылка на запись", sample: "https://example.kz" },
  { key: "company.address", label: "Адрес", sample: "Астана, улица Примерная, 1" },
];
const KEYS = new Set(VARS.map(x => x.key));
/** старые вставки → новые @type {Record<string, string>} */
export const LEGACY = { имя: NAME, мастер: "staff.name", услуга: "service.name", дней: "visit.days_since", компания: "company.name", ссылка: "booking.url", адрес: "company.address", name: NAME };
/** почему текст для этого клиента не уходит — по пропущенной вставке @type {Record<string, string>} */
export const MISSING_WHY = { "staff.name": "нет мастера в истории", "service.name": "нет услуги в истории", "visit.days_since": "нет даты визита",
  "company.name": "нет названия барбершопа", "booking.url": "нет ссылки на запись", "company.address": "нет адреса" };
export const BRACKETS_ISSUE = "Впишите условия вместо [скобок]";

// управляющие символы, невидимые символы и знаки направления текста (ими подменяют вид строки), мягкий перенос
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤﻿]/g;
const GONE = "\u0001", CAP = "\u0002", MARK = "…"; // GONE — место убранного имени, CAP — дальше начало фразы, MARK — нет данных

/** текст шаблона: переводы строк сохраняются, лишние пробелы и пустые строки — нет @param {any} s @param {number} [max] */
export function cleanText(s, max = 4000) {
  return String(s ?? "").replace(/\r\n?/g, "\n").replace(CTRL, "").replace(/\t/g, " ").replace(/[  ]+/g, " ")
    .replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}
/** значение для вставки: одна строка, без скобок и управляющих символов @param {any} v @param {number} [n] */
const val = (v, n = 80) => String(v ?? "").replace(CTRL, "").replace(/[{}[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, n);

/** старые вставки ({имя}, {{ имя }}) и вставки с пробелами ({{ staff.name }}) → {{staff.name}} @param {any} text */
export function toCanonical(text) {
  const legacy = Object.keys(LEGACY).join("|");
  return String(text ?? "")
    .replace(new RegExp(`\\{\\{\\s*(${legacy})\\s*\\}\\}`, "gi"), (_, k) => `{{${LEGACY[k.toLowerCase()]}}}`)
    .replace(new RegExp(`\\{\\s*(${legacy})\\s*\\}`, "gi"), (_, k) => `{{${LEGACY[k.toLowerCase()]}}}`)
    .replace(/\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/gi, (_, k) => `{{${k.toLowerCase()}}}`);
}
/** какие вставки есть в тексте (новые ключи) @param {any} text @returns {string[]} */
export const usedVars = text => [...new Set([...toCanonical(text).matchAll(/\{\{([^{}\s]{1,40})\}\}/g)].map(m => m[1]))];

// целые строки, которые не имя («без имени», «не указано»)
const NOT_NAME_FULL = /^(без имени|нет имени|имя не указано|не указано|неизвестно|не знаю|no name|noname|аты жоқ)$/;
/** первое слово имени с заглавной: «АРМАН» и «арман» → «Арман», «ерлан-али» → «Ерлан-Али»; «МакКартни» — как есть @param {string} w */
const fixCase = w => w.split("-").map(p => p === p.toUpperCase() || p === p.toLowerCase() ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1)).join("-");

/**
 * Имя для обращения — одно слово или "" (обращения не будет). Из базы бывает всё: «Арман Ерланович», «АРМАН», «Ахметова Айгерим»,
 * «Клиент», «Без имени», номер, почта, «-», пометки администратора («Ерлан должник»).
 * @param {any} raw @returns {string}
 */
export function normName(raw) {
  const s = String(raw ?? "").replace(CTRL, "").replace(/["«»“”„`]/g, "").replace(/\s+/g, " ").trim();
  if (!s || s.length > 60 || /[\d@{}[\]<>/\\|_=+*#$%^&~]/.test(s) || NOT_NAME_FULL.test(lowE(s)) || isJoke(s)) return "";
  const toks = s.split(" ").map(w => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")).filter(Boolean);
  if (!toks.length || toks.length > 4 || toks.some(w => bcNoteWord(w))) return "";
  // «Ахметова Айгерим», «Данияр Серикович» — по окончаниям фамилии и отчества (bcName); иначе — первое слово, если оно не фамилия
  const w = bcName(s) || (toks.length > 1 && !bcSurname(toks[0]) ? toks[0] : "");
  if (!w || w.length < 2 || w.length > 24 || !/^\p{L}+(?:[-'’]\p{L}+)*$/u.test(w)) return "";
  return fixCase(w);
}

/** данные одного клиента для вставок. row — строка базы { name, staff, svc, d }, co — компания { name, url, address }
 *  @param {{ name?: any, staff?: any, svc?: any, d?: any }} row @param {{ name?: any, url?: any, address?: any }} co @returns {Record<string, any>} */
export const dataFor = (row, co) => ({ [NAME]: row && row.name, "staff.name": row && row.staff, "service.name": row && row.svc,
  "visit.days_since": row && row.d, "company.name": co && co.name, "booking.url": co && co.url, "company.address": co && co.address });

/** проблемы самого текста, без данных клиента: пусто, [скобки], неизвестные вставки @param {any} text @returns {string[]} */
export function textIssues(text) {
  const t = cleanText(toCanonical(text));
  if (!t) return ["Пустой текст"];
  const out = [];
  if (/[[\]]/.test(t)) out.push(BRACKETS_ISSUE);
  for (const k of usedVars(t)) if (!KEYS.has(k)) out.push(`Неизвестная вставка: ${val(k, 40)}`);
  for (const m of t.replace(/\{\{[^{}]*\}\}/g, "").matchAll(/\{([^{}\n]{1,40})\}/g)) out.push(`Неизвестная вставка: ${val(m[1], 40)}`);
  return out;
}

/** имя пропало — убираем обращение вместе с запятой и восклицанием, без «, !» и двойных пробелов @param {string} t */
function dropName(t) {
  return t
    // «Здравствуйте, ␁!», «Спасибо, ␁, что…», «у нас, ␁.», «Привет, ␁ 👋» — без запятой и имени
    .replace(/[ \t]*,[ \t]*\u0001(?=[ \t]*(?:[^\p{L}\p{N}\s]|\n|$))/gu, "")
    // «␁, добрый день!», «␁! Ждём вас» в начале текста, строки или фразы — дальше начало фразы
    .replace(/(^|\n|[.!?…][ \t]+)[ \t]*\u0001[ \t]*[,!.]?[ \t]*/gu, "$1" + CAP)
    // «Здравствуйте ␁!» — без пробела перед знаком
    .replace(/[ \t]+\u0001(?=[ \t]*(?:[^\p{L}\p{N}\s]|\n|$))/gu, "")
    .replace(/[ \t]*\u0001[ \t]*/g, " ");
}
/** порядок после подстановки: пробел перед знаком, «, !», двойные пробелы, заглавная после убранного имени @param {string} t */
const tidy = t => t
  .replace(/[ \t]+([,.!?;:])/g, "$1").replace(/([,;:])[ \t]*([,.!?])/g, "$2")
  .replace(/^[ \t]*[,;:.!?]+[ \t]*/gm, CAP).replace(/[ \t]{2,}/g, " ").replace(/ *\n */g, "\n")
  .replace(/\u0002+[ \t]*(\p{Ll})/gu, (_, ch) => ch.toUpperCase()).replace(/\u0002/g, "").trim();

/**
 * Готовый текст для одного клиента.
 * @param {any} text шаблон (старые вставки тоже)
 * @param {Record<string, any>} data значения по ключам: { "client.first_name": "Арман", "staff.name": "Тони", … } (см. dataFor)
 * @param {{ max?: number }} [opts] max — не длиннее стольких знаков (1000)
 * @returns {{ text: string, missing: string[], blocked: boolean, issues: string[] }}
 *   missing — каких данных нет (кроме имени); blocked — такой текст не отправлять; issues — что не так, по-человечески
 */
export function render(text, data, opts = {}) {
  const max = opts.max || 1000, d = data || {};
  let t = cleanText(toCanonical(text));
  if (!t) return { text: "", missing: [], blocked: true, issues: ["Пустой текст"] };
  const issues = [], missing = /** @type {string[]} */ ([]);
  if (/[[\]]/.test(t)) { issues.push(BRACKETS_ISSUE); t = t.replace(/\[[^[\]\n]{0,160}\]/g, MARK).replace(/[[\]]/g, ""); }
  // один проход: подставленное значение второй раз не разбирается
  t = t.replace(/\{\{\s*([^{}\s]{1,40})\s*\}\}/g, (_, k) => {
    if (k === NAME) return normName(d[NAME]) || GONE;
    if (!KEYS.has(k)) { issues.push(`Неизвестная вставка: ${val(k, 40)}`); return MARK; }
    let v = val(d[k]);
    if (k === "visit.days_since") { const n = Number(d[k]); v = d[k] == null || d[k] === "" || !Number.isInteger(n) || n < 0 || n > 3650 ? "" : String(n); }
    if (!v) { if (!missing.includes(k)) missing.push(k); return MARK; }
    return v;
  });
  // {опечатка} в одинарных скобках — тоже неизвестная вставка, а не слово в тексте
  t = t.replace(/\{([^{}\n]{1,40})\}/g, (_, k) => { issues.push(`Неизвестная вставка: ${val(k, 40)}`); return MARK; });
  t = tidy(dropName(t.replace(/[{}]/g, "")));
  for (const k of missing) issues.push(MISSING_WHY[k].charAt(0).toUpperCase() + MISSING_WHY[k].slice(1));
  if (t.length > max) { issues.push(`Текст длиннее ${max} знаков`); t = t.slice(0, max); }
  if (!t) issues.push("Пустой текст");
  return { text: t.replace(/[{}[\]]/g, ""), missing, blocked: issues.length > 0, issues };
}
