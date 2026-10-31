// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 3)
// Иконки приложения пульта и манифест для экрана «Домой». Сами иконки приходят параметром (pult.gen.js лежит вне src/).
// Новый пульт apps/pult по адресу /app/ (pultApp): файлы сборки тоже приходят параметром (pult-app.gen.js лежит вне src/).
import { csp, page } from "../lib/http.js";
/** @type {Record<string, any>} */
const PULT_BYTES = {};
/** @param {string} n @param {any} icons */
export function pultIcon(n, icons) { // иконка приложения для экрана «Домой»: байты разбираем один раз и держим в памяти
  if (!PULT_BYTES[n]) { const bin = atob(icons[n]), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); PULT_BYTES[n] = u; }
  return new Response(PULT_BYTES[n], { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
}
/** @param {boolean} demo */
export function pultManifest(demo) { // чтобы пульт ставился на экран «Домой» как приложение (iPhone, Android, компьютер)
  const m = { id: demo ? "/demo" : "/inbox", name: demo ? "Пульт чатов — демо" : "Пульт чатов", short_name: demo ? "Пульт демо" : "Пульт", start_url: demo ? "/demo" : "/inbox", scope: demo ? "/demo" : "/", display: "standalone", theme_color: "#000000", background_color: "#000000", orientation: "any", lang: "ru",
    icons: [{ src: "/pult/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/pult/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }, { src: "/pult/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] };
  return new Response(JSON.stringify(m), { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

/** @typedef {{ type: string, body: string, b64?: boolean, csp?: string[] }} AppFile файл сборки нового пульта (tools/build-pult-app.mjs) */
/** @type {Map<string, Uint8Array<ArrayBuffer>>} */
const APP_BYTES = new Map();
/**
 * Новый пульт (apps/pult) по адресу /app/. Только файлы сборки: без входа и без хранилища — в самой странице данных нет,
 * их пульт берёт из /api/* (там вход и права проверяет сервер; нет входа — 401, и пульт ведёт на /login?next=/app/…).
 * Адреса внутри пульта — после «#», поэтому неизвестный путь — 404, а не index.html.
 * @param {string} path url.pathname: /app или /app/…
 * @param {string} search url.search (сохраняется при переадресации /app → /app/)
 * @param {Record<string, AppFile> | undefined} files PULT_APP из pult-app.gen.js
 * @returns {Response}
 */
export function pultApp(path, search, files) {
  // без косой черты в конце относительные адреса сборки (./assets/…) указали бы мимо /app/
  // переносим только выбор компании ?c=: ключ входа и прочее в адресе (/app?key=…) дальше не идут — иначе остались бы в истории и в /login?next=
  if (path === "/app") { const c = new URLSearchParams(search).get("c"); return new Response(null, { status: 301, headers: { location: "/app/" + (c ? "?c=" + encodeURIComponent(c) : "") } }); }
  const name = path === "/app/" ? "index.html" : path.slice("/app/".length);
  const f = files && Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; // только свои файлы: /app/__proto__ и т. п. — 404
  if (!f) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  if (f.type.startsWith("text/html")) // как остальные страницы: не кэшировать (после выкладки сразу новая версия), не встраивать, скрипты — только свои
    return page(f.body, 200, { "content-security-policy": csp((f.csp || []).map(h => `'${h}'`).join(" ")), "x-robots-tag": "noindex, nofollow" });
  let body = /** @type {string | Uint8Array<ArrayBuffer>} */ (f.body);
  if (f.b64) { // картинки и шрифты: байты разбираем один раз и держим в памяти
    let u = APP_BYTES.get(name);
    if (!u) { const bin = atob(f.body); u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); APP_BYTES.set(name, u); }
    body = u;
  }
  // assets/ — имена с хэшем содержимого (Vite): новая сборка — новые имена, поэтому старые можно кэшировать навсегда;
  // sw.js (push-уведомления, ТЗ v2.0 §3) — всегда сверять с сервером: иначе браузер до суток держал бы прежнюю версию
  const cache = name.startsWith("assets/") ? "public, max-age=31536000, immutable" : name === "sw.js" ? "no-cache" : "public, max-age=3600";
  return new Response(body, { headers: { "content-type": f.type, "cache-control": cache, "x-content-type-options": "nosniff" } });
}
