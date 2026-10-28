// Форма онлайн-записи сайта (apps/site-booking) в настоящем браузере: страница сайта + API Worker на заглушках (test/devserver.mjs,
// расписание Winchester — test/fixtures/winchester-altegio.mjs). Настоящий Altegio и внешние адреса не трогаются: всё, что идёт
// не на 127.0.0.1, обрывается и записывается — в конце список должен быть пуст. В npm test не входит: нужен Playwright.
// Путь — как онлайн-запись Altegio (решение владельца 22.10.2026): мастер (фото, должность, звёзды и отзывы, «Любой специалист») →
// услуги (категории, мультивыбор, «ещё») → календарь месяца и время → детали записи с «изменить», данные, напоминание, согласие → готово.
// Запуск: node test/site-booking-e2e.mjs <папка для снимков> [папка сайта]  (по умолчанию apps/site-booking/demo; вторым прогоном —
// правленая копия winchester.kz; есть kk/index.html — и казахская страница). SITE_ASSETS=<папка> — откуда брать шрифты и логотип сайта,
// если их нет в папке сайта (для снимков).
import { start } from "./devserver.mjs";
import { net, T, ok, pngFace } from "./harness.mjs";
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
  const p = decodeURIComponent(new URL(req.url || "/", "http://x").pathname), rel = normalize(p.endsWith("/") ? p + "index.html" : p).replace(/^(\.\.[/\\])+/, "");
  let f = /^\/assets\/booking\.(js|css)$/.test(rel) ? join(ROOT, "apps/site-booking", rel.slice(8)) : join(SITE, rel);
  if (!existsSync(f) && ASSETS && existsSync(join(ASSETS, rel))) f = join(ASSETS, rel);
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  let body = readFileSync(f);
  if (/\/index\.html$/.test(rel)) body = Buffer.from(body.toString().replace(/data-api="[^"]*"/, `data-api="${API}"`));
  res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(body);
});
await new Promise(r => site.listen(0, "127.0.0.1", r));
const URL0 = `http://127.0.0.1:${/** @type {any} */ (site.address()).port}`;
api.S.env.SITE_ORIGINS_WINCHESTER = URL0;
const mode = m => { api.S.env.SITE_BOOKING_WINCHESTER = m; };
// ответ API без браузера (горизонт записи, признак фото в каталоге)
// (через http: fetch в этом процессе подменён заглушкой harness)
const apiJ = (act, q = "") => new Promise((res, rej) => { ip = "10.0.9.9";
  http.get(`${API}/api/site/winchester/${act}${q ? "?" + q : ""}`, { headers: { origin: URL0 } }, r => { let b = ""; r.setEncoding("utf8"); r.on("data", c => { b += c; }); r.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on("error", rej); });

// прокси агента не нужен для 127.0.0.1: Playwright по умолчанию отправляет и адреса этой машины через прокси (<-loopback>) — тот отвечает 405
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK = "1";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium",
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } } : {}) });
const errors = [], outside = [], wa = [];
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const P360 = { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const P320 = { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
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
// запросы формы к API: { m, u, b, t } — метод, адрес, тело, время
const reqLog = p => { const log = []; p.on("request", r => { if (r.url().includes("/api/site/winchester/")) log.push({ m: r.method(), u: r.url(), b: r.postData(), t: Date.now() }); }); return log; };
// страница загружена и форма уже спросила каталог (после load, в простое браузера)
async function load(p) {
  const cat = p.waitForResponse(r => r.url().includes("/api/site/winchester/catalog"), { timeout: 15000 });
  await p.goto(URL0 + "/");
  return cat;
}
// часы проверок идут: первое время дня (12:30) через минуту-другую прогона уже «прошло» — берём время подальше
const SLOT = n => `${STEP("time")} .wbk-t >> nth=${n}`;
const STEP = s => `.wbk-st[data-step="${s}"]:not(.wbk-lv)`;
const DAY = d => `${STEP("time")} .wbk-c[data-date="${d}"]`;
async function step(p, s) { await p.waitForSelector(STEP(s), { timeout: 15000 }); await p.waitForTimeout(420); } // + конец анимации шага
const txt = async (p, sel) => String(await p.locator(sel).first().textContent()).replace(/\u00a0/g, " "); // textContent — без заглавных букв из CSS
async function shot(p, name) { if (OUT) { await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/${name}.png` }); } } // после переходов цвета (0,2 с)
const next = p => p.click(".wbk-br [data-wbk=next]");
async function times(p) { await p.waitForSelector(`${STEP("time")} .wbk-t`, { timeout: 15000 }); await p.waitForTimeout(350); }
// услуга — щелчок по строке (вся строка — подпись флажка), согласие — галочка
const sv = (p, k) => p.click(`${STEP("services")} [data-key="${k}"] label`);
const agree = p => p.check(`${STEP("contacts")} #wbk-ok`);
const fill = async (p, name, phone, ok2 = true) => { await p.fill("#wbk-name", name); await p.fill("#wbk-phone", phone); if (ok2) await agree(p); };
const tg = () => JSON.stringify(net.tg);
const DOW = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONN = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const ud = d => new Date(d + "T00:00:00Z");
const addD = (d, n) => new Date(ud(d).getTime() + n * 864e5).toISOString().slice(0, 10);
// «Пятница, 23 октября» — как в деталях записи
const fullDate = d => { const u = ud(d), w = DOW[u.getUTCDay()]; return `${w.charAt(0).toUpperCase() + w.slice(1)}, ${u.getUTCDate()} ${MON[u.getUTCMonth()]}`; };
const monthTitle = d => `${MONN[ud(d).getUTCMonth()]} ${ud(d).getUTCFullYear()}`;
const book = log => { const r = log.filter(x => x.m === "POST" && /\/book$/.test(new URL(x.u).pathname)).at(-1); return r ? JSON.parse(r.b) : null; };

try {
  // ---- 1. телефон 390×844, режим проверки: Тони, стрижка + глиняная маска, сегодня 15:00; детали записи, напоминание, согласие
  {
    const p = await page(PHONE, "s1"), log = reqLog(p);
    const cat = await load(p);
    ok("каталог: ответ 200 со своего сайта", cat.status() === 200 && (await cat.headerValue("access-control-allow-origin")) === URL0);
    await shot(p, "phone-00-site");
    const t0 = Date.now();
    await p.click(".hero-cta [data-book]");
    await p.waitForSelector(".wbk.wbk-o", { timeout: 2000 });
    ok("окно открылось сразу после нажатия", Date.now() - t0 < 1500, Date.now() - t0);
    await step(p, "master");
    ok("шаг 1: «Любой специалист» первым и пять мастеров", (await p.locator(`${STEP("master")} .wbk-mr`).count()) === 6 && /Любой специалист/.test(await txt(p, `${STEP("master")} .wbk-mr`)) && (await p.getAttribute(`${STEP("master")} .wbk-mr >> nth=0`, "data-staff")) === "0");
    ok("шаг 1: у Тони имя без скобок, должность и цена стрижки 9 000 ₸", /Тони/.test(await txt(p, '[data-staff="2089378"]')) && !/Рауан/.test(await txt(p, '[data-staff="2089378"]')) && /Шеф-барбер/i.test(await txt(p, '[data-staff="2089378"]')) && /9 000 ₸/.test(await txt(p, '[data-staff="2089378"]')));
    ok("шаг 1: у Тони пять звёзд и «249 отзывов»", (await p.locator('[data-staff="2089378"] .wbk-s5').count()) === 1 && /249 отзывов/.test(await txt(p, '[data-staff="2089378"]')) && /из 5/.test(await txt(p, '[data-staff="2089378"] .wbk-s5 + .wbk-sr, [data-staff="2089378"] .wbk-rt')));
    ok("шаг 1: у Алишера (без оценок) звёзд нет", (await p.locator(`[data-staff="${W.ALISHER}"] .wbk-s5`).count()) === 0);
    await p.waitForSelector('[data-near="2089378"] i', { timeout: 10000 });
    ok("шаг 1: ближайшее время Тони — сегодня с 15:00", /сегодня/.test(await txt(p, '[data-near="2089378"]')) && /15:00/.test(await txt(p, '[data-near="2089378"]')), await txt(p, '[data-near="2089378"]'));
    ok("шаг 1: «Любой специалист» — стрижка от 7 000 ₸", /от 7 000 ₸/.test(await txt(p, '[data-staff="0"]')));
    await shot(p, "phone-01-master");
    await p.click('[data-staff="2089378"]');
    await step(p, "services");
    ok("шаг 2: у Тони нет химической завивки", (await p.locator('[data-key="химическая-завивка"]').count()) === 0);
    ok("шаг 2: цены шеф-барбера (стрижка 9 000 ₸) и длительность «1 ч»", /9 000 ₸/.test(await txt(p, '[data-key="мужская-стрижка"]')) && /1 ч/.test(await txt(p, '[data-key="мужская-стрижка"]')));
    ok("шаг 2: «Дальше» неактивна без услуг", await p.locator(".wbk-br [data-wbk=next]").isDisabled());
    await sv(p, "мужская-стрижка"); await sv(p, "глиняная-маска");
    const bar = await txt(p, ".wbk-bt");
    ok("шаг 2: плашка «2 услуги, 1 ч 15 мин» и «11 000 ₸»", /2 услуги, 1 ч 15 мин/.test(bar) && /11 000 ₸/.test(bar), bar);
    await shot(p, "phone-02-services");
    await next(p); await step(p, "time"); await times(p);
    ok("шаг 3: календарь месяца — название и сетка Пн–Вс", (await txt(p, `${STEP("time")} .wbk-cm`)).includes(monthTitle(dayN(0))) && (await p.locator(`${STEP("time")} [role=grid] [role=columnheader]`).count()) === 7 && (await txt(p, `${STEP("time")} [role=columnheader]`)) === "Пн", await txt(p, `${STEP("time")} .wbk-cm`));
    ok("шаг 3: выбран сегодняшний день", (await p.locator(`${STEP("time")} .wbk-c[aria-selected=true]`).getAttribute("data-date")) === dayN(0));
    ok("шаг 3: первое время — 15:00 (раньше занято, 75 мин помещаются)", (await txt(p, `${STEP("time")} .wbk-t`)) === "15:00");
    await p.click(`${STEP("time")} .wbk-t >> nth=0`);
    ok("шаг 3: плашка — время 15:00–16:15", /15:00–16:15/.test(await txt(p, ".wbk-bt")), await txt(p, ".wbk-bt"));
    await shot(p, "phone-03-time");
    await next(p); await step(p, "contacts");
    const rv = await txt(p, `${STEP("contacts")} .wbk-rv`);
    ok("шаг 4: детали записи — мастер, «Суббота, 3 октября · 15:00 — 16:15», услуги с длительностью, итого", /Детали записи/i.test(await txt(p, "#wbk-title")) && /Тони/.test(rv) && rv.includes(fullDate(dayN(0))) && /15:00 — 16:15/.test(rv) && /Мужская стрижка/.test(rv) && /15 мин/.test(rv) && /Итого/.test(rv) && /11 000 ₸/.test(rv), rv);
    ok("шаг 4: «изменить» у мастера, времени и услуг", (await p.locator(`${STEP("contacts")} .wbk-rv [data-go]`).count()) === 3);
    await fill(p, "Тест", "8 707 123 45 67", false);
    ok("шаг 4: номер с «8» — в поле «+7 707 123 45 67»", (await p.inputValue("#wbk-phone")) === "+7 707 123 45 67", await p.inputValue("#wbk-phone"));
    ok("шаг 4: напоминание по умолчанию — «За 1 час до визита»", (await p.inputValue("#wbk-notify")) === "1" && /За 1 час до визита/.test(await txt(p, "#wbk-notify option:checked")));
    ok("шаг 4: варианты напоминания — не напоминать, 1, 2, 3 часа, за день", JSON.stringify(await p.$$eval("#wbk-notify option", o => o.map(x => x.value))) === JSON.stringify(["0", "1", "2", "3", "24"]));
    ok("шаг 4: режим проверки — «Отправить заявку» и пояснение без слова «проверка» (посетитель читал его как «не по-настоящему», 22.10)", /Отправить заявку/.test(await txt(p, ".wbk-sb")) && (await p.locator(".wbk-dry").count()) === 1 && /администратор/.test(await txt(p, ".wbk-dry")) && !/проверк/i.test(await txt(p, ".wbk-dry")), await txt(p, ".wbk-dry"));
    ok("шаг 4: согласие — ссылка на политику конфиденциальности", (await p.locator(`${STEP("contacts")} .wbk-agree a[href="privacy.html"]`).count()) === 1 && /согласие на обработку персональных данных/.test(await txt(p, ".wbk-agree")));
    ok("шаг 4: без галочки кнопка неактивна, есть подсказка", (await p.getAttribute(".wbk-sb", "aria-disabled")) === "true" && /согласие/i.test(await txt(p, ".wbk-hint")));
    await shot(p, "phone-04-contacts");
    const n0 = log.length;
    await p.click(".wbk-sb", { force: true }); // aria-disabled: Playwright без force не нажимает, а человек — нажмёт
    await p.waitForTimeout(300);
    ok("шаг 4: без согласия заявка не уходит, фокус на галочке", !log.slice(n0).some(x => x.m === "POST") && await p.evaluate(() => document.activeElement && document.activeElement.id === "wbk-ok") && /галочку/.test(await txt(p, "#wbk-ok-e")), await txt(p, "#wbk-ok-e"));
    await agree(p);
    ok("шаг 4: с галочкой кнопка активна", (await p.getAttribute(".wbk-sb", "aria-disabled")) !== "true" && (await txt(p, "#wbk-ok-e")) === "");
    await p.click(".wbk-sb");
    await step(p, "done");
    const b = book(log);
    ok("запрос записи: согласие и напоминание за 1 час", b && b.consent === true && b.notify === 1, JSON.stringify(b));
    ok("готово (проверка): «Заявка принята», честный текст без слова «проверка», без календаря", /Заявка/i.test(await txt(p, "#wbk-title")) && /администратор/i.test(await txt(p, `${STEP("done")} .wbk-sub`)) && /журнал/.test(await txt(p, `${STEP("done")} .wbk-sub`)) && !/проверк/i.test(await txt(p, `${STEP("done")} .wbk-sub`)) && (await p.locator("[data-wbk=ics]").count()) === 0, await txt(p, `${STEP("done")} .wbk-sub`));
    ok("режим проверки: book_check был, book_record — нет", net.altRecords.length === 0 && net.alt.some(x => x.startsWith("POST /book_check/")), net.alt.join(" | "));
    ok("режим проверки: в Telegram «запишите вручную»", /запишите вручную/.test(tg()), tg().slice(0, 300));
    await shot(p, "phone-05-done");
    await p.click(`${STEP("done")} [data-wbk=close]`);
    await p.waitForSelector(".wbk.wbk-o", { state: "detached", timeout: 3000 }).catch(() => {});
    ok("«Готово» закрывает окно", (await p.locator(".wbk.wbk-o").count()) === 0);
    await p.context().close();
  }

  // ---- 2. компьютер 1440×900, настоящая запись: «Записаться» у Айдоса → Premium → время → данные (напоминание за день) → «Вы записаны»
  {
    mode("1"); net.altRecords.length = 0;
    const p = await page(DESK, "s2"), log = reqLog(p);
    await load(p);
    await p.click('[data-book="m:айдос"]');
    await step(p, "services");
    ok("кнопка мастера открывает сразу шаг услуг", /Айдос/.test(await txt(p, ".wbk-sub")));
    await shot(p, "desk-02-services");
    await sv(p, "premium");
    ok("компьютер: справа карточка записи с суммой 12 000 ₸", /12 000 ₸/.test(await txt(p, ".wbk-sd")), await txt(p, ".wbk-sd"));
    await next(p); await step(p, "time"); await times(p);
    await p.click(SLOT(3));
    await shot(p, "desk-03-time");
    await next(p); await step(p, "contacts");
    await fill(p, "Азамат", "+7 701 555 44 33");
    await p.selectOption("#wbk-notify", "24");
    ok("настоящая запись — кнопка «Записаться»", /^Записаться$/.test((await txt(p, ".wbk-sb")).trim()) && (await p.locator(".wbk-dry").count()) === 0);
    await shot(p, "desk-04-contacts");
    await p.click(".wbk-sb");
    await step(p, "done");
    ok("готово: «Вы записаны»", /Вы записаны/i.test(await txt(p, "#wbk-title")), await txt(p, "#wbk-title"));
    const b = book(log);
    ok("запрос записи: напоминание за день (24) и согласие", b && b.notify === 24 && b.consent === true, JSON.stringify(b));
    const a = (net.altRecords[0] || { appointments: [{}] }).appointments[0];
    ok("Altegio: запись к Айдосу, Premium строкой барберов", a.staff_id === W.AIDOS && JSON.stringify(a.services) === JSON.stringify([WS.PREMIUM]), JSON.stringify(net.altRecords));
    if ("notify_by_sms" in (net.altRecords[0] || {})) ok("Altegio: напоминание за 24 часа (notify_by_sms)", net.altRecords[0].notify_by_sms === 24, JSON.stringify(net.altRecords[0]));
    await shot(p, "desk-05-done");
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("[data-wbk=ics]")]);
    const ics = readFileSync(await dl.path()).toString().replace(/\r\n /g, ""); // длинные строки перенесены (RFC 5545)
    ok("«Добавить в календарь» — файл .ics", dl.suggestedFilename() === `winchester-${dayN(0)}.ics` && /BEGIN:VEVENT/.test(ics) && /LOCATION:Астана\\, проспект Кабанбай Батыра\\, 18/.test(ics) && /UID:777001@winchester.kz/.test(ics), ics);
    ok(".ics: время в UTC (Астана −5 ч)", new RegExp(`DTSTART:${dayN(0).replace(/-/g, "")}T0[0-9]{5}Z`).test(ics), ics);
    await p.context().close();
    mode("dry");
  }

  // ---- 3. «Любой специалист» + стрижка: цены «от 7 000 ₸», назначен барбер по 7 000 ₸
  {
    const p = await page({ viewport: { width: 1280, height: 900 } }, "s3");
    await load(p);
    await p.click(".hdr [data-book]");
    await step(p, "master");
    await p.click('[data-staff="0"]');
    await step(p, "services");
    ok("любой специалист: цена «от 7 000 ₸»", /от\s*7 000 ₸/.test(await txt(p, '[data-key="мужская-стрижка"] .wbk-sp')), await txt(p, '[data-key="мужская-стрижка"]'));
    ok("любой специалист: «есть не у всех мастеров» у химической завивки", /есть не у всех/.test(await txt(p, '[data-key="химическая-завивка"]')));
    await sv(p, "мужская-стрижка");
    await next(p); await step(p, "time"); await times(p);
    const who = await txt(p, `${STEP("time")} .wbk-t >> nth=3 >> small`);
    ok("любой специалист: у времени указан барбер, а не Тони", who && !/Тони/.test(who), who);
    await p.click(SLOT(3));
    const card = await txt(p, ".wbk-sd");
    ok("любой специалист: в итоге имя барбера и 7 000 ₸", card.includes(who.charAt(0) + who.slice(1).toLowerCase()) && /7 000 ₸/.test(card) && !/от 7/.test(card), card);
    await shot(p, "desk-06-any-time");
    await next(p); await step(p, "contacts");
    await fill(p, "Ерлан", "+7 702 111 22 33");
    await p.click(".wbk-sb"); await step(p, "done");
    ok("любой специалист: заявка с назначенным барбером", /назначили/.test(await txt(p, ".wbk-fl")), await txt(p, ".wbk-fl"));
    await p.context().close();
  }

  // ---- 4. время заняли между выбором и отправкой
  {
    const p = await page(PHONE, "s4");
    await load(p);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    await p.click(`[data-staff="${W.ALISHER}"]`); await step(p, "services");
    await sv(p, "мужская-стрижка"); await next(p); await step(p, "time"); await times(p);
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
    ok("занято: имя, телефон и согласие не потерялись", (await p.inputValue("#wbk-name")) === "Данияр" && (await p.inputValue("#wbk-phone")) === "+7 705 222 33 44" && await p.isChecked("#wbk-ok"));
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
    await p.route("**/api/site/winchester/times*", r => r.abort()); // до выбора услуги: упреждающая загрузка тоже без сети
    await sv(p, "детская-стрижка");
    ok("Айдын: детская стрижка 45 мин", /45 мин/.test(await txt(p, '[data-key="детская-стрижка"]')));
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

  // ---- 7. клавиатура: Tab до кнопки, Enter, ловушка фокуса, весь путь (календарь — стрелками), согласие пробелом, Esc и фокус обратно
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
    ok("клавиатура: в календаре один день в порядке Tab (выбранный)", await tabTo(() => document.activeElement.matches(".wbk-st:not(.wbk-lv) .wbk-c") && document.activeElement.getAttribute("aria-selected") === "true"));
    const d0 = await p.evaluate(() => document.activeElement.getAttribute("data-date"));
    await p.keyboard.press("ArrowRight");
    let fd = await p.evaluate(() => [document.activeElement.getAttribute("data-date"), document.activeElement.getAttribute("aria-label")]);
    ok("клавиатура: → — следующий день, в подписи полная дата", fd[0] === addD(d0, 1) && fd[1].includes(`${ud(addD(d0, 1)).getUTCDate()} ${MON[ud(addD(d0, 1)).getUTCMonth()]}`) && fd[1].includes(DOW[ud(addD(d0, 1)).getUTCDay()]), fd.join(" | "));
    await p.keyboard.press("ArrowDown");
    fd = await p.evaluate(() => [document.activeElement.getAttribute("data-date"), document.activeElement.getAttribute("aria-label")]);
    ok("клавиатура: ↓ — та же день недели через неделю", fd[0] === addD(d0, 8), fd.join(" | "));
    // Айдос: пн и вт — выходные; ищем рабочий день стрелками
    for (let i = 0; i < 6 && await p.evaluate(() => document.activeElement.getAttribute("aria-disabled") === "true"); i++) await p.keyboard.press("ArrowRight");
    const pick = await p.evaluate(() => document.activeElement.getAttribute("data-date"));
    await p.keyboard.press("Enter");
    await p.waitForFunction(dd => { const b = document.querySelector(`.wbk-st:not(.wbk-lv) .wbk-c[data-date="${dd}"]`); return b && b.getAttribute("aria-selected") === "true"; }, pick, { timeout: 5000 }).catch(() => {});
    await times(p);
    ok("клавиатура: Enter выбирает день, время этого дня", (await p.getAttribute(DAY(pick), "aria-selected")) === "true" && (await txt(p, `${STEP("time")} .wbk-td`)).includes(`${ud(pick).getUTCDate()} ${MON[ud(pick).getUTCMonth()]}`), pick);
    await p.focus(DAY(pick));
    await p.keyboard.press("PageDown");
    ok("клавиатура: PageDown — следующий месяц", (await txt(p, `${STEP("time")} .wbk-cm`)).includes(MONN[(ud(pick).getUTCMonth() + 1) % 12]), await txt(p, `${STEP("time")} .wbk-cm`));
    await p.keyboard.press("PageUp");
    ok("клавиатура: PageUp — обратно", (await txt(p, `${STEP("time")} .wbk-cm`)).includes(MONN[ud(pick).getUTCMonth()]));
    ok("клавиатура: до времени", await tabTo(() => document.activeElement.matches(".wbk-st:not(.wbk-lv) .wbk-t")));
    const tAll = await p.locator(`${STEP("time")} .wbk-t`).count();
    ok("клавиатура: время — одна остановка Tab (остальные — стрелками, как календарь; 22.10: было 22 нажатия до «Дальше»)", (await p.locator(`${STEP("time")} .wbk-t[tabindex="0"]`).count()) === 1 && (await p.locator(`${STEP("time")} .wbk-t[tabindex="-1"]`).count()) === tAll - 1, tAll);
    const tA = await p.evaluate(() => document.activeElement.getAttribute("data-time"));
    await p.keyboard.press("ArrowRight");
    const tB = await p.evaluate(() => document.activeElement.getAttribute("data-time"));
    ok("клавиатура: → — следующее время", !!tB && tB > tA, `${tA} → ${tB}`);
    await p.keyboard.press("End");
    const tEnd = await p.evaluate(() => [document.activeElement.getAttribute("data-time"), [...document.querySelectorAll(".wbk-st:not(.wbk-lv) .wbk-t")].at(-1).getAttribute("data-time")]);
    ok("клавиатура: End — последнее время", tEnd[0] === tEnd[1], tEnd.join(" | "));
    await p.keyboard.press("Home");
    for (let i = 0; i < 40 && await p.evaluate(() => (document.activeElement.getAttribute("data-time") || "") < "14:00"); i++) await p.keyboard.press("ArrowRight");
    await p.keyboard.press("Enter");
    ok("клавиатура: Enter выбирает время, оно и в порядке Tab", await p.evaluate(() => document.activeElement.getAttribute("aria-pressed") === "true" && document.activeElement.tabIndex === 0));
    let tabs = 0;
    for (; tabs < 6 && !(await p.evaluate(() => document.activeElement.matches("[data-wbk=next]"))); tabs++) await p.keyboard.press("Tab");
    ok("клавиатура: от времени до «Дальше» — не больше 3 нажатий Tab", tabs <= 3 && await p.evaluate(() => document.activeElement.matches("[data-wbk=next]")), tabs);
    await p.keyboard.press("Enter"); await step(p, "contacts");
    ok("клавиатура: до имени", await tabTo(() => document.activeElement.id === "wbk-name"));
    await p.keyboard.type("Клара");
    await p.keyboard.press("Tab");
    await p.keyboard.type("7071112233");
    ok("клавиатура: маска телефона при наборе", (await p.inputValue("#wbk-phone")) === "+7 707 111 22 33", await p.inputValue("#wbk-phone"));
    await p.keyboard.press("Backspace"); await p.keyboard.press("Backspace"); await p.keyboard.press("Backspace");
    ok("клавиатура: Backspace стирает цифры через пробел", (await p.inputValue("#wbk-phone")) === "+7 707 111 2", await p.inputValue("#wbk-phone"));
    await p.keyboard.type("233");
    ok("клавиатура: до галочки согласия", await tabTo(() => document.activeElement.id === "wbk-ok"));
    await p.keyboard.press("Space");
    ok("клавиатура: пробел ставит галочку", await p.isChecked("#wbk-ok"));
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

  // ---- 9. без горизонтальной прокрутки на 320, 360, 390, 820, 1280, 1920 на каждом шаге (и календарь целиком влезает)
  {
    const p = await page({ viewport: { width: 390, height: 844 } }, "s9");
    await load(p);
    const widths = [320, 360, 390, 820, 1280, 1920], bad = [];
    const check = async s => { for (const w of widths) { await p.setViewportSize({ width: w, height: 844 }); await p.waitForTimeout(60);
      const r = await p.evaluate(() => { const m = document.querySelector(".wbk-m"), pn = document.querySelector(".wbk-p"), lb = document.querySelector(".wbk-lb"), g = document.querySelector(".wbk-st:not(.wbk-lv) [role=grid]");
        return { doc: document.documentElement.scrollWidth - innerWidth, m: m.scrollWidth - m.clientWidth, p: pn.scrollWidth - pn.clientWidth, lb: lb.scrollWidth - lb.clientWidth, grid: g ? g.scrollWidth - g.clientWidth : 0 }; });
      if (r.doc > 0 || r.m > 0 || r.p > 0 || r.lb > 0 || r.grid > 0) bad.push(`${s}@${w}: ${JSON.stringify(r)}`); } await p.setViewportSize({ width: 390, height: 844 }); };
    await p.click(".hero-cta [data-book]"); await step(p, "master"); await check("master");
    await p.click(`[data-staff="${W.RUSLAN}"]`); await step(p, "services"); await sv(p, "мужская-стрижка"); await sv(p, "spa-процедура-для-лица"); await check("services");
    await next(p); await step(p, "time"); await times(p); await p.click(SLOT(3)); await check("time");
    await next(p); await step(p, "contacts"); await fill(p, "Руслан", "+7 708 333 44 55"); await check("contacts");
    await p.click(".wbk-sb"); await step(p, "done"); await check("done");
    ok("нет горизонтальной прокрутки ни на одном шаге (320–1920)", bad.length === 0, bad.join(" | "));
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
        $('[data-key="premium"] input').click(); await wait(400); $('[data-key="черная-маска"] input').click(); await wait(600);
        $(".wbk-br [data-wbk=next]").click(); await until(".wbk-st[data-step=time]:not(.wbk-lv) .wbk-t");
        $('.wbk-st:not(.wbk-lv) [data-wbk="nm"]').click(); await wait(500); $('.wbk-st:not(.wbk-lv) [data-wbk="pm"]').click(); await wait(500);
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
    ok("долгие задачи: форма дошла до деталей записи", r.done);
  }

  // ---- 12. навигация: ссылка #book=…, «назад» браузера, не больше 5 услуг, смена мастера, «изменить» из деталей, выбор после перезагрузки
  {
    const p = await page(PHONE, "s12");
    const cat = p.waitForResponse(r => r.url().includes("/api/site/winchester/catalog"), { timeout: 15000 });
    await p.goto(URL0 + "/#book=m:тони"); await cat;
    await step(p, "services");
    ok("ссылка #book=m:тони открывает услуги Тони", /Тони/.test(await txt(p, ".wbk-sub")));
    await p.goBack(); await step(p, "master");
    ok("«назад» браузера — на шаг назад", (await p.locator(".wbk.wbk-o").count()) === 1);
    await p.click('[data-staff="0"]'); await step(p, "services");
    for (const k of ["мужская-стрижка", "детская-стрижка", "химическая-завивка", "моделирование-бороды", "глиняная-маска", "черная-маска"]) await sv(p, k);
    ok("не больше 5 услуг: шестая не отмечается, есть подсказка", !(await p.isChecked('input[value="черная-маска"]')) && /Не больше 5 услуг/.test(await txt(p, `${STEP("services")} .wbk-nt`)));
    await sv(p, "глиняная-маска"); // снять, чтобы осталось 4
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
    ok("«изменить» время → «Дальше» возвращает к деталям с новым временем", !(await txt(p, ".wbk-rv")).includes(first + " —") && /\d\d:\d\d — \d\d:\d\d/.test(await txt(p, ".wbk-rv")), await txt(p, ".wbk-rv"));
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
      if (!(await p.isChecked('input[value="окантовка-укладка"]'))) await sv(p, "окантовка-укладка"); // выбор мог остаться с прошлого раза (sessionStorage)
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
    await sv(p, "окантовка-укладка"); await next(p); await step(p, "time"); await times(p);
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
  // 14.2 переход шага: прежний шаг убирается сразу (уходящий шаг с анимацией давал долгую задачу на телефоне, 22.10.2026), новый
  // въезжает: вперёд — wbk-in, назад — wbk-inr; поверх нового ничего не въезжает
  {
    const p = await page({ viewport: { width: 1280, height: 900 } }, "s14b");
    await load(p);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    const enter = async s2 => { await p.waitForSelector(`.wbk-st[data-step="${s2}"]`, { state: "attached", timeout: 3000 }); await p.waitForTimeout(60);
      return p.evaluate(() => { const all = document.querySelectorAll(".wbk-m .wbk-st"), cs = getComputedStyle(all[all.length - 1]); return all.length + " " + cs.animationName; }); };
    const [fw] = await Promise.all([enter("services"), p.click(`[data-staff="${W.TONI}"]`)]);
    ok("переход вперёд: прежний шаг убран сразу, новый въезжает (wbk-in)", fw === "1 wbk-in", fw);
    await step(p, "services");
    const [bw] = await Promise.all([enter("master"), p.click(".wbk-hd [data-wbk=back]")]);
    ok("переход назад: прежний шаг убран сразу, новый въезжает с другой стороны (wbk-inr)", bw === "1 wbk-inr", bw);
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
  // 14.6 «Ближайший день» — день, где есть свободное время (у Алишера 4 дня подряд всё занято); занятые дни в календаре бледнеют
  {
    const busy = [1, 2, 3, 4].map(d => ({ staff: W.ALISHER, day: d, from: "10:00", to: "21:00" }));
    net.altData = () => winchesterAlt({ busy }); altCache.clear(); siteCache.clear();
    try {
      const p = await page(PHONE, "s14f");
      await load(p);
      await p.click(".hero-cta [data-book]"); await step(p, "master");
      await p.click(`[data-staff="${W.ALISHER}"]`); await step(p, "services");
      await p.route(u => u.pathname.endsWith("/api/site/winchester/times") && u.searchParams.get("date") === dayN(1), async r => { await new Promise(x => setTimeout(x, 1500)); await r.continue(); });
      await sv(p, "глиняная-маска"); await next(p); await step(p, "time"); await times(p).catch(() => {});
      // завтра выбрали раньше, чем пришёл ответ (форма спрашивает соседний день заранее — здесь ответ задержан)
      await p.click(DAY(dayN(1)));
      await p.waitForSelector(`${STEP("time")} .wbk-em0 [data-date]`, { timeout: 10000 });
      ok("пустой день: «Ближайший день» ведёт на день со свободным временем", (await p.getAttribute(`${STEP("time")} .wbk-em0 [data-date]`, "data-date")) === dayN(5), await p.getAttribute(`${STEP("time")} .wbk-em0 [data-date]`, "data-date"));
      const labs = await Promise.all([1, 2, 3, 4].map(n => p.getAttribute(DAY(dayN(n)), "aria-label")));
      ok("пустые дни до ближайшего — в календаре «всё занято», бледные и не нажимаются (как в Altegio)", labs.every(x => /занято/.test(x)) && (await p.getAttribute(DAY(dayN(3)), "aria-disabled")) === "true", labs.join(" | "));
      await p.click(`${STEP("time")} .wbk-em0 [data-date]`); await times(p);
      ok("«Ближайший день»: время есть, день выбран в календаре", (await p.locator(`${STEP("time")} .wbk-t`).count()) > 0 && (await p.getAttribute(DAY(dayN(5)), "aria-selected")) === "true");
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
    await sv(p, "глиняная-маска"); await next(p); await step(p, "time"); await times(p);
    await p.click(SLOT(2)); await next(p); await step(p, "contacts");
    await p.fill("#wbk-phone", "123");
    await agree(p);
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

  // ---- 15. календарь месяца (360 px): название, Пн–Вс, прошлые дни и выходные мастера не нажимаются, листание до горизонта Altegio
  {
    const hz = (await apiJ("dates", `staff=${W.TONI}&services=${encodeURIComponent("мужская-стрижка")}`)).to; // горизонт — сколько отдаёт Altegio
    const p = await page(P360, "s15"), log = reqLog(p);
    await load(p);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    await p.click(`[data-staff="${W.TONI}"]`); await step(p, "services");
    await sv(p, "мужская-стрижка"); await next(p); await step(p, "time"); await times(p);
    const today = dayN(0), m0 = today.slice(0, 7);
    ok("календарь: название текущего месяца", (await txt(p, `${STEP("time")} .wbk-cm`)).includes(monthTitle(today)), await txt(p, `${STEP("time")} .wbk-cm`));
    ok("календарь: сетка с ролью grid, строки недель", (await p.locator(`${STEP("time")} [role=grid] [role=row]`).count()) >= 5);
    const days = await p.$$eval(`${STEP("time")} .wbk-c`, b => b.map(x => ({ d: x.getAttribute("data-date"), off: x.getAttribute("aria-disabled") === "true", lab: x.getAttribute("aria-label") })));
    ok("календарь: все дни этого месяца, ни одного чужого", days.length === new Date(Date.UTC(+m0.slice(0, 4), +m0.slice(5, 7), 0)).getUTCDate() && days.every(x => x.d.startsWith(m0)), days.length);
    ok("календарь: прошлые дни неактивны", days.filter(x => x.d < today).every(x => x.off));
    const fri = days.filter(x => x.d >= today && ud(x.d).getUTCDay() === 5);
    ok("календарь: пятницы (выходной Тони) неактивны, в подписи — «нет записи»", fri.length > 0 && fri.every(x => x.off && /нет записи/.test(x.lab)), JSON.stringify(fri));
    ok("календарь: сегодня отмечено", /сегодня/.test(days.find(x => x.d === today).lab) && (await p.locator(DAY(today) + ".td").count()) === 1);
    const n0 = log.length, sel0 = await p.getAttribute(`${STEP("time")} .wbk-c[aria-selected=true]`, "data-date");
    await p.click(DAY(fri[0].d), { force: true });
    await p.waitForTimeout(300);
    ok("календарь: неактивный день не нажимается", (await p.getAttribute(`${STEP("time")} .wbk-c[aria-selected=true]`, "data-date")) === sel0 && !log.slice(n0).some(x => x.u.includes(`date=${fri[0].d}`)));
    ok("календарь: назад в прошлый месяц нельзя", (await p.getAttribute(`${STEP("time")} [data-wbk=pm]`, "aria-disabled")) === "true");
    await shot(p, "p360-cal-month");
    // листаем вперёд, пока Altegio разрешает
    let months = 1, guard = 0;
    while ((await p.getAttribute(`${STEP("time")} [data-wbk=nm]`, "aria-disabled")) !== "true" && guard++ < 8) {
      await p.click(`${STEP("time")} [data-wbk=nm]`); months++;
      await p.waitForFunction(() => !document.querySelector(".wbk-st:not(.wbk-lv) [role=grid][aria-busy=true]"), null, { timeout: 8000 }).catch(() => {});
    }
    const lastM = await txt(p, `${STEP("time")} .wbk-cm`);
    const want = (+hz.slice(0, 4) - +today.slice(0, 4)) * 12 + (+hz.slice(5, 7) - +today.slice(5, 7)) + 1;
    ok("календарь: листается ровно до месяца горизонта Altegio", months === want && lastM.includes(monthTitle(hz)), `${months} из ${want}, ${lastM}, горизонт ${hz}`);
    const after = addD(hz, 1);
    if (after.slice(0, 7) === hz.slice(0, 7)) ok("календарь: дни после горизонта неактивны", (await p.getAttribute(DAY(after), "aria-disabled")) === "true");
    ok("календарь: в последнем месяце есть доступный день", (await p.locator(`${STEP("time")} .wbk-c:not([aria-disabled=true])`).count()) > 0);
    ok("календарь: подпись «запись открыта до …»", /до \d+ [а-я]+/.test(await txt(p, `${STEP("time")} .wbk-hz`)), await txt(p, `${STEP("time")} .wbk-hz`));
    await shot(p, "p360-cal-last");
    const monthReq = log.filter(x => x.u.includes("/dates?") && /[?&]month=\d{4}-\d{2}/.test(x.u)).length;
    ok("календарь: дни спрашиваются по месяцам (month=ГГГГ-ММ)", monthReq >= 2, log.filter(x => x.u.includes("/dates?")).map(x => x.u.split("?")[1]).join(" | "));
    for (let i = 1; i < months; i++) await p.click(`${STEP("time")} [data-wbk=pm]`);
    ok("календарь: обратно к текущему месяцу, выбор на месте", (await txt(p, `${STEP("time")} .wbk-cm`)).includes(monthTitle(today)) && (await p.getAttribute(`${STEP("time")} .wbk-c[aria-selected=true]`, "data-date")) === sel0);
    const cw = await p.evaluate(() => { const g = document.querySelector(".wbk-st:not(.wbk-lv) [role=grid]").getBoundingClientRect(), b = document.querySelector(".wbk-st:not(.wbk-lv) .wbk-c").getBoundingClientRect(); return { g: Math.round(g.right), w: innerWidth, h: Math.round(b.height), bw: Math.round(b.width) }; });
    ok("календарь на 360 px: целиком на экране, дни не меньше 36 px", cw.g <= cw.w && cw.h >= 36 && cw.bw >= 36, JSON.stringify(cw));
    await p.context().close();
  }

  // ---- 16. мгновенность (компьютер): дни текущего и следующего месяца и время — заранее, ещё на шаге услуг; наведение на день — его время
  {
    const p = await page({ viewport: { width: 1280, height: 900 } }, "s16"), log = reqLog(p);
    await load(p);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    await p.click(`[data-staff="${W.AIDOS}"]`); await step(p, "services");
    await sv(p, "мужская-стрижка");
    await p.waitForTimeout(1200);
    const m0 = dayN(0).slice(0, 7), m1 = addD(`${m0}-28`, 7).slice(0, 7);
    const early = log.map(x => x.u);
    ok("упреждающая загрузка: дни текущего месяца — ещё на шаге услуг", early.some(u => u.includes("/dates?") && u.includes(`month=${m0}`)), early.join(" | "));
    ok("упреждающая загрузка: дни следующего месяца — тоже", early.some(u => u.includes("/dates?") && u.includes(`month=${m1}`)));
    ok("упреждающая загрузка: время первого свободного дня — тоже", early.some(u => u.includes("/times?")));
    const t0 = Date.now();
    await next(p);
    await p.waitForSelector(`${STEP("time")} .wbk-t`, { timeout: 5000 });
    const dt = Date.now() - t0;
    ok("шаг времени открывается сразу с временем (без ожидания сети)", dt < 400, dt);
    ok("без скелетона: время пришло из запаса", (await p.locator(`${STEP("time")} .wbk-skt`).count()) === 0);
    await p.waitForTimeout(400);
    const free = await p.$$eval(`${STEP("time")} .wbk-c:not([aria-disabled=true]):not([aria-selected=true])`, b => b.map(x => x.getAttribute("data-date")));
    const target = free[2] || free[0], n0 = log.length;
    await p.hover(DAY(target)); await p.waitForTimeout(400);
    ok("наведение на день — его время спрашивается заранее", log.slice(n0).some(x => x.u.includes("/times?") && x.u.includes(`date=${target}`)), target);
    const t1 = Date.now();
    await p.click(DAY(target));
    await p.waitForFunction(dd => { const t = document.querySelector(".wbk-st:not(.wbk-lv) .wbk-td"); return t && t.getAttribute("data-date") === dd; }, target, { timeout: 5000 });
    ok("выбор дня после наведения — время сразу", Date.now() - t1 < 300, Date.now() - t1);
    await p.context().close();
  }

  // ---- 17. фото мастеров: через наш сервер, круг фиксированного размера (без сдвига), нет фото или ошибка — буква
  {
    const cat = await apiJ("catalog"), flag = cat.staff && cat.staff.some(m => "photo" in m);
    const p = await page(PHONE, "s17"), asked = [];
    await p.route("**/api/site/winchester/photo/**", async r => {
      const id = r.request().url().split("/photo/")[1].split("?")[0]; asked.push(id);
      await new Promise(x => setTimeout(x, 400)); // фото приходит позже: место под ним уже есть
      if (id === String(W.ALISHER)) return r.fulfill({ status: 404, body: "" });
      return r.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(pngFace("e2e-" + id)) });
    });
    await load(p);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    const box0 = await p.locator(`[data-staff="${W.AIDOS}"] .wbk-av`).boundingBox();
    const img = await p.$eval(`[data-staff="${W.AIDOS}"] .wbk-av img`, i => ({ lazy: i.loading, dec: i.decoding, w: i.getAttribute("width"), h: i.getAttribute("height"), alt: i.alt, src: i.getAttribute("src") })).catch(() => null);
    ok("фото: img с loading=lazy, decoding=async, размерами и пустым alt, адрес — наш сервер", img && img.lazy === "lazy" && img.dec === "async" && img.w && img.h && img.alt === "" && img.src.startsWith(API + "/api/site/winchester/photo/"), JSON.stringify(img));
    await p.waitForFunction(id => { const i = document.querySelector(`.wbk-st:not(.wbk-lv) [data-staff="${id}"] .wbk-av img`); return i && i.complete && i.naturalWidth > 0; }, W.AIDOS, { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(400);
    const box1 = await p.locator(`[data-staff="${W.AIDOS}"] .wbk-av`).boundingBox();
    ok("фото: загрузилось у Айдоса и видно", await p.$eval(`[data-staff="${W.AIDOS}"] .wbk-av img`, i => i.naturalWidth > 0 && getComputedStyle(i).opacity === "1"));
    ok("фото: круг, размер не меняется после загрузки (без сдвига)", box0 && box1 && box0.width === box1.width && box0.height === box1.height && box0.y === box1.y && box0.width === box0.height && await p.$eval(`[data-staff="${W.AIDOS}"] .wbk-av`, e => getComputedStyle(e).borderRadius === "50%"), JSON.stringify([box0, box1]));
    await p.locator(`${STEP("master")} [data-staff="${W.RUSLAN}"]`).scrollIntoViewIfNeeded(); // фото ниже экрана грузятся при прокрутке (loading=lazy)
    await p.waitForFunction(id => !document.querySelector(`.wbk-st:not(.wbk-lv) [data-staff="${id}"] .wbk-av img`), W.ALISHER, { timeout: 4000 }).catch(() => {});
    const al = { img: await p.locator(`${STEP("master")} [data-staff="${W.ALISHER}"] .wbk-av img`).count(), b: await txt(p, `${STEP("master")} [data-staff="${W.ALISHER}"] .wbk-av b`), vis: await p.isVisible(`${STEP("master")} [data-staff="${W.ALISHER}"] .wbk-av b`), asked };
    ok("фото не загрузилось (Алишер) — буква «А»", al.img === 0 && al.b === "А" && al.vis, JSON.stringify(al));
    ok("нет фото (Тони) — буква «Т»", (await txt(p, `[data-staff="${W.TONI}"] .wbk-av b`)) === "Т" && await p.isVisible(`[data-staff="${W.TONI}"] .wbk-av b`));
    if (flag) ok("фото: у мастеров без фото (Тони, Руслан) запросов нет", !asked.includes(String(W.TONI)) && !asked.includes(String(W.RUSLAN)), asked.join(","));
    await shot(p, "phone-11-photos");
    // детали записи: тот же круг с фото
    await p.click(`[data-staff="${W.AIDOS}"]`); await step(p, "services");
    await sv(p, "глиняная-маска"); await next(p); await step(p, "time"); await times(p);
    await p.click(SLOT(2)); await next(p); await step(p, "contacts");
    await p.waitForFunction(() => { const i = document.querySelector(".wbk-st:not(.wbk-lv) .wbk-rv .wbk-av img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 4000 }).catch(() => {});
    ok("детали записи: фото мастера", await p.$eval(`${STEP("contacts")} .wbk-rv .wbk-av img`, i => i.naturalWidth > 0).catch(() => false));
    await p.context().close();
    // настоящий путь: картинку отдаёт наш Worker (заглушка Altegio — PNG на assets.alteg.io)
    if (flag) {
      const q = await page(PHONE, "s17b");
      await load(q);
      await q.click(".hero-cta [data-book]"); await step(q, "master");
      await q.waitForFunction(id => { const i = document.querySelector(`.wbk-st:not(.wbk-lv) [data-staff="${id}"] .wbk-av img`); return i && i.complete && i.naturalWidth > 0; }, W.AIDYN, { timeout: 8000 }).catch(() => {});
      ok("фото через Worker: у Айдына загрузилось", await q.$eval(`[data-staff="${W.AIDYN}"] .wbk-av img`, i => i.naturalWidth > 0).catch(() => false));
      await q.context().close();
    }
    // в Altegio фото нет (Тони, Руслан), а в блоке мастеров сайта есть — форма берёт его со страницы (28.10.2026: Кайрат прислал фото,
    // в форме оставались буквы). Файла на сайте нет (Руслан) — буква, без запроса к Worker
    const r = await page(PHONE, "s17c"), asked2 = [];
    await r.route("**/api/site/winchester/photo/**", x => { asked2.push(x.request().url().split("/photo/")[1].split("?")[0]); return x.fulfill({ status: 404, body: "" }); });
    await r.route("**/assets/photos/master-toni.jpg", x => x.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(pngFace("page-toni")) }));
    await r.route("**/assets/photos/master-ruslan.jpg", x => x.fulfill({ status: 404, body: "" }));
    await load(r);
    if (await r.locator(".master .av img").count()) {
      await r.click(".hero-cta [data-book]"); await step(r, "master");
      await r.waitForFunction(id => { const i = document.querySelector(`.wbk-st:not(.wbk-lv) [data-staff="${id}"] .wbk-av img`); return i && i.complete && i.naturalWidth > 0; }, W.TONI, { timeout: 5000 }).catch(() => {});
      const t = await r.$eval(`[data-staff="${W.TONI}"] .wbk-av img`, i => ({ src: i.getAttribute("src"), w: i.naturalWidth, op: getComputedStyle(i).opacity })).catch(() => null);
      ok("нет фото в Altegio — фото Тони из блока мастеров сайта", t && /assets\/photos\/master-toni\.jpg$/.test(t.src) && t.w > 0 && t.op === "1", JSON.stringify(t));
      await r.locator(`${STEP("master")} [data-staff="${W.RUSLAN}"]`).scrollIntoViewIfNeeded();
      await r.waitForFunction(id => !document.querySelector(`.wbk-st:not(.wbk-lv) [data-staff="${id}"] .wbk-av img`), W.RUSLAN, { timeout: 4000 }).catch(() => {});
      ok("фото на сайте не загрузилось (Руслан) — буква «Р»", (await r.locator(`${STEP("master")} [data-staff="${W.RUSLAN}"] .wbk-av img`).count()) === 0 && (await txt(r, `${STEP("master")} [data-staff="${W.RUSLAN}"] .wbk-av b`)) === "Р");
      if (flag) ok("фото со страницы: к Worker за Тони и Русланом не ходим", !asked2.includes(String(W.TONI)) && !asked2.includes(String(W.RUSLAN)), asked2.join(","));
    }
    await r.context().close();
  }

  // ---- 18. услуги как в Altegio: категории сверху (переход к группе), «ещё» у длинного описания Premium
  {
    const p = await page(PHONE, "s18");
    await load(p);
    await p.click('[data-book="m:айдос"]'); await step(p, "services");
    const chips = await p.$$eval(`${STEP("services")} .wbk-chip`, b => b.map(x => x.textContent));
    ok("категории: чипы групп сверху (как в меню сайта)", chips.length >= 3 && /Стрижки/.test(chips[0]) && chips.some(c => /Дополнительные/.test(c)), JSON.stringify(chips));
    ok("категории: первая выбрана", (await p.getAttribute(`${STEP("services")} .wbk-chip >> nth=0`, "aria-pressed")) === "true");
    const k = chips.findIndex(c => /Дополнительные/.test(c));
    await p.click(`${STEP("services")} .wbk-chip >> nth=${k}`);
    await p.waitForTimeout(900);
    const pos = await p.evaluate(i => { const g = document.querySelectorAll(".wbk-st:not(.wbk-lv) .wbk-gr")[i], m = document.querySelector(".wbk-m"), c = document.querySelector(".wbk-st:not(.wbk-lv) .wbk-cats"); return { g: Math.round(g.getBoundingClientRect().top - m.getBoundingClientRect().top), c: Math.round(c.getBoundingClientRect().bottom - m.getBoundingClientRect().top) }; }, k);
    ok("категории: щелчок — группа наверху, под чипами", pos.g >= pos.c - 2 && pos.g < pos.c + 80, JSON.stringify(pos));
    ok("категории: чип группы выбран", (await p.getAttribute(`${STEP("services")} .wbk-chip >> nth=${k}`, "aria-pressed")) === "true");
    await shot(p, "phone-12-categories");
    await p.click(`${STEP("services")} .wbk-chip >> nth=0`); await p.waitForTimeout(700);
    const more = `${STEP("services")} [data-key="premium"] .wbk-more`;
    ok("«ещё»: у Premium есть, у стрижки нет", (await p.locator(more).count()) === 1 && (await p.locator(`${STEP("services")} [data-key="мужская-стрижка"] .wbk-more`).count()) === 0);
    const h0 = (await p.locator(`${STEP("services")} [data-key="premium"]`).boundingBox()).height;
    await p.click(more);
    await p.waitForTimeout(250);
    const h1 = (await p.locator(`${STEP("services")} [data-key="premium"]`).boundingBox()).height;
    ok("«ещё»: описание раскрылось, услуга не отмечена", (await p.getAttribute(more, "aria-expanded")) === "true" && h1 > h0 && !(await p.isChecked('input[value="premium"]')) && /перкуссионный массаж/i.test(await txt(p, `${STEP("services")} [data-key="premium"]`)), `${h0} → ${h1}`);
    await shot(p, "phone-13-premium-more");
    await sv(p, "premium");
    ok("щелчок по строке отмечает услугу", await p.isChecked('input[value="premium"]'));
    await p.context().close();
  }

  // ---- 19. «изменить» в деталях: возврат на нужный шаг без потери остального выбора
  {
    const p = await page(PHONE, "s19");
    await load(p);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    await p.click(`[data-staff="${W.TONI}"]`); await step(p, "services");
    await sv(p, "мужская-стрижка"); await next(p); await step(p, "time"); await times(p);
    await p.click(SLOT(0)); const t0 = await txt(p, `${STEP("time")} .wbk-t[aria-pressed=true]`), d0 = await p.getAttribute(`${STEP("time")} .wbk-c[aria-selected=true]`, "data-date");
    await next(p); await step(p, "contacts");
    await fill(p, "Мадина", "+7 707 999 88 77", false);
    await p.selectOption("#wbk-notify", "3");
    await p.click(`${STEP("contacts")} .wbk-rv [data-go="services"]`); await step(p, "services");
    ok("«изменить» услуги — шаг услуг с прежним выбором", await p.isChecked('input[value="мужская-стрижка"]'));
    await sv(p, "глиняная-маска");
    await p.waitForTimeout(900); // человек не нажимает «Дальше» мгновенно: время на новый набор услуг форма уже спросила
    await next(p); await step(p, "contacts");
    ok("«изменить» услуги → «Дальше» — сразу к деталям, тот же день и время (ещё помещается; 22.10: был лишний шаг времени)", (await txt(p, ".wbk-rv")).includes(`${t0} —`) && (await txt(p, ".wbk-rv")).includes(fullDate(d0)), await txt(p, ".wbk-rv"));
    ok("детали: новая услуга, имя, телефон и напоминание на месте", /Глиняная маска/.test(await txt(p, ".wbk-rv")) && (await p.inputValue("#wbk-name")) === "Мадина" && (await p.inputValue("#wbk-phone")) === "+7 707 999 88 77" && (await p.inputValue("#wbk-notify")) === "3");
    await p.click(`${STEP("contacts")} .wbk-rv [data-go="master"]`); await step(p, "master");
    ok("«изменить» мастера — Тони отмечен", (await p.getAttribute(`[data-staff="${W.TONI}"]`, "aria-pressed")) === "true");
    await p.click(`[data-staff="${W.TONI}"]`);
    await step(p, "contacts");
    ok("тот же мастер — сразу обратно к деталям, время на месте", (await txt(p, ".wbk-rv")).includes(`${t0} —`), await txt(p, ".wbk-rv"));
    await p.click(`${STEP("contacts")} .wbk-rv [data-go="time"]`); await step(p, "time"); await times(p);
    ok("«изменить» время — выбранный день и время подсвечены", (await p.getAttribute(`${STEP("time")} .wbk-c[aria-selected=true]`, "data-date")) === d0 && (await txt(p, `${STEP("time")} .wbk-t[aria-pressed=true]`)) === t0);
    await p.context().close();
  }

  // ---- 20. находки проверки формы 22.10.2026
  // 20.1 низкий телефон (360×740, 375×667): касание дня — время этого дня видно на экране (календарь занимал весь экран, и касание
  // «ничего не меняло»); на 390×844 время и так видно — прокрутки нет
  for (const [name, vp] of [["360x740", { width: 360, height: 740 }], ["375x667", { width: 375, height: 667 }], ["390x844", { width: 390, height: 844 }]]) {
    const p = await page({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, "s20a-" + name);
    await load(p);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    await p.click(`[data-staff="${W.TONI}"]`); await step(p, "services");
    await sv(p, "мужская-стрижка"); await next(p); await step(p, "time"); await times(p);
    const top0 = await p.evaluate(() => document.querySelector(".wbk-m").scrollTop);
    const free = await p.$$eval(`${STEP("time")} .wbk-c:not([aria-disabled=true]):not([aria-selected=true])`, b => b.map(x => x.getAttribute("data-date")));
    const target = free[1] || free[0];
    await p.tap(DAY(target));
    await p.waitForFunction(dd => { const t = document.querySelector(".wbk-st:not(.wbk-lv) .wbk-td"); return t && t.getAttribute("data-date") === dd; }, target, { timeout: 8000 });
    await p.waitForTimeout(700); // плавная прокрутка
    const v = await p.evaluate(() => { const m = document.querySelector(".wbk-m").getBoundingClientRect(), st = document.querySelector(".wbk-m").scrollTop;
      const ts = [...document.querySelectorAll(".wbk-st:not(.wbk-lv) .wbk-t, .wbk-st:not(.wbk-lv) .wbk-em0")].filter(b => { const r = b.getBoundingClientRect(); return r.top >= m.top - 1 && r.bottom <= m.bottom + 1; });
      const sel = document.querySelector(".wbk-st:not(.wbk-lv) .wbk-c[aria-selected=true]").getBoundingClientRect();
      return { seen: ts.length, st, day: Math.round(sel.bottom - m.top) }; });
    if (name === "390x844") ok(`низкий экран ${name}: время видно и без прокрутки — окно не прыгает`, v.seen > 0 && v.st === top0, JSON.stringify(v));
    else ok(`низкий экран ${name}: после касания дня время этого дня на экране (22.10: 0 кнопок из 11)`, v.seen >= 4, JSON.stringify(v));
    await shot(p, `p${name}-day-tap`);
    await p.context().close();
  }
  // 20.2 время под мастером на шаге 1 — тоже выбор: мастер, день и это время (22.10: выбирался только мастер)
  {
    const p = await page(PHONE, "s20b");
    await load(p);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    await p.waitForSelector(`[data-near="${W.TONI}"] i`, { timeout: 10000 });
    const chip = await txt(p, `[data-near="${W.TONI}"] i >> nth=1`);
    await p.click(`[data-near="${W.TONI}"] i >> nth=1`);
    await step(p, "services");
    ok("время под мастером: выбран мастер (Тони)", /Тони/.test(await txt(p, ".wbk-sub")));
    await sv(p, "мужская-стрижка"); await p.waitForTimeout(500);
    await next(p); await step(p, "time"); await times(p);
    ok("время под мастером: на шаге времени выбраны этот день и это время", (await p.getAttribute(`${STEP("time")} .wbk-c[aria-selected=true]`, "data-date")) === dayN(0) && (await txt(p, `${STEP("time")} .wbk-t[aria-pressed=true]`).catch(() => "")) === chip && new RegExp(chip + "–").test(await txt(p, ".wbk-bt")), `${chip} | ${await txt(p, ".wbk-bt")}`);
    await p.context().close();
  }
  // 20.3 вёрстка: «Ближайший день» в две строки — строки не слипаются (390); в деталях на 320 «16:00 — 17:00» одной строкой
  {
    const busy = [1, 2, 3, 4].map(d => ({ staff: W.ALISHER, day: d, from: "10:00", to: "21:00" }));
    net.altData = () => winchesterAlt({ busy }); altCache.clear(); siteCache.clear();
    try {
      const p = await page({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, "s20c");
      await load(p);
      await p.click(".hero-cta [data-book]"); await step(p, "master");
      await p.click(`[data-staff="${W.ALISHER}"]`); await step(p, "services");
      // ответ о завтрашнем дне задержан: иначе форма узнаёт заранее, что он занят, и гасит его (как в 14.6)
      await p.route(u => u.pathname.endsWith("/api/site/winchester/times") && u.searchParams.get("date") === dayN(1), async r => { await new Promise(x => setTimeout(x, 1500)); await r.continue(); });
      await sv(p, "глиняная-маска"); await next(p); await step(p, "time"); await times(p).catch(() => {});
      await p.click(DAY(dayN(1)));
      await p.waitForSelector(`${STEP("time")} .wbk-em0 [data-date]`, { timeout: 10000 });
      const b = await p.$eval(`${STEP("time")} .wbk-em0 [data-date]`, x => { const cs = getComputedStyle(x), lh = parseFloat(cs.lineHeight) || 0, fs = parseFloat(cs.fontSize); const r = document.createRange(); r.selectNodeContents(x); const lines = new Set([...r.getClientRects()].map(q => Math.round(q.top))).size; return { lh, fs, lines }; });
      ok("«Ближайший день»: межстрочный интервал не меньше 1,2 размера шрифта (две строки не слипаются)", b.lines === 1 || b.lh >= b.fs * 1.2, JSON.stringify(b));
      await shot(p, "p375-nearest-day");
      await p.context().close();
    } finally { net.altData = () => winchesterAlt(); altCache.clear(); siteCache.clear(); }
    const q = await page(P320, "s20d");
    await load(q);
    await q.click(".hero-cta [data-book]"); await step(q, "master");
    await q.click(`[data-staff="${W.AIDOS}"]`); await step(q, "services");
    await sv(q, "мужская-стрижка"); await next(q); await step(q, "time"); await times(q);
    await q.click(SLOT(2)); await next(q); await step(q, "contacts");
    const w = await q.$eval(`${STEP("contacts")} .wbk-rv .wbk-dr:nth-of-type(2) .wbk-dx b`, x => { const r = document.createRange(); r.selectNodeContents(x); return { t: x.textContent, lines: new Set([...r.getClientRects()].map(q2 => Math.round(q2.top))).size }; });
    ok("детали на 320 px: время «чч:мм — чч:мм» одной строкой", w.lines === 1 && /\d\d:\d\d\s—\s\d\d:\d\d/.test(w.t), JSON.stringify(w));
    await q.context().close();
  }
  // 20.4 наведение мышью на много дней подряд не забивает Altegio: заранее — не больше нескольких дней в минуту (22.10: 40 дней
  // при «Любом специалисте» — 63 запроса к Altegio за 11 с)
  {
    const p = await page({ viewport: { width: 1280, height: 900 } }, "s20e"), log = reqLog(p);
    await load(p);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    await p.click('[data-staff="0"]'); await step(p, "services");
    await sv(p, "мужская-стрижка"); await p.waitForTimeout(600);
    await next(p); await step(p, "time"); await times(p); await p.waitForTimeout(800);
    const n0 = log.length;
    const days = [];
    for (let k = 0; k < 2; k++) {
      days.push(...await p.$$eval(`${STEP("time")} .wbk-c:not([aria-disabled=true]):not([aria-selected=true])`, b => b.map(x => x.getAttribute("data-date"))));
      for (const d of days.splice(0)) { await p.hover(DAY(d)).catch(() => {}); await p.waitForTimeout(260); }
      await p.click(`${STEP("time")} [data-wbk=nm]`).catch(() => {}); await p.waitForTimeout(400);
    }
    await p.waitForTimeout(800);
    const hov = log.slice(n0).filter(x => x.u.includes("/times?") && x.u.includes("date="));
    ok("наведение на много дней: заранее спрашивается не больше 6 дней в минуту", hov.length >= 1 && hov.length <= 6, hov.length + ": " + hov.map(x => x.u.split("date=")[1]).join(","));
    await p.context().close();
  }

  // ---- 11. снимки каждого шага: телефоны 320, 360, 390, планшет 820, компьютеры 1280 и 1920 (папка снимков — для сравнения с Altegio)
  let shotN = 0;
  if (OUT) for (const [name, o] of [["p320", P320], ["p360", P360], ["p390", PHONE],
    ["t820", { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }], ["d1280", { viewport: { width: 1280, height: 900 } }], ["d1920", { viewport: { width: 1920, height: 1080 } }]]) {
    api.S.env.ALTEGIO_LOC_WINCHESTER = String(990000 + shotN); // своя локация на каждый снимок: на локацию с сайта — не больше 15 заявок в сутки
    const p = await page(o, name);
    await p.route("**/api/site/winchester/photo/**", r => { const id = r.request().url().split("/photo/")[1].split("?")[0];
      return [String(W.AIDOS), String(W.AIDYN), String(W.ALISHER)].includes(id) ? r.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(pngFace("shot-" + id)) }) : r.fulfill({ status: 404, body: "" }); });
    await load(p);
    await p.waitForTimeout(300);
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    await p.waitForSelector('[data-near] i', { timeout: 10000 }).catch(() => {});
    await shot(p, `${name}-1-master`);
    await p.click('[data-staff="0"]'); await step(p, "services");
    await sv(p, "мужская-стрижка"); await sv(p, "моделирование-бороды");
    await shot(p, `${name}-2-services`);
    await p.click(`${STEP("services")} [data-key="premium"] .wbk-more`).catch(() => {});
    await p.locator(`${STEP("services")} [data-key="premium"]`).scrollIntoViewIfNeeded().catch(() => {});
    await shot(p, `${name}-2b-services-more`);
    await next(p); await step(p, "time"); await times(p);
    await p.click(SLOT(4));
    await shot(p, `${name}-3-calendar`);
    await p.click(`${STEP("time")} [data-wbk=nm]`).catch(() => {}); await p.waitForTimeout(500);
    await shot(p, `${name}-3b-next-month`);
    await p.click(`${STEP("time")} [data-wbk=pm]`).catch(() => {}); await p.waitForTimeout(300);
    await next(p); await step(p, "contacts");
    await fill(p, "Арман", `+7 747 000 11 2${++shotN}`, false); // с одного номера — не больше 3 записей в сутки
    await shot(p, `${name}-4-details`);
    await p.evaluate(() => { const f = document.querySelector(".wbk-st:not(.wbk-lv) .wbk-fm"); if (f) f.scrollIntoView({ block: "end" }); });
    await shot(p, `${name}-4b-consent`);
    await agree(p);
    await p.click(".wbk-sb"); await step(p, "done");
    await shot(p, `${name}-5-done`);
    await p.context().close();
  }
  delete api.S.env.ALTEGIO_LOC_WINCHESTER;

  // ---- 13. казахская страница сайта (kk/index.html, пути к файлам — «../»): форма та же (по-русски), ссылка на политику — общая
  if (existsSync(join(SITE, "kk/index.html"))) {
    const p = await page(PHONE, "s13");
    const cat = p.waitForResponse(r => r.url().includes("/api/site/winchester/catalog"), { timeout: 15000 });
    await p.goto(URL0 + "/kk/"); await cat;
    ok("kk: страница на казахском, форма записи подключена", await p.evaluate(() => document.documentElement.lang === "kk" && !!document.querySelector('script[src="../assets/booking.js"]')));
    await p.evaluate(() => document.fonts.ready);
    ok("kk: казахские буквы — шрифтами сайта (Oswald cyrillic-ext, буквы ә ғ қ ң ұ для Manrope)", await p.evaluate(() =>
      [...document.fonts].some(f => f.family.replace(/"/g, "") === "Oswald" && /U\+0?460/i.test(f.unicodeRange) && f.status === "loaded") &&
      [...document.fonts].some(f => f.family.replace(/"/g, "") === "Manrope" && /U\+0?49A/i.test(f.unicodeRange) && f.status === "loaded")));
    await p.click(".hero-cta [data-book]"); await step(p, "master");
    ok("kk: «Онлайн жазылу» открывает форму", (await p.locator(".wbk.wbk-o").count()) === 1);
    await p.click('[data-staff="0"]'); await step(p, "services");
    await sv(p, "мужская-стрижка");
    await next(p); await step(p, "time"); await times(p);
    await p.click(SLOT(3));
    await next(p); await step(p, "contacts");
    await shot(p, "kk-contacts");
    const priv = await p.evaluate(() => { const a = document.querySelector(".wbk-st:not(.wbk-lv) .wbk-agree a"); return a ? new URL(a.getAttribute("href"), location.href).pathname : ""; });
    ok("kk: согласие ведёт на общую политику /privacy.html", priv === "/privacy.html", priv);
    await p.keyboard.press("Escape"); await p.waitForTimeout(400);
    const q = await page(PHONE, "s13b");
    const cat2 = q.waitForResponse(r => r.url().includes("/api/site/winchester/catalog"), { timeout: 15000 });
    await q.goto(URL0 + "/kk/#book=m:тони"); await cat2;
    await step(q, "services");
    ok("kk: ссылка #book=m:тони открывает услуги Тони", /Тони/.test(await txt(q, ".wbk-sub")));
    await p.context().close(); await q.context().close();
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
