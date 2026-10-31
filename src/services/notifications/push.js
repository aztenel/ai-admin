// @ts-check
// Push-уведомления на телефоны и компьютеры сотрудников (ТЗ v2.0 §3, 31.10.2026): пульт /app/ подписывает устройство
// (Web Push: iPhone — только пульт, добавленный на экран «Домой», iOS 16.4+; Android и компьютер — Chrome, Edge, Firefox).
// pushNotify — одно событие (новое сообщение, ответ на рассылку, перенос и т. п.) → устройствам сотрудников этой компании.
// На экран блокировки по умолчанию — без текста и без имени клиента («Новое сообщение · второй номер»): текст — только если
// сотрудник сам включил это на своём устройстве. Не беспокоить — по часам Астаны; «номер не работает» приходит всегда.
// Ключи VAPID: переменные VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (Secret) / VAPID_SUBJECT, иначе создаются сами и лежат в KV
// (новый секрет Cloudflare доходит только до новых черновиков — владельцу ничего настраивать не нужно).
// Доставку обещать нельзя: службы push (Apple, Google) доставляют, когда могут; на iPhone — только с экрана «Домой».
/** @import { Env } from "../../lib/types.js" */
/** @import { VapidPair } from "../integrations/webpush/crypto.js" */
import { CLIENTS, hasClient } from "../../config/builtin-clients.js";
import { local } from "../../lib/time.js";
import { hash } from "../../lib/crypto.js";
import { notifyOnce } from "./telegram.js";
import { opName } from "../inbox/operator.js";
import { staffMark } from "../auth/session.js";
import { webpushSend, pushHostOk } from "../integrations/webpush/client.js";
import { vapidGenerate, vapidOk, unb64u, p256Ok } from "../integrations/webpush/crypto.js";
import { pushVapidGet, pushVapidPut, pushSubId, pushSubGet, pushSubPut, pushSubDel, pushSubs, pushSeen } from "../../db/kv/push.js";

/** @typedef {"inbound" | "campaign_reply" | "booking_change" | "unassigned" | "send_failed" | "channel_down"} PushKind */
/**
 * Событие для pushNotify. key — для отсечения повторов (номер сообщения у провайдера и т. п.): то же событие за 10 минут — один раз.
 * text — полный текст: на устройство уходит, только если там включено «показывать текст»; line — какой номер («второй номер»);
 * assignee — имя ответственного сотрудника: тогда только на его устройства (если у него их нет — всем); badge — число на значке;
 * critical — и в Telegram (не чаще раза в 10 минут на компанию и вид), и в часы «не беспокоить».
 * @typedef {{ kind: PushKind, key: string, chat?: { ch: "wa" | "ga" | "web", id: string }, title?: string, text?: string, line?: string, assignee?: string, badge?: number, critical?: boolean }} PushEvent
 */

export const PUSH_KINDS = /** @type {PushKind[]} */ (["inbound", "campaign_reply", "booking_change", "unassigned", "send_failed", "channel_down"]);
// что видно на экране блокировки без текста сообщения
const GENERIC = /** @type {Record<PushKind, string>} */ ({
  inbound: "Новое сообщение", campaign_reply: "Ответ на рассылку", booking_change: "Перенос, отмена или опоздание",
  unassigned: "Новый чат без ответственного", send_failed: "Сообщение не доставлено", channel_down: "Номер WhatsApp не работает",
});
const URGENT = new Set(["inbound", "campaign_reply", "booking_change", "channel_down"]);
const MAX_SUBS = 50;

/** Настройки устройства из запроса: виды, «не беспокоить» (часы Астаны) и «показывать текст». @param {any} v */
export function prefsOf(v) {
  const p = v && typeof v === "object" ? v : {}, k = p.kinds && typeof p.kinds === "object" ? p.kinds : {};
  const hour = (/** @type {any} */ x) => Number.isInteger(x) && x >= 0 && x <= 23 ? x : null;
  const q = p.quiet && typeof p.quiet === "object" ? { from: hour(p.quiet.from), to: hour(p.quiet.to) } : null;
  return {
    kinds: Object.fromEntries(PUSH_KINDS.map(n => [n, k[n] !== false])),
    quiet: q && q.from !== null && q.to !== null && q.from !== q.to ? /** @type {{ from: number, to: number }} */ (q) : null,
    text: p.text === true,
  };
}
/** Сейчас «не беспокоить»? @param {{ quiet: { from: number, to: number } | null }} prefs @param {number} now */
export function quietNow(prefs, now) {
  if (!prefs.quiet) return false;
  const h = local(now).getUTCHours(), { from, to } = prefs.quiet;
  return from < to ? h >= from && h < to : h >= from || h < to; // 22 → 8 — через полночь
}

// ключи VAPID: память экземпляра → переменные → KV → новые (первый раз)
/** @type {WeakMap<object, VapidPair>} */
const keyCache = new WeakMap();
/** @param {Env} env @returns {Promise<(VapidPair & { subject: string }) | null>} */
export async function vapidKeys(env) {
  const subject = String(env.VAPID_SUBJECT || "") || (env.OWNER_EMAIL ? "mailto:" + env.OWNER_EMAIL : String(env.SITE_URL || "https://ai-admin.azikonps4.workers.dev"));
  if (env.VAPID_PUBLIC_KEY || env.VAPID_PRIVATE_KEY) { // заданы переменными — только они (неверные — push выключен, а не тихо подменён)
    const v = { publicKey: String(env.VAPID_PUBLIC_KEY || "").trim(), privateKey: String(env.VAPID_PRIVATE_KEY || "").trim() };
    return (await vapidOk(v)) ? { ...v, subject } : null;
  }
  const mem = keyCache.get(env.KV);
  if (mem) return { ...mem, subject };
  let v = await pushVapidGet(env);
  if (!(await vapidOk(v))) { v = await vapidGenerate(); await pushVapidPut(env, v); }
  keyCache.set(env.KV, v);
  return { publicKey: v.publicKey, privateKey: v.privateKey, subject };
}

/** Подписка из браузера → { endpoint, keys } или null (не та служба, не те ключи). @param {any} v */
export function subOf(v) {
  if (!v || typeof v !== "object" || !pushHostOk(v.endpoint) || !v.keys || typeof v.keys !== "object") return null;
  const { p256dh, auth } = v.keys;
  if (typeof p256dh !== "string" || typeof auth !== "string" || p256dh.length > 100 || auth.length > 40) return null;
  try { if (!p256Ok(unb64u(p256dh)) || unb64u(auth).length !== 16) return null; } catch (e) { return null; }
  return { endpoint: String(v.endpoint), keys: { p256dh, auth } };
}

/** Что пульт спрашивает при открытии настроек. @param {Env} env @param {string} cid */
export async function pushConfig(env, cid) {
  const k = await vapidKeys(env);
  let devices = 0; try { devices = (await pushSubs(env, cid)).length; } catch (e) {}
  return k ? { enabled: true, key: k.publicKey, devices } : { enabled: false, key: "", devices, why: "Ключи push на сервере заданы неверно (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)." };
}

/**
 * Подписать устройство (или обновить подписку: та же подписка — тот же ключ KV).
 * Подписка живёт не дольше входа, которым её сделали (until — срок сессии), а подписка сотрудника — пока действует его ключ (mk —
 * отпечаток ключа сотрудника): уволенному сотруднику после смены ключа уведомления не приходят (проверка безопасности 31.10.2026).
 * @param {Env} env @param {string} cid @param {any} b { sub, op, prefs } @param {{ role: string, exp?: number }} s сессия @param {string} ua @param {number} now
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function pushSubscribe(env, cid, b, s, ua, now) {
  const role = s && s.role;
  const sub = subOf(b.sub);
  if (!sub) return { status: 400, body: { error: "Браузер прислал подписку, которую сервер не принимает. Обновите страницу и включите ещё раз." } };
  const k = await vapidKeys(env);
  if (!k) return { status: 503, body: { error: "Push на сервере не настроен." } };
  const id = await pushSubId(sub.endpoint), was = await pushSubGet(env, cid, id);
  if (!was && (await pushSubs(env, cid, MAX_SUBS + 1)).length >= MAX_SUBS) return { status: 409, body: { error: `У компании уже ${MAX_SUBS} устройств с уведомлениями. Выключите их на старых устройствах.` } };
  const prefs = prefsOf(b.prefs !== undefined ? b.prefs : was && was.prefs);
  const op = b.op !== undefined ? opName(b.op) : (was && was.op) || "";
  const mk = role === "owner" ? "" : await staffMark(env, cid), until = Number((s && s.exp) || 0) || now + 30 * 86400e3;
  await pushSubPut(env, cid, id, { ...sub, op, role: role === "owner" ? "owner" : "staff", prefs, at: (was && was.at) || now, seen: now, vk: k.publicKey, ua: String(ua || "").slice(0, 160), mk, until });
  return { status: 200, body: { ok: true, prefs, op } };
}
/** Настройки этого устройства. @param {Env} env @param {string} cid @param {any} b { endpoint, prefs, op } */
export async function pushPrefsSet(env, cid, b) {
  if (!pushHostOk(b.endpoint)) return { status: 400, body: { error: "Устройство не подписано." } };
  const id = await pushSubId(String(b.endpoint)), was = await pushSubGet(env, cid, id);
  if (!was) return { status: 404, body: { error: "Уведомления на этом устройстве выключены — включите их заново." } };
  const prefs = b.prefs !== undefined ? prefsOf(b.prefs) : prefsOf(was.prefs), op = b.op !== undefined ? opName(b.op) : was.op || "";
  await pushSubPut(env, cid, id, { ...was, prefs, op });
  return { status: 200, body: { ok: true, prefs, op } };
}
/** @param {Env} env @param {string} cid @param {any} b { endpoint } */
export async function pushUnsubscribe(env, cid, b) {
  if (!pushHostOk(b.endpoint)) return { status: 200, body: { ok: true } };
  await pushSubDel(env, cid, await pushSubId(String(b.endpoint)));
  return { status: 200, body: { ok: true } };
}

// проверка: не чаще раза в 10 секунд на устройство (память экземпляра)
/** @type {Map<string, number>} */
const lastTest = new Map();
/** Проверочное уведомление — только на это устройство. @param {Env} env @param {string} cid @param {any} b { endpoint } @param {number} now */
export async function pushTest(env, cid, b, now) {
  if (!pushHostOk(b.endpoint)) return { status: 400, body: { error: "Устройство не подписано." } };
  const id = await pushSubId(String(b.endpoint)), sub = await pushSubGet(env, cid, id);
  if (!sub || !(await subLive(env, cid, sub, now))) { if (sub) await pushSubDel(env, cid, id); return { status: 404, body: { error: "Уведомления на этом устройстве выключены — включите их заново." } }; }
  if (now - (lastTest.get(id) || 0) < 10e3) return { status: 429, body: { error: "Проверка уже отправлена — подождите несколько секунд." } };
  lastTest.set(id, now);
  const k = await vapidKeys(env);
  if (!k) return { status: 503, body: { error: "Push на сервере не настроен." } };
  const c = CLIENTS[cid], r = await webpushSend(sub, { t: (c && c.name) || "Пульт", b: "Проверка: уведомления на этом устройстве работают", u: `/app/?c=${encodeURIComponent(cid)}#/settings/notifications`, g: "test", k: "test" }, k, { ttl: 300, urgency: "high", now });
  if (r.gone) { await pushSubDel(env, cid, id); return { status: 410, body: { error: "Служба уведомлений браузера отозвала подписку. Включите уведомления заново." } }; }
  if (!r.ok) return { status: 502, body: { error: r.status ? `Служба уведомлений ответила ошибкой ${r.status}. Попробуйте позже.` : "Служба уведомлений не ответила. Попробуйте позже." } };
  return { status: 200, body: { ok: true } };
}

/** Подписка ещё действует: вход, которым её сделали, не истёк, ключ сотрудника не меняли. Старые подписки без срока — до 30 дней
 *  с последнего входа. @param {Env} env @param {string} cid @param {any} s @param {number} now */
async function subLive(env, cid, s, now) {
  if ((+s.until || (+s.seen || +s.at || 0) + 30 * 86400e3) < now) return false;
  if (s.role === "staff") { const cur = await staffMark(env, cid); return !!cur && s.mk === cur; }
  return true;
}

// повторы: память экземпляра (одновременные вебхуки) + KV (другие экземпляры)
/** @type {Map<string, number>} */
const recent = new Map();
/**
 * Отправить событие устройствам сотрудников компании. Никогда не бросает исключение. → { sent, skipped }
 * @param {Env} env @param {string} cid @param {PushEvent} ev
 */
export async function pushNotify(env, cid, ev) {
  const res = { sent: 0, skipped: 0 };
  try {
    if (!hasClient(cid) || !ev || !PUSH_KINDS.includes(ev.kind)) return res;
    const now = Date.now(), dk = `${ev.kind}:${hash(String(ev.key || ""))}`;
    if (ev.key) {
      const mk = cid + ":" + dk;
      if ((recent.get(mk) || 0) > now - 600e3) return res;
      if (recent.size > 2000) recent.clear();
      recent.set(mk, now);
      try { if (await pushSeen(env, cid, dk)) return res; } catch (e) { console.log("push seen", String(e)); }
    }
    const c = CLIENTS[cid], company = String((c && c.name) || "Пульт");
    if (ev.critical) { try { await notifyOnce(env, `push:${cid}:${ev.kind}`, `⚠️ ${company}: ${GENERIC[ev.kind]}${ev.line ? ` (${String(ev.line).slice(0, 40)})` : ""}`, cid); } catch (e) {} }
    const subs = await pushSubs(env, cid), live = await Promise.all(subs.map(s => subLive(env, cid, s, now)));
    // вход истёк или ключ сотрудника сменили — подписку удаляем, ему не пишем
    await Promise.all(subs.filter((_, i) => !live[i]).map(s => pushSubDel(env, cid, s.id).catch(() => {})));
    const all = subs.filter((_, i) => live[i]);
    if (!all.length) return res;
    const k = await vapidKeys(env);
    if (!k) { res.skipped = all.length; return res; }
    // ответственный: только его устройства (по имени на устройстве); если у него устройств нет — всем
    const who = opName(ev.assignee || "").toLowerCase(), mine = who ? all.filter(s => String(s.op || "").toLowerCase() === who) : [];
    const pool = mine.length ? mine : all;
    const target = pool.filter(s => { const p = prefsOf(s.prefs); return p.kinds[ev.kind] && (ev.critical || !quietNow(p, now)); });
    res.skipped = all.length - target.length;
    const chat = ev.chat && /^(wa|ga|web)$/.test(ev.chat.ch) && /^[a-zA-Z0-9-]{1,64}$/.test(String(ev.chat.id)) ? ev.chat : null;
    const conv = chat ? `${chat.ch}:${chat.id}` : "";
    const url = `/app/?c=${encodeURIComponent(cid)}#/inbox${conv ? "/" + encodeURIComponent(conv) : ""}`;
    const tag = conv ? "c" + hash(cid + ":" + conv).toString(36) : "k" + ev.kind; // в метке и в Topic — без номера клиента
    const line = ev.line ? String(ev.line).slice(0, 40) : "";
    const out = await Promise.allSettled(target.map(async s => {
      if (s.vk && s.vk !== k.publicKey) { await pushSubDel(env, cid, s.id); return false; } // подписка на старый ключ сервера: пульт подпишет заново
      const p = prefsOf(s.prefs), text = p.text && ev.text ? String(ev.text).replace(/\s+/g, " ").trim().slice(0, 160) : "";
      const data = {
        t: p.text && ev.title ? String(ev.title).slice(0, 60) : company,
        b: text ? (line ? `${line}: ${text}` : text) : GENERIC[ev.kind] + (line ? " · " + line : ""),
        u: url, g: tag, k: ev.kind, ...(conv ? { c: conv } : {}), ...(Number.isFinite(ev.badge) ? { n: Math.max(0, Math.min(999, Math.round(/** @type {number} */ (ev.badge)))) } : {}),
      };
      const r = await webpushSend(s, data, k, { ttl: ev.critical ? 86400 : ev.kind === "inbound" || ev.kind === "campaign_reply" ? 6 * 3600 : 12 * 3600, urgency: URGENT.has(ev.kind) ? "high" : "normal", topic: tag, now });
      if (r.gone) { await pushSubDel(env, cid, s.id); return false; }
      if (!r.ok) console.log("push send", ev.kind, r.status);
      return r.ok;
    }));
    res.sent = out.filter(x => x.status === "fulfilled" && x.value === true).length;
    res.skipped += target.length - res.sent;
  } catch (e) { console.log("push", String(e)); }
  return res;
}
