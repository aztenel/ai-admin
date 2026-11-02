// Очередь «Нужен ответ» (ТЗ v2.0 §2.1, §11 п. 1): только значимое входящее после последнего ответа человека.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAck, topicOf, replyTo, inboundNeed } from "../../src/services/inbox/queue.js";

const T = 1_790_000_000_000;

test("«спасибо», «ок», смайлик — не повод отвечать; «ок» на наш вопрос — повод", () => {
  for (const t of ["Спасибо 👍", "Ок 👌🏻", "Спасибо!", "спасибо большое", "Рахмет", "рақмет сізге", "👍", "🙏🏻", "+", "Ок", "хорошо, спасибо", "Понял", "жақсы"]) assert.equal(isAck(t, "Записали вас на 15:00 ✂️"), true, t);
  assert.equal(isAck("Ок", "Вам подходит 15:00?"), false, "ответ на вопрос");
  assert.equal(isAck("Да", "Записали вас на 15:00"), false, "«да» — всегда ответ");
  assert.equal(isAck("Спасибо, а на завтра есть время?", ""), false);
  assert.equal(isAck("ок а можно на 16?", ""), false);
});

test("тема: перенос, отмена, опоздание, «во сколько я записан», запись", () => {
  assert.equal(topicOf("Опаздываю минут на 10"), "late");
  assert.equal(topicOf("Не смогу прийти, перенесите на завтра"), "move");
  assert.equal(topicOf("Отмените пожалуйста запись"), "cancel");
  assert.equal(topicOf("Напомните, во сколько я записан?"), "time");
  assert.equal(topicOf("Есть свободное время сегодня вечером?"), "book");
  assert.equal(topicOf("Ертеңге жазылуға бола ма?"), "book");
  assert.equal(topicOf("Сколько стоит стрижка?"), "");
});

test("ответ на напоминание или рассылку — если наше автоматическое сообщение последнее и ему не больше 7 дней", () => {
  const rem = { role: "model", text: "Напоминаем о записи завтра в 15:00", t: T - 3600e3, rm: "d1" };
  assert.deepEqual(replyTo([rem], T), { k: "rm", id: "d1", at: T - 3600e3 });
  assert.equal(replyTo([rem, { role: "model", by: "admin", text: "Ждём вас", t: T - 60e3 }], T), null, "после него ответил человек");
  assert.equal(replyTo([{ ...rem, t: T - 8 * 86400e3 }], T), null);
  assert.equal(replyTo([{ role: "model", text: "Акция", t: T - 60e3, bc: "bc123" }], T).k, "bc");
});

test("входящее: очередь поднимается один раз, время ожидания — с первого сообщения без ответа", () => {
  const p = {}, turns = [{ role: "model", text: "Напоминаем о записи завтра в 15:00", t: T - 3600e3, rm: "d1" }];
  assert.equal(inboundNeed(p, turns, { text: "Спасибо!", why: "off", at: T }), false, "благодарность за напоминание");
  assert.equal(p.need, undefined);
  assert.equal(inboundNeed(p, turns, { text: "А можно перенести на 16:00?", why: "off", at: T + 1000 }), true);
  assert.deepEqual(p.need, { at: T + 1000, why: "off", tp: "move", src: { k: "rm", id: "d1", at: T - 3600e3 } });
  assert.equal(inboundNeed(p, turns, { text: "Ответьте пожалуйста", why: "off", at: T + 9000 }), false);
  assert.equal(p.need.at, T + 1000, "ждёт с первого сообщения");
  assert.equal(inboundNeed(p, turns, { text: "спасибо", why: "off", at: T + 10000 }), false);
  assert.ok(p.need, "«спасибо» вопрос не снимает");
  const q = { done: T - 5 };
  inboundNeed(q, [], { kind: "sticker", why: "media", at: T });
  assert.equal(q.done, undefined, "написал снова — уже не «Готово»"); assert.equal(q.need, undefined, "стикер — не повод");
  assert.ok(inboundNeed({}, [], { kind: "audio", why: "media", at: T }), "голосовое — повод");
});
