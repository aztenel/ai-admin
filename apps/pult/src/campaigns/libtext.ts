// Библиотека текстов рассылок второго номера (финальное ТЗ рассылок Winchester, 02.11.2026): 28 утверждённых владельцем текстов в 7
// категориях, только русский, без вставок — имя клиента в приветствие ставит сервер («Добрый день!» → «Добрый день, Азамат!»).
// Здесь — общее для «Шаблонов» (Library.tsx) и шага «Сообщение» мастера (GaWizard.tsx): статус текста словами, отрывок для списка,
// поиск, группы по категориям. Переменных вида {{…}} пульт не показывает: у старых своих текстов они видны словами ({Имя клиента}).
import type { LibraryCat, LibraryItem } from "@/model/campaigns";
import { toHuman } from "./vars";

/** Подпись у стартовых текстов, которые владелец утвердил и никто не менял (сервер: APPROVED_BY). */
export const EDITION = "Утверждённая редакция";

export type LibStatus = "edition" | "approved" | "review" | "facts" | "archived";
export const LIB_STATUS: Record<LibStatus, { label: string; cls: string }> = {
  edition: { label: EDITION, cls: "bg-positive-soft text-positive" },
  approved: { label: "Одобрен", cls: "bg-positive-soft text-positive" },
  review: { label: "Ждёт одобрения", cls: "bg-surface-2 text-fg-2" },
  facts: { label: "Нужны данные", cls: "bg-accent-soft text-accent-ink" },
  archived: { label: "В архиве", cls: "bg-surface-2 text-fg-3" },
};

/** Есть ли в тексте места, которые надо вписать перед отправкой: [условия акции], [время]. */
const blanks = (t: string) => /\[[^\]]*\]/.test(t);

/** Статус для показа: стартовый одобренный текст без правок (версия 1) — «утверждённая редакция». */
export function libStatus(x: LibraryItem): LibStatus {
  if (x.archived) return "archived";
  const st = x.status || (x.approved ? "approved" : blanks(x.ru) ? "facts" : "review");
  if (st === "approved") return !x.custom && (x.v ?? 1) <= 1 ? "edition" : "approved";
  return st;
}
/** Готов для рассылки: одобрен владельцем и не в архиве. */
export const usable = (x: LibraryItem) => x.approved && !x.archived && !blanks(x.ru);

/** Отрывок для списка: без приветствия первой строки (оно у всех одинаковое), абзацы — пробелами; вставки старых своих текстов — словами. */
export function snippet(text: string): string {
  const t = toHuman(text || "").trim();
  const body = t.replace(/^[^\n]{0,40}(день|вечер|утро|здравствуйте|привет)[^\n]*\n+/i, "");
  return (body || t).replace(/\s*\n+\s*/g, " ").trim();
}

/** Поиск по названию, категории и тексту — без учёта регистра и «ё». */
export function matches(x: LibraryItem, q: string, cats: LibraryCat[] = []): boolean {
  const s = norm(q.trim());
  if (!s) return true;
  const cat = cats.find((c) => c.id === x.cat)?.label || "";
  return norm(`${x.title} ${cat} ${x.who || ""} ${x.ru}`).includes(s);
}
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/** Тексты по категориям в порядке сервера; свои тексты без известной категории — отдельной группой «Свои тексты». */
export function byCategory(items: LibraryItem[], cats: LibraryCat[]): { cat: LibraryCat; items: LibraryItem[] }[] {
  const out = cats.map((cat) => ({ cat, items: items.filter((x) => x.cat === cat.id) })).filter((g) => g.items.length);
  const rest = items.filter((x) => !cats.some((c) => c.id === x.cat));
  if (rest.length) out.push({ cat: { id: "", label: "Свои тексты" }, items: rest });
  return out;
}
