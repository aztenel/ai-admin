// Бот (план проверки модулей, модуль 2, 16.10.2026): готовые фразы, которые бот говорит без ИИ (сбой ИИ, защита ответа, согласие, голосовое),
// были только по-русски — клиент, который пишет по-казахски или по-английски, получал ответ на чужом языке. Всё на заглушках.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";

const META = { WA_TOKEN_BARBER: "meta-token", APP_SECRET_BARBER: "sec-b", PHONE_NUMBER_ID_BARBER: "555000111" };
const RU = /[а-яё]/i, KK = /[әғқңөұүһі]/i;

test("сбой ИИ, клиент пишет по-казахски — ответ по-казахски", async () => {
  net.reset();
  const s = mk();
  const r = await s.chat("barber", "kk-ai-fail", "Сәлеметсіз бе, шаш қию қанша тұрады?", [500]);
  assert.ok(KK.test(r.reply) && !/Спасибо|Администратор ответит/.test(r.reply), r.reply);
});

test("сбой ИИ, клиент пишет по-английски — ответ по-английски", async () => {
  net.reset();
  const s = mk();
  const r = await s.chat("barber", "en-ai-fail", "Hello, how much is a haircut?", [500]);
  assert.ok(!RU.test(r.reply) && /administrator/i.test(r.reply), r.reply);
});

test("защита дважды отклонила ответ (цены нет в фактах), клиент пишет по-английски — заготовка по-английски", async () => {
  net.reset();
  const s = mk();
  const r = await s.chat("barber", "en-guard", "Hello, how much is a haircut?", ["A haircut costs 99 999 ₸."]);
  assert.ok(!/99 999/.test(r.reply), r.reply);
  assert.ok(!RU.test(r.reply), r.reply);
});

test("Winchester: защита отклонила ответ, клиент пишет по-казахски — заготовка по-казахски, с телефоном администратора", async () => {
  net.reset();
  const s = mk({ ALTEGIO_PARTNER: "partner-key" }); // расписание Altegio — заглушка
  const r = await s.chat("winchester", "kk-guard-w", "Сәлем, сақал қанша тұрады?", ["Сақал 99 999 ₸ тұрады."]);
  assert.ok(!/99 999/.test(r.reply), r.reply);
  assert.ok(KK.test(r.reply) && /505 05 03/.test(r.reply) && !/Это лучше уточнить/.test(r.reply), r.reply);
});

test("WhatsApp: первое сообщение по-английски — текст согласия по-английски", async () => {
  net.reset(); net.ai = ["Hello! A men's haircut is from 6 000 ₸."];
  const s = mk(META);
  await s.waText("/wa/barber", "77051114401", "Hello, how much is a haircut?", { secret: "sec-b" });
  const out = s.sentTo("77051114401");
  assert.ok(out.length >= 2, JSON.stringify(out));
  assert.ok(out.every(t => !RU.test(t.replace(/«[^»]*»|“[^”]*”/g, ""))), "по-русски только название бизнеса: " + JSON.stringify(out));
});

test("WhatsApp: голосовое в чате на казахском — ответ по-казахски", async () => {
  net.reset(); net.ai = ["Сәлеметсіз бе! Шаш қию 3 000 ₸."];
  const s = mk(META);
  await s.waText("/wa/barber", "77051114402", "Сәлеметсіз бе, шаш қию қанша тұрады?", { secret: "sec-b" });
  await s.waPost("/wa/barber", { from: "77051114402", type: "audio", audio: { id: "voice1", mime_type: "audio/ogg" } }, { secret: "sec-b" });
  const last = s.sentTo("77051114402").pop();
  assert.ok(KK.test(last) && !/Я пока не умею/.test(last), last);
});

test("«administrator» и «әкімші» одним словом — передача человеку (так написано в согласии на этих языках)", async () => {
  net.reset(); net.ai = ["Hello! How can I help?"];
  const s = mk(META);
  for (const [from, word] of [["77051114403", "administrator"], ["77051114404", "Admin"], ["77051114405", "әкімші"]]) {
    await s.waText("/wa/barber", from, word, { secret: "sec-b" });
    const h = s.hist("wa", "barber", from);
    assert.ok(h.profile.pausedUntil > Date.now(), word + ": бот передал чат человеку: " + JSON.stringify(s.sentTo(from)));
    const last = s.sentTo(from).pop();
    assert.ok(word === "әкімші" ? KK.test(last) : !RU.test(last), word + ": ответ на языке клиента: " + last);
  }
});
