// ИИ (план проверки модулей, модуль 3, 16.10.2026): общий предел времени на ответ и учёт расходов на ИИ. Всё на заглушках.
// Почему предел: ответ бота в WhatsApp готовится в фоне после ответа вебхуку, а Cloudflare даёт на это около 30 секунд.
// Без общего предела ИИ мог думать 9 с × (основная + запасная модель) × (ответ + 2 переспроса защиты) — фон обрывался, и клиент оставался без ответа.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { askClaude } from "../../src/services/ai/claude.js";
import { costOf } from "../../src/services/ai/usage.js";

const later = (ms, v) => () => new Promise(r => setTimeout(() => r(v), ms));

test("время на ответ кончилось — защита не переспрашивает ИИ, клиенту уходит заготовка", async () => {
  net.reset();
  const s = mk({ AI_BUDGET_MS: "1000" });
  net.ai = [later(400, "Мужская стрижка — 99 999 ₸.")]; // цены нет в фактах: защита хотела бы переспросить
  const r = await s.chat("barber", "budget-1", "Сколько стоит стрижка?");
  assert.ok(!/99 999/.test(r.reply), r.reply);
  assert.equal(net.gemini.length, 1, "второго запроса к ИИ нет — на него нет времени");
});

test("ИИ завис — ответ клиенту приходит в пределах времени, а не через 9 с × 2 модели", async () => {
  net.reset();
  const s = mk({ AI_BUDGET_MS: "1500" });
  net.ai = [later(20000, "слишком поздно")];
  const t0 = Date.now();
  const r = await s.chat("barber", "budget-2", "Сколько стоит стрижка?");
  assert.ok(Date.now() - t0 < 4000, "ответ за " + (Date.now() - t0) + " мс");
  assert.ok(r.reply && !/слишком поздно/.test(r.reply), r.reply);
});

test("Claude: токены ответа попадают в сведения о вызове", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (async () => new Response(JSON.stringify({ content: [{ type: "text", text: "Здравствуйте!" }], stop_reason: "end_turn", usage: { input_tokens: 1800, cache_read_input_tokens: 200, output_tokens: 40 } }), { status: 200 }));
  try {
    const info = {};
    await askClaude(/** @type {any} */ ({ ANTHROPIC_KEY: "k" }), "sys", [{ role: "user", text: "Привет" }], "claude-haiku-5-5", info);
    assert.equal(info.inTok, 2000); assert.equal(info.outTok, 40);
  } finally { globalThis.fetch = real; }
});

test("цена Claude Haiku 5.5: $0.10 за миллион входящих и $0.50 за миллион исходящих токенов; у неизвестной модели — 0", () => {
  assert.equal(costOf("claude-haiku-5-5", 1e6, 1e6), 0.6);
  assert.equal(costOf("gemini-3.5-flash-lite", 1e6, 1e6), 0);
});

test("расходы на ИИ копятся по бизнесу и дню и видны владельцу на /diag", async () => {
  net.reset(); net.aiUsage = { promptTokenCount: 3000, candidatesTokenCount: 60, thoughtsTokenCount: 10 };
  const s = mk();
  await s.chat("barber", "usage-1", "Здравствуйте", ["Здравствуйте! Чем помочь?"]);
  await s.chat("barber", "usage-2", "Добрый день", ["Добрый день! Чем помочь?"]);
  const keys = [...s.kv.mem.keys()].filter(k => k.startsWith("aiu:barber:"));
  assert.equal(keys.length, 1, JSON.stringify([...s.kv.mem.keys()].filter(k => k.startsWith("aiu"))));
  const u = s.kv.json(keys[0]);
  assert.equal(u.n, 2); assert.equal(u.in, 6000); assert.equal(u.out, 140);
  const page = await (await s.call("/diag?key=owner-key-123456")).text();
  assert.ok(/Расходы на ИИ/.test(page) && /Демо Барбер/.test(page) && /6\s?000/.test(page), page.slice(-800));
});
