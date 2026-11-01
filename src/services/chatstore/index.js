// @ts-check
// Хранилище переписок: KV или D1 (01.11.2026, Winchester). Весь код бота, вебхуков, пульта, напоминаний и рассылок работает с чатом
// через env.KV по ключу h:<канал>:<компания>:<чат> — так было с начала проекта. Чтобы перенести переписки в D1, не переписывая всех,
// на входе Worker (src/index.js) env.KV заменяется обёрткой: ключи переписок компании с CHAT_STORE_<ID> = d1 (или общей CHAT_STORE = d1)
// читаются и пишутся в D1 (chat_threads, chat_messages), всё остальное — в KV, как раньше. Тот же код, те же правила.
//
// Чтение: чат и последние 60 сообщений одним запросом к D1 (согласованно: та же база для всех точек сети, без копий до минуты).
// Нет чата в D1 — он переносится из KV при первом чтении (и всеми разом при первом списке): история не теряется при переключении.
// Запись: разбирается на изменения (merge.js) и записывается одной пачкой, только если ревизия чата та же, что при чтении; иначе —
// перечитать и наложить свои изменения снова. Новое сообщение — новая строка с устойчивым ключом: два одновременных сообщения,
// повтор вебхука и повтор записи после сбоя не теряют и не удваивают сообщения.
// D1 недоступна — ошибка, а не тихая запись в KV (иначе пульт показал бы старое, а новое пропало бы). После каждой записи в D1 тот же
// чат кладётся и в KV (тень, CHAT_SHADOW_<ID> = 0 — без неё): откат на KV — без потери сообщений, полученных после переключения.
/** @import { Env } from "../../lib/types.js" */
import { HIST_KEEP } from "../../config/constants.js";
import { histMeta, histTtl, lastAct } from "../../db/kv/chats.js";
import { d1Ready } from "../../db/d1/status.js";
import { threadLoad, threadCommit, threadList, threadsVer, threadDelete, threadsPurge, threadRev, messagesById, chatTablesOk, metaSet, metaGet, metaPurgeOld, chatCounts, mkeysIn, threadKeys, erasedSet, erasedMark } from "../../db/d1/chats.js";
import { planPut, mkeyOf, bare } from "./merge.js";

const HK = /^h:(wa|ga|web):([a-z][a-z0-9]{1,15}):([A-Za-z0-9_-]{1,80})$/;
const HP = /^h:(wa|ga|web):([a-z][a-z0-9]{1,15}):$/;
const CHANS = /** @type {const} */ (["wa", "ga", "web"]);
const TRIES = 6;          // перечитать и наложить заново при одновременной записи — до 6 раз
const D1_TRIES = 3;       // сбой связи с D1 — ещё попытки с паузой
const IMPORT_PAGE = 300;  // чатов из KV за один перенос (остальные — в следующий раз)
export const NOT_READY = "Переписки этой компании хранятся в базе D1, а база не подключена или без миграции 0006. Проверьте «Хранилища» (/diag/storage).";

/** Где хранятся переписки компании: d1 — в D1, иначе — в KV. @param {Env} env @param {string} cid @returns {"d1" | "kv"} */
export function chatMode(env, cid) {
  const e = /** @type {Record<string, any>} */ (env);
  const v = String(e["CHAT_STORE_" + String(cid).toUpperCase()] ?? e.CHAT_STORE ?? "").trim().toLowerCase();
  return v === "d1" ? "d1" : "kv";
}
/** Тень в KV после записи в D1 (откат без потерь). @param {Env} env @param {string} cid */
const shadowOn = (env, cid) => String(/** @type {Record<string, any>} */ (env)["CHAT_SHADOW_" + String(cid).toUpperCase()] ?? "1").trim() !== "0";
/** Есть ли хоть одна компания с переписками в D1 (иначе обёртка не нужна). @param {Env} env */
const anyD1 = env => Object.keys(env || {}).some(k => (k === "CHAT_STORE" || k.startsWith("CHAT_STORE_")) && String(/** @type {Record<string, any>} */ (env)[k]).trim().toLowerCase() === "d1");
/** @param {string} key */
const parseKey = key => { const m = HK.exec(String(key)); return m ? { ch: m[1], ws: m[2], chat: m[3] } : null; };
const sleep = (/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms));
const jitter = (/** @type {number} */ i) => sleep(15 * (i + 1) + Math.floor(Math.random() * 40));

// база готова для переписок: своя (отметка stage), с таблицами 0006. Проверка таблиц — раз в минуту на экземпляр Worker
/** @type {WeakMap<object, { at: number, ok: boolean }>} */
const tablesSeen = new WeakMap();
/** @param {Env} env @param {number} now */
export async function chatDb(env, now) {
  const db = await d1Ready(env, now);
  if (!db) return null;
  const c = tablesSeen.get(db);
  if (c && now - c.at < 60_000) return c.ok ? db : null;
  let ok = false; try { ok = await chatTablesOk(db); } catch (e) { console.log("chat tables", String(e).slice(0, 120)); }
  tablesSeen.set(db, { at: now, ok });
  return ok ? db : null;
}
/** сбой связи с D1 — ещё раз (до D1_TRIES), потом ошибка наверх @template T @param {() => Promise<T>} f @returns {Promise<T>} */
async function d1Try(f) {
  let last;
  for (let i = 0; i < D1_TRIES; i++) { try { return await f(); } catch (e) { last = e; if (i < D1_TRIES - 1) await sleep(150 * (i + 1)); } }
  throw last;
}

/** @typedef {{ absent?: boolean, rev: number, n: number, profile: Record<string, any>, turns: Record<string, any>[] }} Snap */
const ABSENT = /** @returns {Snap} */ () => ({ absent: true, rev: 0, n: 0, profile: {}, turns: [] });
/** @param {any} th @returns {Snap} */
const snapOf = th => ({ rev: th.rev, n: th.n, profile: JSON.parse(JSON.stringify(th.profile || {})), turns: JSON.parse(JSON.stringify(th.turns || [])) });
/** порядок показа: по времени реплики, при равном — по порядку записи @param {any} a @param {any} b */
const byTime = (a, b) => (+a.t || 0) - (+b.t || 0) || (+a._i || Infinity) - (+b._i || Infinity);

/**
 * Обёртка env.KV для запроса (или одной фоновой задачи): переписки компаний в режиме d1 — в D1, остальное — в KV. Копии чатов,
 * прочитанные в этом запросе, запоминаются (seen): по ним запись понимает, что именно поменял пишущий.
 * since — с какого времени данные этого запроса (начало запроса; у проигрыша журнала — приход события): запись в чат, данные которого
 * удалили позже, не проходит — проверка в том же запросе к D1, что и запись (threadCommit).
 * @param {Env} env @param {{ since?: number }} [o]
 */
export function chatEnv(env, o = {}) {
  if (!env || !env.KV || !anyD1(env) || /** @type {any} */ (env.KV).__chat) return env;
  const kv = /** @type {any} */ (env.KV);
  let since = +(o.since || 0) || Date.now();
  /** @type {Map<string, Snap[]>} */
  const seen = new Map();
  const stats = { reads: 0, writes: 0, retries: 0, fails: 0, imported: 0, erased: 0 };
  const isD1 = (/** @type {{ ws: string } | null} */ k) => !!k && chatMode(env, k.ws) === "d1";
  const need = async (/** @type {number} */ now) => { const db = await chatDb(env, now); if (!db) { stats.fails++; throw new Error(NOT_READY); } return db; };
  const remember = (/** @type {string} */ key, /** @type {Snap} */ s) => { const a = seen.get(key) || []; a.push(s); if (a.length > 6) a.splice(1, a.length - 6); seen.set(key, a); };

  /** чат из D1; нет — перенести из KV (если там есть) @param {any} db @param {string} key @param {{ ws: string, ch: string, chat: string }} k @param {number} now */
  const load = async (db, key, k, now) => {
    let th = await d1Try(() => threadLoad(db, k.ws, k.ch, k.chat, HIST_KEEP));
    if (th && th.expiresAt <= now) { // срок хранения истёк — как в KV: чата нет; тень в KV тоже удаляем, иначе чат вернулся бы переносом из KV
      await d1Try(() => threadDelete(db, k.ws, k.ch, k.chat));
      try { await kv.delete(key); } catch (e) { console.log("chat shadow del", String(e).slice(0, 120)); }
      return null;
    }
    if (!th) {
      const r = typeof kv.getWithMetadata === "function" ? await kv.getWithMetadata(key) : { value: await kv.get(key), metadata: null };
      if (r && r.value) { if (await importBlob(db, k, r.value, { meta: r.metadata }, now)) stats.imported++; th = await d1Try(() => threadLoad(db, k.ws, k.ch, k.chat, HIST_KEEP)); }
    }
    return th;
  };

  /** @param {string} key @param {any} [opts] */
  const get = async (key, opts) => {
    const k = parseKey(key);
    if (!isD1(k) || !k) return kv.get(key, opts);
    const now = Date.now(), db = await need(now);
    stats.reads++;
    let th;
    try { th = await load(db, key, k, now); } catch (e) { stats.fails++; throw e; }
    remember(key, th ? snapOf(th) : ABSENT());
    if (!th) return null;
    const h = { n: th.n, turns: th.turns, profile: th.profile, _rev: th.rev };
    const type = typeof opts === "string" ? opts : opts && opts.type;
    return type === "json" ? h : JSON.stringify(h);
  };

  /** @param {string} key @param {any} value @param {any} [opts] */
  const put = async (key, value, opts) => {
    const k = parseKey(key);
    if (!isD1(k) || !k) return kv.put(key, value, opts);
    const mine = typeof value === "string" ? JSON.parse(value) : value;
    const now = Date.now(), db = await need(now);
    stats.writes++;
    const views = seen.get(key) || [];
    /** @type {Snap | null} */
    let cur = views.length ? views[views.length - 1] : null; // обычно никто не писал между чтением и записью — первая попытка без перечитывания
    for (let i = 0; i < TRIES; i++) {
      try {
        if (!cur) { const th = await d1Try(() => threadLoad(db, k.ws, k.ch, k.chat, HIST_KEEP)); cur = th && th.expiresAt > now ? snapOf(th) : ABSENT(); }
        const c = /** @type {Snap} */ (cur);
        // изменения старых сообщений (не из последних 60) — подтянуть их строки
        const known = new Set(c.turns.map(t => +t._i)), want = (mine.turns || []).filter((/** @type {any} */ t) => t && t._i !== undefined && !known.has(+t._i)).map((/** @type {any} */ t) => +t._i);
        if (want.length && !c.absent) c.turns = c.turns.concat(await d1Try(() => messagesById(db, k.ws, k.ch, k.chat, want))).sort(byTime);
        const plan = planPut(views.length ? views : [c], mine, c);
        const gone = new Set(plan.deletes), upd = new Map(plan.updates.map(u => [u.id, u.data]));
        const kept = c.turns.filter(t => !gone.has(+t._i)).map(t => (upd.has(+t._i) ? { ...upd.get(+t._i), _i: +t._i } : t));
        const fresh = plan.inserts.map(t => ({ ...t }));
        const all = kept.concat(fresh).sort(byTime), last = all.slice(-HIST_KEEP);
        const unchanged = !c.absent && !plan.inserts.length && !plan.updates.length && !plan.deletes.length && plan.n === c.n && JSON.stringify(plan.profile) === JSON.stringify(c.profile);
        if (unchanged) { await shadow(key, k, { n: plan.n, turns: last, profile: plan.profile }, now, true); return; }
        // время строки списка — как у пишущего (putHist): запись без нового события (прочитано, скрыть, удалить у всех) передаёт
        // время последнего события, и чат не поднимается в списке; что успели дописать другие — учитывается (lastAct)
        const metaAt = +((opts && opts.metadata && opts.metadata.t) || 0), body = { n: plan.n, turns: last.map(bare), profile: plan.profile };
        const meta = histMeta(body, metaAt ? Math.max(metaAt, lastAct(body)) : 0);
        const exp = now + histTtl(plan.profile) * 1000;
        const res = await d1Try(() => threadCommit(db, {
          ws: k.ws, ch: k.ch, chat: k.chat, baseRev: c.absent ? 0 : c.rev, now, n: plan.n, profile: plan.profile, meta, expiresAt: exp,
          inserts: plan.inserts.map((t, j) => ({ mkey: mkeyOf(t, c.turns.length + j), role: t.role === "user" ? "user" : "model", t: +t.t || now, mid: t.mid ? String(t.mid).slice(0, 80) : null,
            rid: t.rid ? String(t.rid).slice(0, 80) : null, st: t.st ? String(t.st).slice(0, 12) : null, data: JSON.stringify(t) })),
          updates: plan.updates, deletes: plan.deletes, since
        }));
        // данные клиента удалили после начала этого запроса (или после прихода события журнала): записанное до удаления не возвращаем
        if (res.erased) { stats.erased++; seen.delete(key); console.log("chat write after erase skipped", k.ws, k.ch); return; }
        if (!res.ok) { stats.retries++; cur = null; await jitter(i); continue; } // кто-то записал раньше — перечитать и наложить заново
        fresh.forEach((t, j) => { if (res.ids[j]) t._i = res.ids[j]; });
        const after = { rev: res.rev, n: plan.n, profile: plan.profile, turns: last.filter(t => t._i !== undefined) };
        seen.set(key, [JSON.parse(JSON.stringify(after))]); // следующая запись этого запроса — от записанного
        await shadow(key, k, { n: plan.n, turns: last, profile: plan.profile }, now, false, meta);
        return;
      } catch (e) {
        stats.fails++;
        throw e;
      }
    }
    stats.fails++;
    throw new Error("Чат меняли одновременно слишком много раз — запись не прошла. Повторите действие.");
  };

  /** тень в KV: тот же чат, что в D1 (без служебных полей) — для отката на KV без потерь. Сбой тени не мешает записи в D1.
   *  @param {string} key @param {{ ws: string }} k @param {any} h @param {number} now @param {boolean} touch только обновить срок @param {any} [meta] */
  const shadow = async (key, k, h, now, touch, meta) => {
    if (!shadowOn(env, k.ws) || touch) return;
    try { await kv.put(key, JSON.stringify({ n: h.n, turns: h.turns.map(bare), profile: h.profile }), { expirationTtl: histTtl(h.profile), metadata: meta || histMeta({ ...h, turns: h.turns.map(bare) }) }); }
    catch (e) { console.log("chat shadow", String(e).slice(0, 120)); }
  };

  /** @param {string} key */
  const del = async key => {
    const k = parseKey(key);
    if (!isD1(k) || !k) return kv.delete(key);
    const now = Date.now(), db = await need(now);
    try { await d1Try(() => threadDelete(db, k.ws, k.ch, k.chat)); } catch (e) { stats.fails++; throw e; }
    seen.delete(key);
    try { await kv.delete(key); } catch (e) { console.log("chat shadow del", String(e).slice(0, 120)); } // и тень, и старую копию: «Удалить данные клиента»
  };

  /** список чатов компании (как KV.list с метаданными): из D1, при первом обращении — перенос всех чатов компании из KV @param {any} [opts] */
  const list = async (opts = {}) => {
    const m = HP.exec(String((opts && opts.prefix) || ""));
    if (!m || chatMode(env, m[2]) !== "d1") return kv.list(opts);
    const [, ch, ws] = m, now = Date.now(), db = await need(now);
    try {
      await importAll(env, ws, { kv, db, now, once: true });
      await purgeSometimes(db, now);
      const limit = Math.min(1000, +(opts && opts.limit) || 1000), offset = +(opts && opts.cursor) || 0;
      const rows = await d1Try(() => threadList(db, ws, ch, now, limit + 1, offset));
      const page = rows.slice(0, limit), more = rows.length > limit;
      return { keys: page.map((/** @type {any} */ r) => ({ name: `h:${ch}:${ws}:${r.chat}`, metadata: r.meta, expiration: Math.floor(r.expiresAt / 1000) })), list_complete: !more, ...(more ? { cursor: String(offset + limit) } : {}) };
    } catch (e) { stats.fails++; throw e; }
  };

  const wrapped = {
    get, put, delete: del, list,
    getWithMetadata: (/** @type {string} */ key, /** @type {any} */ opts) => kv.getWithMetadata(key, opts),
    // «Удалить данные клиента» (chatErased): дальше в этом запросе пишет само удаление — его записи отметка не останавливает
    __chat: { stats, raw: kv, after: (/** @type {number} */ t) => { since = Math.max(since, Math.floor(t) + 1); } }
  };
  return /** @type {Env} */ ({ ...env, KV: /** @type {any} */ (wrapped) });
}
/** сырое KV под обёрткой (перенос, сверка, откат читают и пишут KV напрямую) @param {Env} env */
const rawKv = env => { const w = /** @type {any} */ (env.KV); return (w && w.__chat && w.__chat.raw) || w; };
/** счётчики обёртки этого запроса: были ли сбои записи переписок (журнал вебхуков, services/chatstore/wal.js) @param {Env} env */
export const chatStats = env => { const w = /** @type {any} */ (env && env.KV); return (w && w.__chat && w.__chat.stats) || null; };

// ---- перенос из KV
/** Состояние чата из копии KV после удаления данных клиента: «стоп» и пауза (их оставляет само удаление) и время последнего входящего
 *  по перенесённым сообщениям. @param {Record<string, any>} pr @param {Record<string, any>[]} turns */
function erasedProfile(pr, turns) {
  /** @type {Record<string, any>} */
  const out = {};
  if (pr.stop) out.stop = pr.stop;
  if (pr.pausedUntil) out.pausedUntil = pr.pausedUntil;
  const li = Math.max(0, ...turns.filter(t => t.role === "user").map(t => +t.t || 0));
  if (li) out.li = li;
  return out;
}
/** Перенести один чат из KV в D1: строку чата и все его реплики (повторный перенос добавляет только недостающие реплики).
 *  meta — метаданные ключа KV (время для списка), expires — срок ключа KV (секунды). → перенесено ли что-нибудь.
 *  @param {any} db @param {{ ws: string, ch: string, chat: string }} k @param {string} raw @param {{ meta?: any, expires?: number } | null} info @param {number} now */
async function importBlob(db, k, raw, info, now) {
  let h; try { h = JSON.parse(raw); } catch (e) { return false; }
  if (!h || typeof h !== "object") return false;
  let turns = (Array.isArray(h.turns) ? h.turns : []).filter((/** @type {any} */ t) => t && typeof t === "object").map(bare);
  let profile = h.profile && typeof h.profile === "object" ? h.profile : {}, n = +h.n || 0;
  // данные этого клиента удаляли: копия KV может быть записана до удаления (запоздавшая тень, копия другой точки сети) — из неё
  // переносятся только сообщения новее отметки, а из состояния чата — только «стоп» и пауза, как оставляет само удаление
  const at = Date.now(), er = await d1Try(() => erasedMark(db, k.ws, k.ch, k.chat)); // удаление позже этого чтения — перенос не проходит (since)
  if (er) {
    turns = turns.filter((/** @type {any} */ t) => (+t.t || 0) > er);
    if (!turns.length) return false;
    profile = erasedProfile(profile, turns);
    n = turns.length;
    info = { ...(info || {}), meta: null };
  }
  const meta = (info && info.meta && typeof info.meta === "object") ? info.meta : histMeta({ n, turns, profile });
  const updatedAt = +meta.t || now;
  const expiresAt = info && info.expires ? info.expires * 1000 : updatedAt + histTtl(profile) * 1000;
  if (expiresAt <= now) return false;
  const ins = turns.map((/** @type {any} */ t, /** @type {number} */ i) => ({ mkey: mkeyOf(t, i), role: t.role === "user" ? "user" : "model", t: +t.t || 0, mid: t.mid ? String(t.mid).slice(0, 80) : null,
    rid: t.rid ? String(t.rid).slice(0, 80) : null, st: t.st ? String(t.st).slice(0, 12) : null, data: JSON.stringify(t) }));
  const cur = await d1Try(() => threadLoad(db, k.ws, k.ch, k.chat, 1));
  if (!cur) {
    const res = await d1Try(() => threadCommit(db, { ...k, baseRev: 0, now: updatedAt, n, profile, meta, expiresAt, inserts: ins, updates: [], deletes: [], src: "kv", since: at }));
    return res.ok; // не прошло — чат одновременно перенёс другой запрос
  }
  // чат уже в D1: добавить реплики, которых там нет (их записал код, ещё не знавший про D1, — например, во время переключения)
  const have = await d1Try(() => mkeysIn(db, k.ws, k.ch, k.chat, ins.map((/** @type {any} */ x) => x.mkey)));
  const missing = ins.filter((/** @type {any} */ x) => !have.has(x.mkey));
  if (!missing.length) return false;
  for (let i = 0; i < TRIES; i++) {
    const th = await d1Try(() => threadLoad(db, k.ws, k.ch, k.chat, HIST_KEEP));
    if (!th) return false;
    const all = th.turns.concat(missing.map((/** @type {any} */ x) => JSON.parse(x.data))).sort(byTime).slice(-HIST_KEEP);
    const res = await d1Try(() => threadCommit(db, { ...k, baseRev: th.rev, now, n: th.n, profile: th.profile, meta: histMeta({ n: th.n, turns: all.map(bare), profile: th.profile }),
      expiresAt: Math.max(th.expiresAt, expiresAt), inserts: missing, updates: [], deletes: [], since: at }));
    if (res.ok) return true;
    if (res.erased) return false;
    await jitter(i);
  }
  return false;
}

/** Перенести все чаты компании из KV в D1 (повторяемо: перенесённые не дублируются, недостающие реплики добавляются).
 *  once — только если ещё не переносили (отметка chat_import:<компания>). Отчёт — только числа, без текста переписок.
 *  @param {Env} env @param {string} ws @param {{ kv?: any, db?: any, now?: number, once?: boolean }} [o] */
export async function importAll(env, ws, o = {}) {
  const now = o.now || Date.now(), db = o.db || (await chatDb(env, now)), kv = o.kv || rawKv(env);
  if (!db) throw new Error(NOT_READY);
  const mark = "chat_import:" + ws;
  if (o.once && (await d1Try(() => metaGet(db, mark)))) return null;
  const rep = { kvChats: 0, imported: 0, merged: 0, skipped: 0, bad: 0, more: false };
  let budget = IMPORT_PAGE;
  for (const ch of CHANS) {
    const prefix = `h:${ch}:${ws}:`;
    for (let cursor, page = 0; page < 20; page++) {
      /** @type {any} */ const r = await kv.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      for (const x of (r && r.keys) || []) {
        const k = parseKey(x.name);
        if (!k) { rep.bad++; continue; }
        rep.kvChats++;
        if (budget <= 0) { rep.more = true; continue; }
        budget--;
        const raw = await kv.get(x.name);
        if (!raw) { rep.skipped++; continue; }
        let ok = false; try { JSON.parse(raw); ok = true; } catch (e) {}
        if (!ok) { rep.bad++; continue; }
        const had = await d1Try(() => threadRev(db, k.ws, k.ch, k.chat));
        const did = await importBlob(db, k, raw, { meta: x.metadata, expires: x.expiration }, now);
        if (did) { if (had) rep.merged++; else rep.imported++; } else rep.skipped++;
      }
      if (!r || r.list_complete || !r.cursor) break;
      cursor = r.cursor;
    }
  }
  if (!rep.more) await d1Try(() => metaSet(db, mark, String(now)));
  return rep;
}

/** Сверка переноса: все ли чаты и реплики из KV есть в D1. Только числа. @param {Env} env @param {string} ws */
export async function chatCheck(env, ws) {
  const now = Date.now(), db = await chatDb(env, now), kv = rawKv(env);
  if (!db) throw new Error(NOT_READY);
  /** @type {Record<string, any>} */
  const rep = { kvChats: 0, kvTurns: 0, inD1: 0, missingChats: 0, missingTurns: 0, erased: 0, bad: 0, d1: await d1Try(() => chatCounts(db, ws)), mode: chatMode(env, ws), imported: await d1Try(() => metaGet(db, "chat_import:" + ws)) };
  for (const ch of CHANS) {
    const prefix = `h:${ch}:${ws}:`;
    for (let cursor, page = 0; page < 20; page++) {
      /** @type {any} */ const r = await kv.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      for (const x of (r && r.keys) || []) {
        const k = parseKey(x.name), raw = k ? await kv.get(x.name) : null;
        if (!k || !raw) continue;
        let h; try { h = JSON.parse(raw); } catch (e) { rep.bad++; continue; }
        rep.kvChats++;
        let turns = (Array.isArray(h.turns) ? h.turns : []).filter((/** @type {any} */ t) => t && typeof t === "object");
        const er = await d1Try(() => erasedMark(db, k.ws, k.ch, k.chat));
        if (er) { // данные удаляли: старая копия в KV — не пропуск; сверяются только сообщения новее отметки
          const after = turns.filter((/** @type {any} */ t) => (+t.t || 0) > er);
          if (after.length < turns.length) rep.erased++;
          turns = after;
          if (!turns.length) continue;
        }
        rep.kvTurns += turns.length;
        if (!(await d1Try(() => threadRev(db, k.ws, k.ch, k.chat)))) { rep.missingChats++; rep.missingTurns += turns.length; continue; }
        rep.inD1++;
        const keys = turns.map((/** @type {any} */ t, /** @type {number} */ i) => mkeyOf(bare(t), i));
        const have = await d1Try(() => mkeysIn(db, k.ws, k.ch, k.chat, keys));
        rep.missingTurns += keys.filter((/** @type {string} */ x) => !have.has(x)).length;
      }
      if (!r || r.list_complete || !r.cursor) break;
      cursor = r.cursor;
    }
  }
  return rep;
}

/** Откат на KV без потерь: каждый чат компании из D1 (последние 60 сообщений и состояние) — в KV, как его записал бы KV-режим.
 *  После этого CHAT_STORE_<ID> можно убрать. @param {Env} env @param {string} ws */
export async function exportAll(env, ws) {
  const now = Date.now(), db = await chatDb(env, now), kv = rawKv(env);
  if (!db) throw new Error(NOT_READY);
  const rep = { chats: 0, written: 0, failed: 0 };
  for (let off = 0; off < 20000; off += 200) {
    const page = await d1Try(() => threadKeys(db, ws, 200, off));
    for (const x of page) {
      rep.chats++;
      try {
        const th = await d1Try(() => threadLoad(db, ws, x.ch, x.chat, HIST_KEEP));
        if (!th || th.expiresAt <= now) continue;
        const h = { n: th.n, turns: th.turns.map(bare), profile: th.profile };
        await kv.put(`h:${x.ch}:${ws}:${x.chat}`, JSON.stringify(h), { expirationTtl: Math.max(60, Math.ceil((th.expiresAt - now) / 1000)), metadata: th.meta && Object.keys(th.meta).length ? th.meta : histMeta(h) });
        rep.written++;
      } catch (e) { rep.failed++; console.log("chat export", String(e).slice(0, 120)); }
    }
    if (page.length < 200) break;
  }
  return rep;
}

// ---- для пульта: «изменилось ли что-нибудь» без чтения всей переписки
/** Ревизия чата или null (переписки компании в KV). @param {Env} env @param {string} key */
export async function chatRevOf(env, key) {
  const k = parseKey(key);
  if (!k || chatMode(env, k.ws) !== "d1") return null;
  const db = await chatDb(env, Date.now());
  return db ? d1Try(() => threadRev(db, k.ws, k.ch, k.chat)) : null;
}
/** Версия всех переписок компании или null (в KV). @param {Env} env @param {string} ws */
export async function chatVerOf(env, ws) {
  if (chatMode(env, ws) !== "d1") return null;
  const db = await chatDb(env, Date.now());
  return db ? d1Try(() => threadsVer(db, ws)) : null;
}

// ---- срок хранения: истёкшие чаты удаляются целиком (раз в минуту фоновой задачей, у стенда без неё — при чтении списка)
let purgedAt = 0;
/** @param {any} db @param {number} now */
async function purgeSometimes(db, now) {
  if (now - purgedAt < 10 * 60_000) return;
  purgedAt = now;
  try { const n = await threadsPurge(db, now, 200); if (n) console.log("chat purge", n); } catch (e) { console.log("chat purge", String(e).slice(0, 120)); }
}
/** Фоновая задача: удалить чаты с истёкшим сроком и старые отметки «данные удалены». @param {Env} env @param {number} now */
export async function chatPurgeRun(env, now) {
  if (!anyD1(env)) return 0;
  const db = await chatDb(env, now);
  if (!db) return 0;
  // отметка «данные удалены» живёт дольше любой копии чата в KV (тень — до 31 дня со «стопом») и журнала (3 дня): 32 дня
  try { await metaPurgeOld(db, "erased:", now - 32 * 86400e3); } catch (e) { console.log("chat erased purge", String(e).slice(0, 120)); }
  return threadsPurge(db, now, 500);
}

// ---- «Удалить данные клиента»: отметка в D1 (видна всем точкам сети сразу, в отличие от KV). Запись, начатая до неё (вебхук, проигрыш
// журнала, бот), не проходит — проверка в той же пачке D1, что и запись (threadCommit); копия KV старше отметки не переносится (importBlob)
/** @param {Env} env @param {string} ws @param {string} ch @param {string} chat @param {number} now */
export async function chatErased(env, ws, ch, chat, now) {
  if (chatMode(env, ws) !== "d1") return;
  const db = await chatDb(env, now);
  if (!db) throw new Error(NOT_READY); // отметка не записалась — удаление не считаем законченным
  await d1Try(() => erasedSet(db, ws, ch, chat, now));
  const w = /** @type {any} */ (env.KV);
  if (w && w.__chat && w.__chat.after) w.__chat.after(now); // запись самого удаления («стоп»: пустая переписка) — уже после отметки
}
/** Когда удаляли данные этого чата (0 — не удаляли или переписки в KV). @param {Env} env @param {string} ws @param {string} ch @param {string} chat */
export async function erasedAt(env, ws, ch, chat) {
  if (chatMode(env, ws) !== "d1") return 0;
  const db = await chatDb(env, Date.now());
  if (!db) return 0;
  return d1Try(() => erasedMark(db, ws, ch, chat));
}
/** Состояние для «Хранилищ» и владельца: режим, таблицы, перенос, числа. @param {Env} env @param {string} ws */
export async function chatStoreInfo(env, ws) {
  const mode = chatMode(env, ws), now = Date.now();
  const db = await chatDb(env, now).catch(() => null);
  if (!db) return { mode, ready: false, shadow: shadowOn(env, ws) };
  return { mode, ready: true, shadow: shadowOn(env, ws), imported: +((await metaGet(db, "chat_import:" + ws)) || 0) || 0, counts: await chatCounts(db, ws) };
}
