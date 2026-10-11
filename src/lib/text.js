// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Тексты: очистка, экранирование HTML, нижний регистр без «ё», проверка шуточного имени.
export const clean = (s, n = 80) => String(s ?? "").replace(/[​-‏⁠﻿­]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
export const snip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
export const lowE = s => String(s ?? "").toLowerCase().replace(/ё/g, "е");
export function esc(s) { return String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])); }
// Шуточное имя: известный персонаж («Адольф Гитлер», «Шрек», одно слово «Путин»), проверочное слово, одна буква, брань.
// Настоящие фамилии — «Токаева», «Назарбаев», «Путинцева», «Блялин» — шуткой не считаются: искать нужно слово целиком, а не его кусок
const JOKE_ANY = new Set(["гитлер", "hitler", "бэтмен", "бетмен", "batman", "шрек", "shrek", "пикачу", "хуй", "хер", "пизда", "блядь", "блять", "бля", "жопа", "сука", "суки", "мудак", "пидор", "пидорас", "гандон", "чмо", "fuck", "shit"]);
const JOKE_SOLO = new Set(["путин", "putin", "сталин", "ленин", "трамп", "trump", "байден", "biden", "наполеон", "обама", "маск"]);
const JOKE_FIRST = new Set(["тест", "test", "бот", "bot", "admin", "asdf", "qwer", "qwerty", "йцук", "йцукен", "фыва", "абв", "abc"]);
const JOKE_FULL = /(владимир\s+(владимирович\s+)?путин|путин\s+владимир|иосиф\s+(виссарионович\s+)?сталин|владимир\s+(ильич\s+)?ленин|дональд\s+трамп|джо\s+байден|наполеон\s+бонапарт|нурсултан\s+(абишевич\s+)?назарбаев|назарбаев\s+нурсултан|[кқ]асым[\s-]*жомарт\s+(кемелевич\s+)?токаев|токаев\s+[кқ]асым|человек[\s-]+паук|спанч[\s-]*боб|гарри\s+поттер|дарт\s+вейдер|илон\s+маск|elon\s+musk)/;
export function isJoke(name) {
  const s = String(name || "").toLowerCase().replace(/ё/g, "е").trim(), w = s.match(/[a-zа-яәғқңөұүһі]+/g) || [];
  if (/^[a-zа-я]$/.test(s)) return true;                                   // одна буква
  if (JOKE_FULL.test(s) || w.some(x => JOKE_ANY.has(x))) return true;
  return w.length > 0 && (JOKE_FIRST.has(w[0]) || (w.length === 1 && JOKE_SOLO.has(w[0])));
}
