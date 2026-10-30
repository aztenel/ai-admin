// Сервисные сообщения — вкладка «Сервисные · номер бота» (решение владельца 19.10.2026). Это не рассылки: бот шлёт их сам, без
// администраторов, только по записям, которые клиент сделал в чате с ботом, и с того номера, куда клиент писал (у Winchester — номер бота).
// Здесь: что включено (напоминание накануне в 18:00, за 2 часа, просьба об отзыве со ссылкой), ближайшие в очереди, сколько ушло за 3 дня
// и предупреждение, если бот на номере бота выключен. Всё — из GET /api/bc/service; чего сервер не знает, не показываем.
// Владелец и сотрудник видят одно и то же — менять здесь нечего (только пояснение про черновик сайта — владельцу). Номера — только
// маской, как их отдаёт сервер. Время — по Астане, как у сервера (пульт могут открыть с компьютера в другом часовом поясе).
// Тексты — по данным сервера (находка проверки 19.10.2026): не «с номера бота», а с того номера, куда писал клиент; без записи через
// Altegio напоминаний не бывает — так и пишем, а не «включено».
import { BellRing, CalendarClock, CircleCheck, Inbox, RefreshCw, Star, TriangleAlert, type LucideIcon } from "lucide-react";
import { Button, Skeleton } from "@/components/ui";
import { plural } from "@/lib/format";
import { cn, useNow } from "@/lib/utils";
import type { ServiceKind, ServiceKindState, ServiceOverview, ServiceQueueItem } from "@/model/campaigns";
import { Group } from "@/screens/Page";
import { astanaDay, nf, Notice, Stats, visitDay, when } from "./base/shared";
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

const ICON: Record<ServiceKind, LucideIcon> = { d1: CalendarClock, h2: BellRing, rv: Star };
/** Если сервер не прислал подпись — своя, те же слова. */
const LABEL: Record<ServiceKind, string> = {
  d1: "Накануне в 18:00 — напоминание о записи",
  h2: "За 2 часа — напоминание о записи",
  rv: "Через 3 часа после визита — просьба оставить отзыв",
};
/** Коротко — в строке очереди. */
const SHORT: Record<ServiceKind, string> = { d1: "Напоминание накануне", h2: "Напоминание за 2 часа", rv: "Просьба об отзыве" };
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
        {d.kinds.length ? d.kinds.map((k) => <KindRow key={k.kind} k={k} altegio={d.altegio} paused={d.journal && d.enabled === false} />) : <p className="py-3 text-ui text-fg-2 pointer-coarse:text-base">Сведений нет.</p>}
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
  const off = k.on ? "" : paused ? "Пока выключено — включается после согласия владельца." : !altegio ? "Только по записям через Altegio." : k.kind === "rv" ? "Нет ссылки на отзывы (2ГИС, Google Карты)." : "Выключено в настройках бота.";
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
          k.on ? "bg-positive-soft text-positive" : "bg-surface-2 text-fg-3",
        )}
      >
        {k.on && <CircleCheck aria-hidden className="size-3.5" strokeWidth={2.25} />}
        {k.on ? "включено" : "выключено"}
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
      </div>
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
