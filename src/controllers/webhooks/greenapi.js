// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 3)
// Вебхук Green-API (обычный WhatsApp по QR): разбор события и передача в общую логику текста/медиа.
import { hasClient } from "../../config/builtin-clients.js";
import { PAUSE_MS, HIST_KEEP } from "../../config/constants.js";
import { clean } from "../../lib/text.js";
import { nicheOf, seenBefore } from "../../services/channels/index.js";
import { sendGreen } from "../../services/channels/greenapi.js";
import { gaStateSignal, GA_STATE_BAD, waFailed } from "../../services/broadcast/holds.js";
import { readHist, putHist, kvRetry, gaShared } from "../../services/channels/deps.js";
import { handleWAText, handleWAMedia } from "./meta.js";
/** @import { Env } from "../../lib/types.js" */

/** @param {any} md */
export const gaText = md => { md = md || {}; const t = md.textMessageData?.textMessage || md.extendedTextMessageData?.text || md.fileMessageData?.caption || ""; return clean(t, 1000) || `[${(/** @type {Record<string, string>} */ ({ imageMessage: "фото", videoMessage: "видео", audioMessage: "голосовое", documentMessage: "файл", locationMessage: "геолокация", contactMessage: "контакт" }))[md.typeMessage] || "сообщение"}]`; };
/** @param {any} body @param {Env} env @param {any} origin @param {any} r */
export async function handleGreen(body, env, origin, r) {
  r = r || gaShared(env);
  if (!r) return;
  const type = body?.typeWebhook, iid = body?.instanceData?.idInstance;
  if (iid !== undefined && iid !== null && String(iid) !== r.id) { console.log("ga: сообщение другого инстанса", String(iid).slice(0, 20)); return; } // адрес вебхука вставлен в кабинет другого номера
  if (type === "stateInstanceChanged") return gaStateSignal(env, r, String(body.stateInstance || ""));
  if (type === "outgoingMessageStatus") { // отчёт о доставке: «у номера нет WhatsApp», «не доставлено», ограничение номера
    const st = String(body.status || "");
    if (GA_STATE_BAD[st]) return gaStateSignal(env, r, st);
    if ((st === "noAccount" || st === "failed") && hasClient(r.client)) await waFailed(env, { client: r.client }, [{ code: "ga:" + st, to: String(body.chatId || "").replace(/\D/g, "") }]);
    return;
  }
  const chatId = body?.senderData?.chatId || "";
  if (!chatId.endsWith("@c.us")) return; // группы и каналы игнорируем
  const digitsId = chatId.replace(/\D/g, "");
  const gx = r.shared ? { origin, name: body?.senderData?.senderName || "" } : { client: r.client, origin, name: body?.senderData?.senderName || "" }; // общий номер — как раньше: клиент номера из GA_CLIENT
  // администратор сам написал клиенту с телефона: его ответ виден в пульте, бот молчит в этом чате 2 часа
  if (type === "outgoingMessageReceived") {
    const niche = await nicheOf(env, "ga", digitsId, gx);
    if (!niche) return;
    const hk = `h:ga:${niche}:${digitsId}`, now = Date.now(), mid = String(body.idMessage || "");
    await kvRetry(async () => {
      const h = (await readHist(env, hk)) || { n: 0, turns: [], profile: {} };
      h.profile = h.profile || {}; const seen = h.profile.echo || [];
      if (mid && seen.includes(mid)) return; // Green-API повторил доставку
      h.profile.echo = seen.concat(mid ? [mid] : []).slice(-20);
      h.profile.pausedUntil = Math.max(h.profile.pausedUntil || 0, now + PAUSE_MS); delete h.profile.need;
      h.turns = (h.turns || []).concat([{ role: "model", text: gaText(body.messageData), t: now, by: "admin", m: "phone" }]).slice(-HIST_KEEP); h.n = (h.n || 0) + 1;
      await putHist(env.KV, hk, h);
    });
    return;
  }
  if (type !== "incomingMessageReceived") return;
  const id = body.idMessage;
  if (id && await seenBefore(env, id)) return;
  const md = body.messageData || {};
  /** @param {any} t */
  const send = t => sendGreen(env, chatId, t, r);
  const text = (md.textMessageData?.textMessage || md.extendedTextMessageData?.text || "").trim();
  if (text) return handleWAText(env, "ga", digitsId, text, send, gx);
  /** @type {Record<string, string>} */
  const kinds = { audioMessage: "audio", imageMessage: "image", videoMessage: "video", documentMessage: "document", stickerMessage: "sticker", locationMessage: "location", contactMessage: "contact", contactsArrayMessage: "contact" };
  const kind = kinds[md.typeMessage];
  if (!kind) return; // реакции, опросы и прочее — без ответа
  return handleWAMedia(env, "ga", digitsId, kind, md.fileMessageData?.downloadUrl || null, (md.fileMessageData?.caption || "").trim(), send, gx, { mime: md.fileMessageData?.mimeType || "" });
}
