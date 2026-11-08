// @ts-check
// Вебхук Altegio (ТЗ v4, 08.11.2026: «чтобы нужные сообщения были моментальными, а не через проверку раз в 15 минут»). Altegio присылает
// событие о записи на /alt/<компания>?t=<пароль> (пароль — HMAC ключа владельца LEADS_KEY и компании: в адресе, подписи у Altegio нет).
// Данным события не доверяем и их не храним: по событию сразу читаем журнал своим ключом (jrKick: изменённые записи, при удалении записи —
// весь журнал) — дальше те же правила, отметки и защита от дублей, что и у проверки по расписанию. Расписание остаётся страховкой.
// Вживую не проверено: какие события и в каком виде присылает Altegio Winchester.
/** @import { Env, Client } from "../../lib/types.js" */
import { hmacB64, safeEq } from "../../lib/crypto.js";
import { altLoc } from "../booking/book.js";
import { jrKick } from "./journal.js";
import { altHookSeen, altHookLast } from "../../db/kv/reminders.js";

/** пароль адреса вебхука ("" — без ключа владельца вебхук выключен) @param {Env} env @param {string} cid */
export async function altHookPass(env, cid) {
  if (!env.LEADS_KEY) return "";
  return (await hmacB64(String(env.LEADS_KEY), `alt-hook:${cid}`)).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
}
/** пароль из адреса подходит @param {Env} env @param {string} cid @param {string} t */
export async function altHookOk(env, cid, t) {
  const want = await altHookPass(env, cid);
  return !!want && !!t && safeEq(want, t);
}
/** адрес для настроек Altegio и последнее событие — владельцу @param {Env} env @param {Client} c @param {string} origin */
export async function altHookInfo(env, c, origin) {
  const pass = await altHookPass(env, c.id);
  return { url: pass ? `${origin}/alt/${c.id}?t=${pass}` : "", last: await altHookLast(env, c.id).catch(() => null) };
}

/**
 * Событие Altegio → проход по журналу. Тело — как в документации YCLIENTS/Altegio: { company_id, resource, resource_id, status, data };
 * чужая локация и непонятное тело — ничего не делаем (ответ всё равно 200: повтор не поможет). → { kick: "" | "fast" | "full" }
 * @param {Env} env @param {Client} c @param {any} body @param {number} now
 */
export async function altHookEvent(env, c, body, now) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { kick: "", why: "не событие" };
  const loc = altLoc(env, c), cid = +body.company_id;
  if (body.company_id != null && cid !== loc) return { kick: "", why: "другая локация" };
  const res = String(body.resource || "").slice(0, 40), st = String(body.status || "").slice(0, 20);
  try { await altHookSeen(env, c.id, { at: now, res, st }); } catch (e) { console.log("alt hook seen", String(e)); }
  const mode = res === "record" && st === "delete" ? "full" : "fast";
  return { kick: mode, run: () => jrKick(env, c, mode) };
}
