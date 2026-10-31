// Сервисные сообщения — вкладка «Сервисные · номер бота» (решение владельца 19.10.2026). Это не рассылки: бот шлёт их сам, без
// администраторов, только по записям, которые клиент сделал в чате с ботом, и с того номера, куда клиент писал (у Winchester — номер бота).
// Здесь: что включено (напоминание накануне в 18:00, за 2 часа, просьба об отзыве со ссылкой), ближайшие в очереди, сколько ушло за 3 дня
// и предупреждение, если бот на номере бота выключен. Всё — из GET /api/bc/service; чего сервер не знает, не показываем.
// Владелец и сотрудник видят одно и то же — менять здесь нечего (только пояснение про черновик сайта — владельцу). Номера — только
// маской, как их отдаёт сервер. Время — по Астане, как у сервера (пульт могут открыть с компьютера в другом часовом поясе).
// Тексты — по данным сервера (находка проверки 19.10.2026): не «с номера бота», а с того номера, куда писал клиент; без записи через
// Altegio напоминаний не бывает — так и пишем, а не «включено».
// ТЗ v2.0 §4 (31.10.2026): у вида — одобрен ли текст владельцем (без одобрения не уходит), «Последние решения» по очереди (ушло,
// отменено — запись перенесли, пропущено и почему, задача администратору), «Проверка по журналу» без отправки (владелец) и
// «Тексты сообщений» — каталог сценариев S01–S18 с предпросмотром RU/KZ и одобрением текста владельцем.
import { useEffect, useRef, useState } from "react";
import { Ban, BellRing, CalendarCheck, CalendarClock, CalendarSync, CircleCheck, CircleHelp, ClipboardCheck, Inbox, RefreshCw, Star, TriangleAlert, UserX, type LucideIcon } from "lucide-react";
import { toast } from "@/components/overlay";
import { Button, Skeleton } from "@/components/ui";
import { plural } from "@/lib/format";
import { cn, useNow } from "@/lib/utils";
import type { ServiceDryRun, ServiceKind, ServiceKindState, ServiceLogItem, ServiceOverview, ServiceQueueItem, ServiceScenario } from "@/model/campaigns";
import { Group } from "@/screens/Page";
import { store } from "@/state/store";
import { astanaDay, nf, Notice, Stats, visitDay, when } from "./base/shared";
import { errorList } from "./common";
import { useLoad } from "./useLoad";

const WHO = "Отправляет бот сам, с того номера, куда писал клиент, — только тем, кто записался через бота. Администратору ничего делать не нужно.";
/** Кто и кому шлёт — по данным сервера. */
// второй номер Winchester без бота (30.10.2026): напоминания и отзыв — по всем записям журнала Altegio
const JOURNAL = "Уходят сами со второго номера по всем записям журнала Altegio — администратора, сайта, онлайн-записи. Отзыв — только тем, у кого в Altegio отмечено «пришёл». Администратору ничего делать не нужно.";
function who(d: ServiceOverview): string {
  if (d.journal && d.enabled === false) return "Напоминания и просьба об отзыве по журналу Altegio готовы, но выключены: включаются на сервере после согласия владельца компании.";
  if (d.journal) return d.altegio ? JOURNAL : "Напоминания строятся по журналу Altegio, а ключ журнала не подключён — сообщения не уходят.";
  if (!d.altegio)
    return "Напоминания и просьбу об отзыве бот шлёт сам, но только по записям, которые он сделал в Altegio. У компании запись через Altegio не подключена — эти сообщения не уходят.";
  return `${WHO} Тем, кого администратор записал прямо в Altegio, бот не напоминает.`;
}
const TIME = "Время — по Астане.";
// «боевой сайт / черновик» — слова владельца (так он выкладывает бота); администраторам компании они ничего не говорят
const LIVE_ONLY = `${TIME} Сообщения уходят только с боевого сайта: там бот раз в минуту проверяет очередь. С черновика они не отправляются.`;

const ICON: Record<ServiceKind, LucideIcon> = { s01: CalendarCheck, d1: CalendarClock, h2: BellRing, s06: CalendarSync, rv: Star };
/** Если сервер не прислал подпись — своя, те же слова. */
const LABEL: Record<ServiceKind, string> = {
  s01: "Сразу после новой записи — подтверждение",
  d1: "Накануне в 18:00 — напоминание о записи",
  h2: "За 2 часа — напоминание о записи",
  s06: "После переноса — сообщение с новым временем",
  rv: "Через 3 часа после визита — просьба оставить отзыв",
};
/** Коротко — в строке очереди. */
const SHORT: Record<ServiceKind, string> = { s01: "Подтверждение записи", d1: "Напоминание накануне", h2: "Напоминание за 2 часа", s06: "Сообщение о переносе", rv: "Просьба об отзыве" };
const MESSAGES: [string, string, string] = ["сообщение", "сообщения", "сообщений"];
// очередь меняется медленно (фон шлёт раз в минуту) — раз в минуту и перечитываем, пока вкладка открыта
const POLL_MS = 60e3;

/** «сегодня», «завтра», «вчера» или «5 октября» — по дню ГГГГ-ММ-ДД по Астане. */
function dayWord(iso: string, now: number): string {
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

export default function ServiceMessages({ ws, owner }: { ws: string; owner: boolean }) {
  const now = useNow();
  const svc = useLoad((src) => src.serviceMessages(ws), [ws], { pollMs: POLL_MS });
  const d = svc.data;

  if (svc.loading) return <ServiceSkeleton />;
  if (!d)
    return (
      <Group title="Что бот отправляет сам" note={WHO}>
        <div className="pb-3">
          <Notice tone="critical" role="alert">
            Не загрузилось: {svc.error}
          </Notice>
          <Button variant="outline" icon={RefreshCw} className="mb-1" onClick={() => void svc.reload()}>
            Повторить
          </Button>
        </div>
      </Group>
    );

  return (
    <>
      {d.journal && d.hold && (
        <section role="status" className="mb-4 flex gap-2.5 rounded-[0.875rem] bg-surface px-4 py-3">
          <TriangleAlert aria-hidden className="mt-0.5 size-[1.125rem] shrink-0 text-fg" strokeWidth={2} />
          <div className="min-w-0">
            <p className="text-[0.9375rem] font-semibold md:text-base">Отправка на паузе</p>
            <p className="mt-0.5 text-ui text-fg-2 pointer-coarse:text-base">Green-API не принял сообщение: {d.hold.why}. Через 6 часов попробуем снова — проверьте, не заблокирован ли номер.</p>
          </div>
        </section>
      )}
      {d.botOff && !d.journal && (
        <section role="status" className="mb-4 flex gap-2.5 rounded-[0.875rem] bg-surface px-4 py-3">
          <TriangleAlert aria-hidden className="mt-0.5 size-[1.125rem] shrink-0 text-fg" strokeWidth={2} />
          <div className="min-w-0">
            <p className="text-[0.9375rem] font-semibold md:text-base">Бот на номере бота выключен</p>
            <p className="mt-0.5 text-ui text-fg-2 pointer-coarse:text-base">Он не отвечает клиентам и не записывает их — новых напоминаний и просьб об отзыве не будет.</p>
          </div>
        </section>
      )}

      <Group title={d.journal ? "Что уходит само" : "Что бот отправляет сам"} note={who(d)}>
        {d.kinds.length ? (
          // по журналу Altegio выключенные подтверждение и «перенесли» не показываем строкой — они в «Текстах сообщений»
          d.kinds.filter((k) => k.on || (k.kind !== "s01" && k.kind !== "s06")).map((k) => <KindRow key={k.kind} k={k} altegio={d.altegio} paused={d.journal && d.enabled === false} />)
        ) : (
          <p className="py-3 text-ui text-fg-2 pointer-coarse:text-base">Сведений нет.</p>
        )}
      </Group>

      <Group title="Ближайшие" note={owner ? LIVE_ONLY : TIME}>
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
            <span>Ближайших сообщений нет. Они появятся, когда клиент запишется через бота.</span>
          </p>
        )}
        {d.total > d.queue.length && (
          <p className="py-3 text-sm text-fg-3">
            Показаны ближайшие {nf.format(d.queue.length)} из {nf.format(d.total)}.
          </p>
        )}
      </Group>
      {svc.error && (
        <p role="alert" className="-mt-3 mb-4 px-4 text-sm text-critical">
          Не обновилось: {svc.error}
        </p>
      )}
      {d.journal && !!d.log?.length && <LogGroup log={d.log} now={now} />}
      {d.journal && owner && <DryRunGroup ws={ws} now={now} />}
      {!!d.catalog?.length && <CatalogGroup ws={ws} owner={owner} catalog={d.catalog} onChanged={() => void svc.reload()} />}
    </>
  );
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
function KindRow({ k, altegio, paused }: { k: ServiceKindState; altegio: boolean; paused?: boolean }) {
  const [head, tail] = (k.label || LABEL[k.kind]).split(" — ");
  const what = tail ? tail[0].toUpperCase() + tail.slice(1) : "";
  const waiting = k.on && k.approved === false; // включено, а текст владелец ещё не одобрил — не уходит
  const off = waiting ? "Текст не одобрен владельцем — пока не уходит. Одобрить — в «Текстах сообщений» ниже." : k.on ? "" : paused ? "Пока выключено — включается после согласия владельца." : !altegio ? "Только по записям через Altegio." : k.kind === "rv" ? "Нет ссылки на отзывы (2ГИС, Google Карты)." : "Выключено в настройках бота.";
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
      <span
        className={cn(
          "mt-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-sm font-medium",
          k.on && !waiting ? "bg-positive-soft text-positive" : waiting ? "bg-surface-2 text-fg-2" : "bg-surface-2 text-fg-3",
        )}
      >
        {k.on && !waiting && <CircleCheck aria-hidden className="size-3.5" strokeWidth={2.25} />}
        {waiting ? "ждёт одобрения" : k.on ? "включено" : "выключено"}
      </span>
    </div>
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

const STATE: Record<ServiceLogItem["state"], { word: string; icon: LucideIcon; tone: string }> = {
  sent: { word: "ушло", icon: CircleCheck, tone: "text-positive" },
  cancelled: { word: "отменено", icon: Ban, tone: "text-fg-3" },
  skipped: { word: "не ушло", icon: Ban, tone: "text-fg-3" },
  task: { word: "задача администратору", icon: ClipboardCheck, tone: "text-critical" },
  unknown: { word: "неизвестно, ушло ли", icon: CircleHelp, tone: "text-fg-2" },
};
const KIND_OR_NOSHOW = (k: ServiceLogItem["kind"]) => (k === "noshow" ? "Не пришёл на запись" : SHORT[k]);

/** Последние решения по очереди: ушло, отменено (запись перенесли или удалили), не ушло и почему, задача администратору. Новые сверху. */
function LogGroup({ log, now }: { log: ServiceLogItem[]; now: number }) {
  return (
    <Group title="Последние решения" note="Что произошло с сообщениями очереди за последние 3 дня и почему. Время — по Астане.">
      <ul aria-label="Последние решения" className="divide-y divide-line">
        {log.map((x, i) => {
          const st = STATE[x.state], Icon = x.kind === "noshow" ? UserX : st.icon;
          const booking = x.date ? `запись на ${dayWord(x.date, now)}${x.time ? `, ${x.time}` : ""}` : "";
          return (
            <li key={`${x.at}|${x.phone}|${x.kind}|${i}`} className="flex items-start gap-3 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-[0.625rem] bg-surface-2">
                <Icon aria-hidden className={cn("size-[1.125rem]", st.tone)} strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <p className={cn("min-w-0 flex-1 truncate text-md font-medium md:text-base", !x.name && "tnum")}>{x.name || x.phone || "Без имени"}</p>
                  <time dateTime={new Date(x.at).toISOString()} className="tnum shrink-0 text-sm text-fg-2">{`${dayWord(astanaDay(x.at), now)}, ${when(x.at, now).time}`}</time>
                </div>
                {x.name && x.phone && <p className="tnum text-ui text-fg-2 pointer-coarse:text-base">{x.phone}</p>}
                <p className="mt-0.5 text-sm text-fg-3">{[KIND_OR_NOSHOW(x.kind), booking].filter(Boolean).join(" · ")}</p>
                {/* у задачи и «неизвестно» причина уже называет состояние — не повторяем */}
                <p className={cn("mt-0.5 text-sm", x.state === "task" ? "text-critical" : "text-fg-2")}>
                  {(x.state === "task" || x.state === "unknown") && x.why ? (
                    x.why
                  ) : (
                    <>
                      <span className="font-medium">{st.word}</span>
                      {x.why && x.state !== "sent" ? ` — ${x.why}` : ""}
                    </>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </Group>
  );
}

const DRY_WORD: Record<ServiceDryRun["items"][number]["status"], string> = { now: "ушло бы сейчас", later: "по расписанию", wait: "ждёт", skip: "не уйдёт" };

/** Проверка по настоящему журналу Altegio без отправки — только владелец. Ничего не отправляет и не сохраняет: удобно до включения. */
function DryRunGroup({ ws, now }: { ws: string; now: number }) {
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
          {res.records === 0 && <p className="pb-2 text-ui text-fg-2 pointer-coarse:text-base">В журнале за вчера, сегодня и завтра записей нет — сообщений не будет.</p>}
          <p className="pb-2 text-ui text-fg-2 pointer-coarse:text-base">
            Записей в журнале: {nf.format(res.records)}
            {res.cut ? " (прочитаны не все)" : ""}. Сообщений по плану: {nf.format(res.total)} — сейчас {nf.format(count("now"))}, по расписанию {nf.format(count("later"))}, ждут{" "}
            {nf.format(count("wait"))}, не уйдут {nf.format(count("skip"))}.
            {!res.enabled ? " Отправка на сервере выключена — сейчас не ушло бы ничего." : ""}
            {!res.ga ? " Номер Green-API не подключён." : ""}
            {res.hold ? ` Отправка на паузе: ${res.hold.why}.` : ""}
          </p>
          {res.skipped.length > 0 && (
            <p className="pb-2 text-sm text-fg-3">Записи без сообщений: {res.skipped.map((x) => `${x.why} — ${nf.format(x.n)}`).join("; ")}.</p>
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
                  {x.why ? ` — ${x.why}` : ""}
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

const MODE_WORD: Record<ServiceScenario["mode"], string> = { auto: "уходит само", reply: "ответ в переписке", task: "задача администратору", off: "не подключено" };

/** Тексты сообщений: каталог сценариев S01–S18 с предпросмотром RU/KZ; владелец одобряет текст — без этого он сам не уходит. */
function CatalogGroup({ ws, owner, catalog, onChanged }: { ws: string; owner: boolean; catalog: ServiceScenario[]; onChanged: () => void }) {
  return (
    <Group title="Тексты сообщений" note="Сервисные сообщения — не реклама. Сами уходят только сценарии «уходит само» с текстом, который одобрил владелец. Пример — на вымышленной записи.">
      <ul aria-label="Тексты сообщений" className="divide-y divide-line">
        {catalog.map((x) => (
          <ScenarioRow key={x.id} ws={ws} owner={owner} x={x} onChanged={onChanged} />
        ))}
      </ul>
    </Group>
  );
}

function ScenarioRow({ ws, owner, x, onChanged }: { ws: string; owner: boolean; x: ServiceScenario; onChanged: () => void }) {
  const [lang, setLang] = useState<"ru" | "kk">("ru"), [busy, setBusy] = useState(false);
  const text = x.preview[lang] || (lang === "kk" ? "" : x.preview.ru);
  const canApprove = owner && x.mode === "auto" && !!x.kind && !!x.preview.ru;
  const approve = async (on: boolean) => {
    const src = store.source;
    if (!src) return;
    setBusy(true);
    try {
      await src.serviceApprove(ws, x.id, x.v, on);
      toast(on ? `Текст ${x.id} одобрен` : `Одобрение ${x.id} снято — сообщение не уходит`);
      onChanged();
    } catch (e) {
      toast(errorList(e)[0] || "Не получилось");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="py-3">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[0.9375rem] font-semibold md:text-base">
          <span className="tnum text-fg-3">{x.id}</span> {x.title}
        </p>
        <span className={cn("mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs font-medium", x.mode === "auto" ? (x.approved ? "bg-positive-soft text-positive" : "bg-surface-2 text-fg-2") : "bg-surface-2 text-fg-3")}>
          {x.mode === "auto" && x.kind ? (x.approved ? "одобрено" : "ждёт одобрения") : MODE_WORD[x.mode]}
        </span>
      </div>
      {x.trigger && <p className="mt-0.5 text-sm text-fg-2">{x.trigger}</p>}
      {x.note && <p className="mt-0.5 text-sm text-fg-3">{x.note}</p>}
      {(x.preview.ru || x.preview.kk) && (
        <div className="mt-2">
          {x.preview.kk && (
            <div role="group" aria-label={`Язык примера ${x.id}`} className="mb-1.5 inline-flex rounded-lg bg-surface-2 p-0.5 text-sm">
              {(["ru", "kk"] as const).map((l) => (
                <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={cn("rounded-md px-2.5 py-0.5 pointer-coarse:py-1.5", lang === l ? "bg-surface font-medium text-fg shadow-sm" : "text-fg-2")}>
                  {l === "ru" ? "Русский" : "Қазақша"}
                </button>
              ))}
            </div>
          )}
          <p className="whitespace-pre-line rounded-xl bg-surface-2 px-3 py-2 text-sm text-fg-2">{text}</p>
        </div>
      )}
      {canApprove && (
        <div className="mt-2">
          <Button size="sm" variant={x.approved ? "secondary" : "primary"} disabled={busy} onClick={() => void approve(!x.approved)}>
            {x.approved ? "Снять одобрение" : "Одобрить текст"}
          </Button>
        </div>
      )}
    </li>
  );
}

function ServiceSkeleton() {
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
