// Push на входящие (ТЗ v2.0 §3, §11 п. 1): клиент ответил — один push; «спасибо» и реакция — без push; повтор вебхука — без второго;
// ответ на напоминание — свой вид; ответственному — только на его устройство; недоставленное наше сообщение — push «не доставлено».
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, gaPass } from "../harness.mjs";
import { uaKeys, decrypt } from "./webpush-ua.mjs";

const INST = { id: "7105000077", token: "ga-tok-w" };
const ENV = { GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
let n = 0;
const device = () => { const ua = uaKeys(); return { ua, sub: { endpoint: "https://fcm.googleapis.com/fcm/send/in" + (++n) + "-" + Date.now(), keys: { p256dh: ua.p256dh, auth: ua.auth } } }; };
const login = async s => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" }); return b; };
const got = d => net.push.filter(r => r.url === d.sub.endpoint).map(r => JSON.parse(decrypt(d.ua, Buffer.from(r.body))));
const hook = (s, body) => s.call(`/ga/winchester?t=${gaPass("winchester", INST)}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ instanceData: { idInstance: +INST.id, wid: "77000000077@c.us" }, timestamp: Math.floor(Date.now() / 1000), ...body }) });

test("клиент написал — push без текста на экран блокировки; «спасибо», реакция и повтор вебхука — без push; ответ на напоминание — свой вид", async () => {
  net.reset();
  const s = mk(ENV), b = await login(s), a = device(), from = "77000000401";
  assert.equal((await b.post("/api/push/subscribe", { c: "winchester", sub: a.sub, op: "Айгерим" })).status, 200);
  await s.gaText("winchester", INST, from, "Здравствуйте, можно записаться на завтра?", { idMessage: "IN-P-1" });
  await s.settle?.();
  let msgs = got(a);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].b, /второй номер/); assert.ok(!/записаться|77000000401/.test(msgs[0].t + msgs[0].b), "на экране — без текста и номера (адрес чата внутри уведомления зашифрован и не показывается)");
  assert.match(msgs[0].u, /#\/inbox\/ga%3A77000000401$/);
  await s.gaText("winchester", INST, from, "Здравствуйте, можно записаться на завтра?", { idMessage: "IN-P-1" }); // повтор вебхука
  await hook(s, { typeWebhook: "incomingMessageReceived", idMessage: "IN-P-R", senderData: { chatId: from + "@c.us" }, messageData: { typeMessage: "reactionMessage", extendedTextMessageData: { text: "👍" }, quotedMessage: { stanzaId: "x" } } });
  assert.equal(got(a).length, 1, "повтор и реакция — без push");
  await b.post("/api/inbox/send", { c: "winchester", ch: "ga", id: from, text: "Да, на 15:00", op: "Айгерим" });
  await s.gaText("winchester", INST, from, "Спасибо!", { idMessage: "IN-P-2" });
  assert.equal(got(a).length, 1, "«спасибо» после ответа — без push");
  // ответ на напоминание
  const from2 = "77000000402";
  await s.kv.api.put(`h:ga:winchester:${from2}`, JSON.stringify({ n: 1, turns: [{ role: "model", text: "Напоминаем: завтра в 15:00", t: Date.now() - 3600e3, rm: "d1", mid: "RM-2" }], profile: {} }));
  await s.gaText("winchester", INST, from2, "А можно на 17:00?", { idMessage: "IN-P-3" });
  msgs = got(a);
  assert.equal(msgs.length, 2); assert.equal(msgs[1].k, "campaign_reply");
});

test("ответственному — только на его устройство; наше сообщение не доставлено — push «не доставлено»", async () => {
  net.reset();
  const s = mk(ENV), b = await login(s), aig = device(), erz = device(), from = "77000000403";
  await b.post("/api/push/subscribe", { c: "winchester", sub: aig.sub, op: "Айгерим" });
  await b.post("/api/push/subscribe", { c: "winchester", sub: erz.sub, op: "Ержан" });
  await s.gaText("winchester", INST, from, "Есть время сегодня?", { idMessage: "IN-Q-1" });
  assert.equal(got(aig).length, 1); assert.equal(got(erz).length, 1, "без ответственного — всем");
  await b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "take", op: "Ержан" });
  await s.gaText("winchester", INST, from, "Ау, ответьте", { idMessage: "IN-Q-2" });
  assert.equal(got(aig).length, 1, "Айгерим — нет"); assert.equal(got(erz).length, 2, "Ержану — да");
  const r = await (await b.post("/api/inbox/send", { c: "winchester", ch: "ga", id: from, text: "Сейчас посмотрю", op: "Ержан" })).json();
  const mid = s.hist("ga", "winchester", from).turns.at(-1).mid;
  await hook(s, { typeWebhook: "outgoingMessageStatus", chatId: from + "@c.us", idMessage: mid, status: "failed", description: "Error: Timed Out", sendByApi: true });
  const last = got(erz).at(-1);
  assert.equal(last.k, "send_failed"); assert.ok(r.ok);
});
