// @ts-check
// Автосценарий «Пора на стрижку» (docs/tz-winchester-v2.md §4.3, 19.10.2026): каждый день в 11:00 по Астане — один шаблон Meta тем, у кого
// ровно N дней (по умолчанию 28) с последнего визита и кому можно писать (нет «стоп», будущей записи, маркетинга за 14 дней — segments.js),
// не больше предела в день. Это 10–15 сообщений в день вовремя вместо разовой рассылки на всю базу: дёшево и без жалоб.
// Выключен по умолчанию: без включения владельцем и шаблона ничего не уходит. День пропускается (с сообщением в Telegram), если качество
// номера жёлтое или красное или сегодня не проверено (qualityRun, 10:00), Meta просила остановиться (bchold), номер не подключён или база
// клиентов старше 36 часов. Рассылка автосценария идёт только в день создания (bcTick в sender.js): не успела — назавтра её получателям
// уже не «ровно N дней», а вместе с новой за день ушло бы больше предела.
// Настройки — bcauto:<клиент>, отметка дня — bca:<клиент>:<день> (db/kv/crm.js). На заглушках; вживую не проверено (шаблон ещё не одобрен Meta).
/** @import { Env, Client } from "../../lib/types.js" */
import { clean } from "../../lib/text.js";
import { logSafe } from "../../lib/phone.js";
import { TZ, local, isoDay } from "../../lib/time.js";
import { CLIENTS } from "../../config/builtin-clients.js";
import { AUTO_HOUR, CRM_FRESH_AUTO, CRM_QUIET_DAYS, CRM_PAST_DAYS } from "../../config/constants.js";
import { autoLoad, autoSave, autoDayMark, autoSkipSave, autoSkipLoad } from "../../db/kv/crm.js";
import { notify } from "../integrations/telegram/client.js";
import { bcRoute } from "../broadcast/sender.js";
import { bcHoldRead, bcHoldFor } from "../broadcast/holds.js";
import { qualityGet, qualityFetch } from "../broadcast/quality.js";
import { crmBookedNow } from "./snapshot.js";
import { bcCreate } from "../broadcast/create.js";
import { crmView, crmPick } from "./segments.js";

/** @typedef {{ on: boolean, days: number, tpl: string, lang: string, cap: number, from: number, to: number, text: string }} AutoCfg */
/** @type {Readonly<AutoCfg>} */
export const AUTO_DEF = Object.freeze({ on: false, days: 28, tpl: "", lang: "ru", cap: 20, from: 11, to: 20, text: "" });
const QBAD = /** @type {Record<string, string>} */ ({ YELLOW: "жёлтое (жалобы клиентов растут)", RED: "красное (номер могут ограничить)" });
const QOK = /** @type {Record<string, number>} */ ({ GREEN: 1, HIGH: 1 }); // маркетинг — только при зелёном: UNKNOWN, NA и прочее — не «хорошо»

/** @param {Env} env @param {string} cid @returns {Promise<AutoCfg>} */
export const autoGet = async (env, cid) => ({ ...AUTO_DEF, ...((await autoLoad(env, cid)) || {}) });

// изменения из пульта поверх текущих настроек (можно прислать одно поле, например { on: true }) → { cfg, errors }
/** @param {Client} c @param {Record<string, any>} cur @param {Record<string, any>} body @returns {{ cfg: AutoCfg, errors: string[] }} */
export function autoCheck(c, cur, body) {
  /** @type {Record<string, any>} */
  const x = { ...AUTO_DEF, ...cur }, errors = [];
  if (body.on !== undefined) x.on = body.on === true;
  for (const k of ["days", "cap", "from", "to"]) if (body[k] !== undefined) x[k] = Math.round(+body[k]);
  if (body.tpl !== undefined) x.tpl = String(body.tpl ?? "").trim();
  if (body.lang !== undefined) x.lang = String(body.lang ?? "").trim();
  if (body.text !== undefined) x.text = clean(String(body.text ?? "").replace(/\s*\n\s*/g, " ⏎ "), 1100);
  if (x.tpl && !/^[a-z0-9_]{1,512}$/.test(x.tpl)) errors.push("название шаблона — как в кабинете Meta: строчные латинские буквы, цифры и «_» (например, pora_na_strizhku)");
  if (x.on && !x.tpl) errors.push("чтобы включить, укажите шаблон Meta категории Marketing, который одобрила Meta");
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(x.lang)) errors.push("язык шаблона — код из кабинета Meta: ru, kk, en или en_US");
  if (!(x.days >= 7 && x.days <= 120)) errors.push("дней с последнего визита — от 7 до 120");
  if (!(x.cap >= 1 && x.cap <= 100)) errors.push("сообщений в день — от 1 до 100");
  if (!(x.from >= 8 && x.to <= 22 && x.to > x.from)) errors.push("часы отправки — с 8:00 до 22:00, «с» раньше, чем «до»: ночные сообщения вызывают жалобы");
  // список собирается в 11:00: с часами до 11 приглашения ушли бы только назавтра — на день позже и по базе суточной давности (находка проверки 19.10.2026)
  else if (x.to <= AUTO_HOUR) errors.push(`часы отправки автосценария — «до» позже ${AUTO_HOUR}:00: список собирается в ${AUTO_HOUR}:00, иначе приглашения уйдут только назавтра`);
  if (x.on && !c.crm) errors.push("у этой компании нет базы клиентов из Altegio — автосценарию некому писать");
  const cfg = /** @type {AutoCfg} */ (Object.fromEntries(Object.keys(AUTO_DEF).map(k => [k, x[k]]))); // только известные поля
  return { cfg, errors };
}
/** @param {Env} env @param {Client} c @param {Record<string, any>} body */
export async function autoSet(env, c, body) {
  const { cfg, errors } = autoCheck(c, await autoGet(env, c.id), body);
  if (errors.length) return { ok: false, errors };
  await autoSave(env, c.id, cfg);
  return { ok: true, auto: cfg };
}

// для пульта: настройки, почему недоступен, свежесть базы, кому автосценарий написал бы сегодня (n — с учётом предела в день),
// последняя проверка номера (qual) и почему последний раз пропустил день (skip, за 2 дня) — видно и без Telegram
/** @param {Env} env @param {Client} c @param {number} now */
export async function autoInfo(env, c, now) {
  const auto = await autoGet(env, c.id), route = bcRoute(env, c.id, "");
  /** @type {any} */ let q = null, sk = null;
  try { [q, sk] = await Promise.all([qualityGet(env, c.id), autoSkipLoad(env, c.id)]); } catch (e) {}
  const why = !c.crm ? "У этой компании нет базы клиентов из Altegio — автосценарий недоступен." : route.error || "";
  let at = 0, today = { n: 0, total: 0 };
  if (c.crm) {
    const view = await crmView(env, c, now), all = (await crmPick(env, c, "all", now, { days: auto.days, view })) || [];
    at = view.snap ? view.snap.at : 0; today = { n: Math.min(all.length, auto.cap), total: all.length };
  }
  const note = auto.days < CRM_QUIET_DAYS ? `Тем, кто был меньше ${CRM_QUIET_DAYS} дней назад, маркетинг не пишем — с таким числом дней автосценарию некому писать.`
    : auto.days > CRM_PAST_DAYS ? `В базе — визиты за ${CRM_PAST_DAYS} дней: с таким числом дней автосценарию некому писать.` : "";
  return { auto, available: !!c.crm, why, crm: { at, fresh: !!at && now - at <= CRM_FRESH_AUTO }, today, ...(note ? { note } : {}),
    qual: q ? { quality: String(q.quality || ""), at: +q.at || 0 } : null, ...(sk && now - sk.at < 2 * 86400e3 ? { skip: sk } : {}) };
}

// 11:00–11:09 по Астане: компаниям с базой клиентов (c.crm) и включённым автосценарием — не больше одной рассылки в день
/** @param {Env} env @param {number} now @returns {Promise<number>} сколько рассылок запущено */
export async function autoRun(env, now) {
  const d = local(now);
  if (d.getUTCHours() !== AUTO_HOUR || d.getUTCMinutes() >= 10) return 0;
  let n = 0;
  for (const c of Object.values(CLIENTS)) {
    if (c.off || !c.crm) continue;
    try { if ((await autoOne(env, c, now)).state === "sent") n++; } catch (/** @type {any} */ e) { console.log("auto", c.id, logSafe(String((e && e.stack) || e))); }
  }
  return n;
}

/**
 * Автосценарий одной компании на сегодня. state: off — выключен или сегодня уже был; skip — день пропущен (why — ушло в Telegram);
 * none — сегодня некому; sent — рассылка создана и запущена (id, n — сколько получателей)
 * @param {Env} env @param {Client} c @param {number} now
 * @returns {Promise<{ state: string, why?: string, id?: string, n?: number }>}
 */
export async function autoOne(env, c, now) {
  const cfg = await autoGet(env, c.id);
  if (!cfg.on || !cfg.tpl) return { state: "off" };
  if (!(await autoDayMark(env, c.id, isoDay(now)))) return { state: "off" }; // отметка до работы: сбой не повторяется каждую минуту, рассылка не создаётся дважды
  /** @param {string} why */
  const skip = async why => {
    try { await autoSkipSave(env, c.id, { at: now, why }); } catch (e) { console.log("auto skip", String(e)); }
    try { await notify(env, `⏸ «Пора на стрижку» сегодня не отправлен — ${c.name}\n${why}\nЗавтра в ${AUTO_HOUR}:00 бот проверит снова.`, c.id); } catch (e) { console.log("auto tg", String(e)); }
    return { state: "skip", why };
  };
  try { return await autoDay(env, c, cfg, now, skip); }
  catch (/** @type {any} */ e) { // день уже отмечен: без сообщения владелец не узнал бы, что сегодня ничего не ушло
    console.log("auto", c.id, logSafe(String((e && e.stack) || e)));
    return skip("Сбой хранилища — подробности в журнале сервера.");
  }
}
/** @param {Env} env @param {Client} c @param {AutoCfg} cfg @param {number} now @param {(why: string) => Promise<{ state: string, why: string }>} skip */
async function autoDay(env, c, cfg, now, skip) {
  const route = bcRoute(env, c.id, "");
  if (route.error) return skip(route.error);
  const L = local(now), day0 = Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate()) - TZ * 3600e3;
  // качество номера — сегодняшнее: через Wazzapo вебхуков о качестве нет, эта проверка — единственный сигнал, а номер Winchester уже
  // блокировали. Проверка в 10:00 не удалась — ещё одна попытка сейчас (один сбой Meta не отменяет день); не узнали — не «всё хорошо»
  // (находки проверки 19.10.2026)
  let q = await qualityGet(env, c.id);
  if (!q || !(q.at >= day0)) q = (await qualityFetch(env, c, now)).q;
  if (!q) return skip("Номер WhatsApp сегодня не проверен: Meta (или Wazzapo) не ответили ни в 10:00, ни сейчас. Без проверки качества номера маркетинг не отправляю.");
  if (QBAD[q.quality]) return skip(`Качество номера WhatsApp — ${QBAD[q.quality]}: маркетинг сейчас может привести к ограничению номера.`);
  if (!q.quality) return skip("Номер WhatsApp сегодня не проверен: Meta (или Wazzapo) не сообщили качество номера. Без него маркетинг не отправляю — если так каждый день, скажите разработчику.");
  if (!QOK[q.quality]) return skip(`Качество номера WhatsApp — «${clean(q.quality, 20)}», а не зелёное: маркетинг отправляю только при зелёном.`);
  const hold = bcHoldFor(await bcHoldRead(env, c.id), { tpl: cfg.tpl }); // сбой чтения — ошибка → пропуск дня (autoOne), а не «сигнала нет»
  if (hold) return skip(`Сигнал от Meta: ${hold.why}. Когда причина устранена, снимите сигнал на странице рассылок (кнопка «Снять сигнал Meta») — автосценарий продолжит со следующего дня.`);
  const view = await crmView(env, c, now);
  if (!view.snap || now - view.snap.at > CRM_FRESH_AUTO) return skip("База клиентов из Altegio не обновлялась больше 36 часов (ночное обновление не сработало): по старой базе можно написать тому, кто уже записался. Обновите базу в разделе сегментов.");
  /** @type {Set<string>} */ let booked;
  try { booked = await crmBookedNow(env, c, now); }
  catch (/** @type {any} */ e) { console.log("auto booked", c.id, logSafe(String((e && e.message) || e))); return skip("Altegio не ответил при проверке свежих записей — по ночной базе можно написать тому, кто записался утром."); }
  for (const x of view.rows) if (!x.why && booked.has(x.p)) x.why = "fut"; // записался после ночного снимка
  const seg = { id: "all", days: cfg.days };
  if (!((await crmPick(env, c, seg.id, now, { days: cfg.days, view })) || []).length) return { state: "none" };
  // предел рассылки за 24 часа — предел номера Meta с запасом, а не cfg.cap: cfg.cap уже ограничил получателей, а общий счётчик номера (bcq:)
  // учитывает и вчерашний автосценарий, и ручные рассылки — с пределом 20 сегодняшняя отправка ждала бы, пока из суток уйдут вчерашние 20
  const cap = Math.max(cfg.cap, q.limit > 0 ? Math.floor(q.limit * 0.95) : 240);
  const r = await bcCreate(env, c, { name: `Пора на стрижку · ${String(L.getUTCDate()).padStart(2, "0")}.${String(L.getUTCMonth() + 1).padStart(2, "0")}`, tpl: cfg.tpl, lang: cfg.lang,
    text: cfg.text || `Автосценарий «Пора на стрижку»: прошло ${cfg.days} дней с последнего визита — приглашение записаться (шаблон ${cfg.tpl}).`, params: ["{имя}"],
    segment: seg, cap, from: cfg.from, to: cfg.to, consent: true }, now, "auto", { start: true, view, limit: cfg.cap });
  if (!r.ok) return skip(`Не получилось создать рассылку: ${r.errors.join("; ")}.`);
  return { state: "sent", id: r.b.id, n: r.b.total };
}
