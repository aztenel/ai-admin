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
