// @ts-check
// Аналитика сообщений (ТЗ v2.0 §8): события в таблице events (миграция 0001). event_key UNIQUE — повтор вебхука Green-API
// (он повторяет каждую минуту до суток) второй раз не считается. Только числа: номера и тексты сюда не пишутся.
import { TZ } from "../../lib/time.js";

/** @param {any} db @param {string} ws @param {string} key @param {string} kind @param {Record<string, any>} details @param {number} at */
export async function msgEventAdd(db, ws, key, kind, details, at) {
  await db.prepare("insert into events (ws, event_key, kind, actor, details, at) values (?, ?, ?, 'provider', ?, ?) on conflict do nothing")
    .bind(ws, key.slice(0, 200), kind, JSON.stringify(details), at).run();
}

/** Какие из этих событий уже записаны: галочки открытого чата (services/inbox/status.js → stFresh). Поиск по уникальному ключу и своей компании.
 *  @param {any} db @param {string} ws @param {string[]} keys @returns {Promise<Set<string>>} */
export async function msgEventKeys(db, ws, keys) {
  if (!keys.length) return new Set();
  const r = await db.prepare(`select event_key from events where ws = ? and event_key in (${keys.map(() => "?").join(", ")})`).bind(ws, ...keys).all();
  return new Set((r.results || []).map((/** @type {any} */ x) => String(x.event_key)));
}

/** Числа за период: вид события × источник сообщения. @param {any} db @param {string} ws @param {number} from @param {number} to */
export async function msgEventCounts(db, ws, from, to) {
  const r = await db.prepare("select kind, json_extract(details, '$.src') src, count(*) n from events where ws = ? and at >= ? and at < ? and kind like 'msg\\_%' escape '\\' group by kind, src")
    .bind(ws, from, to).all();
  return /** @type {{ kind: string, src: string | null, n: number }[]} */ (r.results || []);
}

/**
 * Для календаря (ТЗ v3.0 P1): по дням Астаны — ушло и не дошло (по источнику и рассылке), «стоп», неоднозначный «стоп», согласия.
 * Только числа. @param {any} db @param {string} ws @param {number} from @param {number} to
 * @returns {Promise<{ d: string, kind: string, src: string | null, bc: string | null, state: string | null, conf: number | null, ev: string | null, n: number }[]>}
 */
export async function dayEvents(db, ws, from, to) {
  const r = await db.prepare(`select date(at / 1000 + ${TZ * 3600}, 'unixepoch') d, kind, json_extract(details, '$.src') src, campaign_id bc,
      case when kind = 'consent' then json_extract(details, '$.state') end state, case when kind = 'consent' then json_extract(details, '$.confirmed') end conf,
      case when kind = 'consent' then json_extract(details, '$.evidence') end ev, count(*) n
    from events where ws = ?1 and at >= ?2 and at < ?3 and kind in ('msg_sent', 'msg_failed', 'stop', 'full_block', 'stop_review', 'consent')
      and (kind <> 'consent' or json_extract(details, '$.purpose') = 'marketing')
    group by 1, 2, 3, 4, 5, 6, 7`).bind(ws, from, to).all();
  return /** @type {any} */ (r.results || []);
}
