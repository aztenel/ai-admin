// Сборка сайта winchester.kz: один шаблон (src/page.html) + два словаря (src/ru.mjs, src/kk.mjs) → index.html и kk/index.html.
// Так русская и казахская страницы не расходятся по вёрстке. Готовые страницы лежат в репозитории и загружаются на hoster.kz.
// Запуск: node apps/winchester-site/build.mjs           — собрать
//         node apps/winchester-site/build.mjs --check   — проверить, что index.html и kk/index.html собраны из текущих исходников
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ru from "./src/ru.mjs";
import kk from "./src/kk.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const SITE = "https://winchester.kz/";
const template = readFileSync(join(DIR, "src/page.html"), "utf8");
const sprite = readFileSync(join(DIR, "src/sprite.svg"), "utf8").trim();

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const preload = f => `<link rel="preload" href="../assets/fonts/${f}" as="font" type="font/woff2" crossorigin>`;

const PAGES = [
  { dict: ru, out: "index.html", lang: "ru", base: "", canonical: SITE, og_locale: "ru_RU", og_locale_alt: "kk_KZ", alt_href: "kk/", alt_lang: "kk",
    preload_extra: "" },
  // казахские буквы есть почти в каждом слове — их шрифты грузим сразу, чтобы текст не перерисовывался
  { dict: kk, out: "kk/index.html", lang: "kk", base: "../", canonical: SITE + "kk/", og_locale: "kk_KZ", og_locale_alt: "ru_RU", alt_href: "../", alt_lang: "ru",
    preload_extra: ["oswald-cyrillic-ext-600-normal.woff2", "manrope-cyrillic-ext-wght-normal.woff2", "inter-kazakh-ext-wght-normal.woff2", "inter-kazakh-wght-normal.woff2"].map(preload).join("\n") },
];

// Разметка организации — одна и та же сущность (@id) на обеих страницах; «ИП A.M.K» — знак в знак, как в документах для Meta
function jsonld(p) {
  const d = p.dict;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BarberShop",
    "@id": SITE + "#barbershop",
    name: "Winchester Barbershop",
    legalName: "ИП A.M.K",
    description: d.ld_description,
    url: p.canonical,
    telephone: "+77005050503",
    image: SITE + "og-image.jpg",
    logo: SITE + "favicon.svg",
    priceRange: "1 500–20 000 ₸",
    address: { "@type": "PostalAddress", streetAddress: d.ld_street, addressLocality: "Астана", addressCountry: "KZ" },
    // здание «Қабанбай Батыр даңғылы, 18» в OpenStreetMap — https://www.openstreetmap.org/way/51180035
    geo: { "@type": "GeoCoordinates", latitude: 51.14094, longitude: 71.41931 },
    hasMap: "https://2gis.kz/astana/firm/70000001038239111",
    openingHoursSpecification: { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], opens: "10:00", closes: "21:00" },
    sameAs: ["https://instagram.com/barbershop.winchester", "https://2gis.kz/astana/firm/70000001038239111"],
  }, null, 2);
}

function render(p) {
  const vals = { ...p.dict, lang: p.lang, base: p.base, canonical: p.canonical, og_locale: p.og_locale, og_locale_alt: p.og_locale_alt,
    alt_href: p.alt_href, alt_lang: p.alt_lang, preload_extra: p.preload_extra, sprite, jsonld: jsonld(p) };
  const used = new Set(["ld_description", "ld_street"]);
  const get = k => { if (!(k in vals)) throw new Error(`${p.out}: в словаре нет ключа «${k}»`); used.add(k); return vals[k]; };
  let html = template
    .replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\n/gm, "") // комментарий на отдельных строках — вместе со строками
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\{\{\{([a-z0-9_]+)\}\}\}/g, (_, k) => get(k))
    .replace(/\{\{([a-z0-9_]+)\}\}/g, (_, k) => esc(get(k)))
    .replace(/^[ \t]*\n/gm, ""); // пустые строки (и от пустых подстановок)
  if (/\{\{\{?[a-z0-9_]+\}\}/.test(html)) throw new Error(`${p.out}: осталась неподставленная метка {{…}}`);
  const extra = Object.keys(p.dict).filter(k => !used.has(k));
  if (extra.length) throw new Error(`${p.out}: в словаре лишние ключи: ${extra.join(", ")}`);
  return html;
}

const missing = [...Object.keys(ru).filter(k => !(k in kk)).map(k => `kk: нет «${k}»`), ...Object.keys(kk).filter(k => !(k in ru)).map(k => `ru: нет «${k}»`)];
if (missing.length) { console.error("Словари расходятся:\n  " + missing.join("\n  ")); process.exit(1); }

const check = process.argv.includes("--check");
let stale = 0;
for (const p of PAGES) {
  const html = render(p), file = join(DIR, p.out);
  if (check) {
    let cur = ""; try { cur = readFileSync(file, "utf8"); } catch {}
    if (cur !== html) { stale++; console.error(`${p.out} не совпадает с шаблоном и словарём — запустите node apps/winchester-site/build.mjs`); }
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
    console.log(`${p.out}: ${Buffer.byteLength(html)} байт`);
  }
}
if (check) { if (stale) process.exit(1); console.log("index.html и kk/index.html собраны из текущих исходников"); }
