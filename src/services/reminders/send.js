// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Напоминания: отправка одного напоминания (remindSend) и обход очереди (remindRun).
import { kvRetry } from "../../db/kv/retry.js";
import { logTurns } from "../../db/kv/chats.js";
import { REMIND_LATE } from "../../config/constants.js";
import { CLIENTS, hasClient } from "../../config/builtin-clients.js";
import { syncClients } from "../tenants/passport.js";
import { gaRoute, gaShared } from "../integrations/greenapi/webhook.js";
import { sendGreen } from "../channels/greenapi.js";
import { sendWA } from "../channels/meta.js";
import { waRoute } from "../channels/index.js";
import { remindText } from "./plan.js";
export async function remindSend(env, cid, x, now) {
  if (!hasClient(cid)) return false;
  const c = CLIENTS[cid];
  if (c.off || (x.k === "rv" ? !c.review : c.remind === "off" || (x.k === "h2" && c.remind === "day"))) return false; // бот выключен или в паспорте это уже выключили
  const mk = `rms:${cid}:${x.rec}:${x.k}`;
  if (await env.KV.get(mk)) return false;
  const hk = `h:${x.ch}:${cid}:${x.id}`, h = JSON.parse((await env.KV.get(hk)) || "null"), p = (h && h.profile) || {};
  const b = (p.bookings || []).find(v => String(v.record_id) === x.rec);
  if (!b || b.rq || b.date !== x.date || b.time !== x.time || p.stop) return false; // запись отменена, перенесена, по ней просьба — или клиент написал «стоп»
  if (x.ch === "wa" && !(p.li && now - p.li < 24 * 3600e3)) return false;          // официальный WhatsApp: вне 24-часового окна писать можно только шаблоном
  const route = x.ch === "ga" ? gaRoute(env, cid) || gaShared(env) : waRoute(env, cid, p);
  if (!route) return false;
  const text = remindText(c, b, x.k, p.lang);
  await env.KV.put(mk, "1", { expirationTtl: 3 * 86400 });
  let r; try { r = x.ch === "ga" ? await sendGreen(env, x.id + "@c.us", text, route, true) : await sendWA(env, x.id, text, route); } catch (e) { r = { ok: false, error: String(e) }; }
  if (!(r && r.ok)) { console.log("remind send", cid, x.k, JSON.stringify(r).slice(0, 200)); return false; }
  try { await logTurns(env.KV, hk, [{ role: "model", text, t: now, rm: x.k }]); } catch (e) { console.log("remind log", String(e)); }
  return true;
}
export async function remindRun(env, now) {
  let ix; try { ix = JSON.parse((await env.KV.get("rmidx")) || "[]"); } catch (e) { console.log("remind", String(e)); return 0; }
  if (!ix.length) return 0;
  try { await syncClients(env); } catch (e) { console.log("cfg", String(e)); }
  let sent = 0;
  for (const cid of ix) {
    let due = [], empty = false;
    try {
      await kvRetry(async () => { // берём из очереди наступившие (не больше 5 за запуск) и убираем устаревшие
        const q = JSON.parse((await env.KV.get("rmq:" + cid)) || "[]"), keep = [];
        due = [];
        for (const x of q) { if (x.at > now) keep.push(x); else if (now - x.at <= REMIND_LATE) (due.length < 5 ? due : keep).push(x); }
        empty = !keep.length;
        if (keep.length !== q.length) { if (empty) await env.KV.delete("rmq:" + cid); else await env.KV.put("rmq:" + cid, JSON.stringify(keep)); }
      });
    } catch (e) { console.log("remind queue", cid, String(e)); continue; }
    for (const x of due) { try { if (await remindSend(env, cid, x, now)) sent++; } catch (e) { console.log("remind", cid, String((e && e.stack) || e)); } }
    if (empty) { try { await kvRetry(async () => { const cur = JSON.parse((await env.KV.get("rmidx")) || "[]"); if (cur.includes(cid) && !(await env.KV.get("rmq:" + cid))) await env.KV.put("rmidx", JSON.stringify(cur.filter(v => v !== cid))); }); } catch (e) { console.log("remind idx", String(e)); } }
  }
  return sent;
}
