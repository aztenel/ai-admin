// Список чатов: компания, область (номер или филиал), поиск, фильтры и строки. Главное в строке — кто и что написал;
// состояние и номер — тихой третьей строкой, только когда они что-то сообщают.
import { Inbox, RefreshCw, Search, SearchX, X } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import { Avatar, Button, CountBadge, EmptyState, IconButton, Skeleton } from "@/components/ui";
import { channelBadge, channelOf } from "@/model/channels";
import type { ConversationSummary, Workspace } from "@/model/types";
import { formatPhone, rowTime, until, waited } from "@/lib/format";
import { href } from "@/lib/router";
import { cn, useNow } from "@/lib/utils";
import { store, useStore, type Filter } from "@/state/store";
import { WorkspaceSwitcher } from "@/shell/WorkspaceSwitcher";
import { counts, FILTER_TEST, inScope, search } from "./derive";
import { ScopePicker } from "./ScopePicker";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "waiting", label: "Ждут ответа" },
  { id: "operator", label: "Бот на паузе" },
  { id: "unread", label: "Новые" },
];

export function ListPane({ openKey, onOpen, className, inert }: { openKey?: string; onOpen: (key: string) => void; className?: string; inert?: boolean }) {
  const phase = useStore((s) => s.phase);
  const ws = useStore((s) => s.workspace);
  const all = useStore((s) => s.conversations);
  const scope = useStore((s) => s.scope);
  const filter = useStore((s) => s.filter);
  const truncated = useStore((s) => s.truncated);
  const refreshing = useStore((s) => s.refreshing);
  const mode = useStore((s) => s.mode);
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const now = useNow();

  const scoped = useMemo(() => (ws ? inScope(ws, scope, all) : []), [ws, scope, all]);
  const n = useMemo(() => counts(scoped), [scoped]);
  const rows = useMemo(() => (q.trim() ? search(scoped, q) : scoped.filter(FILTER_TEST[filter])), [scoped, q, filter]);
  const multi = !!ws && ws.channels.length > 1 && scope.kind !== "channel";

  return (
    <section aria-label="Чаты" inert={inert} className={cn("flex min-h-0 flex-col bg-surface", className)}>
      <header className="shrink-0 pt-safe">
        <div className="flex items-center gap-1 px-4 pt-2 md:px-3 md:pt-3">
          <WorkspaceSwitcher
            className="min-w-0 flex-1"
            demo={mode === "demo"}
            below={ws && (ws.channels.length > 1 || ws.branches.length > 1) ? <ScopePicker ws={ws} list={all} scope={scope} onChange={(s) => store.setScope(s)} /> : null}
          />
          <IconButton icon={RefreshCw} label="Обновить" onClick={() => store.poll(true)} className={cn("max-md:hidden", refreshing && "[&>svg]:animate-spin")} />
        </div>
        <label className="mx-4 mt-2 flex h-9 items-center gap-2 rounded-lg bg-surface-2 px-2.5 text-fg-3 focus-within:outline-2 focus-within:outline-ring pointer-coarse:h-10 md:mx-3">
          <Search aria-hidden className="size-4 shrink-0" strokeWidth={2} />
          <input
            ref={input}
            type="search"
            enterKeyHint="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            placeholder="Имя, номер или текст"
            aria-label="Поиск по чатам"
            className="min-w-0 flex-1 bg-transparent text-md text-fg outline-none [&::-webkit-search-cancel-button]:hidden md:text-base pointer-coarse:text-md"
          />
          {q && (
            <button type="button" aria-label="Очистить поиск" onClick={() => (setQ(""), input.current?.focus())} className="-mr-1 grid size-7 place-items-center rounded-md text-fg-3 hover:text-fg">
              <X className="size-4" />
            </button>
          )}
        </label>
        {ws && !q && all.length > 0 && (
          <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto px-4 pb-2 pt-2.5 [mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] md:px-3">
            <div role="radiogroup" aria-label="Фильтр" className="flex gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={filter === f.id}
                  onClick={() => store.setFilter(f.id)}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors pointer-coarse:h-9",
                    filter === f.id ? "bg-fg text-surface" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  {f.label}
                  {f.id !== "all" && n[f.id] > 0 && <span className={cn("tnum", f.id === "waiting" && filter !== f.id && "text-critical")}>{n[f.id]}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        {q && <p className="px-4 pb-1.5 pt-2.5 text-sm text-fg-3 md:px-3">{rows.length ? `Найдено: ${rows.length}` : ""}</p>}
      </header>

      <div className="scroll-area min-h-0 flex-1 border-t border-line pb-[calc(env(safe-area-inset-bottom)+4.5rem)] md:pb-2">
        {phase !== "ready" || !ws ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          <Empty filter={filter} q={q} total={scoped.length} />
        ) : (
          <ul className="md:px-1.5 md:pt-1.5">
            {rows.map((c) => (
              <Row key={c.key} c={c} ws={ws} now={now} selected={c.key === openKey} showChannel={multi} onOpen={onOpen} />
            ))}
          </ul>
        )}
        {truncated && phase === "ready" && !q && (
          <p className="px-4 py-4 text-center text-xs text-fg-3">
            Показаны последние {truncated.shown} из {truncated.total}. Ждущие ответа — все.
          </p>
        )}
      </div>
    </section>
  );
}

const Row = memo(function Row({ c, ws, now, selected, showChannel, onOpen }: { c: ConversationSummary; ws: Workspace; now: number; selected: boolean; showChannel: boolean; onOpen: (key: string) => void }) {
  const ch = channelOf(ws, c.ref.channelId);
  const title = c.contact.name || (c.contact.phone ? formatPhone(c.contact.phone) : ch?.kind === "web" ? "Гость сайта" : "Без имени");
  const unread = c.unread || !!c.unreadCount;
  const prefix = c.previewFrom === "bot" ? "Бот: " : c.previewFrom === "operator" ? "Оператор: " : "";
  const status = c.attention
    ? { text: c.attention.label + (c.attention.since ? `, ${waited(c.attention.since, now)}` : ""), tone: "critical" as const }
    : c.bot.state === "paused"
      ? { text: `Бот на паузе ${until(c.bot.until, now)}`, tone: "muted" as const }
      : c.bot.state === "stopped"
        ? { text: "Просил не писать", tone: "muted" as const }
        : null;
  const badge = showChannel ? channelBadge(ch) : "";
  return (
    <li>
      <a
        href={href({ name: "inbox", conv: c.key })}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onOpen(c.key);
        }}
        aria-current={selected ? "true" : undefined}
        className={cn("group flex gap-3 pl-4 outline-offset-[-2px] active:bg-surface-2 md:rounded-lg md:px-2.5 md:hover:bg-surface-2", selected && "bg-selected md:hover:bg-selected")}
      >
        <span className="relative self-start pt-3 md:pt-2.5">
          <Avatar name={c.contact.name} phone={c.contact.phone} size="lg" className="md:size-10 md:text-sm" />
        </span>
        <span className="min-w-0 flex-1 border-b border-line py-2.5 pr-4 group-last:border-transparent md:border-0 md:py-2.5 md:pr-0">
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-lg md:text-base", unread ? "font-semibold" : "font-medium")}>{title}</span>
            <time className={cn("tnum shrink-0 text-xs", unread ? "font-medium text-accent-ink" : "text-fg-3")}>{rowTime(c.lastAt, now)}</time>
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span className={cn("line-clamp-1 min-w-0 flex-1 text-md md:text-sm", unread ? "text-fg" : "text-fg-2")}>
              {prefix && <span className="text-fg-3">{prefix}</span>}
              {c.preview || " "}
            </span>
            {c.unreadCount ? <CountBadge n={c.unreadCount} /> : unread ? <span aria-label="новое" className="size-2.5 shrink-0 rounded-full bg-accent" /> : null}
          </span>
          {(status || badge) && (
            <span className="mt-1 flex items-center gap-2 text-xs">
              {status && (
                <span className={cn("flex min-w-0 items-center gap-1.5 truncate", status.tone === "critical" ? "font-medium text-critical" : "text-fg-3")}>
                  {status.tone === "critical" && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />}
                  <span className="truncate">{status.text}</span>
                </span>
              )}
              {badge && <span className="ml-auto max-w-[40%] shrink-0 truncate text-fg-3">{badge}</span>}
            </span>
          )}
        </span>
      </a>
    </li>
  );
});

function Empty({ filter, q, total }: { filter: Filter; q: string; total: number }) {
  if (q) return <EmptyState icon={SearchX} title="Ничего не нашли" text="Проверьте имя или номер — поиск идёт по всем чатам выбранных номеров." />;
  if (total === 0) return <EmptyState icon={Inbox} title="Чатов пока нет" text="Они появятся, когда клиенты напишут в WhatsApp или в чат на сайте." />;
  const t: Record<Filter, [string, string]> = {
    all: ["Чатов нет", ""],
    waiting: ["Никто не ждёт ответа", "Бот справляется сам. Чаты, где нужен человек, появятся здесь."],
    operator: ["Бот работает во всех чатах", "Здесь будут чаты, где вы ответили клиенту или забрали чат у бота."],
    unread: ["Новых сообщений нет", "Все сообщения клиентов просмотрены на этом устройстве."],
  };
  return (
    <EmptyState
      icon={Inbox}
      title={t[filter][0]}
      text={t[filter][1]}
      action={
        <Button size="sm" variant="outline" onClick={() => store.setFilter("all")}>
          Показать все чаты
        </Button>
      }
    />
  );
}

function ListSkeleton() {
  return (
    <ul aria-label="Загружаю чаты" className="md:px-1.5 md:pt-1.5">
      {Array.from({ length: 7 }, (_, i) => (
        <li key={i} className="flex gap-3 px-4 py-3 md:px-2.5">
          <Skeleton className="size-12 shrink-0 rounded-full md:size-10" />
          <span className="flex-1 space-y-2 pt-1">
            <Skeleton className={cn("h-3.5", ["w-1/2", "w-2/5", "w-3/5", "w-1/3"][i % 4])} />
            <Skeleton className={cn("h-3", ["w-3/4", "w-2/3", "w-5/6", "w-1/2"][i % 4])} />
          </span>
        </li>
      ))}
    </ul>
  );
}
