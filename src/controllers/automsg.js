// @ts-check
// Раздел «Автоматические сообщения» (/api/msg/*, задание владельца 02.11.2026): девять сценариев второго номера — у каждого выключатель,
// текст, время, счётчики, журнал и проверка на номер владельца. Смотреть — владелец и сотрудник своей компании; менять, проверять
// и спрашивать Altegio «кому сегодня» — только владелец. Номера клиентов — только маской.
import { jsonP, sameOrigin } from "../lib/http.js";
import { CLIENTS, hasClient } from "../config/builtin-clients.js";
import { canSee } from "../services/auth/access.js";
import { opWho } from "../services/inbox/operator.js";
import { autoInfo, autoChange, autoTest, autoAudience } from "../services/automsg/index.js";
/** @import { Env } from "../lib/types.js" */

const BUSY = "Сервер сейчас не отвечает. Попробуйте через минуту.";
/** @param {Request} request @param {Env} env @param {URL} url @param {any} s */
export async function automsgApi(request, env, url, s) {
  const P = url.pathname, M = request.method;
  /** @type {Record<string, any>} */
  let body = {};
  if (M === "POST") { if (!sameOrigin(request, url)) return jsonP({ error: "Запрос отклонён." }, 403); try { body = (await request.json()) || {}; } catch (e) {} }
  const cid = String((M === "POST" ? body.c : url.searchParams.get("c")) || "");
  if (!hasClient(cid) || !canSee(s, cid)) return jsonP({ error: "Нет доступа к этому клиенту." }, 403);
  const c = CLIENTS[cid], now = Date.now(), owner = s.role === "owner";
  if (M === "GET" && P === "/api/msg/auto") {
    try { return jsonP(await autoInfo(env, c, now, owner)); } catch (e) { console.log("msg auto", String(e)); return jsonP({ error: BUSY }, 503); }
  }
  if (M !== "POST") return jsonP({ error: "Не найдено." }, 404);
  if (!owner) return jsonP({ error: "Менять автоматические сообщения и проверять их может только владелец." }, 403);
  /** @param {Promise<any>} p */
  const run = async p => {
    try { const r = await p; return r.ok ? jsonP(r) : jsonP({ error: r.error, ...(r.code ? { code: r.code } : {}), ...(r.preview != null ? { preview: r.preview } : {}) }, r.status || 400); }
    catch (e) { console.log("msg", P, String(e)); return jsonP({ error: BUSY }, 503); }
  };
  if (P === "/api/msg/auto") return run(autoChange(env, c, body, opWho(s, body.op), now));
  if (P === "/api/msg/test") return run(autoTest(env, c, body, opWho(s, body.op), now));
  if (P === "/api/msg/audience") return run(autoAudience(env, c, body, now));
  return jsonP({ error: "Не найдено." }, 404);
}
