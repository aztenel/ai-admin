// @ts-check
// Канал Meta (WhatsApp Cloud API): отправка текста клиенту (sendWA) с сигналом администратору в Telegram.
// Номер клиента может быть подключён напрямую к Meta или через партнёра Meta Wazzapo (WA_VIA_<ID>=wazzapo) — для бота это один канал.
/** @import { Env } from "../../lib/types.js" */
import { GRAPH } from "../../config/constants.js";
import { logSafe } from "../../lib/phone.js";
import { notifyOnce } from "../notifications/telegram.js";
import { waCreds, waErr, WA_HINT } from "../integrations/meta/client.js";
import { WZ_HINT } from "../integrations/wazzapo/client.js";
import { wzOn, wzSendOwn } from "./wazzapo.js";

// клиент ответа не получил — администратор должен об этом узнать (не чаще раза в 10 минут)
/** @param {Env} env @param {string} to @param {Record<string, any> | undefined} wx @param {string} what @param {string} hint */
async function sendFailed(env, to, wx, what, hint) {
  if (wx && wx.quiet) return;
  try { await notifyOnce(env, "wasend:" + ((wx && wx.client) || ""), `⚠️ Ответы бота не доходят до клиентов WhatsApp (${what})${hint ? " — " + hint : ""}\nКлиент +${String(to).replace(/\D/g, "")} ответа не получил — напишите ему сами. Подробности — на странице /diag.`, wx && wx.client); } catch (x) {}
}

// → { ok, id } или { ok: false, status, code, error }
/** @param {Env} env @param {string} to @param {string} t @param {Record<string, any>=} wx @returns {Promise<Record<string, any>>} */
export async function sendWA(env, to, t, wx) {
  const cr = waCreds(env, wx);
  if (wx && wzOn(env, wx.client)) {
    const r = await wzSendOwn(env, cr.token, { phone_number_id: cr.pnid, to: String(to).replace(/\D/g, ""), type: "text", text: { body: t.slice(0, 4000) } });
    if (r.ok) return { ok: true, id: r.id };
    console.log("WZ send", r.status, logSafe(r.error));
    await waErr(env, "отправка через Wazzapo " + r.status, r.code, r.error);
    await sendFailed(env, to, wx, `Wazzapo: ошибка ${r.status}`, WZ_HINT[r.status] || "");
    return r;
  }
  /** @type {Response} */ let r;
  try {
    r = await fetch(`${GRAPH}/${cr.pnid}/messages`, {
      method: "POST", headers: { authorization: "Bearer " + cr.token, "content-type": "application/json" }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: t.slice(0, 4000) } })
    });
  } catch (e) { // связь с Meta оборвалась: дошло ли сообщение, неизвестно — повторять нельзя (будет дубль), сообщаем администратору
    console.log("WA send", String(e).slice(0, 200));
    await waErr(env, "отправка", 0, "Meta не ответила");
    await sendFailed(env, to, wx, "Meta не ответила", "");
    return { ok: false, status: 0, code: 0, error: "Meta не ответила" };
  }
  if (!r.ok) {
    const t = await r.text(); console.log("WA send", r.status, logSafe(t.slice(0, 300)));
    /** @type {Record<string, any>} */
    let e = {}; try { e = JSON.parse(t).error || {}; } catch (x) {}
    await waErr(env, "отправка " + r.status, e.code, e.message || t.slice(0, 200), e.error_data?.details);
    await sendFailed(env, to, wx, `ошибка ${r.status}${e.code ? ", код " + e.code : ""}`, WA_HINT[e.code] || "");
    return { ok: false, status: r.status, code: e.code || 0, error: String(e.message || t).slice(0, 200) };
  }
  let id = ""; try { id = ((await r.json()).messages || [])[0]?.id || ""; } catch (x) {}
  return { ok: true, id };
}
