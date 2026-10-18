// @ts-check
// Простые числовые и строковые константы верхнего уровня (лимиты, сроки, адреса API).

// ---- Паузы, сроки хранения, окна истории
export const PAUSE_MS = 2 * 3600e3;
export const LEAD_TTL = 30 * 86400e3;
export const MAX_TURNS = 24, MAX_MSGS_PER_SESSION = 40, MAX_LEN = 600, SESSIONS_PER_IP = 8;
export const HIST_KEEP = 60;

// ---- Altegio: адрес API, кэши, лимиты записей
// API онлайн-записи Altegio: нужен только ключ разработчика (ALTEGIO_PARTNER) и номер локации клиента.
export const ALT_API = "https://api.alteg.io/api/v1";
export const ALT_TTL = 120e3, ALT_BASE_TTL = 600e3, ALT_DAYS = 3;
export const ALT_MAX_SERVICES = 150, ALT_MAX_STAFF = 30;
// автоматических записей: на один чат; в сутки на один телефон или IP; в сутки на всю локацию. Сверх этого — заявка администратору
// с одного IP лимит выше: через Wi-Fi салона или одного сотового оператора пишут разные клиенты
export const ALT_MAX_ACTIVE = 4, ALT_MAX_DAY = 5, ALT_MAX_DAY_IP = 15, ALT_MAX_LOC_DAY = 60, ALT_MAX_ADMIN_LEADS = 6;

// ---- Altegio: возраст записи и глубина журнала
export const ALT_GONE_AGE = 5 * 60e3; // запись моложе — по времени мастера не проверяем
export const ALT_JOURNAL_DAYS = 30;

// ---- база клиентов из журнала Altegio (services/crm, docs/tz-winchester-v2.md §4): окно снимка — визиты за 90 дней назад и
// будущие записи на 60 дней вперёд; снимок ночью в 04:00 по Астане (меньше всего записей и запросов к Altegio); не писать
// маркетинг тем, кто был меньше 14 дней назад или кому уже писали за 14 дней; в списке для пульта — по 50 человек
export const CRM_PAST_DAYS = 90, CRM_FUTURE_DAYS = 60, CRM_HOUR = 4, CRM_QUIET_DAYS = 14, CRM_PAGE = 50;
// рассылка по базе: снимок не старше 3 дней (иначе напишем «пора на стрижку» тому, кто уже записался); автосценарий «Пора на
// стрижку» — в 11:00 по Астане и только по снимку не старше 36 часов (ночное обновление в 04:00 могло один раз не сработать)
export const CRM_FRESH_BC = 3 * 86400e3, CRM_FRESH_AUTO = 36 * 3600e3, AUTO_HOUR = 11;

// ---- Прочие простые константы
export const WA_MAX_DAY = 80; // сообщений в сутки от одного номера WhatsApp, на которые бот отвечает сам
export const PL_MAX = 5;
export const GRAPH = "https://graph.facebook.com/v23.0";
export const WA_BATCH = 12; // столько сообщений из одного запроса бот отвечает сам; остальные (всплеск после рассылки) сохраняет в чатах для администратора
export const GA_BASE = "https://api.green-api.com";
export const REPAIR_MAX = 300;
export const SESSION_MS = 30 * 86400e3, COOKIE = "aia";
export const BC_CHUNK = 250, BC_MAX = 20000, BC_STALE = 150e3, BC_SLOT = 600e3, BC_DAY = 145; // получателей в ключе; предел списка; «фон молчит»; шаг учёта — 10 минут; сутки с запасом — 145 шагов
export const DIGEST_HOUR = 21;
export const REMIND_LATE = 3 * 3600e3; // опоздали больше чем на 3 часа (фоновая задача не работала) — уже не отправляем

// общий предел времени на ответы ИИ в одном сообщении клиента, мс (переспросы защиты входят). Фону Cloudflare после ответа вебхуку даётся около 30 с;
// остаток — на запись в Altegio и отправку. Переменная AI_BUDGET_MS меняет предел (проверки ставят маленький)
export const AI_BUDGET_MS = 20000;
