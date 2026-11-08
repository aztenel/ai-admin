// @ts-check
// Сервисные сообщения по журналу Altegio со второго номера (Green-API), без бота (30.10.2026, решение владельца: второй номер
// Winchester — только исходящие сообщения в часы отправки). remindPlan (plan.js) знает только записи, которые бот сделал в чате;
// здесь — все записи журнала: администратор, сайт, онлайн-запись.
// С 02.11.2026 (раздел «Автоматические сообщения», services/automsg) у каждого сценария свой выключатель, время и текст: подтверждение
// (s01), напоминание за 24 часа или накануне (d1), напоминание за несколько часов (h2), перенос (s06), отмена (cx), благодарность и отзыв
// (rv, с ТЗ v4 — через N часов после окончания визита, ссылки «Детали» и «Контроль качества» Altegio), начислено и списано бонусов (bi, bo —
// ./bonus.js).
// Всё выключено, пока владелец не включит сценарий в пульте; главный выключатель — Text REMIND_GA_<ID> = 1 (jrOn). Настройки —
// msgset:<клиент> (db/kv/automsg.js), часы отправки и предел за сутки — там же (по умолчанию из c.jr паспорта).
// Раз в 15 минут — журнал со вчера на 14 дней вперёд → очередь jrq:<клиент> (только то, что уйдёт в ближайшие 36 часов) и записи,
// которые видели (jrb:<клиент>): у записи сменилась версия (время, мастер, услуги) — перенос; пропала из журнала — проверка по журналу
// на 60 дней: нашлась — перенос, нет — отмена. Перед отправкой запись перечитывается (журнал её дня): удалена, перенесена, «не пришёл»,
// уже пришёл — напоминание не уходит; отзыв — только с отметкой «пришёл» (attendance 1); отмена — только если запись так и не вернулась.
// От двойной отправки: отметка попытки в KV (rms:) и атомарная отметка в D1 send_claims (если у адреса есть база): одна запись, один вид,
// одна версия — одно сообщение, даже если журнал прочитали дважды или фоновые задачи совпали. Неизвестно, ушло ли, — второй раз не шлём.
// Чтением журнала 30.10.2026 проверено: «пришёл» администраторы ставят, create_date есть у всех записей, удалённые записи журнал не отдаёт.
/** @import { Env, Client } from "../../lib/types.js" */
import { CLIENTS } from "../../config/builtin-clients.js";
import { REMIND_LATE } from "../../config/constants.js";
import { TZ, local, isoDay } from "../../lib/time.js";
import { normPhone, maskPhone } from "../../lib/phone.js";
import { hash } from "../../lib/crypto.js";
import { altText } from "../integrations/altegio/client.js";
import { altRecordsRange, altRecordsChanged } from "../integrations/altegio/records-api.js";
import { gaRoute } from "../integrations/greenapi/webhook.js";
import { gaKind, gaWhy, gaUnsureNote } from "../integrations/greenapi/client.js";
import { notify } from "../integrations/telegram/client.js";
import { notifyOnce } from "../notifications/telegram.js";
import { sendGreen } from "../channels/greenapi.js";
import { altUserKey } from "../booking/journal.js";
import { altLoc } from "../booking/book.js";
import { stErr } from "../inbox/status.js";
import { sendOnce } from "../inbox/send.js";
import { marketingGate } from "../contacts/gate.js";
import { logTurns, readHist } from "../../db/kv/chats.js";
import { jrqLoad, jrqSave, jrSyncAt, jrSyncMark, jrCount, jrCountSave, jrCapNote, jrHold, jrHoldSet, jrReviewedAt, jrReviewMark, optedOut, rmOk,
  jrTried, jrTry, jrUntry, jrLogAdd, jrNoShowMark, svApprovals } from "../../db/kv/reminders.js";
import { autoLoad, autoCountAdd, jrbLoad, jrbSave } from "../../db/kv/automsg.js";
import { siteNotifyLoad } from "../../db/kv/site.js";
import { atLocal } from "./plan.js";
import { KIND_SC, scenario, svText, firstName, approvedVariant, activeOf, linkOf } from "./templates.js";
import { autoSettings, KIND_IDS } from "../automsg/catalog.js";
import { bonusScan, sendAt } from "./bonus.js";
import { svOwn } from "./variants.js";
import { isPreview } from "../../lib/stage.js";
import { kvKey } from "../../lib/kv-id.js";

const SYNC_MS = 15 * 60e3;   // журнал — не чаще раза в 15 минут: у Altegio предел 5 запросов в секунду на всех
// между полными чтениями — раз в минуту только изменённые записи (ТЗ v4, 08.11.2026: подтверждение за 1–2 минуты). Окно 10 минут с запасом:
// запись, изменённую за это время, увидим несколько раз — в очередь и состояние она попадает один раз (ключ задачи, версия записи)
const FAST_WIN = 10 * 60e3;
const AHEAD = 14;            // журнал читаем со вчера на 14 дней вперёд: подтверждение, перенос и отмена — и у записей не на завтра
const WIN_PAGES = 4;         // 15 дней одной локации — 1–2 страницы по 200 записей (у Winchester ≈15 записей в день)
const HORIZON = 36 * 3600e3; // в очереди — только то, что уйдёт в ближайшие 36 часов: дальнее спланирует следующее чтение журнала
const PER_MIN = 2;           // сообщений в минуту со второго номера: неофициальный номер, частые сообщения подряд — повод для блокировки
const H2_LATE = 45 * 60e3;   // «за несколько часов» позже чем через 45 минут уже не к месту
const QUEUE_MAX = 600;
const NEW_LATE = 3 * 3600e3; // подтверждение, перенос, отмена — не позже чем через 3 часа (позже — уже не к месту)
const MAX_TRIES = 3;         // Green-API точно не принял (429, перезапуск инстанса): столько попыток, дальше — задача администратору (S18). 5xx — не здесь: сообщение могло уйти
// о записи клиент знает, если по Altegio ей не меньше 30 минут (или мы уже писали о ней): запись, созданную по ошибке и удалённую или
// исправленную через несколько минут, журнал (раз в 15 минут) замечает не раньше чем через 15–20 минут после создания — клиенту не пишем
const KNOWN_MS = 30 * 60e3;
const FRESH_MS = 3600e3;     // перенос и отмену сообщаем, только если видели запись в журнале за последний час (не задним числом после перерыва)
const WIDE_DAYS = 60;        // запись пропала из окна — ищем её в журнале на 60 дней: перенесли далеко или удалили
const SVC_NO = new Set(["block", "stop", "review"]); // база контактов D1: полный запрет, «стоп», неоднозначный «стоп» — сервисных тоже не шлём

/** настройки отправки: с set (настройки «Автоматических сообщений») — выключатели и время из пульта; без set — как в паспорте компании
 *  (так план считают проверки: накануне в 18:00, за 2 часа, отзыв через 3 часа) @param {Client} c @param {any} [set] */
function opts(c, set) {
  const base = { from: 10, to: 21, eve: "18:00", h2: true, rv: true, cap: 150, s01: false, s06: false, cx: false, noshow: true, ...(c.jr || {}) };
  const o = { ...base, d1: !!base.eve, d1mode: "eve", h2h: 2, rvh: 3, rvgap: 60, s01gap: 0, bi: false, bo: false, set: /** @type {any} */ (null), site: /** @type {any} */ (null) };
  if (!set) return o;
  const s = set.s;
  return { ...o, from: set.win.from, to: set.win.to, cap: set.cap, s01: s.confirm.on, s01gap: Number.isFinite(+s.confirm.t.delay) ? Math.max(0, +s.confirm.t.delay) : 0,
    d1: s.remind24.on, d1mode: s.remind24.t.mode, eve: String(s.remind24.t.eve || "18:00"), h2: s.remind3.on, h2h: +s.remind3.t.hours || 3,
    s06: s.move.on, cx: s.cancel.on, rv: s.review.on, rvh: Number.isFinite(+s.review.t.hours) ? Math.max(0, +s.review.t.hours) : 1,
    rvgap: Number.isFinite(+s.review.t.gap) ? Math.max(0, +s.review.t.gap) : 0, bi: !!(s.bonusIn && s.bonusIn.on), bo: !!(s.bonusOut && s.bonusOut.on), set };
}
/** до какого опоздания ещё шлём: накануне — до конца часов отправки, за несколько часов — 45 минут, отзыв — 3 часа, подтверждение,
 *  перенос и отмена — 3 часа @param {any} o @param {string} k @param {number} at */
function late(o, k, at) {
  if (k === "h2") return H2_LATE;
  if (k === "rv") return REMIND_LATE;
  if (k === "s01" || k === "s06" || k === "cx" || k === "bi" || k === "bo") return NEW_LATE;
  const L = local(at), end = Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate(), o.to - TZ, 0);
  return Math.max(0, end - at);
}
/** за 24 часа до визита, в часы отправки: раньше начала — в начало, в конце дня — за полчаса до конца (всё равно накануне)
 *  @param {number} t @param {any} o */
function in24(t, o) {
  const d = t - 24 * 3600e3, L = local(d), h = L.getUTCHours();
  if (h < o.from) return Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate(), o.from - TZ, 0);
  if (h >= o.to) return Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate(), o.to - TZ, 0) - 30 * 60e3;
  return d;
}

// почему по записи журнала сообщений не будет (для проверки без отправки); "" — запись годится
/** @param {any} r */
function recWhy(r) {
  if (!r || typeof r !== "object") return "пустая запись";
  if (r.deleted === true || r.deleted === 1) return "запись удалена";
  if (!r.client || typeof r.client !== "object") return "без клиента (перерыв мастера)";
  const dt = String(r.datetime || "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dt)) return "нет времени записи";
  if (!normPhone(String(r.client.phone ?? ""))) return "номер скрыт или неверный";
  return "";
}
// версия записи: время, мастер, услуги — перенос с тем же номером записи даёт другую версию (ТЗ v2.0 §4)
/** @param {any} r */
const recVer = r => hash([String(r.datetime || ""), String((r.staff && r.staff.id) ?? r.staff_id ?? ""),
  (Array.isArray(r.services) ? r.services : []).map(/** @param {any} s */ s => String(s && s.id)).sort().join(",")].join("|")).toString(36);

// запись журнала → то, что нужно для сообщения; null — удалена, без клиента (перерыв мастера), скрытый или неверный номер
/** @param {any} r */
export function jrRec(r) {
  if (recWhy(r)) return null;
  const dt = String(r.datetime || ""), date = dt.slice(0, 10), time = dt.slice(11, 16);
  const p = normPhone(String(r.client.phone ?? "")).slice(1);
  const att = +r.attendance === -1 || +r.visit_attendance === -1 ? -1 : +r.attendance === 1 || +r.visit_attendance === 1 ? 1 : 0;
  // len — длительность записи в секундах (seance_length): благодарность — от конца визита; lk — ссылка Altegio на запись (short_link)
  const len = +r.seance_length > 0 ? +r.seance_length : +r.length > 0 ? +r.length : 0;
  return { id: String(r.id), date, time, p, att, v: recVer(r), made: Date.parse(String(r.create_date || "")) || 0, n: altText(r.client.name || "", 60),
    staff: altText((r.staff && r.staff.name) || "", 40), len: Math.min(len, 12 * 3600), lk: linkOf(r.short_link),
    svc: (Array.isArray(r.services) ? r.services : []).map(/** @param {any} s */ s => altText(s && s.title, 60)).filter(Boolean).join(", ") };
}

/** что и когда отправить по этим записям (чистая функция). Накануне — в выбранное время или за 24 часа (в часы отправки), если запись
 *  сделана раньше чем за час до этого; за несколько часов — только если это время в часах отправки и запись сделана заранее; отзыв —
 *  через несколько часов после начала, вне часов отправки — утром (from + 1); подтверждение новой записи — через несколько минут после
 *  записи, в часы отправки и не меньше чем за час до визита. Уже прошедшее и опоздавшее больше допустимого — не планируем.
 *  set — настройки «Автоматических сообщений» (выключатели и время); без них — как в паспорте компании; site — выбор с сайта.
 *  @param {Client} c @param {any[]} records @param {number} now @param {any} [set] @param {Record<string, { h: number }>} [site] */
export const jrPlan = (c, records, now, set, site) => jrPlanAll(c, records, now, set, site).items;

/** то же и почему по записям ничего не будет. site — выбор клиента в форме сайта { <номер записи>: { h } } (ТЗ v4): вместо обычных
 *  напоминаний одно — за столько часов, сколько он выбрал (24 и больше — напоминание накануне, меньше — в день визита; 0 — без напоминаний).
 *  Нужен включённый сценарий этого вида: текст и одобрение — у него
 *  @param {Client} c @param {any[]} records @param {number} now @param {any} [set] @param {Record<string, { h: number }>} [site] */
export function jrPlanAll(c, records, now, set, site) {
  const o = opts(c, set), out = /** @type {any[]} */ ([]), skipped = /** @type {any[]} */ ([]);
  for (const r of records) {
    const why = recWhy(r), v = why ? null : jrRec(r);
    if (!v) { skipped.push({ rec: String((r && r.id) ?? ""), why }); continue; }
    if (v.att === -1) { skipped.push({ rec: v.id, why: "клиент не пришёл" }); continue; }
    const t = atLocal(v.date, v.time), base = { rec: v.id, v: v.v, p: v.p, n: v.n, date: v.date, time: v.time, staff: v.staff, svc: v.svc, ...(v.lk ? { lk: v.lk } : {}) };
    const add = (/** @type {string} */ k, /** @type {number} */ at) => { if (now - at <= late(o, k, at)) out.push({ ...base, k, at }); };
    if (o.s01 && v.made && v.att !== 1) {
      let s1 = v.made + o.s01gap * 60e3;
      const L = local(s1), lh = L.getUTCHours();
      if (lh < o.from || lh >= o.to) s1 = Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate() + (lh >= o.to ? 1 : 0), o.from - TZ, 0);
      if (t - s1 >= 3600e3) add("s01", s1);
    }
    const pick = site && site[v.id];
    if (pick && v.att !== 1) { // клиент сам выбрал на сайте, когда напомнить
      const h = Math.max(0, +pick.h || 0);
      if (!h) skipped.push({ rec: v.id, why: "на сайте клиент выбрал «не напоминать»" });
      else if (h >= 12 && o.d1) { const d1 = in24(t - (h - 24) * 3600e3, o); if (d1 < t && !(v.made && v.made > d1 - 600e3)) add("d1", d1); }
      else if (h < 12 && o.h2) {
        const h2 = t - h * 3600e3, hr = local(h2).getUTCHours();
        if (hr >= o.from && hr < o.to && !(v.made && v.made > h2 - 600e3)) add("h2", h2);
        else skipped.push({ rec: v.id, why: `за ${h} ч до визита — вне часов отправки или запись сделана позже` });
      }
    }
    if (o.d1 && v.att !== 1 && !pick) {
      const d1 = o.d1mode === "24h" ? in24(t, o) : atLocal(v.date, o.eve, -1);
      if (t - d1 >= 12 * 3600e3 && !(v.made && v.made > d1 - 3600e3)) add("d1", d1);
    }
    if (o.h2 && v.att !== 1 && !pick) {
      const h2 = t - o.h2h * 3600e3, hr = local(h2).getUTCHours();
      if (hr >= o.from && hr < o.to && !(v.made && t - v.made < (o.h2h + 2) * 3600e3)) add("h2", h2);
    }
    if (o.rv && c.review) { // благодарность — через rvh часов после окончания визита (начало + длительность записи)
      let rv = t + v.len * 1000 + o.rvh * 3600e3;
      const L = local(rv), lh = L.getUTCHours();
      if (lh >= o.to || lh < o.from) rv = Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate() + (lh >= o.to ? 1 : 0), o.from + 1 - TZ, 0);
      add("rv", rv);
    }
  }
  return { items: out, skipped };
}

/** @param {any} x */
const key = x => x.rec + ":" + x.k + ":" + (x.v || "") + (x.tx ? ":" + x.tx : ""); // бонусы: у записи может быть несколько операций
/** запись решения для журнала очереди (раздел «Автоматические сообщения») @param {any} x @param {string} st @param {string} why @param {number} now */
const entry = (x, st, why, now) => ({ t: now, k: x.k, rec: x.rec, p: x.p, n: x.n || "", date: x.date, time: x.time, st, why });
/** @type {Record<string, string>} */
const KIND_WORD = { s01: "подтверждение записи", s06: "сообщение о переносе", cx: "сообщение об отмене", d1: "напоминание накануне", h2: "напоминание в день визита", rv: "благодарность за визит", bi: "начислено бонусов", bo: "списано бонусов" };
/** состояние записи журнала → строка очереди @param {any} p */
const fromState = p => ({ rec: p.id, v: p.v, p: p.p, n: p.n, date: p.d, time: p.t, staff: p.s, svc: p.sv, ...(p.lk ? { lk: p.lk } : {}) });
/** клиент знает об этой записи: мы о ней уже писали, или ей не меньше 30 минут @param {any} p @param {number} now */
const told = (p, now) => (Array.isArray(p.sent) && p.sent.length > 0) || now - (+p.mk || +p.fs || now) >= KNOWN_MS;

/** главный выключатель: c.jr и Text REMIND_GA_<ID> = 1. По умолчанию выключен — это сообщения настоящим клиентам с неофициального
 *  номера: включает владелец после «отправляй» заказчика (30.10.2026). Кроме него, каждый сценарий включается в пульте отдельно
 *  @param {Env} env @param {Client} c */
export const jrOn = (env, c) => !!(c && c.jr) && /^(1|on|yes|true|да)$/i.test(String(env["REMIND_GA_" + String(c.id).toUpperCase()] || "").trim());

/** фоновая задача раз в минуту: компании с c.jr, ключом журнала и номером Green-API @param {Env} env @param {number} now */
export async function jrRun(env, now) {
  let n = 0;
  for (const c of Object.values(CLIENTS)) {
    if (!jrOn(env, c)) continue;
    try { n += await jrClient(env, c, now); } catch (/** @type {any} */ e) { console.log("jr", c.id, String((e && e.stack) || e)); }
  }
  return n;
}

// Событие Altegio (вебхук /alt/<компания>, ТЗ v4: «моментально, а не раз в 15 минут»): журнал читаем сразу, не ждём минуты расписания.
// Одна компания — один проход за раз: события пачкой (администратор правит запись несколько раз) сливаются в ещё один проход после текущего;
// между проходами — не меньше KICK_GAP (Altegio принимает 5 запросов в секунду на всех). Память — экземпляра Worker, по хранилищу (kvKey):
// в другом экземпляре проход может совпасть — от двойной отправки защищают отметки rms: и D1 send_claims.
const KICK_GAP = 1500;
/** @type {WeakMap<object, Map<string, { run: Promise<number> | null, again: string, at: number }>>} */
const KICKS = new WeakMap();
/** прочитать журнал компании сейчас и отправить то, что пора: "fast" — изменённые записи, "full" — весь журнал (удаление записи)
 *  @param {Env} env @param {Client} c @param {"fast" | "full"} mode @returns {Promise<number>} сколько сообщений ушло */
export function jrKick(env, c, mode) {
  if (!jrOn(env, c) || isPreview(env)) return Promise.resolve(0);
  const store = /** @type {object} */ (kvKey(env.KV) || env);
  let m = KICKS.get(store);
  if (!m) { m = new Map(); KICKS.set(store, m); }
  const k = m.get(c.id) || { run: null, again: "", at: 0 };
  m.set(c.id, k);
  if (k.run) { if (k.again !== "full") k.again = mode; return k.run; } // идёт проход — после него ещё один
  const go = async () => {
    let want = /** @type {string} */ (mode), n = 0;
    while (want) {
      const wait = k.at + KICK_GAP - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      k.again = "";
      try { n += await jrClient(env, c, Date.now(), /** @type {"fast" | "full"} */ (want)); }
      catch (/** @type {any} */ e) { console.log("jr kick", c.id, String((e && e.message) || e).slice(0, 160)); }
      k.at = Date.now();
      want = k.again;
    }
    return n;
  };
  k.run = go().finally(() => { k.run = null; });
  return k.run;
}

/** @param {Env} env @param {Client} c @param {number} now @param {"" | "fast" | "full"} [force] проход по событию Altegio */
async function jrClient(env, c, now, force = "") {
  const user = altUserKey(env, c), loc = altLoc(env, c), route = gaRoute(env, c.id);
  if (!env.ALTEGIO_PARTNER || !user || !(loc > 0) || !route) return 0;
  const set = autoSettings(c, await autoLoad(env, c.id)), o = opts(c, set), logs = /** @type {any[]} */ ([]);
  o.site = await siteNotifyLoad(env.KV, c.id); // выбор «напомнить за …» из формы сайта
  let q = await jrqLoad(env, c.id), dirty = false;
  /** @type {Record<string, any> | null} */ let bk = null;
  let bkDirty = false;
  const last = await jrSyncAt(env, c.id);
  if (force === "full" || now - last >= SYNC_MS) {
    try { await jrSyncMark(env, c.id, now); } catch (e) { console.log("jr sync mark", String(e)); } // не записалась — прочитаем журнал ещё раз через минуту
    try {
      const r = await altRecordsRange(env, user, loc, isoDay(now - 86400e3), isoDay(now + AHEAD * 86400e3), WIN_PAGES);
      const ch = await jrChanges(env, await jrbLoad(env, c.id), r.list, !!r.cut, now, { user, loc });
      bk = ch.state; bkDirty = true;
      q = await jrMerge(env, c, o, q, r.list, now, logs, ch);
      // первое чтение журнала после включения (или после перерыва больше суток, jrs: живёт сутки): то, что должно было уйти
      // раньше, задним числом не шлём (ТЗ v3.0: включили сценарий — старые записи не получают сообщений разом)
      if (!last) q = q.filter(x => { if (x.at >= now - 60e3) return true; logs.push(entry(x, "skipped", "отправку только что включили: задним числом не шлём", now)); return false; });
      dirty = true;
      q = await withBonus(env, c, o, q, r.list, now, { user, loc, full: true }, logs);
    } catch (/** @type {any} */ e) { console.log("jr journal", c.id, String((e && e.message) || e).slice(0, 160)); }
  } else if (o.s01 || o.s06 || o.bi || o.bo) {
    // быстрый проход: только записи, которых ещё не видели или у которых сменилась версия. Ничего нового — ничего не пишем (KV)
    try {
      const r = await altRecordsChanged(env, user, loc, now - FAST_WIN, now + 86400e3);
      const prev = await jrbLoad(env, c.id);
      const fresh = r.list.filter(x => { const v = jrRec(x); return !!v && (!prev[v.id] || prev[v.id].v !== v.v); });
      if (fresh.length) {
        const ch = await jrChanges(env, prev, fresh, true, now, { user, loc }); // cut: остальных записей в ответе нет — не «удалены»
        bk = ch.state; bkDirty = true;
        q = await jrMerge(env, c, o, q, fresh, now, logs, ch);
        dirty = true;
      }
      const q0 = q.length;
      q = await withBonus(env, c, o, q, r.list, now, { user, loc, full: false }, logs); // оплата визита меняет запись — видим её здесь
      if (q.length !== q0) dirty = true;
    } catch (/** @type {any} */ e) { console.log("jr fast", c.id, String((e && e.message) || e).slice(0, 160)); }
  }
  const drop = new Set(), due = [];
  for (const x of q) {
    if (now - x.at > late(o, x.k, x.at)) {
      drop.add(key(x));
      logs.push(entry(x, "skipped", x.na ? "не ушло: текст не одобрен владельцем" : x.wa ? "в Altegio нет отметки «пришёл», об отзыве не просим" : "время отправки прошло", now));
    }
    else if (x.at <= now) due.push(x);
  }
  due.sort((a, b) => a.at - b.at);
  const hr = local(now).getUTCHours(), quiet = hr < o.from || hr >= o.to;
  let sent = 0;
  /** @type {[string, string][]} */ const told = [];
  if (due.length && !quiet && !(await jrHold(env, c.id))) {
    const day = isoDay(now), cnt0 = await jrCount(env, c.id, day);
    const st = { cnt: cnt0, cache: new Map(), logs, dirty: false, approvals: await svApprovals(env, c.id), variants: await svOwn(env, c), told, blocks: /** @type {Map<string, string> | null} */ (null) };
    for (const x of due) {
      if (sent >= PER_MIN) break;
      const r = await jrSend(env, c, o, x, now, { route, user, loc }, st);
      if (r === "sent") { sent++; drop.add(key(x)); }
      else if (r === "drop") drop.add(key(x));
      else if (r === "stop") break; // предел, пауза номера, временный отказ или база отметок не ответила — в следующую минуту
    }
    if (st.cnt !== cnt0) await jrCountSave(env, c.id, day, st.cnt);
    if (st.dirty) dirty = true;
  }
  if (drop.size) { q = q.filter(x => !drop.has(key(x))); dirty = true; }
  if (dirty) await jrqSave(env, c.id, q);
  // о записи уже писали: перенос и отмена этой записи — клиенту понятны (told)
  if (told.length) {
    try { bk = bk || await jrbLoad(env, c.id); for (const [rec, k] of told) if (bk[rec]) { bk[rec].sent = [...new Set([...(bk[rec].sent || []), k])]; bkDirty = true; } }
    catch (e) { console.log("jr state read", String(e)); }
  }
  if (bkDirty && bk) { try { await jrbSave(env, c.id, bk); } catch (e) { console.log("jr state save", String(e)); } }
  try { await jrLogAdd(env, c.id, logs); } catch (e) { console.log("jr log add", String(e)); }
  try { await autoCountAdd(env, c.id, isoDay(now), countsOf(logs)); } catch (e) { console.log("jr counts", String(e)); }
  return sent;
}
/** бонусы по прочитанным записям → в очередь (без повторов по ключу задачи). Сбой — только в журнал Worker: напоминания идут дальше
 *  @param {Env} env @param {Client} c @param {any} o @param {any[]} q @param {any[]} list @param {number} now @param {{ user: string, loc: number, full: boolean }} ctx @param {any[]} logs */
async function withBonus(env, c, o, q, list, now, ctx, logs) {
  if (!o.bi && !o.bo) return q;
  try {
    const add = await bonusScan(env, c, o, list.map(r => ({ r, v: jrRec(r) })), now, ctx, (x, st, why) => logs.push(entry(x, st, why, now)));
    if (!add.length) return q;
    const have = new Set(q.map(key));
    return q.concat(add.filter(x => !have.has(key(x)))).slice(-QUEUE_MAX);
  } catch (/** @type {any} */ e) { console.log("jr bonus", c.id, String((e && e.message) || e).slice(0, 160)); return q; }
}
/** решения → прибавка к счётчикам дня по сценариям (неявка — задача администратору, не сценарий) @param {any[]} logs */
function countsOf(logs) {
  /** @type {Record<string, Record<string, number>>} */ const add = {};
  const KEY = /** @type {Record<string, string>} */ ({ sent: "s", task: "f", unknown: "u", skipped: "k", cancelled: "c" });
  for (const x of logs) {
    const id = KIND_IDS[x.k], f = KEY[x.st];
    if (!id || !f) continue;
    add[id] = add[id] || {};
    add[id][f] = (add[id][f] || 0) + 1;
  }
  return add;
}

/**
 * Что изменилось в журнале с прошлого чтения (jrb:<клиент>): у записи другая версия — перенос; запись была в прочитанном окне, а теперь
 * её нет — ищем её в журнале на 60 дней: нашлась — перенос (далеко), нет — отмена. Журнал прочитан не весь (cut) или проверка не
 * удалась — пропавшие записи держим до следующего чтения: пустой или неполный ответ Altegio не должен давать «отменено».
 * @param {Env} env @param {Record<string, any>} prev @param {any[]} list @param {boolean} cut @param {number} now @param {{ user: string, loc: number }} ctx
 * @returns {Promise<{ state: Record<string, any>, moved: { p: any, v: any }[], cancelled: any[] }>}
 */
async function jrChanges(env, prev, list, cut, now, ctx) {
  /** @type {Record<string, any>} */ const state = {};
  const cur = new Map(), moved = [], cancelled = [], gone = [];
  const end = atLocal(isoDay(now + AHEAD * 86400e3), "23:59");
  /** @param {any} v @param {any} p */
  const row = (v, p) => ({ id: v.id, v: v.v, d: v.date, t: v.time, p: v.p, n: v.n, s: v.staff, sv: v.svc, ...(v.lk ? { lk: v.lk } : {}), mk: v.made || (p && p.mk) || 0, fs: (p && p.fs) || now, ls: now, sent: (p && Array.isArray(p.sent)) ? p.sent : [] });
  for (const r of list) {
    const v = jrRec(r);
    if (!v || v.att === -1 || atLocal(v.date, v.time) < now - 86400e3) continue;
    cur.set(v.id, v);
  }
  for (const [id, v] of cur) {
    const p = prev[id];
    if (p && p.v !== v.v) moved.push({ p: { ...p, id }, v });
    state[id] = row(v, p);
  }
  for (const [id, p] of Object.entries(prev)) {
    if (cur.has(id) || !p || typeof p !== "object") continue;
    const t = atLocal(String(p.d), String(p.t));
    if (!(t > now - 86400e3)) continue;               // прошла — забываем
    if (t <= now || t > end || cut) { state[id] = p; continue; } // идёт сейчас, вне окна или журнал прочитан не весь — не знаем, держим
    gone.push({ ...p, id });
  }
  if (gone.length) {
    /** @type {any} */ let wide = null;
    try { wide = await altRecordsRange(env, ctx.user, ctx.loc, isoDay(now), isoDay(now + WIDE_DAYS * 86400e3), 3); } catch (e) { console.log("jr wide", String(e).slice(0, 120)); }
    if (!wide || wide.cut) for (const p of gone) state[p.id] = p;
    else {
      const byId = new Map(wide.list.map(/** @param {any} r */ r => [String(r && r.id), r]));
      for (const p of gone) {
        const v = jrRec(byId.get(p.id));
        if (v && v.att !== -1) { state[p.id] = row(v, p); if (v.v !== p.v) moved.push({ p, v }); }
        else if (!byId.has(p.id)) cancelled.push(p);
      }
    }
  }
  return { state, moved, cancelled };
}

/** свежий журнал → очередь: записи из прочитанного журнала — по новому плану (перенесли — новые версии, старые задачи отменены
 *  с причиной; удалили — нет в плане); остальные — как были. Перенос и отмена — сообщения клиенту, если сценарий включён и клиент
 *  знал о записи. Неявка — задача администратору (S11).
 *  @param {Env} env @param {Client} c @param {any} o @param {any[]} q @param {any[]} list @param {number} now @param {any[]} logs
 *  @param {{ moved: { p: any, v: any }[], cancelled: any[] }} ch */
async function jrMerge(env, c, o, q, list, now, logs, ch) {
  const byId = new Map(list.map(r => [String(r && r.id), r])), plan = jrPlan(c, list, now, o.set, o.site).filter(x => x.at <= now + HORIZON);
  const pk = new Set(plan.map(key)), prk = new Map(plan.map(x => [x.rec + ":" + x.k, x]));
  const gone = new Set(ch.cancelled.map(p => String(p.id)));
  // запись прочитана сейчас. Которой нет в ответе, та остаётся в очереди как была: удалена ли она, решит свежее чтение журнала её дня
  // перед отправкой — пустой или неполный ответ журнала не должен отменять напоминания
  const known = (/** @type {any} */ x) => byId.has(x.rec);
  const keep = [];
  for (const x of q) {
    if (x.k !== "cx" && gone.has(x.rec)) { if (now - x.at <= late(o, x.k, x.at)) logs.push(entry(x, "cancelled", "запись удалена", now)); continue; }
    // отмена и бонусы не из плана журнала: ждут своей минуты (бонусы снова проверит отправка)
    if (x.k === "cx" || x.k === "bi" || x.k === "bo" || !known(x)) { if (now - x.at <= late(o, x.k, x.at)) keep.push(x); continue; }
    if (pk.has(key(x))) continue; // в новом плане то же самое
    const same = prk.get(x.rec + ":" + x.k);
    if (!x.v && same && same.date === x.date && same.time === x.time) continue; // очередь до версий записи — та же запись, тихо заменяем
    const r = byId.get(x.rec), v = jrRec(r);
    if (x.k === "s06" && v && v.v === x.v) { keep.push(x); continue; } // сообщение о переносе ждёт своей минуты
    if (now - x.at > late(o, x.k, x.at)) continue;
    const why = r.deleted ? "запись удалена" : !v ? "у записи нет клиента или номера"
      : v.att === -1 ? "клиент не пришёл" : v.att === 1 && x.k !== "rv" ? "клиент уже пришёл"
      : (x.v && v.v !== x.v) || v.date !== x.date || v.time !== x.time ? "запись перенесена"
      : !o[x.k] ? "сценарий выключен" : "уже не нужно";
    logs.push(entry(x, "cancelled", why, now));
  }
  const out = keep.concat(plan);
  for (const { p, v } of ch.moved) { // перенос: отдельное сообщение с новым временем — только если владелец включил сценарий
    if (!o.s06) continue;
    const x = { ...fromState(p), k: "s06" };
    if (v.att === 1 || atLocal(v.date, v.time) - now < 3600e3) continue;
    if (now - +p.ls > FRESH_MS) { logs.push(entry(x, "skipped", "перенос замечен поздно (журнал долго не читали): не пишем задним числом", now)); continue; }
    if (!told(p, now)) { logs.push(entry(x, "skipped", "запись изменили сразу после создания: клиент узнает новое время из подтверждения", now)); continue; }
    if (out.some(y => y.k === "s01" && y.rec === v.id)) { logs.push(entry(x, "skipped", "подтверждение с новым временем ещё не ушло: о переносе отдельно не пишем", now)); continue; }
    // замечен после часов отправки — утром (ТЗ v4: ночные переносы пропадали, «время отправки прошло»)
    out.push({ rec: v.id, v: v.v, p: v.p, n: v.n, date: v.date, time: v.time, staff: v.staff, svc: v.svc, ...(v.lk ? { lk: v.lk } : {}), k: "s06", at: sendAt(o, now) });
  }
  for (const p of ch.cancelled) { // отмена будущей записи: сообщение — только если владелец включил сценарий и клиент знал о записи
    if (!o.cx) continue;
    const x = { ...fromState(p), k: "cx" };
    if (atLocal(String(p.d), String(p.t)) <= now) continue;
    if (now - +p.ls > FRESH_MS) { logs.push(entry(x, "skipped", "отмена замечена поздно (журнал долго не читали): не пишем задним числом", now)); continue; }
    if (!told(p, now)) { logs.push(entry(x, "skipped", "запись удалили сразу после создания (ошибка администратора): клиенту не пишем", now)); continue; }
    out.push({ ...x, at: sendAt(o, now) }); // ночью — утром
  }
  if (o.noshow !== false) { // S11: «не пришёл» — только задача администратору в чате, клиенту ничего не пишем
    for (const r of list) {
      const v = jrRec(r);
      if (!v || v.att !== -1 || atLocal(v.date, v.time) > now) continue;
      try {
        if (!(await jrNoShowMark(env, c.id, v.id))) continue;
        await logTurns(env.KV, `h:ga:${c.id}:${v.p}`, [], /** @param {any} p */ p => { if (!p.stop) p.need = { at: now, why: "noshow" }; if (!p.waName && v.n) p.waName = v.n; });
        logs.push(entry({ ...v, rec: v.id, k: "noshow" }, "task", "клиент не пришёл, задача администратору", now));
      } catch (e) { console.log("jr noshow", String(e)); }
    }
  }
  const seen = new Set();
  return out.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }).slice(-QUEUE_MAX);
}

/** данные задачи очереди → данные текста: запись, ссылка Altegio на неё, бонусы @param {any} x */
const msgOf = x => ({ name: x.n, date: x.date, time: x.time, services: x.svc, staffName: x.staff, link: x.lk || "",
  ...(x.am !== undefined ? { amount: x.am } : {}), ...(x.bal !== undefined ? { balance: x.bal } : {}) });
/** благодарность этому номеру уже уходила за последние rvgap дней (0 — после каждого визита) @param {Env} env @param {string} cid @param {string} p @param {any} o @param {number} now */
async function reviewedRecently(env, cid, p, o, now) {
  if (!(o.rvgap > 0)) return false;
  const at = await jrReviewedAt(env, cid, p);
  return !!at && now - at < o.rvgap * 86400e3;
}

/** одно сообщение → "sent" | "drop" (не шлём и не будем) | "wait" (отзыв: ждём «пришёл»; текст ждёт одобрения) | "stop" (в эту минуту
 *  больше не шлём). Решение — в st.logs. @param {Env} env @param {Client} c @param {any} o @param {any} x @param {number} now
 *  @param {{ route: any, user: string, loc: number }} ctx
 *  @param {{ cnt: number, cache: Map<string, any[]>, logs: any[], dirty: boolean, approvals: Record<string, any>, variants: Record<string, any>, told: [string, string][], blocks: Map<string, string> | null }} st */
async function jrSend(env, c, o, x, now, ctx, st) {
  const skip = (/** @type {string} */ why) => { st.logs.push(entry(x, "skipped", why, now)); return "drop"; };
  // выключатель сценария (раздел «Автоматические сообщения»): выключили — то, что стояло в очереди, не уходит; включили позже, чем
  // сообщение должно было уйти, — тоже не уходит (задним числом не шлём)
  const sid = KIND_IDS[x.k], son = o.set && sid ? o.set.s[sid] : null;
  if (o.set && son && !son.on) return skip("сценарий выключен");
  if (son && son.at > x.at) return skip("сценарий включили позже, чем должно было уйти это сообщение");
  if (await optedOut(env, c.id, x.p)) return skip("клиент просил не писать");
  if (!st.blocks) {
    // «стоп» и запреты базы контактов D1. База у адреса есть, но не ответила — не шлём в эту минуту (закрыто при сомнении: полный
    // запрет владельца есть только в D1, не в KV); базы у адреса нет — только «стоп» из KV, как раньше
    const g = await marketingGate(env, c, now).catch(() => null);
    if (env.DB && (!g || !g.ready)) {
      if (!x.db) { x.db = 1; st.dirty = true; st.logs.push(entry(x, "skipped", "не ушло: база клиентов не ответила (проверка «стопа» и запретов), пробуем ещё раз", now)); }
      return "stop";
    }
    st.blocks = (g && g.reasons) || new Map();
  }
  if (SVC_NO.has(st.blocks.get(x.p) || "")) return skip("в базе клиентов — «стоп» или запрет писать");
  if (x.k === "rv" && await reviewedRecently(env, c.id, x.p, o, now)) return skip(`благодарность с просьбой об отзыве этому клиенту уже отправляли (не чаще раза в ${o.rvgap} дн.)`);
  // текст — действующий вариант, одобренный владельцем (ТЗ v3.0: у сценария может быть несколько вариантов текста)
  const sc = scenario(KIND_SC[x.k] || ""), vt = sc && approvedVariant(sc, st.approvals, st.variants), ap = sc && st.approvals[sc.id];
  if (!sc || !vt) { // текст не одобрен: ждём одобрения, пока не опоздали; в журнал — один раз
    if (!x.na) { x.na = 1; st.dirty = true; st.logs.push(entry(x, "skipped", "текст не одобрен владельцем, ждёт одобрения", now)); }
    return "wait";
  }
  // задним числом не шлём: одобрили (или включили) сценарий позже, чем это сообщение должно было уйти, — оно не уходит
  if (+ap.at > x.at) return skip("текст одобрен позже, чем должно было уйти это сообщение");
  let list = st.cache.get(x.date);
  if (!list) {
    try { list = (await altRecordsRange(env, ctx.user, ctx.loc, x.date, x.date, WIN_PAGES)).list; }
    catch (/** @type {any} */ e) { console.log("jr recheck", c.id, String((e && e.message) || e).slice(0, 160)); return "stop"; }
    st.cache.set(x.date, list);
  }
  const r = list.find(/** @param {any} v */ v => String(v && v.id) === x.rec), v = r && jrRec(r);
  if (x.k === "cx") { // отмена: запись так и не вернулась в журнал её дня
    if (r && !(r.deleted === true || r.deleted === 1)) return skip("запись снова есть в Altegio: отменять не о чем");
    if (atLocal(x.date, x.time) <= now) return skip("время записи прошло");
  } else {
    if (!r) return skip("запись удалена из журнала или перенесена на другой день");
    if (!v) return skip("запись удалена");
    if (v.att === -1) return skip("клиент не пришёл");
    if (v.date !== x.date || v.time !== x.time || (x.v && v.v !== x.v)) return skip("запись перенесена");
    if (v.p !== x.p) return skip("в записи другой номер");
    const after = x.k === "rv" || x.k === "bi" || x.k === "bo"; // после визита: «пришёл» и прошедшее время — не повод не слать
    if (x.k === "rv" && v.att !== 1) { if (!x.wa) { x.wa = 1; st.dirty = true; } return "wait"; }
    if (!after && v.att === 1) return skip("клиент уже пришёл");
    if (!after && atLocal(x.date, x.time) <= now) return skip("время записи прошло");
  }
  const hk = `h:ga:${c.id}:${x.p}`;
  /** @type {any} */ let p = {};
  try { const h = await readHist(env, hk); p = (h && h.profile) || {}; } catch (e) { console.log("jr chat read", String(e)); }
  // запись сделал бот в этой переписке — подтверждение клиент уже получил там (S01, S06)
  if ((x.k === "s01" || x.k === "s06") && (p.bookings || []).some(/** @param {any} b */ b => String(b && b.record_id) === x.rec)) return skip("подтверждение уже в переписке (запись через бота)");
  if (st.cnt >= o.cap) {
    try { if (await jrCapNote(env, c.id, isoDay(now))) await notify(env, `⚠️ ${c.name}: предел ${o.cap} сообщений в сутки со второго номера. Остальные напоминания сегодня не отправлены.`, c.id); }
    catch (e) { console.log("jr cap note", String(e)); }
    return "stop";
  }
  const t = svText(c, x.k, msgOf(x), p.lang, vt);
  if (!t || !t.text) return skip("нет текста сообщения");
  const ver = x.tx || x.v || "1"; // бонусы: одна операция — одно сообщение
  if (!(await jrTry(env, c.id, x.rec, x.k, ver))) return skip("уже отправляли");
  /** @type {Record<string, any>} */ let res = { ok: false, status: 0, code: "ga:net", error: "не отправляли" };
  // атомарная отметка в D1 (если у адреса есть база): одна запись, вид и версия — одно сообщение, даже если две фоновые задачи
  // одновременно взяли одно и то же (отметка rms: в KV согласуется не сразу). Нет базы у адреса — только отметка в KV, как раньше
  const once = await sendOnceAuto(env, c.id, x.p, `a-${x.k}-${x.rec}-${ver}`, async () => {
    try { res = await sendGreen(env, x.p + "@c.us", t.text, ctx.route, true); } catch (e) { res = { ok: false, status: 0, code: "ga:net", error: String(e) }; }
    return res.ok ? { ok: true, ...(res.id ? { id: String(res.id) } : {}) } : gaKind(res.code) === "net" ? { ok: true, unknown: true, ...(res.id ? { id: String(res.id) } : {}) } : { ok: false };
  });
  if (once && "blocked" in once) {
    await jrUntry(env, c.id, x.rec, x.k, ver);
    if (!x.db) { x.db = 1; st.dirty = true; st.logs.push(entry(x, "skipped", "не ушло: база отметок от двойной отправки не ответила, пробуем ещё раз", now)); }
    return "stop";
  }
  if (once && "dup" in once) return skip(once.dup === "busy" ? "уже отправляется" : "уже отправляли (отметка в базе)");
  if (!res.ok) {
    const kind = gaKind(res.code), why = gaWhy(res, ctx.route);
    console.log("jr send", c.id, x.k, res.code);
    if (kind === "stop") {
      await jrUntry(env, c.id, x.rec, x.k, ver);
      await jrHoldSet(env, c.id, why, now);
      await notify(env, `⛔ ${c.name}: напоминания со второго номера остановлены на 6 часов.\nGreen-API: ${why}\nПроверьте, не заблокирован ли номер.`, c.id);
      return "stop";
    }
    if (kind === "net") {
      // ответа нет, обрыв, срок или сбой у Green-API (5xx): сообщение могло уйти — второй раз не шлём (отметка попытки rms: остаётся,
      // задача из очереди уходит). В переписке — «неизвестно» с причиной (номер сообщения, если Green-API его вернул: отчёт о доставке
      // уточнит статус). В «ушло» (rmok:) не считается, в дневной предел — считается; отзыв — как просили (раз в 60 дней). Раньше 5xx
      // был «временным сбоем», и через минуту напоминание уходило ещё раз (01.11.2026, перед приёмкой Winchester)
      const note = gaUnsureNote(res);
      st.cnt++;
      st.told.push([x.rec, x.k]);
      if (x.k === "rv") { try { await jrReviewMark(env, c.id, x.p, now); } catch (e) { console.log("jr review mark", String(e)); } }
      await turn(env, hk, x, { role: "model", text: t.text, t: now, rm: x.k, ...(res.id ? { mid: String(res.id).slice(0, 80) } : {}), st: "unknown", se: note });
      st.logs.push(entry(x, "unknown", `${note}. Второй раз не шлём — проверьте переписку`, now));
      return "drop";
    }
    if (kind === "temp") {
      await jrUntry(env, c.id, x.rec, x.k, ver);
      x.tries = (x.tries || 0) + 1; st.dirty = true;
      if (x.tries < MAX_TRIES) return "stop"; // в следующую минуту ещё раз
    }
    // номера нет в WhatsApp, текст не принят, три временных отказа подряд — задача администратору (S18), без новых попыток
    await adminTask(env, c, x, now, { role: "model", text: t.text, t: now, rm: x.k, st: "failed", se: stErr("failed", why) }, why);
    st.logs.push(entry(x, "task", `не ушло (${why}), задача администратору`, now));
    return "drop";
  }
  st.cnt++;
  st.told.push([x.rec, x.k]);
  try { await rmOk(env, c.id, x.rec, x.k); } catch (e) { console.log("jr ok mark", String(e)); }
  if (x.k === "rv") { try { await jrReviewMark(env, c.id, x.p, now); } catch (e) { console.log("jr review mark", String(e)); } }
  await turn(env, hk, x, { role: "model", text: t.text, t: now, rm: x.k, ...(res.id ? { mid: String(res.id).slice(0, 80) } : {}), st: "sent" });
  st.logs.push(entry(x, "sent", KIND_WORD[x.k] || "", now));
  return "sent";
}
/**
 * Одна отправка на ключ: у адреса есть база D1 — атомарная отметка send_claims (как у отправки из пульта, services/inbox/send.js);
 * нет базы — просто отправка (отметка попытки в KV уже стоит). → результат fn, { dup } или { blocked }.
 * @template {{ ok: boolean, id?: string, unknown?: boolean }} R
 * @param {Env} env @param {string} cid @param {string} p @param {string} rid @param {() => Promise<R>} fn
 */
export async function sendOnceAuto(env, cid, p, rid, fn) {
  if (!env.DB) return fn();
  return sendOnce(env, cid, "ga", p, rid.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64), fn);
}
/** сообщение в переписку (его видит администратор в пульте) @param {Env} env @param {string} hk @param {any} x @param {any} tr */
async function turn(env, hk, x, tr) {
  try { await logTurns(env.KV, hk, [tr], /** @param {any} p */ p => { if (!p.waName && x.n) p.waName = x.n; }); } catch (e) { console.log("jr log", String(e)); }
}
/** не ушло: чат — в «Нужен ответ» (ответ не дошёл), Telegram — один раз на сообщение @param {Env} env @param {Client} c @param {any} x
 *  @param {number} now @param {any} tr @param {string} why */
async function adminTask(env, c, x, now, tr, why) {
  try { await logTurns(env.KV, `h:ga:${c.id}:${x.p}`, [tr], /** @param {any} p */ p => { if (!p.stop) p.need = { at: now, why: "send" }; if (!p.waName && x.n) p.waName = x.n; }); }
  catch (e) { console.log("jr task", String(e)); }
  try { await notifyOnce(env, `jrfail:${c.id}:${x.rec}:${x.k}`, `⚠️ ${c.name}: со второго номера не ушло сообщение (${KIND_WORD[x.k] || "сообщение"}), клиент ${maskPhone(x.p)}${firstName(x.n) ? " (" + firstName(x.n) + ")" : ""}.\nПричина: ${why}.\nЧат — в пульте, «Нужен ответ»: напишите или позвоните клиенту.`, c.id); }
  catch (e) { console.log("jr task note", String(e)); }
}

/** Проверка по настоящему журналу без отправки (кнопка владельца): журнал на вчера, сегодня и завтра, план по включённым сценариям и
 *  проверки перед отправкой — только чтение; в KV и D1 ничего не пишется, имена — первое слово, номера — маской (правило владельца:
 *  настоящие персональные данные в черновике не храним). @param {Env} env @param {Client} c @param {number} now */
export async function jrDry(env, c, now) {
  if (!c.jr) return { ok: false, why: "У компании нет напоминаний по журналу Altegio." };
  const user = altUserKey(env, c), loc = altLoc(env, c);
  if (!env.ALTEGIO_PARTNER || !(loc > 0)) return { ok: false, why: "Не подключён Altegio: нет ключа разработчика или номера локации." };
  if (!user) return { ok: false, why: "Не подключён журнал Altegio: нужен ключ журнала (страница /altegio/user)." };
  const from = isoDay(now - 86400e3), to = isoDay(now + 86400e3);
  const { list, pages, cut } = await altRecordsRange(env, user, loc, from, to, 3);
  const set = autoSettings(c, await autoLoad(env, c.id)), o = opts(c, set);
  const { items, skipped } = jrPlanAll(c, list, now, set, await siteNotifyLoad(env.KV, c.id)), ap = await svApprovals(env, c.id), own = await svOwn(env, c), byId = new Map(list.map(r => [String(r && r.id), r]));
  const hr = local(now).getUTCHours(), quiet = hr < o.from || hr >= o.to;
  /** @type {Map<string, any>} */ const prof = new Map();
  const out = [];
  for (const x of items.sort((a, b) => a.at - b.at).slice(0, 200)) {
    const sc = scenario(KIND_SC[x.k] || ""), v = jrRec(byId.get(x.rec)), a = sc && ap[sc.id], vt = sc && approvedVariant(sc, ap, own);
    if (!prof.has(x.p)) { try { const h = await readHist(env, `h:ga:${c.id}:${x.p}`); prof.set(x.p, (h && h.profile) || {}); } catch (e) { prof.set(x.p, {}); } }
    const p = prof.get(x.p);
    let why = "", status = "";
    if (await optedOut(env, c.id, x.p)) why = "клиент просил не писать";
    else if (x.k === "rv" && await reviewedRecently(env, c.id, x.p, o, now)) why = `благодарность этому клиенту уже отправляли (не чаще раза в ${o.rvgap} дн.)`;
    else if (!sc || !vt) why = "текст не одобрен владельцем";
    else if (a && +a.at > x.at) why = "текст одобрен позже, чем должно было уйти это сообщение";
    else if ((x.k === "s01" || x.k === "s06") && (p.bookings || []).some(/** @param {any} b */ b => String(b && b.record_id) === x.rec)) why = "подтверждение уже в переписке (запись через бота)";
    else if (await jrTried(env, c.id, x.rec, x.k, x.v)) why = "уже отправляли";
    if (why) status = "skip";
    else if (x.k === "rv" && (!v || v.att !== 1)) { status = "wait"; why = "ждёт отметки «пришёл» в Altegio"; }
    else if (x.at > now) status = "later";
    else if (quiet) { status = "later"; why = `уйдёт в часы отправки (с ${o.from}:00 до ${o.to}:00)`; }
    else status = "now";
    const t = svText(c, x.k, msgOf(x), p.lang, vt || (sc && activeOf(sc, own))); // не одобрен — показываем действующий вариант
    out.push({ k: x.k, sc: sc ? sc.id : "", at: x.at, name: firstName(x.n), phone: maskPhone(x.p), date: x.date, time: x.time, staff: x.staff, svc: x.svc,
      status, why, text: t ? t.text : "", lang: t ? t.lang : "ru" });
  }
  /** @type {Record<string, number>} */ const why = {};
  for (const s of skipped) why[s.why] = (why[s.why] || 0) + 1;
  return { ok: true, at: now, from, to, records: list.length, pages, cut, enabled: jrOn(env, c), ga: !!gaRoute(env, c.id), hold: await jrHold(env, c.id), quiet,
    items: out, total: items.length, skipped: Object.entries(why).map(([w, n]) => ({ why: w, n })) };
}
