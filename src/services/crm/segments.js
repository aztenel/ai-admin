// @ts-check
// Сегменты базы клиентов (docs/tz-winchester-v2.md §4.2) и кому из них можно писать маркетинг. Дни с визита — по календарю Астаны
// (от полуночи: визит вчера в 20:00 — 1 день и утром, и вечером). Всегда исключаем: «стоп» (optout:), будущую запись, визит меньше
// 14 дней назад, кому уже писали маркетинг за 14 дней (отметки bcm:<клиент>:<день> ставит отправка рассылок).
// crmView читает снимок и исключения один раз; crmPick берёт из него получателей — им пользуются список в пульте, рассылка из
// сегмента и автосценарий «Пора на стрижку» (полные номера — только на сервере, браузеру — маской в controllers/crm.js).
/** @import { Env, Client } from "../../lib/types.js" */
import { CRM_QUIET_DAYS, CRM_PAST_DAYS } from "../../config/constants.js";
import { isoDay } from "../../lib/time.js";
import { crmLoad, crmErrLoad, bcmRead } from "../../db/kv/crm.js";
import { bcOptouts } from "../broadcast/segments.js";

/** @typedef {{ p: string, n: string, last: string, first: string, v: number, staff: string, svc: string, fut?: number, d: number, why: string }} CrmRow */
/** @typedef {{ snap: any, rows: CrmRow[], marked?: Set<string>, futOnly?: Set<string> }} CrmView */

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
  if (!crmSegTest(id)) errors.push("сегмент базы клиентов не найден — выберите его заново");
  if ([from, to, days].some(x => x !== undefined && !(x >= 0 && x <= 400))) errors.push("дни с последнего визита — число от 0 до 400");
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
  const days = Array.from({ length: CRM_QUIET_DAYS }, (_, i) => isoDay(now - i * 86400e3));
  const [stop, marked] = await Promise.all([bcOptouts(env, c.id), bcmRead(env, c.id, days)]);
  const rows = snap.list.map((/** @type {any} */ x) => {
    const d = daysSince(x.last, now);
    return { ...x, d, why: stop.has(x.p) ? "stop" : x.fut ? "fut" : d < CRM_QUIET_DAYS ? "recent" : marked.has(x.p) ? "marketed" : "" };
  });
  // marked и futOnly (записан, визита за 90 дней нет) — и тех, кого в списке снимка нет: отправка рассылки проверяет каждого получателя (sender.js)
  return { snap, rows, marked, futOnly: new Set((Array.isArray(snap.futOnly) ? snap.futOnly : []).map(String)) };
}

// кнопки с числами и сведения о снимке (для пульта)
/** @param {Env} env @param {Client} c @param {number} now */
export async function crmSegments(env, c, now) {
  const { snap, rows } = await crmView(env, c, now);
  /** @type {any} */ let err = null; try { err = await crmErrLoad(env, c.id); } catch (e) {}
  const ok = rows.filter(x => !x.why), cnt = (/** @type {string} */ w) => rows.filter(x => x.why === w).length;
  const staff = [...new Set(rows.map(x => x.staff).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
  const segments = CRM_SEGS.map(s => ({ id: s.id, label: s.label, rule: s.rule, n: ok.filter(s.test).length }))
    .concat(staff.map(n => ({ id: "staff:" + n, label: "Мастер: " + n, rule: "последний визит у мастера", n: ok.filter(x => x.staff === n).length })));
  const { list, futOnly, ...info } = snap || {}; // номера — только на сервере
  return { at: snap ? snap.at : 0, clients: rows.length, ok: ok.length, segments, excluded: { stop: cnt("stop"), fut: cnt("fut"), recent: cnt("recent"), marketed: cnt("marketed") },
    info: snap ? info : null, ...(err && err.at > ((snap && snap.at) || 0) ? { error: err.error, errorAt: err.at } : {}) };
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
