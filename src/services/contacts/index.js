// @ts-check
// Единая база контактов (этап 1, 31.10.2026): состояние и проверки, сегменты, список, карточка клиента, ручное добавление,
// согласия и запреты с историей. Источник правды — D1; «стоп» читается ещё и из KV (запрещено, если запрещено хоть где-то).
// Полные номера — только в карточке (как в пульте чатов), в списке — маской.
/** @import { Env, Client } from "../../lib/types.js" */
import { normPhone, maskPhone, fmtPhone, logSafe } from "../../lib/phone.js";
import { d1Ready, stageOf } from "../../db/d1/status.js";
import { syncRows } from "../../db/d1/sync.js";
import { contactNumbers, eventsOf, segmentCounts, contactsPage, contactCard, contactAdd, recompute } from "../../db/d1/contacts.js";
import { contactOne, consentAdd, restrictionAdd, restrictionLift, reviewKeep, blocksLeft, issueOpen, legacyImport, restrictionActiveId } from "../../db/d1/rights.js";
import { optoutPhones, optoutPut, optoutDel, optoutGet, sweepGet } from "../../db/kv/optout.js";
import { gaRoute } from "../integrations/greenapi/webhook.js";
import { SRC, WINDOWS, syncWhy, realAllowed, syncPlan, initialInfo, newId } from "./sync.js";
import { SEGMENTS, READY, GAP_MS, segWhere, marketWhy } from "./segments.js";
import { stopPending } from "./stops.js";
import { searchOf } from "./normalize.js";
import { readTable, importPreview, importApply, importDiscard } from "./importer.js";

export const PER = 50;
const fail = (/** @type {string} */ code, /** @type {string} */ text, /** @type {string} */ field = "") => Object.assign(new Error(text), { code, field });
/** @param {any} v */
const n0 = v => (v == null ? null : +v);

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
  const checks = [
    { id: "initial", label: "Первичная загрузка из Altegio", count: init.pct, level: init.done ? "ok" : "warn", hint: init.done ? "Загружено." : real ? `Загружено ${init.pct}% — продолжится автоматически или кнопкой «Синхронизировать сейчас».` : "На черновике настоящий Altegio не загружается — только «Проверка без записи»." },
    { id: "fresh", label: "Свежесть данных (ближайшие дни)", count: Number.isFinite(hotAge) ? Math.round(hotAge / 60e3) : -1, level: !init.done || !real ? "ok" : hotAge > 24 * 3600e3 ? "bad" : hotAge > 2 * 3600e3 ? "warn" : "ok", hint: Number.isFinite(hotAge) ? `Обновлялось ${Math.round(hotAge / 60e3)} мин назад.` : "Ещё не обновлялось." },
    { id: "visits", label: "Число визитов сходится с записями", count: nums.visitsMismatch, level: nums.visitsMismatch ? "bad" : "ok", hint: nums.visitsMismatch ? "Есть расхождения — «Синхронизировать сейчас» пересчитает." : "Сходится." },
    { id: "stale", label: "Прошедшие записи пересчитаны", count: nums.staleNext, level: nums.staleNext ? "warn" : "ok", hint: nums.staleNext ? "У части клиентов «ближайшая запись» уже прошла — пересчитается при следующей синхронизации." : "Всё пересчитано." },
    { id: "orphans", label: "Записи без номера (скрыт или неверный)", count: nums.orphanBookings, level: nums.orphanBookings ? "warn" : "ok", hint: nums.orphanBookings ? "Этих людей нет в базе контактов: у ключа журнала нет права видеть телефоны или номер записан с ошибкой." : "Нет." },
    { id: "issues", label: "«Стоп» записан не во все хранилища", count: nums.openIssues, level: nums.openIssues ? "bad" : "ok", hint: nums.openIssues ? "Дописывается автоматически каждые 5 минут; запрет уже действует." : "Расхождений нет." },
    { id: "pending", label: "«Стоп» не записался никуда", count: pend, level: pend ? "bad" : "ok", hint: pend ? "Повторяю; дальше выручит сверка журнала Green-API." : "Нет." },
    { id: "review", label: "Неоднозначные «стопы» ждут решения", count: nums.review, level: nums.review ? "warn" : "ok", hint: nums.review ? "Откройте карточку и решите: оставить запрет рекламы, закрыть всё или снять." : "Нет." },
    { id: "sweep", label: "Сверка «стопов» по журналу Green-API", count: sweep && sweep.found ? +sweep.found : 0, level: !ga ? "ok" : !sweep || !sweep.okAt ? "warn" : sweep.err ? "bad" : "ok", hint: !ga ? "Второй номер не подключён — сверять нечего." : !sweep || !sweep.okAt ? "Ещё не проводилась (на черновике — кнопкой)." : sweep.err ? sweep.err : `Последняя — ${Math.round((now - sweep.okAt) / 60e3)} мин назад, найдено пропущенных: ${sweep.found || 0}.` },
    { id: "unknown", label: "Сообщения с неизвестным итогом", count: nums.unknownSends, level: nums.unknownSends ? "warn" : "ok", hint: nums.unknownSends ? "Решите в пульте: ушло или нет." : "Нет." }
  ];
  return {
    ...base, ready: true,
    counts: { contacts: nums.contacts, withVisits: nums.withVisits, upcoming: nums.upcoming, stops: nums.stops, review: nums.review },
    sync: {
      available: !why, ...(why ? { why } : {}), dryOnly: !real, initial: init, lastOkAt, lastError: lastErr ? String(lastErr.last_error) : null, lastErrorAt: lastErr ? +lastErr.last_error_at : null,
      running: !!(by.lock && +by.lock.lease_until > now),
      windows: WINDOWS.map(w => ({ scope: w.scope, label: w.label, lastOkAt: n0(by[w.scope] && by[w.scope].last_ok_at), lastError: (by[w.scope] && by[w.scope].last_error) || null })),
      stats: stats ? { records: +stats.records || 0, contacts: +stats.contacts || 0, bookings: +stats.bookings || 0, masked: +stats.masked || 0, bad: +stats.bad || 0, deleted: +stats.deleted || 0 } : null
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
    items: r.rows.map((/** @type {any} */ x) => ({ id: String(x.id), name: logSafe(x.name || ""), phone: maskPhone(x.phone), lastVisitAt: n0(x.last_visit_at), visits: +x.visits || 0, nextBookingAt: +x.booked ? n0(x.next_booking_at) : null,
      lastStaff: x.last_staff || null, consent: String(x.consent || "unknown"), stop: !!+x.blocked, fullBlock: !!+x.full, review: !!+x.review, sources: String(x.sources || "").split(",").filter(Boolean) }))
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

/** Карточка клиента. @param {Env} env @param {Client} c @param {number} now @param {string} id */
export async function contactsCard(env, c, now, id) {
  const db = await dbOf(env, now), stops = await kvStops(env, c.id);
  const r = await contactCard(db, c.id, String(id).slice(0, 40), now, stops, GAP_MS, SEGMENTS);
  if (!r) throw fail("missing", "Клиент не найден.");
  const k = r.k, x = r.contact, seg = k;
  const live = r.bookings.filter((/** @type {any} */ b) => !b.deleted);
  const latest = (/** @type {string} */ p) => { const s = r.consents.find((/** @type {any} */ y) => y.purpose === p); return s ? { state: s.state, basis: s.basis, source: s.source, actor: s.actor, at: +s.created_at } : null; };
  const restrictions = r.restrictions.map((/** @type {any} */ y) => ({ id: +y.id, kind: y.kind, reason: y.reason, source: y.source, actor: y.actor, at: +y.created_at, review: !!y.needs_review, liftedAt: n0(y.lifted_at), liftedBy: y.lifted_by || null, liftReason: y.lift_reason || null, active: y.lifted_at == null }));
  // «стоп» только в KV (до переноса в D1) — показываем как действующий запрет из старого хранилища
  if (stops.includes(x.phone) && !restrictions.some((/** @type {any} */ y) => y.active && !y.review && (y.kind === "marketing_optout" || y.kind === "full_block"))) {
    let at = now; try { const v = String((await optoutGet(env, c.id, x.phone)) || ""); at = +(v.startsWith("meta:") ? v.slice(5) : v) || now; } catch (e) {}
    restrictions.unshift({ id: 0, kind: "marketing_optout", reason: "«Стоп» в прежнем хранилище (KV)", source: "kv", actor: "—", at, review: false, liftedAt: null, liftedBy: null, liftReason: null, active: true });
  }
  const reasons = marketWhy(k);
  return {
    contact: { id: String(x.id), name: logSafe(x.name || ""), phone: fmtPhone(x.phone) || "+" + x.phone, altegioId: x.altegio_client_id || null, firstVisitAt: n0(x.first_visit_at), lastVisitAt: n0(x.last_visit_at), visits: +x.visits || 0,
      nextBookingAt: x.next_booking_at > now ? +x.next_booking_at : null, lastStaff: x.last_staff || null, lastService: x.last_service || null, createdAt: +x.created_at, updatedAt: +x.updated_at, syncedAt: n0(x.synced_at),
      sources: r.sources.map((/** @type {any} */ s) => ({ source: s.source, at: +s.first_seen })) },
    visits: live.filter((/** @type {any} */ b) => b.starts_at <= now).slice(0, 100).map((/** @type {any} */ b) => ({ id: String(b.record_id), at: +b.starts_at, staff: b.staff || null, services: b.services || null, attendance: n0(b.attendance) })),
    upcoming: live.filter((/** @type {any} */ b) => b.starts_at > now).reverse().map((/** @type {any} */ b) => ({ id: String(b.record_id), at: +b.starts_at, staff: b.staff || null, services: b.services || null })),
    missed: live.filter((/** @type {any} */ b) => b.starts_at <= now && +b.attendance === -1).length,
    consent: { marketing: latest("marketing"), service: latest("service") },
    consentHistory: r.consents.map((/** @type {any} */ y) => ({ purpose: y.purpose, state: y.state, basis: y.basis, source: y.source, actor: y.actor, at: +y.created_at })),
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

/** @param {Env} env @param {Client} c @param {number} now @param {any} b @param {string} actor */
export async function contactsConsent(env, c, now, b, actor) {
  const purpose = String(b.purpose || ""), state = String(b.state || ""), basis = String(b.basis || "").replace(/\s+/g, " ").trim();
  if (!["marketing", "service"].includes(purpose)) throw fail("input", "Неизвестный вид согласия.", "purpose");
  if (!["granted", "denied", "unknown"].includes(state)) throw fail("input", "Выберите: да, нет или не известно.", "state");
  if (state === "granted" && basis.length < 3) throw fail("input", "Укажите основание согласия: где и как клиент согласился.", "basis");
  const db = await dbOf(env, now), x = await contactOne(db, c.id, String(b.id || ""));
  if (!x) throw fail("missing", "Клиент не найден.");
  await consentAdd(db, c.id, { contactId: x.id, purpose, state, basis: basis || (state === "denied" ? "отказ" : "—"), source: "manual", actor, at: now });
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

/** Снять запрет (только владелец — проверяет контроллер; причина обязательна). rid 0 — «стоп» из KV: сначала переносится в D1. @param {Env} env @param {Client} c @param {number} now @param {any} b @param {string} actor */
export async function contactsLift(env, c, now, b, actor) {
  const reason = String(b.reason || "").replace(/\s+/g, " ").trim();
  if (reason.length < 3) throw fail("input", "Укажите причину: почему снова можно писать.", "reason");
  const db = await dbOf(env, now), x = await contactOne(db, c.id, String(b.id || ""));
  if (!x) throw fail("missing", "Клиент не найден.");
  let rid = Math.round(+b.rid) || 0;
  if (!rid) { await legacyImport(db, c.id, [{ id: newId(), p: x.phone, at: now, meta: 0 }], now); rid = await restrictionActiveId(db, c.id, x.id, "marketing_optout"); }
  const kind = rid ? await restrictionLift(db, c.id, { contactId: x.id, rid, by: actor, reason, at: now }) : null;
  if (!kind) throw fail("missing", "Запрет не найден или уже снят.");
  if (!(await blocksLeft(db, c.id, x.id))) await mirror(env, db, c.id, x.phone, "del", now);
  return { ok: true };
}

/** Решение по неоднозначному «стопу»: keep — оставить запрет рекламы, all — закрыть всё, lift — снять (владелец). @param {Env} env @param {Client} c @param {number} now @param {any} b @param {string} actor */
export async function contactsReview(env, c, now, b, actor) {
  const decision = String(b.decision || ""), rid = Math.round(+b.rid) || 0;
  if (!["keep", "all", "lift"].includes(decision)) throw fail("input", "Неизвестное решение.", "decision");
  if (decision === "lift") return contactsLift(env, c, now, b, actor);
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
