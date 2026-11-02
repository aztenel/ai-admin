// Люди одного сегмента базы клиентов: отбор (дни с последнего визита от и до, мастер), список по 50 с «Ещё» и
// «Создать рассылку по сегменту». Номера — только маской, как их отдал сервер (/api/crm/list): не форматировать (formatPhone),
// не сохранять в localStorage и не писать в консоль — полные номера клиентов базы знает только сервер.
// Отбор применяется сам через полсекунды после ввода; в рассылку уходит ровно тот отбор, чей список виден на экране.
// С 02.11.2026 в списке — все клиенты сегмента со статусами (all=1): «получит рекламу» или «не получит: почему», есть ли запись,
// отказался ли. Сколько получат рекламу — отдельным запросом (только те, кому уйдёт): без согласия реклама не уходит никому.
import { CircleAlert, Megaphone, RefreshCw, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar, Button, Skeleton } from "@/components/ui";
import { plural } from "@/lib/format";
import { cn, useNow } from "@/lib/utils";
import type { CrmPerson, CrmSegment, SegmentSpec } from "@/model/campaigns";
import { Group } from "@/screens/Page";
import { store } from "@/state/store";
import { costEstimate, errText, money } from "../common";
import { SelectField, TextField } from "../wizard/fields";
import { nf, segRule, visitDay } from "./shared";

const DAYS_MAX = 400; // как проверяет сервер (/api/crm/list)
const PEOPLE: [string, string, string] = ["человек", "человека", "человек"];
const VISITS: [string, string, string] = ["визит", "визита", "визитов"];

/** Поле «дней»: пусто — без ограничения; иначе целое 0–400. */
function days(s: string): { v?: number; bad: boolean } {
  const t = s.trim();
  if (!t) return { bad: false };
  if (!/^\d{1,3}$/.test(t) || +t > DAYS_MAX) return { bad: true };
  return { v: +t, bad: false };
}
/** Правило сегмента фразой: «Последний визит 36–60 дней назад.» */
function ruleText(seg: CrmSegment): string {
  const r = seg.id === "all" ? "вся база клиентов за 90 дней" : segRule(seg);
  return r ? r[0].toUpperCase() + r.slice(1) + "." : "";
}
const keyOf = (s: SegmentSpec) => `${s.id}|${s.from ?? ""}|${s.to ?? ""}|${s.staff ?? ""}`;

/** rows — все клиенты сегмента (со статусами); allowed — скольким из них реклама уйдёт сейчас (null — сервер старше, только «можно»). */
type Page = { rows: CrmPerson[]; total: number; page: number; pages: number; allowed: number | null };

/** channel — с какого номера рассылка: второй номер (обычное сообщение, бесплатно) или основной (шаблон Meta, оценка цены). */
export function SegmentView({ ws, seg, masters, channel = "main", onCreate }: { ws: string; seg: CrmSegment; masters: string[]; channel?: "bot" | "main"; onCreate: (spec: SegmentSpec) => void }) {
  const now = useNow(60e3);
  const ofMaster = seg.id.startsWith("staff:");
  const [fromS, setFromS] = useState("");
  const [toS, setToS] = useState("");
  const [staff, setStaff] = useState("");
  const f = days(fromS);
  const t = days(toS);
  const order = f.v !== undefined && t.v !== undefined && f.v > t.v;
  const invalid = f.bad || t.bad || order;

  // отбор на экране → через полсекунды тишины становится «применённым» и грузится
  const spec = useMemo<SegmentSpec>(
    () => ({ id: seg.id, ...(f.v !== undefined ? { from: f.v } : {}), ...(t.v !== undefined ? { to: t.v } : {}), ...(staff && !ofMaster ? { staff } : {}) }),
    [seg.id, f.v, t.v, staff, ofMaster],
  );
  const [applied, setApplied] = useState<SegmentSpec>(() => ({ id: seg.id }));
  const specKey = keyOf(spec);
  const appliedKey = keyOf(applied);
  useEffect(() => {
    if (invalid || specKey === appliedKey) return;
    const tm = window.setTimeout(() => setApplied(spec), 450);
    return () => window.clearTimeout(tm);
  }, [specKey, appliedKey, invalid, spec]);
  const pending = !invalid && specKey !== appliedKey;

  const [list, setList] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [more, setMore] = useState(false);
  const [moreErr, setMoreErr] = useState("");
  const seq = useRef(0);

  const load = useCallback(
    async (s: SegmentSpec) => {
      const my = ++seq.current;
      const src = store.source;
      if (!src) return;
      setLoading(true);
      setErr("");
      setMoreErr("");
      // «Ещё» прежнего отбора ещё грузилось — его ответ выбросим (seq), а кнопка не должна остаться с крутилкой (находка проверки 19.10.2026)
      setMore(false);
      try {
        // все клиенты сегмента со статусами и, отдельно, сколько из них получат рекламу (только они уйдут в рассылку)
        const [p, ok] = await Promise.all([src.crmList(ws, s, 1, { all: true }), src.crmList(ws, s, 1)]);
        if (my !== seq.current) return; // пришёл ответ на прежний отбор
        const every = !!p.all; // сервер старше 02.11.2026 отдаёт только тех, кому можно писать
        setList({ rows: p.list, total: p.total, page: p.page, pages: p.pages, allowed: every ? ok.total : null });
      } catch (e) {
        if (my === seq.current) setErr(errText(e));
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [ws],
  );
  useEffect(() => {
    void load(applied);
    return () => {
      seq.current++; // ответы на запросы закрытого экрана не применяются
    };
    // applied меняется только вместе со своим ключом
  }, [appliedKey, load]);

  const loadMore = async () => {
    const src = store.source;
    if (!src || !list) return;
    const my = seq.current;
    setMore(true);
    setMoreErr("");
    try {
      const p = await src.crmList(ws, applied, list.page + 1, { all: true });
      if (my !== seq.current) return;
      setList((cur) => (cur ? { ...cur, rows: [...cur.rows, ...p.list], total: p.total, page: p.page, pages: p.pages } : cur));
    } catch (e) {
      if (my === seq.current) setMoreErr(errText(e));
    } finally {
      if (my === seq.current) setMore(false);
    }
  };

  const filtered = applied.from !== undefined || applied.to !== undefined || !!applied.staff;
  const anyInput = !!(fromS || toS || staff);
  const total = list?.total ?? 0;
  // получат рекламу: у сервера со статусами — отдельное число, у старого — весь список (в нём только те, кому можно писать)
  const allowed = list ? (list.allowed ?? list.total) : 0;
  const canCreate = !invalid && !pending && !loading && !err && allowed > 0;
  const busy = loading || pending;
  const bot = channel === "bot";

  return (
    <>
      <div className="scroll-area min-h-0 flex-1">
        <div className="px-4 pb-6 pt-2 md:px-6 md:pt-5">
          <p className="mb-5 px-4 text-ui text-fg-2 pointer-coarse:text-base">
            {ruleText(seg)} {list?.allowed === null ? "Здесь только те, кому можно писать сейчас." : "Здесь все клиенты сегмента. Реклама уходит только тем, у кого «получит рекламу»: с подтверждённым согласием и без «стопа»."}
          </p>

          <Group title="Отбор">
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Дней с визита, от"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                enterKeyHint="done"
                placeholder="любое"
                maxLength={3}
                value={fromS}
                onChange={(e) => setFromS(e.target.value)}
                error={f.bad ? "Число от 0 до 400" : undefined}
              />
              <TextField
                label="Дней с визита, до"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                enterKeyHint="done"
                placeholder="любое"
                maxLength={3}
                value={toS}
                onChange={(e) => setToS(e.target.value)}
                error={t.bad ? "Число от 0 до 400" : order ? "Не меньше, чем «от»" : undefined}
              />
            </div>
            {!ofMaster && masters.length > 0 && (
              <SelectField label="Мастер последнего визита" value={staff} onChange={(e) => setStaff(e.target.value)}>
                <option value="">Все мастера</option>
                {masters.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </SelectField>
            )}
            {anyInput && (
              <div className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm text-fg-3">{pending ? "Применяю отбор…" : "Отбор применён"}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFromS("");
                    setToS("");
                    setStaff("");
                  }}
                >
                  Сбросить отбор
                </Button>
              </div>
            )}
          </Group>

          {list === null && loading ? (
            <PeopleSkeleton />
          ) : err && list === null ? (
            <LoadError text={err} onRetry={() => void load(applied)} />
          ) : (
            <Group
              title={
                list
                  ? `${nf.format(total)} ${plural(total, PEOPLE)}${filtered ? " с этим отбором" : ""}${list.allowed !== null ? ` · можно рекламу: ${nf.format(list.allowed)}` : ""}`
                  : undefined
              }
            >
              {err ? (
                <LoadError text={err} onRetry={() => void load(applied)} inline />
              ) : !list || list.rows.length === 0 ? (
                <p className="flex items-center gap-2.5 py-4 text-ui text-fg-2 pointer-coarse:text-base">
                  <UsersRound aria-hidden className="size-5 shrink-0 text-fg-3" strokeWidth={1.75} />
                  {filtered ? "Никого с таким отбором. Измените дни или мастера." : "Сейчас в этом сегменте некому писать."}
                </p>
              ) : (
                <ul aria-label="Клиенты сегмента" aria-busy={busy || undefined} className={cn("divide-y divide-line transition-opacity", busy && "opacity-60")}>
                  {list.rows.map((p, i) => (
                    <Person key={`${p.phone}|${i}`} p={p} now={now} />
                  ))}
                </ul>
              )}
            </Group>
          )}

          {list && list.page < list.pages && !err && (
            <div className="-mt-3 mb-6 flex flex-col items-center gap-2">
              <Button variant="outline" busy={more} disabled={busy} onClick={() => void loadMore()}>
                Ещё
              </Button>
              <span className="text-sm text-fg-3">
                Показано {nf.format(list.rows.length)} из {nf.format(total)}
              </span>
              {moreErr && (
                <p role="alert" className="text-sm text-critical">
                  {moreErr}
                </p>
              )}
            </div>
          )}
          <p className="px-4 text-sm text-fg-3">Номера видны частично. Полностью их видит только сервер, он и отправляет рассылку.</p>
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-surface px-4 pt-3 pb-safe-kb md:px-6 md:pb-4">
        <p className="mb-2 min-h-[1.125rem] text-sm text-fg-2" aria-live="polite">
          {invalid
            ? "Исправьте отбор."
            : busy
              ? "Считаю…"
              : err
                ? ""
                : allowed > 0
                  ? bot
                    ? `Рекламу со второго номера получат ${nf.format(allowed)} из ${nf.format(total)}: только с согласием.`
                    : `Шаблон Meta с основного номера получат ${nf.format(allowed)} ${plural(allowed, PEOPLE)} · оценка ≈\u00a0${money(costEstimate(allowed))}`
                  : total > 0
                    ? "Рекламу сейчас не получит никто: нет согласия или другая причина у каждого. Рассылку не создать."
                    : "Некому писать, рассылку не создать."}
        </p>
        <Button variant="primary" size="lg" icon={Megaphone} className="mb-1 w-full" disabled={!canCreate} onClick={() => onCreate(applied)}>
          Создать рассылку по сегменту
        </Button>
      </div>
    </>
  );
}

/** Человек сегмента: имя, номер маской, когда был, сколько визитов, мастер и услуга последнего визита; статусы — получит ли рекламу
 *  (и почему нет — словами сервера), есть ли запись, отказался ли, можно ли сервисные. */
function Person({ p, now }: { p: CrmPerson; now: number }) {
  const facts = [`был ${visitDay(p.last, now)}`, `${p.v} ${plural(p.v, VISITS)} за 90 дней`, p.staff, p.svc].filter(Boolean).join(" · ");
  const st = p.st;
  return (
    <li className="flex items-start gap-3 py-3">
      <Avatar name={p.name} size="md" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className={cn("min-w-0 flex-1 truncate text-md font-medium md:text-base", !p.name && "text-fg-2")}>{p.name || "Без имени"}</p>
          <span className="tnum shrink-0 text-sm text-fg-2">
            {p.d} {plural(p.d, ["день", "дня", "дней"])}
          </span>
        </div>
        <p className="tnum text-ui text-fg-2 pointer-coarse:text-base">{p.phone}</p>
        <p className="mt-0.5 line-clamp-2 text-sm text-fg-3">{facts}</p>
        {st && (
          <div role="group" aria-label="Статусы" className="mt-1.5 flex flex-wrap gap-1">
            {st.ready ? <Chip tone="positive">получит рекламу</Chip> : <Chip tone={st.stopped ? "critical" : "muted"}>не получит рекламу{p.why ? `: ${p.why}` : ""}</Chip>}
            {st.booked && <Chip>есть запись</Chip>}
            {st.stopped && <Chip tone="critical">отказался</Chip>}
            {!st.stopped && st.refused && <Chip>отказ от рекламы</Chip>}
            {!st.service && <Chip tone="critical">сервисные нельзя</Chip>}
          </div>
        )}
      </div>
    </li>
  );
}

function Chip({ tone = "neutral", children }: { tone?: "neutral" | "positive" | "critical" | "muted"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 max-w-full items-center rounded-full px-2 text-xs font-medium",
        tone === "positive" && "bg-positive-soft text-positive",
        tone === "critical" && "bg-critical-soft text-critical",
        tone === "muted" && "bg-surface-2 text-fg-2",
        tone === "neutral" && "bg-accent-soft text-accent-ink",
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

function LoadError({ text, onRetry, inline }: { text: string; onRetry: () => void; inline?: boolean }) {
  const body = (
    <div className="py-4">
      <p role="alert" className="flex gap-2 text-ui text-critical pointer-coarse:text-base">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
        <span>Список не загрузился: {text}</span>
      </p>
      <Button variant="outline" icon={RefreshCw} className="mt-3" onClick={onRetry}>
        Повторить
      </Button>
    </div>
  );
  return inline ? body : <Group>{body}</Group>;
}

function PeopleSkeleton() {
  return (
    <section className="mb-6" aria-hidden>
      <Skeleton className="mb-2 ml-4 h-3.5 w-24" />
      <div className="rounded-[0.875rem] bg-surface px-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 border-line py-3 [&+&]:border-t">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
