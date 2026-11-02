// @ts-check
// Состояние синхронизации в D1 (sync_state): курсор первичной загрузки, когда окно читалось удачно, последняя ошибка, аренда.
// Строка (ws, source, scope): source — 'altegio'; scope — 'initial', 'hot', 'future', 'past', 'probe', 'lock'.

/**
 * @typedef {{ ws: string, source: string, scope: string, last_ok_at: number|null, last_error: string|null, last_error_at: number|null,
 *   cursor: string|null, lease_until: number|null, lease_token: string|null, stats: string|null }} SyncRow
 */

/** @param {any} db @param {string} ws @param {string} source @returns {Promise<SyncRow[]>} */
export async function syncRows(db, ws, source) {
  return (await db.prepare("select * from sync_state where ws = ? and source = ?").bind(ws, source).all()).results || [];
}

/**
 * Взять аренду: две синхронизации одной компании одновременно не идут (фоновая задача и кнопка, два экземпляра Worker).
 * Условное обновление в D1 выполняется по очереди — из двух одновременных берёт один. → true, если взяли.
 * @param {any} db @param {string} ws @param {string} source @param {string} token @param {number} now @param {number} ms
 */
export async function leaseTake(db, ws, source, token, now, ms) {
  await db.prepare("insert into sync_state (ws, source, scope) values (?, ?, 'lock') on conflict do nothing").bind(ws, source).run();
  const r = await db.prepare("update sync_state set lease_until = ?, lease_token = ? where ws = ? and source = ? and scope = 'lock' and (lease_until is null or lease_until < ? or lease_token = ?) returning lease_token")
    .bind(now + ms, token, ws, source, now, token).all();
  return (r.results || []).length === 1;
}
/** @param {any} db @param {string} ws @param {string} source @param {string} token */
export async function leaseFree(db, ws, source, token) {
  await db.prepare("update sync_state set lease_until = null, lease_token = null where ws = ? and source = ? and scope = 'lock' and lease_token = ?").bind(ws, source, token).run();
}

/** Оператор «окно прочитано удачно» — кладётся в ту же пачку, что и данные окна (одна транзакция). @param {any} db */
export function syncOkStmt(db, /** @type {string} */ ws, /** @type {string} */ source, /** @type {string} */ scope, /** @type {number} */ now, /** @type {string|null} */ cursor, /** @type {any} */ stats) {
  return db.prepare(`insert into sync_state (ws, source, scope, last_ok_at, cursor, stats) values (?1, ?2, ?3, ?4, ?5, ?6)
    on conflict (ws, source, scope) do update set last_ok_at = excluded.last_ok_at, cursor = coalesce(excluded.cursor, sync_state.cursor), stats = excluded.stats`)
    .bind(ws, source, scope, now, cursor, stats == null ? null : JSON.stringify(stats));
}
/** Курсор без отметки удачи (первичная загрузка продвинулась). @param {any} db */
export function syncCursorStmt(db, /** @type {string} */ ws, /** @type {string} */ source, /** @type {string} */ scope, /** @type {string} */ cursor) {
  return db.prepare("insert into sync_state (ws, source, scope, cursor) values (?, ?, ?, ?) on conflict (ws, source, scope) do update set cursor = excluded.cursor").bind(ws, source, scope, cursor);
}
/** @param {any} db @param {string} ws @param {string} source @param {string} scope @param {string} text @param {number} now */
export async function syncFail(db, ws, source, scope, text, now) {
  await db.batch([
    db.prepare("insert into sync_state (ws, source, scope, last_error, last_error_at) values (?, ?, ?, ?, ?) on conflict (ws, source, scope) do update set last_error = excluded.last_error, last_error_at = excluded.last_error_at").bind(ws, source, scope, text, now),
    db.prepare("insert into events (ws, event_key, kind, actor, details, at) values (?, ?, 'sync_error', 'sync', ?, ?) on conflict do nothing").bind(ws, `sync:${source}:${scope}:${now}`, JSON.stringify({ scope, text }), now)
  ]);
}
/** Ошибка закрыта удачным проходом: текст остаётся в журнале событий, в состоянии — нет. @param {any} db */
export function syncClearStmt(db, /** @type {string} */ ws, /** @type {string} */ source, /** @type {string} */ scope) {
  return db.prepare("update sync_state set last_error = null, last_error_at = null where ws = ? and source = ? and scope = ?").bind(ws, source, scope);
}
