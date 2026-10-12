// @ts-check
// Поставщик ИИ Gemini (askGemini) с лесенкой «раздумий» THINK_LADDER; состояние THINK_STEP живёт только здесь. Выбор модели и цепочка основной → запасной — внутри askGemini, как раньше.
import { askClaude, isClaude } from "./claude.js";

// «Раздумья» модели перед ответом: на каждый вопрос это лишние секунды, а её «мысли» входят в лимит токенов ответа (ответ обрывается).
// Поколения Gemini отключают их по-разному, поэтому у модели есть лесенка настроек: берём верхнюю, а если Gemini отвечает 400 про thinking — спускаемся на ступеньку ниже.
/** @param {string} model @returns {(Record<string, any> | null)[]} */
export const THINK_LADDER = model => /2\.5-flash/.test(model) ? [{ thinkingBudget: 0 }, null]
  : /gemini-(1\.5|2\.0)/.test(model) ? [null]
  : /pro/.test(model) ? [{ thinkingLevel: "low" }, { thinkingBudget: 128 }, null]
  : [{ thinkingLevel: "minimal" }, { thinkingBudget: 0 }, { thinkingLevel: "low" }, null];
const THINK_STEP = new Map(); // модель → ступенька, которую принял Gemini (помним, пока жив экземпляр воркера)

// info — сюда пишем, что вышло (модель, миллисекунды, настройка «раздумий», токены «мыслей», чем кончился ответ): для /diag; only — список моделей вместо обычных
/**
 * @import { Env, Turn } from "../../lib/types.js"
 * @param {Env} env
 * @param {string} system
 * @param {Turn[]} turns
 * @param {Record<string, any>=} info
 * @param {string[]=} only
 * @returns {Promise<string>}
 */
export async function askGemini(env, system, turns, info, only) {
  const models = only || [env.MODEL || "gemini-flash-lite-latest", env.MODEL_FALLBACK || "gemini-flash-latest"];
  const payload = {
    systemInstruction: { parts: [{ text: system }] },
    contents: turns.reduce((/** @type {any[]} */ a, /** @type {Turn} */ t) => { const l = a[a.length - 1]; if (l && l.role === t.role) l.parts[0].text += "\n" + t.text; else a.push({ role: t.role, parts: [{ text: t.text }] }); return a; }, []),
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }, // запас: если модель всё же «думает», её мысли не съедят ответ
    safetySettings: ["HARASSMENT", "HATE_SPEECH", "SEXUALLY_EXPLICIT", "DANGEROUS_CONTENT"].map(k => ({ category: "HARM_CATEGORY_" + k, threshold: "BLOCK_ONLY_HIGH" }))
  };
  let lastErr;
  for (const [mi, model] of models.entries()) {
    if (isClaude(model)) { try { return await askClaude(env, system, turns, model, info); } catch (e) { lastErr = e; continue; } } // Claude отказал — следующая модель из списка (запасная)
    const ladder = THINK_LADDER(model);
    let step = Math.min(THINK_STEP.get(model) || 0, ladder.length - 1);
    for (let attempt = 0; attempt < 2; attempt++) {
      const body = JSON.parse(JSON.stringify(payload));
      if (ladder[step]) body.generationConfig.thinkingConfig = ladder[step];
      const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 9000), t0 = Date.now();
      let r, tx = "", data = null;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_KEY}`,
          { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
        if (r.ok) data = await r.json(); else tx = (await r.text()).slice(0, 300);
      } catch (e) { lastErr = new Error("timeout " + model); break; } // не дождались ответа (или обрыв связи): пробуем запасную модель
      finally { clearTimeout(timer); }
      const ms = Date.now() - t0;
      if (info) Object.assign(info, { model, ms, think: JSON.stringify(ladder[step]) || "по умолчанию", status: r.status });
      if (!r.ok) {
        if (r.status === 400 && step < ladder.length - 1 && /think/i.test(tx)) { step++; THINK_STEP.set(model, step); attempt--; continue; } // модель не знает такой настройки: следующая ступенька, та же модель
        if ((r.status === 429 || r.status >= 500) && attempt === 0) { await new Promise(s => setTimeout(s, 1200)); continue; }
        if (r.status === 404 || r.status === 400 && mi === 0 && models[1] !== model) { lastErr = new Error("Gemini " + r.status + " " + tx.slice(0, 200)); break; }
        if (r.status === 429 || r.status >= 500) { lastErr = new Error("Gemini " + r.status + " " + tx.slice(0, 200)); break; }
        throw new Error("Gemini " + r.status + " " + tx);
      }
      const out = (data?.candidates?.[0]?.content?.parts || []).map((/** @type {any} */ p) => p.text || "").join("").trim();
      const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "";
      if (info) Object.assign(info, { reason, thoughts: data?.usageMetadata?.thoughtsTokenCount });
      if (ms > 8000) console.log("gemini slow", model, ms, JSON.stringify(ladder[step]), "thoughts", data?.usageMetadata?.thoughtsTokenCount, reason);
      if (!out) { lastErr = new Error("Gemini empty " + reason); break; }
      if (reason === "MAX_TOKENS" && !/[.!?…)»]\s*$/.test(out.replace(/\n?\[\s*(ЗАЯВКА|ОТМЕНА)\s*\][^\n]*/gi, "").trim())) { lastErr = new Error("Gemini cut off"); break; } // обрезок клиенту не отдаём: пробуем запасную модель
      return out;
    }
  }
  throw lastErr || new Error("Gemini failed");
}
