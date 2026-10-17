// @ts-check
// Удаление данных клиента по его просьбе. Страница /privacy обещает: «напишите … — удалим в течение 10 дней», а кнопки у владельца не было —
// пришлось бы стирать ключи в панели Cloudflare вручную (17.10.2026, модуль 11 плана проверки). Удаляем переписку, заявки с этим номером
// (общий список и отдельные ключи), согласие, очередь напоминаний и дневной предел записей. Отметку «стоп» оставляем: без неё бот
// и рассылки снова начнут писать человеку, который просил не писать. Списки рассылок удаляются сами через 180 дней.
/** @import { Env } from "../../lib/types.js" */
import { kvRetry } from "../../db/kv/retry.js";
import { allLeads, loadLeads, saveLeads, leadKey } from "../../db/kv/leads.js";
import { logTurns } from "../../db/kv/chats.js";
import { isoDay } from "../../lib/time.js";

/** @param {Env} env @param {string} cid @param {string} ch @param {string} id @param {string} phone номер чата WhatsApp в виде +7…; у веб-чата пусто: номер там набран посетителем, он мог быть чужим @param {string} loc локация Altegio или "" @param {number} now @returns {Promise<{ leads: number }>} */
export async function eraseClient(env, cid, ch, id, phone, loc, now) {
  const hk = `h:${ch}:${cid}:${id}`, digits = phone.replace(/\D/g, "");
  const h = JSON.parse((await env.KV.get(hk)) || "null");
  if (h && h.profile && h.profile.stop) await logTurns(env.KV, hk, [], (pr, all) => { all.turns = []; for (const k of Object.keys(pr)) if (k !== "stop" && k !== "pausedUntil") delete pr[k]; }); // бот молчит, пока стоит пауза «стопа»
  else await env.KV.delete(hk);
  let n = 0;
  if (phone) {
    const ids = new Set((await allLeads(env, cid)).filter(l => l.phone === phone).map(l => l.id));
    n = ids.size;
    for (const lid of ids) await env.KV.delete(leadKey(cid, lid));
    if (ids.size) await kvRetry(async () => { const list = await loadLeads(env.KV, cid); await saveLeads(env.KV, cid, list.filter(l => !ids.has(l.id))); });
  }
  if (digits) for (const k of [`consent:wa:${cid}:${digits}`, `consent:ga:${cid}:${digits}`, ...(loc ? [`bk:${loc}:${phone}:${isoDay(now)}`] : [])]) await env.KV.delete(k);
  await kvRetry(async () => {
    const q = JSON.parse((await env.KV.get("rmq:" + cid)) || "[]"), keep = q.filter((/** @type {any} */ x) => !(x.ch === ch && x.id === id));
    if (keep.length !== q.length) await env.KV.put("rmq:" + cid, JSON.stringify(keep));
  });
  return { leads: n };
}
