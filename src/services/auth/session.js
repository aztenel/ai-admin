// @ts-check
// Вход и сессии: cookie, роли владелец/сотрудник, ограничение подбора ключа (состояние loginFails — только здесь).
/** @import { Env } from "../../lib/types.js" */
import { enc8, hmacB64, safeEq } from "../../lib/crypto.js";
import { CLIENTS, hasClient } from "../../config/builtin-clients.js";
import { SESSION_MS, COOKIE } from "../../config/constants.js";
import { ipKey } from "../booking/limits.js";

/** @param {Env} env @returns {string} */
export const leadsKey = env => env.LEADS_KEY || env.VERIFY_TOKEN;

// ================= ВХОД: владелец сервиса и сотрудники клиентов =================
// Вход по ключу один раз, дальше — cookie (30 дней). Ключ в адресе страницы оставлять не нужно.
// Владелец входит ключом LEADS_KEY и видит всё. Сотрудник клиента входит ключом клиента (KEY_<ID> в Cloudflare или ключ, выданный на странице «Мои боты») и видит только своего клиента.
/** @param {any} s @returns {Promise<string>} */
export async function sha256Hex(s) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc8.encode(String(s))))].map(b => b.toString(16).padStart(2, "0")).join(""); }
// отпечаток ключа сотрудника: ключ сменили — прежние сессии перестают действовать
/** @param {Env} env @param {string} cid @returns {Promise<string>} */
async function staffMark(env, cid) {
  if (!hasClient(cid)) return "";
  const ek = env["KEY_" + cid.toUpperCase()], kh = CLIENTS[cid].keyHash;
  // заданы оба ключа (секрет KEY_<ID> и ключ со страницы «Мои боты»): отпечаток от обоих — смена любого закрывает прежние сессии.
  // Один ключ — отпечаток прежний, уже открытые сессии не сбрасываются
  if (ek && kh) return (await sha256Hex("k:" + ek + "|" + kh)).slice(0, 10);
  return ek ? (await sha256Hex("k:" + ek)).slice(0, 10) : kh ? String(kh).slice(0, 10) : "";
}
/** @param {Env} env @param {string} role @param {string} cid @returns {Promise<string>} */
export async function sessionMake(env, role, cid) {
  const body = [role, cid, Date.now() + SESSION_MS, role === "staff" ? await staffMark(env, cid) : "o"].join(".");
  return body + "." + await hmacB64("session:" + leadsKey(env), body);
}
/** @param {Env} env @param {Request} request @returns {Promise<{ role: string, cid: string } | null>} */
export async function sessionRead(env, request) {
  if (!leadsKey(env)) return null;
  const m = new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)").exec(request.headers.get("cookie") || "");
  if (!m) return null;
  const p = m[1].split(".");
  if (p.length !== 5) return null;
  const [role, cid, exp, mark, sig] = p, body = [role, cid, exp, mark].join(".");
  if (!(+exp > Date.now()) || !safeEq(sig, await hmacB64("session:" + leadsKey(env), body))) return null;
  if (role === "owner") return { role, cid: "*" };
  if (role === "staff" && hasClient(cid)) { const cur = await staffMark(env, cid); return cur && safeEq(cur, mark) ? { role, cid } : null; }
  return null;
}
/** @param {string} token @param {number=} maxAge @returns {string} */
export const cookieSet = (token, maxAge = SESSION_MS / 1000) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
// кто входит с этим ключом: владелец, сотрудник клиента или никто
/** @param {Env} env @param {any} key @param {any=} hint @returns {Promise<{ role: string, cid: string } | null>} */
export async function loginRole(env, key, hint) {
  key = String(key || "").trim();
  if (!key || key.length > 200) return null;
  if (leadsKey(env) && safeEq(key, leadsKey(env))) return { role: "owner", cid: "*" };
  const h = await sha256Hex(key);
  for (const id of hasClient(hint) ? [hint] : Object.keys(CLIENTS)) {
    const ek = env["KEY_" + id.toUpperCase()], kh = CLIENTS[id].keyHash;
    if ((ek && safeEq(key, ek)) || (kh && safeEq(h, kh))) return { role: "staff", cid: id };
  }
  return null;
}
// не больше 8 неверных ключей за 10 минут с одного адреса
const loginFails = new Map();
/** @param {Env} env @param {Request} request @param {boolean=} failed @returns {Promise<boolean>} */
export async function loginBlocked(env, request, failed) {
  const ip = ipKey(request.headers.get("cf-connecting-ip") || "local"), slot = Math.floor(Date.now() / 600e3), k = `lg:${ip}:${slot}`;
  let n = loginFails.get(k) || 0;
  if (!failed) { if (n >= 8) return true; try { n = Math.max(n, +(await env.KV.get(k)) || 0); } catch (e) {} return n >= 8; }
  n++; loginFails.set(k, n); if (loginFails.size > 2000) loginFails.clear();
  try { await env.KV.put(k, String(n), { expirationTtl: 1200 }); } catch (e) {}
  return n >= 8;
}
// ключ в адресе (?key=…) на страницах заявок, диагностики и автотеста: неверные попытки считаются так же, как на странице входа, — иначе ключ можно подбирать без ограничений
// wants — подходящие ключи; → номер подошедшего ключа, -1 (не подошёл) или -2 (слишком много попыток)
/** @param {Request} request @param {Env} env @param {any} key @param {any[]} wants @returns {Promise<number>} */
export async function keyGate(request, env, key, wants) {
  key = String(key ?? "");
  wants = wants.filter(Boolean);
  if (!key || !wants.length) return -1;
  if (await loginBlocked(env, request, false)) return -2;
  const i = wants.findIndex(w => safeEq(key, String(w)));
  if (i < 0) await loginBlocked(env, request, true);
  return i;
}
