// @ts-check
// Демо-база черновика в D1 (31.10.2026): отметка «демо» у контактов (источник 'demo'), отчёты демо-рассылок (events msg_* с номером
// рассылки и контакта, outbound), отметка загрузки (sync_state, source 'demo') и удаление только демо-строк. Что такое демо-строка:
// контакт с источником 'demo' или с номером из демо-диапазона (phones), запись с номером 'demo-…', событие с ключом 'demo:…',
// отправка с ключом 'demo:…', импорт с именем файла демо. Остальные данные компании не трогаются.
import { chunks } from "./contacts.js";

/** Применена ли миграция 0004 (источник 'demo' разрешён). @param {any} db */
export async function demoReady(db) {
  return !!(await db.prepare("select 1 n from sqlite_master where type = 'index' and name = 'contact_sources_demo'").first("n"));
}

/** Отметить контакты с этими номерами демо-источником. @param {any} db @param {string} ws @param {string[]} phones @param {number} at */
export function demoSourceStmts(db, ws, phones, at) {
  return chunks(phones, 500).map(part => db.prepare(`insert into contact_sources (contact_id, ws, source, external_id, first_seen, last_seen)
    select c.id, ?1, 'demo', 'demo', ?2, ?2 from contacts c where c.ws = ?1 and c.phone in (select value from json_each(?3)) on conflict do nothing`).bind(ws, at, JSON.stringify(part)));
}

/**
 * Отчёты демо-рассылок одной пачкой: events (kind msg_sent / msg_delivered / msg_read / msg_failed / msg_replied, с campaign_id и contact_id —
 * их читают /api/bc/stats, итоги рассылки и календарь) и outbound (реклама за 30 дней в карточке клиента). Ключи — с номером контакта
 * в базе, а не телефоном (номера в журнал событий не пишем): 'demo:msg:<рассылка>:<контакт>:<вид>', 'demo:<рассылка>:<контакт>'.
 * @param {any} db @param {string} ws
 * @param {{ events: { kind: string, bc: string, p: string, at: number, ch: string }[], sends: { bc: string, p: string, at: number, ok: boolean, ch: string }[] }} x
 */
export async function demoReports(db, ws, x) {
  const list = [];
  for (const part of chunks(x.events, 400)) list.push(db.prepare(`insert into events (ws, event_key, kind, contact_id, campaign_id, actor, details, at)
    select ?1, 'demo:msg:' || (j.value ->> '$.bc') || ':' || c.id || ':' || (j.value ->> '$.kind'), 'msg_' || (j.value ->> '$.kind'), c.id, j.value ->> '$.bc', 'demo', json_object('ch', j.value ->> '$.ch', 'src', 'campaign', 'demo', 1), j.value ->> '$.at'
    from json_each(?2) j join contacts c on c.ws = ?1 and c.phone = j.value ->> '$.p' where true on conflict do nothing`).bind(ws, JSON.stringify(part)));
  for (const part of chunks(x.sends, 400)) list.push(db.prepare(`insert into outbound (ws, send_key, channel, contact_id, purpose, campaign_id, text_hash, state, error, created_at, sent_at)
    select ?1, 'demo:' || (j.value ->> '$.bc') || ':' || c.id, j.value ->> '$.ch', c.id, 'marketing', j.value ->> '$.bc', 'demo', case when j.value ->> '$.ok' then 'sent' else 'failed' end,
      case when j.value ->> '$.ok' then null else 'демо: не доставлено' end, j.value ->> '$.at', case when j.value ->> '$.ok' then j.value ->> '$.at' end
    from json_each(?2) j join contacts c on c.ws = ?1 and c.phone = j.value ->> '$.p' where true on conflict do nothing`).bind(ws, JSON.stringify(part)));
  if (list.length) await db.batch(list);
}

/** Отметка загрузки: когда и что (рассылки, дни отметок «писали рекламу»). @param {any} db @param {string} ws @param {number} at @param {any} info */
export function demoMarkStmt(db, ws, at, info) {
  return db.prepare(`insert into sync_state (ws, source, scope, last_ok_at, cursor) values (?1, 'demo', 'base', ?2, ?3)
    on conflict (ws, source, scope) do update set last_ok_at = excluded.last_ok_at, cursor = excluded.cursor`).bind(ws, at, JSON.stringify(info));
}
/** @param {any} db @param {string} ws @returns {Promise<{ at: number, info: any } | null>} */
export async function demoMark(db, ws) {
  const r = await db.prepare("select last_ok_at, cursor from sync_state where ws = ? and source = 'demo' and scope = 'base'").bind(ws).first();
  if (!r) return null;
  /** @type {any} */ let info = {}; try { info = JSON.parse(r.cursor || "{}") || {}; } catch (e) {}
  return { at: +r.last_ok_at || 0, info };
}
/** Сколько контактов помечены демо. @param {any} db @param {string} ws */
export async function demoCount(db, ws) {
  return +((await db.prepare("select count(distinct contact_id) n from contact_sources where ws = ? and source = 'demo'").bind(ws).first("n")) || 0);
}

/**
 * Удалить демо одной пачкой (транзакция). phones — номера демо-диапазона (контакт мог остаться без отметки, если загрузка оборвалась),
 * file — имя файла демо-импорта. → сколько контактов удалено.
 * @param {any} db @param {string} ws @param {string[]} phones @param {string} file @param {string[]} optKeys ключи «стопа» демо-номеров (sync_issues)
 */
export async function demoDelete(db, ws, phones, file, optKeys) {
  const ids = ((await db.prepare(`select id from contacts where ws = ?1 and (id in (select contact_id from contact_sources where ws = ?1 and source = 'demo') or phone in (select value from json_each(?2)))`)
    .bind(ws, JSON.stringify(phones)).all()).results || []).map((/** @type {any} */ r) => String(r.id));
  const J = JSON.stringify(ids), mine = "(contact_id in (select value from json_each(?2)))";
  await db.batch([
    db.prepare(`delete from outcomes where ws = ?1 and outbound_id in (select id from outbound where ws = ?1 and (${mine} or send_key like 'demo:%'))`).bind(ws, J),
    db.prepare(`delete from outbound where ws = ?1 and (${mine} or send_key like 'demo:%')`).bind(ws, J),
    db.prepare(`delete from jobs where ws = ?1 and ${mine}`).bind(ws, J),
    db.prepare(`delete from campaign_recipients where ws = ?1 and ${mine}`).bind(ws, J),
    db.prepare(`delete from bookings where ws = ?1 and (${mine} or record_id like 'demo-%')`).bind(ws, J),
    db.prepare(`delete from events where ws = ?1 and (event_key like 'demo:%' or ${mine} or event_key in (select 'import:' || id from imports where ws = ?1 and source_name = ?3))`).bind(ws, J, file),
    db.prepare("delete from imports where ws = ?1 and source_name = ?2").bind(ws, file),
    db.prepare("delete from sync_issues where ws = ?1 and key in (select value from json_each(?2))").bind(ws, JSON.stringify(optKeys)),
    db.prepare(`delete from contacts where ws = ?1 and id in (select value from json_each(?2))`).bind(ws, J), // источники, согласия, запреты — каскадом
    db.prepare("delete from sync_state where ws = ? and source = 'demo'").bind(ws)
  ]);
  return ids.length;
}
