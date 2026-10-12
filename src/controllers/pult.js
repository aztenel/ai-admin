// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 3)
// Иконки приложения пульта и манифест для экрана «Домой». Сами иконки приходят параметром (pult.gen.js лежит вне src/).
/** @type {Record<string, any>} */
const PULT_BYTES = {};
/** @param {string} n @param {any} icons */
export function pultIcon(n, icons) { // иконка приложения для экрана «Домой»: байты разбираем один раз и держим в памяти
  if (!PULT_BYTES[n]) { const bin = atob(icons[n]), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); PULT_BYTES[n] = u; }
  return new Response(PULT_BYTES[n], { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
}
/** @param {boolean} demo */
export function pultManifest(demo) { // чтобы пульт ставился на экран «Домой» как приложение (iPhone, Android, компьютер)
  const m = { id: demo ? "/demo" : "/inbox", name: demo ? "Пульт чатов — демо" : "Пульт чатов", short_name: demo ? "Пульт демо" : "Пульт", start_url: demo ? "/demo" : "/inbox", scope: demo ? "/demo" : "/", display: "standalone", orientation: "any", lang: "ru", background_color: "#0F1419", theme_color: "#0F1419",
    icons: [{ src: "/pult/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/pult/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }, { src: "/pult/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] };
  return new Response(JSON.stringify(m), { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
