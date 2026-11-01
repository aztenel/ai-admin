// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// Адрес сайта нужен для canonical, Open Graph и sitemap.
// В Cloudflare Pages задаётся переменной SITE_URL (Settings → Variables).
// Пока своего домена нет — адрес Pages по умолчанию (имя проекта botflow-site).
const SITE = (process.env.SITE_URL || "https://botflow-site.pages.dev").replace(/\/$/, "");

export default defineConfig({
  site: SITE,
  trailingSlash: "always",
  build: { format: "directory", inlineStylesheets: "never" },
  // Локализация: русский — основной, без префикса. Казахский и английский добавляются
  // строками в src/i18n и страницами в src/pages/kk, src/pages/en.
  i18n: { locales: ["ru"], defaultLocale: "ru", routing: { prefixDefaultLocale: false } },
  integrations: [sitemap({ filter: (page) => !page.includes("/404") })],
  // assetsInlineLimit: 0 — скрипты всегда отдельными файлами: строгая CSP без 'unsafe-inline' для скриптов.
  vite: { plugins: [tailwindcss()], build: { assetsInlineLimit: 0 } },
});
