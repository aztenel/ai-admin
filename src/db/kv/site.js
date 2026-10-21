// @ts-check
// Онлайн-запись на сайте клиента (services/sitebook): отметки запросов записи, счётчики попыток и пределов записей.
//   sb:<клиент>:<rid>   — «идёт запись» ({ st: "busy" }) или готовый ответ ({ st: "done", http, res }), 15 минут: двойное нажатие
//                         и повтор формы после обрыва связи не создают вторую запись (book_record вслепую не повторяем, CLAUDE.md §5.2)
//   sbh:<лок>:<адрес>:<ГГГГ-ММ-ДДTЧЧ> — попыток записи с одного адреса за час (2 часа хранения)
//   bk:<лок>:…:<день>   — пределы записей (формат ключей — как у бота, services/booking/limits.js)
// KV не атомарен: одновременные запросы читали одно значение и записывали одно и то же (проба 21.10.2026: остаток 1 из 15 с адреса,
// 5 одновременных запросов — 5 записей, счётчик 15 вместо 19). Поэтому в памяти экземпляра — последнее записанное значение каждого
// счётчика, брони запросов, которые ещё идут, и очередь записи по ключу: запросы одного экземпляра видят друг друга сразу и не теряют
// прибавлений. Между экземплярами Worker KV по-прежнему не атомарен (как у бота) — это остаток риска.

/** @param {string} cid @param {string} rid */
const sbKey = (cid, rid) => `sb:${cid}:${rid}`;

/** @param {any} store @param {string} cid @param {string} rid @returns {Promise<any>} */
export async function sbGet(store, cid, rid) {
  const v = await store.get(sbKey(cid, rid));
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}
/** @param {any} store @param {string} cid @param {string} rid @param {any} v */
export async function sbPut(store, cid, rid, v) { await store.put(sbKey(cid, rid), JSON.stringify(v), { expirationTtl: 900 }); }
/** @param {any} store @param {string} cid @param {string} rid */
export async function sbDrop(store, cid, rid) { await store.delete(sbKey(cid, rid)); }

// ---- счётчики в памяти экземпляра: n — последнее записанное значение (действует 60 с: KV за это время уже согласован, а удаление
// ключа — «Удалить данные клиента», «Очистить память бота» — не перекрывается старым значением), p — брони идущих запросов
/** @type {Map<string, { n: number, p: number, at: number }>} */
const cnt = new Map();
const FLOOR_MS = 60e3;
/** @param {{ n: number, at: number }} c */
const floor = c => Date.now() - c.at < FLOOR_MS ? c.n : 0;
/** @param {{ n: number, at: number }} c @param {number} n */
const wrote = (c, n) => { c.n = n; c.at = Date.now(); };
/** @param {string} k */
const C = k => {
  let v = cnt.get(k);
  if (!v) {
    if (cnt.size > 5000) for (const [key, x] of cnt) if (!x.p) cnt.delete(key); // ключи с днём или часом в имени устаревают сами
    v = { n: 0, p: 0, at: Date.now() }; cnt.set(k, v);
  }
  return v;
};
/** @type {Map<string, Promise<any>>} */
const chain = new Map();
// задачи с одним ключом — по очереди (в пределах экземпляра): «прочитал → прибавил → записал» без потерянных прибавлений
/** @template T @param {string} k @param {() => Promise<T>} f @returns {Promise<T>} */
function serial(k, f) {
  const prev = chain.get(k) || Promise.resolve(), p = prev.then(f, f), tail = p.then(() => {}, () => {});
  chain.set(k, tail);
  tail.then(() => { if (chain.get(k) === tail) chain.delete(k); });
  return p;
}

// попытка записи с адреса: → число попыток за этот час до неё; не меньше max — не считаем дальше (запись в KV не нужна)
/** @param {any} store @param {number} loc @param {string} ip @param {string} hour ГГГГ-ММ-ДДTЧЧ по Астане @param {number} max @returns {Promise<number>} */
export function sbHourHit(store, loc, ip, hour, max) {
  const k = `sbh:${loc}:${ip}:${hour}`;
  return serial(k, async () => {
    const c = C(k), n = Math.max(+(await store.get(k) || 0), floor(c));
    if (n < max) { wrote(c, n + 1); await store.put(k, String(n + 1), { expirationTtl: 7200 }); }
    return n;
  });
}

/**
 * Бронь пределов записей: list — [[ключ, предел]]. → { over: ключ, который уже исчерпан } или { over: null, done(ok) }:
 * done(true) — запись (или заявка) состоялась, счётчики +1; done(false) — нет, бронь снимается. Проверка и бронь — без await между
 * ними: одновременный запрос этого экземпляра увидит бронь
 * @param {any} store @param {[string, number][]} list
 * @returns {Promise<{ over: string, done: (ok: boolean) => Promise<void> } | { over: null, done: (ok: boolean) => Promise<void> }>}
 */
export async function sbHold(store, list) {
  const vals = await Promise.all(list.map(([k]) => store.get(k)));
  for (let i = 0; i < list.length; i++) {
    const [k, max] = list[i], c = C(k);
    if (Math.max(+(vals[i] || 0), floor(c)) + c.p >= max) return { over: k, done: async () => {} };
  }
  for (const [k] of list) C(k).p++;
  let fin = false;
  return {
    over: null,
    done: async ok => {
      if (fin) return;
      fin = true;
      try {
        if (!ok) return;
        const r = await Promise.allSettled(list.map(([k]) => serial(k, async () => {
          const c = C(k), n = Math.max(+(await store.get(k) || 0), floor(c)) + 1;
          wrote(c, n); await store.put(k, String(n), { expirationTtl: 2 * 86400 });
        })));
        const bad = r.find(x => x.status === "rejected");
        if (bad) throw /** @type {PromiseRejectedResult} */ (bad).reason;
      } finally { for (const [k] of list) { const c = C(k); c.p = Math.max(0, c.p - 1); } }
    }
  };
}
