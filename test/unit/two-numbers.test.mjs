// Winchester: два номера (18.10.2026, docs/tz-winchester-v2.md). Официальный (Wazzapo) — у администратора, бот там молчит;
// второй номер на Green-API — бот, но до слова владельца тоже молчит (BOT_GA_WINCHESTER = 1 включает). С номера бота первым
// не пишем: рассылок нет, напоминание и отзыв — только если клиент писал в последние 24 часа; на «спасибо» бот не отвечает.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { bcRoute } from "../../src/services/broadcast/sender.js";
import { remindSend } from "../../src/services/reminders/send.js";

const INST = { id: "7105000077", token: "ga-tok-w" };
const ENV = { ALTEGIO_PARTNER: "partner-key", WA_TOKEN_WINCHESTER: "tok-w", APP_SECRET_WINCHESTER: "sec-w", GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
const gaSent = to => net.ga.filter(x => x.op === "sendMessage" && x.body && x.body.chatId === to + "@c.us").map(x => x.body.message);
const login = async s => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Finbox" }); return b; };

test("номер бота: до слова владельца бот молчит, сообщение — в пульте", async () => {
  net.reset(); net.ai = ["Здравствуйте! Чем помочь?"];
  const s = mk(ENV), from = "77000000091";
  await s.gaText("winchester", INST, from, "Здравствуйте, хочу постричься");
  assert.deepEqual(gaSent(from), []);
  assert.equal(net.gemini.length, 0, "ИИ не вызывался");
  assert.ok(s.hist("ga", "winchester", from).turns.some(t => /постричься/.test(t.text)));
});

test("BOT_GA_WINCHESTER = 1: бот отвечает на номере бота, на официальном номере по-прежнему молчит", async () => {
  net.reset(); net.ai = ["Здравствуйте! Чем помочь?", "Здравствуйте! Чем помочь?"];
  const s = mk({ ...ENV, BOT_GA_WINCHESTER: "1" }), from = "77000000092";
  await s.gaText("winchester", INST, from, "Здравствуйте");
  assert.ok(gaSent(from).some(t => /Чем помочь/.test(t)), JSON.stringify(gaSent(from)));
  await s.waText("/wa/winchester", from, "Здравствуйте", { secret: "sec-w" });
  assert.deepEqual(s.sentTo(from), [], "официальный номер — у администратора");
});

test("номер бота: на «спасибо» и 👍 бот не отвечает, сообщение видно в пульте", async () => {
  net.reset(); net.ai = ["Здравствуйте! Чем помочь?"];
  const s = mk({ ...ENV, BOT_GA_WINCHESTER: "1" }), from = "77000000093";
  await s.gaText("winchester", INST, from, "Здравствуйте");
  const before = gaSent(from).length, ai = net.gemini.length;
  await s.gaText("winchester", INST, from, "Спасибо большое!");
  await s.gaText("winchester", INST, from, "👍");
  assert.equal(gaSent(from).length, before, JSON.stringify(gaSent(from)));
  assert.equal(net.gemini.length, ai, "ИИ не вызывался");
  const h = s.hist("ga", "winchester", from);
  assert.ok(h.turns.some(t => /Спасибо/.test(t.text)) && !h.profile.need);
});

test("с номера бота рассылки запрещены; с официального — как раньше", () => {
  const ga = bcRoute(ENV, "winchester", "ga");
  assert.ok(ga.error && /номера бота/.test(ga.error), JSON.stringify(ga));
  assert.ok(bcRoute({ ...ENV, GA_ID_BARBER: "1", GA_TOKEN_BARBER: "t" }, "barber", "ga").ga, "у других компаний Green-API-рассылки не тронуты");
});

test("напоминание с номера бота — только если клиент писал в последние 24 часа", async () => {
  net.reset();
  const s = mk({ ...ENV, BOT_GA_WINCHESTER: "1" }), from = "77000000094", now = Date.now();
  const put = li => s.kv.api.put(`h:ga:winchester:${from}`, JSON.stringify({ n: 1, turns: [], profile: { li, bookings: [{ record_id: "r1", date: "2026-10-20", time: "10:00", services: ["Мужская стрижка"] }] } }));
  const x = { ch: "ga", id: from, rec: "r1", k: "d1", date: "2026-10-20", time: "10:00" };
  await put(now - 30 * 3600e3);
  assert.equal(await remindSend(s.env, "winchester", x, now), false, "клиент молчит больше суток — не пишем");
  assert.deepEqual(gaSent(from), []);
  await put(now - 2 * 3600e3);
  assert.equal(await remindSend(s.env, "winchester", x, now), true);
  assert.equal(gaSent(from).length, 1);
});

test("пульт: оба номера в одном списке, номера подписаны", async () => {
  net.reset();
  const s = mk(ENV), own = await login(s);
  const d = await (await own.go("/api/inbox/list?c=winchester")).json();
  assert.equal(d.client.two, true, JSON.stringify(d.client));
  assert.equal(d.client.off, true, "официальный номер: бот выключен");
  assert.equal(d.client.offGa, true, "номер бота: до слова владельца выключен");
});
