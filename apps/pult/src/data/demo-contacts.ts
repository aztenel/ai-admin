// Демо раздела «Клиенты» (часть демо-данных, data/demo.ts): вымышленная база контактов без сети.
// «Демо Барбер» — как Winchester на черновике: база из журнала Altegio (60 человек), черновик — настоящий Altegio только проверкой без
// записи, есть «Тестовые клиенты»; «Демо Сервис» — без Altegio, база из импорта и ручного добавления; «Без чатов» — базы D1 нет.
// Правила и тексты ошибок повторяют сервер (src/controllers/contacts.js): номер — казахстанский, основание согласия и причина запрета
// обязательны, снять запрет может только владелец. Номера придуманы (+7 700 000 xx xx), имена — обычные вымышленные.
import type {
  ConsentPurpose,
  ConsentRecord,
  ConsentState,
  ContactCard,
  ContactPage,
  ContactRow,
  ContactSegments,
  ContactsStatus,
  ImportAction,
  ImportPreview,
  Report,
  Restriction,
  ReviewDecision,
  SyncState,
  Visit,
} from "@/model/contacts";
import { ApiError } from "./errors";
import type { ContactSource } from "./source";

const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;
const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms + Math.random() * 140));
const NAMES = ["Арман", "Данияр", "Ерлан", "Тимур", "Нурлан", "Самат", "Асхат", "Бекзат", "Дастан", "Ильяс", "Канат", "Мади", "Олжас", "Руслан", "Санжар", "Азамат", "Алихан", "Жандос", "Марат", "Ринат"];
const MASTERS = ["Арман", "Данияр", "Ерлан"];
const SERVICES = ["Мужская стрижка", "Стрижка и борода", "Оформление бороды", "Детская стрижка"];
const PER = 50;

type Person = {
  id: string;
  name: string;
  phone: string; // цифры
  altegioId: string;
  visits: Visit[];
  upcoming: Visit[];
  consents: (ConsentRecord & { purpose: ConsentPurpose })[];
  restrictions: Restriction[];
  sources: { source: string; at: number }[];
  events: { at: number; kind: string; text: string }[];
  createdAt: number;
  updatedAt: number;
  syncedAt: number | null;
};
type Ws = {
  ready: boolean;
  why?: string;
  stage: "preview" | "production";
  name: string;
  altegio: boolean;
  people: Person[];
  sync: SyncState;
  stopsAt: number | null;
  stopsFound: number;
  probe: Report | null;
  errors: { at: number; scope: string; text: string }[];
  imports: Map<string, { rows: { row: number; phone: string; name: string; consent: boolean; action: ImportAction; error?: string }[] }>;
  seq: number;
};

// ---------- номера ----------
const digits = (s: string) => String(s || "").replace(/\D/g, "");
/** Казахстанский номер → 11 цифр с 7 (как normPhone сервера) или «». */
export function normPhone(s: string): string {
  let d = digits(s);
  if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
  if (d.length === 10 && d[0] === "7") d = "7" + d;
  return /^7[3-9]\d{9}$/.test(d) ? d : "";
}
const mask = (d: string) => (d.length >= 10 ? `+${d[0]} ${d.slice(1, 4)} *** ** ${d.slice(-2)}` : "");

// ---------- вымышленная база ----------
function rnd(seed: number) {
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
}
const dayAt = (now: number, daysAgo: number, hour: number) => {
  // полдень по Астане daysAgo дней назад, потом час записи
  const d = new Date(now + 5 * HOUR);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - 5 * HOUR - daysAgo * DAY + hour * HOUR;
};

function makePeople(now: number, n: number, seed: number, prefix: string, altegio: boolean): Person[] {
  const r = rnd(seed);
  const out: Person[] = [];
  for (let i = 1; i <= n; i++) {
    const phone = `7700000${prefix}${String(i).padStart(2, "0")}`;
    const name = i % 13 === 0 ? "" : NAMES[(i * 7) % NAMES.length];
    const staff = MASTERS[i % 3];
    const last = 3 + Math.floor(r() * 95);
    const count = altegio ? 1 + Math.floor(r() * 5) : 0;
    const visits: Visit[] = [];
    for (let k = 0; k < count; k++) {
      const ago = last + k * (20 + Math.floor(r() * 18));
      if (ago > 240) break;
      visits.push({ id: `v${i}-${k}`, at: dayAt(now, ago, 11 + ((i + k) % 8)), staff: MASTERS[(i + k) % 3], services: SERVICES[(i * 5 + k) % 4], attendance: i % 17 === 0 && k === 1 ? -1 : 1 });
    }
    const upcoming: Visit[] = altegio && i % 7 === 0 ? [{ id: `u${i}`, at: dayAt(now, -(1 + (i % 9)), 12 + (i % 6)), staff, services: SERVICES[i % 4], attendance: 0 }] : [];
    const created = now - (count ? 200 : 20 + (i % 30)) * DAY;
    const p: Person = {
      id: `${prefix}-${i}`,
      name,
      phone,
      altegioId: altegio ? String(5000 + i) : "",
      visits,
      upcoming,
      consents: [],
      restrictions: [],
      sources: [{ source: altegio ? "altegio" : i % 2 ? "import" : "manual", at: created }],
      events: [],
      createdAt: created,
      updatedAt: now - (i % 5) * HOUR,
      syncedAt: altegio ? now - 12 * MIN : null,
    };
    if (i % 4 === 0) p.consents.push({ purpose: "marketing", state: "granted", basis: "анкета в салоне", source: "manual", actor: "администратор", at: now - 40 * DAY });
    if (i % 11 === 0) p.consents.push({ purpose: "marketing", state: "denied", basis: "сказал устно", source: "manual", actor: "администратор", at: now - 10 * DAY });
    if (i % 9 === 0) p.restrictions.push(restr(`r${i}`, "marketing_optout", "Клиент написал «СТОП»", "chat_stop", "бот", now - 8 * DAY));
    if (i === 10) p.restrictions.push(restr(`rv${i}`, "marketing_optout", "Клиент написал «пока не пишите»", "chat_stop", "бот", now - 2 * DAY, true));
    if (i === 22) p.restrictions.push(restr(`rf${i}`, "full_block", "Просил не писать вообще, звонил в салон", "admin", "владелец", now - 30 * DAY));
    if (i === 15) {
      const x = restr(`rl${i}`, "marketing_optout", "Клиент написал «стоп»", "chat_stop", "бот", now - 60 * DAY);
      Object.assign(x, { liftedAt: now - 20 * DAY, liftedBy: "владелец", liftReason: "сам попросил снова присылать акции", active: false });
      p.restrictions.push(x);
    }
    for (const v of p.visits.slice(0, 2)) p.events.push({ at: v.at, kind: "visit", text: `Визит: ${v.services}, мастер ${v.staff}${v.attendance === -1 ? " — не пришёл" : ""}` });
    for (const x of p.restrictions) p.events.push({ at: x.at, kind: "restriction", text: `${x.kind === "full_block" ? "Не писать вообще" : "Не писать рекламу"}: ${x.reason}` });
    p.events.sort((a, b) => b.at - a.at);
    out.push(p);
  }
  return out;
}
function restr(id: string, kind: Restriction["kind"], reason: string, source: string, actor: string, at: number, review = false): Restriction {
  return { id, kind, reason, source, actor, at, review, liftedAt: null, liftedBy: "", liftReason: "", active: true };
}

function syncOf(now: number, altegio: boolean, preview: boolean): SyncState {
  if (!altegio)
    return {
      available: false,
      why: "Altegio у этой компании не подключён — база только из импорта и ручного добавления.",
      dryOnly: false,
      initial: { done: false, from: "", to: "", cursor: "", pct: 0 },
      lastOkAt: null,
      lastError: null,
      lastErrorAt: null,
      running: false,
      windows: [],
      stats: null,
    };
  return {
    available: true,
    dryOnly: preview,
    initial: { done: true, from: "2025-10-01", to: "2026-12-30", cursor: "2026-12-30", pct: 100 },
    lastOkAt: now - 12 * MIN,
    lastError: null,
    lastErrorAt: null,
    running: false,
    windows: [
      { scope: "hot", label: "Вчера и 2 недели вперёд — каждые 15 минут", lastOkAt: now - 12 * MIN, lastError: null },
      { scope: "future", label: "Записи на 60 дней — каждый час", lastOkAt: now - 48 * MIN, lastError: null },
      { scope: "past", label: "Визиты за месяц — ночью", lastOkAt: now - 9 * HOUR, lastError: "Altegio не ответил вовремя — попробую в следующий раз" },
    ],
    stats: { records: 214, contacts: 60, bookings: 214, masked: 1, bad: 0, deleted: 6 },
  };
}

// ---------- сегменты (как на сервере: дни с визита — по календарю Астаны) ----------
const astanaDayNo = (t: number) => Math.floor((t + 5 * HOUR) / DAY);
const lastVisit = (p: Person, now: number) => p.visits.filter((v) => v.attendance !== -1 && v.at <= now).reduce((m, v) => Math.max(m, v.at), 0) || null;
const visitCount = (p: Person, now: number) => new Set(p.visits.filter((v) => v.attendance !== -1 && v.at <= now).map((v) => astanaDayNo(v.at))).size;
const daysSince = (p: Person, now: number) => {
  const l = lastVisit(p, now);
  return l ? astanaDayNo(now) - astanaDayNo(l) : null;
};
const nextBooking = (p: Person, now: number) => p.upcoming.filter((v) => v.at > now).reduce((m, v) => (m && m < v.at ? m : v.at), 0) || null;
const active = (p: Person) => p.restrictions.filter((x) => x.active);
const consentNow = (p: Person, purpose: ConsentPurpose) => [...p.consents].reverse().find((c) => c.purpose === purpose) || null;

const SEGS: { id: string; label: string; rule: string; test: (p: Person, now: number) => boolean }[] = [
  { id: "pora", label: "Пора на стрижку", rule: "последний визит 21–35 дней назад", test: (p, n) => inRange(daysSince(p, n), 21, 35) },
  { id: "davno", label: "Давно не были", rule: "36–60 дней", test: (p, n) => inRange(daysSince(p, n), 36, 60) },
  { id: "uhodyat", label: "Уходят", rule: "61–90 дней", test: (p, n) => inRange(daysSince(p, n), 61, 90) },
  { id: "novye", label: "Новые", rule: "1 визит", test: (p, n) => visitCount(p, n) === 1 },
  { id: "postoyannye", label: "Постоянные", rule: "3 и больше визитов", test: (p, n) => visitCount(p, n) >= 3 },
  { id: "booked", label: "Записаны", rule: "есть будущая запись", test: (p, n) => !!nextBooking(p, n) },
  { id: "noconsent", label: "Без согласия", rule: "согласия на рекламу нет", test: (p) => consentNow(p, "marketing")?.state !== "granted" },
];
const inRange = (d: number | null, a: number, b: number) => d !== null && d >= a && d <= b;

/** Почему нельзя писать рекламу (пусто — можно). */
function marketReasons(p: Person, now: number): string[] {
  const out: string[] = [];
  const act = active(p);
  if (act.some((x) => x.kind === "full_block")) out.push("просил не писать вообще");
  if (act.some((x) => x.kind === "marketing_optout" && !x.review)) out.push("просил не писать рекламу («стоп»)");
  if (act.some((x) => x.review)) out.push("«стоп» ждёт решения");
  if (consentNow(p, "marketing")?.state !== "granted") out.push("нет согласия на рекламу");
  if (nextBooking(p, now)) out.push("уже записан");
  const d = daysSince(p, now);
  if (d !== null && d < 14) out.push("был меньше 14 дней назад");
  return out;
}

// ---------- импорт: простая разборка CSV/TSV, как у сервера ----------
function splitLine(line: string): string[] {
  const sep = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
  return line.split(sep).map((x) => x.trim().replace(/^"(.*)"$/, "$1"));
}
const YES = /^(да|yes|1|согласен|согласна|true|\+)$/i;

export function createDemoContacts(role: () => "owner" | "staff"): ContactSource {
  const now0 = Date.now();
  const all: Record<string, Ws> = {
    demo: {
      ready: true,
      stage: "preview",
      name: "Демо Барбер",
      altegio: true,
      people: makePeople(now0, 60, 11, "20", true),
      sync: syncOf(now0, true, true),
      stopsAt: now0 - 7 * MIN,
      stopsFound: 0,
      probe: null,
      errors: [{ at: now0 - 9 * HOUR, scope: "past", text: "Altegio не ответил вовремя — попробую в следующий раз" }],
      imports: new Map(),
      seq: 0,
    },
    "demo-service": {
      ready: true,
      stage: "production",
      name: "Демо Сервис",
      altegio: false,
      people: makePeople(now0, 8, 5, "40", false),
      sync: syncOf(now0, false, false),
      stopsAt: null,
      stopsFound: 0,
      probe: null,
      errors: [],
      imports: new Map(),
      seq: 0,
    },
    "demo-empty": {
      ready: false,
      why: "База клиентов ещё не подключена: нужна база D1. На боевом сайте её включат после решения владельца.",
      stage: "production",
      name: "Без чатов",
      altegio: false,
      people: [],
      sync: syncOf(now0, false, false),
      stopsAt: null,
      stopsFound: 0,
      probe: null,
      errors: [],
      imports: new Map(),
      seq: 0,
    },
  };
  const ws = (id: string) => {
    const w = all[id];
    if (!w) throw new ApiError("Нет доступа к этому клиенту.", 403);
    if (!w.ready) throw new ApiError(w.why || "База клиентов не подключена.", 503);
    return w;
  };
  const person = (w: Ws, id: string) => {
    const p = w.people.find((x) => x.id === id);
    if (!p) throw new ApiError("Клиент не найден.", 404);
    return p;
  };
  const ownerOnly = (what: string) => {
    if (role() !== "owner") throw new ApiError(`${what} может только владелец.`, 403);
  };
  const actor = () => (role() === "owner" ? "владелец" : "сотрудник");
  const log = (p: Person, kind: string, text: string) => p.events.unshift({ at: Date.now(), kind, text });

  const checks = (w: Ws, now: number) => {
    const review = w.people.filter((p) => active(p).some((x) => x.review)).length;
    return [
      { id: "masked", label: "Скрытые номера в журнале", count: w.altegio ? 1 : 0, level: w.altegio ? ("warn" as const) : ("ok" as const), hint: "У ключа журнала нет права видеть телефоны — такие записи в базу не попадают." },
      { id: "stale", label: "Устаревшая «ближайшая запись»", count: 0, level: "ok" as const, hint: "Запись уже прошла, а в базе ещё стоит как будущая. Исправляет ночной пересчёт." },
      { id: "visits", label: "Число визитов не сходится с записями", count: 0, level: "ok" as const, hint: "" },
      { id: "sync_issues", label: "Расхождения «стоп» между хранилищами", count: 0, level: "ok" as const, hint: "Запрет записан в одном хранилище, а в другом нет; запрет при этом действует." },
      { id: "review", label: "«Стоп» ждёт решения", count: review, level: review ? ("warn" as const) : ("ok" as const), hint: "Клиент написал что-то похожее на «стоп» — реклама закрыта, пока человек не решит." },
      { id: "sync_age", label: "Синхронизация давно не проходила", count: w.altegio && w.sync.lastOkAt && now - w.sync.lastOkAt > 2 * HOUR ? 1 : 0, level: "ok" as const, hint: "Больше 2 часов без удачной синхронизации." },
    ];
  };

  return {
    async contactsStatus(id): Promise<ContactsStatus> {
      await wait(160);
      const w = all[id];
      if (!w) throw new ApiError("Нет доступа к этому клиенту.", 403);
      const now = Date.now();
      const counts = {
        contacts: w.people.length,
        withVisits: w.people.filter((p) => visitCount(p, now) > 0).length,
        upcoming: w.people.filter((p) => nextBooking(p, now)).length,
        stops: w.people.filter((p) => active(p).some((x) => x.kind === "marketing_optout" || x.kind === "full_block")).length,
        review: w.people.filter((p) => active(p).some((x) => x.review)).length,
      };
      return {
        ready: w.ready,
        ...(w.why ? { why: w.why } : {}),
        stage: w.stage,
        owner: role() === "owner",
        client: { id, name: w.name },
        counts,
        sync: structuredClone(w.sync),
        stops: { lastOkAt: w.stopsAt, lastError: null, found: w.stopsFound, channel: w.altegio ? "ga" : null },
        probe: w.probe ? structuredClone(w.probe) : null,
        checks: w.ready ? checks(w, now) : [],
        errors: [...w.errors],
      };
    },
    async contactSegments(id): Promise<ContactSegments> {
      await wait(200);
      const w = ws(id), now = Date.now();
      return {
        at: now,
        segments: SEGS.map((s) => {
          const ppl = w.people.filter((p) => s.test(p, now));
          return { id: s.id, label: s.label, rule: s.rule, count: ppl.length, ready: ppl.filter((p) => !marketReasons(p, now).length).length };
        }),
      };
    },
    async contactList(id, { q = "", seg = "", page = 1 }): Promise<ContactPage> {
      await wait(240);
      const w = ws(id), now = Date.now();
      const qd = digits(q), ql = q.trim().toLowerCase();
      const s = SEGS.find((x) => x.id === seg);
      if (seg && !s) throw new ApiError("Неизвестный сегмент.", 400);
      const list = w.people
        .filter((p) => !s || s.test(p, now))
        .filter((p) => !ql || (qd.length >= 3 && p.phone.includes(qd)) || p.name.toLowerCase().includes(ql))
        .sort((a, b) => (lastVisit(b, now) || b.createdAt) - (lastVisit(a, now) || a.createdAt));
      const pages = Math.max(1, Math.ceil(list.length / PER));
      const items = list.slice((page - 1) * PER, page * PER).map((p): ContactRow => {
        const act = active(p);
        return {
          id: p.id,
          name: p.name,
          phone: mask(p.phone),
          lastVisitAt: lastVisit(p, now),
          visits: visitCount(p, now),
          nextBookingAt: nextBooking(p, now),
          lastStaff: p.visits.find((v) => v.attendance !== -1)?.staff || "",
          consent: consentNow(p, "marketing")?.state || "unknown",
          stop: act.some((x) => x.kind === "marketing_optout" && !x.review),
          fullBlock: act.some((x) => x.kind === "full_block"),
          review: act.some((x) => x.review),
          sources: [...new Set(p.sources.map((x) => x.source))],
        };
      });
      return { total: list.length, page, pages, per: PER, items };
    },
    async contactCard(id, cid): Promise<ContactCard> {
      await wait(200);
      const w = ws(id), p = person(w, cid), now = Date.now();
      const done = p.visits.filter((v) => v.at <= now);
      return {
        contact: {
          id: p.id,
          name: p.name,
          phone: "+" + p.phone,
          altegioId: p.altegioId,
          firstVisitAt: done.filter((v) => v.attendance !== -1).reduce((m, v) => (m && m < v.at ? m : v.at), 0) || null,
          lastVisitAt: lastVisit(p, now),
          visits: visitCount(p, now),
          nextBookingAt: nextBooking(p, now),
          lastStaff: done.find((v) => v.attendance !== -1)?.staff || "",
          lastService: done.find((v) => v.attendance !== -1)?.services || "",
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          syncedAt: p.syncedAt,
          sources: structuredClone(p.sources),
        },
        visits: [...done].sort((a, b) => b.at - a.at),
        upcoming: p.upcoming.filter((v) => v.at > now),
        missed: done.filter((v) => v.attendance === -1).length,
        consent: { marketing: consentNow(p, "marketing"), service: consentNow(p, "service") },
        consentHistory: [...p.consents].reverse(),
        restrictions: [...p.restrictions].sort((a, b) => Number(b.active) - Number(a.active) || b.at - a.at),
        segments: SEGS.filter((s) => s.test(p, now)).map((s) => ({ id: s.id, label: s.label })),
        canMarket: { ok: !marketReasons(p, now).length, reasons: marketReasons(p, now) },
        events: structuredClone(p.events),
      };
    },
    async addContact(id, phone, name) {
      await wait(300);
      const w = ws(id), d = normPhone(phone);
      if (!d) throw new ApiError("Номер не похож на казахстанский: нужно 11 цифр, например +7 700 000 00 00.", 400, false, { field: "phone" });
      const have = w.people.find((p) => p.phone === d);
      if (have) return { id: have.id, created: false };
      const now = Date.now();
      const p: Person = {
        id: `m-${++w.seq}`,
        name: name.trim().slice(0, 60),
        phone: d,
        altegioId: "",
        visits: [],
        upcoming: [],
        consents: [],
        restrictions: [],
        sources: [{ source: "manual", at: now }],
        events: [{ at: now, kind: "created", text: `Добавлен вручную (${actor()})` }],
        createdAt: now,
        updatedAt: now,
        syncedAt: null,
      };
      w.people.unshift(p);
      return { id: p.id, created: true };
    },
    async setConsent(id, cid, purpose, state: ConsentState, basis) {
      await wait(260);
      const p = person(ws(id), cid);
      if (state === "granted" && !basis.trim()) throw new ApiError("Укажите основание согласия: где и как клиент согласился.", 400, false, { field: "basis" });
      p.consents.push({ purpose, state, basis: basis.trim(), source: "manual", actor: actor(), at: Date.now() });
      log(p, "consent", `${purpose === "marketing" ? "Согласие на рекламу" : "Сервисные сообщения"}: ${state === "granted" ? "да" : state === "denied" ? "нет" : "неизвестно"}${basis.trim() ? ` (${basis.trim()})` : ""}`);
    },
    async addRestriction(id, cid, kind, reason) {
      await wait(260);
      const p = person(ws(id), cid);
      if (!reason.trim()) throw new ApiError("Напишите причину запрета.", 400, false, { field: "reason" });
      if (active(p).some((x) => x.kind === kind && !x.review)) throw new ApiError("Такой запрет уже действует.", 409);
      p.restrictions.unshift(restr(`r${Date.now()}`, kind, reason.trim(), "admin", actor(), Date.now()));
      log(p, "restriction", `${kind === "full_block" ? "Не писать вообще" : "Не писать рекламу"}: ${reason.trim()}`);
    },
    async liftRestriction(id, cid, rid, reason) {
      await wait(260);
      ownerOnly("Снять запрет");
      const p = person(ws(id), cid), x = p.restrictions.find((r) => r.id === rid && r.active);
      if (!x) throw new ApiError("Запрет не найден или уже снят.", 404);
      if (!reason.trim()) throw new ApiError("Напишите, почему снимаете запрет.", 400, false, { field: "reason" });
      Object.assign(x, { active: false, review: false, liftedAt: Date.now(), liftedBy: actor(), liftReason: reason.trim() });
      log(p, "lift", `Запрет снят: ${reason.trim()}`);
    },
    async reviewRestriction(id, cid, rid, decision: ReviewDecision, reason) {
      await wait(260);
      const p = person(ws(id), cid), x = p.restrictions.find((r) => r.id === rid && r.active && r.review);
      if (!x) throw new ApiError("Решение уже принято.", 409);
      if (decision === "lift") {
        ownerOnly("Снять запрет");
        if (!reason?.trim()) throw new ApiError("Напишите, почему снимаете запрет.", 400, false, { field: "reason" });
        Object.assign(x, { active: false, review: false, liftedAt: Date.now(), liftedBy: actor(), liftReason: reason.trim() });
        log(p, "lift", `«Стоп» снят: ${reason.trim()}`);
        return;
      }
      x.review = false;
      if (decision === "all") p.restrictions.unshift(restr(`rf${Date.now()}`, "full_block", "Решение по «стоп»: не писать вообще", "admin", actor(), Date.now()));
      log(p, "review", decision === "all" ? "Решение по «стоп»: закрыть все сообщения" : "Решение по «стоп»: оставить запрет рекламы");
    },
    async importPreview(id, input): Promise<ImportPreview> {
      await wait(500);
      const w = ws(id);
      let text: string;
      if ("file" in input) {
        if (/\.xlsx$/i.test(input.file.name)) throw new ApiError("В демо файл Excel не разбирается — сохраните таблицу как CSV. На сервере .xlsx принимается.", 400);
        if (/\.xls$/i.test(input.file.name)) throw new ApiError("Старый формат .xls не поддерживается — сохраните таблицу как .xlsx или .csv.", 400);
        text = await input.file.text();
      } else text = input.text;
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!lines.length) throw new ApiError("В файле нет строк.", 400);
      let head = splitLine(lines[0]).map((h) => h.toLowerCase());
      const isHead = head.some((h) => /телефон|номер|phone|имя|name/.test(h)) && !head.some((h) => normPhone(h));
      const pi = isHead ? head.findIndex((h) => /телефон|номер|phone/.test(h)) : 0;
      const ni = isHead ? head.findIndex((h) => /имя|name|клиент/.test(h)) : 1;
      const ci = isHead ? head.findIndex((h) => /соглас|consent/.test(h)) : -1;
      if (!isHead) head = [];
      const seen = new Set<string>();
      const rows = lines.slice(isHead ? 1 : 0).map((l, k) => {
        const c = splitLine(l), d = normPhone(c[pi] || ""), nm = (ni >= 0 ? c[ni] || "" : "").slice(0, 60);
        const r = { row: k + (isHead ? 2 : 1), phone: d, name: nm, consent: ci >= 0 && YES.test(c[ci] || ""), action: "new" as ImportAction, error: undefined as string | undefined };
        if (!d) Object.assign(r, { action: "invalid", error: c[pi] ? "номер не похож на казахстанский" : "нет номера" });
        else if (seen.has(d)) Object.assign(r, { action: "dup", error: "этот номер уже был выше в файле" });
        else {
          seen.add(d);
          const have = w.people.find((p) => p.phone === d);
          if (have) r.action = nm && nm !== have.name ? "update" : "same";
        }
        return r;
      });
      const counts = { new: 0, update: 0, same: 0, dup: 0, invalid: 0 } as Record<ImportAction, number>;
      for (const r of rows) counts[r.action]++;
      const iid = `imp${++w.seq}`;
      w.imports.set(iid, { rows });
      const order: Record<ImportAction, number> = { invalid: 0, dup: 1, new: 2, update: 3, same: 4 };
      return {
        id: iid,
        total: rows.length,
        counts,
        columns: { phone: isHead ? head[pi] || "" : "1-я колонка", name: ni >= 0 ? (isHead ? head[ni] || "" : "2-я колонка") : "", consent: ci >= 0 ? head[ci] || "" : "" },
        hasConsent: ci >= 0,
        rows: [...rows].sort((a, b) => order[a.action] - order[b.action] || a.row - b.row).slice(0, 200).map((r) => ({ row: r.row, phone: r.phone ? mask(r.phone) : "", name: r.name, action: r.action, ...(r.error ? { error: r.error } : {}) })),
      };
    },
    async importConfirm(id, iid, consentBasis) {
      await wait(500);
      const w = ws(id), imp = w.imports.get(iid);
      if (!imp) throw new ApiError("Загрузка уже подтверждена или отменена.", 409);
      w.imports.delete(iid);
      const now = Date.now();
      let created = 0, updated = 0, consents = 0;
      for (const r of imp.rows) {
        if (r.action !== "new" && r.action !== "update" && r.action !== "same") continue;
        let p = w.people.find((x) => x.phone === r.phone);
        if (!p) {
          p = { id: `i-${++w.seq}`, name: r.name, phone: r.phone, altegioId: "", visits: [], upcoming: [], consents: [], restrictions: [], sources: [{ source: "import", at: now }], events: [{ at: now, kind: "created", text: "Загружен из файла" }], createdAt: now, updatedAt: now, syncedAt: null };
          w.people.unshift(p);
          created++;
        } else if (r.action === "update") {
          p.name = r.name;
          p.updatedAt = now;
          updated++;
        }
        if (r.consent && consentBasis?.trim() && consentNow(p, "marketing")?.state !== "granted") {
          p.consents.push({ purpose: "marketing", state: "granted", basis: consentBasis.trim(), source: "import", actor: actor(), at: now });
          consents++;
        }
      }
      return { created, updated, consents };
    },
    async importDiscard(id, iid) {
      await wait(150);
      ws(id).imports.delete(iid);
    },
    async syncContacts(id, mode) {
      await wait(mode === "step" ? 900 : 700);
      ownerOnly("Запустить синхронизацию");
      const w = ws(id);
      if (!w.altegio && mode !== "test") throw new ApiError(w.sync.why || "Altegio не подключён.", 409);
      const now = Date.now();
      if (mode === "step") {
        if (w.sync.dryOnly) throw new ApiError("На черновике настоящий Altegio не записывается в базу — нажмите «Проверка без записи».", 409);
        w.sync.lastOkAt = now;
        for (const x of w.sync.windows) if (x.scope === "hot") x.lastOkAt = now;
        return { sync: structuredClone(w.sync), report: { summary: ["Прочитано записей журнала: 38", "Новых клиентов: 0, изменились: 2", "Удалённых записей: 1"] } };
      }
      if (mode === "dry")
        return {
          sync: structuredClone(w.sync),
          report: { summary: ["Проверка без записи: в базу ничего не записано", "Журнал за 400 дней: 2 140 записей, 11 страниц", "Клиентов с номером: 1 087, скрытых номеров: 31, неверных: 4", "Будущих записей: 85, удалённых: 17", "Время: 14 с"] },
        };
      if (w.stage !== "preview") throw new ApiError("Тестовые клиенты — только на черновике.", 409);
      const add = makePeople(now, 5, 99 + w.seq, "9" + String(++w.seq % 10), true);
      for (const p of add) if (!w.people.some((x) => x.phone === p.phone)) w.people.unshift(p);
      return { sync: structuredClone(w.sync), report: { summary: [`Тестовые клиенты: добавлено ${add.length} (номера +7 700 000 9x xx)`, "Записаны тем же кодом, что и журнал Altegio"] } };
    },
    async probeAltegio(id) {
      await wait(900);
      ownerOnly("Проверить поля Altegio");
      const w = ws(id);
      if (!w.altegio) throw new ApiError(w.sync.why || "Altegio не подключён.", 409);
      w.probe = {
        at: Date.now(),
        ok: true,
        summary: [
          "Журнал записей читается: 50 записей за ±30 дней (только чтение)",
          "create_date — есть у 50 из 50",
          "attendance: 1 — 31, 0 — 15, −1 — 2, 2 — 2",
          "Номера: полностью — 49, скрытые — 1",
          "Удалённые записи журнал отдаёт: 0 из 50",
          "Фильтр changed_after: работает (12 записей за 2 дня)",
          "Карточка клиента: поля согласия не найдены",
        ],
      };
      return structuredClone(w.probe);
    },
    async stopsAction(id, action) {
      await wait(700);
      ownerOnly("Сверка «стопов»");
      const w = ws(id);
      if (action === "sweep") {
        if (!w.altegio) throw new ApiError("Номера Green-API у компании нет.", 409);
        w.stopsAt = Date.now();
        return ["Журнал входящих Green-API за 24 часа: 41 сообщение", "«Стоп»: 0 новых (все уже записаны)", "Неоднозначных: 0"];
      }
      if (action === "migrate-check") return ["Старый список «стоп» (KV): 9 номеров", "Уже в базе: 9, перенести: 0, неверных ключей: 0", "Ничего не записано"];
      return ["Перенесено: 0 (всё уже было в базе)", "Старый список не менялся"];
    },
  };
}
