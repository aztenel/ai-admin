// Один номер отправки (rid) после обрыва связи — в старом пульте /inbox (его же открывает программа для Windows) и в новом /app/
// (находка F4 ревью PR №2, 01.11.2026). Сценарий: сотрудник нажал «Отправить», запрос дошёл до сервера, а ответ потерялся (обрыв);
// он сразу нажимает ещё раз — первая отправка ещё идёт, сервер отвечает «уже отправляется» (409 busy); потом ещё раз. Клиенту должно
// уйти одно сообщение, и все запросы — с одним rid. До исправления старый пульт после ответа «уже отправляется» брал новый rid,
// а новый пульт брал новый rid, если тот же текст набрали заново (а не нажали «Повторить»): клиенту уходило два сообщения.
// Всё на заглушках (dev-live, как боевой сайт: D1 с отметкой production); Green-API отвечает с задержкой 2,5 с.
//   node apps/pult/scripts/e2e-send-rid.mjs [папка для снимков]
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] || "/tmp/e2e-send-rid";
mkdirSync(OUT, { recursive: true });
const { startDevLive } = await import("./dev-live.mjs");
const dl = await startDevLive({ port: 0 });
const { net } = await import(new URL("../../../test/harness.mjs", import.meta.url).href);
const S = dl.bot.S;
const GAW = { id: "1101000002", token: "ga-token-winch" };
const SHIFT = Date.now() - (performance.timeOrigin + performance.now());
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright/index.mjs");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });

const results = [];
const ok = (name, cond, info = "") => { results.push({ name, ok: !!cond }); console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || !info ? "" : " — " + String(info).slice(0, 300)}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function shiftClock(shift) {
  if (!shift) return;
  const Real = Date, now = () => Real.now() + shift;
  globalThis.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(now()); } static now() { return now(); } };
}
// Green-API отвечает на отправку через 2,5 с: пока первая отправка идёт, повтор с тем же rid получает «уже отправляется»
let n = 0;
net.gaReply = (rec) => rec.op === "sendMessage" ? new Promise((r) => setTimeout(() => r(new Response(JSON.stringify({ idMessage: "GA-SLOW-" + ++n }), { headers: { "content-type": "application/json" } })), 2500)) : null;
const sentTo = (to, text) => net.ga.filter((x) => x.op === "sendMessage" && x.body && x.body.chatId === to + "@c.us" && x.body.message === text).length;

/** Первый запрос отправки доходит до сервера, но ответ браузер не получает (обрыв); остальные — как обычно. rids — номера отправки по порядку */
async function cutFirst(page) {
  const rids = [], codes = [];
  let first = true;
  await page.route((u) => u.pathname === "/api/inbox/send", async (route) => {
    try { rids.push(JSON.parse(route.request().postData() || "{}").rid || ""); } catch { rids.push(""); }
    if (first) {
      first = false;
      route.fetch().catch(() => {}); // запрос уходит на сервер
      await wait(200);
      return route.abort("connectionreset"); // а ответ до браузера не доходит
    }
    return route.continue();
  });
  page.on("response", (r) => { if (new URL(r.url()).pathname === "/api/inbox/send") codes.push(r.status()); });
  return { rids, codes };
}

/** закрыть окно-сообщение старого пульта («Нет связи», «Не получилось»), если оно открыто; вернуть его текст */
async function dismiss(page) {
  const btn = page.getByRole("button", { name: "Понятно" });
  if (!(await btn.isVisible().catch(() => false))) return "";
  const t = await page.locator("body").innerText();
  await btn.click();
  await wait(300);
  return t;
}

async function oldPult() {
  console.log("\nСтарый пульт /inbox (и программа для Windows)");
  const from = "77001113301", TEXT = "Да, записали вас на 15:00";
  await S.gaText("winchester", GAW, from, "Можно завтра в 15:00?");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ru-RU", timezoneId: "Asia/Almaty" });
  await ctx.addInitScript(shiftClock, SHIFT);
  const page = await ctx.newPage();
  const { rids, codes } = await cutFirst(page);
  await page.goto(`${dl.bot.url}/inbox?c=winchester&key=${dl.OWNER}#ga:${from}`);
  await page.waitForFunction(() => { const t = document.getElementById("txt"); return t && !t.disabled; });
  await page.fill("#txt", TEXT);
  await page.click("#send");
  await page.waitForFunction((t) => document.getElementById("txt").value === t, TEXT); // обрыв: текст вернулся в поле
  await wait(300);
  const lostNote = await dismiss(page);
  ok("старый пульт: после обрыва не пишет «ничего не отправлено»", !/ничего не отправлено/i.test(lostNote), lostNote.slice(-200));
  await page.click("#send"); // сразу ещё раз: первая отправка ещё идёт
  await wait(800);
  await dismiss(page);
  ok("старый пульт: повтор во время отправки получил «уже отправляется»", codes.includes(409), JSON.stringify(codes));
  await wait(3000); // первая отправка закончилась
  if (!(await page.inputValue("#txt"))) await page.fill("#txt", TEXT); // текст в поле (вернул пульт или набрал сотрудник)
  await page.click("#send");
  await wait(1500);
  await dismiss(page);
  ok("старый пульт: все нажатия — с одним номером отправки", rids.length >= 3 && rids.every((r) => r && r === rids[0]), JSON.stringify(rids));
  ok("старый пульт: клиенту ушло одно сообщение", sentTo(from, TEXT) === 1, `ушло ${sentTo(from, TEXT)}`);
  await page.screenshot({ path: `${OUT}/old-pult.png` });
  await ctx.close();
}

async function newPult() {
  console.log("\nНовый пульт /app/");
  const from = "77001113302", TEXT = "Хорошо, ждём вас завтра";
  await S.gaText("winchester", GAW, from, "Я подойду завтра");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ru-RU", timezoneId: "Asia/Almaty" });
  await ctx.addInitScript(shiftClock, SHIFT);
  const page = await ctx.newPage();
  await page.goto(`${dl.app}?c=winchester`);
  await page.waitForURL(/\/login/);
  await page.fill("input[name=key]", dl.OWNER);
  await page.click("button");
  await page.waitForURL(/\/app\//);
  const { rids, codes } = await cutFirst(page);
  await page.evaluate((h) => { location.hash = h; }, "#/inbox/" + encodeURIComponent("ga:" + from));
  const box = page.getByLabel("Ответ клиенту");
  await box.waitFor();
  await box.fill(TEXT);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await page.getByRole("button", { name: "Повторить" }).first().waitFor({ timeout: 10000 }); // обрыв: пузырь «не ушло»
  await wait(300);
  await box.fill(TEXT); // сотрудник набрал тот же текст заново, а не нажал «Повторить»
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await wait(1200);
  await wait(2500); // первая отправка закончилась
  const again = page.getByRole("button", { name: "Повторить" });
  if (await again.count()) await again.first().click();
  await wait(1500);
  ok("новый пульт: тот же текст после обрыва — тот же номер отправки", rids.length >= 2 && rids.every((r) => r && r === rids[0]), JSON.stringify(rids));
  ok("новый пульт: клиенту ушло одно сообщение", sentTo(from, TEXT) === 1, `ушло ${sentTo(from, TEXT)}`);
  ok("новый пульт: в переписке одно наше сообщение", (await page.locator("[role=log]").getByText(TEXT, { exact: true }).count()) === 1, String(await page.locator("[role=log]").getByText(TEXT, { exact: true }).count()));
  await page.screenshot({ path: `${OUT}/new-pult.png` });
  void codes;
  await ctx.close();
}

try {
  await oldPult();
  await newPult();
} catch (e) {
  for (const c of browser.contexts()) for (const p of c.pages()) await p.screenshot({ path: `${OUT}/fail.png` }).catch(() => {});
  ok("сценарий дошёл до конца", false, String(e && e.message || e).split("\n").slice(0, 6).join(" | "));
} finally {
  await browser.close();
  await dl.close();
}
const bad = results.filter((r) => !r.ok);
console.log(`\nОдин номер отправки (F4): прошло ${results.length - bad.length}, не прошло ${bad.length}. Снимки — ${OUT}`);
process.exit(bad.length ? 1 : 0);
