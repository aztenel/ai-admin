// Что ещё не заполнено для проверки компании в Meta. Читает src/config/site.ts.
// npm run check:meta             — список
// npm run check:meta -- --strict — код выхода 1, если не хватает обязательного
import { metaStatus } from "./meta-status.mjs";
const { items, missingRequired } = metaStatus();
for (const i of items) console.log(`${i.ok ? "✓" : i.required ? "✗" : "·"} ${i.key.padEnd(30)} ${i.ok ? "заполнено" : i.what}`);
console.log(`\nSITE_URL: ${process.env.SITE_URL || "не задан — сборка будет тестовой (noindex, адрес публикации Cloudflare)"}`);
console.log("Для Meta нужен свой домен: адреса *.pages.dev и *.workers.dev — общий хостинг, Meta их уже отклоняла.");
if (missingRequired.length && process.argv.includes("--strict")) { console.error(`\nНе хватает обязательного: ${missingRequired.length}`); process.exit(1); }
