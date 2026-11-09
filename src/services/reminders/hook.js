// @ts-check
// Вебхук Altegio (ТЗ v4, 08.11.2026: «чтобы нужные сообщения были моментальными, а не через проверку раз в 15 минут»). Altegio присылает
// событие на /alt/<компания>?t=<пароль> (пароль — HMAC ключа владельца LEADS_KEY и компании: в адресе, подписи у Altegio нет).
// Данным события не доверяем и их не храним: событие — только «звонок» (kick.js): отметка, как читать журнал. Журнал своим ключом читает и
// сообщения отправляет фоновая проверка раз в минуту с теми же правилами, пределом 2 сообщения в минуту и защитой от дублей. Событие
// ускоряет то, что без него ждало полного чтения раз в 15 минут: отмену (удаление записи) и бонусы при оплате без изменения записи; новая
// и изменённая запись и так видна минутной проверке. По документации Altegio (разведка 08.11.2026): событие приходит через ~5 с, подписи
// нет, повтор — до 2 раз при 5xx/429/обрыве, порядок не гарантирован. Вживую не проверено: какие события и в каком виде присылает Altegio Winchester.
/** @import { Env, Client } from "../../lib/types.js" */
import { hmacB64, safeEq } from "../../lib/crypto.js";
import { isPreview } from "../../lib/stage.js";
import { kvKey } from "../../lib/kv-id.js";
import { altLoc } from "../booking/book.js";
import { jrOn } from "./journal.js";
import { kickWant } from "./kick.js";
import { altHookSeen, altHookLast } from "../../db/kv/reminders.js";

/** пароль адреса вебхука ("" — без ключа владельца вебхук выключен) @param {Env} env @param {string} cid */
export async function altHookPass(env, cid) {
  if (!env.LEADS_KEY) return "";
  return (await hmacB64(String(env.LEADS_KEY), `alt-hook:${cid}`)).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
}
/** пароль из адреса подходит @param {Env} env @param {string} cid @param {string} t */
export async function altHookOk(env, cid, t) {
  const want = await altHookPass(env, cid);
  return !!want && !!t && safeEq(want, t);
}
/** почему события сейчас не обрабатываются ("" — обрабатываются) @param {Env} env @param {Client} c */
function hookWhy(env, c) {
  if (isPreview(env)) return "Это тестовая версия: здесь события Altegio не обрабатываются. Адрес для Altegio берите в пульте боевого сайта.";
  if (!jrOn(env, c)) return "Автоматические сообщения выключены главным выключателем: события приходят, но сообщения по ним не уходят.";
  return "";
}
/** адрес для настроек Altegio, последнее событие и обрабатываются ли события — владельцу @param {Env} env @param {Client} c @param {string} origin */
export async function altHookInfo(env, c, origin) {
  const pass = await altHookPass(env, c.id), why = hookWhy(env, c);
  return { url: pass ? `${origin}/alt/${c.id}?t=${pass}` : "", last: await altHookLast(env, c.id).catch(() => null), on: !why, why };
}

/** событие → как читать журнал: удаление записи — весь журнал; запись (визит) — изменённые записи; оплата и бонусы — и бонусы визитов;
 *  тело не прочитано (больше предела, не JSON) — изменённые записи (пароль верный, событие было); остальное (клиенты, товары, сотрудники) — ничего
 *  @param {any} body @returns {"" | "fast" | "bonus" | "full"} */
export function hookMode(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "fast";
  const res = String(body.resource || ""), st = String(body.status || "");
  const del = !!body.data && typeof body.data === "object" && (body.data.deleted === true || +body.data.deleted === 1);
  if (res === "record" || res === "visit") return st === "delete" || del ? "full" : "fast";
  if (res === "finances_operation" || /^loyalty/.test(res)) return "bonus";
  return "";
}

const SEEN_GAP = 2000; // «последнее событие» для пульта — не чаще раза в 2 с (один ключ KV — не чаще раза в секунду)
/** @type {WeakMap<object, Map<string, number>>} */
const SEEN = new WeakMap();

/**
 * Событие Altegio → отметка для фоновой проверки. Тело — как в документации YCLIENTS/Altegio: { company_id, resource, resource_id, status, data };
 * чужая локация, событие не о записи и не об оплате, выключенные сообщения, тестовая версия — без отметки (ответ всё равно 200: повтор не
 * поможет). Отметку не записать — { error } (вебхук ответит 503, Altegio повторит). → { mode, why?, error? }
 * @param {Env} env @param {Client} c @param {any} body @param {number} now
 */
export async function altHookEvent(env, c, body, now) {
  const ok = !!body && typeof body === "object" && !Array.isArray(body);
  if (ok && body.company_id != null && +body.company_id !== altLoc(env, c)) return { mode: "", why: "другая локация" };
  const res = ok ? String(body.resource || "").slice(0, 40) : "?", st = ok ? String(body.status || "").slice(0, 20) : "?";
  const store = /** @type {object} */ (kvKey(env.KV) || env);
  let m = SEEN.get(store);
  if (!m) { m = new Map(); SEEN.set(store, m); }
  if (now - (m.get(c.id) || 0) >= SEEN_GAP) {
    m.set(c.id, now);
    try { await altHookSeen(env, c.id, { at: now, res, st }); } catch (e) { console.log("alt hook seen", String(e)); }
  }
  const mode = hookMode(body), why = hookWhy(env, c);
  if (!mode) return { mode, why: "событие не о записи и не об оплате" };
  if (why) return { mode: "", why };
  try { await kickWant(env, c.id, mode, now); }
  catch (/** @type {any} */ e) { console.log("alt hook mark", c.id, String((e && e.message) || e).slice(0, 160)); return { mode, error: true }; }
  return { mode };
}
