// Что ещё не заполнено для проверки компании в Meta. Читает src/config/site.ts.
// npm run check:meta            — список
// npm run check:meta -- --strict — код выхода 1, если не хватает обязательного (для выкладки на свой домен)
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/config/site.ts", import.meta.url), "utf8");
const val = (block, key) => {
  const b = new RegExp(`export const ${block} = \\{([\\s\\S]*?)\\n\\};`).exec(src)?.[1] ?? "";
  const m = new RegExp(`\\n\\s*${key}: ([^,\\n]+)`).exec(b);
  return m ? m[1].trim().replace(/^"|"$/g, "") : "";
};
const items = [
  [val("legal", "nameVerified") === "true", "legal.nameVerified", "Сверить «" + val("legal", "name") + "» с документом ИП буква в букву (латиница/кириллица, регистр) и поставить true", true],
  [!!val("contacts", "email") || !!val("contacts", "phone"), "contacts.email / contacts.phone", "Хотя бы один реальный контакт: почта (лучше на своём домене) или телефон", true],
  [!!val("legal", "address"), "legal.address", "Юридический адрес как в документе, который подаётся в Meta (если владелец согласен его публиковать)", false],
  [!!val("legal", "bin"), "legal.bin", "ИИН/БИН (по решению владельца)", false],
  [!!val("contacts", "whatsapp") || !!val("contacts", "telegram"), "contacts.whatsapp / telegram", "Мессенджер для связи (по желанию)", false],
];
let missingRequired = 0;
for (const [ok, key, what, required] of items) {
  if (!ok && required) missingRequired++;
  console.log(`${ok ? "✓" : required ? "✗" : "·"} ${key.padEnd(30)} ${ok ? "заполнено" : what}`);
}
console.log(`\nSITE_URL: ${process.env.SITE_URL || "не задан (будет https://botflow-site.pages.dev)"}`);
console.log("Для Meta нужен свой домен: адреса *.pages.dev Meta может отклонить как общий хостинг.");
if (missingRequired && process.argv.includes("--strict")) { console.error(`\nНе хватает обязательного: ${missingRequired}`); process.exit(1); }
