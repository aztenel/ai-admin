// Проверка раздела «Клиенты» нового пульта в настоящем браузере (Chromium через Playwright). Не тест на скорость.
// Два режима:
//   живой (по умолчанию) — НАСТОЯЩИЙ код бота на заглушках (scripts/dev-live.mjs: память вместо KV, база D1 на node:sqlite —
//     test/d1.mjs, черновик STAGE=preview): вход владельцем и сотрудником Winchester, база пуста → «Тестовые клиенты» (тот же код
//     записи, что у журнала Altegio) → список, поиск, сегмент, карточка, согласие, запрет, снятие, добавление, дубль, импорт;
//   --demo — демо-данные пульта (data/demo-contacts.ts) без бота: то же самое плюс компания без базы («Без чатов»).
// Запуск: npm run e2e:contacts [папка для снимков] [--demo]   (или node scripts/e2e-contacts.mjs <папка> [--demo])
// Playwright — PLAYWRIGHT_PATH или /opt/node-tools/node_modules/playwright/index.mjs; Chromium — /opt/pw-browsers/chromium (CHROMIUM меняет).
// На каждом шаге: нет полных номеров базы на странице (кроме карточки открытого клиента и номеров, которые человек набрал сам),
// нет ошибок в консоли, нет прокрутки вбок; снимки 390×844 и 1280×800, светлая и тёмная тема.
// Правила 31.10.2026: проверка «ещё не проверено» — не зелёная; согласие «есть» — только с доказательством (письменное: номер и дата);
// «стоп» от клиента не снимается, пока не записано его новое подтверждённое согласие; «да» из файла — не подтверждено.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// часы бота — настоящие (test/clock.mjs: CLOCK=real): на снимках — сегодняшние даты, а не 3 октября 2026 из проверок
process.env.CLOCK ||= "real";

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright/index.mjs");
const args = process.argv.slice(2);
const DEMO = args.includes("--demo");
const OUT = args.find((a) => !a.startsWith("--")) || "/tmp/claude-0/-home-user/eacf866f-6d8c-5152-bdf5-ad49eed8555f/scratchpad/pv2/contacts";
mkdirSync(OUT, { recursive: true });

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 800 };
const FULL = /7700000\d{4}/g;
// номера, которые человек набирает сам (не из базы): добавление и импорт
const ADD = "+7 700 000 77 01";
const IMPORT_TEXT = ["Телефон;Имя;Согласие", "+7 700 000 77 11;Тестовый Один;да", "8 700 000 77 12;Тестовый Два;нет", "+7 700 000 77 11;Повтор;да", "12345;Неверный;да"].join("\n");
const OWN = ["77000007701", "77000007711", "77000007712", "77000007721", "77000007722"];
const CSV = "Телефон,Имя\n+77000007721,Файл Один\n+77000007722,Файл Два\n";

// ---------- итоги ----------
const results = [];
function ok(name, cond, info = "") {
  results.push({ name, ok: !!cond, info });
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}${!cond && info ? ` — ${info}` : ""}`);
  return !!cond;
}

// ---------- сервер ----------
let app, close, OWNER = "", STAFF = "", SHIFT = 0;
if (DEMO) {
  const { createServer } = await import("vite");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createServer({ root, base: "/app/", configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)), server: { host: "127.0.0.1", port: 0 } });
  await vite.listen();
  const a = vite.httpServer?.address();
  app = `http://127.0.0.1:${a && typeof a === "object" ? a.port : 0}/app/`;
  close = () => vite.close();
} else {
  const { startDevLive } = await import("./dev-live.mjs");
  const dl = await startDevLive({ port: 0 });
  app = dl.app;
  OWNER = dl.OWNER;
  STAFF = dl.STAFF_W;
  close = dl.close;
  // процесс бота живёт по часам проверок (test/clock.mjs подменил Date): разница с настоящими — для часов браузера
  SHIFT = Date.now() - (performance.timeOrigin + performance.now());
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });

function shiftClock(shift) {
  if (!shift) return;
  const Real = Date;
  const now = () => Real.now() + shift;
  globalThis.Date = class extends Real {
    constructor(...a) {
      if (a.length) super(...a);
      else super(now());
    }
    static now() {
      return now();
    }
  };
}
function iphoneSafeArea() {
  if (!location.pathname.startsWith("/app/")) return;
  document.addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style");
    s.textContent = ":root{--safe-t:47px;--safe-b:34px}";
    document.head.appendChild(s);
  });
}

/** Вход (живой режим) и раздел «Клиенты». */
async function session({ role = "owner", c, vp, scheme, tag, tz = "Asia/Almaty" }) {
  const phone = vp.width < 500;
  const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, locale: "ru-RU", timezoneId: tz });
  await ctx.addInitScript(shiftClock, SHIFT);
  if (phone) await ctx.addInitScript(iphoneSafeArea);
  const page = await ctx.newPage();
  const t = { page, ctx, tag, phone, n: 0, errs: [], logs: [], own: new Set(OWN), card: "", allow: [/\/api\/inbox\/me(\?|$)/, /\/favicon\.ico$/] };
  page.on("console", (m) => {
    t.logs.push(m.text());
    if (m.type() !== "error") return;
    const url = m.location()?.url || "";
    if (/Failed to load resource/.test(m.text()) && t.allow.some((r) => r.test(url))) return;
    t.errs.push(`${m.text()}${url ? ` @ ${url}` : ""}`);
  });
  page.on("pageerror", (e) => t.errs.push(`pageerror: ${e.message}`));
  if (DEMO) {
    await page.goto(`${app}?demo&c=${c}${role === "staff" ? "&staff" : ""}`);
  } else {
    await page.goto(`${app}?c=${c}`);
    await page.waitForURL(/\/login/);
    await page.fill("input[name=key]", role === "owner" ? OWNER : STAFF);
    await page.click("button");
    await page.waitForURL(/\/app\//);
  }
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Клиенты" }).click();
  await page.getByRole("heading", { name: "Клиенты" }).first().waitFor();
  await page.waitForLoadState("networkidle");
  return t;
}

async function step(t, name) {
  const { page } = t;
  await page.waitForTimeout(350);
  const label = `${t.tag} · ${name}`;
  const html = await page.content();
  const found = [...new Set(html.match(FULL) || [])].filter((n) => !t.own.has(n) && n !== t.card);
  ok(`${label}: нет полных номеров базы`, !found.length, found.join(", "));
  const side = await page.evaluate(() => {
    const out = [];
    const de = document.documentElement;
    if (de.scrollWidth > innerWidth + 1) out.push(`страница ${de.scrollWidth} > ${innerWidth}`);
    for (const el of document.querySelectorAll(".scroll-area, .app-root, [role=dialog]")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "hidden") out.push(`${el.className.toString().slice(0, 40)} ${el.scrollWidth} > ${el.clientWidth}`);
    }
    for (const el of document.querySelectorAll("[role=dialog]")) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.left < -1 || r.right > innerWidth + 1)) out.push(`лист ${Math.round(r.left)}…${Math.round(r.right)}`);
    }
    return out;
  });
  ok(`${label}: нет прокрутки вбок`, !side.length, side.join("; "));
  ok(`${label}: консоль без ошибок`, !t.errs.length, t.errs.join(" | "));
  t.errs.length = 0;
  t.n += 1;
  await page.screenshot({ path: `${OUT}/${t.tag}-${String(t.n).padStart(2, "0")}-${name}.png` });
}
async function finish(t) {
  const store = await t.page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  ok(`${t.tag}: в хранилище браузера нет номеров`, !FULL.test(store), store.slice(0, 200));
  FULL.lastIndex = 0;
  const leaked = t.logs.flatMap((l) => l.match(FULL) || []).filter((n) => !t.own.has(n));
  ok(`${t.tag}: в консоли нет полных номеров базы`, !leaked.length, leaked.join(", "));
  await t.ctx.close();
}
async function reveal(loc) {
  await loc.evaluate((el) => {
    const sc = el.closest(".scroll-area");
    if (!sc) return;
    const r = el.getBoundingClientRect();
    const s = sc.getBoundingClientRect();
    if (r.top < s.top + 8 || r.bottom > s.bottom - 8) sc.scrollTop += r.top - s.top - Math.max(8, (s.height - r.height) / 3);
  });
  await loc.page().waitForTimeout(120);
}
async function tap(loc) {
  await loc.waitFor();
  await reveal(loc);
  await loc.click();
}
async function fill(loc, value) {
  await loc.waitFor();
  await reveal(loc);
  await loc.fill(value);
}
const text = (loc) => loc.innerText().catch(() => "");
const rows = (page) => page.getByRole("list", { name: "Клиенты" }).locator("li");
/** Кнопка в шапке: на телефоне — значок, на компьютере — кнопка с подписью. */
const headerBtn = (t, phoneLabel, deskLabel) => t.page.getByRole("button", { name: t.phone ? phoneLabel : deskLabel, exact: true }).first();

/** База пуста (живой режим, черновик) — «Тестовые клиенты» в панели синхронизации. */
async function seedIfEmpty(t) {
  const { page } = t;
  if ((await rows(page).count()) > 0) return;
  ok(`${t.tag}: пустая база — подсказка про тестовых клиентов`, /Тестовые клиенты/.test(await text(page.locator("main"))));
  await step(t, "empty");
  await tap(headerBtn(t, "Синхронизация и проверки", "Синхронизация"));
  const panel = page.getByRole("dialog", { name: "Синхронизация и проверки" });
  await panel.waitFor();
  await tap(panel.getByRole("button", { name: "Тестовые клиенты" }));
  await panel.getByRole("status", { name: "Тестовые клиенты" }).waitFor({ timeout: 30_000 });
  ok(`${t.tag}: тестовые клиенты записаны`, !/ошибк/i.test(await text(panel.getByRole("status", { name: "Тестовые клиенты" }))), await text(panel.getByRole("status", { name: "Тестовые клиенты" })));
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });
  await rows(page).first().waitFor({ timeout: 15_000 });
}

/** Карточка первого клиента: открыть, номер полностью только здесь. */
async function openFirst(t) {
  const { page } = t;
  const first = rows(page).first();
  const name = (await text(first.locator("span.block").first())).trim();
  await tap(first.getByRole("button"));
  const card = page.getByRole("dialog");
  await card.getByText("Визиты", { exact: true }).waitFor();
  const phoneText = await text(card.locator("p.tnum").first());
  t.card = phoneText.replace(/\D/g, "");
  ok(`${t.tag}: карточка — номер полностью`, /^\+7 \d{3} \d{3} \d{2} \d{2}$/.test(phoneText.trim()), phoneText);
  ok(`${t.tag}: адрес карточки — #/clients/<id>`, /#\/clients\/.+/.test(page.url()), page.url());
  return { card, name };
}
async function closeCard(t) {
  const { page } = t;
  if (t.phone) await page.getByRole("dialog").getByRole("button", { name: "Назад" }).click();
  else await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  t.card = "";
  ok(`${t.tag}: карточка закрыта — снова список`, /#\/clients$/.test(page.url()), page.url());
}

// =====================================================================================================================
async function owner(vp, scheme, tag) {
  const t = await session({ role: "owner", c: DEMO ? "demo" : "winchester", vp, scheme, tag });
  const { page } = t;
  await page.getByRole("list", { name: "Клиенты" }).or(page.getByText("Клиентов пока нет")).first().waitFor();
  await seedIfEmpty(t);
  const sync = await text(page.locator("main button, main [role=status]").filter({ hasText: /Altegio/ }).first());
  ok(`${tag}: строка состояния Altegio`, /Altegio/.test(sync), sync);
  const listText = await text(page.getByRole("list", { name: "Клиенты" }));
  ok(`${tag}: в списке номера только маской`, /\+7 700 \*\*\* \*\* \d\d/.test(listText), listText.slice(0, 120));
  await step(t, "list");

  // поиск по имени первого с именем
  const named = rows(page).filter({ hasNotText: "Без имени" }).first();
  const who = (await text(named.locator("span.block").first())).trim();
  await fill(page.getByPlaceholder("Имя или номер"), who);
  // ответ на поиск: список перечитывается поверх прежнего — ждём, пока все строки станут про него (до 8 с)
  let found = [];
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(200);
    if (await page.locator('section[aria-busy="true"]').count()) continue;
    found = await rows(page).allInnerTexts();
    if (found.length && found.every((r) => r.includes(who))) break;
  }
  ok(`${tag}: поиск «${who}» — все строки с этим именем`, found.length > 0 && found.every((r) => r.includes(who)), String(found.length));
  await step(t, "search");
  await page.getByRole("button", { name: "Очистить поиск" }).click();
  await page.waitForTimeout(700);
  await page.locator('section[aria-busy="true"]').waitFor({ state: "detached" }).catch(() => {});

  // сегмент
  const segBtn = page.getByRole("group", { name: "Сегменты" }).getByRole("button").nth(1);
  const segName = (await text(segBtn)).replace(/\s*[\d\s]+$/, "").trim();
  await tap(segBtn);
  await page.waitForLoadState("networkidle");
  ok(`${tag}: сегмент «${segName}» выбран`, (await segBtn.getAttribute("aria-pressed")) === "true");
  await step(t, "segment");
  await tap(page.getByRole("group", { name: "Сегменты" }).getByRole("button", { name: /^Все/ }));
  await page.waitForLoadState("networkidle");

  // карточка: согласие, запрет, снятие
  const { card } = await openFirst(t);
  await step(t, "card");
  await tap(card.getByRole("button", { name: "Изменить согласие" }));
  await tap(card.getByRole("radio", { name: "Есть", exact: true }));
  await tap(card.getByRole("button", { name: "Сохранить", exact: true }));
  ok(`${tag}: согласие «есть» без доказательства — ошибка`, /Выберите, чем подтверждено/.test(await text(card)));
  await tap(card.getByRole("radio", { name: /^Письменное согласие/ }));
  await tap(card.getByRole("button", { name: "Сохранить", exact: true }));
  ok(`${tag}: письменное без номера — ошибка под полем`, /Укажите номер анкеты/.test(await text(card)));
  await fill(card.getByLabel("Номер или где хранится"), "анкета № 7 (проверка)");
  await fill(card.getByLabel(/^Основание/), "подписал анкету (проверка)");
  await tap(card.getByRole("button", { name: "Сохранить", exact: true }));
  await card.getByText(/анкета № 7 \(проверка\)/).first().waitFor();
  ok(`${tag}: согласие с доказательством — «Есть, подтверждено»`, /Есть, подтверждено/.test(await text(card.getByText("Реклама и акции").locator(".."))), await text(card.getByText("Реклама и акции").locator("..")));
  await step(t, "consent");

  await tap(card.getByRole("button", { name: "Добавить запрет" }));
  await tap(card.getByRole("button", { name: "Сохранить запрет" }));
  ok(`${tag}: запрет без причины — ошибка`, /Напишите причину/.test(await text(card)));
  await fill(card.getByLabel("Причина"), "просил не присылать акции (проверка)");
  await tap(card.getByRole("button", { name: "Сохранить запрет" }));
  await card.getByText("просил не присылать акции (проверка)").first().waitFor();
  ok(`${tag}: запрет рекламы виден в карточке`, /Не писать рекламу/.test(await text(card)) && /Рекламу писать нельзя/.test(await text(card)));
  await step(t, "restriction");
  // снимаем именно свой запрет (у клиента может быть и «стоп» от него самого — его «Снять» неактивна)
  const mine = card.locator("div.py-3").filter({ hasText: "просил не присылать акции (проверка)" }).first();
  await tap(mine.getByRole("button", { name: "Снять запрет" }));
  await fill(mine.getByLabel("Почему снимаете"), "ошиблись (проверка)");
  await tap(mine.getByRole("button", { name: "Снять запрет" }));
  await card.getByText("Запрет снят", { exact: true }).or(page.getByText("Запрет снят", { exact: true })).first().waitFor();
  await card.getByRole("button", { name: "Снять запрет" }).first().waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  const lifted = card.getByRole("button", { name: /^Снятые · \d+/ });
  await lifted.waitFor();
  await tap(lifted);
  await card.getByRole("list", { name: "Снятые запреты" }).getByText(/ошиблись \(проверка\)/).waitFor({ timeout: 5000 }).catch(() => {});
  ok(`${tag}: снятый запрет — в истории с причиной`, /ошиблись \(проверка\)/.test(await text(card.getByRole("list", { name: "Снятые запреты" }))));
  await step(t, "lifted");
  await closeCard(t);

  // «стоп» от самого клиента: «Снять» неактивна, пока нет нового подтверждённого согласия; после письменного согласия — можно
  // метка ровно «стоп» (не «стоп» ждёт решения); последняя — чтобы не попасть в клиента, которому выше уже записали согласие
  const stopRow = rows(page).filter({ has: page.getByText("«стоп»", { exact: true }) }).last();
  if (!(await stopRow.count())) ok(`${tag}: в базе есть клиент со «стоп» от него самого`, false, "нет строки с меткой «стоп»");
  else {
    await tap(stopRow.getByRole("button"));
    const sc = page.getByRole("dialog");
    await sc.getByText("Визиты", { exact: true }).waitFor();
    t.card = (await text(sc.locator("p.tnum").first())).replace(/\D/g, "");
    const own = sc.locator("div.py-3").filter({ hasText: "от клиента" }).first();
    await own.waitFor();
    const liftBtn = own.getByRole("button", { name: "Снять запрет" });
    ok(`${tag}: «стоп» от клиента — «Снять» неактивна`, await liftBtn.isDisabled());
    ok(`${tag}: «стоп» от клиента — объяснение, почему нельзя`, /нов\S* подтверждённ\S* согласи/.test(await text(own)), await text(own));
    await reveal(own);
    await step(t, "client-stop");
    await tap(own.getByRole("button", { name: "Записать новое согласие" }));
    const ed = sc.getByLabel("Изменить согласие");
    await ed.waitFor();
    ok(`${tag}: после отказа «устно» недоступно`, await ed.getByRole("radio", { name: /^Устно в салоне/ }).isDisabled());
    await tap(ed.getByRole("radio", { name: /^Письменное согласие/ }));
    await fill(ed.getByLabel("Номер или где хранится"), "анкета № 8 (проверка)");
    await fill(ed.getByLabel(/^Основание/), "снова согласился письменно (проверка)");
    await step(t, "new-consent");
    await tap(ed.getByRole("button", { name: "Сохранить", exact: true }));
    await sc.getByText(/анкета № 8 \(проверка\)/).first().waitFor({ timeout: 10_000 }).catch(() => {});
    const own2 = sc.locator("div.py-3").filter({ hasText: "от клиента" }).first();
    const lift2 = own2.getByRole("button", { name: "Снять запрет" });
    await lift2.waitFor();
    const enabled = !(await lift2.isDisabled());
    ok(`${tag}: после нового согласия «Снять» доступна`, enabled, (await text(sc)).slice(0, 300));
    if (enabled) {
      await tap(lift2);
      await fill(own2.getByLabel("Почему снимаете"), "клиент снова согласился (проверка)");
      await tap(own2.getByRole("button", { name: "Снять запрет" }));
      await page.getByText("Запрет снят", { exact: true }).first().waitFor();
      ok(`${tag}: «стоп» снят после нового согласия`, true);
    }
    await step(t, "client-stop-lifted");
    await closeCard(t);
  }

  // добавить клиента: неверный номер, новый, дубль. Ответ 400 на неверный номер ожидаем — браузер всё равно пишет его в консоль
  t.allow.push(/\/api\/contacts\/add$/);
  await tap(headerBtn(t, "Добавить клиента", "Добавить"));
  const sheet = page.getByRole("dialog", { name: "Новый клиент" });
  await sheet.waitFor();
  await fill(sheet.getByLabel("Номер телефона"), "123");
  await tap(sheet.getByRole("button", { name: "Добавить" }).last());
  await sheet.getByText(/казахстанск/).waitFor();
  ok(`${tag}: неверный номер — ошибка под полем`, true);
  await step(t, "add-invalid");
  t.allow.pop();
  await fill(sheet.getByLabel("Номер телефона"), ADD);
  await fill(sheet.getByLabel(/^Имя/), "Новый Клиент");
  await tap(sheet.getByRole("button", { name: "Добавить" }).last());
  await page.waitForURL(/#\/clients\/.+/);
  const card2 = page.getByRole("dialog", { name: "Новый Клиент", exact: true });
  await card2.getByText("Визиты", { exact: true }).waitFor();
  ok(`${tag}: добавлен — открыта его карточка`, /#\/clients\/.+/.test(page.url()) && /Визитов в журнале нет/.test(await text(card2)));
  await step(t, "added");
  await closeCard(t);
  await tap(headerBtn(t, "Добавить клиента", "Добавить"));
  await fill(page.getByRole("dialog", { name: "Новый клиент" }).getByLabel("Номер телефона"), "8 700 000 77 01");
  await tap(page.getByRole("dialog", { name: "Новый клиент" }).getByRole("button", { name: "Добавить" }).last());
  await page.getByText(/уже есть в базе/).waitFor();
  ok(`${tag}: дубль — карточка существующего с пометкой «уже есть»`, /Новый Клиент/.test(await text(page.getByRole("dialog"))));
  await step(t, "dup");
  await closeCard(t);

  // импорт текстом: предпросмотр, основание согласия, загрузка
  await tap(headerBtn(t, "Импорт из файла", "Импорт"));
  const imp = page.getByRole("dialog", { name: "Импорт клиентов" });
  await imp.waitFor();
  await fill(imp.getByLabel("Строки из таблицы"), IMPORT_TEXT);
  await tap(imp.getByRole("button", { name: "Проверить" }));
  await imp.getByRole("list", { name: "Итог проверки" }).waitFor();
  const sum = await text(imp.getByRole("list", { name: "Итог проверки" }));
  ok(`${tag}: предпросмотр — новые 2, дубль 1, неверный 1`, /Новый\s*2/.test(sum) && /Дубль в файле\s*1/.test(sum) && /Неверный номер\s*1/.test(sum), sum.replace(/\s+/g, " "));
  ok(`${tag}: предпросмотр — номера маской`, /\+7 700 \*\*\* \*\* 11/.test(await text(imp.getByRole("list", { name: "Строки файла" }))));
  ok(`${tag}: есть колонка согласия — поле основания и предупреждение`, /Без основания согласия из файла не ставятся/.test(await text(imp)));
  await step(t, "import-preview");
  await fill(imp.getByLabel("Основание согласия"), "анкета (проверка)");
  await tap(imp.getByRole("button", { name: "Загрузить 2" }));
  await imp.getByText(/^Загружено/).waitFor();
  ok(`${tag}: импорт — 2 новых, в файле «да» у одного и «нет» у другого — обе отметки записаны`, /Новых клиентов:\s*2/.test(await text(imp)) && /согласий и отказов записано:\s*2/.test(await text(imp)), await text(imp));
  ok(`${tag}: «да» из файла — не подтверждено`, /Согласий «да» из файла:\s*1\s*— не подтверждены/.test(await text(imp)), await text(imp));
  await step(t, "import-done");
  await tap(imp.getByRole("button", { name: "Готово" }));
  await imp.waitFor({ state: "detached" });

  // карточка клиента из файла: согласие «есть, не подтверждено» и кнопка «Подтвердить»
  await fill(page.getByPlaceholder("Имя или номер"), "Тестовый Один");
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(200);
    if (await page.locator('section[aria-busy="true"]').count()) continue;
    const r = await rows(page).allInnerTexts();
    if (r.length === 1 && /Тестовый Один/.test(r[0])) break;
  }
  ok(`${tag}: в списке — «согласие не подтверждено»`, /согласие не подтверждено/.test(await text(rows(page).first())), await text(rows(page).first()));
  await tap(rows(page).first().getByRole("button"));
  const ic = page.getByRole("dialog");
  await ic.getByText("Визиты", { exact: true }).waitFor();
  t.card = (await text(ic.locator("p.tnum").first())).replace(/\D/g, "");
  const icLine = await text(ic.getByText("Реклама и акции").locator(".."));
  ok(`${tag}: карточка из файла — «Есть, не подтверждено — из файла»`, /Есть, не подтверждено/.test(icLine) && /из файла/.test(icLine), icLine);
  ok(`${tag}: карточка из файла — кнопка «Подтвердить»`, (await ic.getByRole("button", { name: "Подтвердить", exact: true }).count()) === 1);
  ok(`${tag}: рекламу нельзя — согласие не подтверждено`, /согласие не подтвержден|нет подтверждённого согласия/.test(await text(ic)), (await text(ic)).slice(0, 300));
  await step(t, "import-unconfirmed");
  await closeCard(t);
  await page.getByRole("button", { name: "Очистить поиск" }).click();
  await page.waitForTimeout(700);

  // импорт файлом CSV и отмена
  await tap(headerBtn(t, "Импорт из файла", "Импорт"));
  const imp2 = page.getByRole("dialog", { name: "Импорт клиентов" });
  await imp2.locator("input[type=file]").setInputFiles({ name: "clients.csv", mimeType: "text/csv", buffer: Buffer.from(CSV, "utf8") });
  await imp2.getByText(/clients\.csv/).waitFor();
  await tap(imp2.getByRole("button", { name: "Проверить" }));
  await imp2.getByRole("list", { name: "Итог проверки" }).waitFor();
  ok(`${tag}: файл CSV — 2 новых`, /Новый\s*2/.test(await text(imp2.getByRole("list", { name: "Итог проверки" }))));
  await step(t, "import-file");
  await tap(imp2.getByRole("button", { name: "Отменить" }));
  await imp2.waitFor({ state: "detached" });

  // панель синхронизации
  await tap(headerBtn(t, "Синхронизация и проверки", "Синхронизация"));
  const panel = page.getByRole("dialog", { name: "Синхронизация и проверки" });
  await panel.getByText("Проверки данных", { exact: true }).waitFor();
  ok(`${tag}: панель — проверки данных списком`, (await panel.getByRole("list", { name: "Проверки данных" }).locator("li").count()) > 0);
  // «ещё не проверено» — серый «?», а не зелёная галочка
  const checks = panel.getByRole("list", { name: "Проверки данных" });
  const unk = checks.locator('li[data-level="unknown"]');
  ok(`${tag}: есть проверка «ещё не проверено»`, (await unk.count()) > 0);
  const unkIcons = await unk.locator('[role="img"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  ok(`${tag}: «ещё не проверено» — не «в порядке»`, unkIcons.length > 0 && unkIcons.every((l) => l === "ещё не проверено"), unkIcons.join(", "));
  const okTexts = await checks.locator('li[data-level="ok"]').allInnerTexts();
  ok(`${tag}: зелёных «ещё не было» нет`, !okTexts.some((x) => /ещё не (было|проверено|проводилась|читался)/i.test(x)), okTexts.filter((x) => /ещё не/i.test(x)).join(" | "));
  await step(t, "sync-panel");
  for (const [btn, title] of [
    ["Проверка без записи", "Проверка без записи"],
    ["Сверить «стопы» по Green-API", "Сверка «стопов»"],
    ["Проверить", "Перенос «стопов»: проверка"],
  ]) {
    const b = panel.getByRole("button", { name: btn, exact: true });
    if (!(await b.count()) || (await b.isDisabled())) {
      ok(`${tag}: «${btn}» — кнопка есть`, DEMO ? false : true, "нет или выключена");
      continue;
    }
    await tap(b);
    const out = panel.getByRole("status", { name: title });
    await out.waitFor({ timeout: 30_000 });
    ok(`${tag}: «${btn}» — итог строками`, (await out.locator("li").count()) > 0, await text(out));
  }
  await step(t, "sync-actions");
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });
  await finish(t);
}

async function staff(vp, scheme, tag) {
  const t = await session({ role: "staff", c: DEMO ? "demo" : "winchester", vp, scheme, tag });
  const { page } = t;
  await rows(page).first().waitFor({ timeout: 15_000 });
  ok(`${tag}: у сотрудника нет «Синхронизации»`, !(await page.getByRole("button", { name: /^Синхронизация/ }).count()));
  ok(`${tag}: строка Altegio — просто текст`, (await page.getByRole("status").filter({ hasText: /Altegio/ }).count()) > 0);
  await step(t, "list");
  const { card } = await openFirst(t);
  // свой запрет и попытка снять: кнопки «Снять запрет» у сотрудника нет
  await tap(card.getByRole("button", { name: "Добавить запрет" }));
  await fill(card.getByLabel("Причина"), "сотрудник: просил не писать (проверка)");
  await tap(card.getByRole("button", { name: "Сохранить запрет" }));
  await card.getByText("сотрудник: просил не писать (проверка)").first().waitFor();
  ok(`${tag}: у сотрудника нет «Снять запрет»`, !(await card.getByRole("button", { name: "Снять запрет" }).count()));
  await step(t, "card");
  await closeCard(t);
  await finish(t);
}

// телефон в другом часовом поясе (Нью-Йорк, UTC−5): «был N дней назад» и даты — всё равно по Астане, как считает сервер (31.10.2026)
async function otherZone(vp, scheme, tag) {
  const t = await session({ role: "staff", c: "winchester", vp, scheme, tag, tz: "America/New_York" });
  const { page } = t;
  await rows(page).first().waitFor({ timeout: 15_000 });
  const api = await page.evaluate(async () => (await (await fetch("/api/contacts/list?c=winchester")).json()).items.slice(0, 8));
  const word = (d) => (d <= 0 ? "сегодня" : d === 1 ? "вчера" : `${d} ${d % 10 === 1 && d % 100 !== 11 ? "день" : [2, 3, 4].includes(d % 10) && ![12, 13, 14].includes(d % 100) ? "дня" : "дней"} назад`);
  const texts = await rows(page).allInnerTexts();
  const miss = api.filter((x) => x.daysAgo != null).filter((x) => !texts.some((tx) => tx.includes(x.phone) && tx.includes(word(x.daysAgo))));
  ok(`${tag}: дни с визита — по Астане, как у сервера (браузер в Нью-Йорке)`, api.length > 0 && !miss.length, miss.map((x) => `${x.phone}: ${x.daysAgo}`).join("; "));
  await step(t, "other-zone");
  await finish(t);
}

async function notReady(vp, scheme, tag) {
  const t = await session({ role: "owner", c: "demo-empty", vp, scheme, tag });
  const { page } = t;
  await page.getByText("База клиентов ещё не подключена").first().waitFor();
  ok(`${tag}: компания без базы — спокойный экран с причиной`, /нужна база D1/.test(await text(page.locator("main"))));
  await step(t, "not-ready");
  await finish(t);
}

let crashed = "";
const run = async (name, f) => {
  console.log(`\n${name}`);
  try {
    await f();
  } catch (e) {
    crashed ||= name;
    ok(`${name}: прошло до конца`, false, String(e?.message || e).split("\n")[0]);
  }
};
try {
  await run("Владелец · телефон, светлая", () => owner(PHONE, "light", "own-390-light"));
  await run("Сотрудник · телефон, тёмная", () => staff(PHONE, "dark", "staff-390-dark"));
  if (DEMO) {
    // демо держит состояние в странице — компьютер начинает с чистой базы
    await run("Владелец · компьютер, тёмная", () => owner(DESK, "dark", "own-1280-dark"));
    await run("Компания без базы · телефон, светлая", () => notReady(PHONE, "light", "empty-390-light"));
  } else {
    await run("Сотрудник · компьютер, светлая", () => staff(DESK, "light", "staff-1280-light"));
    await run("Сотрудник · телефон в часовом поясе Нью-Йорка", () => otherZone(PHONE, "light", "staff-390-ny"));
  }
} finally {
  await browser.close();
  await close();
}

const bad = results.filter((r) => !r.ok);
console.log(`\nИтог (${DEMO ? "демо" : "живой бот на заглушках"}): ${results.length - bad.length} из ${results.length} проверок прошли${bad.length ? `, не прошли ${bad.length}` : ""}. Снимки: ${OUT}`);
for (const b of bad) console.log(`  ✗ ${b.name}${b.info ? ` — ${b.info}` : ""}`);
process.exit(bad.length ? 1 : 0);
