// @ts-check
// Адаптер Telegram: прямые вызовы api.telegram.org — notify (сообщение в чаты клиента), tgFile (файл), tgProbe (проверка на /launch). Бизнес-решений здесь нет.
/** @import { Env } from "../../../lib/types.js" */
import { CLIENTS, hasClient } from "../../../config/builtin-clients.js";
import { clean } from "../../../lib/text.js";

/**
 * @param {Env} env
 * @param {string} text
 * @param {any} [clientId]
 * @returns {Promise<boolean>}
 */
export async function notify(env, text, clientId) { // → true, если хотя бы один чат получил сообщение
  const chats = String((clientId && env["TG_CHAT_" + String(clientId).toUpperCase()]) || (clientId && hasClient(clientId) && CLIENTS[clientId].tg) || env.TG_CHAT || "").split(/[,\s]+/).filter(Boolean);
  if (!env.TG_TOKEN || !chats.length) return false;
  let sent = false;
  /** @param {any} chat_id */
  const post = async chat_id => {
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 6000); // зависший Telegram не должен задерживать ответ клиенту
    try { return await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id, text }), signal: ac.signal }); }
    finally { clearTimeout(timer); }
  };
  for (const chat_id of chats) {
    try {
      let r = await post(chat_id);
      if (r && r.status === 429) { // Telegram просит подождать — одна повторная попытка
        let wait = 1; try { wait = Math.min(3, Math.max(1, +((await r.json()).parameters || {}).retry_after || 1)); } catch (e) {}
        await new Promise(s => setTimeout(s, wait * 1000 + 200));
        r = await post(chat_id);
      }
      if (r && r.ok) sent = true;
    } catch (e) { console.log("tg", String(e)); }
  }
  return sent;
}

// пробное сообщение в Telegram: что именно ответил Telegram по каждому чату
/**
 * @param {Env} env
 * @param {any} c
 * @returns {Promise<{ ok: boolean, text: string }>}
 */
export async function tgProbe(env, c) {
  const chats = String(env["TG_CHAT_" + c.id.toUpperCase()] || c.tg || env.TG_CHAT || "").split(/[,\s]+/).filter(Boolean);
  if (!env.TG_TOKEN) return { ok: false, text: "В Cloudflare нет секрета TG_TOKEN — бот не может писать в Telegram." };
  if (!chats.length) return { ok: false, text: "Не указан чат Telegram: впишите его номер в паспорт бота." };
  const res = [];
  for (const chat_id of chats.slice(0, 5)) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id, text: `Проверка: уведомления бота «${c.name}» приходят сюда ✅` }) });
      /** @type {any} */
      let d = {}; try { d = await r.json(); } catch (e) {}
      res.push(r.ok ? `чат ${chat_id}: доставлено ✅` : `чат ${chat_id}: ❌ ${r.status} ${clean(d.description || "", 120)}${r.status === 403 ? " — откройте бота в Telegram и нажмите «Старт»" : r.status === 400 ? " — проверьте номер чата" : r.status === 401 ? " — неверный TG_TOKEN" : ""}`);
    } catch (e) { res.push(`чат ${chat_id}: ❌ Telegram не ответил`); }
  }
  return { ok: res.every(x => x.includes("✅")), text: res.join("\n") };
}

// Ежедневная резервная копия заявок: в 03:00 по времени клиентов файл с заявками за 30 дней уходит в Telegram администратора (в тот же чат, что и заявки)
/**
 * @param {Env} env
 * @param {any} chat_id
 * @param {string} name
 * @param {string} text
 * @param {any} caption
 * @returns {Promise<boolean>}
 */
export async function tgFile(env, chat_id, name, text, caption) {
  const fd = new FormData(); fd.append("chat_id", chat_id); fd.append("caption", caption); fd.append("document", new Blob([text], { type: "application/json" }), name);
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 15000);
  try { const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendDocument`, { method: "POST", body: fd, signal: ac.signal }); return !!(r && r.ok); }
  catch (e) { return false; } finally { clearTimeout(timer); }
}
