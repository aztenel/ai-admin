// Переходник Wazzapo (партнёр Meta, 15.10.2026): номер клиента в режиме «сосуществование», для бота это официальный канал Meta.
// Проверяется на заглушках: формат вебхука и отправки взят из документации Wazzapo (wazzapo.kz/docs), вживую ещё не проверено.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { net, mk } from "../harness.mjs";
import { sendTemplate } from "../../src/services/channels/templates.js";
import { wzToMeta } from "../../src/services/channels/wazzapo.js";

const ENV = { WA_VIA_BARBER: "wazzapo", WA_TOKEN_BARBER: "wz_live_test", APP_SECRET_BARBER: "hook-secret", PHONE_NUMBER_ID_BARBER: "103799815708451" };
const sign = (body, secret = "hook-secret") => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
let n = 0;
function hook(s, event, data, { secret, delivery } = {}) {
  const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: { channel: "whatsapp", phone_number_id: "103799815708451", ...data } });
  return s.call("/wz/barber", { method: "POST", body, headers: { "content-type": "application/json", "x-wazzapo-event": event, "x-wazzapo-delivery-id": delivery || "dlv-" + (++n), "x-wazzapo-signature": sign(body, secret) } });
}
const incoming = (s, from, text, o) => hook(s, "message.incoming", { contact: { id: "c1", phone: from, name: "Айгерим" }, message: { id: "wamid.in.wz" + (++n), from, type: "text", text, timestamp: String(Math.floor(Date.now() / 1000)) } }, o);
const sends = () => net.wz.filter(r => r.path === "/messages/send");

test("входящее сообщение → бот отвечает через Wazzapo: ключ в заголовке, номер, получатель", async () => {
  net.reset(); net.ai = ["Здравствуйте! Подобрать вам удобное время?"];
  const s = mk(ENV);
  const r = await incoming(s, "77051112233", "Сколько стоит стрижка?");
  assert.equal(r.status, 200);
  const out = sends();
  assert.ok(out.length >= 1, "ответ не ушёл: " + JSON.stringify(net.wz));
  assert.ok(out.every(x => x.key === "wz_live_test" && x.body.phone_number_id === "103799815708451" && x.body.to === "77051112233" && x.body.type === "text"), JSON.stringify(out));
  assert.ok(out.some(x => /удобное время/.test(x.body.text.body)), JSON.stringify(out));
  assert.equal(net.graph.length, 0, "в Graph API напрямую ничего не уходит");
  const h = s.hist("wa", "barber", "77051112233");
  assert.ok(h && h.turns.some(t => t.role === "user" && /стрижка/.test(t.text)), "чат лежит там же, где чаты Meta (пульт его видит)");
});

test("без верной подписи, без секрета и без WA_VIA — сообщение не принимается", async () => {
  net.reset();
  const s = mk(ENV);
  assert.equal((await incoming(s, "77051112233", "привет", { secret: "чужой" })).status, 403);
  assert.equal((await mk({ ...ENV, APP_SECRET_BARBER: "" }).call("/wz/barber", { method: "POST", body: "{}", headers: { "x-wazzapo-signature": sign("{}") } })).status, 403);
  assert.equal((await mk({ ...ENV, WA_VIA_BARBER: "" }).call("/wz/barber", { method: "POST", body: "{}", headers: { "x-wazzapo-signature": sign("{}") } })).status, 404);
  assert.equal((await s.call("/wz/nosuchbot", { method: "POST", body: "{}" })).status, 404);
  assert.equal(sends().length, 0);
});

test("повтор доставки (тот же X-Wazzapo-Delivery-Id) обрабатывается один раз", async () => {
  net.reset(); net.ai = ["Здравствуйте!"];
  const s = mk(ENV);
  const body = JSON.stringify({ event: "message.incoming", data: { channel: "whatsapp", phone_number_id: "103799815708451", contact: { phone: "77051112244" }, message: { id: "wamid.dup1", from: "77051112244", type: "text", text: "Здравствуйте" } } });
  const h = { "content-type": "application/json", "x-wazzapo-delivery-id": "dlv-same", "x-wazzapo-signature": sign(body) };
  await s.call("/wz/barber", { method: "POST", body, headers: h });
  const first = sends().length;
  await s.call("/wz/barber", { method: "POST", body, headers: h });
  assert.ok(first >= 1);
  assert.equal(sends().length, first);
});

test("ответ человека с телефона (message.outgoing) → в чат как ответ администратора, бот замолкает", async () => {
  net.reset(); net.ai = ["Здравствуйте! Чем помочь?"];
  const s = mk(ENV);
  await incoming(s, "77051112255", "Здравствуйте");
  await hook(s, "message.outgoing", { sender: { type: "user" }, contact: { phone: "77051112255" }, message: { id: "wamid.phone1", to: "77051112255", type: "text", text: "Это Тони, я сам вас запишу" } });
  const h = s.hist("wa", "barber", "77051112255");
  assert.ok(h.turns.some(t => t.by === "admin" && /Тони/.test(t.text)), JSON.stringify(h.turns));
  assert.ok(h.profile.pausedUntil > Date.now(), "бот на паузе");
  const before = sends().length;
  net.ai = ["Бот не должен отвечать"];
  await incoming(s, "77051112255", "Хорошо, жду");
  assert.equal(sends().length, before, "пока человек ведёт чат, бот молчит");
});

test("свои сообщения бота (message.outgoing с id отправленного) не считаются ответом человека", async () => {
  net.reset(); net.ai = ["Здравствуйте!"];
  const s = mk(ENV);
  await incoming(s, "77051112266", "Здравствуйте");
  assert.ok(sends().length >= 1);
  const id = "wzm-" + net.wz.length; // как отвечает заглушка: message_id = wzm-<номер запроса>; sender.type «agent» нарочно, чтобы сработала именно отметка id
  await hook(s, "message.outgoing", { sender: { type: "agent" }, contact: { phone: "77051112266" }, message: { id, to: "77051112266", type: "text", text: "Здравствуйте!" } });
  await hook(s, "message.outgoing", { sender: { type: "api" }, contact: { phone: "77051112266" }, message: { id: "other-id", to: "77051112266", type: "text", text: "рассылка" } });
  const h = s.hist("wa", "barber", "77051112266");
  assert.ok(!(h.profile.pausedUntil > Date.now()), "бот не встал на паузу из-за своего же сообщения");
  assert.ok(!h.turns.some(t => t.by === "admin"), JSON.stringify(h.turns));
});

test("шаблон рассылки уходит через Wazzapo в их формате", async () => {
  net.reset();
  const s = mk(ENV);
  const r = await sendTemplate(s.env, "77051112277", { tpl: "promo_october", lang: "ru", params: ["{имя}"] }, "Айгерим", { client: "barber", pnid: "103799815708451", quiet: true });
  assert.equal(r.ok, true);
  const x = sends()[0];
  assert.equal(x.key, "wz_live_test");
  assert.deepEqual(x.body, { phone_number_id: "103799815708451", to: "77051112277", type: "template", template: { name: "promo_october", language: { code: "ru" }, components: [{ type: "body", parameters: [{ type: "text", text: "Айгерим" }] }] } });
});

test("ошибка Wazzapo при отправке → администратор получает сигнал в Telegram", async () => {
  net.reset(); net.ai = ["Здравствуйте!"];
  net.wzReply = rec => rec.path === "/messages/send" ? new Response(JSON.stringify({ error: { code: 502, message: "Meta rejected" } }), { status: 502 }) : null;
  const s = mk(ENV);
  await incoming(s, "77051112288", "Здравствуйте");
  assert.ok(net.tg.some(t => /не доходят/.test(t.text || "") && /Wazzapo/.test(t.text || "")), JSON.stringify(net.tg.map(t => t.text)));
});

test("события не из WhatsApp и служебные — боту не передаются", async () => {
  const env = { KV: { get: async () => null, put: async () => {} } };
  assert.equal(await wzToMeta(/** @type {any} */ (env), { event: "message.incoming", data: { channel: "telegram", message: { id: "1", from: "1", text: "hi" } } }), null);
  assert.equal(await wzToMeta(/** @type {any} */ (env), { event: "deal.closed", data: {} }), null);
  const m = await wzToMeta(/** @type {any} */ (env), { event: "message.incoming", data: { channel: "whatsapp", phone_number_id: "p1", contact: { phone: "+7 705 111 22 33", name: "А" }, message: { id: "m1", from: "77051112233", type: "image", media_id: "md1", caption: "вот фото" } } });
  const v = m.entry[0].changes[0].value;
  assert.equal(v.metadata.phone_number_id, "p1");
  assert.deepEqual(v.messages[0].image, { id: "md1", mime_type: "", caption: "вот фото" });
});
