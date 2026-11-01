// @ts-check
// Переписки в D1 (миграция 0006_chat_storage.sql, 01.11.2026): чат — строка chat_threads, сообщение — строка chat_messages.
// Здесь только SQL. Что именно записать (слияние с тем, что успели записать другие), решает services/chatstore.
// Запись — одна пачка (транзакция D1), и каждый её запрос выполняется, только если ревизия чата та же, что при чтении: иначе пачка
// ничего не меняет, а пишущий перечитывает чат и накладывает свои изменения снова (threadCommit → ok: false).

const KEYS = "ws = ? and ch = ? and chat = ?";
const GUARD = `exists (select 1 from chat_threads where ${KEYS} and rev = ?)`;
/** @param {any[]} a @param {number} n */
const chunks = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
/** @param {string} s */
const parse = s => { try { return JSON.parse(s); } catch (e) { return null; } };

/** @typedef {{ rev: number, n: number, profile: Record<string, any>, meta: Record<string, any>, updatedAt: number, expiresAt: number, src: string, turns: Record<string, any>[] }} Thread */

/** Чат и его последние сообщения (по времени реплики) — одной пачкой. null — чата нет. Сообщения — с _i (номер строки).
 *  @param {any} db @param {string} ws @param {string} ch @param {string} chat @param {number} keep @returns {Promise<Thread | null>} */
export async function threadLoad(db, ws, ch, chat, keep) {
  const [t, m] = await db.batch([
    db.prepare(`select rev, n, profile, meta, updated_at, expires_at, src from chat_threads where ${KEYS}`).bind(ws, ch, chat),
    db.prepare(`select id, data from chat_messages where ${KEYS} order by t desc, id desc limit ?`).bind(ws, ch, chat, keep)
  ]);
  const row = (t.results || [])[0];
  if (!row || !(+row.rev > 0)) return null;
  const turns = (m.results || []).reverse().map((/** @type {any} */ r) => ({ ...(parse(r.data) || {}), _i: +r.id }));
  return { rev: +row.rev, n: +row.n || 0, profile: parse(row.profile) || {}, meta: parse(row.meta) || {}, updatedAt: +row.updated_at || 0, expiresAt: +row.expires_at || 0, src: String(row.src || "d1"), turns };
}
/** Отдельные сообщения по номерам строк (изменение старого сообщения, которого нет среди последних). @param {any} db @param {string} ws @param {string} ch @param {string} chat @param {number[]} ids */
export async function messagesById(db, ws, ch, chat, ids) {
  const out = [];
  for (const part of chunks(ids, 90)) {
    const r = await db.prepare(`select id, data from chat_messages where ${KEYS} and id in (${part.map(() => "?").join(", ")})`).bind(ws, ch, chat, ...part).all();
    for (const x of r.results || []) out.push({ ...(parse(x.data) || {}), _i: +x.id });
  }
  return out;
}
/** Ревизия чата — для «изменилось ли что-нибудь» у опроса пульта. 0 — чата нет. @param {any} db @param {string} ws @param {string} ch @param {string} chat */
export async function threadRev(db, ws, ch, chat) {
  return +((await db.prepare(`select rev from chat_threads where ${KEYS}`).bind(ws, ch, chat).first("rev")) || 0);
}

/** @typedef {{ mkey: string, role: string, t: number, mid: string | null, rid: string | null, st: string | null, data: string }} NewMsg */
/** @typedef {{ ws: string, ch: string, chat: string, baseRev: number, now: number, n: number, profile: Record<string, any>, meta: Record<string, any>,
 *   expiresAt: number, inserts: NewMsg[], updates: { id: number, data: Record<string, any> }[], deletes: number[], src?: string }} Commit */
/** Записать изменения чата, если его ревизия всё ещё baseRev (0 — чата не было). → ok и номера строк новых сообщений (null — такое уже было).
 *  @param {any} db @param {Commit} p @returns {Promise<{ ok: boolean, rev: number, ids: (number | null)[] }>} */
export async function threadCommit(db, p) {
  const k = [p.ws, p.ch, p.chat], g = [...k, p.baseRev], st = [];
  if (p.baseRev === 0) st.push(db.prepare("insert into chat_threads (ws, ch, chat, rev, n, profile, meta, updated_at, expires_at, created_at, src) values (?, ?, ?, 0, 0, '{}', '{}', ?, ?, ?, ?) on conflict do nothing")
    .bind(...k, p.now, p.expiresAt, p.now, p.src || "d1"));
  for (const part of chunks(p.deletes, 90)) st.push(db.prepare(`delete from chat_messages where ${KEYS} and id in (${part.map(() => "?").join(", ")}) and ${GUARD}`).bind(...k, ...part, ...g));
  for (const u of p.updates) st.push(db.prepare(`update chat_messages set data = ?, st = ?, ver = ver + 1 where id = ? and ${KEYS} and ${GUARD}`)
    .bind(JSON.stringify(u.data), u.data.st == null ? null : String(u.data.st).slice(0, 12), u.id, ...k, ...g));
  const first = st.length;
  for (const m of p.inserts) st.push(db.prepare(`insert or ignore into chat_messages (ws, ch, chat, mkey, role, t, mid, rid, st, data) select ?, ?, ?, ?, ?, ?, ?, ?, ?, ? where ${GUARD}`)
    .bind(...k, m.mkey, m.role, m.t, m.mid, m.rid, m.st, m.data, ...g));
  const pr = p.profile || {};
  st.push(db.prepare(`update chat_threads set rev = rev + 1, n = ?, profile = ?, meta = ?, updated_at = ?, last_in = ?, need = ?, assignee = ?, done = ?, stop = ?, expires_at = ? where ${KEYS} and rev = ?`)
    .bind(p.n, JSON.stringify(pr), JSON.stringify(p.meta || {}), p.now, +pr.li || null, (pr.need && pr.need.why ? String(pr.need.why).slice(0, 12) : null),
      (pr.as && pr.as.n ? String(pr.as.n).slice(0, 32) : null), +pr.done || null, pr.stop ? 1 : null, p.expiresAt, ...g));
  const res = await db.batch(st);
  if (!(+(res[res.length - 1].meta || {}).changes > 0)) return { ok: false, rev: 0, ids: [] };
  const ids = p.inserts.map((_, i) => { const r = res[first + i].meta || {}; return +r.changes > 0 ? +r.last_row_id : null; });
  return { ok: true, rev: p.baseRev + 1, ids };
}

/** Чаты компании на канале — для списка пульта (как KV.list с метаданными). Заготовки (rev 0) и истёкшие не показываются.
 *  @param {any} db @param {string} ws @param {string} ch @param {number} now @param {number} limit @param {number} offset */
export async function threadList(db, ws, ch, now, limit, offset) {
  const r = await db.prepare("select chat, meta, expires_at from chat_threads where ws = ? and ch = ? and rev > 0 and expires_at > ? order by chat limit ? offset ?").bind(ws, ch, now, limit, offset).all();
  return (r.results || []).map((/** @type {any} */ x) => ({ chat: String(x.chat), meta: parse(x.meta) || {}, expiresAt: +x.expires_at || 0 }));
}
/** Версия переписок компании: меняется при любом изменении любого её чата (сумма ревизий и число чатов) — пульт по ней понимает,
 *  что список пора перечитать. @param {any} db @param {string} ws */
export async function threadsVer(db, ws) {
  const r = await db.prepare("select coalesce(sum(rev), 0) s, count(*) c from chat_threads where ws = ? and rev > 0").bind(ws).first();
  return `${+(r && r.s) || 0}.${+(r && r.c) || 0}`;
}
/** Удалить чат со всеми сообщениями («Удалить данные клиента», истёк срок). @param {any} db @param {string} ws @param {string} ch @param {string} chat */
export async function threadDelete(db, ws, ch, chat) {
  await db.batch([db.prepare(`delete from chat_messages where ${KEYS}`).bind(ws, ch, chat), db.prepare(`delete from chat_threads where ${KEYS}`).bind(ws, ch, chat)]);
}
/** Удалить чаты, у которых истёк срок хранения (не больше limit за раз). → сколько удалено. @param {any} db @param {number} now @param {number} limit */
export async function threadsPurge(db, now, limit) {
  const r = await db.prepare("select ws, ch, chat from chat_threads where expires_at <= ? limit ?").bind(now, limit).all();
  const rows = r.results || [];
  for (const part of chunks(rows, 30)) {
    const st = [];
    for (const x of part) st.push(db.prepare(`delete from chat_messages where ${KEYS}`).bind(x.ws, x.ch, x.chat), db.prepare(`delete from chat_threads where ${KEYS} and expires_at <= ?`).bind(x.ws, x.ch, x.chat, now));
    await db.batch(st);
  }
  return rows.length;
}
/** Сколько чатов и сообщений у компании (сверка переноса, «Хранилища»). @param {any} db @param {string} ws */
export async function chatCounts(db, ws) {
  const [t, m] = await db.batch([
    db.prepare("select ch, count(*) n, sum(case when src = 'kv' then 1 else 0 end) kv from chat_threads where ws = ? and rev > 0 group by ch").bind(ws),
    db.prepare("select ch, count(*) n from chat_messages where ws = ? group by ch").bind(ws)
  ]);
  /** @type {Record<string, { threads: number, fromKv: number, messages: number }>} */
  const out = {};
  for (const x of t.results || []) out[x.ch] = { threads: +x.n || 0, fromKv: +x.kv || 0, messages: 0 };
  for (const x of m.results || []) (out[x.ch] = out[x.ch] || { threads: 0, fromKv: 0, messages: 0 }).messages = +x.n || 0;
  return out;
}
/** Есть ли сообщения с такими ключами (сверка переноса). → множество найденных. @param {any} db @param {string} ws @param {string} ch @param {string} chat @param {string[]} keys */
export async function mkeysIn(db, ws, ch, chat, keys) {
  const out = new Set();
  for (const part of chunks(keys, 90)) {
    const r = await db.prepare(`select mkey from chat_messages where ${KEYS} and mkey in (${part.map(() => "?").join(", ")})`).bind(ws, ch, chat, ...part).all();
    for (const x of r.results || []) out.add(String(x.mkey));
  }
  return out;
}
/** Все чаты компании (для обратного переноса в KV при откате) — по страницам. @param {any} db @param {string} ws @param {number} limit @param {number} offset */
export async function threadKeys(db, ws, limit, offset) {
  const r = await db.prepare("select ch, chat from chat_threads where ws = ? and rev > 0 order by ch, chat limit ? offset ?").bind(ws, limit, offset).all();
  return (r.results || []).map((/** @type {any} */ x) => ({ ch: String(x.ch), chat: String(x.chat) }));
}
/** Отметка в meta (перенос из KV выполнен и т. п.). @param {any} db @param {string} k @param {string | null} v */
export async function metaSet(db, k, v) {
  if (v === null) await db.prepare("delete from meta where k = ?").bind(k).run();
  else await db.prepare("insert into meta (k, v) values (?, ?) on conflict (k) do update set v = excluded.v").bind(k, v).run();
}
/** Убрать отметки вида <prefix>…, у которых время (значение) раньше before. @param {any} db @param {string} prefix @param {number} before */
export async function metaPurgeOld(db, prefix, before) {
  await db.prepare("delete from meta where k like ? and cast(v as integer) < ?").bind(prefix.replace(/[%_]/g, "") + "%", before).run();
}
/** @param {any} db @param {string} k */
export async function metaGet(db, k) { return /** @type {string | null} */ (await db.prepare("select v from meta where k = ?").bind(k).first("v")); }
/** Есть ли таблицы переписок (миграция 0006). @param {any} db */
export async function chatTablesOk(db) {
  const r = await db.prepare("select count(*) n from sqlite_master where type = 'table' and name in ('chat_threads', 'chat_messages')").first("n");
  return +r === 2;
}
