// @ts-check
// Синхронизация журнала Altegio → контакты D1 (этап 1, 31.10.2026; docs/architecture-cloudflare-d1.md §6.2).
// Первичная загрузка: сначала будущее (сегодня … +60 дней), потом прошлое окнами по 14 дней назад до 2 лет; курсор в sync_state —
// оборванная загрузка продолжается с того же окна. Дальше — окна по расписанию: «горячее» (вчера … +14 дней) раз в 15 минут,
// «будущее» (сегодня … +60) раз в час, «прошлое» (35 дней назад … вчера) раз в сутки после 04:00 — отметки «пришёл», поздние правки.
// Окно прочитано целиком — записи, которых в ответе нет, помечаются удалёнными (администратор удаляет — запись пропадает из журнала).
// Каждое окно — одна пачка D1 (транзакция) вместе с курсором: сбой посреди окна не оставляет половины данных.
// Аренда в sync_state: кнопка и фоновая задача одновременно не синхронизируют. Только чтение Altegio (GET).
// На черновике (STAGE=preview) настоящий Altegio не пишется в D1: только «проверка без записи» и проба полей, а для экрана —
// демо-база из вымышленных клиентов (demo.js; CONTACTS_DEV_REAL=1 разрешает запись — только по решению владельца).
/** @import { Env, Client } from "../../lib/types.js" */
import { CLIENTS } from "../../config/builtin-clients.js";
import { logSafe } from "../../lib/phone.js";
import { local } from "../../lib/time.js";
import { altRecordsRange } from "../integrations/altegio/records-api.js";
import { altClientsSearch } from "../integrations/altegio/clients-api.js";
import { normPhone } from "../../lib/phone.js";
import { crmWhy } from "../crm/snapshot.js";
import { altUserKey } from "../booking/journal.js";
import { altLoc } from "../booking/book.js";
import { d1Ready, stageOf } from "../../db/d1/status.js";
import { syncRows, leaseTake, leaseFree, syncOkStmt, syncCursorStmt, syncFail, syncClearStmt } from "../../db/d1/sync.js";
import { windowApply, ownersOf, windowCount, recompute, contactsByPhones, eventPut, directoryApply } from "../../db/d1/contacts.js";
import { foldWindow, dayOf, dayAdd, dayStart, altMs, searchOf } from "./normalize.js";
import { altText as altClean } from "../integrations/altegio/client.js";
import { COOL_DAYS } from "./segments.js";

export const SRC = "altegio";
export const SYNC = { pastDays: 730, futureDays: 60, step: 14, budgetMs: 20000, leaseMs: 90000 };
// окна по расписанию: дни от сегодня (включительно) и как часто
export const WINDOWS = /** @type {const} */ ([
  { scope: "hot", label: "Ближайшие дни (вчера … +14)", from: -1, to: 14, everyMs: 15 * 60e3 },
  { scope: "future", label: "Будущие записи (+60 дней)", from: 0, to: 60, everyMs: 60 * 60e3 },
  { scope: "past", label: "Прошедшие визиты (35 дней)", from: -35, to: -1, everyMs: 20 * 3600e3 }
]);

/** @param {string} code @param {string} text */
const fail = (code, text) => Object.assign(new Error(text), { code });
export const newId = () => crypto.randomUUID().replace(/-/g, "");

/** Почему нельзя читать Altegio (пусто — можно). @param {Env} env @param {Client} c */
export const syncWhy = (env, c) => crmWhy(env, c);
/** Можно ли писать настоящий Altegio в базу этого адреса. @param {Env} env */
export const realAllowed = env => stageOf(env) === "production" || env.CONTACTS_DEV_REAL === "1";

// ошибка Altegio → текст для владельца (текст чужого API — только в журнал сервера)
/** @param {any} e */
const altText = e => {
  const st = +(e && e.status) || 0;
  return st === 401 || st === 403 ? "Altegio не принял ключ журнала: ключ устарел или у сотрудника нет права смотреть журнал. Новый ключ — на странице /altegio/user."
    : st === 429 ? "Altegio попросил подождать (слишком много запросов) — продолжим в следующий раз."
    : st ? `Altegio не отдал журнал (ошибка ${st}) — попробуем ещё раз.` : "Нет связи с Altegio — попробуем ещё раз.";
};

/** Окно журнала: записи и прочитано ли целиком. @param {Env} env @param {Client} c @param {string} from @param {string} to */
async function fetchWindow(env, c, from, to) {
  try { return await altRecordsRange(env, altUserKey(env, c), altLoc(env, c), from, to, 40); }
  catch (e) { console.log("contacts sync", c.id, logSafe(String((/** @type {any} */ (e) && /** @type {any} */ (e).message) || e))); throw fail("altegio", altText(e)); }
}

/**
 * Записи окна → D1. full — окно прочитано целиком (можно помечать пропавшие записи удалёнными). Подозрительно пустой ответ
 * (в базе в этом окне много записей, а пришло вдвое меньше) удалений не делает — только предупреждение в журнал.
 * @param {any} db @param {string} ws @param {any[]} list @param {string} from @param {string} to @param {boolean} full @param {number} stamp
 * @param {any[] | ((count: any) => any[])} extra операторы sync_state в ту же пачку (функция — получает числа окна)
 */
export async function applyWindow(db, ws, list, from, to, full, stamp, extra) {
  const f = foldWindow(list, newId);
  let win = null, warn = "";
  if (full) {
    const a = dayStart(from), b = dayStart(dayAdd(to, 1)), had = await windowCount(db, ws, a, b), got = f.bookings.filter(x => !x.del).length;
    if (had > 20 && got < had / 2) warn = `Altegio отдал за ${from} … ${to} ${got} записей, а в базе их ${had} — удалённые не отмечаю, проверю в следующий раз`;
    else win = { from: a, to: b, ids: f.bookings.map(x => x.id) };
  }
  const oldIds = await ownersOf(db, ws, f.bookings);
  await windowApply(db, ws, { contacts: f.contacts, bookings: f.bookings, window: win, oldIds, stamp, extra: typeof extra === "function" ? extra(f.count) : extra, coolMs: COOL_DAYS * 86400e3 });
  if (warn) await eventPut(db, ws, `warn:${from}:${to}:${stamp}`, "sync_warn", { text: warn }, stamp);
  return { ...f.count, warn };
}

/** Что синхронизация сделала бы сейчас: курсор первичной загрузки и окна по расписанию. @param {any[]} rows @param {number} now */
export function syncPlan(rows, now) {
  const by = Object.fromEntries(rows.map(r => [r.scope, r]));
  /** @type {any} */
  let init = null; try { init = JSON.parse((by.initial && by.initial.cursor) || "null"); } catch (e) {}
  const today = dayOf(now), hour = local(now).getUTCHours();
  if (!init || init.phase !== "done") return { initial: init, due: [] };
  const due = WINDOWS.filter(w => {
    const last = by[w.scope] && by[w.scope].last_ok_at;
    if (!last) return true;
    if (w.scope === "past") return dayOf(last) < today && hour >= 4;
    return now - last >= w.everyMs - 30e3;
  }).map(w => w.scope);
  return { initial: init, due };
}

/**
 * Один шаг синхронизации (фоновая задача или кнопка): первичная загрузка — сколько успеет за 20 секунд; потом — окна, которым пора
 * (force — «горячее» и «будущее» сразу). Ошибка — с понятным текстом (code: db / setup / preview / busy / altegio).
 * @param {Env} env @param {Client} c @param {number} now @param {{ force?: boolean }} [opts]
 */
export async function syncStep(env, c, now, opts = {}) {
  const db = await d1Ready(env, now);
  if (!db) throw fail("db", "База контактов не подключена.");
  const why = syncWhy(env, c);
  if (why) throw fail("setup", why);
  if (!realAllowed(env)) throw fail("preview", "Черновик: настоящий Altegio в базу черновика не загружается — только «Проверка без записи». Для экрана — «Загрузить демо-базу (150 вымышленных клиентов)».");
  const ws = c.id, token = newId(), t0 = Date.now();
  if (!(await leaseTake(db, ws, SRC, token, now, SYNC.leaseMs))) throw fail("busy", "Синхронизация уже идёт — подождите минуту.");
  const done = [];
  let scope = "initial";
  try {
    const plan = syncPlan(await syncRows(db, ws, SRC), now), today = dayOf(now);
    let init = plan.initial;
    if (!init || init.phase !== "done") {
      if (!init) init = { phase: "future", from: dayAdd(today, -SYNC.pastDays), to: dayAdd(today, SYNC.futureDays), next: dayAdd(today, -1) };
      while (init.phase !== "done" && Date.now() - t0 < SYNC.budgetMs) {
        const back = dayAdd(init.next, -(SYNC.step - 1)), [a, b] = init.phase === "future" ? [today, init.to] : [back < init.from ? init.from : back, init.next];
        const r = await fetchWindow(env, c, a, b);
        const nx = init.phase === "future" ? { ...init, phase: "past" } : { ...init, next: dayAdd(a, -1) };
        if (nx.phase === "past" && nx.next < nx.from) nx.phase = "done";
        const extra = nx.phase === "done" ? [syncOkStmt(db, ws, SRC, "initial", now, JSON.stringify(nx), null), syncClearStmt(db, ws, SRC, "initial")] : [syncCursorStmt(db, ws, SRC, "initial", JSON.stringify(nx))];
        const st = await applyWindow(db, ws, r.list, a, b, !r.cut, now, extra);
        done.push({ scope: "initial", from: a, to: b, ...st });
        init = nx;
      }
      if (init.phase === "done") await recompute(db, ws, now, "stale");
      return { initial: initialInfo(init), windows: done };
    }
    const todo = opts.force ? [...new Set(["hot", "future", ...plan.due])] : plan.due;
    for (const s of todo) {
      if (Date.now() - t0 > SYNC.budgetMs) break;
      scope = s;
      const w = WINDOWS.find(x => x.scope === s);
      if (!w) continue;
      const a = dayAdd(today, w.from), b = dayAdd(today, w.to), r = await fetchWindow(env, c, a, b);
      const st = await applyWindow(db, ws, r.list, a, b, !r.cut, now, (/** @type {any} */ n) => [syncOkStmt(db, ws, SRC, s, now, null, { ...n, cut: r.cut, from: a, to: b }), syncClearStmt(db, ws, SRC, s)]);
      done.push({ scope: s, from: a, to: b, ...st });
    }
    await recompute(db, ws, now, "stale"); // ближайшая запись прошла — она стала визитом (или «не пришёл»)
    // справочник клиентов (вся база салона): раз в неделю, страницами, сколько успеет — дальше с того же места
    if (Date.now() - t0 < SYNC.budgetMs) { scope = "clients"; const d = await dirStep(env, c, db, now, t0, !!opts.force); if (d) done.push(d); }
    return { initial: initialInfo(init), windows: done };
  } catch (/** @type {any} */ e) {
    const known = e && typeof e.code === "string";
    if (!known) console.log("contacts sync", c.id, logSafe(String((e && e.stack) || e)));
    const text = known ? e.message : "Сбой при записи в базу — повторим в следующий раз.";
    try { await syncFail(db, ws, SRC, scope, text, now); } catch (e2) { console.log("contacts sync fail", String(e2)); }
    throw known ? e : fail("store", text);
  } finally {
    try { await leaseFree(db, ws, SRC, token); } catch (e) {}
  }
}
/** Ход первичной загрузки для экрана. @param {any} init */
export function initialInfo(init) {
  if (!init) return { done: false, from: null, to: null, cursor: null, pct: 0 };
  if (init.phase === "done") return { done: true, from: init.from, to: init.to, cursor: null, pct: 100 };
  const days = (/** @type {string} */ a, /** @type {string} */ b) => Math.round((dayStart(b) - dayStart(a)) / 86400e3) + 1;
  const total = days(init.from, init.to), left = init.phase === "future" ? total : days(init.from, init.next);
  return { done: false, from: init.from, to: init.to, cursor: init.phase === "future" ? null : init.next, pct: Math.max(0, Math.min(99, Math.round(100 * (1 - left / total)))) };
}

/**
 * Проверка без записи: журнал за 90 дней назад и 60 вперёд читается и разбирается, как при синхронизации, но в базу не пишется —
 * только числа (на черновике это единственный способ проверить настоящий Altegio: номера и имена клиентов в черновик не попадают).
 * @param {Env} env @param {Client} c @param {number} now
 */
export async function syncDry(env, c, now) {
  const why = syncWhy(env, c);
  if (why) throw fail("setup", why);
  const today = dayOf(now), from = dayAdd(today, -90), to = dayAdd(today, 60);
  const r = await fetchWindow(env, c, from, to), f = foldWindow(r.list, newId);
  const db = await d1Ready(env, now);
  let known = 0;
  if (db) { try { known = (await contactsByPhones(db, c.id, f.contacts.map(x => x.p))).size; } catch (e) {} }
  const future = f.bookings.filter(x => !x.del && x.at > now).length;
  const summary = [
    `Журнал ${from} … ${to}: записей ${r.list.length}${r.cut ? " (прочитано не всё — больше 8 000)" : ""}, страниц ${r.pages}`,
    `Записей клиентов: ${f.count.bookings}; без клиента (перерывы): ${f.count.skipped}`,
    `Клиентов с номером: ${f.contacts.length}; скрытых номеров: ${f.count.masked}; неверных: ${f.count.bad}; пустых: ${f.count.empty}`,
    `Удалённых записей в ответе: ${f.count.deleted}; «не пришёл»: ${f.count.missed}; будущих записей: ${future}`,
    `Отметки attendance: ${Object.entries(f.count.att).map(([k, v]) => `${k} — ${v}`).join(", ") || "нет"}`,
    db ? `Уже есть в базе этого адреса: ${known} из ${f.contacts.length}` : "База этого адреса не подключена — сравнения нет",
    "В базу ничего не записано."
  ];
  // справочник клиентов: вся база салона — сколько всего, сколько с номером, сколько не были больше 2 лет (их в журнале нет)
  const dir = await dirDry(env, c, now, Date.now() + 25000).catch((/** @type {any} */ e) => ({ error: e && e.message ? String(e.message) : "не прочитан" }));
  if ("error" in dir) summary.splice(summary.length - 1, 0, `Справочник клиентов: ${dir.error}`);
  else summary.splice(summary.length - 1, 0,
    `Справочник клиентов Altegio: всего ${dir.total}; прочитано ${dir.read}${dir.read < dir.total ? " (не всё — не хватило времени)" : ""}`,
    `В справочнике: с номером ${dir.ok}, скрытых ${dir.masked}, неверных ${dir.bad}, пустых ${dir.empty}; без визитов ${dir.never}; последний визит больше 2 лет назад — ${dir.old2y}`,
    `Разрешили рассылки (флаг Altegio, не подтверждённое согласие): ${dir.news ?? "не прочитано"}${dir.newsNote ? " — " + dir.newsNote : ""}`,
    `Не получают массовые уведомления (Altegio, учитываем как отказ от рекламы): ${dir.nomass ?? "не прочитано"}${dir.nomassNote ? " — " + dir.nomassNote : ""}`);
  const report = { at: now, ok: true, summary, numbers: { ...f.count, contacts: f.contacts.length, future, known, cut: r.cut, pages: r.pages, directory: "error" in dir ? null : dir } };
  if (db) { try { await eventPut(db, c.id, `dry:${now}`, "altegio_dry", report, now, "owner"); } catch (e) {} }
  return report;
}

// Вымышленные клиенты для экрана черновика — демо-база (./demo.js): тот же путь записи (applyWindow), 150 человек, только кнопкой владельца.

/** Фоновая задача: раз в 5 минут — шаг синхронизации компаний с базой клиентов (crm) и флагом MSG_V2_<ID>=1. @param {Env} env @param {number} now */
export async function contactsRun(env, now) {
  if (local(now).getUTCMinutes() % 5 !== 2) return 0;
  let n = 0;
  for (const c of Object.values(CLIENTS)) {
    if (c.off || !c.crm || env["MSG_V2_" + String(c.id).toUpperCase()] !== "1" || syncWhy(env, c)) continue;
    try { await syncStep(env, c, now); n++; } catch (/** @type {any} */ e) { if (!(e && e.code === "busy")) console.log("contacts run", c.id, logSafe(String((e && e.message) || e))); }
  }
  return n;
}

// ---- справочник клиентов Altegio: вся база салона (поиск POST /locations/{локация}/clients/search, «Get a list of clients», до 200
// на страницу, meta.total_count), а не только те, кто был в журнале за 2 года. Это поиск — данные в Altegio не меняет (altRead). Номер, имя, id, первый и
// последний визит, число визитов по Altegio; «разрешил рассылки» — отдельным поиском с фильтром is_newsletter_allowed (это флаг
// Altegio, а не подтверждённое согласие). Курсор — номер страницы в sync_state (scope 'clients'); полный проход — раз в неделю.
export const DIR = { pageSize: 200, everyMs: 7 * 86400e3, fields: ["id", "name", "surname", "phone", "first_visit_date", "last_visit_date", "visits_count"] };
// флаги Altegio: «разрешил рассылки» (не подтверждённое согласие) и «не получает массовые уведомления» (отказ от рекламы: 30.10.2026
// такой был у 1 из 18 935 клиентов Winchester, а синхронизация его не читала — отказ терялся; учтён 02.11.2026)
const NEWS = [{ type: "is_newsletter_allowed", state: { value: true } }];
const NOMASS = [{ type: "is_mass_notification_allowed", state: { value: false } }];
let noVisitsCount = false; // Altegio не принял поле visits_count (400) — дальше без него

/** Страница справочника: { list, total }. filters — фильтры Altegio. @param {Env} env @param {Client} c @param {number} page @param {any[]} [filters] @param {string[]} [fields] */
export async function dirPage(env, c, page, filters, fields) {
  const want = fields || (noVisitsCount ? DIR.fields.filter(f => f !== "visits_count") : DIR.fields);
  const body = { page, page_size: DIR.pageSize, fields: want, order_by: "id", order_by_direction: "ASC", ...(filters ? { filters } : {}) };
  try { return await altClientsSearch(env, altUserKey(env, c), altLoc(env, c), body); }
  catch (/** @type {any} */ e) {
    if (+(e && e.status) === 400 && want.includes("visits_count") && !fields) { noVisitsCount = true; return dirPage(env, c, page, filters); }
    console.log("contacts dir", c.id, logSafe(String((e && e.message) || e)));
    throw fail("altegio", altText(e).replace("журнал", "список клиентов"));
  }
}
/** Клиент справочника → строка для D1 (null — без номера: скрыт или неверный). @param {any} x */
export function dirRow(x) {
  const raw = String(x.phone ?? ""), p = normPhone(raw).slice(1);
  const kind = /** @type {'ok'|'masked'|'bad'|'empty'} */ (p ? "ok" : /[xх*]/i.test(raw) ? "masked" : raw.trim() ? "bad" : "empty");
  if (!p) return { row: null, kind };
  const n = altClean([x.name, x.surname].filter(v => typeof v === "string" && v.trim()).join(" "), 60);
  const day = (/** @type {any} */ v) => { const t = String(v ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? dayStart(t) + 12 * 3600e3 : altMs(t) || null; };
  return { row: { id: newId(), p, n, s: searchOf(n, p), cr: x.id != null ? String(x.id).slice(0, 40) : null, fv: day(x.first_visit_date), lv: day(x.last_visit_date), vc: Number.isFinite(+x.visits_count) && x.visits_count !== null && x.visits_count !== "" ? +x.visits_count : null }, kind };
}
/** Состояние справочника для экрана. @param {any} row строка sync_state 'clients' */
export function dirStatus(row) {
  if (!row) return null;
  /** @type {any} */ let cur = {}; try { cur = JSON.parse(row.cursor || "{}") || {}; } catch (e) {}
  const total = +cur.total || 0, done = !!cur.done, read = Math.min(total, ((+cur.page || 1) - 1) * DIR.pageSize);
  return { done, total, pct: done ? 100 : total ? Math.min(99, Math.round(100 * read / total)) : 0, lastOkAt: row.last_ok_at ? +row.last_ok_at : null, lastError: row.last_error || null, masked: +cur.masked || 0, bad: +cur.bad || 0 };
}
/**
 * Шаг справочника: страницы, пока есть время. Полный проход закончился меньше недели назад — ничего (force — тоже по расписанию:
 * справочник большой, 95 страниц на 19 000 клиентов). → итог шага для отчёта или null.
 * @param {Env} env @param {Client} c @param {any} db @param {number} now @param {number} t0 @param {boolean} force
 */
async function dirStep(env, c, db, now, t0, force) {
  const ws = c.id, row = (await syncRows(db, ws, SRC)).find((/** @type {any} */ r) => r.scope === "clients");
  /** @type {any} */ let cur = {}; try { cur = JSON.parse((row && row.cursor) || "{}") || {}; } catch (e) {}
  if (cur.done && row && row.last_ok_at && now - +row.last_ok_at < DIR.everyMs) return null;
  if (cur.done) cur = {};
  let page = +cur.page || 1, phase = cur.phase || "all", read = 0;
  const st = { masked: +cur.masked || 0, bad: +cur.bad || 0 };
  while (Date.now() - t0 < SYNC.budgetMs) {
    const flag = phase === "news" || phase === "nomass";
    const r = await dirPage(env, c, page, phase === "news" ? NEWS : phase === "nomass" ? NOMASS : undefined, flag ? ["id", "phone"] : undefined);
    const rows = [];
    for (const x of r.list) {
      const d = dirRow(x);
      if (!d.row) { if (phase === "all" && (d.kind === "masked" || d.kind === "bad")) st[d.kind]++; continue; }
      rows.push(flag ? { p: d.row.p } : d.row);
    }
    const last = r.list.length < DIR.pageSize;
    const next = last ? (phase === "all" ? { phase: "news", page: 1 } : phase === "news" ? { phase: "nomass", page: 1 } : { phase: "done", page: 1 }) : { phase, page: page + 1 };
    // отказы из Altegio копятся по страницам в курсоре и записываются одним пакетом в конце прохода (снимать — только по полному списку)
    const nm = phase === "nomass" ? [...(Array.isArray(cur.nm) ? cur.nm : []), ...rows.map(x => x.p)] : null, NM_MAX = 5000;
    const curNext = { total: phase === "all" ? r.total : +cur.total || r.total, ...st, page: next.page, phase: next.phase, done: next.phase === "done", ...(nm && !last ? { nm: nm.slice(0, NM_MAX) } : {}) };
    const extra = curNext.done ? [syncOkStmt(db, ws, SRC, "clients", now, JSON.stringify(curNext), null), syncClearStmt(db, ws, SRC, "clients")] : [syncCursorStmt(db, ws, SRC, "clients", JSON.stringify(curNext))];
    if (nm) await directoryApply(db, ws, last ? nm.slice(0, NM_MAX).map(p => ({ p })) : [], now, extra, last ? { nomass: true, lift: nm.length <= NM_MAX } : {});
    else await directoryApply(db, ws, rows, now, extra, { news: phase === "news", reset: phase === "news" && page === 1 });
    read += r.list.length; cur = curNext; page = next.page; phase = next.phase;
    if (cur.done) break;
  }
  return { scope: "clients", from: "справочник", to: cur.done ? "весь" : `страница ${page}`, records: read, contacts: read, warn: "" };
}

/** Справочник без записи: страницы до срока, только числа. @param {Env} env @param {Client} c @param {number} now @param {number} until */
async function dirDry(env, c, now, until) {
  const out = { total: 0, read: 0, ok: 0, masked: 0, bad: 0, empty: 0, never: 0, old2y: 0, news: /** @type {number|null} */ (null), newsNote: "", nomass: /** @type {number|null} */ (null), nomassNote: "" };
  for (let page = 1; Date.now() < until; page++) {
    const r = await dirPage(env, c, page);
    if (page === 1) out.total = r.total;
    for (const x of r.list) {
      out.read++;
      const d = dirRow(x);
      out[d.kind]++;
      const lv = d.row ? d.row.lv : altMs(x.last_visit_date) || (/^\d{4}-\d{2}-\d{2}$/.test(String(x.last_visit_date || "")) ? dayStart(String(x.last_visit_date)) : 0);
      if (!lv) out.never++; else if (now - lv > SYNC.pastDays * 86400e3) out.old2y++;
    }
    if (r.list.length < DIR.pageSize) break;
  }
  try { out.news = (await dirPage(env, c, 1, NEWS, ["id"])).total; }
  catch (/** @type {any} */ e) { out.newsNote = e && e.message ? String(e.message) : "фильтр не принят"; }
  try { out.nomass = (await dirPage(env, c, 1, NOMASS, ["id"])).total; }
  catch (/** @type {any} */ e) { out.nomassNote = e && e.message ? String(e.message) : "фильтр не принят"; }
  return out;
}
