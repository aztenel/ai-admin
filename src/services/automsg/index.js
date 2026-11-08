// @ts-check
// Раздел «Автоматические сообщения» для пульта (задание владельца 02.11.2026): сведения о девяти сценариях, изменение настроек и проверка
// на номер владельца. Менять (выключатель, текст, время, часы отправки, номер для проверки) и проверять может только владелец —
// проверяет контроллер. Номера клиентов — только маской; номер владельца — целиком только ему.
// Включить сервисный сценарий — значит одобрить его действующий текст: без одобренного текста ничего не уходит (journal.js), а
// включает и правит текст всё равно только владелец. Рекламный — только когда реклама со второго номера разрешена (mkLocked).
/** @import { Env, Client } from "../../lib/types.js" */
import { isPreview } from "../../lib/stage.js";
import { isoDay } from "../../lib/time.js";
import { normPhone, maskPhone, fmtPhone } from "../../lib/phone.js";
import { gaRoute } from "../integrations/greenapi/webhook.js";
import { gaKind, gaWhy } from "../integrations/greenapi/client.js";
import { sendGreen } from "../channels/greenapi.js";
import { altUserKey } from "../booking/journal.js";
import { altLoc } from "../booking/book.js";
import { sendDbOff } from "../inbox/send.js";
import { crmView } from "../crm/segments.js";
import { VARS, cleanText, toCanonical, textIssues, render as mkRender, dataFor, BRACKETS_ISSUE } from "../broadcast/render.js";
import { STOP_RU, DEMO, companyOf } from "../broadcast/library.js";
import { GA_OFF, bcGaOff } from "../broadcast/sender.js";
import { jrOn, sendOnceAuto } from "../reminders/journal.js";
import { serviceVariant } from "../reminders/info.js";
import { scenario, activeOf, approvalFits, svText, svVars, render as svRender, SV_VARS, SV_SAMPLE } from "../reminders/templates.js";
import { logTurns } from "../../db/kv/chats.js";
import { linesRead } from "../../db/kv/inbox.js";
import { jrLogLoad, jrLogAdd, jrHold, svApprovals, svApprove, svVariants } from "../../db/kv/reminders.js";
import { autoLoad, autoEdit, autoCounts, autoTestHit } from "../../db/kv/automsg.js";
import { AUTO, autoDef, autoSettings, timingPatch, windowPatch, timingText, MK_TEXT } from "./catalog.js";
import { mkLocked, mkPick, mkText, birthdays } from "./marketing.js";

const LOG_MAX = 20;          // последних событий сценария — в пульт
const TEST_PER_HOUR = 20;    // проверок за час: номер владельца не засыпаем
const SAMPLE = SV_SAMPLE; // вымышленная запись: ссылки Altegio — пояснением, бонусы 400 и 1 200
/** @type {Record<string, string>} */
const SAY = { on: "включил", off: "выключил", edit: "изменил", test: "проверка" };

/** настройки компании (с тем, что по умолчанию) @param {Env} env @param {Client} c */
export const autoSet = async (env, c) => autoSettings(c, await autoLoad(env, c.id));

/** главный выключатель, номер, Altegio, база отметок — почему сообщения клиентам сейчас не уходят ("" — уходят) @param {Env} env @param {Client} c @param {number} now */
async function readiness(env, c, now) {
  const preview = isPreview(env), route = gaRoute(env, c.id), lines = await linesRead(env, c.id).catch(() => null);
  const master = { on: jrOn(env, c), why: "" };
  if (!c.jr) master.why = "У компании нет автоматических сообщений по журналу Altegio.";
  else if (!master.on) master.why = `Главный выключатель отправки выключен (переменная REMIND_GA_${String(c.id).toUpperCase()} в Cloudflare). Пока он не включён, клиентам ничего не уходит, даже если сценарий включён здесь.`;
  const altegio = { ready: !!env.ALTEGIO_PARTNER && altLoc(env, c) > 0 && !!altUserKey(env, c), why: "" };
  if (!altegio.ready) altegio.why = "Не подключён журнал Altegio: без него сервисные сообщения не знают о записях.";
  const sender = { ready: !!route, phone: route && lines && lines.ga ? fmtPhone(String(lines.ga)) : "", why: route ? "" : "Второй номер (Green-API) не подключён." };
  const db = await sendDbOff(env, now).catch(() => "");
  return { preview, master, altegio, sender, db: env.DB ? db : "", hold: await jrHold(env, c.id) };
}

/** текст сценария для пульта: сервисный — действующий вариант (одобрен ли), рекламный — свой текст или по умолчанию
 *  @param {Client} c @param {any} d @param {any} set @param {Record<string, any>} ap @param {Record<string, any>} own @param {number} now */
function textOf(c, d, set, ap, own, now) {
  if (d.group === "service") {
    const sc = scenario(String(d.sc)), act = sc && activeOf(sc, own);
    if (!sc || !act) return { text: null, preview: "" };
    const b = { ...SAMPLE, date: isoDay(now + 86400e3) };
    // вставки для кнопок: какие подходят сценарию и какие уже стоят в тексте (у встроенных текстов есть {компания}, {услуга и мастер})
    const used = [...`${act.ru} ${act.kk}`.matchAll(/\{([^{}]+)\}/g)].map(m => m[1]).filter(v => SV_VARS.includes(v));
    return { text: { ru: act.ru, kk: act.kk, v: act.v, variant: act.id, own: !act.builtin, approved: approvalFits(ap[sc.id], act), vars: [...new Set([...sc.vars, ...used])] },
      preview: svRender(act.ru, svVars(c, b, "ru")) };
  }
  if (!MK_TEXT[d.id]) return { text: null, preview: "" };
  const tx = set.tx[d.id], r = mkRender(tx.ru, dataFor(DEMO, companyOf(c)));
  return { text: { ru: tx.ru, kk: tx.kk, v: tx.v, own: tx.v > 0, approved: true, vars: VARS.map(x => x.key) }, preview: r.text };
}

/**
 * Всё для раздела: готовность, часы отправки, номер для проверки, сценарии с выключателем, текстом, временем, счётчиками и журналом.
 * @param {Env} env @param {Client} c @param {number} now @param {boolean} owner
 */
export async function autoInfo(env, c, now, owner) {
  const set = await autoSet(env, c), ready = await readiness(env, c, now);
  const [ap, own, log] = await Promise.all([svApprovals(env, c.id), svVariants(env, c.id), jrLogLoad(env, c.id)]);
  const days = Array.from({ length: 7 }, (_, i) => isoDay(now - i * 86400e3)), counts = await autoCounts(env, c.id, days);
  const mkBan = mkLocked(env, c);
  /** @type {any} */ let view = null;
  const scenarios = [];
  for (const d of AUTO) {
    const s = set.s[d.id], sum = (/** @type {Record<string, any>[]} */ arr) => {
      const x = { sent: 0, failed: 0, skipped: 0 };
      for (const o of arr) { const v = o[d.id] || {}; x.sent += +v.s || 0; x.failed += (+v.f || 0) + (+v.u || 0); x.skipped += (+v.k || 0) + (+v.c || 0); }
      return x;
    };
    const locked = d.id === "campaigns" ? (bcGaOff(c.id, env) ? GA_OFF + " Черновики, одобрение и проверка на ваш номер — в «Маркетинге»." : "Рассылки создаются и запускаются в «Маркетинге».")
      : d.group === "marketing" ? mkBan : "";
    const tx = textOf(c, d, set, ap, own, now);
    const on = d.id === "campaigns" ? false : s.on;
    const why = !on ? "" : locked || (ready.preview ? "Тестовая версия: отсюда сообщения не уходят." : "") || ready.master.why || ready.sender.why
      || (d.group === "service" ? ready.altegio.why : "") || (d.group === "service" && tx.text && !tx.text.approved ? "Текст не одобрен: сохраните его ещё раз." : "") || "";
    /** @type {any} */ const item = { id: d.id, group: d.group, title: d.title, who: d.who, on, live: on && !why, why, locked,
      at: s.at || 0, by: s.by || "", timing: s.t, fields: d.fields, timingText: timingText(d, s.t, set.win), text: tx.text, preview: tx.preview,
      counts: { today: sum(counts.slice(0, 1)), week: sum(counts) },
      log: log.filter(x => d.kind && x.k === d.kind).slice(-LOG_MAX).reverse().map(x => ({ t: +x.t || 0, st: String(x.st || ""), why: String(x.why || ""), name: String(x.n || ""),
        phone: x.p ? maskPhone(String(x.p)) : "", date: String(x.date || ""), time: String(x.time || "") })) };
    if (d.id === "reactivate") { // сколько клиентов сегодня ровно N дней без визита и скольким из них можно писать рекламу
      try {
        view = view || await crmView(env, c, now);
        const rows = view.rows.filter((/** @type {any} */ x) => x.d === +s.t.days), why = /** @type {Record<string, number>} */ ({});
        for (const x of rows) if (x.why) why[x.why] = (why[x.why] || 0) + 1;
        item.audience = { total: rows.length, allowed: rows.filter((/** @type {any} */ x) => !x.why).length, why, base: !!view.snap };
      } catch (e) { item.audience = null; }
    }
    scenarios.push(item);
  }
  return { client: { id: c.id, name: c.name }, owner, stage: ready.preview ? "preview" : "production", now,
    master: ready.master, sender: ready.sender, altegio: ready.altegio, db: ready.db, hold: ready.hold,
    window: set.win, cap: set.cap, marketing: { allowed: !mkBan, why: mkBan },
    test: set.test ? { phone: owner ? fmtPhone(set.test.p) : maskPhone(set.test.p) } : null, scenarios };
}

/** рекламный текст: из чипов вставок, с отказом в конце, без [скобок] → { ru, kk } или { error } @param {any} b */
function mkTextCheck(b) {
  const ru = cleanText(toCanonical(b.ru ?? ""), 1000), kk = cleanText(toCanonical(b.kk ?? ""), 1000);
  if (!ru) return { error: "Нужен текст на русском." };
  if (!/стоп/i.test(ru)) return { error: "Добавьте в конце, как отказаться: " + STOP_RU };
  if (kk && !/стоп/i.test(kk)) return { error: "В казахском тексте тоже нужен отказ: «стоп» деп жазыңыз." };
  const bad = [...textIssues(ru), ...(kk ? textIssues(kk) : [])];
  if (bad.length) return { error: bad[0] === BRACKETS_ISSUE ? "Уберите [скобки]: впишите настоящий текст." : bad[0] + ". Вставки добавляйте кнопками над полем." };
  return { ru, kk };
}

/**
 * Изменить настройки (только владелец): { id, on } — выключатель; { id, timing } — время; { id, text: { ru, kk } } — текст;
 * { window, cap } — часы отправки и предел за сутки; { testPhone } — номер для проверки. → { ok } или { error, status, code? }
 * @param {Env} env @param {Client} c @param {any} b @param {string} who @param {number} now
 */
export async function autoChange(env, c, b, who, now) {
  const set = await autoSet(env, c), by = String(who || "").slice(0, 32);
  // номер для проверки — у любой компании со вторым номером (проба рассылки из «Маркетинга» тоже уходит только на него)
  if (b.testPhone != null) {
    const raw = String(b.testPhone).trim(), p = raw ? normPhone(raw).slice(1) : "";
    if (raw && !p) return { error: "Номер для проверки — полностью, например +7 701 123 45 67.", status: 400 };
    await autoEdit(env, c.id, o => { if (p) o.test = { p, at: now, by }; else delete o.test; });
    return { ok: true };
  }
  if (!c.jr) return { error: "У компании нет автоматических сообщений.", status: 404 };
  if (b.window != null || b.cap != null) {
    const w = windowPatch(b, set.win, set.cap);
    if ("error" in w) return { error: w.error, status: 400 };
    await autoEdit(env, c.id, o => { o.win = w.win; o.cap = w.cap; });
    return { ok: true };
  }
  const d = autoDef(String(b.id || ""));
  if (!d) return { error: "Сценарий не найден.", status: 404 };
  /** @type {any[]} */ const ev = [];
  // сначала всё проверить, потом записывать: ошибка в тексте не оставляет сохранённым новое время, отказ включить — новый текст
  // (находка проверки пульта 02.11.2026: время записывалось раньше, чем проверялся текст)
  /** @type {Record<string, any> | null} */ let timing = null;
  if (b.timing != null) { const r = timingPatch(d, b.timing, set.win, set.s[d.id].t); if ("error" in r) return { error: r.error, status: 400 }; timing = r.t; }
  const on = b.on == null ? null : b.on === true;
  if (on != null && d.id === "campaigns") return { error: "Рассылки запускаются в «Маркетинге», здесь их не включают.", status: 409, code: "locked" };
  if (on && d.group === "marketing" && mkLocked(env, c)) return { error: mkLocked(env, c), status: 409, code: "locked" };
  /** @type {{ ru: string, kk: string } | null} */ let mk = null;
  if (b.text != null && d.group !== "service") {
    if (!MK_TEXT[d.id]) return { error: "У этого сценария нет своего текста.", status: 400 };
    const ck = mkTextCheck(b.text);
    if ("error" in ck) return { error: ck.error, status: 400 };
    mk = ck;
  }
  if (on && d.group === "marketing" && !mk) { const ck = mkTextCheck(set.tx[d.id]); if ("error" in ck) return { error: ck.error, status: 400 }; }
  const sc = d.group === "service" ? scenario(String(d.sc)) : null;
  if ((on || b.text != null) && d.group === "service" && !(sc && activeOf(sc, await svVariants(env, c.id)))) return { error: "У сценария нет текста.", status: 400 };
  // запись: текст (сервисный проверяется и пишется одним шагом — первым, до остального), время, выключатель
  if (b.text != null && sc) {
    const act = /** @type {any} */ (activeOf(sc, await svVariants(env, c.id)));
    const r = await serviceVariant(env, c, { id: sc.id, ...(act.builtin ? {} : { variant: act.id }), ru: b.text.ru, kk: b.text.kk ?? "", active: true }, by, now);
    if (!r.ok) return { error: r.error, status: r.status || 400 };
    const now2 = activeOf(sc, await svVariants(env, c.id));
    if (now2) await svApprove(env, c.id, sc.id, now2.v, true, now, now2.id); // правит владелец — новая версия сразу одобрена им
    ev.push({ t: now, k: d.kind, rec: "", p: "", n: by, date: "", time: "", st: "edit", why: "текст сообщения" });
  }
  if (mk) {
    const t = mk;
    await autoEdit(env, c.id, o => { o.tx = o.tx || {}; const was = o.tx[d.id] || {}; o.tx[d.id] = { ru: t.ru, kk: t.kk, v: (+was.v || 0) + 1, at: now, by }; });
    ev.push({ t: now, k: d.kind, rec: "", p: "", n: by, date: "", time: "", st: "edit", why: "текст сообщения" });
  }
  if (timing) {
    const t = timing;
    await autoEdit(env, c.id, o => { o.s = o.s || {}; o.s[d.id] = { ...(o.s[d.id] || { on: false }), t }; });
    ev.push({ t: now, k: d.kind, rec: "", p: "", n: by, date: "", time: "", st: "edit", why: `время: ${timingText(d, t, set.win)}` });
  }
  if (on != null) {
    if (on && sc) { // включить — одобрить действующий текст (включает и правит тексты только владелец)
      const act = activeOf(sc, await svVariants(env, c.id));
      if (act && !approvalFits((await svApprovals(env, c.id))[sc.id], act)) await svApprove(env, c.id, sc.id, act.v, true, now, act.id);
    }
    await autoEdit(env, c.id, o => { o.s = o.s || {}; o.s[d.id] = { ...(o.s[d.id] || {}), on, at: now, by }; });
    ev.push({ t: now, k: d.kind, rec: "", p: "", n: by, date: "", time: "", st: on ? "on" : "off", why: `${SAY[on ? "on" : "off"]} ${by || "владелец"}` });
  }
  if (!ev.length) return { error: "Нечего менять.", status: 400 };
  if (d.kind) { try { await jrLogAdd(env, c.id, ev); } catch (e) { console.log("auto log", String(e)); } }
  return { ok: true };
}

/**
 * Проверка сценария на номере владельца (только владелец): тот же текст, что уйдёт клиенту, на вымышленной записи (сервисный —
 * действующий вариант, даже не одобренный: его и проверяют). Только на номер для проверки из настроек, не на любой; с тестовой версии
 * не уходит (текст показываем); не больше 20 за час; двойное нажатие — одно сообщение (rid).
 * → { ok, text, to } или { error, status, code?, preview? }
 * @param {Env} env @param {Client} c @param {any} b { id, lang?, rid } @param {string} who @param {number} now
 */
export async function autoTest(env, c, b, who, now) {
  const d = autoDef(String(b.id || ""));
  if (!d || d.id === "campaigns") return { error: "Проверку рассылки отправляют из мастера рассылки в «Маркетинге».", status: 400 };
  const set = await autoSet(env, c), lang = b.lang === "kk" ? "kk" : "ru";
  let text = "";
  if (d.group === "service") {
    const sc = scenario(String(d.sc)), act = sc && activeOf(sc, await svVariants(env, c.id));
    const t = act ? svText(c, d.kind, { ...SAMPLE, date: isoDay(now + 86400e3) }, lang, act) : null;
    text = t ? t.text : "";
  } else {
    const t = mkText(c, set, d.id, { n: DEMO.name, staff: DEMO.staff, svc: DEMO.svc, d: DEMO.d }, lang);
    if (t.blocked) return { error: "Текст не собрать: " + (t.issues[0] || "нет данных"), status: 400, preview: t.text };
    text = t.text;
  }
  if (!text) return { error: "У сценария нет текста.", status: 400 };
  if (!set.test) return { error: "Сначала укажите номер для проверки (ваш номер) вверху раздела.", status: 409, code: "notest", preview: text };
  const route = gaRoute(env, c.id);
  if (!route) return { error: "Второй номер (Green-API) не подключён: проверку отправить не с чего.", status: 409, code: "nosender", preview: text };
  if (isPreview(env)) return { error: "Это тестовая версия: проверка отсюда не отправляется. Текст показан ниже.", status: 409, code: "preview", preview: text };
  if (await autoTestHit(env, c.id, now) >= TEST_PER_HOUR) return { error: "Слишком много проверок за час. Подождите немного.", status: 429 };
  const p = set.test.p, rid = "t-" + String(b.rid || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  if (rid.length < 8) return { error: "Обновите страницу пульта: у проверки нет номера отправки.", status: 400 };
  /** @type {Record<string, any>} */ let res = { ok: false, code: "ga:net" };
  const once = await sendOnceAuto(env, c.id, p, rid, async () => {
    try { res = await sendGreen(env, p + "@c.us", text, route, true); } catch (e) { res = { ok: false, status: 0, code: "ga:net", error: String(e) }; }
    return res.ok ? { ok: true, ...(res.id ? { id: String(res.id) } : {}) } : gaKind(res.code) === "net" ? { ok: true, unknown: true } : { ok: false };
  });
  if (once && "blocked" in once) return { error: once.blocked.error, status: once.blocked.status, code: once.blocked.code, preview: text };
  if (once && "dup" in once) return { ok: true, text, to: fmtPhone(p), dup: true };
  if (!res.ok && gaKind(res.code) !== "net") return { error: `Green-API не принял сообщение (${gaWhy(res, route)}).`, status: 409, preview: text };
  const unsure = !res.ok;
  try { await logTurns(env.KV, `h:ga:${c.id}:${p}`, [{ role: "model", text, t: now, rm: d.kind, test: 1, ...(res.id ? { mid: String(res.id).slice(0, 80) } : {}), st: unsure ? "unknown" : "sent" }]); }
  catch (e) { console.log("auto test log", String(e)); }
  try { await jrLogAdd(env, c.id, [{ t: now, k: d.kind, rec: "", p, n: String(who || "").slice(0, 32), date: "", time: "", st: "test", why: unsure ? "проверка: не знаем, ушло ли" : "проверка на номер владельца" }]); }
  catch (e) { console.log("auto test journal", String(e)); }
  return { ok: true, text, to: fmtPhone(p), ...(unsure ? { unknown: true } : {}) };
}

/**
 * Кому рекламный сценарий написал бы сегодня (только владелец): сколько подходит и скольким можно писать — только числа.
 * День рождения — поиск клиентов Altegio (только чтение), реактивация — снимок базы. Ничего не отправляет и не пишет.
 * @param {Env} env @param {Client} c @param {any} b { id } @param {number} now
 */
export async function autoAudience(env, c, b, now) {
  const d = autoDef(String(b.id || ""));
  if (!d || (d.id !== "birthday" && d.id !== "reactivate")) return { error: "Сценарий не найден.", status: 404 };
  const set = await autoSet(env, c);
  try {
    if (d.id === "birthday") {
      const all = await birthdays(env, c, now), allowed = await mkPick(env, c, "birthday", set, now);
      return { ok: true, id: d.id, total: all.length, allowed: allowed.length, day: isoDay(now), at: now };
    }
    const allowed = await mkPick(env, c, "reactivate", set, now);
    return { ok: true, id: d.id, allowed: allowed.length, day: isoDay(now), at: now };
  } catch (/** @type {any} */ e) {
    return { error: String((e && e.message) || "Altegio не ответил — попробуйте через минуту.").slice(0, 200), status: 503 };
  }
}
