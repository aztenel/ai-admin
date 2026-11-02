// @ts-check
// Канал Green-API: отправка сообщения клиенту (sendGreen) с сигналом администратору в Telegram.
/** @import { Env } from "../../lib/types.js" */
import { clean } from "../../lib/text.js";
import { logSafe } from "../../lib/phone.js";
import { notifyOnce } from "../notifications/telegram.js";
import { gaCall, gaCode, gaWhy } from "../integrations/greenapi/client.js";

// → { ok, id } или { ok: false, status, code, error }. quiet — без сигнала администратору (рассылка и пульт сообщают о сбое сами);
// quote — номер сообщения у Green-API, на которое это ответ (цитата в WhatsApp, ответ сотрудника из пульта).
// r — номер, через который отвечаем (gaRoute компании или номер, на который пришёл вебхук). Без него не отправляем: запасной общий
// номер воркера мог быть закреплён за другой компанией (аудит 31.10.2026).
/** @param {Env} env @param {string} chatId @param {any} message @param {any=} r @param {boolean=} quiet @param {string=} quote @returns {Promise<Record<string, any>>} */
export async function sendGreen(env, chatId, message, r, quiet, quote) {
  if (!r) return { ok: false, status: 409, code: "ga:off", error: "Green-API не настроен" }; // 409 — точно не ушло (status 0 значил бы «неизвестно»)
  const x = await gaCall(r, "sendMessage", { chatId, message: String(message).slice(0, 4000), typingTime: 1500, ...(quote ? { quotedMessageId: String(quote).slice(0, 80) } : {}) });
  if (x.ok) return { ok: true, id: String(x.j.idMessage || "") };
  console.log("GA send", x.status, logSafe(x.text.slice(0, 300)));
  // id — если Green-API в ответе с ошибкой всё же вернул номер сообщения: по нему отчёт о доставке потом уточнит «неизвестно»
  const res = { ok: false, status: x.status, code: gaCode(x), error: clean((x.j && x.j.message) || x.text || "", 160), ...(x.j && x.j.idMessage ? { id: String(x.j.idMessage).slice(0, 80) } : {}) };
  if (!quiet && res.code !== "ga:preview") { try { await notifyOnce(env, "gasend:" + r.client, `⚠️ Ответы бота не доходят до клиентов WhatsApp (Green-API: ${gaWhy(res, r)})\nКлиент +${String(chatId).replace(/\D/g, "")} ответа не получил — напишите ему сами.`, r.client); } catch (e) {} }
  return res;
}
