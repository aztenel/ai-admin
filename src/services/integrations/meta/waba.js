// @ts-check
// Сведения аккаунта WhatsApp Business (WABA) компании (план Meta, шаг 2, 09.11.2026): имя, проверка аккаунта и компании, пространство
// шаблонов, подписанные приложения (без подписки вебхуки шаблонов и качества не приходят) и номера аккаунта (принадлежит ли
// PHONE_NUMBER_ID_<ID> этому WABA — опечатка в одной из переменных иначе молча отбросит всё). Только чтение (metaGet); подписка
// приложения — запись, она отдельно и только через metaWrite (шаг 15). Поля WABA — по документации Meta, вживую не проверены.
/** @import { Env } from "../../../lib/types.js" */
/** @import { MetaCreds, MetaOpts, MetaRes } from "./graph.js" */
import { clean } from "../../../lib/text.js";
import { metaGet, metaNode, metaNeed } from "./graph.js";

const WABA_F = ["name", "account_review_status", "business_verification_status", "message_template_namespace", "currency", "timezone_id", "ownership_type", "country"];
const NUM_F = "id,display_phone_number,verified_name,quality_rating,status,name_status";

/** @param {any} v @param {number} [n] */
const s = (v, n = 60) => clean(String(v ?? ""), n);

/**
 * @typedef {{ ok: true, name: string, review: string, verify: string, ns: string, currency: string, country: string,
 *   apps: { id: string, name: string }[] | null, appsWhy?: string, numbers: { id: string, phone: string, name: string, quality: string, status: string, nameStatus: string }[] | null,
 *   numbersWhy?: string, hasPhone: boolean | null }} MetaWaba
 */
/**
 * Сведения WABA. Сам аккаунт не прочитался — ошибка; приложения или номера не прочитались — null и причина рядом (остальное видно).
 * @param {Env} env @param {MetaCreds} ids @param {MetaOpts} [o] @returns {Promise<MetaWaba | MetaRes>}
 */
export async function metaWaba(env, ids, o = {}) {
  const miss = metaNeed(ids, ["token", "waba"]);
  if (miss) return miss;
  const g = { ...o, ctx: /** @type {"waba"} */ ("waba"), up: ids.up }, waba = String(ids.waba);
  const w = await metaNode(env, ids.token, waba, WABA_F, { ...g, ladder: [["name"]] });
  if (!w.ok) { const { fields, j, ...e } = w; return e; }
  const [a, n] = await Promise.all([metaGet(env, ids.token, `${waba}/subscribed_apps`, g), metaGet(env, ids.token, `${waba}/phone_numbers?fields=${NUM_F}&limit=100`, g)]);
  const d = w.j || {};
  const apps = a.ok ? ((a.j && a.j.data) || []).map((/** @type {any} */ x) => { const p = (x && x.whatsapp_business_api_data) || {}; return { id: s(p.id, 32), name: s(p.name) }; }) : null;
  const numbers = n.ok ? ((n.j && n.j.data) || []).map((/** @type {any} */ x) => ({ id: s(x.id, 32), phone: s(x.display_phone_number, 24), name: s(x.verified_name), quality: s(x.quality_rating, 20).toUpperCase(),
    status: s(x.status, 30).toUpperCase(), nameStatus: s(x.name_status, 30).toUpperCase() })) : null;
  return { ok: true, name: s(d.name), review: s(d.account_review_status, 30), verify: s(d.business_verification_status, 30), ns: s(d.message_template_namespace, 80),
    currency: s(d.currency, 8), country: s(d.country, 8), apps, ...(a.ok ? {} : { appsWhy: a.why }), numbers, ...(n.ok ? {} : { numbersWhy: n.why }),
    hasPhone: numbers && ids.pnid ? numbers.some((/** @type {any} */ x) => x.id === String(ids.pnid)) : null };
}
