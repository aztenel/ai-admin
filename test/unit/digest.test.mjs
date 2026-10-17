// Telegram и дневная сводка (план проверки модулей, модуль 9, 16.10.2026): сводка шла только ботам из паспорта.
// Winchester пока встроен в код — Рауан и Кайрат сводку не получали бы, даже со своим чатом TG_CHAT_WINCHESTER. Демо-ботам без своего чата — по-прежнему не шлём.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { digestRun } from "../../src/services/digest.js";

const AT = Date.UTC(2026, 9, 3, 16, 5); // 21:05 по Астане — час сводки по умолчанию

test("встроенный бот со своим чатом Telegram получает дневную сводку; без своего чата — нет", async () => {
  net.reset();
  const s = mk({ TG_CHAT_WINCHESTER: "-1001,-1002" });
  const n = await digestRun(s.env, AT);
  const to = net.tg.filter(t => /Сводка/.test(t.text || "")).map(t => String(t.chat_id));
  assert.ok(n >= 1, "сводка отправлена");
  assert.deepEqual(to.sort(), ["-1001", "-1002"], "обоим в чате Winchester (Рауан и Кайрат), демо-ботам в общий чат — нет: " + JSON.stringify(net.tg.map(t => [t.chat_id, (t.text || "").slice(0, 40)])));
  assert.ok(net.tg.some(t => /Winchester/.test(t.text || "")));
  net.tg.length = 0;
  assert.equal(await digestRun(s.env, AT + 60e3), 0, "второй раз за день — нет");
});
