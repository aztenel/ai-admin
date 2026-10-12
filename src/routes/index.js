// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 3)
// Роутер: цепочка проверок «метод + путь → контроллер». Порядок проверок менять нельзя (контракт маршрутов test/contract).
// Страницы пульта (PULT_DEMO, PULT_LIVE, PULT_ICONS) приходят параметром `pult` из worker.js: pult.gen.js лежит вне src/.
import { COOKIE } from "../config/constants.js";
import { CLIENTS, hasClient } from "../config/builtin-clients.js";
import { html, jsonP, page, forbid, sameOrigin, text } from "../lib/http.js";
import { metaSigOk, eqSafe } from "../lib/crypto.js";
import { clean } from "../lib/text.js";
import { sessionRead, keyGate, leadsKey, cookieSet, syncClients, runCase, gaShared, gaRoute, gaHook } from "../controllers/deps.js";
import { tooManyKeys, handleLogin, enter } from "../controllers/auth.js";
import { studioApi, studioPage } from "../controllers/studio.js";
import { inboxApi } from "../controllers/inbox.js";
import { launchApi, launchPage } from "../controllers/launch.js";
import { bcApi, bcPage } from "../controllers/broadcast.js";
import { leadsPage, privacyPage, portfolioPage, chatPage } from "../controllers/pages.js";
import { diag } from "../controllers/diag.js";
import { altDiag, altPage, altUserPage, altUserProbe } from "../controllers/altegio.js";
import { selftestPage } from "../controllers/selftest.js";
import { cleanSid, handleWebChat } from "../controllers/chat.js";
import { hookBurst, handleWhatsApp, handleWAClient } from "../controllers/webhooks/meta.js";
import { handleGreen } from "../controllers/webhooks/greenapi.js";
import { pultIcon, pultManifest } from "../controllers/pult.js";

/**
 * @param {any} request
 * @param {any} env
 * @param {any} ctx
 * @param {any} pult страницы пульта из worker.js: { PULT_LIVE, PULT_DEMO, PULT_ICONS }
 * @returns {Promise<Response>}
 */
export async function route(request, env, ctx, pult) {
    const url = new URL(request.url), P = url.pathname, M = request.method === "HEAD" ? "GET" : request.method; // HEAD — так проверяют ссылки Meta и другие сервисы
    // владелец: cookie после входа либо ключ в адресе (с ограничением числа неверных попыток) → true, false или готовый ответ «подождите»
    /** @type {(key?: any) => Promise<any>} */
    const owner = async key => {
      const s = await sessionRead(env, request);
      if (s && s.role === "owner") return true;
      const g = await keyGate(request, env, key === undefined ? url.searchParams.get("key") : key, [leadsKey(env)]);
      return g === -2 ? tooManyKeys() : g === 0;
    };
    try { await syncClients(env); } catch (e) { console.log("cfg", String(e)); } // боты клиентов из хранилища (паспорта) — раз в минуту

    if (M === "GET" && url.searchParams.get("hub.mode") === "subscribe") {
      return url.searchParams.get("hub.verify_token") === env.VERIFY_TOKEN
        ? new Response(url.searchParams.get("hub.challenge")) : new Response("Wrong verify token", { status: 403 });
    }
    if (M === "GET" && P === "/leads") {
      const c = /** @type {any} */ (url.searchParams.get("c")), key = url.searchParams.get("key");
      const s = await sessionRead(env, request); // вход по cookie: владелец видит всех (или одного — ?c=), сотрудник — только своего клиента
      if (s) return page(await leadsPage(env, s.role === "staff" ? s.cid : hasClient(c) ? c : null, s));
      if (!key) return new Response(null, { status: 303, headers: { location: "/login?next=" + encodeURIComponent(P + url.search), "cache-control": "no-store" } }); // без входа — на страницу входа, а не «Forbidden»
      const g = await keyGate(request, env, key, [leadsKey(env), hasClient(c) && env["KEY_" + c.toUpperCase()]]);
      if (g === -2) return tooManyKeys();
      if (g < 0) return forbid();
      return page(await leadsPage(env, g === 0 ? (hasClient(c) ? c : null) : c)); // заявки с телефонами: не кэшировать, не встраивать (как и вход по cookie)
    }
    // ---- демо пульта (вымышленные данные, всё в браузере, к серверу и хранилищу не обращается) и установка на экран «Домой»
    if (M === "GET" && (P === "/demo" || P === "/demo/")) return page(pult.PULT_DEMO, 200, { "x-robots-tag": "noindex, nofollow" });
    if (M === "GET" && (P === "/manifest.webmanifest" || P === "/demo.webmanifest")) return pultManifest(P === "/demo.webmanifest");
    { const im = M === "GET" && /^\/pult\/icon-(180|192|512)\.png$/.exec(P); if (im) return pultIcon(im[1], pult.PULT_ICONS); }
    // ---- вход и страница владельца
    if (P === "/login" && (M === "GET" || M === "POST")) return handleLogin(request, env, url);
    if (M === "GET" && P === "/logout") return new Response(null, { status: 303, headers: { location: "/login", "set-cookie": cookieSet("", 0), "cache-control": "no-store" } });
    if (M === "GET" && P === "/studio") {
      const a = await enter(request, env, url);
      if (a.res) return a.res;
      return a.s.role === "owner" ? page(studioPage()) : new Response(null, { status: 303, headers: { location: "/inbox?c=" + a.s.cid } });
    }
    if (P.startsWith("/api/studio/")) {
      const s = await sessionRead(env, request);
      return s ? studioApi(request, env, url, s) : jsonP({ error: "Войдите заново." }, 401);
    }
    // ---- пульт чатов
    if (M === "GET" && P === "/inbox") {
      const a = await enter(request, env, url);
      if (a.res) return a.res;
      const c = url.searchParams.get("c");
      if (a.s.role === "staff" && c !== a.s.cid) return new Response(null, { status: 303, headers: { location: "/inbox?c=" + a.s.cid } }); // сотрудник — только в свой пульт
      if (c && !hasClient(c)) return new Response(null, { status: 303, headers: { location: "/inbox" } });
      return page(pult.PULT_LIVE);
    }
    if (P.startsWith("/api/inbox/")) {
      const s = await sessionRead(env, request);
      if (!s) return jsonP({ error: "Войдите заново." }, 401);
      if (M === "GET" && P === "/api/inbox/me") return jsonP({ owner: s.role === "owner", c: s.role === "staff" ? s.cid : "" });
      return inboxApi(request, env, url, s);
    }
    // ---- проверка запуска (чек-лист подключений и экзамен бота)
    if (M === "GET" && P === "/launch") {
      const a = await enter(request, env, url);
      if (a.res) return a.res;
      if (a.s.role !== "owner") return new Response(null, { status: 303, headers: { location: "/inbox?c=" + a.s.cid } });
      return hasClient(url.searchParams.get("c")) ? page(launchPage()) : new Response(null, { status: 303, headers: { location: "/studio" } });
    }
    if (P.startsWith("/api/launch/")) {
      const s = await sessionRead(env, request);
      return s ? launchApi(request, env, url, s) : jsonP({ error: "Войдите заново." }, 401);
    }
    // ---- рассылки
    if (M === "GET" && P === "/broadcast") {
      const a = await enter(request, env, url);
      if (a.res) return a.res;
      const c = url.searchParams.get("c");
      if (a.s.role === "staff" && c !== a.s.cid) return new Response(null, { status: 303, headers: { location: "/broadcast?c=" + a.s.cid } });
      return hasClient(c) ? page(bcPage()) : new Response(null, { status: 303, headers: { location: a.s.role === "owner" ? "/studio" : "/broadcast?c=" + a.s.cid } });
    }
    if (P.startsWith("/api/bc/")) {
      const s = await sessionRead(env, request);
      return s ? bcApi(request, env, url, s) : jsonP({ error: "Войдите заново." }, 401);
    }
    // ---- WhatsApp клиента со своим номером: вебхук /wa/<id>
    const wm = /^\/wa\/([a-z][a-z0-9]{1,15})$/.exec(P);
    if (wm) return handleWAClient(request, env, ctx, wm[1], url.origin);
    if (M === "GET" && P === "/diag") { const a = await owner(); return a === true ? text(await diag(env)) : a || forbid(); }
    if (P === "/altegio/user" && (M === "GET" || M === "POST")) { // ключ пользователя Altegio: читается ли журнал записей
      // каждая причина отказа — своим текстом: вживую 10 октября форма ответила просто «Forbidden», и было непонятно почему
      if (M === "POST" && !sameOrigin(request, url)) return new Response(`Forbidden: форма отправлена с другого адреса (${clean(request.headers.get("origin") || "", 80)} ≠ ${url.origin})`, { status: 403 });
      let f = null;
      if (M === "POST") { try { f = await request.formData(); } catch (e) { return new Response("Форма не прочитана: " + clean(String(e), 120), { status: 400 }); } }
      const k0 = f ? String(f.get("key") || "") : url.searchParams.get("key") || "";
      const a = await owner(k0 || undefined); // ключ из адреса страницы форма передаёт дальше (вживую 10 октября без него был отказ)
      if (a !== true) return a || new Response(`Forbidden: нет входа владельца — откройте /studio, войдите ключом владельца и повторите (cookie ${new RegExp(COOKIE + "=").test(request.headers.get("cookie") || "") ? "есть, но не подошла" : "не пришла"})`, { status: 403 });
      if (M === "GET") return page(altUserPage("", url.searchParams.get("c") || "", k0));
      const cid = String(f.get("c") || "");
      const r = await altUserProbe(env, cid, String(f.get("login") || ""), String(f.get("password") || ""), String(f.get("phone") || ""));
      return page(altUserPage(r.text, cid, k0, r.token, "ALTEGIO_USER_" + String(cid || "").toUpperCase()));
    }
    if (P === "/altegio" && (M === "GET" || M === "POST")) { // проверка расписания; POST — пробная запись с удалением
      let q = { key: url.searchParams.get("key"), c: url.searchParams.get("c") || "", loc: url.searchParams.get("loc") || "", phone: "" };
      if (M === "POST") { try { const f = await request.formData(); q = { key: f.get("key"), c: String(f.get("c") || ""), loc: String(f.get("loc") || ""), phone: String(f.get("phone") || "") }; } catch (e) { q.key = null; } }
      if (M === "POST" && !sameOrigin(request, url)) return forbid(); // пробную запись запускает только своя страница
      const a = await owner(q.key);
      if (a !== true) return a || forbid();
      return page(altPage(await altDiag(env, q.c, q.loc, q.phone), q.key || "", q.c, q.loc)); // в странице ключ владельца и данные Altegio
    }
    if (M === "GET" && P === "/selftest") { const a = await owner(); return a === true ? page(selftestPage(url.searchParams.get("key") || "")) : a || forbid(); }
    if (M === "POST" && P === "/api/selftest") {
      /** @type {any} */ let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
      const a = await owner(b.key);
      if (a !== true) return a || forbid();
      return jsonP(await runCase(env, b.i === undefined || b.i === null || b.i === "" ? -1 : +b.i)); // переписки автотеста — не кэшировать
    }
    if (request.method === "GET" && P === "/api/selftest") { // один сценарий автотеста по ссылке: ?key=…&i=номер (HEAD — так ссылки проверяют мессенджеры — сценарий не запускает)
      const a = await owner();
      if (a !== true) return a || forbid();
      const i = url.searchParams.get("i");
      return jsonP(await runCase(env, i === null || i === "" ? -1 : +i)); // без номера сценарий не запускаем; не кэшировать
    }
    if (M === "POST" && P === "/api/chat") return handleWebChat(request, env, ctx);
    if (M === "GET" && P === "/api/history") {
      const c = hasClient(url.searchParams.get("c")) ? url.searchParams.get("c") : "dent";
      const sid = cleanSid(url.searchParams.get("sid"));
      let turns = [];
      try { const h = sid ? JSON.parse((await env.KV.get(`h:web:${c}:${sid}`)) || "null") : null; if (h && Array.isArray(h.turns)) turns = h.turns; }
      catch (e) { console.log("history read", String(e)); } // хранилище не отвечает — чат открывается без прежней переписки, а не с ошибкой
      return jsonP({ turns }); // переписка клиента: не кэшировать
    }
    if (M === "POST" && P === "/ga") { // Green-API, общий номер воркера
      if (!env.GA_HOOK || url.searchParams.get("t") !== env.GA_HOOK) return forbid();
      let body = null; try { body = await request.json(); } catch (e) {}
      if (body) ctx.waitUntil(handleGreen(body, env, url.origin, gaShared(env)).catch(err => console.log("ga error", String(err))));
      return new Response("OK");
    }
    const gam = M === "POST" && /^\/ga\/([a-z][a-z0-9]{1,15})$/.exec(P);
    if (gam) { // Green-API: свой номер клиента, вебхук /ga/<id>?t=<пароль>
      const r = /** @type {any} */ (gaRoute(env, gam[1]));
      if (!r || r.shared || !eqSafe(url.searchParams.get("t") || "", await gaHook(r))) return forbid();
      let body = null; try { body = await request.json(); } catch (e) {}
      if (body) ctx.waitUntil(handleGreen(body, env, url.origin, r).catch(err => console.log("ga error", String(err))));
      return new Response("OK");
    }
    if (M === "POST" && (P === "/" || P === "/webhook")) { // WhatsApp Cloud API (Meta), общий номер воркера. Вебхуки клиентов со своим номером — /wa/<id>
      if (!env.WA_TOKEN) return new Response("Not found", { status: 404 }); // общий номер не настроен — принимать нечего (иначе посторонний мог бы засорять хранилище поддельными «сообщениями»)
      const raw = await request.text();
      if (env.APP_SECRET) { if (!(await metaSigOk(env.APP_SECRET, raw, request.headers.get("x-hub-signature-256")))) return new Response("Bad signature", { status: 403 }); }
      else if (hookBurst(request)) return new Response("Too many requests", { status: 429 }); // без подписи Meta: не больше 30 запросов в минуту с одного адреса
      let body = null; try { body = JSON.parse(raw); } catch (e) {}
      if (body) ctx.waitUntil(handleWhatsApp(body, env, { origin: url.origin, signed: !!env.APP_SECRET }).catch(err => console.log("wa error", err)));
      return new Response("OK");
    }
    if (M === "POST") return new Response("Not found", { status: 404 });
    if (M === "GET" && P === "/privacy") return html(privacyPage(env));
    if (M === "GET" && (P === "/" || P === "/chat")) {
      const id = /** @type {any} */ (url.searchParams.get("c"));
      return html(hasClient(id) ? chatPage(id, CLIENTS[id]) : portfolioPage());
    }
    return new Response("Not found", { status: 404 });
}
