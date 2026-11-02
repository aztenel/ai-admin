// @ts-check
// Страница владельца «Хранилища» (/diag/storage, этап 0 плана D1, 31.10.2026): к каким KV и базе D1 подключён этот адрес —
// проверка, что черновик не пишет в боевые данные, — и сколько ключей каких групп в KV (для переноса «стопов» в D1).
import { hasClient } from "../../config/builtin-clients.js";
import { d1Status } from "../../db/d1/status.js";
import { kvStats } from "../../db/kv/stats.js";
/** @import { Env } from "../../lib/types.js" */

/** @param {Env} env */
export async function storageReport(env) {
  const out = [], preview = env.STAGE === "preview";
  out.push("Этот адрес: " + (preview ? "черновик (Worker Previews, STAGE=preview) — должен работать с KV ai-admin-dev и базой ai-admin-dev" : "боевой сайт — KV aiai"));
  const d = await d1Status(env);
  if (!d.bound) out.push("База D1: не подключена" + (preview ? " ❌ — у черновика должна быть ai-admin-dev (wrangler.jsonc → previews.d1_databases)" : " — так и задумано: боевая база ai-admin создана, подключение — по решению владельца"));
  else if (d.error) out.push(`База D1: ❌ не отвечает — ${d.error}`);
  else {
    const who = d.want === "preview" ? "черновик" : "боевой сайт";
    out.push(`База D1: подключена, ответ за ${d.ms} мс`);
    out.push("  отметка базы: " + (d.stage === d.want ? `${d.stage} — совпадает ✅` : d.stage ? `${d.stage} ❌ — а это ${who}: база чужая, код ею не пользуется` : "нет ❌ — код базой не пользуется"));
    out.push(`  миграции: ${d.migrations && d.migrations.length ? d.migrations.join(", ") : "не применены ❌"}; таблиц: ${d.tables}`);
  }
  if (!env.KV) { out.push("KV: не подключено ❌"); return out.join("\n"); }
  try {
    const s = await kvStats(env, hasClient);
    out.push(`KV: ключей ${s.complete ? s.total : `не меньше ${s.total} (подсчёт остановлен на ${s.pages} страницах по 1000)`}` + (preview && s.groups.some(([g]) => /^(h|optout):/.test(g)) ? " ⚠️ есть чаты или «стоп» — проверьте, что это тестовые" : ""));
    for (const [g, n] of s.groups.slice(0, 80)) out.push(`  ${g} ${n}`);
    if (s.groups.length > 80) out.push(`  … ещё групп: ${s.groups.length - 80}`);
  } catch (/** @type {any} */ e) { out.push("KV: ❌ список ключей не читается — " + String((e && e.message) || e).slice(0, 160)); }
  out.push("", "Значения ключей не читаются; номера, имена и метки сессий не показываются — только группы и числа.");
  return out.join("\n");
}
