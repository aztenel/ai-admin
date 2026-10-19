// Раздел «Рассылки» на настоящем API бота: /api/bc/* (рассылки, автосценарий) и /api/crm/* (база клиентов из Altegio).
// Отдельный файл: грузится при первом обращении к разделу, а не при первом открытии пульта (бюджет JS, README).
// Формы ответов — src/controllers/broadcast.js и crm.js сервера. Права (владелец / сотрудник) и компанию проверяет сервер.
// Полные номера клиентов базы сервер не отдаёт — здесь их нет и быть не может; ответы не пишутся ни в консоль, ни в localStorage.
import type {
  AutoInfo,
  AutoSettings,
  BotNumberState,
  CampaignActResult,
  CampaignCheck,
  CampaignDetail,
  CampaignDraft,
  CampaignFail,
  CampaignRow,
  CampaignStatus,
  CampaignsOverview,
  CrmInfo,
  CrmOverview,
  CrmPage,
  MainNumberState,
  NumberQuality,
  SegmentSpec,
  ServiceKind,
  ServiceOverview,
} from "@/model/campaigns";
import { ApiError } from "./errors";
import { call, enc } from "./live";
import type { CampaignSource } from "./source";

// ---------- ответы сервера ----------
type RowRaw = {
  id: string; name?: string; status: string; total?: number; pos?: number; sent?: number; failed?: number; skipped?: number; excl?: number;
  created?: number; ch?: string; by?: string; src?: string; seg?: string; tpl?: string;
};
type BRaw = RowRaw & {
  cap?: number; from?: number; to?: number; text?: string; msg?: string; fallback?: string; img?: string; lang?: string; params?: string[];
  segId?: string; crmAt?: number; startedAt?: number; last?: number; nextAt?: number; doneAt?: number; waitNote?: string; waitTill?: number;
  retryAt?: number; retryWhy?: string; note?: string; unsure?: number; fails?: CampaignFail[]; stalled?: boolean;
};
type ListRaw = {
  client: { id: string; name: string }; owner: boolean; ready: boolean; why: string; stops: number; hold: string[] | null;
  fail: { n: number; codes: CampaignFail[] } | null; used: number;
  health: { phone?: string; name?: string; quality?: string; limit?: number; error?: string } | null;
  ga: { ready: boolean; state: string; phone: string; hook: boolean; why: string; warn: string; used: number; cap: [number, number]; hold: string; bcOff?: string } | null;
  list: RowRaw[]; now: number;
};
type CheckRaw = Omit<CampaignCheck, "listFilter"> & { seg?: string; segOut?: number; noDate?: number };
type SegRaw = Omit<CrmOverview, "available" | "info"> & { info: CrmInfo | null };
type ServiceRaw = {
  owner: boolean; kinds?: { k: string; label?: string; on?: boolean; link?: string }[];
  queue?: { k: string; at?: number; ch?: string; phone?: string; name?: string; date?: string; time?: string }[];
  total?: number; sent3d?: number; botOff?: boolean; altegio?: boolean;
};
type AutoRaw = { owner: boolean; auto: AutoSettings; available: boolean; why: string; crm: AutoInfo["crm"]; today: AutoInfo["today"]; note?: string;
  qual: { quality: string; at: number } | null; skip?: { at: number; why: string } };

// ---------- перевод в понятия пульта ----------
const n = (x: unknown) => (typeof x === "number" && isFinite(x) ? x : 0);
const STATUSES: CampaignStatus[] = ["ready", "running", "paused", "done", "stopped"];
/** Качество номера: Meta — GREEN/YELLOW/RED, проверка качества (qual:) — ещё HIGH/MEDIUM/LOW. */
export function quality(q: string | undefined): NumberQuality {
  const s = String(q || "").toUpperCase();
  return s === "GREEN" || s === "HIGH" ? "green" : s === "YELLOW" || s === "MEDIUM" ? "yellow" : s === "RED" || s === "LOW" ? "red" : "unknown";
}

function row(r: RowRaw): CampaignRow {
  return {
    id: r.id,
    name: r.name || "Без названия",
    status: (STATUSES as string[]).includes(r.status) ? (r.status as CampaignStatus) : "stopped",
    channel: r.ch === "ga" ? "bot" : "main",
    total: n(r.total),
    pos: n(r.pos),
    sent: n(r.sent),
    failed: n(r.failed),
    skipped: n(r.skipped),
    excluded: n(r.excl),
    createdAt: n(r.created),
    source: r.src === "crm" ? "crm" : "list",
    ...(r.seg ? { segment: r.seg } : {}),
    ...(r.by === "owner" || r.by === "staff" || r.by === "auto" ? { by: r.by } : {}),
    ...(r.tpl ? { template: r.tpl } : {}),
  };
}

function detail(b: BRaw): CampaignDetail {
  const d: CampaignDetail = { ...row(b), cap: n(b.cap), from: n(b.from), to: n(b.to), text: b.text || "", fallback: b.fallback || "", fails: b.fails || [], stalled: !!b.stalled };
  // необязательные поля — только если сервер их прислал (пусто и 0 — «нет»)
  const extra: Partial<CampaignDetail> = {
    message: b.msg, image: b.img, lang: b.lang, params: b.params, segmentId: b.segId, crmAt: b.crmAt, startedAt: b.startedAt, lastSentAt: b.last,
    nextAt: b.nextAt, doneAt: b.doneAt, waitNote: b.waitNote, waitTill: b.waitTill, retryAt: b.retryAt, retryWhy: b.retryWhy, note: b.note, unsure: b.unsure,
  };
  for (const [k, v] of Object.entries(extra)) if (v) (d as Record<string, unknown>)[k] = v;
  return d;
}

function overview(d: ListRaw): CampaignsOverview {
  const h = d.health;
  const main: MainNumberState = {
    ready: !!d.ready,
    why: d.why || "",
    quality: quality(h?.quality),
    limit: n(h?.limit),
    used24h: n(d.used),
    hold: d.hold || [],
    failedToday: d.fail && d.fail.n ? d.fail : null,
    ...(h?.phone ? { phone: h.phone } : {}),
    ...(h?.name ? { name: h.name } : {}),
    ...(h?.error ? { infoError: h.error } : {}),
  };
  const g = d.ga;
  const bot: BotNumberState | null = g
    ? {
        ready: !!g.ready,
        state: g.state || "",
        hook: !!g.hook,
        why: g.why || "",
        warn: g.warn || "",
        used24h: n(g.used),
        cap: { def: n(g.cap?.[0]) || 50, max: n(g.cap?.[1]) || 300 },
        hold: g.hold || "",
        noBroadcast: g.bcOff || "",
        ...(g.phone ? { phone: g.phone } : {}),
      }
    : null;
  return { workspace: d.client, owner: !!d.owner, main, bot, optouts: n(d.stops), campaigns: (d.list || []).map(row), now: d.now || Date.now() };
}

const KINDS: ServiceKind[] = ["d1", "h2", "rv"];
const isKind = (k: string): k is ServiceKind => (KINDS as string[]).includes(k);

/** Сервисные сообщения: незнакомые виды (сервер новее пульта) не показываем; номер — маска сервера как есть. */
function service(d: ServiceRaw): ServiceOverview {
  const kinds = (d.kinds || []).flatMap((x) => (isKind(x.k) ? [{ kind: x.k, label: x.label || "", on: !!x.on, ...(x.link ? { link: x.link } : {}) }] : []));
  const queue = (d.queue || []).flatMap((x) =>
    isKind(x.k) ? [{ kind: x.k, at: n(x.at), channel: x.ch === "ga" ? ("bot" as const) : ("main" as const), phone: x.phone || "", name: x.name || "", date: x.date || "", time: x.time || "" }] : [],
  );
  // altegio нет (сервер старше пульта) — как раньше: виды показываем, как прислал сервер
  return { owner: !!d.owner, kinds, queue, total: Math.max(n(d.total), queue.length), sent3d: n(d.sent3d), botOff: !!d.botOff, altegio: d.altegio !== false };
}

/** Черновик → тело запроса check / test / create. fallback шлём всегда: без него предпросмотр («клиент») не совпал бы с отправкой. */
export function draftBody(ws: string, d: CampaignDraft): Record<string, unknown> {
  const bot = d.channel === "bot";
  const b: Record<string, unknown> = {
    c: ws,
    ch: bot ? "ga" : "",
    name: d.name,
    text: d.text,
    img: d.img || "",
    fallback: (d.fallback || "").trim() || "уважаемый клиент",
    cap: d.cap,
    from: d.from,
    to: d.to,
    consent: d.consent === true,
  };
  if (!bot) Object.assign(b, { tpl: (d.tpl || "").trim(), lang: (d.lang || "ru").trim(), params: d.params || [] });
  if (d.source === "segment") b.segment = d.segment ? segBody(d.segment) : { id: "" };
  else {
    b.recipients = d.recipients || "";
    if (d.listFilter) Object.assign(b, { seg: d.listFilter.kind, segDays: d.listFilter.days });
  }
  return b;
}
const segBody = (s: SegmentSpec) => ({ id: s.id, ...(s.from !== undefined ? { from: s.from } : {}), ...(s.to !== undefined ? { to: s.to } : {}), ...(s.staff ? { staff: s.staff } : {}) });

export const liveCampaigns: CampaignSource = {
  async campaignsOverview(ws) {
    return overview(await call<ListRaw>(`/api/bc/list?c=${enc(ws)}`));
  },
  async campaign(ws, id) {
    return detail((await call<{ b: BRaw }>(`/api/bc/get?c=${enc(ws)}&id=${enc(id)}`)).b);
  },
  async campaignBad(ws, id) {
    const d = await call<{ b: BRaw; bad?: string[] }>(`/api/bc/get?c=${enc(ws)}&id=${enc(id)}&bad=1`);
    return { campaign: detail(d.b), lines: d.bad || [] };
  },
  async checkCampaign(ws, draft) {
    const { seg, segOut, noDate, ...r } = await call<CheckRaw>("/api/bc/check", draftBody(ws, draft));
    return { ...r, errors: r.errors || [], sample: r.sample || [], preview: r.preview || [], bad: r.bad || [], ...(seg ? { listFilter: { label: seg, out: n(segOut), noDate: n(noDate) } } : {}) };
  },
  async createCampaign(ws, draft) {
    const d = await call<{ b: BRaw; dup: number; bad: number; cut: number }>("/api/bc/create", draftBody(ws, draft));
    return { campaign: detail(d.b), dup: n(d.dup), bad: n(d.bad), cut: n(d.cut) };
  },
  async campaignAct(ws, id, act, force): Promise<CampaignActResult> {
    try {
      const d = await call<{ b?: BRaw; gone?: boolean }>("/api/bc/act", { c: ws, id, act, ...(force ? { force: true } : {}) });
      return d.gone || !d.b ? { kind: "deleted" } : { kind: "done", campaign: detail(d.b) };
    } catch (e) {
      if (e instanceof ApiError && e.confirm) return { kind: "confirm", question: e.confirm };
      throw e;
    }
  },
  async campaignTick(ws, id) {
    const d = await call<{ b: BRaw; state: string }>("/api/bc/tick", { c: ws, id });
    return { campaign: detail(d.b), state: d.state || "" };
  },
  async testSend(ws, draft, to) {
    return (await call<{ text: string }>("/api/bc/test", { ...draftBody(ws, draft), to })).text;
  },
  async crmSegments(ws) {
    const d = await call<SegRaw>(`/api/crm/segments?c=${enc(ws)}`);
    return {
      owner: !!d.owner,
      why: d.why || "",
      available: !d.why || !!d.at,
      at: n(d.at),
      clients: n(d.clients),
      ok: n(d.ok),
      segments: d.segments || [],
      excluded: d.excluded || { stop: 0, fut: 0, recent: 0, marketed: 0 },
      info: d.info || null,
      ...(d.error ? { error: d.error, errorAt: n(d.errorAt) } : {}),
    };
  },
  async crmList(ws, spec, page = 1) {
    const q = new URLSearchParams({ c: ws, seg: spec.id, page: String(page) });
    if (spec.from !== undefined) q.set("from", String(spec.from));
    if (spec.to !== undefined) q.set("to", String(spec.to));
    if (spec.staff) q.set("staff", spec.staff);
    return call<CrmPage>(`/api/crm/list?${q}`);
  },
  async crmRefresh(ws) {
    const { ok: _ok, ...info } = await call<CrmInfo & { ok: true }>("/api/crm/refresh", { c: ws });
    return info;
  },
  async autoGet(ws) {
    const d = await call<AutoRaw>(`/api/bc/auto?c=${enc(ws)}`);
    return {
      owner: !!d.owner,
      settings: d.auto,
      available: !!d.available,
      why: d.why || "",
      crm: d.crm || { at: 0, fresh: false },
      today: d.today || { n: 0, total: 0 },
      quality: d.qual ? { level: quality(d.qual.quality), at: n(d.qual.at) } : null,
      ...(d.note ? { note: d.note } : {}),
      ...(d.skip ? { skip: d.skip } : {}),
    };
  },
  async autoSet(ws, patch) {
    return (await call<{ auto: AutoSettings }>("/api/bc/auto", { ...patch, c: ws })).auto;
  },
  async clearMetaHold(ws) {
    await call<{ ok: true }>("/api/bc/auto", { c: ws, clearHold: true });
  },
  async serviceMessages(ws) {
    return service(await call<ServiceRaw>(`/api/bc/service?c=${enc(ws)}`));
  },
};
