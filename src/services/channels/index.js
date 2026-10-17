// @ts-check
// Общие функции каналов WhatsApp: выбор клиента по номеру, повторы вебхуков, «стоп» на рассылку, ответ с телефона (coex), номер пульта.
/** @import { Env, Profile } from "../../lib/types.js" */
import { clean } from "../../lib/text.js";
import { redact, maskPhones } from "../../lib/phone.js";
import { kvRetry } from "../../db/kv/retry.js";
import { putHist, readHist } from "../../db/kv/chats.js";
import { hasClient } from "../../config/builtin-clients.js";
import { PAUSE_MS, HIST_KEEP } from "../../config/constants.js";

// wx — к какому клиенту и через какой номер пришло сообщение: { client, token, pnid, name }. Пусто — прежний режим: один номер на весь воркер (WA_CLIENT) или меню демо
/** @param {Env} env @param {string} channel @param {Record<string, any>=} wx @returns {string} */
export const fixedOf = (env, channel, wx) => (wx && wx.client) || (channel === "ga" ? env.GA_CLIENT : env.WA_CLIENT);
// бот в WhatsApp выключен: паспорт «выключен» (off) или только WhatsApp (waOff у встроенного бота; Text BOT_WA_<ID> = 1/0 меняет)
/** @param {Env} env @param {any} c @returns {boolean} */
export const waBotOff = (env, c) => {
  if (!c) return false;
  if (c.off) return true;
  const v = env["BOT_WA_" + String(c.id || "").toUpperCase()];
  return v != null && String(v).trim() !== "" ? !/^(1|on|yes|true|да)$/i.test(String(v).trim()) : !!c.waOff;
};
/** @param {Env} env @param {string} channel @param {string} fromDigits @param {Record<string, any>=} wx @returns {Promise<string | null>} */
export async function nicheOf(env, channel, fromDigits, wx) {
  const fixed = fixedOf(env, channel, wx);
  return hasClient(fixed) ? fixed : await env.KV.get(`wa:niche:${channel}:${fromDigits}`);
}

// сообщение уже обработано? Сбой хранилища на этой отметке не должен оставить клиента без ответа: тогда считаем сообщение новым.
// KV не атомарен: две одновременные доставки одного сообщения (вебхук добавлен в кабинете дважды, повтор провайдера) обе читают «не видели»
// и бот отвечает дважды. Поэтому сначала — память экземпляра Worker (одновременные запросы обычно попадают в один экземпляр), потом KV
/** @type {WeakMap<object, Map<string, number>>} */
const recent = new WeakMap();
/** @param {Env} env @param {string} id @returns {Promise<boolean>} */
export async function seenBefore(env, id) {
  const mem = recent.get(env.KV) || new Map(), now = Date.now();
  if (!recent.has(env.KV)) recent.set(env.KV, mem);
  if ((mem.get(id) || 0) > now - 600e3) return true;
  if (mem.size > 5000) { for (const [k, t] of mem) if (t < now - 600e3) mem.delete(k); if (mem.size > 5000) mem.clear(); }
  mem.set(id, now);
  try {
    if (await env.KV.get("seen:" + id)) return true;
    await env.KV.put("seen:" + id, "1", { expirationTtl: 86400 });
  } catch (e) { console.log("seen", String(e)); }
  return false;
}

// Режим «сосуществование» (Meta): человек отвечает клиенту с телефона, а бот и пульт это видят.
/** @param {any} m @returns {string} */
export const coexText = m => { const t = String((m && m.type) || "text"), b = (m && m[t]) || {}; const x = t === "text" ? b.body : (b.caption || ""); return clean(String(x || ""), 1000) || `[${t === "text" ? "сообщение" : t}]`; };
/** @param {Env} env @param {Record<string, any>} wx @param {string} field @param {Record<string, any>} val @returns {Promise<void>} */
export async function waCoex(env, wx, field, val) {
  const pnid = (val.metadata && val.metadata.phone_number_id) || "", w = { ...wx, pnid: wx.pnid || pnid }, now = Date.now();
  const hkOf = async (/** @type {string} */ digits) => { const niche = await nicheOf(env, "wa", digits, w); return niche ? `h:wa:${niche}:${digits}` : ""; };
  if (field === "smb_message_echoes") { // ответ с телефона: пишем в чат как ответ администратора и ставим бота на паузу (как ответ из пульта)
    for (const m of (val.message_echoes || []).slice(0, 50)) {
      const to = String((m && m.to) || "").replace(/\D/g, ""), id = String((m && m.id) || "");
      if (!/^\d{8,15}$/.test(to)) continue;
      const hk = await hkOf(to); if (!hk) continue;
      await kvRetry(async () => {
        const h = (await readHist(env, hk)) || { n: 0, turns: [], profile: {} };
        h.profile = h.profile || {}; const seen = h.profile.echo || [];
        if (id && seen.includes(id)) return; // Meta повторила доставку
        h.profile.echo = seen.concat(id ? [id] : []).slice(-20);
        h.profile.pausedUntil = Math.max(h.profile.pausedUntil || 0, now + PAUSE_MS); delete h.profile.need; h.profile.pn = h.profile.pn || w.pnid || h.profile.pn;
        h.turns = (h.turns || []).concat([{ role: "model", text: coexText(m), t: now, by: "admin", m: "phone" }]).slice(-HIST_KEEP); h.n = (h.n || 0) + 1;
        await putHist(env.KV, hk, h);
      });
    }
    return;
  }
  for (const part of (val.history || []).slice(0, 5)) for (const th of (part && part.threads || []).slice(0, 40)) { // история чатов: добавляем старые реплики перед текущими, бота не будим и «ждут ответа» не поднимаем
    const digits = String((th && th.id) || "").replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(digits)) continue;
    const hk = await hkOf(digits); if (!hk) continue;
    const old = (th.messages || []).slice(-30).map((/** @type {any} */ m) => ({ role: String((m && m.from) || "").replace(/\D/g, "") === digits ? "user" : "model", text: coexText(m), t: (+m.timestamp || 0) * 1000 || now, ...(String((m && m.from) || "").replace(/\D/g, "") === digits ? {} : { by: "admin", m: "phone" }) }));
    if (!old.length) continue;
    await kvRetry(async () => {
      const h = (await readHist(env, hk)) || { n: 0, turns: [], profile: {} };
      h.profile = h.profile || {};
      const key = (/** @type {any} */ x) => x.t + "|" + x.role + "|" + x.text, have = new Set((h.turns || []).map(key));
      h.turns = old.filter((/** @type {any} */ x) => !have.has(key(x))).map((/** @type {any} */ x) => x.role === "user" ? { ...x, text: maskPhones(redact(x.text)) } : x).concat(h.turns || []).sort((/** @type {any} */ a, /** @type {any} */ b) => a.t - b.t).slice(-HIST_KEEP);
      h.n = (h.n || 0) + 1;
      await putHist(env.KV, hk, h);
    });
  }
}
// отказ от рассылок: отметка без срока, не зависит от того, включён ли бот и дошло ли дело до разговора
/** @param {Env} env @param {string} client @param {string | number} digits @returns {Promise<void>} */
export async function markOptout(env, client, digits) {
  if (!client || !/^\d{8,15}$/.test(String(digits))) return;
  try { await env.KV.put(`optout:${client}:${digits}`, String(Date.now())); } catch (e) { console.log("optout", String(e)); }
}
// через какой номер администратор пишет клиенту этого чата
/** @param {Env} env @param {string} cid @param {Profile=} prof @returns {Record<string, any> | null} */
export function waRoute(env, cid, prof) {
  const up = cid.toUpperCase();
  if (env["WA_TOKEN_" + up]) return { client: cid, pnid: (prof && prof.pn) || "", quiet: true };
  if (env.WA_TOKEN && (!env.WA_CLIENT || env.WA_CLIENT === cid)) return { quiet: true, pnid: (prof && prof.pn) || "" };
  return null;
}
