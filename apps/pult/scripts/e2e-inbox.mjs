// Проверка чатов нового пульта по ТЗ Winchester v2.0 (P0) в настоящем браузере (Chromium через Playwright), на НАСТОЯЩЕМ коде бота
// с заглушками (scripts/dev-live.mjs). Второй номер Winchester (Green-API, бот выключен):
//   очередь «Нужен ответ» (исходящее без ответа — не в очереди, «спасибо» — не повод), разделы «Записи», «Ответы», «Мои», «Готово»;
//   ответ сотрудника с его именем и галочками по вебхукам статусов; «Готово» при неотвеченном вопросе — с подтверждением;
//   голосовое (плеер, скорость), фото (просмотр на весь экран), документ (имя, скачать); карточка: номер компании, ответ на
//   напоминание, ближайшая запись Altegio; нет «бот выключен» в каждом чате и «Оператор, с телефона».
// «Полноценные чаты» (31.10.2026, сценарии ТЗ 1, 2, 3, 7): ответ цитатой (долгое нажатие на телефоне, «⋯» на компьютере), «Копировать»
// (буфер обмена), видео на весь экран, документ Word скачивается, фото и PDF от сотрудника — по одному, у каждого «Отправлено», оба
// открываются; Green-API ответил 500 — «не знаем, ушло ли», ровно один запрос; у основного номера (Meta) нет скрепки и «Ответить».
// Финальная доработка (02.11.2026): фильтры «Все» (по умолчанию) · «Нужен ответ» со счётчиком · «Готово» и меню «Ещё» (Записи, Ответы,
// Мои); снизу на телефоне — Чаты, Рассылки, Клиенты, Настройки, «Заявки» — кнопкой в списке; голосовое из пульта (микрофон-заглушка
// Chromium: запись, таймер, прослушивание, двойное нажатие — одна отправка, Ogg Opus «voice-….ogg»; путь iPhone — запись M4A уходит
// аудиофайлом с пометкой; нет доступа к микрофону; запись прервалась — записанное остаётся); «Удалить у меня» и «Удалить у всех»
// (подтверждение, один запрос deleteMessage, после перезагрузки так же); «прочитано» у двух сотрудников (общее только с D1).
// Снимки 390×844 (как iPhone 14/15, вырез и «полоска Домой» нарисованы) и 1280×800, светлая и тёмная тема.
// Это Chromium в размере iPhone, а не Safari на iPhone: на настоящем телефоне не проверено.
// Запуск: node scripts/e2e-inbox.mjs [папка для снимков]
import { mkdirSync } from "node:fs";

process.env.CLOCK ||= "real";
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright/index.mjs");
const OUT = process.argv[2] || "/tmp/claude-0/-home-user/eacf866f-6d8c-5152-bdf5-ad49eed8555f/scratchpad/inbox";
mkdirSync(OUT, { recursive: true });

const results = [];
function ok(name, cond, info = "") {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}${!cond && info ? ` — ${info}` : ""}`);
  return !!cond;
}

const { startDevLive } = await import("./dev-live.mjs");
const dl = await startDevLive({ port: 0 });
const { net, gaPass, pngFace } = await import(new URL("../../../test/harness.mjs", import.meta.url).href);
const S = dl.bot.S;
const GAW = { id: "1101000002", token: "ga-token-winch" };
const SHIFT = Date.now() - (performance.timeOrigin + performance.now());
// точка сети пульта (живая проверка стенда 01.11.2026): вебхуки Green-API пишет одна точка сети Cloudflare, пульт читает другая —
// список ключей KV там отстаёт до 60 с, чтение переписки — до 30 с. edge.view — снимок переписок второго номера до события (take):
// пока он задан, список отдаёт снимок, а с edge.getOld — и чтение переписки. Вебхук при этом пишет по-настоящему
const EDGE_PRE = "h:ga:winchester:", kvGet = S.kv.api.get, kvList = S.kv.api.list, edge = { view: null, getOld: false };
const take = () => ({ mem: new Map([...S.kv.mem].filter(([k]) => k.startsWith(EDGE_PRE))), meta: new Map([...S.kv.meta].filter(([k]) => k.startsWith(EDGE_PRE))) });
S.kv.api.get = async (k, ...rest) => (edge.view && edge.getOld && k.startsWith(EDGE_PRE) ? edge.view.mem.get(k) ?? null : kvGet(k, ...rest));
S.kv.api.list = async (o = {}, ...rest) => {
  const p = String(o.prefix || ""), v = edge.view;
  if (!v || !p.startsWith(EDGE_PRE)) return kvList(o, ...rest);
  const all = [...v.mem.keys()].filter((k) => k.startsWith(p)).sort();
  return { keys: all.map((name) => (v.meta.has(name) ? { name, metadata: v.meta.get(name) } : { name })), list_complete: true };
};
const listPoll = async (page) => { await page.evaluate(() => window.dispatchEvent(new Event("online"))); await page.waitForTimeout(900); }; // опрос списка — как по таймеру
const chatTick = (page) => page.waitForTimeout(6000); // таймер открытого чата — 5 с

// ---------- переписки второго номера (вымышленные номера +7 700 111 2x xx) ----------
let n = 0;
const hook = (body) => S.call(`/ga/winchester?t=${gaPass("winchester", GAW)}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ instanceData: { idInstance: +GAW.id, wid: "77000000077@c.us" }, timestamp: Math.floor(Date.now() / 1000), ...body }) });
const inMsg = (from, md, name = "") => hook({ typeWebhook: "incomingMessageReceived", idMessage: `E2E-${++n}`, senderData: { chatId: from + "@c.us", sender: from + "@c.us", senderName: name }, messageData: md });
const text = (from, t, name) => S.gaText("winchester", GAW, from, t, { name: name || "" });
// 1-секундный звук WAV — его играет Chromium (настоящие голосовые WhatsApp — Ogg Opus, на старом iPhone пульт их расшифровывает)
function tone() {
  const rate = 8000, len = rate, b = Buffer.alloc(44 + len * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + len * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(len * 2, 40);
  for (let i = 0; i < len; i++) b.writeInt16LE(Math.round(Math.sin(i / 6) * 8000), 44 + i * 2);
  return b;
}
const WAV = tone();
// видео WebM записывает сам Chromium (MediaRecorder с холста) перед проверкой: его он и воспроизводит
let WEBM = Buffer.alloc(0);
const DOCX = Buffer.from("PK\u0003\u0004 e2e-docx"); // начало zip, как у файла Word: скачивается, а не открывается
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** файл заглушки с поддержкой Range (Safari и Chromium так читают аудио и видео) */
function served(buf, type, init) {
  const m = /bytes=(\d+)-(\d*)/.exec(init?.headers?.range || "");
  if (m) { const a = +m[1], e = m[2] ? Math.min(+m[2], buf.length - 1) : buf.length - 1; return new Response(buf.subarray(a, e + 1), { status: 206, headers: { "content-type": type, "content-range": `bytes ${a}-${e}/${buf.length}`, "content-length": String(e - a + 1) } }); }
  return new Response(buf, { headers: { "content-type": type, "content-length": String(buf.length) } });
}
net.mediaReply = (url, init) => {
  if (!url.startsWith("https://media.green-api.test/")) return null;
  if (url.endsWith(".wav")) return served(WAV, "audio/wav", init);
  if (url.endsWith(".webm")) return served(WEBM, "video/webm", init);
  if (url.endsWith(".docx")) return served(DOCX, DOCX_TYPE, init);
  if (url.endsWith(".png")) return new Response(pngFace(url), { headers: { "content-type": "image/png" } });
  if (url.endsWith(".pdf")) return new Response("%PDF-1.4\n%…\n", { headers: { "content-type": "application/pdf" } });
  // голосовое из пульта: заглушка Green-API отдаёт тот самый файл, который ей загрузили (его и слушает пульт)
  if (url.startsWith("https://media.green-api.test/out/") && /\.(ogg|m4a)$/.test(url)) {
    const rec = [...net.ga].reverse().find((x) => x.op === "sendFileByUpload" && x.form && url.endsWith("/" + encodeURIComponent(x.form.fileName)));
    if (rec) return rec.form.file.blob.arrayBuffer().then((ab) => served(Buffer.from(ab), url.endsWith(".ogg") ? "audio/ogg" : "audio/mp4", init));
  }
  return new Response("gone", { status: 403 });
};
const uploads = () => net.ga.filter((x) => x.op === "sendFileByUpload");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const A = "77001112101", B = "77001112102", C = "77001112103", D = "77001112104", E = "77001112105", F = "77000002011", G = "77001112106";
// A: ответил на напоминание просьбой перенести
await S.kv.api.put(`h:ga:winchester:${A}`, JSON.stringify({ n: 1, turns: [{ role: "model", text: "Напоминаем: завтра в 15:00 у мастера Тони. Ждём вас в Winchester!", t: Date.now() - 3 * 3600e3, rm: "d1", mid: "RM-A", st: "read" }], profile: { waName: "Арман" } }));
await text(A, "Спасибо!");
await text(A, "А можно перенести на 17:00?");
// B: голосовое и фото
await inMsg(B, { typeMessage: "audioMessage", fileMessageData: { downloadUrl: "https://media.green-api.test/voice.wav", mimeType: "audio/wav" } }, "Данияр");
await inMsg(B, { typeMessage: "imageMessage", fileMessageData: { downloadUrl: "https://media.green-api.test/photo.png", mimeType: "image/png", caption: "" } }, "Данияр");
await inMsg(B, { typeMessage: "videoMessage", fileMessageData: { downloadUrl: "https://media.green-api.test/clip.webm", mimeType: "video/webm", caption: "" } }, "Данияр");
// C: документы — PDF (открывается) и Word (скачивается)
await inMsg(C, { typeMessage: "documentMessage", fileMessageData: { downloadUrl: "https://media.green-api.test/price.pdf", mimeType: "application/pdf", fileName: "Прайс.pdf" } }, "Ерлан");
await inMsg(C, { typeMessage: "documentMessage", fileMessageData: { downloadUrl: "https://media.green-api.test/form.docx", mimeType: DOCX_TYPE, fileName: "Анкета.docx" } }, "Ерлан");
// G: новый клиент пишет на второй номер — сотрудник отвечает цитатой и отправляет файлы («Полноценные чаты», 31.10.2026)
await S.gaText("winchester", GAW, G, "Здравствуйте! Есть время завтра после обеда?", { name: "Асель", idMessage: "E2E-G-1" });
// D: ответили с телефона, клиент поблагодарил — отвечать нечего
await text(D, "Есть время сегодня после 18?", "Тимур");
await hook({ typeWebhook: "outgoingMessageReceived", idMessage: "PH-D", senderData: { chatId: D + "@c.us", sender: "77000000077@c.us" }, messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "Да, в 18:30 у Рауана" } } });
await hook({ typeWebhook: "outgoingMessageStatus", chatId: D + "@c.us", idMessage: "PH-D", status: "read", sendByApi: false });
await text(D, "Спасибо 👍");
// E: только наше приглашение с телефона — клиент не ответил
await hook({ typeWebhook: "outgoingMessageReceived", idMessage: "PH-E", senderData: { chatId: E + "@c.us", sender: "77000000077@c.us" }, messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "Добрый день! Давно вас не было — запишем?" } } });
// F: спрашивает время своей записи (у него в журнале Altegio запись через 3 дня)
await text(F, "Напомните, во сколько я записан?", "Канат");
await S.settle?.();

// ---------- браузер ----------
// микрофон-заглушка Chromium: запись голосового без настоящего микрофона и без окна «разрешить микрофон»
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
{ // короткое видео WebM (VP8) с холста — настоящий файл, который Chromium воспроизводит
  const p = await browser.newPage();
  const b64 = await p.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 160; c.height = 120;
    const g = c.getContext("2d"), st = c.captureStream(15), rec = new MediaRecorder(st, { mimeType: "video/webm;codecs=vp8" }), parts = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    let i = 0; const tick = setInterval(() => { g.fillStyle = `hsl(${(i++ * 37) % 360},70%,50%)`; g.fillRect(0, 0, 160, 120); }, 50);
    rec.start(100); await new Promise((r) => setTimeout(r, 900)); rec.stop(); await new Promise((r) => (rec.onstop = r)); clearInterval(tick);
    const u = new Uint8Array(await new Blob(parts, { type: "video/webm" }).arrayBuffer());
    let s = ""; for (let k = 0; k < u.length; k++) s += String.fromCharCode(u[k]);
    return btoa(s);
  });
  WEBM = Buffer.from(b64, "base64");
  await p.close();
}
// долгое нажатие пальцем: pointerdown (touch) → 600 мс → pointerup, как на телефоне
async function longPress(page, loc) {
  const b = await loc.boundingBox();
  const at = { pointerType: "touch", isPrimary: true, pointerId: 7, clientX: b.x + b.width / 2, clientY: b.y + Math.min(b.height / 2, 20), bubbles: true };
  await loc.dispatchEvent("pointerdown", at);
  await page.waitForTimeout(600);
  await loc.dispatchEvent("pointerup", at);
}
// «⋯» у сообщения на компьютере: навести на сообщение, нажать «Действия с сообщением»
async function msgMenu(page, bubble) {
  await bubble.hover();
  await bubble.locator("xpath=..").getByRole("button", { name: "Действия с сообщением" }).click();
}
const ticks = (page, name) => page.locator("[role=log]").getByRole("img", { name });
function shiftClock(shift) {
  if (!shift) return;
  const Real = Date, now = () => Real.now() + shift;
  globalThis.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(now()); } static now() { return now(); } };
}
function iphoneSafeArea() {
  document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ":root{--safe-t:47px;--safe-b:34px}"; document.head.appendChild(s); });
}
/** пульт свёрнут (hidden = true) или снова на экране — как при смене приложения на телефоне */
const setHidden = (page, hidden) => page.evaluate((h) => {
  for (const [k, v] of [["hidden", h], ["visibilityState", h ? "hidden" : "visible"]]) Object.defineProperty(document, k, { configurable: true, get: () => v });
  document.dispatchEvent(new Event("visibilitychange"));
}, hidden);
async function session(vp, scheme, tag, op = "") {
  const phone = vp.width < 500;
  const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone, locale: "ru-RU", timezoneId: "Asia/Almaty" });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write", "microphone"], { origin: new URL(dl.app).origin }); // «Копировать» — буфер обмена; голосовое — микрофон
  await ctx.addInitScript(shiftClock, SHIFT);
  if (phone) await ctx.addInitScript(iphoneSafeArea);
  if (op) await ctx.addInitScript((o) => localStorage.setItem("pult.op", o), op);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
  await page.goto(`${dl.app}?c=winchester`);
  await page.waitForURL(/\/login/);
  await page.fill("input[name=key]", dl.OWNER);
  await page.click("button");
  await page.waitForURL(/\/app\//);
  await page.waitForLoadState("networkidle");
  return { page, ctx, tag, phone, errs, shot: async (name) => page.screenshot({ path: `${OUT}/${tag}-${name}.png` }) };
}
const row = (page, name) => page.locator("ul a[href^='#/inbox/']").filter({ hasText: name });
// «Записи», «Ответы», «Мои» — в меню «Ещё» (02.11.2026); остальные — капсулы на виду
const MORE_TABS = new Set(["Записи", "Ответы", "Мои"]);
const moreBtn = (page) => page.getByRole("button", { name: /^(Другие разделы|Раздел )/ });
const tab = (page, label) => MORE_TABS.has(label)
  ? { click: async () => { await moreBtn(page).click(); await page.getByRole("menuitemradio", { name: new RegExp("^" + label) }).click(); await page.waitForTimeout(150); } }
  : page.getByRole("radio", { name: new RegExp("^" + label) });

async function phoneRun(scheme) {
  const t = await session({ width: 390, height: 844 }, scheme, `390-${scheme}`, "Айгерим");
  const { page } = t;
  const tag = t.tag;
  await page.waitForSelector("ul a[href^='#/inbox/']");
  // порядок разделов (02.11.2026): «Все» первым и по умолчанию, «Нужен ответ» вторым — с красным счётчиком, «Готово» третьим, остальное — «Ещё»
  const radios = await page.getByRole("radiogroup", { name: "Фильтр" }).getByRole("radio").allInnerTexts();
  ok(`${tag}: разделы — «Все», «Нужен ответ» со счётчиком, «Готово»`, radios.length === 3 && radios[0].trim() === "Все" && /^Нужен ответ\s*\d+$/.test(radios[1].replace(/\s+/g, " ").trim()) && radios[2].trim() === "Готово", JSON.stringify(radios));
  ok(`${tag}: по умолчанию — «Все»`, await tab(page, "Все").getAttribute("aria-checked") === "true");
  await moreBtn(page).click();
  const more = await page.getByRole("menuitemradio").allInnerTexts();
  ok(`${tag}: в «Ещё» — Записи, Ответы, Мои`, more.length === 3 && /^Записи/.test(more[0]) && /^Ответы/.test(more[1]) && /^Мои/.test(more[2]), JSON.stringify(more));
  await page.keyboard.press("Escape");
  const nav = await page.locator("nav[aria-label='Разделы']").last().getByRole("link").allInnerTexts();
  ok(`${tag}: снизу — Чаты, Рассылки, Клиенты, Настройки`, JSON.stringify(nav.map((x) => x.replace(/\d+/g, "").trim())) === JSON.stringify(["Чаты", "Рассылки", "Клиенты", "Настройки"]), JSON.stringify(nav));
  await page.getByRole("link", { name: "Заявки" }).click();
  await page.waitForTimeout(500);
  ok(`${tag}: «Заявки» — кнопкой в списке чатов, открываются`, /#\/requests/.test(page.url()) && (await page.locator("nav[aria-label='Разделы']").last().getByRole("link", { name: /Чаты/ }).getAttribute("aria-current")) === "page");
  await t.shot("0-requests");
  await page.locator("nav[aria-label='Разделы']").last().getByRole("link", { name: /Чаты/ }).click();
  await page.waitForSelector("ul a[href^='#/inbox/']");
  await t.shot("0-list-all-default");
  await tab(page, "Нужен ответ").click();
  const listText = await page.locator("section[aria-label='Чаты']").innerText();
  ok(`${tag}: в очереди просьба перенести (ответ на напоминание), голосовое, документ, «во сколько я записан»`, /Просит перенести/.test(listText) && /Прислал файл/.test(listText) && /Спрашивает время записи/.test(listText), listText.slice(0, 400));
  ok(`${tag}: «спасибо» после ответа с телефона — не в очереди`, !(await row(page, "Тимур").count()));
  ok(`${tag}: в строках нет «Бот выключен»`, !/Бот выключен/.test(listText));
  await tab(page, "Записи").click();
  ok(`${tag}: «Записи» — перенос и время записи, без голосового`, (await row(page, "Арман").count()) === 1 && (await row(page, "Канат").count()) === 1 && !(await row(page, "Данияр").count()));
  await tab(page, "Ответы").click();
  ok(`${tag}: «Ответы» — только ответ на напоминание`, (await row(page, "Арман").count()) === 1 && (await page.locator("ul a[href^='#/inbox/']").count()) === 1);
  await tab(page, "Все").click();
  ok(`${tag}: «Все» — с «спасибо», без чата только с нашим приглашением`, (await row(page, "Тимур").count()) === 1 && /Ещё \d+: писали только мы/.test(await page.locator("section[aria-label='Чаты']").innerText()));
  await t.shot("1-list-all");
  await tab(page, "Нужен ответ").click();
  await t.shot("1-list-waiting");

  // голосовое и фото
  await row(page, "Данияр").first().click();
  await page.waitForSelector("[role=log]");
  const play = page.getByRole("button", { name: "Слушать голосовое" });
  ok(`${tag}: голосовое — плеер с кнопкой и скоростью`, (await play.count()) === 1 && (await page.getByRole("button", { name: /Скорость 1×/ }).count()) === 1);
  await play.click();
  await page.waitForTimeout(400);
  ok(`${tag}: голосовое играет (пауза доступна)`, (await page.getByRole("button", { name: "Пауза" }).count()) === 1 || /0:01/.test(await page.locator("[role=log]").innerText()));
  await page.getByRole("button", { name: /Скорость/ }).click();
  ok(`${tag}: скорость 1,5×`, (await page.getByRole("button", { name: "Скорость 1.5×" }).count()) === 1);
  await t.shot("2-voice-photo");
  await page.getByRole("button", { name: "Открыть фото" }).click();
  ok(`${tag}: фото — на весь экран`, (await page.getByRole("dialog", { name: "Фото" }).count()) === 1);
  await t.shot("3-photo-full");
  await page.getByRole("button", { name: "Закрыть" }).click();
  // ответ сотрудника с его именем → галочки по статусам Green-API
  await page.getByLabel("Ответ клиенту").fill("Здравствуйте! Фото получили, запишем на завтра в 15:00?");
  await page.getByRole("button", { name: /Отправить/ }).click();
  await page.waitForTimeout(700);
  const log = page.locator("[role=log]");
  ok(`${tag}: ответ подписан именем сотрудника`, /Айгерим/.test(await log.innerText()));
  ok(`${tag}: одна галочка — «Отправлено»`, (await log.getByRole("img", { name: "Отправлено" }).count()) >= 1);
  const h = S.hist("ga", "winchester", B), mine = h.turns.filter((x) => x.by === "admin").at(-1);
  // живая проверка на стенде 01.11.2026: входящие и галочки приходили в пульт через минуту-две, часто только после обновления
  // страницы, а в WhatsApp — сразу (точка сети пульта — edge, выше). Ничего не нажимаем: «Обновить» и перезагрузка страницы не нужны —
  // открытый чат пульт перечитывает сам раз в 5 с
  // (1) «доставлено»: список ещё старый, переписка уже новая — список ничего не меняет, чат догоняет сам. Сначала опрос списка после
  // отправки: первый опрос после ответа и так перечитывает чат (время строки сменилось) — здесь проверяем то, что после него
  await listPoll(page);
  let snap = take();
  await hook({ typeWebhook: "outgoingMessageStatus", chatId: B + "@c.us", idMessage: mine.mid, status: "delivered", sendByApi: true });
  edge.view = snap; edge.getOld = false;
  await listPoll(page);
  await chatTick(page);
  ok(`${tag}: список ещё старый — открытый чат сам «Доставлено» (без «Обновить»)`, (await log.getByRole("img", { name: "Доставлено" }).count()) >= 1);
  edge.view = null;
  // (2) клиент ответил, пока чат открыт: сначала и список, и переписка старые, потом переписка обновилась, список — ещё нет
  snap = take();
  await text(B, "Отлично, приду к 15:00");
  edge.view = snap; edge.getOld = true;
  await listPoll(page);
  await chatTick(page);
  if (process.env.CHAT_STORE === "d1") ok(`${tag}: переписки в D1 — старой копии у пульта нет: новое сообщение уже в чате`, /приду к 15:00/.test(await log.innerText()));
  else ok(`${tag}: (проверка заглушки) пока у пульта старая копия — нового сообщения нет`, !/приду к 15:00/.test(await log.innerText()));
  edge.getOld = false;
  await chatTick(page);
  ok(`${tag}: входящее появилось в открытом чате само, хотя список ещё старый`, /приду к 15:00/.test(await log.innerText()));
  edge.view = null;
  await listPoll(page);
  // (3) «прочитано»: и список, и переписка у пульта старые — галочки из D1 (она согласована сразу)
  await page.getByLabel("Ответ клиенту").fill("Ждём вас!");
  await page.getByRole("button", { name: /Отправить/ }).click();
  await page.waitForTimeout(700);
  const mine2 = S.hist("ga", "winchester", B).turns.filter((x) => x.by === "admin").at(-1);
  await listPoll(page);
  snap = take();
  await hook({ typeWebhook: "outgoingMessageStatus", chatId: B + "@c.us", idMessage: mine2.mid, status: "read", sendByApi: true });
  edge.view = snap; edge.getOld = true;
  await listPoll(page);
  await chatTick(page);
  ok(`${tag}: и список, и переписка у пульта старые — «Прочитано» (две синие) из D1`, (await log.getByRole("img", { name: "Прочитано" }).count()) >= 1);
  edge.view = null; edge.getOld = false;
  const head = await page.locator("section[aria-label^='Переписка'] header").innerText();
  ok(`${tag}: в шапке — второй номер и кто ведёт`, /Второй WhatsApp/.test(head) && /ведёт вы/.test(head), head);
  ok(`${tag}: нет «Бот в этой компании выключен» и «Оператор, с телефона»`, !/Бот в этой компании выключен|Оператор, с телефона/.test(await page.content()));
  await t.shot("4-chat-ticks");
  // «Скорость чатов» (Настройки → Диагностика): живой замер стенда 01.11.2026 считал и время, пока пульт был свёрнут (свёрнутый пульт
  // сервер не спрашивает), — галочки «через 39 с» оказались временем на телефоне Б. Такое событие не считается; одно — один замер
  const vis = (hidden) => page.evaluate((h) => {
    for (const [k, v] of [["hidden", h], ["visibilityState", h ? "hidden" : "visible"]]) Object.defineProperty(document, k, { configurable: true, get: () => v });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await vis(true);
  await text(B, "Пишу, пока пульт свёрнут");
  await page.waitForTimeout(1500);
  await vis(false);
  await page.waitForTimeout(2000);
  ok(`${tag}: вернулись в пульт — сообщение, пришедшее пока он был свёрнут, сразу в чате`, /пока пульт свёрнут/.test(await log.innerText()));
  await chatTick(page);
  await page.evaluate(() => { location.hash = "#/settings/diagnostics"; });
  await page.waitForTimeout(1200);
  const away = await page.getByText(/не посчитано: \d+/).first().innerText().catch(() => "");
  ok(`${tag}: скорость — сообщение, пришедшее пока пульт был свёрнут, не посчитано`, /не посчитано: 1\)/.test(away), away.slice(0, 300));
  const pollRow = await page.getByRole("list", { name: "Скорость чатов" }).locator("li", { hasText: "Проверка открытого чата" }).innerText().catch(() => "");
  ok(`${tag}: скорость — строка «Проверка открытого чата» с замерами`, /замеров \d+/.test(pollRow), pollRow.replace(/\s+/g, " "));
  await page.evaluate(() => { location.hash = "#/inbox"; });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Назад к чатам" }).first().click().catch(() => {});

  // ответ на напоминание: карточка, «Готово» с подтверждением
  await row(page, "Арман").first().click();
  await page.waitForSelector("[role=log]");
  ok(`${tag}: напоминание подписано и с галочками`, /Напоминание/.test(await page.locator("[role=log]").innerText()));
  await page.getByRole("button", { name: /карточка клиента/ }).first().click();
  await page.waitForTimeout(500);
  const card = await page.locator("body").innerText();
  ok(`${tag}: карточка — второй номер и «Ответ на напоминание»`, /Второй WhatsApp/.test(card) && /Ответ на напоминание/.test(card));
  await t.shot("5-card-reminder");
  await page.getByRole("button", { name: "Назад к переписке" }).click();
  await page.getByRole("button", { name: /Назад к чатам/ }).click();
  await page.waitForSelector("ul a[href^='#/inbox/']");
  await row(page, "Канат").first().click();
  await page.waitForSelector("[role=log]");
  await page.getByRole("button", { name: /карточка клиента/ }).first().click();
  await page.getByText("Записи в Altegio").first().waitFor();
  await page.waitForTimeout(600);
  ok(`${tag}: ближайшая запись Altegio в карточке`, /№\s*\d+/.test(await page.locator("body").innerText()));
  await t.shot("6-card-altegio");
  await page.getByRole("button", { name: "Назад к переписке" }).click();
  await page.getByRole("button", { name: "Действия с чатом" }).click();
  await page.getByRole("menuitem", { name: "Готово" }).click();
  ok(`${tag}: «Готово» при вопросе клиента — спрашивает`, (await page.getByRole("alertdialog").or(page.getByRole("dialog")).filter({ hasText: "ждёт ответа" }).count()) >= 1);
  await t.shot("7-close-confirm");
  await page.getByRole("button", { name: "Закрыть без ответа" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /Назад к чатам/ }).click();
  await page.waitForSelector("section[aria-label='Чаты']");
  await tab(page, "Готово").click();
  ok(`${tag}: закрытый чат — в «Готово»`, (await row(page, "Канат").count()) === 1);
  await filesPhone(t);
  ok(`${tag}: ошибок в консоли нет`, !t.errs.length, t.errs.join(" | "));
  await t.ctx.close();
}

// «Полноценные чаты» (31.10.2026), телефон: (1) новый клиент второго номера — в «Нужен ответ», сотрудник отвечает цитатой (долгое
// нажатие → «Ответить»); (3) фото и PDF — по одному, у каждого «Отправлено», оба открываются; (7) Green-API ответил 500 — пузырь
// «не знаем, ушло ли», к Green-API — ровно один запрос
async function filesPhone(t) {
  const { page, tag } = t;
  const sheetOf = (name) => page.getByRole("dialog", { name });
  await tab(page, "Нужен ответ").click();
  ok(`${tag}: (1) новый клиент второго номера — в «Нужен ответ»`, (await row(page, "Асель").count()) === 1);
  await row(page, "Асель").first().click();
  await page.waitForSelector("[role=log]");
  const pane = page.locator("section[aria-label^='Переписка']");
  ok(`${tag}: второй номер — без «написать можно ещё…» (у Green-API нет окна 24 часа)`, !/написать можно/i.test(await pane.innerText()));
  ok(`${tag}: у второго номера — скрепка`, (await page.getByRole("button", { name: "Прикрепить фото, видео или файл" }).count()) === 1);
  // ответ цитатой: долгое нажатие на сообщение клиента
  const orig = page.locator("[role=log] [data-mid='E2E-G-1']");
  await longPress(page, orig);
  const replyItem = page.getByRole("menuitem", { name: "Ответить" });
  ok(`${tag}: долгое нажатие — меню «Ответить», «Копировать»`, (await replyItem.count()) === 1 && (await page.getByRole("menuitem", { name: "Копировать" }).count()) === 1);
  await t.shot("8-msg-menu");
  await replyItem.click();
  const strip = page.locator("[aria-label='Ответ на сообщение']");
  ok(`${tag}: над полем — цитата с ✕`, (await strip.count()) === 1 && /Есть время завтра/.test(await strip.innerText()) && (await page.getByRole("button", { name: "Не отвечать на это сообщение" }).count()) === 1);
  await page.getByLabel("Ответ клиенту").fill("Да, завтра в 15:00 у Тони свободно. Записать вас?");
  await t.shot("9-reply-strip");
  const sm0 = net.ga.filter((x) => x.op === "sendMessage").length;
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await page.waitForTimeout(800);
  const sm = net.ga.filter((x) => x.op === "sendMessage");
  ok(`${tag}: (1) ответ ушёл одним сообщением, цитатой на сообщение клиента`, sm.length === sm0 + 1 && sm.at(-1).body.quotedMessageId === "E2E-G-1", JSON.stringify(sm.at(-1)?.body || {}));
  ok(`${tag}: полоса цитаты убрана после отправки`, (await strip.count()) === 0);
  const qb = page.locator("[role=log]").getByRole("button", { name: /^Ответ на сообщение: Асель/ });
  ok(`${tag}: в отправленном — цитата`, (await qb.count()) === 1);
  await qb.click();
  await page.waitForTimeout(120);
  ok(`${tag}: нажатие на цитату — к исходному сообщению (подсветка)`, await orig.evaluate((el) => el.classList.contains("msg-flash")));

  // (3) фото и PDF
  const up0 = uploads().length, sent0 = await ticks(page, "Отправлено").count();
  await pane.locator("input[type=file]").setInputFiles([
    { name: "Работа мастера.png", mimeType: "image/png", buffer: Buffer.from(pngFace("e2e-work")) },
    { name: "Прайс-лист.pdf", mimeType: "application/pdf", buffer: PDF },
  ]);
  const sheet = sheetOf(/Выбрано 2 файла/);
  await sheet.waitFor();
  ok(`${tag}: (3) перед отправкой — оба файла, у фото миниатюра`, (await sheet.locator("ul[aria-label='Файлы к отправке'] li").count()) === 2 && (await sheet.locator("li img").count()) === 1);
  await page.waitForTimeout(300);
  await t.shot("10-files-sheet");
  await sheet.getByRole("button", { name: "Отправить 2" }).click();
  await page.waitForTimeout(60);
  const during = await page.locator("[role=log]").innerText();
  await page.waitForFunction(() => !/отправляется/.test(document.querySelector("[role=log]")?.textContent || ""), null, { timeout: 15000 });
  await page.waitForTimeout(400);
  const up = uploads().slice(up0);
  ok(`${tag}: (3) по одному запросу на файл, по очереди: фото, потом PDF`, up.length === 2 && up[0].form.fileName === "Работа мастера.png" && up[1].form.fileName === "Прайс-лист.pdf" && up.every((x) => x.host === "media.green-api.com"), JSON.stringify(up.map((x) => x.form?.fileName)));
  ok(`${tag}: (3) оба пузыря в ленте сразу (пока уходят — «отправляется»)`, /отправляется/.test(during) || up.length === 2, during.slice(-200));
  ok(`${tag}: (3) у обоих файлов — «Отправлено»`, (await ticks(page, "Отправлено").count()) === sent0 + 2);
  await t.shot("11-files-sent");
  await page.locator("[role=log]").getByRole("button", { name: "Открыть фото" }).last().click();
  const photo = page.getByRole("dialog", { name: "Фото" });
  await photo.locator("img").evaluate((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r))));
  ok(`${tag}: (3) отправленное фото открывается на весь экран`, (await photo.count()) === 1 && (await photo.locator("img").evaluate((i) => i.naturalWidth > 0)));
  await page.getByRole("button", { name: "Закрыть" }).click();
  const pdfLink = page.locator("[role=log]").getByRole("link", { name: "Скачать Прайс-лист.pdf" });
  const pr = (await pdfLink.count()) ? await page.request.get(new URL(await pdfLink.getAttribute("href"), page.url()).href) : null;
  ok(`${tag}: (3) отправленный PDF открывается (200, application/pdf)`, pr && pr.status() === 200 && /application\/pdf/.test(pr.headers()["content-type"] || ""), pr ? `${pr.status()} ${pr.headers()["content-type"]}` : "нет ссылки");

  // (7) Green-API ответил 500: «не знаем, ушло ли», без повтора
  const prev = net.gaReply, up1 = uploads().length;
  net.gaReply = (rec) => (rec.op === "sendFileByUpload" ? new Response(JSON.stringify({ message: "Internal Server Error" }), { status: 500, headers: { "content-type": "application/json" } }) : prev ? prev(rec) : null);
  try {
    await pane.locator("input[type=file]").setInputFiles([{ name: "Схема проезда.png", mimeType: "image/png", buffer: Buffer.from(pngFace("e2e-map")) }]);
    const one = sheetOf("Отправить файл");
    await one.waitFor();
    await one.getByRole("button", { name: "Отправить", exact: true }).click();
    await page.waitForFunction(() => /Не знаем, ушло ли сообщение/.test(document.querySelector("[role=log]")?.textContent || ""), null, { timeout: 15000 });
    ok(`${tag}: (7) 500 от Green-API — пузырь «Не знаем, ушло ли сообщение…»`, /Не знаем, ушло ли сообщение\. Проверьте в WhatsApp/.test(await page.locator("[role=log]").innerText()));
    await page.waitForTimeout(1500);
    ok(`${tag}: (7) к Green-API — ровно один запрос, без повтора`, uploads().length === up1 + 1, String(uploads().length - up1));
    ok(`${tag}: (7) статус «?» вместо галочки`, (await ticks(page, /^Статус пока неизвестен/).count()) >= 1);
    const toastAlert = page.getByRole("alert").filter({ hasText: "Не знаем, ушло ли" });
    ok(`${tag}: (7) и предупреждение сотруднику`, (await toastAlert.count()) === 1);
    await toastAlert.getByRole("button", { name: "Закрыть" }).click().catch(() => {});
    await page.waitForTimeout(200);
    await t.shot("12-unknown");
  } finally {
    net.gaReply = prev;
  }
  await voicePhone(t);
  await deletePhone(t, orig);
  await page.getByRole("button", { name: /Назад к чатам/ }).click();
  await page.waitForSelector("section[aria-label='Чаты']");
  ok(`${tag}: (1) после ответа — не в «Нужен ответ»`, (await row(page, "Асель").count()) === 0);
}

// голосовое из пульта (02.11.2026), чат Асель (второй номер): микрофон-заглушка Chromium. Это Chromium, а не Safari на iPhone:
// путь iPhone (Safari пишет только MP4) повторён подменой MediaRecorder.isTypeSupported; на настоящем телефоне не проверено
async function voicePhone(t) {
  const { page, tag } = t;
  const log = page.locator("[role=log]");
  await page.getByLabel("Ответ клиенту").fill("");
  const mic = page.getByRole("button", { name: "Записать голосовое" });
  ok(`${tag}: голосовое — при пустом поле на месте «Отправить» кнопка микрофона`, (await mic.count()) === 1);
  await mic.click();
  await page.getByText("Идёт запись").waitFor({ timeout: 5000 });
  await page.waitForTimeout(1700);
  const rec = page.locator("[role=group][aria-label='Запись голосового']");
  const timer = await rec.innerText();
  ok(`${tag}: голосовое — идёт запись, таймер, «Отменить» и «Стоп»`, /0:0[1-9]/.test(timer) && (await rec.getByRole("button", { name: "Отменить запись" }).count()) === 1 && (await rec.getByRole("button", { name: "Остановить запись" }).count()) === 1, timer);
  await t.shot("13-voice-rec");
  await rec.getByRole("button", { name: "Остановить запись" }).click();
  const ready = page.locator("[role=group][aria-label='Голосовое перед отправкой']");
  await ready.waitFor({ timeout: 5000 });
  ok(`${tag}: голосовое — перед отправкой прослушать, удалить или отправить`, (await ready.getByRole("button", { name: "Слушать голосовое" }).count()) === 1 && (await ready.getByRole("button", { name: "Удалить запись" }).count()) === 1);
  ok(`${tag}: Chromium пишет Opus — уйдёт голосовым, без пометки об M4A`, !(await page.getByText(/записывает только в формате M4A/).count()));
  await t.shot("14-voice-ready");
  const up0 = uploads().length, sent0 = await ticks(page, "Отправлено").count();
  await ready.getByRole("button", { name: "Отправить голосовое" }).dblclick();
  await page.waitForFunction(() => !/отправляется/.test(document.querySelector("[role=log]")?.textContent || ""), null, { timeout: 15000 });
  await page.waitForTimeout(700);
  const vu = uploads().slice(up0), vb = vu[0] ? Buffer.from(await vu[0].form.file.blob.arrayBuffer()) : Buffer.alloc(0);
  ok(`${tag}: голосовое — двойное нажатие: к Green-API один файл voice-….ogg (Ogg Opus)`, vu.length === 1 && /^voice-\d{14}\.ogg$/.test(vu[0].form.fileName) && vb.subarray(0, 4).toString() === "OggS" && vb.includes(Buffer.from("OpusHead")), JSON.stringify(vu.map((x) => x.form?.fileName)));
  const vt = S.hist("ga", "winchester", G).turns.at(-1);
  ok(`${tag}: голосовое — в переписке отмечено голосовым, с длиной`, vt.m && vt.m.k === "audio" && vt.m.v === 1 && vt.m.d >= 1 && vt.st === "sent", JSON.stringify({ m: vt.m, st: vt.st }));
  ok(`${tag}: отправленное голосовое — в ленте плеер и «Отправлено»`, (await ticks(page, "Отправлено").count()) === sent0 + 1 && (await log.getByRole("button", { name: "Слушать голосовое" }).count()) >= 1);
  await log.getByRole("button", { name: "Слушать голосовое" }).last().click();
  await page.waitForTimeout(700);
  ok(`${tag}: отправленное голосовое воспроизводится в пульте`, (await log.getByRole("button", { name: "Пауза" }).count()) >= 1 || /0:0[1-9]/.test(await log.innerText()));
  await log.getByRole("button", { name: "Пауза" }).first().click().catch(() => {});
  await t.shot("15-voice-sent");

  // путь iPhone: Safari записывает только MP4 (AAC) — уходит аудиофайлом .m4a, и пульт пишет об этом до отправки
  const mp4 = await page.evaluate(() => MediaRecorder.isTypeSupported("audio/mp4"));
  if (!mp4) console.log(`  · ${tag}: этот Chromium не пишет MP4 — путь iPhone не проверен`);
  else {
    await page.evaluate(() => { const real = MediaRecorder.isTypeSupported.bind(MediaRecorder); MediaRecorder.isTypeSupported = (x) => /mp4/.test(x) && real(x); });
    await mic.click();
    await page.getByText("Идёт запись").waitFor({ timeout: 5000 });
    await page.waitForTimeout(1500);
    await rec.getByRole("button", { name: "Остановить запись" }).click();
    await ready.waitFor({ timeout: 5000 });
    ok(`${tag}: запись M4A (как Safari на iPhone) — честная пометка «уйдёт аудиофайлом»`, (await page.getByText(/записывает только в формате M4A: уйдёт аудиофайлом/).count()) === 1);
    await t.shot("16-voice-m4a");
    const up1 = uploads().length;
    await ready.getByRole("button", { name: "Отправить голосовое" }).click();
    await page.waitForFunction(() => !/отправляется/.test(document.querySelector("[role=log]")?.textContent || ""), null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const mu = uploads().slice(up1), mb = mu[0] ? Buffer.from(await mu[0].form.file.blob.arrayBuffer()) : Buffer.alloc(0);
    ok(`${tag}: M4A — один файл voice-….m4a (MP4), отправлен`, mu.length === 1 && /^voice-\d{14}\.m4a$/.test(mu[0].form.fileName) && mb.subarray(4, 8).toString() === "ftyp", JSON.stringify(mu.map((x) => x.form?.fileName)));
  }

  // запись прервалась (свернули пульт, звонок, погас экран): что успели записать, остаётся для прослушивания
  await mic.click();
  await page.getByText("Идёт запись").waitFor({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await setHidden(page, true);
  await page.waitForTimeout(400);
  await setHidden(page, false);
  await ready.waitFor({ timeout: 5000 }).catch(() => {});
  ok(`${tag}: запись прервалась — записанное осталось, можно прослушать`, (await ready.count()) === 1);
  const up2 = uploads().length;
  await ready.getByRole("button", { name: "Удалить запись" }).click();
  ok(`${tag}: «Удалить запись» — ничего не ушло, снова поле ввода`, uploads().length === up2 && (await page.getByLabel("Ответ клиенту").count()) === 1);

  // нет доступа к микрофону — понятная причина, записи нет
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError")); });
  await mic.click();
  const deny = page.getByRole("alert").filter({ hasText: "Нет доступа к микрофону" });
  await deny.waitFor({ timeout: 3000 }).catch(() => {});
  ok(`${tag}: нет доступа к микрофону — объяснение, как разрешить`, (await deny.count()) === 1 && (await rec.count()) === 0);
  await t.shot("17-mic-denied");
  await deny.getByRole("button", { name: "Закрыть" }).click().catch(() => {});
}

// «Удалить у всех» (наше сообщение) и «Удалить у меня» (сообщение клиента), после перезагрузки — так же (02.11.2026)
async function deletePhone(t, orig) {
  const { page, tag } = t;
  const log = page.locator("[role=log]");
  const dels = () => net.ga.filter((x) => x.op === "deleteMessage");
  const mine = log.locator("[data-mid]").filter({ hasText: "Да, завтра в 15:00 у Тони свободно" }).first();
  await longPress(page, mine);
  ok(`${tag}: у нашего сообщения — «Удалить у меня» и «Удалить у всех»`, (await page.getByRole("menuitem", { name: "Удалить у меня" }).count()) === 1 && (await page.getByRole("menuitem", { name: "Удалить у всех" }).count()) === 1);
  await t.shot("18-msg-delete-menu");
  const d0 = dels().length;
  await page.getByRole("menuitem", { name: "Удалить у всех" }).click();
  const dlg = page.getByRole("dialog", { name: "Удалить у всех?" });
  await dlg.waitFor({ timeout: 3000 }).catch(() => {});
  ok(`${tag}: «Удалить у всех» — сначала подтверждение, запроса ещё нет`, (await dlg.count()) === 1 && dels().length === d0);
  await t.shot("19-delete-confirm");
  await dlg.getByRole("button", { name: "Удалить у всех" }).click();
  await page.waitForTimeout(900);
  const want = S.hist("ga", "winchester", G).turns.find((x) => /Тони свободно/.test(x.text));
  ok(`${tag}: удалено у всех — один запрос deleteMessage с номером нашего сообщения`, dels().length === d0 + 1 && dels().at(-1).body.idMessage === want.mid && want.del === 1, JSON.stringify(dels().slice(d0).map((x) => x.body)));
  ok(`${tag}: в ленте — «удалено у всех»`, /удалено у всех/.test(await log.innerText()));
  await longPress(page, orig);
  ok(`${tag}: у сообщения клиента — только «Удалить у меня»`, (await page.getByRole("menuitem", { name: "Удалить у меня" }).count()) === 1 && !(await page.getByRole("menuitem", { name: "Удалить у всех" }).count()));
  await page.getByRole("menuitem", { name: "Удалить у меня" }).click();
  await page.waitForTimeout(800);
  const origText = log.locator("[data-mid='E2E-G-1'] p");
  ok(`${tag}: «Удалить у меня» — на месте сообщения «Скрыто в пульте» и «Вернуть», к Green-API ничего`, (await log.getByText(/Скрыто в пульте/).count()) === 1 && (await log.getByRole("button", { name: "Вернуть" }).count()) === 1 && (await origText.count()) === 0 && dels().length === d0 + 1);
  await t.shot("20-hidden");
  await page.reload();
  await page.waitForSelector("[role=log] [data-mid='E2E-G-1']");
  await page.waitForTimeout(700);
  ok(`${tag}: после перезагрузки — скрыто и «удалено у всех» так же`, (await log.getByText(/Скрыто в пульте/).count()) === 1 && /удалено у всех/.test(await log.innerText()));
  await log.getByRole("button", { name: "Вернуть" }).click();
  await page.waitForTimeout(800);
  ok(`${tag}: «Вернуть» — сообщение клиента снова видно`, (await origText.count()) === 1 && !(await log.getByText(/Скрыто в пульте/).count()));
}

// «прочитано» и «Ждёт ответа» у двух сотрудников сразу (02.11.2026): открыть чат — не ответить; переписки в D1 — «прочитано» общее
async function readSync() {
  const a = await session({ width: 390, height: 844 }, "light", "sync-a", "Айгерим"), b = await session({ width: 1280, height: 800 }, "light", "sync-b", "Ержан");
  const H = "77001112107", dot = (page) => row(page, "Мадина").locator("[aria-label='новое']");
  await a.page.waitForSelector("section[aria-label='Чаты']");
  await b.page.waitForSelector("section[aria-label='Чаты']");
  await S.gaText("winchester", GAW, H, "Добрый день! Можно записаться на субботу?", { name: "Мадина", idMessage: "E2E-H-1" });
  await listPoll(a.page);
  await listPoll(b.page);
  ok("sync: новое сообщение — «новое» у обоих сотрудников", (await dot(a.page).count()) === 1 && (await dot(b.page).count()) === 1);
  await row(a.page, "Мадина").first().click();
  await a.page.waitForSelector("[role=log]");
  await a.page.waitForTimeout(900);
  await a.page.getByRole("button", { name: /Назад к чатам/ }).click();
  await a.page.waitForSelector("section[aria-label='Чаты']");
  await tab(a.page, "Нужен ответ").click();
  ok("sync: открыли чат — «Ждёт ответа» осталось (чат в «Нужен ответ»), «новое» снято", (await row(a.page, "Мадина").count()) === 1 && (await dot(a.page).count()) === 0);
  await listPoll(b.page);
  if (process.env.CHAT_STORE === "d1") ok("sync: переписки в D1 — у второго сотрудника тоже не «новое»", (await dot(b.page).count()) === 0);
  else ok("sync: без D1 — у второго сотрудника «новое» остаётся (прочитанное помнит устройство)", (await dot(b.page).count()) === 1);
  await tab(b.page, "Нужен ответ").click();
  ok("sync: у второго сотрудника чат по-прежнему ждёт ответа", (await row(b.page, "Мадина").count()) === 1);
  await a.shot("1-open-not-answered");
  await b.shot("1-other-admin");
  await row(a.page, "Мадина").first().click();
  await a.page.waitForSelector("[role=log]");
  await a.page.getByLabel("Ответ клиенту").fill("Здравствуйте! В субботу в 12:00 у Рауана свободно. Записать?");
  await a.page.getByRole("button", { name: "Отправить", exact: true }).click();
  await a.page.waitForTimeout(700);
  await listPoll(b.page);
  ok("sync: ответили — у второго сотрудника чат ушёл из «Нужен ответ»", (await row(b.page, "Мадина").count()) === 0);
  await S.gaText("winchester", GAW, H, "Да, запишите", { name: "Мадина", idMessage: "E2E-H-2" });
  await listPoll(b.page);
  ok("sync: новое сообщение после ответа — снова в «Нужен ответ» и «новое»", (await row(b.page, "Мадина").count()) === 1 && (await dot(b.page).count()) === 1);
  ok("sync: ошибок в консоли нет", !a.errs.length && !b.errs.length, [...a.errs, ...b.errs].join(" | "));
  await a.ctx.close();
  await b.ctx.close();
}

async function deskRun(scheme) {
  const t = await session({ width: 1280, height: 800 }, scheme, `1280-${scheme}`, "Ержан");
  const { page } = t;
  await page.waitForSelector("ul a[href^='#/inbox/']");
  await row(page, "Ерлан").first().click();
  await page.waitForSelector("[role=log]");
  ok(`${t.tag}: документ — имя и «Скачать»`, /Прайс\.pdf/.test(await page.locator("[role=log]").innerText()) && (await page.getByRole("link", { name: /Скачать Прайс/ }).count()) === 1);
  await page.getByRole("button", { name: "Действия с чатом" }).click();
  await page.getByRole("menuitem", { name: "Взять себе" }).click();
  await page.waitForTimeout(500);
  ok(`${t.tag}: «Взять себе» — ведёт Ержан`, /ведёт вы/.test(await page.locator("section[aria-label^='Переписка'] header").innerText()));
  await t.shot("1-doc-take");
  // список рядом с чатом: точка сети пульта видит отчёт «прочитано» только через D1 — строка списка тоже две синие, не меньше, чем в чате
  await page.getByLabel("Ответ клиенту").fill("Получили, спасибо!");
  await page.getByRole("button", { name: /Отправить/ }).click();
  await page.waitForTimeout(700);
  await tab(page, "Все").click();
  await listPoll(page);
  const midC = S.hist("ga", "winchester", C).turns.filter((x) => x.by === "admin").at(-1).mid, snapC = take();
  await hook({ typeWebhook: "outgoingMessageStatus", chatId: C + "@c.us", idMessage: midC, status: "read", sendByApi: true });
  edge.view = snapC; edge.getOld = true;
  await listPoll(page);
  await chatTick(page);
  const rowC = row(page, "Получили, спасибо");
  ok(`${t.tag}: и в чате, и в строке списка — «Прочитано», хотя список у пульта старый`, (await page.locator("[role=log]").getByRole("img", { name: "Прочитано" }).count()) >= 1 && (await rowC.getByRole("img", { name: "Прочитано" }).count()) >= 1, await rowC.first().innerText().catch(() => "нет строки"));
  edge.view = null; edge.getOld = false;
  await tab(page, "Нужен ответ").click();
  // (2) документ Word — скачивание: 200 и «attachment»
  const docx = page.locator("[role=log]").getByRole("link", { name: "Скачать Анкета.docx" });
  const dr = (await docx.count()) ? await page.request.get(new URL(await docx.getAttribute("href"), page.url()).href) : null;
  ok(`${t.tag}: (2) документ Word скачивается (200, attachment)`, dr && dr.status() === 200 && /^attachment/.test(dr.headers()["content-disposition"] || ""), dr ? `${dr.status()} ${dr.headers()["content-disposition"]}` : "нет ссылки");
  await filesDesk(t);
  ok(`${t.tag}: ошибок в консоли нет`, !t.errs.length, t.errs.join(" | "));
  await t.ctx.close();
}

// «Полноценные чаты», компьютер: (2) видео — на весь экран; меню сообщения «⋯» при наведении: «Открыть» фото, «Копировать» текст
// (буфер обмена), «Ответить»; у основного номера (Meta) — ни скрепки, ни «Ответить»
async function filesDesk(t) {
  const { page, tag } = t;
  await tab(page, "Все").click(); // на телефоне этим клиентам уже ответили — в «Нужен ответ» их нет
  await row(page, "Данияр").first().click();
  await page.waitForSelector("[role=log] video");
  const vid = page.locator("[role=log] video");
  await vid.first().evaluate((v) => (v.readyState >= 1 ? null : new Promise((r) => { v.onloadedmetadata = v.onerror = r; setTimeout(r, 4000); })));
  ok(`${tag}: (2) видео клиента — плеер в ленте, файл читается`, (await vid.count()) === 1 && (await vid.first().evaluate((v) => v.readyState >= 1 && !v.error)));
  await page.getByRole("button", { name: "Видео на весь экран" }).click();
  const vdlg = page.getByRole("dialog", { name: "Видео" });
  ok(`${tag}: (2) видео — на весь экран`, (await vdlg.count()) === 1 && (await vdlg.locator("video").count()) === 1);
  await page.waitForTimeout(400);
  await t.shot("2-video-full");
  await page.keyboard.press("Escape");
  const photoMsg = page.locator("[role=log] [data-mid]").filter({ has: page.getByRole("button", { name: "Открыть фото" }) }).first();
  await msgMenu(page, photoMsg);
  ok(`${tag}: у фото клиента в меню — «Ответить» и «Открыть», без «Копировать»`, (await page.getByRole("menuitem", { name: "Ответить" }).count()) === 1 && (await page.getByRole("menuitem", { name: "Открыть" }).count()) === 1 && !(await page.getByRole("menuitem", { name: "Копировать" }).count()));
  await t.shot("3-msg-menu");
  await page.getByRole("menuitem", { name: "Открыть" }).click();
  ok(`${tag}: «Открыть» — фото на весь экран`, (await page.getByRole("dialog", { name: "Фото" }).count()) === 1);
  await page.keyboard.press("Escape");

  // «Копировать» — текст сообщения клиента в буфере обмена
  await page.locator("a[href*='77001112106']").first().click();
  await page.waitForSelector("[role=log] [data-mid='E2E-G-1']");
  await msgMenu(page, page.locator("[role=log] [data-mid='E2E-G-1']"));
  await page.getByRole("menuitem", { name: "Копировать" }).click();
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => "ошибка: " + e);
  ok(`${tag}: «Копировать» — текст в буфере обмена`, clip === "Здравствуйте! Есть время завтра после обеда?", clip);
  ok(`${tag}: отправленные файлы и цитата видны и на компьютере`, (await page.locator("[role=log]").getByRole("button", { name: /^Ответ на сообщение: Асель/ }).count()) === 1 && (await page.locator("[role=log]").getByRole("link", { name: "Скачать Прайс-лист.pdf" }).count()) === 1);
  await t.shot("4-files-quote");

  // основной номер (Meta): файлов из пульта нет, ответить цитатой нельзя
  await page.locator("a[href*='77001112001']").first().click();
  await page.waitForSelector("[role=log]");
  await page.waitForTimeout(300);
  ok(`${tag}: основной номер — без скрепки`, (await page.getByRole("button", { name: "Прикрепить фото, видео или файл" }).count()) === 0 && (await page.getByLabel("Ответ клиенту").count()) === 1);
  const waMsg = page.locator("[role=log] p").filter({ hasText: "Есть свободное время сегодня вечером" }).first().locator("xpath=..");
  await msgMenu(page, waMsg);
  ok(`${tag}: основной номер — в меню «Копировать», без «Ответить»`, (await page.getByRole("menuitem", { name: "Копировать" }).count()) === 1 && !(await page.getByRole("menuitem", { name: "Ответить" }).count()));
  await page.keyboard.press("Escape");
}

// тёмная тема — только вид (состояние чатов уже изменено светлым прогоном)
async function darkShots(vp, tag) {
  const t = await session(vp, "dark", tag, "Айгерим");
  const { page } = t;
  await page.waitForSelector("section[aria-label='Чаты']");
  await tab(page, "Все").click();
  await t.shot("1-list");
  await row(page, "Данияр").first().click();
  await page.waitForSelector("[role=log]");
  await page.waitForTimeout(400);
  await t.shot("2-chat");
  if (vp.width < 500) await page.getByRole("button", { name: /Назад к чатам/ }).click();
  await row(page, "Асель").first().click();
  await page.waitForSelector("[role=log] [data-mid='E2E-G-1']");
  await page.waitForTimeout(500);
  await t.shot("3-files-quote");
  ok(`${tag}: ошибок в консоли нет`, !t.errs.length, t.errs.join(" | "));
  await t.ctx.close();
}

try {
  await phoneRun("light");
  await deskRun("light");
  await darkShots({ width: 390, height: 844 }, "390-dark");
  await darkShots({ width: 1280, height: 800 }, "1280-dark");
  await readSync();
} catch (e) {
  ok("сценарий дошёл до конца", false, String(e && e.stack || e).slice(0, 600));
} finally {
  await browser.close();
  await dl.close();
}
const bad = results.filter((r) => !r.ok);
console.log(`\nЧаты (ТЗ v2.0, P0): прошло ${results.length - bad.length}, не прошло ${bad.length}. Снимки — ${OUT}`);
process.exit(bad.length ? 1 : 0);
