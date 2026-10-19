// Понятия пульта. Повторяют цель из REFACTORING.md §2.2 (workspaces → channels → chats → messages), а не форму ответов KV:
// сервер сегодня отдаёт меньше, и чего нет — то здесь необязательное поле, а не выдумка (см. api/live.ts).

/** Компания (арендатор). Сегодня — паспорт бота `c=<id>`; после фазы 2 — строка `workspaces`. */
export type Workspace = {
  id: string;
  name: string;
  /** Бот выключен во всей компании: отвечают только люди. */
  botOff: boolean;
  /** Филиалы. На сервере их пока нет — список пустой, переключатель не показывается. */
  branches: Branch[];
  channels: Channel[];
  capabilities: Capabilities;
};

export type Branch = { id: string; name: string; address?: string };

export type Capabilities = {
  /** Запись в CRM (Altegio): в карточке клиента есть раздел «Записи». */
  booking: boolean | null;
  /** Рассылки по базе (страница /broadcast). */
  campaigns: boolean;
};

/**
 * Подключённый канал — номер WhatsApp или чат на сайте. Сегодня id совпадает с кодом канала на сервере
 * (`wa` — номер Meta Cloud API, `ga` — номер Green-API, `web` — чат на сайте); после фазы 2 — uuid строки `channels`.
 */
export type ChannelKind = "wa_cloud" | "green_api" | "web";
export type Channel = {
  id: string;
  kind: ChannelKind;
  /** Название номера, как его зовут в компании («ИИ-администратор», «Основной WhatsApp»). Пусто — показываем по виду подключения. */
  name: string;
  /** Номер телефона канала, если сервер его сообщил. */
  phone?: string;
  branchId?: string;
  /** Состояние подключения, если сервер его сообщил. */
  health?: { level: "ok" | "warn"; text: string };
};

/** Чат = переписка одного клиента через один канал. Клиент, писавший на оба номера, — два чата одного контакта. */
export type ConversationRef = { channelId: string; externalId: string };

/** Кто ведёт переписку. Канал (через какой номер) и режим (бот или человек) — разные вещи. */
export type BotState =
  | { state: "active" }
  | { state: "paused"; until: number } // человек взял чат: бот молчит до until
  | { state: "stopped" } // клиент попросил не писать ему автоматически
  | { state: "off" }; // бот выключен во всей компании

/** Нужен человек: бот передал чат или клиент оставил просьбу. */
export type Attention = { reason: string; label: string; since?: number } | null;

export type Contact = {
  /** Ключ контакта — цифры телефона. По нему один и тот же клиент находится в чатах разных номеров. */
  key: string;
  name?: string;
  /** Имя из профиля WhatsApp. */
  profileName?: string;
  phone?: string;
};

export type Sender = "contact" | "bot" | "operator" | "system";

export type ConversationSummary = {
  key: string;
  ref: ConversationRef;
  contact: Contact;
  lastAt: number;
  lastInboundAt?: number;
  preview: string;
  previewFrom: Sender | null;
  attention: Attention;
  bot: BotState;
  hasBooking: boolean;
  /** Число непрочитанных, если сервер его знает (после фазы 2 — chats.unread_count). */
  unreadCount?: number;
  /** Новое сообщение клиента после последнего просмотра на этом устройстве. */
  unread: boolean;
};

export type MediaKind = "audio" | "image" | "video" | "document" | "sticker" | "location" | "contact";
export type Message = {
  id: string;
  from: Sender;
  text: string;
  at: number;
  /** Человек ответил прямо с телефона (приложение WhatsApp), а не из пульта. */
  via?: "phone";
  media?: { kind: MediaKind; url?: string };
  /** Только у сообщений, которые пульт ещё отправляет или не смог отправить. */
  delivery?: "sending" | "failed";
  error?: string;
};

export type RequestKind = "lead" | "cancel" | "change" | "callback";
/** Невыполненная просьба клиента в чате (заявка, отмена, перенос, звонок). */
export type ChatRequest = { id: string; kind: RequestKind; name: string; service: string; time: string; note: string };

export type ReplyState =
  | { allowed: true; closesAt?: number }
  | { allowed: false; reason: "web" | "window" | "not_connected" | "stopped"; text: string };

export type ConversationDetail = {
  key: string;
  ref: ConversationRef;
  contact: Contact;
  messages: Message[];
  attention: Attention;
  bot: BotState;
  /** Записи из журнала CRM — правда о записях (CLAUDE.md §5.1). */
  bookings: string[];
  /** Заявки, ещё не подтверждённые в CRM. */
  pending: string[];
  bookedNote: string;
  requests: ChatRequest[];
  reply: ReplyState;
  /** Реквизиты для оплаты из паспорта — администратор вставляет их в ответ сам. */
  payment?: string;
  /** Недавняя рассылка: клиент мог ответить на неё. */
  campaign?: { at: number; name: string; text: string };
  /** Предупреждение сервера после действия (например, «ушло, но не сохранилось»). */
  warning?: string;
};

/** Заявка из общего списка заявок компании. */
export type Lead = {
  id: string;
  kind: RequestKind;
  name: string;
  phone: string;
  service: string;
  time: string;
  note: string;
  /** Пусто — не выполнена. */
  status: string;
  /** Через какой канал пришла (если понятно из источника). */
  channelId?: string;
  at: number;
};

export type Campaign = {
  id: string;
  name: string;
  status: "ready" | "running" | "paused" | "stopped" | "done" | string;
  total: number;
  sent: number;
  failed: number;
  createdAt: number;
  channelId?: string;
};

export type ChannelReport = {
  channels: Channel[];
  /** Сколько клиентов отписались от рассылок («стоп»). */
  optouts?: number;
  campaigns: Campaign[];
  owner: boolean;
};

export type Role = "owner" | "staff";
export type Session = { role: Role; workspaceId: string | null };
export type WorkspaceOption = { id: string; name: string; kind?: string };

export type InboxSnapshot = {
  workspace: Workspace;
  conversations: ConversationSummary[];
  /** Сервер отдал не все чаты (показываются последние). */
  truncated: { shown: number; total: number } | null;
  now: number;
};

export type ChatAction = "pause" | "resume" | "resolve" | "forget";
