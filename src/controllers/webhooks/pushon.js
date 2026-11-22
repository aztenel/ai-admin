// @ts-check
// Вебхук Pushon (технический провайдер Meta) для клиента со своим номером: https://<воркер>/po/<id>?t=<APP_SECRET_<ID>>.
// Подпись вебхука в документации Pushon не описана («если включено»), поэтому пароль — в адресе (как у Green-API): без верного
// пароля — 403. Событие перекладывается в формат вебхука Meta и обрабатывается тем же кодом, что и прямое подключение к Meta.
// Pushon ждёт 200 с пустым телом и повторяет доставку при другом ответе — отвечаем сразу, работа идёт в фоне; повтор отсекаем
// по номеру сообщения и статусу.
import { hasClient } from "../../config/builtin-clients.js";
import { safeEq } from "../../lib/crypto.js";
import { seenBefore, seenForget } from "../../services/channels/index.js";
import { poOn, poToMeta, poWhy, poNote, poFileNote } from "../../services/channels/pushon.js";
import { chatMode } from "../../services/chatstore/index.js";
import { handleWhatsApp, waHook } from "./meta.js";
/** @import { Env } from "../../lib/types.js" */

const EMPTY = () => new Response(null, { status: 200 });

/** @param {Request} request @param {Env} env @param {any} ctx @param {string} id @param {URL} url */
export async function handlePOClient(request, env, ctx, id, url) {
  if (request.method !== "POST") return EMPTY();
  if (!hasClient(id) || !poOn(env, id)) return new Response("Unknown client", { status: 404 });
  const up = id.toUpperCase(), secret = String(env["APP_SECRET_" + up] || "");
  if (!secret) return new Response("Webhook password is not set for this client", { status: 403 });
  const given = url.searchParams.get("t") || request.headers.get("x-webhook-secret") || "";
  if (!given || !safeEq(given, secret)) { ctx.waitUntil(poNote(env, id, { bad: 1, why: given ? "пароль в адресе не совпал с APP_SECRET" : "в адресе нет пароля ?t=" })); return new Response("Bad password", { status: 403 }); }
  /** @type {any} */ let body = null; try { body = JSON.parse(await request.text()); } catch (e) {}
  if (!body) { ctx.waitUntil(poNote(env, id, { ok: false, why: "тело не JSON" })); return EMPTY(); }
  const channel = String(env["PHONE_NUMBER_ID_" + up] || ""), wx = { client: id, signed: true, origin: url.origin };
  // повтор доставки: то же сообщение или тот же статус того же сообщения
  // настоящий формат (21.11.2026): у каждого события свой id — повтор доставки того же события отсекаем по нему
  const dupKey = /^message\./.test(String(body.type || "")) && body.id ? "poe:" + String(body.id).slice(0, 80)
    : body.type === "message" ? "pom:" + String((body.message && body.message.id) || "") : body.type === "status" ? `pos:${body.messageId || ""}:${body.status || ""}` : "";
  const prep = async () => {
    if (dupKey.length > 5 && await seenBefore(env, dupKey)) return null;
    const meta = poToMeta(body, channel), why = poWhy(body, channel, meta);
    ctx.waitUntil(poNote(env, id, { type: String(body.type || "").slice(0, 30), ok: !!meta, why, keys: Object.keys(body).slice(0, 15).join(","),
      mkeys: body.message && typeof body.message === "object" ? Object.keys(body.message).slice(0, 15).join(",") : "" }));
    ctx.waitUntil(poFileNote(env, id, body));
    if (why) console.log("po skip", why);
    if (!meta && body.type && !/^(message|status)$/.test(String(body.type))) console.log("po event", String(body.type).slice(0, 60));
    return meta;
  };
  if (chatMode(env, id) !== "d1") { // переписки в KV: «200» сразу, всё остальное — после ответа
    ctx.waitUntil((async () => { const meta = await prep(); if (meta) await handleWhatsApp(meta, env, wx); })().catch(err => console.log("po error", String((err && err.stack) || err))));
    return EMPTY();
  }
  // переписки в D1: событие сначала в журнал вебхуков (waHook), «200» — только после записи; не записалось — 503, Pushon повторит
  const meta = await prep();
  if (!meta) return EMPTY();
  const ok = await waHook(meta, env, ctx, wx, { forget: async () => { if (dupKey.length > 5) await seenForget(env, dupKey); } });
  return ok ? EMPTY() : new Response("Retry later", { status: 503 });
}
