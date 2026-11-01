// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { metaStatus } from "./scripts/meta-status.mjs";

// Адрес сайта — для canonical, Open Graph и sitemap.
//  • SITE_URL задан (Cloudflare Pages → Settings → Variables) — боевая сборка: сайт индексируется,
//    и она не соберётся, пока не заполнено обязательное для Meta (название ИП сверено, есть контакт).
//  • Не задан — тестовая сборка: адрес текущей публикации Pages (CF_PAGES_URL) или localhost,
//    страницы закрыты от поисковиков (noindex, robots Disallow).
// Адреса по умолчанию нет намеренно: 01.11.2026 оказалось, что botflow-site.pages.dev — чужой проект,
// и canonical со ссылками указывали бы на чужой сайт.
const SITE_URL = (process.env.SITE_URL || "").trim().replace(/\/$/, "");
const SITE = SITE_URL || (process.env.CF_PAGES_URL || "http://localhost:4321").replace(/\/$/, "");
const INDEXABLE = Boolean(SITE_URL);
// без способа связи страница «Контакты» не в меню и не в карте сайта (там только реквизиты)
const meta = metaStatus();
const HAS_CONTACT = meta.items.some((i) => i.ok && i.key.startsWith("contacts.")) || process.env.PUBLIC_CONTACT_FORM === "1";

if (INDEXABLE) {
  if (!/^https:\/\//.test(SITE_URL)) throw new Error(`SITE_URL должен начинаться с https://, сейчас «${SITE_URL}»`);
  const { missingRequired } = meta;
  if (missingRequired.length) {
    throw new Error(
      "Боевая сборка остановлена: в src/config/site.ts не заполнено обязательное —\n" +
        missingRequired.map((i) => `  • ${i.key}: ${i.what}`).join("\n") +
        "\nЧтобы выложить тестовую версию, уберите SITE_URL (она будет закрыта от поисковиков).",
    );
  }
}

export default defineConfig({
  site: SITE,
  trailingSlash: "always",
  build: { format: "directory", inlineStylesheets: "never" },
  // Локализация: русский — основной, без префикса. Казахский и английский добавляются
  // строками в src/i18n и страницами в src/pages/kk, src/pages/en.
  i18n: { locales: ["ru"], defaultLocale: "ru", routing: { prefixDefaultLocale: false } },
  integrations: [sitemap({ filter: (page) => !page.includes("/404") && (HAS_CONTACT || !page.endsWith("/contacts/")) })],
  // assetsInlineLimit: 0 — скрипты всегда отдельными файлами: строгая CSP без 'unsafe-inline' для скриптов.
  vite: {
    plugins: [tailwindcss()],
    build: { assetsInlineLimit: 0 },
    define: { __INDEXABLE__: JSON.stringify(INDEXABLE) },
  },
});
