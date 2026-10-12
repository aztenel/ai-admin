// @ts-check
// Уведомления администратору в Telegram: «не чаще раза в 10 минут на повод» (noteDue, состояние lastNote живёт только здесь), notifyOnce и ежедневная резервная копия заявок.
/** @import { Env } from "../../lib/types.js" */
import { CLIENTS } from "../../config/builtin-clients.js";
import { local, isoDay } from "../../lib/time.js";
import { allLeads } from "../../db/kv/leads.js";
import { notify, tgFile } from "../integrations/telegram/client.js";

// уведомление администратору не чаще раза в 10 минут на один повод
const lastNote = new Map();
/** @param {string} key @returns {boolean} */
export const noteDue = key => { const now = Date.now(); if (now - (lastNote.get(key) || 0) < 600e3) return false; if (lastNote.size > 500) lastNote.clear(); lastNote.set(key, now); return true; };
/** @param {Env} env @param {string} key @param {string} msg @param {string=} clientId @returns {Promise<void>} */
export async function notifyOnce(env, key, msg, clientId) { if (noteDue(key)) await notify(env, msg, clientId); }

// Ежедневная резервная копия заявок: в 03:00 по времени клиентов файл с заявками за 30 дней уходит в Telegram администратора (в тот же чат, что и заявки)
/** @param {Env} env @param {boolean=} force @returns {Promise<number>} */
export async function backupRun(env, force) {
  const now = Date.now(), d = local(now);
  if (!force && !(d.getUTCHours() === 3 && d.getUTCMinutes() < 10)) return 0;
  if (!env.TG_TOKEN) return 0;
  const day = isoDay(now), mk = "bkdone:" + day;
  if (!force) { try { if (await env.KV.get(mk)) return 0; } catch (e) { return 0; } try { await env.KV.put(mk, "1", { expirationTtl: 3 * 86400 }); } catch (e) { return 0; } } // отметка до отправки: копия не придёт дважды
  let n = 0;
  for (const cid of Object.keys(CLIENTS)) {
    const chats = String(env["TG_CHAT_" + cid.toUpperCase()] || CLIENTS[cid].tg || env.TG_CHAT || "").split(/[,\s]+/).filter(Boolean);
    if (!chats.length) continue;
    let leads; try { leads = await allLeads(env, cid); } catch (e) { console.log("backup", String(e)); continue; }
    if (!leads || !leads.length) continue;
    const name = `zayavki-${cid}-${day}.json`, text = JSON.stringify({ client: cid, day, count: leads.length, leads }, null, 1);
    for (const chat of chats) if (await tgFile(env, chat, name, text, `Резервная копия заявок: ${CLIENTS[cid].name}, ${leads.length} шт. Файл можно сохранить.`)) n++;
  }
  return n;
}
