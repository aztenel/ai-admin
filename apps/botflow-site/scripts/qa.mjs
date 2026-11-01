// Проверка сайта в браузере.
//   node scripts/qa.mjs [папка снимков]                 — собранный dist/ на локальном сервере (заголовки из _headers)
//   node scripts/qa.mjs [папка снимков] --url https://…  — опубликованный сайт (Cloudflare Pages, свой домен)
// Ширины 1440 / 768 / 390: консоль и CSP, горизонтальная прокрутка, картинки, доступность (axe), SEO-теги,
// canonical и noindex, ссылки и якоря, sitemap и robots, меню на телефоне, форма (если включена).
// На опубликованном сайте ещё: HTTPS и переадресация с http, заголовки безопасности, превью ссылки, выключенный обработчик формы.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const args = process.argv.slice(2);
const urlArg = args.includes("--url") ? args[args.indexOf("--url") + 1] : "";
const hostArg = args.includes("--host") ? args[args.indexOf("--host") + 1] : ""; // ждать canonical на этом домене (локальная проверка боевой сборки)
const outDir = resolve(args.find((a, i) => !a.startsWith("--") && !["--url", "--host"].includes(args[i - 1])) || join(root, "qa-shots"));
const req = createRequire(import.meta.url);
let pw;
try { pw = req("playwright"); } catch { pw = req(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright"); }
const { default: AxeBuilder } = await import("@axe-core/playwright");

let base, server;
if (urlArg) {
  base = urlArg.replace(/\/$/, "");
} else {
  // --- локальный сервер: заголовки из _headers (блок /* и блоки по префиксу), только файлы из dist
  const rules = [];
  { let cur = null;
    for (const line of readFileSync(join(dist, "_headers"), "utf8").split("\n")) {
      if (!line.trim()) continue;
      if (!/^\s/.test(line)) { cur = { path: line.trim(), h: {} }; rules.push(cur); continue; }
      const i = line.indexOf(":"); cur.h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    } }
  const headersFor = (p) => Object.assign({}, ...rules.filter((r) => r.path === "/*" || (r.path.endsWith("*") && p.startsWith(r.path.slice(0, -1)))).map((r) => r.h));
  const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8" };
  server = createServer((rq, rs) => {
    const url = new URL(rq.url, "http://x");
    let p, f, status = 200;
    try { p = decodeURIComponent(url.pathname); } catch { rs.writeHead(400); return rs.end(); }
    f = resolve(dist, "." + p);
    if (f !== dist && !f.startsWith(dist + sep)) { rs.writeHead(404); return rs.end(); }
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
    if (!existsSync(f) && !p.endsWith("/") && !extname(p) && existsSync(join(dist, p, "index.html"))) { rs.writeHead(308, { location: p + "/" }); return rs.end(); }
    if (!existsSync(f)) { f = join(dist, "404.html"); status = 404; }
    rs.writeHead(status, { "content-type": TYPES[extname(f)] || "application/octet-stream", ...headersFor(p) });
    rs.end(readFileSync(f));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${server.address().port}`;
}

const fails = [], notes = [];
const fail = (where, what) => fails.push(`${where}: ${what}`);
const host = hostArg || new URL(base).host;

// тестовая это сборка или боевая — по robots.txt
const robots = await (await fetch(base + "/robots.txt")).text();
const indexable = !/Disallow: \/\s*$/m.test(robots);
notes.push(`сборка: ${indexable ? "боевая (индексируется)" : "тестовая (noindex, robots Disallow)"}`);
if (indexable && !/Sitemap: https:\/\/.+\/sitemap-index\.xml/.test(robots)) fail("robots.txt", robots.trim());
const homeHtml = await (await fetch(base + "/")).text();
const hasContacts = /href="\/contacts\/"/.test(homeHtml);
notes.push(`контакты на сайте: ${hasContacts ? "есть" : "нет — кнопки «Обсудить проект» и пункт «Контакты» скрыты"}`);

const ROUTES = ["/", "/services/", "/about/", "/contacts/", "/cases/", "/cases/winchester/", "/privacy/", "/net-takoy-stranicy/"];
const VPS = [["desktop", 1440, 900], ["tablet", 768, 1024], ["mobile", 390, 844]];
const browser = await pw.chromium.launch();
const internal = new Set();

for (const [vp, w, h] of VPS) {
  mkdirSync(join(outDir, vp), { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: vp === "desktop" ? 1 : 2, isMobile: vp === "mobile", hasTouch: vp !== "desktop" });
  for (const route of ROUTES) {
    const page = await ctx.newPage();
    const where = `${vp} ${route}`, errs = [];
    const is404 = route.startsWith("/net-");
    page.on("console", (m) => { if (m.type() === "error" && !(is404 && /status of 404/.test(m.text()))) errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/net-takoy-stranicy/")) errs.push(`${r.status()} ${r.url()}`); });
    await page.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
    const resp = await page.goto(base + route, { waitUntil: "networkidle" });
    const want = is404 ? 404 : 200;
    if (resp.status() !== want) fail(where, `статус ${resp.status()}, ждали ${want}`);
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } window.scrollTo(0, 0); });
    await page.waitForLoadState("networkidle");
    const info = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      wide: [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.right > document.documentElement.clientWidth + 1 && getComputedStyle(el).position !== "fixed"; }).slice(0, 3).map((el) => el.tagName + "." + String(el.className).slice(0, 40)),
      brokenImg: [...document.images].filter((i) => i.getClientRects().length && (!i.complete || i.naturalWidth === 0)).map((i) => i.currentSrc || i.src),
      csp: window.__csp,
      title: document.title, lang: document.documentElement.lang,
      desc: document.querySelector('meta[name="description"]')?.content || "",
      canonical: document.querySelector('link[rel="canonical"]')?.href || "",
      robots: document.querySelector('meta[name="robots"]')?.content || "",
      og: document.querySelector('meta[property="og:image"]')?.content || "",
      h1: document.querySelectorAll("h1").length,
      links: [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")),
      empty: [...document.querySelectorAll('a[href="#"], a[href=""], a:not([href])')].length,
      fontsOk: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
    }));
    if (info.overflow > 0) fail(where, `горизонтальная прокрутка ${info.overflow}px: ${info.wide.join(", ")}`);
    if (info.brokenImg.length) fail(where, `не загрузились картинки: ${info.brokenImg.join(", ")}`);
    if (info.csp.length) fail(where, `нарушения CSP: ${info.csp.join("; ")}`);
    if (errs.length) fail(where, `ошибки в консоли/сети: ${errs.join(" | ")}`);
    if (info.empty) fail(where, `ссылок-пустышек: ${info.empty}`);
    if (vp === "desktop") {
      if (!info.title || info.title.length > 70) fail(where, `title «${info.title}» (${info.title.length} симв.)`);
      if (!info.desc || info.desc.length < 50 || info.desc.length > 170) fail(where, `description ${info.desc.length} симв.`);
      if (info.lang !== "ru") fail(where, `lang=${info.lang}`);
      if (info.h1 !== 1) fail(where, `h1 на странице: ${info.h1}`);
      if (!info.canonical || !info.og) fail(where, "нет canonical или og:image");
      else if (!is404) {
        const cu = new URL(info.canonical);
        if (cu.host !== host && (urlArg || indexable)) fail(where, `canonical на другом адресе: ${info.canonical}`);
        if (cu.pathname !== route) fail(where, `canonical ${cu.pathname}, страница ${route}`);
      }
      if (!indexable && !/noindex/.test(info.robots)) fail(where, "тестовая сборка без noindex");
      if (indexable && /noindex/.test(info.robots) && !is404 && !(route === "/contacts/" && !hasContacts)) fail(where, "боевая сборка, но noindex");
      if (!info.fontsOk.some((f) => /Manrope/.test(f)) || !info.fontsOk.some((f) => /Golos/.test(f))) fail(where, `шрифты: ${info.fontsOk.join(", ")}`);
      if (!is404) for (const l of info.links) if (l.startsWith("/") || l.startsWith("#")) internal.add(l.startsWith("#") ? route + l : l);
      notes.push(`${route} — «${info.title}»${info.robots ? ` [${info.robots}]` : ""}`);
    }
    if (vp !== "tablet") {
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      for (const v of axe.violations) fail(where, `axe ${v.impact} ${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")}`);
    }
    const name = route === "/" ? "home" : route.replace(/^\/|\/$/g, "").replace(/\//g, "-");
    await page.screenshot({ path: join(outDir, vp, `${name}.png`), fullPage: true });
    await page.close();
  }
  if (vp !== "desktop") {
    const page = await ctx.newPage();
    await page.goto(base + "/", { waitUntil: "networkidle" });
    const t = page.locator("[data-menu-toggle]");
    await t.click();
    if ((await t.getAttribute("aria-expanded")) !== "true" || !(await page.locator("#mobile-menu").isVisible())) fail(`${vp} меню`, "не открылось");
    const items = await page.locator("#mobile-menu a").count();
    await page.screenshot({ path: join(outDir, vp, "menu-open.png") });
    await page.locator("#mobile-menu a").first().click();
    await page.waitForLoadState("domcontentloaded");
    if (!page.url().includes("/services/")) fail(`${vp} меню`, `первый пункт ведёт на ${page.url()}`);
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await t.click(); await page.keyboard.press("Escape");
    if (await page.locator("#mobile-menu").isVisible()) fail(`${vp} меню`, "не закрылось по Escape");
    notes.push(`${vp}: меню открывается, ${items} ссылок, переход и Escape работают`);
    await page.close();
  }
  await ctx.close();
}

// внутренние ссылки и якоря
{ const ctx = await browser.newContext(); const page = await ctx.newPage();
  for (const l of internal) {
    const [path, hash] = l.split("#");
    const r = await page.goto(base + path, { waitUntil: "domcontentloaded" });
    if (r.status() !== 200) fail("ссылка", `${l} → ${r.status()}`);
    else if (hash && !(await page.locator(`#${hash}`).count())) fail("ссылка", `${l}: нет якоря #${hash}`);
  }
  await ctx.close(); }

// sitemap: все адреса на этом же сайте и отвечают 200
{ const idx = await (await fetch(base + "/sitemap-index.xml")).text();
  const sm = await (await fetch(base + "/sitemap-0.xml")).text();
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const r of ROUTES.filter((x) => !x.startsWith("/net-") && (hasContacts || x !== "/contacts/"))) if (!locs.some((l) => l.endsWith(r))) fail("sitemap", `нет ${r}`);
  if (!hasContacts && locs.some((l) => l.endsWith("/contacts/"))) fail("sitemap", "есть /contacts/, хотя контактов нет");
  for (const l of locs) {
    const u = new URL(l);
    if ((urlArg || indexable) && u.host !== host) fail("sitemap", `чужой адрес ${l}`);
    const r = await fetch(base + u.pathname);
    if (r.status !== 200) fail("sitemap", `${u.pathname} → ${r.status}`);
  }
  if (!idx.includes("sitemap-0.xml")) fail("sitemap", "индекс без sitemap-0.xml");
  notes.push(`sitemap: ${locs.length} адресов, все отвечают 200`); }

// только опубликованный сайт: HTTPS, переадресация, заголовки, превью, форма выключена
if (urlArg) {
  if (!base.startsWith("https://")) fail("https", `адрес не https: ${base}`);
  try {
    const r = await fetch(base.replace("https://", "http://") + "/", { redirect: "manual" });
    const loc = r.headers.get("location") || "";
    if (![301, 302, 307, 308].includes(r.status) || !loc.startsWith("https://")) fail("https", `http:// → ${r.status} ${loc}`);
    else notes.push(`http:// → ${r.status} на https`);
  } catch (e) { fail("https", `http:// не ответил: ${e.message}`); }
  const hr = await fetch(base + "/");
  for (const hname of ["content-security-policy", "strict-transport-security", "x-content-type-options", "x-frame-options", "referrer-policy"]) {
    if (!hr.headers.get(hname)) fail("заголовки", `нет ${hname}`);
  }
  const og = /property="og:image" content="([^"]+)"/.exec(homeHtml)?.[1];
  if (og) { const r = await fetch(og); if (r.status !== 200 || !/^image\//.test(r.headers.get("content-type") || "")) fail("og:image", `${og} → ${r.status} ${r.headers.get("content-type")}`); else notes.push("превью ссылки (og.png) открывается"); }
  const form = await fetch(base + "/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (form.status !== 404) fail("форма", `обработчик /api/contact отвечает ${form.status} — должен быть выключен (404), пока не включён CONTACT_FORM`);
  else notes.push("обработчик формы выключен (404)");
}

// форма в браузере: только если сайт собран с PUBLIC_CONTACT_FORM=1 (ответ сервера подменяется)
{ const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage();
  await page.goto(base + "/contacts/", { waitUntil: "networkidle" });
  if (await page.locator("[data-contact-form]").count()) {
    let posted = null;
    await page.route("**/api/contact", async (r) => { posted = JSON.parse(r.request().postData() || "{}"); await r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); });
    await page.click("[data-submit]");
    const s1 = await page.textContent("[data-status]");
    if (!/Заполните|согласие/.test(s1 || "")) fail("форма", `пустая отправка: «${s1}»`);
    await page.waitForTimeout(3100);
    await page.fill('input[name="name"]', "Проверка"); await page.fill('input[name="contact"]', "test@example.com");
    await page.fill('textarea[name="message"]', "Тестовое сообщение"); await page.check('input[name="consent"]');
    await page.click("[data-submit]"); await page.waitForTimeout(300);
    const s2 = await page.textContent("[data-status]");
    if (!/Спасибо/.test(s2 || "") || !posted || posted.consent !== true) fail("форма", `отправка: «${s2}», тело ${JSON.stringify(posted)}`);
    notes.push("форма: проверена в браузере (ответ сервера подменён)");
  } else notes.push("форма: выключена в этой сборке");
  await ctx.close(); }

await browser.close(); server?.close();
console.log(`Адрес: ${base}\n` + notes.join("\n"));
console.log(`\nВнутренних ссылок проверено: ${internal.size}. Снимки: ${outDir}`);
if (fails.length) { console.log(`\nОШИБКИ (${fails.length}):\n` + fails.map((f) => "✗ " + f).join("\n")); process.exit(1); }
console.log("\nВсе проверки пройдены.");
