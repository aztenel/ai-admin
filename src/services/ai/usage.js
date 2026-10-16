// @ts-check
// Учёт расходов на ИИ (план проверки модулей, модуль 3, 16.10.2026): токены каждого ответа ИИ — по бизнесу и дню, сумма в долларах — по цене модели.
// Владелец видит расходы на /diag. Сбой учёта ответ клиенту не задерживает и не роняет.
/** @import { Env } from "../../lib/types.js" */
import { addUsage, readUsage } from "../../db/kv/ai-usage.js";
import { isoDay } from "../../lib/time.js";
import { CLIENTS } from "../../config/builtin-clients.js";

// $ за миллион токенов [вход, выход], первая сторона Anthropic, подсказка до 100 тыс. токенов (на 16.10.2026).
// У моделей Gemini цены здесь нет: токены считаются, сумма — нет
/** @type {Record<string, [number, number]>} */
const PRICE = { "claude-haiku-5-5": [0.10, 0.50], "claude-sonnet-5-5": [2, 10], "claude-opus-5-5": [4, 20], "claude-haiku-4-5": [1, 5] };

/** @param {string} model @param {number} inTok @param {number} outTok @returns {number} */
export const costOf = (model, inTok, outTok) => { const p = PRICE[String(model || "").toLowerCase()]; return p ? Math.round((inTok * p[0] + outTok * p[1])) / 1e6 : 0; };

/** один ответ ИИ: info — сведения о вызове из askGemini/askClaude (model, inTok, outTok) @param {Env} env @param {string} client @param {Record<string, any>} info @param {number} nowMs */
export async function trackUsage(env, client, info, nowMs) {
  if (!info || !info.model || !(info.inTok || info.outTok)) return;
  try { await addUsage(env.KV, client, isoDay(nowMs), { in: info.inTok || 0, out: info.outTok || 0, usd: costOf(info.model, info.inTok || 0, info.outTok || 0), model: String(info.model) }); }
  catch (e) { console.log("ai usage", String(e).slice(0, 120)); }
}

const fmt = (/** @type {number} */ n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
/** строки для /diag: расходы за последние days дней по каждому бизнесу @param {Env} env @param {number} nowMs @param {number=} days @returns {Promise<string[]>} */
export async function usageReport(env, nowMs, days = 7) {
  const out = [];
  for (const c of Object.values(CLIENTS)) {
    let n = 0, i = 0, o = 0, usd = 0;
    for (let d = 0; d < days; d++) {
      let u = null; try { u = await readUsage(env.KV, c.id, isoDay(nowMs - d * 86400e3)); } catch (e) { return ["Расходы на ИИ: не прочитались — хранилище не отвечает"]; }
      if (u) { n += u.n; i += u.in; o += u.out; usd += u.usd; }
    }
    if (n) out.push(`  ${c.name}: ответов ИИ ${fmt(n)} · токенов ${fmt(i)} на входе, ${fmt(o)} на выходе${usd ? ` · ≈ $${usd.toFixed(usd < 1 ? 3 : 2)}` : ""}`);
  }
  return [`Расходы на ИИ за ${days} дней${out.length ? ":" : " — ответов ИИ не было"}`, ...out];
}
