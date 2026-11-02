// @ts-check
// Сегменты базы контактов D1 (этап 1, 31.10.2026). Как у снимка KV (services/crm/segments.js): дни с последнего визита — по календарю
// Астаны. Сегмент — условие над вычисленными полями контакта (db/d1/contacts.js, K): d — дней с визита, visits, v90 — визитов
// за 90 дней, booked — запись впереди, blocked — запрет (D1 или «стоп» в KV), review — ждёт решения, consent — согласие на рекламу.
// Сегменты не хранятся: синхронизация меняет записи и сводку клиента — числа и состав сегментов меняются сами.

/** Сколько дней не писать рекламу после прошлой рекламы (предварительное решение владельца 31.10.2026). */
export const MARKETING_GAP_DAYS = 30;
/** Визит меньше 14 дней назад — рекламу не пишем. */
export const QUIET_DAYS = 14;
export const GAP_MS = MARKETING_GAP_DAYS * 86400e3;

// можно писать рекламу: нет запрета и решения не ждёт, нет будущей записи, подтверждённое согласие (без него — нельзя, решение
// владельца 31.10.2026), не был последние 14 дней, рекламы не было 30 дней
// (с 31.10.2026: согласие — только подтверждённое; пауза после отменённой записи — тоже «нельзя»)
export const READY = `blocked = 0 and review = 0 and booked = 0 and cooled = 0 and consent = 'granted' and cconf = 1 and (d is null or d >= ${QUIET_DAYS}) and recent = 0`;
/** Пауза рекламы после отменённой или пропавшей записи — дней (решение владельца 31.10.2026: исчезнувшая запись не возвращает в рекламу сразу). */
export const COOL_DAYS = 14;

export const SEGMENTS = /** @type {{ id: string, label: string, rule: string, where: string }[]} */ ([
  { id: "all", label: "Все", rule: "все контакты компании", where: "1 = 1" },
  { id: "pora", label: "Пора на стрижку", rule: "последний визит 21–35 дней назад", where: "d between 21 and 35" },
  { id: "davno", label: "Давно не были", rule: "36–60 дней", where: "d between 36 and 60" },
  { id: "uhodyat", label: "Уходят", rule: "61–90 дней", where: "d between 61 and 90" },
  { id: "ushli", label: "Больше 90 дней", rule: "последний визит больше 90 дней назад", where: "d > 90" },
  { id: "novye", label: "Новые", rule: "один визит, за последние 90 дней", where: "visits = 1 and d <= 90" },
  { id: "postoyannye", label: "Постоянные", rule: "3 и больше визитов за 90 дней", where: "v90 >= 3" },
  { id: "zapis", label: "Есть запись", rule: "ближайшая запись впереди", where: "booked = 1" },
  { id: "bez", label: "Без визитов", rule: "добавлены вручную или из файла, визитов нет ни в журнале, ни в справочнике Altegio", where: "visits = 0 and coalesce(altv, 0) = 0 and lastv is null" },
  { id: "stop", label: "Просили не писать", rule: "действующий запрет", where: "blocked = 1" },
  { id: "review", label: "Ждут решения", rule: "неоднозначный «стоп»", where: "review = 1" }
]);

/** Условие сегмента; «staff:<имя>» — последний визит у мастера (имя — параметр ?5). null — сегмент неизвестен. @param {any} seg */
export function segWhere(seg) {
  const s = String(seg || "all");
  if (s.startsWith("staff:")) return s.length > 6 && s.length <= 66 ? { where: "last_staff = ?5", staff: s.slice(6) } : null;
  const f = SEGMENTS.find(x => x.id === s);
  return f ? { where: f.where } : null;
}

/**
 * Почему этому клиенту нельзя писать рекламу (по-русски). Пусто — можно.
 * @param {any} k вычисленные поля контакта
 */
export function marketWhy(k) {
  const out = [];
  if (+k.full) out.push("просил не писать вообще");
  else if (+k.blocked) out.push("просил не писать рекламу («стоп»)");
  if (+k.review) out.push("неоднозначный «стоп» — ждёт решения");
  if (k.consent !== "granted") out.push(k.consent === "denied" ? "отказался от рассылок" : "нет подтверждённого согласия на рассылки");
  else if (!+k.cconf) out.push("согласие не подтверждено (из файла или Altegio) — подтвердите в карточке");
  if (+k.booked) out.push("уже записан");
  if (+k.cooled) out.push(`отменил запись — пауза до ${new Date(+k.cool_until + 5 * 3600e3).toISOString().slice(0, 10).split("-").reverse().join(".")}`);
  if (k.d != null && +k.d < QUIET_DAYS) out.push(`был ${+k.d} дн. назад — меньше ${QUIET_DAYS}`);
  if (+k.recent) out.push(`реклама уже была за последние ${MARKETING_GAP_DAYS} дней`);
  return out;
}
