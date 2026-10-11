// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Пульт чатов: смена статуса заявки.
import { clean } from "../../lib/text.js";
import { LEAD_TTL } from "../../config/constants.js";
import { kvRetry } from "../../db/kv/retry.js";
import { leadTs, loadLeads, saveLeads, leadKey } from "../../db/kv/leads.js";

export async function leadPatch(env, cid, id, patch) { // статус заявки — в отдельном ключе (с метаданными) и в общем списке
  let ok = false;
  try {
    await kvRetry(async () => {
      const k = leadKey(cid, id), v = JSON.parse((await env.KV.get(k)) || "null");
      if (v) { const nv = { ...v, ...patch }; await env.KV.put(k, JSON.stringify(nv), { expirationTtl: Math.max(3600, Math.ceil((leadTs(nv) + LEAD_TTL - Date.now()) / 1000)), metadata: { status: nv.status || "", note: clean(nv.note || "", 200) } }); ok = true; }
    });
  } catch (e) { console.log("lead key", String(e)); }
  // общий список пишут все чаты клиента: при отказе «не чаще записи в секунду» читаем его заново и повторяем
  try { await kvRetry(async () => { const list = await loadLeads(env.KV, cid), x = list.find(l => l.id === id); if (x) { Object.assign(x, patch); await saveLeads(env.KV, cid, list); ok = true; } }); } catch (e) { console.log("leads", String(e)); }
  return ok;
}
