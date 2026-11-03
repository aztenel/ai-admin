// @ts-check
// Реклама — только с подтверждённым согласием (решение владельца 31.10.2026; ТЗ Winchester v2.0 §5): рассылка по базе Altegio
// (services/crm, автосценарий «Пора на стрижку», рассылка из сегмента) спрашивает разрешённые номера здесь. Базы согласий D1
// нет (боевой сайт) или она не отвечает — разрешённых нет: рекламы нет, причина видна в пульте («закрыто наглухо»).
// reasons — почему остальным нельзя (для воронки рассылки, ТЗ v3.0 P0): block, stop, review, denied, unconfirmed, noconsent, cooldown.
// Кого нет в базе контактов вовсе — в reasons нет: для воронки это «нет согласия». Кому можно — решает только phones.
/** @import { Env, Client } from "../../lib/types.js" */
import { d1Ready } from "../../db/d1/status.js";
import { consentGate } from "../../db/d1/contacts.js";
import { optoutPhones } from "../../db/kv/optout.js";
import { normPhone } from "../../lib/phone.js";
import { altClientsSearch } from "../integrations/altegio/clients-api.js";
import { altUserKey } from "../booking/journal.js";
import { altLoc } from "../booking/book.js";
import { GAP_MS } from "./segments.js";

// Согласие по умолчанию (решение владельца 03.11.2026, Winchester: «клиенты дали согласие при записи»; c.consentPresumed, Text
// CONSENT_PRESUMED_<ID> = 1 / 0 меняет без выкладки): рекламу можно всем клиентам базы, кроме отказавшихся. Отказ — «стоп» (D1 и KV),
// неоднозначный «стоп», полный запрет и запрет рекламы, «нет» в согласии, отказ в Altegio («не получает массовые уведомления» — читается
// из Altegio, пока база контактов D1 пуста), а ещё пауза после отменённой записи. Отказы из Altegio не прочитались — рекламы нет никому.
/** @param {Env} env @param {Client} c */
export const consentPresumed = (env, c) => { const v = env["CONSENT_PRESUMED_" + String(c.id).toUpperCase()]; return v === "1" ? true : v === "0" ? false : !!(/** @type {any} */ (c).consentPresumed); };
const DENY = new Set(["block", "review", "stop", "denied", "cooldown"]);
/** можно ли рекламу этому номеру по разрешениям (правила рассылки — запись, недавний визит, реклама за 30 дней — отдельно, crmView)
 *  @param {any} g ответ marketingGate @param {string} p */
export const gateAllows = (g, p) => !!g && !!g.ready && (g.presumed ? !g.deny.has(p) : g.phones.has(p));
// кто в Altegio «не получает массовые уведомления» — поиск справочника только чтением, память 10 минут
const NOMASS = new Map(), NOMASS_TTL = 10 * 60e3;
/** @param {Env} env @param {Client} c @param {number} now @returns {Promise<Set<string>>} */
async function altNoMass(env, c, now) {
  const hit = NOMASS.get(c.id);
  if (hit && now >= hit.at && now - hit.at < NOMASS_TTL) return hit.set;
  const user = altUserKey(env, c), loc = altLoc(env, c), set = new Set();
  if (!user || !loc) throw new Error("нет ключа журнала Altegio");
  // список отказов читается целиком или никак (находка проверки безопасности 03.11.2026): ответ не как у Altegio, страниц больше предела
  // или прочитано меньше, чем Altegio насчитал, — ошибка, и реклама не уходит никому
  let seen = 0, total = 0, done = false;
  for (let page = 1; page <= 25 && !done; page++) {
    const r = await altClientsSearch(env, user, loc, { page, page_size: 200, fields: ["id", "phone"], order_by: "id", order_by_direction: "ASC", filters: [{ type: "is_mass_notification_allowed", state: { value: false } }] });
    if (!r.ok) throw new Error("ответ Altegio не похож на список клиентов");
    total = Math.max(total, r.total); seen += r.list.length;
    for (const x of r.list) { const p = normPhone(String(x.phone ?? "")).slice(1); if (p) set.add(p); }
    done = r.list.length < 200;
  }
  if (!done || seen < total) throw new Error(`отказы Altegio прочитаны не все (${seen} из ${total})`);
  NOMASS.set(c.id, { at: now, set });
  return set;
}
/** только для проверок: забыть прочитанные отказы Altegio */
export const noMassReset = () => NOMASS.clear();

/** → { ready: база отвечает, phones: кому можно, why: почему никому, reasons: номер → причина } @param {Env} env @param {Client} c @param {number} now */
export async function marketingGate(env, c, now) {
  /** @type {Map<string, string>} */
  const none = new Map(), presumed = consentPresumed(env, c);
  const db = await d1Ready(env, now).catch(() => null);
  if (!db) return { ready: false, presumed, phones: new Set(), reasons: none, deny: none, why: "Нет базы согласий (раздел «Клиенты»): реклама — только тем, кто дал подтверждённое согласие." };
  let g, stops;
  try { stops = await optoutPhones(env, c.id); g = await consentGate(db, c.id, now, stops, GAP_MS); }
  catch (e) { console.log("gate", String(e).slice(0, 120)); return { ready: false, presumed, phones: new Set(), reasons: none, deny: none, why: "База согласий не ответила — рассылка по базе отложена." }; }
  if (!presumed) return { ready: true, presumed, phones: g.phones, reasons: g.why, deny: none, why: "" };
  /** @type {Map<string, string>} */
  const deny = new Map([...g.why].filter(([, r]) => DENY.has(r)));
  for (const p of g.cool) if (!deny.has(p)) deny.set(p, "cooldown");
  for (const p of stops) deny.set(String(p), "stop");
  try { for (const p of await altNoMass(env, c, now)) if (!deny.has(p)) deny.set(p, "denied"); }
  catch (e) { console.log("gate nomass", c.id, String(e).slice(0, 120)); return { ready: false, presumed, phones: new Set(), reasons: none, deny: none, why: "Не прочитались отказы от рассылок в Altegio — реклама отложена." }; }
  return { ready: true, presumed, phones: g.phones, reasons: deny, deny, why: "" };
}
