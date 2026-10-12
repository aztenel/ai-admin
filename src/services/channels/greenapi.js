// @ts-check
// Канал Green-API: отправка сообщения клиенту (sendGreen) с сигналом администратору в Telegram.
/** @import { Env } from "../../lib/types.js" */
import { clean } from "../../lib/text.js";
import { notifyOnce } from "../notifications/telegram.js";
import { gaShared } from "../integrations/greenapi/webhook.js";
import { gaCall, gaCode, gaWhy } from "../integrations/greenapi/client.js";

// → { ok, id } или { ok: false, status, code, error }. quiet — без сигнала администратору (рассылка и пульт сообщают о сбое сами)
/** @param {Env} env @param {string} chatId @param {any} message @param {any=} r @param {boolean=} quiet @returns {Promise<Record<string, any>>} */
export async function sendGreen(env, chatId, message, r, quiet) {
  r = r || gaShared(env);
  if (!r) return { ok: false, status: 0, code: "ga:off", error: "Green-API не настроен" };
  const x = await gaCall(r, "sendMessage", { chatId, message: String(message).slice(0, 4000), typingTime: 1500 });
  if (x.ok) return { ok: true, id: String(x.j.idMessage || "") };
  console.log("GA send", x.status, x.text.slice(0, 300));
  const res = { ok: false, status: x.status, code: gaCode(x), error: clean((x.j && x.j.message) || x.text || "", 160) };
  if (!quiet) { try { await notifyOnce(env, "gasend:" + r.client, `⚠️ Ответы бота не доходят до клиентов WhatsApp (Green-API: ${gaWhy(res, r)})\nКлиент +${String(chatId).replace(/\D/g, "")} ответа не получил — напишите ему сами.`, r.client); } catch (e) {} }
  return res;
}
