// Проверка чатов нового пульта по ТЗ Winchester v2.0 (P0) в настоящем браузере (Chromium через Playwright), на НАСТОЯЩЕМ коде бота
// с заглушками (scripts/dev-live.mjs). Второй номер Winchester (Green-API, бот выключен):
//   очередь «Нужен ответ» (исходящее без ответа — не в очереди, «спасибо» — не повод), разделы «Записи», «Ответы», «Мои», «Готово»;
//   ответ сотрудника с его именем и галочками по вебхукам статусов; «Готово» при неотвеченном вопросе — с подтверждением;
//   голосовое (плеер, скорость), фото (просмотр на весь экран), документ (имя, скачать); карточка: номер компании, ответ на
//   напоминание, ближайшая запись Altegio; нет «бот выключен» в каждом чате и «Оператор, с телефона».
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
net.mediaReply = (url, init) => {
  if (!url.startsWith("https://media.green-api.test/")) return null;
  if (url.endsWith(".wav")) {
    const range = init?.headers?.range, m = /bytes=(\d+)-(\d*)/.exec(range || "");
    if (m) { const a = +m[1], e = m[2] ? Math.min(+m[2], WAV.length - 1) : WAV.length - 1; return new Response(WAV.subarray(a, e + 1), { status: 206, headers: { "content-type": "audio/wav", "content-range": `bytes ${a}-${e}/${WAV.length}`, "content-length": String(e - a + 1) } }); }
    return new Response(WAV, { headers: { "content-type": "audio/wav", "content-length": String(WAV.length) } });
  }
  if (url.endsWith(".png")) return new Response(pngFace(url), { headers: { "content-type": "image/png" } });
  if (url.endsWith(".pdf")) return new Response("%PDF-1.4\n%…\n", { headers: { "content-type": "application/pdf" } });
  return new Response("gone", { status: 403 });
};
const A = "77001112101", B = "77001112102", C = "77001112103", D = "77001112104", E = "77001112105", F = "77000002011";
// A: ответил на напоминание просьбой перенести
await S.kv.api.put(`h:ga:winchester:${A}`, JSON.stringify({ n: 1, turns: [{ role: "model", text: "Напоминаем: завтра в 15:00 у мастера Тони. Ждём вас в Winchester!", t: Date.now() - 3 * 3600e3, rm: "d1", mid: "RM-A", st: "read" }], profile: { waName: "Арман" } }));
await text(A, "Спасибо!");
await text(A, "А можно перенести на 17:00?");
// B: голосовое и фото
await inMsg(B, { typeMessage: "audioMessage", fileMessageData: { downloadUrl: "https://media.green-api.test/voice.wav", mimeType: "audio/wav" } }, "Данияр");
await inMsg(B, { typeMessage: "imageMessage", fileMessageData: { downloadUrl: "https://media.green-api.test/photo.png", mimeType: "image/png", caption: "" } }, "Данияр");
// C: документ
await inMsg(C, { typeMessage: "documentMessage", fileMessageData: { downloadUrl: "https://media.green-api.test/price.pdf", mimeType: "application/pdf", fileName: "Прайс.pdf" } }, "Ерлан");
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
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
function shiftClock(shift) {
  if (!shift) return;
  const Real = Date, now = () => Real.now() + shift;
  globalThis.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(now()); } static now() { return now(); } };
}
function iphoneSafeArea() {
  document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ":root{--safe-t:47px;--safe-b:34px}"; document.head.appendChild(s); });
}
async function session(vp, scheme, tag, op = "") {
  const phone = vp.width < 500;
  const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone, locale: "ru-RU", timezoneId: "Asia/Almaty" });
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
const tab = (page, label) => page.getByRole("radio", { name: new RegExp("^" + label) });

async function phoneRun(scheme) {
  const t = await session({ width: 390, height: 844 }, scheme, `390-${scheme}`, "Айгерим");
  const { page } = t;
  const tag = t.tag;
  await page.waitForSelector("ul a[href^='#/inbox/']");
  ok(`${tag}: по умолчанию — «Нужен ответ»`, await tab(page, "Нужен ответ").getAttribute("aria-checked") === "true");
  const listText = await page.locator("section[aria-label='Чаты']").innerText();
  ok(`${tag}: в очереди просьба перенести (ответ на напоминание), голосовое, документ, «во сколько я записан»`, /Просит перенести/.test(listText) && /Прислал файл/.test(listText) && /Спрашивает время записи/.test(listText), listText.slice(0, 400));
  ok(`${tag}: «спасибо» после ответа с телефона — не в очереди`, !(await row(page, "Тимур").count()));
  ok(`${tag}: в строках нет «Бот выключен»`, !/Бот выключен/.test(listText));
  await tab(page, "Записи").click();
  ok(`${tag}: «Записи» — перенос и время записи, без голосового`, (await row(page, "Арман").count()) === 1 && (await row(page, "Канат").count()) === 1 && !(await row(page, "Данияр").count()));
  await tab(page, "Ответы").click();
  ok(`${tag}: «Ответы» — только ответ на напоминание`, (await row(page, "Арман").count()) === 1 && (await page.locator("ul a[href^='#/inbox/']").count()) === 1);
  await tab(page, "Все").click();
  ok(`${tag}: «Все» — с «спасибо», без чата только с нашим приглашением`, (await row(page, "Тимур").count()) === 1 && /Ещё \d+ — только наши сообщения/.test(await page.locator("section[aria-label='Чаты']").innerText()));
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
  for (const st of ["delivered", "read"]) await hook({ typeWebhook: "outgoingMessageStatus", chatId: B + "@c.us", idMessage: mine.mid, status: st, sendByApi: true });
  await page.getByRole("button", { name: "Действия с чатом" }).click();
  await page.getByRole("menuitem", { name: "Обновить переписку" }).click();
  await page.waitForTimeout(500);
  ok(`${tag}: после вебхуков — «Прочитано» (две синие)`, (await log.getByRole("img", { name: "Прочитано" }).count()) >= 1);
  const head = await page.locator("section[aria-label^='Переписка'] header").innerText();
  ok(`${tag}: в шапке — второй номер и кто ведёт`, /Второй номер/.test(head) && /ведёт вы/.test(head), head);
  ok(`${tag}: нет «Бот в этой компании выключен» и «Оператор, с телефона»`, !/Бот в этой компании выключен|Оператор, с телефона/.test(await page.content()));
  await t.shot("4-chat-ticks");
  await page.getByRole("button", { name: "Назад к чатам" }).first().click().catch(() => {});

  // ответ на напоминание: карточка, «Готово» с подтверждением
  await row(page, "Арман").first().click();
  await page.waitForSelector("[role=log]");
  ok(`${tag}: напоминание подписано и с галочками`, /Напоминание/.test(await page.locator("[role=log]").innerText()));
  await page.getByRole("button", { name: /карточка клиента/ }).first().click();
  await page.waitForTimeout(500);
  const card = await page.locator("body").innerText();
  ok(`${tag}: карточка — второй номер и «Ответ на напоминание»`, /Второй номер/.test(card) && /Ответ на напоминание/.test(card));
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
  ok(`${tag}: ошибок в консоли нет`, !t.errs.length, t.errs.join(" | "));
  await t.ctx.close();
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
  ok(`${t.tag}: ошибок в консоли нет`, !t.errs.length, t.errs.join(" | "));
  await t.ctx.close();
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
  ok(`${tag}: ошибок в консоли нет`, !t.errs.length, t.errs.join(" | "));
  await t.ctx.close();
}

try {
  await phoneRun("light");
  await deskRun("light");
  await darkShots({ width: 390, height: 844 }, "390-dark");
  await darkShots({ width: 1280, height: 800 }, "1280-dark");
} catch (e) {
  ok("сценарий дошёл до конца", false, String(e && e.stack || e).slice(0, 600));
} finally {
  await browser.close();
  await dl.close();
}
const bad = results.filter((r) => !r.ok);
console.log(`\nЧаты (ТЗ v2.0, P0): прошло ${results.length - bad.length}, не прошло ${bad.length}. Снимки — ${OUT}`);
process.exit(bad.length ? 1 : 0);
