// @ts-check
// База клиентов из журнала Altegio (docs/tz-winchester-v2.md §4.1, 19.10.2026): снимок — кто был за 90 дней, когда последний раз,
// сколько раз, у какого мастера и на какой услуге, есть ли будущая запись. Из него — сегменты и получатели рассылок (segments.js).
// Снимок ночью (crmRun, 04:00 по Астане, только боевой сайт) и кнопкой владельца (POST /api/crm/refresh — у черновиков фоновой задачи нет).
// Не проверено вживую: журнал Winchester за 90 дней постранично, какие значения attendance ставят администраторы, число ≈ 1 120.
/** @import { Env, Client } from "../../lib/types.js" */
import { CLIENTS } from "../../config/builtin-clients.js";
import { CRM_PAST_DAYS, CRM_FUTURE_DAYS, CRM_HOUR } from "../../config/constants.js";
import { normPhone, logSafe } from "../../lib/phone.js";
import { local, isoDay } from "../../lib/time.js";
import { altText } from "../integrations/altegio/client.js";
import { altRecordsRange } from "../integrations/altegio/records-api.js";
import { crmSave, crmErrSave, crmBusy, crmBusySet, crmDayMark } from "../../db/kv/crm.js";
import { altUserKey } from "../booking/journal.js";
import { altLoc } from "../booking/book.js";

/** @param {string} code @param {string} text */
const crmError = (code, text) => Object.assign(new Error(text), { code });

// почему базу не собрать (пусто — можно). Только имена переменных, без значений
/** @param {Env} env @param {Client} c @returns {string} */
export function crmWhy(env, c) {
  const ID = String(c.id).toUpperCase(), loc = altLoc(env, c);
  if (loc < 0) return `В переменной ALTEGIO_LOC_${ID} опечатка — нужны только цифры.`;
  if (!loc) return `Altegio не подключён: нет номера локации (ALTEGIO_LOC_${ID}).`;
  if (!env.ALTEGIO_PARTNER) return "Не задан ключ разработчика Altegio (ALTEGIO_PARTNER) — журнал записей не прочитать.";
  if (!altUserKey(env, c)) return `Нет ключа журнала Altegio (ALTEGIO_USER_${ID}): без него базу клиентов не прочитать. Ключ получают на странице /altegio/user.`;
  return "";
}

// записи журнала → клиенты (чистая функция). Визит — прошедшая запись: не удалена и клиент не «не пришёл» (attendance или
// visit_attendance = -1). Будущая запись (не удалена) — только отметка fut: таким клиентам маркетинг не пишем.
// Несколько записей одного дня (стрижка и борода отдельными записями) — один визит. Скрытый номер («+7 707 XXX-X7-44»: у сотрудника
// нет права видеть телефоны) и неверный — не в список, а в счётчики masked / bad (по клиенту). Запись без клиента (перерыв мастера) — пропускаем
/** @param {any[]} records @param {number} nowMs */
export function crmFold(records, nowMs) {
  const L = local(nowMs), nowS = `${isoDay(nowMs)} ${String(L.getUTCHours()).padStart(2, "0")}:${String(L.getUTCMinutes()).padStart(2, "0")}`;
  const masked = new Set(), bad = new Set(), /** @type {Record<string, number>} */ att = {}, rows = [];
  for (const r of records) {
    if (!r || typeof r !== "object" || r.deleted === true || r.deleted === 1 || !r.client || typeof r.client !== "object") continue;
    const dt = String(r.datetime || ""), when = dt.slice(0, 10) + " " + dt.slice(11, 16);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(when)) continue;
    const raw = String(r.client.phone ?? ""), p = normPhone(raw).slice(1);
    if (!p) { (/[xх*]/i.test(raw) ? masked : bad).add(r.client.id ? "id" + r.client.id : raw || "r" + r.id); continue; }
    rows.push({ r, when, p });
  }
  rows.sort((a, b) => a.when.localeCompare(b.when));
  /** @type {Map<string, any>} */
  const by = new Map();
  let visits = 0;
  for (const { r, when, p } of rows) {
    const x = by.get(p) || { p, n: "", last: "", first: "", v: 0, staff: "", svc: "", fut: 0 }, name = altText(r.client.name || "", 60);
    by.set(p, x);
    if (when > nowS) { x.fut = 1; if (!x.n) x.n = name; continue; }
    const a = r.attendance == null ? "нет" : String(r.attendance);
    att[a] = (att[a] || 0) + 1; // какие отметки ставят администраторы — для проверки владельцем (вживую не проверено)
    if (+r.attendance === -1 || +r.visit_attendance === -1) continue; // не пришёл
    const day = when.slice(0, 10), svc = (Array.isArray(r.services) ? r.services : []).map(/** @param {any} s */ s => altText(s && s.title, 60)).filter(Boolean);
    if (x.last !== day) { x.v++; visits++; x.svc = ""; }
    x.last = day; if (!x.first) x.first = day;
    if (name) x.n = name;
    x.staff = altText((r.staff && r.staff.name) || "", 60) || x.staff;
    x.svc = altText([...new Set([...(x.svc ? x.svc.split(" + ") : []), ...svc])].join(" + "), 90);
  }
  const list = [...by.values()].filter(x => x.v > 0).map(x => { const { fut, ...rest } = x; return fut ? x : rest; });
  // только будущая запись, визита за 90 дней нет: в сегменты не попадают, но рассылка, созданная раньше (последний визит тогда был
  // в окне), перед отправкой должна увидеть, что человек записался (находка проверки 19.10.2026)
  const futOnly = [...by.values()].filter(x => !x.v && x.fut).map(x => x.p);
  return { list, futOnly, visits, masked: masked.size, bad: bad.size, att };
}

// собрать снимок сейчас: журнал за 90 дней назад и 60 вперёд → crm:<клиент>:snap. Возвращает мета-данные без списка.
// Ошибка — всегда с понятным текстом (код setup / busy / altegio / store): контроллер отдаёт его как есть, текст Altegio — только в журнал сервера
/** @param {Env} env @param {Client} c @param {number} nowMs */
export async function crmBuild(env, c, nowMs) {
  const why = crmWhy(env, c);
  if (why) throw crmError("setup", why);
  let busy = false; try { busy = await crmBusy(env, c.id); } catch (e) {}
  if (busy) throw crmError("busy", "База уже обновляется — подождите минуту.");
  try { await crmBusySet(env, c.id, true); } catch (e) {}
  try {
    const from = isoDay(nowMs - CRM_PAST_DAYS * 86400e3), to = isoDay(nowMs + CRM_FUTURE_DAYS * 86400e3);
    const r = await altRecordsRange(env, altUserKey(env, c), altLoc(env, c), from, to);
    const f = crmFold(r.list, nowMs);
    const meta = { at: nowMs, from, to, records: r.list.length, visits: f.visits, clients: f.list.length, masked: f.masked, bad: f.bad, att: f.att, cut: r.cut };
    try { await crmSave(env, c.id, { ...meta, list: f.list, futOnly: f.futOnly }); } catch (e) { throw crmError("store", "Не удалось сохранить базу — хранилище не отвечает, попробуйте ещё раз."); }
    console.log("crm", c.id, JSON.stringify({ ...meta, att: undefined })); // только числа, без номеров
    return meta;
  } catch (/** @type {any} */ e) {
    const err = e && e.code && typeof e.code === "string" ? e : altFail(e);
    console.log("crm build", c.id, logSafe(String((e && e.message) || e)));
    try { await crmErrSave(env, c.id, err.message, nowMs); } catch (e2) {}
    throw err;
  } finally { try { await crmBusySet(env, c.id, false); } catch (e) {} }
}
// ошибка Altegio → текст для владельца (без текста чужого API)
/** @param {any} e */
const altFail = e => {
  const st = +(e && e.status) || 0;
  return crmError("altegio", st === 401 || st === 403 ? "Altegio не принял ключ журнала: ключ устарел или у сотрудника нет права смотреть журнал записей. Новый ключ — на странице /altegio/user."
    : st ? `Altegio не отдал журнал записей (ошибка ${st}) — попробуйте через несколько минут.` : "Нет связи с Altegio — попробуйте через несколько минут.");
};

// ночное обновление: 04:00–04:09 по Астане, встроенные клиенты с c.crm (Winchester), локацией и ключом журнала; раз в день (отметка до работы)
/** @param {Env} env @param {number} now @returns {Promise<number>} сколько снимков собрано */
export async function crmRun(env, now) {
  const d = local(now);
  if (d.getUTCHours() !== CRM_HOUR || d.getUTCMinutes() >= 10) return 0;
  let n = 0;
  for (const c of Object.values(CLIENTS)) {
    if (c.off || !c.crm || crmWhy(env, c)) continue;
    try { if (!(await crmDayMark(env, c.id, isoDay(now)))) continue; } catch (e) { console.log("crm mark", String(e)); continue; }
    try { await crmBuild(env, c, now); n++; } catch (/** @type {any} */ e) { console.log("crm run", c.id, logSafe(String((e && e.message) || e))); }
  }
  return n;
}
