// Проверка раздела «Рассылки» нового пульта в настоящем браузере (Chromium через Playwright) на НАСТОЯЩЕМ коде бота с заглушками
// (scripts/dev-live.mjs: память вместо KV, база D1 на node:sqlite, заглушки Meta, Green-API, Altegio, Telegram). Сеть не нужна. Не тест на скорость.
// Запуск: npm run e2e:campaigns [папка для снимков]   (или node scripts/e2e-campaigns.mjs <папка>)
// Playwright — PLAYWRIGHT_PATH или /opt/node-tools/node_modules/playwright/index.mjs; Chromium — /opt/pw-browsers/chromium (CHROMIUM меняет).
//
// Что проходит (финальное ТЗ рассылок Winchester, 02.11.2026: четыре вкладки — «Маркетинг · рассылки» (главный канал — второй номер;
// подвкладки Рассылки / Шаблоны / Клиенты / Результаты), «Автоматические · сообщения», «Календарь», «Meta» (основной номер и шаблоны Meta —
// неактивный канал); «Создать рассылку» — всегда мастер второго номера: Аудитория → Сообщение → Предпросмотр → Проверка → Тест →
// Сохранение и запуск):
//  · владелец Winchester, телефон: четыре вкладки в 390 px; главный вид — статус второго номера, запуск выключен, «Ответы»; «Клиенты» —
//    «Обновить базу», десять чисел ТЗ (как у сервера), сегменты, люди со статусами (номера маской) → мастер второго номера с сегментом;
//    «Meta» — честный статус, рассылка шаблоном Meta (проверить → пробная → создать и запустить → POST /_cron → «N из N отправлено»),
//    автосценарий «Пора на стрижку»; «Автоматические»; «Шаблоны» — 28 текстов в 7 категориях, поиск по названию и тексту, пузырь
//    WhatsApp с настоящим именем и без имени, без казахской вкладки, «Копировать» → «Изменить» → «Сохранить» → «Одобрить» → архив;
//    «Использовать» → мастер по шагам ТЗ: строка «стоп» по выбору (в предпросмотре — ровно с ней), предел 50 в сутки (до 300), тест на
//    номер владельца (Green-API: тот же текст), «Сохранение и запуск» при запрете — честная плашка и «Как включить», «Одобрить»; сервер
//    при запуске отвечает ga_off; «Календарь»;
//  · сотрудник Winchester (телефон и компьютер): «Meta» — сигнал виден, снять нельзя; «Клиенты» без «Обновить базу»; шаблоны только
//    смотреть и «Использовать»; в мастере тест и запуск — владельца, сотрудник сохраняет черновик;
//  · владелец Winchester, компьютер: сигнал Meta снимается его кнопкой; шаблон Meta «запустить позже» и запуск из листа; ошибка сервера
//    в настройках автосценария; ВТОРОЙ НОМЕР С РАЗРЕШЁННЫМ ЗАПУСКОМ (GA_BROADCAST_WINCHESTER = 1 на ходу): сигнал о номере → «Всё равно
//    запустить» → итоговая аудитория «Сообщение получат N из M» с точным текстом → «Запустить» (порядок запросов: без подтверждения →
//    force → force + sure + n), POST /_cron — ушло ровно то, что было в листе подтверждения; итоги с «нет данных» вместо 0; «Ответы» —
//    «Чаты», раздел «Ответы»; «Запланировать» (время — числом, «Начнётся …», «Запланирована на …»); «Результаты»;
//  · владелец «Демо Дент» (без базы): мастер второго номера говорит почему и ведёт во вкладку «Meta» — рассылка шаблоном Meta списком;
//  · находки проверки 19.10.2026 — отдельными сессиями в конце (fixes*): каждый шаг до правки не проходил; собранный пульт без связи
//    проверяется на свежей сборке во временной папке (vite build + vite preview с тем же ботом).
// Подробно раздел «Автоматические сообщения» — scripts/e2e-automsg.mjs.
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
// заглушки внешних служб бота (тот же модуль, что у dev-live.mjs): что ушло через Green-API
const { net } = await import(new URL("../../../test/harness.mjs", import.meta.url).href);
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
/** Подвкладка «Маркетинга»: Рассылки / Шаблоны / Клиенты / Результаты (финальное ТЗ рассылок, 02.11.2026). */
async function subTab(page, name) {
  const top = page.getByRole("tab", { name: /^Маркетинг/ });
  if ((await top.getAttribute("aria-selected")) !== "true") await top.click();
  await page.getByRole("tablist", { name: "Маркетинг" }).getByRole("tab", { name, exact: true }).click();
}
/** Вкладка «Meta» (02.11.2026): основной номер и шаблоны Meta — отдельной вкладкой, не на главном виде. */
async function expandMeta(page) {
  const tab = page.getByRole("tab", { name: /^Meta/ });
  await tab.waitFor();
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await page.getByRole("button", { name: "Рассылка шаблоном Meta" }).waitFor({ timeout: 15000 });
  return true;
}
/** Рассылка шаблоном Meta — кнопкой во вкладке «Meta» («Создать рассылку» открывает только мастер второго номера). */
async function openMeta(page, how = "tap") {
  await expandMeta(page);
  const b = page.getByRole("button", { name: "Рассылка шаблоном Meta" });
  if (how === "click") await b.click();
  else await tap(b);
}
/** Мастер второго номера: лист «Новая рассылка», шаги «Аудитория» → … → «Сохранение и запуск». */
const gaDialog = (page) => page.getByRole("dialog", { name: "Новая рассылка" });
const gaNext = (gw) => tap(gw.getByRole("button", { name: "Далее" }));
const gaAt = (gw, name) => gw.getByRole("heading", { name, exact: true }).waitFor({ timeout: 15000 });
/** Тела запросов /api/bc/act этой страницы — порядок подтверждений запуска (сигнал → аудитория). */
function actBodies(page) {
  const out = [];
  page.on("request", (r) => {
    if (r.method() !== "POST" || !/\/api\/bc\/act$/.test(r.url())) return;
    try {
      out.push(JSON.parse(r.postData() || "{}"));
    } catch {
      /* не JSON */
    }
  });
  return out;
}
/** Названия вкладок «Вид рассылок» — с подписями (на телефоне подписи только в названии вкладки). */
const tabNames = (page) => page.getByRole("tablist", { name: "Вид рассылок" }).getByRole("tab").evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim()));
/** Сообщения, ушедшие через заглушку Green-API (sendMessage): кому и что. */
const gaSent = () => net.ga.filter((x) => x.op === "sendMessage").map((x) => ({ to: String(x.body.chatId || "").replace("@c.us", ""), text: String(x.body.message || "") }));
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
const STOP_RU = "Если такие сообщения больше не нужны, напишите «стоп».";
/** Сегмент из плитки: «Сегмент «…»: N человек, можно рекламу: M, …» → M (кому реклама уйдёт сейчас). */
const adsOf = async (loc) => Number(((await loc.getAttribute("aria-label")) || "").match(/можно рекламу: (\d+)/)?.[1] || 0);

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

/** Вкладка «Автоматические»: очередь Winchester из dev-live.mjs — 8 сообщений по трём записям (номера +7 700 000 11 01…03), только маской,
 *  если включены напоминания и просьба об отзыве (02.11.2026: в «Ближайших» — только включённые сценарии); первое — в день визита Тимура
 *  сегодня в 17:00 (за 2 часа, в 15:00); ушло за 3 дня — 2. */
async function svcQueue(t, svc) {
  const list = svc.getByRole("list", { name: "Ближайшие сообщения" });
  await list.waitFor();
  const rows = list.locator(":scope > li");
  ok(`${t.tag}: ближайшие — в очереди 8 сообщений`, (await rows.count()) === 8 && /В очереди\s*8/.test(await text(svc)), String(await rows.count()));
  const first = (await text(rows.first())).replace(/\s+/g, " ");
  ok(`${t.tag}: ближайшие — первое: Тимур, сегодня в 15:00, в день визита — запись на 17:00`, /Тимур/.test(first) && /сегодня, 15:00/.test(first) && /Напоминание в день визита/.test(first) && /запись на сегодня, 17:00/.test(first), first);
  const all = await text(list);
  ok(`${t.tag}: ближайшие — номера маской`, ["01", "02", "03"].every((x) => all.includes(`+7 700 *** ** ${x}`)) && /Благодарность за визит · после визита/.test(all) && /Напоминание накануне · запись на завтра, 12:00/.test(all), all.slice(0, 200));
  // запись без имени — вместо имени номер маской
  ok(`${t.tag}: ближайшие — без имени: номер маской вместо имени`, (await list.locator("li p.truncate", { hasText: "+7 700 *** ** 02" }).count()) === 3);
  ok(`${t.tag}: ближайшие — отправлено за 3 дня: 2`, /Отправлено за 3 дня\s*2/.test(await text(svc)));
  ok(`${t.tag}: ближайшие — полных номеров клиентов очереди нет`, !/770000011\d{2}/.test(await t.page.content()));
}
/** Включить или выключить сценарии «Автоматических сообщений» (как выключатель владельца; для проверки очереди). */
const autoSet = (page, ids, on) =>
  page.evaluate(
    async ([ids, on]) => {
      for (const id of ids) await fetch("/api/msg/auto", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ c: "winchester", id, on }) });
    },
    [ids, on],
  );

// =====================================================================================================================
async function ownerWinchesterPhone() {
  const t = await session({ key: dl.OWNER, c: "winchester", vp: PHONE, scheme: "light", tag: "w-owner-390-light", own: [TEST_TO.replace(/\D/g, "")] });
  const { page } = t;
  // четыре вкладки: на 390 px помещаются одной строкой, названия не обрезаны
  const tabs = page.getByRole("tablist", { name: "Вид рассылок" });
  const names = await tabNames(page);
  ok("четыре вкладки: «Маркетинг · рассылки», «Автоматические · сообщения», «Календарь · план и итоги», «Meta»", names.length === 4 && /^Маркетинг/.test(names[0]) && /^Автоматические/.test(names[1]) && /^Календарь/.test(names[2]) && /^Meta · неактивный канал/.test(names[3]), JSON.stringify(names));
  const cut = await tabs.evaluate((el) => [...el.querySelectorAll("[role=tab] span")].filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent));
  ok("вкладки помещаются на 390 px: названия не обрезаны, вбок не прокручиваются", !cut.length && (await tabs.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)), JSON.stringify(cut));
  // главный канал — второй номер: статус, запуск выключен, «Создать рассылку»; Meta — не на главном виде
  const card = page.getByRole("region", { name: "Канал рассылок" });
  await card.waitFor();
  const ct = await text(card);
  ok("главный вид: «Второй WhatsApp», «На связи», запуск выключен и «Создать рассылку»", /Второй WhatsApp/.test(ct) && /На связи/.test(ct) && /Запуск рассылок выключен/.test(ct) && (await card.getByRole("button", { name: "Создать рассылку" }).count()) === 1, ct.slice(0, 300));
  ok("главный вид: на нём нет Meta (ни обзора основного номера, ни шаблонов Meta) и нет технических слов", !(await page.getByText("Предел Meta").count()) && !(await page.getByRole("button", { name: /Meta — неактивный канал|Рассылка шаблоном Meta/ }).count()) && !/вебхук|GA_BROADCAST|Cloudflare|инстанс/i.test(await text(page.locator("main"))));
  const subs = await page.getByRole("tablist", { name: "Маркетинг" }).getByRole("tab").allInnerTexts();
  ok("главный вид: «Рассылки», «Шаблоны», «Клиенты», «Результаты» и «Ответы»", subs.join("|") === "Рассылки|Шаблоны|Клиенты|Результаты" && (await page.getByRole("button", { name: /^Ответы:/ }).count()) === 1, subs.join("|"));
  ok("ссылки на старую страницу /broadcast нет", !(await page.locator('a[href*="/broadcast"]').count()));
  await step(t, "overview");

  // «Клиенты»: база — обновить, десять чисел ТЗ, сегменты
  await subTab(page, "Клиенты");
  const refresh = page.getByRole("button", { name: "Обновить базу" });
  await tap(refresh);
  await page.getByText("Читаю журнал Altegio… до минуты").waitFor({ state: "detached", timeout: 90_000 });
  await page.getByRole("button", { name: /^Сегмент «Пора на стрижку»/ }).waitFor();
  const nums = page.getByLabel("Числа базы");
  const nt = norm(await text(nums));
  const TEN = ["Всего клиентов за 90 дней", "Номер корректный", "Постоянные", "Были один раз", "Не приходили 30–60 дней", "Не приходили 61–90 дней", "Есть будущая запись", "Разрешили рекламу", "Отказались", "Без подтверждённого разрешения"];
  ok("база: десять чисел ТЗ, «без подтверждённого разрешения» — «не отказ и не разрешение»", TEN.every((x) => nt.includes(x)) && /не отказ и не разрешение/.test(nt), nt);
  const m = await page.evaluate(() => fetch("/api/crm/segments?c=winchester").then((r) => r.json()).then((d) => d.metrics));
  const shownNum = (label) => Number((nt.match(new RegExp(`${label} (\\d+)`)) || [])[1] ?? -1);
  ok("база: числа — как прислал сервер", !!m && shownNum("Всего клиентов за 90 дней") === m.total && shownNum("Номер корректный") === m.valid && shownNum("Разрешили рекламу") === m.marketing && shownNum("Без подтверждённого разрешения") === m.noperm && shownNum("Отказались") === m.refused, `${nt} | ${JSON.stringify(m)}`);
  await reveal(page.getByText("База клиентов из Altegio").first());
  await step(t, "base");
  await reveal(page.getByText("Сегменты", { exact: true }));
  await step(t, "segments");

  // сегмент → все люди со статусами (маска) → «Создать рассылку по сегменту» — мастер второго номера, шаг «Аудитория»
  const pora = page.getByRole("button", { name: /^Сегмент «Пора на стрижку»/ });
  const poraN = await adsOf(pora);
  const poraAll = Number(((await pora.getAttribute("aria-label")) || "").match(/: (\d+) /)?.[1] || 0);
  ok("в сегменте «Пора на стрижку» есть кому рекламу, и всех клиентов не меньше", poraN > 0 && poraAll >= poraN, `${poraN} / ${poraAll}`);
  await tap(pora);
  const dlg = page.getByRole("dialog", { name: "Пора на стрижку" });
  await dlg.waitFor();
  const people = dlg.getByRole("list", { name: "Клиенты сегмента" });
  await people.locator(":scope > li").first().waitFor();
  const ptext = await text(people);
  ok("люди сегмента: номера только маской", /\+7 700 \*\*\* \*\* \d\d/.test(ptext) && !/\d{3} \d\d \d\d/.test(ptext.replace(/\*\*\* \*\* \d\d/g, "")), ptext.slice(0, 120));
  ok("люди сегмента: все клиенты со статусами — «получит рекламу» и «не получит: почему»", (await people.locator(":scope > li").count()) === poraAll && /получит рекламу/.test(ptext) && (poraAll === poraN || /не получит рекламу: /.test(ptext)), ptext.slice(0, 300));
  await step(t, "segment-people");
  await tap(dlg.getByRole("button", { name: "Создать рассылку по сегменту" }));
  const gw = gaDialog(page);
  await gw.waitFor();
  await gaAt(gw, "Аудитория");
  const segR = gw.getByRole("radiogroup", { name: "Сегмент" }).getByRole("radio", { name: /^Пора на стрижку/ });
  ok("по сегменту — мастер второго номера, шаг 1 из 6 «Аудитория», сегмент выбран, у него — «можно рекламу»", /Шаг 1 из 6/.test(await text(gw)) && (await segR.getAttribute("aria-checked")) === "true" && /можно рекламу: \d+/.test((await segR.getAttribute("aria-label")) || ""), (await text(gw)).slice(0, 160));
  await step(t, "ga-from-segment");
  await page.keyboard.press("Escape");
  await gw.waitFor({ state: "detached" });
  await page.waitForTimeout(300);

  // вкладка «Meta»: честный статус, основной номер; рассылка шаблоном Meta — только отсюда
  await expandMeta(page);
  const mt = await text(page.getByRole("tabpanel"));
  ok("вкладка «Meta»: «неактивный канал», что в ней есть, основной номер, качество и предел Meta", /Meta — неактивный канал/.test(mt) && /автосценарий «Пора на стрижку»/.test(mt) && /высокое/.test(await text(page.getByText("Качество", { exact: true }).first().locator(".."))) && /1\s?000/.test(await text(page.getByText("Предел Meta").locator("..").first())), mt.slice(0, 300));
  await step(t, "meta-tab");
  await openMeta(page);
  const wiz = page.getByRole("region", { name: "Новая рассылка" });
  const seg0 = wiz.getByRole("radiogroup", { name: "Сегмент базы" }).getByRole("radio", { name: /Пора на стрижку/ });
  await seg0.waitFor();
  await tap(seg0);
  await tap(wiz.getByRole("button", { name: "Далее" }));
  await wiz.getByRole("heading", { name: "Сообщение" }).waitFor();
  const wtext = await text(wiz);
  ok("мастер Meta: без выбора номера и без Green-API", !/Green-API|номер бота|Номер бота/.test(wtext) && !(await wiz.getByRole("radio", { name: /бота/ }).count()), wtext.slice(0, 300).replace(/\n+/g, " / "));
  await fill(wiz.getByLabel("Название шаблона в Meta"), "pora_na_strizhku");
  await fill(wiz.getByLabel("Текст шаблона"), "{{1}}, здравствуйте! Пора на стрижку — запишитесь в Winchester.\nЧтобы не получать сообщения, ответьте СТОП");
  await step(t, "meta-wizard-message");
  await tap(wiz.getByRole("button", { name: "Далее" }));
  await wiz.getByRole("heading", { name: "Часы и предел" }).waitFor();
  ok("мастер Meta: часы отправки по умолчанию 11–20", (await wiz.getByLabel("С", { exact: true }).inputValue()) === "11" && (await wiz.getByLabel("До", { exact: true }).inputValue()) === "20");
  ok("мастер Meta: предел в сутки по умолчанию — 95% предела Meta", (await wiz.getByLabel("Не больше за 24 часа").inputValue()) === "950");
  await tap(wiz.getByRole("button", { name: "Далее" }));
  await wiz.getByRole("heading", { name: "Проверка" }).waitFor();
  await wiz.getByText("Получат шаблон").waitFor();
  const got = Number(((await text(wiz.getByText("Получат шаблон").locator(".."))).match(/(\d+)\s*$/) || [])[1] || 0);
  ok("мастер Meta: получателей столько же, скольким в сегменте можно рекламу", got === poraN, `${got} / ${poraN}`);
  const ctext = await text(wiz);
  ok("мастер Meta: предпросмотр, оценка стоимости, примеры номеров маской", /Как увидит клиент/.test(ctext) && /≈\s?\d/.test(ctext) && /оценка|Это оценка/i.test(ctext) && /\+7 700 \*\*\* \*\* \d\d/.test(ctext));
  await step(t, "meta-wizard-check");
  await fill(wiz.getByLabel("Ваш номер WhatsApp"), TEST_TO);
  await tap(wiz.getByRole("button", { name: "Отправить пробное" }));
  const tst = wiz.getByRole("status").filter({ hasText: /отправлен/i });
  await tst.waitFor({ timeout: 10_000 }).catch(() => {});
  ok("мастер Meta: пробная отправка — ответ сервера", (await tst.count()) > 0, await text(wiz.getByRole("alert").first()));
  await tap(wiz.getByRole("button", { name: "Далее" }));
  await wiz.getByRole("heading", { name: "Запуск" }).waitFor();
  ok("мастер Meta: с основного номера компании", /С номера\s*\+7 700 000 00 99/.test(await text(wiz)));
  await tap(wiz.getByRole("checkbox", { name: /Это клиенты компании/ }));
  await step(t, "meta-wizard-launch");
  await tap(wiz.getByRole("button", { name: "Создать и запустить" }));
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("progressbar", { name: "Ход рассылки" }) });
  await sheet.waitFor({ timeout: 15_000 });
  ok("шаблон Meta: после запуска открыт лист рассылки", /Пора на стрижку/.test(await text(sheet)));
  ok("POST /_cron боту", (await cron(t)) === 200);
  ok("шаблон Meta: отправлено всем из сегмента", await waitSent(t, poraN), await text(sheet.getByText(/отправлено/).first()));
  await step(t, "meta-campaign-sent");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  const hist = page.getByRole("button", { name: /^Пора на стрижку · \d\d\.\d\d/ });
  await hist.first().waitFor({ timeout: 10_000 }).catch(() => {});
  ok("рассылка шаблоном Meta — во вкладке «Meta», среди прошедших: завершена, отправлено всем", new RegExp(`Завершена[\\s\\S]*отправлено ${poraN} из ${poraN}`).test(await text(hist.first())) && (await page.getByText("Прошедшие рассылки шаблонами Meta").count()) === 1, await text(hist.first()));
  await reveal(hist.first());
  await step(t, "meta-history");

  // автосценарий «Пора на стрижку» — во вкладке «Meta»: без шаблона — ошибка; с шаблоном — включён
  const sw = page.getByRole("switch", { name: "Автосценарий «Пора на стрижку»" });
  await reveal(sw);
  await tap(sw);
  const noTpl = page.getByText(/укажите шаблон/i).first();
  await noTpl.waitFor({ timeout: 5000 }).catch(() => {});
  ok("автосценарий без шаблона: ошибка, не включён", (await noTpl.count()) > 0 && (await sw.getAttribute("aria-checked")) === "false");
  await fill(page.getByLabel("Шаблон Meta (Marketing)"), "pora_na_strizhku");
  await tap(sw);
  const ask = page.getByRole("dialog", { name: "Включить автосценарий?" });
  await ask.waitFor();
  ok("автосценарий: подтверждение «каждый день в 11:00»", /11:00/.test(await text(ask)));
  await ask.getByRole("button", { name: "Включить" }).click();
  await page.waitForFunction(() => document.querySelector('[role=switch][aria-label="Автосценарий «Пора на стрижку»"][aria-checked="true"]'), null, { timeout: 10_000 }).catch(() => {});
  ok("автосценарий включён", (await sw.getAttribute("aria-checked")) === "true");
  await reveal(sw);
  await step(t, "meta-auto-on");

  // кому ушёл шаблон, тем рекламу 30 дней не пишем: плитка «Пора на стрижку» — клиенты те же, «можно рекламу: 0»
  await subTab(page, "Клиенты");
  const emptied = page.getByRole("button", { name: /^Сегмент «Пора на стрижку»: \d+ \S+, можно рекламу: 0,/ });
  await emptied.waitFor({ timeout: 10_000 }).catch(() => {});
  ok("после рассылки в плитке «Пора на стрижку»: клиенты те же, «можно рекламу: 0»", (await emptied.count()) > 0, (await pora.getAttribute("aria-label").catch(() => "")) || "");

  // вкладка «Автоматические»: сервисные и реклама — отдельными группами; ближайшие — только по включённым сценариям
  await page.getByRole("tab", { name: /Автоматические/ }).click();
  const svc = page.getByRole("tabpanel");
  await svc.getByRole("heading", { name: "Для записи (сервисные)" }).waitFor({ timeout: 15000 });
  const stext = await text(svc);
  ok("«Автоматические»: сервисные и реклама — отдельными группами", /Реклама \(только с согласием\)/.test(stext) && (await svc.getByRole("article").count()) === 11);
  ok("«Автоматические»: второй номер на связи, всё выключено", /на связи/.test(stext) && /Все сценарии выключены/.test(stext) && !(await svc.getByRole("switch", { checked: true }).count()), stext.slice(0, 300));
  ok("«Автоматические»: «Создать рассылку» здесь нет", !(await svc.getByRole("button", { name: /Создать рассылку/ }).count()) && !(await page.getByRole("button", { name: "Создать рассылку" }).count()));
  await step(t, "auto-tab");
  await autoSet(page, ["remind24", "remind3", "review"], true);
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await svc.getByRole("list", { name: "Ближайшие сообщения" }).waitFor({ timeout: 15000 });
  await svcQueue(t, svc);
  await reveal(svc.getByRole("list", { name: "Ближайшие сообщения" }));
  await step(t, "auto-queue");
  await autoSet(page, ["remind24", "remind3", "review"], false); // фоновая задача других сессий не должна их слать
  const dry = svc.getByRole("button", { name: "Проверить по журналу (без отправки)" });
  await reveal(dry);
  await tap(dry);
  const res = svc.getByRole("status").filter({ hasText: "Записей в журнале" });
  const dryOk = await res.waitFor({ timeout: 15000 }).then(() => true, () => false);
  if (!dryOk) ok("«Автоматические»: проверка по журналу ответила", false, (await text(svc)).slice(-500));
  ok("«Автоматические»: проверка по журналу — без отправки, номера маской", /Записей в журнале: \d+/.test(await text(res)) && !/7700000\d{4}/.test(await text(svc)));
  await step(t, "auto-dry-run");
  await planTab(t, true);
  await finish(t);
  return poraN;
}

/**
 * «Шаблоны» (28 утверждённых текстов в 7 категориях, поиск, пузырь WhatsApp с настоящим именем, «Использовать», у владельца — «Копировать»,
 * «Изменить», «Сохранить», «Одобрить», архив) → мастер второго номера ровно по шагам ТЗ: Аудитория → Сообщение → Предпросмотр → Проверка
 * → Тест → Сохранение и запуск (запуск выключен — честная плашка; владелец одобряет, сотрудник сохраняет черновик) → «Календарь».
 */
const TPL = "Стрижка уже отросла?"; // W05, категория «Пора обновить стрижку», сегмент «Пора на стрижку»
async function planTab(t, owner) {
  const { page } = t;
  await subTab(page, "Шаблоны");
  const lib = page.getByLabel("Шаблоны", { exact: true });
  await lib.waitFor({ timeout: 15000 });
  const items = lib.locator("li");
  const head = norm(await text(page.getByText(/текст\S* · одобрено/).first()));
  ok(`${t.tag}: шаблоны — 28 текстов в 7 категориях, все одобрены`, /28 текстов · одобрено 28/.test(head) && (await items.count()) === 28 && (await lib.getByRole("list").count()) === 7, `${head} · ${await items.count()} · ${await lib.getByRole("list").count()}`);
  const ltext = await text(lib);
  ok(`${t.tag}: шаблоны — «Утверждённая редакция» у каждого, без номеров тем и вставок {{…}}`, (await lib.getByText("Утверждённая редакция").count()) === 28 && !/\bW\d\d\b|\{\{|\{имя\}|\{\{1\}\}/.test(ltext));
  const cats = await lib.getByRole("list").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  ok(`${t.tag}: шаблоны — семь категорий ТЗ`, JSON.stringify(cats) === JSON.stringify(["Тёплое возвращение", "Пора обновить стрижку", "Давно не виделись", "Постоянные клиенты", "После первого визита", "Поводы заглянуть", "Стиль и настроение"]), JSON.stringify(cats));
  await step(t, "templates");
  // поиск — по названию и по тексту
  const search = page.getByRole("searchbox", { name: "Поиск по шаблонам" });
  await fill(search, "отросла");
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Шаблоны"] li').length < 28, null, { timeout: 5000 }).catch(() => {});
  ok(`${t.tag}: поиск по названию «отросла» — «${TPL}»`, (await items.count()) === 1 && (await lib.getByRole("button", { name: TPL }).count()) === 1, String(await items.count()));
  await fill(search, "знакомых гостей");
  await page.waitForTimeout(300);
  ok(`${t.tag}: поиск по тексту «знакомых гостей» — «Знакомые лица» и «Свои люди»`, (await items.count()) === 2 && (await lib.getByRole("button", { name: "Знакомые лица" }).count()) === 1 && (await lib.getByRole("button", { name: "Свои люди" }).count()) === 1, String(await items.count()));
  await step(t, "templates-search");
  await tap(page.getByRole("button", { name: "Очистить поиск" }));
  const chips = page.getByRole("radiogroup", { name: "Категория" });
  await tap(chips.getByRole("radio", { name: "Давно не виделись" }));
  ok(`${t.tag}: категория «Давно не виделись» — 4 текста`, (await items.count()) === 4, String(await items.count()));
  await tap(chips.getByRole("radio", { name: "Все" }));

  // лист текста: пузырь WhatsApp с настоящим именем клиента и без имени; казахской вкладки у стартовых нет
  await tap(lib.getByRole("button", { name: TPL }));
  const sh = page.getByRole("dialog", { name: TPL });
  await sh.waitFor();
  await sh.locator("figure").nth(1).waitFor({ timeout: 10000 });
  const b1 = await text(sh.locator("figure").nth(0)), b2 = await text(sh.locator("figure").nth(1));
  ok(`${t.tag}: шаблон — пример с настоящим именем в приветствии и тот же текст без имени`, /Добрый день, [А-ЯЁ][а-яё]+! /.test(b1) && /Добрый день! /.test(b2) && /Волосы растут незаметно/.test(b1) && /Так увидит [А-ЯЁ]/.test(await text(sh)), `${b1.slice(0, 80)} | ${b2.slice(0, 60)}`);
  ok(`${t.tag}: шаблон — без вставок и скобок, без казахской вкладки, «Утверждённая редакция»`, !/[{}[\]]/.test(b1 + b2) && !(await sh.getByRole("radio", { name: "Қазақша" }).count()) && (await sh.getByText("Утверждённая редакция").count()) > 0);
  ok(`${t.tag}: шаблон — «Использовать» одной кнопкой`, await sh.getByRole("button", { name: "Использовать" }).isEnabled());
  await step(t, "template-sheet");
  if (owner) {
    ok(`${t.tag}: владельцу — «Изменить», «Копировать», «Снять одобрение»`, (await sh.getByRole("button", { name: "Изменить" }).count()) === 1 && (await sh.getByRole("button", { name: "Копировать" }).count()) === 1 && (await sh.getByRole("button", { name: "Снять одобрение" }).count()) === 1);
    // копия → изменить → «Сохранить» (своя версия, ждёт одобрения) → «Одобрить» → в архив
    await tap(sh.getByRole("button", { name: "Копировать" }));
    const cp = page.getByRole("dialog", { name: `${TPL} (копия)` });
    await cp.waitFor({ timeout: 10000 });
    ok(`${t.tag}: копия — свой текст, ждёт одобрения`, (await cp.getByText("Ждёт одобрения").count()) > 0);
    await tap(cp.getByRole("button", { name: "Изменить" }));
    const ed = cp.getByRole("textbox", { name: "Текст на русском" });
    await ed.waitFor();
    ok(`${t.tag}: редактор — текст без вставок {{…}}; имя добавит система`, !/\{\{/.test(await ed.inputValue()) && /Имя клиента система добавит сама/.test(await text(cp)));
    await fill(ed, "Добрый день! 👋🏻\n\nПроверка копии: свежая стрижка ждёт вас в Winchester ✂️\n\nЗаписать на удобное время? 💈");
    await step(t, "template-editor");
    await tap(cp.getByRole("button", { name: "Сохранить" }));
    await cp.getByRole("button", { name: "Одобрить" }).waitFor({ timeout: 10000 });
    ok(`${t.tag}: «Сохранить» — новая версия, ждёт одобрения`, (await cp.getByText("Ждёт одобрения").count()) > 0);
    await tap(cp.getByRole("button", { name: "Одобрить" }));
    await cp.getByRole("button", { name: "Снять одобрение" }).waitFor({ timeout: 10000 });
    await cp.locator("figure").first().waitFor({ timeout: 10000 });
    ok(`${t.tag}: своя версия одобрена: «Одобрен» (не «утверждённая редакция»), пример — с именем`, (await cp.getByText("Одобрен", { exact: true }).count()) > 0 && /Проверка копии/.test(await text(cp.locator("figure").first())) && /Добрый день, [А-ЯЁ]/.test(await text(cp.locator("figure").first())));
    await step(t, "template-copy-approved");
    await tap(cp.getByRole("button", { name: "В архив" }));
    await cp.waitFor({ state: "detached", timeout: 10000 });
    ok(`${t.tag}: копия — в архиве: в списке снова 28, есть «Архив»`, (await items.count()) === 28 && (await chips.getByRole("radio", { name: "Архив" }).count()) === 1);
    await tap(lib.getByRole("button", { name: TPL }));
    await sh.waitFor();
  } else {
    ok(`${t.tag}: сотрудник не правит, не копирует и не одобряет`, !(await sh.getByRole("button", { name: /^(Одобрить|Снять одобрение|Изменить|Копировать)$/ }).count()) && !(await page.getByRole("button", { name: "Новый текст" }).count()));
  }

  // «Использовать» → мастер второго номера с этим текстом; сегмент — по категории текста («Пора на стрижку»)
  await tap(sh.getByRole("button", { name: "Использовать" }));
  const gw = gaDialog(page);
  await gw.waitFor();
  await gaAt(gw, "Аудитория");
  const segs = gw.getByRole("radiogroup", { name: "Сегмент" });
  const poraR = segs.getByRole("radio", { name: /^Пора на стрижку/ });
  ok(`${t.tag}: мастер — шаг 1 из 6 «Аудитория», сегмент по категории текста выбран`, /Шаг 1 из 6/.test(await text(gw)) && (await poraR.getAttribute("aria-checked")) === "true");
  // «Пора на стрижку» уже получил шаблон Meta (30 дней без рекламы): рекламу не получит никто — так и сказано
  if (/можно рекламу: 0/.test((await poraR.getAttribute("aria-label")) || "")) ok(`${t.tag}: сегмент без рекламы — сказано, что не получит никто и где будет почему`, /рекламу сейчас не получит никто/.test(await text(gw)));
  await tap(segs.getByRole("radio", { name: /^Вся база/ }));
  const all = Number(((await segs.getByRole("radio", { name: /^Вся база/ }).getAttribute("aria-label")) || "").match(/можно рекламу: (\d+)/)?.[1] || 0);
  await step(t, "ga-audience");
  await gaNext(gw);
  await gaAt(gw, "Сообщение");
  const msgs = gw.getByRole("radiogroup", { name: "Сообщение" });
  const stopBox = gw.getByRole("checkbox", { name: /Добавить в конце/ });
  ok(`${t.tag}: «Сообщение» — выбран «${TPL}», строка «стоп» по умолчанию выключена, 7 категорий`, (await msgs.getByRole("radio", { name: TPL }).getAttribute("aria-checked")) === "true" && !(await stopBox.isChecked()) && (await gw.getByRole("radiogroup", { name: "Категория" }).getByRole("radio").count()) === 8);
  await step(t, "ga-message");
  await gaNext(gw);
  await gaAt(gw, "Предпросмотр");
  await gw.locator("figure").nth(1).waitFor({ timeout: 15000 });
  const p1 = await text(gw.locator("figure").nth(0)), p2 = await text(gw.locator("figure").nth(1));
  ok(`${t.tag}: предпросмотр — настоящее имя в приветствии и тот же текст без имени, без вставок и «стоп»`, /Добрый день, [А-ЯЁ][а-яё]+! /.test(p1) && /Добрый день! /.test(p2) && !/[{}[\]]/.test(p1 + p2) && !p1.includes(STOP_RU) && !/7700000\d{4}/.test(await text(gw)), `${p1.slice(0, 80)} | ${p2.slice(0, 60)}`);
  await step(t, "ga-preview");
  // строка «стоп» — галочкой: в предпросмотре — ровно с ней
  await tap(gw.getByRole("button", { name: "Назад" }).first());
  await gaAt(gw, "Сообщение");
  await tap(stopBox);
  await gaNext(gw);
  await gaAt(gw, "Предпросмотр");
  await page.waitForFunction((s) => (document.querySelector("[role=dialog] figure")?.textContent || "").includes(s), STOP_RU, { timeout: 15000 }).catch(() => {});
  ok(`${t.tag}: строка «стоп» выбрана — в конце сообщения в предпросмотре`, (await text(gw.locator("figure").nth(0))).includes(STOP_RU));
  await gaNext(gw);
  await gaAt(gw, "Проверка");
  await gw.getByText(/Сообщение получат:/).waitFor({ timeout: 15000 });
  const ck = norm(await text(gw));
  const valid = Number((ck.match(/Сообщение получат: (\d+)/) || [])[1] || 0);
  ok(`${t.tag}: проверка — получат столько, скольким можно рекламу; «технически можно написать» и «можно писать рекламу» отдельно`, valid > 0 && valid === all && /технически можно написать/.test(ck) && /Можно писать рекламу/.test(ck) && /В сегменте «Вся база»/.test(ck), ck.slice(0, 400));
  const cap = gw.getByRole("textbox", { name: "Предел сообщений в сутки" });
  ok(`${t.tag}: предел сообщений в сутки — 50 по умолчанию, слова «безопасно» нет`, (await cap.inputValue()) === "50" && /примерно \d+ (день|дня|дней)/.test(ck) && !/безопасн|гаранти/i.test(ck));
  await fill(cap, "301");
  ok(`${t.tag}: предел больше 300 — ошибка, дальше нельзя`, /Число от 1 до 300/.test(await text(gw)) && (await gw.getByRole("button", { name: "Далее" }).isDisabled()));
  await fill(cap, "50");
  await step(t, "ga-check");
  await gaNext(gw);
  await gaAt(gw, "Тест");
  if (owner) {
    // тест — только на номер для проверки владельца; не указан — вписать здесь (он сохранится в «Автоматических»)
    const pin = gw.getByLabel("Номер для проверки");
    const send = gw.getByRole("button", { name: "Отправить тест" });
    // номер для проверки пульт дочитывает при входе на шаг — ждём поле или кнопку, а не заглушку загрузки
    await pin.or(send).first().waitFor({ timeout: 10000 });
    if (await pin.count()) {
      await fill(pin, TEST_TO);
      await tap(gw.getByRole("button", { name: "Сохранить" }));
    }
    await send.waitFor({ timeout: 10000 });
    const before = gaSent().length;
    await tap(send);
    await gw.getByRole("status").filter({ hasText: /отправлено на ваш номер/i }).waitFor({ timeout: 10000 }).catch(() => {});
    const out = gaSent().slice(before);
    ok(`${t.tag}: тест ушёл один раз — на номер владельца, тот же текст со строкой «стоп» и именем вымышленного клиента`, out.length === 1 && out[0].to === "77000009999" && out[0].text.includes(STOP_RU) && /Добрый день, Айгерим!/.test(out[0].text), JSON.stringify(out.map((x) => [x.to, x.text.slice(0, 40)])));
    ok(`${t.tag}: тест — что ушло, видно пузырём`, /Добрый день, Айгерим!/.test(await text(gw.locator("figure").first())));
  } else ok(`${t.tag}: тест отправляет владелец — кнопки нет`, !(await gw.getByRole("button", { name: "Отправить тест" }).count()) && /Тест отправляет владелец/.test(await text(gw)));
  await step(t, "ga-test");
  await gaNext(gw);
  await gaAt(gw, "Сохранение и запуск");
  const fin = await text(gw);
  // запуск со второго номера выключен — честная плашка; кнопки «Запустить» нет; владельцу — «Как включить» (свёрнуто)
  ok(
    `${t.tag}: «Сохранение и запуск» — ${owner ? "плашка «Запуск выключен», «Как включить», «Одобрить» и «Сохранить черновик»" : "«Запускает владелец», только «Сохранить черновик»"}, без «Запустить»`,
    !(await gw.getByRole("button", { name: /^Запустить|^Запланировать/ }).count()) &&
      (await gw.getByRole("button", { name: "Сохранить черновик" }).count()) === 1 &&
      (owner ? (await gw.getByRole("status", { name: "Запуск выключен" }).count()) === 1 && /Как включить/.test(fin) && (await gw.getByRole("button", { name: "Одобрить" }).count()) === 1 : /Запускает владелец/.test(fin) && !(await gw.getByRole("button", { name: "Одобрить" }).count())),
    fin.slice(0, 400),
  );
  ok(`${t.tag}: итог — ссылки на шаги: «Выбрать аудиторию», «Выбрать сообщение», «Посмотреть текст», «Проверить получателей»`, ["Выбрать аудиторию", "Выбрать сообщение", "Посмотреть текст", "Проверить получателей"].every((x) => fin.includes(x)));
  await step(t, "ga-save");
  await tap(gw.getByRole("button", { name: owner ? "Одобрить" : "Сохранить черновик", exact: true }));
  const cs = page.getByRole("dialog", { name: new RegExp(`^${TPL.replace("?", "\\?")} · `) });
  await cs.waitFor({ timeout: 15000 });
  // сведения рассылки (с текстом) приходят вторым запросом — ждём пузырь сообщения
  await cs.locator("figure").first().waitFor({ timeout: 15000 });
  const cst = await text(cs);
  ok(`${t.tag}: лист черновика — без «Итогов» (их ещё нет)`, !(await cs.getByRole("region", { name: "Итоги рассылки" }).count()) && !/Итоги/.test(cst));
  ok(`${t.tag}: лист рассылки — ${owner ? "«Одобрена»" : "«Черновик»"}, сообщение пузырём со строкой «стоп», «Запустить» нет`, (owner ? /Одобрена/.test(await text(cs.locator("header"))) : /Черновик/.test(await text(cs.locator("header")))) && cst.includes(STOP_RU) && !(await cs.getByRole("button", { name: /^Запустить/ }).count()), cst.slice(0, 300));
  ok(`${t.tag}: одно уведомление за раз`, (await page.locator("[aria-live=polite].fixed > *").count()) <= 1);
  await step(t, "ga-saved");
  if (owner) {
    // сервер: запуск при запрете — 409 ga_off и (владельцу) как включить
    t.allow.push(/\/api\/bc\/act$/);
    const off = await page.evaluate(async () => {
      const list = await (await fetch("/api/bc/list?c=winchester")).json();
      const ga = (list.list || []).find((x) => x.ch === "ga" && x.status === "ready");
      if (!ga) return { none: true };
      const r = await fetch("/api/bc/act", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ c: "winchester", id: ga.id, act: "start" }) });
      return { status: r.status, ...(await r.json()) };
    });
    t.allow.pop();
    if (!off.none) ok(`${t.tag}: сервер при запрете отвечает ga_off и, владельцу, как включить`, off.status === 409 && off.code === "ga_off" && /GA_BROADCAST_WINCHESTER/.test(off.how || ""), JSON.stringify(off).slice(0, 200));
  }
  await page.keyboard.press("Escape");
  await cs.waitFor({ state: "detached" });
  const drafts = page.getByRole("button", { name: new RegExp(`^${TPL.replace("?", "\\?")} · \\d\\d\\.\\d\\d`) });
  ok(`${t.tag}: рассылка — в группе «Черновики и запланированные»`, (await page.getByText("Черновики и запланированные").count()) === 1 && (await drafts.count()) > 0);
  await step(t, "ga-drafts");

  // календарь месяца: сетка дней, выбранный день; итоги доставки
  await page.getByRole("tab", { name: /Календарь/ }).click();
  const panel = page.getByRole("tabpanel");
  const grid = panel.getByRole("grid");
  const calOk = await grid.waitFor({ timeout: 15000 }).then(() => true, () => false);
  const cells = grid.getByRole("gridcell");
  ok(`${t.tag}: календарь — сетка месяца с днями недели`, calOk && (await cells.count()) >= 28 && (await grid.getByRole("columnheader").count()) === 7, (await text(panel)).slice(0, 300));
  await step(t, "plan-calendar");
  const stats = panel.getByRole("list", { name: /Итоги за/ }).or(panel.getByText(/Числа появятся|отчётов о доставке не было/)).first();
  await stats.waitFor({ timeout: 15000 });
  ok(`${t.tag}: календарь и итоги — полных номеров нет`, !/7700000\d{4}/.test(await t.page.content()));
  await page.getByRole("tab", { name: /Маркетинг/ }).click();
}

// =====================================================================================================================
async function staffWinchester(vp, scheme) {
  const t = await session({ key: dl.STAFF_W, c: "winchester", vp, scheme, tag: `w-staff-${vp.width}-${scheme}` });
  const { page } = t;
  await page.getByRole("region", { name: "Канал рассылок" }).waitFor();
  await page.waitForLoadState("networkidle");
  // сигнал Meta — во вкладке «Meta»: виден, кнопки «Снять сигнал Meta» нет
  await expandMeta(page);
  const hold = page.getByRole("alert").filter({ hasText: "Сигнал от Meta" });
  ok(`${t.tag}: «Meta» — сигнал Meta виден, кнопки «Снять сигнал Meta» нет`, (await hold.count()) > 0 && !(await page.getByRole("button", { name: "Снять сигнал Meta" }).count()) && /Снять сигнал может владелец/.test(await text(hold)) && /Есть сигнал Meta/.test(await text(page.getByRole("region", { name: "Канал Meta" }))));
  await reveal(hold);
  await step(t, "meta-hold");
  const autoTitle = page.getByText("Автосценарий «Пора на стрижку»").first();
  await reveal(autoTitle);
  ok(`${t.tag}: автосценарий без переключателя и настроек`, !(await page.getByRole("switch").count()) && !(await page.getByRole("button", { name: "Изменить настройки" }).count()) && (await page.getByText("Меняет только владелец.").count()) > 0);
  await step(t, "auto-readonly");
  // мастер Meta: выбора номера и текста с номера бота нет
  await openMeta(page);
  const wiz = page.getByRole("region", { name: "Новая рассылка" });
  await wiz.getByText(/основного номера/).first().waitFor();
  await wiz.getByRole("radiogroup", { name: "Сегмент базы" }).or(wiz.getByLabel("Номера и имена")).first().waitFor();
  const wtext = await text(wiz);
  ok(`${t.tag}: в мастере Meta нет выбора номера и рассылки текстом с номера бота`, !/Green-API|номер бота|Номер бота|Текст сообщения/.test(wtext) && !(await wiz.getByRole("radio", { name: /бота|Green/ }).count()));
  const picked = await wiz.locator("input[type=radio][name=seg]:checked").evaluate((el) => el.closest("label")?.innerText || "").catch(() => "");
  ok(`${t.tag}: мастер Meta — по умолчанию выбран сегмент, где есть кому писать`, Number((picked.match(/(\d+)\s*$/) || [])[1] || 0) > 0, picked.replace(/\n+/g, " / "));
  await step(t, "meta-wizard");
  if (t.phone) await wiz.getByRole("button", { name: "Закрыть" }).first().click();
  else await wiz.getByRole("button", { name: "Закрыть" }).click();
  await wiz.waitFor({ state: "detached" });
  // «Клиенты»: без «Обновить базу»
  await subTab(page, "Клиенты");
  await page.getByText("База клиентов из Altegio").first().waitFor();
  ok(`${t.tag}: «Клиенты» — нет «Обновить базу», десять чисел видны`, !(await page.getByRole("button", { name: "Обновить базу" }).count()) && (await page.getByLabel("Числа базы").count()) === 1);
  await step(t, "base");
  // «Автоматические»: только смотреть
  await page.getByRole("tab", { name: /Автоматические/ }).click();
  const svc = page.getByRole("tabpanel");
  await svc.getByRole("heading", { name: "Для записи (сервисные)" }).waitFor({ timeout: 15000 });
  const stext = await text(svc);
  ok(`${t.tag}: «Автоматические» — только смотреть: ни выключателей, ни проверок, ни правки`, !(await svc.getByRole("switch").count()) && !(await svc.getByRole("button", { name: /Проверить на мой номер|Изменить|Проверить по журналу/ }).count()) && /на связи/.test(stext));
  await step(t, "auto-tab");
  await planTab(t, false);
  await finish(t);
}

// =====================================================================================================================
/** Владелец, компьютер: сигнал Meta снимается его кнопкой; шаблон Meta «запустить позже» и запуск из листа; ошибка сервера в настройках
 *  автосценария; рассылка со второго номера при разрешённом запуске (GA_BROADCAST_WINCHESTER = 1, как в Cloudflare): сигнал о номере →
 *  «Всё равно запустить» → итоговая аудитория → «Запустить» (порядок подтверждений и force — как требует сервер), фоновая отправка —
 *  ровно тот текст, что был в листе подтверждения; «Запланировать»; итоги с «нет данных»; «Ответы» — в «Чаты». */
async function ownerWinchesterDesk() {
  const t = await session({ key: dl.OWNER, c: "winchester", vp: DESK, scheme: "dark", tag: "w-owner-1280-dark", own: [TEST_TO.replace(/\D/g, "")] });
  const { page } = t;
  await expandMeta(page);
  const hold = page.getByRole("alert").filter({ hasText: "Сигнал от Meta" });
  await hold.waitFor();
  await step(t, "meta-hold");
  await hold.getByRole("button", { name: "Снять сигнал Meta" }).click();
  const ask = page.getByRole("dialog", { name: "Снять сигнал Meta?" });
  await ask.waitFor();
  await ask.getByRole("button", { name: "Снять сигнал" }).click();
  await hold.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  ok("владелец снял сигнал Meta — плашки нет", !(await hold.count()));

  // база: люди сегмента
  await subTab(page, "Клиенты");
  const davno = page.getByRole("button", { name: /^Сегмент «Давно не были»/ });
  await davno.waitFor();
  const davnoN = await adsOf(davno);
  ok("в сегменте «Давно не были» есть кому рекламу", davnoN > 0, String(davnoN));
  await tap(davno);
  const dlg = page.getByRole("dialog", { name: "Давно не были" });
  await dlg.getByRole("list", { name: "Клиенты сегмента" }).locator(":scope > li").first().waitFor();
  await step(t, "segment-people");
  await dlg.getByRole("button", { name: "Закрыть" }).click();
  await dlg.waitFor({ state: "detached" });

  // шаблон Meta на компьютере: одна форма, «запустить позже», запуск из листа
  await openMeta(page, "click");
  const wiz = page.getByRole("region", { name: "Новая рассылка" });
  const seg = wiz.getByRole("radiogroup", { name: "Сегмент базы" });
  await seg.waitFor();
  await seg.getByRole("radio", { name: /Давно не были/ }).click();
  await fill(wiz.getByLabel("Название шаблона в Meta"), "davno_ne_byli");
  await fill(wiz.getByLabel("Текст шаблона"), "{{1}}, давно вас не видели! Скидка 10% на стрижку до конца месяца.\nЧтобы не получать сообщения, ответьте СТОП");
  await tap(wiz.getByRole("button", { name: "Проверить" }));
  await wiz.getByText("Получат шаблон").waitFor();
  await tap(wiz.getByRole("checkbox", { name: /Это клиенты компании/ }));
  await tap(wiz.getByRole("button", { name: "Создать, запустить позже" }));
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("progressbar", { name: "Ход рассылки" }) });
  await sheet.waitFor({ timeout: 15_000 });
  await sheet.getByRole("button", { name: "Запустить" }).click();
  const sure = page.getByRole("dialog", { name: "Запустить рассылку?" });
  await sure.waitFor();
  ok("шаблон Meta: запуск из листа — подтверждение с оценкой стоимости", /≈/.test(await text(sure)));
  await sure.getByRole("button", { name: "Запустить" }).click();
  await sheet.getByRole("button", { name: "Пауза" }).waitFor({ timeout: 10_000 });
  ok("POST /_cron боту", (await cron(t)) === 200);
  ok("шаблон Meta на компьютере: отправлено всем", await waitSent(t, davnoN), await text(sheet.getByText(/отправлено/).first()));
  await step(t, "meta-campaign-sent");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });

  // автосценарий: ошибка сервера списком
  await tap(page.getByRole("button", { name: "Изменить настройки" }));
  await fill(page.getByLabel("Дней с последнего визита"), "3");
  t.allow.push(/\/api\/bc\/auto$/); // ошибку 400 вызываем нарочно
  await tap(page.getByRole("button", { name: "Сохранить" }));
  const err = page.getByText(/от 7 до 120/).first();
  await err.waitFor({ timeout: 5000 }).catch(() => {});
  ok("автосценарий: ошибка сервера показана текстом", (await err.count()) > 0);
  t.allow.pop();
  await tap(page.getByRole("button", { name: "Отмена" }));

  // ---------- второй номер: запуск разрешён владельцем ----------
  dl.S.env.GA_BROADCAST_WINCHESTER = "1";
  const acts = actBodies(page);
  try {
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: /Маркетинг/ }).click();
    await subTab(page, "Рассылки");
    const card = page.getByRole("region", { name: "Канал рассылок" });
    await card.getByText(/Запуск разрешён владельцем/).waitFor({ timeout: 15000 });
    ok("запуск разрешён: в карточке — «Запуск разрешён владельцем», только с согласием и не больше предела", /реклама уходит только тем, кто дал согласие, не больше предела в сутки/.test(await text(card)));
    // сигнал о номере (Green-API): запуск не закрыт — сервер спросит, решает владелец
    await dl.S.kv.api.put("bchold:winchester", JSON.stringify({ ga: { at: Date.now(), why: "WhatsApp временно ограничил номер (проверка)" } }));
    await page.reload();
    await page.waitForLoadState("networkidle");
    const row = page.getByRole("button", { name: new RegExp(`^${TPL.replace("?", "\\?")} · \\d\\d\\.\\d\\d[\\s\\S]*Одобрена`) }).first();
    await row.waitFor({ timeout: 15000 });
    await tap(row);
    const cs = page.getByRole("dialog", { name: new RegExp(`^${TPL.replace("?", "\\?")} · `) });
    await cs.waitFor();
    const launch = cs.getByRole("button", { name: "Запустить", exact: true });
    await launch.waitFor({ timeout: 10000 });
    ok("лист одобренной рассылки: «Сразу» / «Запланировать» и «Запустить», плашки запрета нет; сигнал Green-API — предупреждением", (await cs.getByRole("radio", { name: "Запланировать" }).count()) === 1 && !(await cs.getByRole("status", { name: "Запуск выключен" }).count()) && /Сигнал от Green-API/.test(await text(cs)));
    await step(t, "ga-sheet-launch");
    t.allow.push(/\/api\/bc\/act$/); // 409 — вопросы сервера, так и должно быть
    const n0 = acts.length;
    await launch.click();
    const sig = page.getByRole("dialog", { name: "Есть сигнал о номере" });
    await sig.waitFor({ timeout: 10000 });
    ok("запуск: сначала — вопрос о сигнале о номере (текст сервера)", /Сигнал от/.test(await text(sig)) && /временно ограничил номер/.test(await text(sig)));
    await step(t, "ga-hold-question");
    await sig.getByRole("button", { name: "Всё равно запустить" }).click();
    const fin = page.getByRole("dialog", { name: "Запустить рассылку?" });
    await fin.waitFor({ timeout: 10000 });
    const ft = norm(await text(fin));
    const fn = Number((ft.match(/Сообщение получат (\d+) из (\d+)/) || [])[1] || 0), frest = Number((ft.match(/Сообщение получат (\d+) из (\d+)/) || [])[2] || 0);
    const sample = (await text(fin.locator("figure p").first())).replace(/\s*12:00\s*$/, "");
    ok("потом — итоговая аудитория: «Сообщение получат N из M», точный текст с именем и строкой «стоп», предел, часы и примерно дней", fn > 0 && frest >= fn && /Добрый день, [А-ЯЁ][а-яё]+! /.test(sample) && sample.includes(STOP_RU) && /Предел сообщений в сутки 50/.test(ft) && /с 11:00 до 20:00 по Астане/.test(ft) && /Примерно \d+ (день|дня|дней)/.test(ft), ft.slice(0, 300));
    await step(t, "ga-final");
    const before = gaSent().length;
    await fin.getByRole("button", { name: "Запустить" }).click();
    await cs.getByRole("button", { name: "Пауза" }).waitFor({ timeout: 10000 });
    const seq = acts.slice(n0).filter((x) => x.act === "start");
    ok("порядок подтверждений: без подтверждения → force (сигнал) → force + sure + n (аудитория)", seq.length === 3 && !seq[0].force && !seq[0].sure && seq[1].force === true && !seq[1].sure && seq[2].force === true && seq[2].sure === true && seq[2].n === fn, JSON.stringify(seq));
    ok("сигнал о номере снят запуском (решение владельца)", !(dl.S.kv.json("bchold:winchester") || {}).ga);
    ok("лист: «Идёт отправка»", /Идёт отправка/.test(await text(cs.locator("header"))));
    t.allow.pop();
    ok("POST /_cron боту", (await cron(t)) === 200);
    const sent = gaSent().slice(before);
    ok("ушло со второго номера ровно то сообщение, что было в листе подтверждения", sent.length >= 1 && norm(sent[0].text) === norm(sample), JSON.stringify(sent.map((x) => x.text.slice(0, 60))));
    await step(t, "ga-running");
    const id = seq[2]?.id;
    // итоги: подписи ТЗ; null — «нет данных», а не 0
    await page.keyboard.press("Escape");
    await cs.waitFor({ state: "detached" });
    const fake = async (route) => {
      const resp = await route.fetch();
      const j = await resp.json();
      j.results = { selected: 30, admitted: 20, sent: 1, unsure: 0, failed: 0, skipped: 0, delivered: null, read: null, replied: null, want: null, booked: null, refused: null, window: 14, reports: false };
      await route.fulfill({ response: resp, json: j });
    };
    await page.route(new RegExp(`/api/bc/get\\?.*id=${id}`), fake);
    await tap(page.getByRole("button", { name: new RegExp(`^${TPL.replace("?", "\\?")} · \\d\\d\\.\\d\\d[\\s\\S]*Идёт отправка`) }).first());
    await cs.waitFor();
    const it = cs.getByRole("region", { name: "Итоги рассылки" });
    await it.waitFor({ timeout: 10000 });
    const itt = norm(await text(it));
    ok("итоги: Выбрано, Допущено, Ушло, Не знаем, Не ушло, Доставлено, Прочитано, Ответили, Хотят записаться, Записались после, Отказались", ["Выбрано", "Допущено", "можно писать рекламу", "Ушло", "Не знаем", "сбой связи", "Не ушло", "Доставлено", "Прочитано", "если клиент не отключил отчёты", "Ответили", "Хотят записаться", "Записались после", "совпадение по времени, не доказательство", "Отказались"].every((x) => itt.includes(x)), itt.slice(0, 500));
    ok("итоги: данных нет — «нет данных», а не 0", (itt.match(/нет данных/g) || []).length >= 6 && !/Доставлено 0/.test(itt), itt.slice(0, 500));
    await reveal(it);
    await step(t, "ga-results");
    await page.unroute(new RegExp(`/api/bc/get\\?.*id=${id}`), fake);
    // «Ответы» — в «Чаты», раздел «Ответы»
    await tap(cs.getByRole("button", { name: "Ответы", exact: true }));
    await page.waitForURL(/#\/inbox/, { timeout: 10000 }).catch(() => {});
    await page.getByRole("button", { name: /^Раздел Ответы/ }).waitFor({ timeout: 10000 }).catch(() => {});
    ok("«Ответы» — переход в «Чаты», раздел «Ответы»", /#\/inbox/.test(page.url()) && (await page.getByRole("button", { name: /^Раздел Ответы/ }).count()) === 1, page.url());
    await step(t, "replies");
    await page.getByRole("link", { name: "Рассылки" }).click();
    await page.getByRole("heading", { name: "Рассылки" }).first().waitFor();

    // «Запланировать»: мастер на компьютере, другой текст — поиском; время — числом (мс), лист с «Начнётся …»
    await page.getByRole("button", { name: "Создать рассылку" }).first().click();
    const gw = gaDialog(page);
    await gw.waitFor();
    await gaAt(gw, "Аудитория");
    await tap(gw.getByRole("radiogroup", { name: "Сегмент" }).getByRole("radio", { name: /^Вся база/ }));
    await step(t, "ga-desk-audience");
    await gaNext(gw);
    await gaAt(gw, "Сообщение");
    await fill(gw.getByRole("searchbox", { name: "Поиск по текстам" }), "давно");
    await tap(gw.getByRole("radiogroup", { name: "Сообщение" }).getByRole("radio", { name: "Давно не виделись" }));
    await step(t, "ga-desk-message");
    await gaNext(gw);
    await gaAt(gw, "Предпросмотр");
    await gw.locator("figure").nth(1).waitFor({ timeout: 15000 });
    await step(t, "ga-desk-preview");
    await gaNext(gw);
    await gaAt(gw, "Проверка");
    await gw.getByText(/Сообщение получат:/).waitFor({ timeout: 15000 });
    await step(t, "ga-desk-check");
    await gaNext(gw);
    await gaAt(gw, "Тест");
    await gaNext(gw);
    await gaAt(gw, "Сохранение и запуск");
    await tap(gw.getByRole("radio", { name: "Запланировать" }));
    const when = gw.getByLabel("Дата и время начала");
    await when.waitFor();
    ok("«Запланировать»: по умолчанию — завтра в 11:00 по Астане", /T11:00$/.test(await when.inputValue()), await when.inputValue());
    await step(t, "ga-desk-schedule");
    const n1 = acts.length;
    t.allow.push(/\/api\/bc\/act$/);
    await tap(gw.getByRole("button", { name: "Запланировать", exact: true }));
    const pf = page.getByRole("dialog", { name: "Запланировать рассылку?" });
    await pf.waitFor({ timeout: 15000 });
    ok("«Запланировать»: лист итоговой аудитории — «Начнётся …» по Астане", /Начнётся \d+ \S+, 11:00 по Астане/.test(norm(await text(pf))), norm(await text(pf)).slice(0, 300));
    await step(t, "ga-desk-final");
    await pf.getByRole("button", { name: "Запланировать" }).click();
    const ps = page.getByRole("dialog", { name: /^Давно не виделись · / });
    await ps.waitFor({ timeout: 15000 });
    await ps.getByText(/Запланирована на/).first().waitFor({ timeout: 10000 }).catch(() => {});
    const pseq = acts.slice(n1).filter((x) => x.act === "start");
    ok("«Запланировать»: время ушло числом (мс), подтверждение — sure и n; лист — «Запланирована на …»", pseq.length === 2 && typeof pseq[0].at === "number" && pseq[1].at === pseq[0].at && pseq[1].sure === true && /Запланирована на/.test(await text(ps.locator("header"))), JSON.stringify(pseq));
    t.allow.pop();
    await step(t, "ga-desk-scheduled");
    await page.keyboard.press("Escape");
    await ps.waitFor({ state: "detached" });
    const planned = page.getByRole("button", { name: /^Давно не виделись · \d\d\.\d\d[\s\S]*Запланирована на/ });
    ok("запланированная — в группе «Черновики и запланированные»; идущая — в «Идут»", (await planned.count()) === 1 && (await page.getByText("Идут", { exact: true }).count()) === 1);
    // «Результаты»: итоги запущенной
    await subTab(page, "Результаты");
    await page.getByRole("button", { name: new RegExp(`^${TPL.replace("?", "\\?")}`) }).first().waitFor({ timeout: 10000 });
    ok("«Результаты»: запущенная рассылка с итогами (ушло, доставлено, ответили, записались после)", /Ушло[\s\S]*Доставлено[\s\S]*Ответили[\s\S]*Записались после/.test(await text(page.getByRole("tabpanel"))));
    await step(t, "results-tab");
  } finally {
    // остановить рассылки второго номера (фоновая отправка других сессий их не шлёт) и вернуть запрет
    await page.evaluate(async () => {
      const list = await (await fetch("/api/bc/list?c=winchester")).json();
      for (const b of (list.list || []).filter((x) => x.ch === "ga" && (x.status === "running" || x.status === "paused")))
        await fetch("/api/bc/act", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ c: "winchester", id: b.id, act: "stop" }) });
    }).catch(() => {});
    delete dl.S.env.GA_BROADCAST_WINCHESTER;
    await dl.S.kv.api.delete("bchold:winchester");
  }
  await page.getByRole("tab", { name: /Автоматические/ }).click();
  await page.getByRole("tabpanel").getByRole("heading", { name: "Для записи (сервисные)" }).waitFor({ timeout: 15000 });
  await step(t, "auto-tab");
  await finish(t);
}

// =====================================================================================================================
async function ownerDent(vp, scheme, full) {
  const t = await session({ key: dl.OWNER, c: "dent", vp, scheme, tag: `d-owner-${vp.width}-${scheme}`, own: DENT_OWN });
  const { page } = t;
  const card = page.getByRole("region", { name: "Канал рассылок" });
  await card.waitFor();
  await page.waitForLoadState("networkidle");
  ok(`${t.tag}: главный вид — второй номер «Демо Дента»: на связи, запуск разрешён`, /Второй WhatsApp/.test(await text(card)) && /На связи/.test(await text(card)) && /Запуск разрешён/.test(await text(card)));
  await step(t, "overview");
  // «Создать рассылку» — всегда мастер второго номера; базы нет — причина и переход во вкладку «Meta»
  await tap(page.getByRole("button", { name: "Создать рассылку" }).first());
  const gw = gaDialog(page);
  await gw.waitFor();
  const toMeta = gw.getByRole("button", { name: "Открыть «Meta»" });
  await toMeta.waitFor({ timeout: 15000 });
  ok(`${t.tag}: без базы мастер второго номера говорит почему и ведёт во вкладку «Meta»`, /только по базе клиентов/.test(await text(gw)) && (await gw.getByRole("button", { name: "Далее" }).isDisabled()));
  await step(t, "ga-no-base");
  await tap(toMeta);
  await gw.waitFor({ state: "detached" });
  ok(`${t.tag}: открыта вкладка «Meta» («шаблоны»)`, (await page.getByRole("tab", { name: /^Meta/ }).getAttribute("aria-selected")) === "true" && /^Meta · шаблоны/.test((await page.getByRole("tab", { name: /^Meta/ }).getAttribute("aria-label")) || ""));
  await page.getByRole("button", { name: "Рассылка шаблоном Meta" }).waitFor();
  ok(`${t.tag}: «Meta» — основной номер, без «неактивного канала»`, /Основной номер · шаблоны Meta/.test(await text(page.getByRole("region", { name: "Канал Meta" }))));
  await step(t, "meta-tab");
  if (full) {
    await openMeta(page);
    const wiz = page.getByRole("region", { name: "Новая рассылка" });
    const list = wiz.getByLabel("Номера и имена");
    await list.waitFor();
    ok("«Дент»: мастер Meta без выбора номера, получатели — список", !/Green-API|номер бота|Номер бота/.test(await text(wiz)));
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
    await tap(wiz.getByRole("button", { name: "Создать и запустить" }));
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("progressbar", { name: "Ход рассылки" }) });
    await sheet.waitFor({ timeout: 15_000 });
    ok("POST /_cron боту", (await cron(t)) === 200);
    ok("«Дент»: отправлено всем из списка", await waitSent(t, DENT_OWN.length), await text(sheet.getByText(/отправлено/).first()));
    await step(t, "campaign-sent");
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached" });
  }
  // «Автоматические» компании без журнала Altegio — что бот шлёт сам (прежний вид) и номер бота
  await page.getByRole("tab", { name: /Автоматические/ }).click();
  await page.getByRole("tabpanel").getByText("Что бот отправляет сам").waitFor();
  const stext = await text(page.getByRole("tabpanel"));
  ok(`${t.tag}: «Автоматические» без журнала Altegio — что бот шлёт сам, номер бота на связи`, /Второй WhatsApp/.test(stext) && /на связи/.test(stext) && !(await page.getByRole("tabpanel").getByRole("article").count()));
  ok(`${t.tag}: [12] без Altegio — все три вида выключены, причина словами`, (await page.getByRole("tabpanel").getByText("выключено", { exact: true }).count()) === 3 && /запись через Altegio не подключена/.test(stext), stext.slice(0, 400));
  await step(t, "service-tab");
  await finish(t);
}

/** Остальные сочетания размера и темы — главные экраны владельца Winchester (для глаз). */
async function gallery(vp, scheme, { botOff = false } = {}) {
  const t = await session({ key: dl.OWNER, c: "winchester", vp, scheme, tag: `w-owner-${vp.width}-${scheme}` });
  const { page } = t;
  await page.getByRole("region", { name: "Канал рассылок" }).waitFor();
  await page.waitForLoadState("networkidle");
  await step(t, "overview");
  await subTab(page, "Клиенты");
  await page.getByRole("button", { name: /^Сегмент «Вся база»/ }).waitFor();
  await step(t, "base");
  await reveal(page.getByText("Сегменты", { exact: true }));
  await step(t, "segments");
  await subTab(page, "Шаблоны");
  await page.getByLabel("Шаблоны", { exact: true }).waitFor({ timeout: 15000 });
  await step(t, "templates");
  await subTab(page, "Результаты");
  await step(t, "results");
  await expandMeta(page);
  await step(t, "meta");
  await reveal(page.getByText("Автосценарий «Пора на стрижку»").first());
  await step(t, "meta-auto");
  await openMeta(page);
  await page.getByRole("region", { name: "Новая рассылка" }).getByText(/основного номера/).first().waitFor();
  await step(t, "meta-wizard");
  await page.keyboard.press("Escape");
  // бот на номере бота выключен (как Text BOT_GA_WINCHESTER = 0): у Winchester сообщения идут по журналу Altegio — предупреждения нет
  if (botOff) dl.S.env.BOT_GA_WINCHESTER = "0";
  try {
    await page.getByRole("tab", { name: /Автоматические/ }).click();
    await page.getByRole("tabpanel").getByRole("heading", { name: "Для записи (сервисные)" }).waitFor({ timeout: 15000 });
    const off = page.getByRole("tabpanel").getByRole("status").filter({ hasText: "Бот на номере бота выключен" });
    ok(`${t.tag}: «Автоматические» — ${botOff ? "бот выключен" : "бот включён"}: предупреждения нет (сообщения по журналу Altegio)`, !(await off.count()));
    await step(t, botOff ? "auto-bot-off" : "auto-tab");
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
  await page.waitForLoadState("networkidle");
  await expandMeta(page);

  await openMeta(page, "click");
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
  await openMeta(page, "click");
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
  await expandMeta(page);
  await page.getByRole("alert").filter({ hasText: "Сигнал от Meta" }).waitFor();
  await openMeta(page, "click");
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
  await expandMeta(o.page);
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
  await page.getByRole("region", { name: "Канал рассылок" }).waitFor();
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

  // [16] у плашки качества видно слово «качество» (а не только «высокое») — во вкладке «Meta»
  await expandMeta(page);
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
  await openMeta(page);
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
  await openMeta(page);
  const again = wiz.getByRole("button", { name: "Начать заново" });
  await again.waitFor();
  const h2 = (await again.boundingBox())?.height || 0;
  ok("[15] «Начать заново» — касание не меньше 44 px", h2 >= 43.5, String(h2));
  await step(t, "fix15-restart");
  await tap(again);
  await wiz.getByRole("button", { name: "Закрыть" }).first().click();
  await wiz.waitFor({ state: "detached" });

  // [15] «Автоматические»: строки настроек и выключатели — касание не меньше 44 px
  await page.getByRole("tab", { name: /Автоматические/ }).click();
  const row = page.getByRole("button", { name: /^Часы отправки:/ });
  await row.waitFor({ timeout: 15000 });
  const h3 = (await row.boundingBox())?.height || 0;
  const swh = await page.getByRole("switch").first().evaluate((el) => { const a = getComputedStyle(el, "::after"); return el.getBoundingClientRect().height - parseFloat(a.top) - parseFloat(a.bottom); });
  ok("[15] «Автоматические»: строка «Часы отправки» и выключатель — касание не меньше 44 px", h3 >= 43.5 && swh >= 43.5, `${h3} · ${swh}`);
  await step(t, "fix15-auto-targets");
  await page.getByRole("tab", { name: /Маркетинг/ }).click();
  await finish(t);
}

/** Нулевая аудитория (решение владельца 02.11.2026): ни у одного клиента нет согласия на рекламу — тест любого из 28 текстов на свой номер
 *  всё равно уходит (это проверка текста), а сохранить, одобрить и запустить рассылку нельзя: честно «Реальная рассылка сейчас
 *  невозможна». Клиентам — ничего. Согласия снимаются для этой сессии (следующая, последняя, выдаёт свои). */
async function zeroAudience() {
  const t = await session({ key: dl.OWNER, c: "winchester", vp: PHONE, scheme: "light", tag: "zero-w-owner-390-light", own: [TEST_TO.replace(/\D/g, "")] });
  const { page } = t;
  // база клиентов есть (как у Winchester на боевом), а согласий на рекламу — ни у кого
  await subTab(page, "Клиенты");
  await tap(page.getByRole("button", { name: "Обновить базу" }));
  await page.getByText("Читаю журнал Altegio… до минуты").waitFor({ state: "detached", timeout: 90_000 });
  await dl.bot.S.env.DB.prepare("delete from consents where ws = 'winchester'").run();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await tap(page.getByRole("region", { name: "Канал рассылок" }).getByRole("button", { name: "Создать рассылку" }));
  const gw = gaDialog(page);
  await gw.waitFor();
  await gaAt(gw, "Аудитория");
  const segs = gw.getByRole("radiogroup", { name: "Сегмент" });
  const allR = segs.getByRole("radio", { name: /^Вся база/ });
  await tap(allR);
  ok(`${t.tag}: аудитория — клиенты есть, а «можно рекламу: 0»`, /можно рекламу: 0/.test((await allR.getAttribute("aria-label")) || ""), (await allR.getAttribute("aria-label")) || "");
  await gaNext(gw);
  await gaAt(gw, "Сообщение");
  const msgs = gw.getByRole("radiogroup", { name: "Сообщение" });
  await tap(msgs.getByRole("radio", { name: "Давно не виделись" }));
  await gaNext(gw);
  await gaAt(gw, "Предпросмотр");
  await gaNext(gw);
  await gaAt(gw, "Проверка");
  await gw.getByText(/Сообщение получат:/).waitFor({ timeout: 15000 });
  const ck = norm(await text(gw));
  ok(`${t.tag}: проверка — получат 0, причина и как получить согласия`, /Сообщение получат: 0/.test(ck) && /согласи/i.test(ck), ck.slice(0, 300));
  ok(`${t.tag}: «Далее» доступно — на «Тест» можно и при нулевой аудитории`, !(await gw.getByRole("button", { name: "Далее" }).isDisabled()));
  await step(t, "zero-check");
  await gaNext(gw);
  await gaAt(gw, "Тест");
  ok(`${t.tag}: на «Тесте» сказано, что это только проверка текста, а реальная рассылка сейчас невозможна`, /Это только проверка текста на вашем номере/.test(await text(gw)));
  const pin = gw.getByLabel("Номер для проверки");
  const send = gw.getByRole("button", { name: "Отправить тест" });
  await pin.or(send).first().waitFor({ timeout: 10000 });
  if (await pin.count()) {
    await fill(pin, TEST_TO);
    await tap(gw.getByRole("button", { name: "Сохранить" }));
  }
  await send.waitFor({ timeout: 10000 });
  const before = gaSent().length;
  await tap(send);
  await gw.getByRole("status").filter({ hasText: /отправлено на ваш номер/i }).waitFor({ timeout: 10000 }).catch(() => {});
  const out = gaSent().slice(before);
  ok(`${t.tag}: тест «Давно не виделись» ушёл один раз — только на номер владельца, с именем вымышленного клиента`, out.length === 1 && out[0].to === "77000009999" && /^Добрый день, Айгерим! 👋🏻\n\nДавно не виделись в Winchester!/.test(out[0].text), JSON.stringify(out.map((x) => [x.to, x.text.slice(0, 50)])));
  await step(t, "zero-test");
  await gaNext(gw);
  await gaAt(gw, "Сохранение и запуск");
  const fin = await text(gw);
  ok(
    `${t.tag}: «Сохранение и запуск» — «Реальная рассылка сейчас невозможна», тест — отдельно; ни «Сохранить черновик», ни «Одобрить», ни «Запустить»`,
    /Реальная рассылка сейчас невозможна/.test(fin) && /Тест на ваш номер уже отправлен — это только проверка текста, не рассылка/.test(fin) &&
      !(await gw.getByRole("button", { name: /^(Сохранить черновик|Одобрить|Запустить|Запланировать)/ }).count()),
    fin.slice(0, 400),
  );
  ok(`${t.tag}: клиентам не ушло ничего — после теста ни одного сообщения`, gaSent().length === before + 1);
  await step(t, "zero-save");
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
  await subTab(page, "Клиенты");
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
// ONLY=<регулярное выражение> — только эти сессии (для отладки одной сессии; сессии почти независимы)
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const run = async (name, f) => {
  if (ONLY && !ONLY.test(name)) return;
  console.log(`\n${name}`);
  try {
    await f();
  } catch (e) {
    crashed ||= name;
    // строка этого файла, где упало, — по стеку (Playwright кладёт в него место вызова)
    const at = String(e?.stack || "").match(/e2e-campaigns\.mjs:(\d+)/);
    ok(`${name}: прошло до конца`, false, String(e?.message || e).split("\n")[0] + (at ? ` (строка ${at[1]})` : ""));
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
  await run("Нулевая аудитория: тест любого из 28 текстов на свой номер", zeroAudience);
  await run("Находки проверки: люди сегмента, «Ещё» и отбор", fixesPaging);
} finally {
  await browser.close();
  await dl.close();
}

const bad = results.filter((r) => !r.ok);
console.log(`\nИтог: ${results.length - bad.length} из ${results.length} проверок прошли${bad.length ? `, не прошли ${bad.length}` : ""}. Снимки: ${OUT}`);
for (const b of bad) console.log(`  ✗ ${b.name}${b.info ? ` — ${b.info}` : ""}`);
process.exit(bad.length ? 1 : 0);
