// Состояние пульта: какая компания открыта, список чатов, открытые переписки, неотправленные сообщения.
// Обновление — опросом, как в рабочем пульте (раз в 15 с; свёрнутая вкладка не опрашивает). Realtime — фаза 2–4 REFACTORING.md.
import { useSyncExternalStore } from "react";
import { getSource, type DataSource } from "@/data/source";
import { notifyState, notifyWaiting, resetNotify } from "@/lib/notify";
import { navigate } from "@/lib/router";
import { ApiError } from "@/data/errors";
import { mergeChannels, validScope, type Scope } from "@/model/channels";
import type {
  ChannelReport,
  ChatAction,
  ChatActionExtra,
  ConversationDetail,
  ConversationRef,
  ConversationSummary,
  InboxSnapshot,
  Message,
  Session,
  Workspace,
  WorkspaceOption,
} from "@/model/types";

// разделы чатов (ТЗ v2.0 §2.1): нужен ответ, записи и изменения, ответы на рассылки и напоминания, назначено мне, все, готово
export type Filter = "waiting" | "booking" | "replies" | "mine" | "all" | "done";
const FILTERS: Filter[] = ["waiting", "booking", "replies", "mine", "all", "done"];
/** Итог действия в чате: ошибка, вопрос перед действием (например, «клиент ждёт ответа — закрыть?») или null — сделано. */
export type ActResult = null | { error: string } | { confirm: string };
export type DetailState = { data?: ConversationDetail; loading: boolean; error?: string; at?: number };

export type State = {
  phase: "boot" | "loading" | "ready" | "pick" | "error";
  mode: "live" | "demo" | null;
  error?: string;
  offline: boolean;
  session: Session | null;
  workspaces: WorkspaceOption[];
  wsId: string | null;
  workspace: Workspace | null;
  conversations: ConversationSummary[];
  truncated: InboxSnapshot["truncated"];
  /** Чаты только с нашими сообщениями: сколько и показаны ли. */
  outOnly: number;
  showOut: boolean;
  /** Имена сотрудников для «Назначить». */
  operators: string[];
  report: ChannelReport | null;
  reportError?: string;
  details: Record<string, DetailState>;
  /** Сообщения, которые пульт отправляет или не смог отправить, — по чатам. */
  outbox: Record<string, Message[]>;
  scope: Scope;
  filter: Filter;
  refreshing: boolean;
};

const initial: State = {
  phase: "boot",
  mode: null,
  offline: false,
  session: null,
  workspaces: [],
  wsId: null,
  workspace: null,
  conversations: [],
  truncated: null,
  outOnly: 0,
  showOut: false,
  operators: [],
  report: null,
  details: {},
  outbox: {},
  scope: { kind: "all" },
  filter: "waiting",
  refreshing: false,
};

const VIEW_KEY = "pult2.view";
type SavedView = { scope: Scope; filter: Filter };
function savedView(ws: string): SavedView | null {
  try {
    const all = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}") as Record<string, SavedView>;
    return all[ws] || null;
  } catch {
    return null;
  }
}
function saveView(ws: string, v: SavedView) {
  try {
    const all = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}") as Record<string, SavedView>;
    all[ws] = v;
    localStorage.setItem(VIEW_KEY, JSON.stringify(all));
  } catch {
    /* частный режим — выбор живёт до перезагрузки */
  }
}

export const refKey = (r: ConversationRef) => `${r.channelId}:${r.externalId}`;
export function parseKey(key: string): ConversationRef | null {
  const i = key.indexOf(":");
  return i > 0 ? { channelId: key.slice(0, i), externalId: key.slice(i + 1) } : null;
}
const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Что-то пошло не так. Обновите страницу.");

class Store {
  state: State = initial;
  private subs = new Set<() => void>();
  private src: DataSource | null = null;
  private timer = 0;
  private open: string | null = null;
  private gen = 0; // смена компании отменяет ответы, пришедшие для прежней

  subscribe = (f: () => void) => {
    this.subs.add(f);
    return () => this.subs.delete(f);
  };
  get = () => this.state;
  private set(p: Partial<State>) {
    this.state = { ...this.state, ...p };
    this.subs.forEach((f) => f());
  }
  private setDetail(key: string, d: Partial<DetailState>) {
    this.set({ details: { ...this.state.details, [key]: { ...{ loading: false }, ...this.state.details[key], ...d } } });
  }

  get source() {
    return this.src;
  }

  private booted = false;
  async boot() {
    if (this.booted) return; // StrictMode в разработке вызывает запуск дважды
    this.booted = true;
    this.src = await getSource();
    this.set({ mode: this.src.mode, phase: "loading" });
    try {
      const session = await this.src.session();
      this.set({ session });
      // владелец сервиса видит все компании; список нужен для переключателя (и для выбора, если компания не указана)
      const list = session.role === "owner" ? this.src.workspaces().catch(() => [] as WorkspaceOption[]) : Promise.resolve([] as WorkspaceOption[]);
      if (!session.workspaceId) {
        this.set({ workspaces: await list, phase: "pick" });
        return;
      }
      list.then((workspaces) => this.set({ workspaces }));
      await this.selectWorkspace(session.workspaceId);
    } catch (e) {
      this.set({ phase: "error", error: errText(e), offline: e instanceof ApiError && e.offline });
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.poll();
    });
    window.addEventListener("online", () => this.poll());
    window.addEventListener("offline", () => this.set({ offline: true }));
  }

  async selectWorkspace(id: string) {
    if (!this.src) return;
    const g = ++this.gen;
    const v = savedView(id);
    // смена компании: открытый чат принадлежал прежней — к списку. При запуске открытый по ссылке чат остаётся
    if (this.state.wsId && this.state.wsId !== id) {
      this.open = null;
      navigate({ name: "inbox" }, { replace: true });
    }
    resetNotify();
    this.set({ wsId: id, phase: "loading", workspace: null, conversations: [], details: {}, outbox: {}, report: null, reportError: undefined, showOut: false, outOnly: 0, operators: [], filter: v && FILTERS.includes(v.filter) ? v.filter : "waiting", scope: v?.scope || { kind: "all" } });
    // адрес с ?c= — как у рабочего пульта (/inbox?c=…): ссылку можно открыть заново и переслать коллеге
    const u = new URL(location.href);
    if (u.searchParams.get("c") !== id) {
      u.searchParams.set("c", id);
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    }
    try {
      const snap = await this.src.inbox(id);
      if (g !== this.gen) return;
      this.applySnapshot(snap);
      this.set({ phase: "ready", offline: false });
    } catch (e) {
      if (g !== this.gen) return;
      this.set({ phase: "error", error: errText(e), offline: e instanceof ApiError && e.offline });
      return;
    }
    if (this.open) this.setOpen(this.open);
    this.loadReport(g);
    this.schedule();
  }

  private applySnapshot(snap: InboxSnapshot) {
    const report = this.state.report;
    const workspace = { ...snap.workspace, channels: mergeChannels(snap.workspace.channels, report?.channels) };
    // показанные по кнопке чаты только с нашими сообщениями не пропадают при обновлении списка
    const keep = this.state.showOut ? this.state.conversations.filter((c) => !c.inbound && !snap.conversations.some((x) => x.key === c.key)) : [];
    this.set({ workspace, conversations: keep.length ? [...snap.conversations, ...keep] : snap.conversations, truncated: snap.truncated, outOnly: snap.outOnly || 0, operators: snap.operators || [], scope: validScope(workspace, this.state.scope) });
    if (this.state.mode === "live") notifyWaiting(snap.conversations, this.open, (key) => navigate({ name: "inbox", conv: key }));
  }

  private async loadReport(g: number) {
    if (!this.src || !this.state.wsId) return;
    try {
      const report = await this.src.channelReport(this.state.wsId);
      if (g !== this.gen) return;
      const ws = this.state.workspace;
      this.set({ report, reportError: undefined, workspace: ws ? { ...ws, channels: mergeChannels(ws.channels, report.channels) } : ws });
    } catch (e) {
      if (g !== this.gen) return;
      this.set({ reportError: errText(e) });
    }
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.poll(), 15e3);
  }

  /** Обновить список и открытый чат. Вызывается по таймеру, при возврате во вкладку и кнопкой «Обновить». */
  async poll(manual = false) {
    clearTimeout(this.timer);
    const ws = this.state.wsId;
    if (!this.src || !ws || this.state.phase === "pick") return;
    // свёрнутая вкладка не опрашивает сервер — кроме случая, когда включены уведомления: ради них опрашиваем список
    if (document.hidden && !manual && notifyState() !== "on") {
      this.schedule();
      return;
    }
    const g = this.gen;
    if (manual) this.set({ refreshing: true });
    try {
      const snap = await this.src.inbox(ws);
      if (g !== this.gen) return;
      const before = this.open ? this.state.conversations.find((c) => c.key === this.open)?.lastAt : undefined;
      this.applySnapshot(snap);
      this.set({ offline: false, phase: "ready" });
      const after = this.open ? snap.conversations.find((c) => c.key === this.open)?.lastAt : undefined;
      if (this.open && (manual || after !== before)) this.loadConversation(this.open, true);
      if (manual) this.loadReport(g);
    } catch (e) {
      if (g !== this.gen) return;
      if (e instanceof ApiError && e.offline) this.set({ offline: true });
      else if (manual) this.set({ reportError: errText(e) });
    } finally {
      if (manual) this.set({ refreshing: false });
      this.schedule();
    }
  }

  setOpen(key: string | null) {
    this.open = key;
    if (key) {
      const d = this.state.details[key];
      if (!d?.data || Date.now() - (d.at || 0) > 5e3) this.loadConversation(key, !!d?.data);
      // открытый чат прочитан
      const c = this.state.conversations.find((x) => x.key === key);
      if (c && (c.unread || c.unreadCount)) this.set({ conversations: this.state.conversations.map((x) => (x.key === key ? { ...x, unread: false, unreadCount: 0 } : x)) });
    }
  }

  async loadConversation(key: string, quiet = false) {
    const ws = this.state.wsId, ref = parseKey(key);
    if (!this.src || !ws || !ref) return;
    const g = this.gen;
    if (!quiet) this.setDetail(key, { loading: true, error: undefined });
    try {
      const data = await this.src.conversation(ws, ref);
      if (g !== this.gen) return;
      this.setDetail(key, { data, loading: false, error: undefined, at: Date.now() });
    } catch (e) {
      if (g !== this.gen) return;
      if (e instanceof ApiError && e.offline) this.set({ offline: true });
      this.setDetail(key, { loading: false, error: errText(e) });
    }
  }

  private applyDetail(key: string, data: ConversationDetail) {
    this.setDetail(key, { data, loading: false, error: undefined, at: Date.now() });
    // строка списка — сразу по свежей переписке, не дожидаясь опроса
    const last = data.messages.at(-1);
    this.set({
      conversations: this.state.conversations.map((c) =>
        c.key === key
          ? { ...c, attention: data.attention, bot: data.bot, assignee: data.assignee, done: data.done, lastStatus: last && last.from !== "contact" ? last.status : undefined, preview: last ? (last.media && /^\[[^\]]{1,60}\]$/.test(last.text.trim()) ? c.preview : last.text) : c.preview, previewFrom: last?.from ?? c.previewFrom, lastAt: Math.max(c.lastAt, last?.at || 0), unread: false, unreadCount: 0 }
          : c,
      ),
    });
  }

  /** Отправка: сообщение сразу в ленте; не ушло — остаётся с пометкой и кнопкой «Повторить». */
  async send(key: string, text: string, retryId?: string) {
    const ws = this.state.wsId, ref = parseKey(key);
    if (!this.src || !ws || !ref) return;
    const id = retryId || `out-${Date.now()}`;
    const m: Message = { id, from: "operator", text, at: Date.now(), delivery: "sending" };
    const box = (this.state.outbox[key] || []).filter((x) => x.id !== id);
    this.set({ outbox: { ...this.state.outbox, [key]: [...box, m] } });
    try {
      const data = await this.src.send(ws, ref, text);
      this.set({ outbox: { ...this.state.outbox, [key]: (this.state.outbox[key] || []).filter((x) => x.id !== id) } });
      this.applyDetail(key, data);
      return { ok: true as const, warning: data.warning };
    } catch (e) {
      const error = errText(e);
      this.set({ outbox: { ...this.state.outbox, [key]: (this.state.outbox[key] || []).map((x) => (x.id === id ? { ...x, delivery: "failed" as const, error } : x)) } });
      if (e instanceof ApiError && e.offline) this.set({ offline: true });
      return { ok: false as const, error };
    }
  }
  dropOutgoing(key: string, id: string) {
    this.set({ outbox: { ...this.state.outbox, [key]: (this.state.outbox[key] || []).filter((x) => x.id !== id) } });
  }

  async act(key: string, act: ChatAction, extra?: ChatActionExtra): Promise<ActResult> {
    const ws = this.state.wsId, ref = parseKey(key);
    if (!this.src || !ws || !ref) return { error: "Чат не найден." };
    try {
      this.applyDetail(key, await this.src.act(ws, ref, act, extra));
      return null;
    } catch (e) {
      if (e instanceof ApiError && e.confirm) return { confirm: e.confirm };
      return { error: errText(e) };
    }
  }
  /** GET к API пульта текущей компании (свободное время Altegio). В демо — «недоступно». */
  async inboxApi<T>(path: string): Promise<T> {
    const ws = this.state.wsId;
    if (this.state.mode !== "live" || !ws) return { available: false, why: "В демо свободное время не показывается." } as T;
    const { call } = await import("@/data/live");
    return call<T>(path + (path.includes("?") ? "&" : "?") + "c=" + encodeURIComponent(ws));
  }
  /** Ближайшие записи клиента в Altegio — для карточки чата. */
  async bookingCard(key: string) {
    const ws = this.state.wsId, ref = parseKey(key);
    if (!this.src?.bookingCard || !ws || !ref) return { available: false, records: [] };
    return this.src.bookingCard(ws, ref);
  }
  /** Чаты только с нашими сообщениями — по кнопке под списком «Все». */
  async loadOutbound() {
    const ws = this.state.wsId;
    if (!this.src?.outboundOnly || !ws) return;
    try {
      const extra = await this.src.outboundOnly(ws);
      const have = new Set(this.state.conversations.map((c) => c.key));
      this.set({ showOut: true, outOnly: 0, conversations: [...this.state.conversations, ...extra.filter((c) => !have.has(c.key))] });
    } catch (e) {
      this.set({ reportError: errText(e) });
    }
  }

  async complete(key: string, leadId: string, text: string): Promise<string | null> {
    const ws = this.state.wsId, ref = parseKey(key);
    if (!this.src || !ws || !ref) return "Чат не найден.";
    try {
      this.applyDetail(key, await this.src.complete(ws, ref, leadId, text));
      return null;
    } catch (e) {
      return errText(e);
    }
  }

  setScope(scope: Scope) {
    this.set({ scope });
    if (this.state.wsId) saveView(this.state.wsId, { scope, filter: this.state.filter });
  }
  setFilter(filter: Filter) {
    this.set({ filter });
    if (this.state.wsId) saveView(this.state.wsId, { scope: this.state.scope, filter });
  }
}

export const store = new Store();
export function useStore<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => pick(store.state));
}
