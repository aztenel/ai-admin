// @ts-check
// Контакты и записи в D1 (этап 1, 31.10.2026): запись пачками через json_each (один параметр — до 500 строк: у D1 предел
// 100 параметров на запрос и 1000 запросов на вызов), пересчёт сводки клиента по его записям, выборки для списка и карточки.
// Компания (ws) — всегда первым условием. Правила (что такое визит, сегменты) — здесь только как SQL, решают их сервисы.
import { TZ } from "../../lib/time.js";

const TZS = TZ * 3600; // секунды: день визита — по календарю Астаны
const CHUNK = 500;
/** @template T @param {T[]} a @param {number} [n] @returns {T[][]} */
export const chunks = (a, n = CHUNK) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

// визит — прошедшая запись: не удалена и клиент не «не пришёл» (attendance = -1); ?1 — сейчас. Как crmFold в services/crm/snapshot.js
const VISIT = "b.ws = contacts.ws and b.contact_id = contacts.id and b.deleted = 0 and b.starts_at <= ?1 and coalesce(b.attendance, 0) <> -1";
const RECOMPUTE = `update contacts set
  first_visit_at = (select min(b.starts_at) from bookings b where ${VISIT}),
  last_visit_at = (select max(b.starts_at) from bookings b where ${VISIT}),
  visits = (select count(distinct date(b.starts_at / 1000 + ${TZS}, 'unixepoch')) from bookings b where ${VISIT}),
  next_booking_at = (select min(b.starts_at) from bookings b where b.ws = contacts.ws and b.contact_id = contacts.id and b.deleted = 0 and b.starts_at > ?1),
  last_staff = (select b.staff from bookings b where ${VISIT} order by b.starts_at desc limit 1),
  last_service = (select b.services from bookings b where ${VISIT} order by b.starts_at desc limit 1),
  updated_at = ?1`;

/** Номера → id и имя существующих контактов. @param {any} db @param {string} ws @param {string[]} phones @returns {Promise<Map<string, { id: string, name: string|null }>>} */
export async function contactsByPhones(db, ws, phones) {
  const out = new Map();
  for (const part of chunks(phones, 2000)) {
    const r = await db.prepare("select id, phone, name from contacts where ws = ?1 and phone in (select value from json_each(?2))").bind(ws, JSON.stringify(part)).all();
    for (const x of r.results || []) out.set(String(x.phone), { id: String(x.id), name: x.name == null ? null : String(x.name) });
  }
  return out;
}

/**
 * Окно журнала Altegio → D1 одной пачкой (транзакция): контакты, источники, записи, пометка пропавших записей удалёнными,
 * пересчёт сводки затронутых клиентов и отметка синхронизации (extra — операторы sync_state). Затронутые — у кого запись
 * в этой пачке добавилась или изменилась (last_seen_at = stamp), плюс прежние владельцы записей (номер у записи сменился).
 * @param {any} db
 * @param {string} ws
 * @param {{ contacts: any[], bookings: any[], window?: { from: number, to: number, ids: string[] } | null, oldIds?: string[], stamp: number, extra?: any[], coolMs?: number }} q
 */
export async function windowApply(db, ws, q) {
  const s = q.stamp, list = [];
  for (const part of chunks(q.contacts)) {
    list.push(db.prepare(`insert into contacts (id, ws, phone, name, altegio_client_id, search, created_at, updated_at, synced_at)
      select j.value ->> '$.id', ?1, j.value ->> '$.p', nullif(j.value ->> '$.n', ''), j.value ->> '$.cr', j.value ->> '$.s', ?2, ?2, ?2 from json_each(?3) j where true
      on conflict (ws, phone) do update set altegio_client_id = coalesce(excluded.altegio_client_id, contacts.altegio_client_id), synced_at = excluded.synced_at
      where excluded.altegio_client_id is not null and excluded.altegio_client_id is not contacts.altegio_client_id`).bind(ws, s, JSON.stringify(part)));
    // имя — из самой поздней записи: первичная загрузка идёт от сегодня в прошлое, и старое имя не должно затирать новое
    list.push(db.prepare(`update contacts set name = j.value ->> '$.n', search = j.value ->> '$.s', synced_at = ?2 from json_each(?3) j
      where contacts.ws = ?1 and contacts.phone = j.value ->> '$.p' and j.value ->> '$.n' <> '' and contacts.name is not (j.value ->> '$.n')
        and coalesce((select max(b.starts_at) from bookings b where b.ws = contacts.ws and b.contact_id = contacts.id and b.deleted = 0), 0) <= (j.value ->> '$.at')`).bind(ws, s, JSON.stringify(part)));
    list.push(db.prepare(`insert into contact_sources (contact_id, ws, source, external_id, first_seen, last_seen)
      select c.id, ?1, 'altegio', coalesce(j.value ->> '$.cr', ''), ?2, ?2 from json_each(?3) j join contacts c on c.ws = ?1 and c.phone = j.value ->> '$.p' where true
      on conflict do nothing`).bind(ws, s, JSON.stringify(part)));
  }
  for (const part of chunks(q.bookings)) {
    list.push(db.prepare(`insert into bookings (ws, record_id, contact_id, client_ref, starts_at, provider_created_at, staff, services, attendance, deleted, gone, hash, first_seen_at, last_seen_at)
      select ?1, j.value ->> '$.id', c.id, j.value ->> '$.cr', j.value ->> '$.at', j.value ->> '$.ca', j.value ->> '$.st', j.value ->> '$.sv', j.value ->> '$.att', j.value ->> '$.del',
        case when (j.value ->> '$.del') = 1 then 'cancelled' end, j.value ->> '$.h', ?2, ?2
      from json_each(?3) j left join contacts c on c.ws = ?1 and c.phone = j.value ->> '$.p' where true
      on conflict (ws, record_id) do update set contact_id = excluded.contact_id, client_ref = excluded.client_ref, starts_at = excluded.starts_at,
        provider_created_at = excluded.provider_created_at, staff = excluded.staff, services = excluded.services, attendance = excluded.attendance,
        deleted = excluded.deleted, gone = excluded.gone, hash = excluded.hash, last_seen_at = excluded.last_seen_at
      where bookings.hash is not excluded.hash`).bind(ws, s, JSON.stringify(part)));
  }
  // окно прочитано целиком: записи этого окна, которых в ответе нет, удалены в Altegio (администратор удаляет — запись пропадает)
  if (q.window) list.push(db.prepare(`update bookings set deleted = 1, gone = 'vanished', hash = 'deleted', last_seen_at = ?1
    where ws = ?2 and deleted = 0 and starts_at >= ?3 and starts_at < ?4 and record_id not in (select value from json_each(?5))`).bind(s, ws, q.window.from, q.window.to, JSON.stringify(q.window.ids)));
  // отменённая или пропавшая будущая запись не возвращает клиента в рекламу сразу: пауза (cooldown) на ?3 мс, одна на запись
  // (legacy_key 'cancel:<запись>'); запись нашлась снова (перенос за край окна) — пауза снимается. Решение владельца 31.10.2026
  if (q.coolMs) {
    list.push(db.prepare(`insert into restrictions (ws, contact_id, kind, channel, until_at, reason, source, actor, legacy_key, needs_review, created_at)
      select ?2, b.contact_id, 'cooldown', '', ?1 + ?3, case b.gone when 'cancelled' then 'Запись отменена в Altegio' else 'Запись пропала из журнала Altegio (отмена или перенос)' end,
        'booking_cancelled', 'sync', 'cancel:' || b.record_id, 0, ?1
      from bookings b where b.ws = ?2 and b.last_seen_at = ?1 and b.deleted = 1 and b.contact_id is not null and b.starts_at > ?1 - 86400000
      on conflict (ws, legacy_key) where legacy_key is not null do update set lifted_at = null, lifted_by = null, lift_reason = null, until_at = excluded.until_at,
        reason = excluded.reason, created_at = excluded.created_at`).bind(s, ws, q.coolMs));
    list.push(db.prepare(`update restrictions set lifted_at = ?1, lifted_by = 'sync', lift_reason = 'запись снова в журнале Altegio'
      where ws = ?2 and kind = 'cooldown' and lifted_at is null and legacy_key in (select 'cancel:' || record_id from bookings where ws = ?2 and last_seen_at = ?1 and deleted = 0)`).bind(s, ws));
  }
  list.push(db.prepare(`${RECOMPUTE} where ws = ?2 and (id in (select contact_id from bookings where ws = ?2 and last_seen_at = ?1 and contact_id is not null) or id in (select value from json_each(?3)))`)
    .bind(s, ws, JSON.stringify(q.oldIds || [])));
  list.push(...(q.extra || []));
  await db.batch(list);
}

/** Прежние владельцы записей (у записи сменился номер — сводку старого клиента тоже пересчитать). @param {any} db @param {string} ws @param {any[]} rows */
export async function ownersOf(db, ws, rows) {
  const out = new Set();
  for (const part of chunks(rows.map(r => ({ id: r.id, p: r.p })), 2000)) {
    const r = await db.prepare(`select distinct b.contact_id from bookings b join json_each(?2) j on j.value ->> '$.id' = b.record_id
      join contacts c on c.id = b.contact_id where b.ws = ?1 and c.phone is not (j.value ->> '$.p')`).bind(ws, JSON.stringify(part)).all();
    for (const x of r.results || []) out.add(String(x.contact_id));
  }
  return [...out];
}
/** Сколько не удалённых записей в окне сейчас в базе. @param {any} db @param {string} ws @param {number} from @param {number} to */
export async function windowCount(db, ws, from, to) {
  return +((await db.prepare("select count(*) n from bookings where ws = ? and deleted = 0 and starts_at >= ? and starts_at < ?").bind(ws, from, to).first("n")) || 0);
}

/** Пересчитать сводку: where — 'stale' (ближайшая запись уже прошла), 'all' или список id. @param {any} db @param {string} ws @param {number} now @param {'stale'|'all'|string[]} which */
export async function recompute(db, ws, now, which) {
  const w = which === "stale" ? "and next_booking_at is not null and next_booking_at <= ?1" : which === "all" ? "" : "and id in (select value from json_each(?3))";
  const r = await db.prepare(`${RECOMPUTE} where ws = ?2 ${w}`).bind(now, ws, ...(Array.isArray(which) ? [JSON.stringify(which)] : [])).run();
  return +((r.meta && r.meta.changes) || 0);
}

// ---- выборки для пульта
// k — контакт с вычисленными полями: lastv — последний визит (журнал или справочник Altegio — что позже), d — дней с него (по
// календарю Астаны), booked — запись впереди, blocked — действующий запрет маркетинга или полный (или «стоп» в старом хранилище KV, ?3),
// review — ждёт решения, cooled — пауза после отменённой записи, consent и cconf — последнее согласие на маркетинг и подтверждено ли,
// v90 — визитов за 90 дней, recent — маркетинг за последние ?4 мс. ?1 — компания, ?2 — сейчас
const LASTV = "nullif(max(coalesce(c.last_visit_at, 0), coalesce(c.alt_last_visit_at, 0)), 0)";
const K = `with k as (select c.id, c.name, c.phone, c.search, c.visits, c.first_visit_at, c.last_visit_at, c.next_booking_at, c.last_staff, c.created_at,
  c.alt_visits as altv, ${LASTV} as lastv,
  case when ${LASTV} is null then null else cast(julianday(date(?2 / 1000 + ${TZS}, 'unixepoch')) - julianday(date(${LASTV} / 1000 + ${TZS}, 'unixepoch')) as integer) end as d,
  case when c.next_booking_at > ?2 then 1 else 0 end as booked,
  case when exists (select 1 from restrictions r where r.ws = c.ws and r.contact_id = c.id and r.lifted_at is null and r.kind in ('marketing_optout', 'full_block')) or c.phone in (select value from json_each(?3)) then 1 else 0 end as blocked,
  case when exists (select 1 from restrictions r where r.ws = c.ws and r.contact_id = c.id and r.lifted_at is null and r.kind = 'full_block') then 1 else 0 end as full,
  case when exists (select 1 from restrictions r where r.ws = c.ws and r.contact_id = c.id and r.lifted_at is null and r.needs_review = 1) then 1 else 0 end as review,
  coalesce((select s.state from consents s where s.ws = c.ws and s.contact_id = c.id and s.purpose = 'marketing' order by s.id desc limit 1), 'unknown') as consent,
  coalesce((select s.confirmed from consents s where s.ws = c.ws and s.contact_id = c.id and s.purpose = 'marketing' order by s.id desc limit 1), 0) as cconf,
  (select max(r.until_at) from restrictions r where r.ws = c.ws and r.contact_id = c.id and r.lifted_at is null and r.kind = 'cooldown' and r.until_at > ?2) as cool_until,
  case when exists (select 1 from restrictions r where r.ws = c.ws and r.contact_id = c.id and r.lifted_at is null and r.kind = 'cooldown' and r.until_at > ?2) then 1 else 0 end as cooled,
  (select count(distinct date(b.starts_at / 1000 + ${TZS}, 'unixepoch')) from bookings b where b.ws = c.ws and b.contact_id = c.id and b.deleted = 0 and b.starts_at <= ?2 and b.starts_at > ?2 - 7776000000 and coalesce(b.attendance, 0) <> -1) as v90,
  case when exists (select 1 from outbound o where o.ws = c.ws and o.contact_id = c.id and o.purpose = 'marketing' and o.state in ('sending', 'sent', 'unknown') and o.created_at > ?2 - ?4) then 1 else 0 end as recent
  from contacts c where c.ws = ?1)`;

/** Номера, которым можно рекламу по согласию и запретам (подтверждённое «да», нет запрета, решения не ждёт, нет паузы после
 *  отмены) — для рассылок по базе Altegio (services/crm, ТЗ v2.0 §5). @param {any} db @param {string} ws @param {number} now @param {string[]} kvStops @param {number} gapMs */
export async function consentReadyPhones(db, ws, now, kvStops, gapMs) {
  const r = await db.prepare(`${K} select phone from k where consent = 'granted' and cconf = 1 and blocked = 0 and review = 0 and cooled = 0`).bind(ws, now, JSON.stringify(kvStops), gapMs).all();
  return new Set((r.results || []).map((/** @type {any} */ x) => String(x.phone)));
}
/**
 * Числа по сегментам: всего и сколько из них можно писать рекламу (ready — условие сервиса).
 * @param {any} db @param {string} ws @param {number} now @param {string[]} kvStops @param {number} gapMs
 * @param {{ id: string, where: string }[]} segs @param {string} ready
 */
export async function segmentCounts(db, ws, now, kvStops, gapMs, segs, ready) {
  const cols = segs.map((x, i) => `sum(case when (${x.where}) then 1 else 0 end) as c${i}, sum(case when (${x.where}) and (${ready}) then 1 else 0 end) as r${i}`).join(", ");
  const [one, staff] = await db.batch([
    db.prepare(`${K} select ${cols} from k`).bind(ws, now, JSON.stringify(kvStops), gapMs),
    db.prepare(`${K} select last_staff as staff, count(*) as n, sum(case when (${ready}) then 1 else 0 end) as r from k where last_staff is not null group by last_staff order by n desc limit 30`).bind(ws, now, JSON.stringify(kvStops), gapMs)
  ]);
  const row = (one.results || [])[0] || {};
  return { segs: segs.map((x, i) => ({ id: x.id, count: +(row["c" + i] || 0), ready: +(row["r" + i] || 0) })), staff: (staff.results || []).map((/** @type {any} */ x) => ({ staff: String(x.staff), count: +x.n, ready: +(x.r || 0) })) };
}

/**
 * Страница списка: where — условие сегмента (с параметром ?5 — имя мастера), q — строка поиска в нижнем регистре.
 * @param {any} db @param {string} ws @param {number} now @param {string[]} kvStops @param {number} gapMs
 * @param {{ where: string, staff?: string, q: string, page: number, per: number }} f
 */
export async function contactsPage(db, ws, now, kvStops, gapMs, f) {
  const q = f.q.replace(/[\\%_]/g, x => "\\" + x);
  const cond = `(${f.where}) and (?6 = '' or search like '%' || ?6 || '%' escape '\\')`;
  const args = [ws, now, JSON.stringify(kvStops), gapMs, f.staff || "", q];
  const [n, rows] = await db.batch([
    db.prepare(`${K} select count(*) n from k where ${cond}`).bind(...args),
    db.prepare(`${K} select k.*, (select group_concat(distinct s.source) from contact_sources s where s.contact_id = k.id) as sources from k where ${cond}
      order by lastv desc nulls last, created_at desc, id limit ?7 offset ?8`).bind(...args, f.per, (f.page - 1) * f.per)
  ]);
  return { total: +(((n.results || [])[0] || {}).n || 0), rows: rows.results || [] };
}

/**
 * Всё для карточки клиента одной пачкой; segs — условия сегментов (в каких он состоит: s0, s1, …).
 * @param {any} db @param {string} ws @param {string} id @param {number} now @param {string[]} kvStops @param {number} gapMs @param {{ where: string }[]} segs
 */
export async function contactCard(db, ws, id, now, kvStops, gapMs, segs) {
  const flags = segs.map((x, i) => `(${x.where}) as s${i}`).join(", ");
  const [c, k, b, cs, r, src, ev] = await db.batch([
    db.prepare("select * from contacts where ws = ? and id = ?").bind(ws, id),
    db.prepare(`${K} select *, ${flags} from k where id = ?5`).bind(ws, now, JSON.stringify(kvStops), gapMs, id),
    db.prepare("select record_id, starts_at, staff, services, attendance, deleted from bookings where ws = ? and contact_id = ? order by starts_at desc limit 300").bind(ws, id),
    db.prepare("select purpose, state, basis, source, actor, created_at, evidence, evidence_ref, confirmed, given_at from consents where ws = ? and contact_id = ? order by id desc limit 100").bind(ws, id),
    db.prepare("select * from restrictions where ws = ? and contact_id = ? order by id desc limit 100").bind(ws, id),
    db.prepare("select source, external_id, first_seen from contact_sources where ws = ? and contact_id = ? order by first_seen").bind(ws, id),
    db.prepare("select kind, actor, details, at from events where ws = ? and contact_id = ? order by at desc limit 50").bind(ws, id)
  ]);
  const contact = (c.results || [])[0];
  if (!contact) return null;
  return { contact, k: (k.results || [])[0] || {}, bookings: b.results || [], consents: cs.results || [], restrictions: r.results || [], sources: src.results || [], events: ev.results || [] };
}

/**
 * Новый контакт вручную; есть с таким номером — его id и created: false.
 * @param {any} db @param {string} ws @param {{ id: string, phone: string, name: string, search: string, actor: string, at: number }} x
 */
export async function contactAdd(db, ws, x) {
  const [ins, sel] = await db.batch([
    db.prepare("insert into contacts (id, ws, phone, name, search, created_at, updated_at) values (?, ?, ?, nullif(?, ''), ?, ?, ?) on conflict (ws, phone) do nothing returning id").bind(x.id, ws, x.phone, x.name, x.search, x.at, x.at),
    db.prepare("select id, name from contacts where ws = ? and phone = ?").bind(ws, x.phone)
  ]);
  const created = (ins.results || []).length === 1, id = String(((sel.results || [])[0] || {}).id || "");
  if (created) await db.batch([
    db.prepare("insert into contact_sources (contact_id, ws, source, external_id, first_seen, last_seen) values (?, ?, 'manual', '', ?, ?) on conflict do nothing").bind(id, ws, x.at, x.at),
    db.prepare("insert into events (ws, event_key, kind, contact_id, actor, details, at) values (?, ?, 'contact_added', ?, ?, null, ?) on conflict do nothing").bind(ws, `add:${id}`, id, x.actor, x.at),
    db.prepare("insert into audit (ws, actor, action, target, details, at) values (?, ?, 'contact_add', ?, null, ?)").bind(ws, x.actor, id, x.at)
  ]);
  return { id, created };
}

/** Простые числа для экрана и проверок данных. @param {any} db @param {string} ws @param {number} now */
export async function contactNumbers(db, ws, now) {
  const r = await db.batch([
    db.prepare("select count(*) n, sum(case when visits > 0 then 1 else 0 end) v, sum(case when next_booking_at > ?2 then 1 else 0 end) u, sum(case when next_booking_at is not null and next_booking_at <= ?2 then 1 else 0 end) stale from contacts where ws = ?1").bind(ws, now),
    db.prepare("select count(distinct contact_id) s, sum(case when needs_review = 1 then 1 else 0 end) rv from restrictions where ws = ? and lifted_at is null and kind in ('marketing_optout', 'full_block')").bind(ws),
    db.prepare("select count(*) n from bookings where ws = ? and contact_id is null and deleted = 0").bind(ws),
    db.prepare(`select count(*) n from contacts where ws = ?1 and visits <> (select count(distinct date(b.starts_at / 1000 + ${TZS}, 'unixepoch')) from bookings b where ${VISIT.replace(/\?1/g, "?2")})`).bind(ws, now),
    db.prepare("select count(*) n from sync_issues where ws = ? and resolved_at is null").bind(ws),
    db.prepare("select count(*) n from outbound where ws = ? and state = 'unknown' and resolution is null").bind(ws),
    db.prepare("select count(*) n from bookings where ws = ?").bind(ws)
  ]);
  const v = (/** @type {number} */ i, /** @type {string} */ k) => +((((r[i] || {}).results || [])[0] || {})[k] || 0);
  return { contacts: v(0, "n"), withVisits: v(0, "v"), upcoming: v(0, "u"), staleNext: v(0, "stale"), stops: v(1, "s"), review: v(1, "rv"), orphanBookings: v(2, "n"), visitsMismatch: v(3, "n"), openIssues: v(4, "n"), unknownSends: v(5, "n"), bookings: v(6, "n") };
}

/** Последние события компании нужного вида (ошибки синхронизации, проверки Altegio). @param {any} db @param {string} ws @param {string[]} kinds @param {number} n */
export async function eventsOf(db, ws, kinds, n) {
  return (await db.prepare("select kind, details, at from events where ws = ?1 and kind in (select value from json_each(?2)) order by at desc limit ?3").bind(ws, JSON.stringify(kinds), n).all()).results || [];
}
/** @param {any} db @param {string} ws @param {string} key @param {string} kind @param {any} details @param {number} at @param {string} [actor] */
export async function eventPut(db, ws, key, kind, details, at, actor = "sync") {
  await db.prepare("insert into events (ws, event_key, kind, actor, details, at) values (?, ?, ?, ?, ?, ?) on conflict do nothing").bind(ws, key, kind, actor, details == null ? null : JSON.stringify(details), at).run();
}

/**
 * Справочник клиентов Altegio → контакты (вся база салона, не только журнал за 2 года): номер, имя из карточки Altegio (оно главнее
 * имени из записи), id клиента, первый и последний визит и число визитов по данным Altegio. Неизменённые строки не переписываются.
 * news — проход «разрешил рассылки» (флаг Altegio, не подтверждённое согласие): reset — перед первой страницей флаги сбрасываются
 * (клиент мог запретить рассылки в Altegio). extra — отметка курсора в той же пачке.
 * @param {any} db @param {string} ws @param {any[]} rows [{ id, p, n, s, cr, fv, lv, vc }] или [{ p }] для news @param {number} stamp @param {any[]} extra
 * @param {{ news?: boolean, reset?: boolean }} [mode]
 */
export async function directoryApply(db, ws, rows, stamp, extra, mode = {}) {
  const list = [];
  if (mode.news && mode.reset) list.push(db.prepare("update contacts set alt_newsletter = null where ws = ? and alt_newsletter is not null").bind(ws));
  for (const part of chunks(rows)) {
    const j = JSON.stringify(part);
    if (mode.news) { list.push(db.prepare(`update contacts set alt_newsletter = 1 from json_each(?2) j where contacts.ws = ?1 and contacts.phone = j.value ->> '$.p'`).bind(ws, j)); continue; }
    list.push(db.prepare(`insert into contacts (id, ws, phone, name, altegio_client_id, search, alt_first_visit_at, alt_last_visit_at, alt_visits, created_at, updated_at, synced_at)
      select j.value ->> '$.id', ?1, j.value ->> '$.p', nullif(j.value ->> '$.n', ''), j.value ->> '$.cr', j.value ->> '$.s', j.value ->> '$.fv', j.value ->> '$.lv', j.value ->> '$.vc', ?2, ?2, ?2
      from json_each(?3) j where true
      on conflict (ws, phone) do update set name = coalesce(excluded.name, contacts.name), search = case when excluded.name is not null then excluded.search else contacts.search end,
        altegio_client_id = coalesce(excluded.altegio_client_id, contacts.altegio_client_id), alt_first_visit_at = excluded.alt_first_visit_at, alt_last_visit_at = excluded.alt_last_visit_at,
        alt_visits = excluded.alt_visits, synced_at = excluded.synced_at
      where (excluded.name is not null and excluded.name is not contacts.name) or excluded.altegio_client_id is not contacts.altegio_client_id or excluded.alt_last_visit_at is not contacts.alt_last_visit_at
        or excluded.alt_first_visit_at is not contacts.alt_first_visit_at or excluded.alt_visits is not contacts.alt_visits`).bind(ws, stamp, j));
    list.push(db.prepare(`insert into contact_sources (contact_id, ws, source, external_id, first_seen, last_seen)
      select c.id, ?1, 'altegio', coalesce(j.value ->> '$.cr', ''), ?2, ?2 from json_each(?3) j join contacts c on c.ws = ?1 and c.phone = j.value ->> '$.p' where true
      on conflict do nothing`).bind(ws, stamp, j));
  }
  list.push(...extra);
  await db.batch(list);
}
