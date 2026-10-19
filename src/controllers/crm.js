// @ts-check
// База клиентов из Altegio для пульта (/api/crm/*, docs/tz-winchester-v2.md §5.1): сегменты с числами, люди сегмента, обновить базу.
// Полные номера браузеру не уходят — только маской («+7 707 *** ** 44»): получателей рассылки сервер берёт из снимка сам.
import { jsonP, sameOrigin } from "../lib/http.js";
import { clean } from "../lib/text.js";
import { maskPhone, logSafe } from "../lib/phone.js";
import { CLIENTS, hasClient } from "../config/builtin-clients.js";
import { CRM_PAGE } from "../config/constants.js";
import { canSee } from "../services/auth/access.js";
import { crmBuild, crmWhy } from "../services/crm/snapshot.js";
import { crmSegments, crmPick, crmSegTest } from "../services/crm/segments.js";
/** @import { Env } from "../lib/types.js" */

const BUSY = "Хранилище не отвечает — попробуйте через минуту.";
/** @param {Request} request @param {Env} env @param {URL} url @param {any} s */
export async function crmApi(request, env, url, s) {
  const P = url.pathname, M = request.method, q = url.searchParams;
  /** @type {Record<string, any>} */
  let body = {};
  if (M === "POST") { if (!sameOrigin(request, url)) return jsonP({ error: "Запрос отклонён." }, 403); try { body = (await request.json()) || {}; } catch (e) {} }
  const cid = String((M === "POST" ? body.c : q.get("c")) || "");
  if (!hasClient(cid) || !canSee(s, cid)) return jsonP({ error: "Нет доступа к этому клиенту." }, 403);
  const c = CLIENTS[cid], now = Date.now();
  if (M === "GET" && P === "/api/crm/segments") {
    try { return jsonP({ client: { id: cid, name: c.name }, owner: s.role === "owner", why: crmWhy(env, c), ...(await crmSegments(env, c, now)) }); }
    catch (e) { console.log("crm segments", String(e)); return jsonP({ error: BUSY }, 503); }
  }
  if (M === "GET" && P === "/api/crm/list") { // ?seg=&page=&from=&to=&staff= — по 50 человек
    const seg = clean(q.get("seg") || "", 80), page = Math.min(1000, Math.max(1, Math.round(+(q.get("page") || 1)) || 1));
    const num = (/** @type {string} */ k) => { const v = q.get(k); return v === null || v.trim() === "" ? undefined : Math.round(+v); };
    const from = num("from"), to = num("to"), staff = clean(q.get("staff") || "", 60) || undefined;
    if (!crmSegTest(seg)) return jsonP({ error: "Неизвестный сегмент." }, 400);
    if ([from, to].some(v => v !== undefined && !(v >= 0 && v <= 400))) return jsonP({ error: "Дни с визита — число от 0 до 400." }, 400);
    let all;
    try { all = (await crmPick(env, c, seg, now, { from, to, staff })) || []; } catch (e) { console.log("crm list", String(e)); return jsonP({ error: BUSY }, 503); }
    // имя — через logSafe: администраторы нередко пишут в Altegio номер вместо имени («87071234567»), а полные номера базы браузеру не уходят
    const rows = all.slice((page - 1) * CRM_PAGE, page * CRM_PAGE).map(x => ({ name: logSafe(x.name), phone: maskPhone(x.phone), last: x.last, d: x.d, v: x.v, staff: x.staff, svc: x.svc }));
    return jsonP({ seg, total: all.length, page, pages: Math.max(1, Math.ceil(all.length / CRM_PAGE)), per: CRM_PAGE, list: rows });
  }
  if (M === "POST" && P === "/api/crm/refresh") { // собрать снимок сейчас: у черновиков фоновой задачи нет, а владелец хочет видеть свежие числа
    if (s.role !== "owner") return jsonP({ error: "Обновить базу может только владелец." }, 403);
    try { return jsonP({ ok: true, ...(await crmBuild(env, c, now)) }); }
    catch (/** @type {any} */ e) {
      const known = e && typeof e.code === "string"; // свои ошибки — с понятным текстом; чужие — в журнал сервера
      if (!known) console.log("crm refresh", logSafe(String((e && e.stack) || e)));
      return jsonP({ error: known ? e.message : "Не получилось обновить базу — попробуйте через минуту." }, !known ? 503 : e.code === "altegio" ? 502 : e.code === "store" ? 503 : 409);
    }
  }
  return jsonP({ error: "Не найдено." }, 404);
}
