// Переходник Pushon (технический провайдер Meta, 15.11.2026): номер Winchester подключён к Cloud API через кабинет Pushon,
// для бота это официальный канал Meta («wa»). Формат API и вебхука — по документации pushon365.kz/apipushon; вживую не проверено.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { sendTemplate } from "../../src/services/channels/templates.js";
import { poToMeta } from "../../src/services/channels/pushon.js";
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
