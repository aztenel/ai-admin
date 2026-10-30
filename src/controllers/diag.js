// @ts-check
// /diag: проверка ключей и скорости моделей.
import { CLIENTS } from "../config/builtin-clients.js";
import { GRAPH } from "../config/constants.js";
import { askGemini } from "../services/ai/gemini.js";
import { isClaude } from "../services/ai/claude.js";
import { usageReport } from "../services/ai/usage.js";
import { systemPrompt } from "../services/conversation/prompt.js";
import { WA_HINT } from "../services/inbox/deps.js";
import { storageReport } from "../services/storage/report.js";
/** @import { Env } from "../lib/types.js" */

/** @param {Env} env */
export async function diag(env) {
  /** @type {string[]} */
  const out = [];
  // хранилище проверяем чтением: эта страница нужна как раз тогда, когда оно не работает, поэтому сбой — строка в отчёте, а не падение страницы
  let kvErr = "", waLast = null;
  if (env.KV) { try { waLast = await env.KV.get("wa:lastErr"); } catch (/** @type {any} */ e) { kvErr = String((e && e.message) || e).slice(0, 160); } }
  out.push(!env.KV ? "KV: НЕ подключено ❌ — Settings → Bindings → KV namespace, имя KV"
    : kvErr ? `Хранилище KV: ❌ не читается — ${kvErr}. Проверьте привязку KV (Settings → Bindings) и суточный лимит хранилища в панели Cloudflare. Пока оно не читается, бот не ведёт диалог и не показывает заявки`
    : "KV: подключено ✅");
  const key = env.GEMINI_KEY || "";
  out.push("GEMINI_KEY: " + (key ? `есть ✅ (${key.length} симв.)` : "НЕТ ❌")); // начало ключа не показываем: страницу видно на экране, снимки уходят в чаты
  const useClaude = isClaude(env.MODEL) || isClaude(env.MODEL_FALLBACK);
  if (useClaude) out.push("ANTHROPIC_KEY: " + (env.ANTHROPIC_KEY ? `есть ✅ (${env.ANTHROPIC_KEY.length} симв.)` : "НЕТ ❌ — секрет из console.anthropic.com"));
  out.push("LEADS_KEY: " + (env.LEADS_KEY ? "задан ✅" : "не задан — используется VERIFY_TOKEN (лучше задать отдельный)"));
  const tgChats = String(env.TG_CHAT || "").split(/[,\s]+/).filter(Boolean).length;
  out.push("Telegram: " + (env.TG_TOKEN && tgChats ? `настроен ✅ (чатов: ${tgChats})` : "не настроен (заявки только на /leads)"));
  out.push("Согласие: " + (env.CONSENT_TEXT ? "свой текст ✅" : "стандартный текст"));
  out.push("Green-API: " + (env.GA_ID && env.GA_TOKEN && env.GA_HOOK ? `настроен ✅ (инстанс ${env.GA_ID}, ниша: ${env.GA_CLIENT || "меню"}). В настройках инстанса включите входящие и «отправленные с телефона»` : "не настроен (нужны GA_URL, GA_ID, GA_TOKEN, GA_HOOK)"));
  if (env.GA_ID && env.GA_TOKEN) {
    try {
      const base = (env.GA_URL || "https://api.green-api.com").replace(/\/$/, "");
      const r = await fetch(`${base}/waInstance${env.GA_ID}/getStateInstance/${env.GA_TOKEN}`);
      const st = r.ok ? (await r.json()).stateInstance : "ошибка " + r.status;
      out.push("Green-API статус: " + (st === "authorized" ? "authorized ✅ (WhatsApp привязан)" : st + " ❌ — отсканируйте QR в кабинете Green-API"));
    } catch (e) { out.push("Green-API статус: ❌ " + String(e).slice(0, 120)); }
  }
  const metaOn = env.WA_TOKEN && env.PHONE_NUMBER_ID;
  out.push("Meta WhatsApp: " + (metaOn ? `настроен (PHONE_NUMBER_ID ${env.PHONE_NUMBER_ID}, ниша: ${env.WA_CLIENT || "меню"})` : "не настроен (нужны WA_TOKEN, PHONE_NUMBER_ID, VERIFY_TOKEN)"));
  if (metaOn) {
    out.push("APP_SECRET: " + (env.APP_SECRET ? "задан ✅ (принимаются только запросы, подписанные Meta)" : "не задан ⚠️ — добавьте App secret из App settings → Basic"));
    out.push("VERIFY_TOKEN: " + (env.VERIFY_TOKEN ? "задан ✅" : "НЕТ ❌ — без него Meta не подтвердит webhook"));
    out.push("Политика для Meta: /privacy · " + (env.OWNER_EMAIL ? "OWNER_EMAIL задан ✅" : "добавьте OWNER_EMAIL (почта для запросов об удалении данных) ⚠️"));
    try {
      const get = (/** @type {any} */ f) => fetch(`${GRAPH}/${env.PHONE_NUMBER_ID}?fields=${f}`, { headers: { authorization: "Bearer " + env.WA_TOKEN } });
      let r = await get("display_phone_number,verified_name,name_status,quality_rating,code_verification_status");
      let j = await r.json().catch(() => ({}));
      if (!r.ok && j?.error?.code === 100) { r = await get("display_phone_number,verified_name"); j = await r.json().catch(() => ({})); }
      if (r.ok) out.push(`Номер в Meta: ✅ ${j.display_phone_number || "?"} «${j.verified_name || "?"}»` +
        (j.name_status ? ` · имя: ${j.name_status}` : "") + (j.quality_rating ? ` · качество: ${j.quality_rating}` : "") +
        (j.code_verification_status ? ` · подтверждение: ${j.code_verification_status}` : ""));
      else { const e = j?.error || {}; out.push(`Номер в Meta: ❌ ${e.code || r.status} ${e.message || ""}` + (WA_HINT[e.code] ? " → " + WA_HINT[e.code] : "")); }
    } catch (e) { out.push("Номер в Meta: ❌ " + String(e).slice(0, 120)); }
    out.push("Последняя ошибка WhatsApp: " + (!env.KV || kvErr ? "не прочитана — хранилище не отвечает" : waLast || "нет ✅"));
  }
  out.push("Altegio: " + (env.ALTEGIO_PARTNER ? "ключ разработчика задан ✅ — проверка расписания: /altegio?key=…" : "не настроен (нужен Secret ALTEGIO_PARTNER)"));
  out.push("Модели: " + (env.MODEL || "gemini-flash-lite-latest") + " → запасная " + (env.MODEL_FALLBACK || "gemini-flash-latest"));
  if (env.KV && !kvErr) out.push(...await usageReport(env, Date.now()));
  if (!key && !(useClaude && env.ANTHROPIC_KEY)) return out.join("\n");
  const t0 = Date.now(), lbl = isClaude(env.MODEL) ? "Тест Claude" : "Тест Gemini";
  try { const r = await askGemini(env, "Ответь одним словом.", [{ role: "user", text: "Скажи: работает" }]); out.push(`${lbl}: ✅ «${r.slice(0, 40)}» за ${Date.now() - t0} мс`); }
  catch (e) {
    const s = String(e); out.push(lbl + ": ❌ " + s.slice(0, 400));
    out.push(/Claude 401|authentication/i.test(s) ? "ПРИЧИНА: неверный ключ Claude — создайте новый в console.anthropic.com" : /API_KEY_INVALID|not valid/i.test(s) ? "ПРИЧИНА: неверный ключ — создайте новый в aistudio.google.com" :
      /leaked/i.test(s) ? "ПРИЧИНА: ключ заблокирован как засвеченный — создайте новый" :
      /404|no longer available|not found/i.test(s) ? "ПРИЧИНА: модель устарела — поставьте MODEL из списка ниже" :
      /429/.test(s) ? "ПРИЧИНА: исчерпан бесплатный лимит — подождите или новый ключ" : "Пришлите этот текст в чат.");
  }
  // скорость каждой модели на настоящей подсказке бота (как в чате): миллисекунды, настройка «раздумий», токены «мыслей», чем кончился ответ
  try {
    const sysDemo = systemPrompt(CLIENTS.barber || Object.values(CLIENTS)[0], { nowMs: Date.now() });
    out.push(`Скорость на настоящей подсказке бота (${sysDemo.length} знаков), быстро — до 4000 мс:`);
    for (const mdl of [...new Set([env.MODEL || "gemini-flash-lite-latest", env.MODEL_FALLBACK || "gemini-flash-latest"])]) {
      /** @type {Record<string, any>} */
      const info = {};
      try {
        await askGemini(env, sysDemo, [{ role: "user", text: "Здравствуйте, сколько стоит мужская стрижка и есть ли время завтра?" }], info, [mdl]);
        out.push(`  ${mdl}: ${info.ms > 8000 ? "❌ очень медленно" : info.ms > 4000 ? "⚠️ медленно" : "✅"} ${info.ms} мс · «раздумья»: ${info.think} · токены «мыслей»: ${info.thoughts ?? "нет данных"} · конец ответа: ${info.reason || "?"}`);
      } catch (e) { out.push(`  ${mdl}: ❌ ${String(e).replace(/^Error: /, "").slice(0, 200)}${info.ms ? ` (${info.ms} мс)` : ""}`); }
    }
  } catch (e) { out.push("Скорость моделей: не проверена — " + String(e).slice(0, 120)); }
  if (key) try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`);
    if (r.ok) out.push("Доступные flash-модели: " + ((await r.json()).models || []).map((/** @type {any} */ m) => m.name.replace("models/", "")).filter((/** @type {any} */ n) => /flash/i.test(n) && !/tts|image|audio|live|embed/i.test(n)).join(", "));
  } catch (e) {}
  return out.join("\n");
}

/** /diag/storage: к каким KV и D1 подключён этот адрес, сколько ключей каких групп (без значений) — §0 плана D1 */
/** @param {Env} env */
export const storage = env => storageReport(env);
