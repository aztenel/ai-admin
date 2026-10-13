// Ошибка ИИ: если Claude отказал, а запасной Gemini тоже, в ошибке видны обе причины (14.10.2026 был виден только Gemini).
import { test } from "node:test";
import assert from "node:assert/strict";
import { askGemini } from "../../src/services/ai/gemini.js";

const TURNS = [{ role: "user", text: "Сколько стоит стрижка?" }];

/** @param {(url: string) => { status: number, body: string }} f */
async function withFetch(f, run) {
  const real = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (async (/** @type {any} */ url) => { const r = f(String(url)); return new Response(r.body, { status: r.status }); });
  try { return await run(); } finally { globalThis.fetch = real; }
}

test("Claude 401 и Gemini 400: в ошибке обе причины, первая — Claude", async () => {
  await withFetch(
    url => url.includes("anthropic") ? { status: 401, body: '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}' } : { status: 400, body: '{"error":{"message":"API key not valid"}}' },
    async () => {
      const env = /** @type {any} */ ({ MODEL: "claude-haiku-5-5", ANTHROPIC_KEY: "k1", GEMINI_KEY: "k2" });
      await assert.rejects(() => askGemini(env, "sys", TURNS), e => {
        const m = String(e.message);
        return /^Claude 401/.test(m) && /invalid x-api-key/.test(m) && /Gemini 400/.test(m) && m.indexOf("Claude") < m.indexOf("Gemini");
      });
    });
});

test("ANTHROPIC_KEY не задан: причина видна, а не только отказ запасной модели", async () => {
  await withFetch(
    () => ({ status: 400, body: '{"error":{"message":"API key not valid"}}' }),
    async () => {
      const env = /** @type {any} */ ({ MODEL: "claude-haiku-5-5", GEMINI_KEY: "k2" });
      await assert.rejects(() => askGemini(env, "sys", TURNS), e => /ANTHROPIC_KEY не задан/.test(String(e.message)) && /Gemini 400/.test(String(e.message)));
    });
});

test("только Gemini (без Claude): ошибка прежняя, без лишних частей", async () => {
  await withFetch(
    () => ({ status: 400, body: '{"error":{"message":"API key not valid"}}' }),
    async () => {
      const env = /** @type {any} */ ({ GEMINI_KEY: "k2" });
      await assert.rejects(() => askGemini(env, "sys", TURNS), e => /^Gemini 400/.test(String(e.message)));
    });
});
