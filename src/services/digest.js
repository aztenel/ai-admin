// @ts-check
// Дневная сводка в Telegram (digestRun, digestText).
/** @import { Env, Client } from "../lib/types.js" */
import { local, isoDay } from "../lib/time.js";
import { CLIENTS } from "../config/builtin-clients.js";
import { DIGEST_HOUR } from "../config/constants.js";
import { allLeads, leadTs } from "../db/kv/leads.js";
import { notify } from "./integrations/telegram/client.js";
import { DYN, syncClients } from "./tenants/passport.js";
import { dayLabel } from "./schedule/slots.js";
// Дневная сводка в Telegram компании: раз в день, в час из паспорта (по умолчанию 21:00 по Астане; утром — за вчерашний день).
// Только боты из паспортов (демо — без сводки). Отметка «отправлено» ставится до отправки: сводка не придёт дважды
/** @param {Env} env @param {number} now @returns {Promise<number>} */
export async function digestRun(env, now) {
  const d = local(now), h = d.getUTCHours();
  if (d.getUTCMinutes() >= 10 || !env.TG_TOKEN) return 0;
  const due = (/** @type {Client} */ c) => c.dynamic && !c.off && c.digest !== "off" && (c.digest ? +c.digest : DIGEST_HOUR) === h;
  if (!DYN.at || Object.values(CLIENTS).some(due)) { try { await syncClients(env); } catch (e) { console.log("cfg", String(e)); } } // паспорта перечитываем, только если сейчас чей-то час сводки
  let n = 0;
  for (const c of Object.values(CLIENTS)) {
    if (!due(c)) continue;
    const mk = `dg:${c.id}:${isoDay(now)}`;
    try { if (await env.KV.get(mk)) continue; await env.KV.put(mk, "1", { expirationTtl: 3 * 86400 }); } catch (e) { console.log("digest mark", String(e)); continue; }
    try { if (await notify(env, await digestText(env, c, now, h < 12), c.id)) n++; } catch (e) { console.log("digest", String((e && /** @type {any} */ (e).stack) || e)); }
  }
  return n;
}
/** @param {Env} env @param {Client} c @param {number} now @param {boolean=} prevDay @returns {Promise<string>} */
export async function digestText(env, c, now, prevDay) {
  const d = local(now), start = now - (((d.getUTCHours() * 60 + d.getUTCMinutes()) * 60 + d.getUTCSeconds()) * 1000 + d.getUTCMilliseconds());
  const from = prevDay ? start - 86400e3 : start, to = prevDay ? start : now + 1;
  let wa = 0, web = 0, need = 0, part = false;
  for (const ch of ["wa", "ga", "web"]) { // чаты — по метаданным ключей истории (как список в пульте), без чтения самих чатов
    const prefix = `h:${ch}:${c.id}:`;
    for (let cursor, page = 0; page < 3; page++) {
      /** @type {any} */
      const r = await env.KV.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      for (const k of (r && r.keys) || []) {
        const m = k.metadata || {}, t = ch === "web" ? m.t || 0 : m.li || m.t || 0;
        if (t >= from && t < to) { if (ch === "web") web++; else wa++; }
        if (m.nd) need++;
      }
      if (!r || r.list_complete || !r.cursor) break;
      cursor = r.cursor; if (page === 2) part = true;
    }
  }
  let leads = []; try { leads = (await allLeads(env, c.id)).filter(l => { const t = leadTs(l); return t >= from && t < to; }); } catch (e) { console.log("digest leads", String(e)); }
  const cnt = (/** @type {(l: any) => any} */ f) => leads.filter(f).length;
  const alt = cnt((/** @type {any} */ l) => !l.kind && l.altegio && l.altegio.record_id), req = cnt((/** @type {any} */ l) => !l.kind && !(l.altegio && l.altegio.record_id)), cb = cnt((/** @type {any} */ l) => l.kind === "callback"), cx = cnt((/** @type {any} */ l) => l.kind === "cancel" || l.kind === "change");
  const when = (prevDay ? "вчера, " : "сегодня, ") + dayLabel(local(from)), site = String(env.SITE_URL || "").replace(/\/+$/, "");
  const L = [`📊 Сводка за ${when} — ${c.name}`];
  if (!wa && !web && !leads.length) L.push(`За ${prevDay ? "вчера" : "сегодня"} обращений не было.`);
  else {
    L.push(`Чатов в WhatsApp: ${wa} · на сайте: ${web}${part ? " (показаны не все)" : ""}`);
    L.push((c.booking === "altegio" || alt ? `Записей в Altegio: ${alt} · ` : "") + `заявок на запись: ${req}`);
    L.push(`Просят перезвонить: ${cb} · просьб об отмене и переносе: ${cx}`);
  }
  if (need) L.push(`Ждут ответа: ${need}`);
  if (/^https:\/\//.test(site)) L.push(`Пульт: ${site}/inbox?c=${c.id}`);
  return L.join("\n");
}
