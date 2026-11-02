// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 1)
// Рассылки: разбор списка получателей из текста/Excel (bcParse, bcDate, имя bcName).
import { BC_MAX } from "../../config/constants.js";
import { normPhone, phonesIn } from "../../lib/phone.js";
import { local } from "../../lib/time.js";
import { snip } from "../../lib/text.js";
// имя для подстановки {имя} — одно слово из букв. Пометки администратора из клиентской базы («не записывать», «должник Арман») в сообщение клиенту попасть не должны
const BC_NOT_NAME = /^(не|нет|без|клиент\S*|должни\S*|долг\S*|мама|папа|муж|жена|сын|дочь|брат|сестра|вип|vip|блок\S*|спам|тест\S*|test|админ\S*|мастер|нов(ый|ая)|постоянн\S*|client|unknown|неизвестн\S*|аноним\S*|гость|guest|whatsapp|ватсап\S*|инста\S*|номер|тел|телефон|имя|фио|name|phone)$/i;
// слова, по которым видно: это пометка администратора, услуга или город, а не имя («Хамка», «Ресницы Дана», «Скидка 20%»)
const BC_NOTE = /^(чс|ч\.с|хамк\S*|хам|кидал\S*|жмот\S*|сосед\S*|т[её]т[яю]\S*|дяд\S*|бывш\S*|начальн\S*|kaspi|каспи|доставк\S*|маникюр\S*|педикюр\S*|ресниц\S*|бров\S*|директор\S*|конкурент\S*|проблемн\S*|умер\S*|перезвон\S*|бесплатн\S*|скидк\S*|ребён\S*|ребен\S*|жених\S*|невест\S*|отказ\S*|игнор\S*|мошенн\S*|дур[аы]\S*|коз[её]л\S*|неадекват\S*|барбер\S*|опаздыва\S*|подруг\S*|друг|ч[её]рн\S*|никогда|стриж\S*|бород\S*|мужск\S*|женск\S*|детск\S*|астана|алматы|шымкент|караганд\S*|instagram|инстаграм\S*|да|ок|скандал\S*|пьян\S*|масса[жд]\S*|чистк\S*|пломб\S*|врач\S*|доктор\S*|коллег\S*|знаком\S*|родств\S*|бабушк\S*|дедушк\S*|свекр\S*|тёщ\S*|тещ\S*|тесть|зять|клиник\S*|салон\S*|ип|тоо|г-н|гн|др|мр|мисс|ханым|иин|карта|тел|процент\S*|клиентк\S*|заказ\S*|записать|записывать|менеджер\S*|парикмахер\S*|стилист\S*|косметолог\S*|ногт\S*|эпиляц\S*|услуг\S*|абонемент\S*|акци\S*|вип)$/i;
const BC_SUR = /^\p{L}{3,}(ов|ова|ев|ева|ёв|ёва|ский|ская|цкий|цкая|енко|швили|дзе|кызы|қызы|ұлы|улы|тегі)$/iu, BC_PAT = /^\p{L}{3,}(ович|евич|овна|евна|ична|кызы|қызы|ұлы|улы)$/iu;
// слово — пометка администратора или служебное слово, а не имя («клиент», «должник», «без»): для имени в рекламном тексте (render.js)
/** @param {string} w @returns {boolean} */
export const bcNoteWord = w => BC_NOT_NAME.test(w) || String(w).split("-").some(x => BC_NOTE.test(x) || BC_NOT_NAME.test(x));
// фамилия или отчество по окончанию («Ахметова», «Ерланович»): одно такое слово — не имя
/** @param {string} w @returns {boolean} */
export const bcSurname = w => BC_SUR.test(w) || BC_PAT.test(w);
// одна ячейка → имя или "". Только однозначное: «Айгерим», «Ахметова Айгерим», «Данияр Серикович», «Иванов Иван Иванович»; пометки, услуги и «два слова непонятно каких» — нет
/** @param {any} s @returns {string} */
export function bcName(s) {
  const cell = String(s || "").replace(/["«»“”]/g, "").trim();
  if (!cell || /[\d()@/\\]/.test(cell) || cell.length > 60) return "";
  const toks = cell.split(/\s+/).map(w => w.replace(/[.,!]+$/, "")).filter(Boolean);
  if (!toks.length || toks.length > 3 || toks.some(w => !/^\p{L}[\p{L}'’-]{1,24}$/u.test(w) || BC_NOT_NAME.test(w) || w.split("-").some(x => BC_NOTE.test(x) || BC_NOT_NAME.test(x)))) return "";
  let w = "";
  if (toks.length === 1) { if (BC_SUR.test(toks[0]) || BC_PAT.test(toks[0])) return ""; w = toks[0]; } // одна фамилия — не имя
  else {
    const sur = toks.map(x => BC_SUR.test(x)), pat = toks.map(x => BC_PAT.test(x)), rest = toks.filter((x, i) => !sur[i] && !pat[i]);
    if (rest.length === 1) w = rest[0]; // фамилия, имя, отчество — по признакам окончаний; ровно одно слово без них — имя
    else return "";
  }
  return w === w.toUpperCase() || w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w;
}
// список получателей из текста: по клиенту на строку — номер и (необязательно) имя, через запятую, точку с запятой или табуляцию (как при вставке из Excel)
// даты в списке получателей: «01.08.2026», «2026-06-15», «12.10» (день рождения без года)
const BC_DATE = /^\s*(?:(\d{1,2})[./](\d{1,2})(?:[./](\d{4}|\d{2}))?|(\d{4})-(\d{1,2})-(\d{1,2}))\s*$/;
/** @param {string} cell */
export function bcDate(cell) {
  const m = BC_DATE.exec(cell); if (!m) return null;
  let d, mo, y; if (m[4]) { y = +m[4]; mo = +m[5]; d = +m[6]; } else { d = +m[1]; mo = +m[2]; y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : 0; }
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  return { y, mo, d };
}
/** @param {any} src */
export function bcParse(src) {
  const seen = new Set(), list = [], bad = [], info = [];
  let dup = 0, badN = 0, cut = 0, visitCol = -1, bdayCol = -1, seenAny = false;
  const yearNow = local(Date.now()).getUTCFullYear();
  for (const raw of String(src || "").split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    if (list.length >= BC_MAX) { cut++; continue; }
    const first = !seenAny; seenAny = true; // заголовок Excel — только первая строка («не номер» в середине списка — непонятная строка)
    if (first && !/\d{5}/.test(line.replace(/[\s()+\-.–—]/g, "")) && /телефон|номер|phone|тел\.?(\s|$|;|,)/i.test(line)) { // строка заголовка из Excel: запоминаем, где визит и где день рождения
      line.split(/[\t;,|]/).forEach((cell, i) => { if (/визит|посещ|последн|был[аи]?|last/i.test(cell)) visitCol = i; else if (/рожд|birth|^\s*д\.?\s?р\.?\s*$/i.test(cell)) bdayCol = i; });
      continue;
    }
    let digits = "", nm = "", visit = null, bday = null;
    const nums = [], texts = [];
    for (const [ci, cell] of line.split(/[\t;,|]/).entries()) {
      const dt = bcDate(cell);
      if (dt) { // какая это дата: по заголовку, иначе по году — недавняя дата — визит, давняя или без года — день рождения
        const isB = bdayCol >= 0 || visitCol >= 0 ? ci === bdayCol || (ci !== visitCol && !dt.y) : !dt.y || dt.y < yearNow - 5;
        if (isB) bday = [dt.mo, dt.d]; else if (dt.y) visit = Date.UTC(dt.y, dt.mo - 1, dt.d);
        continue;
      }
      if (/^[\s+\d()\-.–—]{10,24}$/.test(cell)) { // в ячейке только цифры: полный номер (8…, 7…, +…) надёжнее десяти цифр без кода страны — это может быть чужое число из соседнего столбца
        const d = cell.replace(/\D/g, ""), p = normPhone(cell), plus = /^\s*\+/.test(cell);
        const dg = p ? p.slice(1) : plus && /^[1-9]\d{9,14}$/.test(d) ? d : "";
        if (dg) nums.push({ dg, full: !(d.length === 10 && !plus) });
      } else if (/\p{L}/u.test(cell) && !cell.includes("@")) texts.push(cell);
    }
    const best = nums.find(x => x.full) || (nums.length === 1 ? nums[0] : null); // несколько «голых» десятизначных чисел — какое из них телефон, неизвестно
    if (best) digits = best.dg;
    else if (nums.length > 1) { badN++; if (bad.length < 8) bad.push(snip(line, 50)); continue; }
    /** @param {string[]} arr */
    const pickName = arr => { const ok = arr.map(bcName).filter(Boolean); return ok.length === 1 ? ok[0] : ""; }; // имя берём, только если оно однозначно: из нескольких подходящих ячеек не угадываем
    nm = pickName(texts);
    if (!digits) { // номер внутри текста: «Айгерим 8 701 123 45 67»
      const p = phonesIn(line)[0];
      if (p) { digits = p.phone.slice(1); nm = pickName((line.slice(0, p.at) + "," + line.slice(p.at + p.len)).split(/[\t;,|]/).filter(x => /\p{L}/u.test(x) && !x.includes("@"))); }
    }
    if (!digits) { badN++; if (bad.length < 8) bad.push(snip(line, 50)); continue; }
    if (seen.has(digits)) { dup++; continue; }
    seen.add(digits);
    list.push([digits, nm]); info.push({ v: visit, b: bday });
  }
  return { list, info, dup, bad, badN, cut };
}
