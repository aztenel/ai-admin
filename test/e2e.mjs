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
const newPage = async (viewport = { width: 390, height: 844 }) => {
  const ctx = await browser.newContext({ viewport, locale: "ru-RU" });
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
  const st = await newPage();
  await st.goto(url + "/inbox?c=kairat#wa:77051110001");
  await st.fill("input[name=key]", staffKey); await st.click("button");
  await st.waitForSelector("#msgs .m");
  ok("сотрудник после входа попадает сразу в чат из ссылки", /#wa:77051110001$/.test(st.url()) && /Данияр/.test(await st.locator("#cname").innerText()));
  const stateText = await st.locator("#cstate").innerText();
  ok("в шапке чата — номер и состояние бота", /\+77051110001/.test(stateText) && /бот молчит до/.test(stateText), stateText);
  ok("в чате видны сообщения клиента, ответ бота и голосовое с проигрывателем", await st.locator("#msgs .m.u").count() >= 3 && await st.locator("#msgs .m.b").count() >= 1 && await st.locator("#msgs audio").count() === 1);
  await shot(st, "07-inbox-chat");
  await st.fill("#txt", "Здравствуйте, Данияр! Это администратор, чем помочь?"); await st.click("#send");
  await st.waitForSelector("#msgs .m.a");
  ok("ответ администратора появился в чате и ушёл клиенту", /Это администратор/.test(await st.locator("#msgs .m.a").last().innerText()) && S.sentTo("77051110001").some(x => /Это администратор/.test(x)));
  await shot(st, "08-inbox-replied");
  await st.click("text=Вернуть бота");
  await st.waitForFunction(() => /отвечает бот/.test(document.getElementById("cstate").textContent));
  ok("«Вернуть бота» — состояние сменилось на «отвечает бот»", true);
  await st.click("#back");
  await st.waitForSelector("#rows .r, #rows .empty");
  await st.click("#t_all");
  await st.waitForFunction(() => document.querySelectorAll("#rows .r").length >= 2);
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
  await w.waitForSelector("#rows .r");
  ok("вход по ссылке с ключом: ключ из адреса убран", !w.url().includes("key="));
  await w.click("#rows .r");
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
  ok("владелец видит ссылку «Боты» в пульте", await w.locator("#l_st").isVisible());

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
  await v.click("#t_all"); await v.waitForSelector("#rows .r");
  const rowOf = n => v.locator(`#rows .r:has(.h b:text-is("${n}"))`);
  await rowOf("Данияр").click(); await v.waitForFunction(() => document.getElementById("cname").textContent === "Данияр");
  await v.fill("#txt", "черновик для Данияра");
  await rowOf("Айгерим").click(); await v.waitForFunction(() => document.getElementById("cname").textContent === "Айгерим");
  ok("черновик ответа не переезжает в другой чат", (await v.inputValue("#txt")) === "");
  await rowOf("Данияр").click(); await v.waitForFunction(() => document.getElementById("cname").textContent === "Данияр");
  ok("…а при возвращении в чат черновик на месте", (await v.inputValue("#txt")) === "черновик для Данияра");
  let slow = true;
  await v.route(u => u.pathname === "/api/inbox/chat" && u.searchParams.get("id") === "77051110001", async r => { if (slow) { slow = false; await new Promise(x => setTimeout(x, 1500)); } await r.continue(); });
  await rowOf("Айгерим").click(); await rowOf("Данияр").click(); await rowOf("Айгерим").click(); // Данияр открыт и не дождались; ответ сервера придёт позже
  await v.waitForTimeout(2200);
  ok("запоздавший ответ сервера не перерисовывает чужой чат", (await v.locator("#cname").innerText()) === "Айгерим");
  await v.unroute(u => u.pathname === "/api/inbox/chat" && u.searchParams.get("id") === "77051110001");
  const toD0 = S.sentTo("77051110001").length, toA0 = S.sentTo("77051110002").length;
  await v.fill("#txt", "Ответ Айгерим про запись"); await v.click("#send"); await v.waitForSelector("#msgs .m.a >> text=Ответ Айгерим про запись");
  ok("ответ ушёл тому, чей чат на экране", S.sentTo("77051110002").length === toA0 + 1 && S.sentTo("77051110001").length === toD0 && /Ответ Айгерим/.test(S.sentTo("77051110002").at(-1)));
  // отправка уходит адресату на момент нажатия, даже если чат успели сменить до ответа сервера
  await rowOf("Данияр").click(); await v.waitForFunction(() => document.getElementById("cname").textContent === "Данияр");
  await v.fill("#txt", "Данияр, ждём вас");
  await v.route("**/api/inbox/send", async r => { await new Promise(x => setTimeout(x, 800)); await r.continue(); });
  await v.click("#send"); await rowOf("Айгерим").click();
  await v.waitForTimeout(1500);
  ok("медленная отправка: ответ ушёл Данияру, а экран остался на открытом чате", S.sentTo("77051110001").some(x => /Данияр, ждём вас/.test(x)) && (await v.locator("#cname").innerText()) === "Айгерим" && !(await v.locator("#msgs").innerText()).includes("Данияр, ждём вас"));
  await v.unroute("**/api/inbox/send");
  // чат с заявкой: «Готово» не прячет чат, а «отправить клиенту» не предлагается там, где писать нельзя
  const webSid = [...S.kv.mem.keys()].find(k => k.startsWith("h:web:kairat:")).split(":").pop();
  await v.goto("about:blank"); await v.goto(url + "/inbox?c=kairat#web:" + webSid); await v.waitForSelector(".rq");
  ok("чат с сайта: заявка видна, кнопки «Готово — убрать» нет", !(await v.locator("#acts").innerText()).includes("Готово — убрать"));
  await v.click(".rq >> text=Позвонил и подтвердил");
  await v.waitForFunction(() => !document.querySelector(".rq"));
  ok("чат с сайта: «Отправить клиенту и закрыть» не предлагается, заявка закрывается без сообщения", !(await v.locator("body").innerText()).includes("Отправить клиенту и закрыть") && S.leads("kairat").some(l => l.status === "выполнена"));
  await wa({ c: "kairat", from: "77051110009", name: "Тимур", text: "Тимур, +7 705 111 22 77, завтра в 12:00" });
  { const k = "h:wa:kairat:77051110009", h = S.kv.json(k), old = Date.now() - 26 * 3600e3; h.profile.li = old; await S.kv.api.put(k, JSON.stringify(h), { metadata: { ...(S.kv.meta.get(k) || {}), li: old } }); }
  await v.goto("about:blank"); await v.goto(url + "/inbox?c=kairat#wa:77051110009"); await v.waitForSelector(".rq");
  ok("чат старше 24 часов с заявкой: «Готово — убрать» скрыта", !(await v.locator("#acts").innerText()).includes("Готово — убрать"));
  await v.click(".rq .btn.p");
  ok("чат старше 24 часов: сразу закрытие без «Отправить клиенту»", !(await v.locator(".rq textarea").count()) && !(await v.locator("body").innerText()).includes("Отправить клиенту и закрыть"));
  await v.route("**/api/inbox/list*", r => r.abort());
  await v.evaluate(() => list());
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
