// «Автоматические сообщения» в проверках (services/automsg, 02.11.2026): включить сценарии так, как это делает владелец в пульте —
// настройки msgset:<клиент> в KV. По умолчанию всё выключено, поэтому проверки отправки сначала включают нужные сценарии.
// LEGACY — время, как работало до раздела: накануне в 18:00, за 2 часа, отзыв через 3 часа (у записей проверок нет длительности — от начала),
// одному клиенту не чаще раза в 60 дней.
export const LEGACY = { remind24: { mode: "eve", eve: "18:00" }, remind3: { hours: 2 }, review: { hours: 3, gap: 60 } };

/** @param {any} s стенд из harness (mk) @param {Record<string, boolean>} on @param {Record<string, any>} [t] время сценариев @param {string} [cid] */
export async function autoOn(s, on, t = {}, cid = "winchester") {
  const raw = await s.kv.api.get("msgset:" + cid);
  const cur = raw ? JSON.parse(raw) : {};
  cur.s = cur.s || {};
  for (const [id, v] of Object.entries(on)) {
    const was = (cur.s[id] && cur.s[id].t) || {};
    cur.s[id] = { on: !!v, at: 1, by: "test", t: { ...was, ...(LEGACY[id] || {}), ...(t[id] || {}) } };
  }
  await s.kv.api.put("msgset:" + cid, JSON.stringify(cur));
}
/** как было до раздела: напоминания накануне и за 2 часа и отзыв включены; подтверждение и перенос — как в паспорте (c.jr.s01, c.jr.s06)
 *  @param {any} W клиент из CLIENTS */
export const legacyOn = W => ({ remind24: true, remind3: true, review: true, confirm: !!(W.jr && W.jr.s01), move: !!(W.jr && W.jr.s06) });
