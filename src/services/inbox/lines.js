// @ts-check
// Номера компании в пульте (ТЗ v2.0 §2.2): у каждого чата видно, на какой номер написал клиент — основной или второй. Второй номер
// (Green-API) не выдаём за основной. Номер второго — из Green-API (getSettings → wid), раз в 12 часов в фоне, в ln:<клиент>.
/** @import { Env } from "../../lib/types.js" */
import { CLIENTS } from "../../config/builtin-clients.js";
import { gaRoute } from "../integrations/greenapi/webhook.js";
import { gaInfo } from "../integrations/greenapi/client.js";
import { linesRead, linesSave, opsRead } from "../../db/kv/inbox.js";

const DEF = { wa: "Основной номер", ga: "Второй номер", web: "Чат на сайте" };
/** Подпись номера. Компания с одним номером Green-API без своей подписи — просто «WhatsApp». @param {string} cid @param {string} ch @param {string[]} chans */
export function lineLabel(cid, ch, chans) {
  const c = CLIENTS[cid] || {}, own = c.lines && c.lines[ch];
  if (own) return String(own);
  if (ch === "ga" && !chans.includes("wa")) return "WhatsApp";
  return /** @type {any} */ (DEF)[ch] || ch;
}
/** Какие номера у компании подключены на самом деле: Meta — по ключу, Green-API — по маршруту. @param {Env} env @param {string} cid */
export function lineChans(env, cid) {
  const up = cid.toUpperCase(), out = [];
  if (env["WA_TOKEN_" + up] || (env.WA_TOKEN && env.WA_CLIENT === cid)) out.push("wa");
  if (gaRoute(env, cid)) out.push("ga");
  return out.length ? out : ["wa"];
}
/** @param {Env} env @param {string} cid @param {string[]} chans @param {any} [ctx] */
export async function linesOf(env, cid, chans, ctx) {
  const cached = await linesRead(env, cid), out = /** @type {Record<string, any>} */ ({});
  for (const ch of chans) if (ch !== "web") out[ch] = { label: lineLabel(cid, ch, chans), ...(cached && cached[ch] ? { phone: cached[ch] } : {}) };
  if (chans.includes("ga") && (!cached || Date.now() - (+cached.at || 0) > 12 * 3600e3) && ctx && ctx.waitUntil) ctx.waitUntil(refresh(env, cid).catch(e => console.log("lines", String(e))));
  return out;
}
/** @param {Env} env @param {string} cid */
async function refresh(env, cid) {
  const r = gaRoute(env, cid); if (!r) return;
  const i = await gaInfo(env, r);
  await linesSave(env, cid, { at: Date.now(), ...(i && i.phone ? { ga: i.phone } : {}) });
}
/** Имена сотрудников для «Назначить» (кто работал в пульте за 90 дней). @param {Env} env @param {string} cid */
export async function opsOf(env, cid) { return (await opsRead(env, cid)).map(x => x.n); }
