// @ts-check
// Сведения о номере WhatsApp в Meta (план Meta, шаг 2, 09.11.2026): номер и имя для показа, качество, предел получателей за 24 часа,
// состояние номера и имени, проверка кода, платформа, режим. Раньше то же читал bcHealth прямо через fetch и без срока ответа — теперь
// через metaGet (срок, один повтор при 429/5xx, причины словами); bcHealth отдаёт из этого прежний вид ответа.
// Поле предела в Graph менялось: whatsapp_business_manager_messaging_limit (новое), messaging_limit_tier (старое) — лестница полей
// как у прежнего bcHealth. Поля status, name_status, account_mode и др. — по документации Meta, у нового номера вживую не проверены:
// неизвестное поле убирается, остальное читается.
/** @import { Env } from "../../../lib/types.js" */
/** @import { MetaCreds, MetaOpts, MetaRes } from "./graph.js" */
import { clean } from "../../../lib/text.js";
import { metaNode, metaNeed } from "./graph.js";

const BASE = ["display_phone_number", "verified_name", "quality_rating"];
const NEW = "whatsapp_business_manager_messaging_limit", OLD = "messaging_limit_tier";
const EXTRA = ["status", "name_status", "code_verification_status", "platform_type", "account_mode", "throughput"];

/** предел номера: TIER_250 → 250, TIER_2K → 2000, TIER_UNLIMITED → -1, нет → 0. Объектом ({ current_limit }) — тоже: вид поля у новых
 * версий API вживую не проверен @param {any} v @returns {{ tier: string, limit: number }} */
export function tierOf(v) {
  const x = v && typeof v === "object" ? v.current_limit || v.limit || v.tier || v.value || "" : v;
  const tier = clean(String(x || ""), 40).toUpperCase(), m = /TIER_(\d+)(K)?/.exec(tier);
  return { tier, limit: m ? +m[1] * (m[2] ? 1000 : 1) : /UNLIMITED/.test(tier) ? -1 : 0 };
}
/** @param {any} v */
const upw = v => clean(String(v || ""), 40).toUpperCase();

/**
 * @typedef {{ ok: true, phone: string, name: string, quality: string, limit: number, tier: string, status: string, nameStatus: string,
 *   verify: string, platform: string, mode: string, throughput: string }} MetaPhone
 */
/**
 * Сведения о номере компании. cr — { token, pnid, up? } (metaIds или waCreds). Нет номера или ключа — причина без запроса к Graph.
 * @param {Env} env @param {MetaCreds} cr @param {MetaOpts} [o] @returns {Promise<MetaPhone | MetaRes>}
 */
export async function metaPhone(env, cr, o = {}) {
  const miss = metaNeed(cr, ["token", "pnid"]);
  if (miss) return miss;
  const r = await metaNode(env, cr.token, String(cr.pnid), [...BASE, NEW, ...EXTRA],
    { ...o, ctx: "phone", up: cr.up, alt: { [NEW]: OLD }, ladder: [[...BASE, OLD, ...EXTRA], [...BASE, OLD], BASE] });
  if (!r.ok) { const { fields, j, ...e } = r; return e; }
  const d = r.j || {}, t = tierOf(d[NEW] !== undefined ? d[NEW] : d[OLD]), tp = d.throughput;
  return { ok: true, phone: clean(d.display_phone_number || "", 24), name: clean(d.verified_name || "", 60), quality: upw(d.quality_rating), limit: t.limit, tier: t.tier,
    status: upw(d.status), nameStatus: upw(d.name_status), verify: upw(d.code_verification_status), platform: upw(d.platform_type), mode: upw(d.account_mode),
    throughput: upw(tp && typeof tp === "object" ? tp.level : tp) };
}
