// @ts-check
// Push-уведомления пульта /app/ (/api/push/*, ТЗ v2.0 §3): ключ сервера, подписка устройства, настройки, отписка, проверка.
// Только вошедшим (владелец — любой компании, сотрудник — своей), изменения — только со своего сайта; тело — до 8 КБ.
import { jsonP, sameOrigin, readCapped } from "../lib/http.js";
import { hasClient } from "../config/builtin-clients.js";
import { canSee } from "../services/auth/access.js";
import { pushConfig, pushSubscribe, pushPrefsSet, pushUnsubscribe, pushTest } from "../services/notifications/push.js";
/** @import { Env } from "../lib/types.js" */

/** @param {Request} request @param {Env} env @param {URL} url @param {any} s */
export async function pushApi(request, env, url, s) {
  const P = url.pathname, M = request.method, now = Date.now();
  if (M === "POST" && !sameOrigin(request, url)) return jsonP({ error: "Запрос отклонён." }, 403);
  /** @type {Record<string, any>} */
  let b = {};
  if (M === "POST") {
    const raw = await readCapped(request, 8 * 1024);
    if (!raw) return jsonP({ error: "Слишком большой запрос." }, 413);
    try { const j = JSON.parse(new TextDecoder().decode(raw) || "{}"); b = j && typeof j === "object" && !Array.isArray(j) ? j : {}; }
    catch (e) { return jsonP({ error: "Запрос не прочитался." }, 400); }
  }
  const cid = String((M === "POST" ? b.c : url.searchParams.get("c")) || "");
  if (!hasClient(cid) || !canSee(s, cid)) return jsonP({ error: "Нет доступа к этому клиенту." }, 403);
  try {
    if (M === "GET" && P === "/api/push/config") return jsonP(await pushConfig(env, cid));
    if (M !== "POST") return jsonP({ error: "Не найдено." }, 404);
    if (typeof b.endpoint !== "undefined" && typeof b.endpoint !== "string") return jsonP({ error: "Устройство не подписано." }, 400);
    /** @type {{ status: number, body: any } | null} */
    let r = null;
    if (P === "/api/push/subscribe") r = await pushSubscribe(env, cid, b, s, request.headers.get("user-agent") || "", now);
    else if (P === "/api/push/prefs") r = await pushPrefsSet(env, cid, b);
    else if (P === "/api/push/unsubscribe") r = await pushUnsubscribe(env, cid, b);
    else if (P === "/api/push/test") r = await pushTest(env, cid, b, now);
    return r ? jsonP(r.body, r.status) : jsonP({ error: "Не найдено." }, 404);
  } catch (e) {
    console.log("push api", String(e));
    return jsonP({ error: "Хранилище не ответило — попробуйте ещё раз через минуту." }, 503);
  }
}
