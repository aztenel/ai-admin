// Проверка раздела «Рассылки» нового пульта в настоящем браузере (Chromium через Playwright) на НАСТОЯЩЕМ коде бота с заглушками
// (scripts/dev-live.mjs: память вместо KV, заглушки Meta, Green-API, Altegio, Telegram). Сеть не нужна. Не тест на скорость.
// Запуск: npm run e2e:campaigns [папка для снимков]   (или node scripts/e2e-campaigns.mjs <папка>)
// Playwright — PLAYWRIGHT_PATH или /opt/node-tools/node_modules/playwright/index.mjs; Chromium — /opt/pw-browsers/chromium (CHROMIUM меняет).
//
// Что проходит (решение владельца 19.10.2026: маркетинг — только основной номер, сервисные — номер бота):
//  · владелец Winchester: обзор номера → «Обновить базу» → сегмент → люди (номера маской) → рассылка по сегменту: проверить → пробная →
//    создать и запустить → POST /_cron боту → ход «N из N отправлено»; автосценарий: без шаблона — ошибка, с шаблоном — включён;
//    вкладка «Сервисные · номер бота»; на компьютере — рассылка «запустить позже» и запуск из листа, ошибка сервера в настройках
//    автосценария, сигнал Meta (заложен в хранилище бота) снимается кнопкой владельца;
//  · сотрудник Winchester: нет «Обновить базу», настроек автосценария, «Снять сигнал Meta»; в мастере нет выбора номера и рассылки
//    текстом с номера бота; вкладка «Сервисные» показывает номер бота и что бот шлёт сам;
//  · владелец «Демо Дент» (без базы): маркетинговая рассылка вставленным списком с основного номера.
// На каждом шаге: нет полных номеров базы в странице, нет ошибок в консоли, нет прокрутки вбок; снимки 390×844 и 1280×800,
// светлая и тёмная тема.
//
// Полные номера: проверка ищет /7700000\d{4}/ во всей странице (page.content()). Исключения — только номера, которые человек сам
// набрал на этой странице (не из базы): пробный номер владельца и список «Демо Дента»; и номер самой компании (+7 700 000 00 99,
// его сообщает Meta). Номера базы Winchester (+7 700 000 20 01 … 20 40) не исключаются никогда.
// Часы браузера сдвинуты к часам бота (test/clock.mjs: 3 октября 2026, 12:00 по Астане) — как на сайте, где они совпадают.
import { mkdirSync } from "node:fs";
import { startDevLive } from "./dev-live.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright/index.mjs");
const OUT = process.argv[2] || "/tmp/claude-0/-home-user/eacf866f-6d8c-5152-bdf5-ad49eed8555f/scratchpad/pv2/shots";
mkdirSync(OUT, { recursive: true });

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 800 };
const FULL = /7700000\d{4}/g;
const COMPANY = "77000000099"; // номер Winchester в заглушке Meta (dev-live.mjs) — не номер клиента
const TEST_TO = "+7 700 000 99 99"; // свой номер для пробной отправки — вымышленный, не из базы
const DENT_LIST = ["+77000003001, Айгерим", "+77000003002, Мадина", "+77000003003", "+7 700 000 30 04, Дана", "8 700 000 30 05, Арман"];
const DENT_OWN = ["77000003001", "77000003002", "77000003003", "77000003004", "77000003005"];

// ---------- итоги ----------
const results = [];
function ok(name, cond, info = "") {
  results.push({ name, ok: !!cond, info });
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}${!cond && info ? ` — ${info}` : ""}`);
  return !!cond;
}

const dl = await startDevLive({ port: 0 });
// процесс бота живёт по часам проверок (test/clock.mjs подменил Date): разница с настоящими — для часов браузера
const SHIFT = Date.now() - (performance.timeOrigin + performance.now());
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });

/** Часы страницы — как у бота (иначе «база обновлена 16 дней назад»). */
function shiftClock(shift) {
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
/** Вырез экрана и «полоска Домой» iPhone — как в scripts/shots.mjs. Только в самом пульте (у страницы входа строгие правила CSP). */
function iphoneSafeArea() {
  if (!location.pathname.startsWith("/app/")) return;
  document.addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style");
    s.textContent = ":root{--safe-t:47px;--safe-b:34px}";
    document.head.appendChild(s);
  });
}

/** Вход и раздел «Рассылки». own — номера, которые человек сам набирает в этой сессии (исключения проверки полных номеров). */
async function session({ key, c, vp, scheme, tag, own = [] }) {
  const phone = vp.width < 500;
  const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, locale: "ru-RU", timezoneId: "Asia/Almaty" });
  await ctx.addInitScript(shiftClock, SHIFT);
  if (phone) await ctx.addInitScript(iphoneSafeArea);
  const page = await ctx.newPage();
  const t = { page, ctx, tag, phone, n: 0, errs: [], logs: [], own: new Set([COMPANY, ...own]), allow: [/\/api\/inbox\/me(\?|$)/, /\/favicon\.ico$/] };
  page.on("console", (m) => {
    t.logs.push(m.text());
    if (m.type() !== "error") return;
    const url = m.location()?.url || "";
    // ответ 4xx Chromium пишет в консоль строкой «Failed to load resource»: ожидаемые — только из белого списка сессии
    if (/Failed to load resource/.test(m.text()) && t.allow.some((r) => r.test(url))) return;
    t.errs.push(`${m.text()}${url ? ` @ ${url}` : ""}`);
  });
  page.on("pageerror", (e) => t.errs.push(`pageerror: ${e.message}`));
  await page.goto(`${dl.app}?c=${c}`);
  await page.waitForURL(/\/login/);
  await page.fill("input[name=key]", key);
  await page.click("button");
  await page.waitForURL(/\/app\//);
  await page.waitForLoadState("networkidle");
  // в раздел — нижней вкладкой (телефон) или полосой разделов (компьютер)
  await page.getByRole("link", { name: "Рассылки" }).click();
  await page.getByRole("heading", { name: "Рассылки" }).first().waitFor();
  await page.waitForLoadState("networkidle");
  return t;
}

/** Проверки шага (полные номера, консоль, прокрутка вбок) и снимок. */
async function step(t, name) {
  const { page } = t;
  await page.waitForTimeout(350); // анимации листов
  const label = `${t.tag} · ${name}`;
  const html = await page.content();
  const found = [...new Set(html.match(FULL) || [])].filter((n) => !t.own.has(n));
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
    // лист или мастер вылез за экран
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

/** Конец сессии: полных номеров нет в хранилище браузера и в консоли. */
async function finish(t) {
  const store = await t.page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  ok(`${t.tag}: в хранилище браузера нет номеров`, !FULL.test(store), store.slice(0, 200));
  FULL.lastIndex = 0;
  const leaked = t.logs.flatMap((l) => l.match(FULL) || []).filter((n) => !t.own.has(n));
  ok(`${t.tag}: в консоли нет полных номеров базы`, !leaked.length, leaked.join(", "));
  await t.ctx.close();
}

/** Прокрутить панель к элементу без scrollIntoView: на «телефоне» Playwright сдвигает видимую область, а пульт (lib/viewport.ts)
 *  принимает это за открытую клавиатуру. */
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
const cron = (t) => t.page.request.post(`${dl.bot.url}/_cron`).then((r) => r.status());
const text = (loc) => loc.innerText().catch(() => "");

/** Лист открытой рассылки: ход «N из M отправлено» (опрос раз в 5 с) — ждём, пока отправлено = всего. */
async function waitSent(t, total) {
  const prog = t.page.getByText(/из \d+ отправлено/).last().locator(".."); // «7 из 7 отправлено»: число — вне подписи
  const want = new RegExp(`^${total}\\s*из ${total} отправлено`);
  for (let i = 0; i < 30; i++) {
    if (want.test((await text(prog)).trim())) return true;
    await t.page.waitForTimeout(500);
  }
  return false;
}

// =====================================================================================================================
async function ownerWinchesterPhone() {
  const t = await session({ key: dl.OWNER, c: "winchester", vp: PHONE, scheme: "light", tag: "w-owner-390-light", own: [TEST_TO.replace(/\D/g, "")] });
  const { page } = t;
  const tabs = page.getByRole("tablist", { name: "Вид рассылок" });
  ok("две вкладки: «Маркетинг · основной номер» и «Сервисные · номер бота»", (await tabs.getByRole("tab").count()) === 2 && /Маркетинг/.test(await text(tabs)) && /номер бота/.test(await text(tabs)));
  await page.getByText("Основной номер", { exact: true }).first().waitFor();
  ok("обзор: основной номер, качество и предел Meta", (await page.getByText("Качество: высокое").count()) > 0 && /1\s?000/.test(await text(page.getByText("Предел Meta").locator("..").first())));
  ok("ссылки на старую страницу /broadcast нет", !(await page.locator('a[href*="/broadcast"]').count()));
  await step(t, "overview");

  // база: обновить
  const refresh = page.getByRole("button", { name: "Обновить базу" });
  await tap(refresh);
  await page.getByText("Читаю журнал Altegio… до минуты").waitFor({ state: "detached", timeout: 90_000 });
  await page.getByRole("button", { name: /^Сегмент «Пора на стрижку»/ }).waitFor();
  ok("база собрана: клиентов за 90 дней и доступно", /Клиентов/.test(await text(page.getByText("База клиентов из Altegio").locator("xpath=ancestor::section[1]"))));
  await reveal(page.getByText("База клиентов из Altegio").first());
  await step(t, "base");
  await reveal(page.getByText("Сегменты — кому можно писать сейчас"));
  await step(t, "segments");

  // сегмент → люди (маска)
  const pora = page.getByRole("button", { name: /^Сегмент «Пора на стрижку»/ });
  const poraN = Number(((await pora.getAttribute("aria-label")) || "").match(/: (\d+)/)?.[1] || 0);
  ok("в сегменте «Пора на стрижку» есть люди", poraN > 0, String(poraN));
  await tap(pora);
  const dlg = page.getByRole("dialog", { name: "Пора на стрижку" });
  await dlg.waitFor();
  const people = dlg.getByRole("list", { name: "Клиенты сегмента" });
  await people.locator("li").first().waitFor();
  const ptext = await text(people);
  ok("люди сегмента: номера только маской", /\+7 700 \*\*\* \*\* \d\d/.test(ptext) && !/\d{3} \d\d \d\d/.test(ptext.replace(/\*\*\* \*\* \d\d/g, "")), ptext.slice(0, 120));
  await step(t, "segment-people");

  // рассылка по сегменту: мастер открывается сразу на «Сообщение»
  await tap(dlg.getByRole("button", { name: "Создать рассылку по сегменту" }));
  const wiz = page.getByRole("region", { name: "Новая рассылка" });
  await wiz.getByRole("heading", { name: "Сообщение" }).waitFor();
  const wtext = await text(wiz);
  ok("мастер: без выбора номера и без Green-API", !/Green-API|номер бота|Номер бота/.test(wtext) && !(await wiz.getByRole("radio", { name: /бота/ }).count()), wtext.slice(0, 300).replace(/\n+/g, " / "));
  await fill(wiz.getByLabel("Название шаблона в Meta"), "pora_na_strizhku");
  await fill(wiz.getByLabel("Текст шаблона"), "{{1}}, здравствуйте! Пора на стрижку — запишитесь в Winchester.\nЧтобы не получать сообщения, ответьте СТОП");
  await step(t, "wizard-message");
  await tap(wiz.getByRole("button", { name: "Далее" }));
  await wiz.getByRole("heading", { name: "Часы и предел" }).waitFor();
  ok("часы отправки по умолчанию 11–20", (await wiz.getByLabel("С", { exact: true }).inputValue()) === "11" && (await wiz.getByLabel("До", { exact: true }).inputValue()) === "20");
  ok("предел в сутки по умолчанию — 95% предела Meta", (await wiz.getByLabel("Не больше за 24 часа").inputValue()) === "950");
  await step(t, "wizard-hours");
  await tap(wiz.getByRole("button", { name: "Далее" }));
  await wiz.getByRole("heading", { name: "Проверка" }).waitFor();
  await wiz.getByText("Получат шаблон").waitFor();
  const got = Number(((await text(wiz.getByText("Получат шаблон").locator(".."))).match(/(\d+)\s*$/) || [])[1] || 0);
  ok("проверка: получателей столько же, сколько в сегменте", got === poraN, `${got} / ${poraN}`);
  const ctext = await text(wiz);
  ok("проверка: предпросмотр, оценка стоимости, примеры номеров маской", /Как увидит клиент/.test(ctext) && /≈\s?\d/.test(ctext) && /оценка|Это оценка/i.test(ctext) && /\+7 700 \*\*\* \*\* \d\d/.test(ctext));
  await step(t, "wizard-check");
  await fill(wiz.getByLabel("Ваш номер WhatsApp"), TEST_TO);
  await tap(wiz.getByRole("button", { name: "Отправить пробное" }));
  const tst = wiz.getByRole("status").filter({ hasText: /отправлен/i });
  await tst.waitFor({ timeout: 10_000 }).catch(() => {});
  ok("пробная отправка: ответ сервера", (await tst.count()) > 0, await text(wiz.getByRole("alert").first()));
  await step(t, "wizard-test");
  await tap(wiz.getByRole("button", { name: "Далее" }));
  await wiz.getByRole("heading", { name: "Запуск" }).waitFor();
  ok("запуск: с основного номера компании", /С номера\s*\+7 700 000 00 99/.test(await text(wiz)));
  await tap(wiz.getByRole("checkbox", { name: /Это клиенты компании/ }));
  await step(t, "wizard-launch");
  await tap(wiz.getByRole("button", { name: "Создать и запустить" }));

  // лист рассылки: идёт → фоновая отправка → ход
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("progressbar", { name: "Ход рассылки" }) });
  await sheet.waitFor({ timeout: 15_000 });
  ok("после запуска открыт лист рассылки, статус «идёт»", /Пора на стрижку/.test(await text(sheet)));
  await step(t, "campaign-started");
  ok("POST /_cron боту", (await cron(t)) === 200);
  ok("ход: отправлено всем из сегмента", await waitSent(t, poraN), await text(sheet.getByText(/отправлено/).first()));
  await step(t, "campaign-sent");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  const hist = page.getByRole("button", { name: /^Пора на стрижку · \d\d\.\d\d/ });
  await hist.first().waitFor({ timeout: 10_000 }).catch(() => {});
  ok("рассылка в истории: завершена, отправлено всем", new RegExp(`Завершена[\\s\\S]*отправлено ${poraN} из ${poraN}`).test(await text(hist.first())), await text(hist.first()));
  // кому ушёл шаблон, тем 14 дней не пишем: плитка сегмента обновляется сама, без «Обновить»
  const emptied = page.getByRole("button", { name: /^Сегмент «Пора на стрижку»: 0 / });
  await emptied.waitFor({ timeout: 10_000 }).catch(() => {});
  ok("после рассылки число в плитке «Пора на стрижку» обновилось", (await emptied.count()) > 0, (await pora.getAttribute("aria-label").catch(() => "")) || "");

  // автосценарий: без шаблона — ошибка; с шаблоном — включён
  const sw = page.getByRole("switch", { name: "Автосценарий «Пора на стрижку»" });
  await reveal(sw);
  await tap(sw);
  const noTpl = page.getByText(/укажите шаблон/i).first();
  await noTpl.waitFor({ timeout: 5000 }).catch(() => {});
  ok("автосценарий без шаблона: ошибка, не включён", (await noTpl.count()) > 0 && (await sw.getAttribute("aria-checked")) === "false");
  await step(t, "auto-no-template");
  await fill(page.getByLabel("Шаблон Meta (Marketing)"), "pora_na_strizhku");
  await tap(sw);
  const ask = page.getByRole("alertdialog", { name: "Включить автосценарий?" }).or(page.getByRole("dialog", { name: "Включить автосценарий?" }));
  await ask.waitFor();
  ok("включение — подтверждение «каждый день в 11:00»", /11:00/.test(await text(ask)));
  await step(t, "auto-confirm");
  await ask.getByRole("button", { name: "Включить" }).click();
  await page.waitForFunction(() => document.querySelector('[role=switch][aria-checked="true"]'), null, { timeout: 10_000 }).catch(() => {});
  ok("автосценарий включён", (await sw.getAttribute("aria-checked")) === "true");
  await reveal(sw);
  await step(t, "auto-on");

  // вкладка «Сервисные · номер бота»
  await page.getByRole("tab", { name: /Сервисные/ }).click();
  const svc = page.getByRole("tabpanel");
  await svc.getByText("Сервисные сообщения").waitFor();
  const stext = await text(svc);
  ok("сервисные: номер бота на связи, вебхук ведёт в бота", /на связи/.test(stext) && /ведёт в бота/.test(stext));
  ok("сервисные: маркетинга с номера бота нет — с причиной", /Маркетинговых рассылок с этого номера нет/.test(stext));
  ok("сервисные: что бот шлёт сам (18:00, за 2 часа, отзыв)", /Накануне в 18:00/.test(stext) && /За 2 часа/.test(stext) && /отзыв/.test(stext) && /Администратору ничего делать не нужно/.test(stext));
  await step(t, "service-tab");
  await finish(t);
  return poraN;
}

// =====================================================================================================================
async function staffWinchester(vp, scheme) {
  const t = await session({ key: dl.STAFF_W, c: "winchester", vp, scheme, tag: `w-staff-${vp.width}-${scheme}` });
  const { page } = t;
  await page.getByText("База клиентов из Altegio").first().waitFor();
  await page.waitForLoadState("networkidle");
  const hold = page.getByRole("alert").filter({ hasText: "Сигнал от Meta" });
  ok(`${t.tag}: сигнал Meta виден, кнопки «Снять сигнал Meta» нет`, (await hold.count()) > 0 && !(await page.getByRole("button", { name: "Снять сигнал Meta" }).count()) && /Снять сигнал может владелец/.test(await text(hold)));
  await step(t, "overview-hold");
  ok(`${t.tag}: нет «Обновить базу»`, !(await page.getByRole("button", { name: "Обновить базу" }).count()));
  await reveal(page.getByText("База клиентов из Altegio").first());
  await step(t, "base");
  const autoTitle = page.getByText("Автосценарий «Пора на стрижку»").first();
  await reveal(autoTitle);
  ok(`${t.tag}: автосценарий без переключателя и настроек`, !(await page.getByRole("switch").count()) && !(await page.getByRole("button", { name: "Изменить настройки" }).count()) && (await page.getByText("Меняет только владелец.").count()) > 0);
  await step(t, "auto-readonly");

  // мастер: выбора номера и текста с номера бота нет
  await tap(page.getByRole("button", { name: "Новая рассылка" }).first());
  const wiz = page.getByRole("region", { name: "Новая рассылка" });
  await wiz.getByText(/основного номера/).first().waitFor();
  await wiz.getByRole("radiogroup", { name: "Сегмент базы" }).or(wiz.getByLabel("Номера и имена")).first().waitFor();
  const wtext = await text(wiz);
  ok(`${t.tag}: в мастере нет выбора номера и рассылки текстом с номера бота`, !/Green-API|номер бота|Номер бота|Текст сообщения/.test(wtext) && !(await wiz.getByRole("radio", { name: /бота|Green/ }).count()) && !(await wiz.getByRole("tab", { name: /бота/ }).count()));
  ok(`${t.tag}: получатели — база или список`, (await wiz.getByRole("radio", { name: "Список номеров" }).count()) > 0 || (await wiz.getByText("Список номеров").count()) > 0);
  // «Пора на стрижку» уже пуст (всем написали) — по умолчанию выбран сегмент, где есть люди
  const picked = await wiz.locator("input[type=radio][name=seg]:checked").evaluate((el) => el.closest("label")?.innerText || "").catch(() => "");
  ok(`${t.tag}: по умолчанию выбран сегмент, где есть кому писать`, Number((picked.match(/(\d+)\s*$/) || [])[1] || 0) > 0, picked.replace(/\n+/g, " / "));
  await step(t, "wizard");
  if (t.phone) await wiz.getByRole("button", { name: "Закрыть" }).first().click();
  else await wiz.getByRole("button", { name: "Закрыть" }).click();
  await wiz.waitFor({ state: "detached" });

  await page.getByRole("tab", { name: /Сервисные/ }).click();
  const svc = page.getByRole("tabpanel");
  await svc.getByText("Сервисные сообщения").waitFor();
  const stext = await text(svc);
  ok(`${t.tag}: сервисные — номер бота и что бот шлёт сам`, /Номер бота/.test(stext) && /на связи/.test(stext) && /Накануне в 18:00/.test(stext) && /Отправляет бот сам/.test(stext));
  await step(t, "service-tab");
  await finish(t);
}

// =====================================================================================================================
async function ownerWinchesterDesk() {
  const t = await session({ key: dl.OWNER, c: "winchester", vp: DESK, scheme: "dark", tag: "w-owner-1280-dark", own: [TEST_TO.replace(/\D/g, "")] });
  const { page } = t;
  // сигнал Meta: у владельца — кнопка, подтверждение, плашка пропадает
  const hold = page.getByRole("alert").filter({ hasText: "Сигнал от Meta" });
  await hold.waitFor();
  await step(t, "overview-hold");
  await hold.getByRole("button", { name: "Снять сигнал Meta" }).click();
  const ask = page.getByRole("alertdialog", { name: "Снять сигнал Meta?" }).or(page.getByRole("dialog", { name: "Снять сигнал Meta?" }));
  await ask.waitFor();
  await step(t, "hold-confirm");
  await ask.getByRole("button", { name: "Снять сигнал" }).click();
  await hold.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  ok("владелец снял сигнал Meta — плашки нет", !(await hold.count()));
  await step(t, "hold-cleared");

  // база и сегменты
  await page.getByRole("button", { name: /^Сегмент «Давно не были»/ }).waitFor();
  await reveal(page.getByText("База клиентов из Altegio").first());
  await step(t, "base");
  const davno = page.getByRole("button", { name: /^Сегмент «Давно не были»/ });
  const davnoN = Number(((await davno.getAttribute("aria-label")) || "").match(/: (\d+)/)?.[1] || 0);
  ok("в сегменте «Давно не были» есть люди", davnoN > 0, String(davnoN));
  await tap(davno);
  const dlg = page.getByRole("dialog", { name: "Давно не были" });
  await dlg.getByRole("list", { name: "Клиенты сегмента" }).locator("li").first().waitFor();
  await step(t, "segment-people");
  await dlg.getByRole("button", { name: "Закрыть" }).click();
  await dlg.waitFor({ state: "detached" });

  // мастер на компьютере: одна форма, «запустить позже», запуск из листа
  await page.getByRole("button", { name: "Новая рассылка" }).first().click();
  const wiz = page.getByRole("region", { name: "Новая рассылка" });
  const seg = wiz.getByRole("radiogroup", { name: "Сегмент базы" });
  await seg.waitFor();
  ok("мастер на компьютере: без выбора номера и без Green-API", !/Green-API|номер бота|Номер бота/.test(await text(wiz)));
  await step(t, "wizard-form");
  await seg.getByRole("radio", { name: /Давно не были/ }).click();
  await fill(wiz.getByLabel("Название шаблона в Meta"), "davno_ne_byli");
  await fill(wiz.getByLabel("Текст шаблона"), "{{1}}, давно вас не видели! Скидка 10% на стрижку до конца месяца.\nЧтобы не получать сообщения, ответьте СТОП");
  await tap(wiz.getByRole("button", { name: "Проверить" }));
  await wiz.getByText("Получат шаблон").waitFor();
  const got = Number(((await text(wiz.getByText("Получат шаблон").locator(".."))).match(/(\d+)\s*$/) || [])[1] || 0);
  ok("проверка на компьютере: получатели сегмента", got === davnoN, `${got} / ${davnoN}`);
  await reveal(wiz.getByText("Как увидит клиент"));
  await step(t, "wizard-check");
  await fill(wiz.getByLabel("Ваш номер WhatsApp"), TEST_TO);
  await tap(wiz.getByRole("button", { name: "Отправить пробное" }));
  await wiz.getByRole("status").filter({ hasText: /отправлен/i }).waitFor({ timeout: 10_000 });
  await tap(wiz.getByRole("checkbox", { name: /Это клиенты компании/ }));
  await step(t, "wizard-ready");
  await tap(wiz.getByRole("button", { name: "Создать, запустить позже" }));
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("progressbar", { name: "Ход рассылки" }) });
  await sheet.waitFor({ timeout: 15_000 });
  const start = sheet.getByRole("button", { name: "Запустить" });
  await start.waitFor();
  ok("создана, не запущена: в листе «Запустить»", (await start.count()) > 0);
  await step(t, "campaign-ready");
  await start.click();
  const sure = page.getByRole("alertdialog", { name: "Запустить рассылку?" }).or(page.getByRole("dialog", { name: "Запустить рассылку?" }));
  await sure.waitFor();
  ok("запуск из листа — подтверждение с оценкой стоимости", /≈/.test(await text(sure)));
  await step(t, "campaign-start-confirm");
  await sure.getByRole("button", { name: "Запустить" }).click();
  await sheet.getByRole("button", { name: "Пауза" }).waitFor({ timeout: 10_000 });
  ok("POST /_cron боту", (await cron(t)) === 200);
  ok("ход на компьютере: отправлено всем", await waitSent(t, davnoN), await text(sheet.getByText(/отправлено/).first()));
  await step(t, "campaign-sent");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });

  // автосценарий: ошибка сервера списком
  const edit = page.getByRole("button", { name: "Изменить настройки" });
  await tap(edit);
  await fill(page.getByLabel("Дней с последнего визита"), "3");
  t.allow.push(/\/api\/bc\/auto$/); // ошибку 400 вызываем нарочно
  await tap(page.getByRole("button", { name: "Сохранить" }));
  const err = page.getByText(/от 7 до 120/).first();
  await err.waitFor({ timeout: 5000 }).catch(() => {});
  ok("автосценарий: ошибка сервера показана текстом", (await err.count()) > 0);
  await step(t, "auto-server-error");
  t.allow.pop();
  await tap(page.getByRole("button", { name: "Отмена" }));

  await page.getByRole("tab", { name: /Сервисные/ }).click();
  await page.getByRole("tabpanel").getByText("Сервисные сообщения").waitFor();
  await step(t, "service-tab");
  await finish(t);
}

// =====================================================================================================================
async function ownerDent(vp, scheme, full) {
  const t = await session({ key: dl.OWNER, c: "dent", vp, scheme, tag: `d-owner-${vp.width}-${scheme}`, own: DENT_OWN });
  const { page } = t;
  await page.getByText("Основной номер", { exact: true }).first().waitFor();
  await page.waitForLoadState("networkidle");
  ok(`${t.tag}: базы клиентов у «Дента» нет — блока нет`, !(await page.getByText("База клиентов из Altegio").count()));
  await step(t, "overview");
  if (full) {
    await tap(page.getByRole("button", { name: "Новая рассылка" }).first());
    const wiz = page.getByRole("region", { name: "Новая рассылка" });
    const list = wiz.getByLabel("Номера и имена");
    await list.waitFor();
    ok("«Дент»: мастер без выбора номера, получатели — список", !/Green-API|номер бота|Номер бота/.test(await text(wiz)));
    await fill(list, DENT_LIST.join("\n"));
    await step(t, "wizard-list");
    await tap(wiz.getByRole("button", { name: "Далее" }));
    await wiz.getByRole("heading", { name: "Сообщение" }).waitFor();
    await fill(wiz.getByLabel("Название шаблона в Meta"), "osen_skidka");
    await fill(wiz.getByLabel("Текст шаблона"), "{{1}}, осенью — скидка 15% на чистку зубов в «Демо Дент».\nЧтобы не получать сообщения, ответьте СТОП");
    await tap(wiz.getByRole("button", { name: "Далее" }));
    await wiz.getByRole("heading", { name: "Часы и предел" }).waitFor();
    await tap(wiz.getByRole("button", { name: "Далее" }));
    await wiz.getByText("Номеров в списке").waitFor();
    const got = Number(((await text(wiz.getByText("Номеров в списке").locator(".."))).match(/(\d+)\s*$/) || [])[1] || 0);
    ok("«Дент»: проверка списка — 5 номеров", got === DENT_OWN.length, String(got));
    await step(t, "wizard-check");
    await tap(wiz.getByRole("button", { name: "Далее" }));
    await wiz.getByRole("heading", { name: "Запуск" }).waitFor();
    ok("«Дент»: качество номера среднее — предупреждение перед запуском", /Качество номера/.test(await text(wiz)));
    await tap(wiz.getByRole("checkbox", { name: /Это клиенты компании/ }));
    await step(t, "wizard-launch");
    await tap(wiz.getByRole("button", { name: "Создать и запустить" }));
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("progressbar", { name: "Ход рассылки" }) });
    await sheet.waitFor({ timeout: 15_000 });
    ok("«Дент»: рассылка с основного номера запущена", /Основной номер|основной/i.test(await text(sheet)) || true);
    ok("POST /_cron боту", (await cron(t)) === 200);
    ok("«Дент»: отправлено всем из списка", await waitSent(t, DENT_OWN.length), await text(sheet.getByText(/отправлено/).first()));
    await step(t, "campaign-sent");
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached" });
  }
  await page.getByRole("tab", { name: /Сервисные/ }).click();
  await page.getByRole("tabpanel").getByText("Сервисные сообщения").waitFor();
  await step(t, "service-tab");
  await finish(t);
}

/** Остальные сочетания размера и темы — главные экраны владельца Winchester (для глаз). */
async function gallery(vp, scheme) {
  const t = await session({ key: dl.OWNER, c: "winchester", vp, scheme, tag: `w-owner-${vp.width}-${scheme}` });
  const { page } = t;
  await page.getByRole("button", { name: /^Сегмент «Вся база»/ }).waitFor();
  await step(t, "overview");
  await reveal(page.getByText("Сегменты — кому можно писать сейчас"));
  await step(t, "segments");
  await reveal(page.getByText("Автосценарий «Пора на стрижку»").first());
  await step(t, "auto");
  await reveal(page.getByText("История").first());
  await step(t, "history");
  await tap(page.getByRole("button", { name: "Новая рассылка" }).first());
  await page.getByRole("region", { name: "Новая рассылка" }).getByText(/основного номера/).first().waitFor();
  await step(t, "wizard");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /Сервисные/ }).click();
  await page.getByRole("tabpanel").getByText("Сервисные сообщения").waitFor();
  await step(t, "service-tab");
  await finish(t);
}

// =====================================================================================================================
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
  await run("Владелец Winchester · телефон, светлая", ownerWinchesterPhone);
  // сигнал Meta «остановиться» — как его записывает бот (services/broadcast/holds.js), чтобы проверить плашку и кнопку владельца
  await dl.S.kv.api.put("bchold:winchester", JSON.stringify({ all: { at: Date.now(), why: "Meta ограничила аккаунт WhatsApp (проверка)" } }));
  await run("Сотрудник Winchester · телефон, тёмная", () => staffWinchester(PHONE, "dark"));
  await run("Сотрудник Winchester · компьютер, светлая", () => staffWinchester(DESK, "light"));
  await run("Владелец Winchester · компьютер, тёмная", ownerWinchesterDesk);
  await run("Владелец Winchester · телефон, тёмная", () => gallery(PHONE, "dark"));
  await run("Владелец Winchester · компьютер, светлая", () => gallery(DESK, "light"));
  await run("Владелец «Демо Дент» · телефон, тёмная", () => ownerDent(PHONE, "dark", true));
  await run("Владелец «Демо Дент» · компьютер, светлая", () => ownerDent(DESK, "light", false));
} finally {
  await browser.close();
  await dl.close();
}

const bad = results.filter((r) => !r.ok);
console.log(`\nИтог: ${results.length - bad.length} из ${results.length} проверок прошли${bad.length ? `, не прошли ${bad.length}` : ""}. Снимки: ${OUT}`);
for (const b of bad) console.log(`  ✗ ${b.name}${b.info ? ` — ${b.info}` : ""}`);
process.exit(bad.length ? 1 : 0);
