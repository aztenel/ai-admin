// Push-уведомления в браузере (ТЗ v2.0 §3, 31.10.2026): бот на заглушках (dev-live.mjs), Chromium.
//   1. iPhone, вкладка Safari (UA iPhone, не с экрана «Домой») — инструкция «Поделиться → На экран Домой», кнопки «Включить» нет;
//   2. запрет уведомлений — как разрешить снова;
//   3. iPhone «с экрана Домой» (navigator.standalone): «Включить» → разрешение → подписка → сервер её хранит (wp:winchester:…),
//      настройки видов, «не беспокоить», экран блокировки; «Проверить» уходит в службу push (заглушка) и расшифровывается;
//   4. компьютер: Service Worker /app/sw.js с областью /app/; сообщение, доставленное в него (CDP ServiceWorker.deliverPushMessage),
//      показывает уведомление с адресом чата.
// Подписку браузера подменяем (PushManager.subscribe): службы Google в песочнице нет; шифрование и подпись при этом настоящие
// (сервер шифрует ключами подписки, проверка расшифровывает своим закрытым ключом). Настоящий iPhone так не проверить.
// Запуск: node scripts/e2e-push.mjs [папка снимков]
import { mkdirSync } from "node:fs";
import { startDevLive } from "./dev-live.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright/index.mjs");
const out = process.argv[2] || "push-shots";
mkdirSync(out, { recursive: true });
const { net } = await import(new URL("../../../test/harness.mjs", import.meta.url).href);
const { uaKeys, decrypt } = await import(new URL("../../../test/unit/webpush-ua.mjs", import.meta.url).href);

let fails = 0, n = 0;
const ok = (name, cond, extra = "") => {
  n++;
  if (!cond) fails++;
  console.log(`${cond ? "ok" : "НЕ ПРОШЛО"} ${n} — ${name}${!cond && extra ? `: ${extra}` : ""}`);
};
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, locale: "ru-RU" };

const dl = await startDevLive({ port: 0 });
const origin = new URL(dl.app).origin;
// Chromium в новом режиме без окна: в старом (headless shell) уведомления всегда «запрещены», и разрешение не выдать
const browser = await chromium.launch({ channel: "chromium" }).catch(() => chromium.launch());
const errs = [];

async function open(ctx, tag) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(`${tag}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push(`${tag}: ${m.text()}`));
  await page.goto(`${dl.app}?c=winchester`);
  await page.waitForURL(/\/login/);
  await page.fill("input[name=key]", dl.STAFF_W);
  await page.click("button");
  await page.waitForURL(/\/app\//);
  await page.goto(`${dl.app}?c=winchester#/settings/notifications`);
  await page.waitForLoadState("networkidle");
  return page;
}
// подписка браузера-заглушка: ключи — настоящие (у проверки есть закрытый ключ), адрес — служба push Google
const fakePush = ({ endpoint, p256dh, auth }) => {
  let cur = null;
  PushManager.prototype.subscribe = async function (o) {
    const k = o.applicationServerKey;
    const ask = k instanceof ArrayBuffer ? k : k.buffer.slice(k.byteOffset, k.byteOffset + k.byteLength);
    cur = { endpoint, options: { applicationServerKey: ask, userVisibleOnly: true }, toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh, auth } }), unsubscribe: async () => ((cur = null), true) };
    return cur;
  };
  PushManager.prototype.getSubscription = async function () {
    return cur;
  };
};

// 1. iPhone, вкладка Safari
{
  const ctx = await browser.newContext({ ...PHONE, colorScheme: "light" });
  const page = await open(ctx, "iphone-tab");
  await page.getByText("пульт добавлен на экран «Домой»").waitFor();
  ok("iPhone во вкладке Safari: инструкция «На экран Домой»", await page.getByText("Выберите «На экран Домой»").isVisible());
  ok("iPhone во вкладке Safari: кнопки «Включить» нет", !(await page.getByRole("button", { name: "Включить уведомления" }).count()));
  await page.screenshot({ path: `${out}/push-1-iphone-safari-tab.png` });
  await ctx.close();
}
// 2. запрет
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru-RU", colorScheme: "light" });
  await ctx.addInitScript(() => Object.defineProperty(Notification, "permission", { get: () => "denied" }));
  const page = await open(ctx, "denied");
  await page.getByText("Уведомления для пульта запрещены в настройках").waitFor();
  ok("запрет: подсказка, как разрешить", await page.getByText("значок слева от адреса сайта").isVisible());
  await ctx.close();
}
// 3. iPhone с экрана «Домой»: включить, настройки, проверка
const ua = uaKeys(), endpoint = "https://fcm.googleapis.com/fcm/send/e2e-" + Date.now();
{
  const ctx = await browser.newContext({ ...PHONE, colorScheme: "dark" });
  await ctx.grantPermissions(["notifications"], { origin });
  await ctx.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await ctx.addInitScript(fakePush, { endpoint, p256dh: ua.p256dh, auth: ua.auth });
  const page = await open(ctx, "iphone-home");
  await page.getByRole("button", { name: "Включить уведомления" }).waitFor();
  await page.getByLabel("Ваше имя в пульте").fill("Айгерим");
  await page.screenshot({ path: `${out}/push-2-iphone-home-off.png` });
  await page.getByRole("button", { name: "Включить уведомления" }).click();
  await page.getByText("Что присылать").waitFor();
  const keys = [...dl.S.kv.mem.keys()].filter((k) => k.startsWith("wp:winchester:"));
  const sub = keys.length ? JSON.parse(dl.S.kv.mem.get(keys[0])) : null;
  ok("сервер хранит подписку устройства", !!sub && sub.endpoint === endpoint && sub.op === "Айгерим" && sub.role === "staff", JSON.stringify(sub).slice(0, 200));
  ok("по умолчанию текст на экран блокировки не уходит", sub && sub.prefs && sub.prefs.text === false);
  await page.getByRole("checkbox", { name: "Не присылать ночью" }).check();
  await page.waitForTimeout(400);
  const after = JSON.parse(dl.S.kv.mem.get(keys[0]));
  ok("«Не беспокоить» сохранено на сервере (21:00–09:00)", after.prefs.quiet && after.prefs.quiet.from === 21 && after.prefs.quiet.to === 9, JSON.stringify(after.prefs));
  await page.getByRole("checkbox", { name: "Ответ на рассылку или напоминание" }).uncheck();
  await page.waitForTimeout(400);
  ok("вид «ответ на рассылку» выключен на сервере", JSON.parse(dl.S.kv.mem.get(keys[0])).prefs.kinds.campaign_reply === false);
  net.push.length = 0;
  await page.getByRole("button", { name: "Проверить" }).click();
  await page.getByText("Проверка отправлена").waitFor();
  const rec = net.push.find((r) => r.url === endpoint);
  let msg = null;
  try { msg = rec && JSON.parse(decrypt(ua, Buffer.from(rec.body))); } catch (e) { errs.push("decrypt: " + e.message); }
  ok("«Проверить»: зашифрованное сообщение ушло в службу push и расшифровывается", !!msg && msg.b === "Проверка: уведомления на этом устройстве работают", JSON.stringify(msg));
  ok("подпись VAPID в запросе", !!rec && /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=B[\w-]+$/.test(rec.headers.authorization || ""));
  await page.waitForTimeout(3500); // подсказки внизу экрана исчезли
  await page.evaluate(() => document.querySelectorAll(".scroll-area").forEach((e) => (e.scrollTop = 0)));
  await page.screenshot({ path: `${out}/push-3-iphone-home-on.png` });
  await ctx.close();
}
// 4. компьютер: Service Worker и показ уведомления
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru-RU", colorScheme: "light" });
  await ctx.grantPermissions(["notifications"], { origin });
  const page = await open(ctx, "desktop");
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, script: r.active && r.active.scriptURL };
  });
  ok("Service Worker пульта зарегистрирован с областью /app/", reg.scope === `${origin}/app/` && /\/app\/sw\.js$/.test(reg.script || ""), JSON.stringify(reg));
  const cdp = await ctx.newCDPSession(page);
  const regs = [];
  cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => regs.push(...e.registrations));
  await cdp.send("ServiceWorker.enable");
  await page.waitForTimeout(300);
  const id = (regs.find((r) => r.scopeURL === `${origin}/app/`) || {}).registrationId;
  const data = JSON.stringify({ t: "Winchester", b: "Новое сообщение · второй номер", u: "/app/?c=winchester#/inbox/ga%3A77001112001", g: "ctest", k: "inbound", c: "ga:77001112001" });
  let shown = [];
  try {
    await cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId: String(id), data });
    for (let i = 0; i < 20 && !shown.length; i++) {
      await page.waitForTimeout(150);
      shown = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((x) => ({ title: x.title, body: x.body, tag: x.tag, url: x.data && x.data.url })));
    }
  } catch (e) {
    errs.push("deliverPushMessage: " + e.message);
  }
  ok("сообщение push → уведомление «Новое сообщение · второй номер» с адресом чата", shown.length === 1 && shown[0].body === "Новое сообщение · второй номер" && shown[0].url === `${origin}/app/?c=winchester#/inbox/ga%3A77001112001`, JSON.stringify(shown));
  await page.screenshot({ path: `${out}/push-4-desktop-off.png` });
  await ctx.close();
}
ok("без ошибок в консоли", !errs.length, errs.join(" | "));
await browser.close();
await dl.close();
console.log(fails ? `Не прошло: ${fails} из ${n}` : `Всё прошло: ${n}`);
process.exit(fails ? 1 : 0);
