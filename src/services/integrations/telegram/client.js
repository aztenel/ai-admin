// @ts-check
// Адаптер Telegram: прямые вызовы api.telegram.org — notify (сообщение в чаты клиента), tgFile (файл), tgProbe (проверка на /launch). Бизнес-решений здесь нет.
/** @import { Env } from "../../../lib/types.js" */
import { CLIENTS, hasClient } from "../../../config/builtin-clients.js";
import { clean } from "../../../lib/text.js";

// чаты уведомлений клиента: свой TG_CHAT_<ID> → поле tg паспорта → общий чат владельца TG_CHAT (через запятую — несколько)
/** @param {Env} env @param {any} [clientId] @returns {string[]} */
export const tgChats = (env, clientId) => String((clientId && env["TG_CHAT_" + String(clientId).toUpperCase()]) || (clientId && hasClient(clientId) && CLIENTS[clientId].tg) || env.TG_CHAT || "").split(/[,\s]+/).filter(Boolean);
// почему уведомления клиента не уходят вовсе ("" — настроены): notify в этом случае просто возвращает false. У боевого сайта
// и черновика dev переменные в Cloudflare свои (Production / Previews) — настроенный dev ещё не значит настроенный боевой
/** @param {Env} env @param {any} [clientId] @returns {string} */
export function tgOff(env, clientId) {
  if (!env.TG_TOKEN) return "нет секрета TG_TOKEN";
  return tgChats(env, clientId).length ? "" : `нет чата: не заданы ${clientId ? "TG_CHAT_" + String(clientId).toUpperCase() + " и " : ""}TG_CHAT`;
}

/**
 * @param {Env} env
 * @param {string} text
 * @param {any} [clientId]
 * @returns {Promise<boolean>}
 */
export async function notify(env, text, clientId) { // → true, если хотя бы один чат получил сообщение
  const chats = tgChats(env, clientId);
  if (!env.TG_TOKEN || !chats.length) return false;
  let sent = false;
  /** @param {any} chat_id */
  const post = async chat_id => {
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 6000); // зависший Telegram не должен задерживать ответ клиенту
    try { return await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id, text }), signal: ac.signal }); }
    finally { clearTimeout(timer); }
  };
  for (const [i, chat_id] of chats.entries()) {
    try {
      let r = await post(chat_id);
      if (r && r.status === 429) { // Telegram просит подождать — одна повторная попытка
        let wait = 1; try { wait = Math.min(3, Math.max(1, +((await r.json()).parameters || {}).retry_after || 1)); } catch (e) {}
        await new Promise(s => setTimeout(s, wait * 1000 + 200));
        r = await post(chat_id);
      }
      if (r && r.ok) sent = true;
      else if (r) { // отказ Telegram (403 — бот заблокирован или не запущен, 400 — нет такого чата) раньше пропадал молча (22.10.2026);
        // в журнал — код и описание Telegram, без ключа, номера чата и текста сообщения
        // тело читаем со своим пределом 2 с: таймер запроса уже снят, а бот ждёт notify внутри think()
        let d = ""; try { const j = await Promise.race([r.json(), new Promise(s => setTimeout(() => s(null), 2000))]); d = clean(String((j || {}).description || ""), 120); } catch (e) {}
        console.log("tg", `Telegram не принял сообщение (чат ${i + 1} из ${chats.length}): ${r.status} ${d}`.trim());
      }
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
