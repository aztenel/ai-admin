// Время, даты, номера телефонов и склонения — по-русски, без библиотек.
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MON_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const p2 = (n: number) => String(n).padStart(2, "0");
const dayStart = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const daysBetween = (a: number, b: number) => Math.round((dayStart(b) - dayStart(a)) / 864e5);

export const timeHM = (t: number) => {
  const d = new Date(t);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

/** Время в строке списка: сегодня — часы, вчера, на этой неделе — день недели, иначе число. */
export function rowTime(t: number, now: number): string {
  if (!t) return "";
  const n = daysBetween(t, now);
  if (n <= 0) return timeHM(t);
  if (n === 1) return "вчера";
  if (n < 7) return WD[new Date(t).getDay()];
  const d = new Date(t);
  return d.getFullYear() === new Date(now).getFullYear() ? `${d.getDate()} ${MON_SHORT[d.getMonth()]}` : `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}

/** Разделитель дней в переписке. */
export function dayLabel(t: number, now: number): string {
  const n = daysBetween(t, now);
  if (n === 0) return "Сегодня";
  if (n === 1) return "Вчера";
  const d = new Date(t);
  return `${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() !== new Date(now).getFullYear() ? " " + d.getFullYear() : ""}`;
}
export const sameDay = (a: number, b: number) => dayStart(a) === dayStart(b);

/** Сколько клиент ждёт ответа: «5 мин», «2 ч», «3 дн». */
export function waited(since: number, now: number): string {
  const m = Math.max(0, Math.floor((now - since) / 60e3));
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч`;
  return `${Math.floor(h / 24)} дн`;
}

/** «до 18:40», «до завтра, 09:00», «до 21 октября, 09:00». */
export function until(t: number, now: number): string {
  const n = daysBetween(now, t);
  if (n === 0) return `до ${timeHM(t)}`;
  if (n === 1) return `до завтра, ${timeHM(t)}`;
  const d = new Date(t);
  return `до ${d.getDate()} ${MON[d.getMonth()]}, ${timeHM(t)}`;
}

/** Относительная дата для списков заявок и рассылок. */
export function shortDate(t: number, now: number): string {
  if (!t) return "";
  const n = daysBetween(t, now);
  if (n === 0) return `сегодня, ${timeHM(t)}`;
  if (n === 1) return `вчера, ${timeHM(t)}`;
  const d = new Date(t);
  return `${d.getDate()} ${MON[d.getMonth()]}, ${timeHM(t)}`;
}

/** +7 701 048 27 15 — так номера пишут в Казахстане. Чужие форматы оставляем как есть. */
export function formatPhone(s: string): string {
  const d = String(s || "").replace(/\D/g, "");
  if (d.length === 11 && (d[0] === "7" || d[0] === "8")) return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}`;
  if (d.length >= 8 && d.length <= 15) return "+" + d;
  return String(s || "");
}
/** Последние четыре цифры: «·· 27 15» — чтобы различать номера компании, не занимая места. */
export function phoneTail(s: string): string {
  const d = String(s || "").replace(/\D/g, "");
  return d.length >= 4 ? `·· ${d.slice(-4, -2)} ${d.slice(-2)}` : "";
}

/** Инициалы: «Айгерим Нуртаева» → «АН», «Ерлан» → «ЕР»; без имени — две последние цифры номера. */
export function initials(name?: string, phone?: string): string {
  const w = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase();
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  const d = String(phone || "").replace(/\D/g, "");
  return d ? d.slice(-2) : "?";
}

/** 1 чат, 2 чата, 5 чатов. */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100, b = a % 10;
  return forms[a > 10 && a < 20 ? 2 : b === 1 ? 0 : b >= 2 && b <= 4 ? 1 : 2];
}
