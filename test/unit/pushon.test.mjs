// Переходник Pushon (технический провайдер Meta, 15.11.2026): номер Winchester подключён к Cloud API через кабинет Pushon,
// для бота это официальный канал Meta («wa»). Формат API и вебхука — по документации pushon365.kz/apipushon; вживую не проверено.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { sendTemplate } from "../../src/services/channels/templates.js";
import { poToMeta } from "../../src/services/channels/pushon.js";
import { waKind } from "../../src/services/reminders/watpl.js";
import { bcParam } from "../../src/services/integrations/meta/templates.js";

const ENV = { WA_VIA_BARBER: "pushon", WA_TOKEN_BARBER: "po_key_test", APP_SECRET_BARBER: "hook-pass-123", PHONE_NUMBER_ID_BARBER: "chan-1" };
let n = 0;
const hook = (s, body, t = "hook-pass-123") => s.call("/po/barber" + (t === null ? "" : "?t=" + encodeURIComponent(t)), { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const incoming = (s, from, text) => hook(s, { type: "message", direction: "inbound", timestamp: new Date().toISOString(), message: { id: "wamid.in.po" + (++n), from: "+" + from, channelId: "chan-1", payload_type: "text", text } });
const sends = () => net.po.filter(r => r.path === "/send-session-message");

test("входящее → бот отвечает через Pushon: ключ в заголовке, channelId, номер с «+»; ответ вебхуку — 200 с пустым телом", async () => {
  net.reset(); net.ai = ["Здравствуйте! Подобрать вам удобное время?"];
  const s = mk(ENV);
  const r = await incoming(s, "77051112233", "Сколько стоит стрижка?");
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "", "Pushon ждёт пустое тело");
  const out = sends();
  assert.ok(out.length >= 1, "ответ не ушёл: " + JSON.stringify(net.po));
  assert.ok(out.every(x => x.key === "po_key_test" && x.body.channelId === "chan-1" && x.body.toPhone === "+77051112233"), JSON.stringify(out));
  assert.ok(out.some(x => /удобное время/.test(x.body.text)), JSON.stringify(out));
  assert.equal(net.graph.length, 0, "в Graph API напрямую ничего не уходит");
  const h = s.hist("wa", "barber", "77051112233");
  assert.ok(h && h.turns.some(t => t.role === "user" && /стрижка/.test(t.text)), "чат лежит там же, где чаты Meta (пульт его видит)");
});

test("без верного пароля, без пароля у клиента и без WA_VIA — событие не принимается", async () => {
  net.reset();
  const s = mk(ENV);
  assert.equal((await hook(s, { type: "message" }, "чужой")).status, 403);
  assert.equal((await hook(s, { type: "message" }, null)).status, 403);
  assert.equal((await hook(mk({ ...ENV, APP_SECRET_BARBER: "" }), { type: "message" })).status, 403);
  assert.equal((await hook(mk({ ...ENV, WA_VIA_BARBER: "" }), { type: "message" })).status, 404);
  assert.equal(sends().length, 0);
});

test("повтор доставки того же сообщения обрабатывается один раз", async () => {
  net.reset(); net.ai = ["Здравствуйте!"];
  const s = mk(ENV);
  const body = { type: "message", direction: "inbound", message: { id: "wamid.dup.po", from: "+77051112244", channelId: "chan-1", payload_type: "text", text: "Здравствуйте" } };
  await hook(s, body);
  const first = sends().length;
  await hook(s, body);
  assert.ok(first >= 1);
  assert.equal(sends().length, first);
});

test("«стоп» клиента через Pushon записывается как отказ от рассылок", async () => {
  net.reset(); net.ai = ["Хорошо, больше не будем писать."];
  const s = mk(ENV);
  await incoming(s, "77051112266", "стоп");
  if (s.settle) await s.settle();
  assert.ok(await s.env.KV.get("optout:barber:77051112266"), "отказ от рассылок не записан");
});

test("статусы Pushon → формат Meta: failed с ошибкой, delivered/read без; событие чужого канала — мимо", () => {
  const f = poToMeta({ type: "status", messageId: "wamid.x", to: "+77051112233", channelId: "chan-1", status: "failed", error: { code: 131026, message: "номер не в WhatsApp" } }, "chan-1");
  const st = f && f.entry[0].changes[0].value.statuses[0];
  assert.equal(st.status, "failed"); assert.equal(st.recipient_id, "77051112233"); assert.equal(st.errors[0].code, 131026);
  const d = poToMeta({ type: "status", messageId: "wamid.y", to: "+7705", channelId: "chan-1", status: "delivered", error: null }, "chan-1");
  assert.equal(d && d.entry[0].changes[0].value.statuses[0].status, "delivered");
  assert.equal(poToMeta({ type: "status", messageId: "wamid.z", channelId: "chan-2", status: "read" }, "chan-1"), null);
  assert.equal(poToMeta({ type: "message", direction: "outbound", message: { id: "a", from: "+7" } }, "chan-1"), null);
  const btn = poToMeta({ type: "message", direction: "inbound", message: { id: "b", from: "+77051112233", channelId: "chan-1", payload_type: "button", text: "Записаться" } }, "chan-1");
  assert.equal(btn && btn.entry[0].changes[0].value.messages[0].text.body, "Записаться", "нажатие кнопки — как текст клиента");
});

test("рассылка шаблоном через Pushon: имя, мастер и дни после визита подставляются, номер сообщения возвращается", async () => {
  net.reset();
  const route = { client: "barber" };
  const b = { tpl: "pora_obnovit_p", lang: "ru", params: ["{имя}", "{мастер}", "{дней}"] };
  const r = await sendTemplate(ENV, "77051112233", b, "Азамат", route, { staff: "Тони", svc: "Стрижка", days: 35 });
  assert.equal(r.ok, true); assert.ok(String(r.id).startsWith("wamid.po."), JSON.stringify(r));
  const sent = net.po.find(x => x.path === "/send-template-message");
  assert.equal(sent.body.templateName, "pora_obnovit_p"); assert.equal(sent.body.templateLanguage, "ru"); assert.equal(sent.body.channelId, "chan-1");
  assert.deepEqual(sent.body.components[0].parameters.map(p => p.text), ["Азамат", "Тони", "35 дней"]);
});

test("ошибки Pushon → коды Meta: 24 часа, предел, ключ, шаблон", async () => {
  net.reset();
  const route = { client: "barber" }, b = { tpl: "x", lang: "ru", params: [] };
  const cases = [[{ status: "error", code: "SESSION_WINDOW_CLOSED" }, 400, 131047], [{ status: "error", code: "RATE_LIMITED" }, 429, 130429], [{ status: "error", code: "UNAUTHORIZED" }, 401, 190], [{ status: "error", code: "NOT_FOUND" }, 404, 132001]];
  for (const [j, status, code] of cases) {
    net.poReply = () => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
    const r = await sendTemplate(ENV, "77051112233", b, "", route);
    assert.equal(r.ok, false); assert.equal(r.code, code, JSON.stringify(j));
  }
});

test("черновик (STAGE=preview) через Pushon клиентам не пишет", async () => {
  net.reset();
  const r = await sendTemplate({ ...ENV, STAGE: "preview" }, "77051112233", { tpl: "x", lang: "ru", params: [] }, "", { client: "barber" });
  assert.equal(r.ok, false);
  assert.equal(net.po.length, 0);
});

test("подстановки шаблона: слово после числа дней и запасные значения", () => {
  assert.equal(bcParam("{дней}", "", "", { days: 21 }), "21 день");
  assert.equal(bcParam("{дней}", "", "", { days: 33 }), "33 дня");
  assert.equal(bcParam("{дней}", "", "", { days: 12 }), "12 дней");
  assert.equal(bcParam("{мастер}", "", "", {}), "ваш мастер");
  assert.equal(bcParam("{имя}", "", "друг"), "друг");
});

test("диагностика вебхука (21.11.2026: вебхук подключили, а в пульте пусто): последнее событие — пароль, вид, разобрано ли; без номеров и текстов", async () => {
  net.reset();
  const s = mk(ENV);
  assert.equal((await hook(s, { type: "message" }, "wrong")).status, 403);
  let L = s.kv.json("pol:barber");
  assert.equal(L.bad, 1); assert.match(L.why, /не совпал/);
  await hook(s, { event: "incoming_message", data: { from: "+77000000001", text: "привет" } });
  L = s.kv.json("pol:barber");
  assert.equal(L.ok, false); assert.match(L.why, /неизвестный вид события/); assert.equal(L.keys, "event,data");
  assert.ok(!JSON.stringify(L).includes("77000000001") && !JSON.stringify(L).includes("привет"), "без номера и текста");
  await incoming(s, "77000000002", "тест");
  L = s.kv.json("pol:barber");
  assert.equal(L.ok, true); assert.equal(L.type, "message"); assert.equal(L.why, "");
});

test("настоящий формат вебхука Pushon (живая проверка 21.11.2026): message.incoming с contactPhone и contactName — в пульт; повтор события — один раз; исходящие — мимо; статус — по externalRef", async () => {
  net.reset();
  const s = mk(ENV);
  const ev = (id, type, msg, x = {}) => ({ id, type, version: 1, accountId: "acc-1", occurredAt: new Date().toISOString(), contactName: "Азамат", channelPhone: "77771148659", contactPhone: "77000000099", message: msg, ...x });
  const inc = ev("ev-1", "message.incoming", { id: "po-msg-1", text: "Здравствуйте, хочу записаться", replyTo: null, direction: "inbound", externalRef: "wamid.real.1", messageType: "text" });
  assert.equal((await hook(s, inc)).status, 200);
  assert.equal((await hook(s, inc)).status, 200, "повтор того же события");
  const h = s.hist("wa", "barber", "77000000099");
  assert.ok(h, "чат появился");
  assert.equal(h.turns.filter(t => t.role === "user" && /хочу записаться/.test(t.text)).length, 1, JSON.stringify(h.turns));
  assert.equal(s.kv.json("pol:barber").ok, true);
  await hook(s, ev("ev-2", "message.outgoing", { id: "po-msg-2", text: "ответ из кабинета", direction: "outbound", externalRef: "wamid.out.2", messageType: "text" }));
  assert.match(s.kv.json("pol:barber").why, /исходящее/);
  assert.equal(s.hist("wa", "barber", "77000000099").turns.filter(t => /ответ из кабинета/.test(t.text)).length, 0);
  const meta = poToMeta(ev("ev-3", "message.status", { id: "po-msg-3", externalRef: "wamid.sent.3" }, { status: "delivered" }), "chan-1");
  assert.deepEqual([meta.entry[0].changes[0].value.statuses[0].id, meta.entry[0].changes[0].value.statuses[0].status], ["wamid.sent.3", "delivered"]);
  const fail = poToMeta(ev("ev-4", "message.failed", { id: "po-msg-4", externalRef: "wamid.sent.4" }, { error: { code: 131049, message: "healthy ecosystem" } }), "chan-1");
  assert.deepEqual(fail.entry[0].changes[0].value.statuses[0].errors[0].code, 131049);
});

test("файл от клиента (22.11.2026: фото не дошло до пульта): запоминается форма события — поля и хост ссылки, без номеров и текста", async () => {
  net.reset();
  const s = mk(ENV);
  await hook(s, { id: "ev-f1", type: "message.incoming", contactPhone: "77051112233", contactName: "Данияр", channelPhone: "77771148659", occurredAt: new Date().toISOString(),
    message: { id: "m-1", text: "секретная подпись", messageType: "image", externalRef: "wamid.X1", media: { url: "https://files.pushon.example/abc.jpg?sig=1", mime: "image/jpeg" } } });
  const F = s.kv.json("polm:barber");
  assert.equal(F.kind, "image");
  const j = JSON.stringify(F);
  assert.match(j, /ссылка files\.pushon\.example/);
  assert.ok(!/77051112233|Данияр|секретная|abc\.jpg|sig=/.test(j), j);
  await hook(s, { id: "ev-t1", type: "message.incoming", contactPhone: "77051112233", message: { id: "m-2", text: "ок", messageType: "text" } });
  assert.equal(s.kv.json("polm:barber").kind, "image", "текст файл не затирает");
});

test("фото клиента через Pushon (22.11.2026, ответ поддержки: ссылка на скачивание — в text): в переписке файл со ссылкой, подписи-ссылки нет", async () => {
  net.reset();
  const s = mk(ENV);
  const r = await hook(s, { id: "ev-img1", type: "message.incoming", contactPhone: "77051112244", contactName: "Данияр", occurredAt: new Date().toISOString(),
    message: { id: "m-img1", text: "https://media.pushon365.ru/files/abc.jpg", messageType: "image", externalRef: "wamid.IMG1" } });
  assert.equal(r.status, 200);
  const h = s.hist("wa", "barber", "77051112244");
  const t = h && h.turns.find(x => x.m && x.m.k);
  assert.ok(t, JSON.stringify(h && h.turns));
  assert.equal(t.m.url, "https://media.pushon365.ru/files/abc.jpg");
  assert.ok(!/https:/.test(t.text), "ссылка не попадает в текст сообщения");
});

test("фото клиента — настоящий формат 22.11.2026: message.media.url (filemanager.gupshup.io), text null", async () => {
  net.reset();
  const s = mk(ENV);
  await hook(s, { id: "ev-img2", type: "message.incoming", contactPhone: "77051112255", occurredAt: new Date().toISOString(),
    message: { id: "m-img2", text: null, media: { url: "https://filemanager.gupshup.io/wa/abc/file?x=1", caption: "мой фейд", filename: null, mimeType: "image/jpeg" }, replyTo: null, direction: "in", externalRef: null, messageType: "image" } });
  const t = s.hist("wa", "barber", "77051112255").turns.find(x => x.m && x.m.k);
  assert.equal(t.m.url, "https://filemanager.gupshup.io/wa/abc/file?x=1");
  assert.equal(t.m.mime, "image/jpeg");
});

test("шапка шаблона по ссылке (23.11.2026): .mp4 — видео, .pdf — документ, иначе картинка", async () => {
  const { headerMedia } = await import("../../src/services/integrations/meta/templates.js");
  assert.deepEqual(headerMedia("https://winchester.kz/promo.mp4?v=2"), { type: "header", parameters: [{ type: "video", video: { link: "https://winchester.kz/promo.mp4?v=2" } }] });
  assert.equal(headerMedia("https://x.kz/a.pdf").parameters[0].type, "document");
  assert.equal(headerMedia("https://x.kz/a.jpg").parameters[0].type, "image");
});

// отправка файлов из пульта через Pushon (коллекция методов Pushon, 25.11.2026): send-session-message с mediaUrl — Pushon скачивает
// файл по нашей ссылке /po/f/<номер> (живёт час); ответ цитатой — contextMessageId. Вживую не проверено.
import { poMediaOf } from "../../src/services/inbox/send.js";
test("файлы, голосовое и цитата из пульта через Pushon: ссылка на файл у нас, тип WhatsApp, подпись, contextMessageId; без окна 24 часа — отказ", async () => {
  net.reset();
  const s = mk({ WA_VIA_WINCHESTER: "pushon", WA_TOKEN_WINCHESTER: "po_key_w", APP_SECRET_WINCHESTER: "hook-w-123", PHONE_NUMBER_ID_WINCHESTER: "chan-w" });
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" });
  const from = "77051230001";
  await s.call("/po/winchester?t=hook-w-123", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "message.incoming", id: "ev-f-1", contactPhone: "+" + from, contactName: "Арман", message: { id: "msg-in-1", text: "Пришлите прайс", messageType: "text" } }) });
  if (s.settle) await s.settle();
  let c = await (await b.go(`/api/inbox/chat?c=winchester&ch=wa&id=${from}`)).json();
  assert.equal(c.canFiles, true, JSON.stringify({ canFiles: c.canFiles, sendOff: c.sendOff }));
  assert.equal(c.canQuote, true); assert.equal(c.canDelete, false, "«Удалить у всех» у Pushon нет");
  net.po.length = 0;
  const fd = new FormData();
  fd.set("file", new Blob([Uint8Array.from([0x25, 0x50, 0x44, 0x46, 1, 2, 3])], { type: "application/pdf" }), "Прайс.pdf");
  fd.set("caption", "Вот прайс"); fd.set("rid", "rid-po-file-1");
  const inMid = (c.turns.find(t => t.r === "u") || {}).mid;
  assert.ok(inMid, "у сообщения клиента — номер Pushon (на него можно ответить)");
  fd.set("quote", inMid);
  const r = await b.go(`/api/inbox/send-file?c=winchester&ch=wa&id=${from}`, { method: "POST", body: fd });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  const x = net.po.find(q => q.path === "/send-session-message");
  assert.ok(x, "запрос к Pushon не ушёл");
  assert.equal(x.body.mediaType, "document"); assert.equal(x.body.mimeType, "application/pdf"); assert.equal(x.body.filename, "Прайс.pdf");
  assert.equal(x.body.caption, "Вот прайс"); assert.equal(x.body.text, undefined, "text и mediaUrl вместе нельзя");
  if (inMid) assert.equal(x.body.contextMessageId, inMid);
  const m = /\/po\/f\/([0-9a-f]{32})$/.exec(x.body.mediaUrl);
  assert.ok(m, x.body.mediaUrl);
  const got = await s.call("/po/f/" + m[1]);
  assert.equal(got.status, 200); assert.equal(got.headers.get("content-type"), "application/pdf"); assert.equal(got.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await got.arrayBuffer()).byteLength, 7);
  assert.equal((await s.call("/po/f/" + "0".repeat(32))).status, 404, "чужой номер — нет файла");
  const last = j.chat.turns[j.chat.turns.length - 1];
  assert.equal(last.m && last.m.k, "document"); assert.ok(last.mid, "номер сообщения Pushon запомнен");
  // ответ текстом цитатой
  if (inMid) {
    net.po.length = 0;
    const t = await b.go("/api/inbox/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ c: "winchester", ch: "wa", id: from, text: "Да", quote: inMid, rid: "rid-po-q-1" }) });
    assert.equal(t.status, 200);
    assert.equal(net.po[0].body.contextMessageId, inMid);
  }
  // типы WhatsApp: голосовое Ogg — аудио; webp и mov — документом; большое фото — документом
  assert.deepEqual(poMediaOf("audio", "audio/ogg", 3000), { type: "audio", mime: "audio/ogg" });
  assert.equal(poMediaOf("image", "image/webp", 100).type, "document");
  assert.equal(poMediaOf("video", "video/quicktime", 100).type, "document");
  assert.equal(poMediaOf("image", "image/jpeg", 6 * 1024 * 1024).type, "document");
  assert.equal(poMediaOf("image", "image/jpeg", 100).type, "image");
  // Pushon отказал — «не принял», ничего не помечено как ушедшее
  net.poReply = rec => rec.path === "/send-session-message" ? new Response(JSON.stringify({ error: "SESSION_WINDOW_CLOSED", code: "SESSION_WINDOW_CLOSED" }), { status: 400, headers: { "content-type": "application/json" } }) : null;
  const fd2 = new FormData(); fd2.set("file", new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 1])], { type: "image/jpeg" }), "a.jpg"); fd2.set("rid", "rid-po-file-2");
  const r2 = await b.go(`/api/inbox/send-file?c=winchester&ch=wa&id=${from}`, { method: "POST", body: fd2 });
  assert.equal(r2.status, 409); assert.match((await r2.json()).error, /Pushon не принял файл/);
});

test("номер телефона в сообщении клиента виден в пульте, а в тексте для ИИ скрыт (26.11.2026: «[телефон указан]» вместо номера для оплаты)", async () => {
  net.reset();
  const s = mk({ WA_VIA_WINCHESTER: "pushon", WA_TOKEN_WINCHESTER: "po_key_w", APP_SECRET_WINCHESTER: "hook-w-123", PHONE_NUMBER_ID_WINCHESTER: "chan-w" });
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" });
  const from = "77051230099";
  await s.call("/po/winchester?t=hook-w-123", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "message.incoming", id: "ev-ph-1", contactPhone: "+" + from, contactName: "Адам", message: { id: "msg-ph-1", text: "оплата на номер 8 701 234 56 78", messageType: "text" } }) });
  if (s.settle) await s.settle();
  const h = s.hist("wa", "winchester", from);
  const t = h.turns.find(x => x.role === "user");
  assert.match(t.text, /\[телефон указан\]/, "текст для ИИ — без номера");
  const c = await (await b.go(`/api/inbox/chat?c=winchester&ch=wa&id=${from}`)).json();
  const u = c.turns.find(x => x.r === "u");
  assert.match(u.x, /8 701 234 56 78/, "в пульте номер виден: " + u.x);
});

test("галочки и ошибки Pushon (проверка 26.11.2026): статусы ответа из пульта — доставлено, прочитано; не доставлено — «ответ не дошёл»; 5xx — «неизвестно», без повтора; 400 сервисного — не пауза всех", async () => {
  net.reset();
  const E = { WA_VIA_WINCHESTER: "pushon", WA_TOKEN_WINCHESTER: "po_key_w", APP_SECRET_WINCHESTER: "hook-w-123", PHONE_NUMBER_ID_WINCHESTER: "chan-w" };
  const s = mk(E);
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" });
  const from = "77051230077", hk = (t) => s.call("/po/winchester?t=hook-w-123", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(t) });
  await hk({ type: "message.incoming", id: "ev-st-1", contactPhone: "+" + from, contactName: "Ерлан", message: { id: "po-in-1", text: "Здравствуйте", messageType: "text", externalRef: "wamid.in.1" } });
  if (s.settle) await s.settle();
  const send = (text, rid) => b.go("/api/inbox/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ c: "winchester", ch: "wa", id: from, text, rid }) });
  assert.equal((await send("Добрый день!", "rid-st-1")).status, 200);
  const mid = s.hist("wa", "winchester", from).turns.at(-1).mid;
  assert.ok(mid, "номер сообщения Pushon запомнен");
  await hk({ type: "message.delivered", id: "ev-st-2", contactPhone: "+" + from, message: { id: mid, externalRef: "wamid.out.1" } });
  await hk({ type: "message.read", id: "ev-st-3", contactPhone: "+" + from, message: { id: mid, externalRef: "wamid.out.1" } });
  if (s.settle) await s.settle();
  assert.equal(s.hist("wa", "winchester", from).turns.at(-1).st, "read", "две синие галочки");
  // второе сообщение не доставлено
  assert.equal((await send("Ещё вопрос?", "rid-st-2")).status, 200);
  const mid2 = s.hist("wa", "winchester", from).turns.at(-1).mid;
  await hk({ type: "message.failed", id: "ev-st-4", contactPhone: "+" + from, message: { id: mid2 }, error: { code: 131049, message: "healthy ecosystem" } });
  if (s.settle) await s.settle();
  const h = s.hist("wa", "winchester", from);
  assert.equal(h.turns.at(-1).st, "failed"); assert.equal(h.profile.need.why, "send", "чат — в «Нужен ответ: ответ не дошёл»");
  // 5xx Pushon: «неизвестно», «Повторить» с тем же rid второй раз не шлёт
  net.poReply = rec => rec.path === "/send-session-message" ? new Response(JSON.stringify({ error: "SENDING_ERROR", details: "queued" }), { status: 500, headers: { "content-type": "application/json" } }) : null;
  const r5 = await (await send("Третье", "rid-st-5")).json();
  assert.equal(r5.ok, true); assert.ok(r5.warn, "предупреждение «не знаем, ушло ли»");
  const n = net.po.filter(x => x.path === "/send-session-message").length;
  await send("Третье", "rid-st-5");
  assert.equal(net.po.filter(x => x.path === "/send-session-message").length, n, "повтор не отправляет второй раз");
  // 400 VALIDATION_ERROR — только этот клиент
  assert.equal(waKind({ ok: false, status: 400, code: 100, po: "VALIDATION_ERROR" }), "fail");
  assert.equal(waKind({ ok: false, status: 402, code: 402, po: "CHANNEL_STOPPED" }), "stop");
});
