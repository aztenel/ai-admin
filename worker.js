// AI-администратор v7.5 — веб-чат по ссылке (6 ниш) + WhatsApp Cloud API + запись в Altegio + автотест
// Cloudflare Worker.
//
// ОБЯЗАТЕЛЬНО:  KV binding "KV" · Secret GEMINI_KEY · Text VERIFY_TOKEN
// ЖЕЛАТЕЛЬНО:   Text LEADS_KEY (пароль к заявкам и автотесту; если нет — используется VERIFY_TOKEN)
//               Text MODEL (например gemini-3.5-flash-lite) · Text MODEL_FALLBACK
// УВЕДОМЛЕНИЯ:  Secret TG_TOKEN + Text TG_CHAT — заявки, отмены, «позовите человека», голосовые и фото в Telegram.
//               TG_CHAT можно через запятую (владелец, администратор). Свой чат у клиента: TG_CHAT_DENT, TG_CHAT_BEAUTY…
// СОГЛАСИЕ:     Text CONSENT_TEXT — свой текст согласия (по умолчанию стандартный, {name} = название компании)
// WHATSAPP (официально, Meta):  Secret WA_TOKEN · Text PHONE_NUMBER_ID · Text WA_CLIENT · Secret APP_SECRET
//   Webhook в Meta (WhatsApp → Configuration): Callback URL = https://<воркер>/  · Verify token = VERIFY_TOKEN · поле messages
//   APP_SECRET = App secret из App settings → Basic: бот принимает только запросы, подписанные Meta.
//   Без APP_SECRET бот в WhatsApp сам в расписание Altegio не записывает — передаёт заявку администратору
//   Text OWNER_NAME, OWNER_EMAIL — оператор и почта на странице /privacy (Privacy Policy URL для публикации приложения Meta)
// WHATSAPP (Green-API, обычный WhatsApp по QR-коду), номер клиента: Text GA_ID_<ID> · Secret GA_TOKEN_<ID> · Text GA_URL_<ID> (apiUrl из кабинета)
//   Вебхук https://<воркер>/ga/<id>?t=<пароль> настраивает кнопка «Настроить Green-API» на странице /launch?c=<id>. Через этот номер идут и рассылки (обычным текстом).
// WHATSAPP (Green-API, общий номер воркера — демо):   Text GA_URL · Text GA_ID · Secret GA_TOKEN · Secret GA_HOOK (любой пароль)
//                               Text GA_CLIENT — ниша (dent/beauty/…); пусто = меню ниш
//   Webhook URL в кабинете Green-API:  https://<воркер>/ga?t=<GA_HOOK>
// КЛЮЧИ КЛИЕНТОВ: Text KEY_DENT, KEY_BEAUTY… — владелец видит только свои заявки: /leads?c=dent&key=…
// ALTEGIO (запись в расписание): Secret ALTEGIO_PARTNER — ключ разработчика (Altegio → Интеграции → Аккаунт разработчика)
//   Локация клиента: поле altegio.location в его блоке CLIENTS или Text ALTEGIO_LOC_<ID> (например ALTEGIO_LOC_ALT)
//   Бот берёт из Altegio услуги, мастеров и свободное время и сам создаёт запись (API онлайн-записи).
//   Отмена и перенос: по умолчанию бот в расписании ничего не удаляет, а передаёт просьбу клиента администратору (заявка + Telegram).
//   Text ALTEGIO_SELF_CANCEL = 1 (или ALTEGIO_SELF_CANCEL_<ID>, или altegio.selfCancel в блоке клиента) — бот отменяет и переносит сам
// ЛИМИТЫ:       Text SESSIONS_PER_IP — новых диалогов в сутки с одного IP (по умолчанию 8 для демо и 40 для клиента с расписанием Altegio)
//
// Ссылки:
//   /                         — витрина всех демо
//   /?c=dent|beauty|auto|edu|event|barber — чат ниши; /?c=alt — чат с записью в расписание Altegio (не на витрине)
//   /leads?key=<LEADS_KEY>    — заявки
//   /selftest?key=<LEADS_KEY> — автотест на живой модели (один сценарий по ссылке: /api/selftest?key=…&i=номер)
//   /diag?key=<LEADS_KEY>     — диагностика ключа и модели
//   /altegio?key=<LEADS_KEY>  — проверка Altegio: услуги, мастера, свободное время (&loc=<номер> — любая локация) и пробная запись
//
// Новый клиент = новый блок в CLIENTS: факты, график (hours), слоты (slots), безопасные фразы.
// Страница пульта (дизайн, телефон/планшет/ПК, демо) лежит в папке pult/ и собирается в pult.gen.js командой `node tools/build-pult.mjs`.
import { PULT_LIVE, PULT_DEMO, PULT_ICONS } from "./pult.gen.js";
// Модули переезда (REFACTORING.md): всё новое — только в src/, worker.js их подключает.
import { money } from "./src/lib/money.js";
import { nameToks, svTrim } from "./src/lib/names.js";
import { normPhone, phonesIn, redact, maskPhones } from "./src/lib/phone.js";
import { TZ, local, mins, isoDay, hm } from "./src/lib/time.js";
import { clean, snip, lowE, esc, isJoke } from "./src/lib/text.js";
import { hash, enc8, hmacB64, safeEq, metaSigOk } from "./src/lib/crypto.js";
import { html, json, jsonP, page, forbid, sameOrigin } from "./src/lib/http.js";
import { altText, altCall } from "./src/services/integrations/altegio/client.js";
import { altCache, altBase, altDates, altDropTimes, altTimes, altRecord } from "./src/services/integrations/altegio/booking-api.js";
import { altEmailErr, ALT_EMAIL_TIP } from "./src/services/integrations/altegio/errors.js";
import { kvRetry } from "./src/db/kv/retry.js";
import { putHist, logTurns, mergeProfile, readHist } from "./src/db/kv/chats.js";
import { leadTs, loadLeads, saveLeads, leadKey, allLeads } from "./src/db/kv/leads.js";
import { bcKey, bcChunkKey, bcPut, bcGet } from "./src/db/kv/broadcasts.js";
import { detectLang } from "./src/services/conversation/language.js";
import { tagFields, tagField, altDateOf } from "./src/services/conversation/tags.js";
import { altClaims } from "./src/services/conversation/claims.js";
import { checkReply, offers, findPhone } from "./src/services/conversation/guard.js";
import { hStr, freeSlots, getSlots } from "./src/services/schedule/slots.js";
import { ALT_WANT_CHANGE } from "./src/services/conversation/intents.js";
import { compileClient, syncClients } from "./src/services/tenants/passport.js";
import { CLIENTS, BUILTIN, hasClient } from "./src/config/builtin-clients.js";
import { notify, tgProbe } from "./src/services/integrations/telegram/client.js";
import { noteDue, notifyOnce, backupRun } from "./src/services/notifications/telegram.js";
import { gaShared, gaRoute, gaSecret, gaHook } from "./src/services/integrations/greenapi/webhook.js";
import { gaCall, gaCode, gaWhy, gaInfo } from "./src/services/integrations/greenapi/client.js";
import { sendGreen } from "./src/services/channels/greenapi.js";
import { waCreds, WA_HINT, waErr } from "./src/services/integrations/meta/client.js";
import { bcParam, sendTemplate } from "./src/services/integrations/meta/templates.js";
import { sendWA } from "./src/services/channels/meta.js";
import { fixedOf, nicheOf, seenBefore, waCoex, markOptout, waRoute } from "./src/services/channels/index.js";
import { NICHES } from "./src/config/niches.js";
import { askGemini } from "./src/services/ai/gemini.js";
import { isClaude } from "./src/services/ai/claude.js";
import { PAUSE_MS, LEAD_TTL, MAX_LEN, SESSIONS_PER_IP, HIST_KEEP, ALT_DAYS, ALT_JOURNAL_DAYS, GRAPH, WA_BATCH, SESSION_MS, COOKIE, BC_CHUNK, BC_STALE, BC_SLOT, BC_DAY } from "./src/config/constants.js";
// nameForms, altNamed, ANY_STAFF, altDay, altLimKeys в worker.js не вызываются: их берут обвязки test/review (копия worker.js с экспортом внутренних функций)
import { nameKey, samePerson, caseName, nameForms } from "./src/services/booking/people.js";
import { altPickServices, altPickStaff, altNamed, ANY_STAFF } from "./src/services/booking/pick.js";
import { altSelfCancel, altLoc, thin, altSnapshot, altBook } from "./src/services/booking/book.js";
import { altUserKey } from "./src/services/booking/journal.js";
import { altWhen, altLabel, altSay, altDay } from "./src/services/booking/replies.js";
import { BASE_CSS } from "./src/lib/css.js";
import { altDiag, altUserProbe, altUserPage, altPage } from "./src/controllers/altegio.js";
import { diag } from "./src/controllers/diag.js";
import { leadsPage, privacyPage, portfolioPage, chatPage } from "./src/controllers/pages.js";
import { selftestPage } from "./src/controllers/selftest.js";
import { sundayNight, has, hasnt, noOffer, pickSlot, KZ, altSlot, altMade, CASES, COMMON } from "./src/services/selftest/cases.js";
import { ipKey, altOverLimit, altCount, altLimKeys } from "./src/services/booking/limits.js";
import { BC_HINT, bcCode, bcWhy } from "./src/services/broadcast/errors.js";
import { bcParse } from "./src/services/broadcast/parse.js";
import { bcSeg, bcOptouts } from "./src/services/broadcast/segments.js";
import { bcHold, bcHoldFor, bcFrom, bcHoldEdit, GA_STATE_TEXT, GA_STATE_BAD, gaStateSignal, waSignal, waFailed } from "./src/services/broadcast/holds.js";
import { bcRoute, bcHealth, bcGaMsg, bcGaText, bcSendGa, bcRun, bcTick, GA_CAP, GA_MSG_MAX, GA_CAPTION_MAX } from "./src/services/broadcast/sender.js";
import { remindRun } from "./src/services/reminders/send.js";
import { digestRun } from "./src/services/digest.js";
import { cronRun } from "./src/jobs/cron.js";
import { systemPrompt } from "./src/services/conversation/prompt.js";
// wantsHuman, HANDOFF, ATTACK в worker.js не вызываются: их берут обвязки test/review (копия worker.js с экспортом внутренних функций)
import { canSee } from "./src/services/auth/access.js";
import { inboxApi } from "./src/controllers/inbox.js";
import { leadsKey, sessionRead, cookieSet, keyGate } from "./src/services/auth/session.js";
import { tooManyKeys, handleLogin, enter } from "./src/controllers/auth.js";
import { studioApi, studioPage } from "./src/controllers/studio.js";
import { launchApi, launchPage } from "./src/controllers/launch.js";
import { bcApi, bcPage } from "./src/controllers/broadcast.js";
import { runCase } from "./src/services/selftest/run.js";
import { think, thinkSafe, dropAsk, FALLBACK, STOP, wantsHuman, HANDOFF, ATTACK } from "./src/services/conversation/orchestrator.js";
import { cleanSid, tooMany, handleWebChat } from "./src/controllers/chat.js";
import { consentText, MENU, MENU_TEXT, hookBurst, handleWAText, waText, MEDIA_LABEL, MEDIA_WORD, handleWAMedia, handleWhatsApp, handleWAMessage, handleWAClient } from "./src/controllers/webhooks/meta.js";
import { gaText, handleGreen } from "./src/controllers/webhooks/greenapi.js";


// ================= слой 1: вход =================
const JOKE = { test: isJoke };


// ================= передача живому администратору =================
const WORD = /[^a-zа-яәғқңөұүһі0-9]+/;

const firstWord = s => clean(s).toLowerCase().split(" ")[0];

// ================= HTTP =================

export default {
  async fetch(request, env, ctx) {
    try { return await route(request, env, ctx); }
    catch (e) { // необработанный сбой (чаще всего — хранилище): страницы пульта и рассылок получают понятный ответ, а не пустую ошибку
      console.log("fatal", String((e && e.stack) || e).slice(0, 800));
      let P = ""; try { P = new URL(request.url).pathname; } catch (x) {}
      if (P.startsWith("/api/") && P !== "/api/chat") return jsonP({ error: "Сбой на сервере — попробуйте ещё раз через минуту." }, 500);
      throw e;
    }
  },
  // раз в минуту (cron в wrangler.jsonc): фоновая отправка рассылок
  backup: (env) => backupRun(env, true), // для проверок
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(Promise.all([cronRun(env), backupRun(env), digestRun(env, (controller && controller.scheduledTime) || Date.now()), remindRun(env, (controller && controller.scheduledTime) || Date.now())]).catch(e => console.log("cron", String((e && e.stack) || e))));
  }
};
async function route(request, env, ctx) {
    const url = new URL(request.url), P = url.pathname, M = request.method === "HEAD" ? "GET" : request.method; // HEAD — так проверяют ссылки Meta и другие сервисы
    // владелец: cookie после входа либо ключ в адресе (с ограничением числа неверных попыток) → true, false или готовый ответ «подождите»
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
      const c = url.searchParams.get("c"), key = url.searchParams.get("key");
      const s = await sessionRead(env, request); // вход по cookie: владелец видит всех (или одного — ?c=), сотрудник — только своего клиента
      if (s) return page(await leadsPage(env, s.role === "staff" ? s.cid : hasClient(c) ? c : null, s));
      if (!key) return new Response(null, { status: 303, headers: { location: "/login?next=" + encodeURIComponent(P + url.search), "cache-control": "no-store" } }); // без входа — на страницу входа, а не «Forbidden»
      const g = await keyGate(request, env, key, [leadsKey(env), hasClient(c) && env["KEY_" + c.toUpperCase()]]);
      if (g === -2) return tooManyKeys();
      if (g < 0) return forbid();
      return page(await leadsPage(env, g === 0 ? (hasClient(c) ? c : null) : c)); // заявки с телефонами: не кэшировать, не встраивать (как и вход по cookie)
    }
    // ---- демо пульта (вымышленные данные, всё в браузере, к серверу и хранилищу не обращается) и установка на экран «Домой»
    if (M === "GET" && (P === "/demo" || P === "/demo/")) return page(PULT_DEMO, 200, { "x-robots-tag": "noindex, nofollow" });
    if (M === "GET" && (P === "/manifest.webmanifest" || P === "/demo.webmanifest")) return pultManifest(P === "/demo.webmanifest");
    { const im = M === "GET" && /^\/pult\/icon-(180|192|512)\.png$/.exec(P); if (im) return pultIcon(im[1]); }
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
      return page(PULT_LIVE);
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
      let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
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
      const r = gaRoute(env, gam[1]);
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
      const id = url.searchParams.get("c");
      return html(hasClient(id) ? chatPage(id, CLIENTS[id]) : portfolioPage());
    }
    return new Response("Not found", { status: 404 });
}

const eqSafe = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
// ================= страницы =================
function text(s) { return new Response(s, { headers: { "content-type": "text/plain; charset=utf-8" } }); }



const PULT_BYTES = {};
function pultIcon(n) { // иконка приложения для экрана «Домой»: байты разбираем один раз и держим в памяти
  if (!PULT_BYTES[n]) { const bin = atob(PULT_ICONS[n]), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); PULT_BYTES[n] = u; }
  return new Response(PULT_BYTES[n], { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
}
function pultManifest(demo) { // чтобы пульт ставился на экран «Домой» как приложение (iPhone, Android, компьютер)
  const m = { id: demo ? "/demo" : "/inbox", name: demo ? "Пульт чатов — демо" : "Пульт чатов", short_name: demo ? "Пульт демо" : "Пульт", start_url: demo ? "/demo" : "/inbox", scope: demo ? "/demo" : "/", display: "standalone", orientation: "any", lang: "ru", background_color: "#0F1419", theme_color: "#0F1419",
    icons: [{ src: "/pult/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/pult/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }, { src: "/pult/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] };
  return new Response(JSON.stringify(m), { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

