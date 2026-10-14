// @ts-check
// Вебхук Wazzapo (официальный партнёр Meta) для клиента со своим номером: https://<воркер>/wz/<id>.
// Подпись X-Wazzapo-Signature (sha256=HMAC тела секретом вебхука, как у Meta) проверяется секретом APP_SECRET_<ID>.
// Событие перекладывается в формат вебхука Meta и обрабатывается тем же кодом, что и прямое подключение к Meta.
// Wazzapo ждёт ответа 2xx за 10 секунд и повторяет доставку до 5 раз — отвечаем сразу, работа идёт в фоне; повтор отсекаем по X-Wazzapo-Delivery-Id.
import { hasClient } from "../../config/builtin-clients.js";
import { metaSigOk } from "../../lib/crypto.js";
import { seenBefore } from "../../services/channels/index.js";
import { wzOn, wzToMeta } from "../../services/channels/wazzapo.js";
import { handleWhatsApp } from "./meta.js";
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
  const delivery = request.headers.get("x-wazzapo-delivery-id") || "";
  ctx.waitUntil((async () => {
    if (delivery && await seenBefore(env, "wzd:" + delivery)) return; // Wazzapo повторил доставку
    const meta = await wzToMeta(env, body);
    if (!meta) { if (body.event && !/^(message\.(incoming|outgoing|status)|conversation\.|session\.|deal\.)/.test(String(body.event))) console.log("wz event", String(body.event).slice(0, 60)); return; }
    await handleWhatsApp(meta, env, { client: id, signed: true, origin });
  })().catch(err => console.log("wz error", String((err && err.stack) || err))));
  return new Response("OK");
}
