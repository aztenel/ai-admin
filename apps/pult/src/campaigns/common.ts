// Общее для экранов раздела «Рассылки»: подписи, правила полей (как на сервере), оценка стоимости, разбор ошибок.
// Файл подключают только ленивые экраны раздела — в первое открытие пульта он не попадает.
import { ApiError } from "@/data/errors";
import type {
  BotNumberState,
  CampaignChannel,
  CampaignRow,
  CampaignStatus,
  CampaignsOverview,
  CrmOverview,
  NumberQuality,
  SegmentSpec,
} from "@/model/campaigns";

/**
 * Цена одного шаблона категории Marketing для получателя из Казахстана — 27,3 ₸ (экран Wazzapo, 19.10.2026).
 * Это оценка для владельца: точная цена (и её изменения) — в кабинете Meta / Wazzapo. Сервер цену не знает.
 */
export const MARKETING_PRICE_KZT = 27.3;
/** Больше стольких получателей — второе подтверждение с суммой перед «Запустить». */
export const CONFIRM_OVER = 100;
/** Чем заменить имя, если его нет. Сервер подставляет то же, если поле пустое. */
export const DEFAULT_FALLBACK = "уважаемый клиент";
/** Строка, которую сервер добавляет в конец сообщения с номера бота (если в тексте нет «стоп»). */
export const STOP_LINE = "Чтобы не получать сообщения, ответьте СТОП";
/** Правила полей — те же, что проверяет сервер (src/services/broadcast/create.js). */
export const TEMPLATE_RE = /^[a-z0-9_]{1,512}$/;
export const LANG_RE = /^[a-z]{2,3}(_[A-Z]{2})?$/;
export const IMAGE_RE = /^https:\/\/[^\s"'<>]{4,500}$/;
export const LANGS = [
  { id: "ru", label: "Русский" },
  { id: "kk", label: "Қазақша" },
  { id: "en", label: "English" },
] as const;
/** Пределы за 24 часа: основной номер — до 100 000 (на деле — предел Meta), номер бота — до 300 (обычный WhatsApp блокируют за массовые рассылки). */
export const CAP_MAX: Record<CampaignChannel, number> = { main: 100000, bot: 300 };
/** Часы отправки по Астане: шаблоны — 11–20 (ТЗ §4.4), номер бота — 10–20, как на старой странице. Сервер принимает 8–22. */
export const HOURS_DEFAULT: Record<CampaignChannel, { from: number; to: number }> = { main: { from: 11, to: 20 }, bot: { from: 10, to: 20 } };
export const HOURS_RANGE = { min: 8, max: 22 } as const;

export const CHANNEL_LABEL: Record<CampaignChannel, string> = { main: "Основной номер", bot: "Номер бота" };
export const CHANNEL_HINT: Record<CampaignChannel, string> = {
  main: "Шаблон Meta. Строка «СТОП» — в самом шаблоне.",
  bot: "Обычное сообщение. Пауза 30–150 секунд между сообщениями, строку «СТОП» добавит бот.",
};

export type Tone = "ok" | "run" | "warn" | "critical" | "muted";
export const STATUS: Record<CampaignStatus, { label: string; tone: Tone }> = {
  ready: { label: "Готова к запуску", tone: "muted" },
  running: { label: "Идёт отправка", tone: "run" },
  paused: { label: "На паузе", tone: "warn" },
  stopped: { label: "Остановлена", tone: "muted" },
  done: { label: "Завершена", tone: "ok" },
};
export const QUALITY: Record<NumberQuality, { label: string; tone: Tone }> = {
  green: { label: "высокое", tone: "ok" },
  yellow: { label: "среднее — есть жалобы", tone: "warn" },
  red: { label: "низкое — много жалоб", tone: "critical" },
  unknown: { label: "неизвестно", tone: "muted" },
};
/** Почему человека нет в сегментах (CrmOverview.excluded). */
export const EXCLUDED: Record<keyof CrmOverview["excluded"], string> = {
  stop: "просили не писать",
  fut: "уже записаны",
  recent: "были меньше 14 дней назад",
  marketed: "уже писали за 14 дней",
};
/** Отметки визитов в журнале Altegio (CrmInfo.att). Что ставят администраторы Winchester — не проверено, поэтому показываем как есть. */
export const ATTENDANCE: Record<string, string> = { "1": "пришёл", "-1": "не пришёл — не считается", "0": "без отметки", "2": "подтвердил запись", нет: "без отметки" };

// ---------- числа и деньги ----------
const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
/** 1 092 ₸ (неразрывные пробелы ru-RU). */
// неразрывные пробелы: «≈ 191 ₸» на узком экране не разрывается на «≈» и «191 ₸» (находка проверки 19.10.2026)
export const money = (kzt: number) => `${nf.format(Math.round(kzt))}\u00a0₸`;
/** Оценка стоимости рассылки шаблоном: получатели × цена шаблона Marketing. */
export const costEstimate = (recipients: number) => recipients * MARKETING_PRICE_KZT;
/** «≈ 1 092 ₸ — оценка: 40 × 27,3 ₸. Точная цена — в кабинете Meta.» Номеру бота — бесплатно, но риск блокировки. */
export function costText(channel: CampaignChannel, recipients: number): string {
  if (channel === "bot") return "Бесплатно, но обычный WhatsApp могут заблокировать за массовые сообщения.";
  return `≈\u00a0${money(costEstimate(recipients))} — оценка: ${nf.format(recipients)} × ${nf.format(MARKETING_PRICE_KZT)} ₸. Точная цена — в кабинете Meta.`;
}

/** Предел в сутки по умолчанию: основной номер — предел Meta × 0,95 (или 240, если предел неизвестен); номер бота — 50. */
export function defaultCap(channel: CampaignChannel, ov: Pick<CampaignsOverview, "main" | "bot"> | null): number {
  if (channel === "bot") return ov?.bot?.cap.def || 50;
  const limit = ov?.main.limit || 0;
  return limit > 0 ? Math.max(1, Math.floor(limit * 0.95)) : 240;
}

/** Можно ли рассылать с номера. available = false — вариант недоступен (reason — почему); warn — создать можно, запустить пока нельзя. */
export function channelState(ov: Pick<CampaignsOverview, "main" | "bot">, channel: CampaignChannel): { available: boolean; reason: string; warn: string } {
  if (channel === "main") return { available: true, reason: "", warn: ov.main.ready ? "" : ov.main.why };
  const b: BotNumberState | null = ov.bot;
  if (!b) return { available: false, reason: "Номера бота (Green-API) у компании нет.", warn: "" };
  if (b.noBroadcast) return { available: false, reason: b.noBroadcast, warn: "" };
  return { available: true, reason: "", warn: !b.ready ? b.why : !b.hook ? b.warn : b.hold ? `Сигнал от Green-API: ${b.hold}.` : "" };
}

/** Ход рассылки одной строкой: «отправлено 12 из 40 · не дошло 1 · просили не писать 2 · уже записались или им писали 3». */
export function progressText(c: Pick<CampaignRow, "total" | "sent" | "failed" | "skipped" | "excluded">): string {
  return [
    `отправлено ${c.sent} из ${c.total}`,
    c.failed ? `не дошло ${c.failed}` : "",
    c.skipped ? `просили не писать ${c.skipped}` : "",
    c.excluded ? `уже записались или им писали ${c.excluded}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
/** Доля для полоски хода, 0–100. */
export const progressPct = (c: Pick<CampaignRow, "pos" | "total">) => (c.total ? Math.min(100, Math.round((c.pos / c.total) * 100)) : 0);

/** Название сегмента с фильтрами — как его назовёт сервер: «Давно не были · 40–60 дн. с визита · мастер Арман». */
export function segmentTitle(spec: SegmentSpec, segments: { id: string; label: string }[] = []): string {
  const base = spec.id === "all" ? "Вся база" : segments.find((s) => s.id === spec.id)?.label || (spec.id.startsWith("staff:") ? `Мастер: ${spec.id.slice(6)}` : spec.id);
  const days = spec.from !== undefined || spec.to !== undefined ? `${spec.from ?? 0}–${spec.to ?? 400} дн. с визита` : "";
  return [base, days, spec.staff ? `мастер ${spec.staff}` : ""].filter(Boolean).join(" · ");
}

/** Подставить имя в текст — для предпросмотра пузыря до проверки на сервере. */
export const withName = (text: string, name: string) => text.replace(/\{\s*(имя|name)\s*\}/gi, name);

// ---------- ошибки ----------
const cap1 = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** Текст ошибки для человека (сервер пишет понятные причины). */
export const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Что-то пошло не так. Попробуйте ещё раз.");
/** Ошибки списком: ошибки формы сервера (ApiError.errors) — каждая строкой с заглавной буквы; иначе одна строка. */
export const errorList = (e: unknown): string[] => (e instanceof ApiError && e.errors?.length ? e.errors.map(cap1) : [errText(e)]);
/** Ошибки проверки (CampaignCheck.errors) — с заглавной буквы. */
export const checkErrors = (errors: string[]) => errors.map(cap1);
/** Нет права (сотруднику — 403 на автосценарий, «Обновить базу», «Снять сигнал»). */
/** Вопрос сервера при сигнале «остановиться» — сотруднику как причина: снять сигнал (а запуск его снимает) может только владелец. */
export const ownerOnly = (question: string) => `${question.replace(/\s*(Всё равно продолжить|Снять сигнал, если причина устранена)\?/g, "").trim()} Снять сигнал может владелец.`;
export const isForbidden = (e: unknown) => e instanceof ApiError && e.status === 403;
