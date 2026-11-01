// @ts-check
// Слияние изменений чата (переписки в D1, 01.11.2026). Код бота, вебхуков и пульта работает с чатом как с одним объектом
// { n, turns, profile }: прочитал → поменял → записал. В KV такая запись затирала всё, что успел записать кто-то другой между чтением
// и записью (живая проверка стенда 01.11.2026: две точки сети Cloudflare видят разные копии). Здесь запись разбирается на изменения:
// новые сообщения — новые строки, изменённые поля сообщений и профиля — только те, что поменял сам пишущий. Пишущий «поменял» поле,
// если его значение отличается от всех копий, которые он прочитал в этом запросе: если оно совпадает хоть с одной, он просто перенёс
// старое значение (think() читает чат дважды — в начале и перед записью), и текущее значение в базе остаётся.
// Только чистые функции: без базы, сети и часов.
/** @import { Profile } from "../../lib/types.js" */
import { stNext } from "../inbox/status.js";

/** @typedef {{ [k: string]: any }} Turn */
/** @typedef {{ absent?: boolean, rev: number, n: number, profile: Record<string, any>, turns: Turn[] }} Snap копия чата, как её прочитал пишущий (turns — с _i, номером строки) */
/** @typedef {{ n: number, profile: Record<string, any>, turns: Turn[] }} Mine то, что пишущий записывает */

const json = (/** @type {any} */ v) => (v === undefined ? "\u0000" : JSON.stringify(v));
const eq = (/** @type {any} */ a, /** @type {any} */ b) => json(a) === json(b);

// ---- устойчивый ключ сообщения
/** 64-битный отпечаток строки (два FNV-1a с разной затравкой): для ключа сообщения без номера у провайдера @param {string} s */
export function fp(s) {
  let a = 2166136261, b = 0x811c9dc5 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 16777619) ^ (b >>> 13); }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}
/** Ключ сообщения в чате: номер у провайдера (у входящего и нашего — разный суффикс), номер отправки пульта или отпечаток неизменяемых полей.
 *  Текст в отпечатке — только у сообщений без номера: их текст не меняется (правят только входящие Green-API, а у них номер есть).
 *  @param {Turn} t @param {number} [pos] место в переписке — только для старых реплик без времени */
export function mkeyOf(t, pos) {
  const r = t.role === "user" ? "u" : "m";
  if (t.mid) return `m:${String(t.mid).slice(0, 80)}:${r}`;
  if (t.rid) return `r:${String(t.rid).slice(0, 80)}`;
  const tt = +t.t || 0;
  return `h:${r}:` + fp([tt || "#" + (pos ?? 0), t.by || "", t.rm || "", t.bc || "", t.op || "", String(t.text ?? "").slice(0, 500)].join("|"));
}
/** реплика без служебных полей хранилища @param {Turn} t */
export function bare(t) { const { _i, ...rest } = t || {}; return rest; }

// ---- профиль: поле за полем
/** у объектов в списках — свой «паспорт», по нему список сливается по элементам @param {any} x */
const idOf = x => (x && typeof x === "object" ? x.leadId ?? x.key ?? x.rid ?? x.mid ?? x.id ?? json(x) : json(x));
/** Список: добавленное пишущим — в конец, удалённое им (было во всех его копиях, а у него нет) — убрать, изменённый элемент — заменить.
 *  Чего пишущий не видел (добавил кто-то другой), остаётся. @param {any[][]} seen @param {any[]} mine @param {any[] | undefined} cur */
export function mergeList(seen, mine, cur) {
  const sets = seen.map(s => new Map((Array.isArray(s) ? s : []).map(x => [idOf(x), x])));
  const mineIds = new Set(mine.map(idOf));
  const removed = new Set(sets.length ? [...sets[0].keys()].filter(id => !mineIds.has(id) && sets.every(m => m.has(id))) : []);
  const out = [];
  const curIds = new Set();
  for (const x of Array.isArray(cur) ? cur : []) {
    const id = idOf(x);
    if (removed.has(id)) continue;
    curIds.add(id);
    const m = mine.find(y => idOf(y) === id);
    // элемент поменял пишущий (его версия отличается от всех, что он видел) — берём его версию
    out.push(m !== undefined && sets.some(s => s.has(id)) && sets.every(s => !s.has(id) || !eq(s.get(id), m)) ? m : x);
  }
  for (const m of mine) { const id = idOf(m); if (!curIds.has(id) && sets.every(s => !s.has(id))) { out.push(m); curIds.add(id); } } // новое у пишущего; удалённое другими не возвращаем
  return out;
}
/** @param {Record<string, any>[]} seen профили, которые прочитал пишущий @param {Record<string, any>} mine @param {Record<string, any>} cur текущий в базе */
export function mergeProfile3(seen, mine, cur) {
  if (!seen.length) return { ...cur, ...mine }; // запись без чтения: свои поля — поверх, чего пишущий не знает — не удаляется
  const S = seen;
  /** @type {Record<string, any>} */
  const out = { ...cur };
  const keys = new Set([...Object.keys(mine), ...S.flatMap(s => Object.keys(s || {}))]);
  for (const k of keys) {
    const m = mine[k];
    if (!S.every(s => !eq((s || {})[k], m))) continue; // не менял — остаётся текущее
    if (m === undefined) { delete out[k]; continue; }
    if (Array.isArray(m)) { out[k] = mergeList(S.map(s => (s || {})[k]), m, cur[k]); continue; }
    // пауза бота, последнее сообщение клиента и «прочитано» — только вперёд: более поздняя пауза или отметка «прочитано» другого
    // запроса (второй сотрудник открыл чат позже) не откатывается
    if ((k === "pausedUntil" || k === "li" || k === "rd") && typeof m === "number") { out[k] = Math.max(m, +cur[k] || 0); continue; }
    out[k] = m;
  }
  return out;
}

// ---- сообщение: поле за полем; статус — только растёт (как у вебхуков: поздний «отправлено» не опускает «прочитано»)
/** @param {Turn[]} seen версии этой реплики в прочитанных копиях @param {Turn} mine @param {Turn} cur @returns {Turn | null} новая версия или null — без изменений */
export function mergeTurn3(seen, mine, cur) {
  const m = bare(mine), c = bare(cur), S = (seen.length ? seen : [cur]).map(bare);
  /** @type {Turn} */
  const out = { ...c };
  const changed = (/** @type {string} */ f) => S.every(s => !eq(s[f], m[f]));
  for (const f of new Set([...Object.keys(m), ...S.flatMap(s => Object.keys(s))])) {
    if (f === "st" || f === "se" || !changed(f)) continue;
    if (m[f] === undefined) delete out[f]; else out[f] = m[f];
  }
  if (changed("st") && m.st) {
    const next = stNext(c.st, m.st);
    if (next) { out.st = next; if (next === "failed" && m.se) out.se = m.se; else if (next !== "failed") delete out.se; }
  } else if (changed("se") && (out.st === "failed" || m.st === "failed")) { if (m.se === undefined) delete out.se; else out.se = m.se; }
  return eq(out, c) ? null : out;
}

/** Что записать в базу: новые сообщения, изменения сообщений, удаления, профиль и счётчик n.
 *  seen — копии, прочитанные пишущим в этом запросе (последняя — самая свежая); cur — то, что сейчас в базе (с _i);
 *  удаление сообщений — только явное: пустая переписка у пишущего («Очистить память», «Удалить данные») или новая отметка forgot —
 *  иначе пропажа реплики значит лишь, что она ушла за 60 последних или пишущий её не видел.
 *  @param {Snap[]} seen @param {Mine} mine @param {Snap} cur
 *  @returns {{ n: number, profile: Record<string, any>, inserts: Turn[], updates: { id: number, data: Turn }[], deletes: number[] }} */
export function planPut(seen, mine, cur) {
  const S = seen.length ? seen : [cur], last = S[S.length - 1];
  const curById = new Map(cur.turns.map(t => [+t._i, t]));
  const mineTurns = Array.isArray(mine.turns) ? mine.turns : [];
  const inserts = [], updates = [], deletes = new Set(), seenKeys = new Set(cur.turns.map((t, i) => mkeyOf(t, i)));
  for (const [i, t] of mineTurns.entries()) {
    if (!t || typeof t !== "object") continue;
    if (t._i === undefined) { const k = mkeyOf(t, i); if (!seenKeys.has(k)) { seenKeys.add(k); inserts.push(bare(t)); } continue; }
    const id = +t._i, c = curById.get(id);
    if (!c) continue; // сообщения уже нет (удалили, истёк срок) — не возвращаем
    const vers = S.map(s => s.turns.find(x => +x._i === id)).filter(Boolean);
    const next = mergeTurn3(/** @type {Turn[]} */ (vers), t, c);
    if (next) updates.push({ id, data: next });
  }
  const mineIds = new Set(mineTurns.filter(t => t && t._i !== undefined).map(t => +t._i));
  const lastTurns = last.turns || [];
  if (!mineTurns.length && lastTurns.length) for (const t of lastTurns) deletes.add(+t._i); // переписку очистили
  const forgot = +(mine.profile || {}).forgot || 0;
  if (forgot > Math.max(0, ...S.map(s => +((s.profile || {}).forgot) || 0))) for (const t of lastTurns) if (!mineIds.has(+t._i) && (+t.t || 0) < forgot) deletes.add(+t._i);
  const profile = mergeProfile3(S.map(s => s.profile || {}), mine.profile || {}, cur.profile || {});
  const dn = (+mine.n || 0) - (+last.n || 0);
  const n = last.absent && !S.some(s => !s.absent) ? Math.max(+cur.n || 0, +mine.n || 0) : (+cur.n || 0) + Math.max(0, dn);
  return { n, profile, inserts, updates: updates.filter(u => !deletes.has(u.id)), deletes: [...deletes] };
}
