// @ts-check
// Входящее сообщение → push сотрудникам (ТЗ v2.0 §3): только если чат встал в очередь «Нужен ответ» (на «спасибо» не будим);
// ответ на напоминание или рассылку, перенос/отмена/опоздание, первый чат без ответственного — свои виды, их можно выключить
// на устройстве. Ответственному — на его устройства. На экран блокировки текст и имя — только если сотрудник сам включил.
/** @import { Env } from "../../lib/types.js" */
import { readHist } from "../../db/kv/chats.js";
import { pushNotify } from "../notifications/push.js";
import { lineLabel, lineChans } from "./lines.js";

/** @param {Env} env @param {string} ch @param {string} cid @param {string} digits @param {string} msgId номер входящего у провайдера (повтор вебхука — без второго push) */
export async function inboundPush(env, ch, cid, digits, msgId) {
  try {
    const h = await readHist(env, `h:${ch}:${cid}:${digits}`);
    const p = (h && h.profile) || {}, need = p.need;
    if (!h || !need || p.stop) return;
    const turns = h.turns || [], last = [...turns].reverse().find((/** @type {any} */ t) => t && t.role === "user");
    if (!last || +last.t < +need.at) return; // последнее сообщение клиента старше очереди: нечего будить
    const first = turns.filter((/** @type {any} */ t) => t && t.role === "user").length === 1;
    const kind = need.src ? "campaign_reply" : ["move", "cancel", "late"].includes(need.tp) ? "booking_change" : first && !(p.as && p.as.n) ? "unassigned" : "inbound";
    await pushNotify(env, cid, { kind, key: msgId || `${ch}:${digits}:${last.t}`, chat: { ch: /** @type {any} */ (ch), id: digits },
      title: String(p.name || p.waName || "Клиент").slice(0, 60), text: String(last.text || "").slice(0, 300), line: lineLabel(cid, ch, lineChans(env, cid)).toLowerCase(),
      assignee: (p.as && p.as.n) || "" });
  } catch (e) { console.log("inbound push", String(e).slice(0, 120)); }
}
/** Наше сообщение не доставлено — ответственному за чат. @param {Env} env @param {string} ch @param {string} cid @param {string} digits @param {string} mid */
export async function failedPush(env, ch, cid, digits, mid) {
  try {
    const h = await readHist(env, `h:${ch}:${cid}:${digits}`), p = (h && h.profile) || {};
    await pushNotify(env, cid, { kind: "send_failed", key: "f:" + mid, chat: { ch: /** @type {any} */ (ch), id: digits }, title: String(p.name || p.waName || "Клиент").slice(0, 60),
      line: lineLabel(cid, ch, lineChans(env, cid)).toLowerCase(), assignee: (p.as && p.as.n) || "" });
  } catch (e) { console.log("failed push", String(e).slice(0, 120)); }
}
