// @ts-check
// Онлайн-запись на сайте: POST book. Порядок (docs: CLAUDE.md §2.2 «Запись с сайта»): тело (≤ 4 КБ в байтах) → повтор того же rid
// в памяти → ловушка website и подпись метки формы ft (до хранилища: мусор не стоит чтения KV) → повтор rid в KV → возраст метки →
// попытки с адреса за час → поля → бронь пределов записей → отметка «идёт запись» → свежее время мастера → book_check →
// (режим «1») book_record → заявка, Telegram. book_record вслепую не повторяем (CLAUDE.md §5.2): повтор того же rid отдаёт
// сохранённый ответ, без новых запросов к Altegio. В хранилище — только через db/kv (CLAUDE.md §5.1).
/** @import { Env, Client } from "../../lib/types.js" */
/** @import { SiteConf } from "./config.js" */
/** @import { Cat } from "./base.js" */
/** @import { Out } from "./texts.js" */
import { altDropTimes, altRecord } from "../integrations/altegio/booking-api.js";
import { altCheck } from "../integrations/altegio/site-api.js";
import { altEmailErr, ALT_EMAIL_TIP } from "../integrations/altegio/errors.js";
import { notify } from "../integrations/telegram/client.js";
import { settledBy } from "../booking/book.js";
import { nearest, tStr } from "../booking/fit.js";
import { ipKey, altLimits } from "../booking/limits.js";
import { loadLeads, saveLeads, putLeadKey } from "../../db/kv/leads.js";
import { sbGet, sbPut, sbDrop, sbHourHit, sbHold } from "../../db/kv/site.js";
import { normPhone, maskPhone, logSafe } from "../../lib/phone.js";
import { clean } from "../../lib/text.js";
import { isoDay, local, hhmm, mins } from "../../lib/time.js";
import { loadCat, pickServices, staffPool, doesAll, sumOf, stopped, altLog, cacheDrop, ck, BUDGET } from "./base.js";
import { openDates, staffStarts, daySlots, pad } from "./slots.js";
import { ftCheck, ftTime, FT_MIN_MS } from "./token.js";
import { fail, badField, limitHit, leadWhen, tgText } from "./texts.js";

const BODY_MAX = 4096, HOUR_MAX = 8, CANDIDATES = 3;
const PHONE_KZ = /^\+77(0[0-8]|47|71|7[5-8])\d{7}$/; // мобильные операторы Казахстана: городской номер («+7 7172 …») — нельзя, по нему не напишешь в WhatsApp
const NAME_RE = /^[\p{L}][\p{L}\s.'’-]*$/u;
// ответы с итогом хранятся под rid (повтор того же rid отдаёт их без запросов к Altegio); остальное (ошибка поля, «подожди») — нет:
// форма повторяет с тем же rid после «Секунду — проверяем данные»
const FINAL = new Set(["unknown", "taken", "overlap", "limit", "service", "altegio", "refused"]);
const enc = new TextEncoder();

// rid в памяти экземпляра: второй одновременный запрос с тем же rid (двойное нажатие) — «уже отправляется», не вторая запись.
// KV между экземплярами согласован не сразу — память ловит одновременные запросы, KV (sb:) — повтор через секунды
/** @type {Map<string, any>} */
const mem = new Map();
/** @param {string} k @param {number} nowMs */
const memGet = (k, nowMs) => { const v = mem.get(k); if (v && nowMs - v.at > 900e3) { mem.delete(k); return null; } return v || null; };
/** @param {string} k @param {any} v @param {number} nowMs */
const memSet = (k, v, nowMs) => { if (mem.size > 2000) mem.clear(); mem.set(k, { ...v, at: nowMs }); };

// ошибка Altegio → что ответить клиенту. check — book_check: «время недоступно» приходит и без кода (422).
// "altegio" у book_record — отказ (432, 434, почта, прочие 4xx): запись не создана, клиенту — «заявка у администратора»
/** @param {any} e @param {boolean} check @returns {"taken" | "overlap" | "service" | "phone" | "unknown" | "altegio"} */
function altWhy(e, check) {
  if (altEmailErr(e)) return "altegio";
  if (e.code === 433 || e.code === 436 || (check && (e.code === 422 || (e.status === 422 && !e.code)))) return "taken";
  if (e.code === 437) return "overlap";
  if (e.code === 438 || e.status === 404) return "service";
  if (e.code === 431) return check ? "altegio" : "phone";
  if (!e.status || e.status >= 500 || (e.status >= 200 && e.status < 300)) return check ? "altegio" : "unknown";
  return "altegio";
}
// причина отказа book_record для администратора (клиенту — общий текст: чёрный список клиенту не раскрываем)
/** @param {any} e */
const whyAdmin = e => e.code === 432 ? "локация требует код из SMS — отключите подтверждение номера в онлайн-записи Altegio"
  : e.code === 434 ? "номер клиента в чёрном списке Altegio" : altEmailErr(e) ? ALT_EMAIL_TIP : `Altegio ${e.status || ""}${e.code ? "/" + e.code : ""}: ${clean(e.message, 120)}`;

// домен сайта для пометки в журнале Altegio — из кода (site.origins), а не из SITE_ORIGINS_<ID> (там бывает адрес проверки)
/** @param {Client} c */
const siteHost = c => { try { return new URL(String(((c.site && c.site.origins) || [])[0])).hostname; } catch (e) { return ""; } };

// заявка — как у бота (orchestrator): сначала отдельным ключом (не теряется, если два запроса пишут общий список), потом в общий список,
// перечитанный прямо перед записью; одна повторная попытка через 1,1 с (у KV одна запись ключа в секунду). Сбой ответ клиенту не ломает
/** @param {Env} env @param {Client} c @param {any} lead */
async function saveLead(env, c, lead) {
  try { await putLeadKey(env.KV, c.id, lead); } catch (e) { console.log("site lead key", logSafe(String(e))); }
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const list = await loadLeads(env.KV, c.id); if (!list.some(x => x.id === lead.id)) list.push(lead); await saveLeads(env.KV, c.id, list); return; }
    catch (e) { console.log("site leads", logSafe(String(e))); if (!attempt) await new Promise(s => setTimeout(s, 1100)); }
  }
}

// пределы записей с сайта: с адреса и с номера — общие с ботом (ключи как в services/booking/limits.js), на день — свой у сайта
// (bk:<лок>:site:<день>, site.dayMax): номер никак не подтверждается, и выдуманные номера с сайта закрывали бы на день запись и боту
// в WhatsApp (общий предел локации 25, проверка 21.10.2026). Режим проверки тоже тратит — иначе спам заявками
/** @param {Client} c @param {SiteConf} conf @param {string} ip @param {string} phone @param {number} nowMs @returns {[string, number, string][]} */
function limitKeys(c, conf, ip, phone, nowMs) {
  const L = altLimits(c), day = isoDay(nowMs), loc = conf.loc;
  return [[`bk:${loc}:${ip}:${day}`, L.ip, "ip"], [`bk:${loc}:${phone}:${day}`, L.day, "phone"], [`bk:${loc}:site:${day}`, conf.dayMax, "day"]];
}

// поля заявки → данные записи или ответ-ошибка (bad_request)
/** @param {Env} env @param {SiteConf} conf @param {any} b @param {number} nowMs */
async function readFields(env, conf, b, nowMs) {
  const name = String(b.name ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 60 || !NAME_RE.test(name)) return { out: badField("name", conf) };
  const phone = normPhone(b.phone);
  if (!PHONE_KZ.test(phone)) return { out: badField("phone", conf) };
  const comment = clean(String(b.comment ?? "").replace(/[\u0000-\u001f\u007f]/g, " "), 1000);
  if (comment.length > 150) return { out: badField("comment", conf) };
  const cat = await loadCat(env, conf, nowMs);
  const sv = pickServices(cat, conf, Array.isArray(b.services) ? b.services : []);
  if (!sv.keys) return { out: badField("services", conf, sv.why) };
  const keys = sv.keys, st = staffPool(cat, b.staff, keys, false);
  if (!st.pool) return { out: badField(st.field, conf, st.why) };
  const m = st.pool[0], date = String(b.date ?? ""), time = String(b.time ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(await openDates(env, conf, m.id, nowMs)).includes(date)) return { out: badField("date", conf) };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { out: badField("time", conf) };
  return { name, phone, comment, cat, keys, m, any: b.any === true, date, time };
}

// кандидаты: выбранный мастер; при «любом мастере» — ещё до двух, кто делает все услуги не дороже показанной суммы и по последней
// сетке свободен в это время (проверка 21.10.2026: Алишер свободен в 15:00 за те же 7 000, а пробовали занятых Айдына и Руслана)
/** @param {Env} env @param {SiteConf} conf @param {Cat} cat @param {any} m @param {string[]} keys @param {string} date @param {string} time @param {number} nowMs */
async function candidates(env, conf, cat, m, keys, date, time, nowMs) {
  const want = sumOf(cat, m.id, keys);
  const others = cat.staff.filter(x => x !== m && doesAll(cat, x, keys) && sumOf(cat, x.id, keys).price <= want.price);
  const info = await settledBy(others.map(x => async () => {
    if (!(await openDates(env, conf, x.id, nowMs)).includes(date)) return null;
    const r = await staffStarts(env, conf, x.id, date, sumOf(cat, x.id, keys).min, nowMs);
    return r.starts.includes(time) ? { x, price: sumOf(cat, x.id, keys).price, free: r.free, idx: cat.staff.indexOf(x) } : null;
  }), 3);
  const ok = /** @type {any[]} */ (info.map(r => r.status === "fulfilled" ? r.value : null).filter(Boolean));
  ok.sort((a, b2) => a.price - b2.price || b2.free - a.free || a.idx - b2.idx);
  return [m, ...ok.slice(0, CANDIDATES - 1).map(v => v.x)];
}

// «время заняли»: свежие варианты на тот же день — до 6 ближайших к выбранному времени, а у «любого мастера» — и это же время у мастера
// не дороже показанной суммы, которого не пробовали. Поздно (срок ответа) — без вариантов: форма всё равно перечитает время
/** @param {Env} env @param {SiteConf} conf @param {any} f @param {Set<number>} tried @param {number} t0 @param {number} nowMs @returns {Promise<Out>} */
async function takenOut(env, conf, f, tried, t0, nowMs) {
  const { cat, keys, m, any, date, time } = f;
  /** @type {any[]} */ let slots = [];
  if (Date.now() - t0 > BUDGET.record) return fail("taken", conf, { slots });
  try {
    const pool = !any ? [m] : (await settledBy(cat.staff.filter(/** @param {any} x */ x => doesAll(cat, x, keys)).map(/** @param {any} x */ x => async () => (await openDates(env, conf, x.id, nowMs)).includes(date) ? x : null), 3))
      .map(r => r.status === "fulfilled" ? r.value : null).filter(Boolean);
    const all = await daySlots(env, conf, cat, pool, keys, date, nowMs);
    const near = new Set(nearest(all.map(s => s.time), time, 6));
    slots = all.filter(s => near.has(s.time));
    if (any) {
      const top = sumOf(cat, m.id, keys).price, rest = pool.filter(x => !tried.has(x.id) && sumOf(cat, x.id, keys).price <= top);
      const same = (await daySlots(env, conf, cat, rest, keys, date, nowMs)).find(s => s.time === time);
      if (same) slots = [...slots, same].sort((a, b) => mins(a.time) - mins(b.time));
    }
  } catch (e) { altLog("taken slots", e); }
  return fail("taken", conf, { slots });
}

// свежее время и book_check у каждого кандидата по очереди → { pick } | { out }
/** @param {Env} env @param {SiteConf} conf @param {any} f @param {any[]} cands @param {number} t0 @param {number} nowMs */
async function choose(env, conf, f, cands, t0, nowMs) {
  const { cat, keys, date, time } = f, tried = new Set();
  let taken = false;
  for (const x of cands) {
    if (Date.now() - t0 > BUDGET.cands) break; // срок ответа: новый шаг уже не успеет
    tried.add(x.id);
    const sum = sumOf(cat, x.id, keys);
    /** @type {any} */ let r;
    try { r = await staffStarts(env, conf, x.id, date, sum.min, nowMs, true); } catch (e) { altLog("times " + x.id, e); continue; }
    if (!r.starts.includes(time)) { taken = true; continue; }
    if (Date.now() - t0 > BUDGET.cands) break;
    const appointments = [{ id: 1, services: keys.map(/** @param {string} k */ k => cat.ids[x.id][k]), staff_id: x.id, datetime: `${date}T${time}:00+05:00` }];
    try { await altCheck(env, conf.loc, appointments); }
    catch (/** @type {any} */ e) {
      const why = altWhy(e, true);
      if (why === "taken") { taken = true; continue; }
      altLog("check", e);
      if (why === "service") cacheDrop(ck(conf, "sc"));
      return { out: fail(why === "overlap" || why === "service" ? why : "altegio", conf) };
    }
    return { pick: { x, sum, appointments } };
  }
  return { out: taken ? await takenOut(env, conf, f, tried, t0, nowMs) : fail("altegio", conf) };
}

// заявка для администратора: kind — live (записан), dry (режим проверки), unknown (Altegio не ответил), fail (Altegio отказал, why)
/** @param {Client} c @param {SiteConf} conf @param {"live" | "dry" | "unknown" | "fail"} kind @param {any} full @param {any} rec @param {string} [why] */
function makeLead(c, conf, kind, full, rec, why) {
  const now = Date.now(), { any, comment } = full;
  const note = kind === "dry" ? "Онлайн-запись с сайта в режиме проверки: время свободно, внесите запись в журнал и подтвердите клиенту"
    : kind === "unknown" ? "Altegio не ответил — запись могла создаться, проверьте журнал"
    : kind === "fail" ? `Онлайн-запись с сайта не прошла: ${why} — в журнале записи нет, свяжитесь с клиентом и запишите вручную`
    : "Записан онлайн с сайта" + (any ? " · мастер на выбор" : "");
  // src: "site" — запись с сайта; кода записи (record_hash) нет: бот такую запись видит чужой и не отменяет сам (решение №10, проверка 21.10.2026)
  return { id: now.toString(36) + Math.random().toString(36).slice(2, 6), ts: now, src: "site", name: full.name, phone: full.phone,
    service: full.services.map(/** @param {any} s */ s => s.name).join(" + ") + ` (мастер ${full.staff.name})`, time: leadWhen(full.date, full.time, full.end),
    source: c.name + " · сайт", at: hhmm(local(now)) + " " + isoDay(now), note: note + (comment ? ` · комментарий: «${comment}»` : ""),
    ...(kind === "live" ? { altegio: { loc: conf.loc, record_id: rec.record_id, date: full.date, time: full.time, services: full.services.map(/** @param {any} s */ s => s.name).join(" + "), staffName: full.staff.name } } : {}) };
}

/**
 * POST book. raw — тело запроса строкой (null — длиннее 4 КБ, не дочитывалось); meta.ip — адрес клиента (cf-connecting-ip); defer(f) — уведомление после ответа (ctx.waitUntil)
 * @param {Env} env @param {Client} c @param {SiteConf} conf @param {string | null} raw @param {{ ip: string }} meta @param {number} nowMs
 * @param {((f: () => Promise<any>) => void) | null} [defer] @returns {Promise<Out>}
 */
export async function siteBook(env, c, conf, raw, meta, nowMs, defer) {
  const t0 = Date.now();
  // 1. тело: предел — в байтах (кириллица — 2 байта на знак)
  if (typeof raw !== "string" || raw.length > BODY_MAX || enc.encode(raw).length > BODY_MAX) return badField("body", conf);
  /** @type {any} */ let b = null;
  try { b = JSON.parse(raw); } catch (e) {}
  if (!b || typeof b !== "object" || Array.isArray(b) || !/^[A-Za-z0-9_-]{16,40}$/.test(String(b.rid || ""))) return badField("body", conf);
  // 2. повтор того же rid: занимаем его в памяти сразу, до первого обращения к хранилищу
  const rid = String(b.rid), mk = conf.id + ":" + rid, seen = memGet(mk, nowMs);
  if (seen) return seen.st === "done" ? { http: seen.http, res: seen.res } : fail("in_progress", conf);
  memSet(mk, { st: "busy" }, nowMs);
  let marked = false, sent = false;
  /** @type {{ done: (ok: boolean) => Promise<void> } | null} */ let hold = null;
  /** @param {Out} out */
  const done = async out => {
    memSet(mk, { st: "done", http: out.http, res: out.res }, nowMs);
    try { await sbPut(env.KV, conf.id, rid, { st: "done", http: out.http, res: out.res }); } catch (e) { console.log("site sb", logSafe(String(e))); }
    return out;
  };
  /** @param {Out} out */
  const release = async out => { mem.delete(mk); if (marked) { try { await sbDrop(env.KV, conf.id, rid); } catch (e) { console.log("site sb", logSafe(String(e))); } } return out; };
  /** @param {Out} out */
  const finish = out => out.res.ok || FINAL.has(out.res.code) ? done(out) : release(out);
  // счётчики пределов +1 (запись или заявка состоялась); сбой хранилища ответ не ломает
  const count = async () => { if (hold) try { await hold.done(true); } catch (e) { console.log("site count", logSafe(String(e))); } };
  try {
    // 3. дешёвые проверки — до хранилища: ловушка для роботов (поле website люди не видят) и подпись метки формы
    if (String(b.website ?? "").trim()) return release(fail("spam", conf));
    const ft = await ftCheck(env, c, b.ft, nowMs);
    if (ft === "bad") return release(badField("body", conf));
    // 4. повтор rid через секунды (другой экземпляр, обрыв связи): готовый ответ — без запросов к Altegio. Возраст метки — после:
    // повтор с готовым ответом работает и со старой меткой
    const kv = await sbGet(env.KV, conf.id, rid);
    if (kv && kv.st === "done") { memSet(mk, kv, nowMs); return { http: kv.http, res: kv.res }; }
    if (kv) return release(fail("in_progress", conf));
    if (ft === "fast") return release(fail("too_fast", conf, { retry: Math.max(1, Math.ceil((FT_MIN_MS - (nowMs - ftTime(b.ft))) / 1000)) }));
    if (ft === "old") return release(fail("expired", conf));
    // 5. попытки записи с адреса за час (повтор того же rid выше не считается)
    const ip = ipKey(meta.ip || "local");
    if (await sbHourHit(env.KV, conf.loc, ip, local(nowMs).toISOString().slice(0, 13), HOUR_MAX) >= HOUR_MAX)
      return release(fail("rate", conf, { retry: Math.max(1, Math.ceil((3600e3 - (nowMs % 3600e3)) / 1000)) }));
    // 6. поля
    const f = await readFields(env, conf, b, nowMs);
    if (f.out) return release(f.out);
    const { name, phone, comment, cat, keys, m, any, date, time } = /** @type {any} */ (f);
    // 7. пределы записей: бронь (одновременные запросы этого экземпляра её видят)
    const lim = limitKeys(c, conf, ip, phone, nowMs), h = await sbHold(env.KV, lim.map(([k, max]) => /** @type {[string, number]} */ ([k, max])));
    if (h.over) return finish(limitHit(/** @type {string} */ ((lim.find(x => x[0] === h.over) || [])[2] || "day"), conf));
    hold = h;
    // 8. «идёт запись»
    await sbPut(env.KV, conf.id, rid, { st: "busy" }); marked = true;
    // 9–10. кандидаты, свежее время и book_check
    const ch = await choose(env, conf, f, any ? await candidates(env, conf, cat, m, keys, date, time, nowMs) : [m], t0, nowMs);
    if (!ch.pick) return finish(/** @type {Out} */ (ch.out));
    const x = ch.pick.x, sum = ch.pick.sum, end = pad(tStr(mins(time) + sum.min));
    const booking = { id: /** @type {any} */ (null), staff: { id: x.id, name: x.name, role: x.role }, any,
      services: keys.map(/** @param {string} k */ k => ({ key: k, name: cat.sv[k].name, price: cat.sv[k].by[x.id].price, min: cat.sv[k].by[x.id].min })),
      date, time, end, min: sum.min, total: sum.price, name, phone: maskPhone(phone) };
    const full = { ...booking, phone, comment };
    /** @type {"live" | "dry" | "unknown"} */ let kind = conf.mode === "live" ? "live" : "dry";
    /** @type {any} */ let rec = null;
    // 11. настоящая запись — только если успеваем ответить форме (срок ответа)
    if (conf.mode === "live") {
      if (Date.now() - t0 > BUDGET.record) return finish(fail("altegio", conf));
      sent = true;
      const host = siteHost(c), note = `Запись с сайта${host ? " " + host : ""}` + (any ? " · мастер на выбор" : "") + (comment ? " · " + comment : "");
      try {
        const d = (await altRecord(env, conf.loc, { phone, fullname: name, comment: note, appointments: ch.pick.appointments })).data;
        rec = (Array.isArray(d) ? d[0] : d) || null;
        if (!rec || !rec.record_id) kind = "unknown";
      } catch (/** @type {any} */ e) {
        const why = altWhy(e, false);
        altLog("record", e);
        altDropTimes(conf.loc); cacheDrop(ck(conf, "sn"));
        if (why === "unknown") kind = "unknown";
        else if (why === "phone") return release(badField("phone", conf)); // запись при 431 не создана (altRecord уже повторил номер без «+»)
        else if (why === "altegio") { // отказ: запись не создана — заявка администратору (и без Telegram данные клиента не пропадут)
          const t = tgText("fail", conf.name, full, whyAdmin(e));
          await saveLead(env, c, makeLead(c, conf, "fail", full, null, whyAdmin(e)));
          await count();
          later(defer, () => notify(env, t, c.id));
          return done(fail("refused", conf));
        } else {
          if (why === "service") cacheDrop(ck(conf, "sc"));
          return finish(why === "taken" ? await takenOut(env, conf, f, new Set([x.id]), t0, nowMs) : fail(why, conf));
        }
      }
      altDropTimes(conf.loc); cacheDrop(ck(conf, "sn"));
    }
    // 12. итог: счётчики пределов, заявка, ответ, Telegram после ответа
    if (kind === "live") booking.id = rec.record_id;
    await count();
    await saveLead(env, c, makeLead(c, conf, kind, full, rec));
    const t = tgText(kind, conf.name, { ...full, id: booking.id });
    later(defer, () => notify(env, t, c.id));
    return done(kind === "unknown" ? fail("unknown", conf) : { http: 200, res: { ok: true, mode: kind, booking } });
  } catch (e) {
    const o = stopped(e);
    if (o) return finish(o);
    if (sent) { console.log("site book after record", logSafe(String((e && /** @type {any} */ (e).stack) || e)).slice(0, 400)); await count(); return done(fail("unknown", conf)); } // запись могла создаться — повтор rid не должен создать вторую
    await release(fail("server", conf));
    throw e;
  } finally {
    if (hold) try { await hold.done(false); } catch (e) {} // бронь без записи снимается (после count — ничего не делает)
  }
}

// уведомление после ответа клиенту; без defer — сразу (сбой Telegram ответ не ломает)
/** @param {((f: () => Promise<any>) => void) | null | undefined} defer @param {() => Promise<any>} f */
function later(defer, f) {
  const run = () => f().catch(e => console.log("site tg", logSafe(String(e))));
  if (defer) defer(run); else run();
}
