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
  /** Как включить запуск — текст сервера, только владельцу (bcHow). */
  how?: string;
  /** Владелец снял запрет кода: запуск рассылок со второго номера разрешён (bcOn, финальное ТЗ 02.11.2026). */
  launchOn?: boolean;
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
  /** Рассылка из демо-базы (вымышленные клиенты). */
  demo?: boolean;
  /** Второй номер: одобрена владельцем (не запуск). */
  approved?: boolean;
  /** Запуск на время (мс): рассылка уже «идёт», но первое сообщение уйдёт не раньше этого времени. */
  at?: number;
  /** Второй номер: текст из библиотеки (W01…). */
  tplId?: string;
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
  /** Одобрил владелец (кто и когда). Одобрение — не запуск. */
  approvedBy?: string;
  approvedAt?: number;
  /** Второй номер: в конце сообщения — строка «Если такие сообщения больше не нужны, напишите «стоп».» (выбор владельца в мастере). */
  stop?: boolean;
  /** Второй номер, база: сколько клиентов было в выбранной аудитории (и тех, кому реклама не уйдёт). */
  selected?: number;
  /** Итоги (нет базы D1 — null или нет поля). */
  results?: CampaignResults | null;
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
  /** Кому реклама уйдёт прямо сейчас (согласие, нет «стопа», не записан, не был недавно, без рекламы 30 дней). */
  n: number;
  /** Все клиенты сегмента — и те, кому реклама сейчас не уйдёт (02.11.2026). Нет — сервер старше пульта. */
  total?: number;
  /** Статусы клиентов сегмента — сколько у кого (CrmStatusCounts). */
  st?: CrmStatusCounts;
};

/** Сколько клиентов в каждом статусе (02.11.2026: «0 доступных» — не «0 клиентов»; статусы — не первая причина, а каждый отдельно).
 *  valid — номер верный; booked — есть будущая запись; service — сервисные сообщения можно (нет «стопа» и запрета); marketing — реклама
 *  можно (подтверждённое согласие, нет «стопа», запрета и отказа); stopped — отказались («стоп», полный запрет, «стоп» ждёт решения);
 *  refused — отказ от рекламы; ready — реклама уйдёт прямо сейчас (ещё и не был недавно, не записан, без рекламы 30 дней). */
export type CrmStatusCounts = { valid: number; booked: number; service: number; marketing: number; stopped: number; refused: number; ready: number };
/** Статусы всей базы: base — всего в базе (с неверными и скрытыми номерами), invalid — неверных и скрытых номеров. */
export type CrmStatuses = CrmStatusCounts & { base: number; invalid: number };
/** Числа базы за 90 дней (ТЗ §3): всего (с неверными и скрытыми номерами), номер корректный, неверных и скрытых, постоянные (3+ визита),
 *  были один раз, не приходили 30–60 и 61–90 дней, есть будущая запись, разрешили рекламу, отказались, без подтверждённого разрешения
 *  (это не отказ и не разрешение). */
export type CrmMetrics = { total: number; valid: number; invalid: number; regular: number; once: number; d30_60: number; d61_90: number; booked: number; marketing: number; refused: number; noperm: number };
/** Статусы одного клиента (список сегмента с all=1). */
export type CrmPersonStatus = { booked: boolean; service: boolean; marketing: boolean; stopped: boolean; refused: boolean; ready: boolean };

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
  /** Не пишем (каждый — по первой причине): просили не писать, нет подтверждённого согласия, записаны, были меньше 14 дней назад,
   *  уже писали рекламу за 30 дней (31.10.2026). */
  excluded: { stop: number; noconsent: number; fut: number; recent: number; marketed: number };
  /** База согласий: ready — отвечает; why — почему рекламу сейчас нельзя никому. */
  consent?: { ready: boolean; why: string; n: number };
  /** Статусы всей базы (02.11.2026); null — базы ещё нет; нет поля — сервер старше пульта. */
  statuses?: CrmStatuses | null;
  /** Десять чисел базы за 90 дней (финальное ТЗ рассылок, 02.11.2026); null — базы ещё нет. */
  metrics?: CrmMetrics | null;
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
  /** Статусы клиента — только в списке всех клиентов сегмента (all). */
  st?: CrmPersonStatus;
  /** Почему реклама этому клиенту сейчас не уйдёт — словами сервера; "" — уйдёт. Только в списке всех клиентов (all). */
  why?: string;
};

/** Страница людей сегмента (/api/crm/list, по 50). all — все клиенты сегмента со статусами, а не только те, кому уйдёт реклама. */
export type CrmPage = { seg: string; total: number; page: number; pages: number; per: number; list: CrmPerson[]; all?: boolean };

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
  /** Второй номер: текст из библиотеки (id) — сервер подставляет имя и данные каждому клиенту. */
  tplId?: string;
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
  /** Второй номер: добавить в конце строку «Если такие сообщения больше не нужны, напишите «стоп».» (по умолчанию нет: утверждённые
   *  тексты не меняем). Текст со строкой собирает сервер — тот же в проверке, тесте и отправке. */
  stop?: boolean;
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
  /** Второй номер, база: готовые тексты для 3–5 клиентов (номер маской). */
  samples?: { to: string; text: string }[];
  /** Второй номер: ровно тот текст, что уйдёт (со строкой «стоп», если её выбрали), без имени — имя сервер ставит каждому сам. */
  text?: string;
  /** Второй номер: текст библиотеки, по которому собран text. */
  tplId?: string;
  /** Кому не уйдёт и почему (текст сервера) и сколько. */
  excluded?: { code: string; why: string; n: number }[];
  /** Воронка аудитории (ТЗ V3): всего → с правильным номером → по сегменту → исключения (правила и разрешения) → можно отправлять. */
  funnel?: AudienceFunnel;
};

export type FunnelReason = { code: string; why: string; n: number };
export type AudienceFunnel = {
  total: number;
  valid: number;
  segment: number;
  /** Исключены по правилам компании: недавний визит, будущая запись, реклама за 30 дней, нет данных для текста. */
  rules: FunnelReason[];
  /** Исключены по разрешениям на связь: нет согласия, «стоп», запрет. */
  consent: FunnelReason[];
  allowed: number;
  /** База согласий не отвечает — почему рекламу сейчас нельзя никому. */
  note?: string;
};

/**
 * Итоги рассылки (финальное ТЗ рассылок, 02.11.2026 §9). selected — было в выбранной аудитории; admitted — допущено (можно писать рекламу);
 * sent — ушло; unsure — не знаем, ушло ли (сбой связи); failed — не ушло (ошибки); skipped — пропущено перед отправкой (записались, отказались…).
 * null у delivered, read, replied, want, booked — данных нет (нет базы отметок D1 или свежей базы клиентов): это не ноль.
 * booked — записались в течение window дней после сообщения: совпадение по времени, не доказательство. reports — отчёты о доставке есть.
 */
export type CampaignResults = {
  selected?: number;
  admitted?: number;
  sent: number;
  unsure?: number;
  failed: number;
  skipped?: number;
  delivered: number | null;
  read: number | null;
  replied: number | null;
  want?: number | null;
  booked: number | null;
  /** Отказались после рассылки («стоп», отказ от рекламы); null — данных нет. */
  refused?: number | null;
  window: number;
  reports?: boolean;
};

/** Итоговая аудитория перед запуском (409 { confirm, final }): получат n из rest, не больше cap в сутки с from до to, примерно days дней;
 *  text — сообщение без имени, sample — точный текст первому получателю; at — запланированный запуск. */
export type LaunchFinal = { n: number; rest: number; cap: number; from: number; to: number; days: number; text: string; sample: string; at?: number };
/** Запуск: запущена (или запланирована); сервер показал итоговую аудиторию — подтвердить повтором с sure и n; сигнал Green-API — вопрос. */
export type LaunchResult = { kind: "done"; campaign: CampaignDetail } | { kind: "final"; question: string; final: LaunchFinal } | { kind: "confirm"; question: string };
/** Тест рассылки со второго номера: text — ответ сервера («Сообщение отправлено на ваш номер…»), preview — что ушло; dup — это нажатие уже отправило. */
export type GaTestResult = { text: string; preview: string; dup?: boolean };

export type CampaignCreated = {
  campaign: CampaignDetail;
  /** Повторов убрано, непонятых строк, отброшено сверх предела списка. */
  dup: number;
  bad: number;
  cut: number;
};

export type CampaignAct = "start" | "pause" | "stop" | "delete" | "approve" | "unapprove";
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

/** Сервисное сообщение, которое уходит само (не рассылка): d1 — накануне в 18:00, h2 — за 2 часа, rv — просьба об отзыве через 3 часа;
 *  по журналу Altegio со второго номера ещё s01 — подтверждение новой записи, s06 — сообщение о переносе (ТЗ v2.0 §4) и cx — об отмене
 *  (02.11.2026, «Автоматические сообщения»; время и включённость — там). */
export type ServiceKind = "d1" | "h2" | "rv" | "s01" | "s06" | "cx";

/** Вид сервисного сообщения: включён ли у компании. */
export type ServiceKindState = {
  kind: ServiceKind;
  /** Как сервер называет вид: «Накануне в 18:00 — напоминание о записи». */
  label: string;
  /** false — выключено: напоминания выключены в настройках бота, отзыв — нет ссылки на отзывы. */
  on: boolean;
  /** Ссылка на отзывы (2ГИС, Google Карты) — у просьбы об отзыве. */
  link?: string;
  /** Текст одобрен владельцем (журнал Altegio): без одобрения сообщение не уходит. undefined — сервер старше пульта. */
  approved?: boolean;
  /** Сценарий из каталога: «S03». */
  scenario?: string;
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
  /** Почему ещё не ушло: «текст не одобрен владельцем», «не ушло с 1-й попытки — пробуем ещё». */
  why?: string;
};

/** Решение по очереди (журнал Altegio): ушло, отменено (запись перенесли или удалили), пропущено и почему, задача администратору,
 *  неизвестно — Green-API не ответил (второй раз не шлём). */
export type ServiceLogState = "sent" | "cancelled" | "skipped" | "task" | "unknown";
export type ServiceLogItem = {
  at: number;
  /** Вид сообщения; noshow — «не пришёл» (только задача администратору). */
  kind: ServiceKind | "noshow";
  state: ServiceLogState;
  why: string;
  phone: string;
  name: string;
  date: string;
  time: string;
};
/** Как сценарий работает: auto — уходит сам после одобрения текста; reply — ответ в переписке; task — задача администратору; off — не подключено. */
export type ServiceScenarioMode = "auto" | "reply" | "task" | "off";
/** Сценарий из каталога S01–S18 (src/services/reminders/templates.js): тексты RU/KZ — предпросмотр на вымышленной записи. */
export type ServiceScenario = {
  id: string;
  title: string;
  trigger: string;
  mode: ServiceScenarioMode;
  channel: string;
  note: string;
  /** Версия текста: одобряют текущую. */
  v: number;
  /** Вид в очереди, если сценарий уходит сам. */
  kind: ServiceKind | "";
  approved: boolean;
  approvedAt: number;
  vars: string[];
  preview: { ru: string; kk: string };
  /** Категория для экрана: Запись, Напоминания, Изменения, Опоздания и неявки, После визита, Ошибки и задачи. */
  cat?: string;
  /** Варианты текста (ТЗ v3.0 §6): уходит активный и одобренный. */
  variants?: ServiceVariant[];
};
export type ServiceVariant = { id: string; ru: string; kk: string; active: boolean; approved: boolean; v: number; builtin?: boolean };
/** Что ушло бы по настоящему журналу Altegio — проверка без отправки и без записи (только владелец). */
export type ServiceDryItem = {
  kind: ServiceKind;
  scenario: string;
  at: number;
  /** now — уйдёт сейчас, later — по расписанию, wait — ждёт отметки «пришёл», skip — не уйдёт (why). */
  status: "now" | "later" | "wait" | "skip";
  why: string;
  name: string;
  phone: string;
  date: string;
  time: string;
  staff: string;
  service: string;
  text: string;
  lang: string;
};
export type ServiceDryRun = {
  ok: boolean;
  /** Почему проверить нельзя (нет ключа журнала и т. п.). */
  why?: string;
  at: number;
  from: string;
  to: string;
  records: number;
  /** Журнал прочитан не целиком. */
  cut: boolean;
  /** Отправка включена на сервере (REMIND_GA_<ID> = 1). */
  enabled: boolean;
  /** Номер Green-API подключён. */
  ga: boolean;
  quiet: boolean;
  hold: { at: number; why: string } | null;
  total: number;
  items: ServiceDryItem[];
  /** Записи без сообщений: почему и сколько. */
  skipped: { why: string; n: number }[];
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
  /** Режим журнала: false — напоминания не включены (Text REMIND_GA_<ID> = 1 на сервере включает владелец после согласия заказчика). */
  enabled?: boolean;
  /** Green-API отказал (номер заблокирован или ключ не подходит) — отправка на паузе (6 часов). */
  hold?: { at: number; why: string } | null;
  /** Последние решения по очереди (журнал Altegio), новые сверху. */
  log?: ServiceLogItem[];
  /** Каталог сервисных сценариев S01–S18. */
  catalog?: ServiceScenario[];
};

// ---- Календарь, итоги доставки, библиотека текстов (ТЗ v2.0 §5, §6, §8; сервер — /api/bc/calendar, /api/bc/stats, /api/bc/templates)

/** Один день календаря: сервисные (очередь бота) и реклама (автосценарий) — отдельно, только числа. */
export type CalendarDay = {
  /** ГГГГ-ММ-ДД по Астане. */
  date: string;
  service: { total: number; kinds: Partial<Record<ServiceKind, number>> };
  /** null — у компании нет базы клиентов (реклама по базе не считается). */
  marketing: {
    /** Сколько клиентов в этот день дойдут до «N дней с визита». */
    candidates: number;
    /** Из них можно писать (согласие, нет записи, нет «стоп», 30 дней без рекламы). */
    allowed: number;
    /** Сколько уйдёт: автосценарий включён и есть шаблон — не больше предела в день; иначе 0. */
    planned: number;
    /** Почему нельзя: причина → сколько (noconsent, stop, booked, recent, marketed…). */
    excluded: Record<string, number>;
  } | null;
  /** События дня: сервисные, рассылки по плану, ждут одобрения, отправлено, ошибки, изменения аудитории (стоп, согласия). */
  events?: CalendarEvent[];
};
export type CalendarEventKind = "service" | "campaign" | "approval" | "sent" | "error" | "audience";
export type CalendarEvent = { kind: CalendarEventKind; title: string; n: number; id?: string };
export type CampaignCalendar = {
  today: string;
  /** Автосценарий: включён, через сколько дней после визита, предел в день, есть ли шаблон. null — у компании нет базы. */
  auto: { on: boolean; days: number; cap: number; tpl: boolean } | null;
  /** Когда собрана база клиентов (мс), 0 — не собрана. */
  baseAt: number;
  days: CalendarDay[];
};

export type StatSource = "service" | "review" | "campaign" | "admin";
export type StatCounts = { sent: number; delivered: number; read: number; failed: number; replied: number };
export type MessageStats = {
  /** false — на этом адресе нет базы D1: числа не копятся (why — почему). */
  available: boolean;
  why?: string;
  days: number;
  by: Record<StatSource, StatCounts>;
};

/** Текст из библиотеки (у Winchester — 28 утверждённых владельцем текстов W01–W28, только русский, без вставок: имя в приветствие
 *  ставит сервер; плюс свои). approved — одобрил владелец (это не отправка); status: approved — готов; review — ждёт одобрения
 *  владельца; facts — нужны данные ([скобки]). Стартовый текст без правок (v = 1) — «утверждённая редакция». */
export type LibraryItem = {
  id: string;
  title: string;
  /** Категория (id из TemplateLibrary.cats). */
  cat?: string;
  /** Для кого словами: «Были 30–45 дней назад». */
  who?: string;
  goal: string;
  /** Сегмент базы, для которого задуман текст (all, pora, uhodyat…). */
  seg?: string;
  /** Какие факты нужны перед отправкой (staff.name, slot, promo…). */
  needs?: string[];
  /** Что проверить перед отправкой — словами. */
  check?: string;
  ru: string;
  kk: string;
  /** Казахский текст проверен носителем языка. */
  kkChecked?: boolean;
  /** Что вписать перед одобрением (старое поле). */
  need?: string;
  custom?: boolean;
  archived?: boolean;
  approved: boolean;
  status?: "approved" | "review" | "facts";
  v?: number;
  at?: number;
  by?: string;
  /** Кто и когда одобрил: у стартовых — «Владелец (утверждённая редакция)». */
  approvedBy?: string;
  approvedAt?: number;
};
export type TemplateVar = { key: string; label: string; sample?: string };
/** Категория библиотеки: seg — сегмент базы, для которого она задумана (all, pora, davno, postoyannye, novye); who — для кого словами. */
export type LibraryCat = { id: string; label: string; seg?: string; who?: string };
export type TemplateLibrary = {
  owner: boolean;
  /** Переменные для вставки в текст: { key: "client.first_name", label: "Имя клиента" }. */
  vars: TemplateVar[];
  cats?: LibraryCat[];
  counts?: { total: number; approved: number; review: number; facts?: number; archived?: number };
  items: LibraryItem[];
};
export type TemplatePreview = {
  lang: "ru" | "kk";
  /** true — базы нет, пример на вымышленном клиенте. */
  demo: boolean;
  /** Пример на клиентах сегмента: allowed — реклама ему уйдёт; why — почему не уйдёт (02.11.2026; на вымышленном клиенте полей нет). */
  list: { to: string; name?: string; text: string; issues?: string[]; allowed?: boolean; why?: string }[];
  /** Тот же текст для клиента без имени. */
  noName?: { text: string };
  /** Каких данных не хватает (мастер, время…) — отправить нельзя. */
  missing?: string[];
  blocked?: boolean;
};

// ---- «Автоматические сообщения» второго номера (02.11.2026, сервер — /api/msg/*: src/controllers/automsg.js, src/services/automsg/)

/** Девять сценариев: сервисные (о конкретной записи, без рекламы) и рекламные (только с подтверждённым согласием). */
export type AutoMsgGroup = "service" | "marketing";
/** Поле времени сценария (форма «Текст и время»): minutes/hours/days/count — целое от min до max (кратное step); time — «ЧЧ:ММ»
 *  в часы отправки; choice — один из options; when — поле видно, только если другое поле равно значению. */
export type AutoMsgField = {
  key: string;
  label: string;
  kind: "minutes" | "hours" | "days" | "time" | "choice" | "count";
  min?: number;
  max?: number;
  step?: number;
  options?: { v: string; label: string }[];
  when?: { key: string; is: string };
};
/** Решение по сообщению или действие владельца в журнале сценария. */
export type AutoMsgLogState = "sent" | "unknown" | "failed" | "task" | "skipped" | "cancelled" | "test" | "on" | "off" | "edit" | "planned";
export type AutoMsgLogItem = {
  at: number;
  /** Незнакомое состояние (сервер новее пульта) — как пришло. */
  state: string;
  why: string;
  /** Имя клиента или того, кто изменил («владелец», имя сотрудника на устройстве). */
  name: string;
  /** Номер маской («+7 701 *** ** 88»). */
  phone: string;
  /** Запись, о которой сообщение: ГГГГ-ММ-ДД и ЧЧ:ММ. */
  date: string;
  time: string;
};
export type AutoMsgCounts = { sent: number; failed: number; skipped: number };
/** Текст сценария. Сервисный — {имя} {дата} {время} {мастер} {услуга} {услуга и мастер} {адрес} {ссылка} {компания} и [[ … ]] (кусок
 *  пропадает без данных); рекламный — {{client.first_name}} и т. п. (в пульте — словами). own — свой текст владельца; approved — одобрен. */
export type AutoMsgText = { ru: string; kk: string; v: number; variant?: string; own: boolean; approved: boolean; vars: string[] };
export type AutoMsgScenario = {
  id: string;
  group: AutoMsgGroup;
  title: string;
  /** Кому уходит — словами сервера. */
  who: string;
  /** Включён владельцем. */
  on: boolean;
  /** Включён и правда уходит. */
  live: boolean;
  /** Включён, но не уходит — почему. */
  why: string;
  /** Включить нельзя — почему ("" — можно). */
  locked: string;
  /** Когда и кто последний раз включил или выключил. */
  at: number;
  by: string;
  timing: Record<string, string | number>;
  fields: AutoMsgField[];
  /** Когда уходит — словами сервера. */
  timingText: string;
  /** null — своего текста нет (кампании: текст в мастере рассылки). */
  text: AutoMsgText | null;
  /** Пример на вымышленной записи («Арман», завтра в 15:00). */
  preview: string;
  counts: { today: AutoMsgCounts; week: AutoMsgCounts };
  /** Последние события, новые сверху. */
  log: AutoMsgLogItem[];
  /** Реактивация: сколько клиентов сегодня ровно N дней без визита и скольким можно рекламу; why — причины (код → сколько). */
  audience?: { total: number; allowed: number; why: Record<string, number>; base: boolean } | null;
};
export type AutoMessages = {
  workspace: { id: string; name: string };
  owner: boolean;
  /** Тестовая версия (черновик): отсюда клиентам не уходит ничего. */
  stage: "preview" | "production";
  now: number;
  /** Главный выключатель отправки (Text REMIND_GA_<ID> в Cloudflare): выключен — не уходит ничего, даже включённое здесь. */
  master: { on: boolean; why: string };
  /** Второй номер (Green-API): подключён ли и какой. */
  sender: { ready: boolean; phone: string; why: string };
  /** Журнал Altegio: без него сервисные не знают о записях. */
  altegio: { ready: boolean; why: string };
  /** База отметок от двойной отправки не готова — почему ("" — в порядке). */
  db: string;
  /** Green-API отказал — отправка на паузе (6 часов). */
  hold: { at: number; why: string } | null;
  /** Часы отправки по Астане: с from:00 до to:00. */
  window: { from: number; to: number };
  /** Не больше сообщений со второго номера за сутки. */
  cap: number;
  /** Реклама со второго номера разрешена (запрет gaNoBroadcast снимает только решение владельца в коде). */
  marketing: { allowed: boolean; why: string };
  /** Номер для проверки: владельцу — целиком, сотруднику — маской; null — не указан. */
  test: { phone: string } | null;
  scenarios: AutoMsgScenario[];
};
/** Изменить (только владелец): выключатель, время, текст сценария; часы отправки и предел; номер для проверки ("" — убрать). */
export type AutoMsgPatch =
  | { id: string; on: boolean }
  | { id: string; timing?: Record<string, string | number>; text?: { ru: string; kk: string } }
  | { window?: { from: number; to: number }; cap?: number }
  | { testPhone: string };
/** Проверка ушла на номер владельца: text — что ушло, to — куда; dup — это нажатие уже отправило; unknown — Green-API не ответил. */
export type AutoMsgTestResult = { text: string; to: string; dup?: boolean; unknown?: boolean };
/** «Кто сегодня» у рекламного сценария: сколько подходит (день рождения — по Altegio) и скольким можно рекламу. */
export type AutoMsgAudience = { id: string; total?: number; allowed: number; day: string; at: number };
