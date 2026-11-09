// @ts-check
// Вебхук Altegio: /alt/<компания>?t=<пароль> (ТЗ v4, 08.11.2026). Событие — отметка для фоновой проверки раз в минуту (services/reminders/kick.js):
// сам запрос Altegio не читает и ничего не отправляет. Отметку не записать — 503 (Altegio повторит событие).
// Пароль неверный — 403 (адрес знают только владелец и настройки Altegio); GET с верным паролем — 200 (проверка адреса при сохранении).
/** @import { Env } from "../../lib/types.js" */
import { CLIENTS, hasClient } from "../../config/builtin-clients.js";
import { altHookOk, altHookEvent } from "../../services/reminders/hook.js";

const MAX_BODY = 64 * 1024; // событие Altegio — несколько КБ; больше — не читаем
/** тело не больше MAX_BODY байт (поток читается с пределом); больше — null @param {Request} request @returns {Promise<string | null>} */
async function bodyText(request) {
  if (!request.body) return "";
  const reader = request.body.getReader(), parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { try { await reader.cancel(); } catch (e) {} return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.byteLength; }
  return new TextDecoder().decode(all);
}
const text = (/** @type {string} */ s, /** @type {number} */ status) => new Response(s, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** @param {Request} request @param {Env} env @param {any} ctx @param {string} id @param {URL} url */
export async function handleAltHook(request, env, ctx, id, url) {
  const c = hasClient(id) ? /** @type {any} */ (CLIENTS)[id] : null;
  if (!c || !c.jr) return text("Not found", 404);
  if (!(await altHookOk(env, id, url.searchParams.get("t") || ""))) return text("Forbidden", 403);
  if (request.method === "GET" || request.method === "HEAD") return text("ok", 200);
  if (request.method !== "POST") return text("Method not allowed", 405);
  /** @type {any} */ let body = null;
  try { const raw = await bodyText(request); if (raw !== null) body = JSON.parse(raw); } catch (e) { body = null; } // не прочитали — всё равно читаем журнал
  const ev = await altHookEvent(env, c, body, Date.now());
  if (ev.error) return text("Try again later", 503);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
