// Данные и безопасность (план проверки модулей, модуль 11, 16.10.2026): полные номера клиентов не попадают в журнал сервера (CLAUDE.md §3.5).
// Ответы с ошибкой от Meta, Green-API и Wazzapo часто содержат номер получателя («chatId 77051112233@c.us is invalid») — их писали в журнал как есть.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";

const NUM = "77051117701";
async function capture(run) {
  const out = [], orig = console.log;
  console.log = (...a) => { out.push(a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ")); };
  try { await run(); } finally { console.log = orig; }
  return out.join("\n");
}

test("ошибка Green-API с номером получателя — в журнале номер скрыт", async () => {
  net.reset(); net.ai = ["Здравствуйте!"];
  net.gaReply = rec => rec.op === "sendMessage" ? new Response(JSON.stringify({ message: `Validation failed. Details: 'chatId' ${NUM}@c.us is invalid` }), { status: 400 }) : null;
  const inst = { id: "1101000002", token: "ga-token-2" };
  const s = mk({ GA_ID_BARBER: inst.id, GA_TOKEN_BARBER: inst.token });
  const log = await capture(() => s.gaText("barber", inst, NUM, "Здравствуйте"));
  assert.ok(/GA send/.test(log), log.slice(0, 500));
  assert.ok(!log.includes(NUM), log.split("\n").filter(l => l.includes(NUM)).join("\n"));
});

test("ошибка Meta с номером получателя — в журнале и на /diag номер скрыт", async () => {
  net.reset(); net.ai = ["Здравствуйте!"];
  net.graphReply = (url, init) => /\/messages$/.test(url) && init.method === "POST" ? new Response(JSON.stringify({ error: { code: 131026, message: `Message undeliverable to +${NUM}`, error_data: { details: `recipient ${NUM} not on WhatsApp` } } }), { status: 400 }) : null;
  const s = mk({ WA_TOKEN_EVENT: "t", APP_SECRET_EVENT: "sec-e", PHONE_NUMBER_ID_EVENT: "555000111" });
  const log = await capture(() => s.waText("/wa/event", NUM, "Здравствуйте", { secret: "sec-e" }));
  assert.ok(/WA send/.test(log), log.slice(0, 500));
  assert.ok(!log.includes(NUM), log.split("\n").filter(l => l.includes(NUM)).join("\n"));
  assert.ok(!String(s.kv.mem.get("wa:lastErr") || "").includes(NUM), s.kv.mem.get("wa:lastErr"));
});
