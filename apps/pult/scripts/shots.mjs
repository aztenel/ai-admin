// Снимки пульта на телефонах, планшетах и компьютерах — светлая и тёмная тема. Для проверки вида глазами, не тест.
// Запуск: npm run dev (демо) в другом окне, затем: node scripts/shots.mjs <папка> [адрес]
// Playwright — тот же, что у test/e2e.mjs: PLAYWRIGHT_PATH или /opt/node-tools/node_modules/playwright/index.mjs.
import { mkdirSync } from "node:fs";

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright/index.mjs");
const out = process.argv[2] || "shots";
const base = process.argv[3] || "http://127.0.0.1:5173/";
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
mkdirSync(out, { recursive: true });

export const SIZES = [
  ["375x812", 375, 812, true],
  ["390x844", 390, 844, true],
  ["402x874", 402, 874, true],
  ["430x932", 430, 932, true],
  ["768x1024", 768, 1024, true],
  ["1024x768", 1024, 768, true],
  ["1280x800", 1280, 800, false],
  ["1440x900", 1440, 900, false],
  ["1728x1117", 1728, 1117, false],
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
for (const [name, w, h, touch] of SIZES) {
  if (only && !only.includes(name)) continue;
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: touch && w < 1000, hasTouch: touch, colorScheme: theme, locale: "ru-RU" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name} ${theme}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${name} ${theme}: ${m.text()}`));
    await page.goto(base + "#/inbox", { waitUntil: "networkidle" });
    await page.waitForSelector("ul a[href^='#/inbox/']", { timeout: 8000 });
    await page.screenshot({ path: `${out}/${name}-${theme}-1-list.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth);
    if (overflow) errors.push(`${name} ${theme}: горизонтальная прокрутка страницы`);
    await page.locator("ul a[href^='#/inbox/']").first().click();
    await page.waitForSelector("[role=log]");
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}/${name}-${theme}-2-chat.png` });
    // карточка клиента: на телефоне и планшете — отдельный экран/панель, на компьютере — колонка (уже видна)
    if (w < 1280) {
      await page.getByRole("button", { name: /карточка клиента/ }).first().click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${name}-${theme}-3-contact.png` });
    }
    await ctx.close();
  }
}
await browser.close();
if (errors.length) {
  console.log("Замечания:\n" + [...new Set(errors)].join("\n"));
  process.exitCode = 1;
} else console.log("Снимки: " + out);
