// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 1)
// Напоминания: отправка одного напоминания (remindSend) и обход очереди (remindRun).
/** @import { Env } from "../../lib/types.js" */
import { kvRetry } from "../../db/kv/retry.js";
import { logTurns } from "../../db/kv/chats.js";
import { REMIND_LATE } from "../../config/constants.js";
import { CLIENTS, hasClient } from "../../config/builtin-clients.js";
import { syncClients } from "../tenants/passport.js";
import { gaRoute, gaShared } from "../integrations/greenapi/webhook.js";
import { sendGreen } from "../channels/greenapi.js";
import { sendWA } from "../channels/meta.js";
import { waRoute } from "../channels/index.js";
import { remindText, remindLive } from "./plan.js";
import { logSafe } from "../../lib/phone.js";
import { sendTemplate } from "../channels/templates.js";
// шаблон Meta для напоминания или просьбы об отзыве (вне 24-часового окна). Имя — из Cloudflare: TPL_REMIND_<ID> (накануне и за 2 часа),
// TPL_REVIEW_<ID> (отзыв); «имя:язык» — другой язык шаблона (по умолчанию ru). Подстановки по порядку, как в шаблоне в кабинете Meta:
//   напоминание: {{1}} бизнес, {{2}} «завтра»/«сегодня», {{3}} время, {{4}} услуга и мастер;  отзыв: {{1}} бизнес, {{2}} ссылка на отзыв
/** @param {Env} env @param {any} c @param {any} b @param {string} k @returns {{ tpl: string, lang: string, params: string[] } | null} */
export function remindTpl(env, c, b, k) {
  const raw = String(env[(k === "rv" ? "TPL_REVIEW_" : "TPL_REMIND_") + String(c.id).toUpperCase()] || "").trim();
  if (!/^[a-z0-9_]{1,512}(:[a-z_A-Z]{2,5})?$/.test(raw)) return null;
  const [tpl, lang = "ru"] = raw.split(":");
  const svc = [b.services, b.staffName].filter(Boolean).join(" · ") || "—";
  return { tpl, lang, params: k === "rv" ? [c.name, c.review] : [c.name, k === "d1" ? "завтра" : "сегодня", b.time, svc] };
}
/** @param {Env} env @param {string} cid @param {any} x @param {number} now */
export async function remindSend(env, cid, x, now) {
  if (!hasClient(cid)) return false;
  const c = CLIENTS[cid];
  if (c.off || (x.k === "rv" ? !c.review : c.remind === "off" || (x.k === "h2" && c.remind === "day"))) return false; // бот выключен или в паспорте это уже выключили
  const mk = `rms:${cid}:${x.rec}:${x.k}`;
  if (await env.KV.get(mk)) return false;
  const hk = `h:${x.ch}:${cid}:${x.id}`, h = JSON.parse((await env.KV.get(hk)) || "null"), p = (h && h.profile) || {};
  const b = remindLive(p, x);
  if (!b) return false; // запись отменена, перенесена, по ней просьба — или клиент написал «стоп»
  // официальный WhatsApp (Meta, Wazzapo): вне 24-часового окна — только одобренным шаблоном. Напоминание накануне и просьба об отзыве
  // почти всегда за окном: без шаблона их не было бы вовсе (16.10.2026). Шаблон задаётся в Cloudflare: TPL_REMIND_<ID>, TPL_REVIEW_<ID>
  const tpl = x.ch === "wa" && !(p.li && now - p.li < 24 * 3600e3) ? remindTpl(env, c, b, x.k) : null;
  if (x.ch === "wa" && !(p.li && now - p.li < 24 * 3600e3) && !tpl) return false;
  const route = x.ch === "ga" ? gaRoute(env, cid) || gaShared(env) : waRoute(env, cid, p);
  if (!route) return false;
  const text = remindText(c, b, x.k, p.lang);
  await env.KV.put(mk, "1", { expirationTtl: 3 * 86400 });
  let r; try { r = tpl ? await sendTemplate(env, x.id, tpl, "", route) : x.ch === "ga" ? await sendGreen(env, x.id + "@c.us", text, route, true) : await sendWA(env, x.id, text, route); } catch (e) { r = { ok: false, error: String(e) }; }
  if (!(r && r.ok)) { console.log("remind send", cid, x.k, logSafe(JSON.stringify(r).slice(0, 200))); return false; }
  // отметка «ушло» — отдельным ключом (тот же ключ второй раз за секунду KV не принимает): по ней пульт считает «Отправлено за 3 дня»,
  // неудачные попытки (rms: без rmok:) не считаются (находка проверки 19.10.2026)
  try { await env.KV.put(`rmok:${cid}:${x.rec}:${x.k}`, "1", { expirationTtl: 3 * 86400 }); } catch (e) { console.log("remind ok mark", String(e)); }
  // номер сообщения у провайдера и статус — для галочек в пульте (ТЗ v2.0 §2.3, services/inbox/status.js)
  const rr = /** @type {any} */ (r), mid = String((rr && (rr.id || (rr.ids && rr.ids[0]))) || "").slice(0, 80);
  try { await logTurns(env.KV, hk, [{ role: "model", text, t: now, rm: x.k, ...(mid ? { mid } : {}), st: "sent" }]); } catch (e) { console.log("remind log", String(e)); }
  return true;
}
/** @param {Env} env @param {number} now */
export async function remindRun(env, now) {
  let ix; try { ix = JSON.parse((await env.KV.get("rmidx")) || "[]"); } catch (e) { console.log("remind", String(e)); return 0; }
  if (!ix.length) return 0;
  try { await syncClients(env); } catch (e) { console.log("cfg", String(e)); }
  let sent = 0;
  for (const cid of ix) {
    let due = /** @type {any[]} */ ([]), empty = false;
    try {
      await kvRetry(async () => { // берём из очереди наступившие (не больше 5 за запуск) и убираем устаревшие
        const q = JSON.parse((await env.KV.get("rmq:" + cid)) || "[]"), keep = [];
        due = [];
        for (const x of q) { if (x.at > now) keep.push(x); else if (now - x.at <= REMIND_LATE) (due.length < 5 ? due : keep).push(x); }
        empty = !keep.length;
        if (keep.length !== q.length) { if (empty) await env.KV.delete("rmq:" + cid); else await env.KV.put("rmq:" + cid, JSON.stringify(keep)); }
      });
    } catch (e) { console.log("remind queue", cid, String(e)); continue; }
    for (const x of due) { try { if (await remindSend(env, cid, x, now)) sent++; } catch (/** @type {any} */ e) { console.log("remind", cid, String((e && e.stack) || e)); } }
    if (empty) { try { await kvRetry(async () => { const cur = JSON.parse((await env.KV.get("rmidx")) || "[]"); if (cur.includes(cid) && !(await env.KV.get("rmq:" + cid))) await env.KV.put("rmidx", JSON.stringify(cur.filter(/** @param {any} v */ v => v !== cid))); }); } catch (e) { console.log("remind idx", String(e)); } }
  }
  return sent;
}
