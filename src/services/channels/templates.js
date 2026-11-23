// @ts-check
// Отправка шаблона (рассылки): напрямую в Meta, через партнёра Meta Wazzapo (WA_VIA_<ID>=wazzapo) или через Pushon (WA_VIA_<ID>=pushon) — с тем же ответом { ok, status?, code?, error? }.
/** @import { Env } from "../../lib/types.js" */
import { sendTemplate as metaTemplate, bcParam, headerMedia } from "../integrations/meta/templates.js";
import { waCreds } from "../integrations/meta/client.js";
import { wzOn, wzSendOwn } from "./wazzapo.js";
import { poOn } from "./pushon.js";
import { poSendTemplate } from "../integrations/pushon/client.js";

export { bcParam };

/**
 * @param {Env} env @param {any} to @param {any} b @param {any} name @param {any} route
 * @param {{ staff?: any, svc?: any, days?: any }} [x] данные строки базы для {мастер}, {услуга}, {дней}
 * @returns {Promise<{ ok: boolean, id?: string, status?: number, code?: number, error?: string }>}
 */
export async function sendTemplate(env, to, b, name, route, x) {
  const po = !!(route && poOn(env, route.client));
  if (!po && !(route && wzOn(env, route.client))) return metaTemplate(env, to, b, name, route, x);
  const cr = waCreds(env, route), params = (b.params || []).map(/** @param {any} t */ t => ({ type: "text", text: bcParam(t, name, b.fallback, x) }));
  const comps = /** @type {any[]} */ ([]).concat(b.img ? [headerMedia(b.img)] : [], params.length ? [{ type: "body", parameters: params }] : []);
  if (po) { // Pushon: свой API, номер — channelId; components как у Meta
    const r = await poSendTemplate(env, cr.token, cr.pnid, String(to), b.tpl, b.lang, comps);
    return r.ok ? { ok: true, id: r.id } : { ok: false, status: r.status, code: r.code, error: r.error };
  }
  const r = await wzSendOwn(env, cr.token, { phone_number_id: cr.pnid, to: String(to).replace(/\D/g, ""), type: "template", template: { name: b.tpl, language: { code: b.lang }, ...(comps.length ? { components: comps } : {}) } });
  return r.ok ? { ok: true, id: r.id } : { ok: false, status: r.status, code: r.code, error: r.error };
}
