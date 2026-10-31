// Демо раздела «Рассылки» (часть демо-данных, data/demo.ts): вымышленные номера, база клиентов и рассылки — без сети.
// «Демо Барбер» — как Winchester: основной номер (Meta) с базой клиентов из Altegio, номер бота (Green-API) без рассылок;
// «Демо Сервис» — без базы, рассылки с номера бота разрешены, у основного номера — сигнал Meta (видно подтверждение «Всё равно продолжить?»).
// Правила и тексты ошибок повторяют сервер (src/services/broadcast/create.js, crm/auto.js), чтобы мастер рассылки вёл себя одинаково.
// Номера клиентов базы — только маской («+7 700 *** ** 44»), как их отдаёт сервер; люди и номера придуманы.
import type {
  AutoInfo,
  AutoSettings,
  BotNumberState,
  CampaignCheck,
  CampaignDetail,
  CampaignDraft,
  CampaignRow,
  CampaignsOverview,
  CrmInfo,
  CrmOverview,
  CrmPerson,
  CrmSegment,
  MainNumberState,
  SegmentSpec,
  ServiceKindState,
  ServiceOverview,
  ServiceQueueItem,
  ServiceScenario,
  CalendarDay,
  CampaignCalendar,
  LibraryItem,
  MessageStats,
  TemplateLibrary,
  TemplatePreview,
  TemplateVar,
} from "@/model/campaigns";
import type { Campaign, Role } from "@/model/types";
import { ApiError } from "./errors";
import type { CampaignSource } from "./source";

const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;
// библиотека в демо — шесть тем как в настоящей (сервер: src/services/broadcast/library.js), без правки; данные вымышленные
const DEMO_VARS: TemplateVar[] = [
  { key: "client.first_name", label: "Имя клиента", sample: "Арман" },
  { key: "staff.name", label: "Мастер", sample: "Айдос" },
  { key: "service.name", label: "Услуга", sample: "мужская стрижка" },
  { key: "visit.days_since", label: "Дней после визита", sample: "28" },
  { key: "booking.url", label: "Ссылка на запись", sample: "winchester.kz" },
];
const DEMO_CATS = [
  { id: "invite", label: "Приглашения" },
  { id: "lapsed", label: "Давно не были" },
  { id: "slots", label: "Свободное время" },
  { id: "regular", label: "Постоянные клиенты" },
  { id: "services", label: "Услуги" },
  { id: "occasions", label: "Поводы" },
  { id: "personal", label: "Персональные" },
];
const STOP = "Если такие сообщения больше не нужны, напишите «стоп».";
const STOP_KK = "Мұндай хабарламалар қажет болмаса, «стоп» деп жазыңыз.";
const DEMO_LIBRARY: LibraryItem[] = [
  { id: "M01", title: "Пора обновить стрижку", cat: "invite", who: "Были 3–5 недель назад", goal: "напомнить о стрижке", seg: "pora", needs: [], check: "Ссылка на запись работает", approved: true, status: "approved", v: 2, kkChecked: false,
    ru: `Здравствуйте, {{client.first_name}}! Если планировали обновить стрижку, удобное время можно выбрать на {{booking.url}}. ${STOP}`,
    kk: `Сәлеметсіз бе, {{client.first_name}}! Шашты жаңартуды жоспарласаңыз, ыңғайлы уақытты {{booking.url}} сайтынан таңдай аласыз. ${STOP_KK}` },
  { id: "M02", title: "Давно не были", cat: "lapsed", who: "Были 30–45 дней назад", goal: "мягко пригласить вернуться", seg: "davno", needs: [], check: "Клиент не записан на ближайшие дни", approved: false, status: "review", v: 1, kkChecked: false,
    ru: `{{client.first_name}}, добрый день! Давно не виделись. Если захотите заглянуть на стрижку, будем рады. Запись: {{booking.url}}. ${STOP}`,
    kk: `{{client.first_name}}, қайырлы күн! Көптен бері көрмедік. Шаш алдырғыңыз келсе, қуанамыз. Жазылу: {{booking.url}}. ${STOP_KK}` },
  { id: "M05", title: "Постоянному клиенту", cat: "regular", who: "Были 3 раза и больше", goal: "поблагодарить", seg: "regular", needs: [], check: "Текст без обещаний скидок", approved: false, status: "review", v: 1, kkChecked: false,
    ru: `Здравствуйте, {{client.first_name}}! Спасибо, что выбираете наш барбершоп. Когда понадобится стрижка, записаться можно здесь: {{booking.url}}. ${STOP}`,
    kk: `Сәлеметсіз бе, {{client.first_name}}! Біздің барбершопты таңдағаныңызға рақмет. Шаш алдыру керек болса, осы жерден жазылыңыз: {{booking.url}}. ${STOP_KK}` },
  { id: "M08", title: "Свободное время сегодня", cat: "slots", who: "Кто был у этого мастера", goal: "предложить окно", seg: "all", needs: ["staff.name", "slot"], check: "Время у мастера действительно свободно прямо перед отправкой", approved: false, status: "facts", v: 1, kkChecked: false,
    ru: `Здравствуйте! Сегодня у {{staff.name}} освободилось время в [время]. Хотите записаться? ${STOP}`,
    kk: `Сәлеметсіз бе! Бүгін {{staff.name}} шеберде [уақыт] бос. Жазыласыз ба? ${STOP_KK}` },
  { id: "M12", title: "Стрижка и борода", cat: "services", who: "Все, кому можно писать", goal: "рассказать об услуге", seg: "all", needs: [], check: "Услуга есть в прайсе", approved: false, status: "review", v: 1, kkChecked: false,
    ru: `Здравствуйте! У нас можно записаться на стрижку и оформление бороды за один визит. Удобное время: {{booking.url}}. ${STOP}`,
    kk: `Сәлеметсіз бе! Бізде шаш алу мен сақалды бір келгенде жасатуға болады. Ыңғайлы уақыт: {{booking.url}}. ${STOP_KK}` },
  { id: "M24", title: "Акция", cat: "occasions", who: "Все, кому можно писать", goal: "сообщить об утверждённой акции", seg: "all", needs: ["promo"], check: "Условия, срок и цена утверждены владельцем", approved: false, status: "facts", v: 1, kkChecked: false,
    ru: `Здравствуйте! До [дата] действует [условия акции]. Записаться: {{booking.url}}. ${STOP}`,
    kk: `Сәлеметсіз бе! [күн] дейін [акция шарттары]. Жазылу: {{booking.url}}. ${STOP_KK}` },
];
const fillDemo = (t: string, name: string) =>
  t
    .replace(/\{\{client\.first_name\}\},?\s*/g, name ? `${name}, ` : "")
    .replace(/Здравствуйте, (\S+), !/, "Здравствуйте, $1!")
    .replace(/\{\{staff\.name\}\}/g, "Айдоса")
    .replace(/\{\{booking\.url\}\}/g, "winchester.kz")
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/, !/g, "!")
    .replace(/^(\p{L})/u, (m) => m.toUpperCase());
const wait = (ms = 260) => new Promise((r) => setTimeout(r, ms + Math.random() * 160));
const STOP_LINE = "Чтобы не получать сообщения, ответьте СТОП";
const NO_GA = "Рассылки с номера бота (Green-API) у этой компании выключены: номер только отвечает клиентам. Рассылки — с официального номера шаблонами Meta.";
const GA_HOOK_WARN = "Номер не настроен до конца: ответы клиентов не приходят в пульт, и тем, кто ответит «стоп», рассылка будет приходить дальше.";
const NO_BASE_AUTO = "У этой компании нет базы клиентов из Altegio — автосценарий недоступен.";

type Person = CrmPerson & { why: "" | "stop" | "fut" | "recent" | "marketed" };
type Camp = CampaignDetail & { runFrom?: number; posFrom?: number };
type Ws = {
  main: Omit<MainNumberState, "used24h" | "hold">;
  bot: BotNumberState | null;
  hold: string[];
  optouts: number;
  base: Person[] | null;
  baseAt: number;
  crmWhy: string;
  camps: Camp[];
  auto: AutoSettings;
};

// ---------- вымышленная база клиентов ----------
function rnd(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}
const NAMES = ["Арман", "Данияр", "Ерлан", "Тимур", "Нурлан", "Самат", "Асхат", "Бекзат", "Дастан", "Ильяс", "Канат", "Мади", "Олжас", "Руслан", "Санжар", "Азамат", "Алихан", "Жандос", "Марат", "Ринат", ""];
const MASTERS = ["Арман", "Данияр", "Ерлан"];
const SERVICES = ["Мужская стрижка", "Стрижка и борода", "Оформление бороды", "Детская стрижка"];
const dayIso = (t: number) => new Date(t + 5 * HOUR).toISOString().slice(0, 10); // день по Астане

function makeBase(now: number): Person[] {
  const r = rnd(7);
  const people: Person[] = [];
  for (let i = 0; i < 72; i++) {
    // первые — были недавно (меньше 14 дней); каждый девятый — ровно 28 дней назад: автосценарию «Пора на стрижку» есть кому писать сегодня
    const d = i < 4 ? 5 + i * 2 : i % 9 === 4 ? 28 : 15 + Math.floor(r() * 76);
    const v = 1 + Math.floor(r() * r() * 6);
    const why: Person["why"] = i < 4 ? "recent" : i % 19 === 3 ? "stop" : i % 13 === 5 ? "fut" : i % 17 === 8 ? "marketed" : "";
    people.push({
      name: NAMES[Math.floor(r() * NAMES.length)],
      phone: `+7 700 *** ** ${String(10 + i).padStart(2, "0")}`,
      last: dayIso(now - d * DAY),
      d,
      v,
      staff: MASTERS[Math.floor(r() * MASTERS.length)],
      svc: SERVICES[Math.floor(r() * SERVICES.length)],
      why,
    });
  }
  return people;
}

const SEGS: { id: string; label: string; rule: string; test: (p: Person) => boolean }[] = [
  { id: "pora", label: "Пора на стрижку", rule: "последний визит 21–35 дней назад", test: (p) => p.d >= 21 && p.d <= 35 },
  { id: "davno", label: "Давно не были", rule: "36–60 дней", test: (p) => p.d >= 36 && p.d <= 60 },
  { id: "uhodyat", label: "Уходят", rule: "61–90 дней", test: (p) => p.d >= 61 && p.d <= 90 },
  { id: "novye", label: "Новые", rule: "1 визит за 90 дней", test: (p) => p.v === 1 },
  { id: "postoyannye", label: "Постоянные", rule: "3 и больше визитов за 90 дней", test: (p) => p.v >= 3 },
];
function segTest(id: string): ((p: Person) => boolean) | null {
  if (id === "all") return () => true;
  if (id.startsWith("staff:")) return (p) => p.staff === id.slice(6);
  return SEGS.find((s) => s.id === id)?.test || null;
}
function segLabel(s: SegmentSpec): string {
  const base = s.id === "all" ? "Вся база" : s.id.startsWith("staff:") ? `Мастер: ${s.id.slice(6)}` : SEGS.find((x) => x.id === s.id)?.label || s.id;
  const days = s.from !== undefined || s.to !== undefined ? `${s.from ?? 0}–${s.to ?? 400} дн. с визита` : "";
  return [base, days, s.staff ? `мастер ${s.staff}` : ""].filter(Boolean).join(" · ");
}
function pick(base: Person[], s: SegmentSpec): Person[] | null {
  const t = segTest(s.id);
  if (!t) return null;
  return base
    .filter((p) => !p.why && t(p) && (s.from === undefined || p.d >= s.from) && (s.to === undefined || p.d <= s.to) && (!s.staff || p.staff === s.staff))
    .sort((a, b) => a.d - b.d || b.v - a.v || a.phone.localeCompare(b.phone));
}

// ---------- компании ----------
const AUTO_DEF: AutoSettings = { on: false, days: 28, tpl: "", lang: "ru", cap: 20, from: 11, to: 20, text: "" };
function camp(now: number, c: Partial<Camp> & Pick<Camp, "id" | "name" | "status" | "total">): Camp {
  return { channel: "main", pos: c.total, sent: 0, failed: 0, skipped: 0, excluded: 0, createdAt: now, source: "list", cap: 240, from: 11, to: 20, text: "", fallback: "уважаемый клиент", fails: [], stalled: false, ...c };
}
function build(now: number): Record<string, Ws> {
  const barber: Ws = {
    main: { ready: true, why: "", phone: "+7 700 000 12 34", name: "Демо Барбер", quality: "green", limit: 1000, failedToday: null },
    bot: { ready: true, state: "authorized", phone: "+7 700 000 56 78", hook: true, why: "", warn: "", used24h: 0, cap: { def: 50, max: 300 }, hold: "", noBroadcast: NO_GA },
    hold: [],
    optouts: 3,
    base: makeBase(now),
    baseAt: now - 7 * HOUR,
    crmWhy: "",
    auto: { ...AUTO_DEF },
    camps: [
      camp(now, { id: "d4", name: "Подарочные сертификаты к Новому году", status: "ready", total: 18, pos: 0, createdAt: now - 2 * HOUR, source: "crm", segment: "Постоянные", segmentId: "postoyannye", by: "owner", template: "sertifikat_ny", lang: "ru", params: ["{имя}"], text: "{{1}}, подарочный сертификат — лучший подарок к Новому году. Ответьте «да» — расскажем подробнее. Чтобы не получать сообщения, ответьте СТОП" }),
      camp(now, { id: "d3", name: "Скидка 20% в будни до 14:00", status: "paused", total: 120, pos: 64, sent: 61, failed: 2, skipped: 1, createdAt: now - 1 * DAY, by: "owner", template: "skidka_budni", lang: "ru", params: ["{имя}"], text: "{{1}}, в будни до 14:00 — скидка 20% на стрижку. Чтобы не получать сообщения, ответьте СТОП", note: "Остановлена вручную.", startedAt: now - 1 * DAY + HOUR, lastSentAt: now - 1 * DAY + 3 * HOUR, fails: [{ code: 131026, n: 2, hint: "номер не в WhatsApp или не принимает сообщения" }] }),
      camp(now, { id: "d2", name: "Пора на стрижку", status: "done", total: 42, sent: 39, failed: 1, excluded: 2, createdAt: now - 6 * DAY, source: "crm", segment: "Пора на стрижку", segmentId: "pora", by: "staff", template: "pora_na_strizhku", lang: "ru", params: ["{имя}"], text: "{{1}}, прошло около месяца с вашей стрижки — запишем вас? Чтобы не получать сообщения, ответьте СТОП", startedAt: now - 6 * DAY + 10 * MIN, doneAt: now - 6 * DAY + 50 * MIN, fails: [{ code: 131026, n: 1, hint: "номер не в WhatsApp или не принимает сообщения" }] }),
      camp(now, { id: "d1", name: "Новый мастер в команде", status: "done", total: 340, sent: 331, failed: 6, skipped: 3, createdAt: now - 16 * DAY, by: "owner", template: "new_master", lang: "ru", params: ["{имя}"], text: "{{1}}, в нашей команде новый мастер — Данияр. Первая стрижка у него со скидкой 15%. Чтобы не получать сообщения, ответьте СТОП", doneAt: now - 15 * DAY, fails: [{ code: 131026, n: 6, hint: "номер не в WhatsApp или не принимает сообщения" }] }),
    ],
  };
  const service: Ws = {
    main: { ready: true, why: "", phone: "+7 700 000 20 20", name: "Демо Сервис", quality: "yellow", limit: 250, failedToday: { n: 2, codes: [{ code: 131049, n: 2, hint: "Meta не доставила маркетинговое сообщение: этому человеку уже много писали компании — попробуйте позже" }] } },
    bot: { ready: true, state: "authorized", phone: "+7 700 000 21 21", hook: true, why: "", warn: "", used24h: 12, cap: { def: 50, max: 300 }, hold: "", noBroadcast: "" },
    hold: ["Meta приостановила шаблон promo_autumn: клиенты жаловались на сообщения"],
    optouts: 1,
    base: null,
    baseAt: 0,
    crmWhy: "Altegio не подключён — базы клиентов у этой компании нет. Рассылка — по списку.",
    auto: { ...AUTO_DEF },
    camps: [
      camp(now, { id: "s2", name: "Осенняя акция: замена стекла", status: "paused", total: 200, pos: 80, sent: 78, failed: 2, createdAt: now - 2 * DAY, by: "owner", template: "promo_autumn", lang: "ru", params: ["{имя}"], text: "{{1}}, замена защитного стекла — 3 000 ₸ до конца месяца. Чтобы не получать сообщения, ответьте СТОП", note: "Сигнал от Meta: Meta приостановила шаблон promo_autumn: клиенты жаловались на сообщения. Рассылка остановлена, чтобы не навредить номеру.", startedAt: now - 2 * DAY + HOUR }),
      camp(now, { id: "s1", name: "Защитные стёкла −20%", status: "done", channel: "bot", total: 45, sent: 44, failed: 1, cap: 50, createdAt: now - 9 * DAY, by: "owner", text: "{имя}, на этой неделе защитные стёкла со скидкой 20%. ⏎ Чтобы не получать сообщения, ответьте СТОП", message: "{имя}, на этой неделе защитные стёкла со скидкой 20%.\n\n" + STOP_LINE, fails: [{ code: "ga:466", n: 1, hint: "Green-API: исчерпан лимит сообщений тарифа" }] }),
    ],
  };
  const empty: Ws = {
    main: { ready: false, why: "WhatsApp этой компании не подключён — рассылки появятся после подключения номера.", quality: "unknown", limit: 0, failedToday: null },
    bot: null,
    hold: [],
    optouts: 0,
    base: null,
    baseAt: 0,
    crmWhy: "Altegio не подключён — базы клиентов у этой компании нет.",
    auto: { ...AUTO_DEF },
    camps: [],
  };
  return { demo: barber, "demo-service": service, "demo-empty": empty };
}

// ---------- ход отправки: «идёт» — по сообщению в 1,5 с (номер бота — в 4 с), чтобы в демо было видно движение ----------
const countUpTo = (pos: number, every: number, at: number) => (pos > at ? Math.floor((pos - 1 - at) / every) + 1 : 0);
function advance(c: Camp, now: number) {
  if (c.status !== "running" || c.runFrom === undefined || c.posFrom === undefined) return;
  const step = c.channel === "bot" ? 4000 : 1500;
  c.pos = Math.min(c.total, c.posFrom + Math.floor((now - c.runFrom) / step));
  c.excluded = c.source === "crm" ? countUpTo(c.pos, 17, 5) : 0;
  c.failed = countUpTo(c.pos, 23, 7);
  c.sent = Math.max(0, c.pos - c.excluded - c.failed - c.skipped);
  c.fails = c.failed ? [{ code: c.channel === "bot" ? "ga:400" : 131026, n: c.failed, hint: "номер не в WhatsApp или не принимает сообщения" }] : [];
  if (c.pos > (c.posFrom || 0)) c.lastSentAt = c.runFrom + (c.pos - (c.posFrom || 0)) * step;
  if (c.pos >= c.total) {
    c.status = "done";
    c.doneAt = now;
    delete c.runFrom;
    delete c.posFrom;
  }
}
const pub = (c: Camp): CampaignDetail => {
  const { runFrom: _r, posFrom: _p, ...d } = c;
  return structuredClone(d);
};
const rowOf = (c: Camp): CampaignRow => {
  const { id, name, status, channel, total, pos, sent, failed, skipped, excluded, createdAt, source, segment, by, template } = c;
  return { id, name, status, channel, total, pos, sent, failed, skipped, excluded, createdAt, source, ...(segment ? { segment } : {}), ...(by ? { by } : {}), ...(template ? { template } : {}) };
};

// ---------- проверка черновика — те же правила и тексты, что у сервера ----------
const TPL_RE = /^[a-z0-9_]{1,512}$/, LANG_RE = /^[a-z]{2,3}(_[A-Z]{2})?$/, IMG_RE = /^https:\/\/[^\s"'<>]{4,500}$/;
const withName = (t: string, name: string) => t.replace(/\{\s*(имя|name)\s*\}/gi, name);
function gaMsg(text: string) {
  const t = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return !t ? "" : /стоп|stop/i.test(t) ? t : `${t}\n\n${STOP_LINE}`;
}
function fields(d: CampaignDraft) {
  const errors: string[] = [], img = (d.img || "").trim();
  if (img && !IMG_RE.test(img)) errors.push("картинка — ссылка, которая начинается с https://");
  if (d.channel === "bot") {
    if (!gaMsg(d.text || "")) errors.push("напишите текст сообщения");
    return errors;
  }
  if (!TPL_RE.test((d.tpl || "").trim())) errors.push("название шаблона — как в кабинете Meta: строчные латинские буквы, цифры и «_» (например, promo_october)");
  if (!LANG_RE.test((d.lang || "ru").trim())) errors.push("язык шаблона — код из кабинета Meta: ru, kk, en или en_US");
  return errors;
}
type Rec = { phone: string; name: string };
function parseList(text: string) {
  const seen = new Set<string>(), list: Rec[] = [], bad: string[] = [];
  let dup = 0, badN = 0;
  for (const line of (text || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const digits = (line.match(/\+?[\d\s()-]{10,}/)?.[0] || "").replace(/\D/g, "");
    const p = digits.length === 11 && /^[78]/.test(digits) ? "7" + digits.slice(1) : digits.length === 10 && digits[0] === "7" ? "7" + digits : "";
    if (!p) {
      badN++;
      if (bad.length < 8) bad.push(line.trim().slice(0, 50));
      continue;
    }
    if (seen.has(p)) {
      dup++;
      continue;
    }
    seen.add(p);
    const name = (line.replace(/\+?[\d\s()-]{10,}/, " ").match(/[А-ЯЁA-Z][а-яёa-z]+/) || [""])[0];
    list.push({ phone: p, name });
  }
  return { list, bad, badN, dup };
}

// ---------- сервисные сообщения: вымышленные записи через бота, времена — по правилам бота (src/services/reminders/plan.js) ----------
const ASTANA = 5 * HOUR; // UTC+5
/** Время по Астане: day — дней от сегодняшнего, hm — «ЧЧ:ММ». */
function astanaAt(now: number, day: number, hm: string): number {
  const d = new Date(now + ASTANA), [h, m] = hm.split(":").map(Number);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + day, h, m) - ASTANA;
}
const SERVICE_LABEL: Partial<Record<ServiceKindState["kind"], string>> = {
  d1: "Накануне в 18:00 — напоминание о записи",
  h2: "За 2 часа — напоминание о записи",
  rv: "Через 3 часа после визита — просьба оставить отзыв",
};
/** Каталог сервисных сценариев — как у сервера (src/services/reminders/templates.js), коротко; тексты — на вымышленной записи. */
const DEMO_CATALOG: ServiceScenario[] = (
  [
    ["S01", "Новая запись — подтверждение", "auto", "s01", "Здравствуйте, Арман! Вы записаны в «Демо Барбер» на завтра в 15:00 — Мужская стрижка · Мастер. Если нужно перенести или отменить — напишите сюда."],
    ["S02", "Запись с сайта без WhatsApp", "auto", "", ""],
    ["S03", "Напоминание накануне", "auto", "d1", "Напоминаем: завтра в 15:00 вас ждут в «Демо Барбер» — Мужская стрижка · Мастер. Если планы изменились, напишите сюда."],
    ["S04", "Напоминание за 2 часа", "auto", "h2", "Ждём вас сегодня в 15:00 в «Демо Барбер» (Мужская стрижка · Мастер). Если опаздываете или не сможете прийти — напишите сюда."],
    ["S05", "«Напомните моё время»", "reply", "", "Вы записаны на завтра в 15:00 — Мужская стрижка · Мастер."],
    ["S06", "Перенос подтверждён", "auto", "s06", "Ваша запись в «Демо Барбер» перенесена: завтра в 15:00 — Мужская стрижка · Мастер. Если что-то не так — напишите сюда."],
    ["S07", "Отмена по просьбе клиента", "reply", "", "Вашу запись отменили. Если захотите записаться снова — напишите."],
    ["S08", "Мастер не выйдет", "off", "", ""],
    ["S09", "Клиент опаздывает", "task", "", "Спасибо, что предупредили! Передали мастеру."],
    ["S10", "Клиент подтвердил, что придёт", "reply", "", "Отлично, ждём вас!"],
    ["S11", "Клиент не пришёл", "task", "", ""],
    ["S12", "Просьба об отзыве", "auto", "rv", "Спасибо, что были у нас в «Демо Барбер»! Будем благодарны за отзыв: https://2gis.kz/…\nЕсли что-то не понравилось — напишите сюда, передадим администратору."],
    ["S13", "Благодарность после визита", "off", "", ""],
    ["S14", "Записали двух человек", "auto", "", ""],
    ["S15", "Перенос в последний час", "task", "", ""],
    ["S16", "Ошибка или конфликт в Altegio", "task", "", ""],
    ["S17", "Изменились часы работы", "off", "", ""],
    ["S18", "Сообщение не ушло", "task", "", ""],
  ] as const
).map(([id, title, mode, kind, ru]) => ({ id, title, trigger: "", mode, channel: "", note: "", v: 1, kind, approved: kind === "d1" || kind === "h2" || kind === "rv", approvedAt: 0, vars: [], preview: { ru, kk: "" } }));
/** Очередь «Демо Барбера»: четыре записи через бота — накануне в 18:00, за 2 часа, отзыв через 3 часа (вечером — утром в 11:00). */
function barberQueue(now: number): ServiceQueueItem[] {
  // после 14:00 по Астане записи — с завтрашнего дня, чтобы вся очередь была впереди
  const b = new Date(now + ASTANA).getUTCHours() < 14 ? 0 : 1;
  const books: { name: string; phone: string; channel: "main" | "bot"; day: number; time: string; eve: boolean }[] = [
    { name: "Тимур", phone: "+7 700 *** ** 18", channel: "bot", day: b, time: "16:00", eve: false }, // записался сегодня утром — без «накануне»
    { name: "Арман", phone: "+7 700 *** ** 41", channel: "bot", day: b + 1, time: "12:00", eve: true },
    { name: "", phone: "+7 700 *** ** 07", channel: "bot", day: b + 1, time: "16:30", eve: true },
    { name: "Данияр", phone: "+7 700 *** ** 63", channel: "main", day: b + 2, time: "11:00", eve: true }, // писал на основной номер — оттуда и напоминание
  ];
  const out: ServiceQueueItem[] = [];
  for (const x of books) {
    const t = astanaAt(now, x.day, x.time), base = { phone: x.phone, name: x.name, channel: x.channel, date: dayIso(t), time: x.time };
    if (x.eve) out.push({ ...base, kind: "d1", at: astanaAt(now, x.day - 1, "18:00") });
    out.push({ ...base, kind: "h2", at: t - 2 * HOUR });
    const rv = t + 3 * HOUR, rh = new Date(rv + ASTANA).getUTCHours();
    out.push({ ...base, kind: "rv", at: rh >= 21 || rh < 10 ? astanaAt(now, x.day + (rh >= 21 ? 1 : 0), "11:00") : rv });
  }
  return out.filter((x) => x.at > now).sort((a, z) => a.at - z.at);
}
function demoService(ws: string, now: number): Omit<ServiceOverview, "owner"> {
  const kinds = (on: Partial<Record<ServiceKindState["kind"], boolean>>, link = ""): ServiceKindState[] =>
    (["d1", "h2", "rv"] as const).map((k) => ({ kind: k, label: SERVICE_LABEL[k] || "", on: !!on[k], ...(k === "rv" && link ? { link } : {}) }));
  if (ws === "demo") {
    const queue = barberQueue(now);
    return { kinds: kinds({ d1: true, h2: true, rv: true }, "https://2gis.kz/astana/firm/70000000000000001/tab/reviews"), queue, total: queue.length, sent3d: 6, botOff: false, altegio: true, catalog: DEMO_CATALOG };
  }
  // «Демо Сервис» и новая компания — без записи через Altegio: напоминаний и отзывов бот не шлёт (как сервер: только по своим записям в Altegio)
  return { kinds: kinds({ d1: false, h2: false, rv: false }), queue: [], total: 0, sent3d: 0, botOff: false, altegio: false };
}

export function createDemoCampaigns(role: () => Role): { api: CampaignSource; rows(ws: string, channelId: (ch: "main" | "bot") => string | undefined): Campaign[] } {
  const all = build(Date.now());
  const find = (ws: string) => {
    const w = all[ws];
    if (!w) throw new ApiError("Нет доступа к этому клиенту.", 403);
    return w;
  };
  const owner = () => role() === "owner";
  const ownerOnly = (text: string) => {
    if (!owner()) throw new ApiError(text, 403);
  };
  const camp1 = (w: Ws, id: string) => {
    const c = w.camps.find((x) => x.id === id);
    if (!c) throw new ApiError("Рассылка не найдена.", 404);
    advance(c, Date.now());
    return c;
  };
  const used = (w: Ws, ch: "main" | "bot") => w.camps.filter((c) => c.channel === ch && (c.lastSentAt || c.createdAt) > Date.now() - DAY).reduce((a, c) => a + c.sent, 0);

  function recipients(w: Ws, d: CampaignDraft): { list: Rec[]; masked: boolean; dup: number; bad: string[]; badN: number; errors: string[]; segment?: CampaignCheck["segment"] } {
    const none = { list: [], masked: true, dup: 0, bad: [], badN: 0 };
    if (d.source === "segment") {
      const s = d.segment || { id: "" };
      const errors = d.channel === "bot" ? ["рассылка по базе клиентов Altegio — только шаблоном Meta с основного номера: массовые сообщения с обычного WhatsApp (Green-API) — главная причина блокировок"] : [];
      if (errors.length) return { ...none, errors };
      if (!w.base || !w.baseAt) return { ...none, errors: ["базы клиентов из Altegio ещё нет — обновите базу в разделе сегментов"] };
      const people = pick(w.base, s);
      if (!people) return { ...none, errors: ["сегмент базы клиентов не найден — выберите его заново"] };
      const label = segLabel(s);
      return {
        ...none,
        list: people.map((p) => ({ phone: p.phone, name: p.name })),
        errors: people.length ? [] : [`в сегменте «${label}» сейчас некому писать: остальные просили не писать, уже записаны, были меньше 14 дней назад или им уже писали за 14 дней`],
        segment: { id: s.id, label, at: w.baseAt, total: people.length },
      };
    }
    const r = parseList(d.recipients || "");
    return { ...r, masked: false, errors: [] };
  }

  async function check(ws: string, d: CampaignDraft): Promise<CampaignCheck & { rec: Rec[] }> {
    const w = find(ws), rc = recipients(w, d), errors = fields(d).concat(rc.errors);
    const fb = (d.fallback || "").trim() || "уважаемый клиент";
    const first = rc.list.find((x) => x.name)?.name || "";
    const preview = d.channel === "bot" ? (gaMsg(d.text || "") ? [withName(gaMsg(d.text || ""), first || fb)] : []) : (d.params || []).filter(Boolean).map((p) => withName(p, first || fb));
    return {
      ok: rc.list.length > 0 && !errors.length,
      valid: rc.list.length,
      named: rc.list.filter((x) => x.name).length,
      dup: rc.dup,
      bad: rc.bad,
      badN: rc.badN,
      cut: 0,
      stopped: rc.masked ? 0 : rc.list.filter((x) => x.phone === "77000000105").length,
      ...(rc.segment ? { segment: rc.segment } : {}),
      sample: rc.list.slice(0, 5).map((x) => (rc.masked ? x.phone : "+" + x.phone) + " — " + (x.name || "без имени")),
      errors,
      preview,
      rec: rc.list,
    };
  }

  const api: CampaignSource = {
    async campaignsOverview(ws): Promise<CampaignsOverview> {
      await wait(600);
      const w = find(ws), now = Date.now();
      w.camps.forEach((c) => advance(c, now));
      const bot = w.bot ? { ...w.bot, used24h: w.bot.used24h + used(w, "bot") } : null;
      return {
        workspace: { id: ws, name: ws === "demo" ? "Демо Барбер" : ws === "demo-service" ? "Демо Сервис" : "Новая компания" },
        owner: owner(),
        main: { ...w.main, used24h: used(w, "main"), hold: [...w.hold] },
        bot,
        optouts: w.optouts,
        campaigns: [...w.camps].sort((a, b) => b.createdAt - a.createdAt).map(rowOf),
        now,
      };
    },
    async campaign(ws, id) {
      await wait(150);
      return pub(camp1(find(ws), id));
    },
    async campaignBad(ws, id) {
      await wait(250);
      const c = camp1(find(ws), id);
      const lines = Array.from({ length: Math.min(c.failed, 300) }, (_, i) => `+7 700 *** ** ${String(60 + i).slice(-2)} — номер не в WhatsApp или не принимает сообщения`);
      return { campaign: pub(c), lines };
    },
    async checkCampaign(ws, d) {
      await wait(450);
      const { rec: _rec, ...r } = await check(ws, d);
      return r;
    },
    async createCampaign(ws, d) {
      await wait(500);
      const w = find(ws), r = await check(ws, d), errors = [...r.errors];
      const name = (d.name || "").trim().slice(0, 60), cap = Math.round(+d.cap || 0), from = Math.round(+d.from), to = Math.round(+d.to), bot = d.channel === "bot";
      if (name.length < 2) errors.push("дайте рассылке название — для себя");
      if (d.source === "list" && !r.valid) errors.push("в списке нет ни одного номера");
      if (bot && !(cap >= 1 && cap <= 300)) errors.push("предел на 24 часа через Green-API — от 1 до 300: обычный WhatsApp блокируют за массовые рассылки");
      else if (!(cap >= 1 && cap <= 100000)) errors.push("предел на 24 часа — число от 1 до 100 000");
      if (!(from >= 0 && to <= 24 && to > from)) errors.push("часы отправки: «с» должно быть раньше, чем «до»");
      else if (from < 8 || to > 22) errors.push("часы отправки — не раньше 8:00 и не позже 22:00: ночные сообщения вызывают жалобы, а жалобы блокируют номер");
      if (!bot && !(d.text || "").trim()) errors.push("вставьте текст шаблона — его увидит администратор, а бот поймёт, на что отвечает клиент");
      if (d.consent !== true) errors.push("подтвердите, что эти люди — клиенты компании и не просили им не писать");
      if (errors.length) throw new ApiError(errors.join("; "), 400, false, { errors });
      const now = Date.now();
      const c: Camp = camp(now, {
        id: now.toString(36),
        name,
        status: "ready",
        channel: bot ? "bot" : "main",
        total: r.valid,
        pos: 0,
        cap,
        from,
        to,
        by: owner() ? "owner" : "staff",
        fallback: (d.fallback || "").trim() || "уважаемый клиент",
        text: bot ? gaMsg(d.text).replace(/\s*\n\s*/g, " ⏎ ") : (d.text || "").trim(),
        ...(bot ? { message: gaMsg(d.text) } : { template: (d.tpl || "").trim(), lang: (d.lang || "ru").trim(), params: (d.params || []).filter(Boolean) }),
        ...(d.img ? { image: d.img.trim() } : {}),
        ...(r.segment ? { source: "crm" as const, segment: r.segment.label, segmentId: r.segment.id, crmAt: r.segment.at } : {}),
      });
      w.camps.unshift(c);
      return { campaign: pub(c), dup: r.dup, bad: r.badN, cut: 0 };
    },
    async campaignAct(ws, id, act, force) {
      await wait(350);
      const w = find(ws), c = camp1(w, id), now = Date.now();
      if (act === "start") {
        if (c.channel === "main" && !w.main.ready) throw new ApiError(w.main.why, 409);
        if (c.channel === "bot") {
          if (!w.bot) throw new ApiError("Green-API у этого клиента не подключён.", 409);
          if (w.bot.noBroadcast) throw new ApiError(w.bot.noBroadcast, 409);
          if (!w.bot.hook) throw new ApiError(GA_HOOK_WARN, 409);
        }
        if (c.status !== "ready" && c.status !== "paused") throw new ApiError("Эту рассылку уже нельзя запустить.", 409);
        const hold = c.channel === "main" ? w.hold[0] : w.bot?.hold;
        if (hold && !force) return { kind: "confirm", question: `Сигнал от ${c.channel === "bot" ? "Green-API" : "Meta"}: ${hold}. Продолжать отправку опасно для номера. Всё равно продолжить?` };
        if (hold) {
          if (c.channel === "main") w.hold = [];
          else if (w.bot) w.bot.hold = "";
        }
        Object.assign(c, { status: "running", startedAt: now, runFrom: now, posFrom: c.pos });
        delete c.note;
      } else if (act === "pause") {
        if (c.status === "running") Object.assign(c, { status: "paused", note: "Остановлена вручную." });
      } else if (act === "stop") {
        if (c.status !== "done") c.status = "stopped";
        delete c.note;
      } else if (act === "delete") {
        if (c.status === "running") throw new ApiError("Сначала остановите рассылку.", 409);
        w.camps = w.camps.filter((x) => x.id !== id);
        return { kind: "deleted" };
      } else throw new ApiError("Неизвестное действие.", 400);
      if (c.status !== "running") {
        delete c.runFrom;
        delete c.posFrom;
      }
      return { kind: "done", campaign: pub(c) };
    },
    async campaignTick(ws, id) {
      await wait(400);
      const c = camp1(find(ws), id);
      if (c.status === "running" && c.runFrom !== undefined) {
        c.runFrom -= 20 * (c.channel === "bot" ? 4000 : 1500); // «порция вручную» — как будто прошла минута
        advance(c, Date.now());
      }
      return { campaign: pub(c), state: c.status === "running" ? "running" : c.status };
    },
    async testSend(ws, d, to) {
      await wait(500);
      const w = find(ws), errors = fields(d);
      if (errors.length) throw new ApiError(errors.join("; "), 400);
      const digits = to.replace(/\D/g, ""), phone = digits.length === 11 && /^[78]7/.test(digits) ? "+7" + digits.slice(1) : digits.length === 10 && digits[0] === "7" ? "+7" + digits : "";
      if (!phone) throw new ApiError("Укажите свой номер полностью, например +7 701 123 45 67.", 400);
      if (d.channel === "bot" && w.bot?.noBroadcast) throw new ApiError(w.bot.noBroadcast, 409);
      if (d.channel === "main" && !w.main.ready) throw new ApiError(w.main.why, 409);
      return `Демо: на ${phone} ничего не отправлено. В рабочем пульте ${d.channel === "bot" ? "сообщение придёт с номера бота" : "шаблон придёт с основного номера"} — проверьте WhatsApp.`;
    },
    async crmSegments(ws): Promise<CrmOverview> {
      await wait(450);
      const w = find(ws), base = w.base && w.baseAt ? w.base : [];
      const ok = base.filter((p) => !p.why);
      const cnt = (k: Person["why"]) => base.filter((p) => p.why === k).length;
      const segments: CrmSegment[] = [
        ...SEGS.map((s) => ({ id: s.id, label: s.label, rule: s.rule, n: ok.filter(s.test).length })),
        ...[...new Set(base.map((p) => p.staff))].sort().map((m) => ({ id: `staff:${m}`, label: `Мастер: ${m}`, rule: "последний визит у мастера", n: ok.filter((p) => p.staff === m).length })),
      ];
      const info: CrmInfo | null = w.baseAt ? { at: w.baseAt, from: dayIso(w.baseAt - 90 * DAY), to: dayIso(w.baseAt + 60 * DAY), records: base.length * 2 + 9, visits: base.reduce((a, p) => a + p.v, 0), clients: base.length, masked: 3, bad: 0, att: { "1": base.reduce((a, p) => a + p.v, 0), "-1": 4, "0": 2 }, cut: false } : null;
      return { owner: owner(), why: w.crmWhy, available: !w.crmWhy || !!w.baseAt, at: w.baseAt, clients: base.length, ok: ok.length, segments, excluded: { stop: cnt("stop"), noconsent: 0, fut: cnt("fut"), recent: cnt("recent"), marketed: cnt("marketed") }, info };
    },
    async crmList(ws, spec, page = 1) {
      await wait(300);
      const w = find(ws);
      if ([spec.from, spec.to].some((v) => v !== undefined && !(v >= 0 && v <= 400))) throw new ApiError("Дни с визита — число от 0 до 400.", 400);
      const people = pick(w.base && w.baseAt ? w.base : [], spec);
      if (!people) throw new ApiError("Неизвестный сегмент.", 400);
      const per = 50, pages = Math.max(1, Math.ceil(people.length / per)), p = Math.min(Math.max(1, Math.round(page)), 1000);
      return { seg: spec.id, total: people.length, page: p, pages, per, list: people.slice((p - 1) * per, p * per).map(({ why: _w, ...x }) => x) };
    },
    async crmRefresh(ws) {
      const w = find(ws);
      ownerOnly("Обновить базу может только владелец.");
      if (w.crmWhy) throw new ApiError(w.crmWhy, 409);
      await wait(2500); // настоящий сервер читает журнал Altegio до минуты
      w.baseAt = Date.now();
      const info = (await api.crmSegments(ws)).info!;
      return info;
    },
    async autoGet(ws): Promise<AutoInfo> {
      await wait(350);
      const w = find(ws), now = Date.now(), available = !!w.base;
      const total = available && w.baseAt ? pick(w.base!, { id: "all", from: w.auto.days, to: w.auto.days })!.length : 0;
      const note = w.auto.days < 14 ? "Тем, кто был меньше 14 дней назад, маркетинг не пишем — с таким числом дней автосценарию некому писать." : w.auto.days > 90 ? "В базе — визиты за 90 дней: с таким числом дней автосценарию некому писать." : "";
      return {
        owner: owner(),
        settings: { ...w.auto },
        available,
        why: !available ? NO_BASE_AUTO : w.main.ready ? "" : w.main.why,
        crm: { at: w.baseAt, fresh: !!w.baseAt && now - w.baseAt <= 36 * HOUR },
        today: { n: Math.min(total, w.auto.cap), total },
        quality: w.main.quality === "unknown" ? null : { level: w.main.quality, at: now - 2 * HOUR },
        ...(note ? { note } : {}),
      };
    },
    async autoSet(ws, patch) {
      await wait(400);
      const w = find(ws);
      ownerOnly("Настраивать автосценарий может только владелец.");
      const a: AutoSettings = { ...w.auto, ...patch, on: patch.on === undefined ? w.auto.on : patch.on === true };
      for (const k of ["days", "cap", "from", "to"] as const) a[k] = Math.round(+a[k]);
      a.tpl = String(a.tpl || "").trim();
      const errors: string[] = [];
      if (a.tpl && !TPL_RE.test(a.tpl)) errors.push("название шаблона — как в кабинете Meta: строчные латинские буквы, цифры и «_» (например, pora_na_strizhku)");
      if (a.on && !a.tpl) errors.push("чтобы включить, укажите шаблон Meta категории Marketing, который одобрила Meta");
      if (!LANG_RE.test(a.lang)) errors.push("язык шаблона — код из кабинета Meta: ru, kk, en или en_US");
      if (!(a.days >= 7 && a.days <= 120)) errors.push("дней с последнего визита — от 7 до 120");
      if (!(a.cap >= 1 && a.cap <= 100)) errors.push("сообщений в день — от 1 до 100");
      if (!(a.from >= 8 && a.to <= 22 && a.to > a.from)) errors.push("часы отправки — с 8:00 до 22:00, «с» раньше, чем «до»: ночные сообщения вызывают жалобы");
      else if (a.to <= 11) errors.push("часы отправки автосценария — «до» позже 11:00: автосценарий собирает список в 11:00");
      if (a.on && !w.base) errors.push("у этой компании нет базы клиентов из Altegio — автосценарию некому писать");
      if (errors.length) throw new ApiError(errors.join("; "), 400, false, { errors });
      w.auto = a;
      return { ...a };
    },
    async clearMetaHold(ws) {
      await wait(300);
      const w = find(ws);
      ownerOnly("Настраивать автосценарий может только владелец.");
      w.hold = [];
    },
    async serviceMessages(ws) {
      await wait(350);
      find(ws);
      return { owner: owner(), ...demoService(ws, Date.now()) };
    },
    async serviceDryRun(ws) {
      await wait(300);
      find(ws);
      ownerOnly("Проверку по журналу запускает владелец.");
      throw new ApiError("В демо журнала Altegio нет — проверка работает в настоящем пульте.", 409);
    },
    async serviceApprove(ws) {
      await wait(200);
      find(ws);
      ownerOnly("Одобрить текст может только владелец.");
      throw new ApiError("В демо тексты не одобряются — это делает владелец в настоящем пульте.", 409);
    },
    async serviceVariant(ws) {
      await wait(200);
      find(ws);
      ownerOnly("Менять тексты может только владелец.");
      throw new ApiError("В демо тексты не меняются.", 409);
    },
    async calendar(ws): Promise<CampaignCalendar> {
      await wait(300);
      const w = find(ws), base = !!(w.base && w.baseAt), t0 = Date.now();
      const days = Array.from({ length: 14 }, (_, k): CalendarDay => {
        const date = new Date(t0 + k * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10), svc = base ? [3, 5, 2, 4, 6, 1, 0][k % 7] : 0;
        const cand = base ? [4, 2, 0, 3, 5, 1, 2][k % 7] : 0, allowed = Math.max(0, cand - 1);
        return {
          date,
          service: { total: svc, kinds: svc ? { d1: Math.ceil(svc / 2), h2: Math.floor(svc / 2) } : {} },
          marketing: base ? { candidates: cand, allowed, planned: 0, excluded: cand ? ({ noconsent: cand - allowed } as Record<string, number>) : {} } : null,
        };
      });
      return { today: days[0].date, auto: base ? { on: false, days: 28, cap: 20, tpl: false } : null, baseAt: w.baseAt || 0, days };
    },
    async messageStats(ws, days): Promise<MessageStats> {
      await wait(250);
      const w = find(ws), k = days === 30 ? 4 : 1, has = !!(w.base && w.baseAt);
      const z = { sent: 0, delivered: 0, read: 0, failed: 0, replied: 0 };
      return {
        available: true,
        days,
        by: {
          service: has ? { sent: 18 * k, delivered: 17 * k, read: 12 * k, failed: 1 * k, replied: 4 * k } : z,
          review: has ? { sent: 6 * k, delivered: 6 * k, read: 4 * k, failed: 0, replied: 1 * k } : z,
          campaign: z,
          admin: { sent: 25 * k, delivered: 24 * k, read: 20 * k, failed: 0, replied: 0 },
        },
      };
    },
    async templates(ws): Promise<TemplateLibrary> {
      await wait(250);
      find(ws);
      const items = DEMO_LIBRARY.map((x) => ({ ...x }));
      return { owner: owner(), vars: DEMO_VARS, cats: DEMO_CATS, counts: { total: items.length, approved: items.filter((x) => x.approved).length, review: items.filter((x) => !x.approved).length }, items };
    },
    async templateSave(ws) {
      await wait(200);
      find(ws);
      ownerOnly("Править и одобрять тексты может только владелец.");
      throw new ApiError("В демо тексты не сохраняются — это делает владелец в настоящем пульте.", 409);
    },
    async templatePreview(ws, q): Promise<TemplatePreview> {
      await wait(200);
      find(ws);
      const x = q.id ? DEMO_LIBRARY.find((i) => i.id === q.id) : null;
      const text = x ? (q.lang === "kk" ? x.kk : x.ru) : q.text || "";
      if (!text) throw new ApiError("Нет текста.", 400);
      const blocked = /\[[^\]]*\]/.test(text);
      return { lang: q.lang, demo: true, list: [{ to: "пример", name: "Арман", text: fillDemo(text, "Арман") }], noName: { text: fillDemo(text, "") }, missing: blocked ? ["условия в [скобках]"] : [], blocked };
    },
    async templateAction(ws) {
      await wait(200);
      find(ws);
      ownerOnly("Менять библиотеку может только владелец.");
      throw new ApiError("В демо библиотека не меняется.", 409);
    },
  };

  return {
    api,
    /** Строки для channelReport (старый вид раздела) — из тех же демо-рассылок. */
    rows(ws, channelId) {
      const w = all[ws];
      if (!w) return [];
      const now = Date.now();
      return [...w.camps]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((c) => {
          advance(c, now);
          return { id: c.id, name: c.name, status: c.status, total: c.total, sent: c.sent, failed: c.failed, createdAt: c.createdAt, channelId: channelId(c.channel) };
        });
    },
  };
}
