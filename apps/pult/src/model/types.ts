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
/** Тема входящего — пометка по словам, не решение ИИ (сервер: services/inbox/queue.js). */
export type Topic = "book" | "move" | "cancel" | "late" | "time";
/** Клиент ответил на наше автоматическое сообщение: rm — напоминание или отзыв, bc — рассылка. */
export type ReplySource = { kind: "rm" | "bc"; at: number; text: string };
export type Attention = { reason: string; label: string; since?: number; topic?: Topic; source?: ReplySource } | null;
/** Статус исходящего у провайдера: часы, одна, две серые, две синие галочки, ошибка, неизвестно (ТЗ v2.0 §2.3). */
export type DeliveryStatus = "queued" | "sent" | "delivered" | "read" | "failed" | "unknown";

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
  /** Клиент писал в этот чат (иначе — только наши сообщения: напоминание, ответ с телефона). */
  inbound: boolean;
  /** Кто ведёт чат — имя сотрудника. */
  assignee?: string;
  /** Чат закрыт кнопкой «Готово», клиент больше не писал. */
  done?: boolean;
  /** Статус нашего последнего сообщения (если оно последнее в чате). */
  lastStatus?: DeliveryStatus;
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
  /** Имя сотрудника, который ответил из пульта. */
  operator?: string;
  /** Автоматическое сообщение: напоминание или отзыв (service) и рассылка (campaign). */
  auto?: "service" | "campaign";
  status?: DeliveryStatus;
  statusError?: string;
  edited?: boolean;
  deleted?: boolean;
  /** Реакция клиента на это сообщение. */
  reaction?: string;
  media?: { kind: MediaKind; url?: string; name?: string; mime?: string; size?: number };
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
  assignee?: string;
  done?: boolean;
  /** На какой номер компании написал клиент. */
  line?: { label: string; phone?: string };
  /** Кто что делал в чате (последние). */
  audit?: { at: number; who: string; act: string; to?: string }[];
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
  /** Сколько чатов только с нашими сообщениями (клиент не отвечал) — в списке не показываются. */
  outOnly?: number;
  /** Имена сотрудников для «Назначить». */
  operators?: string[];
  now: number;
};

/** Запись клиента в Altegio для карточки чата (только чтение журнала). */
export type BookingCard = { id: string; date: string; time: string; staff: string; services: string; minutes?: number; state: string; source: string };
export type ChatAction = "pause" | "resume" | "resolve" | "forget" | "take" | "assign" | "reopen" | "task" | "late";
/** Дополнительно к действию: кому назначить, закрыть несмотря на вопрос клиента. */
export type ChatActionExtra = { to?: string; force?: boolean; text?: string; min?: number };
