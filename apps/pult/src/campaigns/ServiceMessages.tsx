// Сервисные сообщения, которые уходят сами (не рассылки), — части вкладки «Автоматические · сообщения» (02.11.2026).
//  · ServiceMessages — компании БЕЗ журнала Altegio (например, «Демо Дент»): бот шлёт напоминания и просьбу об отзыве сам, только по
//    записям, которые клиент сделал в чате с ботом, и с того номера, куда клиент писал. Что включено, ближайшие в очереди, сколько ушло
//    за 3 дня. Всё — из GET /api/bc/service; менять здесь нечего (напоминания и ссылку на отзывы задают в настройках бота).
//  · Upcoming и DryRunGroup — общие с разделом «Автоматические сообщения» (компании с журналом Altegio, Winchester): ближайшие сообщения
//    в очереди (только включённых сценариев — так их отдаёт сервер) и «Проверка по журналу» без отправки (только владелец).
// Номера — только маской, как их отдаёт сервер. Время — по Астане, как у сервера (пульт могут открыть из другого часового пояса).
// Включение, тексты и журнал сценариев компании с журналом Altegio — в AutoMessages.tsx (прежние «Тексты сообщений» с одобрением и
// «Последние решения» заменены выключателями сценариев и журналом каждого сценария).
import { useEffect, useRef, useState } from "react";
import { BellRing, CalendarCheck, CalendarClock, CalendarSync, CalendarX2, CircleCheck, Inbox, RefreshCw, Star, TriangleAlert, type LucideIcon } from "lucide-react";
import { Button, Skeleton } from "@/components/ui";
import { plural } from "@/lib/format";
import { cn, useNow } from "@/lib/utils";
import type { ServiceDryRun, ServiceKind, ServiceKindState, ServiceOverview, ServiceQueueItem } from "@/model/campaigns";
import { Group } from "@/screens/Page";
import { store } from "@/state/store";
import { astanaDay, nf, Notice, Stats, visitDay, when } from "./base/shared";
import { errorList } from "./common";
import { useLoad, type Loaded } from "./useLoad";

const WHO = "Уходят сами с того номера, куда писал клиент, только тем, кто записался через бота. Администратору ничего делать не нужно.";
function who(d: ServiceOverview): string {
  if (!d.altegio)
    return "Напоминания и просьбу об отзыве бот шлёт сам, но только по записям, которые он сделал в Altegio. У компании запись через Altegio не подключена, поэтому эти сообщения не уходят.";
  return `${WHO} Тем, кого администратор записал прямо в Altegio, бот не напоминает.`;
}
const TIME = "Время по Астане.";
// «боевой сайт / черновик» — слова владельца (так он выкладывает бота); администраторам компании они ничего не говорят
const LIVE_ONLY = `${TIME} Сообщения уходят только с боевого сайта: там очередь проверяется раз в минуту. С черновика они не отправляются.`;

const ICON: Record<ServiceKind, LucideIcon> = { s01: CalendarCheck, d1: CalendarClock, h2: BellRing, s06: CalendarSync, cx: CalendarX2, rv: Star };
/** Если сервер не прислал подпись — своя, те же слова. */
const LABEL: Record<ServiceKind, string> = {
  s01: "Сразу после новой записи: подтверждение",
  d1: "Накануне в 18:00: напоминание о записи",
  h2: "За 2 часа: напоминание о записи",
  s06: "После переноса: сообщение с новым временем",
  cx: "После отмены: сообщение об отмене",
  rv: "Через 3 часа после визита: просьба оставить отзыв",
};
/** Коротко — в строке очереди (время напоминания в день визита владелец выбирает сам: 1–6 часов). */
const SHORT: Record<ServiceKind, string> = { s01: "Подтверждение записи", d1: "Напоминание накануне", h2: "Напоминание в день визита", s06: "Сообщение о переносе", cx: "Сообщение об отмене", rv: "Просьба об отзыве" };
const MESSAGES: [string, string, string] = ["сообщение", "сообщения", "сообщений"];
// очередь меняется медленно (фон шлёт раз в минуту) — раз в минуту и перечитываем, пока вкладка открыта
export const SERVICE_POLL_MS = 60e3;

/** «сегодня», «завтра», «вчера» или «5 октября» — по дню ГГГГ-ММ-ДД по Астане. */
export function dayWord(iso: string, now: number): string {
  if (iso === astanaDay(now)) return "сегодня";
  if (iso === astanaDay(now + 864e5)) return "завтра";
  if (iso === astanaDay(now - 864e5)) return "вчера";
  return visitDay(iso, now);
}
/** Когда уйдёт: «сегодня, 18:00»; уже пора — «сейчас» (фон отправит в ближайшую минуту). */
const sendWhen = (at: number, now: number) => (at <= now ? "сейчас" : `${dayWord(astanaDay(at), now)}, ${when(at, now).time}`);
/** О какой записи: «запись на завтра, 12:00» или — для отзыва — «после визита сегодня в 17:00». */
function bookingText(x: ServiceQueueItem, now: number): string {
  if (!x.date) return "";
  const day = dayWord(x.date, now);
  return x.kind === "rv" ? `после визита ${day}${x.time ? ` в ${x.time}` : ""}` : `запись на ${day}${x.time ? `, ${x.time}` : ""}`;
}
/** Ссылка коротко: «2gis.kz/astana/firm/…» — без https:// и хвоста. */
function shortLink(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return u.host.replace(/^www\./, "") + (path.length > 24 ? path.slice(0, 24) + "…" : path);
  } catch {
    return url;
  }
}

/** Компания без журнала Altegio: что бот шлёт сам (только смотреть — владельцу и сотруднику одинаково). Данные — GET /api/bc/service,
 *  их грузит вкладка (useServiceMessages): по ним же она решает, этот вид показывать или «Автоматические сообщения». */
export default function ServiceMessages({ owner, svc: s }: { owner: boolean; svc: Loaded<ServiceOverview> }) {
  const now = useNow();
  const d = s.data;

  if (s.loading) return <ServiceSkeleton />;
  if (!d)
    return (
      <Group title="Что бот отправляет сам" note={WHO}>
        <div className="pb-3">
          <Notice tone="critical" role="alert">
            Не загрузилось: {s.error}
          </Notice>
          <Button variant="outline" icon={RefreshCw} className="mb-1" onClick={() => void s.reload()}>
            Повторить
          </Button>
        </div>
      </Group>
    );

  return (
    <>
      {d.botOff && (
        <section role="status" className="mb-4 flex gap-2.5 rounded-[0.875rem] bg-surface px-4 py-3">
          <TriangleAlert aria-hidden className="mt-0.5 size-[1.125rem] shrink-0 text-fg" strokeWidth={2} />
          <div className="min-w-0">
            <p className="text-[0.9375rem] font-semibold md:text-base">Бот на номере бота выключен</p>
            <p className="mt-0.5 text-ui text-fg-2 pointer-coarse:text-base">Он не отвечает клиентам и не записывает их, поэтому новых напоминаний и просьб об отзыве не будет.</p>
          </div>
        </section>
      )}

      <Group title="Что бот отправляет сам" note={who(d)}>
        {d.kinds.length ? d.kinds.map((k) => <KindRow key={k.kind} k={k} altegio={d.altegio} />) : <p className="py-3 text-ui text-fg-2 pointer-coarse:text-base">Сведений нет.</p>}
      </Group>

      <Upcoming d={d} owner={owner} now={now} empty="Ближайших сообщений нет. Они появятся, когда клиент запишется через бота." />
      {s.error && (
        <p role="alert" className="-mt-3 mb-4 px-4 text-sm text-critical">
          Не обновилось: {s.error}
        </p>
      )}
    </>
  );
}

/** Очередь сервисных сообщений (GET /api/bc/service) с опросом раз в минуту, пока вкладка открыта. */
export function useServiceMessages(ws: string): Loaded<ServiceOverview> {
  return useLoad((src) => src.serviceMessages(ws), [ws], { pollMs: SERVICE_POLL_MS });
}

/** Плитка со значком вида сообщения — как в настройках. */
function Tile({ kind, on = true }: { kind: ServiceKind; on?: boolean }) {
  const Icon = ICON[kind];
  return (
    <span className={cn("grid size-9 shrink-0 place-items-center rounded-[0.625rem]", on ? "bg-surface-2 text-fg-2" : "bg-surface-2 text-fg-3")}>
      <Icon aria-hidden className="size-[1.125rem]" strokeWidth={1.9} />
    </span>
  );
}

/** Вид сообщения: когда уходит, что это, включено ли; у отзыва — ссылка, куда бот зовёт оставить отзыв. */
function KindRow({ k, altegio }: { k: ServiceKindState; altegio: boolean }) {
  const [head, tail] = (k.label || LABEL[k.kind]).split(/ — |: /);
  const what = tail ? tail[0].toUpperCase() + tail.slice(1) : "";
  const off = k.on ? "" : !altegio ? "Только по записям через Altegio." : k.kind === "rv" ? "Нет ссылки на отзывы (2ГИС, Google Карты)." : "Выключено в настройках бота.";
  return (
    <div className="flex min-h-14 items-start gap-3 py-2.5">
      <Tile kind={k.kind} on={k.on} />
      <div className="min-w-0 flex-1 self-center">
        <p className={cn("text-[0.9375rem] font-semibold md:text-base", !k.on && "text-fg-2")}>{head}</p>
        {what && <p className="text-sm text-fg-2">{what}</p>}
        {k.on && k.link && (
          <a
            href={k.link}
            target="_blank"
            rel="noopener noreferrer"
            // на телефоне строка ссылки — 44 px (касание пальцем), а место в строке — как у обычной подписи
            className="mt-0.5 block truncate text-sm text-accent-ink underline-offset-2 hover:underline pointer-coarse:-my-3 pointer-coarse:leading-[2.75rem]"
            aria-label={`Ссылка на отзывы: ${shortLink(k.link)}`}
          >
            {shortLink(k.link)}
          </a>
        )}
        {off && <p className="mt-0.5 text-sm text-fg-3">{off}</p>}
      </div>
      <span className={cn("mt-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-sm font-medium", k.on ? "bg-positive-soft text-positive" : "bg-surface-2 text-fg-3")}>
        {k.on && <CircleCheck aria-hidden className="size-3.5" strokeWidth={2.25} />}
        {k.on ? "включено" : "выключено"}
      </span>
    </div>
  );
}

/** Ближайшие сообщения: сколько в очереди и сколько ушло за 3 дня, кому (имя или номер маской), когда и о какой записи. */
export function Upcoming({ d, owner, now, empty, title = "Ближайшие" }: { d: ServiceOverview; owner: boolean; now: number; empty: string; title?: string }) {
  return (
    <Group title={title} note={owner ? LIVE_ONLY : TIME}>
      <Stats
        items={[
          { label: "В очереди", value: nf.format(d.total), sub: plural(d.total, MESSAGES) },
          { label: "Отправлено за 3 дня", value: nf.format(d.sent3d), sub: plural(d.sent3d, MESSAGES) },
        ]}
      />
      {d.queue.length ? (
        <ul aria-label="Ближайшие сообщения" className="divide-y divide-line">
          {d.queue.map((x, i) => (
            <QueueRow key={`${x.kind}|${x.at}|${x.phone}|${i}`} x={x} now={now} />
          ))}
        </ul>
      ) : (
        <p className="flex items-start gap-2.5 py-4 text-ui text-fg-2 pointer-coarse:text-base">
          <Inbox aria-hidden className="mt-px size-5 shrink-0 text-fg-3" strokeWidth={1.75} />
          <span>{empty}</span>
        </p>
      )}
      {d.total > d.queue.length && (
        <p className="py-3 text-sm text-fg-3">
          Показаны ближайшие {nf.format(d.queue.length)} из {nf.format(d.total)}.
        </p>
      )}
    </Group>
  );
}

/** Строка очереди: кому (имя или номер маской), когда уйдёт, что и о какой записи. */
function QueueRow({ x, now }: { x: ServiceQueueItem; now: number }) {
  const facts = [SHORT[x.kind], bookingText(x, now), x.channel === "main" ? "с основного номера" : ""].filter(Boolean).join(" · ");
  return (
    <li className="flex items-start gap-3 py-3">
      <Tile kind={x.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className={cn("min-w-0 flex-1 truncate text-md font-medium md:text-base", !x.name && "tnum")}>{x.name || x.phone || "Без имени"}</p>
          <time dateTime={new Date(x.at).toISOString()} className={cn("tnum shrink-0 text-sm", x.at <= now ? "font-medium text-fg" : "text-fg-2")}>
            {sendWhen(x.at, now)}
          </time>
        </div>
        {x.name && x.phone && <p className="tnum text-ui text-fg-2 pointer-coarse:text-base">{x.phone}</p>}
        <p className="mt-0.5 text-sm text-fg-3">{facts}</p>
        {x.why && <p className="mt-0.5 text-sm text-fg-2">{x.why}</p>}
      </div>
    </li>
  );
}

const DRY_WORD: Record<ServiceDryRun["items"][number]["status"], string> = { now: "ушло бы сейчас", later: "по расписанию", wait: "ждёт", skip: "не уйдёт" };

/** Проверка по настоящему журналу Altegio без отправки — только владелец. Ничего не отправляет и не сохраняет: удобно до включения. */
export function DryRunGroup({ ws, now }: { ws: string; now: number }) {
  const [busy, setBusy] = useState(false), [res, setRes] = useState<ServiceDryRun | null>(null), [err, setErr] = useState<string[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // в режиме разработки React монтирует дважды — снова «жив» после первой уборки
    return () => void (alive.current = false);
  }, []);
  const run = async () => {
    const src = store.source;
    if (!src) return;
    setBusy(true);
    setErr([]);
    try {
      const r = await src.serviceDryRun(ws);
      if (alive.current) setRes(r);
    } catch (e) {
      if (alive.current) setErr(errorList(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const count = (st: string) => (res ? res.items.filter((x) => x.status === st).length : 0);
  return (
    <Group title="Проверка по журналу" note="Читает журнал Altegio за вчера, сегодня и завтра и показывает, что ушло бы и почему. Ничего не отправляет и не сохраняет.">
      <div className="py-3">
        {/* на узком телефоне длинная надпись переносится, кнопка — во всю ширину группы */}
        <Button variant="outline" icon={RefreshCw} busy={busy} className="h-auto min-h-11 w-full whitespace-normal py-2 pointer-coarse:h-auto sm:w-auto" onClick={() => void run()}>
          {busy ? "Читаю журнал…" : "Проверить по журналу (без отправки)"}
        </Button>
      </div>
      {err.map((e) => (
        <Notice key={e} tone="critical" role="alert">
          {e}
        </Notice>
      ))}
      {res && !res.ok && <Notice tone="warn" role="status">{res.why || "Проверить нельзя."}</Notice>}
      {res && res.ok && (
        <div role="status">
          {res.records === 0 && <p className="pb-2 text-ui text-fg-2 pointer-coarse:text-base">В журнале за вчера, сегодня и завтра записей нет, сообщений не будет.</p>}
          <p className="pb-2 text-ui text-fg-2 pointer-coarse:text-base">
            Записей в журнале: {nf.format(res.records)}
            {res.cut ? " (прочитаны не все)" : ""}. Сообщений по плану: {nf.format(res.total)}. Сейчас {nf.format(count("now"))}, по расписанию {nf.format(count("later"))}, ждут{" "}
            {nf.format(count("wait"))}, не уйдут {nf.format(count("skip"))}.
            {!res.enabled ? " Отправка выключена, сейчас не ушло бы ничего." : ""}
            {!res.ga ? " Номер Green-API не подключён." : ""}
            {res.hold ? ` Отправка на паузе: ${res.hold.why}.` : ""}
          </p>
          {res.skipped.length > 0 && (
            <p className="pb-2 text-sm text-fg-3">Записи без сообщений: {res.skipped.map((x) => `${x.why}: ${nf.format(x.n)}`).join("; ")}.</p>
          )}
          <ul aria-label="Проверка по журналу" className="divide-y divide-line">
            {res.items.slice(0, 40).map((x, i) => (
              <li key={`${x.kind}|${x.at}|${x.phone}|${i}`} className="py-3">
                <div className="flex items-baseline gap-2">
                  <p className={cn("min-w-0 flex-1 truncate text-md font-medium md:text-base", !x.name && "tnum")}>{x.name ? `${x.name} · ${x.phone}` : x.phone || "Без имени"}</p>
                  <time dateTime={new Date(x.at).toISOString()} className="tnum shrink-0 text-sm text-fg-2">{sendWhen(x.at, now)}</time>
                </div>
                <p className="mt-0.5 text-sm text-fg-3">{[SHORT[x.kind], x.date ? `запись на ${dayWord(x.date, now)}${x.time ? `, ${x.time}` : ""}` : ""].filter(Boolean).join(" · ")}</p>
                <p className={cn("mt-0.5 text-sm", x.status === "skip" ? "text-fg-2" : "text-fg")}>
                  <span className="font-medium">{DRY_WORD[x.status]}</span>
                  {x.why ? `: ${x.why}` : ""}
                </p>
                {x.text && (
                  <details className="mt-1 text-sm">
                    <summary className="cursor-pointer text-accent-ink">Текст{x.lang === "kk" ? " (на казахском)" : ""}</summary>
                    <p className="mt-1 whitespace-pre-line rounded-xl bg-surface-2 px-3 py-2 text-fg-2">{x.text}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {res.items.length > 40 && <p className="py-3 text-sm text-fg-3">Показаны первые 40 из {nf.format(res.items.length)}.</p>}
        </div>
      )}
    </Group>
  );
}

export function ServiceSkeleton() {
  return (
    <div aria-hidden>
      {[3, 2].map((rows, g) => (
        <section key={g} className="mb-6">
          <Skeleton className="mb-2 ml-4 h-3.5 w-40" />
          <div className="rounded-[0.875rem] bg-surface px-4 py-1">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className={cn("flex items-center gap-3 py-3", i && "border-t border-line")}>
                <Skeleton className="size-9 rounded-[0.625rem]" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-3/5" />
                </div>
                <Skeleton className="h-7 w-20 rounded-full" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
