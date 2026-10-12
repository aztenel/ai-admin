// @ts-check
// Страница входа /login, выход, вход по ключу в адресе (enter), ответ «слишком много неверных ключей».
import { esc } from "../lib/text.js";
import { page } from "../lib/http.js";
import { BASE_CSS } from "../lib/css.js";
import { sessionMake, sessionRead, cookieSet, loginRole, loginBlocked } from "../services/auth/session.js";
/** @import { Env } from "../lib/types.js" */

export const tooManyKeys = () => new Response("Слишком много неверных ключей с вашего адреса. Подождите 10 минут.", { status: 429, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
/** @param {any} n @returns {string} */
const safeNext = n => { n = String(n || ""); return /^\/[a-z]/.test(n) && !/[\\\s]/.test(n) && !n.startsWith("//") ? n.slice(0, 200) : "/studio"; };
/** @param {string} next @param {string} [msg] */
export function loginPage(next, msg) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Вход — AI-администратор</title>
<style>${BASE_CSS}.w{max-width:380px;margin:0 auto;padding:48px 16px}h1{font-size:21px;margin:0 0 6px}p{color:var(--muted);margin:0 0 16px;line-height:1.5}
input{width:100%;padding:13px 14px;border:1px solid var(--line);border-radius:12px;font-size:16px;background:var(--panel);color:var(--ink)}button{width:100%;margin-top:12px;padding:13px;border:0;border-radius:12px;background:var(--acc);color:#fff;font-size:16px;font-weight:600}
.e{color:var(--bad);margin:0 0 12px}</style></head><body><div class="w"><h1>Вход</h1><p>Введите ключ доступа. Он нужен один раз — дальше это устройство запомнится на 30 дней.</p>
${msg ? `<p class="e">${esc(msg)}</p>` : ""}<form method="post" action="/login"><input type="hidden" name="next" value="${esc(next)}"><input type="password" name="key" placeholder="Ключ доступа" autocomplete="current-password" autofocus required><button>Войти</button></form></div>
<script>if(location.hash){var n=document.querySelector('[name=next]');n.value+=location.hash}</script></body></html>`; // ссылка на чат из Telegram ведёт сразу в него и после входа
}
/** @param {Request} request @param {Env} env @param {URL} url */
export async function handleLogin(request, env, url) {
  if (request.method === "GET") return page(loginPage(safeNext(url.searchParams.get("next")), ""));
  let key = "", next = "/studio";
  try { const f = await request.formData(); key = String(f.get("key") || ""); next = safeNext(f.get("next")); } catch (e) {}
  const og = request.headers.get("origin");
  if (og && og !== "null" && og !== url.origin) return page(loginPage(next, "Откройте страницу входа заново."), 403); // форму входа с чужого сайта не принимаем; «null» присылают браузеры со строгой приватностью
  if (await loginBlocked(env, request, false)) return page(loginPage(next, "Слишком много попыток. Подождите 10 минут."), 429);
  const hint = (/[?&]c=([a-z0-9]+)/.exec(next) || [])[1];
  const who = await loginRole(env, key, hint);
  if (!who) { await loginBlocked(env, request, true); return page(loginPage(next, "Ключ не подошёл."), 403); }
  if (who.role === "staff" && /^\/(studio|launch)/.test(next)) next = "/inbox?c=" + who.cid;
  return new Response(null, { status: 303, headers: { location: next, "set-cookie": cookieSet(await sessionMake(env, who.role, who.cid)), "cache-control": "no-store" } });
}
// страница, на которую нужен вход: с cookie — пускаем; с ключом в адресе (?key=) — запоминаем устройство и убираем ключ из адреса; иначе — на страницу входа
/** @param {Request} request @param {Env} env @param {URL} url */
export async function enter(request, env, url) {
  const s = await sessionRead(env, request);
  if (s) return { s };
  const key = url.searchParams.get("key");
  if (key) {
    if (await loginBlocked(env, request, false)) return { res: page(loginPage(url.pathname, "Слишком много попыток. Подождите 10 минут."), 429) };
    const who = await loginRole(env, key, url.searchParams.get("c"));
    if (who) { const u = new URL(url); u.searchParams.delete("key"); return { res: new Response(null, { status: 303, headers: { location: u.pathname + u.search, "set-cookie": cookieSet(await sessionMake(env, who.role, who.cid)), "cache-control": "no-store" } }) }; }
    await loginBlocked(env, request, true);
  }
  return { res: new Response(null, { status: 303, headers: { location: "/login?next=" + encodeURIComponent(url.pathname + url.search.replace(/([?&])key=[^&]*&?/, "$1").replace(/[?&]$/, "")), "cache-control": "no-store" } }) };
}
