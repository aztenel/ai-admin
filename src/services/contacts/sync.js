// @ts-check
// Синхронизация журнала Altegio → контакты D1 (этап 1, 31.10.2026; docs/architecture-cloudflare-d1.md §6.2).
// Первичная загрузка: сначала будущее (сегодня … +60 дней), потом прошлое окнами по 14 дней назад до 2 лет; курсор в sync_state —
// оборванная загрузка продолжается с того же окна. Дальше — окна по расписанию: «горячее» (вчера … +14 дней) раз в 15 минут,
// «будущее» (сегодня … +60) раз в час, «прошлое» (35 дней назад … вчера) раз в сутки после 04:00 — отметки «пришёл», поздние правки.
// Окно прочитано целиком — записи, которых в ответе нет, помечаются удалёнными (администратор удаляет — запись пропадает из журнала).
// Каждое окно — одна пачка D1 (транзакция) вместе с курсором: сбой посреди окна не оставляет половины данных.
// Аренда в sync_state: кнопка и фоновая задача одновременно не синхронизируют. Только чтение Altegio (GET).
// На черновике (STAGE=preview) настоящий Altegio не пишется в D1: только «проверка без записи» и проба полей, а для экрана —
// тестовые клиенты (CONTACTS_DEV_REAL=1 разрешает запись — только по решению владельца).
/** @import { Env, Client } from "../../lib/types.js" */
import { CLIENTS } from "../../config/builtin-clients.js";
import { logSafe } from "../../lib/phone.js";
import { local } from "../../lib/time.js";
import { altRecordsRange } from "../integrations/altegio/records-api.js";
import { crmWhy } from "../crm/snapshot.js";
import { altUserKey } from "../booking/journal.js";
import { altLoc } from "../booking/book.js";
import { d1Ready, stageOf } from "../../db/d1/status.js";
import { syncRows, leaseTake, leaseFree, syncOkStmt, syncCursorStmt, syncFail, syncClearStmt } from "../../db/d1/sync.js";
import { windowApply, ownersOf, windowCount, recompute, contactsByPhones, eventPut } from "../../db/d1/contacts.js";
import { foldWindow, dayOf, dayAdd, dayStart } from "./normalize.js";

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
  await windowApply(db, ws, { contacts: f.contacts, bookings: f.bookings, window: win, oldIds, stamp, extra: typeof extra === "function" ? extra(f.count) : extra });
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
  if (!realAllowed(env)) throw fail("preview", "Черновик: настоящий Altegio в базу черновика не загружается — только «Проверка без записи». Для экрана — «Тестовые клиенты».");
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
  const report = { at: now, ok: true, summary, numbers: { ...f.count, contacts: f.contacts.length, future, known, cut: r.cut, pages: r.pages } };
  if (db) { try { await eventPut(db, c.id, `dry:${now}`, "altegio_dry", report, now, "owner"); } catch (e) {} }
  return report;
}

// ---- тестовые клиенты черновика: синтетический журнал в формате Altegio проходит тот же путь записи, что и настоящий
const NAMES = ["Арман", "Ерлан", "Данияр", "Тимур", "Нурлан", "Азамат", "Руслан", "Санжар", "Олжас", "Бауыржан", "Максим", "Иван", "Алексей", "Дамир", "Ильяс", "Марат", "Аслан", "Бекзат", "Канат", "Роман"];
const STAFF = ["Мастер А", "Мастер Б", "Мастер В"], SVC = ["Мужская стрижка", "Борода", "Стрижка + борода", "Отец и сын", "Детская стрижка"];
/** Синтетический журнал: 40 клиентов, визиты за 150 дней, будущие записи, скрытый номер, удалённая запись, «не пришёл». @param {number} now */
export function testJournal(now) {
  const list = [], at = (/** @type {number} */ d, /** @type {number} */ h) => new Date(dayStart(dayAdd(dayOf(now), d)) + h * 3600e3).toISOString().replace(".000Z", "+00:00");
  let id = 900000;
  for (let i = 0; i < 40; i++) {
    const phone = "+7 700 000 " + String(10 + Math.floor(i / 10)).padStart(2, "0") + " " + String(10 + (i % 90)).padStart(2, "0");
    const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? " " + (i + 1) : "");
    const gap = [7, 22, 25, 30, 33, 40, 50, 65, 80, 100][i % 10], visits = 1 + (i % 4);
    for (let v = 0; v < visits; v++) {
      const d = -(gap + v * 28);
      list.push({ id: ++id, datetime: at(d, 11 + (i % 8)), create_date: at(d - 3, 10), client: { id: 5000 + i, name, phone }, staff: { id: 1 + (i % 3), name: STAFF[i % 3] }, services: [{ id: 1, title: SVC[(i + v) % SVC.length] }], attendance: v === 1 && i % 9 === 0 ? -1 : 1, deleted: false });
    }
    if (i % 5 === 0) list.push({ id: ++id, datetime: at(2 + (i % 12), 15), create_date: at(-1, 12), client: { id: 5000 + i, name, phone }, staff: { id: 1, name: STAFF[0] }, services: [{ id: 1, title: SVC[0] }], attendance: 0, deleted: false });
  }
  list.push({ id: ++id, datetime: at(-10, 13), client: { id: 6001, name: "Скрытый номер", phone: "+7 707 XXX-X7-44" }, staff: { id: 2, name: STAFF[1] }, services: [{ id: 1, title: SVC[0] }], attendance: 1 });
  list.push({ id: ++id, datetime: at(3, 12), client: { id: 5001, name: NAMES[1], phone: "+7 700 000 10 11" }, staff: { id: 2, name: STAFF[1] }, services: [{ id: 1, title: SVC[1] }], attendance: 0, deleted: true });
  list.push({ id: ++id, datetime: at(-2, 12), staff: { id: 3, name: STAFF[2] }, services: [], comment: "перерыв" });
  return list;
}
/** Залить тестовых клиентов (только черновик). @param {Env} env @param {Client} c @param {number} now */
export async function syncTest(env, c, now) {
  if (stageOf(env) !== "preview") throw fail("preview", "Тестовые клиенты — только на черновике.");
  const db = await d1Ready(env, now);
  if (!db) throw fail("db", "База контактов не подключена.");
  const st = await applyWindow(db, c.id, testJournal(now), dayAdd(dayOf(now), -160), dayAdd(dayOf(now), 30), false, now, []);
  await eventPut(db, c.id, `test:${now}`, "test_data", { contacts: st.contacts, bookings: st.bookings }, now, "owner");
  return { summary: [`Тестовые клиенты: ${st.contacts} (номера +7 700 000 xx xx), записей ${st.bookings}, из них скрытый номер — ${st.masked}, удалённых — ${st.deleted}, «не пришёл» — ${st.missed}.`] };
}

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
