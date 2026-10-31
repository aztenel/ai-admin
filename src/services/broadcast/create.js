// @ts-check
// Создание рассылки (bcCheck, bcCreate) и её запуск (bcStarting, bcStarted) — общие для страницы рассылок (controllers/broadcast.js)
// и автосценария «Пора на стрижку» (services/crm/auto.js). Получатели — список из браузера (bcParse, сегменты списка bcSeg) или сегмент
// базы клиентов Altegio (поле segment, docs/tz-winchester-v2.md §5, 19.10.2026): тогда получателей строит сервер из снимка (crmPick),
// номера из браузера не берутся, а в ответ уходят только маской — полные номера базы есть только на сервере.
// Второй номер (Green-API, ch: "ga") и сегмент базы (ТЗ Winchester v3.0, 31.10.2026): черновик рассылки обычным текстом — текст из
// библиотеки (tplId) или свой (text) с вставками {{client.first_name}} и другими (render.js). Текст каждому клиенту собирает сервер из
// его строки базы; кому не хватает данных (нет мастера в истории и т. п.) — не пишем, с причиной в проверке. Шаблоны Meta и {{1}}
// здесь не нужны. Создать, проверить и одобрить черновик можно; запуск со второго номера — отдельное решение владельца (sender.js).
/** @import { Env, Client } from "../../lib/types.js" */
/** @import { CrmView } from "../crm/segments.js" */
import { clean, snip } from "../../lib/text.js";
import { maskPhone } from "../../lib/phone.js";
import { CRM_FRESH_BC } from "../../config/constants.js";
import { bcPut, bcChunksSave, bcLastSave } from "../../db/kv/broadcasts.js";
import { bcParam } from "../channels/templates.js";
import { bcParse, bcName } from "./parse.js";
import { bcSeg, bcOptouts } from "./segments.js";
import { bcRun, bcGaMsg, bcGaText, GA_CAP, GA_MSG_MAX, GA_CAPTION_MAX } from "./sender.js";
import { render, dataFor, normName, textIssues, toCanonical, MISSING_WHY } from "./render.js";
import { libraryOf, companyOf, DEMO } from "./library.js";
import { crmView, crmPick, crmSegSpec, crmSegLabel, crmSegWhy } from "../crm/segments.js";

/** @typedef {{ list: any[], dup: number, bad: string[], badN: number, cut: number, errors: string[], empty: string, noList: boolean,
 *   seg?: { label: string, out: number, noDate: number }, crm: { id: string, label: string, at: number, total: number } | null,
 *   rows?: any[], why?: Record<string, number> }} Recipients */

// почему человеку из сегмента не пишем — по-человечески (коды — crmView и render.js)
/** @type {Record<string, string>} */
export const EXCL_WHY = { stop: "просили не писать", noconsent: "нет согласия на рекламу", fut: "уже записаны", recent: "были меньше 14 дней назад",
  marketed: "реклама уже была за 30 дней", text: "текст не собрался" };
const MISSING_CODE = /** @type {Record<string, string>} */ ({ "staff.name": "nostaff", "service.name": "nosvc", "visit.days_since": "nodays", "company.name": "nocompany", "booking.url": "nolink", "company.address": "noaddr" });
for (const [k, code] of Object.entries(MISSING_CODE)) EXCL_WHY[code] = MISSING_WHY[k];
/** @param {Record<string, number>} m @returns {{ code: string, why: string, n: number }[]} */
const exclList = m => Object.entries(m).filter(([, n]) => n > 0).map(([code, n]) => ({ code, why: EXCL_WHY[code] || code, n })).sort((a, b) => b.n - a.n);

/** рассылка со второго номера по сегменту базы @param {Record<string, any>} body */
const gaCrm = body => body.ch === "ga" && body.segment != null && body.segment !== "";

// текст рассылки со второго номера по базе: из библиотеки (tplId, язык lang) или свой; вставки — в новом виде. errors — что не так
/** @param {Env} env @param {Client} c @param {Record<string, any>} body */
async function gaText(env, c, body) {
  const lang = body.lang === "kk" ? "kk" : "ru", errors = /** @type {string[]} */ ([]);
  let text = String(body.text ?? ""), tplId = "";
  if (body.tplId) {
    const it = (await libraryOf(env, c)).find(x => x.id === String(body.tplId).slice(0, 16));
    if (!it) errors.push("такого текста в библиотеке нет — выберите его заново");
    else { tplId = it.id; if (!text.trim()) text = (lang === "kk" && it.kk) || it.ru; }
  }
  text = toCanonical(text);
  if (text.trim()) for (const x of textIssues(text)) errors.push(x.charAt(0).toLowerCase() + x.slice(1));
  return { body: /** @type {Record<string, any>} */ ({ ...body, text, lang }), errors, tplId, lang };
}

// пробная отправка себе со второго номера: текст на вымышленном клиенте («Айгерим»). Рассылка по базе или текст из библиотеки —
// со вставками (render.js); по списку из Excel — {имя}, как при отправке. errors — почему не отправить
// f — поля сообщения (картинка, текст) для отправки
/** @param {Env} env @param {Client} c @param {Record<string, any>} body0 @returns {Promise<{ text: string, errors: string[], f: ReturnType<typeof bcFields> }>} */
export async function bcGaTestText(env, c, body0) {
  const g = gaCrm(body0) || body0.tplId ? await gaText(env, c, body0) : null, body = g ? g.body : body0, f = bcFields(body);
  const errors = f.errors.concat(g ? g.errors : []);
  if (errors.length) return { text: "", errors, f };
  if (!g) return { text: bcGaText(f, "Айгерим"), errors: [], f };
  const r = render(f.msg, dataFor({ ...DEMO, name: "Айгерим" }, companyOf(c)));
  return { text: r.text, errors: r.issues, f };
}

// поля сообщения из формы: Green-API — обычный текст как написан (переводы строк сохраняются, в конце — «ответьте СТОП»), Meta — шаблон
/** @param {Record<string, any>} body */
export function bcFields(body) {
  const errors = /** @type {string[]} */ ([]), img = String(body.img || "").trim(), fallback = clean(body.fallback || "", 30);
  if (body.ch === "ga") {
    const msg = bcGaMsg(body.text);
    if (!msg) errors.push("напишите текст сообщения");
    else if (img ? msg.replace(/\{\s*(имя|name)\s*\}/gi, "x".repeat(30)).length > 1024 : msg.length > GA_MSG_MAX) errors.push(img ? `текст с картинкой не длиннее ${GA_CAPTION_MAX} знаков: это подпись к картинке, у WhatsApp она короче обычного сообщения` : `текст сообщения не длиннее ${GA_MSG_MAX} знаков`); // подпись к картинке — до 1024 знаков вместе с самым длинным именем
    if (img && !(/^https:\/\/[^\s"'<>]{4,500}$/.test(img))) errors.push("картинка: ссылка, которая начинается с https://");
    return { errors, ch: "ga", tpl: "", lang: "", img, msg, params: /** @type {string[]} */ ([]), text: clean(msg.replace(/\s*\n\s*/g, " ⏎ "), 1100), fallback };
  }
  const tpl = String(body.tpl || "").trim(), lang = String(body.lang || "ru").trim();
  if (!/^[a-z0-9_]{1,512}$/.test(tpl)) errors.push("название шаблона — как в кабинете Meta: строчные латинские буквы, цифры и «_» (например, promo_october)");
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(lang)) errors.push("язык шаблона — код из кабинета Meta: ru, kk, en или en_US");
  if (img && !(/^https:\/\/[^\s"'<>]{4,500}$/.test(img))) errors.push("картинка: ссылка, которая начинается с https://");
  const params = (Array.isArray(body.params) ? body.params : String(body.params || "").split("\n")).map(x => clean(x, 300)).filter(Boolean).slice(0, 10);
  return { errors, ch: "", tpl, lang, img, msg: "", params, text: clean(String(body.text || "").replace(/\s*\n\s*/g, " ⏎ "), 1100), fallback };
}

/**
 * Получатели [цифры без «+», имя][]: из списка, который прислал браузер, или из сегмента базы (body.segment).
 * errors — ошибки сегмента (в ответе — до названия рассылки, как раньше); empty — почему получателей нет; noList — в списке нет ни одного номера
 * @param {Env} env @param {Client} c @param {Record<string, any>} body @param {number} now
 * @param {{ view?: CrmView, limit?: number }} [o] view — уже прочитанный снимок; limit — не больше стольких получателей (автосценарий)
 * @returns {Promise<Recipients>}
 */
export async function bcRecipients(env, c, body, now, o = {}) {
  if (body.segment != null && body.segment !== "") return crmRecipients(env, c, body, now, o);
  const seg = ["idle", "bday"].includes(body.seg) ? body.seg : "", segDays = Math.round(+body.segDays || 0), segBad = !!seg && !(segDays >= 1 && segDays <= 365);
  const r0 = bcParse(body.recipients), sg = bcSeg(r0, segBad ? "" : seg, segDays, now);
  return { list: sg.list, dup: r0.dup, bad: r0.bad, badN: r0.badN, cut: r0.cut, errors: segBad ? ["сегмент: число дней от 1 до 365"] : [], noList: !r0.list.length,
    empty: seg && r0.list.length && !sg.list.length ? `в сегменте «${sg.label}» никого нет${sg.noDate ? ` (без нужной даты в списке: ${sg.noDate})` : ""}` : "",
    ...(seg ? { seg: { label: sg.label, out: sg.out, noDate: sg.noDate } } : {}), crm: null };
}
// сегмент базы клиентов Altegio: «стоп», нет согласия, будущая запись, визит меньше 14 дней назад и реклама за 30 дней уже исключены
// (crmPick). Старая база — отказ: по ней напишем «пора на стрижку» тому, кто уже записался
/** @param {Env} env @param {Client} c @param {Record<string, any>} body @param {number} now @param {{ view?: CrmView, limit?: number }} o @returns {Promise<Recipients>} */
async function crmRecipients(env, c, body, now, o) {
  const sp = crmSegSpec(body.segment), none = { list: [], dup: 0, bad: [], badN: 0, cut: 0, empty: "", noList: false, crm: null };
  if (sp.errors.length) return { ...none, errors: sp.errors };
  const view = o.view || await crmView(env, c, now);
  if (!view.snap) return { ...none, errors: ["базы клиентов из Altegio ещё нет: обновите базу в разделе «Клиенты»"] };
  const age = Math.floor((now - view.snap.at) / 86400e3);
  if (now - view.snap.at > CRM_FRESH_BC) return { ...none, errors: [`база клиентов обновлялась ${age} дн. назад: обновите её, кто-то из сегмента мог уже записаться`] };
  const flt = { days: sp.days, from: sp.from, to: sp.to, staff: sp.staff };
  const all = (await crmPick(env, c, sp.id, now, { ...flt, view })) || [], label = crmSegLabel(sp);
  const picked = o.limit ? all.slice(0, o.limit) : all;
  return { ...none, list: picked.map(x => [x.phone, bcName(x.name)]), errors: [], crm: { id: sp.id, label, at: view.snap.at, total: all.length }, // имя — как из Excel: пометки администратора («Арман должник») в сообщение не попадут
    rows: picked, why: crmSegWhy(view, sp.id, flt),
    empty: picked.length ? "" : `в сегменте «${label}» сейчас некому писать: остальные просили не писать, без согласия на рекламу, уже записаны, были меньше 14 дней назад или реклама уже была за 30 дней` };
}

// текст каждому клиенту со второго номера: из его строки базы и данных компании. Кому не хватает данных — в blocked с причиной.
// В список рассылки — [цифры, имя, мастер, услуга, последний визит]: при отправке текст собирается заново по свежей базе (sender.js)
/** @param {string} msg @param {any[]} rows @param {Client} c */
function gaRows(msg, rows, c) {
  const co = companyOf(c), list = /** @type {any[]} */ ([]), samples = /** @type {{ to: string, text: string }[]} */ ([]), blocked = /** @type {Record<string, number>} */ ({});
  for (const x of rows) {
    const r = render(msg, dataFor({ name: x.name, staff: x.staff, svc: x.svc, d: x.d }, co));
    if (r.blocked) { const code = MISSING_CODE[r.missing[0]] || "text"; blocked[code] = (blocked[code] || 0) + 1; continue; }
    list.push([x.phone, normName(x.name), String(x.staff || "").slice(0, 60), String(x.svc || "").slice(0, 80), String(x.last || "")]);
    if (samples.length < 5) samples.push({ to: maskPhone(x.phone), text: r.text });
  }
  return { list, samples, blocked };
}

// проверка без сохранения: сколько номеров, сколько повторов, кого пропустим, подстановка для первого клиента. Номера базы — маской
/** @param {Env} env @param {Client} c @param {Record<string, any>} body0 @param {number} now */
export async function bcCheck(env, c, body0, now) {
  const g = gaCrm(body0) ? await gaText(env, c, body0) : null, body = g ? g.body : body0;
  const f = bcFields(body), rc = await bcRecipients(env, c, body, now), errors = f.errors.concat(g ? g.errors : [], rc.errors, rc.crm && rc.empty ? [rc.empty] : []);
  const gr = g && rc.rows && f.msg ? gaRows(f.msg, rc.rows, c) : null;
  if (gr && rc.rows && rc.rows.length && !gr.list.length && !errors.length) errors.push("никому из сегмента этот текст не собрать: не хватает данных (смотрите причины ниже)");
  const list = gr ? gr.list : rc.list, first = (list.find(x => x[1]) || [])[1] || "";
  let stop = new Set(); if (!rc.crm) { try { stop = await bcOptouts(env, c.id); } catch (e) {} } // в сегменте базы «стоп» уже исключён
  return { ok: list.length > 0 && !errors.length, valid: list.length, named: list.filter(x => x[1]).length, dup: rc.dup, bad: rc.bad, badN: rc.badN, cut: rc.cut, stopped: list.filter(x => stop.has(x[0])).length,
    ...(rc.seg ? { segOut: rc.seg.out, noDate: rc.seg.noDate, seg: rc.seg.label } : {}), ...(rc.crm ? { segment: rc.crm, excluded: exclList({ ...(rc.why || {}), ...(gr ? gr.blocked : {}) }) } : {}),
    ...(g ? { tplId: g.tplId, lang: g.lang, text: f.msg, samples: gr ? gr.samples : [] } : {}),
    sample: list.slice(0, 5).map(x => (rc.crm ? maskPhone(x[0]) : "+" + x[0]) + " — " + (x[1] || "без имени")), errors,
    preview: f.ch === "ga" ? (gr ? gr.samples.slice(0, 1).map(x => x.text) : f.msg ? [bcGaText(f, first)] : []) : f.params.map(t => bcParam(t, first, f.fallback)) };
}

/**
 * Создать рассылку: проверка полей, получатели частями (bcr:), сама рассылка (bc:). by — кто создал: owner, staff или auto.
 * o.start — сразу запустить (автосценарий); o.view, o.limit — см. bcRecipients
 * @param {Env} env @param {Client} c @param {Record<string, any>} body0 @param {number} now @param {string} by
 * @param {{ start?: boolean, view?: CrmView, limit?: number }} [o]
 * @returns {Promise<{ ok: true, b: Record<string, any>, dup: number, bad: number, cut: number } | { ok: false, errors: string[], status: number }>}
 */
export async function bcCreate(env, c, body0, now, by, o = {}) {
  const g = gaCrm(body0) ? await gaText(env, c, body0) : null, body = g ? g.body : body0;
  const f = bcFields(body), ga = f.ch === "ga", rc = await bcRecipients(env, c, body, now, o), errors = f.errors.concat(g ? g.errors : [], rc.errors, !rc.errors.length && rc.empty ? [rc.empty] : []);
  const gr = g && rc.rows && f.msg ? gaRows(f.msg, rc.rows, c) : null;
  if (gr && rc.rows && rc.rows.length && !gr.list.length && !errors.length) errors.push("никому из сегмента этот текст не собрать: не хватает данных");
  const list = gr ? gr.list : rc.list;
  const name = clean(body.name || "", 60), cap = Math.round(+body.cap || 0), from = Math.round(+body.from), to = Math.round(+body.to);
  if (name.length < 2) errors.push("дайте рассылке название, для себя");
  if (rc.noList) errors.push("в списке нет ни одного номера");
  if (ga && !(cap >= 1 && cap <= GA_CAP[1])) errors.push(`не больше ${GA_CAP[1]} сообщений за сутки с этого номера: обычный WhatsApp блокируют за массовые рассылки`);
  else if (!(cap >= 1 && cap <= 100000)) errors.push("предел на 24 часа: число от 1 до 100 000");
  if (!(from >= 0 && to <= 24 && to > from)) errors.push("часы отправки: «с» должно быть раньше, чем «до»");
  else if (from < 8 || to > 22) errors.push("часы отправки: не раньше 8:00 и не позже 22:00. Ночные сообщения вызывают жалобы, а жалобы блокируют номер");
  if (!ga && !f.text) errors.push("вставьте текст шаблона: его увидит администратор, а бот поймёт, на что отвечает клиент");
  if (body.consent !== true) errors.push("подтвердите, что эти люди — клиенты компании и не просили им не писать");
  if (errors.length) return { ok: false, errors, status: 400 };
  const base = { id: now.toString(36) + Math.random().toString(36).slice(2, 5), name, ...(f.img ? { img: f.img } : {}), text: f.text, fallback: f.fallback || "уважаемый клиент", created: now, by, status: "ready",
    total: list.length, pos: 0, sent: 0, failed: 0, skipped: 0, cap, from, to, ...(rc.seg && rc.seg.label ? { seg: rc.seg.label } : {}), ...(rc.crm ? { src: "crm", seg: rc.crm.label, segId: rc.crm.id, crmAt: rc.crm.at } : {}) };
  /** @type {Record<string, any>} */
  const b = ga ? { ...base, ch: "ga", msg: f.msg, ...(g ? { render: 1, lang: g.lang, ...(g.tplId ? { tplId: g.tplId } : {}), drop: exclList({ ...(rc.why || {}), ...(gr ? gr.blocked : {}) }).slice(0, 12) } : {}) }
    : { ...base, tpl: f.tpl, lang: f.lang, params: f.params };
  if (o.start) bcStarting(b, now);
  try { await bcChunksSave(env, c.id, b.id, list); await bcPut(env, c.id, b); }
  catch (e) { console.log("bc create", String(e)); return { ok: false, errors: ["не удалось сохранить список: хранилище не отвечает, попробуйте ещё раз"], status: 500 }; }
  if (o.start && !(await bcStarted(env, c.id, b, now))) return { ok: false, errors: [BC_NOT_QUEUED], status: 503 };
  return { ok: true, b, dup: rc.dup, bad: rc.badN, cut: rc.cut };
}

// рассылку по базе запускают и продолжают только по свежей базе: за дни паузы кто-то из списка мог записаться. Пусто — можно
/** @param {Env} env @param {Client} c @param {Record<string, any>} b @param {number} now @returns {Promise<string>} */
export async function bcCrmStale(env, c, b, now) {
  if (b.src !== "crm") return "";
  const { snap } = await crmView(env, c, now);
  return snap && now - snap.at <= CRM_FRESH_BC ? "" : "База клиентов из Altegio не обновлялась больше 3 дней: по ней не видно, кто уже записался. Обновите базу в разделе «Клиенты», потом запустите рассылку.";
}

export const BC_NOT_QUEUED = "рассылка не попала в очередь отправки: хранилище не отвечает. Она на паузе, нажмите «Продолжить» через минуту";
// запуск: отметки «идёт» — до записи рассылки (bcPut делает вызывающий), очередь фоновой отправки и текст для ИИ и пульта — после
/** @param {Record<string, any>} b @param {number} now */
export function bcStarting(b, now) {
  b.status = "running"; b.startedAt = now; b.streak = 0; b.tmp = 0;
  for (const k of ["note", "retryAt", "retryWhy", "waitNote", "waitTill", "nextAt"]) delete b[k];
}
// очередь не записалась — рассылка «идёт», но фоновая отправка её не видит и молчит: ставим на паузу с объяснением (находка проверки
// 19.10.2026). false — не запущена
/** @param {Env} env @param {string} cid @param {Record<string, any>} b @param {number} now @returns {Promise<boolean>} */
export async function bcStarted(env, cid, b, now) {
  if (!(await bcRun(env, cid, b.id, true))) {
    b.status = "paused"; b.note = "Не попала в очередь отправки: хранилище не ответило. Нажмите «Продолжить».";
    try { await bcPut(env, cid, b); } catch (e) { console.log("bc save", String(e)); }
    return false;
  }
  try { await bcLastSave(env, cid, { at: now, name: b.name, text: snip(b.text, 600) }); } catch (e) { console.log("bclast", String(e)); } // текст рассылки увидят ИИ (клиент может ответить на неё) и администратор в пульте
  return true;
}
