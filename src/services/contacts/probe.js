// @ts-check
// Проверка полей Altegio только чтением (этап 1, 31.10.2026): какие поля журнал записей и карточка клиента отдают на самом деле
// с ключом журнала Winchester, работает ли фильтр changed_after, видны ли удалённые записи и номера телефонов.
// В отчёт — только имена полей, доли, числа и значения «да/нет»; ни имён, ни номеров, ни текстов. Отчёт сохраняется в журнал
// событий D1 (altegio_probe) — его видно в пульте и через подключение Cloudflare.
/** @import { Env, Client } from "../../lib/types.js" */
import { logSafe, normPhone } from "../../lib/phone.js";
import { altCall } from "../integrations/altegio/client.js";
import { altUserKey } from "../booking/journal.js";
import { altLoc } from "../booking/book.js";
import { d1Ready } from "../../db/d1/status.js";
import { eventPut } from "../../db/d1/contacts.js";
import { syncWhy } from "./sync.js";
import { dayOf, dayAdd, altMs } from "./normalize.js";

/** «2026-10-30T15:00:00+05:00» → «9999-99-99T99:99:99+99:99». @param {any} v */
const shape = v => typeof v === "string" ? v.replace(/\d/g, "9").slice(0, 40) : v === null ? "null" : typeof v;
/** Поля объектов: доля заполненных, типы, образец формы (у дат). @param {any[]} list */
function fieldsOf(list) {
  /** @type {Record<string, { n: number, types: Set<string>, shape?: string }>} */
  const f = {};
  for (const x of list) for (const [k, v] of Object.entries(x && typeof x === "object" ? x : {})) {
    const e = f[k] || (f[k] = { n: 0, types: new Set() });
    if (v !== null && v !== undefined && v !== "") e.n++;
    e.types.add(Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
    if (!e.shape && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) e.shape = shape(v);
  }
  return Object.entries(f).map(([k, e]) => ({ key: k, filled: e.n, of: list.length, types: [...e.types].join("/"), ...(e.shape ? { shape: e.shape } : {}) }));
}
/** Сколько записей с каким значением поля. @param {any[]} list @param {string} k @returns {Record<string, number>} */
function dist(list, k) {
  /** @type {Record<string, number>} */
  const d = {};
  for (const x of list) { const v = x && x[k], s = v === undefined ? "нет поля" : v === null ? "null" : String(v).slice(0, 12); d[s] = (d[s] || 0) + 1; }
  return d;
}
/** @param {Record<string, number>} d */
const show = d => Object.entries(d).map(([k, v]) => `${k} — ${v}`).join(", ");
/** @param {any} e */
const errOf = e => `ошибка ${+(e && e.status) || "связи"}`;

/** @param {Env} env @param {Client} c @param {number} now */
export async function altProbe(env, c, now) {
  const why = syncWhy(env, c);
  if (why) return { at: now, ok: false, summary: [why], fields: null };
  const user = altUserKey(env, c), loc = altLoc(env, c), today = dayOf(now), summary = [], /** @type {Record<string, any>} */ fields = {};
  let ok = true;
  // 1. журнал: 30 дней назад и 30 вперёд, первая страница
  /** @type {any[]} */
  let recs = [];
  try {
    const d = await altCall(env, "GET", `/records/${loc}?start_date=${dayAdd(today, -30)}&end_date=${dayAdd(today, 30)}&count=100&page=1`, null, user);
    recs = (Array.isArray(d) ? d : []).filter(x => x && typeof x === "object");
    summary.push(`Журнал: прочитано ${recs.length} записей (первая страница, ${dayAdd(today, -30)} … ${dayAdd(today, 30)})`);
  } catch (e) { ok = false; summary.push(`Журнал не прочитан: ${errOf(e)}`); console.log("probe", logSafe(String(e))); }
  if (recs.length) {
    fields.record = fieldsOf(recs);
    fields.client = fieldsOf(recs.map(x => x.client).filter(Boolean));
    fields.staff = fieldsOf(recs.map(x => x.staff).filter(Boolean));
    fields.services = fieldsOf(recs.flatMap(x => Array.isArray(x.services) ? x.services : []));
    const has = (/** @type {string} */ k) => { const e = fields.record.find((/** @type {any} */ x) => x.key === k); return e ? `${e.filled} из ${e.of}${e.shape ? `, вид ${e.shape}` : ""}` : "поля нет"; };
    summary.push(`Дата создания записи (create_date): ${has("create_date")}`);
    summary.push(`Дата изменения (last_change_date): ${has("last_change_date")}`);
    summary.push(`Время визита (datetime): ${has("datetime")}`);
    summary.push(`attendance: ${show(dist(recs, "attendance"))}`);
    summary.push(`visit_attendance: ${show(dist(recs, "visit_attendance"))}`);
    summary.push(`deleted: ${show(dist(recs, "deleted"))}`);
    const ph = { ok: 0, masked: 0, bad: 0, empty: 0, noclient: 0 };
    for (const r of recs) { if (!r.client || typeof r.client !== "object") { ph.noclient++; continue; } const raw = String(r.client.phone ?? ""); if (normPhone(raw)) ph.ok++; else if (/[xх*]/i.test(raw)) ph.masked++; else if (raw.trim()) ph.bad++; else ph.empty++; }
    summary.push(`Номера клиентов: полные ${ph.ok}, скрытые ${ph.masked}, неверные ${ph.bad}, пустые ${ph.empty}, записей без клиента ${ph.noclient}`);
    summary.push(`id клиента Altegio (client.id): ${(fields.client.find((/** @type {any} */ x) => x.key === "id") || { filled: 0 }).filled} из ${recs.filter(x => x.client).length}`);
    fields.dist = { attendance: dist(recs, "attendance"), visit_attendance: dist(recs, "visit_attendance"), deleted: dist(recs, "deleted"), phones: ph };
  }
  // 2. фильтр по дате изменения: если работает, синхронизацию можно сделать дешевле (сейчас — окнами по датам)
  try {
    const iso = (/** @type {number} */ ms) => new Date(ms).toISOString().slice(0, 19);
    const d = await altCall(env, "GET", `/records/${loc}?changed_after=${iso(now - 3 * 86400e3)}&changed_before=${iso(now)}&count=100&page=1`, null, user);
    const arr = (Array.isArray(d) ? d : []).filter(x => x && typeof x === "object");
    const inRange = arr.filter(x => { const t = altMs(x.last_change_date); return t && t >= now - 3 * 86400e3 - 6 * 3600e3 && t <= now + 6 * 3600e3; }).length;
    summary.push(`Фильтр changed_after (3 дня): вернул ${arr.length}${arr.length >= 100 ? "+" : ""} записей, из них с датой изменения в эти 3 дня — ${inRange}` + (arr.length && !inRange ? " (похоже, фильтр не работает)" : ""));
    fields.changedAfter = { returned: arr.length, inRange };
  } catch (e) { summary.push(`Фильтр changed_after: ${errOf(e)}`); fields.changedAfter = { error: +(/** @type {any} */ (e).status) || 0 }; }
  // 3. карточка клиента: какие поля есть (согласия на рассылки, «не отправлять SMS»); значения — только у полей про рассылки и
  // согласия и только да/нет (пол, категории и прочее о человеке не берём)
  const cid = (recs.find(x => x.client && x.client.id) || { client: {} }).client.id;
  if (cid) {
    try {
      const d = await altCall(env, "GET", `/client/${loc}/${encodeURIComponent(String(cid))}`, null, user);
      const o = d && typeof d === "object" ? d : {};
      const keys = Object.keys(o).sort(), flags = Object.fromEntries(Object.entries(o).filter(([k, v]) => /sms|send|mail|push|allow|consent|newsletter|notif|agree|personal|spam|subscri/i.test(k) && (typeof v === "boolean" || v === 0 || v === 1)));
      summary.push(`Карточка клиента: полей ${keys.length}: ${keys.join(", ")}`);
      summary.push(`Флаги «да/нет» в карточке: ${show(/** @type {any} */ (flags)) || "нет"}`);
      fields.clientCard = { keys, flags };
    } catch (e) { summary.push(`Карточка клиента: ${errOf(e)}`); }
  }
  const report = { at: now, ok, summary, fields };
  const db = await d1Ready(env, now);
  if (db) { try { await eventPut(db, c.id, `probe:${now}`, "altegio_probe", report, now, "owner"); } catch (e) { console.log("probe save", String(e)); } }
  return report;
}
