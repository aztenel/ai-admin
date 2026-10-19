// Откуда пульт берёт данные. Два источника с одним интерфейсом:
//   live — настоящий API бота (/api/inbox/*, /api/bc/list, /api/studio/list), см. data/live.ts;
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
import { createLiveSource } from "./live";

export { ApiError } from "./errors";

export interface DataSource {
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
