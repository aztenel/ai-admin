// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 3)
// Вебхук Green-API (обычный WhatsApp по QR): разбор события и передача в общую логику текста/медиа.
import { hasClient } from "../../config/builtin-clients.js";
import { PAUSE_MS, HIST_KEEP } from "../../config/constants.js";
import { clean } from "../../lib/text.js";
import { nicheOf, seenBefore } from "../../services/channels/index.js";
import { sendGreen } from "../../services/channels/greenapi.js";
import { gaStateSignal, GA_STATE_BAD, waFailed } from "../../services/broadcast/holds.js";
import { readHist, putHist, kvRetry, gaShared } from "../../services/channels/deps.js";
import { handleWAText, handleWAMedia, watchSend } from "./meta.js";
import { applyStatus, patchTurn, stOf } from "../../services/inbox/status.js";
import { statStatus } from "../../services/inbox/stats.js";
import { inboundPush, failedPush } from "../../services/inbox/notify.js";
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
  if (type === "outgoingMessageStatus") { // отчёт о доставке: галочки в пульте (ТЗ v2.0 §2.3) и сигналы «у номера нет WhatsApp», ограничение номера
    const st = String(body.status || ""), to = String(body.chatId || "");
    if (to.endsWith("@c.us")) {
      const niche = await nicheOf(env, "ga", to.replace(/\D/g, ""), r.shared ? {} : { client: r.client });
      if (niche) {
        try {
          /** @type {any} */ let turn = null;
          const mid = String(body.idMessage || ""), ch0 = await applyStatus(env, `h:ga:${niche}:${to.replace(/\D/g, "")}`, mid, st, String(body.description || ""), t => { turn = t; });
          if (ch0 === "changed" && /^(failed|noAccount|notInGroup|suspended)$/.test(st)) await failedPush(env, "ga", niche, to.replace(/\D/g, ""), mid);
          if (turn) await statStatus(env, niche, "ga", mid, turn, stOf(st), Date.now()); // аналитика (ТЗ v2.0 §8): повтор отчёта не считается
        } catch (e) { console.log("ga status", String(e)); }
      }
    }
    if (GA_STATE_BAD[st]) return gaStateSignal(env, r, st);
    if ((st === "noAccount" || st === "failed") && hasClient(r.client)) await waFailed(env, { client: r.client }, [{ code: "ga:" + st, to: to.replace(/\D/g, "") }]);
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
      const md = body.messageData || {};
      if (md.typeMessage === "editedMessage" || md.typeMessage === "deletedMessage" || md.typeMessage === "reactionMessage") return; // правка и удаление своего сообщения с телефона — не новый ответ
      h.turns = (h.turns || []).concat([{ role: "model", text: gaText(md), t: now, by: "admin", m: "phone", ...(mid ? { mid: mid.slice(0, 80), st: "sent" } : {}) }]).slice(-HIST_KEEP); h.n = (h.n || 0) + 1;
      await putHist(env.KV, hk, h);
    });
    return;
  }
  if (type !== "incomingMessageReceived") return;
  const id = body.idMessage;
  if (id && await seenBefore(env, id)) return;
  const md = body.messageData || {};
  if (md.typeMessage === "editedMessage" || md.typeMessage === "deletedMessage" || md.typeMessage === "reactionMessage") return gaChange(env, digitsId, gx, md); // не новое сообщение
  const gxm = { ...gx, msgId: String(id || "") };
  const send = watchSend(env, "ga", digitsId, gxm, t => sendGreen(env, chatId, t, r));
  const text = (md.textMessageData?.textMessage || md.extendedTextMessageData?.text || "").trim();
  const niche0 = r.shared ? "" : r.client; // компания номера: по ней — push сотрудникам (общий демо-номер — без push)
  if (text) { await handleWAText(env, "ga", digitsId, text, send, gxm); if (niche0) await inboundPush(env, "ga", niche0, digitsId, String(id || "")); return; }
  /** @type {Record<string, string>} */
  const kinds = { audioMessage: "audio", imageMessage: "image", videoMessage: "video", documentMessage: "document", stickerMessage: "sticker", locationMessage: "location", contactMessage: "contact", contactsArrayMessage: "contact" };
  const kind = kinds[md.typeMessage];
  if (!kind) return; // реакции, опросы и прочее — без ответа
  const fd = md.fileMessageData || {};
  // id сообщения нужен, чтобы взять у Green-API новую ссылку на файл (downloadFile), когда старая устареет; имя файла — только у документов
  await handleWAMedia(env, "ga", digitsId, kind, fd.downloadUrl || null, (fd.caption || "").trim(), send, gxm, { id: String(id || ""), mime: fd.mimeType || "", ...(kind === "document" && fd.fileName ? { name: String(fd.fileName) } : {}) });
  if (niche0) await inboundPush(env, "ga", niche0, digitsId, String(id || ""));
}

// клиент исправил или удалил своё сообщение, поставил реакцию на наше: меняем ту реплику, которую видит пульт (Green-API присылает
// stanzaId — номер того сообщения). Нового ответа не нужно, очередь «Нужен ответ» не трогаем
/** @param {Env} env @param {string} digits @param {any} gx @param {any} md */
async function gaChange(env, digits, gx, md) {
  const niche = await nicheOf(env, "ga", digits, gx);
  if (!niche) return;
  const hk = `h:ga:${niche}:${digits}`;
  try {
    if (md.typeMessage === "editedMessage") {
      const e = md.editedMessageData || {}, txt = clean(String(e.textMessage || ""), 1000);
      if (e.stanzaId && txt) await patchTurn(env, hk, String(e.stanzaId), false, t => { if (t.text === txt) return false; t.text = txt; t.ed = 1; return true; });
    } else if (md.typeMessage === "deletedMessage") {
      const e = md.deletedMessageData || {};
      if (e.stanzaId) await patchTurn(env, hk, String(e.stanzaId), false, t => { if (t.del) return false; t.del = 1; return true; });
    } else {
      const q = md.quotedMessage || {}, emo = String((md.extendedTextMessageData || {}).text || "").slice(0, 8);
      if (q.stanzaId) await patchTurn(env, hk, String(q.stanzaId), true, t => { if (t.re === emo) return false; if (emo) t.re = emo; else delete t.re; return true; });
    }
  } catch (e) { console.log("ga change", String(e)); }
}
