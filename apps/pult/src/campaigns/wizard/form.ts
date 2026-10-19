// Черновик мастера рассылки: поля формы, умолчания, проверка по шагам и перевод в CampaignDraft для сервера.
// Правила — те же, что проверяет сервер (src/services/broadcast/create.js); сервер всё равно проверит ещё раз,
// а его ошибки пульт показывает списком как есть. Мастер — только основной номер (шаблон Meta): решение владельца 19.10.2026.
import type { CampaignDraft, CrmOverview, CrmSegment, SegmentSpec } from "@/model/campaigns";
import { DEFAULT_FALLBACK, HOURS_DEFAULT, IMAGE_RE, TEMPLATE_RE, segmentTitle } from "../common";

export const STEPS = ["Кому", "Сообщение", "Часы и предел", "Проверка", "Запуск"] as const;
export const STEP_CHECK = 3;
export const STEP_LAUNCH = 4;

export type Source = "segment" | "list";
export type Form = {
  /** null — выбрать само: база клиентов, если она есть, иначе список. */
  source: Source | null;
  segId: string;
  /** Уточнение сегмента: дни с последнего визита (строки полей) и мастер. */
  dayFrom: string;
  dayTo: string;
  staff: string;
  filters: boolean;
  recipients: string;
  listKind: "" | "idle" | "bday";
  listDays: string;
  tpl: string;
  lang: string;
  params: string[];
  text: string;
  img: string;
  fallback: string;
  cap: string;
  from: number;
  to: number;
  name: string;
  nameTouched: boolean;
  consent: boolean;
};

export type FieldKey = "segId" | "days" | "recipients" | "listDays" | "tpl" | "text" | "params" | "img" | "fallback" | "cap" | "hours" | "name" | "consent";
export type Errs = Partial<Record<FieldKey, string>>;

export function initialForm(preset?: { segment?: SegmentSpec }): Form {
  const s = preset?.segment;
  const str = (n?: number) => (n === undefined ? "" : String(n));
  return {
    source: s ? "segment" : null,
    segId: s?.id || "",
    dayFrom: str(s?.from),
    dayTo: str(s?.to),
    staff: s?.staff || "",
    filters: !!s && (s.from !== undefined || s.to !== undefined || !!s.staff),
    recipients: "",
    listKind: "",
    listDays: "30",
    tpl: "",
    lang: "ru",
    // в шаблонах Winchester {{1}} — имя (ТЗ §4.4); нет переменных — строку убирают
    params: ["{имя}"],
    text: "",
    img: "",
    fallback: "",
    cap: "",
    from: HOURS_DEFAULT.main.from,
    to: HOURS_DEFAULT.main.to,
    name: "",
    nameTouched: false,
    consent: false,
  };
}

/** Есть ли у компании база клиентов: loading — ещё не знаем; none — нет (только список); empty — настроена, но снимка ещё нет. */
export type BaseState = "loading" | "none" | "empty" | "ready";
export function baseState(crm: CrmOverview | undefined, loading: boolean): BaseState {
  if (!crm) return loading ? "loading" : "none";
  if (!crm.available) return "none";
  return crm.at ? "ready" : "empty";
}

export type Resolved = { source: Source; spec: SegmentSpec; segments: CrmSegment[] };
export function resolve(f: Form, crm: CrmOverview | undefined, base: BaseState): Resolved {
  const segments = crm?.segments || [];
  const source: Source = f.source ?? (base === "ready" ? "segment" : "list");
  // по умолчанию — «Пора на стрижку»; если в нём сейчас никого (всем уже писали), — первый сегмент, где есть люди:
  // иначе проверка сразу ответит «некому писать» (находка проверки 19.10.2026)
  const pora = segments.find((s) => s.id === "pora");
  const id = f.segId || (pora && pora.n > 0 ? "pora" : segments.find((s) => s.n > 0)?.id || pora?.id || segments[0]?.id || "");
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const spec: SegmentSpec = { id };
  if (f.filters) {
    const a = num(f.dayFrom), b = num(f.dayTo);
    if (a !== undefined) spec.from = a;
    if (b !== undefined) spec.to = b;
    if (f.staff) spec.staff = f.staff;
  }
  return { source, spec, segments };
}

const dm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
};
/** Название по умолчанию: «Пора на стрижку · 19.10» — владелец может переписать. */
export function defaultName(r: Resolved, now: number): string {
  const base = r.source === "segment" ? segmentTitle(r.spec, r.segments) : "Рассылка по списку";
  return `${base.slice(0, 50)} · ${dm(now)}`;
}
export const nameOf = (f: Form, r: Resolved, now: number) => (f.nameTouched ? f.name : defaultName(r, now));

export const cleanParams = (p: string[]) => p.map((x) => x.trim()).filter(Boolean);
/** Предел в сутки из поля: «1 000» — тоже 1000 (пробелы между разрядами — по-русски). */
export const capNum = (s: string) => Number(String(s).replace(/[\s ]/g, ""));

export function toDraft(f: Form, r: Resolved, now: number): CampaignDraft {
  const d: CampaignDraft = {
    name: nameOf(f, r, now).trim(),
    source: r.source,
    channel: "main",
    tpl: f.tpl.trim(),
    lang: f.lang,
    params: cleanParams(f.params),
    text: f.text.trim(),
    img: f.img.trim(),
    // всегда шлём, чем заменить имя: иначе предпросмотр сервера («клиент») не совпал бы с отправкой («уважаемый клиент»)
    fallback: f.fallback.trim() || DEFAULT_FALLBACK,
    cap: capNum(f.cap),
    from: f.from,
    to: f.to,
    consent: f.consent,
  };
  if (r.source === "segment") d.segment = r.spec;
  else {
    d.recipients = f.recipients;
    if (f.listKind) d.listFilter = { kind: f.listKind, days: Number(f.listDays) };
  }
  return d;
}

/** Что влияет на проверку сервера (/api/bc/check): название, предел, часы и согласие она не смотрит. */
export const checkKey = (d: CampaignDraft) => JSON.stringify({ ...d, name: "", cap: 0, from: 0, to: 0, consent: false });

const int = (s: string) => /^\d{1,6}$/.test(s.trim());

/** Ошибки шага (тексты — по-русски и коротко; сервер проверит то же и ответит своими словами). */
export function validate(step: number, f: Form, r: Resolved): Errs {
  const e: Errs = {};
  if (step === 0) {
    if (r.source === "segment") {
      if (!r.spec.id) e.segId = "Выберите, кому писать.";
      if (f.filters) {
        const bad = [f.dayFrom, f.dayTo].some((s) => s.trim() !== "" && (!int(s) || Number(s) > 400));
        if (bad) e.days = "Дни с визита — целое число от 0 до 400.";
        else if (r.spec.from !== undefined && r.spec.to !== undefined && r.spec.from > r.spec.to) e.days = "«От» должно быть не больше, чем «до».";
      }
    } else {
      if (!f.recipients.trim()) e.recipients = "Вставьте номера: по клиенту на строке.";
      if (f.listKind && (!int(f.listDays) || Number(f.listDays) < 1 || Number(f.listDays) > 365)) e.listDays = "Число дней — от 1 до 365.";
    }
  }
  if (step === 1) {
    const tpl = f.tpl.trim();
    if (!tpl) e.tpl = "Впишите название шаблона из кабинета Meta.";
    else if (!TEMPLATE_RE.test(tpl)) e.tpl = "Только строчные латинские буквы, цифры и «_» — как в кабинете Meta (например, promo_october).";
    if (!f.text.trim()) e.text = "Вставьте текст шаблона — его увидят администратор и бот.";
    else if (f.text.trim().length > 1100) e.text = "Текст длиннее 1100 знаков — сократите.";
    const p = cleanParams(f.params);
    if (p.length > 10) e.params = "Не больше 10 подстановок.";
    else if (p.some((x) => x.length > 300)) e.params = "Подстановка длиннее 300 знаков — сократите.";
    if (f.img.trim() && !IMAGE_RE.test(f.img.trim())) e.img = "Ссылка на картинку должна начинаться с https://";
    if (f.fallback.trim().length > 30) e.fallback = "Не длиннее 30 знаков.";
  }
  if (step === 2) {
    const cap = capNum(f.cap);
    if (!Number.isInteger(cap) || cap < 1 || cap > 100000) e.cap = "Целое число от 1 до 100 000.";
    if (!(f.from < f.to)) e.hours = "«С» должно быть раньше, чем «до».";
  }
  if (step === STEP_LAUNCH) {
    if (nameOf(f, r, Date.now()).trim().length < 2) e.name = "Дайте рассылке название — для себя.";
    if (!f.consent) e.consent = "Подтвердите, что это клиенты компании и они не просили им не писать.";
  }
  return e;
}

/** Сколько переменных {{1}}, {{2}}… в тексте шаблона (наибольший номер). */
export function templateVars(text: string): number {
  let max = 0;
  for (const m of text.matchAll(/\{\{\s*(\d{1,2})\s*\}\}/g)) max = Math.max(max, Number(m[1]));
  return max;
}
