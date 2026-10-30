// @ts-check
// Импорт контактов из Excel/CSV (этап 1, 31.10.2026): файл → предпросмотр (новые, обновятся, без изменений, дубли в файле, неверные)
// → «Загрузить» одной пачкой D1. Импорт не снимает запреты и не ставит согласие сам: согласие из файла записывается, только если
// человек указал основание («анкета в салоне 2026», «согласие в WhatsApp»). Файл не хранится — только строки предпросмотра,
// они удаляются при подтверждении, отмене или через сутки.
import { normPhone, maskPhone, logSafe } from "../../lib/phone.js";
import { decodeText, csvRows, tableColumns, consentValue } from "../../lib/table.js";
import { isZip, xlsxRows } from "../../lib/xlsx.js";
import { contactsByPhones } from "../../db/d1/contacts.js";
import { importSave, importGet, importRows, importConfirm, importDiscard } from "../../db/d1/imports.js";
import { searchOf } from "./normalize.js";

export const IMPORT_MAX_ROWS = 20000, IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const err = (/** @type {string} */ text) => Object.assign(new Error(text), { code: "input" });
const phoneOf = (/** @type {string} */ s) => normPhone(s).slice(1);
const nameOf = (/** @type {any} */ s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

/** Байты файла (или текст) → строки таблицы. @param {Uint8Array} bytes @param {string} name */
export async function readTable(bytes, name) {
  if (bytes.length > IMPORT_MAX_BYTES) throw err("Файл больше 5 МБ — разделите его на части.");
  if (/\.xls$/i.test(name) && !isZip(bytes)) throw err("Старый формат .xls не читается — сохраните файл как .xlsx или .csv.");
  if (isZip(bytes)) { try { return await xlsxRows(bytes, IMPORT_MAX_ROWS); } catch (e) { throw err("Файл .xlsx не прочитался — сохраните его ещё раз или как .csv."); } }
  return csvRows(decodeText(bytes), IMPORT_MAX_ROWS);
}

/**
 * Предпросмотр: что будет с каждой строкой. Ничего не пишет в контакты — только сохраняет строки предпросмотра.
 * @param {any} db @param {string} ws @param {string[][]} table @param {{ id: string, by: string, at: number, sourceName: string }} x
 */
export async function importPreview(db, ws, table, x) {
  if (!table.length) throw err("В файле нет строк.");
  const cols = tableColumns(table, phoneOf);
  if (cols.phone < 0) throw err("Не нашёл колонку с номерами телефонов. Первая строка — заголовки: «Телефон», «Имя».");
  const body = table.slice(cols.header ? 1 : 0);
  if (body.length > IMPORT_MAX_ROWS) throw err(`В файле больше ${IMPORT_MAX_ROWS} строк — разделите его на части.`);
  const phones = [...new Set(body.map(r => phoneOf(String(r[cols.phone] || ""))).filter(Boolean))];
  const known = await contactsByPhones(db, ws, phones);
  const seen = new Set(), counts = { total: body.length, new: 0, update: 0, same: 0, dup: 0, invalid: 0 }, rows = [];
  let hasConsent = false;
  for (let i = 0; i < body.length; i++) {
    const r = body[i], raw = String(r[cols.phone] ?? ""), p = phoneOf(raw), n = cols.name >= 0 ? nameOf(r[cols.name]) : "", c = cols.consent >= 0 ? consentValue(r[cols.consent]) : null;
    const row = i + 1 + (cols.header ? 1 : 0);
    if (c) hasConsent = true;
    if (!p) { counts.invalid++; rows.push({ row, p: null, n, c, a: "invalid", e: raw.trim() ? "неверный номер" : "нет номера" }); continue; }
    if (seen.has(p)) { counts.dup++; rows.push({ row, p, n, c, a: "dup", e: "этот номер уже был выше в файле" }); continue; }
    seen.add(p);
    const k = known.get(p), a = !k ? "new" : n && n !== k.name ? "update" : "same";
    counts[a]++;
    rows.push({ row, p, n, c, a, e: null });
  }
  await importSave(db, ws, { id: x.id, mode: "saved", by: x.by, at: x.at, sourceName: x.sourceName, counts, rows });
  // в браузер — номера маской и только интересные строки (неверные, дубли, обновления) плюс первые новые
  const show = [...rows.filter(r => r.a !== "new" && r.a !== "same"), ...rows.filter(r => r.a === "new").slice(0, 20)].slice(0, 100).sort((a, b) => a.row - b.row);
  return {
    id: x.id, total: counts.total, counts: { new: counts.new, update: counts.update, same: counts.same, dup: counts.dup, invalid: counts.invalid },
    columns: { phone: cols.phone, name: cols.name, consent: cols.consent }, header: cols.header, hasConsent,
    rows: show.map(r => ({ row: r.row, phone: r.p ? maskPhone(r.p) : "", name: logSafe(r.n), action: r.a, ...(r.e ? { error: r.e } : {}) }))
  };
}

/**
 * «Загрузить»: новые — в базу, у существующих — имя из файла, согласия — только с основанием. Повтор — ничего не делает.
 * @param {any} db @param {string} ws @param {string} id @param {{ basis: string, actor: string, at: number }} x
 */
export async function importApply(db, ws, id, x) {
  const imp = await importGet(db, ws, id);
  if (!imp) throw err("Импорт не найден — загрузите файл заново.");
  if (imp.state !== "preview") return { ok: false, already: true, state: String(imp.state) };
  const rows = await importRows(db, id), basis = String(x.basis || "").trim();
  const fresh = rows.filter((/** @type {any} */ r) => r.action === "new").map((/** @type {any} */ r) => ({ p: r.phone, n: r.name || "", s: searchOf(r.name, r.phone) }));
  const update = rows.filter((/** @type {any} */ r) => r.action === "update").map((/** @type {any} */ r) => ({ p: r.phone, n: r.name, s: searchOf(r.name, r.phone) }));
  const consents = basis ? rows.filter((/** @type {any} */ r) => r.consent === "granted" || r.consent === "denied").map((/** @type {any} */ r) => ({ p: r.phone, c: r.consent })) : [];
  const res = await importConfirm(db, ws, id, { fresh, update, consents, basis, actor: x.actor, at: x.at });
  return res.ok ? { ok: true, created: fresh.length, updated: update.length, consents: consents.length } : { ok: false, already: true };
}
export { importDiscard };
