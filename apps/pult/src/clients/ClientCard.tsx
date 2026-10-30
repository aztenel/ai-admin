// Карточка клиента (раздел «Клиенты»): кто это (номер полностью — это карточка одного человека), можно ли писать рекламу и почему нет,
// визиты (из журнала Altegio — правда о записях), ближайшие записи, согласия с историей, запреты с историей (кто, когда, причина),
// сегменты и журнал событий. Изменить: согласие (для «есть» — чем подтверждено: сообщение клиента, письменное или устно; основание
// обязательно), добавить запрет (причина обязательна), снять запрет (только владелец, с причиной), решение по неоднозначному «стоп».
// Запрет, который поставил сам клиент («стоп»), снимается только после его нового подтверждённого согласия: «Снять» неактивна, рядом —
// «Записать новое согласие» (31.10.2026, правило владельца: отказ клиента не обходится без его согласия). Согласие из файла —
// «не подтверждено» и кнопка «Подтвердить». После каждого действия карточка перечитывается с сервера.
import { Ban, CalendarDays, CircleAlert, CircleCheck, Clock, History, Phone, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Notice, Stats, nf } from "@/campaigns/base/shared";
import { RadioRow, SelectField, TextField } from "@/campaigns/wizard/fields";
import { toast } from "@/components/overlay";
import { Avatar, Button, buttonClass, Field, InsetGroup, Segmented, Skeleton } from "@/components/ui";
import { dataMode } from "@/data/source";
import { formatPhone, plural } from "@/lib/format";
import { cn, useNow } from "@/lib/utils";
import type { ConsentInput, ConsentPurpose, ConsentRecord, ConsentState, ContactCard, Restriction, Visit } from "@/model/contacts";
import { store } from "@/state/store";
import { agoText, CONSENT_LABEL, consentText, dateTime, dayText, errField, errMsg, KIND_LABEL, sourceText, useFetch } from "./common";

const SHOW = 10;

type Props = { ws: string; id: string; owner: boolean; dup?: boolean; onTitle: (t: string) => void; onChanged: () => void };

export function ClientCard({ ws, id, owner, dup, onTitle, onChanged }: Props) {
  const now = useNow();
  const card = useFetch(() => store.source!.contactCard(ws, id), [ws, id]);
  const d = card.data;
  useEffect(() => {
    onTitle(d ? d.contact.name || "Без имени" : "");
  }, [d, onTitle]);
  /** Действие выполнено — перечитать карточку и список. */
  const done = async (msg: string) => {
    toast(msg);
    await card.reload();
    onChanged();
  };
  // редактор согласия открывается и из блока «Согласие», и из запрета клиента («Записать новое согласие»)
  const [consentOpen, setConsentOpen] = useState<{ n: number } | null>(null);
  const openConsent = useCallback(() => setConsentOpen((x) => ({ n: (x?.n || 0) + 1 })), []);

  if (card.loading && !d) return <CardSkeleton />;
  if (!d)
    return (
      <div className="scroll-area min-h-0 flex-1 px-4 pt-4 md:px-6">
        <Notice tone="critical" role="alert">
          Карточка не загрузилась: {card.error}
        </Notice>
        <Button variant="outline" icon={RefreshCw} onClick={() => void card.reload()}>
          Повторить
        </Button>
      </div>
    );
  const c = d.contact;
  const phone = formatPhone(c.phone);
  return (
    <div className="scroll-area min-h-0 flex-1">
      <div className="px-4 pb-[max(1.5rem,var(--safe-b))] pt-2 md:px-6 md:pt-5">
        <div className="flex flex-col items-center pb-5 pt-3 text-center">
          <Avatar name={c.name} size="xl" />
          <p className={cn("mt-3 max-w-full break-words text-[1.375rem] font-bold leading-7 tracking-[-0.02em] md:text-xl md:font-semibold", !c.name && "text-fg-2")}>{c.name || "Без имени"}</p>
          <p className="tnum mt-0.5 text-[0.9375rem] text-fg-2">{phone}</p>
          {/* в демо номер вымышленный — не набираем */}
          {dataMode() === "live" && c.phone && (
            <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className={buttonClass("tinted", "md", "mt-3")}>
              <Phone aria-hidden className="size-4" strokeWidth={2} />
              Позвонить
            </a>
          )}
        </div>
        {dup && (
          <Notice role="status">Этот номер уже есть в базе — открыта его карточка, второй клиент не создан.</Notice>
        )}
        {card.error && <p role="alert" className="mb-3 text-sm text-critical">Не обновилось: {card.error}</p>}

        <Market d={d} />

        <InsetGroup title="Визиты">
          <Stats
            items={[
              { label: "Визитов", value: nf.format(c.visits), sub: d.missed ? `не пришёл: ${d.missed}` : "всего" },
              { label: "Последний визит", value: c.lastVisitAt ? agoText(c.lastVisitAt, now, c.daysAgo) : "—", sub: c.lastVisitAt ? [dayText(c.lastVisitAt, now), c.lastStaff].filter(Boolean).join(" · ") : undefined },
            ]}
          />
          {c.firstVisitAt && (
            <dl>
              <Field label="Первый визит">{dayText(c.firstVisitAt, now)}</Field>
            </dl>
          )}
          {d.upcoming.length > 0 ? (
            <div className="py-3">
              <p className="mb-1.5 text-sm font-medium text-fg-2">Ближайшие записи</p>
              <ul aria-label="Ближайшие записи" className="space-y-1.5">
                {d.upcoming.map((v) => (
                  <li key={v.id} className="flex items-start gap-2 text-ui pointer-coarse:text-base">
                    <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={2} />
                    <span className="min-w-0">
                      <span className="font-medium">{dateTime(v.at, now)}</span>
                      <span className="text-fg-2">{[v.services, v.staff && `мастер ${v.staff}`].filter(Boolean).map((x) => ` · ${x}`)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="py-3 text-ui text-fg-3 pointer-coarse:text-base">Будущих записей нет.</p>
          )}
        </InsetGroup>

        <VisitHistory visits={d.visits} now={now} />

        <ConsentBlock ws={ws} id={id} d={d} now={now} onDone={done} open={consentOpen} onClosed={() => setConsentOpen(null)} onOpen={openConsent} />
        <RestrictionsBlock ws={ws} id={id} d={d} now={now} owner={owner} onDone={done} onNewConsent={openConsent} />

        {d.segments.length > 0 && (
          <InsetGroup title="Сегменты">
            <p className="flex flex-wrap gap-1.5 py-3">
              {d.segments.map((s) => (
                <span key={s.id} className="inline-flex h-7 items-center rounded-full bg-surface-2 px-2.5 text-sm text-fg">
                  {s.label}
                </span>
              ))}
            </p>
          </InsetGroup>
        )}

        <InsetGroup title="О клиенте">
          <dl>
            <Field label="Откуда">{c.sources.length ? [...new Set(c.sources.map((s) => sourceText(s.source)))].join(", ") : "—"}</Field>
            {c.altegioId && <Field label="Номер в Altegio">{c.altegioId}</Field>}
            {c.altVisits !== null && (
              <Field label="Визитов по Altegio">
                {nf.format(c.altVisits)}
                {c.altLastVisitAt ? `, последний ${dayText(c.altLastVisitAt, now)}` : ""}
              </Field>
            )}
            {c.newsletter !== null && (
              <Field stacked label="Altegio: разрешил рассылки">
                <span>
                  {c.newsletter ? "да" : "нет"}
                  <span className="block text-sm text-fg-3">Это отметка в Altegio, а не подтверждённое согласие.</span>
                </span>
              </Field>
            )}
            {c.lastService && <Field label="Последняя услуга">{c.lastService}</Field>}
            <Field label="В базе с">{c.createdAt ? dateTime(c.createdAt, now) : "—"}</Field>
            {c.syncedAt && <Field label="Сверено с Altegio">{dateTime(c.syncedAt, now)}</Field>}
          </dl>
        </InsetGroup>

        {d.events.length > 0 && (
          <InsetGroup title="Журнал">
            <ul aria-label="Журнал событий">
              {d.events.slice(0, 30).map((e, i) => (
                <li key={i} className="flex gap-3 border-line py-2.5 [&+&]:border-t">
                  <span className="tnum w-[7.5rem] shrink-0 text-sm text-fg-3">{dateTime(e.at, now)}</span>
                  <span className="min-w-0 text-ui text-fg pointer-coarse:text-base">{e.text}</span>
                </li>
              ))}
            </ul>
          </InsetGroup>
        )}
      </div>
    </div>
  );
}

/** Можно ли писать рекламу — одной строкой сверху, причины списком. */
function Market({ d }: { d: ContactCard }) {
  const ok = d.canMarket.ok;
  return (
    <div className={cn("mb-6 flex gap-2.5 rounded-[0.875rem] px-4 py-3 text-ui pointer-coarse:text-base", ok ? "bg-positive-soft text-positive" : "bg-surface text-fg")}>
      {ok ? <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} /> : <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-critical" strokeWidth={2} />}
      <div className="min-w-0">
        <p className="font-medium">{ok ? "Рекламу писать можно" : "Рекламу писать нельзя"}</p>
        {!ok && d.canMarket.reasons.length > 0 && <p className="mt-0.5 text-fg-2">{d.canMarket.reasons.join(" · ")}</p>}
        {ok && <p className="mt-0.5 text-sm">Есть согласие, запретов нет. Сервисные напоминания — по своим правилам.</p>}
      </div>
    </div>
  );
}

function VisitHistory({ visits, now }: { visits: Visit[]; now: number }) {
  const [all, setAll] = useState(false);
  if (!visits.length)
    return (
      <InsetGroup title="История визитов">
        <p className="py-3 text-ui text-fg-3 pointer-coarse:text-base">Визитов в журнале нет.</p>
      </InsetGroup>
    );
  const shown = all ? visits : visits.slice(0, SHOW);
  return (
    <InsetGroup title={`История визитов · ${visits.length} ${plural(visits.length, ["запись", "записи", "записей"])}`}>
      <ul aria-label="История визитов">
        {shown.map((v) => (
          <li key={v.id} className="flex items-start justify-between gap-3 border-line py-2.5 [&+&]:border-t">
            <span className="min-w-0">
              <span className={cn("block text-ui font-medium pointer-coarse:text-base", v.attendance === -1 && "text-fg-2 line-through decoration-fg-3")}>{v.services || "Визит"}</span>
              <span className="block text-sm text-fg-2">{[v.staff && `мастер ${v.staff}`, v.attendance === -1 ? "не пришёл" : ""].filter(Boolean).join(" · ") || "—"}</span>
            </span>
            <span className="tnum shrink-0 text-right text-sm text-fg-3">{dateTime(v.at, now)}</span>
          </li>
        ))}
      </ul>
      {visits.length > SHOW && (
        <div className="py-2">
          <Button variant="ghost" size="sm" onClick={() => setAll((x) => !x)}>
            {all ? "Свернуть" : `Показать все ${visits.length}`}
          </Button>
        </div>
      )}
    </InsetGroup>
  );
}

// ---------- согласия ----------
const STATES: { id: ConsentState; label: string }[] = [
  { id: "granted", label: "Есть" },
  { id: "denied", label: "Отказ" },
  { id: "unknown", label: "Не известно" },
];
const PURPOSE: Record<ConsentPurpose, string> = { marketing: "Реклама и акции", service: "Сервисные сообщения" };

function consentLine(r: ConsentRecord | null, now: number) {
  if (!r) return <span className="text-fg-3">не указано</span>;
  const t = consentText(r, now);
  return (
    <span>
      <span className={cn("font-medium", r.state === "granted" ? (r.confirmed ? "text-positive" : "text-fg") : r.state === "denied" ? "text-critical" : "text-fg")}>
        {t.head}
        {t.tail && <span className="font-normal text-fg-2"> — {t.tail}</span>}
      </span>
      <span className="block text-sm text-fg-3">{[r.basis, r.actor, `записано ${dateTime(r.at, now)}`].filter(Boolean).join(" · ")}</span>
    </span>
  );
}

type Evidence = NonNullable<ConsentInput["evidence"]>;
/** Сегодня по Астане — ГГГГ-ММ-ДД (для поля даты письменного согласия). */
const astanaToday = (now: number) => new Date(now + 5 * 3600e3).toISOString().slice(0, 10);

function ConsentBlock({
  ws,
  id,
  d,
  now,
  onDone,
  open,
  onOpen,
  onClosed,
}: {
  ws: string;
  id: string;
  d: ContactCard;
  now: number;
  onDone: (msg: string) => Promise<void>;
  /** Открыть редактор снаружи (запрет клиента → «Записать новое согласие»): новый n — открыть с «есть». */
  open: { n: number } | null;
  onOpen: () => void;
  onClosed: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const [purpose, setPurpose] = useState<ConsentPurpose>("marketing");
  const [state, setState] = useState<ConsentState>("granted");
  const [evidence, setEvidence] = useState<Evidence | "">("");
  const [ref, setRef] = useState("");
  const [given, setGiven] = useState("");
  const [basis, setBasis] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field: string; text: string } | null>(null);
  const [hist, setHist] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const rules = d.consentRules;
  const cur = d.consent.marketing;

  const start = (st: ConsentState) => {
    setPurpose("marketing");
    setState(st);
    setEvidence("");
    setRef("");
    setGiven("");
    setBasis("");
    setErr(null);
    setEdit(true);
  };
  // открыть с «есть» по просьбе снаружи и показать редактор
  useEffect(() => {
    if (!open) return;
    start("granted");
    window.setTimeout(() => box.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
  }, [open?.n]);
  const close = () => {
    setEdit(false);
    onClosed();
  };

  const save = async () => {
    const input: ConsentInput = { purpose, state, basis: basis.trim() };
    if (state === "granted") {
      if (!evidence) return setErr({ field: "evidence", text: "Выберите, чем подтверждено согласие." });
      if (evidence === "chat" && !rules.chatAvailable) return setErr({ field: "evidence", text: "В переписке нет сообщения клиента после отказа." });
      if (evidence === "oral" && !rules.oralAllowed) return setErr({ field: "evidence", text: "Клиент сам отказывался — устного согласия мало." });
      if (evidence === "document") {
        if (!ref.trim()) return setErr({ field: "evidenceRef", text: "Укажите номер анкеты или где хранится документ." });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(given)) return setErr({ field: "givenAt", text: "Укажите дату, когда клиент подписал согласие." });
      }
      if (!basis.trim()) return setErr({ field: "basis", text: "Коротко: где и как клиент согласился." });
      input.evidence = evidence;
      if (evidence === "document") Object.assign(input, { evidenceRef: ref.trim(), givenAt: given });
    }
    setBusy(true);
    setErr(null);
    try {
      await store.source!.setConsent(ws, id, input);
      close();
      await onDone(state === "granted" ? "Согласие записано" : "Сохранено");
    } catch (x) {
      setErr({ field: errField(x), text: errMsg(x) });
    } finally {
      setBusy(false);
    }
  };
  const fieldErr = (f: string) => (err && err.field === f ? err.text : undefined);
  const refused = rules.refusedAt ? dayText(rules.refusedAt, now) : "";

  return (
    <InsetGroup
      title="Согласие на сообщения"
      note="Реклама уходит только при подтверждённом согласии: клиент сам написал в WhatsApp, подписал анкету или согласился устно в салоне. Согласие из файла или из Altegio нужно подтвердить."
    >
      <dl>
        <Field stacked label={PURPOSE.marketing}>
          {consentLine(cur, now)}
        </Field>
        <Field stacked label={PURPOSE.service}>
          {consentLine(d.consent.service, now)}
        </Field>
      </dl>
      {edit ? (
        <div ref={box} className="py-1" aria-label="Изменить согласие">
          {refused && <Notice tone="muted">Клиент сам отказался {refused}. Нужно его новое согласие: сообщение в WhatsApp после отказа или письменное согласие с датой позже отказа.</Notice>}
          <SelectField label="Для чего" value={purpose} onChange={(e) => setPurpose(e.target.value as ConsentPurpose)}>
            <option value="marketing">{PURPOSE.marketing}</option>
            <option value="service">{PURPOSE.service}</option>
          </SelectField>
          <div className="py-3">
            <p className="mb-1.5 text-sm font-medium text-fg-2">Согласие</p>
            <Segmented label="Согласие" value={state} onChange={(v) => (setState(v), setErr(null))} options={STATES} className="w-full" />
          </div>
          {state === "granted" && (
            <div role="radiogroup" aria-label="Чем подтверждено" className="py-2">
              <p className="mb-1 text-sm font-medium text-fg-2">Чем подтверждено</p>
              <RadioRow
                name="evidence"
                checked={evidence === "chat"}
                onSelect={() => (setEvidence("chat"), setErr(null))}
                disabled={!rules.chatAvailable}
                title="Клиент сам написал в WhatsApp"
                sub={rules.chatAvailable ? "сервер найдёт его сообщение" : "в переписке нет сообщения клиента после отказа"}
              />
              <RadioRow
                name="evidence"
                checked={evidence === "document"}
                onSelect={() => (setEvidence("document"), setErr(null), given || setGiven(astanaToday(now)))}
                title="Письменное согласие"
                sub="анкета, договор — номер и дата"
              />
              <RadioRow
                name="evidence"
                checked={evidence === "oral"}
                onSelect={() => (setEvidence("oral"), setErr(null))}
                disabled={!rules.oralAllowed}
                title="Устно в салоне"
                sub={rules.oralAllowed ? "администратор записывает со слов клиента" : "клиент сам отказывался — устного согласия мало"}
              />
              {fieldErr("evidence") && (
                <p role="alert" className="flex gap-1.5 pt-1 text-sm text-critical">
                  <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
                  {fieldErr("evidence")}
                </p>
              )}
            </div>
          )}
          {state === "granted" && evidence === "document" && (
            <>
              <TextField label="Номер или где хранится" placeholder="Например: анкета № 12, папка «Согласия»" maxLength={120} value={ref} onChange={(e) => setRef(e.target.value)} error={fieldErr("evidenceRef")} />
              <TextField label="Дата согласия" type="date" max={astanaToday(now)} value={given} onChange={(e) => setGiven(e.target.value)} error={fieldErr("givenAt")} />
            </>
          )}
          <TextField
            label="Основание"
            optional={state !== "granted"}
            placeholder={state === "granted" ? "Например: подписал анкету при записи" : "Например: сказал по телефону"}
            maxLength={120}
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            error={fieldErr("basis")}
          />
          {err && !["basis", "evidence", "evidenceRef", "givenAt"].includes(err.field) && (
            <Notice tone="critical" role="alert">
              {err.text}
            </Notice>
          )}
          <div className="flex gap-2 pb-3 pt-1">
            <Button onClick={close} className="flex-1 md:flex-none">
              Отмена
            </Button>
            <Button variant="primary" busy={busy} onClick={() => void save()} className="flex-1 md:flex-none">
              Сохранить
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 py-3">
          {cur?.state === "granted" && !cur.confirmed && (
            <Button variant="primary" size="sm" icon={ShieldCheck} onClick={() => (start("granted"), onOpen())}>
              Подтвердить
            </Button>
          )}
          <Button variant="tinted" size="sm" onClick={() => start(cur?.state === "granted" && cur.confirmed ? "denied" : "granted")}>
            Изменить согласие
          </Button>
          {d.consentHistory.length > 0 && (
            <Button variant="ghost" size="sm" icon={History} onClick={() => setHist((x) => !x)} aria-expanded={hist}>
              {hist ? "Скрыть историю" : `История · ${d.consentHistory.length}`}
            </Button>
          )}
        </div>
      )}
      {hist && !edit && (
        <ul aria-label="История согласий">
          {d.consentHistory.map((h, i) => {
            const t = consentText(h, now);
            return (
              <li key={i} className="py-2.5 text-ui pointer-coarse:text-base">
                <span className="font-medium">
                  {PURPOSE[h.purpose]}: {t.head.toLowerCase()}
                </span>
                {t.tail && <span className="text-fg-2"> — {t.tail}</span>}
                <span className="block text-sm text-fg-3">{[h.basis, sourceText(h.source), h.actor, dateTime(h.at, now)].filter(Boolean).join(" · ")}</span>
              </li>
            );
          })}
        </ul>
      )}
    </InsetGroup>
  );
}

// ---------- запреты ----------
type Pending = { rid: string; mode: "lift" | "review-lift" } | null;

function RestrictionsBlock({
  ws,
  id,
  d,
  now,
  owner,
  onDone,
  onNewConsent,
}: {
  ws: string;
  id: string;
  d: ContactCard;
  now: number;
  owner: boolean;
  onDone: (msg: string) => Promise<void>;
  /** Открыть редактор согласия: запрет клиента снимается только после его нового подтверждённого согласия. */
  onNewConsent: () => void;
}) {
  const active = d.restrictions.filter((r) => r.active);
  const lifted = d.restrictions.filter((r) => !r.active);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<"marketing_optout" | "full_block">("marketing_optout");
  const [reason, setReason] = useState("");
  const [pend, setPend] = useState<Pending>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{ field: string; text: string } | null>(null);
  const [hist, setHist] = useState(false);

  const run = async (key: string, f: () => Promise<void>, msg: string) => {
    setBusy(key);
    setErr(null);
    try {
      await f();
      setAdding(false);
      setPend(null);
      setReason("");
      await onDone(msg);
    } catch (x) {
      setErr({ field: errField(x), text: errMsg(x) });
    } finally {
      setBusy("");
    }
  };
  const src = () => store.source!;
  const add = () => {
    if (!reason.trim()) return setErr({ field: "reason", text: "Напишите причину запрета." });
    void run("add", () => src().addRestriction(ws, id, kind, reason.trim()), "Запрет добавлен");
  };
  const lift = (r: Restriction, review: boolean) => {
    if (!reason.trim()) return setErr({ field: "reason", text: "Напишите, почему снимаете запрет." });
    void run(
      "lift:" + r.id,
      () => (review ? src().reviewRestriction(ws, id, r.id, "lift", reason.trim()) : src().liftRestriction(ws, id, r.id, reason.trim())),
      "Запрет снят",
    );
  };

  const reasonField = (label: string) => (
    <TextField label={label} maxLength={160} value={reason} onChange={(e) => setReason(e.target.value)} error={err && err.field === "reason" ? err.text : undefined} />
  );

  return (
    <InsetGroup
      title="Запреты"
      note="«Стоп» от клиента ставит бот; снять его можно только после нового подтверждённого согласия самого клиента. Остальные запреты снимает владелец — с причиной, она останется в истории."
    >
      {active.length === 0 && !adding && <p className="flex items-center gap-2 py-3 text-ui text-fg-2 pointer-coarse:text-base"><CircleCheck aria-hidden className="size-4 text-positive" strokeWidth={2} />Действующих запретов нет.</p>}
      {active.map((r) => (
        <div key={r.id} className="py-3">
          <div className="flex items-start gap-2.5">
            {r.kind === "cooldown" ? (
              <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-2" strokeWidth={2} />
            ) : (
              <Ban aria-hidden className="mt-0.5 size-4 shrink-0 text-critical" strokeWidth={2} />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-ui font-medium pointer-coarse:text-base">
                {r.kind === "cooldown" && r.untilAt ? `Пауза до ${dayText(r.untilAt, now)}` : KIND_LABEL[r.kind]}
                {r.review && <span className="ml-2 inline-flex h-6 items-center rounded-full bg-surface-2 px-2 align-middle text-xs font-medium text-fg-2">ждёт решения</span>}
                {r.byClient && !r.review && <span className="ml-2 inline-flex h-6 items-center rounded-full bg-critical-soft px-2 align-middle text-xs font-medium text-critical">от клиента</span>}
              </p>
              <p className="text-sm text-fg-2">{r.reason}</p>
              <p className="text-sm text-fg-3">{[sourceText(r.source), r.actor, dateTime(r.at, now)].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          {r.review && pend?.rid !== r.id && (
            <div className="mt-2.5 pl-6.5">
              <p className="mb-2 text-sm text-fg-2">Клиент написал что-то похожее на «стоп». Реклама закрыта, пока вы не решите:</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="tinted" busy={busy === "keep:" + r.id} onClick={() => void run("keep:" + r.id, () => src().reviewRestriction(ws, id, r.id, "keep"), "Запрет рекламы оставлен")}>
                  Оставить запрет рекламы
                </Button>
                <Button size="sm" variant="secondary" busy={busy === "all:" + r.id} onClick={() => void run("all:" + r.id, () => src().reviewRestriction(ws, id, r.id, "all"), "Закрыты все сообщения")}>
                  Закрыть все сообщения
                </Button>
                {owner && (
                  <Button size="sm" variant="danger" onClick={() => (setPend({ rid: r.id, mode: "review-lift" }), setReason(""), setErr(null))}>
                    Снять
                  </Button>
                )}
              </div>
            </div>
          )}
          {!r.review && owner && pend?.rid !== r.id && (
            <div className="mt-2 pl-6.5">
              <Button size="sm" variant="danger" disabled={!r.canLift} onClick={() => (setPend({ rid: r.id, mode: "lift" }), setReason(""), setErr(null))}>
                Снять запрет
              </Button>
              {!r.canLift && (
                <p className="mt-1.5 text-sm text-fg-2">{r.liftHint || "Клиент сам отказался — снять можно только после его нового подтверждённого согласия."}</p>
              )}
            </div>
          )}
          {!r.review && r.byClient && !r.canLift && pend?.rid !== r.id && (
            <div className={cn("pl-6.5", owner ? "mt-2" : "mt-2.5")}>
              {!owner && <p className="mb-1.5 text-sm text-fg-2">Клиент сам отказался. Когда он снова согласится — запишите его согласие, потом владелец снимет запрет.</p>}
              <Button size="sm" variant="tinted" icon={ShieldCheck} onClick={onNewConsent}>
                Записать новое согласие
              </Button>
            </div>
          )}
          {pend?.rid === r.id && (
            <div className="mt-1 pl-6.5">
              {reasonField("Почему снимаете")}
              {err && err.field !== "reason" && <Notice tone="critical" role="alert">{err.text}</Notice>}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setPend(null)}>
                  Отмена
                </Button>
                <Button size="sm" variant="primary" busy={busy === "lift:" + r.id} onClick={() => lift(r, pend.mode === "review-lift")}>
                  Снять запрет
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}

      {adding ? (
        <div className="py-1">
          <div className="py-3">
            <p className="mb-1.5 text-sm font-medium text-fg-2">Запрет</p>
            <Segmented
              label="Вид запрета"
              value={kind}
              onChange={setKind}
              options={[
                { id: "marketing_optout", label: "Только реклама" },
                { id: "full_block", label: "Не писать вообще" },
              ]}
              className="w-full"
            />
          </div>
          {reasonField("Причина")}
          {err && err.field !== "reason" && <Notice tone="critical" role="alert">{err.text}</Notice>}
          <div className="flex gap-2 pb-3">
            <Button onClick={() => setAdding(false)} className="flex-1 md:flex-none">
              Отмена
            </Button>
            <Button variant="primary" busy={busy === "add"} onClick={add} className="flex-1 md:flex-none">
              Сохранить запрет
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 py-3">
          <Button variant="tinted" size="sm" icon={Ban} onClick={() => (setAdding(true), setReason(""), setErr(null), setPend(null))}>
            Добавить запрет
          </Button>
          {lifted.length > 0 && (
            <Button variant="ghost" size="sm" icon={History} onClick={() => setHist((x) => !x)} aria-expanded={hist}>
              {hist ? "Скрыть снятые" : `Снятые · ${lifted.length}`}
            </Button>
          )}
        </div>
      )}
      {!adding && !pend && err && (
        <p role="alert" className="flex gap-2 pb-3 text-sm text-critical">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
          {err.text}
        </p>
      )}
      {hist && (
        <ul aria-label="Снятые запреты">
          {lifted.map((r) => (
            <li key={r.id} className="py-2.5 text-ui text-fg-2 pointer-coarse:text-base">
              <span className="font-medium text-fg">{KIND_LABEL[r.kind]}</span> — {r.reason}
              <span className="block text-sm text-fg-3">
                {[sourceText(r.source), r.actor, dateTime(r.at, now)].filter(Boolean).join(" · ")}
              </span>
              <span className="block text-sm text-fg-3">
                Снят{r.liftedAt ? ` ${dateTime(r.liftedAt, now)}` : ""}
                {r.liftedBy ? `, ${r.liftedBy}` : ""}
                {r.liftReason ? `: ${r.liftReason}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </InsetGroup>
  );
}

function CardSkeleton() {
  return (
    <div aria-hidden className="flex flex-col items-center px-6 pt-8">
      <Skeleton className="size-16 rounded-full" />
      <Skeleton className="mt-4 h-5 w-40" />
      <Skeleton className="mt-2 h-4 w-32" />
      <Skeleton className="mt-8 h-24 w-full rounded-[0.875rem]" />
      <Skeleton className="mt-4 h-40 w-full rounded-[0.875rem]" />
    </div>
  );
}
