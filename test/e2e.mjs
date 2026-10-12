// Проверка страниц в настоящем браузере (Chromium через Playwright) на локальном сервере с заглушками.
// В npm test не входит: нужен установленный Playwright. Запуск: node test/e2e.mjs [папка для снимков экрана]
// Путь к Playwright: переменная PLAYWRIGHT_PATH или /opt/npm-tools/node_modules/playwright/index.mjs
import { start, OWNER } from "./devserver.mjs";
import { net, T, ok } from "./harness.mjs";
import { mkdirSync } from "node:fs";

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || "/opt/npm-tools/node_modules/playwright/index.mjs");
const shots = process.argv[2] || "";
if (shots) mkdirSync(shots, { recursive: true });
const { S, server, url } = await start(0);
const browser = await chromium.launch();
const errors = [];
const newPage = async (viewport = { width: 390, height: 844 }, opts = {}) => {
  const ctx = await browser.newContext({ viewport, locale: "ru-RU", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  page.on("dialog", d => d.accept(d.type() === "prompt" ? "kairat" : undefined));
  return page;
};
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false }); };
const wa = (b) => fetch(url + "/_wa", { method: "POST", body: JSON.stringify(b) }).then(r => r.json());
const realFetch = globalThis.fetch; // harness подменил fetch: запросы к локальному серверу пропускаем настоящим
{
  const stub = globalThis.fetch, http = await import("node:http");
  globalThis.fetch = (u, init) => String(u).startsWith(url) ? new Promise((resolve, reject) => {
    const q = http.request(String(u), { method: (init && init.method) || "GET", headers: (init && init.headers) || {} }, res => { const ch = []; res.on("data", c => ch.push(c)); res.on("end", () => resolve(new Response(Buffer.concat(ch), { status: res.statusCode }))); });
    q.on("error", reject); if (init && init.body) q.write(init.body); q.end();
  }) : stub(u, init);
}

try {
  // ---- вход владельца и страница «Мои боты»
  const p = await newPage();
  await p.goto(url + "/studio");
  ok("без входа открывается страница входа", /\/login/.test(p.url()) && await p.locator("input[name=key]").isVisible());
  await p.fill("input[name=key]", "неверный"); await p.click("button");
  ok("неверный ключ — сообщение об ошибке", await p.locator("text=Ключ не подошёл").isVisible());
  await p.fill("input[name=key]", OWNER); await p.click("button");
  await p.waitForSelector("text=Боты клиентов");
  ok("после входа — «Мои боты», ключа в адресе нет", p.url().endsWith("/studio"));
  ok("демо-боты перечислены", await p.locator(".card").count() >= 7);
  await shot(p, "01-studio-list");

  // ---- новый бот: ошибки, проверка, сохранение
  await p.click("text=+ Новый бот");
  await p.fill("#f_id", "kairat"); await p.fill("#f_name", "Barber House");
  await p.selectOption("#f_booking", "manual");
  await p.fill("#f_schedule", "как получится"); await p.fill("#f_services", "Стрижка — 50");
  await p.click("#b_check");
  await p.waitForSelector(".msg.e");
  const errText = await p.locator(".msg.e").innerText();
  ok("ошибки паспорта показаны простыми словами", /Нужно исправить/.test(errText) && /график/.test(errText) && /цена 50/.test(errText), errText);
  await shot(p, "02-studio-errors");
  await p.fill("#f_address", "Астана, пр. Мангилик Ел, 10"); await p.fill("#f_phone", "8 701 123 45 67");
  await p.fill("#f_schedule", "Пн–Сб 10:00–21:00; Вс 11:00–19:00");
  await p.fill("#f_services", "Мужская стрижка — 6000 — 60\nСтрижка + борода — 9000 — 90\nОформление бороды от 4000\nДетская стрижка — 4000 — 45");
  await p.fill("#f_staff", "Арман — топ-барбер\nЕрлан — барбер"); await p.fill("#f_extra", "Оплата: наличные и Kaspi.\nПарковка бесплатная.");
  await p.click("#b_check");
  await p.waitForSelector(".msg.g");
  const prev = await p.locator("#out").innerText();
  ok("проверка без ошибок показывает, что бот будет знать", /Ошибок нет/.test(prev) && /Мужская стрижка — 6 000 ₸/.test(prev) && /\+7 701 123 45 67/.test(prev) && /Пн–Сб 10:00–21:00/.test(prev), prev.slice(0, 400));
  await shot(p, "03-studio-check");
  await p.click("#b_save");
  await p.waitForSelector("text=Сохранено");
  ok("бот сохранён", !!S.kv.json("cfg:all").kairat);
  await p.click("#b_key");
  await p.waitForSelector("#keyout pre");
  const staffKey = (await p.locator("#keyout pre").innerText()).trim();
  ok("ключ сотрудника показан", /^[a-z2-9-]{17}$/.test(staffKey), staffKey);
  await shot(p, "04-studio-key");
  await p.click("#b_back");
  await p.waitForSelector("text=Barber House");
  const card = await p.locator(".card", { hasText: "Barber House" }).innerText();
  ok("в списке — новый бот с отметками", /заявки администратору/.test(card) && /ключ сотрудника выдан/.test(card), card);
  await shot(p, "05-studio-list-with-bot");

  // ---- веб-чат бота из паспорта
  const c = await newPage();
  await c.goto(url + "/?c=kairat");
  await c.waitForSelector("text=Barber House");
  await c.fill("#in", "Сколько стоит стрижка?"); await c.keyboard.press("Enter");
  await c.waitForSelector("text=6 000 ₸");
  await c.fill("#in", "Тимур, +7 705 111 22 33, завтра в 12:00"); await c.keyboard.press("Enter");
  await c.waitForSelector("text=Забронировала вас");
  ok("веб-чат бота из паспорта: цена из паспорта, заявка создана", S.leads("kairat").length === 1 && S.leads("kairat")[0].phone === "+77051112233");
  await shot(c, "06-webchat");

  // ---- пульт чатов глазами сотрудника
  await wa({ c: "kairat", from: "77051110001", name: "Данияр", text: "Здравствуйте! Сколько стоит стрижка?" });
  await wa({ c: "kairat", from: "77051110001", name: "Данияр", text: "Позовите администратора" });
  await wa({ c: "kairat", from: "77051110002", name: "Айгерим", text: "Добрый день" });
  await wa({ c: "kairat", from: "77051110001", name: "Данияр", media: "MEDIA1" });
  const st = await newPage({ width: 390, height: 844 });
  await st.goto(url + "/inbox?c=kairat#wa:77051110001");
  await st.fill("input[name=key]", staffKey); await st.click("button");
  await st.waitForSelector("#msgs .m");
  ok("сотрудник после входа попадает сразу в чат из ссылки", /#wa:77051110001$/.test(st.url()) && /Данияр/.test(await st.locator("#cname").innerText()));
  const stateText = await st.locator("#cst").innerText();
  ok("в шапке чата — состояние бота, а кнопка «Позвонить» ведёт на номер клиента", /Пауза до/.test(stateText) && (await st.locator("#call").getAttribute("href")) === "tel:+77051110001", stateText + " " + await st.locator("#call").getAttribute("href"));
  ok("в чате видны сообщения клиента, ответ бота и голосовое с проигрывателем", await st.locator("#msgs .m.in").count() >= 3 && await st.locator("#msgs .m.bot").count() >= 1 && await st.locator("#msgs audio").count() === 1);
  await shot(st, "07-inbox-chat");
  await st.fill("#txt", "Здравствуйте, Данияр! Это администратор, чем помочь?"); await st.click("#send");
  await st.waitForSelector("#msgs .m.adm:not(.pend)");
  ok("ответ администратора появился в чате и ушёл клиенту", /Это администратор/.test(await st.locator("#msgs .m.adm").last().innerText()) && S.sentTo("77051110001").some(x => /Это администратор/.test(x)));
  await shot(st, "08-inbox-replied");
  await st.click(".strip >> text=Вернуть бота");
  await st.waitForFunction(() => /Ведёт бот/.test(document.getElementById("cst").textContent));
  ok("«Вернуть бота» — состояние сменилось на «Ведёт бот»", true);
  await st.click("#back");
  await st.waitForSelector("#rows a.row, #rows .empty");
  await st.click(".chip:text-is('Все')");
  await st.waitForFunction(() => document.querySelectorAll("#rows a.row").length >= 2);
  const listText = await st.locator("#rows").innerText();
  ok("список чатов: оба клиента, имена из WhatsApp, начало последнего сообщения", /Данияр/.test(listText) && /Айгерим/.test(listText) && /Добрый день|Здравствуйте/.test(listText), listText.slice(0, 300));
  await shot(st, "09-inbox-list");
  await st.goto(url + "/studio");
  ok("сотрудника со страницы владельца уводит в его пульт", /\/inbox\?c=kairat/.test(st.url()));

  // ---- клиент с Altegio: просьба об отмене → «Сделано» в пульте (широкий экран)
  await p.evaluate(async () => { await fetch("/api/studio/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "salon", isNew: true, name: "Салон Айгерим", niche: "beauty", address: "Алматы, ул. Абая, 1", phone: "+7 727 000 00 01", schedule: "ежедневно 9–21", booking: "altegio", altegioLoc: "5001" }) }); });
  await wa({ c: "salon", from: "77071110001", name: "Айша", text: "Айша, мужская стрижка завтра в 10:00" });
  await wa({ c: "salon", from: "77071110001", name: "Айша", text: "Не смогу прийти, отмените запись" });
  ok("запись в Altegio создана, отмена не выполнена ботом", net.altRecords.length === 1 && net.altDeleted.length === 0);
  const w = await newPage({ width: 1200, height: 800 });
  await w.goto(url + "/inbox?c=salon&key=" + OWNER);
  await w.waitForSelector("#rows a.row");
  ok("вход по ссылке с ключом: ключ из адреса убран", !w.url().includes("key="));
  await w.click("#rows a.row");
  await w.waitForSelector(".rq");
  const rqText = await w.locator(".rq").first().innerText();
  ok("карточка просьбы: что просит клиент, номер записи, его слова", /Клиент просит отменить запись/.test(rqText) && /№ 777001/.test(rqText) && /Не смогу прийти/.test(rqText), rqText);
  await shot(w, "10-inbox-request-wide");
  await w.click(".rq >> text=Сделано");
  await w.waitForSelector(".rq textarea");
  ok("подготовлен текст для клиента", /Вашу запись отменили/.test(await w.locator(".rq textarea").inputValue()));
  await w.click("text=Отправить клиенту и закрыть");
  await w.waitForFunction(() => !document.querySelector(".rq"));
  ok("«Сделано»: клиенту ушло сообщение, карточка закрыта, заявка помечена", S.sentTo("77071110001").some(x => /Вашу запись отменили/.test(x)) && S.leads("salon").some(l => l.kind === "cancel" && l.status === "выполнена"));
  await shot(w, "11-inbox-done-wide");
  await w.click("#nav a[data-v=more]");
  ok("владелец видит в разделе «Ещё» ссылку «Боты и сотрудники»", await w.locator("#v-more >> text=Боты и сотрудники").isVisible());

  // ---- рассылка глазами сотрудника: список, проверка, пробная отправка, запуск, итог
  S.env.WA_TOKEN_KAIRAT = S.env.WA_TOKEN_KAIRAT || "tok-kairat"; S.env.PHONE_NUMBER_ID_KAIRAT = "900111";
  net.graphReply = u => u.includes("?fields=") ? new Response(JSON.stringify({ display_phone_number: "+7 700 111 22 33", verified_name: "Barber House", quality_rating: "GREEN", whatsapp_business_manager_messaging_limit: "TIER_250" }), { status: 200 }) : null;
  await st.goto(url + "/broadcast?c=kairat");
  await st.waitForSelector("#info .msg");
  const infoText = await st.locator("#info").innerText();
  ok("страница рассылок: номер, качество и предел Meta", /\+7 700 111 22 33/.test(infoText) && /качество: высокое/.test(infoText) && /250 получателей за 24 часа/.test(infoText), infoText);
  await st.click("#b_new");
  ok("предел подставлен из Meta с запасом", (await st.locator("#f_cap").inputValue()) === "237");
  await st.fill("#f_name", "Октябрь: скидка"); await st.fill("#f_tpl", "promo_october");
  await st.fill("#f_text", "Здравствуйте, {{1}}! В октябре стрижка 5 000 ₸. Чтобы не получать сообщения, ответьте СТОП"); await st.fill("#f_params", "{имя}");
  await st.fill("#f_rec", "8 705 111 00 01, Данияр\n+7 705 111 00 02\tАйгерим\n87051110001, повтор\nне номер\n8 705 111 00 03; не записывать");
  await st.click("#b_chk");
  await st.waitForSelector("#fout .msg");
  const chkText = await st.locator("#fout").innerText();
  ok("проверка списка: номера, имена, повторы и непонятные строки", /Номеров: 3/.test(chkText) && /с именем: 2/.test(chkText) && /повторов убрано: 1/.test(chkText) && /Не понял строк: 1/.test(chkText) && /Подстановки для первого клиента: Данияр/.test(chkText), chkText);
  await shot(st, "14-broadcast-check");
  await st.fill("#f_to1", "8 705 999 00 00"); await st.click("#b_test");
  await st.waitForSelector("#tout .msg");
  ok("пробная отправка себе", /Шаблон отправлен на \+77059990000/.test(await st.locator("#tout").innerText()) && S.sentTo("77059990000").includes("[шаблон promo_october]"));
  await st.click("#b_make");
  await st.waitForSelector("#fout .msg.e");
  ok("без галочки согласия рассылка не создаётся", /клиенты компании/.test(await st.locator("#fout").innerText()));
  await st.check("#f_ok"); await st.click("#b_make");
  await st.waitForSelector("#list .card");
  ok("рассылка создана и готова к запуску", /готова к запуску/.test(await st.locator("#list .card").first().innerText()));
  // «Запустить» спрашивает подтверждение: отказ — рассылка не стартует
  const asked = []; st.removeAllListeners("dialog"); st.once("dialog", d => { asked.push(d.message()); d.dismiss(); });
  await st.click("#list .card >> text=Запустить"); await st.waitForTimeout(400);
  ok("«Запустить»: перед стартом вопрос, при отказе рассылка не идёт", asked.length === 1 && /Запустить рассылку «Октябрь: скидка»/.test(asked[0]) && /3 человек/.test(asked[0]) && /готова к запуску/.test(await st.locator("#list .card").first().innerText()), JSON.stringify(asked));
  st.on("dialog", d => d.accept(d.type() === "prompt" ? "kairat" : undefined));
  await st.click("#list .card >> text=Запустить");
  await st.waitForFunction(() => /идёт/.test(document.querySelector("#list .card").textContent));
  await shot(st, "15-broadcast-running");
  await fetch(url + "/_cron", { method: "POST" });
  await st.waitForFunction(() => /завершена/.test(document.querySelector("#list .card").textContent), null, { timeout: 15000 });
  const doneText = await st.locator("#list .card").first().innerText();
  ok("фоновая отправка: все получили шаблон, страница сама показала итог", /отправлено 3 из 3/.test(doneText) && ["77051110001", "77051110002", "77051110003"].every(x => S.sentTo(x).includes("[шаблон promo_october]")), doneText);
  await shot(st, "16-broadcast-done");
  await st.route("**/api/bc/list*", r => r.abort());
  await st.evaluate(() => load());
  await st.waitForFunction(() => /Нет связи/.test(document.getElementById("info").textContent), null, { timeout: 5000 }).catch(() => {});
  ok("страница рассылок при сбое запроса пишет об этом, а не молчит", /Нет связи/.test(await st.locator("#info").innerText()));
  await st.unroute("**/api/bc/list*");
  await wa({ c: "kairat", from: "77051110002", name: "Айгерим", text: "Здравствуйте, хочу по акции" });
  await st.goto(url + "/inbox?c=kairat#wa:77051110002");
  await st.waitForSelector("#msgs .sys");
  ok("в пульте в чате клиента, ответившего на рассылку, видна подсказка с её текстом", /Рассылка «Октябрь: скидка»/.test(await st.locator("#msgs .sys").innerText()) && /5 000 ₸/.test(await st.locator("#msgs .sys").innerText()));
  await shot(st, "17-inbox-after-broadcast");
  net.graphReply = null;

  // ---- пульт: ответ уходит тому, чей чат открыт; черновик не переезжает; запоздавший ответ сервера не перерисовывает чужой чат
  const v = await newPage({ width: 1200, height: 800 });
  await v.goto(url + "/inbox?c=kairat&key=" + OWNER);
  await v.click(".chip:text-is('Все')"); await v.waitForSelector("#rows a.row");
  const rowOf = n => v.locator(`#rows a.row:has(.nm:text-is("${n}"))`);
  const nameIs = n => v.waitForFunction(x => document.getElementById("cname").textContent === x, n);
  const sheetText = async () => { await v.click("#menu"); await v.waitForSelector("#sheet"); const t = await v.locator("#sheet").innerText(); await v.keyboard.press("Escape"); return t; };
  await rowOf("Данияр").click(); await nameIs("Данияр");
  await v.fill("#txt", "черновик для Данияра");
  await rowOf("Айгерим").click(); await nameIs("Айгерим");
  ok("черновик ответа не переезжает в другой чат", (await v.inputValue("#txt")) === "");
  await rowOf("Данияр").click(); await nameIs("Данияр");
  ok("…а при возвращении в чат черновик на месте", (await v.inputValue("#txt")) === "черновик для Данияра");
  let slow = true;
  await v.route(u => u.pathname === "/api/inbox/chat" && u.searchParams.get("id") === "77051110001", async r => { if (slow) { slow = false; await new Promise(x => setTimeout(x, 1500)); } await r.continue(); });
  await rowOf("Айгерим").click(); await rowOf("Данияр").click(); await rowOf("Айгерим").click(); // Данияр открыт и не дождались; ответ сервера придёт позже
  await v.waitForTimeout(2200);
  ok("запоздавший ответ сервера не перерисовывает чужой чат", (await v.locator("#cname").innerText()) === "Айгерим");
  await v.unroute(u => u.pathname === "/api/inbox/chat" && u.searchParams.get("id") === "77051110001");
  const toD0 = S.sentTo("77051110001").length, toA0 = S.sentTo("77051110002").length;
  await v.fill("#txt", "Ответ Айгерим про запись"); await v.click("#send"); await v.waitForSelector("#msgs .m.adm:not(.pend) >> text=Ответ Айгерим про запись");
  ok("ответ ушёл тому, чей чат на экране", S.sentTo("77051110002").length === toA0 + 1 && S.sentTo("77051110001").length === toD0 && /Ответ Айгерим/.test(S.sentTo("77051110002").at(-1)));
  // отправка уходит адресату на момент нажатия, даже если чат успели сменить до ответа сервера
  await rowOf("Данияр").click(); await nameIs("Данияр");
  await v.fill("#txt", "Данияр, ждём вас");
  await v.route("**/api/inbox/send", async r => { await new Promise(x => setTimeout(x, 800)); await r.continue(); });
  await v.click("#send"); await rowOf("Айгерим").click();
  await v.waitForTimeout(1500);
  ok("медленная отправка: ответ ушёл Данияру, а экран остался на открытом чате", S.sentTo("77051110001").some(x => /Данияр, ждём вас/.test(x)) && (await v.locator("#cname").innerText()) === "Айгерим" && !(await v.locator("#msgs").innerText()).includes("Данияр, ждём вас"));
  await v.unroute("**/api/inbox/send");
  // чат с заявкой: «Готово» не прячет чат, а «отправить клиенту» не предлагается там, где писать нельзя
  const webSid = [...S.kv.mem.keys()].find(k => k.startsWith("h:web:kairat:")).split(":").pop();
  await v.goto("about:blank"); await v.goto(url + "/inbox?c=kairat#web:" + webSid); await v.waitForSelector(".rq");
  ok("чат с сайта: заявка видна, пункта «Готово — убрать» в меню нет", !(await sheetText()).includes("Готово — убрать"));
  ok("чат с сайта: поля ответа нет, сказано почему", await v.locator("#comp").isHidden() && /ответить в него нельзя/.test(await v.locator("#warn").innerText()));
  await v.click(".rq >> text=Позвонил и подтвердил");
  await v.waitForFunction(() => !document.querySelector(".rq"));
  ok("чат с сайта: «Отправить клиенту и закрыть» не предлагается, заявка закрывается без сообщения", !(await v.locator("body").innerText()).includes("Отправить клиенту и закрыть") && S.leads("kairat").some(l => l.status === "выполнена"));
  await wa({ c: "kairat", from: "77051110009", name: "Тимур", text: "Тимур, +7 705 111 22 77, завтра в 12:00" });
  { const k = "h:wa:kairat:77051110009", h = S.kv.json(k), old = Date.now() - 26 * 3600e3; h.profile.li = old; await S.kv.api.put(k, JSON.stringify(h), { metadata: { ...(S.kv.meta.get(k) || {}), li: old } }); }
  await v.goto("about:blank"); await v.goto(url + "/inbox?c=kairat#wa:77051110009"); await v.waitForSelector(".rq");
  ok("чат старше 24 часов с заявкой: «Готово — убрать» скрыта", !(await sheetText()).includes("Готово — убрать"));
  ok("чат старше 24 часов: поле ответа заблокировано, сказано почему", await v.locator("#txt").isDisabled() && /больше 24 часов/.test(await v.locator("#warn").innerText()));
  await v.click(".rq .btn.pri");
  await v.waitForFunction(() => !document.querySelector(".rq"));
  ok("чат старше 24 часов: сразу закрытие без «Отправить клиенту»", !(await v.locator("body").innerText()).includes("Отправить клиенту и закрыть"));
  await v.route("**/api/inbox/list*", r => r.abort());
  await v.evaluate(() => window.__pult.loadList());
  await v.waitForFunction(() => !document.getElementById("net").hidden, null, { timeout: 5000 }).catch(() => {});
  ok("пульт при сбое запроса пишет об этом", await v.locator("#net").isVisible());
  await v.unroute("**/api/inbox/list*");

  // ---- проверка запуска: чек-лист и экзамен
  await p.goto(url + "/launch?c=kairat");
  await p.waitForSelector("#checks .ck");
  const chk = await p.locator("#checks").innerText();
  ok("чек-лист запуска: видно, что готово и чего не хватает", /Ключ ИИ/.test(chk) && /Хранилище/.test(chk) && /WhatsApp: адрес вебхука/.test(chk) && /\/wa\/kairat/.test(chk) && /Что сделать/.test(chk), chk.slice(0, 500));
  await p.click("#b_tg");
  await p.waitForSelector("#tgout .msg");
  ok("пробное сообщение в Telegram отправляется со страницы", /доставлено/.test(await p.locator("#tgout").innerText()));
  await shot(p, "12-launch-checklist");
  await p.click("#b_run");
  await p.waitForFunction(() => /^Итог:/.test(document.getElementById("sum").textContent), null, { timeout: 120000 });
  const sumText = await p.locator("#sum").innerText(), marks = await p.locator("#cases .i").allInnerTexts();
  ok("экзамен бота проходит все сценарии по очереди и показывает итог", /Итог: прошло \d+ из \d+/.test(sumText) && marks.length >= 12 && marks.every(m => m === "✅" || m === "❌") && marks.filter(m => m === "✅").length >= 6, sumText + " " + marks.join(""));
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(p, "13-launch-exam");

  // ---- Green-API: вебхук одной кнопкой на проверке запуска; рассылка обычным текстом по одному сообщению
  S.env.GA_ID_KAIRAT = "7105000001"; S.env.GA_TOKEN_KAIRAT = "ga-tok-kairat";
  await p.goto(url + "/launch?c=kairat");
  await p.waitForSelector("#checks .ck");
  ok("проверка запуска: пункты Green-API и кнопка «Настроить Green-API»", /WhatsApp \(Green-API\)/.test(await p.locator("#checks").innerText()) && await p.locator("#b_ga").isVisible());
  await p.click("#b_ga");
  await p.waitForSelector("#tgout .msg");
  ok("«Настроить Green-API» вписывает адрес вебхука этого бота", /Готово/.test(await p.locator("#tgout").innerText()) && /\/ga\/kairat\?t=[a-f0-9]{32}$/.test((net.gaSettings["7105000001"] || {}).webhookUrl || ""), await p.locator("#tgout").innerText());
  await p.click("#b_re");
  await p.waitForFunction(() => [...document.querySelectorAll("#checks .ck")].some(r => /Green-API: вебхук/.test(r.textContent) && /✅/.test(r.textContent)), null, { timeout: 10000 }).catch(() => {});
  ok("после настройки вебхук отмечен готовым — с адресом сайта", /✅/.test(await p.locator("#checks .ck", { hasText: "Green-API: вебхук" }).innerText()) && /настроен на 127\.0\.0\.1/.test(await p.locator("#checks").innerText()), await p.locator("#checks .ck", { hasText: "Green-API: вебхук" }).innerText());
  await shot(p, "13b-launch-green-api");
  await st.goto(url + "/broadcast?c=kairat");
  await st.waitForSelector("#info .msg");
  ok("страница рассылок: номер Green-API привязан", /WhatsApp через Green-API: номер \+7 700 000 00 77 привязан/.test(await st.locator("#info").innerText()), await st.locator("#info").innerText());
  await st.click("#b_new");
  ok("у клиента и Meta, и Green-API — выбор, через что отправлять", await st.locator("#chbox").isVisible());
  await st.check("#ch_ga");
  ok("Green-API: полей шаблона и подсказок про Meta нет, предел 50 в сутки", !(await st.locator("#f_tpl").isVisible()) && !(await st.locator("#f_params").isVisible()) && !(await st.locator("#p_meta2").isVisible()) && await st.locator("#p_ga").isVisible() && (await st.locator("#f_cap").inputValue()) === "50" && (await st.locator("#l_text").innerText()) === "Текст сообщения");
  await st.fill("#f_name", "Green: октябрь");
  await st.fill("#f_text", "Здравствуйте, {имя}!\nВ октябре стрижка 4 500 ₸.");
  await st.fill("#f_rec", "8 705 222 00 01, Данияр\n8 705 222 00 02");
  await st.click("#b_chk"); await st.waitForSelector("#fout .msg");
  const gaChk = await st.locator("#fout").innerText();
  ok("проверка: видно, как сообщение увидит первый клиент — с именем и строкой «СТОП»", /Так увидит сообщение первый клиент/.test(gaChk) && /Здравствуйте, Данияр!\nВ октябре стрижка 4 500 ₸\./.test(gaChk) && /ответьте СТОП/.test(gaChk) && !/Подстановки/.test(gaChk), gaChk);
  await shot(st, "16b-broadcast-ga-check");
  if (!(await st.locator("#f_ok").isChecked())) await st.check("#f_ok");
  await st.click("#b_make");
  await st.waitForSelector("#list .card >> text=Green: октябрь");
  const gcard = st.locator("#list .card", { hasText: "Green: октябрь" });
  ok("рассылка через Green-API создана", /Green-API · готова к запуску/.test(await gcard.innerText()), await gcard.innerText());
  await gcard.locator("text=Запустить").click();
  await st.waitForFunction(() => [...document.querySelectorAll("#list .card")].some(c => /Green: октябрь/.test(c.textContent) && /идёт/.test(c.textContent)));
  ok("идёт: на карточке — «по одному сообщению раз в 1–3 минуты»", /по одному сообщению раз в 1–3 минуты/.test(await gcard.innerText()), await gcard.innerText());
  net.ga.length = 0;
  await fetch(url + "/_cron", { method: "POST" });
  const gk = [...S.kv.mem.keys()].find(k => k.startsWith("bc:kairat:") && (S.kv.json(k) || {}).name === "Green: октябрь");
  { const b = S.kv.json(gk); b.nextAt = Date.now() - 1; S.kv.mem.set(gk, JSON.stringify(b)); } // «прошло две минуты»
  await fetch(url + "/_cron", { method: "POST" });
  await st.waitForFunction(() => [...document.querySelectorAll("#list .card")].some(c => /Green: октябрь/.test(c.textContent) && /завершена/.test(c.textContent)), null, { timeout: 15000 });
  const gaSent = net.ga.filter(x => x.op === "sendMessage").map(x => [x.body.chatId, x.body.message]);
  ok("отправлено 2 из 2: обычным текстом с номера Green-API, каждому — со своим обращением", /отправлено 2 из 2/.test(await gcard.innerText()) && gaSent.length === 2 && gaSent[0][0] === "77052220001@c.us" && /^Здравствуйте, Данияр!/.test(gaSent[0][1]) && /^Здравствуйте, уважаемый клиент!/.test(gaSent[1][1]), JSON.stringify(gaSent));
  await shot(st, "16c-broadcast-ga-done");
  delete S.env.GA_ID_KAIRAT; delete S.env.GA_TOKEN_KAIRAT;

  // ---- /demo: открывается без входа и без единого обращения к серверу, данные вымышленные
  {
    const d = await newPage({ width: 390, height: 844 });
    const api = []; d.on("request", r => { if (new URL(r.url()).pathname.startsWith("/api/")) api.push(r.url()); });
    await d.goto(url + "/demo");
    await d.waitForSelector("#rows a.row");
    ok("/demo открывается без входа, в списке вымышленные чаты", /Айдос/.test(await d.locator("#rows").innerText()) && !/\/login/.test(d.url()));
    await d.click("#rows a.row"); await d.waitForSelector("#msgs .m");
    await d.fill("#txt", "Проверка из теста"); await d.click("#send");
    await d.waitForSelector("#msgs .m.adm:not(.pend) >> text=Проверка из теста");
    ok("демо: ответ появляется в чате", true);
    await shot(d, "18-demo-chat");
    await d.click("#back");
    for (const t of ["leads", "summary", "broadcast", "more"]) { await d.click(`#nav a[data-v=${t}]`); await d.waitForTimeout(200); ok(`демо: раздел «${t}» открывается и не пустой`, (await d.locator(`#v-${t}`).innerText()).trim().length > 20); }
    ok("демо не обращается к настоящему серверу (/api/…)", api.length === 0, api.join(" "));
  }

  // ---- /demo: второй бизнес «Магазин телефонов» (вымышленный «Смарт Маркет»): переключатель, чаты, счётчики, маски номеров
  {
    const api = [];
    const open = async (viewport, theme) => {
      const d = await newPage(viewport);
      d.on("request", r => { if (new URL(r.url()).pathname.startsWith("/api/")) api.push(r.url()); });
      await d.goto(url + "/demo");
      await d.waitForSelector("#rows a.row");
      await d.evaluate(t => window.__pult.setTheme(t, true), theme);
      return d;
    };
    const biz = d => d.locator("#bizslot .biz .n").first().innerText();
    const switchTo = async (d, name) => {
      await d.locator("#bizslot .biz").first().click();
      await d.waitForSelector("#sheet .opt");
      await d.locator("#sheet .opt", { hasText: name }).click();
      await d.waitForFunction(n => { const e = document.querySelector("#bizslot .biz .n"); return e && e.textContent === n && document.querySelectorAll("#rows a.row, #rows .empty").length > 0 && !document.querySelector("#rows .sk-row"); }, name);
    };
    const calm = async d => { await d.waitForSelector("#toast", { state: "hidden", timeout: 6000 }); await d.waitForTimeout(450); }; // перед снимком: тост убрался, анимации закончились
    const chip = (d, t) => d.locator(".chip", { hasText: t }).first();
    const rowsText = d => d.locator("#rows").innerText();
    const waitNum = async d => Number(/Ждут ответа\s*(\d+)/.exec(await chip(d, "Ждут ответа").innerText())?.[1] || 0);
    const allList = async d => { await d.locator(".chip:text-is('Все')").click(); await d.waitForFunction(() => document.querySelectorAll("#rows a.row").length > 0); await d.waitForTimeout(150); };

    // --- телефон (390), светлая тема
    const d = await open({ width: 390, height: 844 }, "light");
    await allList(d);
    const barberRows = await d.locator("#rows a.row").count(), barberText = await rowsText(d), barberWait = await d.locator("#rows a.row.wait").count(), barberChip = await waitNum(d);
    ok("демо: в переключателе оба бизнеса", await (async () => { await d.locator("#bizslot .biz").first().click(); await d.waitForSelector("#sheet .opt"); const t = await d.locator("#sheet").innerText(); await d.keyboard.press("Escape"); return /Барбершоп/.test(t) && /Магазин телефонов/.test(t); })());
    await switchTo(d, "Магазин телефонов");
    ok("демо: шапка показывает выбранный бизнес «Магазин телефонов»", (await biz(d)) === "Магазин телефонов");
    await allList(d);
    const shopRows = await d.locator("#rows a.row").count(), shopText = await rowsText(d), shopWait = await d.locator("#rows a.row.wait").count();
    ok("магазин: в списке не меньше 8 чатов, барбершопных клиентов нет", shopRows >= 8 && !/Айдос|Мадина|Данияр С\./.test(shopText) && /Бекзат/.test(shopText), String(shopRows));
    ok("магазин: есть чат про trade-in и чат с «менеджер»", /trade-?in/i.test(shopText) && /менеджер/i.test(shopText), shopText.slice(0, 400));
    const chipN = await waitNum(d), badge = Number(await d.locator("#bdg").innerText());
    ok("магазин: счётчик «Ждут ответа» (вкладка, значок, заголовок) совпадает с числом ждущих чатов", shopWait >= 3 && chipN === shopWait && badge === shopWait && new RegExp("^" + shopWait + " ждут ответа").test(await d.locator("#meta").innerText()), `${chipN}/${badge}/${shopWait}`);
    await chip(d, "Ждут ответа").click(); await d.waitForTimeout(200);
    ok("магазин: фильтр «Ждут ответа» показывает ровно ждущие чаты", (await d.locator("#rows a.row").count()) === shopWait && (await d.locator("#rows a.row:not(.wait)").count()) === 0);
    await chip(d, "Бот молчит").click(); await d.waitForTimeout(200);
    ok("магазин: «Бот молчит» — один чат с паузой бота", (await d.locator("#rows a.row").count()) === 1 && /Бот молчит до/.test(await rowsText(d)));
    await allList(d);
    await calm(d); await shot(d, "demo-shop-phone-light");
    await d.evaluate(() => window.__pult.setTheme("dark", true)); await calm(d);
    await shot(d, "demo-shop-phone-dark");
    // содержимое чатов: trade-in с вилкой, менеджер, ночные, ответ администратора; в каждом открытом чате нет tel: и настоящих на вид номеров
    const idx = {}; const n = await d.locator("#rows a.row").count();
    const leak = [];
    for (let i = 0; i < n; i++) {
      await d.locator("#rows a.row").nth(i).click(); await d.waitForSelector("#msgs .m");
      const nm = await d.locator("#cname").innerText(), txt = await d.locator("#msgs").innerText(), pageText = await d.locator("body").innerText();
      idx[nm] = { txt, ts: await d.locator("#msgs .m .ts").allInnerTexts(), adm: await d.locator("#msgs .m.adm").count(), strip: await d.locator("#strip").innerText().catch(() => "") };
      if (/\d{11}/.test(pageText)) leak.push(nm + ": 11 цифр");
      if (/(?:\+7|8)[\s (-]*7\d\d[)\s -]*\d{3}[\s -]*\d{2}[\s -]*\d{2}/.test(pageText)) leak.push(nm + ": номер");
      if (await d.locator('a[href^="tel:"]').count()) leak.push(nm + ": tel:");
      await d.click("#back");
    }
    ok("магазин: чат trade-in — бот называет вилку и зовёт на осмотр", /185 000–210 000 ₸/.test(idx["Бекзат Н."].txt) && /осмотр/i.test(idx["Бекзат Н."].txt) && /аккумулятор/i.test(idx["Бекзат Н."].txt));
    ok("магазин: рассрочка Kaspi Red / Halyk — общими словами, без обещанных условий", /Kaspi Red/.test(idx["Руслан К."].txt) && /Halyk/.test(idx["Руслан К."].txt) && /решени\w+ банка|определяет банк/.test(idx["Руслан К."].txt) && !/\d+\s?%/.test(idx["Руслан К."].txt));
    ok("магазин: чат «Позовите менеджера» ждёт ответа — в чате кнопка «Забрать чат»", /менеджер/i.test(idx["Жанар Е."].txt) && /Забрать чат/.test(idx["Жанар Е."].strip), idx["Жанар Е."].strip);
    ok("магазин: ночные чаты — сообщения клиентов написаны с 02:00 до 05:00", idx["Арсен Б."].ts.length >= 2 && /^0[2-4]:/.test(idx["Арсен Б."].ts[0]) && /^0[2-4]:/.test(idx["Динара С."].ts[0]) && /Вне рабочих часов/.test(idx["Арсен Б."].txt), JSON.stringify([idx["Арсен Б."].ts, idx["Динара С."].ts]));
    ok("магазин: у одного чата ответ администратора (и пауза бота)", idx["Мейрам А."].adm >= 1 && /Вернуть бота/.test(idx["Мейрам А."].strip));
    ok("магазин: доставка по городу, в другой город, гарантия, чехол и стекло — есть чаты", /Астане/.test(idx["Салтанат М."].txt) && /Караганд/.test(idx["Мейрам А."].txt) && /гарантия/i.test(idx["Данияр О."].txt) && /стекл/i.test(idx["Айгерим Ж."].txt));
    ok("магазин: есть и закрытые чаты (бот ответил, никто не ждёт)", n - shopWait >= 5);
    ok("/demo (магазин): нет ссылок tel: и номеров, похожих на настоящие (11 цифр подряд)", leak.length === 0, leak.join("; "));
    // вкладки «Лиды», «Сводка», «Ещё» тоже считаются по выбранному бизнесу
    await d.click("#nav a[data-v=summary]"); await d.waitForSelector("#v-summary .att");
    ok("магазин: «Сводка» считает ждущих по магазину", new RegExp("Ждут ответа человека\\s*" + shopWait).test(await d.locator("#v-summary").innerText()));
    await d.click("#nav a[data-v=leads]"); await d.waitForSelector("#v-leads .stages");
    ok("магазин: «Лиды» — клиенты магазина, этап «Бронь»", /Бекзат/.test(await d.locator("#v-leads").innerText()) && /Бронь/.test(await d.locator("#v-leads .stages").innerText()) && !/Айдос/.test(await d.locator("#v-leads").innerText()));
    await d.click("#nav a[data-v=more]"); await d.waitForSelector("#v-more .card");
    ok("магазин: «Ещё» — название бизнеса и подписи магазина, без барбершопа", /Магазин телефонов/.test(await d.locator("#v-more").innerText()) && /Товары и услуги/.test(await d.locator("#v-more").innerText()) && !/Мастера и услуги|Altegio/.test(await d.locator("#v-more").innerText()));
    await d.click("#nav a[data-v=chats]");
    await d.locator("#rows a.row").first().click(); await d.waitForSelector("#msgs .m");
    await calm(d); await shot(d, "demo-shop-chat-phone-dark");
    await d.evaluate(() => window.__pult.setTheme("light", true)); await calm(d);
    await shot(d, "demo-shop-chat-phone-light");
    await d.click("#back");

    // --- переключение обратно: прежний бизнес и его чаты на месте
    await switchTo(d, "Барбершоп");
    ok("переключение обратно: шапка «Барбершоп»", (await biz(d)) === "Барбершоп");
    await allList(d);
    ok("переключение обратно: чаты и счётчик барбершопа прежние, магазинных нет", (await d.locator("#rows a.row").count()) === barberRows && (await d.locator("#rows a.row.wait").count()) === barberWait && (await waitNum(d)) === barberChip && !/Бекзат|Алия/.test(await rowsText(d)) && /Айдос/.test(await rowsText(d)) && (await rowsText(d)) === barberText, `${barberRows}/${barberWait}/${barberChip}`);
    await d.click("#nav a[data-v=more]"); await d.waitForSelector("#v-more .card");
    ok("переключение обратно: «Ещё» снова барбершоп (Altegio, мастера)", /Мастера и услуги/.test(await d.locator("#v-more").innerText()) && /Altegio/.test(await d.locator("#v-more").innerText()));

    // --- компьютер (1280): три колонки, открыт чат магазина
    const w = await open({ width: 1280, height: 800 }, "light");
    await switchTo(w, "Магазин телефонов");
    await w.locator(".chip:text-is('Все')").click(); await w.waitForTimeout(200);
    await w.locator("#rows a.row", { hasText: "Бекзат" }).click(); await w.waitForSelector("#msgs .m");
    ok("компьютер: список магазина и открытый чат рядом, без горизонтальной прокрутки", (await w.locator("#rows a.row").count()) >= 8 && await w.locator("#msgs").isVisible() && await w.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await calm(w); await shot(w, "demo-shop-desktop");
    await w.evaluate(() => window.__pult.setTheme("dark", true)); await calm(w);
    await shot(w, "demo-shop-desktop-dark");
    ok("демо с двумя бизнесами не обращается к настоящему серверу (/api/…)", api.length === 0, api.join(" "));
    await d.close(); await w.close();
  }

  // ---- уведомления: новый чат, который ждёт ответа, — уведомление браузера (в программе для Windows — уведомление Windows)
  {
    const n = await newPage({ width: 1200, height: 800 });
    await n.addInitScript(() => { window.__notes = []; window.Notification = class { constructor(t, o) { window.__notes.push([t, (o || {}).body || ""]); } static get permission() { return "granted"; } static requestPermission() { return Promise.resolve("granted"); } close() {} }; });
    await n.goto(url + "/inbox?c=kairat&key=" + OWNER);
    await n.waitForSelector("#rows a.row, #rows .empty");
    await n.waitForTimeout(300);
    const before = await n.evaluate(() => window.__notes.length);
    ok("уведомления: при открытии пульта старые ждущие чаты не «звенят»", before === 0, String(before));
    await wa({ c: "kairat", from: "77051119911", text: "Позовите администратора, пожалуйста", name: "Ерасыл" });
    await n.evaluate(() => window.__pult.loadList());
    await n.waitForFunction(() => window.__notes.length > 0, null, { timeout: 5000 }).catch(() => {});
    const notes = await n.evaluate(() => window.__notes);
    ok("уведомления: клиент позвал администратора → уведомление «Клиент ждёт ответа» с именем", notes.length === 1 && /ждёт ответа/.test(notes[0][0]) && /Ерасыл/.test(notes[0][1]), JSON.stringify(notes));
    await n.evaluate(() => window.__pult.loadList()); await n.waitForTimeout(300);
    ok("уведомления: тот же чат второй раз не «звенит»", (await n.evaluate(() => window.__notes.length)) === 1);
    ok("ждущий чат отмечен «лентой внимания»", await n.locator("#rows a.row.wait").count() > 0);
    await shot(n, "18b-notify-wide");
    await n.close();
  }

  // ---- свайпы по строке чата на телефоне: влево — «Готово», вправо — «Забрать у бота», тост «Отменить» 5 секунд.
  // Касания — настоящие, через CDP (Input.dispatchTouchEvent): браузер сам решает, где прокрутка, а где жест. Демо — без сервера, плюс живой /inbox на заглушках.
  {
    const touchKit = async page => {
      const cdp = await page.context().newCDPSession(page);
      const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
      const pos = async loc => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
      const kit = {
        pos,
        async begin(loc, dx, dy = 0, steps = 8) { const p = await pos(loc); await send("touchStart", [{ x: p.x, y: p.y }]); for (let i = 1; i <= steps; i++) await send("touchMove", [{ x: p.x + dx * i / steps, y: p.y + dy * i / steps }]); return p; }, // палец идёт и остаётся на экране
        async to(p, dx) { await send("touchMove", [{ x: p.x + dx, y: p.y }]); },
        async end() { await send("touchEnd", []); },
        async drag(loc, dx, dy = 0, steps = 8) { await kit.begin(loc, dx, dy, steps); await kit.end(); }
      };
      return kit;
    };
    const R = (pg, n) => pg.locator(`#rows a.row:has(.nm:text-is("${n}"))`);
    const rowsN = pg => pg.locator("#rows a.row").count();
    const needN = async pg => Number(/Ждут ответа\s*(\d+)/.exec(await pg.locator(".chip", { hasText: "Ждут ответа" }).first().innerText())?.[1] || 0);
    const track = pg => pg.evaluate(() => { const A = window.__pult.API(), o = A.act; window.__acts = []; A.act = function (ch, id, a) { window.__acts.push(ch + ":" + id + ":" + a); return o.apply(A, arguments); }; }); // какие действия реально ушли
    const acts = pg => pg.evaluate(() => window.__acts.slice());
    const toastGone = pg => pg.waitForSelector("#toast", { state: "hidden", timeout: 9000 });
    const settle = pg => pg.waitForTimeout(450);
    const api = [];
    const phoneDemo = async (opts = {}, viewport = { width: 390, height: 844 }) => {
      const pg = await newPage(viewport, { hasTouch: true, ...opts });
      pg.on("request", r => { if (new URL(r.url()).pathname.startsWith("/api/")) api.push(r.url()); });
      await pg.goto(url + "/demo"); await pg.waitForSelector("#rows a.row");
      await pg.evaluate(() => { window.__pult.setTheme("light", true); window.__pult.SW.ms = 1200; });
      await track(pg); await settle(pg);
      return pg;
    };

    // --- телефон (390), демо, светлая тема
    const d = await phoneDemo(), tk = await touchKit(d);
    ok("свайп: 3 ждущих чата, значок «Ждут ответа 4»", (await rowsN(d)) === 3 && (await needN(d)) === 4);
    // подсказка под строкой: цвет + значок + подпись, не только цвет
    const mad = R(d, "Мадина Темирова");
    let pt = await tk.begin(mad, -120);
    const hintL = await d.evaluate(() => { const s = document.querySelector(".sw.on"), v = s && s.querySelector(".swh.l"), cs = v && getComputedStyle(v); return { on: !!s, d: s && s.getAttribute("data-d"), go: s && s.classList.contains("go"), shown: !!cs && cs.display !== "none", text: v ? v.textContent : "", svg: v ? v.querySelectorAll("svg").length : 0, bg: getComputedStyle(s.querySelector(".swb")).backgroundColor, tx: s.querySelector(".row").style.transform }; });
    ok("свайп влево: строка идёт за пальцем, под ней шафрановая подсказка «Готово» со значком", hintL.on && hintL.d === "l" && hintL.go && hintL.shown && /^Готово$/.test(hintL.text) && hintL.svg === 1 && /translate3d\(-/.test(hintL.tx) && hintL.bg !== "rgba(0, 0, 0, 0)", JSON.stringify(hintL));
    await shot(d, "swipe-left-phone");
    await tk.to(pt, 0); await tk.end(); await settle(d);
    ok("палец вернули к началу и отпустили — ничего не произошло", (await rowsN(d)) === 3 && (await acts(d)).length === 0 && await d.locator("#toast").isHidden());
    // короткий свайп ниже порога
    await tk.drag(mad, -50); await settle(d);
    ok("короткий свайп (ниже порога): действия нет, тоста нет, строка вернулась на место", (await rowsN(d)) === 3 && (await acts(d)).length === 0 && await d.locator("#toast").isHidden() && (await d.evaluate(() => document.querySelectorAll(".sw.on").length + document.querySelectorAll(".row[style*=transform]").length)) === 0);
    // длинный свайп влево: «Готово»
    await tk.drag(R(d, "Айдос Акберов"), -160); await d.waitForFunction(() => document.querySelectorAll("#rows a.row").length === 2);
    const tb = await d.locator("#toast .tb").boundingBox();
    ok("свайп влево за порогом: чат ушёл из «Ждут ответа», появился тост «Отменить»", (await rowsN(d)) === 2 && (await R(d, "Айдос Акберов").count()) === 0 && /Готово: Айдос/.test(await d.locator("#toast").innerText()) && await d.locator("#toast .tb").isVisible() && (await d.locator("#toast .tb").innerText()) === "Отменить");
    ok("после свайпа значок «Ждут ответа» уменьшился (4 → 3), чат не открылся", (await needN(d)) === 3 && /3 ждут ответа/.test(await d.locator("#meta").innerText()) && (await d.evaluate(() => window.__pult.S.cur)) === null);
    ok("кнопка «Отменить» не меньше 44×44 px, тост — role=status", tb.width >= 44 && tb.height >= 44 && (await d.locator("#toast").getAttribute("role")) === "status", JSON.stringify(tb));
    ok("пока тост виден, на сервер (в демо — в «API») ничего не ушло", (await acts(d)).length === 0);
    await d.locator("#toast .tb").tap();
    await d.waitForFunction(() => document.querySelectorAll("#rows a.row").length === 3);
    ok("«Отменить» возвращает чат в «Ждут ответа», счётчик снова 4", (await R(d, "Айдос Акберов").count()) === 1 && (await needN(d)) === 4 && (await R(d, "Айдос Акберов").evaluate(e => e.classList.contains("wait"))));
    await d.waitForTimeout(1700);
    ok("после «Отменить» действие так и не уходит (даже когда время вышло)", (await acts(d)).length === 0 && (await rowsN(d)) === 3);
    // не отменили — через паузу действие уходит
    await toastGone(d);
    await tk.drag(R(d, "Айдос Акберов"), -160); await d.waitForFunction(() => document.querySelectorAll("#rows a.row").length === 2);
    await d.waitForFunction(() => window.__acts.length === 1, null, { timeout: 5000 });
    ok("не нажали «Отменить» — действие «resolve» уходит по этому чату, тост убрался", JSON.stringify(await acts(d)) === JSON.stringify(["wa:demo-01:resolve"]) && await d.locator("#toast").isHidden());
    await d.evaluate(() => window.__pult.loadList()); await d.waitForTimeout(300);
    ok("после обновления списка чат остаётся закрытым (ответ демо принят)", (await R(d, "Айдос Акберов").count()) === 0 && (await needN(d)) === 3);
    // чат с просьбой клиента: сервер не даёт нажать «Готово» — строка возвращается и сказано почему
    await tk.drag(R(d, "Данияр С."), -160); await d.waitForFunction(() => document.querySelectorAll("#rows a.row").length === 1);
    await d.waitForFunction(() => window.__acts.length === 2 && /невыполненная просьба/.test(document.getElementById("toast").textContent) && document.querySelectorAll("#rows a.row").length === 2, null, { timeout: 5000 });
    ok("чат с невыполненной просьбой: сервер отказал — строка вернулась, в тосте текст ошибки сервера", (await R(d, "Данияр С.").count()) === 1 && /невыполненная просьба клиента/.test(await d.locator("#toast").innerText()) && (await R(d, "Данияр С.").evaluate(e => e.classList.contains("wait"))) && (await needN(d)) === 3);
    await toastGone(d);

    // --- вправо: «Забрать у бота»
    await d.locator(".chip:text-is('Все')").click(); await d.waitForFunction(() => document.querySelectorAll("#rows a.row").length >= 10); await settle(d);
    const pausedBefore = await d.locator("#rows .tag.ok").count();
    const erl = R(d, "Ерлан Касымов");
    pt = await tk.begin(erl, 120);
    const hintR = await d.evaluate(() => { const s = document.querySelector(".sw.on"), v = s && s.querySelector(".swh.r"), cs = v && getComputedStyle(v); return { d: s && s.getAttribute("data-d"), go: s && s.classList.contains("go"), shown: !!cs && cs.display !== "none", text: v ? v.textContent : "", svg: v ? v.querySelectorAll("svg").length : 0, left: s.querySelector(".swh.l") ? getComputedStyle(s.querySelector(".swh.l")).display : "" }; });
    ok("свайп вправо: подсказка «Забрать у бота» со значком (а «Готово» скрыто)", hintR.d === "r" && hintR.go && hintR.shown && /^Забрать у бота$/.test(hintR.text) && hintR.svg === 1 && hintR.left === "none", JSON.stringify(hintR));
    await shot(d, "swipe-right-phone");
    await tk.end(); await R(d, "Ерлан Касымов").locator(".tag.ok").waitFor({ timeout: 3000 }); // строка вернулась на место уже с пометкой
    ok("свайп вправо за порогом: бот на паузе (метка «Бот молчит до …» в строке), тост «Отменить»", (await R(d, "Ерлан Касымов").locator(".tag.ok").count()) === 1 && /Бот молчит до/.test(await R(d, "Ерлан Касымов").innerText()) && (await d.locator("#rows .tag.ok").count()) === pausedBefore + 1 && (await d.locator("#toast .tb").innerText()) === "Отменить" && (await acts(d)).length === 2, JSON.stringify([await R(d, "Ерлан Касымов").locator(".tag.ok").count(), await R(d, "Ерлан Касымов").innerText(), await d.locator("#rows .tag.ok").count(), pausedBefore, await acts(d)]));
    await d.locator("#toast .tb").tap();
    await d.waitForFunction(() => !document.querySelector("#rows a.row .tag.ok") || document.querySelectorAll("#rows .tag.ok").length === 1);
    ok("«Отменить» после «Забрать у бота»: метки паузы в строке нет, на сервер ничего не ушло", (await R(d, "Ерлан Касымов").locator(".tag.ok").count()) === 0 && (await acts(d)).length === 2);
    await d.waitForTimeout(1700); await toastGone(d);
    ok("…и через время тоже не уходит", (await acts(d)).length === 2 && (await R(d, "Ерлан Касымов").locator(".tag.ok").count()) === 0);
    // недоступные направления: бот уже молчит — вправо нельзя; чат не ждёт — влево нельзя
    await tk.drag(R(d, "Алибек Н."), 160); await tk.drag(R(d, "Нурлан Б."), -160); await settle(d);
    ok("недоступное действие (бот уже молчит / чат не ждёт ответа) не срабатывает", (await acts(d)).length === 2 && await d.locator("#toast").isHidden());
    // настоящая пауза: действие «pause» уходит
    await tk.drag(erl, 160);
    await d.waitForFunction(() => window.__acts.length === 3, null, { timeout: 5000 });
    ok("не отменили — действие «pause» уходит по этому чату", (await acts(d))[2] === "wa:demo-04:pause");
    await d.locator(".chip:text-is('Бот молчит')").click(); await d.waitForTimeout(300);
    ok("фильтр «Бот молчит» теперь показывает и этот чат", (await R(d, "Ерлан Касымов").count()) === 1 && (await R(d, "Алибек Н.").count()) === 1);
    await d.locator(".chip:text-is('Все')").click(); await d.waitForTimeout(300);

    // --- тёмная тема
    await d.evaluate(() => window.__pult.setTheme("dark", true)); await settle(d);
    pt = await tk.begin(R(d, "Мадина Темирова"), -120);
    await shot(d, "swipe-left-phone-dark");
    await tk.to(pt, 0); await tk.end(); await settle(d);
    pt = await tk.begin(R(d, "Ержан А."), 120);
    await shot(d, "swipe-right-phone-dark");
    ok("тёмная тема: подсказка видна (цвет фона подсказки отличается от фона строки)", await d.evaluate(() => { const s = document.querySelector(".sw.on"); return !!s && getComputedStyle(s.querySelector(".swb")).backgroundColor !== getComputedStyle(s.querySelector(".row")).backgroundColor; }));
    await tk.to(pt, 0); await tk.end(); await settle(d);
    await d.evaluate(() => window.__pult.setTheme("light", true));
    ok("палец вернули в начало: ничего не сработало", (await acts(d)).length === 3 && await d.locator("#toast").isHidden());

    // --- вертикальная прокрутка списка не запускает жест, а нажатие по-прежнему открывает чат
    const scroller = d.locator("#rows");
    await scroller.evaluate(e => { e.scrollTop = 0; }); await settle(d);
    const before = await scroller.evaluate(e => e.scrollTop);
    await tk.drag(R(d, "Ерлан Касымов"), 6, -320, 12); await settle(d);
    const scrolled = await scroller.evaluate(e => e.scrollTop);
    ok("вертикальная прокрутка списка: список прокрутился, жест не начался, действий нет", scrolled > before && (await acts(d)).length === 3 && await d.locator("#toast").isHidden() && (await d.locator(".sw.on").count()) === 0, `${before}→${scrolled}`);
    await scroller.evaluate(e => { e.scrollTop = 0; }); await settle(d);
    await R(d, "Тимур К.").tap(); await d.waitForSelector("#msgs .m");
    ok("обычное нажатие по строке открывает чат (клики как раньше)", /Тимур/.test(await d.locator("#cname").innerText()));
    await d.click("#back"); await d.waitForSelector("#rows a.row"); await settle(d);

    // --- окно «Отменить» длится 5 секунд (по умолчанию)
    await d.evaluate(() => { window.__pult.SW.ms = 5000; });
    await tk.drag(R(d, "Тимур К."), 160);
    const t0 = Date.now();
    await d.waitForFunction(() => /Бот молчит: Тимур/.test(document.getElementById("toast").textContent));
    await d.waitForTimeout(3800);
    ok("тост «Отменить» держится больше 3,5 секунды, действие ещё не ушло", await d.locator("#toast .tb").isVisible() && (await acts(d)).length === 3, String(Date.now() - t0));
    await d.waitForFunction(() => window.__acts.length === 4, null, { timeout: 4000 });
    const dt = Date.now() - t0;
    ok("через ~5 секунд действие уходит, тост убран", dt >= 4500 && dt <= 6500 && await d.locator("#toast").isHidden() && (await acts(d))[3] === "wa:demo-07:pause", String(dt));
    // два свайпа подряд: первое действие уходит сразу, окно «Отменить» — у последнего
    await d.evaluate(() => { window.__pult.SW.ms = 1200; });
    await tk.drag(R(d, "Ержан А."), 160); await d.waitForFunction(() => /Бот молчит: Ержан/.test(document.getElementById("toast").textContent));
    await tk.drag(R(d, "Санжар Ж."), 160); await d.waitForFunction(() => /Бот молчит: Санжар/.test(document.getElementById("toast").textContent));
    ok("два свайпа подряд: первое действие ушло сразу, у второго — свой «Отменить»", (await acts(d)).includes("wa:demo-10:pause") && !(await acts(d)).includes("wa:demo-06:pause"));
    await d.locator("#toast .tb").tap(); await d.waitForTimeout(300);
    ok("«Отменить» отменяет только последнее", !(await acts(d)).includes("wa:demo-06:pause") && (await R(d, "Санжар Ж.").locator(".tag.ok").count()) === 0 && (await R(d, "Ержан А.").locator(".tag.ok").count()) === 1);
    ok("свайпы в демо не обращаются к настоящему серверу (/api/…)", api.length === 0, api.join(" "));
    await d.context().close();

    // --- reduced motion: жест работает, но без анимации (строка пропадает сразу)
    const rm = await phoneDemo({ reducedMotion: "reduce" }), tkr = await touchKit(rm);
    ok("reduced motion: браузер сообщает об отключённой анимации", await rm.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches));
    await tkr.drag(R(rm, "Айдос Акберов"), -160);
    const instant = await rm.evaluate(() => ({ rows: document.querySelectorAll("#rows a.row").length, snap: document.querySelectorAll(".sw.snap").length, toast: !document.getElementById("toast").hidden }));
    ok("reduced motion: свайп влево сработал, строка убрана сразу, без скольжения (.snap нет), тост есть", instant.rows === 2 && instant.snap === 0 && instant.toast, JSON.stringify(instant));
    await rm.waitForTimeout(500); // сразу после жеста браузер пропускает касание — как и у человека
    await rm.locator("#toast .tb").tap(); await rm.waitForTimeout(150);
    ok("reduced motion: «Отменить» возвращает чат тоже сразу", (await rowsN(rm)) === 3);
    await tkr.drag(R(rm, "Мадина Темирова"), -50); await rm.waitForTimeout(100);
    ok("reduced motion: короткий свайп ничего не делает, строка на месте", (await rowsN(rm)) === 3 && (await acts(rm)).length === 0 && (await rm.locator(".row[style*=transform]").count()) === 0);
    await rm.context().close();

    // --- компьютер (1280): мышь и касание при широком окне не запускают жест
    const wd = await phoneDemo({}, { width: 1280, height: 800 });
    const wk = await touchKit(wd), wrow = R(wd, "Айдос Акберов"), wb = await wrow.boundingBox();
    await wd.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2); await wd.mouse.down();
    for (let i = 1; i <= 10; i++) await wd.mouse.move(wb.x + wb.width / 2 - 16 * i, wb.y + wb.height / 2);
    ok("компьютер (мышь): во время перетаскивания строка не двигается и подсказки нет", (await wd.locator(".sw.on").count()) === 0 && (await wrow.evaluate(e => e.style.transform)) === "");
    await wd.mouse.up(); await wd.waitForTimeout(300);
    ok("компьютер (мышь): перетаскивание строки не запускает действие", (await acts(wd)).length === 0 && (await rowsN(wd)) === 3 && await wd.locator("#toast").isHidden());
    await wk.drag(wrow, -160); await wd.waitForTimeout(300);
    ok("широкое окно, даже с касанием: свайпа нет", (await acts(wd)).length === 0 && (await rowsN(wd)) === 3 && await wd.locator("#toast").isHidden());
    await wrow.click(); await wd.waitForSelector("#msgs .m");
    ok("компьютер: обычный щелчок по строке открывает чат", /Айдос/.test(await wd.locator("#cname").innerText()));
    await wd.context().close();

    // --- живой /inbox на заглушках: «Готово» и «Забрать у бота» доходят до сервера; при уходе со страницы действие уходит сразу
    for (const [id, nm, tx] of [["77051118801", "Свайп Один", "Позовите администратора"], ["77051118802", "Свайп Два", "Добрый день"], ["77051118803", "Свайп Три", "Позовите администратора"]]) await wa({ c: "kairat", from: id, name: nm, text: tx });
    const prof = id => (S.kv.json("h:wa:kairat:" + id) || {}).profile || {};
    ok("живой пульт (подготовка): двое ждут ответа, у третьего бот отвечает сам", !!prof("77051118801").need && !!prof("77051118803").need && !prof("77051118802").need && !(prof("77051118802").pausedUntil > Date.now()));
    const lv = await newPage({ width: 390, height: 844 }, { hasTouch: true }), lk = await touchKit(lv);
    await lv.goto(url + "/inbox?c=kairat&key=" + OWNER); await lv.waitForSelector("#rows a.row");
    await lv.evaluate(() => { window.__pult.SW.ms = 800; }); await track(lv); await settle(lv);
    await lk.drag(R(lv, "Свайп Один"), -170);
    await lv.waitForFunction(() => document.querySelectorAll("#rows a.row .nm").length > 0 && ![...document.querySelectorAll("#rows a.row .nm")].some(e => e.textContent === "Свайп Один"));
    ok("живой пульт: свайп влево — чат ушёл из «Ждут ответа» сразу, тост «Отменить»", await lv.locator("#toast .tb").isVisible() && !!prof("77051118801").need);
    await lv.waitForFunction(() => window.__acts.length === 1, null, { timeout: 4000 });
    await lv.waitForTimeout(300);
    ok("живой пульт: через паузу «Готово» дошло до сервера (пометка «ждёт ответа» снята)", (await acts(lv))[0] === "wa:77051118801:resolve" && !prof("77051118801").need && !!prof("77051118803").need);
    await lv.locator(".chip:text-is('Все')").click(); await lv.waitForSelector("#rows a.row .nm >> text=Свайп Два");
    await lv.evaluate(() => { window.__pult.SW.ms = 5000; });
    await lk.drag(R(lv, "Свайп Два"), 170);
    await lv.waitForFunction(() => /Бот молчит: Свайп Два/.test(document.getElementById("toast").textContent));
    await lv.locator("#toast .tb").tap(); await lv.waitForTimeout(400);
    ok("живой пульт: «Отменить» после свайпа вправо — на сервер ничего не ушло", (await acts(lv)).length === 1 && !(prof("77051118802").pausedUntil > Date.now()) && (await R(lv, "Свайп Два").locator(".tag.ok").count()) === 0);
    await lv.evaluate(() => { window.__pult.SW.ms = 800; });
    await lk.drag(R(lv, "Свайп Два"), 170);
    await lv.waitForFunction(() => window.__acts.length === 2, null, { timeout: 4000 }); await lv.waitForTimeout(300);
    ok("живой пульт: свайп вправо — бот в этом чате на паузе (на сервере и в строке)", prof("77051118802").pausedUntil > Date.now() && /Бот молчит до/.test(await R(lv, "Свайп Два").innerText()));
    await shot(lv, "swipe-live-inbox-phone");
    // закрыли страницу, не дождавшись пяти секунд: действие всё равно уходит
    await lv.evaluate(() => { window.__pult.SW.ms = 5000; });
    await lk.drag(R(lv, "Свайп Три"), -170);
    await lv.waitForFunction(() => /Готово: Свайп Три/.test(document.getElementById("toast").textContent));
    ok("уход со страницы (подготовка): пока ждём, действие на сервер не ушло", !!prof("77051118803").need);
    await lv.goto("about:blank");
    for (let i = 0; i < 40 && prof("77051118803").need; i++) await new Promise(r => setTimeout(r, 100));
    ok("живой пульт: ушли со страницы в окне «Отменить» — «Готово» отправлено сразу", !prof("77051118803").need);
    await lv.context().close();
  }

  // ---- живой пульт: открытый чат обновляется каждые 3 с (список — раз в 15 с), пока вкладка видна
  {
    const PID = "77051119901", hk = "h:wa:kairat:" + PID;
    await wa({ c: "kairat", from: PID, name: "Опрос Три", text: "Добрый день" });
    { // длинная переписка, чтобы было что прокручивать
      const h = S.kv.json(hk), t0 = Date.now() - 3 * 3600e3, old = [];
      for (let i = 0; i < 40; i++) old.push({ role: i % 2 ? "assistant" : "user", text: "Старая реплика номер " + i + " для прокрутки", t: t0 + i * 60e3 });
      h.turns = old.concat(h.turns);
      await S.kv.api.put(hk, JSON.stringify(h), { metadata: S.kv.meta.get(hk) || {} });
    }
    const pp = await newPage({ width: 390, height: 844 });
    const cnt = { chat: 0, list: 0, act: 0, max: 0 };
    pp.on("request", r => { const u = new URL(r.url()); if (u.pathname === "/api/inbox/chat") { cnt.chat++; cnt.act++; cnt.max = Math.max(cnt.max, cnt.act); } else if (u.pathname === "/api/inbox/list") cnt.list++; });
    const fin = r => { if (new URL(r.url()).pathname === "/api/inbox/chat") cnt.act--; };
    pp.on("requestfinished", fin); pp.on("requestfailed", fin);
    const reset = () => { cnt.chat = 0; cnt.list = 0; cnt.max = 0; };
    await pp.goto(url + "/inbox?c=kairat&key=" + OWNER); await pp.waitForSelector("#rows a.row");
    await pp.waitForTimeout(4500);
    ok("опрос чата: пока чат не открыт, /api/inbox/chat не запрашивается", cnt.chat === 0, String(cnt.chat));
    await pp.click(".chip:text-is('Все')"); await pp.locator("#rows a.row", { hasText: "Опрос Три" }).click(); await pp.waitForSelector("#msgs .m");
    await pp.waitForTimeout(300); reset();
    const M0 = await pp.evaluate(() => { const m = document.getElementById("msgs"); m.querySelector(".m").__same = 1; return m.scrollTop > 0; });
    await pp.waitForTimeout(7000);
    ok("опрос чата: за 7 с при открытом чате и видимой вкладке — 2–4 запроса переписки, списка не больше одного", cnt.chat >= 2 && cnt.chat <= 4 && cnt.list <= 1, JSON.stringify(cnt));
    ok("опрос чата: чат открылся прокрученным вниз", M0 === true);
    ok("опрос чата: если ничего не изменилось, переписка не перерисовывается", await pp.evaluate(() => document.getElementById("msgs").querySelector(".m").__same === 1));

    // новое входящее появляется само
    const t1 = Date.now(); await wa({ c: "kairat", from: PID, name: "Опрос Три", text: "Новое входящее раз" });
    await pp.waitForFunction(() => /Новое входящее раз/.test(document.getElementById("msgs").textContent), null, { timeout: 6000 });
    const dt = Date.now() - t1;
    ok("опрос чата: новое входящее появилось в открытом чате за ≤ 4 с без ручного обновления", dt <= 4000, dt + " мс");
    ok("опрос чата: чат был внизу — остался внизу", await pp.evaluate(() => { const m = document.getElementById("msgs"); return m.scrollHeight - m.scrollTop - m.clientHeight < 80; }));

    // черновик и прокрутка вверх не сбрасываются
    await pp.fill("#txt", "мой черновик ответа");
    await pp.evaluate(() => { document.getElementById("msgs").scrollTop = 0; });
    await pp.waitForTimeout(200);
    await wa({ c: "kairat", from: PID, name: "Опрос Три", text: "Новое входящее два" });
    await pp.waitForFunction(() => /Новое входящее два/.test(document.getElementById("msgs").textContent), null, { timeout: 6000 });
    ok("опрос чата: черновик в поле ответа сохранился после обновления переписки", (await pp.inputValue("#txt")) === "мой черновик ответа");
    ok("опрос чата: читаете старое выше — прокрутка не прыгает вниз", await pp.evaluate(() => document.getElementById("msgs").scrollTop < 5), String(await pp.evaluate(() => document.getElementById("msgs").scrollTop)));
    await pp.evaluate(() => { const m = document.getElementById("msgs"); m.scrollTop = m.scrollHeight; });
    await pp.waitForTimeout(200);
    await wa({ c: "kairat", from: PID, name: "Опрос Три", text: "Новое входящее три" });
    await pp.waitForFunction(() => /Новое входящее три/.test(document.getElementById("msgs").textContent), null, { timeout: 6000 });
    await pp.waitForTimeout(400);
    ok("опрос чата: внизу и пришло новое — прокрутка идёт вниз вместе с ним", await pp.evaluate(() => { const m = document.getElementById("msgs"); return m.scrollHeight - m.scrollTop - m.clientHeight < 80; }));

    // скрытая вкладка: переписка не запрашивается; при возврате — снова
    await pp.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
    await pp.waitForTimeout(400); reset();
    await pp.waitForTimeout(7000);
    ok("опрос чата: вкладка скрыта — запросов переписки нет", cnt.chat === 0, String(cnt.chat));
    await pp.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event("visibilitychange")); });
    await pp.waitForTimeout(4000);
    ok("опрос чата: вкладка снова видна — опрос возобновился", cnt.chat >= 1, String(cnt.chat));

    // медленный сервер: запросы не накладываются
    await pp.waitForTimeout(300);
    await pp.route("**/api/inbox/chat*", async r => { await new Promise(x => setTimeout(x, 3600)); await r.continue(); });
    await pp.waitForTimeout(3500); reset(); // дождались завершения уже идущих запросов
    await pp.waitForTimeout(11000);
    ok("опрос чата: сервер отвечает медленнее интервала — запросы не накладываются (одновременно не больше одного)", cnt.max <= 1 && cnt.chat >= 1, JSON.stringify(cnt));
    await pp.unroute("**/api/inbox/chat*");

    // закрыли чат — опрос чата остановлен
    await pp.waitForTimeout(4000);
    await pp.click("#back"); await pp.waitForTimeout(500); reset();
    await pp.waitForTimeout(4500);
    ok("опрос чата: чат закрыт — запросов переписки больше нет", cnt.chat === 0, String(cnt.chat));
    await pp.context().close();
  }

  // ---- страницы заявок и выхода
  await st.goto(url + "/leads");
  ok("сотрудник видит заявки своего клиента", /Barber House/.test(await st.locator("body").innerText()) && !/Демо Дент/.test(await st.locator("body").innerText()));
  await p.goto(url + "/logout");
  await p.goto(url + "/studio");
  ok("после выхода страница владельца закрыта", /\/login/.test(p.url()));
  ok("в браузере нет ошибок JavaScript", errors.length === 0, errors.join(" | "));
} catch (e) {
  ok("сценарий в браузере дошёл до конца", false, String((e && e.stack) || e).slice(0, 1200) + (errors.length ? " | " + errors.join(" | ") : ""));
} finally {
  await browser.close(); server.close(); globalThis.fetch = realFetch;
}
console.log(`\nБраузер: прошло ${T.pass}, не прошло ${T.fail}`);
process.exit(T.fail ? 1 : 0);
