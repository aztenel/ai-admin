// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Заявки в KV: общий список leads:<клиент> и отдельные ключи lead:<клиент>:<день>:<id>; чтение с «подлечиванием» списка.
/** @import { Env } from "../../lib/types.js" */
import { LEAD_TTL } from "../../config/constants.js";
import { isoDay } from "../../lib/time.js";

// заявки храним 30 дней
/** @param {Record<string, any>} l @returns {number} */
export const leadTs = l => l.ts || parseInt(String(l.id || "").slice(0, -4), 36) || Date.now();
/** @param {any} store @param {string} cid @returns {Promise<any[]>} */
export async function loadLeads(store, cid) { return JSON.parse((await store.get("leads:" + cid)) || "[]"); }
/** @param {any} store @param {string} cid @param {any[]} leads */
export async function saveLeads(store, cid, leads) {
  const now = Date.now();
  await store.put("leads:" + cid, JSON.stringify(leads.filter(l => now - leadTs(l) < LEAD_TTL).slice(-300)));
}
// каждая заявка хранится ещё и отдельным ключом (с днём в имени): если два чата сохраняли общий список одновременно и заявка из него выпала, страница заявок вернёт её.
// Статус заявки («отменена», «заменена») лежит в метаданных ключа: страница берёт его оттуда, даже если в общем списке он потерялся
/** @param {string} cid @param {string} id */
export const leadKey = (cid, id) => `lead:${cid}:${isoDay(leadTs({ id }))}:${id}`;
// отдельный ключ новой заявки (30 дней)
/** @param {any} store @param {string} cid @param {Record<string, any>} lead */
export async function putLeadKey(store, cid, lead) { await store.put(leadKey(cid, lead.id), JSON.stringify(lead), { expirationTtl: LEAD_TTL / 1000 }); }
/** @param {Env} env @param {string} cid @returns {Promise<any[]>} */
export async function allLeads(env, cid) {
  /** @param {Record<string, any>} l */
  const fresh = l => Date.now() - leadTs(l) < LEAD_TTL;
  /** @type {any[]} */
  let leads = [], readable = true, keysRead = false;
  try { leads = (await loadLeads(env.KV, cid)).filter(fresh); } catch (e) { readable = false; console.log("leads read", String(e)); } // общий список не читается — покажем заявки из отдельных ключей
  try {
    if (typeof env.KV.list === "function") {
      /** @type {any[]} */
      const keys = [];
      for (let cursor, page = 0; page < 3; page++) { // до 3000 ключей: все заявки клиента за 30 дней одним-тремя запросами
        /** @type {any} */
        const r = await env.KV.list({ prefix: `lead:${cid}:`, limit: 1000, ...(cursor ? { cursor } : {}) });
        keys.push(...((r && r.keys) || []));
        if (!r || r.list_complete || !r.cursor) break;
        cursor = r.cursor;
      }
      const have = new Map(leads.map(l => [l.id, l])), miss = [], fixed = new Map();
      // статус в метаданных отдельного ключа — последний записанный; в общем списке он мог устареть (два чата сохраняли список одновременно)
      const apply = /** @param {any} l @param {any} m */ (l, m) => { if (m.status) l.status = m.status; else delete l.status; if (m.note) l.note = m.note; };
      for (const k of keys) {
        const id = String(k.name).split(":").pop(), l = have.get(id), m = k.metadata;
        if (!l) miss.push(k.name);
        else if (m && typeof m.status === "string" && (l.status || "") !== m.status) { apply(l, m); fixed.set(id, m); }
      }
      const got = [];
      for (const name of miss.sort().reverse().slice(0, 60)) { const v = JSON.parse((await env.KV.get(name)) || "null"); if (v && v.id && !have.has(v.id) && fresh(v)) { have.set(v.id, v); got.push(v); } } // сначала самые новые
      if (got.length) { leads.push(...got); leads.sort((a, b) => leadTs(a) - leadTs(b)); }
      keysRead = true;
      if (readable && (got.length || fixed.size)) { // возвращаем в общий список: перечитываем его прямо перед записью и только добавляем, чужих изменений не затираем
        try {
          const cur = await loadLeads(env.KV, cid), ids = new Set(cur.map(l => l.id));
          for (const l of cur) { const m = fixed.get(l.id); if (m && (l.status || "") !== m.status) apply(l, m); }
          for (const v of got) if (!ids.has(v.id)) cur.push(v);
          cur.sort((a, b) => leadTs(a) - leadTs(b));
          await saveLeads(env.KV, cid, cur);
        } catch (e) { console.log("leads heal", String(e)); }
      }
    }
  } catch (e) { console.log("leads heal", String(e)); }
  // общий список не прочитался: «all» — заявок не видно вовсе, «part» — видны только найденные отдельными ключами. Страница заявок скажет об этом, а не покажет «Пока пусто»
  if (!readable) Object.defineProperty(leads, "unread", { value: keysRead ? "part" : "all" });
  return leads;
}
