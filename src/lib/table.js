// @ts-check
// Таблица из файла для импорта контактов (этап 1, 31.10.2026): CSV / TSV / текст, вставленный из Excel, и .xlsx (lib/xlsx.js).
// Excel в Казахстане часто сохраняет CSV в кодировке Windows-1251 и с «;» — кодировку и разделитель определяем сами.

// Windows-1251, байты 0x80–0xFF (0x98 в кодировке не занят)
const CP1251 = "ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—�™љ›њќћџ ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕїАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя";

/** Байты файла → текст: UTF-8 (с BOM или без), иначе Windows-1251. @param {Uint8Array} b */
export function decodeText(b) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b).replace(/^﻿/, ""); }
  catch (e) { let s = ""; for (const x of b) s += x < 0x80 ? String.fromCharCode(x) : CP1251[x - 0x80]; return s; }
}

/** Строки CSV с кавычками («"Иванов; Пётр"», «""» внутри); разделитель — ; , или табуляция, какой чаще в первой строке. @param {string} text @param {number} [max] */
export function csvRows(text, max = 20000) {
  const first = text.split(/\r?\n/).find(l => l.trim()) || "";
  const count = (/** @type {string} */ ch) => first.split(ch).length - 1;
  const d = count("\t") > 0 && count("\t") >= count(";") ? "\t" : count(";") >= count(",") && count(";") > 0 ? ";" : ",";
  /** @type {string[][]} */
  const rows = [];
  let row = /** @type {string[]} */ ([]), cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === d) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(x => x.trim())) rows.push(row);
      row = [];
      if (rows.length >= max + 1) return rows;
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(x => x.trim())) rows.push(row);
  return rows;
}

const HEAD = { phone: /тел|phone|номер|моб|whats|ватсап|вацап/i, name: /имя|name|фио|клиент|аты|есім/i, consent: /соглас|consent|рассыл|подпис|келісім/i };

/**
 * Какая колонка что: по заголовку, а без заголовка — номер там, где больше всего номеров, имя — первая колонка с буквами.
 * @param {string[][]} rows
 * @param {(s: string) => string} phoneOf нормализация номера (пусто — не номер)
 * @returns {{ header: boolean, phone: number, name: number, consent: number }} -1 — колонки нет
 */
export function tableColumns(rows, phoneOf) {
  const top = rows[0] || [];
  const find = (/** @type {RegExp} */ re) => top.findIndex(x => re.test(String(x || "")));
  const header = top.some(x => HEAD.phone.test(String(x || "")) || HEAD.name.test(String(x || ""))) && !top.some(x => phoneOf(String(x || "")));
  if (header) {
    const phone = find(HEAD.phone), name = top.findIndex((x, i) => i !== phone && HEAD.name.test(String(x || ""))), consent = top.findIndex((x, i) => i !== phone && i !== name && HEAD.consent.test(String(x || "")));
    if (phone >= 0) return { header, phone, name, consent };
  }
  const body = rows.slice(header ? 1 : 0, 51), width = Math.max(0, ...body.map(r => r.length));
  let phone = -1, best = 0;
  for (let i = 0; i < width; i++) { const n = body.filter(r => phoneOf(String(r[i] || ""))).length; if (n > best) { best = n; phone = i; } }
  let name = -1;
  for (let i = 0; i < width && name < 0; i++) if (i !== phone && body.filter(r => /\p{L}{2}/u.test(String(r[i] || ""))).length >= Math.max(1, body.length / 2)) name = i;
  return { header, phone, name, consent: -1 };
}

/** «да», «yes», «1», «+», «согласен» → granted; «нет», «no», «0», «-» → denied; пусто или другое → null. @param {any} v */
export function consentValue(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(да|yes|y|1|\+|true|согласен|согласна|есть|иә|ия)$/.test(s)) return "granted";
  if (/^(нет|no|n|0|-|false|не согласен|не согласна|жоқ)$/.test(s)) return "denied";
  return null;
}
