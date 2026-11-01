// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { metaStatus } from "./scripts/meta-status.mjs";

// Адрес сайта — для canonical, Open Graph и sitemap.
//  • SITE_URL задан (или сборка в Workers Builds) — боевая сборка: сайт индексируется,
//    не соберётся без сверенного названия ИП; без контактов — только предупреждение.
//  • Не задан — тестовая сборка: адрес публикации Pages (CF_PAGES_URL) или localhost,
//    страницы закрыты от поисковиков (noindex, robots Disallow).
// Адреса по умолчанию нет намеренно: 01.11.2026 оказалось, что botflow-site.pages.dev — чужой проект,
// и canonical со ссылками указывали бы на чужой сайт.
// Сборка в Cloudflare Workers Builds (WORKERS_CI=1) — боевая на https://tayveno.xyz, если SITE_URL не задан явно.
const PRODUCTION_URL = "https://tayveno.xyz";
const SITE_URL = (process.env.SITE_URL || (process.env.WORKERS_CI === "1" ? PRODUCTION_URL : "")).trim().replace(/\/$/, "");
const SITE = SITE_URL || (process.env.CF_PAGES_URL || "http://localhost:4321").replace(/\/$/, "");
const INDEXABLE = Boolean(SITE_URL);
// без способа связи страница «Контакты» не в меню и не в карте сайта (там только реквизиты)
const meta = metaStatus();
const HAS_CONTACT = meta.items.some((i) => i.ok && i.key.startsWith("contacts.")) || process.env.PUBLIC_CONTACT_FORM === "1";

if (INDEXABLE) {
  if (!/^https:\/\//.test(SITE_URL)) throw new Error(`SITE_URL должен начинаться с https://, сейчас «${SITE_URL}»`);
  // Название ИП обязано быть сверено с документом — без этого боевую версию не собираем.
  // Остальное (контакты) — предупреждение: технический запуск сайта им не блокируется (решение владельца 01.11.2026),
  // без контактов кнопки «Обсудить проект» и пункт «Контакты» на сайте скрыты.
  const nameItem = meta.items.find((i) => i.key === "legal.nameVerified");
  if (nameItem && !nameItem.ok) throw new Error(`Боевая сборка остановлена: ${nameItem.what}`);
  for (const i of meta.missingRequired) console.warn(`[check:meta] не заполнено: ${i.key} — ${i.what}`);
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
