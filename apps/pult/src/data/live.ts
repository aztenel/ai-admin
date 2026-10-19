// Настоящий API бота. Формы ответов — как их сейчас отдаёт сервер (src/controllers/inbox.js, broadcast.js, studio.js);
// здесь они переводятся в понятия пульта (model/types.ts). Права и арендатор проверяет сервер: параметр c= — только выбор
// среди разрешённых пользователю компаний (CLAUDE.md §5.3, п. 4), пульт ничего не решает сам.
import type {
  BotState,
  Campaign,
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
import type { DataSource } from "./source";
import { readMarks } from "./read-marks";

// ---------- ответы сервера ----------
type ChRaw = "wa" | "ga" | "web";
type ListRowRaw = { ch: ChRaw; id: string; t: number; li: number; s: string; d: "" | "u" | "a" | "b"; nm: string; ph: string; nd: string; pu: number; st: 0 | 1; bk: number };
type ListRaw = { client: { id: string; name: string; off: boolean }; need: number; total: number; more: boolean; chats: ListRowRaw[]; now: number };
type TurnRaw = { r: "u" | "a" | "b"; x: string; t: number; m?: { k?: string; id: string; f: boolean } };
type ReqRaw = { id: string; kind: string; name: string; service: string; time: string; note: string; at: string };
type ChatRaw = {
  promo: { at: number; name: string; text: string } | null;
  ch: ChRaw; id: string; phone: string; name: string; waName: string; turns: TurnRaw[];
  bookings: string[]; pend: string[]; booked: string;
  need: { why: string; text: string; at: number } | null; paused: number; stop: boolean; off: boolean;
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
const enc = encodeURIComponent;
async function call<T>(path: string, body?: Record<string, unknown>): Promise<T> {
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
  let j: (T & { error?: string }) | null = null;
  try {
    j = (await r.json()) as T & { error?: string };
  } catch {
    /* не JSON — ниже общая ошибка */
  }
  if (!j) throw new ApiError(`Сервер ответил ошибкой ${r.status}. Попробуйте ещё раз через минуту.`, r.status);
  if (j.error) throw new ApiError(j.error, r.status);
  if (!r.ok) throw new ApiError(`Сервер ответил ошибкой ${r.status}.`, r.status);
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
  off: "Бот выключен",
};
const digits = (s: string) => String(s || "").replace(/\D/g, "");
const keyOf = (ch: string, id: string) => `${ch}:${id}`;

function botState(off: boolean, stop: boolean | number, pausedUntil: number, now: number): BotState {
  if (off) return { state: "off" };
  if (stop) return { state: "stopped" };
  if (pausedUntil > now) return { state: "paused", until: pausedUntil };
  return { state: "active" };
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
    preview: r.s || "",
    previewFrom: from,
    attention: r.nd ? { reason: r.nd, label: NEED_LABEL[r.nd] || "Нужен ответ", since: inbound || undefined } : null,
    bot: botState(off, r.st, r.pu, now),
    hasBooking: !!r.bk,
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
    if (t.m) {
      // у ответа с телефона сервер кладёт m без вида файла (src/controllers/inbox.js: m = "phone" → { id: "", f: false })
      if (!t.m.k && from === "operator") m.via = "phone";
      else if (t.m.k) {
        const media: Message["media"] = { kind: MEDIA[t.m.k] || "document" };
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
    attention: d.need ? { reason: d.need.why, label: NEED_LABEL[d.need.why] || d.need.text || "Нужен ответ", since: d.need.at || undefined } : null,
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
      const base = `/api/inbox/list?c=${enc(ws)}&f=all`;
      const [wa, web] = await Promise.all([call<ListRaw>(base + "&ch=wa"), call<ListRaw>(base + "&ch=web")]);
      let rows = [...wa.chats, ...web.chats];
      // сервер отдаёт не больше 200 последних чатов: ждущих ответа добираем отдельным запросом, чтобы ни один не потерялся
      if (wa.total > wa.chats.length) {
        const need = await call<ListRaw>(`/api/inbox/list?c=${enc(ws)}&f=need&ch=wa`);
        const have = new Set(rows.map((r) => keyOf(r.ch, r.id)));
        rows = rows.concat(need.chats.filter((r) => !have.has(keyOf(r.ch, r.id))));
      }
      const now = wa.now || Date.now();
      const isRead = marks.forWorkspace(ws);
      const conversations = rows.map((r) => summary(r, wa.client.off, now, isRead)).sort((a, b) => b.lastAt - a.lastAt);
      const kinds = new Set(rows.map((r) => r.ch));
      const channels: Channel[] = (["wa", "ga", "web"] as const).filter((c) => kinds.has(c)).map((c) => ({ id: c, kind: channelKind(c), name: "" }));
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
      return { workspace, conversations, truncated: total > shown ? { shown, total } : null, now };
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
      const d = await call<{ ok: true; chat: ChatRaw; warn?: string }>("/api/inbox/send", { c: ws, ch: ref.channelId, id: ref.externalId, text });
      marks.mark(ws, keyOf(ref.channelId, ref.externalId));
      return detail(ws, d.chat, d.warn);
    },
    async act(ws, ref, act: ChatAction) {
      const d = await call<{ ok: true; chat: ChatRaw }>("/api/inbox/act", { c: ws, ch: ref.channelId, id: ref.externalId, act });
      return detail(ws, d.chat);
    },
    async complete(ws, ref, leadId, text) {
      const d = await call<{ ok: true; chat: ChatRaw }>("/api/inbox/act", { c: ws, ch: ref.channelId, id: ref.externalId, act: "done", lead: leadId, text });
      return detail(ws, d.chat);
    },
    async leads(ws): Promise<Lead[]> {
      const d = await call<{ leads: LeadRaw[] }>(`/api/inbox/leads?c=${enc(ws)}`);
      return d.leads.map((l) => ({ id: l.id, kind: reqKind(l.kind), name: l.name, phone: l.phone, service: l.service, time: l.time, note: l.note, status: l.status, channelId: leadChannel(l.source), at: l.ts || 0 }));
    },
    externalUrl(page, ws) {
      const c = "?c=" + enc(ws);
      return { broadcast: "/broadcast" + c, studio: "/studio", launch: "/launch" + c, leads: "/leads" + c, logout: "/logout", site: "/" + c }[page];
    },
  };
}
