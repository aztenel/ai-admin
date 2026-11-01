// @ts-check
// Вебхук Wazzapo (официальный партнёр Meta) для клиента со своим номером: https://<воркер>/wz/<id>.
// Подпись X-Wazzapo-Signature (sha256=HMAC тела секретом вебхука, как у Meta) проверяется секретом APP_SECRET_<ID>.
// Событие перекладывается в формат вебхука Meta и обрабатывается тем же кодом, что и прямое подключение к Meta.
// Wazzapo ждёт ответа 2xx за 10 секунд и повторяет доставку ещё 5 раз (через 1 мин, 5 мин, 30 мин, 2 ч и 6 ч; 10 недоставленных событий
// подряд — вебхук выключается, wazzapo.kz/docs) — отвечаем сразу, работа идёт в фоне; повтор отсекаем по X-Wazzapo-Delivery-Id.
import { hasClient } from "../../config/builtin-clients.js";
import { metaSigOk } from "../../lib/crypto.js";
import { seenBefore, seenForget } from "../../services/channels/index.js";
import { wzOn, wzToMeta, wzForget } from "../../services/channels/wazzapo.js";
import { chatMode } from "../../services/chatstore/index.js";
import { handleWhatsApp, waHook } from "./meta.js";
/** @import { Env } from "../../lib/types.js" */

/** @param {Request} request @param {Env} env @param {any} ctx @param {string} id @param {string} origin */
export async function handleWZClient(request, env, ctx, id, origin) {
  if (request.method !== "POST") return new Response("OK");
  if (!hasClient(id) || !wzOn(env, id)) return new Response("Unknown client", { status: 404 });
  const secret = env["APP_SECRET_" + id.toUpperCase()], raw = await request.text();
  if (!secret) return new Response("Webhook secret is not set for this client", { status: 403 });
  if (!(await metaSigOk(secret, raw, request.headers.get("x-wazzapo-signature")))) return new Response("Bad signature", { status: 403 });
  /** @type {any} */ let body = null; try { body = JSON.parse(raw); } catch (e) {}
  if (!body) return new Response("OK");
  const delivery = request.headers.get("x-wazzapo-delivery-id") || "", wx = { client: id, signed: true, origin };
  // событие → формат Meta; null — не для бота или Wazzapo повторил доставку
  const prep = async () => {
    if (delivery && await seenBefore(env, "wzd:" + delivery)) return null; // Wazzapo повторил доставку
    const meta = await wzToMeta(env, body);
    if (!meta && body.event && !/^(message\.(incoming|outgoing|status)|conversation\.|session\.|deal\.)/.test(String(body.event))) console.log("wz event", String(body.event).slice(0, 60));
    return meta;
  };
  if (chatMode(env, id) !== "d1") { // переписки в KV — как было: «200» сразу, всё остальное — после ответа
    ctx.waitUntil((async () => { const meta = await prep(); if (meta) await handleWhatsApp(meta, env, wx); })().catch(err => console.log("wz error", String((err && err.stack) || err))));
    return new Response("OK");
  }
  // переписки в D1: повтор доставки и перевод в формат Meta — до ответа, чтобы событие легло в журнал вебхуков раньше «200» (waHook):
  // после «200» Wazzapo его не повторит. Не записалось нигде — 503, отметки «доставка уже была» и «то же сообщение» сняты: повтор пройдёт
  const meta = await prep();
  if (!meta) return new Response("OK");
  const ok = await waHook(meta, env, ctx, wx, { forget: async () => { if (delivery) await seenForget(env, "wzd:" + delivery); await wzForget(env, body); } });
  return ok ? new Response("OK") : new Response("Retry later", { status: 503 });
}
