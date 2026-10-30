// Откуда пульт берёт данные. Два источника с одним интерфейсом:
//   live — настоящий API бота (/api/inbox/*, /api/bc/*, /api/crm/*, /api/contacts/*, /api/studio/list), см. data/live.ts
//          (рассылки — live-campaigns.ts, клиенты — live-contacts.ts);
//   demo — вымышленные компании для показа и проверки вида, см. data/demo.ts.
// Режим выбирается явно (сборка с VITE_PULT_DATA=demo или адрес /demo). Если сервер не ответил, пульт показывает ошибку —
// подставлять демо вместо настоящих данных нельзя.
import type {
  ChannelReport,
  ChatAction,
  ConversationDetail,
  ConversationRef,
  InboxSnapshot,
  Lead,
  Session,
  WorkspaceOption,
} from "@/model/types";
import type {
  AutoInfo,
  AutoSettings,
  CampaignAct,
  CampaignActResult,
  CampaignCheck,
  CampaignCreated,
  CampaignDetail,
  CampaignDraft,
  CampaignFailures,
  CampaignsOverview,
  CampaignTickResult,
  CrmInfo,
  CrmOverview,
  CrmPage,
  SegmentSpec,
  ServiceOverview,
} from "@/model/campaigns";
import type {
  ConsentPurpose,
  ConsentState,
  ContactCard,
  ContactPage,
  ContactSegments,
  ContactsStatus,
  ImportDone,
  ImportInput,
  ImportPreview,
  Report,
  ReviewDecision,
  StopsAction,
  SyncMode,
  SyncResult,
} from "@/model/contacts";
import { createLiveSource } from "./live";

export { ApiError } from "./errors";

/**
 * Раздел «Рассылки»: номера, рассылки, база клиентов из Altegio, автосценарий (model/campaigns.ts). ws — id компании (c=).
 * Ошибки — ApiError: message — текст сервера; errors — список ошибок формы (create, autoSet); роль проверяет сервер
 * (сотруднику crmRefresh, autoSet и clearMetaHold отвечают 403).
 */
export interface CampaignSource {
  /** Номера компании и история рассылок. Дорогой запрос (сервер спрашивает Meta и Green-API) — не опрашивать часто; ход — campaign(). */
  campaignsOverview(ws: string): Promise<CampaignsOverview>;
  /** Одна рассылка целиком — дешёвый запрос, им опрашивать ход идущей рассылки. */
  campaign(ws: string, id: string): Promise<CampaignDetail>;
  /** «Не дошло — почему»: строки «номер — причина» (номера базы — маской). */
  campaignBad(ws: string, id: string): Promise<CampaignFailures>;
  /** Проверить черновик без сохранения: ошибки — в result.errors (не исключением). */
  checkCampaign(ws: string, draft: CampaignDraft): Promise<CampaignCheck>;
  /** Создать (статус ready, не запускает). Ошибки формы — ApiError.errors. */
  createCampaign(ws: string, draft: CampaignDraft): Promise<CampaignCreated>;
  /** Запустить / продолжить (start), пауза, остановить совсем, удалить. Сигнал Meta → { kind: "confirm" }: спросить и повторить с force = true. */
  campaignAct(ws: string, id: string, act: CampaignAct, force?: boolean): Promise<CampaignActResult>;
  /** Отправить порцию вручную — только когда campaign.stalled (фон молчит). */
  campaignTick(ws: string, id: string): Promise<CampaignTickResult>;
  /** Пробная отправка черновика на один номер (свой). Ответ — текст сервера «Шаблон отправлен на … — проверьте WhatsApp». */
  testSend(ws: string, draft: CampaignDraft, to: string): Promise<string>;
  /** База клиентов: числа, сегменты, исключения. */
  crmSegments(ws: string): Promise<CrmOverview>;
  /** Люди сегмента по 50 (page с 1), номера — маской. */
  crmList(ws: string, spec: SegmentSpec, page?: number): Promise<CrmPage>;
  /** Собрать базу из журнала Altegio сейчас — только владелец, до минуты. */
  crmRefresh(ws: string): Promise<CrmInfo>;
  /** Автосценарий «Пора на стрижку»: настройки и состояние. */
  autoGet(ws: string): Promise<AutoInfo>;
  /** Изменить автосценарий (только владелец), можно одно поле. Ошибки — ApiError.errors. Ответ — настройки после изменения. */
  autoSet(ws: string, patch: Partial<AutoSettings>): Promise<AutoSettings>;
  /** Снять сигнал Meta «остановиться» (только владелец). Остановленные рассылки остаются на паузе — их продолжают «Продолжить». */
  clearMetaHold(ws: string): Promise<void>;
  /** Сервисные сообщения (вкладка «Сервисные · номер бота»): что бот шлёт сам, очередь (номера маской), сколько ушло за 3 дня. Только чтение. */
  serviceMessages(ws: string): Promise<ServiceOverview>;
}

/**
 * Раздел «Клиенты» (model/contacts.ts): база контактов компании в D1. Ошибки — ApiError с текстом сервера; поле формы с ошибкой
 * (add) — ApiError.field. Роль проверяет сервер: сотруднику lift (и review «lift»), sync, probe и stops отвечают 403.
 */
export interface ContactSource {
  contactsStatus(ws: string): Promise<ContactsStatus>;
  contactSegments(ws: string): Promise<ContactSegments>;
  /** По 50 (page с 1); номера — маской. seg — id сегмента («» — все), q — имя или номер. */
  contactList(ws: string, opts: { q?: string; seg?: string; page?: number }): Promise<ContactPage>;
  /** Карточка одного клиента: номер полностью. */
  contactCard(ws: string, id: string): Promise<ContactCard>;
  /** Добавить вручную; такой номер уже есть — created: false и id существующего. */
  addContact(ws: string, phone: string, name: string): Promise<{ id: string; created: boolean }>;
  setConsent(ws: string, id: string, purpose: ConsentPurpose, state: ConsentState, basis: string): Promise<void>;
  addRestriction(ws: string, id: string, kind: "marketing_optout" | "full_block", reason: string): Promise<void>;
  liftRestriction(ws: string, id: string, rid: string, reason: string): Promise<void>;
  reviewRestriction(ws: string, id: string, rid: string, decision: ReviewDecision, reason?: string): Promise<void>;
  importPreview(ws: string, input: ImportInput): Promise<ImportPreview>;
  importConfirm(ws: string, id: string, consentBasis?: string): Promise<ImportDone>;
  importDiscard(ws: string, id: string): Promise<void>;
  /** Только владелец: step — синхронизировать сейчас (порция), dry — проверка без записи, test — тестовые клиенты (черновик). */
  syncContacts(ws: string, mode: SyncMode): Promise<SyncResult>;
  /** Только владелец: какие поля отдаёт журнал Altegio (только чтение, без персональных данных в ответе). */
  probeAltegio(ws: string): Promise<Report>;
  /** Только владелец: сверка «стопов» по журналу Green-API, проверка и перенос старого списка «стоп» из KV. */
  stopsAction(ws: string, action: StopsAction): Promise<string[]>;
}

export interface DataSource extends CampaignSource, ContactSource {
  readonly mode: "live" | "demo";
  session(): Promise<Session>;
  /** Компании, между которыми может переключаться пользователь (владелец сервиса — все, сотрудник — своя). */
  workspaces(): Promise<WorkspaceOption[]>;
  inbox(ws: string): Promise<InboxSnapshot>;
  /** Сведения о номерах и рассылках. Медленнее списка (сервер спрашивает Meta и Green-API) — грузится вторым. */
  channelReport(ws: string): Promise<ChannelReport>;
  conversation(ws: string, ref: ConversationRef): Promise<ConversationDetail>;
  send(ws: string, ref: ConversationRef, text: string): Promise<ConversationDetail>;
  act(ws: string, ref: ConversationRef, act: ChatAction): Promise<ConversationDetail>;
  /** Просьба выполнена; text — сообщение клиенту (пусто — закрыть без сообщения). */
  complete(ws: string, ref: ConversationRef, leadId: string, text: string): Promise<ConversationDetail>;
  leads(ws: string): Promise<Lead[]>;
  /** Ссылки на страницы, которые пока живут вне пульта (рассылки, паспорт бота, проверка запуска). */
  externalUrl(page: "broadcast" | "studio" | "launch" | "leads" | "logout" | "site", ws: string): string | null;
}

export const dataMode = (): "live" | "demo" =>
  import.meta.env.VITE_PULT_DATA === "demo" || /^\/demo(\/|$)/.test(location.pathname) || new URLSearchParams(location.search).has("demo") ? "demo" : "live";

let current: Promise<DataSource> | null = null;
/** Демо-данные — отдельный файл: в рабочем режиме он не загружается вовсе. */
export function getSource(): Promise<DataSource> {
  current ??= dataMode() === "demo" ? import("./demo").then((m) => m.createDemoSource()) : Promise.resolve(createLiveSource());
  return current;
}
