// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Поставщик ИИ Claude (Anthropic): isClaude и askClaude.

// Claude (Anthropic) как поставщик ИИ: модель с именем claude-… (MODEL или MODEL_FALLBACK), ключ — секрет ANTHROPIC_KEY.
// Отвечает так же, как askGemini: строка текста или ошибка (тогда askGemini пробует следующую модель списка).
export const isClaude = model => /^claude-/i.test(String(model || ""));
export async function askClaude(env, system, turns, model, info) {
  if (!env.ANTHROPIC_KEY) throw new Error("ANTHROPIC_KEY не задан");
  const messages = turns.reduce((a, t) => { const role = t.role === "model" ? "assistant" : "user", l = a[a.length - 1]; if (l && l.role === role) l.content += "\n" + t.text; else a.push({ role, content: t.text }); return a; }, []);
  if (!messages.length || messages[0].role !== "user") messages.unshift({ role: "user", content: "(клиент открыл чат)" }); // Claude требует, чтобы диалог начинался с клиента
  const body = { model, max_tokens: 2048, temperature: 0.3, system, messages };
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 9000), t0 = Date.now();
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
      if ((r.status === 429 || r.status >= 500) && attempt === 0) { await new Promise(s => setTimeout(s, 1200)); lastErr = new Error("Claude " + r.status); continue; }
      throw new Error("Claude " + r.status + " " + tx.slice(0, 200));
    }
    const out = (data?.content || []).filter(p => p.type === "text").map(p => p.text || "").join("").trim(), reason = data?.stop_reason || "";
    if (info) Object.assign(info, { reason, thoughts: undefined });
    if (ms > 8000) console.log("claude slow", model, ms, reason);
    if (!out) throw new Error("Claude empty " + reason);
    if (reason === "max_tokens" && !/[.!?…)»]\s*$/.test(out.replace(/\n?\[\s*(ЗАЯВКА|ОТМЕНА)\s*\][^\n]*/gi, "").trim())) throw new Error("Claude cut off");
    return out;
  }
  throw lastErr || new Error("Claude failed");
}
