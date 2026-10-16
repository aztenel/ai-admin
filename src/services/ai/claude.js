// @ts-check
// Поставщик ИИ Claude (Anthropic): isClaude и askClaude.

// Claude (Anthropic) как поставщик ИИ: модель с именем claude-… (MODEL или MODEL_FALLBACK), ключ — секрет ANTHROPIC_KEY.
// Отвечает так же, как askGemini: строка текста или ошибка (тогда askGemini пробует следующую модель списка).
/** @param {any} model @returns {boolean} */
export const isClaude = model => /^claude-/i.test(String(model || ""));

// Время на одну попытку: 9 с, но не дольше общего предела ответа (info.deadline — отметка времени, ставит think()).
// Меньше MIN_TRY_MS не пробуем: ответ всё равно не успеет прийти
export const MIN_TRY_MS = 800;
/** @param {Record<string, any>=} info @returns {number} */
export const waitMs = info => Math.min(9000, info && info.deadline ? info.deadline - Date.now() : 9000);
/**
 * @import { Env, Turn } from "../../lib/types.js"
 * @param {Env} env
 * @param {string} system
 * @param {Turn[]} turns
 * @param {string} model
 * @param {Record<string, any>=} info
 * @returns {Promise<string>}
 */
export async function askClaude(env, system, turns, model, info) {
  if (!env.ANTHROPIC_KEY) throw new Error("ANTHROPIC_KEY не задан");
  const messages = turns.reduce((/** @type {any[]} */ a, /** @type {Turn} */ t) => { const role = t.role === "model" ? "assistant" : "user", l = a[a.length - 1]; if (l && l.role === role) l.content += "\n" + t.text; else a.push({ role, content: t.text }); return a; }, []);
  if (!messages.length || messages[0].role !== "user") messages.unshift({ role: "user", content: "(клиент открыл чат)" }); // Claude требует, чтобы диалог начинался с клиента
  /** @type {Record<string, any>} */
  const body = { model, max_tokens: 2048, temperature: 0.3, system, messages };
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ms0 = waitMs(info);
    if (ms0 < MIN_TRY_MS) throw new Error("timeout " + model + " (время на ответ кончилось)");
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms0), t0 = Date.now();
    let r, tx = "", data = null;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body), signal: ac.signal });
      if (r.ok) data = await r.json(); else tx = (await r.text()).slice(0, 300);
    } catch (e) { throw new Error("timeout " + model); }
    finally { clearTimeout(timer); }
    const ms = Date.now() - t0;
    if (info) Object.assign(info, { model, ms, think: "у Claude нет", status: r.status });
    if (!r.ok) {
      if (r.status === 400 && "temperature" in body && /temperature/i.test(tx)) { delete body.temperature; attempt--; continue; } // эта модель не принимает temperature
      if ((r.status === 429 || r.status >= 500) && attempt === 0 && waitMs(info) > 1200 + MIN_TRY_MS) { await new Promise(s => setTimeout(s, 1200)); lastErr = new Error("Claude " + r.status); continue; }
      throw new Error("Claude " + r.status + " " + tx.slice(0, 200));
    }
    const out = (data?.content || []).filter((/** @type {any} */ p) => p.type === "text").map((/** @type {any} */ p) => p.text || "").join("").trim(), reason = data?.stop_reason || "";
    const u = data?.usage || {};
    if (info) Object.assign(info, { reason, thoughts: undefined, inTok: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), outTok: u.output_tokens || 0 });
    if (ms > 8000) console.log("claude slow", model, ms, reason);
    if (!out) throw new Error("Claude empty " + reason);
    if (reason === "max_tokens" && !/[.!?…)»]\s*$/.test(out.replace(/\n?\[\s*(ЗАЯВКА|ОТМЕНА)\s*\][^\n]*/gi, "").trim())) throw new Error("Claude cut off");
    return out;
  }
  throw lastErr || new Error("Claude failed");
}
