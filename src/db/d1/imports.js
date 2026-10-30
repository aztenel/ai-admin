// @ts-check
// Импорт контактов в D1 (этап 1, 31.10.2026): предпросмотр хранится строками import_rows, подтверждение — одна пачка (транзакция).
// Повторное или одновременное «Загрузить» ничего не делает: первая операция пачки переводит импорт preview → confirmed со своей
// меткой времени, остальные выполняются, только если метка их (сбой пачки — откат целиком, импорт снова можно подтвердить).
import { chunks } from "./contacts.js";

/**
 * @param {any} db @param {string} ws
 * @param {{ id: string, mode: string, by: string, at: number, sourceName: string, counts: Record<string, number>, rows: any[] }} x
 */
export async function importSave(db, ws, x) {
  const c = x.counts, list = [db.prepare(`insert into imports (id, ws, mode, state, total, valid, dup, invalid, new_contacts, updated, same, created_by, created_at, source_name)
    values (?, ?, ?, 'preview', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(x.id, ws, x.mode, c.total, c.total - c.invalid - c.dup, c.dup, c.invalid, c.new, c.update, c.same, x.by, x.at, x.sourceName.slice(0, 120))];
  for (const part of chunks(x.rows, 1000)) list.push(db.prepare(`insert into import_rows (import_id, row_no, phone, name, consent, error, action)
    select ?1, j.value ->> '$.row', j.value ->> '$.p', j.value ->> '$.n', j.value ->> '$.c', j.value ->> '$.e', j.value ->> '$.a' from json_each(?2) j`).bind(x.id, JSON.stringify(part)));
  await db.batch(list);
}
/** @param {any} db @param {string} ws @param {string} id */
export async function importGet(db, ws, id) {
  return await db.prepare("select * from imports where ws = ? and id = ?").bind(ws, id).first();
}
/** Строки импорта для подтверждения (только те, что пойдут в базу). @param {any} db @param {string} id */
export async function importRows(db, id) {
  return (await db.prepare("select row_no, phone, name, consent, action from import_rows where import_id = ? and action in ('new', 'update', 'same') order by row_no").bind(id).all()).results || [];
}
/** @param {any} db @param {string} ws @param {string} id @param {number} at */
export async function importDiscard(db, ws, id, at) {
  const [r] = await db.batch([
    db.prepare("update imports set state = 'discarded', confirmed_at = ? where ws = ? and id = ? and state = 'preview' returning id").bind(at, ws, id),
    db.prepare("delete from import_rows where import_id = ? and exists (select 1 from imports where id = ? and state = 'discarded')").bind(id, id)
  ]);
  return (r.results || []).length === 1;
}

/**
 * Подтвердить импорт. rows: [{ p, n, s, c }] — новые и обновлённые; consent: { basis } — записать согласия из файла (только с основанием).
 * → { ok: false } если импорт уже подтверждён или отменён.
 * @param {any} db @param {string} ws @param {string} id
 * @param {{ fresh: any[], update: any[], consents: any[], basis: string, ref: string, actor: string, at: number }} x
 */
export async function importConfirm(db, ws, id, x) {
  const mine = "exists (select 1 from imports where id = ?9 and state = 'confirmed' and confirmed_at = ?8)";
  const list = [db.prepare("update imports set state = 'confirmed', confirmed_at = ? where ws = ? and id = ? and state = 'preview' returning id").bind(x.at, ws, id)];
  for (const part of chunks(x.fresh, 1000)) list.push(db.prepare(`insert into contacts (id, ws, phone, name, search, created_at, updated_at)
    select lower(hex(randomblob(16))), ?1, j.value ->> '$.p', nullif(j.value ->> '$.n', ''), j.value ->> '$.s', ?8, ?8 from json_each(?2) j where ${mine}
    on conflict (ws, phone) do nothing`).bind(ws, JSON.stringify(part), null, null, null, null, null, x.at, id));
  for (const part of chunks(x.update, 1000)) list.push(db.prepare(`update contacts set name = j.value ->> '$.n', search = j.value ->> '$.s', updated_at = ?8
    from json_each(?2) j where contacts.ws = ?1 and contacts.phone = j.value ->> '$.p' and ${mine}`).bind(ws, JSON.stringify(part), null, null, null, null, null, x.at, id));
  for (const part of chunks([...x.fresh, ...x.update], 1000)) list.push(db.prepare(`insert into contact_sources (contact_id, ws, source, external_id, import_id, first_seen, last_seen)
    select c.id, ?1, 'import', '', ?9, ?8, ?8 from json_each(?2) j join contacts c on c.ws = ?1 and c.phone = j.value ->> '$.p' where ${mine} on conflict do nothing`).bind(ws, JSON.stringify(part), null, null, null, null, null, x.at, id));
  // согласие из файла — НЕ подтверждено (одного текста основания мало, решение владельца 31.10.2026): реклама ему не уйдёт, пока
  // согласие не подтвердят в карточке. Отказ из файла — подтверждён (отказ уважаем всегда)
  for (const part of chunks(x.consents, 1000)) list.push(db.prepare(`insert into consents (ws, contact_id, purpose, state, basis, source, actor, created_at, evidence, evidence_ref, confirmed, given_at)
    select ?1, c.id, 'marketing', j.value ->> '$.c', ?3, 'import', ?4, ?8, 'import', ?5, case when (j.value ->> '$.c') = 'denied' then 1 else 0 end, null
    from json_each(?2) j join contacts c on c.ws = ?1 and c.phone = j.value ->> '$.p' where ${mine}`).bind(ws, JSON.stringify(part), x.basis.slice(0, 200), x.actor, x.ref.slice(0, 200), null, null, x.at, id));
  list.push(db.prepare(`insert into events (ws, event_key, kind, actor, details, at) select ?1, 'import:' || ?9, 'import', ?2, ?3, ?8 where ${mine} on conflict do nothing`)
    .bind(ws, x.actor, JSON.stringify({ new: x.fresh.length, updated: x.update.length, consents: x.consents.length }), null, null, null, null, x.at, id));
  list.push(db.prepare(`insert into audit (ws, actor, action, target, details, at) select ?1, ?2, 'import_confirm', ?9, ?3, ?8 where ${mine}`)
    .bind(ws, x.actor, JSON.stringify({ new: x.fresh.length, updated: x.update.length, consents: x.consents.length }), null, null, null, null, x.at, id));
  list.push(db.prepare(`delete from import_rows where import_id = ?9 and ${mine}`).bind(null, null, null, null, null, null, null, x.at, id));
  const res = await db.batch(list);
  return { ok: (res[0].results || []).length === 1 };
}
/** Отменить зависшие предпросмотры старше суток (их строки — персональные данные). @param {any} db @param {number} before */
export async function importsExpire(db, before) {
  await db.batch([
    db.prepare("delete from import_rows where import_id in (select id from imports where state = 'preview' and created_at < ?)").bind(before),
    db.prepare("update imports set state = 'discarded' where state = 'preview' and created_at < ?").bind(before)
  ]);
}
