// Проверка приложения в браузере на размере iPhone 14 Pro: node test/e2e.mjs [папка для снимков]
// Нужен запущенный локальный сервер: node test/devserver.mjs 8799
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");
const out = process.argv[2] || "", URL0 = process.env.CRM_URL || "http://127.0.0.1:8799";
let ok = 0, bad = 0;
const check = (name, cond, extra = "") => { if (cond) ok++; else { bad++; console.log("НЕ ПРОШЛО:", name, extra); } };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", e => errs.push(String(e))); p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
await p.goto(URL0);
await p.waitForSelector("#login:not([hidden])");
check("без входа — экран входа", await p.isHidden("#app"));
await p.fill("#loginKey", "wrong-key-000000"); await p.click("#loginForm button");
await p.waitForFunction(() => document.getElementById("loginErr").textContent.length > 0);
check("неверный ключ — понятный отказ", /не подош/i.test(await p.textContent("#loginErr")));
await p.fill("#loginKey", "dev-key-123456"); await p.click("#loginForm button");
await p.waitForSelector("#app:not([hidden])");
check("пустая база — подсказка про «+»", /Нажмите «\+»/.test(await p.textContent("#view")));

// новый лид: оценка считается на лету
await p.click("#fab");
check("без данных — «мало данных»", /Мало данных/.test(await p.textContent("#scoreBox")));
await p.fill("#dName", "Барбершоп Тигр"); await p.fill("#dPhone", "8 701 111 22 33"); await p.fill("#dCity", "Астана"); await p.fill("#dNiche", "Барбершоп");
await p.fill("#dReviews", "380"); await p.fill("#dRating", "4,9"); await p.fill("#dMasters", "6"); await p.fill("#dIg", "12000");
await p.click('[data-seg="ig_alive"][data-v="1"]'); await p.click('[data-seg="impression"][data-v="3"]');
check("сильный лид — оценка A, 95", /Оценка 95 из 100/.test(await p.textContent("#scoreBox")) && (await p.textContent("#scoreBox .gr")) === "A");
await p.fill("#dInsta", "@tigr.barber");
await p.click("#nSaveMore");
await p.waitForFunction(() => document.getElementById("dName") && document.getElementById("dName").value === "");
check("«сохранить и ещё» — форма пустая, город и ниша остались", (await p.inputValue("#dCity")) === "Астана" && (await p.inputValue("#dNiche")) === "Барбершоп");
await p.fill("#dName", "Слабый салон"); await p.fill("#dPhone", "+7 701 111 22 33"); await p.click("#nSave");
await p.waitForFunction(() => /уже есть/.test(document.getElementById("toast").textContent));
check("повтор номера — предупреждение", true);
await p.fill("#dPhone", "+7 705 000 00 01"); await p.fill("#dReviews", "12"); await p.fill("#dMasters", "1"); await p.click('[data-seg="impression"][data-v="1"]');
await p.click("#nSave");
await p.waitForSelector("#sheet", { state: "hidden" });
await p.waitForFunction(() => document.querySelectorAll(".lead").length === 2);
const names = await p.$$eval(".lead .nm", a => a.map(x => x.textContent));
check("«Новые — звонить»: сильный выше слабого", names[0] === "Барбершоп Тигр" && names[1] === "Слабый салон", JSON.stringify(names));
check("кнопка звонка набирает +7", (await p.getAttribute(".lead .call", "href")) === "tel:+77011112233");

// итог звонка: встреча на сегодня
await p.click(".lead [data-touch]");
await p.waitForSelector("#tSave");
await p.click('[data-res="meet"]');
check("встреча — появилось поле времени", await p.isVisible("#tMeet"));
await p.click("#tSave");
await p.waitForFunction(() => /время встречи/i.test(document.getElementById("toast").textContent));
check("встреча без времени не сохраняется", await p.isVisible("#tSave"));
const soon = new Date(Date.now() + 5 * 60e3); soon.setMinutes(soon.getMinutes() - soon.getTimezoneOffset());
const today = soon.toISOString().slice(0, 10) === new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
await p.fill("#tMeet", soon.toISOString().slice(0, 16)); await p.fill("#tNote", "Владелец Ерлан, ждёт"); await p.click("#tSave");
await p.waitForSelector("#sheet", { state: "hidden" });
await p.waitForFunction(() => document.querySelector("#stats .st b").textContent === "1");
const stats = await p.$$eval("#stats .st b", a => a.map(x => x.textContent));
check("счётчики дня: 1 звонок, 1 ЛПР, 1 встреча", stats.slice(0, 3).join() === "1,1,1", stats.join());
if (today) check("встреча видна в «Встречи сегодня»", /Барбершоп Тигр/.test(await p.textContent("#view .list")) && (await p.textContent("#bToday")) === "1");
if (out) await p.screenshot({ path: out + "/crm-today.png" });

// лиды: поиск по-русски и фильтр
await p.click('nav [data-tab="leads"]');
await p.waitForSelector("#q");
await p.fill("#q", "тигр");
await p.waitForFunction(() => document.querySelectorAll(".lead").length === 1);
check("поиск «тигр» находит «Барбершоп Тигр»", /Тигр/.test(await p.textContent(".lead .nm")));
await p.fill("#q", ""); await p.waitForFunction(() => document.querySelectorAll(".lead").length === 2);
await p.click('[data-grade="C"]');
await p.waitForFunction(() => document.querySelectorAll(".lead").length === 1);
check("фильтр «C» — только слабый", /Слабый/.test(await p.textContent(".lead .nm")));
await p.click('[data-grade="all"]');
await p.waitForFunction(() => document.querySelectorAll(".lead").length === 2);

// карточка: правка данных и этап вручную
await p.click('.lead:has-text("Слабый") [data-open]');
await p.waitForSelector("details.blk");
await p.click("details.blk summary"); await p.fill("#dLpr", "Айдос"); await p.click("#dSave");
await p.waitForFunction(() => /Айдос/.test(document.getElementById("sheet").textContent) && !!document.getElementById("tSave"));
await p.click('[data-setst="bad"]');
await p.waitForFunction(() => document.querySelector('[data-setst="bad"]') && document.querySelector('[data-setst="bad"]').getAttribute("aria-pressed") === "true");
check("этап вручную записан в историю", /Этап изменён вручную/.test(await p.textContent("#sheet .hist")));
await p.click("[data-close]");

// воронка и скрипт
await p.click('nav [data-tab="funnel"]');
await p.waitForSelector(".frow");
const w = await p.$eval('.frow[data-goto="meet"] .bar i', e => e.style.width);
check("воронка: полоска этапа нарисована", w === "100%", w);
check("воронка: конверсия посчитана", /Звонков: 1/.test(await p.textContent("#view")));
check("выгрузка CSV — ссылка есть", (await p.getAttribute('a[href="/api/export.csv"]', "href")) !== null);
if (out) await p.screenshot({ path: out + "/crm-funnel.png", fullPage: true });
await p.fill("#meName", "Тест");
await p.click('nav [data-tab="script"]');
check("скрипт: имя подставлено", /Меня зовут Тест/.test(await p.textContent("#view")));
await p.click('.sc details:has-text("калькулятор") summary'); await p.fill("#cPack", "340000");
check("калькулятор окупаемости", /вернуть 49 клиентов/.test(await p.textContent("#cOut")));

// выход
await p.click('nav [data-tab="funnel"]'); await p.waitForSelector("#logout"); await p.click("#logout");
await p.waitForSelector("#login:not([hidden])");
check("после выхода данные закрыты", (await p.evaluate(() => fetch("/api/leads").then(r => r.status))) === 401);
check("ошибок в консоли и нарушений политики безопасности нет", errs.filter(e => !/401|403|409|400/.test(e)).length === 0, errs.join(" | "));

// горизонтальной прокрутки нет
check("страница не шире экрана", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await b.close();
console.log(`Браузер: прошло ${ok}, не прошло ${bad}`);
process.exit(bad ? 1 : 0);
