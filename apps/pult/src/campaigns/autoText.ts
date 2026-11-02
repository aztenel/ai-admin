// Тексты «Автоматических сообщений» в редакторе пульта (AutoMessages.tsx): пример «Так увидит клиент» прямо при вводе — как текст соберёт
// сервер. Сервисные — {имя} {дата} {время} {мастер} {услуга} {услуга и мастер} {адрес} {ссылка} {компания}, кусок в [[ … ]] пропадает,
// если в нём пустая вставка (src/services/reminders/templates.js, render); рекламные — {{client.first_name}} и т. п. (в редакторе —
// словами: {Имя клиента}, campaigns/vars.ts). Значения вставок — те же, что в примере сервера для сохранённого текста: их достаём из
// пары «сохранённый текст → пример сервера» (sampleFrom); чего в сохранённом тексте не было — запасные (вымышленная запись).

/** Вставки сервисных сообщений, которые принимает сервер (SV_VARS). */
export const SV_VARS = ["имя", "дата", "время", "мастер", "услуга", "услуга и мастер", "адрес", "ссылка", "компания"];
/** Подпись вставки на кнопке: «имя» → «Имя». */
export const svLabel = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

/** Запасные значения — вымышленная запись, как пример сервера: Арман, завтра в 15:00, мужская стрижка у мастера Данияра. */
export function svDefaults(company: string): Record<string, string> {
  return { имя: "Арман", дата: "завтра", время: "15:00", услуга: "Мужская стрижка", мастер: "Данияр", "услуга и мастер": "Мужская стрижка, мастер Данияр", компания: company, адрес: "", ссылка: "" };
}
export function mkDefaults(company: string): Record<string, string> {
  return { "client.first_name": "Арман", "staff.name": "Данияр", "service.name": "Мужская стрижка", "visit.days_since": "28", "company.name": company, "booking.url": "", "company.address": "" };
}

/** Как сервер: {вставка}; [[ … ]] пропадает, если в нём пустая вставка. */
export function svRender(text: string, vars: Record<string, string>): string {
  const sub = (s: string) => s.replace(/\{([^{}]+)\}/g, (_, k: string) => vars[k] ?? "");
  return sub(text.replace(/\[\[([\s\S]*?)\]\]/g, (_, part: string) => ([...part.matchAll(/\{([^{}]+)\}/g)].some((m) => !(vars[m[1]] ?? "")) ? "" : part)));
}
/** Рекламный текст: {{ключ}} → значение (в примере имя есть всегда, поэтому правила «без имени» сервера здесь не нужны). */
export function mkRender(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Значения вставок из пары «текст с вставками → готовый текст сервера». Каждая вставка — ленивая группа между неизменными кусками текста,
 * [[ … ]] — необязательная группа. Не совпало (сервер собрал иначе) — null, тогда только запасные значения.
 */
export function sampleFrom(tpl: string, out: string, kind: "service" | "marketing"): Record<string, string> | null {
  if (!tpl || !out || tpl.length > 2000) return null;
  const token = kind === "service" ? /\[\[|\]\]|\{([^{}]+)\}/g : /\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g;
  const group = new Map<string, number>();
  let src = "", last = 0, n = 0;
  for (const m of tpl.matchAll(token)) {
    src += esc(tpl.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    if (m[0] === "[[") src += "(?:";
    else if (m[0] === "]]") src += ")?";
    else {
      const k = m[1].trim(), g = group.get(k);
      if (g) src += `(?:\\${g})`; // в скобках: цифры текста после ссылки на группу не склеятся с её номером
      else {
        group.set(k, ++n);
        src += "([\\s\\S]*?)";
      }
    }
  }
  src += esc(tpl.slice(last));
  try {
    const r = new RegExp(`^${src}$`).exec(out);
    if (!r) return null;
    return Object.fromEntries([...group].map(([k, i]) => [k, r[i] ?? ""]));
  } catch {
    return null; // необычный текст (несогласованные [[ ]]) — пример по запасным значениям
  }
}

/** Пример на языке kk: значения те же, слово «мастер» — по-казахски, как у сервера (svVars). */
export const kkVars = (v: Record<string, string>) => ({ ...v, "услуга и мастер": (v["услуга и мастер"] || "").replace(/(^|, )мастер /, "$1шебер ") });

/** Номер нажатия для защиты от двойной отправки (сервер принимает [A-Za-z0-9_-], 6–40 знаков). */
export const newRid = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
