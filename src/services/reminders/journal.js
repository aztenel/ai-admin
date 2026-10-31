// @ts-check
// Напоминания о записи и просьба об отзыве по журналу Altegio со второго номера (Green-API), без бота (30.10.2026, решение владельца:
// второй номер Winchester — только исходящие сообщения с 10:00 до 21:00). remindPlan (plan.js) знает только записи, которые бот сделал
// в чате; здесь — все записи журнала: администратор, сайт, онлайн-запись. Настройки — c.jr = { from, to, eve, h2, rv, cap, s01, s06, noshow }.
// Раз в 15 минут — журнал на вчера, сегодня и завтра → очередь jrq:<клиент> (db/kv/reminders.js). Перед отправкой запись перечитывается
// (журнал её дня): удалена, перенесена, «не пришёл», уже пришёл — напоминание не уходит; отзыв — только с отметкой «пришёл» (attendance 1).
// ТЗ v2.0 §4 (31.10.2026): у записи — версия (время, мастер, услуги): перенос с тем же номером записи отменяет старые напоминания и даёт
// новые; текст — из каталога (templates.js) и только одобренный владельцем; язык — как у чата; неявка и сбой отправки — задача
// администратору в чате (need) и Telegram; jrDry — проверка по настоящему журналу без отправки и без записи.
// Чтением журнала 30.10.2026 проверено: «пришёл» администраторы ставят, create_date есть у всех записей.
/** @import { Env, Client } from "../../lib/types.js" */
import { CLIENTS } from "../../config/builtin-clients.js";
import { REMIND_LATE } from "../../config/constants.js";
import { TZ, local, isoDay } from "../../lib/time.js";
import { normPhone, maskPhone } from "../../lib/phone.js";
import { hash } from "../../lib/crypto.js";
import { altText } from "../integrations/altegio/client.js";
import { altRecordsRange } from "../integrations/altegio/records-api.js";
import { gaRoute } from "../integrations/greenapi/webhook.js";
import { gaKind, gaWhy } from "../integrations/greenapi/client.js";
import { notify } from "../integrations/telegram/client.js";
import { notifyOnce } from "../notifications/telegram.js";
import { sendGreen } from "../channels/greenapi.js";
import { altUserKey } from "../booking/journal.js";
import { altLoc } from "../booking/book.js";
import { stErr } from "../inbox/status.js";
import { logTurns, readHist } from "../../db/kv/chats.js";
import { jrqLoad, jrqSave, jrSyncAt, jrSyncMark, jrCount, jrCountSave, jrCapNote, jrHold, jrHoldSet, jrReviewed, jrReviewMark, optedOut, rmOk,
  jrTried, jrTry, jrUntry, jrLogAdd, jrNoShowMark, svApprovals } from "../../db/kv/reminders.js";
import { atLocal } from "./plan.js";
import { KIND_SC, scenario, svText, firstName } from "./templates.js";

const SYNC_MS = 15 * 60e3;   // журнал — не чаще раза в 15 минут: у Altegio предел 5 запросов в секунду на всех
const PAGES = 3;             // 3 дня одной локации — одна страница (200 записей), больше трёх не читаем
const PER_MIN = 2;           // сообщений в минуту со второго номера: неофициальный номер, частые сообщения подряд — повод для блокировки
const H2_LATE = 45 * 60e3;   // «за 2 часа» позже чем через 45 минут уже не к месту
const QUEUE_MAX = 600;
const NEW_LATE = 3 * 3600e3; // подтверждение новой записи и переноса — не позже чем через 3 часа (позже — уже не к месту)
const MAX_TRIES = 3;         // временный отказ Green-API (429, 5xx): столько попыток, дальше — задача администратору (S18)
const NEW_GAP = 5 * 60e3;    // подтверждение — через 5 минут после записи: администратор успевает поправить опечатку

/** @param {Client} c */
const opts = c => ({ from: 10, to: 21, eve: "18:00", h2: true, rv: true, cap: 150, s01: false, s06: false, noshow: true, ...(c.jr || {}) });
/** до какого опоздания ещё шлём: накануне — до конца часов отправки, за 2 часа — 45 минут, отзыв — 3 часа, подтверждения — 3 часа
 *  @param {any} o @param {string} k @param {number} at */
function late(o, k, at) {
  if (k === "h2") return H2_LATE;
  if (k === "rv") return REMIND_LATE;
  if (k === "s01" || k === "s06") return NEW_LATE;
  const L = local(at), end = Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate(), o.to - TZ, 0);
  return Math.max(0, end - at);
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
  return { id: String(r.id), date, time, p, att, v: recVer(r), made: Date.parse(String(r.create_date || "")) || 0, n: altText(r.client.name || "", 60),
    staff: altText((r.staff && r.staff.name) || "", 40),
    svc: (Array.isArray(r.services) ? r.services : []).map(/** @param {any} s */ s => altText(s && s.title, 60)).filter(Boolean).join(", ") };
}

/** что и когда отправить по этим записям (чистая функция). Накануне — в eve, если запись сделана раньше чем за час до этого;
 *  за 2 часа — только если это время в часах отправки и запись сделана раньше чем за 4 часа; отзыв — через 3 часа после начала,
 *  вне часов отправки — утром (from + 1); подтверждение новой записи (S01, если включено) — через 5 минут после записи, в часы
 *  отправки и не меньше чем за час до визита. Уже прошедшее и опоздавшее больше допустимого — не планируем.
 *  @param {Client} c @param {any[]} records @param {number} now */
export const jrPlan = (c, records, now) => jrPlanAll(c, records, now).items;

/** то же и почему по записям ничего не будет @param {Client} c @param {any[]} records @param {number} now */
export function jrPlanAll(c, records, now) {
  const o = opts(c), out = /** @type {any[]} */ ([]), skipped = /** @type {any[]} */ ([]);
  for (const r of records) {
    const why = recWhy(r), v = why ? null : jrRec(r);
    if (!v) { skipped.push({ rec: String((r && r.id) ?? ""), why }); continue; }
    if (v.att === -1) { skipped.push({ rec: v.id, why: "клиент не пришёл" }); continue; }
    const t = atLocal(v.date, v.time), base = { rec: v.id, v: v.v, p: v.p, n: v.n, date: v.date, time: v.time, staff: v.staff, svc: v.svc };
    const add = (/** @type {string} */ k, /** @type {number} */ at) => { if (now - at <= late(o, k, at)) out.push({ ...base, k, at }); };
    if (o.s01 && v.made && v.att !== 1) {
      let s1 = v.made + NEW_GAP;
      const L = local(s1), lh = L.getUTCHours();
      if (lh < o.from || lh >= o.to) s1 = Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate() + (lh >= o.to ? 1 : 0), o.from - TZ, 0);
      if (t - s1 >= 3600e3) add("s01", s1);
    }
    if (o.eve && v.att !== 1) {
      const eve = atLocal(v.date, o.eve, -1);
      if (t - eve >= 12 * 3600e3 && !(v.made && v.made > eve - 3600e3)) add("d1", eve);
    }
    if (o.h2 && v.att !== 1) {
      const h2 = t - 2 * 3600e3, hr = local(h2).getUTCHours();
      if (hr >= o.from && hr < o.to && !(v.made && t - v.made < 4 * 3600e3)) add("h2", h2);
    }
    if (o.rv && c.review) {
      let rv = t + 3 * 3600e3;
      const L = local(rv), lh = L.getUTCHours();
      if (lh >= o.to || lh < o.from) rv = Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate() + (lh >= o.to ? 1 : 0), o.from + 1 - TZ, 0);
      add("rv", rv);
    }
  }
  return { items: out, skipped };
}

/** @param {any} x */
const key = x => x.rec + ":" + x.k + ":" + (x.v || "");
/** запись решения для журнала очереди (вкладка «Сервисные») @param {any} x @param {string} st @param {string} why @param {number} now */
const entry = (x, st, why, now) => ({ t: now, k: x.k, rec: x.rec, p: x.p, n: x.n || "", date: x.date, time: x.time, st, why });
/** @type {Record<string, string>} */
const KIND_WORD = { s01: "подтверждение записи", s06: "сообщение о переносе", d1: "напоминание накануне", h2: "напоминание за 2 часа", rv: "просьба об отзыве" };

/** включены ли напоминания по журналу: c.jr и Text REMIND_GA_<ID> = 1. По умолчанию выключены — это сообщения настоящим клиентам
 *  с неофициального номера: включает владелец после «отправляй» заказчика и одобренных текстов (30.10.2026, перед выкладкой: на боевом
 *  сервере могли уже стоять номер Green-API и ключ журнала — напоминания ушли бы в тот же вечер)
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

/** @param {Env} env @param {Client} c @param {number} now */
async function jrClient(env, c, now) {
  const user = altUserKey(env, c), loc = altLoc(env, c), route = gaRoute(env, c.id);
  if (!env.ALTEGIO_PARTNER || !user || !(loc > 0) || !route) return 0;
  const o = opts(c), logs = /** @type {any[]} */ ([]);
  let q = await jrqLoad(env, c.id), dirty = false;
  if (now - (await jrSyncAt(env, c.id)) >= SYNC_MS) {
    try { await jrSyncMark(env, c.id, now); } catch (e) { console.log("jr sync mark", String(e)); } // не записалась — прочитаем журнал ещё раз через минуту
    try {
      const { list } = await altRecordsRange(env, user, loc, isoDay(now - 86400e3), isoDay(now + 86400e3), PAGES);
      q = await jrMerge(env, c, o, q, list, now, logs);
      dirty = true;
    } catch (/** @type {any} */ e) { console.log("jr journal", c.id, String((e && e.message) || e).slice(0, 160)); }
  }
  const drop = new Set(), due = [];
  for (const x of q) {
    if (now - x.at > late(o, x.k, x.at)) {
      drop.add(key(x));
      logs.push(entry(x, "skipped", x.na ? "не ушло: текст не одобрен владельцем" : x.wa ? "в Altegio нет отметки «пришёл» — об отзыве не просим" : "время отправки прошло", now));
    }
    else if (x.at <= now) due.push(x);
  }
  due.sort((a, b) => a.at - b.at);
  const hr = local(now).getUTCHours(), quiet = hr < o.from || hr >= o.to;
  let sent = 0;
  if (due.length && !quiet && !(await jrHold(env, c.id))) {
    const day = isoDay(now), cnt0 = await jrCount(env, c.id, day), st = { cnt: cnt0, cache: new Map(), logs, dirty: false, approvals: await svApprovals(env, c.id) };
    for (const x of due) {
      if (sent >= PER_MIN) break;
      const r = await jrSend(env, c, o, x, now, { route, user, loc }, st);
      if (r === "sent") { sent++; drop.add(key(x)); }
      else if (r === "drop") drop.add(key(x));
      else if (r === "stop") break; // предел, пауза номера или временный отказ — в следующую минуту
    }
    if (st.cnt !== cnt0) await jrCountSave(env, c.id, day, st.cnt);
    if (st.dirty) dirty = true;
  }
  if (drop.size) { q = q.filter(x => !drop.has(key(x))); dirty = true; }
  if (dirty) await jrqSave(env, c.id, q);
  try { await jrLogAdd(env, c.id, logs); } catch (e) { console.log("jr log add", String(e)); }
  return sent;
}

/** свежий журнал → очередь: записи из прочитанного журнала — по новому плану (перенесли — новые версии, старые задачи отменены
 *  с причиной; удалили — нет в плане); остальные — как были. Неявка — задача администратору (S11).
 *  @param {Env} env @param {Client} c @param {any} o @param {any[]} q @param {any[]} list @param {number} now @param {any[]} logs */
async function jrMerge(env, c, o, q, list, now, logs) {
  const byId = new Map(list.map(r => [String(r && r.id), r])), plan = jrPlan(c, list, now);
  const pk = new Set(plan.map(key)), prk = new Map(plan.map(x => [x.rec + ":" + x.k, x]));
  // запись прочитана сейчас. Которой нет в ответе, та остаётся в очереди как была: удалена ли она, решит свежее чтение журнала её дня
  // перед отправкой — пустой или неполный ответ журнала не должен отменять напоминания
  const known = (/** @type {any} */ x) => byId.has(x.rec);
  const keep = [], moved = new Set();
  for (const x of q) {
    if (!known(x)) { if (now - x.at <= late(o, x.k, x.at)) keep.push(x); continue; }
    if (pk.has(key(x))) continue; // в новом плане то же самое
    const same = prk.get(x.rec + ":" + x.k);
    if (!x.v && same && same.date === x.date && same.time === x.time) continue; // очередь до версий записи — та же запись, тихо заменяем
    const r = byId.get(x.rec), v = jrRec(r);
    if (x.k === "s06" && v && v.v === x.v) { keep.push(x); continue; } // сообщение о переносе ждёт своей минуты
    if (now - x.at > late(o, x.k, x.at)) continue;
    const why = r.deleted ? "запись удалена" : !v ? "у записи нет клиента или номера"
      : v.att === -1 ? "клиент не пришёл" : v.att === 1 && x.k !== "rv" ? "клиент уже пришёл"
      : (x.v && v.v !== x.v) || v.date !== x.date || v.time !== x.time ? "запись перенесена" : "уже не нужно";
    if (why === "запись перенесена") moved.add(x.rec);
    logs.push(entry(x, "cancelled", why, now));
  }
  const out = keep.concat(plan);
  if (o.s06) for (const rec of moved) { // S06: отдельное сообщение «перенесли» — только если владелец включил и одобрил текст
    const v = jrRec(byId.get(rec));
    if (v && v.att !== 1 && atLocal(v.date, v.time) - now >= 3600e3) out.push({ rec: v.id, v: v.v, p: v.p, n: v.n, date: v.date, time: v.time, staff: v.staff, svc: v.svc, k: "s06", at: now });
  }
  if (o.noshow !== false) { // S11: «не пришёл» — только задача администратору в чате, клиенту ничего не пишем
    for (const r of list) {
      const v = jrRec(r);
      if (!v || v.att !== -1 || atLocal(v.date, v.time) > now) continue;
      try {
        if (!(await jrNoShowMark(env, c.id, v.id))) continue;
        await logTurns(env.KV, `h:ga:${c.id}:${v.p}`, [], /** @param {any} p */ p => { if (!p.stop) p.need = { at: now, why: "noshow" }; if (!p.waName && v.n) p.waName = v.n; });
        logs.push(entry({ ...v, rec: v.id, k: "noshow" }, "task", "клиент не пришёл — задача администратору", now));
      } catch (e) { console.log("jr noshow", String(e)); }
    }
  }
  return out.slice(-QUEUE_MAX);
}

/** одно сообщение → "sent" | "drop" (не шлём и не будем) | "wait" (отзыв: ждём «пришёл»; текст ждёт одобрения) | "stop" (в эту минуту
 *  больше не шлём). Решение — в st.logs. @param {Env} env @param {Client} c @param {any} o @param {any} x @param {number} now
 *  @param {{ route: any, user: string, loc: number }} ctx @param {{ cnt: number, cache: Map<string, any[]>, logs: any[], dirty: boolean, approvals: Record<string, any> }} st */
async function jrSend(env, c, o, x, now, ctx, st) {
  const skip = (/** @type {string} */ why) => { st.logs.push(entry(x, "skipped", why, now)); return "drop"; };
  if (await optedOut(env, c.id, x.p)) return skip("клиент просил не писать");
  if (x.k === "rv" && await jrReviewed(env, c.id, x.p)) return skip("отзыв у этого клиента уже просили (раз в 60 дней)");
  const sc = scenario(KIND_SC[x.k] || ""), ap = sc && st.approvals[sc.id];
  if (!sc || !ap || +ap.v !== sc.v) { // текст не одобрен: ждём одобрения, пока не опоздали; в журнал — один раз
    if (!x.na) { x.na = 1; st.dirty = true; st.logs.push(entry(x, "skipped", "текст не одобрен владельцем — ждёт одобрения", now)); }
    return "wait";
  }
  let list = st.cache.get(x.date);
  if (!list) {
    try { list = (await altRecordsRange(env, ctx.user, ctx.loc, x.date, x.date, PAGES)).list; }
    catch (/** @type {any} */ e) { console.log("jr recheck", c.id, String((e && e.message) || e).slice(0, 160)); return "stop"; }
    st.cache.set(x.date, list);
  }
  const r = list.find(/** @param {any} v */ v => String(v && v.id) === x.rec), v = r && jrRec(r);
  if (!r) return skip("запись удалена из журнала или перенесена на другой день");
  if (!v) return skip("запись удалена");
  if (v.att === -1) return skip("клиент не пришёл");
  if (v.date !== x.date || v.time !== x.time || (x.v && v.v !== x.v)) return skip("запись перенесена");
  if (v.p !== x.p) return skip("в записи другой номер");
  if (x.k === "rv" && v.att !== 1) { if (!x.wa) { x.wa = 1; st.dirty = true; } return "wait"; }
  if (x.k !== "rv" && v.att === 1) return skip("клиент уже пришёл");
  if (x.k !== "rv" && atLocal(x.date, x.time) <= now) return skip("время записи прошло");
  const hk = `h:ga:${c.id}:${x.p}`;
  /** @type {any} */ let p = {};
  try { const h = await readHist(env, hk); p = (h && h.profile) || {}; } catch (e) { console.log("jr chat read", String(e)); }
  // запись сделал бот в этой переписке — подтверждение клиент уже получил там (S01, S06)
  if ((x.k === "s01" || x.k === "s06") && (p.bookings || []).some(/** @param {any} b */ b => String(b && b.record_id) === x.rec)) return skip("подтверждение уже в переписке (запись через бота)");
  if (st.cnt >= o.cap) {
    try { if (await jrCapNote(env, c.id, isoDay(now))) await notify(env, `⚠️ ${c.name}: предел ${o.cap} сообщений в сутки со второго номера — остальные напоминания сегодня не отправлены.`, c.id); }
    catch (e) { console.log("jr cap note", String(e)); }
    return "stop";
  }
  const t = svText(c, x.k, { name: x.n, date: x.date, time: x.time, services: x.svc, staffName: x.staff }, p.lang);
  if (!t || !t.text) return skip("нет текста сообщения");
  const ver = x.v || "1";
  if (!(await jrTry(env, c.id, x.rec, x.k, ver))) return skip("уже отправляли");
  /** @type {Record<string, any>} */ let res;
  try { res = await sendGreen(env, x.p + "@c.us", t.text, ctx.route, true); } catch (e) { res = { ok: false, status: 0, code: "ga:net", error: String(e) }; }
  if (!res.ok) {
    const kind = gaKind(res.code), why = gaWhy(res, ctx.route);
    console.log("jr send", c.id, x.k, res.code);
    if (kind === "stop") {
      await jrUntry(env, c.id, x.rec, x.k, ver);
      await jrHoldSet(env, c.id, why, now);
      await notify(env, `⛔ ${c.name}: напоминания со второго номера остановлены на 6 часов.\nGreen-API: ${why}\nПроверьте, не заблокирован ли номер.`, c.id);
      return "stop";
    }
    if (kind === "net") { // Green-API не ответил: могло уйти — второй раз не шлём, в переписке — «неизвестно» (знак вопроса)
      await turn(env, hk, x, { role: "model", text: t.text, t: now, rm: x.k, st: "unknown" });
      st.logs.push(entry(x, "unknown", "Green-API не ответил — неизвестно, ушло ли; второй раз не шлём", now));
      return "drop";
    }
    if (kind === "temp") {
      await jrUntry(env, c.id, x.rec, x.k, ver);
      x.tries = (x.tries || 0) + 1; st.dirty = true;
      if (x.tries < MAX_TRIES) return "stop"; // в следующую минуту ещё раз
    }
    // номера нет в WhatsApp, текст не принят, три временных отказа подряд — задача администратору (S18), без новых попыток
    await adminTask(env, c, x, now, { role: "model", text: t.text, t: now, rm: x.k, st: "failed", se: stErr("failed", why) }, why);
    st.logs.push(entry(x, "task", `не ушло (${why}) — задача администратору`, now));
    return "drop";
  }
  st.cnt++;
  try { await rmOk(env, c.id, x.rec, x.k); } catch (e) { console.log("jr ok mark", String(e)); }
  if (x.k === "rv") { try { await jrReviewMark(env, c.id, x.p, now); } catch (e) { console.log("jr review mark", String(e)); } }
  await turn(env, hk, x, { role: "model", text: t.text, t: now, rm: x.k, ...(res.id ? { mid: String(res.id).slice(0, 80) } : {}), st: "sent" });
  st.logs.push(entry(x, "sent", KIND_WORD[x.k] || "", now));
  return "sent";
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
  try { await notifyOnce(env, `jrfail:${c.id}:${x.rec}:${x.k}`, `⚠️ ${c.name}: сообщение со второго номера не ушло — ${KIND_WORD[x.k] || "сообщение"}, клиент ${maskPhone(x.p)}${firstName(x.n) ? " (" + firstName(x.n) + ")" : ""}.\nПричина: ${why}.\nЧат — в пульте, «Нужен ответ»: напишите или позвоните клиенту.`, c.id); }
  catch (e) { console.log("jr task note", String(e)); }
}

/** Проверка по настоящему журналу без отправки (кнопка владельца во вкладке «Сервисные»): журнал на вчера, сегодня и завтра, план и
 *  проверки перед отправкой — только чтение; в KV и D1 ничего не пишется, имена — первое слово, номера — маской (правило владельца:
 *  настоящие персональные данные в черновике не храним). @param {Env} env @param {Client} c @param {number} now */
export async function jrDry(env, c, now) {
  if (!c.jr) return { ok: false, why: "У компании нет напоминаний по журналу Altegio." };
  const user = altUserKey(env, c), loc = altLoc(env, c);
  if (!env.ALTEGIO_PARTNER || !(loc > 0)) return { ok: false, why: "Не подключён Altegio: нет ключа разработчика или номера локации." };
  if (!user) return { ok: false, why: "Не подключён журнал Altegio: нужен ключ журнала (страница /altegio/user)." };
  const from = isoDay(now - 86400e3), to = isoDay(now + 86400e3);
  const { list, pages, cut } = await altRecordsRange(env, user, loc, from, to, PAGES);
  const o = opts(c), { items, skipped } = jrPlanAll(c, list, now), ap = await svApprovals(env, c.id), byId = new Map(list.map(r => [String(r && r.id), r]));
  const hr = local(now).getUTCHours(), quiet = hr < o.from || hr >= o.to;
  /** @type {Map<string, any>} */ const prof = new Map();
  const out = [];
  for (const x of items.sort((a, b) => a.at - b.at).slice(0, 200)) {
    const sc = scenario(KIND_SC[x.k] || ""), v = jrRec(byId.get(x.rec)), a = sc && ap[sc.id];
    if (!prof.has(x.p)) { try { const h = await readHist(env, `h:ga:${c.id}:${x.p}`); prof.set(x.p, (h && h.profile) || {}); } catch (e) { prof.set(x.p, {}); } }
    const p = prof.get(x.p);
    let why = "", status = "";
    if (await optedOut(env, c.id, x.p)) why = "клиент просил не писать";
    else if (x.k === "rv" && await jrReviewed(env, c.id, x.p)) why = "отзыв у этого клиента уже просили (раз в 60 дней)";
    else if (!sc || !a || +a.v !== sc.v) why = "текст не одобрен владельцем";
    else if ((x.k === "s01" || x.k === "s06") && (p.bookings || []).some(/** @param {any} b */ b => String(b && b.record_id) === x.rec)) why = "подтверждение уже в переписке (запись через бота)";
    else if (await jrTried(env, c.id, x.rec, x.k, x.v)) why = "уже отправляли";
    if (why) status = "skip";
    else if (x.k === "rv" && (!v || v.att !== 1)) { status = "wait"; why = "ждёт отметки «пришёл» в Altegio"; }
    else if (x.at > now) status = "later";
    else if (quiet) { status = "later"; why = `уйдёт в часы отправки (с ${o.from}:00 до ${o.to}:00)`; }
    else status = "now";
    const t = svText(c, x.k, { name: x.n, date: x.date, time: x.time, services: x.svc, staffName: x.staff }, p.lang);
    out.push({ k: x.k, sc: sc ? sc.id : "", at: x.at, name: firstName(x.n), phone: maskPhone(x.p), date: x.date, time: x.time, staff: x.staff, svc: x.svc,
      status, why, text: t ? t.text : "", lang: t ? t.lang : "ru" });
  }
  /** @type {Record<string, number>} */ const why = {};
  for (const s of skipped) why[s.why] = (why[s.why] || 0) + 1;
  return { ok: true, at: now, from, to, records: list.length, pages, cut, enabled: jrOn(env, c), ga: !!gaRoute(env, c.id), hold: await jrHold(env, c.id), quiet,
    items: out, total: items.length, skipped: Object.entries(why).map(([w, n]) => ({ why: w, n })) };
}
