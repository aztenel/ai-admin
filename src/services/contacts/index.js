// @ts-check
// Единая база контактов (этап 1, 31.10.2026): состояние и проверки, сегменты, список, карточка клиента, ручное добавление,
// согласия и запреты с историей. Источник правды — D1; «стоп» читается ещё и из KV (запрещено, если запрещено хоть где-то).
// Полные номера — только в карточке (как в пульте чатов), в списке — маской.
/** @import { Env, Client } from "../../lib/types.js" */
import { normPhone, maskPhone, fmtPhone, logSafe } from "../../lib/phone.js";
import { d1Ready, stageOf } from "../../db/d1/status.js";
import { syncRows } from "../../db/d1/sync.js";
import { contactNumbers, eventsOf, segmentCounts, contactsPage, contactCard, contactAdd, recompute } from "../../db/d1/contacts.js";
import { contactOne, consentAdd, restrictionAdd, restrictionLift, reviewKeep, blocksLeft, issueOpen, legacyImport, restrictionActiveId, refusedAt, consentLast, restrictionGet, CLIENT_SOURCES } from "../../db/d1/rights.js";
import { readHist } from "../../db/kv/chats.js";
import { optoutPhones, optoutPut, optoutDel, optoutGet, sweepGet } from "../../db/kv/optout.js";
import { gaRoute } from "../integrations/greenapi/webhook.js";
import { SRC, WINDOWS, syncWhy, realAllowed, syncPlan, initialInfo, newId, dirStatus } from "./sync.js";
import { SEGMENTS, READY, GAP_MS, segWhere, marketWhy } from "./segments.js";
import { stopPending } from "./stops.js";
import { searchOf, dayStart, dayOf } from "./normalize.js";
import { readTable, importPreview, importApply, importDiscard } from "./importer.js";

export const PER = 50;
const fail = (/** @type {string} */ code, /** @type {string} */ text, /** @type {string} */ field = "") => Object.assign(new Error(text), { code, field });
/** @param {any} v */
const n0 = v => (v == null ? null : +v);
// кто сделал — словами для карточки (в базе — короткие метки)
const ACTOR = /** @type {Record<string, string>} */ ({ owner: "владелец", staff: "сотрудник", webhook: "сообщение клиента", migration: "перенос из прежнего хранилища", sync: "синхронизация", "—": "—" });
/** @param {any} a */
const who = a => ACTOR[String(a)] || String(a || "");
/** строка из запроса — только строкой (подмена типа не проходит) @param {any} v */
const str = v => (typeof v === "string" ? v : "");
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
/** «14 ноября» по Астане. @param {number} t */
const dayWords = t => { const d = dayOf(t); return `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]}`; };

/**
 * Последнее сообщение клиента в переписке (оба номера) позже after — подтверждение «клиент сам написал». null — нет.
 * @param {Env} env @param {string} ws @param {string} phone @param {number} after
 */
async function clientWroteAfter(env, ws, phone, after) {
  let best = null;
  for (const ch of ["ga", "wa"]) {
    let h = null; try { h = await readHist(env, `h:${ch}:${ws}:${phone}`); } catch (e) {}
    for (const t of (h && h.turns) || []) if (t && t.role === "user" && +t.t > after && (!best || +t.t > best)) best = +t.t;
  }
  return best;
}
/** Когда клиент написал «стоп», если «стоп» лежит только в прежнем хранилище KV (0 — нет). @param {Env} env @param {string} ws @param {string} phone */
async function kvStopAt(env, ws, phone) {
  try { const v = await optoutGet(env, ws, phone); if (v == null) return 0; const s = String(v); return +(s.startsWith("meta:") ? s.slice(5) : s) || 1; } catch (e) { return 1; } // не прочиталось — считаем, что отказ был
}
/** Запрет поставил сам клиент («стоп», отказ в Meta, его «стоп» из KV)? Такой снимается только после нового подтверждённого согласия. @param {any} y */
const byClientOf = y => CLIENT_SOURCES.includes(String(y.source)) && (y.kind === "marketing_optout" || y.kind === "full_block") && !+y.needs_review;
/** Есть ли подтверждённое «да» позже момента at. @param {any} cs @param {number} at */
const consentAfter = (cs, at) => !!cs && cs.state === "granted" && +cs.confirmed === 1 && +(cs.given_at ?? cs.created_at) > at;
const NEED_CONSENT = "Клиент сам отказался от рассылок. Снять запрет можно только после его нового подтверждённого согласия: запишите его в блоке «Согласие» (сообщение клиента в WhatsApp или письменное согласие).";

/** База этого адреса или ошибка «нет базы». @param {Env} env @param {number} now */
async function dbOf(env, now) {
  const db = await d1Ready(env, now);
  if (!db) throw fail("db", env.DB ? "База контактов не отвечает или подключена чужая — проверьте /diag/storage." : "База контактов ещё не подключена к этому адресу.");
  return db;
}
/** «Стопы» из KV: прочитать не удалось — ошибка (иначе показали бы «можно писать» тому, кто просил не писать). @param {Env} env @param {string} ws */
async function kvStops(env, ws) {
  try { return await optoutPhones(env, ws); } catch (e) { throw fail("kv", "Не прочитался список «стоп» — попробуйте через минуту."); }
}

/** Состояние для экрана «Клиенты». @param {Env} env @param {Client} c @param {number} now @param {boolean} owner */
export async function contactsStatus(env, c, now, owner) {
  const base = { stage: stageOf(env), owner, client: { id: c.id, name: c.name } };
  const db = await d1Ready(env, now);
  if (!db) return { ...base, ready: false, why: env.DB ? "База контактов не отвечает или подключена чужая база — откройте /diag/storage." : "База контактов ещё не подключена к этому адресу. Сейчас работает прежняя база клиентов в «Рассылках»." };
  const ws = c.id;
  const [nums, rows, errs, probes, sweep] = await Promise.all([contactNumbers(db, ws, now), syncRows(db, ws, SRC), eventsOf(db, ws, ["sync_error", "sync_warn"], 10), eventsOf(db, ws, ["altegio_probe"], 1), sweepGet(env, ws)]);
  const by = Object.fromEntries(rows.map((/** @type {any} */ r) => [r.scope, r])), plan = syncPlan(rows, now), init = initialInfo(plan.initial);
  const scoped = ["initial", ...WINDOWS.map(w => w.scope)].map(s => by[s]).filter(Boolean);
  const lastOkAt = Math.max(0, ...scoped.map((/** @type {any} */ r) => +r.last_ok_at || 0)) || null;
  const lastErr = scoped.filter((/** @type {any} */ r) => r.last_error).sort((/** @type {any} */ a, /** @type {any} */ b) => b.last_error_at - a.last_error_at)[0];
  const hot = by.hot || {}, why = syncWhy(env, c), real = realAllowed(env), pend = stopPending(), ga = gaRoute(env, ws);
  /** @type {any} */ let stats = null; try { stats = JSON.parse(hot.stats || "null"); } catch (e) {}
  const probe = probes[0] ? (() => { try { const d = JSON.parse(probes[0].details || "{}"); return { at: +probes[0].at, ok: !!d.ok, summary: d.summary || [] }; } catch (e) { return null; } })() : null;
  const hotAge = hot.last_ok_at ? now - hot.last_ok_at : Infinity;
  // «ещё не проверено» — отдельный уровень unknown, не «всё хорошо» (находка владельца 31.10.2026: «ещё не было» выглядело успехом)
  const noData = !nums.contacts, noBookings = !nums.bookings, dir = by.clients || null, dirInfo = dirStatus(dir);
  const checks = [
    { id: "initial", label: "Первичная загрузка журнала Altegio", count: init.pct, level: !real ? "unknown" : init.done ? "ok" : plan.initial ? "warn" : "unknown", hint: !real ? "Не проверено: на черновике настоящий Altegio не загружается — только «Проверка без записи»." : init.done ? "Загружено." : plan.initial ? `Загружено ${init.pct}% — продолжится автоматически или кнопкой «Синхронизировать сейчас».` : "Ещё не начиналась." },
    { id: "directory", label: "Справочник клиентов Altegio (вся база)", count: dirInfo ? dirInfo.pct : 0, level: !real || !dirInfo ? "unknown" : dirInfo.lastError ? "bad" : dirInfo.done ? "ok" : "warn", hint: !real ? "Не проверено: на черновике справочник не загружается — число клиентов покажет «Проверка без записи»." : !dirInfo ? "Ещё не загружался." : dirInfo.lastError ? dirInfo.lastError : dirInfo.done ? `Загружено: ${dirInfo.total} клиентов.` : `Загружено ${dirInfo.pct}% из ${dirInfo.total}.` },
    { id: "fresh", label: "Свежесть данных (ближайшие дни), минут", count: Number.isFinite(hotAge) ? Math.round(hotAge / 60e3) : 0, level: !real || !Number.isFinite(hotAge) ? "unknown" : hotAge > 24 * 3600e3 ? "bad" : hotAge > 2 * 3600e3 ? "warn" : "ok", hint: !real ? "Не проверено: на черновике журнал Altegio не синхронизируется." : Number.isFinite(hotAge) ? `Обновлялось ${Math.round(hotAge / 60e3)} мин назад.` : "Ещё не обновлялось." },
    { id: "probe", label: "Поля Altegio проверены", count: probe ? probe.summary.length : 0, level: !probe ? "unknown" : probe.ok ? "ok" : "bad", hint: !probe ? "Ещё не проверялись — кнопка «Проверить поля Altegio»." : probe.ok ? "Проверка прошла, отчёт ниже." : "Проверка не прошла — смотрите отчёт." },
    { id: "visits", label: "Число визитов сходится с записями", count: nums.visitsMismatch, level: noData ? "unknown" : nums.visitsMismatch ? "bad" : "ok", hint: noData ? "Клиентов ещё нет — проверять нечего." : nums.visitsMismatch ? "Есть расхождения — «Синхронизировать сейчас» пересчитает." : "Сходится." },
    { id: "stale", label: "Прошедшие записи пересчитаны", count: nums.staleNext, level: noBookings ? "unknown" : nums.staleNext ? "warn" : "ok", hint: noBookings ? "Записей ещё нет — проверять нечего." : nums.staleNext ? "У части клиентов «ближайшая запись» уже прошла — пересчитается при следующей синхронизации." : "Всё пересчитано." },
    { id: "orphans", label: "Записи без номера (скрыт или неверный)", count: nums.orphanBookings, level: noBookings ? "unknown" : nums.orphanBookings ? "warn" : "ok", hint: noBookings ? "Записей ещё нет — проверять нечего." : nums.orphanBookings ? "Этих людей нет в базе контактов: у ключа журнала нет права видеть телефоны или номер записан с ошибкой." : "Нет." },
    { id: "issues", label: "«Стоп» записан не во все хранилища", count: nums.openIssues, level: nums.openIssues ? "bad" : "ok", hint: nums.openIssues ? "Дописывается автоматически каждые 5 минут; запрет уже действует." : "Расхождений нет." },
    { id: "pending", label: "«Стоп» не записался никуда", count: pend, level: pend ? "bad" : "ok", hint: pend ? "Повторяю; дальше выручит сверка журнала Green-API." : "Нет." },
    { id: "review", label: "Неоднозначные «стопы» ждут решения", count: nums.review, level: nums.review ? "warn" : "ok", hint: nums.review ? "Откройте карточку и решите: оставить запрет рекламы, закрыть всё или снять." : "Нет." },
    { id: "sweep", label: "Сверка «стопов» по журналу Green-API", count: sweep && sweep.found ? +sweep.found : 0, level: !ga || !sweep || !sweep.okAt ? "unknown" : sweep.err ? "bad" : "ok", hint: !ga ? "Не проверено: второй номер (Green-API) у этого адреса не подключён." : !sweep || !sweep.okAt ? "Ещё не проводилась (на черновике — кнопкой)." : sweep.err ? sweep.err : `Последняя — ${Math.round((now - sweep.okAt) / 60e3)} мин назад, найдено пропущенных: ${sweep.found || 0}.` },
    { id: "unknown", label: "Сообщения с неизвестным итогом", count: nums.unknownSends, level: nums.unknownSends ? "warn" : "ok", hint: nums.unknownSends ? "Решите в пульте: ушло или нет." : "Нет." }
  ];
  return {
    ...base, ready: true,
    counts: { contacts: nums.contacts, withVisits: nums.withVisits, upcoming: nums.upcoming, stops: nums.stops, review: nums.review },
    sync: {
      available: !why, ...(why ? { why } : {}), dryOnly: !real, initial: init, lastOkAt, lastError: lastErr ? String(lastErr.last_error) : null, lastErrorAt: lastErr ? +lastErr.last_error_at : null,
      running: !!(by.lock && +by.lock.lease_until > now),
      windows: WINDOWS.map(w => ({ scope: w.scope, label: w.label, lastOkAt: n0(by[w.scope] && by[w.scope].last_ok_at), lastError: (by[w.scope] && by[w.scope].last_error) || null })),
      stats: stats ? { records: +stats.records || 0, contacts: +stats.contacts || 0, bookings: +stats.bookings || 0, masked: +stats.masked || 0, bad: +stats.bad || 0, deleted: +stats.deleted || 0 } : null,
      directory: dirInfo
    },
    stops: { lastOkAt: (sweep && sweep.okAt) || null, lastError: (sweep && sweep.err) || null, found: (sweep && +sweep.found) || 0, channel: ga ? "ga" : null },
    probe, checks,
    errors: errs.map((/** @type {any} */ e) => { let d = {}; try { d = JSON.parse(e.details || "{}") || {}; } catch (x) {} return { at: +e.at, scope: String(/** @type {any} */ (d).scope || (e.kind === "sync_warn" ? "проверка" : "")), text: String(/** @type {any} */ (d).text || "") }; })
  };
}

/** @param {Env} env @param {Client} c @param {number} now */
export async function contactsSegments(env, c, now) {
  const db = await dbOf(env, now), stops = await kvStops(env, c.id);
  /** @type {{ segs: { id: string, count: number, ready: number }[], staff: { staff: string, count: number, ready: number }[] }} */
  const r = await segmentCounts(db, c.id, now, stops, GAP_MS, SEGMENTS, READY);
  return { at: now, segments: [...SEGMENTS.map((x, i) => ({ id: x.id, label: x.label, rule: x.rule, count: r.segs[i].count, ready: r.segs[i].ready })),
    ...r.staff.map(x => ({ id: "staff:" + x.staff, label: "Мастер: " + x.staff, rule: "последний визит у мастера", count: x.count, ready: x.ready }))] };
}

/** @param {Env} env @param {Client} c @param {number} now @param {{ q?: string, seg?: string, page?: number }} f */
export async function contactsList(env, c, now, f) {
  const sw = segWhere(f.seg || "all");
  if (!sw) throw fail("input", "Неизвестный сегмент.");
  const db = await dbOf(env, now), stops = await kvStops(env, c.id);
  const raw = String(f.q || "").trim().slice(0, 60), digits = raw.replace(/\D/g, ""), q = /^[\d\s+()-]+$/.test(raw) && digits.length >= 3 ? digits.replace(/^8(?=\d{10}$)/, "7") : raw.toLowerCase().replace(/ё/g, "е");
  const page = Math.max(1, Math.min(2000, Math.round(+(f.page || 1)) || 1));
  const r = await contactsPage(db, c.id, now, stops, GAP_MS, { where: sw.where, staff: sw.staff, q, page, per: PER });
  return {
    total: r.total, page, pages: Math.max(1, Math.ceil(r.total / PER)), per: PER,
    items: r.rows.map((/** @type {any} */ x) => ({ id: String(x.id), name: logSafe(x.name || ""), phone: maskPhone(x.phone), lastVisitAt: n0(x.lastv), daysAgo: n0(x.d), visits: +x.visits || 0, nextBookingAt: +x.booked ? n0(x.next_booking_at) : null,
      lastStaff: x.last_staff || null, consent: String(x.consent || "unknown"), consentConfirmed: !!+x.cconf, stop: !!+x.blocked, fullBlock: !!+x.full, review: !!+x.review, cooldownUntil: n0(x.cool_until), sources: String(x.sources || "").split(",").filter(Boolean) }))
  };
}

const EVENT_TEXT = /** @type {Record<string, (d: any) => string>} */ ({
  stop: d => `«Стоп» — реклама закрыта (${d.source === "ga_journal" ? "найдено сверкой журнала Green-API" : d.source === "admin" ? "вручную: " + (d.reason || "") : "сообщение клиента"})`,
  stop_review: d => `Неоднозначный «стоп» — ждёт решения: ${d.reason || ""}`,
  full_block: d => `Не писать вообще: ${d.reason || ""}`,
  lift: d => `Запрет снят: ${d.reason || ""}`,
  consent: d => `Согласие на ${d.purpose === "service" ? "сервисные" : "рекламные"} сообщения: ${d.state === "granted" ? "да" : d.state === "denied" ? "нет" : "не известно"} (${d.basis || ""})`,
  contact_added: () => "Добавлен вручную"
});
const EVIDENCE_TEXT = /** @type {Record<string, string>} */ ({ chat: "клиент написал в WhatsApp", document: "письменное согласие", oral: "устно в салоне", import: "из файла — не подтверждено", altegio: "флаг в Altegio — не подтверждено", client_stop: "клиент сам написал «стоп»" });

/** Карточка клиента. @param {Env} env @param {Client} c @param {number} now @param {string} id */
export async function contactsCard(env, c, now, id) {
  const db = await dbOf(env, now), stops = await kvStops(env, c.id);
  const r = await contactCard(db, c.id, String(id).slice(0, 40), now, stops, GAP_MS, SEGMENTS);
  if (!r) throw fail("missing", "Клиент не найден.");
  const k = r.k, x = r.contact, seg = k;
  const live = r.bookings.filter((/** @type {any} */ b) => !b.deleted);
  const cons = (/** @type {any} */ s) => ({ state: s.state, basis: s.basis, source: s.source, actor: who(s.actor), at: +s.created_at, confirmed: !!+s.confirmed, evidence: s.evidence || null, evidenceRef: s.evidence_ref || (s.evidence ? EVIDENCE_TEXT[s.evidence] || null : null), givenAt: n0(s.given_at) });
  const latest = (/** @type {string} */ p) => { const s = r.consents.find((/** @type {any} */ y) => y.purpose === p); return s ? cons(s) : null; };
  const lastM = r.consents.find((/** @type {any} */ y) => y.purpose === "marketing") || null;
  const restrictions = r.restrictions.map((/** @type {any} */ y) => {
    const active = y.lifted_at == null, byClient = byClientOf(y), canLift = active && (!byClient || consentAfter(lastM, +y.created_at));
    return { id: +y.id, kind: y.kind, reason: y.reason, source: y.source, actor: who(y.actor), at: +y.created_at, review: !!y.needs_review, liftedAt: n0(y.lifted_at), liftedBy: y.lifted_by ? who(y.lifted_by) : null,
      liftReason: y.lift_reason || null, active, byClient, untilAt: n0(y.until_at), canLift, liftHint: active && !canLift ? NEED_CONSENT : "" };
  });
  // «стоп» только в KV (до переноса в D1) — показываем как действующий запрет из старого хранилища (его поставил клиент)
  if (stops.includes(x.phone) && !restrictions.some((/** @type {any} */ y) => y.active && !y.review && (y.kind === "marketing_optout" || y.kind === "full_block"))) {
    let at = now; try { const v = String((await optoutGet(env, c.id, x.phone)) || ""); at = +(v.startsWith("meta:") ? v.slice(5) : v) || now; } catch (e) {}
    const canLift = consentAfter(lastM, at);
    restrictions.unshift({ id: 0, kind: "marketing_optout", reason: "«Стоп» в прежнем хранилище (KV)", source: "kv", actor: "—", at, review: false, liftedAt: null, liftedBy: null, liftReason: null, active: true, byClient: true, untilAt: null, canLift, liftHint: canLift ? "" : NEED_CONSENT });
  }
  const refused = await refusedAt(db, c.id, x.id), kvStop = restrictions.find((/** @type {any} */ y) => y.id === 0), refusal = Math.max(refused || 0, kvStop ? kvStop.at : 0) || null;
  const reasons = marketWhy(k);
  return {
    contact: { id: String(x.id), name: logSafe(x.name || ""), phone: fmtPhone(x.phone) || "+" + x.phone, altegioId: x.altegio_client_id || null, firstVisitAt: n0(x.first_visit_at), lastVisitAt: n0(k.lastv), daysAgo: n0(k.d), visits: +x.visits || 0,
      altVisits: n0(x.alt_visits), altLastVisitAt: n0(x.alt_last_visit_at), newsletter: x.alt_newsletter == null ? null : !!+x.alt_newsletter,
      nextBookingAt: x.next_booking_at > now ? +x.next_booking_at : null, lastStaff: x.last_staff || null, lastService: x.last_service || null, createdAt: +x.created_at, updatedAt: +x.updated_at, syncedAt: n0(x.synced_at),
      sources: r.sources.map((/** @type {any} */ s) => ({ source: s.source, at: +s.first_seen })) },
    visits: live.filter((/** @type {any} */ b) => b.starts_at <= now).slice(0, 100).map((/** @type {any} */ b) => ({ id: String(b.record_id), at: +b.starts_at, staff: b.staff || null, services: b.services || null, attendance: n0(b.attendance) })),
    upcoming: live.filter((/** @type {any} */ b) => b.starts_at > now).reverse().map((/** @type {any} */ b) => ({ id: String(b.record_id), at: +b.starts_at, staff: b.staff || null, services: b.services || null })),
    missed: live.filter((/** @type {any} */ b) => b.starts_at <= now && +b.attendance === -1).length,
    consent: { marketing: latest("marketing"), service: latest("service") },
    consentHistory: r.consents.map(cons),
    consentRules: { refusedAt: refusal, chatAvailable: !!(await clientWroteAfter(env, c.id, x.phone, refusal || 0)), oralAllowed: !refusal },
    restrictions,
    segments: SEGMENTS.filter((s, i) => s.id !== "all" && seg["s" + i]).map(s => ({ id: s.id, label: s.label })),
    canMarket: { ok: !reasons.length, reasons },
    events: r.events.map((/** @type {any} */ e) => { let d = {}; try { d = JSON.parse(e.details || "{}") || {}; } catch (x2) {} const f = EVENT_TEXT[e.kind]; return { at: +e.at, kind: e.kind, text: f ? f(d) : e.kind }; })
  };
}

/** Добавить вручную. @param {Env} env @param {Client} c @param {number} now @param {{ phone?: any, name?: any }} b @param {string} actor */
export async function contactsAdd(env, c, now, b, actor) {
  const p = normPhone(String(b.phone || "")).slice(1);
  if (!p) throw fail("input", "Номер не похож на казахстанский: +7 7XX XXX XX XX.", "phone");
  const name = String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
  const db = await dbOf(env, now);
  return { ok: true, ...(await contactAdd(db, c.id, { id: newId(), phone: p, name, search: searchOf(name, p), actor, at: now })) };
}

/**
 * Согласие вручную (решение владельца 31.10.2026). «Да» — только с доказательством, и тогда оно подтверждено:
 * chat — клиент сам написал в WhatsApp (сервер находит его сообщение, после отказа — позже отказа); document — письменное согласие с
 * номером и датой (после отказа — не раньше дня отказа); oral — устно в салоне, только если клиент никогда сам не отказывался.
 * Отказ записывается всегда (и он подтверждён: отказ клиента уважаем без доказательств).
 * @param {Env} env @param {Client} c @param {number} now @param {any} b @param {string} actor
 */
export async function contactsConsent(env, c, now, b, actor) {
  const purpose = str(b.purpose), state = str(b.state), evidence = str(b.evidence), ref = str(b.evidenceRef).replace(/\s+/g, " ").trim();
  let basis = str(b.basis).replace(/\s+/g, " ").trim();
  if (!["marketing", "service"].includes(purpose)) throw fail("input", "Неизвестный вид согласия.", "purpose");
  if (!["granted", "denied", "unknown"].includes(state)) throw fail("input", "Выберите: да, нет или не известно.", "state");
  const db = await dbOf(env, now), x = await contactOne(db, c.id, str(b.id));
  if (!x) throw fail("missing", "Клиент не найден.");
  if (state !== "granted") {
    await consentAdd(db, c.id, { contactId: x.id, purpose, state, basis: basis || (state === "denied" ? "отказ" : "—"), source: "manual", actor, at: now, evidence: ["chat", "document", "oral"].includes(evidence) ? evidence : null, evidenceRef: ref || null, confirmed: state === "denied", givenAt: now });
    return { ok: true };
  }
  if (!["chat", "document", "oral"].includes(evidence)) throw fail("input", "Выберите, чем подтверждено согласие: сообщение клиента, письменное согласие или устно в салоне.", "evidence");
  const refused = purpose === "marketing" ? Math.max((await refusedAt(db, c.id, x.id)) || 0, await kvStopAt(env, c.id, x.phone)) || null : null;
  let givenAt = now, evRef = ref;
  if (evidence === "chat") {
    const t = await clientWroteAfter(env, c.id, x.phone, refused || 0);
    if (!t) throw fail("consent", refused ? `После отказа (${dayWords(refused)}) клиент не писал в WhatsApp — подтверждения в переписке нет.` : "В переписке нет сообщений клиента — подтверждения нет.");
    givenAt = t; evRef = `сообщение клиента ${dayWords(t)}`;
  } else if (evidence === "document") {
    if (evRef.length < 3) throw fail("input", "Укажите номер письменного согласия или где оно хранится.", "evidenceRef");
    const g = /^\d{4}-\d{2}-\d{2}$/.test(str(b.givenAt)) ? dayStart(str(b.givenAt)) : NaN;
    if (!Number.isFinite(g)) throw fail("input", "Укажите дату согласия.", "givenAt");
    if (g > now) throw fail("input", "Дата согласия ещё не наступила.", "givenAt");
    if (refused && g + 86400e3 <= refused) throw fail("consent", `Согласие подписано раньше отказа клиента (${dayWords(refused)}) — нужно новое, не раньше этого дня.`);
    givenAt = refused ? Math.max(g, refused + 1) : g; // в день отказа: человек подтверждает, что подписано после «стопа»
  } else if (refused) throw fail("consent", "Клиент сам отказывался от рассылок — устного согласия мало: нужно его сообщение в WhatsApp или письменное согласие.");
  if (basis.length < 3) basis = evidence === "chat" ? "клиент написал в WhatsApp" : evidence === "document" ? "письменное согласие" : "устно в салоне";
  await consentAdd(db, c.id, { contactId: x.id, purpose, state, basis, source: "manual", actor, at: now, evidence, evidenceRef: evRef.slice(0, 200) || null, confirmed: true, givenAt });
  return { ok: true };
}

/** Зеркало «стопа» в KV; не записалось — расхождение для фоновой починки. @param {Env} env @param {any} db @param {string} ws @param {string} phone @param {'put'|'del'} op @param {number} now */
async function mirror(env, db, ws, phone, op, now) {
  try { if (op === "put") await optoutPut(env, ws, phone, String(now)); else await optoutDel(env, ws, phone); }
  catch (e) { await issueOpen(db, ws, "kv_write", `optout:${ws}:${phone}`, { op, at: now }, now); }
}

/** Запрет вручную. @param {Env} env @param {Client} c @param {number} now @param {any} b @param {string} actor */
export async function contactsRestrict(env, c, now, b, actor) {
  const kind = String(b.kind || ""), reason = String(b.reason || "").replace(/\s+/g, " ").trim();
  if (!["marketing_optout", "full_block"].includes(kind)) throw fail("input", "Неизвестный вид запрета.", "kind");
  if (reason.length < 3) throw fail("input", "Укажите причину запрета.", "reason");
  const db = await dbOf(env, now), x = await contactOne(db, c.id, String(b.id || ""));
  if (!x) throw fail("missing", "Клиент не найден.");
  await restrictionAdd(db, c.id, { contactId: x.id, kind, reason, source: "admin", actor, at: now });
  await mirror(env, db, c.id, x.phone, "put", now);
  return { ok: true };
}

/**
 * Снять запрет (только владелец — проверяется здесь, а не только в контроллере; причина обязательна). rid 0 — «стоп» из KV:
 * сначала переносится в D1.
 * @param {Env} env @param {Client} c @param {number} now @param {any} b @param {string} actor @param {boolean} owner
 */
export async function contactsLift(env, c, now, b, actor, owner) {
  if (!owner) throw fail("forbidden", "Снять запрет может только владелец.");
  const reason = typeof b.reason === "string" ? b.reason.replace(/\s+/g, " ").trim() : "";
  if (reason.length < 3) throw fail("input", "Укажите причину: почему снова можно писать.", "reason");
  const db = await dbOf(env, now), x = await contactOne(db, c.id, String(b.id || ""));
  if (!x) throw fail("missing", "Клиент не найден.");
  let rid = Math.round(+b.rid) || 0;
  const cs = await consentLast(db, c.id, x.id);
  if (!rid) { // «стоп» из KV поставил клиент: сначала — новое подтверждённое согласие
    let at = now; try { const v = String((await optoutGet(env, c.id, x.phone)) || ""); at = +(v.startsWith("meta:") ? v.slice(5) : v) || now; } catch (e) {}
    if (!consentAfter(cs, at)) throw fail("consent", NEED_CONSENT);
    await legacyImport(db, c.id, [{ id: newId(), p: x.phone, at, meta: 0 }], now); rid = await restrictionActiveId(db, c.id, x.id, "marketing_optout");
  }
  const row = rid ? await restrictionGet(db, c.id, x.id, rid) : null;
  if (!row || row.lifted_at != null) throw fail("missing", "Запрет не найден или уже снят.");
  if (byClientOf(row) && !consentAfter(cs, +row.created_at)) throw fail("consent", NEED_CONSENT); // отказ клиента не обходится без его нового согласия
  const kind = await restrictionLift(db, c.id, { contactId: x.id, rid, by: actor, reason, at: now });
  if (!kind) throw fail("missing", "Запрет не найден или уже снят.");
  if (!(await blocksLeft(db, c.id, x.id))) await mirror(env, db, c.id, x.phone, "del", now);
  return { ok: true };
}

/**
 * Решение по неоднозначному «стопу»: keep — оставить запрет рекламы, all — закрыть всё, lift — снять (только владелец).
 * Решение — только строкой: ["lift"] через String() стал бы «lift» в обход проверки прав (находка проверки безопасности 31.10.2026).
 * @param {Env} env @param {Client} c @param {number} now @param {any} b @param {string} actor @param {boolean} owner
 */
export async function contactsReview(env, c, now, b, actor, owner) {
  const decision = typeof b.decision === "string" ? b.decision : "", rid = Math.round(+b.rid) || 0;
  if (!["keep", "all", "lift"].includes(decision)) throw fail("input", "Неизвестное решение.", "decision");
  if (decision === "lift") return contactsLift(env, c, now, b, actor, owner);
  const db = await dbOf(env, now), x = await contactOne(db, c.id, String(b.id || ""));
  if (!x) throw fail("missing", "Клиент не найден.");
  if (!(await reviewKeep(db, c.id, x.id, rid, actor, now))) throw fail("missing", "Решение уже принято.");
  if (decision === "all") await restrictionAdd(db, c.id, { contactId: x.id, kind: "full_block", reason: String(b.reason || "").trim() || "решение по неоднозначному «стопу»: не писать вообще", source: "admin", actor, at: now });
  await mirror(env, db, c.id, x.phone, "put", now); // запрет рекламы подтверждён — его должны видеть и бот, и старый код
  return { ok: true };
}

// ---- импорт (обёртки: база этого адреса)
/** @param {Env} env @param {Client} c @param {number} now @param {Uint8Array} bytes @param {string} name @param {string} actor */
export async function contactsImport(env, c, now, bytes, name, actor) {
  const db = await dbOf(env, now);
  return importPreview(db, c.id, await readTable(bytes, name), { id: newId(), by: actor, at: now, sourceName: name });
}
/** @param {Env} env @param {Client} c @param {number} now @param {any} b @param {string} actor */
export async function contactsImportConfirm(env, c, now, b, actor) {
  const db = await dbOf(env, now), r = await importApply(db, c.id, String(b.id || ""), { basis: String(b.consentBasis || ""), actor, at: now });
  if (!r.ok) throw fail("done", "Этот файл уже загружен или отменён.");
  return r;
}
/** @param {Env} env @param {Client} c @param {number} now @param {any} b */
export async function contactsImportDiscard(env, c, now, b) {
  const db = await dbOf(env, now);
  return { ok: await importDiscard(db, c.id, String(b.id || ""), now) };
}
/** Пересчитать сводку всех клиентов (после ручной синхронизации, если числа визитов не сошлись). @param {Env} env @param {Client} c @param {number} now */
export async function contactsRecompute(env, c, now) {
  const db = await dbOf(env, now), nums = await contactNumbers(db, c.id, now);
  return nums.visitsMismatch || nums.staleNext ? recompute(db, c.id, now, "all") : 0;
}
