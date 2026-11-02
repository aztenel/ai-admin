// @ts-check
// Сегменты базы клиентов (docs/tz-winchester-v2.md §4.2) и кому из них можно писать маркетинг. Дни с визита — по календарю Астаны
// (от полуночи: визит вчера в 20:00 — 1 день и утром, и вечером). Всегда исключаем: «стоп» (optout:), будущую запись, визит меньше
// 14 дней назад, кому уже писали маркетинг за 14 дней (отметки bcm:<клиент>:<день> ставит отправка рассылок).
// crmView читает снимок и исключения один раз; crmPick берёт из него получателей — им пользуются список в пульте, рассылка из
// сегмента и автосценарий «Пора на стрижку» (полные номера — только на сервере, браузеру — маской в controllers/crm.js).
/** @import { Env, Client } from "../../lib/types.js" */
import { CRM_QUIET_DAYS, CRM_PAST_DAYS } from "../../config/constants.js";
import { marketingGate } from "../contacts/gate.js";
import { MARKETING_GAP_DAYS } from "../contacts/segments.js";
import { isoDay } from "../../lib/time.js";
import { crmLoad, crmErrLoad, bcmRead } from "../../db/kv/crm.js";
import { bcOptouts } from "../broadcast/segments.js";

/** @typedef {{ p: string, n: string, last: string, first: string, v: number, staff: string, svc: string, fut?: number, d: number, why: string }} CrmRow */
/** @typedef {{ snap: any, rows: CrmRow[], marked?: Set<string>, stop?: Set<string>, futOnly?: Set<string>, allow?: Set<string>, gate?: { ready: boolean, why: string, n: number }, reasons?: Map<string, string> }} CrmView */

// сегменты-кнопки. «all» (все, кому можно писать) и «staff:<имя>» (последний визит у мастера) — тоже сегменты, см. crmSegTest
export const CRM_SEGS = /** @type {{ id: string, label: string, rule: string, test: (x: CrmRow) => boolean }[]} */ ([
  { id: "pora", label: "Пора на стрижку", rule: "последний визит 21–35 дней назад", test: x => x.d >= 21 && x.d <= 35 },
  { id: "davno", label: "Давно не были", rule: "36–60 дней", test: x => x.d >= 36 && x.d <= 60 },
  { id: "uhodyat", label: "Уходят", rule: "61–90 дней", test: x => x.d >= 61 && x.d <= 90 },
  { id: "novye", label: "Новые", rule: "1 визит за 90 дней", test: x => x.v === 1 },
  { id: "postoyannye", label: "Постоянные", rule: "3 и больше визитов за 90 дней", test: x => x.v >= 3 }
]);
/** @param {any} seg @returns {((x: CrmRow) => boolean) | null} null — сегмент неизвестен */
export function crmSegTest(seg) {
  const s = String(seg || "");
  if (s === "all") return () => true;
  if (s.startsWith("staff:")) { const n = s.slice(6); return n ? x => x.staff === n : null; }
  const f = CRM_SEGS.find(x => x.id === s);
  return f ? f.test : null;
}

// сегмент из запроса рассылки: "pora" или { id, from, to, staff, days } — те же фильтры, что у /api/crm/list (дни с визита от и до,
// мастер) и «ровно N дней» автосценария. errors — что не так (пусто — можно)
/** @param {any} v @returns {{ id: string, from?: number, to?: number, staff?: string, days?: number, errors: string[] }} */
export function crmSegSpec(v) {
  const o = v && typeof v === "object" ? v : { id: v }, errors = [];
  const num = (/** @type {string} */ k) => o[k] == null || String(o[k]).trim() === "" ? undefined : Math.round(+o[k]);
  const id = String(o.id ?? "").trim().slice(0, 80), from = num("from"), to = num("to"), days = num("days"), staff = String(o.staff ?? "").trim().slice(0, 60) || undefined;
  if (!crmSegTest(id)) errors.push("сегмент базы клиентов не найден, выберите его заново");
  if ([from, to, days].some(x => x !== undefined && !(x >= 0 && x <= 400))) errors.push("дни с последнего визита: число от 0 до 400");
  return { id, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}), ...(days !== undefined ? { days } : {}), ...(staff ? { staff } : {}), errors };
}
// название сегмента для рассылки и отчёта: «Пора на стрижку», «Мастер: Тони · 36–60 дн. с визита»
/** @param {{ id: string, from?: number, to?: number, staff?: string, days?: number }} sp */
export function crmSegLabel(sp) {
  const f = CRM_SEGS.find(x => x.id === sp.id), base = f ? f.label : sp.id.startsWith("staff:") ? "Мастер: " + sp.id.slice(6) : "Вся база";
  const d = sp.days != null ? `ровно ${sp.days} дн. с визита` : sp.from != null || sp.to != null ? `${sp.from ?? 0}–${sp.to ?? CRM_PAST_DAYS} дн. с визита` : "";
  return [base, d, sp.staff ? "мастер " + sp.staff : ""].filter(Boolean).join(" · ").slice(0, 120);
}

/** @param {string} s ГГГГ-ММ-ДД */
const dayNo = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400e3;
/** @param {string} last @param {number} now @returns {number} */
export const daysSince = (last, now) => dayNo(isoDay(now)) - dayNo(last);

// снимок и причина «не писать» у каждого: стоп → будущая запись → был недавно → уже писали (первая подходящая).
// Стоп-лист или отметки не прочитались — ошибка, а не пустой список: иначе написали бы тем, кто просил не писать
/** @param {Env} env @param {Client} c @param {number} now @returns {Promise<CrmView>} */
export async function crmView(env, c, now) {
  const snap = await crmLoad(env, c.id);
  if (!snap || !Array.isArray(snap.list)) return { snap: null, rows: [] };
  // реклама: 30 дней между рекламными сообщениями (решение владельца 31.10.2026, было 14) и только с подтверждённым согласием
  const days = Array.from({ length: MARKETING_GAP_DAYS }, (_, i) => isoDay(now - i * 86400e3));
  const [stop, marked, gate] = await Promise.all([bcOptouts(env, c.id), bcmRead(env, c.id, days), marketingGate(env, c, now)]);
  const rows = snap.list.map((/** @type {any} */ x) => {
    const d = daysSince(x.last, now);
    return { ...x, d, why: stop.has(x.p) ? "stop" : !gate.phones.has(x.p) ? "noconsent" : x.fut ? "fut" : d < CRM_QUIET_DAYS ? "recent" : marked.has(x.p) ? "marketed" : "" };
  });
  // marked и futOnly (записан, визита за 90 дней нет) — и тех, кого в списке снимка нет: отправка рассылки проверяет каждого получателя (sender.js)
  return { snap, rows, marked, stop, allow: gate.phones, gate: { ready: gate.ready, why: gate.why, n: gate.phones.size }, reasons: gate.reasons, futOnly: new Set((Array.isArray(snap.futOnly) ? snap.futOnly : []).map(String)) };
}

// Статусы клиента базы (задание владельца 02.11.2026: «0 доступных» не значит «0 клиентов» — показываем всех, а писать рекламу можно только
// с подтверждённым согласием). Каждый статус — отдельно, а не первая причина: «есть запись», «сервисные можно» (нет «стопа» и запрета),
// «реклама можно» (подтверждённое согласие, нет «стопа», запрета, отказа и паузы), «отказался» («стоп», полный запрет, «стоп» ждёт решения),
// «отказ от рекламы» (в согласии или в Altegio). ready — получит рекламу прямо сейчас (ещё и не был недавно, не записан, без рекламы 30 дней)
const STOPPED = new Set(["block", "stop", "review"]);
/** @param {CrmView} view @param {{ p: string, fut?: number, why?: string }} x */
export function crmStatus(view, x) {
  const r = (view.reasons && view.reasons.get(x.p)) || "", stopped = x.why === "stop" || !!(view.stop && view.stop.has(x.p)) || STOPPED.has(r);
  return { booked: !!x.fut, service: !stopped, marketing: !stopped && !!(view.allow && view.allow.has(x.p)), stopped, refused: r === "denied", ready: !x.why };
}
/** сводка статусов: строки базы и записанные без визита за 90 дней (futOnly) @param {CrmView} view @param {CrmRow[]} rows @param {boolean} [withFut] */
export function crmStatusCount(view, rows, withFut = false) {
  const out = { valid: 0, booked: 0, service: 0, marketing: 0, stopped: 0, refused: 0, ready: 0 };
  const add = (/** @type {any} */ st) => { out.valid++; for (const k of /** @type {const} */ (["booked", "service", "marketing", "stopped", "refused", "ready"])) if (st[k]) out[k]++; };
  for (const x of rows) add(crmStatus(view, x));
  if (withFut) for (const p of view.futOnly || []) add({ ...crmStatus(view, { p, fut: 1, why: "fut" }), ready: false });
  return out;
}
/** @type {Record<string, string>} */
const WHY_TEXT = { stop: "просил не писать («стоп»)", block: "запрет: не писать вообще", review: "«стоп» ждёт решения", denied: "отказался от рекламы",
  unconfirmed: "согласие не подтверждено", noconsent: "нет согласия на рекламу", cooldown: "пауза после отменённой записи", fut: "уже записан",
  recent: "был меньше 14 дней назад", marketed: "реклама уже была за 30 дней" };
/** почему этому клиенту сейчас не уйдёт реклама — словами; "" — уйдёт @param {{ why?: string, reason?: string }} x */
export const crmWhyText = x => !x.why ? "" : x.why === "noconsent" ? WHY_TEXT[x.reason || "noconsent"] || WHY_TEXT.noconsent : WHY_TEXT[x.why] || x.why;
/** все клиенты сегмента (и те, кому сейчас нельзя рекламу) — для списка и предпросмотра: свежие визиты первыми
 *  @param {CrmView} view @param {string} seg @param {{ days?: number, from?: number, to?: number, staff?: string }} [o] */
export function crmPeople(view, seg, o = {}) {
  const test = crmSegTest(seg);
  if (!test) return null;
  return view.rows.filter(x => test(x) && (o.days == null || x.d === o.days) && (o.from == null || x.d >= o.from) && (o.to == null || x.d <= o.to) && (!o.staff || x.staff === o.staff))
    .sort((a, b) => a.d - b.d || b.v - a.v || a.p.localeCompare(b.p))
    .map(x => ({ phone: x.p, name: x.n, last: x.last, d: x.d, v: x.v, staff: x.staff, svc: x.svc, why: x.why, reason: (view.reasons && view.reasons.get(x.p)) || "", st: crmStatus(view, x) }));
}

// воронка рассылки по сегменту (ТЗ v3.0 P0): сколько всего, с правильным номером, в сегменте и почему не все получат. Кто получит,
// решают crmView и crmPick — здесь только счёт по их же причинам; каждый человек — один раз, по первой причине (порядок crmView:
// «стоп» → нет согласия → будущая запись → недавний визит → реклама за 30 дней). «Нет согласия» раскрывается по базе контактов D1
// (marketingGate): «стоп» в D1, полный запрет, неоднозначный «стоп», отказ, не подтверждено, нет согласия; пауза после отменённой записи —
// правило компании, а не разрешение. rules и consent — коды и числа; тексты и «нет данных для текста» добавляет проверка рассылки
/** @param {CrmView} view @param {string} seg @param {{ days?: number, from?: number, to?: number, staff?: string }} [o] */
export function crmFunnel(view, seg, o = {}) {
  const snap = view.snap || {}, test = crmSegTest(seg), rules = /** @type {Record<string, number>} */ ({}), consent = /** @type {Record<string, number>} */ ({});
  const valid = view.rows.length + (Array.isArray(snap.futOnly) ? snap.futOnly.length : 0);
  let segment = 0;
  for (const x of view.rows) {
    if (!test || !test(x) || (o.days != null && x.d !== o.days) || (o.from != null && x.d < o.from) || (o.to != null && x.d > o.to) || (o.staff && x.staff !== o.staff)) continue;
    segment++;
    if (!x.why) continue;
    if (x.why === "stop") consent.stop = (consent.stop || 0) + 1;
    else if (x.why === "noconsent") {
      const r = (view.reasons && view.reasons.get(x.p)) || "noconsent";
      if (r === "cooldown") rules.cooldown = (rules.cooldown || 0) + 1; else consent[r] = (consent[r] || 0) + 1;
    } else rules[x.why] = (rules[x.why] || 0) + 1;
  }
  return { total: valid + (+snap.masked || 0) + (+snap.bad || 0), valid, segment, rules, consent };
}

// кнопки с числами и сведения о снимке (для пульта)
/** @param {Env} env @param {Client} c @param {number} now */
export async function crmSegments(env, c, now) {
  const view = await crmView(env, c, now), { snap, rows } = view;
  /** @type {any} */ let err = null; try { err = await crmErrLoad(env, c.id); } catch (e) {}
  const ok = rows.filter(x => !x.why), cnt = (/** @type {string} */ w) => rows.filter(x => x.why === w).length;
  const staff = [...new Set(rows.map(x => x.staff).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
  // n — получат рекламу прямо сейчас; total и st — все клиенты сегмента и их статусы (02.11.2026: сегменты не «пустые», если согласий нет)
  const seg = (/** @type {(x: CrmRow) => boolean} */ test) => { const all = rows.filter(test); return { n: all.filter(x => !x.why).length, total: all.length, st: crmStatusCount(view, all) }; };
  const segments = CRM_SEGS.map(s => ({ id: s.id, label: s.label, rule: s.rule, ...seg(s.test) }))
    .concat(staff.map(n => ({ id: "staff:" + n, label: "Мастер: " + n, rule: "последний визит у мастера", ...seg(x => x.staff === n) })));
  const { list, futOnly, ...info } = snap || {}; // номера — только на сервере
  const st = crmStatusCount(view, rows, true), invalid = (+(snap && snap.masked) || 0) + (+(snap && snap.bad) || 0);
  return { at: snap ? snap.at : 0, clients: rows.length, ok: ok.length, segments, excluded: { stop: cnt("stop"), noconsent: cnt("noconsent"), fut: cnt("fut"), recent: cnt("recent"), marketed: cnt("marketed") }, consent: view.gate,
    statuses: snap ? { base: st.valid + invalid, ...st, invalid } : null,
    info: snap ? info : null, ...(err && err.at > ((snap && snap.at) || 0) ? { error: err.error, errorAt: err.at } : {}) };
}

/** кто из сегмента отсеян и почему: { stop: 2, noconsent: 5, … } — для проверки рассылки (числа, без номеров)
 *  @param {CrmView} view @param {string} seg @param {{ days?: number, from?: number, to?: number, staff?: string }} [o] @returns {Record<string, number>} */
export function crmSegWhy(view, seg, o = {}) {
  const test = crmSegTest(seg), out = /** @type {Record<string, number>} */ ({});
  if (!test) return out;
  for (const x of view.rows) {
    if (!x.why || !test(x) || (o.days != null && x.d !== o.days) || (o.from != null && x.d < o.from) || (o.to != null && x.d > o.to) || (o.staff && x.staff !== o.staff)) continue;
    out[x.why] = (out[x.why] || 0) + 1;
  }
  return out;
}

/**
 * Кому писать из сегмента — только те, у кого нет причины «не писать». Свежие визиты — первыми.
 * @param {Env} env @param {Client} c
 * @param {string} seg id из CRM_SEGS, «staff:<имя>» или «all»
 * @param {number} now
 * @param {{ days?: number, from?: number, to?: number, staff?: string, view?: CrmView }} [o] days — ровно столько дней с последнего визита
 *   (автосценарий); from/to — дней с визита от и до; staff — мастер последнего визита; view — уже прочитанный crmView (снимок не читать дважды)
 * @returns {Promise<{ phone: string, name: string, last: string, d: number, v: number, staff: string, svc: string }[] | null>}
 *   phone — цифры без «+» (как в списках рассылок и ключах optout:); null — сегмент неизвестен; [] — снимка нет
 */
export async function crmPick(env, c, seg, now, o = {}) {
  const test = crmSegTest(seg);
  if (!test) return null;
  const { rows } = o.view || await crmView(env, c, now);
  return rows.filter(x => !x.why && test(x) && (o.days == null || x.d === o.days) && (o.from == null || x.d >= o.from) && (o.to == null || x.d <= o.to) && (!o.staff || x.staff === o.staff))
    .sort((a, b) => a.d - b.d || b.v - a.v || a.p.localeCompare(b.p))
    .map(x => ({ phone: x.p, name: x.n, last: x.last, d: x.d, v: x.v, staff: x.staff, svc: x.svc }));
}
