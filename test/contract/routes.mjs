// Контракт маршрутов (REFACTORING.md, шаг 0): для каждого адреса и каждой роли — код ответа, вид ответа и права.
// Ловит поломки при смене роутера (фаза 3): если маршрут начал отвечать иначе, проверка покажет, где и как.
//   • снимок test/contract/routes.snap.json — статус, тип, переадресация, заголовки защиты, ключи JSON;
//   • правила прав (не зависят от снимка): гость, сотрудник чужого клиента, чужой сайт и неподписанный вебхук данных не получают.
// Запуск: node test/contract/routes.mjs. Поведение изменили намеренно — UPDATE=1 node test/contract/routes.mjs и проверить разницу в git.
// Строки в снимке — тестовые ключи из обвязки (owner-key-123456 и т. п.), не настоящие.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { mk, net, ok, T, gaPass } from "../harness.mjs";
import { PULT_APP } from "../../pult-app.gen.js";
import { winchesterAlt } from "../fixtures/winchester-altegio.mjs";
import { grantSnap, sqliteOk } from "../consent.mjs";
import { d1With } from "../d1.mjs";

const SNAP = fileURLToPath(new URL("./routes.snap.json", import.meta.url));
const OWNER_KEY = "owner-key-123456", STAFF_KEY = "staff-key-barber-0001", OTHER_KEY = "staff-key-dent-0002";
// вебхуки настроены по-настоящему (свой номер Meta и Green-API у барбершопа, общий номер Meta и Green-API воркера) — значит, проверяется именно подпись и пароль
const GA = { id: "7105000001", token: "ga-tok-barber" };
const S = mk({ KEY_BARBER: STAFF_KEY, KEY_DENT: OTHER_KEY, WA_TOKEN_BARBER: "tok-barber", APP_SECRET_BARBER: "sec-barber", WA_TOKEN: "wat", APP_SECRET: "sec-shared", WA_CLIENT: "barber",
  GA_ID_BARBER: GA.id, GA_TOKEN_BARBER: GA.token, GA_URL_BARBER: "https://7105.api.green-api.com",
  GA_ID: "7105000009", GA_TOKEN: "ga-tok-shared", GA_URL: "https://7105.api.green-api.com", GA_CLIENT: "barber", GA_HOOK: "ga-hook-shared" });
const sig = (secret, body) => "sha256=" + createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex");
const gaPw = gaPass("barber", GA);
// новый пульт /app/ (apps/pult → pult-app.gen.js): имена файлов сборки меняются с каждой сборкой (хэш содержимого) — в снимке вместо хэша «<хэш>»
const APP_JS = "/app/" + /<script type="module"[^>]*\bsrc="\.\/(assets\/[^"]+\.js)"/.exec(PULT_APP["index.html"].body)[1];
const APP_CSS = "/app/" + /<link rel="stylesheet"[^>]*\bhref="\.\/(assets\/[^"]+\.css)"/.exec(PULT_APP["index.html"].body)[1];
const shown = p => p.replace(/^(\/app\/assets\/[\w.-]+?)-[\w-]{8}\.(js|css)$/, "$1-<хэш>.$2");

// у каждого запроса свой адрес: неверные ключи считаются по адресу, и проверки не должны блокировать друг друга
let ipN = 0;
const ip = () => `10.77.${Math.floor(++ipN / 250)}.${ipN % 250}`;
const go = async (b, method, path, body, extra = {}) => { // extra — свои заголовки (подпись, origin)
  const headers = { "cf-connecting-ip": ip(), ...extra };
  const init = { method, headers };
  if (body !== undefined) {
    if (typeof body === "string") { headers["content-type"] = "application/x-www-form-urlencoded"; init.body = body; }
    else { headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  }
  if (!b) return S.call(path, { ...init, redirect: "manual" });
  const one = S.browser(); one.cookie = b.cookie; // копия cookie: ответ (например, /logout) не должен разлогинить роль для следующих проверок
  return one.go(path, init);
};

// входим как владелец и как сотрудник барбершопа (ключ один раз → cookie)
async function login(key, next) {
  const b = S.browser();
  const r = await b.go("/login", { method: "POST", headers: { "cf-connecting-ip": ip(), "content-type": "application/x-www-form-urlencoded" }, body: `key=${encodeURIComponent(key)}&next=${encodeURIComponent(next)}` });
  ok(`вход ключом → 303 и cookie (${next})`, r.status === 303 && !!b.cookie, r.status);
  return b;
}
const owner = await login(OWNER_KEY, "/studio"), staff = await login(STAFF_KEY, "/inbox?c=barber");
const ROLES = { anon: null, owner, staff };

// данные чужого для сотрудника клиента (стоматология): заявка и чат WhatsApp с меткой — метка не должна попасть ни в один его ответ
const MARK = "Дентмаркер", now = Date.now();
await S.kv.api.put("leads:dent", JSON.stringify([{ id: now.toString(36) + "abcd", ts: now, name: MARK, phone: "+77010000055", text: MARK + ": чистка зубов", source: "Стоматология · WhatsApp", status: "новая" }]));
await S.kv.api.put("h:wa:dent:77010000055", JSON.stringify({ n: 1, turns: [{ role: "user", text: MARK + " хочет на чистку", t: now }], profile: { name: MARK, li: now } }), { metadata: { nm: MARK, s: MARK + " хочет на чистку", d: "u", t: now, li: now } });
// база клиентов из Altegio у стоматологии (снимок с той же меткой): сотруднику барбершопа — ни сегментов, ни списка
const d25 = new Date(now - 25 * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
await S.kv.api.put("crm:dent:snap", JSON.stringify({ at: now, from: d25, to: d25, records: 1, visits: 1, clients: 1, masked: 0, bad: 0, att: { 1: 1 }, cut: false, list: [{ p: "77010000055", n: MARK, last: d25, first: d25, v: 1, staff: MARK, svc: "Чистка" }] }));

// что запоминаем о ответе: только то, что не меняется от запуска к запуску
async function shape(r) {
  const ct = (r.headers.get("content-type") || "").split(";")[0];
  const o = { status: r.status, type: ct || "-" };
  const loc = r.headers.get("location");
  if (loc) o.location = loc;
  if (r.headers.get("set-cookie")) o.cookie = /max-age=0/i.test(r.headers.get("set-cookie")) ? "clear" : "set";
  if (r.headers.get("cache-control")) o.cache = r.headers.get("cache-control");
  if (r.headers.get("content-security-policy")) o.csp = true;
  if (r.headers.get("x-frame-options")) o.frame = r.headers.get("x-frame-options");
  const ac = r.headers.get("access-control-allow-origin"); if (ac) o.cors = ac; // CORS (только /api/site/): старые записи снимка от этого не меняются
  const text = await r.text();
  Object.defineProperty(o, "body", { value: text }); // для проверки утечек; в снимок не идёт
  if (ct === "application/json" || ct === "application/manifest+json") {
    try { const j = JSON.parse(text); o.json = Array.isArray(j) ? "array" : j && typeof j === "object" ? Object.keys(j).sort() : typeof j; } catch (e) { o.json = "invalid"; }
  } else if (ct === "text/plain" || ct === "-") o.text = text.slice(0, 60).replace(/\d{2,}/g, "#");
  return o;
}

// вебхуки с настоящим на вид сообщением: если бы проверка подписи/пароля пропустила, бот ответил бы (вызов ИИ)
const META = { object: "whatsapp_business_account", entry: [{ id: "waba1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "555000111" }, messages: [{ id: "wamid.contract.1", from: "77010000009", type: "text", text: { body: "Привет" } }] } }] }] };
const GREEN = { typeWebhook: "incomingMessageReceived", idMessage: "GA-contract-1", instanceData: { idInstance: 1101000001 }, senderData: { chatId: "77010000009@c.us", sender: "77010000009@c.us" }, messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "Привет" } } };

// маршруты: [метод, путь, тело]. Тела для изменяющих запросов — без побочных действий над настоящими данными (ошибка ввода или безвредное действие).
const R = [
  ["GET", "/"], ["GET", "/?c=barber"], ["GET", "/?c=nope"], ["GET", "/chat"], ["GET", "/privacy"], ["GET", "/nope"], ["POST", "/nope", {}],
  ["GET", "/?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=12345"], ["GET", "/?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=1"],
  ["GET", "/demo"], ["GET", "/demo/"], ["GET", "/manifest.webmanifest"], ["GET", "/demo.webmanifest"], ["GET", "/pult/icon-180.png"], ["GET", "/pult/icon-192.png"], ["GET", "/pult/icon-512.png"], ["GET", "/pult/icon-64.png"],
  ["GET", "/app"], ["GET", "/app?c=barber"], ["GET", "/app/"], ["GET", "/app/?c=barber"], ["GET", "/app/index.html"], ["GET", APP_JS], ["GET", APP_CSS], ["GET", "/app/assets/nope.js"], ["GET", "/app/nope"], ["POST", "/app/", {}],
  ["GET", "/login"], ["GET", "/login?next=%2Finbox"], ["GET", "/login?next=%2Fapp%2F%3Fc%3Dbarber"], ["POST", "/login", "key=wrong-key"], ["GET", "/logout"],
  ["GET", "/leads"], ["GET", "/leads?c=barber"], ["GET", "/leads?c=dent"], ["GET", "/leads?key=wrong"], ["GET", `/leads?key=${OWNER_KEY}`], ["GET", `/leads?c=barber&key=${STAFF_KEY}`], ["GET", `/leads?c=dent&key=${STAFF_KEY}`],
  ["GET", "/studio"], ["GET", "/inbox"], ["GET", "/inbox?c=barber"], ["GET", "/inbox?c=dent"], ["GET", "/inbox?c=nope"],
  ["GET", "/launch"], ["GET", "/launch?c=barber"], ["GET", "/broadcast"], ["GET", "/broadcast?c=barber"], ["GET", "/broadcast?c=dent"],
  ["GET", "/api/studio/list"], ["GET", "/api/studio/get?id=nope"], ["POST", "/api/studio/check", {}], ["POST", "/api/studio/save", {}], ["POST", "/api/studio/key", { id: "nope" }], ["POST", "/api/studio/remove", { id: "nope" }], ["GET", "/api/studio/nope"],
  ["GET", "/api/inbox/me"], ["GET", "/api/inbox/list?c=barber"], ["GET", "/api/inbox/list?c=dent"], ["GET", "/api/inbox/chat?c=barber&ch=web&id=nobody"], ["GET", "/api/inbox/leads?c=barber"], ["GET", "/api/inbox/leads?c=dent"],
  ["GET", "/api/inbox/media?c=barber&ch=wa&id=77010000001&m=nope"], ["POST", "/api/inbox/send", { c: "barber" }], ["POST", "/api/inbox/send", { c: "dent" }], ["POST", "/api/inbox/act", { c: "barber" }], ["POST", "/api/inbox/act", { c: "dent" }], ["GET", "/api/inbox/nope?c=barber"],
  // ТЗ Winchester v2.0 (31.10.2026): список чатов v2, ближайшая запись Altegio, push-уведомления
  ["GET", "/api/inbox/list?c=barber&v=2"], ["GET", "/api/inbox/list?c=dent&v=2"], ["GET", "/api/inbox/booking?c=barber&ch=wa&id=77010000001"], ["GET", "/api/inbox/booking?c=dent&ch=wa&id=77010000055"],
  ["GET", "/api/push/config?c=barber"], ["GET", "/api/push/config?c=dent"], ["POST", "/api/push/subscribe", { c: "barber" }], ["POST", "/api/push/subscribe", { c: "dent" }],
  ["POST", "/api/push/prefs", { c: "barber" }], ["POST", "/api/push/unsubscribe", { c: "barber" }], ["POST", "/api/push/test", { c: "barber" }],
  ["GET", "/api/bc/templates?c=barber"], ["GET", "/api/bc/templates?c=dent"], ["POST", "/api/bc/templates", { c: "barber" }], ["POST", "/api/bc/templates/preview", { c: "barber" }], ["GET", "/api/bc/calendar?c=barber"], ["GET", "/api/bc/calendar?c=dent"], ["GET", "/api/bc/stats?c=barber"], ["GET", "/api/bc/stats?c=dent"],
  ["POST", "/api/bc/service/dry", { c: "barber" }], ["POST", "/api/bc/service/approve", { c: "barber" }],
  ["GET", "/api/inbox/catalog?c=barber"], ["GET", "/api/inbox/times?c=barber&date=2026-11-02"], ["GET", "/api/inbox/times?c=dent"],
  ["GET", "/api/launch/status?c=barber"], ["GET", "/api/launch/status?c=nope"], ["POST", "/api/launch/tg", { c: "barber" }], ["POST", "/api/launch/ga", { c: "barber" }], ["POST", "/api/launch/done", { c: "barber" }], ["POST", "/api/launch/case", { c: "barber", i: 999 }],
  ["GET", "/api/bc/list?c=barber"], ["GET", "/api/bc/list?c=dent"], ["GET", "/api/bc/get?c=barber&id=nope"], ["POST", "/api/bc/check", { c: "barber" }], ["POST", "/api/bc/test", { c: "barber" }], ["POST", "/api/bc/create", { c: "barber" }], ["POST", "/api/bc/act", { c: "barber" }], ["POST", "/api/bc/tick", { c: "barber" }], ["POST", "/api/bc/check", { c: "dent" }],
  ["GET", "/api/crm/segments?c=barber"], ["GET", "/api/crm/segments?c=dent"], ["GET", "/api/crm/list?c=barber&seg=pora"], ["GET", "/api/crm/list?c=dent&seg=pora"], ["GET", "/api/crm/list?c=barber&seg=nope"],
  ["POST", "/api/crm/refresh", { c: "barber" }], ["POST", "/api/crm/refresh", { c: "dent" }], ["GET", "/api/crm/nope?c=barber"],
  // база контактов D1 (этап 1): у Worker контракта базы нет — status отвечает ready: false, остальное 503; права — как у всех /api
  ["GET", "/api/contacts/status?c=barber"], ["GET", "/api/contacts/status?c=dent"], ["GET", "/api/contacts/segments?c=barber"], ["GET", "/api/contacts/list?c=barber&q=x"],
  ["GET", "/api/contacts/card?c=barber&id=x"], ["POST", "/api/contacts/add", { c: "barber", phone: "+77000000999" }], ["POST", "/api/contacts/consent", { c: "barber", id: "x" }],
  ["POST", "/api/contacts/restrict", { c: "barber", id: "x" }], ["POST", "/api/contacts/lift", { c: "barber", id: "x" }], ["POST", "/api/contacts/review", { c: "barber", id: "x", decision: "lift" }],
  ["POST", "/api/contacts/import", { c: "barber", text: "+77000000999" }], ["POST", "/api/contacts/import/confirm", { c: "barber", id: "x" }], ["POST", "/api/contacts/sync", { c: "barber", mode: "step" }],
  ["POST", "/api/contacts/probe", { c: "barber" }], ["POST", "/api/contacts/stops", { c: "barber", action: "sweep" }], ["POST", "/api/contacts/add", { c: "dent", phone: "+77000000999" }], ["GET", "/api/contacts/nope?c=barber"],
  // рассылка из сегмента базы (номера строит сервер, наружу — маской) и автосценарий «Пора на стрижку» (менять — только владелец)
  ["POST", "/api/bc/check", { c: "dent", segment: "all" }], ["POST", "/api/bc/create", { c: "barber", segment: "pora" }], ["POST", "/api/bc/create", { c: "dent", segment: "all" }],
  ["GET", "/api/bc/service?c=barber"], ["GET", "/api/bc/service?c=dent"],
  ["GET", "/api/bc/auto?c=barber"], ["GET", "/api/bc/auto?c=dent"], ["POST", "/api/bc/auto", { c: "barber" }], ["POST", "/api/bc/auto", { c: "dent", on: false }], ["POST", "/api/bc/auto", { c: "barber", days: 3 }],
  ["GET", "/wa/barber"], ["POST", "/wa/barber", META], ["POST", "/wa/barber", META, { "x-hub-signature-256": sig("wrong-secret", META) }], ["POST", "/wa/nope", META],
  ["GET", "/diag"], ["GET", "/diag/storage"], ["GET", "/diag?key=wrong"], ["GET", "/altegio"], ["POST", "/altegio", "c=barber"], ["GET", "/altegio/user"], ["POST", "/altegio/user", "c=barber"],
  ["GET", "/selftest"], ["POST", "/api/selftest", {}], ["GET", "/api/selftest"],
  ["POST", "/api/chat", {}], ["POST", "/api/chat", { c: "barber", sid: "contract-1", text: "Здравствуйте" }], ["GET", "/api/history?c=barber&sid=contract-1"], ["GET", "/api/history?c=barber"],
  ["POST", "/ga", GREEN], ["POST", "/ga?t=wrong", GREEN], ["POST", "/ga/barber", GREEN], ["POST", "/ga/barber?t=wrong", GREEN],
  ["POST", "/", META], ["POST", "/", META, { "x-hub-signature-256": sig("wrong-secret", META) }], ["POST", "/webhook", META],
  // онлайн-запись на сайте клиента (winchester.kz): CORS только для его сайтов. В контракте нет ключа Altegio — со своего сайта «выключено» (503)
  ["GET", "/api/site/winchester/catalog"], ["GET", "/api/site/winchester/catalog", undefined, { origin: "https://winchester.kz" }], ["GET", "/api/site/winchester/catalog", undefined, { origin: "https://evil.example" }],
  ["GET", "/api/site/barber/catalog"], ["GET", "/api/site/nope/catalog"], ["GET", "/api/site/winchester/nope", undefined, { origin: "https://winchester.kz" }],
  ["OPTIONS", "/api/site/winchester/book", undefined, { origin: "https://winchester.kz", "access-control-request-method": "POST" }],
  ["OPTIONS", "/api/site/winchester/book", undefined, { origin: "https://evil.example", "access-control-request-method": "POST" }],
  ["POST", "/api/site/winchester/book", {}, { origin: "https://winchester.kz" }],
  ["GET", "/api/site/winchester/times?staff=0&services=x&date=2026-10-04", undefined, { origin: "https://winchester.kz" }],
  // форма как онлайн-запись Altegio (22.10.2026): дни по месяцам и фото мастера (<img> шлёт запрос без Origin)
  ["GET", "/api/site/winchester/dates?staff=0&month=2026-10", undefined, { origin: "https://winchester.kz" }],
  ["GET", "/api/site/winchester/photo/2844400"], ["GET", "/api/site/winchester/photo/2844400?v=0123abcd", undefined, { origin: "https://winchester.kz" }],
  ["GET", "/api/site/winchester/photo/abc", undefined, { origin: "https://winchester.kz" }],
  ["OPTIONS", "/api/site/winchester/photo/2844400", undefined, { origin: "https://winchester.kz", "access-control-request-method": "GET" }]
];

// страницы и данные, куда без входа нельзя; что можно только владельцу; что видно по клиенту (c=dent — чужой для сотрудника барбершопа)
const PROTECTED = /^\/(leads|studio|inbox|launch|broadcast|diag|altegio|selftest)(\/|\?|$)|^\/api\/(studio|inbox|launch|bc|selftest|crm)\//;
const PROTECTED_EXACT = new Set(["/api/selftest"]);
const OWNER_ONLY = /^\/(studio|launch|diag|altegio|selftest)(\/|\?|$)|^\/api\/(studio|launch|selftest)(\/|$)|^\/api\/crm\/refresh$/; // обновить базу клиентов — только владелец
const OWNER_POST = /^\/api\/bc\/auto$/; // смотреть автосценарий может и сотрудник, менять — только владелец
const FOREIGN = /[?&]c=dent\b|"c":"dent"/;
const isProtected = p => PROTECTED.test(p) || PROTECTED_EXACT.has(p.split("?")[0]);

const label = (body, hd) => (body === undefined ? "" : body === META ? " <сообщение Meta>" : body === GREEN ? " <сообщение Green-API>" : " " + (typeof body === "string" ? body : JSON.stringify(body)))
  + (hd && hd["x-hub-signature-256"] ? " <неверная подпись>" : "") + (hd && hd.origin ? ` <origin ${hd.origin}>` : ""); // origin — запросы с сайта клиента (/api/site/)
// вход ключом в адресе (старый способ) — это не «гость»: ключ владельца — к любому клиенту, ключ сотрудника барбершопа — только к барбершопу
const hasKey = (p, k) => new URL(p, "https://x").searchParams.get("key") === k;
const validKey = p => hasKey(p, OWNER_KEY) || (hasKey(p, STAFF_KEY) && new URL(p, "https://x").searchParams.get("c") === "barber");
const got = {};
net.reset(); net.ai = ["Здравствуйте! Чем помочь?"];
for (const [method, path, body, hd] of R) {
  for (const [role, b] of Object.entries(ROLES)) {
    const id = `${method} ${shown(path)}${label(body, hd)} [${role}]`;
    const ai0 = net.gemini.length;
    const r = await go(b, method, path, body, hd);
    const o = await shape(r);
    got[id] = o;
    const p = path, data = o.status === 200;
    // 1. гость не получает защищённых страниц и данных
    if (role === "anon" && isProtected(p) && !validKey(p)) ok(`гость: ${id} → не 200`, !data, JSON.stringify(o));
    // 2. сотрудник не получает страниц и данных владельца
    if (role === "staff" && (OWNER_ONLY.test(p) || (method === "POST" && OWNER_POST.test(p)))) ok(`сотрудник: ${id} → не 200`, !data, JSON.stringify(o));
    // 3. сотрудник не видит чужого клиента: API с чужим c= отказывает, а страницы показывают только своего (метки чужих данных в ответе нет)
    if (role === "staff" && /^\/api\//.test(p) && isProtected(p) && FOREIGN.test(p + JSON.stringify(body || ""))) ok(`сотрудник, чужой клиент: ${id} → не 200`, !data, JSON.stringify(o));
    if (role !== "owner" && !hasKey(p, OWNER_KEY)) ok(`нет чужих данных в ответе: ${id}`, !o.body.includes(MARK), o.body.slice(0, 300));
    // 4. страницы с личными данными — без кэша, без встраивания, с CSP
    if (data && o.type === "text/html" && isProtected(p)) ok(`страница с данными без кэша и встраивания: ${id}`, o.cache === "no-store" && o.frame === "DENY" && o.csp, JSON.stringify(o));
    // 5. ответы API с данными не кэшируются (кроме картинки — фото мастера для сайта, браузер хранит его день: не данные;
    // исключение — по типу ответа, а не по адресу: JSON с адреса фото проверяется, как все — ревью 22.10.2026)
    if (data && /^\/api\/(inbox|launch|bc|studio|selftest|history|crm|site)\b/.test(p) && !/^image\//.test(o.type)) ok(`данные API не кэшируются: ${id}`, o.cache === "no-store", JSON.stringify(o));
    // 6. неподписанный вебхук и вебхук без пароля не запускают бота
    if (/^\/(wa\/|ga\b|webhook|$)/.test(p) && method === "POST") ok(`вебхук без подписи/пароля не доходит до ИИ: ${id}`, o.status !== 200 && net.gemini.length === ai0, JSON.stringify(o));
  }
}

// проверка подписи и пароля сама работает: правильно подписанный вебхук и правильный пароль Green-API доходят до бота (ИИ отвечает)
for (const [path, body, hd] of [["/wa/barber", META, { "x-hub-signature-256": sig("sec-barber", META) }], ["/", { ...META, entry: [{ ...META.entry[0], changes: [{ ...META.entry[0].changes[0], value: { ...META.entry[0].changes[0].value, messages: [{ ...META.entry[0].changes[0].value.messages[0], id: "wamid.contract.2" }] } }] }] }, null],
  [`/ga/barber?t=${gaPw}`, { ...GREEN, idMessage: "GA-contract-2", instanceData: { idInstance: +GA.id } }, null], ["/ga?t=ga-hook-shared", { ...GREEN, idMessage: "GA-contract-3", senderData: { chatId: "77010000008@c.us", sender: "77010000008@c.us" }, instanceData: { idInstance: 7105000009 } }, null]]) {
  const h = hd || (path === "/" ? { "x-hub-signature-256": sig("sec-shared", body) } : {});
  const ai0 = net.gemini.length, r = await go(null, "POST", path, body, h);
  ok(`правильно подписанный вебхук доходит до бота: POST ${path.replace(/t=[^&]+/, "t=<пароль>")}`, r.status === 200 && net.gemini.length > ai0, `${r.status} ИИ: ${net.gemini.length - ai0}`);
}

// проверка утечек сама работает: владелец метку видит
for (const p of ["/api/inbox/list?c=dent", "/api/inbox/leads?c=dent", "/leads?c=dent", "/api/crm/segments?c=dent"]) { const o = await shape(await go(owner, "GET", p)); ok(`владелец видит данные клиента (метка находится): ${p}`, o.body.includes(MARK), o.body.slice(0, 200)); }
// список людей сегмента и рассылка из сегмента — только тем, у кого подтверждённое согласие (31.10.2026): оно — в базе D1 (node:sqlite,
// Node 22+), поэтому эти две проверки — на отдельной копии бота с базой согласий; у основной копии базы нет (снимок одинаков на Node 20)
if (sqliteOk) {
  S.env.DB = d1With("production").db;
  await grantSnap(S.env, "dent");
  { const o = await shape(await go(owner, "GET", "/api/crm/list?c=dent&seg=all")); ok("владелец видит данные клиента (метка находится): /api/crm/list?c=dent&seg=all", o.body.includes(MARK), o.body.slice(0, 200)); }
  { // рассылка из сегмента базы: имя видно, полный номер — нет (только маской)
    const o = await shape(await go(owner, "POST", "/api/bc/check", { c: "dent", segment: "all" }));
    ok("владелец видит данные клиента (метка находится): POST /api/bc/check сегмент базы, номер маской", o.body.includes(MARK) && !o.body.includes("77010000055") && o.body.includes("+7 701 *** ** 55"), o.body.slice(0, 300));
  }
  delete S.env.DB;
}

// 7. изменяющие запросы с чужого сайта отклоняются даже с cookie владельца
for (const [method, path, body, hd] of R.filter(([m, p]) => m === "POST" && /^\/(api\/(studio|inbox|launch|bc|crm|site)\/|altegio)/.test(p))) {
  const r = await go(owner, method, path, body, { origin: "https://evil.example" });
  const id = `${method} ${path}${label(body, hd)} [owner, чужой сайт]`;
  got[id] = await shape(r);
  ok(`запрос с чужого сайта отклонён: ${id}`, r.status === 403, JSON.stringify(got[id]));
}
// 8. вход с чужого сайта не принимается
{
  const r = await go(null, "POST", "/login", `key=${OWNER_KEY}&next=%2Fstudio`, { origin: "https://evil.example" });
  got["POST /login [чужой сайт]"] = await shape(r);
  ok("вход с чужого сайта не принимается", r.status === 403 && !r.headers.get("set-cookie"), JSON.stringify(got["POST /login [чужой сайт]"]));
}
// 9. подделанная cookie не даёт входа
{
  const fake = S.browser(); fake.cookie = "aia=owner.*.9999999999999.o.forged";
  const r = await go(fake, "GET", "/api/inbox/me");
  got["GET /api/inbox/me [поддельная cookie]"] = await shape(r);
  ok("поддельная cookie → 401", r.status === 401);
}

// 10. запись с сайта включена (ключ Altegio есть — в общем Worker выше его нет, там всё /api/site/* отвечает 503): данные — no-store,
// фото мастера — картинка с кэшем на день, nosniff и vary: Origin и с Origin, и без него (ревью 22.10.2026). В снимок не идёт
{
  const was = net.altData, data = winchesterAlt();
  net.altData = () => data;
  try {
    const W2 = mk({ ALTEGIO_PARTNER: "partner-key", ALTEGIO_LOC_WINCHESTER: "7990" }), SITE = "https://winchester.kz";
    const call = (path, origin) => W2.call(path, { headers: { "cf-connecting-ip": ip(), ...(origin ? { origin } : {}) } });
    const cat = await call("/api/site/winchester/catalog", SITE), cj = await cat.clone().json();
    ok("сайт: каталог 200 без кэша", cat.status === 200 && cat.headers.get("cache-control") === "no-store", `${cat.status} ${cat.headers.get("cache-control")}`);
    const photo = (cj.staff || []).find(m => m.photo);
    ok("сайт: у мастера есть фото (заглушка)", !!photo, JSON.stringify((cj.staff || []).map(m => m.photo)));
    for (const origin of [SITE, null]) {
      const r = await call(photo.photo, origin), o = await shape(r), vary = r.headers.get("vary") || "";
      ok(`сайт: фото мастера ${origin ? "с Origin" : "без Origin"} — картинка с кэшем на день, nosniff, vary: Origin`, o.status === 200 && /^image\//.test(o.type) && o.cache === "public, max-age=86400"
        && r.headers.get("x-content-type-options") === "nosniff" && /\bOrigin\b/.test(vary) && (origin ? o.cors === origin : !o.cors), JSON.stringify({ ...o, vary }));
    }
    const none = await shape(await call("/api/site/winchester/photo/999", SITE));
    ok("сайт: нет фото — JSON без кэша", none.status === 404 && none.type === "application/json" && none.cache === "no-store", JSON.stringify(none));
  } finally { net.altData = was; }
}

// снимок
const snap = existsSync(SNAP) ? JSON.parse(readFileSync(SNAP, "utf8")) : null;
if (process.env.UPDATE === "1") {
  writeFileSync(SNAP, JSON.stringify(got, null, 1) + "\n");
  console.log(`Маршруты: снимок ${snap ? "обновлён" : "создан"} (${Object.keys(got).length} ответов) — проверьте разницу в git`);
} else if (!snap) ok("снимок test/contract/routes.snap.json есть (создать: UPDATE=1)", false);
else {
  const ids = new Set([...Object.keys(snap), ...Object.keys(got)]);
  for (const id of ids) ok(`снимок: ${id}`, JSON.stringify(snap[id]) === JSON.stringify(got[id]), `было ${JSON.stringify(snap[id])}, стало ${JSON.stringify(got[id])}`);
}
console.log(`Маршруты (${R.length} адресов × 3 роли): прошло ${T.pass}, не прошло ${T.fail}`);
process.exit(T.fail ? 1 : 0);
