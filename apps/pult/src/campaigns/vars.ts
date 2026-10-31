// Переменные в текстах рассылок (ТЗ v3.0 §4.3). На сервере текст хранится с каноническими именами — {{client.first_name}},
// {{staff.name}}…; администратор видит и вставляет их словами: {Имя клиента}, {Мастер}. Перевод туда и обратно — здесь.
// Старые записи {имя}, {мастер} сервер принимает и сам приводит к каноническим.
import type { TemplateVar } from "@/model/campaigns";

/** Запасной список, пока сервер не ответил (совпадает с src/services/broadcast/render.js). */
export const DEFAULT_VARS: TemplateVar[] = [
  { key: "client.first_name", label: "Имя клиента", sample: "Арман" },
  { key: "staff.name", label: "Мастер", sample: "Айдос" },
  { key: "service.name", label: "Услуга", sample: "мужская стрижка" },
  { key: "visit.days_since", label: "Дней после визита", sample: "28" },
  { key: "company.name", label: "Название барбершопа", sample: "Winchester" },
  { key: "booking.url", label: "Ссылка на запись", sample: "winchester.kz" },
  { key: "company.address", label: "Адрес", sample: "Кабанбай батыра, 18" },
];
const LEGACY: Record<string, string> = { имя: "client.first_name", мастер: "staff.name", услуга: "service.name", дней: "visit.days_since", компания: "company.name", ссылка: "booking.url" };

/** {{client.first_name}} → {Имя клиента} (для редактора). */
export function toHuman(text: string, vars: TemplateVar[] = DEFAULT_VARS): string {
  const by = new Map(vars.map((v) => [v.key, v.label]));
  return text
    .replace(/\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g, (m, k: string) => (by.has(k) ? `{${by.get(k)}}` : m))
    .replace(/\{(имя|мастер|услуга|дней|компания|ссылка)\}/gi, (m, k: string) => {
      const key = LEGACY[k.toLowerCase()];
      return key && by.has(key) ? `{${by.get(key)}}` : m;
    });
}
/** {Имя клиента} → {{client.first_name}} (перед сохранением и предпросмотром). */
export function toCanon(text: string, vars: TemplateVar[] = DEFAULT_VARS): string {
  const by = new Map(vars.map((v) => [v.label.toLowerCase(), v.key]));
  return text.replace(/\{([^{}]{2,40})\}/g, (m, label: string) => {
    const key = by.get(label.trim().toLowerCase()) || LEGACY[label.trim().toLowerCase()];
    return key ? `{{${key}}}` : m;
  });
}
/** Есть ли в тексте места, которые надо вписать перед отправкой: [условия акции], [время]. */
export const hasBlanks = (t: string) => /\[[^\]]*\]/.test(t);
