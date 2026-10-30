// Понятия раздела «Рассылки» (этап 3 Winchester, docs/tz-winchester-v2.md §5): номера компании, рассылки, база клиентов из Altegio,
// автосценарий «Пора на стрижку». Повторяют то, что сегодня отдаёт сервер (src/controllers/broadcast.js, crm.js) — чего на сервере нет
// (шаблоны Meta со статусом, «доставлено/прочитано», отложенный запуск), того нет и здесь. Номера клиентов базы — только маской,
// как их отдаёт сервер («+7 700 *** ** 44»): полных номеров базы пульт не получает.

/** С какого номера рассылка: основной (Meta Cloud API или Wazzapo, шаблоны Meta) или номер бота (Green-API, обычный текст). */
export type CampaignChannel = "main" | "bot";

/**
 * Состояние рассылки на сервере. ready — создана, не запущена; running — в очереди (в том числе ждёт часов или предела — waitNote);
 * paused — на паузе (вручную или сама, причина в note; «Продолжить» = start); done — обработаны все; stopped — остановлена совсем.
 */
export type CampaignStatus = "ready" | "running" | "paused" | "done" | "stopped";

/** Качество номера по оценке Meta. unknown — Meta не сообщила (или номер через Wazzapo без сведений). */
export type NumberQuality = "green" | "yellow" | "red" | "unknown";

/** Основной номер (Meta / Wazzapo) — для рассылок шаблонами. */
export type MainNumberState = {
  /** Номер подключён к рассылкам (маршрут есть). false — рассылку можно создать, но не запустить; почему — в why. */
  ready: boolean;
  /** Почему не подключён — текст сервера («WhatsApp этого клиента не подключён: …»). Пусто, если ready. */
  why: string;
  /** Номер бизнеса, как его сообщила Meta («+7 700 000 00 99»). */
  phone?: string;
  /** Подтверждённое имя в WhatsApp. */
  name?: string;
  quality: NumberQuality;
  /** Предел Meta — получателей за 24 часа; -1 — без ограничений; 0 — неизвестно. */
  limit: number;
  /** Сведения о номере не получены: текст ошибки Meta / Wazzapo. Номер при этом может работать. */
  infoError?: string;
  /** Отправлено рассылками с этого номера за последние ~24 часа. */
  used24h: number;
  /** Сигналы Meta «остановиться» (жалобы, шаблон приостановлен…): тексты. Пустой список — сигнала нет. */
  hold: string[];
  /** Не доставлено сегодня по отчётам Meta. */
  failedToday: { n: number; codes: CampaignFail[] } | null;
};

/** Номер бота (Green-API, обычный WhatsApp по QR) — рассылки обычным текстом по списку. */
export type BotNumberState = {
  /** Номер на связи (authorized) и Green-API отвечает. */
  ready: boolean;
  /** Состояние инстанса Green-API: authorized, notAuthorized, blocked, yellowCard, sleepMode, starting… */
  state: string;
  phone?: string;
  /** Вебхук ведёт в этого бота — без него рассылку не запустить (бот не увидит «стоп»). */
  hook: boolean;
  /** Почему номер не готов — текст сервера. */
  why: string;
  /** Предупреждение (вебхук не настроен) — текст сервера. */
  warn: string;
  /** Отправлено с номера бота за ~24 часа. */
  used24h: number;
  /** Предел в сутки: по умолчанию и максимум (сервер: 50 и 300). */
  cap: { def: number; max: number };
  /** Сигнал Green-API (номер заблокирован или ограничен) — текст; пусто — нет. */
  hold: string;
  /** Рассылки с этого номера выключены кодом (у Winchester) — почему. Пусто — разрешены. */
  noBroadcast: string;
};

export type CampaignFail = { code: string | number; n: number; hint: string };

/** Строка истории рассылок (/api/bc/list — без чтения каждой рассылки). */
export type CampaignRow = {
  id: string;
  name: string;
  status: CampaignStatus;
  channel: CampaignChannel;
  /** Получателей. */
  total: number;
  /** Обработано (для полоски хода: pos / total). */
  pos: number;
  sent: number;
  /** Не отправлено из-за ошибки. */
  failed: number;
  /** Пропущено: просили не писать. */
  skipped: number;
  /** Пропущено у рассылки по базе: уже записались, были недавно или им уже писали. */
  excluded: number;
  createdAt: number;
  /** Откуда получатели: crm — база клиентов Altegio; list — вставленный список. */
  source: "crm" | "list";
  /** Название сегмента («Пора на стрижку», «Вся база · 36–60 дн. с визита»), если рассылка по сегменту. */
  segment?: string;
  /** Кто создал: владелец, сотрудник или автосценарий. Нет — старая рассылка (поле появилось 19.10.2026). */
  by?: "owner" | "staff" | "auto";
  /** Шаблон Meta (основной номер). */
  template?: string;
};

/** Рассылка целиком (/api/bc/get, ответы create/act/tick). */
export type CampaignDetail = CampaignRow & {
  /** Предел получателей за 24 часа — общий для всех рассылок с этого номера. */
  cap: number;
  /** Часы отправки по Астане, целые: с from:00 до to:00. */
  from: number;
  to: number;
  /** Основной номер — текст шаблона для администратора и бота; номер бота — сообщение одной строкой (переводы строк — « ⏎ »). */
  text: string;
  /** Номер бота: сообщение как уйдёт (с переводами строк и строкой «СТОП»), {имя} не подставлено. */
  message?: string;
  /** Чем заменить имя, если его нет. */
  fallback: string;
  /** Картинка (https). */
  image?: string;
  /** Язык шаблона Meta (ru, kk, en, en_US). */
  lang?: string;
  /** Подстановки шаблона ({имя} — имя клиента). */
  params?: string[];
  /** Код сегмента базы (pora, all, staff:<имя>…). */
  segmentId?: string;
  /** Время снимка базы при создании. */
  crmAt?: number;
  startedAt?: number;
  /** Последняя отправка. */
  lastSentAt?: number;
  /** Номер бота: раньше этого следующее сообщение не уйдёт (пауза 30–150 с). */
  nextAt?: number;
  doneAt?: number;
  /** Идёт, но ждёт: «Отправка идёт с 10:00 до 20:00 по Астане. Продолжу завтра в 10:00.» и т. п. */
  waitNote?: string;
  waitTill?: number;
  /** Временный отказ — повтор в это время. */
  retryAt?: number;
  retryWhy?: string;
  /** Почему на паузе или остановлена — текст сервера. */
  note?: string;
  /** После сбоя посреди порции: неизвестно, дошло ли, — до N человек. */
  unsure?: number;
  fails: CampaignFail[];
  /** Идёт, но фон молчит больше 2,5 минут — можно предложить «Отправить порцию сейчас» (campaignTick). */
  stalled: boolean;
};

/** Обзор раздела: номера компании и история рассылок (/api/bc/list — сервер спрашивает Meta и Green-API, не опрашивать часто). */
export type CampaignsOverview = {
  workspace: { id: string; name: string };
  /** Владелец сервиса (true) или сотрудник компании. */
  owner: boolean;
  main: MainNumberState;
  /** null — номера Green-API у компании нет. */
  bot: BotNumberState | null;
  /** Сколько номеров просили не писать — им рассылки не уходят. */
  optouts: number;
  /** До 60 последних, новые сверху. */
  campaigns: CampaignRow[];
  now: number;
};

/** Сегмент базы клиентов. id: pora, davno, uhodyat, novye, postoyannye, staff:<имя> (all — вся база, в списке не приходит). */
export type CrmSegment = {
  id: string;
  label: string;
  /** Правило словами: «последний визит 21–35 дней назад». */
  rule: string;
  /** Кому можно писать сейчас (исключения уже убраны). */
  n: number;
};

/** Сведения о снимке базы (как прочитан журнал Altegio). */
export type CrmInfo = {
  at: number;
  /** Период журнала: дни ГГГГ-ММ-ДД. */
  from: string;
  to: string;
  records: number;
  visits: number;
  clients: number;
  /** Скрытых номеров («+7 707 XXX-X7-44» — у ключа журнала нет права видеть телефоны). */
  masked: number;
  /** Неверных номеров. */
  bad: number;
  /** Отметки визитов в журнале: «1» — пришёл, «-1» — не пришёл (не считается), «0», «нет» — без отметки. */
  att: Record<string, number>;
  /** Журнал прочитан не весь (больше 40 страниц) — числа меньше настоящих. */
  cut: boolean;
};

/** База клиентов из Altegio (/api/crm/segments). */
export type CrmOverview = {
  owner: boolean;
  /** Почему базу не собрать (настройка; только имена переменных). Пусто — можно. */
  why: string;
  /** Показывать раздел «База клиентов»: настройка в порядке или снимок уже есть (как старая страница: !why || at). */
  available: boolean;
  /** Время снимка; 0 — базы ещё нет (владелец нажимает «Обновить базу»). */
  at: number;
  /** Клиентов с визитами за 90 дней. */
  clients: number;
  /** Из них можно писать сейчас. */
  ok: number;
  segments: CrmSegment[];
  /** Не пишем (каждый — по первой причине): просили не писать, записаны, были меньше 14 дней назад, уже писали за 14 дней. */
  excluded: { stop: number; fut: number; recent: number; marketed: number };
  info: CrmInfo | null;
  /** Последнее обновление не удалось (и оно новее снимка) — текст и время. */
  error?: string;
  errorAt?: number;
};

/** Человек сегмента. Номер — только маской с сервера. */
export type CrmPerson = {
  name: string;
  /** Маска «+7 700 *** ** 44» — показывать как есть, не форматировать. */
  phone: string;
  /** День последнего визита ГГГГ-ММ-ДД. */
  last: string;
  /** Дней с последнего визита (по календарю Астаны). */
  d: number;
  /** Визитов за 90 дней. */
  v: number;
  /** Мастер последнего визита. */
  staff: string;
  /** Услуги последнего визита. */
  svc: string;
};

/** Страница людей сегмента (/api/crm/list, по 50). */
export type CrmPage = { seg: string; total: number; page: number; pages: number; per: number; list: CrmPerson[] };

/** Сегмент с фильтрами — для списка людей и для рассылки по базе. from/to — дни с последнего визита включительно (0–400); staff — мастер. */
export type SegmentSpec = { id: string; from?: number; to?: number; staff?: string };

/** Черновик рассылки из мастера. */
export type CampaignDraft = {
  /** Название для себя (≥ 2 знаков, до 60). */
  name: string;
  /** segment — сегмент базы (только основной номер, шаблон Meta); list — вставленный список. */
  source: "segment" | "list";
  channel: CampaignChannel;
  segment?: SegmentSpec;
  /** Список: по клиенту на строке, «номер, имя» (вставка из Excel). Разбирает сервер. */
  recipients?: string;
  /** Список: отбор по датам в нём — не были дольше N дней (idle) или день рождения в ближайшие N дней (bday), N 1–365. */
  listFilter?: { kind: "idle" | "bday"; days: number };
  /** Основной номер: название шаблона в Meta (^[a-z0-9_]+$). */
  tpl?: string;
  /** Основной номер: язык шаблона (ru, kk, en, en_US). */
  lang?: string;
  /** Основной номер: подстановки по порядку ({имя} — имя клиента). */
  params?: string[];
  /** Основной номер — текст шаблона (его видят администратор и бот); номер бота — само сообщение («СТОП» добавит сервер). */
  text: string;
  /** Картинка — https-ссылка (необязательно). */
  img?: string;
  /** Чем заменить имя, если его нет (до 30 знаков). Пусто — «уважаемый клиент». */
  fallback?: string;
  /** Предел за 24 часа: основной номер 1–100 000, номер бота 1–300. */
  cap: number;
  /** Часы отправки по Астане, целые: 8 ≤ from < to ≤ 22. */
  from: number;
  to: number;
  /** «Это наши клиенты, не просили не писать» — без этого сервер не создаст рассылку. */
  consent?: boolean;
};

/** Проверка черновика без сохранения (/api/bc/check). Название, предел, часы и согласие сервер здесь не проверяет. */
export type CampaignCheck = {
  /** Есть получатели и нет ошибок. */
  ok: boolean;
  /** Получателей. */
  valid: number;
  /** У скольких есть имя для {имя}. */
  named: number;
  /** Повторов убрано (список). */
  dup: number;
  /** До 8 непонятых строк списка. */
  bad: string[];
  /** Сколько всего непонятых строк. */
  badN: number;
  /** Строк отброшено сверх 20 000. */
  cut: number;
  /** Список: сколько просили не писать (им не уйдёт). У сегмента базы — 0 (уже исключены). */
  stopped: number;
  /** Отбор по датам списка (listFilter): название, сколько не подошло, у скольких нет даты. */
  listFilter?: { label: string; out: number; noDate: number };
  /** Сегмент базы: название, время снимка, сколько в нём. */
  segment?: { id: string; label: string; at: number; total: number };
  /** До 5 первых: «+7 700 *** ** 04 — Арман» (база — маской). */
  sample: string[];
  /** Ошибки полей и получателей — тексты сервера (со строчной буквы). */
  errors: string[];
  /** Основной номер — подстановки для первого клиента с именем; номер бота — [полный текст сообщения с именем и строкой СТОП]. */
  preview: string[];
};

export type CampaignCreated = {
  campaign: CampaignDetail;
  /** Повторов убрано, непонятых строк, отброшено сверх предела списка. */
  dup: number;
  bad: number;
  cut: number;
};

export type CampaignAct = "start" | "pause" | "stop" | "delete";
/** Ответ на действие: готово (рассылка после действия), удалена или сервер спрашивает подтверждение (сигнал Meta) — тогда повторить с force. */
export type CampaignActResult = { kind: "done"; campaign: CampaignDetail } | { kind: "deleted" } | { kind: "confirm"; question: string };

/** «Отправить порцию сейчас»: state — running (отправила, ещё есть), wait (часы, предел, пауза), busy, paused, stopped, done. */
export type CampaignTickResult = { campaign: CampaignDetail; state: string };

/** «Не дошло — почему»: строки «номер — причина» (у рассылки по базе номер маской). */
export type CampaignFailures = { campaign: CampaignDetail; lines: string[] };

/** Настройки автосценария «Пора на стрижку». */
export type AutoSettings = {
  on: boolean;
  /** Ровно N дней с последнего визита (7–120). */
  days: number;
  /** Шаблон Meta категории Marketing. Пусто — включить нельзя. */
  tpl: string;
  lang: string;
  /** Не больше сообщений в день (1–100). */
  cap: number;
  /** Часы отправки по Астане: 8 ≤ from < to ≤ 22, «до» позже 11:00. */
  from: number;
  to: number;
  /** Заметка для администратора и бота (что за сообщение ушло). */
  text: string;
};

/** Автосценарий: настройки и состояние (/api/bc/auto). */
export type AutoInfo = {
  owner: boolean;
  settings: AutoSettings;
  /** У компании есть база клиентов (иначе автосценарий недоступен). */
  available: boolean;
  /** Почему недоступен (нет базы или основной номер не подключён). */
  why: string;
  /** Снимок базы: время и свежесть (не старше 36 ч — иначе автосценарий пропустит день). */
  crm: { at: number; fresh: boolean };
  /** Кому написал бы сегодня: total — ровно N дней с визита и можно писать; n — не больше предела в день. */
  today: { n: number; total: number };
  /** При днях < 14 или > 90: «с таким числом дней автосценарию некому писать». */
  note?: string;
  /** Последняя проверка качества номера (в 10:00). */
  quality: { level: NumberQuality; at: number } | null;
  /** Почему последний раз пропустил день (если меньше 2 суток назад). */
  skip?: { at: number; why: string };
};

/** Сервисное сообщение, которое бот шлёт сам (не рассылка): d1 — накануне в 18:00, h2 — за 2 часа, rv — просьба об отзыве через 3 часа. */
export type ServiceKind = "d1" | "h2" | "rv";

/** Вид сервисного сообщения: включён ли у компании. */
export type ServiceKindState = {
  kind: ServiceKind;
  /** Как сервер называет вид: «Накануне в 18:00 — напоминание о записи». */
  label: string;
  /** false — выключено: напоминания выключены в настройках бота, отзыв — нет ссылки на отзывы. */
  on: boolean;
  /** Ссылка на отзывы (2ГИС, Google Карты) — у просьбы об отзыве. */
  link?: string;
};

/** Сообщение в очереди: кому, что и когда уйдёт. Номер — только маской с сервера. */
export type ServiceQueueItem = {
  kind: ServiceKind;
  /** Когда уйдёт (мс). Может быть чуть в прошлом — фоновая задача отправит в ближайшую минуту. */
  at: number;
  /** С какого номера: тот, куда клиент писал боту (у Winchester — номер бота). */
  channel: CampaignChannel;
  /** Маска «+7 700 *** ** 34» — показывать как есть. */
  phone: string;
  /** Имя из чата; пусто — неизвестно. */
  name: string;
  /** Запись, о которой сообщение: день ГГГГ-ММ-ДД и время ЧЧ:ММ по Астане. */
  date: string;
  time: string;
};

/** Сервисные сообщения компании (/api/bc/service): что бот шлёт сам, ближайшие в очереди, сколько ушло. Владелец и сотрудник видят одно и то же. */
export type ServiceOverview = {
  owner: boolean;
  kinds: ServiceKindState[];
  /** Ближайшие по времени (сервер отдаёт до 50). */
  queue: ServiceQueueItem[];
  /** Всего в очереди — только то, что бот отправит: отменённые и перенесённые записи и «стоп» сервер не считает (может быть больше, чем в queue). */
  total: number;
  /** Ушло за последние 3 дня (удачные отправки; неудачные попытки не считаются). */
  sent3d: number;
  /** Бот на номере бота выключен (не отвечает и не записывает) — новых напоминаний не будет. */
  botOff: boolean;
  /** Бот записывает в Altegio. false — напоминаний и просьб об отзыве не бывает: бот строит их только по своим записям в Altegio. */
  altegio: boolean;
  /** Напоминания по всем записям журнала Altegio со второго номера, без бота (Winchester, 30.10.2026): тогда botOff не мешает. */
  journal?: boolean;
  /** Green-API отказал (номер заблокирован или ключ не подходит) — отправка на паузе (6 часов). */
  hold?: { at: number; why: string } | null;
};
