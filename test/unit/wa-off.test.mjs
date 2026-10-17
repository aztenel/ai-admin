// Бот Winchester в WhatsApp выключен (17.10.2026): номер после блокировки подключается заново, первые дни отвечают только люди.
// Сообщения клиентов ложатся в пульт и в Telegram, бот не пишет ничего (ни ответа, ни согласия, ни «меню», ни ответа на голосовое).
// Веб-чат Winchester работает (показ заказчику). Включить — Text BOT_WA_WINCHESTER = 1. Всё на заглушках.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";

const ENV = { ALTEGIO_PARTNER: "partner-key", WA_TOKEN_WINCHESTER: "tok-w", APP_SECRET_WINCHESTER: "sec-w" };

test("WhatsApp Winchester: бот молчит, сообщение — в пульте и в Telegram", async () => {
  net.reset(); net.ai = ["Здравствуйте! Чем помочь?"];
  const s = mk(ENV), from = "77000000081";
  await s.waText("/wa/winchester", from, "Здравствуйте, хочу постричься завтра", { secret: "sec-w" });
  await s.waText("/wa/winchester", from, "меню", { secret: "sec-w" });
  await s.waPost("/wa/winchester", { from, type: "audio", audio: { id: "v1", mime_type: "audio/ogg" } }, { secret: "sec-w" });
  assert.deepEqual(s.sentTo(from), [], "клиенту ничего не ушло");
  assert.equal(net.gemini.length, 0, "ИИ не вызывался");
  const h = s.hist("wa", "winchester", from);
  assert.ok(h.turns.some(t => /постричься/.test(t.text)), "сообщение видно в пульте");
  assert.ok(net.tg.some(t => /Бот выключен/.test(t.text || "")), "администратору — сигнал в Telegram");
});

test("веб-чат Winchester отвечает как раньше", async () => {
  net.reset();
  const s = mk(ENV);
  const r = await s.chat("winchester", "web-off-1", "Здравствуйте", ["Здравствуйте! Подскажу цены и свободное время."]);
  assert.ok(/Подскажу цены/.test(r.reply) && !/отвечает администратор/.test(r.reply), r.reply);
});

test("BOT_WA_WINCHESTER = 1 — бот в WhatsApp снова отвечает", async () => {
  net.reset(); net.ai = ["Здравствуйте! Чем помочь?"];
  const s = mk({ ...ENV, BOT_WA_WINCHESTER: "1" }), from = "77000000082";
  await s.waText("/wa/winchester", from, "Здравствуйте", { secret: "sec-w" });
  assert.ok(s.sentTo(from).length >= 1, JSON.stringify(s.sentTo(from)));
});
