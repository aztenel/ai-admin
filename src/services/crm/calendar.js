// @ts-check
// Календарь (ТЗ v2.0 §6, v3.0 31.10.2026): этот месяц с 1-го числа и весь следующий, по Астане. По каждому дню отдельно —
// сервисные (напоминания и отзывы в очереди по видам) и реклама (автосценарий «Пора на стрижку»: кто в этот день дойдёт до N дней
// с визита, кому можно, почему остальным нельзя). Только числа, без номеров. Прошедшие дни месяца — без плана рекламы (null):
// прошедшие рассылки — в списке рассылок. Реклама — по свежему снимку и правилам «только с согласием, 30 дней между рекламой».
// Это план, а не обещание отправки: в день отправки всё проверяется ещё раз (sender.js). Снимок читается один раз (crmView).
// events у дня (ТЗ v3.0 P1, 31.10.2026) — то же словами и числами для клеток календаря: service — сервисные в очереди по видам;
// campaign — рассылка, которая идёт или одобрена и ждёт запуска (сегодня), и план автосценария; approval — черновик ждёт одобрения
// владельца (сегодня); sent и error — сколько ушло и не дошло в этот день (отчёты в D1, прошедшие дни и сегодня); audience — «стоп»,
// неоднозначный «стоп», новые и отозванные согласия (D1). Запланированных отправок «под предел» не придумываем: только то, что есть.
/** @import { Env, Client } from "../../lib/types.js" */
import { isoDay, local, TZ } from "../../lib/time.js";
import { CRM_QUIET_DAYS } from "../../config/constants.js";
import { crmView } from "./segments.js";
import { autoGet } from "./auto.js";
import { autoSettings } from "../automsg/catalog.js";
import { mkLocked } from "../automsg/marketing.js";
import { autoLoad } from "../../db/kv/automsg.js";
import { serviceInfo } from "../reminders/info.js";
import { d1Ready } from "../../db/d1/status.js";
import { dayEvents } from "../../db/d1/stats.js";
import { bcList, bcGet } from "../../db/kv/broadcasts.js";

// виды сервисных сообщений словами (очередь jrq: и rmq:)
const SERVICE_TITLE = /** @type {Record<string, string>} */ ({ s01: "Подтверждения записи", d1: "Напоминания накануне", h2: "Напоминания за 2 часа", s06: "Новое время после переноса", rv: "Благодарности за визит", bi: "Начислено бонусов", bo: "Списано бонусов" });
const SRC_TITLE = /** @type {Record<string, string>} */ ({ service: "Напоминания", review: "Просьбы об отзыве", campaign: "Рассылки" });
/** «12:00» из часа @param {any} h */
const hh = h => `${String(Math.round(+h) || 0).padStart(2, "0")}:00`;

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
/** @param {string} s ГГГГ-ММ-ДД */
const dayNo = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400e3;

/** @param {Env} env @param {Client} c @param {number} now */
export async function calendarOf(env, c, now) {
  const L = local(now), y = L.getUTCFullYear(), m = L.getUTCMonth(), today = isoDay(now), t0 = dayNo(today);
  const days = /** @type {string[]} */ ([]);
  for (let t = Date.UTC(y, m, 1), end = Date.UTC(y, m + 2, 0); t <= end; t += 86400e3) days.push(new Date(t).toISOString().slice(0, 10));
  const month = [0, 1].map(k => { const d = new Date(Date.UTC(y, m + k, 1)); return { id: d.toISOString().slice(0, 7), label: MONTHS[d.getUTCMonth()] }; });
  /** @type {Record<string, any>} */
  const out = Object.fromEntries(days.map(d => [d, { date: d, wd: new Date(dayNo(d) * 86400e3).getUTCDay(), past: d < today, today: d === today,
    service: { total: 0, kinds: /** @type {Record<string, number>} */ ({}) }, marketing: null, events: /** @type {{ kind: string, title: string, n: number, id?: string }[]} */ ([]) }]));
  // сервисные: очередь по дням отправки (часы Астаны)
  try {
    const s = await serviceInfo(env, c, now);
    for (const x of (s && s.queue) || []) {
      const cell = out[isoDay(+x.at || 0)];
      if (!cell) continue;
      cell.service.total++; cell.service.kinds[x.k] = (cell.service.kinds[x.k] || 0) + 1;
    }
  } catch (e) { console.log("calendar service", String(e).slice(0, 100)); }
  // реклама: кто в день k (0 — сегодня) наберёт ровно N дней с визита; прошедшие дни — без плана. У компании со вторым номером (c.jr,
  // Winchester) — реактивация «Автоматических сообщений» (ТЗ v4: календарь показывал автосценарий Meta, а реклама идёт со второго номера),
  // иначе — автосценарий Meta «Пора на стрижку». «Был меньше 14 дней назад» — на день календаря: к этому дню с визита пройдёт N дней
  // (было: считалось на сегодня, и с 15-го дня «можно писать 0»)
  /** @type {any} */ let auto = null, at = 0;
  if (c.crm) {
    try {
      if (c.jr) {
        const set = autoSettings(c, await autoLoad(env, c.id)), ra = set.s.reactivate, locked = mkLocked(env, c);
        auto = { on: !!ra.on && !locked, days: +ra.t.days, cap: +ra.t.cap, tpl: true, src: "ga", title: "Реактивация клиентов", time: String(ra.t.time || ""), ...(locked ? { locked } : {}) };
      } else auto = { ...(await autoGet(env, c.id)), src: "meta", title: "Автосценарий «Пора на стрижку»", time: "11:00" };
      const view = await crmView(env, c, now);
      at = view.snap ? view.snap.at : 0;
      for (const d of days) {
        const k = dayNo(d) - t0;
        if (k < 0) continue;
        const cand = view.rows.filter(x => x.d + k === auto.days), why = /** @type {Record<string, number>} */ ({});
        const whyOn = (/** @type {any} */ x) => x.why !== "recent" ? x.why : x.d + k < CRM_QUIET_DAYS ? "recent" : view.marked && view.marked.has(x.p) ? "marketed" : "";
        for (const x of cand) { const w = whyOn(x); if (w) why[w] = (why[w] || 0) + 1; }
        const ok = cand.filter(x => !whyOn(x)).length;
        out[d].marketing = { candidates: cand.length, allowed: ok, planned: auto.on && auto.tpl ? Math.min(ok, auto.cap) : 0, excluded: why };
      }
    } catch (e) { console.log("calendar crm", String(e).slice(0, 100)); }
  }
  // события дня: рассылки из списка (KV), отчёты и изменения аудитории (D1), сервисные и план автосценария — из того, что посчитано выше
  /** @type {any[]} */ let bcs = [];
  try { bcs = await bcList(env, c.id); } catch (e) { console.log("calendar bc", String(e).slice(0, 100)); }
  const names = new Map(bcs.map(b => [String(b.id), String(b.name || "Рассылка")]));
  /** @param {string} d @param {string} kind @param {string} title @param {number} n @param {string | null} [id] */
  const ev = (d, kind, title, n, id) => { if (out[d] && n > 0) out[d].events.push({ kind, title, n, ...(id ? { id } : {}) }); };
  for (const b of bcs) {
    const left = Math.max(0, (+b.total || 0) - (+b.pos || 0)), nm = `«${String(b.name || "Рассылка")}»`;
    if (b.status === "running") { // окно отправки — из самой рассылки (в метаданных его нет)
      /** @type {any} */ let full = null; try { full = await bcGet(env, c.id, String(b.id)); } catch (e) {}
      ev(today, "campaign", `${nm} идёт${full && full.from != null ? ` · с ${hh(full.from)} до ${hh(full.to)}` : ""}`, left, String(b.id));
    } else if (b.status === "ready" && b.approved) ev(today, "campaign", `${nm} одобрена, ждёт запуска`, +b.total || 0, String(b.id));
    else if (b.status === "ready") ev(today, "approval", `${nm} ждёт одобрения владельца`, +b.total || 0, String(b.id));
  }
  for (const d of days) {
    const cell = out[d];
    if (cell.marketing && cell.marketing.planned > 0) ev(d, "campaign", auto && auto.src === "ga" ? `«${auto.title}» со второго номера` : `Автосценарий «Пора на стрижку»`, cell.marketing.planned);
    for (const [k, n] of Object.entries(cell.service.kinds)) ev(d, "service", SERVICE_TITLE[k] || "Сервисные сообщения", +n || 0);
  }
  try {
    const db = await d1Ready(env, now);
    if (db) {
      const start = Date.UTC(+days[0].slice(0, 4), +days[0].slice(5, 7) - 1, +days[0].slice(8, 10)) - TZ * 3600e3;
      /** @type {Record<string, Record<string, { kind: string, title: string, n: number, id?: string }>>} */
      const acc = {};
      const add = (/** @type {string} */ d, /** @type {string} */ key, /** @type {string} */ kind, /** @type {string} */ title, /** @type {number} */ n, /** @type {string | null} */ id) => {
        const a = acc[d] || (acc[d] = {}), x = a[key] || (a[key] = { kind, title, n: 0, ...(id ? { id } : {}) }); x.n += n;
      };
      for (const r of await dayEvents(db, c.id, start, now + 1)) {
        const n = +r.n || 0, bc = r.bc ? String(r.bc) : null;
        if (r.kind === "msg_sent" || r.kind === "msg_failed") {
          if (r.src === "admin") continue; // ответы сотрудников — не рассылка и не напоминание
          const what = bc ? `«${names.get(bc) || "Рассылка"}»` : SRC_TITLE[String(r.src)] || "Сообщения", sent = r.kind === "msg_sent";
          add(r.d, `${sent ? "s" : "e"}:${bc || r.src}`, sent ? "sent" : "error", `${what}: ${sent ? "ушло" : "не дошло"}`, n, bc);
        } else if (r.kind === "stop" || r.kind === "full_block") add(r.d, "a:stop", "audience", "Просили не писать", n, null);
        else if (r.kind === "stop_review") add(r.d, "a:review", "audience", "Неоднозначный «стоп»: ждёт решения", n, null);
        else if (r.kind === "consent" && r.state === "granted" && +(r.conf || 0) === 1) add(r.d, "a:yes", "audience", "Дали согласие на рекламу", n, null);
        else if (r.kind === "consent" && r.state === "denied" && r.ev !== "client_stop") add(r.d, "a:no", "audience", "Отозвали согласие на рекламу", n, null);
      }
      for (const [d, a] of Object.entries(acc)) for (const x of Object.values(a)) ev(d, x.kind, x.title, x.n, x.id);
    }
  } catch (e) { console.log("calendar d1", String(e).slice(0, 100)); }
  const ORDER = ["approval", "campaign", "service", "sent", "error", "audience"];
  for (const d of days) out[d].events.sort((/** @type {any} */ a, /** @type {any} */ b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.n - a.n);
  return { today, weekday0: L.getUTCDay(), from: days[0], to: days[days.length - 1], month,
    auto: auto ? { on: !!auto.on, days: auto.days, cap: auto.cap, tpl: !!auto.tpl, src: auto.src, title: auto.title, time: auto.time, ...(auto.locked ? { locked: auto.locked } : {}) } : null,
    baseAt: at, days: days.map(d => out[d]) };
}
