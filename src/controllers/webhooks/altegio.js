// @ts-check
// Вебхук Altegio: /alt/<компания>?t=<пароль> (ТЗ v4, 08.11.2026). Ответ сразу, проход по журналу — после ответа (ctx.waitUntil).
// Пароль неверный — 403 (адрес знают только владелец и настройки Altegio); GET с верным паролем — 200 (проверка адреса при сохранении).
/** @import { Env } from "../../lib/types.js" */
import { CLIENTS, hasClient } from "../../config/builtin-clients.js";
import { altHookOk, altHookEvent } from "../../services/reminders/hook.js";

const MAX_BODY = 64 * 1024; // событие Altegio — несколько КБ; больше — не читаем
const text = (/** @type {string} */ s, /** @type {number} */ status) => new Response(s, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** @param {Request} request @param {Env} env @param {any} ctx @param {string} id @param {URL} url */
export async function handleAltHook(request, env, ctx, id, url) {
  const c = hasClient(id) ? /** @type {any} */ (CLIENTS)[id] : null;
  if (!c || !c.jr) return text("Not found", 404);
  if (!(await altHookOk(env, id, url.searchParams.get("t") || ""))) return text("Forbidden", 403);
  if (request.method === "GET" || request.method === "HEAD") return text("ok", 200);
  if (request.method !== "POST") return text("Method not allowed", 405);
  /** @type {any} */ let body = null;
  try { const raw = await request.text(); if (raw.length <= MAX_BODY) body = JSON.parse(raw); } catch (e) { body = null; }
  const ev = await altHookEvent(env, c, body, Date.now());
  if (ev.run) ctx.waitUntil(ev.run().catch((/** @type {any} */ e) => console.log("alt hook run", id, String((e && e.message) || e).slice(0, 160))));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
