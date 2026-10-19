// @ts-check
// Ежедневная проверка номера WhatsApp (план проверки модулей, модуль 10, 16.10.2026). Meta сообщает о падении качества вебхуком
// (waSignal), но через Wazzapo такие события не приходят. Раз в день в 10:00 по Астане бот сам спрашивает качество и предел
// номера (bcHealth: Meta или Wazzapo) и пишет администратору: качество жёлтое или красное (каждый день, пока так), номер не отвечает,
// предел получателей уменьшился. Всё в порядке — тишина.
/** @import { Env } from "../../lib/types.js" */
import { CLIENTS } from "../../config/builtin-clients.js";
import { local, isoDay } from "../../lib/time.js";
import { waRoute } from "../channels/index.js";
import { notify } from "../integrations/telegram/client.js";
import { bcHealth } from "./sender.js";
import { autoLoad } from "../../db/kv/crm.js";

const QL = /** @type {Record<string, string>} */ ({ YELLOW: "жёлтое (жалобы клиентов растут)", RED: "красное (номер могут ограничить)" });

/** @param {Env} env @param {number} now @returns {Promise<number>} сколько сигналов отправлено */
export async function qualityRun(env, now) {
  const d = local(now);
  // без TG_TOKEN тоже проверяем и записываем qual: — по нему автосценарий «Пора на стрижку» решает, можно ли сегодня маркетинг
  // (без записи он пропускал бы каждый день молча: находка проверки 19.10.2026); сигналы в Telegram — только с TG_TOKEN (notify)
  if (d.getUTCHours() !== 10 || d.getUTCMinutes() >= 10) return 0;
  let n = 0;
  for (const c of Object.values(CLIENTS)) {
    if (c.off || !env["WA_TOKEN_" + c.id.toUpperCase()]) continue; // свой номер Meta или Wazzapo
    const route = waRoute(env, c.id);
    if (!route) continue;
    const mk = `qch:${c.id}:${isoDay(now)}`;
    try { if (await env.KV.get(mk)) continue; await env.KV.put(mk, "1", { expirationTtl: 3 * 86400 }); } catch (e) { console.log("quality mark", String(e)); continue; }
    const { h, prev } = await qualityFetch(env, c, now);
    const L = [];
    if (h.error) L.push(`Не удалось проверить номер WhatsApp: ${h.error}`);
    else {
      if (QL[h.quality]) L.push(`Качество номера WhatsApp — ${QL[h.quality]}. Сократите рассылки и проверьте, на что жалуются клиенты.`);
      if (prev && prev.limit > 0 && h.limit > 0 && h.limit < prev.limit) L.push(`Предел Meta уменьшился: было ${prev.limit} получателей за 24 часа, стало ${h.limit}.`);
      if (prev && QL[prev.quality] && h.quality === "GREEN") L.push("Качество номера снова зелёное ✅");
      // качество не пришло (поле ответа Wazzapo вживую не проверено) — автосценарий без него не пишет; включённый — пусть владелец знает почему
      if (!h.quality && c.crm) { /** @type {any} */ let a = null; try { a = await autoLoad(env, c.id); } catch (e) {} if (a && a.on) L.push("Meta (или Wazzapo) не сообщили качество номера — автосценарий «Пора на стрижку» сегодня не отправит. Если так каждый день, скажите разработчику."); }
    }
    if (L.length && await notify(env, `📶 Номер WhatsApp — ${c.name}${h.phone ? " (" + h.phone + ")" : ""}\n${L.join("\n")}`, c.id)) n++;
  }
  return n;
}
// спросить качество и предел номера сейчас и записать qual:<клиент> → { h, prev, q }: h.error — не узнали; prev — прошлая проверка;
// q — что записано (null — не узнали). Им пользуются проверка в 10:00 и автосценарий в 11:00, если утренняя не удалась
/** @param {Env} env @param {any} c @param {number} now @returns {Promise<{ h: any, prev: any, q: { quality: string, limit: number, at: number } | null }>} */
export async function qualityFetch(env, c, now) {
  const route = waRoute(env, c.id), qk = `qual:${c.id}`;
  /** @type {any} */ let h; try { h = route ? await bcHealth(env, route) : { error: "номер WhatsApp не подключён" }; } catch (e) { h = { error: "сведения о номере не получены" }; }
  /** @type {any} */ let prev = null; try { prev = JSON.parse((await env.KV.get(qk)) || "null"); } catch (e) {}
  if (h.error) return { h, prev, q: null };
  const q = { quality: String(h.quality || ""), limit: +h.limit || 0, at: now };
  try { await env.KV.put(qk, JSON.stringify(q), { expirationTtl: 60 * 86400 }); } catch (e) { console.log("quality save", String(e)); }
  return { h, prev, q };
}
// последняя проверка номера (qual:<клиент>, пишет qualityRun в 10:00): { quality, limit, at } или null — не проверяли.
// Сбой чтения — ошибка, а не «всё хорошо»: автосценарий в такой день лучше пропустить
/** @param {Env} env @param {string} cid @returns {Promise<{ quality: string, limit: number, at: number } | null>} */
export const qualityGet = async (env, cid) => JSON.parse((await env.KV.get(`qual:${cid}`)) || "null");
