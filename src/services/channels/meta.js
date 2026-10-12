// @ts-check
// Канал Meta (WhatsApp Cloud API): отправка текста клиенту (sendWA) с сигналом администратору в Telegram.
/** @import { Env } from "../../lib/types.js" */
import { GRAPH } from "../../config/constants.js";
import { notifyOnce } from "../notifications/telegram.js";
import { waCreds, waErr, WA_HINT } from "../integrations/meta/client.js";

// → { ok, id } или { ok: false, status, code, error }
/** @param {Env} env @param {string} to @param {string} t @param {Record<string, any>=} wx @returns {Promise<Record<string, any>>} */
export async function sendWA(env, to, t, wx) {
  const cr = waCreds(env, wx);
  const r = await fetch(`${GRAPH}/${cr.pnid}/messages`, {
    method: "POST", headers: { authorization: "Bearer " + cr.token, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: t.slice(0, 4000) } })
  });
  if (!r.ok) {
    const t = await r.text(); console.log("WA send", r.status, t.slice(0, 300));
    /** @type {Record<string, any>} */
    let e = {}; try { e = JSON.parse(t).error || {}; } catch (x) {}
    await waErr(env, "отправка " + r.status, e.code, e.message || t.slice(0, 200), e.error_data?.details);
    // клиент ответа не получил — администратор должен об этом узнать (не чаще раза в 10 минут)
    if (!(wx && wx.quiet)) { try { await notifyOnce(env, "wasend:" + ((wx && wx.client) || ""), `⚠️ Ответы бота не доходят до клиентов WhatsApp (ошибка ${r.status}${e.code ? ", код " + e.code : ""})${WA_HINT[e.code] ? " — " + WA_HINT[e.code] : ""}\nКлиент +${String(to).replace(/\D/g, "")} ответа не получил — напишите ему сами. Подробности — на странице /diag.`, wx && wx.client); } catch (x) {} }
    return { ok: false, status: r.status, code: e.code || 0, error: String(e.message || t).slice(0, 200) };
  }
  let id = ""; try { id = ((await r.json()).messages || [])[0]?.id || ""; } catch (x) {}
  return { ok: true, id };
}
