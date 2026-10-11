// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Green-API: настройки номера из переменных (gaShared, gaRoute, gaSecret) и пароль вебхука (gaHook = HMAC токена).
import { hasClient } from "../../../config/builtin-clients.js";

// --- Green-API (обычный WhatsApp по QR-коду)
// Свой номер у клиента: Text GA_ID_<ID>, Secret GA_TOKEN_<ID>, Text GA_URL_<ID> (apiUrl из кабинета, по умолчанию api.green-api.com).
//   Вебхук: https://<воркер>/ga/<id>?t=<пароль>. Пароль бот выводит из токена инстанса; адрес показывает «Проверка запуска», там же кнопка «Настроить Green-API».
// Общий номер воркера (прежний режим): GA_ID, GA_TOKEN, GA_URL, GA_HOOK, GA_CLIENT — вебхук /ga?t=<GA_HOOK>.
export const gaShared = env => env.GA_ID && env.GA_TOKEN ? { client: hasClient(env.GA_CLIENT) ? env.GA_CLIENT : "", id: String(env.GA_ID).trim(), token: String(env.GA_TOKEN), base: env.GA_URL || "", shared: true } : null;
// номер Green-API клиента: свой (GA_ID_<ID> и GA_TOKEN_<ID>) или общий номер воркера, закреплённый за ним (GA_CLIENT)
export function gaRoute(env, cid) {
  if (!hasClient(cid)) return null;
  const up = cid.toUpperCase();
  if (env["GA_ID_" + up] && env["GA_TOKEN_" + up]) return { client: cid, id: String(env["GA_ID_" + up]).trim(), token: String(env["GA_TOKEN_" + up]), base: env["GA_URL_" + up] || "" };
  const s = gaShared(env);
  return s && s.client === cid ? s : null;
}
export const gaSecret = (r, k) => r.shared ? k : k + "_" + r.client.toUpperCase(); // имя переменной в Cloudflare: GA_TOKEN или GA_TOKEN_<ID>
// пароль вебхука клиента: из токена его инстанса (без лишнего секрета в панели; токен сменили — адрес вебхука настраивается заново)
export async function gaHook(r) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(r.token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`ga-hook:${r.client}:${r.id}`)));
  return [...mac].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
