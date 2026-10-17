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
// Только боты из паспортов и встроенные боты со своим чатом TG_CHAT_<ID> (демо — без сводки). Отметка «отправлено» ставится до отправки: сводка не придёт дважды
/** @param {Env} env @param {number} now @returns {Promise<number>} */
export async function digestRun(env, now) {
  const d = local(now), h = d.getUTCHours();
  if (d.getUTCMinutes() >= 10 || !env.TG_TOKEN) return 0;
  // боты из паспорта и встроенные боты со своим чатом Telegram (Winchester до переноса в паспорт, 16.10.2026). Демо-ботам без своего чата сводку не шлём
  const due = (/** @type {Client} */ c) => (c.dynamic || !!env["TG_CHAT_" + c.id.toUpperCase()]) && !c.off && c.digest !== "off" && (c.digest ? +c.digest : DIGEST_HOUR) === h;
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
// обращения и заявки бизнеса за промежуток [from, to): чаты — по метаданным ключей истории (как список в пульте, без чтения самих чатов;
// чат считается по последнему сообщению клиента), заявки — по списку заявок (хранится 30 дней)
/** @param {Env} env @param {Client} c @param {number} from @param {number} to */
export async function countPeriod(env, c, from, to) {
  let wa = 0, web = 0, need = 0, part = false;
  for (const ch of ["wa", "ga", "web"]) {
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
  return { wa, web, need, part, leads: leads.length,
    alt: cnt((/** @type {any} */ l) => !l.kind && l.altegio && l.altegio.record_id), req: cnt((/** @type {any} */ l) => !l.kind && !(l.altegio && l.altegio.record_id)),
    cb: cnt((/** @type {any} */ l) => l.kind === "callback"), cx: cnt((/** @type {any} */ l) => l.kind === "cancel" || l.kind === "change") };
}
/** @param {Env} env @param {Client} c @param {number} now @param {boolean=} prevDay @returns {Promise<string>} */
export async function digestText(env, c, now, prevDay) {
  const d = local(now), start = now - (((d.getUTCHours() * 60 + d.getUTCMinutes()) * 60 + d.getUTCSeconds()) * 1000 + d.getUTCMilliseconds());
  const from = prevDay ? start - 86400e3 : start, to = prevDay ? start : now + 1;
  const { wa, web, need, part, leads: nLeads, alt, req, cb, cx } = await countPeriod(env, c, from, to), leads = { length: nLeads };
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

// ---- отчёт роста за 30 дней (план проверки модулей, модуль 10, 16.10.2026). Заявки хранятся 30 дней, поэтому для сравнения с прошлым
// периодом бот каждую ночь (00:00–00:10 по Астане) сохраняет итоги прошедшего дня (ds:<клиент>:<день>, год). Настоящие бизнесы:
// бот из паспорта, свой чат Telegram или свой номер WhatsApp — у демо-ботов итоги не копятся
/** @param {Env} env @param {Client} c */
const realBiz = (env, c) => !!(c.dynamic || env["TG_CHAT_" + c.id.toUpperCase()] || env["WA_TOKEN_" + c.id.toUpperCase()] || env["GA_ID_" + c.id.toUpperCase()]);
const DS_KEYS = /** @type {const} */ (["wa", "web", "alt", "req", "cb", "cx"]);
/** @param {Env} env @param {number} now @returns {Promise<number>} */
export async function dayStatsRun(env, now) {
  const d = local(now);
  if (d.getUTCHours() !== 0 || d.getUTCMinutes() >= 10) return 0;
  const start = now - (((d.getUTCMinutes()) * 60 + d.getUTCSeconds()) * 1000 + d.getUTCMilliseconds()), day = isoDay(start - 1);
  let n = 0;
  for (const c of Object.values(CLIENTS)) {
    if (!realBiz(env, c)) continue;
    const k = `ds:${c.id}:${day}`;
    try {
      if (await env.KV.get(k)) continue;
      const r = await countPeriod(env, c, start - 86400e3, start), o = /** @type {Record<string, number>} */ ({});
      for (const x of DS_KEYS) o[x] = r[x];
      await env.KV.put(k, JSON.stringify(o), { expirationTtl: 400 * 86400 }); n++;
    } catch (e) { console.log("day stats", c.id, String(e)); }
  }
  return n;
}
/** итоги за последние days дней и за такой же период до них. Прошлый период — из дневных итогов; если их меньше двух третей периода, prev = null
 * @param {Env} env @param {Client} c @param {number} now @param {number=} days */
export async function growthReport(env, c, now, days = 30) {
  const cur = await countPeriod(env, c, now - days * 86400e3, now + 1);
  const prev = /** @type {Record<string, number>} */ ({ wa: 0, web: 0, alt: 0, req: 0, cb: 0, cx: 0 });
  let have = 0;
  for (let i = days + 1; i <= 2 * days; i++) {
    let v = null; try { v = JSON.parse((await env.KV.get(`ds:${c.id}:${isoDay(now - i * 86400e3)}`)) || "null"); } catch (e) {}
    if (v) { have++; for (const x of DS_KEYS) prev[x] += +v[x] || 0; }
  }
  const pick = (/** @type {Record<string, any>} */ o) => ({ chats: (o.wa || 0) + (o.web || 0), alt: o.alt || 0, req: o.req || 0, cb: o.cb || 0, cx: o.cx || 0 });
  return { days, cur: pick(cur), prev: have >= Math.ceil(days * 2 / 3) ? pick(prev) : null, prevDays: have };
}
