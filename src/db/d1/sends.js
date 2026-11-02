// @ts-check
// Отметки отправки из пульта (миграция 0005_send_claims.sql): одно нажатие «Отправить» — одна строка (компания, канал, чат, rid).
// Атомарная вставка решает, кто отправляет: из одновременных запросов с тем же rid вставка проходит ровно у одного.

/** @typedef {{ ws: string, ch: string, chat: string, rid: string }} SendKey */
/** @typedef {{ state: "pending" | "sent" | "unknown" | "refused", mid: string | null, updated_at: number }} SendRow */

const KEEP_MS = 30 * 86400e3; // отметки старше 30 дней удаляются при новых отправках этой компании

/** Есть ли в базе таблица отметок (миграция 0005). Нет — это настройка, а не сбой связи. @param {any} db @returns {Promise<boolean>} */
export async function sendTableReady(db) {
  return !!(await db.prepare("select name from sqlite_master where type = 'table' and name = 'send_claims'").first());
}

/**
 * Занять отправку. own: true — отправляем мы; own: false — уже отправляется или отправлено (row — что известно).
 * Отказ Green-API (refused: ничего не ушло) можно занять снова: «Повторить» в пульте с тем же rid. owner — номер этого запроса.
 * @param {any} db @param {SendKey} k @param {number} now @param {string} owner
 * @returns {Promise<{ own: true } | { own: false, row: SendRow | null }>}
 */
export async function claimSend(db, k, now, owner) {
  const [ins] = await db.batch([
    db.prepare("insert into send_claims (ws, ch, chat, rid, state, owner, created_at, updated_at) values (?1, ?2, ?3, ?4, 'pending', ?6, ?5, ?5) on conflict do nothing")
      .bind(k.ws, k.ch, k.chat, k.rid, now, owner),
    db.prepare("delete from send_claims where ws = ?1 and created_at < ?2").bind(k.ws, now - KEEP_MS)
  ]);
  if (ins && ins.meta && ins.meta.changes === 1) return { own: true };
  const re = await db.prepare("update send_claims set state = 'pending', mid = null, owner = ?6, updated_at = ?5 where ws = ?1 and ch = ?2 and chat = ?3 and rid = ?4 and state = 'refused'")
    .bind(k.ws, k.ch, k.chat, k.rid, now, owner).run();
  if (re && re.meta && re.meta.changes === 1) return { own: true };
  return { own: false, row: await sendRow(db, k) };
}

/** @param {any} db @param {SendKey} k @returns {Promise<SendRow | null>} */
async function sendRow(db, k) {
  const row = await db.prepare("select state, mid, updated_at from send_claims where ws = ?1 and ch = ?2 and chat = ?3 and rid = ?4").bind(k.ws, k.ch, k.chat, k.rid).first();
  return row ? { state: row.state, mid: row.mid == null ? null : String(row.mid), updated_at: +row.updated_at || 0 } : null;
}

/**
 * Освободить свою строку, если вставка могла пройти, а ответ базы потерялся (Green-API ещё не вызывали): pending этого запроса →
 * refused, «Повторить» с тем же rid отправит. → mine: строки нет или освободили; other — строку держит другой запрос с тем же rid.
 * @param {any} db @param {SendKey} k @param {string} owner @param {number} now @returns {Promise<{ mine: true } | { mine: false, row: SendRow }>}
 */
export async function releaseSend(db, k, owner, now) {
  await db.prepare("update send_claims set state = 'refused', updated_at = ?6 where ws = ?1 and ch = ?2 and chat = ?3 and rid = ?4 and state = 'pending' and owner = ?5")
    .bind(k.ws, k.ch, k.chat, k.rid, owner, now).run();
  const row = await sendRow(db, k);
  return !row || row.state === "refused" ? { mine: true } : { mine: false, row };
}

/**
 * Итог отправки. Только своя строка (owner) и только из pending: строку, которую уже закрыли или заняли снова, не трогаем.
 * @param {any} db @param {SendKey} k @param {"sent" | "unknown" | "refused"} state @param {string} mid @param {number} now @param {string} owner
 */
export async function finishSend(db, k, state, mid, now, owner) {
  await db.prepare("update send_claims set state = ?5, mid = ?6, updated_at = ?7 where ws = ?1 and ch = ?2 and chat = ?3 and rid = ?4 and state = 'pending' and owner = ?8")
    .bind(k.ws, k.ch, k.chat, k.rid, state, mid || null, now, owner).run();
}
