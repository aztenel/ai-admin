// @ts-check
// Рекламные «Автоматические сообщения» со второго номера (задание владельца 02.11.2026): поздравление с днём рождения и реактивация.
// Реклама — только тем, у кого подтверждённое согласие на рекламу, нет «стопа» и не было рекламы 30 дней (marketingGate, crmView): история
// визитов — не согласие, отсутствие согласия — не согласие. Рекламу со второго номера держит запрет gaNoBroadcast (Winchester): пока он
// стоит, эти сценарии не включаются и ничего не шлют (снимает его только решение владельца в коде, не выключатель).
// Раз в день, в выбранное время: получатели (день рождения — поиск клиентов Altegio с фильтром birthday, только чтение; реактивация —
// снимок базы crm:, ровно N дней с визита) → очередь mkq:<клиент>:<сценарий> → по 2 сообщения в минуту в часы отправки, в общий предел
// второго номера за сутки. Перед каждым сообщением — свежая проверка согласия и «стопа». От дублей: отметка D1 send_claims
// (a-bd-<номер>-<год>, a-ra-<номер>-<день>), поздравили в этом году (bdg:), реклама за день (bcm: — её видят и рассылки, и сегменты).
/** @import { Env, Client } from "../../lib/types.js" */
import { CLIENTS } from "../../config/builtin-clients.js";
import { local, isoDay } from "../../lib/time.js";
import { normPhone } from "../../lib/phone.js";
import { altText } from "../integrations/altegio/client.js";
import { altClientsSearch } from "../integrations/altegio/clients-api.js";
import { gaRoute } from "../integrations/greenapi/webhook.js";
import { gaKind, gaWhy, gaUnsureNote } from "../integrations/greenapi/client.js";
import { notify } from "../integrations/telegram/client.js";
import { sendGreen } from "../channels/greenapi.js";
import { altUserKey } from "../booking/journal.js";
import { altLoc } from "../booking/book.js";
import { marketingGate } from "../contacts/gate.js";
import { MARKETING_GAP_DAYS } from "../contacts/segments.js";
import { crmPick } from "../crm/segments.js";
import { bcGaOff } from "../broadcast/sender.js";
import { render, dataFor } from "../broadcast/render.js";
import { companyOf } from "../broadcast/library.js";
import { jrOn, sendOnceAuto } from "../reminders/journal.js";
import { atLocal } from "../reminders/plan.js";
import { logTurns, readHist } from "../../db/kv/chats.js";
import { bcmRead, bcmAdd } from "../../db/kv/crm.js";
import { jrCount, jrCountSave, jrHold, jrHoldSet, jrLogAdd, optedOut } from "../../db/kv/reminders.js";
import { autoLoad, autoCountAdd, mkDayMark, mkqLoad, mkqSave, bdGreeted, bdGreetMark } from "../../db/kv/automsg.js";
import { autoSettings, autoDef } from "./catalog.js";

const PER_MIN = 2;        // как у напоминаний: неофициальный номер, частые сообщения подряд — повод для блокировки
const MAX_TRIES = 3;      // Green-API точно не принял (429, перезапуск инстанса) — столько попыток, дальше не шлём
export const MK_IDS = /** @type {const} */ (["birthday", "reactivate"]);
const STOP = new Set(["stop"]);

/** реклама со второго номера сейчас разрешена? → "" или почему нет @param {Client} c */
export const mkLocked = c => bcGaOff(c.id) ? "Реклама со второго номера выключена: массовые сообщения с обычного WhatsApp — главная причина блокировок. Включает владелец отдельным решением." : "";

/** фоновая задача раз в минуту @param {Env} env @param {number} now */
export async function mkRun(env, now) {
  let n = 0;
  for (const c of Object.values(CLIENTS)) {
    if (!jrOn(env, c) || mkLocked(c)) continue;
    try { n += await mkClient(env, c, now); } catch (/** @type {any} */ e) { console.log("mk", c.id, String((e && e.stack) || e).slice(0, 300)); }
  }
  return n;
}

/** @param {Env} env @param {Client} c @param {number} now */
async function mkClient(env, c, now) {
  const route = gaRoute(env, c.id);
  if (!route) return 0;
  const set = autoSettings(c, await autoLoad(env, c.id)), day = isoDay(now), hr = local(now).getUTCHours();
  const quiet = hr < set.win.from || hr >= set.win.to, logs = /** @type {any[]} */ ([]);
  let sent = 0;
  for (const id of MK_IDS) {
    const sc = set.s[id];
    if (!sc.on) continue;
    if (now >= atLocal(day, String(sc.t.time)) && !quiet && await mkDayMark(env, c.id, id, day)) {
      try {
        const list = await mkPick(env, c, id, set, now);
        await mkqSave(env, c.id, id, day, list);
        logs.push(mkEntry(id, { p: "", n: "" }, "planned", list.length ? `на сегодня: ${list.length}` : "сегодня некому: нет подходящих клиентов с согласием на рекламу", now));
      } catch (/** @type {any} */ e) {
        console.log("mk pick", c.id, id, String((e && e.message) || e).slice(0, 160));
        logs.push(mkEntry(id, { p: "", n: "" }, "skipped", "не удалось собрать получателей: Altegio или база не ответили, сегодня не шлём", now));
      }
    }
    if (quiet || sent >= PER_MIN) continue;
    const q = await mkqLoad(env, c.id, id);
    if (!q.list.length) continue;
    if (q.day !== day) { await mkqSave(env, c.id, id, day, []); continue; } // вчерашняя очередь: поздравление и реактивация — только в свой день
    if (await jrHold(env, c.id)) continue;
    const left = [];
    let stop = false;
    for (const x of q.list) {
      if (stop || sent >= PER_MIN) { left.push(x); continue; }
      const r = await mkSend(env, c, id, set, x, now, route, logs);
      if (r === "sent") sent++;
      else if (r === "again") left.push(x);
      else if (r === "stop") { left.push(x); stop = true; }
    }
    await mkqSave(env, c.id, id, day, left);
  }
  try { await jrLogAdd(env, c.id, logs); } catch (e) { console.log("mk log add", String(e)); }
  try { await autoCountAdd(env, c.id, day, mkCounts(logs)); } catch (e) { console.log("mk counts", String(e)); }
  return sent;
}

/** запись журнала решений (общий журнал jrl:, раздел «Автоматические сообщения») @param {string} id @param {any} x @param {string} st @param {string} why @param {number} now */
const mkEntry = (id, x, st, why, now) => ({ t: now, k: (autoDef(id) || { kind: "" }).kind, rec: "", p: String(x.p || ""), n: String(x.n || ""), date: "", time: "", st, why });
/** @param {any[]} logs */
function mkCounts(logs) {
  /** @type {Record<string, Record<string, number>>} */ const add = {};
  const KEY = /** @type {Record<string, string>} */ ({ sent: "s", task: "f", failed: "f", unknown: "u", skipped: "k" });
  for (const x of logs) {
    const id = x.k === "bd" ? "birthday" : x.k === "ra" ? "reactivate" : "", f = KEY[x.st];
    if (!id || !f || !x.p) continue;
    add[id] = add[id] || {};
    add[id][f] = (add[id][f] || 0) + 1;
  }
  return add;
}

/**
 * Кому сегодня: только подтверждённое согласие на рекламу, без «стопа», без рекламы за 30 дней. → [{ p, n, staff, svc, d }]
 * @param {Env} env @param {Client} c @param {string} id @param {any} set @param {number} now
 */
export async function mkPick(env, c, id, set, now) {
  if (id === "reactivate") {
    const sc = set.s.reactivate;
    const list = (await crmPick(env, c, "all", now, { days: +sc.t.days })) || [];
    return list.slice(0, +sc.t.cap || 20).map(x => ({ p: x.phone, n: x.name, staff: x.staff, svc: x.svc, d: x.d }));
  }
  const people = await birthdays(env, c, now);
  const gate = await marketingGate(env, c, now);
  if (!gate.ready) throw new Error(gate.why);
  const year = isoDay(now).slice(0, 4), days = Array.from({ length: MARKETING_GAP_DAYS }, (_, i) => isoDay(now - i * 86400e3));
  const marked = await bcmRead(env, c.id, days), out = [];
  for (const x of people) {
    if (!gate.phones.has(x.p) || marked.has(x.p) || await optedOut(env, c.id, x.p) || await bdGreeted(env, c.id, x.p, year)) continue;
    out.push(x);
  }
  return out.slice(0, 50);
}
/** у кого сегодня день рождения (по Астане) — поиск клиентов Altegio, только чтение. → [{ p, n }] @param {Env} env @param {Client} c @param {number} now */
export async function birthdays(env, c, now) {
  const user = altUserKey(env, c), loc = altLoc(env, c), day = isoDay(now);
  if (!env.ALTEGIO_PARTNER || !user || !(loc > 0)) throw new Error("Altegio не подключён: нужен ключ журнала.");
  const out = [], seen = new Set();
  for (let page = 1; page <= 5; page++) {
    const r = await altClientsSearch(env, user, loc, { page, page_size: 200, fields: ["id", "name", "phone"], filters: [{ type: "birthday", state: { from: day, to: day } }] });
    for (const x of r.list) {
      const p = normPhone(String(x.phone ?? "")).slice(1);
      if (!p || seen.has(p)) continue;
      seen.add(p);
      out.push({ p, n: altText(x.name || "", 60) });
    }
    if (r.list.length < 200) break;
  }
  return out;
}

/** текст рекламного сценария для клиента: язык чата (kk — если есть казахский текст), иначе по-русски
 *  @param {Client} c @param {any} set @param {string} id @param {any} x { n, staff, svc, d } @param {string} [lang] */
export function mkText(c, set, id, x, lang) {
  const tx = set.tx[id], use = lang === "kk" && tx.kk ? "kk" : "ru";
  return { ...render(use === "kk" ? tx.kk : tx.ru, dataFor({ name: x.n, staff: x.staff, svc: x.svc, d: x.d }, companyOf(c))), lang: use };
}

/** одно сообщение → "sent" | "drop" | "again" (в следующую минуту) | "stop" (больше не шлём сегодня, номер на паузе)
 *  @param {Env} env @param {Client} c @param {string} id @param {any} set @param {any} x @param {number} now @param {any} route @param {any[]} logs */
async function mkSend(env, c, id, set, x, now, route, logs) {
  const skip = (/** @type {string} */ why) => { logs.push(mkEntry(id, x, "skipped", why, now)); return "drop"; };
  // перед каждым сообщением — свежая проверка: «стоп» и отказ от рекламы могли прийти после сбора очереди
  if (await optedOut(env, c.id, x.p)) return skip("клиент просил не писать");
  const gate = await marketingGate(env, c, now).catch(() => null);
  if (!gate || !gate.ready) return "stop"; // база согласий не ответила — закрыто при сомнении, попробуем через минуту
  if (!gate.phones.has(x.p)) return skip(STOP.has(gate.reasons.get(x.p) || "") ? "клиент просил не писать" : "нет подтверждённого согласия на рекламу");
  const day = isoDay(now), year = day.slice(0, 4);
  if (id === "birthday" && await bdGreeted(env, c.id, x.p, year)) return skip("уже поздравили в этом году");
  const cnt = await jrCount(env, c.id, day);
  if (cnt >= set.cap) return "stop";
  const hk = `h:ga:${c.id}:${x.p}`;
  /** @type {any} */ let prof = {};
  try { const h = await readHist(env, hk); prof = (h && h.profile) || {}; } catch (e) { console.log("mk chat read", String(e)); }
  if (prof.stop) return skip("клиент просил не писать");
  const t = mkText(c, set, id, x, prof.lang);
  if (t.blocked || !t.text) return skip("текст не собрать: " + (t.issues[0] || "нет данных").toLowerCase());
  /** @type {Record<string, any>} */ let res = { ok: false, code: "ga:net" };
  const once = await sendOnceAuto(env, c.id, x.p, id === "birthday" ? `a-bd-${x.p}-${year}` : `a-ra-${x.p}-${day}`, async () => {
    try { res = await sendGreen(env, x.p + "@c.us", t.text, route, true); } catch (e) { res = { ok: false, status: 0, code: "ga:net", error: String(e) }; }
    return res.ok ? { ok: true, ...(res.id ? { id: String(res.id) } : {}) } : gaKind(res.code) === "net" ? { ok: true, unknown: true } : { ok: false };
  });
  if (once && "blocked" in once) return "stop";
  if (once && "dup" in once) return skip("уже отправляли (отметка в базе)");
  const kind = res.ok ? "" : gaKind(res.code);
  if (!res.ok && kind === "stop") {
    const why = gaWhy(res, route);
    await jrHoldSet(env, c.id, why, now);
    await notify(env, `⛔ ${c.name}: сообщения со второго номера остановлены на 6 часов.\nGreen-API: ${why}\nПроверьте, не заблокирован ли номер.`, c.id);
    return "stop";
  }
  if (!res.ok && kind === "temp") { x.tries = (x.tries || 0) + 1; return x.tries < MAX_TRIES ? "again" : skip(`не ушло: ${gaWhy(res, route)}`); }
  if (!res.ok && kind !== "net") { logs.push(mkEntry(id, x, "failed", `не ушло: ${gaWhy(res, route)}`, now)); return "drop"; }
  // ушло или неизвестно, ушло ли: второй раз не шлём; реклама за день — отметка (30 дней ничего рекламного), поздравили в этом году
  try { await jrCountSave(env, c.id, day, cnt + 1); } catch (e) { console.log("mk count", String(e)); }
  try { await bcmAdd(env, c.id, day, [x.p]); } catch (e) { console.log("mk bcm", String(e)); }
  if (id === "birthday") { try { await bdGreetMark(env, c.id, x.p, year, now); } catch (e) { console.log("mk bd mark", String(e)); } }
  const unsure = !res.ok;
  try { await logTurns(env.KV, hk, [{ role: "model", text: t.text, t: now, rm: id === "birthday" ? "bd" : "ra", ...(res.id ? { mid: String(res.id).slice(0, 80) } : {}), st: unsure ? "unknown" : "sent", ...(unsure ? { se: gaUnsureNote(res) } : {}) }], /** @param {any} p */ p => { if (!p.waName && x.n) p.waName = x.n; }); }
  catch (e) { console.log("mk log", String(e)); }
  logs.push(mkEntry(id, x, unsure ? "unknown" : "sent", unsure ? `${gaUnsureNote(res)}. Второй раз не шлём` : (id === "birthday" ? "поздравление" : "приглашение вернуться"), now));
  return unsure ? "drop" : "sent";
}
