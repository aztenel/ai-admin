// Понятия раздела «Клиенты» (этап 1 плана D1, docs/architecture-cloudflare-d1.md): единая база контактов компании в D1 —
// синхронизация с журналом Altegio, ручное добавление, импорт из файла, согласия, запреты и их история, сегменты, проверки данных.
// Повторяют ответы сервера /api/contacts/* (src/controllers/contacts.js). Время — мс UTC, показывается по Астане.
// Номера: в списке и в предпросмотре импорта — только маской («+7 700 *** ** 44»); полностью — только в карточке одного клиента.

/** Окно синхронизации журнала Altegio: hot — вчера…2 недели вперёд, future — записи на 60 дней, past — визиты за месяц (ночью). */
export type SyncScope = "hot" | "future" | "past";
/** unknown — «ещё не проверено» (загрузки или сверки ещё не было): это не успех, показывается серым «?». */
export type CheckLevel = "ok" | "warn" | "bad" | "unknown";
export type ConsentState = "granted" | "denied" | "unknown";
export type ConsentPurpose = "marketing" | "service";
/**
 * Чем подтверждено согласие: chat — клиент сам написал в WhatsApp (сервер нашёл его сообщение), document — письменное (анкета,
 * договор, с номером и датой), oral — устно в салоне (нельзя, если клиент сам отказывался), import — из файла (не подтверждено),
 * altegio — флаг «разрешил рассылки» в Altegio (не подтверждено), client_stop — клиент сам отказался («стоп»).
 */
export type ConsentEvidence = "chat" | "document" | "oral" | "import" | "altegio" | "client_stop";
/** Вид запрета. Человек ставит только marketing_optout (не писать рекламу) и full_block (не писать вообще); остальные ставит бот. */
export type RestrictionKind = "marketing_optout" | "full_block" | "sender_block" | "cooldown" | "undeliverable";
export type ImportAction = "new" | "update" | "same" | "dup" | "invalid";
/** Решение по неоднозначному «стоп»: оставить запрет рекламы, закрыть все сообщения, снять (только владелец). */
export type ReviewDecision = "keep" | "all" | "lift";
export type SyncMode = "step" | "dry" | "test";
export type StopsAction = "sweep" | "migrate-check" | "migrate";

export type SyncWindow = { scope: SyncScope; label: string; lastOkAt: number | null; lastError: string | null };

export type SyncState = {
  /** Синхронизацию с Altegio можно запускать (есть локация и ключ журнала). Нет — почему: why. */
  available: boolean;
  why?: string;
  /** Черновик: настоящий Altegio читается только проверкой без записи (персональные данные клиентов в черновик не попадают). */
  dryOnly: boolean;
  /** Первичная загрузка журнала: from/to — дни ГГГГ-ММ-ДД, cursor — докуда дошла, pct — 0–100. */
  initial: { done: boolean; from: string; to: string; cursor: string; pct: number };
  lastOkAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  running: boolean;
  windows: SyncWindow[];
  /** Итог последней загрузки: записей журнала, клиентов, записей в базе, скрытых и неверных номеров, удалённых записей. */
  stats: { records: number; contacts: number; bookings: number; masked: number; bad: number; deleted: number } | null;
  /** Справочник клиентов Altegio — вся база, а не только те, кто был в журнале за 2 года: сколько прочитано из total. */
  directory: { done: boolean; total: number; pct: number; lastOkAt: number | null; lastError: string | null } | null;
};

export type DataCheck = { id: string; label: string; count: number; level: CheckLevel; hint: string };
export type Report = { at: number; ok: boolean; summary: string[] };

export type ContactsStatus = {
  /** База контактов (D1) подключена. false — почему: why (у боевого сайта до решения владельца). */
  ready: boolean;
  why?: string;
  stage: "preview" | "production";
  owner: boolean;
  client: { id: string; name: string };
  counts: { contacts: number; withVisits: number; upcoming: number; stops: number; review: number };
  sync: SyncState;
  /** Сверка «стопов» по журналу входящих Green-API (не надеемся на повтор вебхука): когда, ошибка, сколько нашла; channel null — номера Green-API нет. */
  stops: { lastOkAt: number | null; lastError: string | null; found: number; channel: "ga" | null };
  probe: Report | null;
  checks: DataCheck[];
  errors: { at: number; scope: string; text: string }[];
};

export type ContactSegment = { id: string; label: string; rule: string; count: number; /** скольким из них можно писать рекламу */ ready: number };
export type ContactSegments = { at: number; segments: ContactSegment[] };

export type ContactRow = {
  id: string;
  name: string;
  /** Маской. */
  phone: string;
  lastVisitAt: number | null;
  /** Дней с последнего визита по календарю Астаны — считает сервер; null — не прислал (старый сервер) или визитов нет. */
  daysAgo: number | null;
  visits: number;
  nextBookingAt: number | null;
  lastStaff: string;
  consent: ConsentState;
  /** Согласие «есть» подтверждено (сообщение клиента, письменное, устно без прежнего отказа); из файла или Altegio — нет. */
  consentConfirmed: boolean;
  stop: boolean;
  fullBlock: boolean;
  review: boolean;
  sources: string[];
};
export type ContactPage = { total: number; page: number; pages: number; per: number; items: ContactRow[] };

export type Visit = { id: string; at: number; staff: string; services: string; attendance: number | null };
export type ConsentRecord = {
  state: ConsentState;
  basis: string;
  source: string;
  actor: string;
  /** Когда записали. */
  at: number;
  /** Подтверждено (реклама уходит только при «есть» + подтверждено). */
  confirmed: boolean;
  evidence: ConsentEvidence | null;
  /** Что подтверждает: время сообщения клиента, номер анкеты, импорт. */
  evidenceRef: string | null;
  /** Когда клиент согласился или отказался (а не когда записали). */
  givenAt: number | null;
};
/** Что можно выбрать в диалоге согласия: был ли отказ клиента, есть ли его сообщение после отказа, можно ли «устно». */
export type ConsentRules = { refusedAt: number | null; chatAvailable: boolean; oralAllowed: boolean; chatText?: string | null; chatAt?: number | null };
/** Новое согласие: для «есть» обязательно evidence; document — evidenceRef и givenAt (ГГГГ-ММ-ДД). */
export type ConsentInput = { purpose: ConsentPurpose; state: ConsentState; basis: string; evidence?: "chat" | "document" | "oral"; evidenceRef?: string; givenAt?: string };
export type Restriction = {
  id: string;
  kind: RestrictionKind;
  reason: string;
  source: string;
  actor: string;
  at: number;
  /** Неоднозначный «стоп»: реклама закрыта, пока человек не решит. */
  review: boolean;
  liftedAt: number | null;
  liftedBy: string;
  liftReason: string;
  active: boolean;
  /** Запрет поставил сам клиент («стоп», кнопка Meta): снять можно только после его нового подтверждённого согласия. */
  byClient: boolean;
  /** До когда пауза (cooldown): например, «запись отменена в Altegio». */
  untilAt: number | null;
  /** Можно ли снять сейчас; нельзя — почему (liftHint). */
  canLift: boolean;
  liftHint: string;
};

export type ContactCard = {
  contact: {
    id: string;
    name: string;
    /** Полностью — это карточка одного клиента (владелец или сотрудник компании). */
    phone: string;
    altegioId: string;
    firstVisitAt: number | null;
    lastVisitAt: number | null;
    /** Дней с последнего визита по календарю Астаны — считает сервер. */
    daysAgo: number | null;
    visits: number;
    /** Визитов и последний визит по справочнику Altegio (вся история, не только журнал за 2 года); null — нет данных. */
    altVisits: number | null;
    altLastVisitAt: number | null;
    /** Флаг Altegio «разрешил рассылки»: true / false / null — нет. Это не подтверждённое согласие. */
    newsletter: boolean | null;
    nextBookingAt: number | null;
    lastStaff: string;
    lastService: string;
    createdAt: number;
    updatedAt: number;
    syncedAt: number | null;
    sources: { source: string; at: number }[];
  };
  visits: Visit[];
  upcoming: Visit[];
  /** Неявок («не пришёл»). */
  missed: number;
  consent: { marketing: ConsentRecord | null; service: ConsentRecord | null };
  consentHistory: (ConsentRecord & { purpose: ConsentPurpose })[];
  consentRules: ConsentRules;
  restrictions: Restriction[];
  segments: { id: string; label: string }[];
  /** Можно ли писать рекламу сейчас и почему нет. */
  canMarket: { ok: boolean; reasons: string[] };
  events: { at: number; kind: string; text: string }[];
};

export type ImportRow = { row: number; phone: string; name: string; action: ImportAction; error?: string };
export type ImportPreview = {
  id: string;
  total: number;
  counts: Record<ImportAction, number>;
  /** Какие колонки файла узнаны: заголовок или номер колонки; пусто — не нашли. */
  columns: { phone: string; name: string; consent: string };
  hasConsent: boolean;
  /** Что будет с согласиями из файла (сервер): показать под блоком согласия. */
  consentNote: string;
  rows: ImportRow[];
};
/** consents — сколько записано отметок из файла; consentsUnconfirmed — из них «есть», но не подтверждено; consentsSkipped — пропущено (клиент сам отказывался). */
export type ImportDone = { created: number; updated: number; consents: number; consentsUnconfirmed: number; consentsSkipped: number };
/** Импорт: файл (.csv, .xlsx, .txt) или вставленный текст. */
export type ImportInput = { file: File } | { text: string };

export type SyncResult = { sync: SyncState; report?: { summary: string[] } };
