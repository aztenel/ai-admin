// Вкладка «Календарь» раздела «Рассылки» (ТЗ v2.0 §6, §8, 31.10.2026): что уйдёт в ближайшие 14 дней и что было за 7 или 30 дней.
// Сервисные (подтверждения, напоминания, отзыв) и реклама — отдельными колонками: это разные сообщения с разными правилами.
// Реклама — только автосценарий «Пора на стрижку» по базе клиентов: сколько клиентов в этот день дойдут до «N дней с визита»,
// кому из них можно писать и почему нельзя остальным; уйдёт — только если автосценарий включён и у него есть шаблон. Ручных
// рассылок в календаре нет — их запускает владелец. Итоги — по отчётам Green-API о доставке; «прочитано» — не меньше, чем
// пришло отчётов (у клиента могут быть выключены отчёты о прочтении). Только числа: имён и номеров здесь нет.
import { useState } from "react";
import { CalendarDays, Megaphone } from "lucide-react";
import { Segmented, Skeleton } from "@/components/ui";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CalendarDay, CampaignCalendar, MessageStats, ServiceKind, StatSource } from "@/model/campaigns";
import { Group } from "@/screens/Page";
import { nf, Notice, visitDay } from "./base/shared";
import { EXCLUDED } from "./common";
import { useLoad } from "./useLoad";

const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const KIND: Record<ServiceKind, string> = { s01: "подтверждение", d1: "накануне", h2: "за 2 часа", s06: "перенос", rv: "отзыв" };
const MESSAGES: [string, string, string] = ["сообщение", "сообщения", "сообщений"];
const CLIENTS: [string, string, string] = ["клиент", "клиента", "клиентов"];

/** «сегодня», «завтра», «пн, 3 ноября». */
function dayName(iso: string, today: string, now: number): string {
  if (iso === today) return "Сегодня";
  const t = Date.parse(iso + "T00:00:00Z"), t0 = Date.parse(today + "T00:00:00Z");
  if (t - t0 === 864e5) return "Завтра";
  return `${WD[new Date(t).getUTCDay()]}, ${visitDay(iso, now)}`;
}

export default function Plan({ ws }: { ws: string }) {
  const cal = useLoad((src) => src.calendar(ws), [ws]);
  const [days, setDays] = useState<7 | 30>(7);
  const st = useLoad((src) => src.messageStats(ws, days), [ws, days]);
  const now = Date.now();
  return (
    <>
      {cal.loading ? <PlanSkeleton /> : cal.data ? <CalendarGroup d={cal.data} now={now} /> : <Notice tone="critical" role="alert">Календарь не загрузился: {cal.error}</Notice>}
      <Group title="Итоги" note="По отчётам о доставке, которые присылает Green-API. «Прочитано» не меньше этого числа: у части клиентов отчёты о прочтении выключены.">
        <Segmented<"7" | "30">
          label="Период итогов"
          value={String(days) as "7" | "30"}
          onChange={(v) => setDays(v === "30" ? 30 : 7)}
          options={[
            { id: "7", label: "7 дней" },
            { id: "30", label: "30 дней" },
          ]}
          className="my-3 flex w-full max-w-xs"
        />
        {st.loading ? <Skeleton className="mb-3 h-40 w-full rounded-xl" /> : st.data ? <StatsTable d={st.data} /> : <Notice tone="critical" role="alert">Итоги не загрузились: {st.error}</Notice>}
      </Group>
    </>
  );
}

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEK = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** Календарь месяца (ТЗ v3.0 §5.3): текущий и следующий месяц. В дне — сколько сервисных (латунь) и рекламы (бордовый);
 *  по нажатию — подробности дня. Пустые и прошедшие дни приглушены. */
function CalendarGroup({ d, now }: { d: CampaignCalendar; now: number }) {
  const auto = d.auto;
  const byDay = new Map(d.days.map((x) => [x.date, x]));
  const months = [...new Set(d.days.map((x) => x.date.slice(0, 7)))];
  if (!months.length) months.push(d.today.slice(0, 7));
  const [mi, setMi] = useState(0);
  const [sel, setSel] = useState(d.today);
  const month = months[Math.min(mi, months.length - 1)];
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)), lead = (first.getUTCDay() + 6) % 7, dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const note = !auto
    ? "Сервисные сообщения уходят сами по записям. Рекламы по базе клиентов у компании нет."
    : auto.on && auto.tpl
      ? `Реклама: автосценарий «Пора на стрижку» в 11:00 тем, у кого ${auto.days} ${plural(auto.days, ["день", "дня", "дней"])} с визита, не больше ${auto.cap} в день.`
      : "Реклама сама не уходит: автосценарий выключен. В дне видно, сколько клиентов подошли бы.";
  const day = byDay.get(sel);
  return (
    <Group title="Календарь" note={note}>
      <div className="flex items-center justify-between py-2">
        <button type="button" aria-label="Предыдущий месяц" disabled={mi === 0} onClick={() => setMi(mi - 1)} className="grid size-10 place-items-center rounded-full text-fg-2 hover:bg-surface-2 disabled:opacity-30">
          ‹
        </button>
        <p className="title-display text-lg font-semibold">{`${MONTHS[m - 1]} ${y}`}</p>
        <button type="button" aria-label="Следующий месяц" disabled={mi >= months.length - 1} onClick={() => setMi(mi + 1)} className="grid size-10 place-items-center rounded-full text-fg-2 hover:bg-surface-2 disabled:opacity-30">
          ›
        </button>
      </div>
      <div role="grid" aria-label={`${MONTHS[m - 1]} ${y}`} className="grid grid-cols-7 gap-1 pb-2">
        {WEEK.map((w) => (
          <span key={w} role="columnheader" className="pb-1 text-center text-xs text-fg-3">
            {w}
          </span>
        ))}
        {cells.map((iso, i) => {
          if (!iso) return <span key={i} aria-hidden />;
          const x = byDay.get(iso), svc = x?.service.total || 0, mk = x?.marketing ? (auto?.on && auto.tpl ? x.marketing.planned : x.marketing.candidates) : 0;
          const past = iso < d.today, today = iso === d.today, on = iso === sel;
          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              aria-selected={on}
              aria-label={`${+iso.slice(8)} ${MONTHS[m - 1].toLowerCase()}: сервисных ${svc}, рекламы ${mk}`}
              onClick={() => setSel(iso)}
              className={cn(
                "flex aspect-square min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl text-ui transition-colors",
                on ? "bg-accent text-accent-fg" : today ? "ring-2 ring-brand-gold ring-inset" : "hover:bg-surface-2",
                past && !on && "text-fg-3",
              )}
            >
              <span className="tnum font-medium">{+iso.slice(8)}</span>
              <span className="flex h-1.5 gap-0.5">
                {svc > 0 && <span className={cn("size-1.5 rounded-full", on ? "bg-accent-fg" : "bg-brand-gold")} />}
                {mk > 0 && <span className={cn("size-1.5 rounded-full", on ? "bg-accent-fg/70" : "bg-accent")} />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex gap-4 border-t border-line py-2 text-xs text-fg-3">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-brand-gold" /> сервисные
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-accent" /> реклама
        </span>
      </div>
      {day ? (
        <ul aria-label="Выбранный день" className="border-t border-line">
          <DayRow x={day} today={d.today} now={now} auto={!!(auto && auto.on && auto.tpl)} />
        </ul>
      ) : (
        <p className="border-t border-line py-3 text-ui text-fg-3">{sel < d.today ? "День прошёл." : "Нет данных на этот день."}</p>
      )}
    </Group>
  );
}

function DayRow({ x, today, now, auto }: { x: CalendarDay; today: string; now: number; auto: boolean }) {
  const s = x.service, m = x.marketing;
  const kinds = (Object.entries(s.kinds) as [ServiceKind, number][]).filter(([, n]) => n > 0).map(([k, n]) => `${KIND[k] || k} ${nf.format(n)}`);
  const why = m ? Object.entries(m.excluded).filter(([, n]) => n > 0).map(([k, n]) => `${EXCLUDED[k as keyof typeof EXCLUDED] || k}: ${nf.format(n)}`) : [];
  const quiet = !s.total && !(m && m.candidates);
  // пустой день — одной строкой: 14 дней по три строки на телефоне — длинный экран без смысла
  if (quiet)
    return (
      <li className="grid grid-cols-[6.5rem_1fr] gap-x-3 py-2 text-fg-3 md:grid-cols-[9rem_1fr]">
        <p className="text-[0.9375rem] md:text-base">{dayName(x.date, today, now)}</p>
        <p className="text-ui pointer-coarse:text-base">ничего не запланировано</p>
      </li>
    );
  return (
    <li className="grid grid-cols-[6.5rem_1fr] gap-x-3 py-2.5 md:grid-cols-[9rem_1fr_1fr]">
      <p className="text-[0.9375rem] font-semibold md:text-base">{dayName(x.date, today, now)}</p>
      <div className="min-w-0">
        <p className="text-ui pointer-coarse:text-base">
          <span className="text-fg-2">Сервисные:</span> <span className="tnum font-semibold">{nf.format(s.total)}</span>
        </p>
        {!!kinds.length && <p className="text-sm text-fg-3">{kinds.join(", ")}</p>}
      </div>
      {m && (
        <div className="col-start-2 min-w-0 max-md:mt-1 md:col-start-3">
          <p className="flex items-center gap-1.5 text-ui pointer-coarse:text-base">
            <Megaphone aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={1.9} />
            <span className="text-fg-2">Реклама:</span>{" "}
            {auto ? (
              <span className="tnum font-semibold">{nf.format(m.planned)}</span>
            ) : (
              <span className="tnum">{m.candidates ? `0 из ${nf.format(m.candidates)}` : "0"}</span>
            )}
          </p>
          {!!m.candidates && (
            <p className="text-sm text-fg-3">
              подходят {nf.format(m.candidates)} {plural(m.candidates, CLIENTS)}, можно писать {nf.format(m.allowed)}
              {why.length ? `; нельзя: ${why.join(", ")}` : ""}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

const SRC: { id: StatSource; label: string }[] = [
  { id: "service", label: "Напоминания" },
  { id: "review", label: "Просьбы об отзыве" },
  { id: "campaign", label: "Рассылки" },
  { id: "admin", label: "Ответы сотрудников" },
];
const COLS: { id: keyof MessageStats["by"]["service"]; label: string }[] = [
  { id: "sent", label: "ушло" },
  { id: "delivered", label: "дошло" },
  { id: "read", label: "прочли" },
  { id: "failed", label: "не дошло" },
  { id: "replied", label: "ответили" },
];

function StatsTable({ d }: { d: MessageStats }) {
  if (!d.available) return <Notice tone="muted">{d.why || "Числа пока не копятся."}</Notice>;
  const rows = SRC.filter((s) => s.id === "service" || s.id === "admin" || Object.values(d.by[s.id]).some((n) => n > 0));
  const none = rows.every((s) => !d.by[s.id].sent && !d.by[s.id].failed);
  return (
    <>
      {none && <Notice tone="muted">За {d.days === 30 ? "30 дней" : "7 дней"} отчётов о доставке не было.</Notice>}
      <ul aria-label={`Итоги за ${d.days} дней`} className="divide-y divide-line">
        {rows.map((s) => {
          const c = d.by[s.id];
          return (
            <li key={s.id} className="py-2.5">
              <p className="text-[0.9375rem] font-semibold md:text-base">
                {s.label}
                {c.sent > 0 && <span className="font-normal text-fg-3"> · {nf.format(c.sent)} {plural(c.sent, MESSAGES)}</span>}
              </p>
              <dl className="mt-1 grid grid-cols-5 gap-1">
                {COLS.map((k) => (
                  <div key={k.id} className="flex min-w-0 flex-col">
                    <dt className="order-2 truncate text-xs text-fg-3">{k.label}</dt>
                    <dd className={cn("tnum order-1 text-lg font-semibold leading-6", k.id === "failed" && c.failed > 0 && "text-critical", !c[k.id] && "text-fg-3")}>{nf.format(c[k.id])}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function PlanSkeleton() {
  return (
    <section aria-hidden className="mb-6">
      <Skeleton className="mb-2 ml-4 h-3.5 w-40" />
      <div className="rounded-[0.875rem] bg-surface px-4 py-1">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={cn("flex items-center gap-3 py-3", i && "border-t border-line")}>
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3.5 flex-1" />
          </div>
        ))}
      </div>
    </section>
  );
}
