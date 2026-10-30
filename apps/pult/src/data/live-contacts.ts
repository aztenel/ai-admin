// Раздел «Клиенты» на настоящем API бота: /api/contacts/* (src/controllers/contacts.js сервера, этап 1 плана D1).
// Отдельный файл: грузится при первом открытии раздела, а не при первом открытии пульта (бюджет JS, README).
// Ответы приводятся к понятиям model/contacts.ts осторожно: сервер новее или старее пульта — пропавшее поле не роняет экран.
// Номера в списке и предпросмотре импорта сервер отдаёт маской; полный номер — только в карточке одного клиента.
// Ответы не пишутся ни в консоль, ни в localStorage.
import type {
  CheckLevel,
  ConsentEvidence,
  ConsentPurpose,
  ConsentRecord,
  ConsentState,
  ContactCard,
  ContactPage,
  ContactRow,
  ContactSegments,
  ContactsStatus,
  DataCheck,
  ImportAction,
  ImportPreview,
  Report,
  Restriction,
  RestrictionKind,
  SyncScope,
  SyncState,
  Visit,
} from "@/model/contacts";
import { ApiError } from "./errors";
import { call, enc, parse } from "./live";
import type { ContactSource } from "./source";

// ---------- осторожный разбор ----------
type Raw = Record<string, unknown>;
const obj = (x: unknown): Raw => (x && typeof x === "object" && !Array.isArray(x) ? (x as Raw) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const num = (x: unknown) => (typeof x === "number" && isFinite(x) ? x : 0);
const tm = (x: unknown) => (typeof x === "number" && isFinite(x) && x > 0 ? x : null);
const str = (x: unknown) => (typeof x === "string" ? x : typeof x === "number" ? String(x) : "");
const strs = (x: unknown) => arr(x).map(str).filter(Boolean);
const oneOf = <T extends string>(x: unknown, list: readonly T[], def: T): T => ((list as readonly string[]).includes(str(x)) ? (str(x) as T) : def);
/** Число или null (дни с визита: 0 — сегодня, это не «нет»). */
const numOrNull = (x: unknown) => (typeof x === "number" && isFinite(x) ? x : null);
const boolOrNull = (x: unknown) => (typeof x === "boolean" ? x : null);

const SCOPES = ["hot", "future", "past"] as const;
const LEVELS = ["ok", "warn", "bad", "unknown"] as const;
const EVIDENCE = ["chat", "document", "oral", "import", "altegio", "client_stop"] as const;
const STATES = ["granted", "denied", "unknown"] as const;
const KINDS = ["marketing_optout", "full_block", "sender_block", "cooldown", "undeliverable"] as const;
const ACTIONS = ["new", "update", "same", "dup", "invalid"] as const;

function report(x: unknown): Report | null {
  const r = obj(x);
  if (!Object.keys(r).length) return null;
  return { at: num(r.at), ok: !!r.ok, summary: strs(r.summary) };
}

export function syncState(x: unknown): SyncState {
  const s = obj(x), i = obj(s.initial), st = s.stats && typeof s.stats === "object" ? obj(s.stats) : null;
  const dir = s.directory && typeof s.directory === "object" ? obj(s.directory) : null;
  return {
    available: !!s.available,
    ...(str(s.why) ? { why: str(s.why) } : {}),
    dryOnly: !!s.dryOnly,
    initial: { done: !!i.done, from: str(i.from), to: str(i.to), cursor: str(i.cursor), pct: Math.max(0, Math.min(100, Math.round(num(i.pct)))) },
    lastOkAt: tm(s.lastOkAt),
    lastError: str(s.lastError) || null,
    lastErrorAt: tm(s.lastErrorAt),
    running: !!s.running,
    windows: arr(s.windows).flatMap((w) => {
      const o = obj(w);
      return (SCOPES as readonly string[]).includes(str(o.scope))
        ? [{ scope: str(o.scope) as SyncScope, label: str(o.label), lastOkAt: tm(o.lastOkAt), lastError: str(o.lastError) || null }]
        : [];
    }),
    stats: st
      ? { records: num(st.records), contacts: num(st.contacts), bookings: num(st.bookings), masked: num(st.masked), bad: num(st.bad), deleted: num(st.deleted) }
      : null,
    directory: dir
      ? { done: !!dir.done, total: num(dir.total), pct: Math.max(0, Math.min(100, Math.round(num(dir.pct)))), lastOkAt: tm(dir.lastOkAt), lastError: str(dir.lastError) || null }
      : null,
  };
}

function status(x: unknown): ContactsStatus {
  const d = obj(x), c = obj(d.counts), k = obj(d.client), sp = obj(d.stops);
  return {
    ready: !!d.ready,
    ...(str(d.why) ? { why: str(d.why) } : {}),
    stage: d.stage === "preview" ? "preview" : "production",
    owner: !!d.owner,
    client: { id: str(k.id), name: str(k.name) },
    counts: { contacts: num(c.contacts), withVisits: num(c.withVisits), upcoming: num(c.upcoming), stops: num(c.stops), review: num(c.review) },
    sync: syncState(d.sync),
    stops: { lastOkAt: tm(sp.lastOkAt), lastError: str(sp.lastError) || null, found: num(sp.found), channel: sp.channel === "ga" ? "ga" : null },
    probe: report(d.probe),
    checks: arr(d.checks).map((v): DataCheck => {
      const o = obj(v);
      // уровень, которого пульт не знает, — «ещё не проверено», а не «в порядке»
      return { id: str(o.id), label: str(o.label), count: num(o.count), level: oneOf<CheckLevel>(o.level, LEVELS, "unknown"), hint: str(o.hint) };
    }),
    errors: arr(d.errors).map((v) => {
      const o = obj(v);
      return { at: num(o.at), scope: str(o.scope), text: str(o.text) };
    }),
  };
}

function row(x: unknown): ContactRow {
  const o = obj(x);
  return {
    id: str(o.id),
    name: str(o.name),
    phone: str(o.phone),
    lastVisitAt: tm(o.lastVisitAt),
    daysAgo: numOrNull(o.daysAgo),
    visits: num(o.visits),
    nextBookingAt: tm(o.nextBookingAt),
    lastStaff: str(o.lastStaff),
    consent: oneOf<ConsentState>(o.consent, STATES, "unknown"),
    consentConfirmed: o.consentConfirmed === true,
    stop: !!o.stop,
    fullBlock: !!o.fullBlock,
    review: !!o.review,
    sources: strs(o.sources),
  };
}

const visit = (x: unknown): Visit => {
  const o = obj(x);
  return { id: str(o.id), at: num(o.at), staff: str(o.staff), services: str(o.services), attendance: typeof o.attendance === "number" ? o.attendance : null };
};
const consent = (x: unknown): ConsentRecord | null => {
  const o = obj(x);
  if (!Object.keys(o).length) return null;
  return {
    state: oneOf<ConsentState>(o.state, STATES, "unknown"),
    basis: str(o.basis),
    source: str(o.source),
    actor: str(o.actor),
    at: num(o.at),
    // нет поля — не подтверждено: реклама уходит только с подтверждённым согласием
    confirmed: o.confirmed === true,
    evidence: (EVIDENCE as readonly string[]).includes(str(o.evidence)) ? (str(o.evidence) as ConsentEvidence) : null,
    evidenceRef: str(o.evidenceRef) || null,
    givenAt: tm(o.givenAt),
  };
};
const restriction = (x: unknown): Restriction => {
  const o = obj(x), lifted = tm(o.liftedAt);
  return {
    id: str(o.id),
    kind: oneOf<RestrictionKind>(o.kind, KINDS, "marketing_optout"),
    reason: str(o.reason),
    source: str(o.source),
    actor: str(o.actor),
    at: num(o.at),
    review: !!o.review,
    liftedAt: lifted,
    liftedBy: str(o.liftedBy),
    liftReason: str(o.liftReason),
    active: typeof o.active === "boolean" ? o.active : !lifted,
    byClient: !!o.byClient,
    untilAt: tm(o.untilAt),
    // нет поля (старый сервер) — снять можно, сервер всё равно проверит сам
    canLift: typeof o.canLift === "boolean" ? o.canLift : true,
    liftHint: str(o.liftHint),
  };
};

function card(x: unknown): ContactCard {
  const d = obj(x), c = obj(d.contact), cs = obj(d.consent), cm = obj(d.canMarket), cr = obj(d.consentRules);
  return {
    contact: {
      id: str(c.id),
      name: str(c.name),
      phone: str(c.phone),
      altegioId: str(c.altegioId),
      firstVisitAt: tm(c.firstVisitAt),
      lastVisitAt: tm(c.lastVisitAt),
      daysAgo: numOrNull(c.daysAgo),
      visits: num(c.visits),
      altVisits: numOrNull(c.altVisits),
      altLastVisitAt: tm(c.altLastVisitAt),
      newsletter: boolOrNull(c.newsletter),
      nextBookingAt: tm(c.nextBookingAt),
      lastStaff: str(c.lastStaff),
      lastService: str(c.lastService),
      createdAt: num(c.createdAt),
      updatedAt: num(c.updatedAt),
      syncedAt: tm(c.syncedAt),
      sources: arr(c.sources).map((v) => {
        const o = obj(v);
        return { source: str(o.source), at: num(o.at) };
      }),
    },
    visits: arr(d.visits).map(visit),
    upcoming: arr(d.upcoming).map(visit),
    missed: num(d.missed),
    consent: { marketing: consent(cs.marketing), service: consent(cs.service) },
    consentHistory: arr(d.consentHistory).map((v) => {
      const o = obj(v);
      return { ...(consent(o) as ConsentRecord), purpose: (o.purpose === "service" ? "service" : "marketing") as ConsentPurpose };
    }),
    consentRules: { refusedAt: tm(cr.refusedAt), chatAvailable: cr.chatAvailable === true, oralAllowed: cr.oralAllowed !== false, chatText: typeof cr.chatText === "string" ? cr.chatText : null, chatAt: tm(cr.chatAt) },
    restrictions: arr(d.restrictions).map(restriction),
    segments: arr(d.segments).map((v) => {
      const o = obj(v);
      return { id: str(o.id), label: str(o.label) };
    }),
    canMarket: { ok: !!cm.ok, reasons: strs(cm.reasons) },
    events: arr(d.events).map((v) => {
      const o = obj(v);
      return { at: num(o.at), kind: str(o.kind), text: str(o.text) };
    }),
  };
}

function preview(x: unknown): ImportPreview {
  const d = obj(x), c = obj(d.counts), col = obj(d.columns);
  const counts = Object.fromEntries(ACTIONS.map((a) => [a, num(c[a])])) as Record<ImportAction, number>;
  return {
    id: str(d.id),
    total: num(d.total),
    counts,
    columns: { phone: str(col.phone), name: str(col.name), consent: str(col.consent) },
    hasConsent: !!d.hasConsent,
    consentNote: str(d.consentNote),
    rows: arr(d.rows).map((v) => {
      const o = obj(v);
      return { row: num(o.row), phone: str(o.phone), name: str(o.name), action: oneOf<ImportAction>(o.action, ACTIONS, "invalid"), ...(str(o.error) ? { error: str(o.error) } : {}) };
    }),
  };
}

/** Файл импорта — multipart (call умеет только JSON). Ошибки — как у call: нет связи, вход истёк, текст сервера. */
async function upload<T>(path: string, form: FormData): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { method: "POST", credentials: "same-origin", body: form });
  } catch {
    throw new ApiError("Нет связи с сервером. Проверьте интернет — файл не отправлен.", 0, true);
  }
  if (r.status === 401) {
    location.href = "/login?next=" + enc(location.pathname + location.search + location.hash);
    throw new ApiError("Нужно войти заново.", 401);
  }
  return parse<T>(r);
}

export const liveContacts: ContactSource = {
  async contactsStatus(ws) {
    return status(await call<unknown>(`/api/contacts/status?c=${enc(ws)}`));
  },
  async contactSegments(ws): Promise<ContactSegments> {
    const d = obj(await call<unknown>(`/api/contacts/segments?c=${enc(ws)}`));
    return {
      at: num(d.at),
      segments: arr(d.segments).map((v) => {
        const o = obj(v);
        return { id: str(o.id), label: str(o.label), rule: str(o.rule), count: num(o.count), ready: num(o.ready) };
      }),
    };
  },
  async contactList(ws, { q = "", seg = "", page = 1 }): Promise<ContactPage> {
    const qs = [`c=${enc(ws)}`, q ? `q=${enc(q)}` : "", seg ? `seg=${enc(seg)}` : "", page > 1 ? `page=${page}` : ""].filter(Boolean).join("&");
    const d = obj(await call<unknown>(`/api/contacts/list?${qs}`));
    const items = arr(d.items).map(row);
    return { total: num(d.total), page: num(d.page) || page, pages: num(d.pages) || 1, per: num(d.per) || 50, items };
  },
  async contactCard(ws, id) {
    return card(await call<unknown>(`/api/contacts/card?c=${enc(ws)}&id=${enc(id)}`));
  },
  async addContact(ws, phone, name) {
    const d = obj(await call<unknown>("/api/contacts/add", { c: ws, phone, name }));
    return { id: str(d.id), created: !!d.created };
  },
  async setConsent(ws, id, input) {
    await call("/api/contacts/consent", { c: ws, id, ...input });
  },
  async addRestriction(ws, id, kind, reason) {
    await call("/api/contacts/restrict", { c: ws, id, kind, reason });
  },
  async liftRestriction(ws, id, rid, reason) {
    await call("/api/contacts/lift", { c: ws, id, rid, reason });
  },
  async reviewRestriction(ws, id, rid, decision, reason) {
    await call("/api/contacts/review", { c: ws, id, rid, decision, ...(reason ? { reason } : {}) });
  },
  async importPreview(ws, input) {
    if ("file" in input) {
      const f = new FormData();
      f.set("c", ws);
      f.set("file", input.file, input.file.name);
      return preview(await upload<unknown>("/api/contacts/import", f));
    }
    return preview(await call<unknown>("/api/contacts/import", { c: ws, text: input.text }));
  },
  async importConfirm(ws, id, consentBasis) {
    const d = obj(await call<unknown>("/api/contacts/import/confirm", { c: ws, id, ...(consentBasis ? { consentBasis } : {}) }));
    return { created: num(d.created), updated: num(d.updated), consents: num(d.consents), consentsUnconfirmed: num(d.consentsUnconfirmed), consentsSkipped: num(d.consentsSkipped) };
  },
  async importDiscard(ws, id) {
    await call("/api/contacts/import/discard", { c: ws, id });
  },
  async syncContacts(ws, mode) {
    const d = obj(await call<unknown>("/api/contacts/sync", { c: ws, mode }));
    const r = obj(d.report);
    return { sync: syncState(d.sync), ...(Object.keys(r).length ? { report: { summary: strs(r.summary) } } : {}) };
  },
  async probeAltegio(ws) {
    const d = obj(await call<unknown>("/api/contacts/probe", { c: ws }));
    return report(d.report) || { at: Date.now(), ok: false, summary: [] };
  },
  async stopsAction(ws, action) {
    return strs(obj(await call<unknown>("/api/contacts/stops", { c: ws, action })).summary);
  },
};
