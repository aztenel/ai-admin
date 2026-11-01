// Готовность сайта к проверке Meta: что из обязательного не заполнено в src/config/site.ts.
// Используют: scripts/check-meta.mjs (вывод в консоль) и astro.config.mjs (боевая сборка не пройдёт без обязательного).
import { readFileSync } from "node:fs";

export function metaStatus() {
  const src = readFileSync(new URL("../src/config/site.ts", import.meta.url), "utf8");
  const val = (block, key) => {
    const b = new RegExp(`export const ${block} = \\{([\\s\\S]*?)\\n\\};`).exec(src)?.[1] ?? "";
    const m = new RegExp(`\\n\\s*${key}: ([^,\\n]+)`).exec(b);
    return m ? m[1].trim().replace(/^"|"$/g, "") : "";
  };
  const items = [
    { ok: val("legal", "nameVerified") === "true", key: "legal.nameVerified", required: true,
      what: `Сверить «${val("legal", "name")}» с документом ИП буква в букву (латиница/кириллица, регистр, кавычки) и поставить true` },
    { ok: !!val("contacts", "email") || !!val("contacts", "phone"), key: "contacts.email / contacts.phone", required: true,
      what: "Хотя бы один реальный контакт: почта (лучше на своём домене) или телефон — те же, что в форме Meta" },
    { ok: !!val("legal", "bin"), key: "legal.bin", required: false, what: "ИИН/БИН из документа (по решению владельца)" },
    { ok: !!val("legal", "address"), key: "legal.address", required: false, what: "Юридический адрес как в документе, поданном в Meta (по решению владельца)" },
    { ok: !!val("contacts", "whatsapp") || !!val("contacts", "telegram"), key: "contacts.whatsapp / telegram", required: false, what: "Мессенджер для связи (по желанию)" },
  ];
  return { items, missingRequired: items.filter((i) => i.required && !i.ok) };
}
