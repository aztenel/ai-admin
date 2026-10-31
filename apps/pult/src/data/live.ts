// Настоящий API бота. Формы ответов — как их сейчас отдаёт сервер (src/controllers/inbox.js, broadcast.js, studio.js);
// здесь они переводятся в понятия пульта (model/types.ts). Права и арендатор проверяет сервер: параметр c= — только выбор
// среди разрешённых пользователю компаний (CLAUDE.md §5.3, п. 4), пульт ничего не решает сам.
import type {
  BookingCard,
  BotState,
  Campaign,
  ChatActionExtra,
  DeliveryStatus,
  Topic,
  Channel,
  ChannelReport,
  ChatAction,
  ChatRequest,
  ConversationDetail,
  ConversationRef,
  ConversationSummary,
  InboxSnapshot,
  Lead,
  MediaKind,
  Message,
  ReplyState,
  RequestKind,
  Session,
  Workspace,
  WorkspaceOption,
} from "@/model/types";
import { channelKind } from "@/model/channels";
import { ApiError } from "./errors";
import type { CampaignSource, ContactSource, DataSource } from "./source";
import { readMarks } from "./read-marks";
import { getOperator } from "@/lib/operator";

// ---------- ответы сервера ----------
type ChRaw = "wa" | "ga" | "web";
type ListRowRaw = { ch: ChRaw; id: string; t: number; li: number; s: string; d: "" | "u" | "a" | "b"; nm: string; ph: string; nd: string; pu: number; st: 0 | 1; bk: number; tp?: string; rs?: string; as?: string; dn?: 1; ls?: string };
type ListRaw = { client: { id: string; name: string; off: boolean }; need: number; total: number; more: boolean; chats: ListRowRaw[]; now: number; lines?: Record<string, { label: string; phone?: string }>; ops?: string[]; outOnly?: number };
type TurnRaw = { r: "u" | "a" | "b"; x: string; t: number; m?: { k?: string; id: string; f: boolean; name?: string; size?: number; mime?: string }; op?: string; st?: string; se?: string; auto?: "service" | "campaign"; ed?: 1; del?: 1; re?: string };
type ReqRaw = { id: string; kind: string; name: string; service: string; time: string; note: string; at: string };
type ChatRaw = {
  promo: { at: number; name: string; text: string } | null;
  ch: ChRaw; id: string; phone: string; name: string; waName: string; turns: TurnRaw[];
  bookings: string[]; pend: string[]; booked: string;
  need: { why: string; text: string; at: number; tp?: string; src?: { k: "rm" | "bc"; at: number; text: string } } | null; paused: number; stop: boolean; off: boolean;
  assignee?: string; done?: number; line?: { ch: string; label: string }; audit?: { t: number; w: string; a: string; to?: string }[];
  canSend: boolean; open: boolean; li: number; reqs: ReqRaw[]; now: number; pay?: string;
};
type LeadRaw = { id: string; name: string; phone: string; service: string; time: string; note: string; status: string; kind: string; source: string; ts: number };
type StudioClientRaw = { id: string; name: string; kind: string; niche: string; off: boolean; booking: string };
type BcRaw = {
  client: { id: string; name: string }; owner: boolean; ready: boolean; why: string; stops: number;
  health: { phone?: string; name?: string; quality?: string; limit?: number; error?: string } | null;
  ga: { ready: boolean; state: string; phone: string; hook: boolean; why: string; warn: string } | null;
  list: { id: string; name: string; status: string; total: number; sent: number; failed: number; created: number; ch?: string }[];
};

// ---------- запросы ----------
export const enc = encodeURIComponent;
/** Запрос к API бота. Ошибка — ApiError с текстом сервера; список ошибок формы (`errors`) и вопрос (`confirm`) — в её полях. */
export async function call<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, body ? { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin" });
  } catch {
    throw new ApiError("Нет связи с сервером. Проверьте интернет — действие не выполнено.", 0, true);
  }
  if (r.status === 401) {
    // вход истёк: на страницу входа, затем обратно сюда (сервер принимает только свои адреса)
    location.href = "/login?next=" + enc(location.pathname + location.search + location.hash);
    throw new ApiError("Нужно войти заново.", 401);
  }
  return parse<T>(r);
}
/** Ответ сервера → данные или ApiError (общая часть call и запросов с файлом, data/live-contacts.ts). */
export async function parse<T>(r: Response): Promise<T> {
  let j: (T & { error?: string; errors?: unknown; confirm?: unknown; field?: unknown }) | null = null;
  try {
    j = (await r.json()) as T & { error?: string; errors?: unknown; confirm?: unknown; field?: unknown };
  } catch {
    /* не JSON — ниже общая ошибка */
  }
  if (!j) throw new ApiError(`Сервер ответил ошибкой ${r.status}. Попробуйте ещё раз через минуту.`, r.status);
  // раздел «Клиенты»: 400 { error, field } — к какому полю формы относится ошибка
  if (j.error) throw new ApiError(j.error, r.status, false, typeof j.field === "string" && j.field ? { field: j.field } : undefined);
  if (!r.ok) {
    // рассылки: 400 { ok: false, errors: [...] } — ошибки формы списком; 409 { confirm } — вопрос перед запуском при сигнале Meta
    const errors = Array.isArray(j.errors) ? j.errors.map(String).filter(Boolean) : [];
    if (errors.length) throw new ApiError(errors.join("; "), r.status, false, { errors });
    if (typeof j.confirm === "string" && j.confirm) throw new ApiError(j.confirm, r.status, false, { confirm: j.confirm });
    throw new ApiError(`Сервер ответил ошибкой ${r.status}.`, r.status);
  }
  return j;
}

// ---------- перевод в понятия пульта ----------
export const NEED_LABEL: Record<string, string> = {
  human: "Просит человека",
  limit: "Бот не ответил",
  media: "Прислал файл",
  ai: "Сбой бота",
  req: "Просит отменить или перенести",
  lead: "Новая заявка",
  call: "Ждёт звонка",
  off: "Ждёт ответа", // бот выключен — это не причина ждать, а просто новое сообщение (ТЗ v2.0 §2.2)
  send: "Ответ не дошёл",
  noshow: "Не пришёл на запись",
};
/** Тема входящего важнее причины: «Просит перенести» понятнее, чем «Ждёт ответа». */
const TOPIC_LABEL: Record<string, string> = { book: "Хочет записаться", move: "Просит перенести", cancel: "Просит отменить", late: "Опаздывает", time: "Спрашивает время записи" };
const SRC_LABEL: Record<string, string> = { rm: "Ответ на напоминание", bc: "Ответ на рассылку" };
const STATUSES = new Set<DeliveryStatus>(["queued", "sent", "delivered", "read", "failed", "unknown"]);
const status = (s?: string) => (s && STATUSES.has(s as DeliveryStatus) ? (s as DeliveryStatus) : undefined);
const topic = (t?: string) => (t && t in TOPIC_LABEL ? (t as Topic) : undefined);
const needLabel = (why: string, tp?: string, src?: string, text?: string) => (tp && TOPIC_LABEL[tp]) || (why === "off" && src && SRC_LABEL[src]) || NEED_LABEL[why] || text || "Нужен ответ";
const digits = (s: string) => String(s || "").replace(/\D/g, "");
const keyOf = (ch: string, id: string) => `${ch}:${id}`;

function botState(off: boolean, stop: boolean | number, pausedUntil: number, now: number): BotState {
  if (off) return { state: "off" };
  if (stop) return { state: "stopped" };
  if (pausedUntil > now) return { state: "paused", until: pausedUntil };
  return { state: "active" };
}

// служебная подпись сервера о файле → коротко, как в мессенджере
const MEDIA_PREVIEW: [RegExp, string][] = [[/голосов/, "Голосовое"], [/фото|картин|изображ/, "Фото"], [/видео/, "Видео"], [/стикер/, "Стикер"], [/геолок|мест/, "Геолокация"], [/контакт/, "Контакт"], [/файл|документ/, "Файл"]];
function previewText(s: string) {
  const m = /^\[клиент прислал ([^\]]+)\]$/.exec(s.trim());
  if (!m) return s;
  return (MEDIA_PREVIEW.find(([re]) => re.test(m[1])) || [null, "Файл"])[1];
}

function summary(r: ListRowRaw, off: boolean, now: number, isRead: (key: string, at: number) => boolean): ConversationSummary {
  const key = keyOf(r.ch, r.id);
  const phone = r.ph || "";
  const lastAt = r.li && r.li > r.t ? r.li : r.t || r.li || 0;
  const from = r.d === "u" ? "contact" : r.d === "a" ? "operator" : r.d === "b" ? "bot" : null;
  // li — последнее сообщение клиента (окно 24 ч WhatsApp); у чатов сайта его может не быть
  const inbound = r.li || (from === "contact" ? lastAt : 0);
  return {
    key,
    ref: { channelId: r.ch, externalId: r.id },
    contact: { key: digits(phone) || `web:${r.id}`, name: r.nm || undefined, phone: phone || undefined },
    lastAt,
    lastInboundAt: inbound || undefined,
    preview: previewText(r.s || ""),
    previewFrom: from,
    attention: r.nd ? { reason: r.nd, label: needLabel(r.nd, r.tp, r.rs), since: inbound || undefined, topic: topic(r.tp), ...(r.rs === "rm" || r.rs === "bc" ? { source: { kind: r.rs, at: 0, text: "" } } : {}) } : null,
    bot: botState(off, r.st, r.pu, now),
    hasBooking: !!r.bk,
    inbound: !!(r.li || r.d === "u" || r.nd),
    assignee: r.as || undefined,
    done: !!r.dn,
    lastStatus: status(r.ls),
    // счётчика непрочитанных на сервере нет: «новое» — сообщение клиента после последнего просмотра на этом устройстве
    unread: inbound > 0 && !isRead(key, inbound),
  };
}

const MEDIA: Record<string, MediaKind> = { audio: "audio", image: "image", video: "video", document: "document", sticker: "sticker", location: "location", contact: "contact" };

function detail(ws: string, d: ChatRaw, warn?: string): ConversationDetail {
  const ref = { channelId: d.ch, externalId: d.id };
  const messages: Message[] = d.turns.map((t, i) => {
    const from = t.r === "u" ? "contact" : t.r === "a" ? "operator" : "bot";
    const m: Message = { id: `${t.t}-${i}`, from, text: t.x || "", at: t.t || 0 };
    if (t.op) m.operator = t.op;
    if (t.auto) m.auto = t.auto;
    if (status(t.st)) m.status = status(t.st);
    if (t.se) m.statusError = t.se;
    if (t.ed) m.edited = true;
    if (t.del) m.deleted = true;
    if (t.re) m.reaction = t.re;
    if (t.m) {
      // у ответа с телефона сервер кладёт m без вида файла (src/controllers/inbox.js: m = "phone" → { id: "", f: false })
      if (!t.m.k && from === "operator") m.via = "phone";
      else if (t.m.k) {
        const media: Message["media"] = { kind: MEDIA[t.m.k] || "document", ...(t.m.name ? { name: t.m.name } : {}), ...(t.m.mime ? { mime: t.m.mime } : {}), ...(t.m.size ? { size: t.m.size } : {}) };
        if (t.m.f) media.url = `/api/inbox/media?c=${enc(ws)}&ch=${d.ch}&id=${enc(d.id)}&` + (t.m.id ? `mid=${enc(t.m.id)}` : `n=${i}`);
        m.media = media;
      }
    }
    return m;
  });
  let reply: ReplyState;
  if (d.ch === "web") reply = { allowed: false, reason: "web", text: "Это чат с сайта — ответить в него нельзя. Позвоните клиенту, если он оставил номер." };
  else if (!d.canSend) reply = { allowed: false, reason: "not_connected", text: "Отправка с этого номера не настроена. Владелец подключает номер в «Проверке запуска»." };
  else if (!d.open) reply = { allowed: false, reason: "window", text: "Клиент писал больше 24 часов назад — WhatsApp не даёт написать первым. Позвоните ему или дождитесь сообщения." };
  else reply = { allowed: true, closesAt: d.ch === "wa" && d.li ? d.li + 24 * 3600e3 : undefined };
  return {
    key: keyOf(d.ch, d.id),
    ref,
    contact: { key: digits(d.phone) || `web:${d.id}`, name: d.name || undefined, profileName: d.waName || undefined, phone: d.phone || undefined },
    messages,
    attention: d.need ? { reason: d.need.why, label: needLabel(d.need.why, d.need.tp, d.need.src?.k, d.need.text), since: d.need.at || undefined, topic: topic(d.need.tp), ...(d.need.src ? { source: { kind: d.need.src.k, at: d.need.src.at, text: d.need.src.text } } : {}) } : null,
    assignee: d.assignee || undefined,
    done: !!d.done,
    line: d.line ? { label: d.line.label } : undefined,
    audit: (d.audit || []).map((x) => ({ at: x.t, who: x.w, act: x.a, to: x.to })),
    bot: botState(d.off, d.stop, d.paused, d.now),
    bookings: d.bookings || [],
    pending: d.pend || [],
    bookedNote: d.booked || "",
    requests: (d.reqs || []).map((q): ChatRequest => ({ id: q.id, kind: reqKind(q.kind), name: q.name, service: q.service, time: q.time, note: q.note })),
    reply,
    payment: d.pay,
    campaign: d.promo || undefined,
    warning: warn,
  };
}
const reqKind = (k: string): RequestKind => (k === "cancel" || k === "change" || k === "callback" ? k : "lead");

/** Канал заявки — из подписи источника (src/controllers/webhooks/meta.js: «WhatsApp» — Green-API, «WhatsApp API» — Meta). */
const leadChannel = (source: string) => (/WhatsApp API$/.test(source) ? "wa" : /WhatsApp$/.test(source) ? "ga" : /веб-чат$/.test(source) ? "web" : undefined);

const fmtGaState: Record<string, string> = {
  authorized: "подключён",
  notAuthorized: "не привязан — отсканируйте QR-код",
  blocked: "заблокирован WhatsApp",
  starting: "запускается",
  yellowCard: "ограничен WhatsApp",
};

// раздел «Рассылки» — отдельный файл (live-campaigns.ts): грузится при первом обращении, в первое открытие пульта не входит
const campaignsApi = <K extends keyof CampaignSource>(k: K): CampaignSource[K] =>
  ((...a: unknown[]) => import("./live-campaigns").then((m) => (m.liveCampaigns[k] as (...x: unknown[]) => unknown)(...a))) as CampaignSource[K];
// раздел «Клиенты» — тоже отдельный файл (live-contacts.ts)
const contactsApi = <K extends keyof ContactSource>(k: K): ContactSource[K] =>
  ((...a: unknown[]) => import("./live-contacts").then((m) => (m.liveContacts[k] as (...x: unknown[]) => unknown)(...a))) as ContactSource[K];

export function createLiveSource(): DataSource {
  const marks = readMarks();
  const studio = new Map<string, StudioClientRaw>();
  return {
    mode: "live",
    async session(): Promise<Session> {
      const me = await call<{ owner: boolean; c: string }>("/api/inbox/me");
      const q = new URLSearchParams(location.search).get("c");
      return { role: me.owner ? "owner" : "staff", workspaceId: me.owner ? q || null : me.c || q || null };
    },
    async workspaces(): Promise<WorkspaceOption[]> {
      const d = await call<{ clients: StudioClientRaw[] }>("/api/studio/list");
      for (const c of d.clients) studio.set(c.id, c);
      return d.clients.map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
    },
    async inbox(ws): Promise<InboxSnapshot> {
      // v=2 (ТЗ v2.0 §2.1): все чаты, где клиент писал (до 1000), номера компании, имена сотрудников, число чатов только с нашими сообщениями
      const base = `/api/inbox/list?c=${enc(ws)}&f=all&v=2`;
      const [wa, web] = await Promise.all([call<ListRaw>(base + "&ch=wa"), call<ListRaw>(base + "&ch=web")]);
      const rows = [...wa.chats, ...web.chats];
      const now = wa.now || Date.now();
      const isRead = marks.forWorkspace(ws);
      const conversations = rows.map((r) => summary(r, wa.client.off, now, isRead)).sort((a, b) => b.lastAt - a.lastAt);
      const kinds = new Set(rows.map((r) => r.ch));
      const channels: Channel[] = (["wa", "ga", "web"] as const).filter((c) => kinds.has(c) || (c !== "web" && wa.lines?.[c])).map((c) => ({ id: c, kind: channelKind(c), name: wa.lines?.[c]?.label || "", ...(wa.lines?.[c]?.phone ? { phone: wa.lines[c].phone } : {}) }));
      const sc = studio.get(ws);
      const workspace: Workspace = {
        id: wa.client.id,
        name: wa.client.name,
        botOff: !!wa.client.off,
        branches: [],
        channels,
        capabilities: { booking: sc ? sc.booking !== "none" : null, campaigns: true },
      };
      const shown = wa.chats.length + web.chats.length, total = wa.total + web.total;
      return { workspace, conversations, truncated: total > shown ? { shown, total } : null, outOnly: wa.outOnly || 0, operators: wa.ops || [], now };
    },
    async bookingCard(ws, ref) {
      return call<{ available: boolean; records: BookingCard[] }>(`/api/inbox/booking?c=${enc(ws)}&ch=${enc(ref.channelId)}&id=${enc(ref.externalId)}`);
    },
    async outboundOnly(ws) {
      const d = await call<ListRaw>(`/api/inbox/list?c=${enc(ws)}&v=2&ch=wa&f=out`);
      const isRead = marks.forWorkspace(ws);
      return d.chats.map((r) => summary(r, d.client.off, d.now || Date.now(), isRead));
    },
    async channelReport(ws): Promise<ChannelReport> {
      const d = await call<BcRaw>(`/api/bc/list?c=${enc(ws)}`);
      const channels: Channel[] = [];
      if (d.health) {
        const h = d.health;
        channels.push({
          id: "wa",
          kind: "wa_cloud",
          name: "",
          phone: h.phone || undefined,
          health: h.error ? { level: "warn", text: h.error } : { level: h.quality === "RED" ? "warn" : "ok", text: h.quality === "RED" ? "Meta снизила оценку качества номера" : "подключён" },
        });
      }
      if (d.ga) {
        const g = d.ga;
        channels.push({
          id: "ga",
          kind: "green_api",
          name: "",
          phone: g.phone || undefined,
          health: g.ready && !g.warn ? { level: "ok", text: "подключён" } : { level: "warn", text: g.why || g.warn || fmtGaState[g.state] || "не подключён" },
        });
      }
      const campaigns: Campaign[] = (d.list || []).map((b) => ({ id: b.id, name: b.name || "Без названия", status: b.status, total: b.total || 0, sent: b.sent || 0, failed: b.failed || 0, createdAt: b.created || 0, channelId: b.ch === "ga" ? "ga" : "wa" }));
      return { channels, optouts: d.stops, campaigns, owner: !!d.owner };
    },
    async conversation(ws, ref) {
      const d = await call<ChatRaw>(`/api/inbox/chat?c=${enc(ws)}&ch=${enc(ref.channelId)}&id=${enc(ref.externalId)}`);
      marks.mark(ws, keyOf(ref.channelId, ref.externalId));
      return detail(ws, d);
    },
    async send(ws, ref, text) {
      const d = await call<{ ok: true; chat: ChatRaw; warn?: string }>("/api/inbox/send", { c: ws, ch: ref.channelId, id: ref.externalId, text, op: getOperator() });
      marks.mark(ws, keyOf(ref.channelId, ref.externalId));
      return detail(ws, d.chat, d.warn);
    },
    async act(ws, ref, act: ChatAction, extra?: ChatActionExtra) {
      const d = await call<{ ok: true; chat: ChatRaw }>("/api/inbox/act", { c: ws, ch: ref.channelId, id: ref.externalId, act, op: getOperator(), ...(extra || {}) });
      return detail(ws, d.chat);
    },
    async complete(ws, ref, leadId, text) {
      const d = await call<{ ok: true; chat: ChatRaw }>("/api/inbox/act", { c: ws, ch: ref.channelId, id: ref.externalId, act: "done", lead: leadId, text, op: getOperator() });
      return detail(ws, d.chat);
    },
    async leads(ws): Promise<Lead[]> {
      const d = await call<{ leads: LeadRaw[] }>(`/api/inbox/leads?c=${enc(ws)}`);
      return d.leads.map((l) => ({ id: l.id, kind: reqKind(l.kind), name: l.name, phone: l.phone, service: l.service, time: l.time, note: l.note, status: l.status, channelId: leadChannel(l.source), at: l.ts || 0 }));
    },
    campaignsOverview: campaignsApi("campaignsOverview"),
    campaign: campaignsApi("campaign"),
    campaignBad: campaignsApi("campaignBad"),
    checkCampaign: campaignsApi("checkCampaign"),
    createCampaign: campaignsApi("createCampaign"),
    campaignAct: campaignsApi("campaignAct"),
    campaignTick: campaignsApi("campaignTick"),
    testSend: campaignsApi("testSend"),
    crmSegments: campaignsApi("crmSegments"),
    crmList: campaignsApi("crmList"),
    crmRefresh: campaignsApi("crmRefresh"),
    autoGet: campaignsApi("autoGet"),
    autoSet: campaignsApi("autoSet"),
    clearMetaHold: campaignsApi("clearMetaHold"),
    serviceMessages: campaignsApi("serviceMessages"),
    contactsStatus: contactsApi("contactsStatus"),
    contactSegments: contactsApi("contactSegments"),
    contactList: contactsApi("contactList"),
    contactCard: contactsApi("contactCard"),
    addContact: contactsApi("addContact"),
    setConsent: contactsApi("setConsent"),
    addRestriction: contactsApi("addRestriction"),
    liftRestriction: contactsApi("liftRestriction"),
    reviewRestriction: contactsApi("reviewRestriction"),
    importPreview: contactsApi("importPreview"),
    importConfirm: contactsApi("importConfirm"),
    importDiscard: contactsApi("importDiscard"),
    syncContacts: contactsApi("syncContacts"),
    probeAltegio: contactsApi("probeAltegio"),
    stopsAction: contactsApi("stopsAction"),
    externalUrl(page, ws) {
      const c = "?c=" + enc(ws);
      return { broadcast: "/broadcast" + c, studio: "/studio", launch: "/launch" + c, leads: "/leads" + c, logout: "/logout", site: "/" + c }[page];
    },
  };
}
