// @ts-check
// Сервисные сообщения для пульта (вкладка «Сервисные · номер бота», 19.10.2026): что бот шлёт сам, без администратора (напоминание
// накануне в 18:00, за 2 часа, просьба об отзыве через 3 часа — только по записям, которые клиент сделал в чате с ботом), что стоит
// в очереди и сколько ушло за 3 дня. Номера — только маской: очередь хранит цифры номера (id чата), браузеру они целиком не уходят.
/** @import { Env, Client } from "../../lib/types.js" */
import { maskPhone } from "../../lib/phone.js";
import { botOff } from "../channels/index.js";
import { altLoc } from "../booking/book.js";
import { altUserKey } from "../booking/journal.js";
import { isoDay } from "../../lib/time.js";
import { jrqLoad, jrHold, jrLogLoad, svApprovals, svApprove, svVariants, svVariantsEdit } from "../../db/kv/reminders.js";
import { jrOn } from "./journal.js";
import { remindLive } from "./plan.js";
import { KIND_SC, SV_CATS, SV_VARS, scenario, svCatalog, variantsOf, activeOf, approvedVariant, approvalFits } from "./templates.js";
import { cleanText } from "../broadcast/render.js";

const QUEUE_MAX = 50;
const LOG_MAX = 30; // последних решений по очереди — в пульт
// сколько переписок читаем, чтобы убрать из очереди то, что бот не отправит (запись отменена, перенесена, «стоп»): очередь бывает
// до 500 сообщений — дальше этих переписок сообщения показываем как есть
const CHAT_READS = 50;

// напоминания по журналу Altegio со второго номера (c.jr, journal.js, 30.10.2026): все записи журнала, без бота. Очередь jrq: хранит
// имя из Altegio и цифры номера; в силе ли запись, проверяет отправка (журнал её дня) — здесь показываем очередь как есть.
// ТЗ v2.0 §4 (31.10.2026): у вида — одобрен ли текст владельцем (без одобрения не уходит), каталог сценариев S01–S18 с предпросмотром,
// журнал решений (ушло, отменено — запись перенесена, пропущено и почему, задача администратору) — номера маской
/** @param {Env} env @param {Client} c @param {number} now */
async function journalInfo(env, c, now) {
  const o = { from: 10, to: 21, eve: "18:00", h2: true, rv: true, s01: false, s06: false, ...c.jr }, altegio = altLoc(env, c) > 0 && !!altUserKey(env, c), enabled = jrOn(env, c);
  const go = altegio && enabled, rv = go && o.rv && !!c.review, ap = await svApprovals(env, c.id), own = await svVariants(env, c.id);
  const ok = (/** @type {string} */ k) => { const sc = scenario(KIND_SC[k]); return !!(sc && approvedVariant(sc, ap, own)); };
  const kinds = [
    { k: "s01", label: "Подтверждение сразу после новой записи (кроме записей через бота)", on: go && !!o.s01 },
    { k: "d1", label: `Напоминание накануне в ${o.eve}`, on: go && !!o.eve },
    { k: "h2", label: `Напоминание за 2 часа (только с ${o.from}:00 до ${o.to}:00)`, on: go && !!o.h2 },
    { k: "s06", label: "Новое время после переноса в Altegio", on: go && !!o.s06 },
    { k: "rv", label: "Просьба об отзыве через 3 часа после визита с отметкой «пришёл» (одному клиенту раз в 60 дней)", on: rv, ...(c.review ? { link: String(c.review) } : {}) },
  ].map(x => ({ ...x, sc: KIND_SC[x.k], approved: ok(x.k) }));
  const on = /** @type {Record<string, boolean>} */ (Object.fromEntries(kinds.map(x => [x.k, x.on])));
  const soon = (await jrqLoad(env, c.id)).filter(x => x && on[x.k] && x.at > now - 3600e3).sort((a, b) => a.at - b.at);
  const queue = soon.slice(0, QUEUE_MAX).map(x => ({ k: x.k, at: x.at, ch: "ga", phone: maskPhone(x.p), name: String(x.n || ""), date: x.date, time: x.time,
    ...(x.na ? { why: "текст не одобрен владельцем" } : x.tries ? { why: `не ушло с ${x.tries}-й попытки, пробуем ещё` } : {}) }));
  let sent3d = 0;
  try { const r = await env.KV.list({ prefix: `rmok:${c.id}:`, limit: 1000 }); sent3d = ((r && r.keys) || []).length; } catch (e) {}
  const log = (await jrLogLoad(env, c.id)).slice(-LOG_MAX).reverse().map(x => ({ t: x.t, k: x.k, st: x.st, why: String(x.why || ""), phone: maskPhone(x.p), name: String(x.n || ""), date: x.date, time: x.time }));
  return { kinds, queue, total: soon.length, sent3d, botOff: false, altegio, journal: true, enabled, hold: await jrHold(env, c.id), log,
    cats: SV_CATS, catalog: svCatalog(c, ap, isoDay(now + 86400e3), own) };
}

/** одобрить (или снять одобрение) действующий вариант текста сценария — только владелец (проверяет контроллер). v — версия
 *  действующего варианта (catalog[].v), variant — его id (не обязательно; другой — отказ). → { ok } или { error, status }.
 *  Одобрение не отправляет уже прошедшее: сообщения, время которых было до одобрения, не уходят (journal.js)
 *  @param {Env} env @param {Client} c @param {any} id @param {any} v @param {boolean} on @param {number} now @param {any} [variant] */
export async function serviceApprove(env, c, id, v, on, now, variant) {
  const sc = scenario(String(id || ""));
  if (!c.jr || !sc) return { error: "Сценарий не найден.", status: 404 };
  if (!sc.auto) return { error: "Этот сценарий сам не отправляется, одобрять нечего.", status: 400 };
  const act = activeOf(sc, await svVariants(env, c.id));
  if (!act) return { error: "У сценария нет текста.", status: 400 };
  if (variant != null && variant !== "" && String(variant) !== act.id) return { error: "Сначала сделайте этот вариант действующим, потом одобряйте.", status: 409 };
  if (+v !== act.v) return { error: "Текст изменился. Обновите страницу и проверьте новую версию.", status: 409 };
  await svApprove(env, c.id, sc.id, act.v, on, now, act.id);
  return { ok: true };
}

/** свой текст: только переменные из списка, без одиночных [скобок] (это незаполненные данные), до 600 знаков → "" или что не так
 *  @param {string} t */
function svCheck(t) {
  if (t.length > 600) return "Текст длиннее 600 знаков.";
  for (const m of t.matchAll(/\{([^{}]*)\}/g)) if (!SV_VARS.includes(m[1])) return `Неизвестная вставка {${m[1].slice(0, 30)}}. Можно: ${SV_VARS.map(x => "{" + x + "}").join(", ")}.`;
  if (/[{}]/.test(t.replace(/\{[^{}]*\}/g, ""))) return "Фигурные скобки ставьте только у вставок, например {время}.";
  if (/[[\]]/.test(t.replace(/\[\[[\s\S]*?\]\]/g, ""))) return "Уберите квадратные скобки: впишите настоящий текст.";
  return "";
}
/** варианты для пульта @param {any} sc @param {Record<string, any>} own @param {Record<string, any>} ap */
const variantsPub = (sc, own, ap) => { const act = activeOf(sc, own); return variantsOf(sc, own).map(y => ({ id: y.id, ru: y.ru, kk: y.kk, active: !!act && y.id === act.id, approved: !!sc.auto && approvalFits(ap[sc.id], y), v: y.v, builtin: y.builtin })); };

/**
 * Свой вариант текста сценария (только владелец — проверяет контроллер): без variant — новый (ru обязателен, kk — нет); variant
 * своего варианта и ru — правка (версия +1, одобрение к новой версии не подходит); active: true — сделать действующим (и встроенный).
 * Встроенные тексты не меняются. → { ok, id, variant, active, variants } или { error, status }
 * @param {Env} env @param {Client} c @param {any} b { id, variant?, ru?, kk?, active? } @param {string} who @param {number} now
 */
export async function serviceVariant(env, c, b, who, now) {
  const sc = scenario(String(b.id ?? b.sc ?? ""));
  if (!c.jr || !sc) return { error: "Сценарий не найден.", status: 404 };
  if (!sc.ru.length) return { error: "У этого сценария нет своего текста клиенту.", status: 400 };
  const vid = b.variant != null && b.variant !== "" ? String(b.variant).slice(0, 24) : "", edit = b.ru != null;
  const ru = edit ? cleanText(b.ru, 700) : "", kk = edit ? cleanText(b.kk ?? "", 700) : "";
  if (edit && !ru) return { error: "Нужен текст на русском.", status: 400 };
  const bad = edit ? svCheck(ru) || (kk ? svCheck(kk) : "") : "";
  if (bad) return { error: bad, status: 400 };
  const all = variantsOf(sc, await svVariants(env, c.id)), cur = vid ? all.find(x => x.id === vid) : null;
  if (vid && !cur) return { error: "Такого варианта нет.", status: 404 };
  if (cur && cur.builtin && edit) return { error: "Встроенный текст не меняется. Добавьте свой вариант.", status: 400 };
  if (!vid && !edit) return { error: "Нужен текст на русском.", status: 400 };
  if (!vid && all.filter(x => !x.builtin).length >= 5) return { error: "Своих вариантов не больше пяти. Измените один из них.", status: 400 };
  const id = vid || "u" + now.toString(36) + Math.random().toString(36).slice(2, 4), by = String(who || "").slice(0, 32);
  const own = await svVariantsEdit(env, c.id, o => {
    const e = o[sc.id] && typeof o[sc.id] === "object" ? o[sc.id] : {};
    const list = Array.isArray(e.list) ? e.list : [];
    if (edit) {
      const i = list.findIndex(/** @param {any} x */ x => x && x.id === id);
      if (i < 0) list.push({ id, ru, kk, v: 1, at: now, by });
      else if (list[i].ru !== ru || String(list[i].kk || "") !== kk) list[i] = { ...list[i], ru, kk, v: (+list[i].v || 1) + 1, at: now, by };
    }
    e.list = list;
    if (b.active === true) e.active = id; else if (b.active === false && e.active === id) delete e.active;
    o[sc.id] = e;
  });
  const act = activeOf(sc, own);
  return { ok: true, id: sc.id, variant: id, active: act ? act.id : "", variants: variantsPub(sc, own, await svApprovals(env, c.id)) };
}

/** @param {Env} env @param {Client} c @param {number} now */
export async function serviceInfo(env, c, now) {
  if (c.jr) return journalInfo(env, c, now);
  // напоминания и отзыв бот строит только по своим записям в Altegio (remindPlan в orchestrator.js): без Altegio они не уходят никогда
  const altegio = altLoc(env, c) > 0;
  const remind = altegio && c.remind !== "off", h2 = remind && c.remind !== "day", rv = altegio && !!c.review;
  const kinds = [
    { k: "d1", label: "Напоминание о записи накануне в 18:00", on: remind },
    { k: "h2", label: "Напоминание о записи за 2 часа", on: h2 },
    { k: "rv", label: "Просьба оставить отзыв через 3 часа после визита", on: rv, ...(c.review ? { link: String(c.review) } : {}) },
  ];
  /** @type {any[]} */ let q = [];
  try { q = JSON.parse((await env.KV.get("rmq:" + c.id)) || "[]") || []; } catch (e) { console.log("service queue", String(e)); }
  const on = /** @type {Record<string, boolean>} */ ({ d1: remind, h2, rv });
  const soon = q.filter(x => x && on[x.k] && x.at > now - 3600e3).sort((a, b) => a.at - b.at);
  // в силе ли: те же правила, что у отправки (remindLive). Переписку читаем одну на клиента; не прочиталась — показываем как есть
  const keys = [...new Set(soon.map(x => `h:${x.ch}:${c.id}:${x.id}`))].slice(0, CHAT_READS);
  /** @type {Map<string, any>} */ const prof = new Map();
  await Promise.all(keys.map(async k => { try { const h = JSON.parse((await env.KV.get(k)) || "null"); prof.set(k, (h && h.profile) || {}); } catch (e) { console.log("service chat", String(e)); } }));
  const due = soon.filter(x => { const p = prof.get(`h:${x.ch}:${c.id}:${x.id}`); return p === undefined || !!remindLive(p, x); });
  // имена — из строк списка чатов (метаданные ключей h:<канал>:<клиент>:<id>), без чтения каждой переписки
  /** @type {Map<string, string>} */ const names = new Map();
  for (const ch of [...new Set(due.slice(0, QUEUE_MAX).map(x => x.ch))]) {
    try { const r = await env.KV.list({ prefix: `h:${ch}:${c.id}:`, limit: 1000 }); for (const k of (r && r.keys) || []) if (k.metadata && k.metadata.nm) names.set(k.name, String(k.metadata.nm)); } catch (e) {}
  }
  const queue = due.slice(0, QUEUE_MAX).map(x => ({ k: x.k, at: x.at, ch: x.ch, phone: maskPhone(x.id), name: names.get(`h:${x.ch}:${c.id}:${x.id}`) || "", date: x.date, time: x.time }));
  // «ушло» — отметка rmok:<клиент>:<запись>:<вид> (3 дня), её ставит удачная отправка; rms: — только попытка (могла не дойти)
  let sent3d = 0;
  try { const r = await env.KV.list({ prefix: `rmok:${c.id}:`, limit: 1000 }); sent3d = ((r && r.keys) || []).length; } catch (e) {}
  return { kinds, queue, total: due.length, sent3d, botOff: botOff(env, c, "ga"), altegio };
}
