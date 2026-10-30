// @ts-check
// База контактов для пульта (/api/contacts/*, этап 1 D1, 31.10.2026): состояние и проверки, сегменты, список, карточка, добавление,
// импорт, согласия и запреты; владельцу — синхронизация Altegio, проба полей, сверка и перенос «стопов». Нет базы у этого адреса
// (боевой сайт до решения владельца) — status отвечает ready: false, остальное — 503.
import { jsonP, sameOrigin, readCapped } from "../lib/http.js";
import { CLIENTS, hasClient } from "../config/builtin-clients.js";
import { canSee } from "../services/auth/access.js";
import { contactsStatus, contactsSegments, contactsList, contactsCard, contactsAdd, contactsConsent, contactsRestrict, contactsLift, contactsReview, contactsImport, contactsImportConfirm, contactsImportDiscard, contactsRecompute } from "../services/contacts/index.js";
import { syncStep, syncDry, syncTest } from "../services/contacts/sync.js";
import { altProbe } from "../services/contacts/probe.js";
import { stopSweep, optoutMigrate } from "../services/contacts/stops.js";
import { IMPORT_MAX_BYTES } from "../services/contacts/importer.js";
import { logSafe } from "../lib/phone.js";
/** @import { Env } from "../lib/types.js" */

const STATUS = /** @type {Record<string, number>} */ ({ input: 400, forbidden: 403, missing: 404, done: 409, preview: 409, setup: 409, busy: 409, altegio: 502, db: 503, kv: 503, store: 503 });
const OWNER_ONLY = new Set(["/api/contacts/lift", "/api/contacts/sync", "/api/contacts/probe", "/api/contacts/stops"]);

/** @param {Request} request @param {Env} env @param {URL} url @param {any} s */
export async function contactsApi(request, env, url, s) {
  const P = url.pathname, M = request.method, q = url.searchParams, now = Date.now(), owner = s.role === "owner", actor = owner ? "owner" : "staff";
  if (M === "POST" && !sameOrigin(request, url)) return jsonP({ error: "Запрос отклонён." }, 403);
  /** @type {Record<string, any>} */
  let body = {};
  let file = /** @type {{ bytes: Uint8Array, name: string } | null} */ (null);
  if (M === "POST") {
    // тело читаем сами с пределом: без Content-Length (или с ложным) formData() и json() прочитали бы всё целиком
    const ct = request.headers.get("content-type") || "", raw = await readCapped(request, ct.startsWith("multipart/form-data") ? IMPORT_MAX_BYTES + 64 * 1024 : 64 * 1024);
    if (!raw) return jsonP({ error: "Файл больше 5 МБ — разделите его на части." }, 413);
    try {
      if (ct.startsWith("multipart/form-data")) {
        const f = await new Response(/** @type {any} */ (raw), { headers: { "content-type": ct } }).formData(), up = /** @type {any} */ (f.get("file"));
        body = { c: String(f.get("c") || "") };
        if (up && typeof up === "object" && typeof up.arrayBuffer === "function") file = { bytes: new Uint8Array(await up.arrayBuffer()), name: String(up.name || "file").slice(0, 120) };
      } else { const j = JSON.parse(new TextDecoder().decode(raw) || "{}"); body = j && typeof j === "object" && !Array.isArray(j) ? j : {}; }
    } catch (e) { return jsonP({ error: "Запрос не прочитался." }, 400); }
  }
  const cid = String((M === "POST" ? body.c : q.get("c")) || "");
  if (!hasClient(cid) || !canSee(s, cid)) return jsonP({ error: "Нет доступа к этому клиенту." }, 403);
  if (OWNER_ONLY.has(P) && !owner) return jsonP({ error: "Это может только владелец." }, 403);
  const c = CLIENTS[cid];
  try {
    if (M === "GET" && P === "/api/contacts/status") return jsonP(await contactsStatus(env, c, now, owner));
    if (M === "GET" && P === "/api/contacts/segments") return jsonP(await contactsSegments(env, c, now));
    if (M === "GET" && P === "/api/contacts/list") return jsonP(await contactsList(env, c, now, { q: q.get("q") || "", seg: q.get("seg") || "all", page: +(q.get("page") || 1) }));
    if (M === "GET" && P === "/api/contacts/card") return jsonP(await contactsCard(env, c, now, q.get("id") || ""));
    if (M !== "POST") return jsonP({ error: "Не найдено." }, 404);
    if (P === "/api/contacts/add") return jsonP(await contactsAdd(env, c, now, body, actor));
    if (P === "/api/contacts/consent") return jsonP(await contactsConsent(env, c, now, body, actor));
    if (P === "/api/contacts/restrict") return jsonP(await contactsRestrict(env, c, now, body, actor));
    if (P === "/api/contacts/lift") return jsonP(await contactsLift(env, c, now, body, actor, owner));
    if (P === "/api/contacts/review") return jsonP(await contactsReview(env, c, now, body, actor, owner)); // снять — только владелец: проверяет сервис
    if (P === "/api/contacts/import") {
      const f = file || (typeof body.text === "string" && body.text.trim() ? { bytes: new TextEncoder().encode(String(body.text).slice(0, IMPORT_MAX_BYTES)), name: "вставка.txt" } : null);
      if (!f) return jsonP({ error: "Выберите файл или вставьте строки." }, 400);
      return jsonP(await contactsImport(env, c, now, f.bytes, f.name, actor));
    }
    if (P === "/api/contacts/import/confirm") return jsonP(await contactsImportConfirm(env, c, now, body, actor));
    if (P === "/api/contacts/import/discard") return jsonP(await contactsImportDiscard(env, c, now, body));
    if (P === "/api/contacts/sync") {
      const mode = String(body.mode || "step");
      if (mode === "dry") { const report = await syncDry(env, c, now); return jsonP({ ok: true, report, sync: (/** @type {any} */ (await contactsStatus(env, c, now, owner))).sync }); }
      if (mode === "test") { const report = await syncTest(env, c, now); return jsonP({ ok: true, report, sync: (/** @type {any} */ (await contactsStatus(env, c, now, owner))).sync }); }
      if (mode !== "step") return jsonP({ error: "Неизвестный режим." }, 400);
      const r = await syncStep(env, c, now, { force: true }), fixed = await contactsRecompute(env, c, now);
      const lines = r.windows.map((/** @type {any} */ w) => `${w.from} … ${w.to}: записей ${w.records}, клиентов ${w.contacts}${w.warn ? " — " + w.warn : ""}`);
      if (fixed) lines.push(`Пересчитана сводка клиентов: ${fixed}`);
      return jsonP({ ok: true, report: { summary: lines.length ? lines : ["Всё уже свежее — читать нечего."] }, sync: (/** @type {any} */ (await contactsStatus(env, c, now, owner))).sync });
    }
    if (P === "/api/contacts/probe") return jsonP({ ok: true, report: await altProbe(env, c, now) });
    if (P === "/api/contacts/stops") {
      const action = String(body.action || "");
      if (action === "sweep") {
        const [r] = await stopSweep(env, now, { only: cid, force: true });
        if (!r || !r.ok) return jsonP({ error: (r && r.error) || "Сверка не прошла." }, r && r.setup ? 409 : 502);
        return jsonP({ ok: true, summary: [`Журнал входящих за ${r.minutes} мин: сообщений ${r.checked}, «стопов» ${r.stops}, неоднозначных ${r.review}.`, r.found ? `Пропущенных «стопов» найдено и записано: ${r.found}.` : "Пропущенных «стопов» нет."] });
      }
      if (action === "migrate-check" || action === "migrate") return jsonP({ ok: true, ...(await optoutMigrate(env, cid, now, action === "migrate-check")) });
      return jsonP({ error: "Неизвестное действие." }, 400);
    }
    return jsonP({ error: "Не найдено." }, 404);
  } catch (/** @type {any} */ e) {
    const code = e && typeof e.code === "string" ? e.code : "";
    if (!STATUS[code]) { console.log("contacts api", P, logSafe(String((e && e.stack) || e))); return jsonP({ error: "Не получилось — попробуйте через минуту." }, 500); }
    return jsonP({ error: e.message, ...(e.field ? { field: e.field } : {}), ...(code === "db" ? { ready: false } : {}) }, STATUS[code]);
  }
}
