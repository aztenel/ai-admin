// Картинка превью ссылки (1200×630) и значки из favicon.svg. Запуск: node scripts/og.mjs
// Нужен Playwright (в облачной среде — /opt/node-tools/node_modules/playwright).
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);
let pw;
try { pw = req("playwright"); } catch { pw = req(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright"); }
const font = (p) => pathToFileURL(resolve(root, "node_modules", p)).href;
const shot = pathToFileURL(resolve(root, "public/images/winchester/booking-time-760.webp")).href;
const brand = /export const BRAND = "([^"]+)"/.exec(readFileSync(resolve(root, "src/config/site.ts"), "utf8"))[1];
const legal = /name: "([^"]+)"/.exec(readFileSync(resolve(root, "src/config/site.ts"), "utf8"))[1];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:M;src:url(${font("@fontsource-variable/manrope/files/manrope-cyrillic-wght-normal.woff2")}) format("woff2");font-weight:200 800}
@font-face{font-family:M;src:url(${font("@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2")}) format("woff2");font-weight:200 800;unicode-range:U+0000-00FF}
@font-face{font-family:G;src:url(${font("@fontsource/golos-text/files/golos-text-cyrillic-400-normal.woff2")}) format("woff2")}
@font-face{font-family:G;src:url(${font("@fontsource/golos-text/files/golos-text-latin-400-normal.woff2")}) format("woff2");unicode-range:U+0000-00FF}
*{margin:0;box-sizing:border-box}body{width:1200px;height:630px;background:#fff;font-family:G;color:#525d6b;position:relative;overflow:hidden}
.l{position:absolute;left:72px;top:64px;width:600px}.b{font:600 22px/1 M;letter-spacing:.03em;color:#161a22}
h1{font:600 58px/62px M;letter-spacing:-.025em;color:#161a22;margin-top:96px}
.f{position:absolute;left:72px;bottom:60px;font-size:20px;line-height:28px}
.r{position:absolute;right:0;top:0;width:430px;height:630px;background:#f2f4f7;padding:72px 0 0 48px}
.s{width:520px;height:500px;border-radius:14px;overflow:hidden;box-shadow:0 0 0 1px rgba(22,26,34,.1),0 16px 32px -20px rgba(22,26,34,.35);background:url(${shot}) top left/cover}
.a{position:absolute;left:72px;top:64px;width:0}
</style></head><body><div class="r"><div class="s"></div></div><div class="l"><div class="b">${brand}</div><h1>Сайты и системы под процессы вашей компании</h1></div>
<div class="f">Студия разработки программного обеспечения<br>в Казахстане · ${legal}</div></body></html>`;

const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
// страница из файла: иначе Chromium не даёт читать локальные шрифты и картинку
const tmp = resolve(root, "scripts/.og.html");
writeFileSync(tmp, html);
await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle" });
rmSync(tmp);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(root, "public/og.png") });
const svg = readFileSync(resolve(root, "public/favicon.svg"), "utf8");
for (const [size, file] of [[180, "public/apple-touch-icon.png"], [32, "scripts/.favicon-32.png"]]) {
  const p = await browser.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<html><body style="margin:0">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: resolve(root, file), omitBackground: true });
}
await browser.close();
console.log("og.png, apple-touch-icon.png готовы");
