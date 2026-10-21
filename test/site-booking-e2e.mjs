// Форма онлайн-записи сайта (apps/site-booking) в настоящем браузере: страница сайта + API Worker на заглушках (test/devserver.mjs,
// расписание Winchester — test/fixtures/winchester-altegio.mjs). Настоящий Altegio и внешние адреса не трогаются: всё, что идёт
// не на 127.0.0.1, обрывается и записывается — в конце список должен быть пуст. В npm test не входит: нужен Playwright.
// Запуск: node test/site-booking-e2e.mjs <папка для снимков> [папка сайта]  (по умолчанию apps/site-booking/demo; вторым прогоном —
// правленая копия winchester.kz). SITE_ASSETS=<папка> — откуда брать шрифты и логотип сайта, если их нет в папке сайта (для снимков).
import { start } from "./devserver.mjs";
import { net, T, ok } from "./harness.mjs";
import { winchesterAlt, W, WS, dayN } from "./fixtures/winchester-altegio.mjs";
import { altCache } from "../src/services/integrations/altegio/booking-api.js";
import { siteCache } from "../src/services/sitebook/base.js";
import http from "node:http";
import { readFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, extname, dirname, resolve, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright/index.mjs");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || "", SITE = resolve(process.argv[3] || join(ROOT, "apps/site-booking/demo")), ASSETS = process.env.SITE_ASSETS || "";
if (OUT) mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg" };

// ---- API: devserver, перед ним — пропуск с адресом «посетителя» (cf-connecting-ip): у каждого сценария свой, как у разных людей,
// иначе сценарии упирались бы в пределы с одного адреса (90 запросов в минуту, 8 попыток записи в час)
let ip = "10.0.0.1";
const api = await start(0, { SITE_BOOKING_WINCHESTER: "dry" });
net.altData = () => winchesterAlt();
const proxy = http.createServer((req, res) => {
  const q = http.request(api.url + req.url, { method: req.method, headers: { ...req.headers, "cf-connecting-ip": ip } }, r => { res.writeHead(r.statusCode || 500, r.headers); r.pipe(res); });
  q.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(q);
});
await new Promise(r => proxy.listen(0, "127.0.0.1", r));
const API = `http://127.0.0.1:${/** @type {any} */ (proxy.address()).port}`;

// ---- сайт: файлы из папки сайта, скрипт и стили формы — всегда из apps/site-booking, адрес API — заглушка
const site = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url || "/", "http://x").pathname), rel = normalize(p === "/" ? "/index.html" : p).replace(/^(\.\.[/\\])+/, "");
  let f = /^\/assets\/booking\.(js|css)$/.test(rel) ? join(ROOT, "apps/site-booking", rel.slice(8)) : join(SITE, rel);
  if (!existsSync(f) && ASSETS && existsSync(join(ASSETS, rel))) f = join(ASSETS, rel);
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  let body = readFileSync(f);
  if (rel === "/index.html") body = Buffer.from(body.toString().replace(/data-api="[^"]*"/, `data-api="${API}"`));
  res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(body);
});
await new Promise(r => site.listen(0, "127.0.0.1", r));
const URL0 = `http://127.0.0.1:${/** @type {any} */ (site.address()).port}`;
api.S.env.SITE_ORIGINS_WINCHESTER = URL0;
const mode = m => { api.S.env.SITE_BOOKING_WINCHESTER = m; };

// прокси агента не нужен для 127.0.0.1: Playwright по умолчанию отправляет и адреса этой машины через прокси (<-loopback>) — тот отвечает 405
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK = "1";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium",
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } } : {}) });
const errors = [], outside = [], wa = [];
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1440, height: 900 } };
let ipN = 1;
async function page(opts = PHONE, who = "") {
  ip = `10.0.0.${++ipN}`;
  const ctx = await browser.newContext({ locale: "ru-RU", acceptDownloads: true, ...opts });
  await ctx.route("**/*", r => { const u = new URL(r.request().url()); if (u.hostname === "127.0.0.1") return r.continue(); outside.push(u.href); return r.abort(); });
  await ctx.route("https://wa.me/**", r => { wa.push(r.request().url()); return r.fulfill({ status: 200, contentType: "text/html", body: "wa" }); });
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(`${who} pageerror: ${e.message}`));
  if (process.env.DEBUG) { p.on("requestfailed", r => console.log("failed", r.url(), r.failure() && r.failure().errorText)); p.on("response", r => console.log("resp", r.status(), r.url())); p.on("console", m => console.log("console", m.text())); }
  p.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${who} console: ${m.text()}`); });
  return p;
}
// страница загружена и форма уже спросила каталог (после load, в простое браузера)
async function load(p) {
  const cat = p.waitForResponse(r => r.url().includes("/api/site/winchester/catalog"), { timeout: 15000 });
  await p.goto(URL0 + "/");
  return cat;
}
// часы проверок идут: первое время дня (12:30) через минуту-другую прогона уже «прошло» — берём время подальше
const SLOT = n => `${STEP("time")} .wbk-t >> nth=${n}`;
const STEP = s => `.wbk-st[data-step="${s}"]:not(.wbk-lv)`;
async function step(p, s) { await p.waitForSelector(STEP(s), { timeout: 15000 }); await p.waitForTimeout(420); } // + конец анимации шага
const txt = async (p, sel) => String(await p.locator(sel).first().textContent()).replace(/\u00a0/g, " "); // textContent — без заглавных букв из CSS
async function shot(p, name) { if (OUT) { await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/${name}.png` }); } } // после переходов цвета (0,2 с)
const next = p => p.click(".wbk-br [data-wbk=next]");
async function times(p) { await p.waitForSelector(`${STEP("time")} .wbk-t`, { timeout: 15000 }); await p.waitForTimeout(350); }
const fill = async (p, name, phone) => { await p.fill("#wbk-name", name); await p.fill("#wbk-phone", phone); };
const tg = () => JSON.stringify(net.tg);

try {
  // ---- 1. телефон 390×844, режим проверки: Тони, стрижка + глиняная маска, сегодня 15:00
  {
    const p = await page(PHONE, "s1");
    const cat = await load(p);
    ok("каталог: ответ 200 со своего сайта", cat.status() === 200 && (await cat.headerValue("access-control-allow-origin")) === URL0);
    await shot(p, "phone-00-site");
    const t0 = Date.now();
    await p.click(".hero-cta [data-book]");
    await p.waitForSelector(".wbk.wbk-o", { timeout: 2000 });
    ok("окно открылось сразу после нажатия", Date.now() - t0 < 1500, Date.now() - t0);
    await step(p, "master");
    ok("шаг 1: «Любой мастер» и пять мастеров", (await p.locator(`${STEP("master")} .wbk-mr`).count()) === 6);
    ok("шаг 1: у Тони имя без скобок и цена стрижки 9 000 ₸", /Тони/.test(await txt(p, '[data-staff="2089378"]')) && !/Рауан/.test(await txt(p, '[data-staff="2089378"]')) && /9 000 ₸/.test(await txt(p, '[data-staff="2089378"]')));
    await p.waitForSelector('[data-near="2089378"] i', { timeout: 10000 });
    ok("шаг 1: ближайшее время Тони — сегодня с 15:00", /сегодня/.test(await txt(p, '[data-near="2089378"]')) && /15:00/.test(await txt(p, '[data-near="2089378"]')), await txt(p, '[data-near="2089378"]'));
    ok("шаг 1: «Любой мастер» — стрижка от 7 000 ₸", /от 7 000 ₸/.test(await txt(p, '[data-staff="0"]')));
    await shot(p, "phone-01-master");
    await p.click('[data-staff="2089378"]');
    await step(p, "services");
    ok("шаг 2: у Тони нет химической завивки", (await p.locator('[data-key="химическая-завивка"]').count()) === 0);
    ok("шаг 2: цены шеф-барбера (стрижка 9 000 ₸)", /9 000 ₸/.test(await txt(p, '[data-key="мужская-стрижка"]')));
    ok("шаг 2: «Дальше» неактивна без услуг", await p.locator(".wbk-br [data-wbk=next]").isDisabled());
    await p.click('[data-key="мужская-стрижка"]'); await p.click('[data-key="глиняная-маска"]');
    const bar = await txt(p, ".wbk-bt");
    ok("шаг 2: плашка «2 услуги · 1 ч 15 мин · 11 000 ₸»", /2 услуги · 1 ч 15 мин/.test(bar) && /11 000 ₸/.test(bar), bar);
    await shot(p, "phone-02-services");
    await next(p); await step(p, "time"); await times(p);
    ok("шаг 3: выбран сегодняшний день", (await p.locator(`${STEP("time")} .wbk-d[aria-pressed=true]`).getAttribute("data-date")) === dayN(0));
    ok("шаг 3: первое время — 15:00 (раньше занято, 75 мин помещаются)", (await txt(p, `${STEP("time")} .wbk-t`)) === "15:00");
    await p.click(`${STEP("time")} .wbk-t >> nth=0`);
    ok("шаг 3: плашка — время 15:00–16:15", /15:00–16:15/.test(await txt(p, ".wbk-bt")), await txt(p, ".wbk-bt"));
    await shot(p, "phone-03-time");
    await next(p); await step(p, "contacts");
    await fill(p, "Тест", "8 707 123 45 67");
    ok("шаг 4: номер с «8» — в поле «+7 707 123 45 67»", (await p.inputValue("#wbk-phone")) === "+7 707 123 45 67", await p.inputValue("#wbk-phone"));
    ok("шаг 4: режим проверки — «Отправить заявку» и пояснение", /Отправить заявку/.test(await txt(p, ".wbk-sb")) && (await p.locator(".wbk-dry").count()) === 1);
    ok("шаг 4: ссылка на политику конфиденциальности", (await p.locator('.wbk-cs a[href="privacy.html"]').count()) === 1);
    await shot(p, "phone-04-contacts");
    await p.click(".wbk-sb");
    await step(p, "done");
    ok("готово: «Заявка принята», без календаря", /Заявка/i.test(await txt(p, "#wbk-title")) && (await p.locator("[data-wbk=ics]").count()) === 0);
    ok("режим проверки: book_check был, book_record — нет", net.altRecords.length === 0 && net.alt.some(x => x.startsWith("POST /book_check/")), net.alt.join(" | "));
    ok("режим проверки: в Telegram «запишите вручную»", /запишите вручную/.test(tg()), tg().slice(0, 300));
    await shot(p, "phone-05-done");
    await p.click(`${STEP("done")} [data-wbk=close]`);
    await p.waitForSelector(".wbk.wbk-o", { state: "detached", timeout: 3000 }).catch(() => {});
    ok("«Готово» закрывает окно", (await p.locator(".wbk.wbk-o").count()) === 0);
    await p.context().close();
  }

  // ---- 2. компьютер 1440×900, настоящая запись: «Записаться» у Айдоса → Premium → время → контакты
  {
    mode("1"); net.altRecords.length = 0;
    const p = await page(DESK, "s2");
    await load(p);
    await p.click('[data-book="m:айдос"]');
    await step(p, "services");
    ok("кнопка мастера открывает сразу шаг услуг", /Айдос/.test(await txt(p, ".wbk-sub")));
    await shot(p, "desk-02-services");
    await p.click('[data-key="premium"]');
    ok("компьютер: справа карточка записи с суммой 12 000 ₸", /12 000 ₸/.test(await txt(p, ".wbk-sd")), await txt(p, ".wbk-sd"));
    await next(p); await step(p, "time"); await times(p);
    await p.click(SLOT(3));
    await shot(p, "desk-03-time");
    await next(p); await step(p, "contacts");
    await fill(p, "Азамат", "+7 701 555 44 33");
    ok("настоящая запись — кнопка «Записаться»", /^Записаться$/.test((await txt(p, ".wbk-sb")).trim()) && (await p.locator(".wbk-dry").count()) === 0);
    await shot(p, "desk-04-contacts");
    await p.click(".wbk-sb");
    await step(p, "done");
    ok("готово: «Ждём тебя в Winchester»", /Ждём тебя/i.test(await txt(p, "#wbk-title")));
    const a = (net.altRecords[0] || { appointments: [{}] }).appointments[0];
    ok("Altegio: запись к Айдосу, Premium строкой барберов", a.staff_id === W.AIDOS && JSON.stringify(a.services) === JSON.stringify([WS.PREMIUM]), JSON.stringify(net.altRecords));
    await shot(p, "desk-05-done");
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("[data-wbk=ics]")]);
    const ics = readFileSync(await dl.path()).toString().replace(/\r\n /g, ""); // длинные строки перенесены (RFC 5545)
    ok("«Добавить в календарь» — файл .ics", dl.suggestedFilename() === `winchester-${dayN(0)}.ics` && /BEGIN:VEVENT/.test(ics) && /LOCATION:Астана\\, проспект Кабанбай Батыра\\, 18/.test(ics) && /UID:777001@winchester.kz/.test(ics), ics);
    ok(".ics: время в UTC (Астана −5 ч)", new RegExp(`DTSTART:${dayN(0).replace(/-/g, "")}T0[0-9]{5}Z`).test(ics), ics);
    await p.context().close();
    mode("dry");
  }

  // ---- 3. «Любой мастер» + стрижка: цены «от 7 000 ₸», назначен барбер по 7 000 ₸
  {
    const p = await page({ viewport: { width: 1280, height: 900 } }, "s3");
    await load(p);
    await p.click(".hdr [data-book]");
    await step(p, "master");
    await p.click('[data-staff="0"]');
    await step(p, "services");
    ok("любой мастер: цена «от 7 000 ₸»", /от\s*7 000 ₸/.test(await txt(p, '[data-key="мужская-стрижка"] .wbk-sp')), await txt(p, '[data-key="мужская-стрижка"]'));
    ok("любой мастер: «есть не у всех мастеров» у химической завивки", /есть не у всех/.test(await txt(p, '[data-key="химическая-завивка"]')));
    await p.click('[data-key="мужская-стрижка"]');
    await next(p); await step(p, "time"); await times(p);
    const who = await txt(p, `${STEP("time")} .wbk-t >> nth=3 >> small`);
    ok("любой мастер: у времени указан барбер, а не Тони", who && !/Тони/.test(who), who);
    await p.click(SLOT(3));
    const card = await txt(p, ".wbk-sd");
    ok("любой мастер: в итоге имя барбера и 7 000 ₸", card.includes(who.charAt(0) + who.slice(1).toLowerCase()) && /7 000 ₸/.test(card) && !/от 7/.test(card), card);
    await shot(p, "desk-06-any-time");
    await next(p); await step(p, "contacts");
    await fill(p, "Ерлан", "+7 702 111 22 33");
    await p.click(".wbk-sb"); await step(p, "done");
    ok("любой мастер: заявка с назначенным барбером", /назначили/.test(await txt(p, ".wbk-fl")), await txt(p, ".wbk-fl"));
    await p.context().close();
  }

  // ---- 4. время заняли между выбором и отправкой
  {
    const p = await page(PHONE, "s4");
    await load(p);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    await p.click(`[data-staff="${W.ALISHER}"]`); await step(p, "services");
    await p.click('[data-key="мужская-стрижка"]'); await next(p); await step(p, "time"); await times(p);
    await p.click(SLOT(3)); await next(p); await step(p, "contacts");
    await fill(p, "Данияр", "+7 705 222 33 44");
    net.altCheckBusy = true;
    await p.click(".wbk-sb");
    await step(p, "time");
    ok("занято: возврат к выбору времени с сообщением", /только что заняли/.test(await txt(p, `${STEP("time")} .wbk-nt`)));
    ok("занято: свободное время показано сразу", (await p.locator(`${STEP("time")} .wbk-t`).count()) > 0);
    await shot(p, "phone-06-taken");
    net.altCheckBusy = false;
    await times(p);
    await p.click(SLOT(4)); await next(p); await step(p, "contacts");
    ok("занято: имя и телефон не потерялись", (await p.inputValue("#wbk-name")) === "Данияр" && (await p.inputValue("#wbk-phone")) === "+7 705 222 33 44");
    await p.click(".wbk-sb"); await step(p, "done");
    ok("занято: после выбора другого времени — заявка принята", /Заявка/i.test(await txt(p, "#wbk-title")));
    await p.context().close();
  }

  // ---- 5. нет сети на шаге времени: «Повторить»
  {
    const p = await page(PHONE, "s5");
    await load(p);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    await p.click(`[data-staff="${W.AIDYN}"]`); await step(p, "services");
    await p.click('[data-key="детская-стрижка"]');
    ok("Айдын: детская стрижка 45 мин", /45 мин/.test(await txt(p, '[data-key="детская-стрижка"]')));
    await p.route("**/api/site/winchester/times*", r => r.abort());
    await next(p); await step(p, "time");
    await p.waitForSelector(`${STEP("time")} [data-wbk=retry]`, { timeout: 15000 });
    ok("нет сети: «Повторить» и «Написать в WhatsApp»", /Не удалось загрузить/.test(await txt(p, `${STEP("time")} .wbk-al`)) && (await p.locator(`${STEP("time")} .wbk-al a[href^="https://wa.me/"]`).count()) === 1);
    await shot(p, "phone-07-offline");
    await p.unroute("**/api/site/winchester/times*");
    await p.click(`${STEP("time")} [data-wbk=retry]`);
    await times(p);
    ok("нет сети: после «Повторить» время загрузилось", (await p.locator(`${STEP("time")} .wbk-t`).count()) > 0);
    await p.context().close();
  }

  // ---- 6. онлайн-запись выключена: кнопка ведёт в WhatsApp, окно не открывается
  {
    mode("0");
    const p = await page(PHONE, "s6");
    const cat = await load(p);
    ok("выключено: каталог отвечает 503", cat.status() === 503);
    const [pop] = await Promise.all([p.context().waitForEvent("page", { timeout: 5000 }), p.click(".hero-cta [data-book]")]);
    await pop.waitForLoadState().catch(() => {});
    ok("выключено: нажатие ведёт в WhatsApp", /^https:\/\/wa\.me\/77066940608/.test(pop.url()) && wa.length > 0, pop.url());
    ok("выключено: окно записи не открылось", (await p.locator(".wbk.wbk-o").count()) === 0);
    await p.context().close();
    mode("dry");
  }

  // ---- 7. клавиатура: Tab до кнопки, Enter, ловушка фокуса, весь путь, Esc и фокус обратно
  {
    const p = await page({ viewport: { width: 1280, height: 900 } }, "s7");
    await load(p);
    const tabTo = async (test, max = 80) => { for (let i = 0; i < max; i++) { if (await p.evaluate(test)) return true; await p.keyboard.press("Tab"); } return p.evaluate(test); };
    ok("клавиатура: Tab доходит до кнопки записи", await tabTo(() => !!document.activeElement && document.activeElement.matches(".hero-cta [data-book]")));
    await p.keyboard.press("Enter");
    await step(p, "master");
    ok("клавиатура: фокус на заголовке шага", await p.evaluate(() => document.activeElement && document.activeElement.id === "wbk-title"));
    let inside = true;
    for (let i = 0; i < 30; i++) { await p.keyboard.press("Tab"); inside = inside && await p.evaluate(() => !!document.activeElement && document.activeElement.closest(".wbk") !== null); }
    for (let i = 0; i < 5; i++) { await p.keyboard.press("Shift+Tab"); inside = inside && await p.evaluate(() => !!document.activeElement && document.activeElement.closest(".wbk") !== null); }
    ok("клавиатура: Tab и Shift+Tab не выходят из окна", inside);
    ok("клавиатура: до мастера", await tabTo(() => document.activeElement.matches(`[data-staff="${2844400}"]`)));
    await p.keyboard.press("Enter"); await step(p, "services");
    ok("клавиатура: до услуги", await tabTo(() => document.activeElement.matches('input[value="мужская-стрижка"]')));
    await p.keyboard.press("Space");
    ok("клавиатура: пробел отмечает услугу", await p.isChecked('input[value="мужская-стрижка"]'));
    ok("клавиатура: до «Дальше»", await tabTo(() => document.activeElement.matches("[data-wbk=next]")));
    await p.keyboard.press("Enter"); await step(p, "time"); await times(p);
    ok("клавиатура: до времени", await tabTo(() => document.activeElement.matches(".wbk-st:not(.wbk-lv) .wbk-t") && document.activeElement.textContent >= "14:00"));
    await p.keyboard.press("Enter");
    ok("клавиатура: до «Дальше» на шаге времени", await tabTo(() => document.activeElement.matches("[data-wbk=next]")));
    await p.keyboard.press("Enter"); await step(p, "contacts");
    ok("клавиатура: до имени", await tabTo(() => document.activeElement.id === "wbk-name"));
    await p.keyboard.type("Клара");
    await p.keyboard.press("Tab");
    await p.keyboard.type("7071112233");
    ok("клавиатура: маска телефона при наборе", (await p.inputValue("#wbk-phone")) === "+7 707 111 22 33", await p.inputValue("#wbk-phone"));
    await p.keyboard.press("Backspace"); await p.keyboard.press("Backspace"); await p.keyboard.press("Backspace");
    ok("клавиатура: Backspace стирает цифры через пробел", (await p.inputValue("#wbk-phone")) === "+7 707 111 2", await p.inputValue("#wbk-phone"));
    await p.keyboard.type("233");
    ok("клавиатура: до отправки", await tabTo(() => document.activeElement.matches(".wbk-sb")));
    await p.keyboard.press("Enter"); await step(p, "done");
    ok("клавиатура: заявка отправлена", /Заявка/i.test(await txt(p, "#wbk-title")));
    await p.keyboard.press("Escape");
    await p.waitForTimeout(400);
    ok("клавиатура: Esc закрывает окно", (await p.locator(".wbk.wbk-o").count()) === 0);
    ok("клавиатура: фокус вернулся на кнопку, которой открыли", await p.evaluate(() => document.activeElement.matches(".hero-cta [data-book]")));
    await p.context().close();
  }

  // ---- 8. «уменьшить движение»: анимаций нет, панель видна сразу
  {
    const p = await page({ ...PHONE, reducedMotion: "reduce" }, "s8");
    await load(p);
    await p.click(".hero-cta [data-book]");
    await p.waitForSelector(".wbk.wbk-o");
    await p.waitForTimeout(60);
    ok("уменьшить движение: после открытия анимаций нет", (await p.evaluate(() => document.getAnimations().length)) === 0, await p.evaluate(() => document.getAnimations().map(a => a.animationName || a.transitionProperty).join(",")));
    ok("уменьшить движение: панель на месте", await p.evaluate(() => getComputedStyle(document.querySelector(".wbk-p")).transform === "none"));
    await p.click(`[data-staff="${W.TONI}"]`); await p.waitForSelector(STEP("services"));
    await p.waitForTimeout(30);
    ok("уменьшить движение: смена шага без анимации", (await p.evaluate(() => document.getAnimations().length)) === 0 && (await p.locator(".wbk-lv").count()) === 0);
    await p.context().close();
  }

  // ---- 9. без горизонтальной прокрутки на 320, 390, 820, 1440 на каждом шаге
  {
    const p = await page({ viewport: { width: 390, height: 844 } }, "s9");
    await load(p);
    const widths = [320, 390, 820, 1440], bad = [];
    const check = async s => { for (const w of widths) { await p.setViewportSize({ width: w, height: 844 }); await p.waitForTimeout(60);
      const r = await p.evaluate(() => { const m = document.querySelector(".wbk-m"), pn = document.querySelector(".wbk-p"), lb = document.querySelector(".wbk-lb");
        return { doc: document.documentElement.scrollWidth - innerWidth, m: m.scrollWidth - m.clientWidth, p: pn.scrollWidth - pn.clientWidth, lb: lb.scrollWidth - lb.clientWidth }; });
      if (r.doc > 0 || r.m > 0 || r.p > 0 || r.lb > 0) bad.push(`${s}@${w}: ${JSON.stringify(r)}`); } await p.setViewportSize({ width: 390, height: 844 }); };
    await p.click(".hero-cta [data-book]"); await step(p, "master"); await check("master");
    await p.click(`[data-staff="${W.RUSLAN}"]`); await step(p, "services"); await p.click('[data-key="мужская-стрижка"]'); await p.click('[data-key="spa-процедура-для-лица"]'); await check("services");
    await next(p); await step(p, "time"); await times(p); await p.click(SLOT(3)); await check("time");
    await next(p); await step(p, "contacts"); await fill(p, "Руслан", "+7 708 333 44 55"); await check("contacts");
    await p.click(".wbk-sb"); await step(p, "done"); await check("done");
    ok("нет горизонтальной прокрутки ни на одном шаге", bad.length === 0, bad.join(" | "));
    await p.context().close();
  }

  // ---- 10. долгие задачи на телефоне при процессоре ×4 медленнее: открытие и все шаги. Шаги проходит сама страница (клики из её
  // скрипта с паузами), а не Playwright: его проверки видимости и попадания тоже идут в основном потоке и попадали бы в замер.
  // Замер на эмуляции шумный (общая машина; на демо-странице нет шрифтов сайта — подбор системных дороже): лучший из двух проходов
  {
    const pass = async () => {
      const p = await page(PHONE, "s10");
      await p.addInitScript(() => { window.__lt = []; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: true }); } catch (e) { /* нет longtask */ } });
      await load(p);
      await p.waitForSelector(".wbk", { state: "attached", timeout: 10000 }); // окно собрано в простое после загрузки каталога
      await p.waitForTimeout(500);
      const cdp = await p.context().newCDPSession(p);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      const lt = await p.evaluate(async ({ toni }) => {
        const wait = ms => new Promise(r => setTimeout(r, ms)), $ = s => document.querySelector(s);
        const until = async s => { for (let i = 0; i < 100 && !$(s); i++) await wait(100); await wait(700); };
        window.__lt.length = 0;
        $(".hero-cta [data-book]").click(); await until('.wbk-st[data-step=master]:not(.wbk-lv) [data-near] i');
        $(`[data-staff="${toni}"]`).click(); await until(".wbk-st[data-step=services]:not(.wbk-lv)");
        $('[data-key="premium"]').click(); await wait(400); $('[data-key="черная-маска"]').click(); await wait(400);
        $(".wbk-br [data-wbk=next]").click(); await until(".wbk-st[data-step=time]:not(.wbk-lv) .wbk-t");
        $(".wbk-st:not(.wbk-lv) .wbk-t").click(); await wait(400);
        $(".wbk-br [data-wbk=next]").click(); await until(".wbk-st[data-step=contacts]:not(.wbk-lv)");
        return window.__lt.slice();
      }, { toni: W.TONI });
      const done = (await p.locator(STEP("contacts")).count()) === 1;
      await p.context().close();
      return { lt, done, good: done && lt.every(x => x <= 100) && lt.reduce((a, b) => a + b, 0) < 300 };
    };
    let r = await pass();
    if (process.env.SHOW) console.log("  долгие задачи, мс:", JSON.stringify(r.lt));
    if (!r.good) { r = await pass(); if (process.env.SHOW) console.log("  долгие задачи (второй проход), мс:", JSON.stringify(r.lt)); }
    ok("долгие задачи (×4): ни одной дольше 100 мс, в сумме меньше 300 мс", r.good, JSON.stringify(r.lt));
    ok("долгие задачи: форма дошла до контактов", r.done);
  }

  // ---- 12. навигация: ссылка #book=…, «назад» браузера, не больше 5 услуг, смена мастера, «Изменить» из проверки, выбор после перезагрузки
  {
    const p = await page(PHONE, "s12");
    const cat = p.waitForResponse(r => r.url().includes("/api/site/winchester/catalog"), { timeout: 15000 });
    await p.goto(URL0 + "/#book=m:тони"); await cat;
    await step(p, "services");
    ok("ссылка #book=m:тони открывает услуги Тони", /Тони/.test(await txt(p, ".wbk-sub")));
    await p.goBack(); await step(p, "master");
    ok("«назад» браузера — на шаг назад", (await p.locator(".wbk.wbk-o").count()) === 1);
    await p.click('[data-staff="0"]'); await step(p, "services");
    for (const k of ["мужская-стрижка", "детская-стрижка", "химическая-завивка", "моделирование-бороды", "глиняная-маска", "черная-маска"]) await p.click(`[data-key="${k}"]`);
    ok("не больше 5 услуг: шестая не отмечается, есть подсказка", !(await p.isChecked('input[value="черная-маска"]')) && /Не больше 5 услуг/.test(await txt(p, `${STEP("services")} .wbk-nt`)));
    await p.click('[data-key="глиняная-маска"]'); // снять, чтобы осталось 4
    await p.click("[data-wbk=back]"); await step(p, "master");
    await p.click(`[data-staff="${W.TONI}"]`); await step(p, "services");
    ok("смена мастера: химическая завивка убрана с подсказкой", /Химическая завивка» — Тони эту услугу не делает/.test(await txt(p, `${STEP("services")} .wbk-nt`)) && (await p.locator("input[name=svc]:checked").count()) === 3);
    await next(p); await step(p, "time"); await times(p);
    await p.click(SLOT(3));
    const first = await txt(p, `${STEP("time")} .wbk-t[aria-pressed=true]`);
    await next(p); await step(p, "contacts");
    await p.click('.wbk-rv [data-go="time"]'); await step(p, "time"); await times(p);
    await p.click(SLOT(4));
    await next(p); await step(p, "contacts");
    ok("«Изменить» время → «Дальше» возвращает к проверке с новым временем", !(await txt(p, ".wbk-rv")).includes(first + "–") && /\d\d:\d\d–\d\d:\d\d/.test(await txt(p, ".wbk-rv")), await txt(p, ".wbk-rv"));
    await p.keyboard.press("Escape"); await p.waitForTimeout(400);
    ok("закрытие убирает #book из адреса", !/#book/.test(p.url()), p.url());
    const cat2 = p.waitForResponse(r => r.url().includes("/api/site/winchester/catalog"), { timeout: 15000 });
    await p.reload(); await cat2;
    await p.waitForTimeout(300);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    ok("после перезагрузки выбор сохранён (Тони и 3 услуги)", (await p.getAttribute(`[data-staff="${W.TONI}"]`, "aria-pressed")) === "true" && /3 услуги/.test(await txt(p, `[data-staff="${W.TONI}"]`)), await txt(p, `[data-staff="${W.TONI}"]`));
    await p.goBack(); await p.waitForTimeout(400);
    ok("«назад» браузера на первом шаге закрывает окно", (await p.locator(".wbk.wbk-o").count()) === 0);
    await p.context().close();
  }

  // ---- 13. отказы сервера: блок с «Позвонить» и WhatsApp; Altegio не ответил при настоящей записи — «Не получили подтверждения»
  {
    const p = await page(PHONE, "s13");
    await load(p);
    const toContacts = async (staff, phone) => {
      await p.click(".hero-cta [data-book]"); await step(p, "master");
      await p.click(`[data-staff="${staff}"]`); await step(p, "services");
      if (!(await p.isChecked('input[value="окантовка-укладка"]'))) await p.click('[data-key="окантовка-укладка"]'); // выбор мог остаться с прошлого раза (sessionStorage)
      await next(p); await step(p, "time"); await times(p);
      await p.click(SLOT(4)); await next(p); await step(p, "contacts");
      await fill(p, "Тимур", phone);
    };
    await toContacts(W.ALISHER, "+7 776 100 20 30");
    await p.evaluate(() => { document.querySelector(".wbk-hp input").value = "http://spam.example"; }); // поле-ловушку заполняют только роботы
    await p.click(".wbk-sb");
    await p.waitForSelector(`${STEP("contacts")} .wbk-al`, { timeout: 15000 });
    ok("отказ сервера: текст и кнопки «Позвонить» и WhatsApp", /Не получилось отправить заявку/.test(await txt(p, ".wbk-al")) && (await p.locator('.wbk-al a[href="tel:+77005050503"]').count()) === 1 && (await p.locator('.wbk-al a[href^="https://wa.me/77066940608"]').count()) === 1);
    await shot(p, "phone-08-refused");
    await p.keyboard.press("Escape"); await p.waitForTimeout(400);
    mode("1");
    const f0 = globalThis.fetch;
    globalThis.fetch = (u, i) => /\/book_record\//.test(String(u)) ? Promise.resolve(new Response('{"success":false}', { status: 500 })) : f0(u, i); // Altegio «упал» при записи
    try {
      const cat = p.waitForResponse(r => r.url().includes("/api/site/winchester/catalog"), { timeout: 15000 });
      await p.reload(); await cat; await p.waitForTimeout(300);
      await toContacts(W.RUSLAN, "+7 778 200 30 40");
      await p.click(".wbk-sb");
      await step(p, "unknown");
      ok("Altegio не ответил: «Не получили подтверждения», повтора нет", /Не получили подтверждения/.test(await txt(p, "#wbk-title")) && /Не записывайся повторно/.test(await txt(p, ".wbk-sub")) && (await p.locator(".wbk-sb").count()) === 0);
      ok("Altegio не ответил: прогресс — 3 из 4, а не «всё готово»", (await p.locator(".wbk-pg i.on").count()) === 3);
      await shot(p, "phone-09-unknown");
      // Altegio отказал (434 — чёрный список): заявка у администратора, повторно записываться не нужно
      globalThis.fetch = (u, i) => /\/book_record\//.test(String(u)) ? Promise.resolve(new Response(JSON.stringify({ success: false, data: null, meta: { message: "blacklist", errors: [{ code: 434, message: "blacklist" }] } }), { status: 422 })) : f0(u, i);
      await p.click("[data-wbk=close] >> nth=-1"); await p.waitForTimeout(400);
      await toContacts(W.AIDYN, "+7 775 300 40 50");
      await p.click(".wbk-sb");
      await step(p, "unknown").catch(() => {});
      ok("Altegio отказал: «Заявка у администратора», без повтора", /Заявка у администратора/i.test(await txt(p, "#wbk-title")) && /администратор/.test(await txt(p, ".wbk-sub")) && (await p.locator(".wbk-sb").count()) === 0, await txt(p, "#wbk-title"));
    } finally { globalThis.fetch = f0; mode("dry"); }
    await p.context().close();
  }

  // ---- 14. находки проверки формы 21.10.2026
  // 14.1 «назад» (в шапке и браузера), крестик и Esc во время отправки: окно ждёт ответа, подтверждение не теряется, заявка одна
  {
    const p = await page(PHONE, "s14a");
    await load(p);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    await p.click(`[data-staff="${W.RUSLAN}"]`); await step(p, "services");
    await p.click('[data-key="окантовка-укладка"]'); await next(p); await step(p, "time"); await times(p);
    await p.click(SLOT(2)); await next(p); await step(p, "contacts");
    await fill(p, "Нурлан", "+7 701 600 70 80");
    const leads0 = (api.S.leads("winchester") || []).length;
    await p.route("**/api/site/winchester/book", async r => { if (r.request().method() === "POST") await new Promise(x => setTimeout(x, 2500)); await r.continue(); });
    await p.click(".wbk-sb");
    await p.waitForTimeout(200);
    ok("отправка: фокус остаётся на кнопке, кнопка читается (непрозрачная)", await p.evaluate(() => { const b = document.querySelector(".wbk-st:not(.wbk-lv) .wbk-sb"); return document.activeElement === b && getComputedStyle(b).opacity === "1"; }));
    ok("отправка в режиме проверки: «Отправляем…», а не «Записываем…»", /Отправляем/.test(await txt(p, ".wbk-sb")), await txt(p, ".wbk-sb"));
    await shot(p, "phone-10-sending");
    const t0 = Date.now();
    await p.click(".wbk-hd [data-wbk=back]", { force: true, timeout: 1000 }).catch(() => {}); // aria-disabled — Playwright без force не нажимает
    await p.keyboard.press("Escape");
    await p.click(".wbk-hd [data-wbk=close]", { force: true, timeout: 1000 }).catch(() => {});
    await p.goBack({ timeout: 1000 }).catch(() => {});
    ok("отправка: проверки «назад»/Esc/крестик успели до ответа сервера", Date.now() - t0 < 2000, Date.now() - t0);
    await p.waitForTimeout(150);
    ok("отправка: «назад», Esc, крестик и «назад» браузера окно не закрывают и шаг не меняют", (await p.locator(".wbk.wbk-o").count()) === 1 && (await p.locator(STEP("contacts")).count()) === 1);
    await step(p, "done");
    ok("отправка: после ответа — подтверждение, заявка одна", /Заявка/i.test(await txt(p, "#wbk-title")) && (api.S.leads("winchester") || []).length === leads0 + 1, (api.S.leads("winchester") || []).length - leads0);
    await p.unroute("**/api/site/winchester/book");
    await shot(p, "phone-10-busy-done");
    await p.context().close();
  }
  // 14.2 переход шага: уходящий шаг исчезает (wbk-out / wbk-outr), а не въезжает поверх нового
  {
    const p = await page({ viewport: { width: 1280, height: 900 } }, "s14b");
    await load(p);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    const leave = async () => { await p.waitForSelector(".wbk-st.wbk-lv", { state: "attached", timeout: 3000 }); await p.waitForTimeout(90);
      return p.evaluate(() => { const l = document.querySelector(".wbk-st.wbk-lv"), cs = l && getComputedStyle(l); return cs ? cs.animationName + " " + (+cs.opacity).toFixed(2) : "нет"; }); };
    const [fw] = await Promise.all([leave(), p.click(`[data-staff="${W.TONI}"]`)]);
    ok("переход вперёд: старый шаг уходит (wbk-out, прозрачность падает)", /^wbk-out [0-9.]+$/.test(fw) && +fw.split(" ")[1] < 0.9, fw);
    await step(p, "services");
    const [bw] = await Promise.all([leave(), p.click(".wbk-hd [data-wbk=back]")]);
    ok("переход назад: старый шаг уходит (wbk-outr)", /^wbk-outr [0-9.]+$/.test(bw) && +bw.split(" ")[1] < 0.9, bw);
    await step(p, "master");
    // Esc после щелчка по тексту окна (фокус не на поле) закрывает окно
    await p.click(`${STEP("master")} .wbk-sub`);
    await p.keyboard.press("Escape"); await p.waitForTimeout(400);
    ok("Esc после щелчка по тексту окна закрывает его", (await p.locator(".wbk.wbk-o").count()) === 0);
    await p.context().close();
  }
  // 14.3 первое нажатие «Записаться на Premium» на свежей странице: цены Premium, а не стрижки
  {
    const p = await page(PHONE, "s14c");
    await load(p);
    await p.waitForSelector(".wbk", { state: "attached", timeout: 10000 }); await p.waitForTimeout(300); // окно собрано заранее
    await p.click('[data-book="s:premium"]'); await step(p, "master");
    const toni = await txt(p, `${STEP("master")} [data-staff="${W.TONI}"]`);
    ok("s:premium на свежей странице: у Тони Premium 13 000 ₸", /Premium/.test(toni) && /13 000 ₸/.test(toni) && !/9 000 ₸/.test(toni), toni);
    await p.context().close();
  }
  // 14.4 двойное нажатие на «Записаться онлайн» (телефон и компьютер): окно открыто, мастер не выбран
  for (const [name, o, gap] of [["phone", PHONE, 200], ["desk", { viewport: { width: 1280, height: 900 } }, 180]]) {
    const p = await page(o, "s14d-" + name);
    await load(p);
    await p.waitForSelector(".wbk", { state: "attached", timeout: 10000 }); await p.waitForTimeout(300);
    const box = await p.locator(".hero-cta [data-book]").boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (o.hasTouch) { await p.touchscreen.tap(x, y); await p.waitForTimeout(gap); await p.touchscreen.tap(x, y); }
    else { await p.mouse.click(x, y); await p.waitForTimeout(gap); await p.mouse.click(x, y); }
    await p.waitForTimeout(600);
    ok(`двойное нажатие (${name}): окно открыто на шаге «Мастер», мастер не выбран`, (await p.locator(".wbk.wbk-o").count()) === 1 && (await p.locator(STEP("master")).count()) === 1 && (await p.locator(`${STEP("master")} .wbk-mr[aria-pressed=true]`).count()) === 0);
    await p.context().close();
  }
  // 14.5 каталог не загрузился при открытии страницы — форма сама пробует снова и включается
  {
    const p = await page(PHONE, "s14e");
    let n = 0;
    await p.route("**/api/site/winchester/catalog", r => n++ < 2 ? r.abort() : r.continue()); // обрыв и повтор через 1 с — тоже обрыв
    const second = p.waitForResponse(r => r.url().includes("/api/site/winchester/catalog") && r.status() === 200, { timeout: 20000 });
    await p.goto(URL0 + "/");
    await second;
    await p.waitForTimeout(300);
    await p.click(".hero-cta [data-book]");
    await p.waitForSelector(".wbk.wbk-o", { timeout: 3000 }).catch(() => {});
    ok("каталог сорвался при загрузке → повтор сам, кнопка открывает форму", (await p.locator(".wbk.wbk-o").count()) === 1, n);
    await p.context().close();
  }
  // 14.6 «Ближайший день» — день, где есть свободное время (у Алишера 4 дня подряд всё занято)
  {
    const busy = [1, 2, 3, 4].map(d => ({ staff: W.ALISHER, day: d, from: "10:00", to: "21:00" }));
    net.altData = () => winchesterAlt({ busy }); altCache.clear(); siteCache.clear();
    try {
      const p = await page(PHONE, "s14f");
      await load(p);
      await p.click(".hero-cta [data-book]"); await step(p, "master");
      await p.click(`[data-staff="${W.ALISHER}"]`); await step(p, "services");
      await p.click('[data-key="глиняная-маска"]'); await next(p); await step(p, "time"); await times(p).catch(() => {});
      await p.click(`${STEP("time")} [data-date="${dayN(1)}"]`);
      await p.waitForSelector(`${STEP("time")} .wbk-em0 [data-date]`, { timeout: 10000 });
      ok("пустой день: «Ближайший день» ведёт на день со свободным временем", (await p.getAttribute(`${STEP("time")} .wbk-em0 [data-date]`, "data-date")) === dayN(5), await p.getAttribute(`${STEP("time")} .wbk-em0 [data-date]`, "data-date"));
      await p.click(`${STEP("time")} .wbk-em0 [data-date]`); await times(p);
      ok("«Ближайший день»: время есть", (await p.locator(`${STEP("time")} .wbk-t`).count()) > 0);
      await p.context().close();
    } finally { net.altData = () => winchesterAlt(); altCache.clear(); siteCache.clear(); }
  }
  // 14.7 мелочи: пустое имя, маска номера в ошибке одной строкой, одна рамка у поля с ошибкой, мастер — круглая отметка,
  // «Готово» по центру на компьютере, фокус после закрытия из мобильного меню
  {
    const p = await page({ viewport: { width: 1280, height: 900 } }, "s14g");
    await load(p);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    ok("мастер: отметка выбора круглая (один из списка)", await p.evaluate(() => getComputedStyle(document.querySelector(".wbk-st:not(.wbk-lv) .wbk-rd")).borderRadius === "50%"));
    await p.click(`[data-staff="${W.AIDOS}"]`); await step(p, "services");
    await p.click('[data-key="глиняная-маска"]'); await next(p); await step(p, "time"); await times(p);
    await p.click(SLOT(2)); await next(p); await step(p, "contacts");
    await p.fill("#wbk-phone", "123");
    await p.click(".wbk-sb");
    ok("пустое имя: «Напиши имя.»", (await txt(p, "#wbk-name-e")) === "Напиши имя.", await txt(p, "#wbk-name-e"));
    ok("ошибка номера: маска неразрывная", /\+7\u00a07XX\u00a0XXX\u00a0XX\u00a0XX/.test(await p.textContent("#wbk-phone-e")), await p.textContent("#wbk-phone-e"));
    ok("поле с ошибкой в фокусе: без второй рамки", await p.evaluate(() => { const i = document.getElementById("wbk-name"); i.focus(); return getComputedStyle(i).outlineStyle === "none"; }));
    await fill(p, "Ербол", "+7 702 700 80 90");
    await p.click(".wbk-sb"); await step(p, "done");
    const c = await p.evaluate(() => { const d = document.querySelector(".wbk-dn").getBoundingClientRect(), m = document.querySelector(".wbk-m").getBoundingClientRect(); return Math.round((d.left + d.right) / 2 - (m.left + m.right) / 2); });
    ok("«Готово» на компьютере — по центру панели", Math.abs(c) <= 24, c);
    await p.context().close();
    const q = await page(PHONE, "s14h");
    await load(q);
    if (await q.locator("#burger").count()) {
      await q.click("#burger"); await q.waitForTimeout(300);
      await q.click("#nav [data-book]"); await step(q, "master");
      await q.click(".wbk-hd [data-wbk=close]"); await q.waitForTimeout(400);
      ok("закрыли окно, открытое из меню: фокус на кнопке меню", await q.evaluate(() => document.activeElement && document.activeElement.id === "burger"));
    }
    await q.context().close();
  }

  // ---- 11. снимки каждого шага: телефоны 390×844 и 360×740, компьютеры 1280×900 и 1920×1080, планшет 820×1180
  let shotN = 0;
  if (OUT) for (const [name, o] of [["p390", PHONE], ["p360", { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ["t820", { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }], ["d1280", { viewport: { width: 1280, height: 900 } }], ["d1920", { viewport: { width: 1920, height: 1080 } }]]) {
    const p = await page(o, name);
    await load(p);
    await p.waitForTimeout(300);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    await p.waitForSelector('[data-near] i', { timeout: 10000 }).catch(() => {});
    await shot(p, `${name}-1-master`);
    await p.click('[data-staff="0"]'); await step(p, "services");
    await p.click('[data-key="мужская-стрижка"]'); await p.click('[data-key="моделирование-бороды"]');
    await shot(p, `${name}-2-services`);
    await next(p); await step(p, "time"); await times(p);
    await p.click(SLOT(4));
    await shot(p, `${name}-3-time`);
    await next(p); await step(p, "contacts");
    await fill(p, "Арман", `+7 747 000 11 2${++shotN}`); // с одного номера — не больше 3 записей в сутки
    await shot(p, `${name}-4-contacts`);
    await p.click(".wbk-sb"); await step(p, "done");
    await shot(p, `${name}-5-done`);
    await p.context().close();
  }

  ok("в браузере нет ошибок JavaScript", errors.length === 0, errors.join(" | "));
  ok("внешних запросов не было (только 127.0.0.1)", outside.length === 0, [...new Set(outside)].join(" | "));
} catch (e) {
  ok("сценарий в браузере дошёл до конца", false, String((e && e.stack) || e).slice(0, 1500) + (errors.length ? " | " + errors.join(" | ") : ""));
} finally {
  await browser.close(); api.server.close(); proxy.close(); site.close();
}
console.log(`\nФорма записи (${SITE.replace(ROOT + "/", "")}): прошло ${T.pass}, не прошло ${T.fail}`);
process.exit(T.fail ? 1 : 0);
