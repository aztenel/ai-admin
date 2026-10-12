// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 3)
// Веб-чат (POST /api/chat): ограничение с одного IP и обработка сообщения.
import { CLIENTS, hasClient } from "../config/builtin-clients.js";
import { SESSIONS_PER_IP } from "../config/constants.js";
import { json } from "../lib/http.js";
import { TZ } from "../lib/time.js";
import { ipKey } from "../services/booking/limits.js";
import { altLoc } from "../services/booking/book.js";
import { thinkSafe } from "../services/conversation/orchestrator.js";
/** @import { Env } from "../lib/types.js" */

// ================= лимит сессий на IP =================
/** @type {Map<string, number[]>} */
const burst = new Map();
/** @param {any} request @param {Env} env @param {any} c @param {any} sid */
export async function tooMany(request, env, c, sid) {
  const ip = ipKey(request.headers.get("cf-connecting-ip") || "local");
  const now = Date.now(), b = (burst.get(ip) || []).filter(/** @param {number} t */ t => now - t < 60e3);
  b.push(now); burst.set(ip, b); if (burst.size > 5000) burst.clear();
  const real = hasClient(c) && altLoc(env, CLIENTS[c]); // настоящая компания с расписанием, а не демо
  if (b.length > (real ? 30 : 12)) return true; // слишком много сообщений в минуту с одного IP
  // новая сессия считается раз — 1 запись в KV на сессию, а не на сообщение
  if (await env.KV.get(`h:web:${c}:${sid}`)) return false;
  const k = `ip:${ip}:${new Date(now + TZ * 3600e3).toISOString().slice(0, 10)}`;
  const n = +(await env.KV.get(k) || 0);
  if (n >= (+env.SESSIONS_PER_IP || (real ? 40 : SESSIONS_PER_IP))) return true;
  await env.KV.put(k, String(n + 1), { expirationTtl: 86400 });
  return false;
}

/** @param {any} s */
export const cleanSid = s => String(s || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);

/** @param {any} request @param {Env} env @param {any} ctx */
export async function handleWebChat(request, env, ctx) {
  /** @type {any} */ let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
  const c = hasClient(b.c) ? b.c : "dent";
  const sid = cleanSid(b.sid), textIn = String(b.text || "").trim();
  if (!sid || !textIn) return json({ error: "bad request" }, 400);
  let limited = false;
  try { limited = await tooMany(request, env, c, sid); } catch (e) { console.log("limit", String(e)); } // сбой хранилища на счётчике не должен ронять чат
  if (limited) return json({ reply: "Слишком много сообщений. Попробуйте чуть позже или позвоните нам.", offer: [] });
  if (CLIENTS[c].off) return json({ reply: "Сейчас на сообщения отвечает администратор. Напишите нам, пожалуйста, в WhatsApp или позвоните.", offer: [] }); // бот выключен владельцем
  /** @type {any[]} */ const later = [];
  const r = /** @type {any} */ (await thinkSafe(env, env.KV, c, `h:web:${c}:${sid}`, textIn, "веб-чат", { channel: "web", ip: request.headers.get("cf-connecting-ip") || "", defer: ctx && ctx.waitUntil ? /** @param {any} f */ f => later.push(f) : null }));
  if (later.length) ctx.waitUntil(Promise.allSettled(later.map(/** @param {any} f */ f => f()))); // уведомления администратору не задерживают ответ клиенту
  // в браузер не уходят код записи Altegio и служебные пометки для администратора
  /** @param {any} l */ const pub = l => { const { note, altegio, ...rest } = l; return l.kind ? { id: l.id, kind: l.kind, phone: l.phone } : altegio ? { ...rest, altegio: { record_id: altegio.record_id } } : rest; };
  if (r.lead) r.lead = pub(r.lead);
  if (r.leads) r.leads = r.leads.map(pub);
  return json(r);
}
