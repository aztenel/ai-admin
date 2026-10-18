// Список чатов: компания, область (номер или филиал), поиск, фильтры и строки. Главное в строке — кто и что написал;
// третьей строкой, тихо — кто ведёт переписку и (если номеров несколько) через какой номер она идёт.
import { Inbox, RefreshCw, Search, SearchX, X } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import { Avatar, Button, CountBadge, EmptyState, IconButton, Skeleton } from "@/components/ui";
import { channelBadge, channelOf } from "@/model/channels";
import type { ConversationSummary, Workspace } from "@/model/types";
import { formatPhone, rowTime, waited } from "@/lib/format";
import { href } from "@/lib/router";
import { cn, useNow } from "@/lib/utils";
import { store, useStore, type Filter } from "@/state/store";
import { WorkspaceSwitcher } from "@/shell/WorkspaceSwitcher";
import { counts, FILTER_TEST, inScope, search } from "./derive";
import { handling } from "./handling";
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
        <div className="flex items-start gap-1 px-4 pt-2.5 md:px-4 md:pt-4">
          <WorkspaceSwitcher
            className="min-w-0 flex-1"
            demo={mode === "demo"}
            below={ws && (ws.channels.length > 1 || ws.branches.length > 1) ? <ScopePicker ws={ws} list={all} scope={scope} onChange={(s) => store.setScope(s)} /> : null}
          />
          <IconButton icon={RefreshCw} label="Обновить" onClick={() => store.poll(true)} className={cn("-mr-1.5 max-md:hidden", refreshing && "[&>svg]:animate-spin")} />
        </div>
        <label className="mx-4 mt-3 flex h-9 items-center gap-2 rounded-[0.625rem] bg-surface-2 px-2.5 text-fg-3 focus-within:outline-2 focus-within:outline-ring pointer-coarse:h-10 md:mt-3.5">
          <Search aria-hidden className="size-4 shrink-0" strokeWidth={2} />
          <input
            ref={input}
            type="search"
            enterKeyHint="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            placeholder="Поиск"
            aria-label="Поиск по имени, номеру или тексту"
            className="min-w-0 flex-1 bg-transparent text-md text-fg outline-none [&::-webkit-search-cancel-button]:hidden md:text-ui pointer-coarse:text-md"
          />
          {q && (
            <button type="button" aria-label="Очистить поиск" onClick={() => (setQ(""), input.current?.focus())} className="-mr-1 grid size-7 place-items-center rounded-md text-fg-3 hover:text-fg">
              <X className="size-4" />
            </button>
          )}
        </label>
        {ws && !q && all.length > 0 && (
          <div role="radiogroup" aria-label="Фильтр" className="no-scrollbar flex gap-1 overflow-x-auto px-4 pb-2.5 pt-2.5 [mask-image:linear-gradient(to_right,#000_calc(100%-1.25rem),transparent)]">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={filter === f.id}
                onClick={() => store.setFilter(f.id)}
                className={cn(
                  "inline-flex h-[1.875rem] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors pointer-coarse:h-9",
                  filter === f.id ? "bg-selected text-selected-fg" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
                )}
              >
                {f.label}
                {f.id !== "all" && n[f.id] > 0 && <span className={cn("tnum", filter === f.id ? "text-selected-fg/75" : "text-fg-3")}>{n[f.id]}</span>}
              </button>
            ))}
          </div>
        )}
        {q && <p className="px-4 pb-2 pt-2.5 text-sm text-fg-3">{rows.length ? `Найдено: ${rows.length}` : ""}</p>}
      </header>

      <div className="scroll-area min-h-0 flex-1 border-t border-line pb-[calc(env(safe-area-inset-bottom)+4.5rem)] md:pb-2">
        {phase !== "ready" || !ws ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          <Empty filter={filter} q={q} total={scoped.length} />
        ) : (
          <ul className="md:px-2 md:pt-1.5">
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

/** Строка чата — всегда три строки одной высоты: кто и когда; последнее сообщение; кто ведёт и через какой номер. */
const Row = memo(function Row({ c, ws, now, selected, showChannel, onOpen }: { c: ConversationSummary; ws: Workspace; now: number; selected: boolean; showChannel: boolean; onOpen: (key: string) => void }) {
  const ch = channelOf(ws, c.ref.channelId);
  const title = c.contact.name || (c.contact.phone ? formatPhone(c.contact.phone) : ch?.kind === "web" ? "Гость сайта" : "Без имени");
  const unread = c.unread || !!c.unreadCount;
  const h = handling(c.attention, c.bot, now);
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
        className={cn(
          "group flex gap-3 pl-4 outline-offset-[-2px] active:bg-surface-2 md:rounded-[0.625rem] md:px-2.5 md:hover:bg-surface-2",
          selected && "md:bg-selected md:hover:bg-selected",
        )}
      >
        <span className="self-start pt-2.5 md:pt-2">
          <Avatar name={c.contact.name} size="lg" className="md:size-9 md:text-[0.8125rem]" />
        </span>
        <span className="min-w-0 flex-1 border-b border-line py-2 pr-4 group-last:border-transparent md:border-0 md:pr-0.5">
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-md tracking-[-0.005em] md:text-base", unread ? "font-semibold" : "font-medium")}>{title}</span>
            <time className="tnum shrink-0 text-sm text-fg-3 md:text-xs">{rowTime(c.lastAt, now)}</time>
          </span>
          <span className="flex items-center gap-2">
            <span className={cn("line-clamp-1 min-w-0 flex-1 text-[0.9375rem] leading-5 md:text-ui", unread ? "text-fg" : "text-fg-2")}>{c.preview || "\u00a0"}</span>
            {c.unreadCount ? <CountBadge n={c.unreadCount} /> : unread ? <span aria-label="новое" className="mr-1 size-2.5 shrink-0 rounded-full bg-accent" /> : null}
          </span>
          <span className="mt-0.5 flex items-center gap-3 text-sm md:text-xs">
            <span className={cn("flex min-w-0 max-w-[72%] shrink-0 items-center gap-1.5", h.tone === "critical" ? "text-critical" : "text-fg-3")}>
              {h.icon ? <h.icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} /> : <span aria-hidden className="mx-[3px] size-2 shrink-0 rounded-full bg-critical" />}
              {c.attention ? (
                <>
                  <span className="truncate font-medium">{c.attention.label}</span>
                  {c.attention.since && <span className="tnum shrink-0 font-medium">· {waited(c.attention.since, now)}</span>}
                </>
              ) : (
                <span className="truncate">{h.short}</span>
              )}
            </span>
            {badge && <span className="ml-auto min-w-0 flex-1 truncate text-right text-fg-3" title={badge}>{badge}</span>}
          </span>
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
    <ul aria-label="Загружаю чаты" className="md:px-2 md:pt-1.5">
      {Array.from({ length: 7 }, (_, i) => (
        <li key={i} className="flex gap-3 px-4 py-3 md:px-2.5">
          <Skeleton className="size-11 shrink-0 rounded-full md:size-9" />
          <span className="flex-1 space-y-2 pt-1">
            <Skeleton className={cn("h-3.5", ["w-1/2", "w-2/5", "w-3/5", "w-1/3"][i % 4])} />
            <Skeleton className={cn("h-3", ["w-3/4", "w-2/3", "w-5/6", "w-1/2"][i % 4])} />
          </span>
        </li>
      ))}
    </ul>
  );
}
