// @ts-check
// Web Push: отправка одного сообщения в службу push браузера (Apple, Google, Mozilla, Microsoft). Адрес подписки приходит
// из браузера — поэтому только https и только хосты этих служб (иначе сервер стучался бы по любому адресу — SSRF),
// без перенаправлений, 5 секунд. 404/410 — подписки больше нет (gone): её надо удалить.
/** @import { VapidPair } from "./crypto.js" */
import { encrypt, vapidAuth } from "./crypto.js";

// службы push: Safari (iPhone, Mac) — web.push.apple.com, Chrome и Android — fcm.googleapis.com, Firefox — Mozilla, Edge — WNS
const HOSTS = [/^([a-z0-9-]+\.)*push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

/** Адрес подписки можно использовать: https, хост службы push, без порта и логина, не длиннее 1024. @param {any} endpoint */
export function pushHostOk(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > 1024) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && !u.username && !u.password && HOSTS.some(r => r.test(u.hostname));
  } catch (e) { return false; }
}

/**
 * @param {{ endpoint: string, keys: { p256dh: string, auth: string } }} sub
 * @param {Record<string, any>} data что показать (JSON, до ~3 КБ)
 * @param {VapidPair & { subject: string }} vapid
 * @param {{ ttl?: number, urgency?: "very-low" | "low" | "normal" | "high", topic?: string, now?: number }} [opt]
 * @returns {Promise<{ ok: boolean, status: number, gone: boolean }>}
 */
export async function webpushSend(sub, data, vapid, opt = {}) {
  if (!pushHostOk(sub.endpoint)) return { ok: false, status: 0, gone: true };
  const body = await encrypt(JSON.stringify(data), sub.keys.p256dh, sub.keys.auth);
  /** @type {Record<string, string>} */
  const headers = {
    "content-type": "application/octet-stream", "content-encoding": "aes128gcm",
    ttl: String(Math.max(0, Math.round(opt.ttl ?? 3600))), urgency: opt.urgency || "normal",
    authorization: await vapidAuth(sub.endpoint, vapid, vapid.subject, opt.now || Date.now()),
  };
  if (opt.topic && /^[A-Za-z0-9_-]{1,32}$/.test(opt.topic)) headers.topic = opt.topic; // новое сообщение того же чата заменяет недоставленное
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 5000);
  try {
    const r = await fetch(sub.endpoint, { method: "POST", headers, body, redirect: "manual", signal: ac.signal });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, gone: r.status === 404 || r.status === 410 };
  } catch (e) {
    return { ok: false, status: 0, gone: false };
  } finally { clearTimeout(timer); }
}
