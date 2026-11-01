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
  MediaKind,
  Message,
  Quote,
  Session,
  Workspace,
  WorkspaceOption,
} from "@/model/types";

/** Вид файла по типу — как его покажет пузырь (сервер решает так же: services/inbox/send.js, fileKind). */
export function fileKindOf(f: { type: string; name: string }): MediaKind {
  const t = (f.type || "").toLowerCase(), n = (f.name || "").toLowerCase();
  if (/^image\/(jpeg|png|webp|gif)$/.test(t) || (!t && /\.(jpe?g|png|webp|gif)$/.test(n))) return "image";
  if (/^video\/(mp4|quicktime|3gpp|webm)$/.test(t) || (!t && /\.(mp4|mov|3gp|webm)$/.test(n))) return "video";
  if (/^audio\//.test(t) || (!t && /\.(mp3|ogg|opus|m4a|aac|wav|amr)$/.test(n))) return "audio";
  return "document";
}

// разделы чатов (ТЗ v2.0 §2.1): нужен ответ, записи и изменения, ответы на рассылки и напоминания, назначено мне, все, готово.
// По умолчанию — «Все» (решение владельца 02.11.2026: «Все» — первая вкладка, «Нужен ответ» — вторая, со счётчиком)
export type Filter = "waiting" | "booking" | "replies" | "mine" | "all" | "done";
const FILTERS: Filter[] = ["waiting", "booking", "replies", "mine", "all", "done"];
const DEFAULT_FILTER: Filter = "all";
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
  /** «Прочитано» общее для сотрудников (переписки в D1): открытый чат пульт отмечает на сервере. */
  reads: boolean;
  /** Замер скорости пульта (Настройки → Диагностика): через сколько мс после сервера пульт показал новое — по видам. */
  speed: Speed;
};
export type SpeedKind = "inbound" | "newChat" | "ticks" | "open" | "poll";
/** away — сколько событий не посчитано: они случились, пока пульт был свёрнут или экран погас (это не задержка пульта) */
export type Speed = { store: "d1" | "kv" | ""; samples: Record<SpeedKind, number[]>; away: number };
const SPEED0 = (): Speed => ({ store: "", samples: { inbound: [], newChat: [], ticks: [], open: [], poll: [] }, away: 0 });

const initial: State = {
  speed: SPEED0(),
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
  filter: DEFAULT_FILTER,
  refreshing: false,
  reads: false,
};

// v2 (02.11.2026): раньше «Нужен ответ» было выбором по умолчанию и запоминалось у всех — с новым порядком начинаем со «Все»
const VIEW_KEY = "pult2.view2";
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
const CHAT_POLL_MS = 5e3; // открытый чат — чаще списка (15 с): store.tickChat
const LIST_POLL_D1_MS = 5e3; // список при переписках в D1: «без изменений» стоит один маленький запрос
const RANK: Record<string, number> = { queued: 0, unknown: 1, sent: 2, delivered: 3, read: 4 }; // как на сервере (services/inbox/status.js)

class Store {
  state: State = initial;
  private subs = new Set<() => void>();
  private src: DataSource | null = null;
  private timer = 0;
  private open: string | null = null;
  private gen = 0; // смена компании отменяет ответы, пришедшие для прежней
  private chatTimer = 0;
  private chatBusy = ""; // открытый чат, который сейчас перечитывает таймер (запросы не наслаиваются)
  private ver = ""; // версия списка (переписки в D1): опрос присылает её, сервер отвечает «без изменений» одним маленьким ответом
  private skew = 0; // насколько часы сервера впереди часов устройства (по «now» в ответах) — для замера скорости
  private opening = new Map<string, number>(); // чат открыли, переписки ещё нет: когда начали (замер «открытие переписки»)
  // замер скорости: с какого времени (часы устройства) пульт на экране без перерыва. Живой замер стенда 01.11.2026 считал и время,
  // пока пульт был свёрнут или экран погас (свёрнутый пульт сервер не опрашивает): галочки «через 39 с» оказались временем на телефоне Б
  private shownAt = typeof document !== "undefined" && document.hidden ? Infinity : Date.now();
  private sampled = new Set<string>(); // одно событие — один замер: опрос списка и опрос чата могут принести одно и то же сообщение
  private chatDue = 0; // когда должен сработать таймер чата: опоздал больше чем на 3 с — устройство усыпляло пульт
  private listDue = 0;

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
      this.shownAt = document.hidden ? Infinity : Date.now();
      if (document.hidden) return;
      this.poll();
      this.tickChat();
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
    for (const k of [...this.pending.keys()]) this.forgetFile(k); // неотправленные файлы прежней компании
    this.set({ wsId: id, phase: "loading", workspace: null, conversations: [], details: {}, outbox: {}, report: null, reportError: undefined, showOut: false, outOnly: 0, operators: [], filter: v && FILTERS.includes(v.filter) ? v.filter : DEFAULT_FILTER, scope: v?.scope || { kind: "all" }, reads: false });
    // адрес с ?c= — как у рабочего пульта (/inbox?c=…): ссылку можно открыть заново и переслать коллеге
    const u = new URL(location.href);
    if (u.searchParams.get("c") !== id) {
      u.searchParams.set("c", id);
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    }
    this.ver = "";
    try {
      const snap = await this.src.inbox(id);
      if (g !== this.gen) return;
      if (!snap) throw new Error("Список чатов не загрузился. Обновите страницу.");
      this.applySnapshot(snap, true);
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

  private applySnapshot(snap: InboxSnapshot, first = false) {
    this.ver = snap.ver || "";
    if (snap.now) this.skew = snap.now - Date.now();
    // замер: новый чат с сообщением клиента появился в списке — через сколько после того, как сервер его записал
    if (!first && this.state.conversations.length) {
      const had = new Set(this.state.conversations.map((c) => c.key));
      for (const c of snap.conversations) if (!had.has(c.key) && c.lastInboundAt) this.sample("newChat", this.srvNow() - c.lastInboundAt, c.key + "|" + c.lastInboundAt);
    }
    if (first || this.state.speed.store !== (snap.ver ? "d1" : "kv")) this.set({ speed: { ...this.state.speed, store: snap.ver ? "d1" : "kv" } });
    const report = this.state.report;
    const workspace = { ...snap.workspace, channels: mergeChannels(snap.workspace.channels, report?.channels) };
    // показанные по кнопке чаты только с нашими сообщениями не пропадают при обновлении списка
    const keep = this.state.showOut ? this.state.conversations.filter((c) => !c.inbound && !snap.conversations.some((x) => x.key === c.key)) : [];
    this.set({ workspace, conversations: this.rowStatus(keep.length ? [...snap.conversations, ...keep] : snap.conversations), truncated: snap.truncated, outOnly: snap.outOnly || 0, operators: snap.operators || [], scope: validScope(workspace, this.state.scope), reads: !!snap.reads });
    if (this.open) this.readMark(this.open);
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

  // список: раз в 15 с; переписки в D1 — раз в 5 с (сервер отвечает «без изменений» маленьким ответом, без всего списка)
  private schedule() {
    clearTimeout(this.timer);
    const ms = this.ver ? LIST_POLL_D1_MS : 15e3;
    this.listDue = Date.now() + ms;
    this.timer = window.setTimeout(() => this.poll(), ms);
  }

  /** Обновить список и открытый чат. Вызывается по таймеру, при возврате во вкладку и кнопкой «Обновить». */
  async poll(manual = false) {
    clearTimeout(this.timer);
    if (!manual) this.woke(this.listDue);
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
      const snap = await this.src.inbox(ws, manual ? undefined : this.ver || undefined);
      if (g !== this.gen) return;
      if (!snap) { // переписки в D1: с прошлого опроса ничего не изменилось
        if (this.state.offline || this.state.phase !== "ready") this.set({ offline: false, phase: "ready" });
        return;
      }
      const before = this.open ? this.state.conversations.find((c) => c.key === this.open)?.lastAt : undefined;
      this.applySnapshot(snap);
      this.set({ offline: false, phase: "ready" });
      const row = this.open ? snap.conversations.find((c) => c.key === this.open) : undefined;
      if (this.open && (manual || row?.lastAt !== before)) this.loadConversation(this.open, true);
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

  /** Открытый чат перечитываем сами каждые 5 с, не дожидаясь, пока изменится список (как рабочий пульт /inbox — раз в 3 с). Живая
   *  проверка на стенде 01.11.2026: входящие и галочки появлялись в пульте через минуту-две, часто только после обновления страницы,
   *  а в WhatsApp — сразу. Вебхуки Green-API пишет одна точка сети Cloudflare, пульт читает другая: список ключей KV там отстаёт до 60 с,
   *  чтение переписки — до 30 с (сервер читает её с наименьшим сроком). Опрос перезагружал чат, только когда в списке менялось время,
   *  а получив старую копию, больше его не трогал. Свёрнутая вкладка чат не перечитывает. */
  private scheduleChat() {
    clearTimeout(this.chatTimer);
    if (this.open) { this.chatDue = Date.now() + CHAT_POLL_MS; this.chatTimer = window.setTimeout(() => this.tickChat(), CHAT_POLL_MS); }
  }
  private async tickChat() {
    clearTimeout(this.chatTimer);
    this.woke(this.chatDue);
    const key = this.open;
    if (key && !document.hidden && this.state.phase === "ready" && this.chatBusy !== key) {
      this.chatBusy = key;
      try {
        await this.loadConversation(key, true);
      } finally {
        if (this.chatBusy === key) this.chatBusy = "";
      }
    }
    this.scheduleChat();
  }

  // ---- замер скорости (Настройки → Диагностика): только на этом устройстве, никуда не отправляется
  private srvNow() {
    return Date.now() + this.skew;
  }
  /** таймер сработал позже, чем должен, больше чем на 3 с: устройство усыпляло пульт (экран погас, другое приложение), а события
   *  «свёрнут» могло и не быть — замер считает пульт на экране только с этого момента @param due когда таймер должен был сработать */
  private woke(due: number) {
    if (due && Date.now() - due > 3e3) this.shownAt = Math.max(this.shownAt === Infinity ? 0 : this.shownAt, Date.now());
  }
  /** @param key событие (сообщение, галочка, чат): засчитывается один раз */
  private sample(kind: SpeedKind, ms: number, key = "") {
    if (!(ms >= 0) || ms > 30 * 60e3) return; // старое сообщение (открыли чат позже) — не задержка пульта
    if (key) {
      if (this.sampled.has(kind + "\u0000" + key)) return;
      if (this.sampled.size > 3000) this.sampled.clear();
      this.sampled.add(kind + "\u0000" + key);
    }
    // событие случилось, пока пульт был свёрнут или экран погас: показать его раньше пульт не мог — это не задержка, не считаем
    if (kind !== "open" && kind !== "poll" && Date.now() - ms < this.shownAt) {
      this.set({ speed: { ...this.state.speed, away: this.state.speed.away + 1 } });
      return;
    }
    const all = this.state.speed.samples, list = [...all[kind], Math.round(ms)].slice(-20);
    this.set({ speed: { ...this.state.speed, samples: { ...all, [kind]: list } } });
  }
  /** новое входящее в открытом чате и новые галочки — через сколько после записи на сервере пульт их показал */
  private measure(prev: ConversationDetail, data: ConversationDetail) {
    const old = new Map(prev.messages.map((m) => [m.mid || `${m.at}|${m.text}`, m]));
    for (const m of data.messages) {
      const k = m.mid || `${m.at}|${m.text}`, was = old.get(k);
      if (!was) { if (m.from === "contact") this.sample("inbound", this.srvNow() - m.at, k); continue; }
      if (m.from !== "contact" && m.status && m.statusAt && (RANK[m.status] ?? -1) > (RANK[was.status ?? ""] ?? -1) && (m.status === "delivered" || m.status === "read")) this.sample("ticks", this.srvNow() - m.statusAt, k + "|" + m.status);
    }
  }
  resetSpeed() {
    this.sampled.clear();
    this.set({ speed: { ...SPEED0(), store: this.state.speed.store } });
  }

  /** Галочки в строке открытого чата — не меньше, чем у последнего сообщения в самой переписке: список отстаёт сильнее (до 60 с). */
  private rowStatus(rows: ConversationSummary[]) {
    const key = this.open, last = key ? this.state.details[key]?.data?.messages.at(-1) : undefined;
    const st = last && last.from !== "contact" ? last.status : undefined;
    if (!key || !st) return rows;
    let changed = false;
    const out = rows.map((c) => {
      if (c.key !== key || c.previewFrom === "contact" || (RANK[st] ?? -1) <= (RANK[c.lastStatus ?? ""] ?? -1)) return c;
      changed = true;
      return { ...c, lastStatus: st };
    });
    return changed ? out : rows;
  }

  setOpen(key: string | null) {
    this.open = key;
    if (key) {
      const d = this.state.details[key];
      if (!d?.data) this.opening.set(key, performance.now());
      if (!d?.data || Date.now() - (d.at || 0) > 5e3) this.loadConversation(key, !!d?.data);
      // открытый чат прочитан: «новое» снимается (и у других сотрудников — readMark), «Ждёт ответа» остаётся до ответа или «Готово»
      const c = this.state.conversations.find((x) => x.key === key);
      if (c && (c.unread || c.unreadCount)) this.set({ conversations: this.state.conversations.map((x) => (x.key === key ? { ...x, unread: false, unreadCount: 0 } : x)) });
      this.readMark(key);
    }
    this.scheduleChat();
  }

  private reading = new Set<string>(); // чаты, о прочтении которых пульт сейчас сообщает серверу: запросы не наслаиваются
  /** Сотрудник видит открытый чат: сообщить серверу, до какого сообщения клиента прочитано (только переписки в D1 — там это общее
   *  для всех сотрудников; без D1 прочитанное помнит это устройство). Свёрнутый пульт ничего не читает. */
  private readMark(key: string) {
    const ws = this.state.wsId, ref = parseKey(key), src = this.src;
    if (!src?.markRead || !ws || !ref || !this.state.reads || this.open !== key || document.hidden || this.reading.has(key)) return;
    const c = this.state.conversations.find((x) => x.key === key), msgs = this.state.details[key]?.data?.messages || [];
    const at = Math.max(c?.lastInboundAt || 0, ...msgs.filter((m) => m.from === "contact").map((m) => m.at || 0));
    if (!at || (c?.readAt || 0) >= at) return;
    this.reading.add(key);
    const g = this.gen;
    src
      .markRead(ws, ref, at)
      .then((rd) => {
        if (g !== this.gen) return;
        this.set({ conversations: this.state.conversations.map((x) => (x.key === key ? { ...x, readAt: Math.max(x.readAt || 0, rd || at), unread: false, unreadCount: 0 } : x)) });
      })
      .catch(() => {}) // не вышло — «новое» останется у других сотрудников до следующего открытия; здесь оно уже снято
      .finally(() => this.reading.delete(key));
  }

  async loadConversation(key: string, quiet = false) {
    const ws = this.state.wsId, ref = parseKey(key);
    if (!this.src || !ws || !ref) return;
    const g = this.gen;
    if (!quiet) this.setDetail(key, { loading: true, error: undefined });
    const prev = this.state.details[key]?.data;
    try {
      // опрос открытого чата с ревизией (переписки в D1): «без изменений» — переписку не перерисовываем
      const t1 = performance.now(), shown = this.shownAt;
      const data = await this.src.conversation(ws, ref, quiet && prev?.rev ? prev.rev : undefined);
      if (g !== this.gen) return;
      // сколько идёт проверка открытого чата (запрос к серверу и база): пульт всё это время был на экране
      if (quiet && shown === this.shownAt && shown !== Infinity && !document.hidden) this.sample("poll", performance.now() - t1);
      if (!data) { const d = this.state.details[key]; if (d) d.at = Date.now(); return; }
      const t0 = this.opening.get(key);
      if (t0 !== undefined) { this.opening.delete(key); this.sample("open", performance.now() - t0); }
      if (prev) this.measure(prev, data);
      this.setDetail(key, { data, loading: false, error: undefined, at: Date.now() });
      const rows = this.rowStatus(this.state.conversations);
      if (rows !== this.state.conversations) this.set({ conversations: rows });
      if (this.open === key) this.readMark(key); // новое сообщение клиента в открытом чате — тоже прочитано
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

  /** Отправка: сообщение сразу в ленте; не ушло — остаётся с пометкой и кнопкой «Повторить». id сообщения — он же rid для сервера:
   *  «Повторить» после обрыва связи шлёт тот же rid, и сервер второй раз клиенту не отправит. quote — ответ на сообщение. */
  async send(key: string, text: string, retryId?: string, quote?: Quote) {
    const ws = this.state.wsId, ref = parseKey(key);
    if (!this.src || !ws || !ref) return;
    // id — он же rid: время и случайная часть (два сотрудника в одну миллисекунду не должны получить один номер отправки)
    // тот же текст в этом чате после неудачи (обрыв, «уже отправляется», база не ответила) — тот же номер отправки, даже если его набрали
    // заново, а не нажали «Повторить»: сервер второй раз клиенту не отправит (ревью PR №2, F4, 01.11.2026)
    const prev = retryId ? undefined : (this.state.outbox[key] || []).find((x) => x.delivery === "failed" && !x.hasFile && x.text === text);
    const id = retryId || prev?.id || `out-${Math.floor(Date.now()).toString(36)}-${Math.random().toString(36).slice(2, 8)}`; // только буквы, цифры и «-»: такой rid принимает сервер
    const was = (this.state.outbox[key] || []).find((x) => x.id === id);
    const q = quote || was?.quote;
    const m: Message = { id, from: "operator", text, at: Date.now(), delivery: "sending", ...(q ? { quote: q } : {}) };
    this.setOutbox(key, (box) => [...box.filter((x) => x.id !== id), m]);
    try {
      const data = await this.src.send(ws, ref, text, { rid: id, ...(q ? { quote: q.mid } : {}) });
      this.setOutbox(key, (box) => box.filter((x) => x.id !== id));
      this.applyDetail(key, data);
      return { ok: true as const, warning: data.warning };
    } catch (e) {
      return this.failOutgoing(key, id, e);
    }
  }

  /** Файлы — по одному, по очереди: каждый сразу в ленте своим пузырём со своим состоянием («отправляется», ушло, не ушло).
   *  Подпись — у одного файла, цитата — у первого. Вернёт предупреждения сервера (например, «не знаем, ушло ли»). */
  async sendFiles(key: string, files: File[], caption: string, quote?: Quote, voice?: { dur: number }) {
    const ws = this.state.wsId, ref = parseKey(key);
    if (!this.src?.sendFile || !ws || !ref || !files.length) return [];
    const now = Date.now(), seed = Math.random().toString(36).slice(2, 8);
    // голосовое — один файл с отметкой voice: в переписке у него плеер, на сервере — отметка голосового (02.11.2026)
    const items = files.map((file, i) => ({ id: `file-${Math.floor(now).toString(36)}-${seed}-${i}`, file, caption: files.length === 1 ? caption : "", quote: i === 0 ? quote : undefined, ...(voice && files.length === 1 ? { voice } : {}) }));
    for (const it of items) this.pending.set(it.id, it);
    this.setOutbox(key, (box) => [...box, ...items.map((it) => this.fileMessage(it, now))]);
    const warnings: string[] = [];
    for (const it of items) {
      const r = await this.uploadOne(key, it.id);
      if (r?.ok && r.warning) warnings.push(r.warning);
    }
    return [...new Set(warnings)];
  }
  /** «Повторить» у файла, который не ушёл: тот же rid — если первый раз файл всё-таки дошёл, сервер второй раз не отправит. */
  async retryFile(key: string, id: string) {
    const r = await this.uploadOne(key, id);
    return r?.ok && r.warning ? [r.warning] : [];
  }
  private pending = new Map<string, { id: string; file: File; caption: string; quote?: Quote; url?: string; voice?: { dur: number } }>();
  private fileMessage(it: { id: string; file: File; caption: string; quote?: Quote; url?: string; voice?: { dur: number } }, at: number): Message {
    const kind = fileKindOf(it.file);
    // фото, видео и голосовое видно и слышно сразу, до ответа сервера: ссылка на файл в этом браузере (освобождается, когда пузырь уходит)
    if (!it.url && (kind === "image" || kind === "video" || kind === "audio")) it.url = URL.createObjectURL(it.file);
    return { id: it.id, from: "operator", text: it.caption, at, delivery: "sending", hasFile: true, ...(it.quote ? { quote: it.quote } : {}),
      media: { kind, name: it.file.name, mime: it.file.type, size: it.file.size, ...(it.url ? { url: it.url } : {}), ...(it.voice ? { voice: true, dur: it.voice.dur } : {}) } };
  }
  private async uploadOne(key: string, id: string) {
    const ws = this.state.wsId, ref = parseKey(key), it = this.pending.get(id);
    if (!this.src?.sendFile || !ws || !ref || !it) return null;
    this.setOutbox(key, (box) => box.map((x) => (x.id === id ? { ...x, delivery: "sending" as const, error: undefined } : x)));
    try {
      const data = await this.src.sendFile(ws, ref, it.file, { rid: id, caption: it.caption, ...(it.quote ? { quote: it.quote.mid } : {}), ...(it.voice ? { voice: true, dur: it.voice.dur } : {}) });
      this.forgetFile(id);
      this.setOutbox(key, (box) => box.filter((x) => x.id !== id));
      this.applyDetail(key, data);
      return { ok: true as const, warning: data.warning };
    } catch (e) {
      return this.failOutgoing(key, id, e);
    }
  }
  private forgetFile(id: string) {
    const it = this.pending.get(id);
    if (it?.url) setTimeout(() => URL.revokeObjectURL(it.url!), 30e3); // картинка ещё может показываться, пока грузится файл с сервера
    this.pending.delete(id);
  }
  private failOutgoing(key: string, id: string, e: unknown) {
    const error = errText(e);
    this.setOutbox(key, (box) => box.map((x) => (x.id === id ? { ...x, delivery: "failed" as const, error } : x)));
    if (e instanceof ApiError && e.offline) this.set({ offline: true });
    return { ok: false as const, error };
  }
  private setOutbox(key: string, f: (box: Message[]) => Message[]) {
    this.set({ outbox: { ...this.state.outbox, [key]: f(this.state.outbox[key] || []) } });
  }
  dropOutgoing(key: string, id: string) {
    this.forgetFile(id);
    this.setOutbox(key, (box) => box.filter((x) => x.id !== id));
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
  private removing = new Set<string>(); // сообщения, которые сейчас скрываются или удаляются: второе нажатие ничего не отправляет
  /** «Удалить у меня» (скрыть в пульте), «Вернуть» и «Удалить у всех» (только наше сообщение второго номера; сервер удаляет один
   *  раз на все устройства). → null — сделано; warn — сделано, но с оговоркой (неизвестно, удалилось ли у клиента); error — нет. */
  async messageAct(key: string, m: Message, act: "hide" | "unhide" | "delete"): Promise<null | { warn: string } | { error: string }> {
    const ws = this.state.wsId, ref = parseKey(key);
    if (!this.src || !ws || !ref) return { error: "Чат не найден." };
    const id = `${key}|${m.mid || m.at}`;
    if (this.removing.has(id)) return null;
    this.removing.add(id);
    try {
      const sel: ChatActionExtra = m.mid ? { mid: m.mid } : { at: m.at, r: m.from === "contact" ? "u" : m.from === "operator" ? "a" : "b" };
      const d = await this.src.act(ws, ref, act, sel);
      this.applyDetail(key, d);
      return d.warning ? { warn: d.warning } : null;
    } catch (e) {
      return { error: errText(e) };
    } finally {
      this.removing.delete(id);
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
