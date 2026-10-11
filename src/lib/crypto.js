// @ts-nocheck — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// Быстрый нестойкий хеш строки (FNV-1a) — для стабильных «случайностей» и ключей, не для безопасности.
export function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

// HMAC-SHA256 в base64url и сравнение строк за постоянное время (вход, cookie, пароль вебхука)
export const enc8 = new TextEncoder();
export const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function hmacB64(secret, msg) {
  const k = await crypto.subtle.importKey("raw", enc8.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc8.encode(msg)));
}
export const safeEq = (a, b) => { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < a.length && i < b.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// подпись Meta: заголовок x-hub-signature-256 = "sha256=" + HMAC-SHA256(App secret, тело запроса)
export async function metaSigOk(secret, raw, header) {
  if (!header || !header.startsWith("sha256=")) return false;
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(raw)));
  const want = [...mac].map(b => b.toString(16).padStart(2, "0")).join(""), got = header.slice(7).toLowerCase();
  if (got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}
