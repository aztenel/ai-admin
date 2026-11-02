// @ts-check
// Переписки в D1 — кнопки владельца (01.11.2026, docs/chat-storage-d1.md): где хранятся переписки компании, перенос из KV (повторяемый:
// без дублей), сверка KV и D1, выгрузка из D1 в KV перед откатом, журнал вебхуков, ждущих записи. Только владелец. В ответах — только
// числа: ни текста переписок, ни номеров.
/** @import { Env } from "../lib/types.js" */
import { jsonP, sameOrigin } from "../lib/http.js";
import { hasClient } from "../config/builtin-clients.js";
import { canSee } from "../services/auth/access.js";
import { chatStoreInfo, importAll, chatCheck, exportAll, NOT_READY } from "../services/chatstore/index.js";
import { walPending, walKick } from "../services/chatstore/wal.js";

/** @param {Request} request @param {Env} env @param {URL} url @param {any} s */
export async function chatStoreApi(request, env, url, s) {
  const P = url.pathname, M = request.method;
  if (s.role !== "owner") return jsonP({ error: "Только владелец." }, 403);
  if (M === "POST" && !sameOrigin(request, url)) return jsonP({ error: "Запрос отклонён." }, 403);
  /** @type {Record<string, any>} */
  let b = {};
  if (M === "POST") { try { b = (await request.json()) || {}; } catch (e) {} }
  const cid = String((M === "POST" ? b.c : url.searchParams.get("c")) || "");
  if (!hasClient(cid) || !canSee(s, cid)) return jsonP({ error: "Нет доступа к этому клиенту." }, 403);
  try {
    if (M === "GET" && P === "/api/chatstore/status") return jsonP({ ...(await chatStoreInfo(env, cid)), pending: await walPending(env, cid) });
    if (M === "GET" && P === "/api/chatstore/check") return jsonP(await chatCheck(env, cid));
    if (M === "POST" && P === "/api/chatstore/import") return jsonP({ ok: true, ...(await importAll(env, cid)) });
    if (M === "POST" && P === "/api/chatstore/export") return jsonP({ ok: true, ...(await exportAll(env, cid)) });
    if (M === "POST" && P === "/api/chatstore/replay") return jsonP({ ok: true, ...(await walKick(env, cid, { force: true })) });
  } catch (/** @type {any} */ e) {
    const msg = String((e && e.message) || e);
    return jsonP({ error: msg === NOT_READY ? NOT_READY : "Не получилось: " + msg.slice(0, 160) }, msg === NOT_READY ? 503 : 500);
  }
  return jsonP({ error: "Не найдено." }, 404);
}
