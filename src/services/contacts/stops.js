// @ts-check
// «СТОП» без опоры на повторную доставку вебхука (этап 1, 31.10.2026, требование владельца). Green-API не обязан прислать
// вебхук ещё раз, а сбой обработки после ответа 200 повтора не вызывает вообще — поэтому:
// 1. запрет пишется сразу в оба хранилища (KV — зеркало для бота и старого кода, D1 — новая база), каждое — с повторами;
// 2. не записалось одно — след для фоновой починки (D1 sync_issues или KV syncerr:), запрет действует по второму хранилищу;
// 3. не записалось никуда — память экземпляра, сигнал в Telegram и, главное,
// 4. сверка журнала входящих Green-API (lastIncomingMessages) каждые 10 минут: «стоп», который не дошёл до нас вебхуком или
//    потерялся при сбое, находится там и записывается заново. Сверка ничего не отправляет.
// Неоднозначный «стоп» («стоп, я перепутал время») — только в D1, с пометкой «ждёт решения»: маркетинг закрыт до решения человека,
// бот и напоминания по записи работают как раньше (решение владельца 31.10.2026).
/** @import { Env } from "../../lib/types.js" */
import { CLIENTS, DEMO_IDS } from "../../config/builtin-clients.js";
import { maskPhone, logSafe } from "../../lib/phone.js";
import { local } from "../../lib/time.js";
import { stopKind } from "../conversation/stop-words.js";
import { gaCall } from "../integrations/greenapi/client.js";
import { gaRoute } from "../integrations/greenapi/webhook.js";
import { notifyOnce } from "../notifications/telegram.js";
import { d1Ready } from "../../db/d1/status.js";
import { contactFor, restrictionAdd, issueOpen, issueClose, issuesOpen, blocksLeft, legacyImport, blockedCount, auditAdd, consentAdd } from "../../db/d1/rights.js";
import { contactsByPhones } from "../../db/d1/contacts.js";
import { importsExpire } from "../../db/d1/imports.js";
import { optoutGet, optoutPut, optoutDel, kvKeys, syncerrPut, syncerrDel, sweepGet, sweepPut } from "../../db/kv/optout.js";

/** @typedef {{ ws: string, phone: string, kind: 'stop'|'review', source: string, actor?: string, eventKey?: string, text?: string, at: number }} StopIn */

const sleep = (/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms));
const newId = () => crypto.randomUUID().replace(/-/g, "");
// не записалось никуда — повторяем из памяти экземпляра (фоновая починка), пока экземпляр жив; дальше выручает сверка журнала
/** @type {Map<string, StopIn>} */
const PENDING = new Map();
export const stopPending = () => PENDING.size;

/** @param {() => Promise<any>} f @param {number[]} waits */
async function tries(f, waits) {
  let last;
  for (const ms of [0, ...waits]) { if (ms) await sleep(ms); try { await f(); return true; } catch (e) { last = e; } }
  console.log("stop write", String(last).slice(0, 160));
  return false;
}

/** D1: 'ok' — записано (или уже было), 'skip' — базы у этого адреса нет, 'fail' — база есть, но не ответила. @param {Env} env @param {StopIn} x */
async function d1Stop(env, x) {
  if (!env.DB) return "skip";
  const db = await d1Ready(env, Date.now(), true); // готовность — на сейчас (сообщение бывает давним: починка, сверка) и без минутного ожидания после сбоя
  if (!db) return "fail";
  const ok = await tries(async () => {
    const id = await contactFor(db, x.ws, x.phone, newId(), x.at);
    const added = await restrictionAdd(db, x.ws, { contactId: id, kind: "marketing_optout", reason: x.kind === "review" ? `Неоднозначно: «${String(x.text || "").slice(0, 120)}»` : "STOP", source: x.source, actor: x.actor || "webhook", review: x.kind === "review", at: x.at, eventKey: x.eventKey || undefined });
    // ясный «стоп» — это и отказ клиента от рассылок: запись в истории согласий (снять запрет потом — только с его новым подтверждённым «да»)
    if (added && x.kind === "stop") await consentAdd(db, x.ws, { contactId: id, purpose: "marketing", state: "denied", basis: "клиент написал «стоп»", source: x.source, actor: x.actor || "webhook", at: x.at, evidence: "client_stop", evidenceRef: x.text ? `«${String(x.text).slice(0, 60)}»` : null, confirmed: true, givenAt: x.at });
  }, [300]);
  return ok ? "ok" : "fail";
}

/**
 * Записать «стоп». kvDone — KV уже записан вызывающим (true) или не записался (false); не задан — пишем сами.
 * @param {Env} env @param {StopIn & { kvDone?: boolean }} x
 * @returns {Promise<{ kv: string, d1: string }>}
 */
export async function stopRecord(env, x) {
  if (!x.ws || !/^\d{8,15}$/.test(x.phone)) return { kv: "skip", d1: "skip" };
  const review = x.kind === "review";
  const [kv, d1] = await Promise.all([
    review ? "skip" : x.kvDone === true ? "ok" : x.kvDone === false ? "fail" : tries(() => optoutPut(env, x.ws, x.phone, String(x.at)), [300, 1100]).then(ok => ok ? "ok" : "fail"),
    d1Stop(env, x)
  ]);
  const who = maskPhone(x.phone);
  if (d1 === "fail") { // D1 не ответила: след в KV — фоновая починка допишет в D1
    const marked = await tries(() => syncerrPut(env, x.ws, x.phone, { kind: x.kind, source: x.source, at: x.at, key: x.eventKey || "", text: review ? String(x.text || "").slice(0, 120) : "" }), [300, 1100]);
    if (!marked && kv !== "ok") PENDING.set(`${x.ws}:${x.phone}:${x.kind}`, x);
  }
  if (kv === "fail" && d1 === "ok") { // KV не записался: запрет уже в D1, починка допишет зеркало
    try { const db = await d1Ready(env, x.at); if (db) await issueOpen(db, x.ws, "kv_write", `optout:${x.ws}:${x.phone}`, { op: "put", at: x.at }, x.at); }
    catch (e) { PENDING.set(`${x.ws}:${x.phone}:${x.kind}`, x); }
  }
  if (kv === "fail" && d1 !== "ok") PENDING.set(`${x.ws}:${x.phone}:${x.kind}`, x);
  if (kv === "fail" || d1 === "fail") {
    const lost = kv !== "ok" && d1 !== "ok";
    try { await notifyOnce(env, lost ? `stoplost:${x.ws}:${x.phone}` : `stopfail:${x.ws}`, lost ? `⚠️ «Стоп» от клиента ${who} не записался ни в одно хранилище. Повторю сам и сверю по журналу Green-API; до этого не пишите ему рекламу вручную.`
      : `⚠️ «Стоп» от клиента ${who} записан не во все хранилища — допишу автоматически, запрет уже действует.`, x.ws); } catch (e) {}
  }
  return { kv, d1 };
}

/** «Стоп» в сообщении клиента (ясный или неоднозначный) → запись. Вебхуки, бот выключен. @param {Env} env @param {string} ws @param {string} phone @param {any} text @param {{ msgId?: string, source?: string }} [info] */
export async function stopSeen(env, ws, phone, text, info = {}) {
  const kind = stopKind(text);
  if (!kind) return null;
  return stopRecord(env, { ws, phone: String(phone), kind, source: info.source || "chat_stop", eventKey: info.msgId ? "in:" + info.msgId : "", text: String(text || ""), at: Date.now() });
}

// ---- сверка журнала входящих Green-API
/** Текст входящего из журнала Green-API (поля — по документации, вживую не проверено). @param {any} m */
const textOf = m => String((m && (m.textMessage || (m.extendedTextMessage && m.extendedTextMessage.text) || (m.extendedTextMessageData && m.extendedTextMessageData.text))) || "");

/**
 * Каждые 10 минут (или кнопкой владельца): входящие второго номера за время с прошлой сверки (+30 минут запаса, не больше суток)
 * → «стопы», которых нет в KV, записываются. only — одна компания (кнопка); force — без расписания.
 * @param {Env} env @param {number} now @param {{ only?: string, force?: boolean }} [opts]
 */
export async function stopSweep(env, now, opts = {}) {
  if (!opts.force && local(now).getUTCMinutes() % 10 !== 7) return [];
  const out = [];
  for (const c of Object.values(CLIENTS)) {
    if ((opts.only && c.id !== opts.only) || (!opts.only && (c.off || DEMO_IDS.has(c.id)))) continue;
    const r = gaRoute(env, c.id);
    if (!r || /** @type {any} */ (r).shared) { if (opts.only) out.push({ ws: c.id, ok: false, setup: true, error: "Второй номер (Green-API) у этой компании не подключён." }); continue; }
    const st = (await sweepGet(env, c.id)) || {}, since = st.okAt || now - 86400e3;
    const minutes = Math.max(60, Math.min(1440, Math.ceil((now - since) / 60e3) + 30));
    const res = await gaCall(r, "lastIncomingMessages", null, 15000, `minutes=${minutes}`);
    if (!res.ok || !Array.isArray(res.j)) {
      const error = res.status ? `Green-API ответил ${res.status} на запрос журнала входящих` : "Green-API не ответил на запрос журнала входящих";
      try { await sweepPut(env, c.id, { ...st, errAt: now, err: error }); } catch (e) {}
      out.push({ ws: c.id, ok: false, error }); continue;
    }
    let found = 0, review = 0, stops = 0;
    for (const m of res.j) {
      const chat = String((m && m.chatId) || "");
      if (!chat.endsWith("@c.us")) continue;
      const phone = chat.replace(/\D/g, ""), kind = stopKind(textOf(m));
      if (!kind || !/^\d{8,15}$/.test(phone)) continue;
      const at = +(m.timestamp || 0) * 1000 || now, key = m.idMessage ? "in:" + m.idMessage : "";
      if (kind === "review") { review++; await stopRecord(env, { ws: c.id, phone, kind, source: "ga_journal", eventKey: key, text: textOf(m), at }); continue; }
      stops++;
      let have = null; try { have = await optoutGet(env, c.id, phone); } catch (e) {}
      if (have) { if (env.DB) await d1Stop(env, { ws: c.id, phone, kind, source: "ga_journal", eventKey: key, at }); continue; } // уже в KV — D1 (если есть) догоняем
      found++;
      await stopRecord(env, { ws: c.id, phone, kind, source: "ga_journal", eventKey: key, text: textOf(m), at });
    }
    try { await sweepPut(env, c.id, { okAt: now, checked: res.j.length, stops, review, found, err: null, errAt: null }); } catch (e) {}
    if (found) { try { await notifyOnce(env, `stopsweep:${c.id}`, `⚠️ Сверка журнала Green-API нашла «стоп», которого не было в обработанных сообщениях (вебхук не дошёл или был сбой): ${found}. Записал — этим клиентам реклама не уйдёт.`, c.id); } catch (e) {} }
    out.push({ ws: c.id, ok: true, checked: res.j.length, stops, review, found, minutes });
  }
  return out;
}

/**
 * Фоновая починка расхождений (каждые 5 минут): отметки syncerr: → D1; открытые sync_issues → зеркало KV; «стопы» из памяти;
 * заодно удаляет брошенные предпросмотры импорта старше суток. Без базы D1 — только память (KV). → сколько исправлено.
 * @param {Env} env @param {number} now @param {boolean} [force]
 */
export async function syncFix(env, now, force) {
  if (!force && local(now).getUTCMinutes() % 5 !== 4) return 0;
  let n = 0;
  for (const [k, x] of [...PENDING]) { PENDING.delete(k); const r = await stopRecord(env, { ...x, at: x.at }); if (r.kv !== "fail" || r.d1 === "ok") n++; }
  const db = env.DB ? await d1Ready(env, now) : null;
  if (!db) return n;
  for (const k of await kvKeys(env, "syncerr:", true, 500)) {
    const [, ws, phone] = k.name.split(":");
    /** @type {any} */ let info = {}; try { info = JSON.parse(k.value || "{}") || {}; } catch (e) {}
    if (!ws || !/^\d{8,15}$/.test(phone || "")) { try { await syncerrDel(env, k.name); } catch (e) {} continue; }
    const r = await d1Stop(env, { ws, phone, kind: info.kind === "review" ? "review" : "stop", source: String(info.source || "kv_fallback"), eventKey: String(info.key || ""), text: String(info.text || ""), at: +info.at || now });
    if (r !== "ok") continue;
    try { await issueOpen(db, ws, "d1_write", `optout:${ws}:${phone}`, { from: "syncerr" }, now); await issueClose(db, ws, "d1_write", `optout:${ws}:${phone}`, now); await syncerrDel(env, k.name); n++; } catch (e) {}
  }
  for (const it of await issuesOpen(db, 100)) {
    if (it.kind !== "kv_write") continue;
    const [, ws, phone] = String(it.key).split(":");
    /** @type {any} */ let d = {}; try { d = JSON.parse(it.details || "{}") || {}; } catch (e) {}
    try {
      if (d.op === "del") { const rows = await contactsByPhones(db, ws, [phone]); const c = rows.get(phone); if (!c || !(await blocksLeft(db, ws, c.id))) await optoutDel(env, ws, phone); }
      else await optoutPut(env, ws, phone, String(d.at || now));
      await issueClose(db, ws, "kv_write", it.key, now); n++;
    } catch (e) { await issueOpen(db, ws, "kv_write", it.key, d, now); }
  }
  try { await importsExpire(db, now - 86400e3); } catch (e) {} // брошенные предпросмотры импорта (номера из файла) — не дольше суток
  return n;
}

/**
 * Перенос «стопов» из KV в D1 (идемпотентно, пачками по 500) или проверка без записи (dry). Ключи KV не трогаем.
 * @param {Env} env @param {string} ws @param {number} now @param {boolean} dry
 */
export async function optoutMigrate(env, ws, now, dry) {
  const db = await d1Ready(env, now);
  if (!db) throw Object.assign(new Error("База контактов не подключена."), { code: "db" });
  const keys = await kvKeys(env, `optout:${ws}:`, true), /** @type {{ id: string, p: string, at: number, meta: number }[]} */ rows = [];
  let bad = 0, meta = 0;
  for (const k of keys) {
    const p = k.name.slice(`optout:${ws}:`.length), v = String(k.value || "");
    if (!/^\d{8,15}$/.test(p)) { bad++; continue; }
    const isMeta = v.startsWith("meta:"), at = +(isMeta ? v.slice(5) : v) || now;
    if (isMeta) meta++;
    rows.push({ id: newId(), p, at, meta: isMeta ? 1 : 0 });
  }
  const blocked = () => blockedCount(db, ws, rows.map(r => r.p));
  const before = await blocked();
  let added = 0;
  if (!dry) for (let i = 0; i < rows.length; i += 500) added += await legacyImport(db, ws, rows.slice(i, i + 500), now);
  const after = dry ? before : await blocked();
  const summary = [
    `Ключей «стоп» в KV: ${keys.length}; из них кнопка Meta: ${meta}; неверных ключей: ${bad}`,
    `Уже есть действующий запрет в D1: ${before} из ${rows.length}`,
    dry ? "Проверка без записи — в D1 ничего не записано." : `Перенесено сейчас: ${added}; после переноса с запретом в D1: ${after} из ${rows.length} — ${after === rows.length ? "совпадает ✅" : "не совпадает ❌"}`,
    "Ключи KV не удалялись."
  ];
  if (!dry) { try { await auditAdd(db, ws, "owner", "optout_migrate", null, { keys: keys.length, added, after }, now); } catch (e) { console.log("migrate audit", logSafe(String(e))); } }
  return { summary, keys: keys.length, valid: rows.length, bad, meta, before, added, after };
}
