// @ts-check
// Отправка шаблона (рассылки): напрямую в Meta или через партнёра Meta Wazzapo (WA_VIA_<ID>=wazzapo) — с тем же ответом { ok, status?, code?, error? }.
/** @import { Env } from "../../lib/types.js" */
import { sendTemplate as metaTemplate, bcParam } from "../integrations/meta/templates.js";
import { waCreds } from "../integrations/meta/client.js";
import { wzOn, wzSendOwn } from "./wazzapo.js";

export { bcParam };

/**
 * @param {Env} env @param {any} to @param {any} b @param {any} name @param {any} route
 * @returns {Promise<{ ok: boolean, status?: number, code?: number, error?: string }>}
 */
export async function sendTemplate(env, to, b, name, route) {
  if (!(route && wzOn(env, route.client))) return metaTemplate(env, to, b, name, route);
  const cr = waCreds(env, route), params = (b.params || []).map(/** @param {any} t */ t => ({ type: "text", text: bcParam(t, name, b.fallback) }));
  const comps = /** @type {any[]} */ ([]).concat(b.img ? [{ type: "header", parameters: [{ type: "image", image: { link: b.img } }] }] : [], params.length ? [{ type: "body", parameters: params }] : []);
  const r = await wzSendOwn(env, cr.token, { phone_number_id: cr.pnid, to: String(to).replace(/\D/g, ""), type: "template", template: { name: b.tpl, language: { code: b.lang }, ...(comps.length ? { components: comps } : {}) } });
  return r.ok ? { ok: true } : { ok: false, status: r.status, code: r.code, error: r.error };
}
