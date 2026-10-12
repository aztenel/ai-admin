// @ts-check
// Фоновая задача рассылок (cronRun): раз в минуту — порции идущих рассылок.
import { hasClient } from "../config/builtin-clients.js";
import { syncClients } from "../services/tenants/passport.js";
import { bcRun, bcTick } from "../services/broadcast/sender.js";
/** @import { Env } from "../lib/types.js" */
// фоновая отправка: раз в минуту — одна порция одной рассылки (у бесплатного тарифа Cloudflare 50 внешних запросов на запуск)
/** @param {Env} env */
export async function cronRun(env) {
  let run = [];
  try { run = JSON.parse((await env.KV.get("bcrun")) || "[]") || []; } catch (e) { console.log("cron", String(e)); return 0; }
  if (!run.length) return 0;
  try { await syncClients(env, true); } catch (e) { console.log("cfg", String(e)); }
  const k = Math.floor(Date.now() / 60e3) % run.length, gaSent = new Set();
  let n = 0;
  for (const x of run.slice(k).concat(run.slice(0, k)).slice(0, 5)) { // по очереди: у каждой рассылки своя минута
    if (!hasClient(x.c)) { await bcRun(env, x.c, x.id, false); continue; }
    let r; try { r = await bcTick(env, x.c, x.id, gaSent.has(x.c)); } catch (/** @type {any} */ e) { console.log("cron bc", String((e && e.stack) || e)); continue; }
    n++;
    if (r.error || !["running", "wait", "busy"].includes(r.state)) await bcRun(env, x.c, x.id, false);
    if (r.did) { if (r.b && r.b.ch === "ga") gaSent.add(x.c); else break; } // Meta — одна порция за запуск (предел внешних запросов); Green-API — по одному сообщению с номера каждого клиента
  }
  return n;
}
