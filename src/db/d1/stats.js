// @ts-check
// Аналитика сообщений (ТЗ v2.0 §8): события в таблице events (миграция 0001). event_key UNIQUE — повтор вебхука Green-API
// (он повторяет каждую минуту до суток) второй раз не считается. Только числа: номера и тексты сюда не пишутся.

/** @param {any} db @param {string} ws @param {string} key @param {string} kind @param {Record<string, any>} details @param {number} at */
export async function msgEventAdd(db, ws, key, kind, details, at) {
  await db.prepare("insert into events (ws, event_key, kind, actor, details, at) values (?, ?, ?, 'provider', ?, ?) on conflict do nothing")
    .bind(ws, key.slice(0, 200), kind, JSON.stringify(details), at).run();
}

/** Числа за период: вид события × источник сообщения. @param {any} db @param {string} ws @param {number} from @param {number} to */
export async function msgEventCounts(db, ws, from, to) {
  const r = await db.prepare("select kind, json_extract(details, '$.src') src, count(*) n from events where ws = ? and at >= ? and at < ? and kind like 'msg\\_%' escape '\\' group by kind, src")
    .bind(ws, from, to).all();
  return /** @type {{ kind: string, src: string | null, n: number }[]} */ (r.results || []);
}
