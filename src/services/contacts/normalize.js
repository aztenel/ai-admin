// @ts-check
// Запись журнала Altegio → строка bookings и контакт (этап 1, 31.10.2026). Чистые функции, без запросов.
// Правила — как у снимка базы (services/crm/snapshot.js, crmFold): запись без клиента (перерыв мастера) пропускаем; скрытый номер
// («+7 707 XXX-X7-44»: у сотрудника нет права видеть телефоны) и неверный — запись есть, контакта нет (счётчики masked / bad);
// «не пришёл» — attendance или visit_attendance = -1.
import { normPhone } from "../../lib/phone.js";
import { TZ } from "../../lib/time.js";
import { altText } from "../integrations/altegio/client.js";

/** Время Altegio («2026-10-30T15:00:00+05:00», без пояса — по Астане) → мс UTC; не разобрать — 0. @param {any} s */
export function altMs(s) {
  const t = String(s ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(t)) return 0;
  const iso = t.replace(" ", "T"), ms = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + `+0${TZ}:00`);
  return Number.isFinite(ms) ? ms : 0;
}
/** Короткий отпечаток (FNV-1a): изменилась ли запись. @param {any} v */
export function hashOf(v) {
  const s = JSON.stringify(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
/** Поиск: имя в нижнем регистре (ё = е) и цифры номера. @param {any} name @param {string} phone */
export const searchOf = (name, phone) => `${String(name || "").toLowerCase().replace(/ё/g, "е").trim()} ${phone}`.trim();

/**
 * @typedef {{ id: string, p: string|null, n: string, cr: string|null, at: number, ca: number|null, st: string|null, sv: string|null, att: number|null, del: number, h: string }} BookingRow
 */
/**
 * @param {any} r запись журнала
 * @returns {{ row: BookingRow, phone: 'ok'|'masked'|'bad'|'empty' } | null} null — не запись клиента
 */
export function bookingOf(r) {
  if (!r || typeof r !== "object" || r.id == null || !r.client || typeof r.client !== "object") return null;
  const at = altMs(r.datetime);
  if (!at) return null;
  const raw = String(r.client.phone ?? ""), p = normPhone(raw).slice(1) || null;
  const phone = p ? "ok" : /[xх*]/i.test(raw) ? "masked" : raw.trim() ? "bad" : "empty";
  const att = +r.attendance === -1 || +r.visit_attendance === -1 ? -1 : r.attendance != null && Number.isFinite(+r.attendance) ? +r.attendance : null;
  const del = r.deleted === true || r.deleted === 1 || r.deleted === "1" ? 1 : 0;
  const st = altText((r.staff && r.staff.name) || "", 60) || null;
  const sv = (Array.isArray(r.services) ? r.services : []).map((/** @type {any} */ s) => altText(s && s.title, 60)).filter(Boolean).join(" + ").slice(0, 200) || null;
  const ca = altMs(r.create_date) || null, cr = r.client.id != null && String(r.client.id).trim() ? String(r.client.id).slice(0, 40) : null;
  const row = { id: String(r.id).slice(0, 40), p, n: altText(r.client.name || "", 60), cr, at, ca, st, sv, att, del, h: "" };
  row.h = hashOf([p, cr, at, ca, st, sv, att, del]);
  return { row, phone };
}

/**
 * Записи окна → строки для D1: записи и контакты (по номеру; имя — из последней по времени записи, где оно есть).
 * @param {any[]} records
 * @param {() => string} newId
 */
export function foldWindow(records, newId) {
  /** @type {BookingRow[]} */
  const bookings = [];
  /** @type {Map<string, { id: string, p: string, n: string, cr: string|null, s: string, at: number }>} */
  const people = new Map();
  const count = { records: records.length, bookings: 0, masked: 0, bad: 0, empty: 0, deleted: 0, skipped: 0, missed: 0 };
  /** @type {Record<string, number>} */
  const att = {};
  for (const r of records) {
    const b = bookingOf(r);
    if (!b) { count.skipped++; continue; }
    bookings.push(b.row); count.bookings++;
    if (b.phone !== "ok") count[b.phone]++;
    if (b.row.del) count.deleted++;
    if (b.row.att === -1) count.missed++;
    const a = r.attendance == null ? "нет" : String(r.attendance); att[a] = (att[a] || 0) + 1;
    const p = b.row.p;
    if (!p) continue;
    const x = people.get(p);
    if (!x) people.set(p, { id: newId(), p, n: b.row.n, cr: b.row.cr, s: searchOf(b.row.n, p), at: b.row.at });
    else if (b.row.at >= x.at) { if (b.row.n) { x.n = b.row.n; x.s = searchOf(b.row.n, p); } if (b.row.cr) x.cr = b.row.cr; x.at = b.row.at; }
  }
  return { bookings, contacts: [...people.values()], count: { ...count, contacts: people.size, att } };
}

// ---- окна по дням (календарь Астаны)
/** «ГГГГ-ММ-ДД» по Астане. @param {number} ms */
export const dayOf = ms => new Date(ms + TZ * 3600e3).toISOString().slice(0, 10);
/** Полночь дня по Астане, мс UTC. @param {string} day */
export const dayStart = day => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) - TZ * 3600e3;
/** @param {string} day @param {number} n */
export const dayAdd = (day, n) => dayOf(dayStart(day) + n * 86400e3 + 3600e3);
