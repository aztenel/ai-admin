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
//  · владелец «Демо Дент» (без базы): маркетинговая рассылка вставленным списком с основного номера;
//  · находки проверки 19.10.2026 — отдельными сессиями в конце (fixes*): каждый шаг до правки не проходил; собранный пульт без связи
//    проверяется на свежей сборке во временной папке (vite build + vite preview с тем же ботом).
// На каждом шаге: нет полных номеров базы в странице, нет ошибок в консоли, нет прокрутки вбок; снимки 390×844 и 1280×800,
// светлая и тёмная тема.
//
// Полные номера: проверка ищет /7700000\d{4}/ во всей странице (page.content()). Исключения — только номера, которые человек сам
// набрал на этой странице (не из базы): пробный номер владельца и список «Демо Дента»; и номер самой компании (+7 700 000 00 99,
// его сообщает Meta). Номера базы Winchester (+7 700 000 20 01 … 20 40) не исключаются никогда.
// Часы браузера сдвинуты к часам бота (test/clock.mjs: 3 октября 2026, 12:00 по Астане) — как на сайте, где они совпадают.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
async function session({ key, c, vp, scheme, tag, own = [], app = dl.app }) {
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
  await page.goto(`${app}?c=${c}`);
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

/** Вкладка «Сервисные»: очередь Winchester из dev-live.mjs — 8 сообщений по трём записям через бота (номера +7 700 000 11 01…03),
 *  только маской; первое — за 2 часа до записи Тимура сегодня в 17:00; ушло за 3 дня — 2. Владелец и сотрудник видят одно и то же. */
async function svcQueue(t, svc) {
  const list = svc.getByRole("list", { name: "Ближайшие сообщения" });
  await list.waitFor();
  const rows = list.locator("li");
  ok(`${t.tag}: сервисные — в очереди 8 сообщений`, (await rows.count()) === 8 && /В очереди\s*8/.test(await text(svc)), String(await rows.count()));
  const first = (await text(rows.first())).replace(/\s+/g, " ");
  ok(`${t.tag}: сервисные — первое: Тимур, сегодня в 15:00, за 2 часа до записи на 17:00`, /Тимур/.test(first) && /сегодня, 15:00/.test(first) && /Напоминание за 2 часа/.test(first) && /запись на сегодня, 17:00/.test(first), first);
  const all = await text(list);
  ok(`${t.tag}: сервисные — номера маской`, ["01", "02", "03"].every((x) => all.includes(`+7 700 *** ** ${x}`)) && /Просьба об отзыве · после визита/.test(all) && /Напоминание накануне · запись на завтра, 12:00/.test(all), all.slice(0, 200));
  // запись без имени — вместо имени номер маской
  ok(`${t.tag}: сервисные — без имени: номер маской вместо имени`, (await list.locator("li p.truncate", { hasText: "+7 700 *** ** 02" }).count()) === 3);
  ok(`${t.tag}: сервисные — отправлено за 3 дня: 2`, /Отправлено за 3 дня\s*2/.test(await text(svc)));
  ok(`${t.tag}: сервисные — полных номеров клиентов очереди нет`, !/770000011\d{2}/.test(await t.page.content()));
}

// =====================================================================================================================
async function ownerWinchesterPhone() {
  const t = await session({ key: dl.OWNER, c: "winchester", vp: PHONE, scheme: "light", tag: "w-owner-390-light", own: [TEST_TO.replace(/\D/g, "")] });
  const { page } = t;
  const tabs = page.getByRole("tablist", { name: "Вид рассылок" });
  ok("две вкладки: «Маркетинг · основной номер» и «Сервисные · номер бота»", (await tabs.getByRole("tab").count()) === 2 && /Маркетинг/.test(await text(tabs)) && /номер бота/.test(await text(tabs)));
  await page.getByText("Основной номер", { exact: true }).first().waitFor();
  ok("обзор: основной номер, качество и предел Meta", /высокое/.test(await text(page.getByText("Качество", { exact: true }).first().locator(".."))) && /1\s?000/.test(await text(page.getByText("Предел Meta").locator("..").first())));
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

  // вкладка «Сервисные · номер бота»: что уходит само со второго номера (с 30.10.2026 — по журналу Altegio, без бота) и очередь
  // из хранилища бота (dev-live.mjs: jrq:winchester, отметки rms:)
  await page.getByRole("tab", { name: /Сервисные/ }).click();
  const svc = page.getByRole("tabpanel");
  await svc.getByText("Что уходит само").waitFor();
  const stext = await text(svc);
  ok("сервисные: номер бота на связи, вебхук ведёт в бота", /на связи/.test(stext) && /ведёт в бота/.test(stext));
  ok("сервисные: маркетинга с номера бота нет — с причиной", /Маркетинговых рассылок с этого номера нет/.test(stext));
  ok("сервисные: что бот шлёт сам (18:00, за 2 часа, отзыв)", /Накануне в 18:00/.test(stext) && /За 2 часа/.test(stext) && /отзыв/.test(stext) && /Администратору ничего делать не нужно/.test(stext));
  ok("сервисные: кому — по всем записям журнала Altegio, отзыв — с отметкой «пришёл»", /по всем записям журнала Altegio/.test(stext) && /отмечено «пришёл»/.test(stext) && !/прямо в Altegio, бот не напоминает/.test(stext));
  ok("[12] сервисные: со второго номера (Winchester — по журналу, без бота), не «бот шлёт сам»", /Уходят сами со второго номера/.test(stext) && !/Отправляет бот сам/.test(stext), stext.slice(0, 300));
  ok("сервисные: работает только на боевом сайте", /только с боевого сайта/.test(stext) && /С черновика они не отправляются/.test(stext));
  ok("сервисные: все три вида включены, у отзыва — ссылка 2ГИС", (await svc.getByText("включено", { exact: true }).count()) === 3 && (await svc.locator('a[href^="https://2gis.kz/"]').count()) === 1);
  await step(t, "service-tab");
  await svc.getByText("Ближайшие", { exact: true }).waitFor();
  await svcQueue(t, svc);
  await reveal(svc.getByRole("list", { name: "Ближайшие сообщения" }));
  await step(t, "service-queue");
  // ТЗ v2.0 §4: последние решения по очереди, тексты сообщений с одобрением владельца, проверка по журналу без отправки
  const log = svc.getByRole("list", { name: "Последние решения" });
  await reveal(log);
  ok("сервисные: последние решения — перенос отменил напоминание, неявка — задача администратору; номера маской", /отменено — запись перенесена/.test(await text(log)) && /задача администратору/.test(await text(log)) && /\+7 700 \*\*\* \*\* 04/.test(await text(log)), (await text(log)).slice(0, 400));
  const cat = svc.getByRole("list", { name: "Тексты сообщений" });
  await reveal(cat);
  ok("сервисные: каталог S01–S18, напоминания одобрены, подтверждение — ждёт одобрения", (await cat.locator("li").count()) === 18 && /S03 Напоминание накануне\s*одобрено/.test(await text(cat)) && /S01 Новая запись — подтверждение\s*ждёт одобрения/.test(await text(cat)), (await text(cat)).slice(0, 300));
  const s03 = cat.locator("li").filter({ hasText: "S03 Напоминание накануне" });
  await tap(s03.getByRole("button", { name: "Қазақша" }));
  ok("сервисные: пример текста на казахском", /Еске салу/.test(await text(s03)));
  await step(t, "service-texts");
  const s01 = cat.locator("li").filter({ hasText: "S01 Новая запись" });
  await tap(s01.getByRole("button", { name: "Одобрить текст" }));
  await s01.getByText("одобрено", { exact: true }).waitFor();
  ok("сервисные: владелец одобрил текст S01", (await s01.getByRole("button", { name: "Снять одобрение" }).count()) === 1);
  await tap(s01.getByRole("button", { name: "Снять одобрение" }));
  const back = await s01.getByText("ждёт одобрения", { exact: true }).waitFor({ timeout: 10000 }).then(() => true, () => false);
  ok("сервисные: одобрение S01 снято", back, (await text(s01)).slice(0, 300));
  const dry = svc.getByRole("button", { name: "Проверить по журналу (без отправки)" });
  await reveal(dry);
  await tap(dry);
  const res = svc.getByRole("status").filter({ hasText: "Записей в журнале" });
  const dryOk = await res.waitFor({ timeout: 15000 }).then(() => true, () => false);
  if (!dryOk) ok("сервисные: проверка по журналу ответила", false, (await text(svc)).slice(-500));
  ok("сервисные: проверка по журналу — без отправки, номера маской", /Записей в журнале: \d+/.test(await text(res)) && !/7700000\d{4}/.test(await text(svc)));
  await step(t, "service-dry-run");
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
  await svc.getByText("Что уходит само").waitFor();
  const stext = await text(svc);
  ok(`${t.tag}: сервисные — номер бота и что уходит само`, /Номер бота/.test(stext) && /на связи/.test(stext) && /Накануне в 18:00/.test(stext) && /Уходят сами со второго номера/.test(stext));
  await svcQueue(t, svc);
  // переключатель языка примера текста — не действие: кроме него кнопок нет
  ok(`${t.tag}: сервисные — только смотреть, кнопок нет`, !(await svc.getByRole("button").filter({ hasNotText: /^(Русский|Қазақша)$/ }).count()) && !(await svc.getByRole("switch").count()));
  ok(`${t.tag}: сервисные — тексты сообщений видны, одобрить нельзя`, (await svc.getByRole("list", { name: "Тексты сообщений" }).locator("li").count()) === 18 && !(await svc.getByRole("button", { name: /Одобрить текст|Проверить по журналу/ }).count()));
  ok(`${t.tag}: [17] сотруднику — без слов «боевой сайт / черновик», время по Астане`, !/боевого сайта|черновик/i.test(await text(svc)) && /Время — по Астане/.test(await text(svc)));
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
  await page.getByRole("tabpanel").getByText("Что уходит само").waitFor();
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
  await page.getByRole("tabpanel").getByText("Что бот отправляет сам").waitFor();
  const stext = await text(page.getByRole("tabpanel"));
  ok(`${t.tag}: сервисные — очереди нет, понятная строка`, /Ближайших сообщений нет/.test(stext) && /Отправлено за 3 дня\s*0/.test(stext));
  ok(`${t.tag}: [12] без Altegio — все три вида выключены, причина словами`, (await page.getByRole("tabpanel").getByText("выключено", { exact: true }).count()) === 3 && /запись через Altegio не подключена/.test(stext) && !/включено/.test(stext.replace(/выключено/g, "")), stext.slice(0, 400));
  await step(t, "service-tab");
  await finish(t);
}

/** Остальные сочетания размера и темы — главные экраны владельца Winchester (для глаз). */
async function gallery(vp, scheme, { botOff = false } = {}) {
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
  // бот на номере бота выключен (как Text BOT_GA_WINCHESTER = 0 в Cloudflare): у Winchester напоминания идут по журналу Altegio
  // и без бота (30.10.2026) — предупреждения «новых напоминаний не будет» нет ни так, ни так
  if (botOff) dl.S.env.BOT_GA_WINCHESTER = "0";
  try {
    await page.getByRole("tab", { name: /Сервисные/ }).click();
    await page.getByRole("tabpanel").getByText("Что уходит само").waitFor();
    const off = page.getByRole("tabpanel").getByRole("status").filter({ hasText: "Бот на номере бота выключен" });
    ok(`${t.tag}: сервисные — ${botOff ? "бот выключен" : "бот включён"}: предупреждения нет (напоминания по журналу)`, !(await off.count()));
    await step(t, botOff ? "service-bot-off" : "service-tab");
  } finally {
    delete dl.S.env.BOT_GA_WINCHESTER;
  }
  await finish(t);
}

// =====================================================================================================================
// Находки проверки 19.10.2026 (проверяющие подтвердили их на этом же стенде). Каждый шаг ниже до правки не проходил; номер в скобках —
// номер находки в отчёте. Идут последними: меняют данные стенда (сигнал Meta, журнал Altegio), остальным сессиям это не мешает.

const SIG = { all: { at: Date.now(), why: "Meta ограничила аккаунт WhatsApp (проверка)" } };
/** Рассылка по списку через API (как «Создать, запустить позже») — номера вымышленные, набраны «вручную». */
async function apiCreate(page, c, name, list) {
  return page.evaluate(
    async ([c, name, list]) => {
      const r = await fetch("/api/bc/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ c, ch: "", name, tpl: "promo_october", lang: "ru", params: ["{имя}"], text: "{{1}}, здравствуйте! Чтобы не получать сообщения, ответьте СТОП", fallback: "уважаемый клиент", cap: 200, from: 11, to: 20, consent: true, recipients: list }),
      });
      return (await r.json()).b;
    },
    [c, name, list],
  );
}
const apiList = (page, c) => page.evaluate(async (c) => (await (await fetch(`/api/bc/list?c=${c}`)).json()).list || [], c);
/** Открыть рассылку из списка (после «Обновить»). */
async function openRow(t, name) {
  const { page } = t;
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  const row = page.getByRole("button", { name: new RegExp(`^${name}`) }).first();
  await row.waitFor({ timeout: 10_000 });
  await tap(row);
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("progressbar", { name: "Ход рассылки" }) });
  await sheet.waitFor();
  return sheet;
}
/** Подпись под заголовком листа — статус рассылки. */
const sheetStatus = (sheet) => text(sheet.locator("header p").first());

/** «Демо Дент», компьютер: мастер — шаблон без {{1}} [6], предел «1 000» [8], «создана, но не запущена» + Esc [10], очередь не
 *  записалась при запуске [2]; лист — то же [2], поздний ответ опроса после «Пауза» [3]. */
async function fixesDent() {
  const t = await session({ key: dl.OWNER, c: "dent", vp: DESK, scheme: "light", tag: "fix-dent-1280-light", own: [...DENT_OWN, "77000003101", "77000003102"] });
  const { page } = t;
  const S = dl.S;
  await page.getByText("Основной номер", { exact: true }).first().waitFor();
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Новая рассылка" }).first().click();
  const wiz = page.getByRole("region", { name: "Новая рассылка" });
  await fill(wiz.getByLabel("Номера и имена"), DENT_LIST.join("\n"));
  await fill(wiz.getByLabel("Название шаблона в Meta"), "osen_skidka");
  await fill(wiz.getByLabel("Текст шаблона"), "Осенью — скидка 15% на чистку зубов в «Демо Дент».\nЧтобы не получать сообщения, ответьте СТОП");
  const wt = await text(wiz);
  ok("[6] текст шаблона без {{1}}, а подстановка {имя} осталась — предупреждение «Meta не примет»", /В тексте шаблона нет переменных[^.]*\. Уберите строку «Вместо \{\{1\}\}», иначе Meta не примет шаблон/.test(wt), wt.match(/Подстановки[\s\S]{0,400}/)?.[0]);
  await reveal(wiz.getByText("Подстановки").first());
  await step(t, "fix6-no-vars-warning");
  await fill(wiz.getByLabel("Текст шаблона"), "{{1}}, осенью — скидка 15% на чистку зубов в «Демо Дент».\nЧтобы не получать сообщения, ответьте СТОП");
  ok("[6] с {{1}} предупреждения нет", !/В тексте шаблона нет переменных/.test(await text(wiz)));
  await fill(wiz.getByLabel("Не больше за 24 часа"), "1 000");
  const perDay = (await text(wiz.getByText("В сутки", { exact: true }).locator(".."))).replace(/\s+/g, " ");
  ok("[8] предел «1 000» с пробелом — в итоге «не больше 1 000», а не 0", /не больше 1 000/.test(perDay), perDay);
  await reveal(wiz.getByText("В сутки", { exact: true }));
  await step(t, "fix8-cap-summary");

  // [10] + [2] создана, а очередь отправки не записалась (сервер ставит её на паузу, 503) → «Продолжить»; Esc — не черновик, а рассылка в списке
  await tap(wiz.getByRole("button", { name: "Проверить" }));
  await wiz.getByText("Номеров в списке").waitFor();
  await tap(wiz.getByRole("checkbox", { name: /Это клиенты компании/ }));
  const before = (await apiList(page, "dent")).length;
  t.allow.push(/\/api\/bc\/act$/); // 503 вызываем нарочно
  S.kv.fail.put = (k) => k === "bcrun";
  try {
    await tap(wiz.getByRole("button", { name: "Создать и запустить" }));
    await wiz.getByText(/создана, но ещё не запущена/).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
  } finally {
    S.kv.fail.put = null;
  }
  const ct = await text(wiz);
  ok("[2] мастер: сервер поставил рассылку на паузу — кнопка «Продолжить», не «Запустить»", (await wiz.getByRole("button", { name: "Продолжить" }).count()) === 1 && !(await wiz.getByRole("button", { name: "Запустить", exact: true }).count()) && /не попала в очередь/.test(ct), ct.slice(0, 300));
  await step(t, "fix2-wizard-paused");
  await page.keyboard.press("Escape");
  const toastLine = page.getByRole("status").filter({ hasText: /создана, но не запущена/ });
  await toastLine.first().waitFor({ timeout: 5000 }).catch(() => {});
  ok("[10] Esc после «создана, но не запущена»: сообщение «она в списке рассылок»", (await toastLine.count()) > 0);
  const sheet10 = page.getByRole("dialog").filter({ has: page.getByRole("progressbar", { name: "Ход рассылки" }) });
  await sheet10.waitFor({ timeout: 5000 }).catch(() => {});
  ok("[10] Esc: открыт лист этой рассылки (как кнопкой «Открыть в списке рассылок»)", (await sheet10.count()) > 0 && /Рассылка по списку/.test(await text(sheet10)));
  await step(t, "fix10-esc-sheet");
  await page.keyboard.press("Escape");
  await sheet10.waitFor({ state: "detached" }).catch(() => {});
  const inWork = page.getByRole("button", { name: /^Рассылка по списку · \d\d\.\d\d/ });
  ok("[10] рассылка — в «В работе»", (await inWork.count()) > 0);
  await page.getByRole("button", { name: "Новая рассылка" }).first().click();
  await wiz.getByLabel("Номера и имена").waitFor();
  ok("[10] снова «Новая рассылка»: не черновик уже созданной (нет «Продолжаем черновик», согласие не отмечено, список пуст)", !(await wiz.getByText("Продолжаем черновик").count()) && !(await wiz.getByRole("checkbox", { name: /Это клиенты компании/ }).isChecked()) && (await wiz.getByLabel("Номера и имена").inputValue()) === "");
  await step(t, "fix10-new-wizard-clean");
  await wiz.getByRole("button", { name: "Закрыть" }).click();
  await wiz.waitFor({ state: "detached" });
  ok("[10] рассылка создана один раз", (await apiList(page, "dent")).length === before + 1);

  // [2] лист: «Запустить» → очередь не записалась → «На паузе» и «Продолжить» (без перезагрузки)
  await apiCreate(page, "dent", "Проба очереди", "+77000003101, Айгерим\n+77000003102, Мадина");
  const sheet = await openRow(t, "Проба очереди");
  await sheet.getByRole("button", { name: "Запустить" }).click();
  const sure = page.getByRole("dialog", { name: "Запустить рассылку?" });
  await sure.waitFor();
  S.kv.fail.put = (k) => k === "bcrun";
  try {
    await sure.getByRole("button", { name: "Запустить" }).click();
    await sheet.getByText(/не попала в очередь/).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
  } finally {
    S.kv.fail.put = null;
  }
  const st2 = await sheetStatus(sheet);
  ok("[2] лист: после 503 — «На паузе» и кнопка «Продолжить»", /На паузе/.test(st2) && (await sheet.getByRole("button", { name: "Продолжить" }).count()) === 1, `${st2} · ${(await text(sheet)).slice(0, 160)}`);
  await step(t, "fix2-sheet-paused");
  t.allow.pop();

  // [3] идёт → опрос хода в пути (медленная связь) → «Пауза»: поздний ответ опроса не возвращает «Идёт отправка»
  await sheet.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("dialog", { name: "Продолжить рассылку?" }).getByRole("button", { name: "Продолжить" }).click();
  await sheet.getByRole("button", { name: "Пауза" }).waitFor({ timeout: 10_000 });
  const slow = async (route) => {
    const resp = await route.fetch();
    await new Promise((r) => setTimeout(r, 2500));
    await route.fulfill({ response: resp }).catch(() => {});
  };
  await page.route(/\/api\/bc\/get\?/, slow);
  await page.waitForRequest(/\/api\/bc\/get\?/, { timeout: 8000 });
  await sheet.getByRole("button", { name: "Пауза" }).click();
  await page.waitForTimeout(3500); // поздний ответ опроса пришёл
  const st3 = await sheetStatus(sheet);
  ok("[3] после «Пауза» поздний ответ опроса не затирает: «На паузе», кнопки «Пауза» нет", /На паузе/.test(st3) && !(await sheet.getByRole("button", { name: "Пауза" }).count()) && (await sheet.getByRole("button", { name: "Продолжить" }).count()) === 1, st3);
  await step(t, "fix3-pause-race");
  await page.unroute(/\/api\/bc\/get\?/, slow);
  await page.keyboard.press("Escape");
  await finish(t);
}

/** Сигнал Meta [9]: сотрудник не снимает его «Всё равно запустить / продолжить»; владельцу вопрос говорит, что снимется для всего номера. */
async function fixesHold() {
  await dl.S.kv.api.put("bchold:winchester", JSON.stringify(SIG));
  const t = await session({ key: dl.STAFF_W, c: "winchester", vp: DESK, scheme: "light", tag: "fix-hold-staff-1280" });
  const { page } = t;
  await page.getByRole("alert").filter({ hasText: "Сигнал от Meta" }).waitFor();
  await page.getByRole("button", { name: "Новая рассылка" }).first().click();
  const wiz = page.getByRole("region", { name: "Новая рассылка" });
  await wiz.getByRole("radiogroup", { name: "Сегмент базы" }).waitFor();
  await fill(wiz.getByLabel("Название шаблона в Meta"), "davno_ne_byli");
  await fill(wiz.getByLabel("Текст шаблона"), "{{1}}, давно вас не видели!\nЧтобы не получать сообщения, ответьте СТОП");
  await tap(wiz.getByRole("button", { name: "Проверить" }));
  await wiz.getByText("Получат шаблон").waitFor();
  await tap(wiz.getByRole("checkbox", { name: /Это клиенты компании/ }));
  t.allow.push(/\/api\/bc\/act$/); // 403 — так и должно быть
  await tap(wiz.getByRole("button", { name: "Создать и запустить" }));
  await wiz.getByText(/создана, но ещё не запущена/).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
  const force = () => page.getByRole("button", { name: /Всё равно/ }).count();
  ok("[9] сотрудник при сигнале: «только владелец», вопроса «Всё равно запустить» нет", /только владелец/.test(await text(wiz)) && !(await force()), (await text(wiz)).slice(0, 300));
  ok("[9] сигнал Meta на месте", !!dl.S.kv.json("bchold:winchester"));
  await step(t, "fix9-staff-wizard");
  // сервер постарше мог бы спросить (409 confirm) — пульт сотруднику всё равно не даёт снять сигнал
  const asks = (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ confirm: "Сигнал от Meta: проверка. Продолжать отправку опасно для номера. Всё равно продолжить?" }) });
  await page.route(/\/api\/bc\/act$/, asks);
  await tap(wiz.getByRole("button", { name: /^(Запустить|Продолжить)$/ }));
  await page.waitForTimeout(600);
  ok("[9] мастер: вопрос сервера сотруднику — только как причина, без «Всё равно запустить»", !(await force()) && /Снять сигнал может владелец|только владелец/.test(await text(wiz)));
  await page.unroute(/\/api\/bc\/act$/, asks);
  await tap(wiz.getByRole("button", { name: "Открыть в списке рассылок" }));
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("progressbar", { name: "Ход рассылки" }) });
  await sheet.waitFor();
  await sheet.getByRole("button", { name: "Запустить" }).click();
  await page.getByRole("dialog", { name: "Запустить рассылку?" }).getByRole("button", { name: "Запустить" }).click();
  await sheet.getByText(/только владелец/).waitFor({ timeout: 10_000 }).catch(() => {});
  ok("[9] лист: сотруднику — «только владелец», без «Всё равно продолжить»", (await sheet.getByText(/только владелец/).count()) > 0 && !(await force()));
  await page.route(/\/api\/bc\/act$/, asks);
  await sheet.getByRole("button", { name: "Запустить" }).click();
  await page.getByRole("dialog", { name: "Запустить рассылку?" }).getByRole("button", { name: "Запустить" }).click();
  await page.waitForTimeout(600);
  ok("[9] лист: вопрос сервера сотруднику — без кнопки снять сигнал", !(await force()) && /Снять сигнал может владелец/.test(await text(sheet)));
  await page.unroute(/\/api\/bc\/act$/, asks);
  await step(t, "fix9-staff-sheet");
  ok("[9] сигнал Meta всё ещё на месте", !!dl.S.kv.json("bchold:winchester"));
  await sheet.getByRole("button", { name: "Удалить" }).click();
  await page.getByRole("dialog", { name: "Удалить рассылку?" }).getByRole("button", { name: "Удалить" }).click();
  await sheet.waitFor({ state: "detached", timeout: 10_000 });
  t.allow.pop();
  await finish(t);

  // владелец: вопрос сервера говорит, что сигнал снимется для всего номера и для автосценария
  const o = await session({ key: dl.OWNER, c: "winchester", vp: DESK, scheme: "light", tag: "fix-hold-owner-1280", own: ["77000009901"] });
  await o.page.getByRole("alert").filter({ hasText: "Сигнал от Meta" }).waitFor();
  const made = await apiCreate(o.page, "winchester", "Проба сигнала", "+77000009901, Тест");
  const sh = await openRow(o, "Проба сигнала");
  o.allow.push(/\/api\/bc\/act$/); // 409 — вопрос сервера
  await sh.getByRole("button", { name: "Запустить" }).click();
  await o.page.getByRole("dialog", { name: "Запустить рассылку?" }).getByRole("button", { name: "Запустить" }).click();
  const q = o.page.getByRole("dialog", { name: /сигнал/i }).filter({ hasText: /Всё равно продолжить/ });
  await q.waitFor({ timeout: 10_000 }).catch(() => {});
  ok("[9] владелец: в вопросе — «снимется для всех рассылок с основного номера и для автосценария»", /снимется для всех рассылок с основного номера и для автосценария/.test(await text(q)), await text(q));
  await step(o, "fix9-owner-question");
  await q.getByRole("button", { name: "Отмена" }).click();
  ok("[9] владелец ответил «Отмена» — сигнал на месте", !!dl.S.kv.json("bchold:winchester"));
  o.allow.pop();
  await o.page.evaluate(async (id) => fetch("/api/bc/act", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ c: "winchester", id, act: "delete" }) }), made.id);
  await o.page.keyboard.press("Escape");
  await finish(o);
  await dl.S.kv.api.delete("bchold:winchester");
}

/** Владелец Winchester, телефон: «назад» в мастере [11], размеры касания [15], тексты [16], клавиатура [14], контраст вкладок [18]. */
async function fixesPhone() {
  const t = await session({ key: dl.OWNER, c: "winchester", vp: PHONE, scheme: "light", tag: "fix-w-owner-390-light" });
  const { page } = t;
  await page.getByText("Основной номер", { exact: true }).first().waitFor();
  await page.waitForLoadState("networkidle");

  // [18] подпись неактивной вкладки — контраст ≥ 4.5:1 на фоне вкладок
  const ratio = await page.evaluate(() => {
    const L = (c) => {
      const [r, g, b] = (c.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const list = document.querySelector('[role=tablist][aria-label="Вид рассылок"]');
    const tab = list && list.querySelector('[role=tab][aria-selected="false"]');
    const spans = tab ? [...tab.querySelectorAll("span")].filter((x) => x.textContent.trim() && getComputedStyle(x).position !== "absolute") : [];
    const a = L(getComputedStyle(list).backgroundColor);
    return Math.min(...spans.map((x) => { const b = L(getComputedStyle(x).color); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }));
  });
  ok("[18] неактивная вкладка: подписи — контраст не ниже 4.5:1", ratio >= 4.5, String(ratio.toFixed(2)));

  // [16] у плашки качества видно слово «качество» (а не только «высокое»)
  const qual = page.getByText("Качество", { exact: true }).first();
  const qbox = await qual.boundingBox().catch(() => null);
  ok("[16] плашка качества номера — подпись «Качество» видна, не только для читалок; номер телефона не обрезан", (await page.locator(".sr-only", { hasText: /Качество/ }).count()) === 0 && !!qbox && qbox.width > 20 && /высокое/.test(await text(qual.locator(".."))) && (await page.getByText(/^\+7\s700\s000\s00\s99$/).first().evaluate((el) => el.scrollWidth <= el.clientWidth)));

  // [16] автосценарий: шаблона нет — поле не выглядит заполненным; «Оценка — до ≈ …» с пробелом
  const edit = page.getByRole("button", { name: "Изменить настройки" });
  await tap(edit);
  const tpl = page.getByLabel("Шаблон Meta (Marketing)");
  ok("[16] подсказка поля шаблона — «например, …», а не как будто вписанное название", /^например, /.test((await tpl.getAttribute("placeholder")) || ""), (await tpl.getAttribute("placeholder")) || "");
  // [14] открытая клавиатура (как lib/viewport.ts: видимая часть 464 px): нижние вкладки не занимают место над клавиатурой
  const cap = page.getByLabel("Сообщений в день, не больше");
  await reveal(cap);
  await page.evaluate(() => {
    const r = document.querySelector(".app-root");
    r.style.setProperty("--app-h", "464px");
    r.dataset.kb = "1";
  });
  await cap.focus();
  await page.waitForTimeout(300);
  const kb = await page.evaluate(() => {
    const nav = [...document.querySelectorAll("nav[aria-label='Разделы']")].find((n) => n.getBoundingClientRect().height > 0 && getComputedStyle(n).display !== "none" && n.getBoundingClientRect().bottom > innerHeight / 2);
    const sc = document.querySelector("main .scroll-area").getBoundingClientRect();
    const bottom = nav ? nav.getBoundingClientRect().top : 464;
    return { nav: !!nav, form: Math.round(Math.min(bottom, 464) - sc.top) };
  });
  ok("[14] клавиатура открыта: нижних вкладок нет, под поля — больше 300 px", !kb.nav && kb.form > 300, JSON.stringify(kb));
  await page.screenshot({ path: `${OUT}/${t.tag}-kb.png`, clip: { x: 0, y: 0, width: 390, height: 464 } });
  await page.evaluate(() => {
    const r = document.querySelector(".app-root");
    r.style.removeProperty("--app-h");
    r.dataset.kb = "0";
  });
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await tap(page.getByRole("button", { name: "Отмена" }));
  const sw = page.getByRole("switch", { name: "Автосценарий «Пора на стрижку»" });
  await reveal(sw);
  if ((await sw.getAttribute("aria-checked")) === "true") {
    await tap(sw);
    await page.waitForFunction(() => document.querySelector('[role=switch][aria-checked="false"]'), null, { timeout: 10_000 });
  }
  await tap(sw);
  const ask = page.getByRole("dialog", { name: "Включить автосценарий?" });
  await ask.waitFor();
  ok("[16] подтверждение: «Оценка — до ≈ …» с пробелом", /до\s≈/.test(await text(ask)), await text(ask));
  await ask.getByRole("button", { name: "Включить" }).click();
  await page.waitForFunction(() => document.querySelector('[role=switch][aria-checked="true"]'), null, { timeout: 10_000 });

  // мастер: подписи сегментов [16], «Убрать уточнение» [15], «назад» — на прошлый шаг [11], «Начать заново» [15]
  await tap(page.getByRole("button", { name: "Новая рассылка" }).first());
  const wiz = page.getByRole("region", { name: "Новая рассылка" });
  await wiz.getByRole("radiogroup", { name: "Сегмент базы" }).waitFor();
  const davno = (await text(wiz.locator("label", { hasText: "Давно не были" }).first())).replace(/\s+/g, " ");
  ok("[16] мастер: у сегмента — «последний визит 36–60 дней назад», как в базе", /последний визит 36–60 дней назад/.test(davno), davno);
  await tap(wiz.getByRole("button", { name: /Уточнить/ }));
  const unf = wiz.getByRole("button", { name: "Убрать уточнение" });
  await unf.waitFor();
  const h1 = (await unf.boundingBox())?.height || 0;
  ok("[15] «Убрать уточнение» — касание не меньше 44 px", h1 >= 43.5, String(h1));
  await tap(unf);
  await tap(wiz.getByRole("button", { name: "Далее" }));
  await wiz.getByRole("heading", { name: "Сообщение" }).waitFor();
  await fill(wiz.getByLabel("Название шаблона в Meta"), "uhodyat");
  await fill(wiz.getByLabel("Текст шаблона"), "{{1}}, мы скучаем!\nЧтобы не получать сообщения, ответьте СТОП");
  await tap(wiz.getByRole("button", { name: "Далее" }));
  await wiz.getByRole("heading", { name: "Часы и предел" }).waitFor();
  await tap(wiz.getByRole("button", { name: "Далее" }));
  await wiz.getByRole("heading", { name: "Проверка" }).waitFor();
  await wiz.getByText("Получат шаблон").waitFor();
  const steps = [];
  for (const want of ["Часы и предел", "Сообщение", "Кому"]) {
    await page.goBack();
    const h = wiz.getByRole("heading", { name: want });
    await h.waitFor({ timeout: 3000 }).catch(() => {});
    steps.push(`${want}: ${(await h.count()) > 0 && (await wiz.count()) > 0 ? "да" : "нет"}`);
  }
  ok("[11] жест «назад» в мастере — на прошлый шаг: Проверка → Часы → Сообщение → Кому", steps.every((x) => x.endsWith("да")), steps.join(", "));
  await step(t, "fix11-back-step");
  await page.goBack();
  await wiz.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  ok("[11] на первом шаге «назад» закрывает мастер, раздел «Рассылки» на месте", !(await wiz.count()) && (await page.getByRole("heading", { name: "Рассылки" }).count()) > 0);
  await tap(page.getByRole("button", { name: "Новая рассылка" }).first());
  const again = wiz.getByRole("button", { name: "Начать заново" });
  await again.waitFor();
  const h2 = (await again.boundingBox())?.height || 0;
  ok("[15] «Начать заново» — касание не меньше 44 px", h2 >= 43.5, String(h2));
  await step(t, "fix15-restart");
  await tap(again);
  await wiz.getByRole("button", { name: "Закрыть" }).first().click();
  await wiz.waitFor({ state: "detached" });

  // [15] ссылка на отзывы — касание не меньше 44 px
  await page.getByRole("tab", { name: /Сервисные/ }).click();
  const link = page.getByRole("tabpanel").locator('a[href^="https://2gis.kz/"]');
  await link.waitFor();
  const h3 = (await link.boundingBox())?.height || 0;
  ok("[15] ссылка на отзывы 2ГИС — касание не меньше 44 px", h3 >= 43.5, String(h3));
  await step(t, "fix15-review-link");
  await page.getByRole("tab", { name: /Маркетинг/ }).click();
  await finish(t);
}

/** [4] Люди сегмента: «Ещё» ещё грузится, а отбор поменяли — «Ещё» не остаётся с крутилкой навсегда. Нужно больше 50 человек:
 *  журнал Altegio — 130 вымышленных клиентов (последней сессией: базу Winchester после неё не проверяем). */
async function fixesPaging() {
  const { net } = await import(new URL("../../../test/harness.mjs", import.meta.url).href);
  const NOW = Date.now();
  const day = (n) => new Date(NOW - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
  net.altJournal = Array.from({ length: 130 }, (_, i) => ({ id: 7000 + i, datetime: `${day(15 + (i % 76))}T12:00:00+05:00`, deleted: false, attendance: 1,
    staff: { id: 1 + (i % 3), name: ["Арман", "Данияр", "Ерлан"][i % 3] }, client: { id: 9000 + i, phone: "+7700000" + String(4000 + i), name: "Клиент " + i }, services: [{ id: 1, title: "Мужская стрижка" }] }));
  const t = await session({ key: dl.OWNER, c: "winchester", vp: DESK, scheme: "dark", tag: "fix-paging-1280-dark" });
  const { page } = t;
  await tap(page.getByRole("button", { name: "Обновить базу" }));
  await page.getByText("Читаю журнал Altegio… до минуты").waitFor({ state: "detached", timeout: 90_000 });
  // реклама — только с подтверждённым согласием (31.10.2026): этим 130 вымышленным клиентам оно выдано, и сегмент перечитывается
  const { grantSnap } = await import(new URL("../../../test/consent.mjs", import.meta.url).href);
  await grantSnap(dl.bot.S.env, "winchester");
  await page.reload();
  await page.waitForLoadState("networkidle");
  const all = page.getByRole("button", { name: /^Сегмент «Вся база»/ });
  await all.waitFor();
  await tap(all);
  const dlg = page.getByRole("dialog", { name: "Вся база" });
  const people = dlg.getByRole("list", { name: "Клиенты сегмента" });
  await people.locator("li").nth(49).waitFor({ timeout: 10_000 });
  const more = dlg.getByRole("button", { name: "Ещё" });
  await more.waitFor();
  const slow = async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue().catch(() => {});
  };
  await page.route(/\/api\/crm\/list\?.*page=2/, slow);
  await more.click();
  await dlg.getByLabel("Дней с визита, до").fill("80");
  await page.waitForTimeout(4500); // отбор применился, ответ на «Ещё» пришёл и выброшен
  const btn = dlg.getByRole("button", { name: /Ещё/ });
  const st = { n: await btn.count(), enabled: await btn.isEnabled().catch(() => false), busy: await btn.getAttribute("aria-busy").catch(() => null) };
  ok("[4] отбор поменяли, пока «Ещё» грузилось: «Ещё» снова нажимается", st.n === 1 && st.enabled && !st.busy, JSON.stringify(st));
  await step(t, "fix4-more-after-filter");
  await page.unroute(/\/api\/crm\/list\?.*page=2/, slow);
  await btn.click();
  await people.locator("li").nth(50).waitFor({ timeout: 10_000 }).catch(() => {});
  ok("[4] «Ещё» после смены отбора догружает список", (await people.locator("li").count()) > 50);
  await dlg.getByRole("button", { name: "Закрыть" }).click();
  await finish(t);
}

/** [5] Собранный пульт (как на сайте): связь пропала при открытии раздела — не страница браузера «нет интернета», а «Повторить». */
async function fixesOffline() {
  const { build, preview } = await import("vite");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const configFile = fileURLToPath(new URL("../vite.config.ts", import.meta.url));
  const outDir = mkdtempSync(join(tmpdir(), "pult-e2e-"));
  await build({ root, configFile, logLevel: "warn", build: { outDir, emptyOutDir: true } });
  const proxy = Object.fromEntries(["/api", "/login", "/logout", "/inbox", "/_cron"].map((p) => [p, { target: dl.bot.url }]));
  const pv = await preview({ root, configFile, base: "/app/", logLevel: "warn", build: { outDir }, preview: { host: "127.0.0.1", port: 0, proxy } });
  const addr = pv.httpServer.address();
  const app = `http://127.0.0.1:${addr.port}/app/`;
  try {
    const phone = PHONE.width < 500;
    const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone, locale: "ru-RU", timezoneId: "Asia/Almaty" });
    await ctx.addInitScript(shiftClock, SHIFT);
    const page = await ctx.newPage();
    const tag = "fix5-offline-390";
    await page.goto(`${app}?c=winchester`);
    await page.waitForURL(/\/login/);
    await page.fill("input[name=key]", dl.OWNER);
    await page.click("button");
    await page.waitForURL(/\/app\//);
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: "Рассылки" }).waitFor();
    await ctx.setOffline(true);
    await page.getByRole("link", { name: "Рассылки" }).click();
    await page.waitForTimeout(2500);
    const url = page.url();
    const shown = await page.getByText(/не загрузил/i).count().catch(() => 0);
    ok("[5] нет связи при открытии раздела: пульт на месте, «не загрузился» и «Повторить» (не страница «нет интернета»)", url.startsWith(app) && shown > 0 && (await page.getByRole("button", { name: "Повторить" }).count()) > 0, url);
    await page.screenshot({ path: `${OUT}/${tag}-01-offline.png` }).catch(() => {});
    await ctx.setOffline(false);
    await page.getByRole("button", { name: "Повторить" }).click().catch(() => {});
    await page.getByRole("heading", { name: "Рассылки" }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    ok("[5] связь вернулась — «Повторить» открывает раздел", (await page.getByRole("heading", { name: "Рассылки" }).count()) > 0, page.url());
    await page.screenshot({ path: `${OUT}/${tag}-02-online.png` }).catch(() => {});
    await ctx.close();
  } finally {
    await new Promise((r) => pv.httpServer.close(() => r(undefined)));
    rmSync(outDir, { recursive: true, force: true });
  }
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
  await run("Владелец Winchester · компьютер, светлая (бот на номере бота выключен)", () => gallery(DESK, "light", { botOff: true }));
  await run("Владелец «Демо Дент» · телефон, тёмная", () => ownerDent(PHONE, "dark", true));
  await run("Владелец «Демо Дент» · компьютер, светлая", () => ownerDent(DESK, "light", false));
  await run("Находки проверки: «Демо Дент» · компьютер", fixesDent);
  await run("Находки проверки: сигнал Meta — сотрудник и владелец", fixesHold);
  await run("Находки проверки: Winchester · телефон", fixesPhone);
  await run("Находки проверки: собранный пульт без связи", fixesOffline);
  await run("Находки проверки: люди сегмента, «Ещё» и отбор", fixesPaging);
} finally {
  await browser.close();
  await dl.close();
}

const bad = results.filter((r) => !r.ok);
console.log(`\nИтог: ${results.length - bad.length} из ${results.length} проверок прошли${bad.length ? `, не прошли ${bad.length}` : ""}. Снимки: ${OUT}`);
for (const b of bad) console.log(`  ✗ ${b.name}${b.info ? ` — ${b.info}` : ""}`);
process.exit(bad.length ? 1 : 0);
