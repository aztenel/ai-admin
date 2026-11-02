// Проверка раздела «Рассылки» → «Автоматические сообщения» нового пульта в настоящем браузере (Chromium через Playwright) на НАСТОЯЩЕМ
// коде бота с заглушками (scripts/dev-live.mjs: память вместо KV, база D1 на node:sqlite, заглушки Green-API, Altegio, Telegram). Сеть не
// нужна. Телефон iPhone: 390×844, isMobile, hasTouch, светлая и тёмная тема.
// Запуск: npm run e2e:automsg [папка для снимков]   (или node scripts/e2e-automsg.mjs <папка>)
// Playwright — PLAYWRIGHT_PATH или /opt/node-tools/node_modules/playwright/index.mjs; Chromium — /opt/pw-browsers/chromium (CHROMIUM меняет).
//
// Что проходит (задание владельца 02.11.2026):
//  · владелец Winchester: вкладка «Автоматические · сообщения» (прежнее «service» в памяти устройства открывает её же); две группы —
//    «Для записи (сервисные)» (6) и «Реклама (только с согласием)» (3); уходит ли — сверху; «Номер для проверки» — указать; сервисный
//    сценарий включить (с вопросом) и выключить; «Текст и время»: текст на русском и время — сохранить, пример «Так увидит клиент»
//    меняется при вводе; «Проверить на мой номер» — текст пришёл на номер владельца со второго номера (заглушка Green-API), обрыв связи
//    после отправки → «Повторить» с тем же номером нажатия: второй раз не ушло; «Журнал» — включено, выключено, изменено, проверка;
//    перезагрузка страницы — выключатели, текст, время и номер для проверки на месте (они на сервере); рекламный сценарий включить нельзя,
//    причина рядом; реактивация — сколько подходит сегодня и скольким можно рекламу;
//  · сотрудник Winchester: только смотреть — без выключателей, проверок и правки; номер для проверки — маской.
// На каждом шаге: нет полных номеров клиентов базы, нет ошибок в консоли, нет прокрутки вбок. Снимки — светлая и тёмная тема.
import { mkdirSync } from "node:fs";
import { startDevLive } from "./dev-live.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright/index.mjs");
const OUT = process.argv[2] || "/tmp/claude-0/-home-user/eacf866f-6d8c-5152-bdf5-ad49eed8555f/scratchpad/automsg-shots";
mkdirSync(OUT, { recursive: true });

const PHONE = { width: 390, height: 844 };
const FULL = /7700000\d{4}/g; // номера базы клиентов Winchester в заглушке (+7 700 000 xx xx)
const TEST = "+7 701 000 99 88"; // номер для проверки — номер «владельца», вымышленный, не из базы
const TEST_D = "77010009988";
const NEW_TEXT = "Напоминаем: завтра в {время} ждём вас в {компания}.[[ {услуга и мастер}.]] Возьмите хорошее настроение! Если планы изменились, напишите сюда.";

const results = [];
function ok(name, cond, info = "") {
  results.push({ name, ok: !!cond, info });
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}${!cond && info ? ` — ${info}` : ""}`);
  return !!cond;
}

const dl = await startDevLive({ port: 0 });
const { net } = await import(new URL("../../../test/harness.mjs", import.meta.url).href);
// процесс бота живёт по часам проверок (test/clock.mjs подменил Date): разница с настоящими — для часов браузера
const SHIFT = Date.now() - (performance.timeOrigin + performance.now());
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });

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
function iphoneSafeArea() {
  if (!location.pathname.startsWith("/app/")) return;
  document.addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style");
    s.textContent = ":root{--safe-t:47px;--safe-b:34px}";
    document.head.appendChild(s);
  });
}

/** Вход и «Рассылки». tab — что лежит в памяти устройства (pult2.campaigns.tab) до входа: «service» — прежняя вкладка «Сервисные». */
async function session({ key, scheme, tag, own = [], tab }) {
  const ctx = await browser.newContext({ viewport: PHONE, colorScheme: scheme, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU", timezoneId: "Asia/Almaty" });
  await ctx.addInitScript(shiftClock, SHIFT);
  await ctx.addInitScript(iphoneSafeArea);
  if (tab) await ctx.addInitScript((t) => { try { if (!localStorage.getItem("pult2.campaigns.tab")) localStorage.setItem("pult2.campaigns.tab", t); } catch {} }, tab);
  const page = await ctx.newPage();
  const t = { page, ctx, tag, n: 0, errs: [], logs: [], own: new Set(own), allow: [/\/api\/inbox\/me(\?|$)/, /\/favicon\.ico$/] };
  page.on("console", (m) => {
    t.logs.push(m.text());
    if (m.type() !== "error") return;
    const url = m.location()?.url || "";
    if (/Failed to load resource/.test(m.text()) && t.allow.some((r) => r.test(url))) return;
    t.errs.push(`${m.text()}${url ? ` @ ${url}` : ""}`);
  });
  page.on("pageerror", (e) => t.errs.push(`pageerror: ${e.message}`));
  await page.goto(`${dl.app}?c=winchester`);
  await page.waitForURL(/\/login/);
  await page.fill("input[name=key]", key);
  await page.click("button");
  await page.waitForURL(/\/app\//);
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Рассылки" }).click();
  await page.getByRole("heading", { name: "Рассылки" }).first().waitFor();
  return t;
}

async function step(t, name) {
  const { page } = t;
  await page.waitForTimeout(350);
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
/** Вся вкладка одним снимком (для глаз): высота — по содержимому прокрутки. */
async function fullShot(t, name) {
  const { page } = t;
  const h = await page.evaluate(() => {
    const sc = document.querySelector("main .scroll-area") || document.querySelector(".scroll-area");
    return sc ? sc.scrollHeight + 260 : 844;
  });
  await page.setViewportSize({ width: PHONE.width, height: Math.min(h, 7000) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${t.tag}-full-${name}.png` });
  await page.setViewportSize(PHONE);
  await page.waitForTimeout(200);
}
async function finish(t) {
  const store = await t.page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  ok(`${t.tag}: в хранилище браузера нет номеров`, !FULL.test(store) && !store.includes(TEST_D), store.slice(0, 200));
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
const card = (page, title) => page.getByRole("article", { name: title, exact: true });
const sent = () => net.ga.filter((x) => x.op === "sendMessage").map((x) => ({ to: String(x.body.chatId || "").replace("@c.us", ""), text: String(x.body.message || "") }));

/** Открыть вкладку «Автоматические» (если не открыта) и дождаться карточек. */
async function openAuto(page) {
  const tab = page.getByRole("tab", { name: /Автоматические/ });
  await tab.waitFor();
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await page.getByRole("heading", { name: "Для записи (сервисные)" }).waitFor({ timeout: 15000 });
}

// =====================================================================================================================
async function owner(scheme) {
  const t = await session({ key: dl.OWNER, scheme, tag: `auto-owner-390-${scheme}`, own: [TEST_D], tab: "service" });
  const { page } = t;
  // база клиентов из журнала Altegio (заглушка) — как «Обновить базу»: реактивации есть кого посчитать
  const built = await page.evaluate(() => fetch("/api/crm/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ c: "winchester" }) }).then((r) => r.status));
  ok("база клиентов собрана (заглушка журнала Altegio)", built === 200, String(built));
  await page.reload();
  await page.waitForLoadState("networkidle");
  const tabs = page.getByRole("tablist", { name: "Вид рассылок" });
  await tabs.waitFor();
  const names = (await tabs.getByRole("tab").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim());
  ok("вкладки: «Маркетинг · рассылки», «Автоматические · сообщения», «Календарь · план и итоги»", names.length === 3 && /Маркетинг/.test(names[0]) && /Автоматические/.test(names[1]) && /сообщения/.test(names[1]) && /Календарь/.test(names[2]), JSON.stringify(names));
  // прежнее «service» в памяти устройства — открывается новая вкладка
  ok("в памяти устройства «service» (прежние «Сервисные») — открыта вкладка «Автоматические»", (await page.getByRole("tab", { name: /Автоматические/ }).getAttribute("aria-selected")) === "true");
  // подписи вкладок не обрезаны на 390 px
  const cut = await tabs.evaluate((el) => [...el.querySelectorAll("[role=tab] span")].filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent));
  ok("подписи вкладок помещаются на телефоне", !cut.length, JSON.stringify(cut));
  await openAuto(page);

  // две группы: сервисные и реклама
  const arts = page.getByRole("article");
  ok("девять сценариев", (await arts.count()) === 9, String(await arts.count()));
  const svcSec = page.locator("section", { has: page.getByRole("heading", { name: "Для записи (сервисные)" }) });
  const mkSec = page.locator("section", { has: page.getByRole("heading", { name: "Реклама (только с согласием)" }) });
  ok("группа «Для записи (сервисные)»: 6 сценариев", (await svcSec.getByRole("article").count()) === 6);
  ok("группа «Реклама (только с согласием)»: 3 сценария, сказано про согласие", (await mkSec.getByRole("article").count()) === 3 && /подтверждённое согласие/.test(await text(mkSec)));
  const status = page.getByRole("region", { name: "Отправка клиентам" });
  ok("сверху: всё выключено — клиентам ничего не уходит", /Все сценарии выключены/.test(await text(status)), (await text(status)).slice(0, 300));
  ok("сверху: часы отправки и предел за сутки", /с 10:00 до 21:00/.test(await text(status)) && /Не больше в сутки/.test(await text(status)));
  ok("по умолчанию все выключатели выключены", (await page.getByRole("switch", { checked: true }).count()) === 0);
  await step(t, "auto-tab");
  await fullShot(t, "auto-tab");

  // номер для проверки
  await tap(page.getByRole("button", { name: /^Номер для проверки: не указан/ }));
  const ph = page.getByRole("dialog", { name: "Номер для проверки" });
  await ph.waitFor();
  await fill(ph.getByLabel("Ваш номер WhatsApp"), TEST);
  await step(t, "test-phone-sheet");
  await tap(ph.getByRole("button", { name: "Сохранить" }));
  await ph.waitFor({ state: "detached" });
  await page.getByRole("button", { name: new RegExp(`^Номер для проверки: \\${TEST}`) }).waitFor({ timeout: 10000 }).catch(() => {});
  ok("номер для проверки сохранён и виден", (await page.getByRole("button", { name: new RegExp(`^Номер для проверки: \\${TEST}`) }).count()) === 1);

  // сервисный сценарий: включить (вопрос) и выключить
  const r24 = card(page, "Напоминание за 24 часа");
  const sw24 = r24.getByRole("switch", { name: "Напоминание за 24 часа" });
  await tap(sw24);
  const ask = page.getByRole("dialog", { name: "Включить «Напоминание за 24 часа»?" });
  await ask.waitFor();
  ok("включить — сначала вопрос: уйдёт настоящим клиентам, текст одобряется", /настоящим клиентам/.test(await text(ask)) && /одобряете текст/.test(await text(ask)), await text(ask));
  await step(t, "confirm-on");
  await ask.getByRole("button", { name: "Включить" }).click();
  await page.waitForFunction(() => document.querySelector('article [role=switch][aria-label="Напоминание за 24 часа"][aria-checked="true"]'), null, { timeout: 10000 }).catch(() => {});
  ok("сценарий включён (с сервера)", (await sw24.getAttribute("aria-checked")) === "true");
  ok("включён и уходит: главный выключатель, номер и журнал Altegio в порядке", /Включено и уходит/.test(await text(r24)), await text(r24));
  await reveal(r24);
  await step(t, "remind24-on");
  await tap(sw24);
  await page.waitForFunction(() => document.querySelector('article [role=switch][aria-label="Напоминание за 24 часа"][aria-checked="false"]'), null, { timeout: 10000 }).catch(() => {});
  ok("выключить — сразу, без вопроса", (await sw24.getAttribute("aria-checked")) === "false" && !(await page.getByRole("dialog").count()));
  // ещё один сценарий — включить и оставить: после перезагрузки он должен остаться включённым
  const r3 = card(page, "Напоминание за 3 часа");
  await tap(r3.getByRole("switch", { name: "Напоминание за 3 часа" }));
  await page.getByRole("dialog", { name: "Включить «Напоминание за 3 часа»?" }).getByRole("button", { name: "Включить" }).click();
  await page.waitForFunction(() => document.querySelector('article [role=switch][aria-label="Напоминание за 3 часа"][aria-checked="true"]'), null, { timeout: 10000 }).catch(() => {});
  ok("«Напоминание за 3 часа» включено", (await r3.getByRole("switch").getAttribute("aria-checked")) === "true");
  ok("сверху: уходит 1 сценарий из 6, которые можно включить", /Уходят сами: 1 из 6/.test(await text(status)), (await text(status)).slice(0, 200));
  // ближайшие сообщения: в очереди только включённый сценарий (заглушка: записи через бота — напоминания в день визита)
  const upcoming = page.getByRole("list", { name: "Ближайшие сообщения" });
  await upcoming.waitFor({ timeout: 10000 }).catch(() => {});
  const up = await text(upcoming);
  ok("«Ближайшие сообщения»: только включённые — напоминания в день визита, номера маской", (await upcoming.locator("li").count()) > 0 && /Напоминание в день визита/.test(up) && !/Напоминание накануне|Просьба об отзыве/.test(up) && /\+7 700 \*\*\* \*\* \d\d/.test(up), up.slice(0, 300));

  // «Текст и время»: время накануне 19:30 и свой текст
  await tap(r24.getByRole("button", { name: "Текст и время" }));
  const ed = page.getByRole("dialog", { name: "Напоминание за 24 часа" });
  await ed.waitFor();
  const ru = ed.getByLabel("На русском");
  ok("редактор: текст на русском со вставками, кнопки вставок", /\{время\}/.test(await ru.inputValue()) && (await ed.getByRole("button", { name: "Время", exact: true }).count()) === 1 && (await ed.getByLabel("На казахском").count()) === 1);
  await tap(ed.getByRole("radio", { name: "Накануне в выбранное время" }));
  await ed.getByLabel("Время накануне").selectOption("19:30");
  await fill(ru, NEW_TEXT);
  const bubble = ed.locator("figure").first();
  await page.waitForTimeout(200);
  ok("пример «Так увидит клиент» меняется при вводе, вставки подставлены", /Возьмите хорошее настроение/.test(await text(bubble)) && /15:00/.test(await text(bubble)) && /Winchester/.test(await text(bubble)) && !/[{}[\]]/.test(await text(bubble)), await text(bubble));
  await step(t, "edit-sheet");
  await tap(ed.getByRole("button", { name: "Сохранить" }));
  await ed.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  ok("сохранено, лист закрыт", !(await ed.count()), (await text(ed.getByRole("alert"))).slice(0, 200));
  await page.waitForFunction(() => /Накануне визита в 19:30/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
  ok("на карточке — новое время: «Накануне визита в 19:30»", /Накануне визита в 19:30/.test(await text(r24)), await text(r24));
  // ошибка сервера словами: время вне часов отправки
  await tap(r3.getByRole("button", { name: "Текст и время" }));
  const ed3 = page.getByRole("dialog", { name: "Напоминание за 3 часа" });
  await ed3.waitFor();
  await ed3.getByLabel("За сколько часов до визита").selectOption("2");
  await tap(ed3.getByRole("button", { name: "Сохранить" }));
  await ed3.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => /За 2 ч до визита/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
  ok("«Напоминание за 3 часа»: время — за 2 часа", /За 2 ч до визита/.test(await text(r3)), await text(r3));

  // проверка на мой номер: обрыв связи после отправки → «Повторить» с тем же номером нажатия, второй раз не уходит
  const before = sent().length;
  await tap(r24.getByRole("button", { name: "Проверить на мой номер" }));
  const ts = page.getByRole("dialog", { name: "Проверка: Напоминание за 24 часа" });
  await ts.waitFor();
  ok("проверка: куда — номер для проверки, со второго номера", (await text(ts)).includes(TEST) && /второй/.test(await text(ts)));
  await step(t, "test-sheet");
  let rids = [];
  await page.route(/\/api\/msg\/test$/, async (route) => {
    rids.push(JSON.parse(route.request().postData() || "{}").rid);
    await route.fetch(); // запрос дошёл до сервера (сообщение ушло), ответ потерялся
    await route.abort("failed");
  }, { times: 1 });
  t.allow.push(/\/api\/msg\/test$/);
  await tap(ts.getByRole("button", { name: "Отправить проверку" }));
  await ts.getByRole("button", { name: "Повторить" }).waitFor({ timeout: 10000 });
  ok("обрыв связи: «Повторить», ошибка словами", /Нет связи/.test(await text(ts)), (await text(ts)).slice(0, 300));
  page.on("request", (r) => {
    if (/\/api\/msg\/test$/.test(r.url())) rids.push(JSON.parse(r.postData() || "{}").rid);
  });
  await tap(ts.getByRole("button", { name: "Повторить" }));
  await ts.getByRole("status").filter({ hasText: /уже отправлена|Отправлено/ }).waitFor({ timeout: 10000 }).catch(() => {});
  const got = sent().slice(before);
  ok("повтор — с тем же номером нажатия (rid)", rids.length === 2 && rids[0] && rids[0] === rids[1], JSON.stringify(rids));
  ok("на номер владельца ушло ровно одно сообщение, со вставками и новым текстом", got.length === 1 && got[0].to === TEST_D && /Возьмите хорошее настроение/.test(got[0].text) && /завтра в 15:00 ждём вас в Winchester/.test(got[0].text), JSON.stringify(got));
  ok("ответ: «уже отправлена», текст — в листе", /уже отправлена/.test(await text(ts)) && /Возьмите хорошее настроение/.test(await text(ts.locator("figure").first())), (await text(ts)).slice(0, 300));
  t.allow.pop();
  // новое нажатие — новый номер, ещё одно сообщение
  await tap(ts.getByRole("button", { name: "Отправить ещё раз" }));
  await ts.getByRole("status").filter({ hasText: /^Отправлено на/ }).waitFor({ timeout: 10000 }).catch(() => {});
  ok("новое нажатие — новый rid и ещё одно сообщение", sent().length - before === 2 && rids.length === 3 && rids[2] !== rids[0], `${sent().length - before} · ${JSON.stringify(rids)}`);
  await step(t, "test-sent");
  await ts.getByRole("button", { name: "Закрыть" }).first().click();
  await ts.waitFor({ state: "detached" });

  // журнал сценария
  await page.waitForTimeout(500);
  await tap(r24.getByRole("button", { name: /^Журнал/ }));
  const lg = page.getByRole("dialog", { name: "Журнал: Напоминание за 24 часа" });
  await lg.waitFor();
  const lt = await text(lg);
  ok("журнал: включено, выключено, изменено (время и текст), проверка", /включено/.test(lt) && /выключено/.test(lt) && /изменено/.test(lt) && /время: Накануне визита в 19:30/.test(lt) && /текст сообщения/.test(lt) && /проверка/.test(lt), lt.slice(0, 600));
  ok("журнал: номер для проверки — маской", /\+7 701 \*\*\* \*\* 88/.test(lt) && !lt.includes(TEST_D));
  await step(t, "journal");
  await page.keyboard.press("Escape");
  await lg.waitFor({ state: "detached" });

  // рекламный сценарий: включить нельзя, причина рядом
  const bd = card(page, "Поздравление с днём рождения");
  const bdSw = bd.getByRole("switch", { name: "Поздравление с днём рождения" });
  await reveal(bd);
  ok("реклама: выключатель недоступен", await bdSw.isDisabled());
  const desc = await bdSw.evaluate((el) => document.getElementById(el.getAttribute("aria-describedby") || "")?.textContent || "");
  ok("реклама: причина рядом с выключателем", /Включить нельзя: реклама со второго номера выключена/.test(desc), desc);
  ok("реклама: над группой — почему выключена целиком", /массовые сообщения с обычного WhatsApp/.test(await text(mkSec)));
  const ra = card(page, "Реактивация клиентов");
  ok("реактивация: сколько подходит сегодня и скольким можно рекламу", /Сегодня подходят: \d+/.test(await text(ra)) && /можно рекламу: \d+/.test(await text(ra)), (await text(ra)).slice(0, 300));
  const camp = card(page, "Маркетинговые кампании");
  ok("кампании: без выключателя, «Открыть «Маркетинг»»", !(await camp.getByRole("switch").count()) && (await camp.getByRole("button", { name: "Открыть «Маркетинг»" }).count()) === 1);
  await reveal(mkSec.getByRole("heading", { name: "Реклама (только с согласием)" }));
  await step(t, "marketing");
  // «Кто сегодня» у дня рождения — Altegio (заглушка) отвечает или нет: так или иначе — словами
  await tap(bd.getByRole("button", { name: "Кто сегодня" }));
  const who = bd.getByRole("status").or(bd.getByRole("alert")).first();
  await who.waitFor({ timeout: 15000 }).catch(() => {});
  ok("день рождения: «Кто сегодня» — ответ словами", /день рождения|Altegio|ответил|минуту/i.test(await text(who)), await text(who));

  // перезагрузка: всё с сервера
  await page.reload();
  await page.waitForLoadState("networkidle");
  await openAuto(page);
  const r24b = card(page, "Напоминание за 24 часа"), r3b = card(page, "Напоминание за 3 часа");
  ok("после перезагрузки: «за 24 часа» выключено, «за 3 часа» включено", (await r24b.getByRole("switch").getAttribute("aria-checked")) === "false" && (await r3b.getByRole("switch").getAttribute("aria-checked")) === "true");
  ok("после перезагрузки: время на месте", /Накануне визита в 19:30/.test(await text(r24b)) && /За 2 ч до визита/.test(await text(r3b)));
  ok("после перезагрузки: номер для проверки на месте", (await page.getByRole("button", { name: new RegExp(`^Номер для проверки: \\${TEST}`) }).count()) === 1);
  await tap(r24b.getByRole("button", { name: "Текст и время" }));
  const ed2 = page.getByRole("dialog", { name: "Напоминание за 24 часа" });
  await ed2.waitFor();
  ok("после перезагрузки: свой текст на месте", (await ed2.getByLabel("На русском").inputValue()) === NEW_TEXT && (await ed2.getByRole("radio", { name: "Накануне в выбранное время" }).isChecked()) && (await ed2.getByLabel("Время накануне").inputValue()) === "19:30");
  await ed2.getByRole("button", { name: "Отмена" }).click();
  await ed2.waitFor({ state: "detached" });
  await step(t, "after-reload");
  await fullShot(t, "after-changes");
  await finish(t);
}

// =====================================================================================================================
async function staff(scheme) {
  const t = await session({ key: dl.STAFF_W, scheme, tag: `auto-staff-390-${scheme}` });
  const { page } = t;
  await openAuto(page);
  ok(`${t.tag}: нет выключателей`, !(await page.getByRole("switch").count()));
  ok(`${t.tag}: нет «Проверить на мой номер» и правки настроек`, !(await page.getByRole("button", { name: /Проверить на мой номер|Изменить/ }).count()) && !(await page.getByRole("button", { name: /Проверить по журналу/ }).count()));
  const r3 = card(page, "Напоминание за 3 часа");
  ok(`${t.tag}: состояние словами — «за 3 часа» включено`, /включено/.test(await text(r3)), await text(r3));
  const status = page.getByRole("region", { name: "Отправка клиентам" });
  ok(`${t.tag}: номер для проверки — маской`, /\+7 701 \*\*\* \*\* 88/.test(await text(status)) && !(await text(status)).includes(TEST), (await text(status)).slice(0, 300));
  ok(`${t.tag}: менять может только владелец — сказано`, /только владелец/.test(await text(status)));
  await step(t, "staff-tab");
  await fullShot(t, "staff");
  await tap(card(page, "Напоминание за 24 часа").getByRole("button", { name: "Текст и время" }));
  const ed = page.getByRole("dialog", { name: "Напоминание за 24 часа" });
  await ed.waitFor();
  ok(`${t.tag}: «Текст и время» — только смотреть: без полей и «Сохранить», пример текста виден`, !(await ed.getByRole("textbox").count()) && !(await ed.getByRole("button", { name: "Сохранить" }).count()) && /Возьмите хорошее настроение/.test(await text(ed.locator("figure").first())));
  await step(t, "staff-text");
  await page.keyboard.press("Escape");
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
  await run("Владелец Winchester · iPhone 390×844, светлая", () => owner("light"));
  await run("Сотрудник Winchester · iPhone 390×844, тёмная", () => staff("dark"));
  await run("Сотрудник Winchester · iPhone 390×844, светлая", () => staff("light"));
  await run("Владелец Winchester · iPhone 390×844, тёмная (снимки)", async () => {
    const t = await session({ key: dl.OWNER, scheme: "dark", tag: "auto-owner-390-dark", own: [TEST_D], tab: "auto" });
    await openAuto(t.page);
    await step(t, "auto-tab");
    await fullShot(t, "auto-tab");
    await tap(card(t.page, "Напоминание за 24 часа").getByRole("button", { name: "Текст и время" }));
    await t.page.getByRole("dialog", { name: "Напоминание за 24 часа" }).waitFor();
    await step(t, "edit-sheet");
    await t.page.keyboard.press("Escape");
    await finish(t);
  });
} finally {
  await browser.close();
  await dl.close();
}

const bad = results.filter((r) => !r.ok);
console.log(`\nИтог: ${results.length - bad.length} из ${results.length} проверок прошли${bad.length ? `, не прошли ${bad.length}` : ""}. Снимки: ${OUT}`);
for (const b of bad) console.log(`  ✗ ${b.name}${b.info ? ` — ${b.info}` : ""}`);
process.exit(bad.length ? 1 : 0);
