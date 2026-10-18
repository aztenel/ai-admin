// Список чатов: компания крупным заголовком, справа — какой номер показан; поиск; вкладки-фильтры; строки.
// Главное в строке — кто и что написал. Третьей строкой, одной фразой, — кто ведёт переписку и через какой номер.
// Клиент ждёт человека — вместо времени сообщения красным «сколько ждёт», третья строка — причина.
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
  { id: "operator", label: "Ведёте вы" },
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
        {/* демо — строкой над названием, а не меткой рядом: название компании не обрезается на узком iPhone */}
        {mode === "demo" && <p className="-mb-1.5 px-4 pt-2 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-3">Демо · данные вымышленные</p>}
        {/* крупный шрифт: капсула номера уходит строкой ниже, а не съедает название компании */}
        <div className="flex min-h-[3.25rem] flex-wrap items-center gap-x-2 gap-y-1 pl-4 pr-3 pt-1.5 md:min-h-14 md:pr-2 md:pt-2">
          <WorkspaceSwitcher className="min-w-0 flex-[1_1_10rem]" />
          {ws && (ws.channels.length > 1 || ws.branches.length > 1) && <ScopePicker ws={ws} list={all} scope={scope} onChange={(s) => store.setScope(s)} />}
        </div>
        <div className="mx-4 mt-1.5 flex items-center gap-1 md:mr-2 md:mt-2">
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[0.625rem] bg-surface-2 px-2.5 text-fg-3 focus-within:outline-2 focus-within:outline-ring pointer-coarse:h-10">
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
          {/* на телефоне список обновляется сам (раз в 15 с и при возврате в пульт) — кнопка только на планшете и компьютере */}
          <IconButton icon={RefreshCw} label="Обновить" onClick={() => store.poll(true)} className={cn("max-md:hidden", refreshing && "[&>svg]:animate-spin")} />
        </div>
        {ws && !q && all.length > 0 ? (
          <div role="radiogroup" aria-label="Фильтр" className="no-scrollbar mt-1 flex gap-4 overflow-x-auto border-b border-line px-4 md:gap-3.5 [mask-image:linear-gradient(to_right,#000_calc(100%-1rem),transparent)]">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={filter === f.id}
                onClick={() => store.setFilter(f.id)}
                className={cn(
                  "relative inline-flex h-10 shrink-0 items-center gap-1 text-ui font-medium transition-colors pointer-coarse:h-11 md:text-sm lg:text-ui after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full md:h-9",
                  filter === f.id ? "text-fg after:bg-accent" : "text-fg-3 hover:text-fg-2",
                )}
              >
                {f.label}
                {f.id !== "all" && n[f.id] > 0 && <span className={cn("tnum text-sm", f.id === "waiting" ? "font-semibold text-critical" : "font-normal text-fg-3")}>{n[f.id]}</span>}
              </button>
            ))}
          </div>
        ) : q ? (
          <p className="mt-1 border-b border-line px-4 pb-2 pt-1.5 text-sm text-fg-3">{rows.length ? `Найдено: ${rows.length}` : "\u00a0"}</p>
        ) : (
          <div className="mt-2.5 border-b border-line" />
        )}
      </header>

      <div className="scroll-area min-h-0 flex-1 pb-[calc(var(--safe-b)+4.5rem)] md:pb-2">
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

/** Строка чата — всегда три строки одной высоты: кто и когда; последнее сообщение; кто ведёт и через какой номер.
 *  Обычное состояние (ведёт бот) — тихое: значок бота и название номера. Красное — только когда клиент ждёт человека. */
const Row = memo(function Row({ c, ws, now, selected, showChannel, onOpen }: { c: ConversationSummary; ws: Workspace; now: number; selected: boolean; showChannel: boolean; onOpen: (key: string) => void }) {
  const ch = channelOf(ws, c.ref.channelId);
  const title = c.contact.name || (c.contact.phone ? formatPhone(c.contact.phone) : ch?.kind === "web" ? "Гость сайта" : "Без имени");
  const unread = c.unread || !!c.unreadCount;
  const h = handling(c.attention, c.bot, now);
  const badge = showChannel ? channelBadge(ch) : "";
  // одна фраза вместо двух обрезанных колонок: «Просит человека · ИИ-администратор», «Человек · Основной WhatsApp»
  const state = c.attention ? c.attention.label : c.bot.state === "active" ? (badge ? "" : h.short) : c.bot.state === "paused" ? "Человек" : h.short;
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
        <span className="self-start pt-2.5 md:pt-2.5">
          <Avatar name={c.contact.name} size="lg" className="md:size-10 md:text-sm" />
        </span>
        <span className="min-w-0 flex-1 border-b border-line py-2 pr-4 group-last:border-transparent md:border-0 md:pr-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-md font-semibold tracking-[-0.01em] md:text-base">{title}</span>
            {c.attention?.since ? (
              <span className="tnum shrink-0 text-sm font-semibold text-critical md:text-xs" title={`Ждёт ответа ${waited(c.attention.since, now)}, последнее сообщение — ${rowTime(c.lastAt, now)}`}>
                {waited(c.attention.since, now)}
              </span>
            ) : (
              <time className={cn("tnum shrink-0 text-sm md:text-xs", unread ? "text-fg-2" : "text-fg-3")}>{rowTime(c.lastAt, now)}</time>
            )}
          </span>
          <span className="mt-px flex items-center gap-2">
            <span className={cn("line-clamp-1 min-w-0 flex-1 text-[0.9375rem] leading-5 md:text-ui", unread ? "text-fg" : "text-fg-2")}>{c.preview || "\u00a0"}</span>
            {c.unreadCount ? <CountBadge n={c.unreadCount} /> : unread ? <span aria-label="новое" className="mr-1 size-2.5 shrink-0 rounded-full bg-accent" /> : null}
          </span>
          <span className={cn("mt-0.5 flex min-w-0 items-center gap-1.5 text-sm md:text-xs", c.attention ? "text-critical" : "text-fg-3")} title={[h.text, badge].filter(Boolean).join(" · ")}>
            {c.attention ? <span aria-hidden className="mx-[3px] size-2 shrink-0 rounded-full bg-critical" /> : h.icon ? <h.icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} /> : null}
            <span className="min-w-0 truncate">
              {state && <span className={cn(c.attention && "font-medium")}>{state}</span>}
              {state && badge && <span className="text-fg-3"> · </span>}
              {badge && <span className="text-fg-3">{badge}</span>}
            </span>
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
          <Skeleton className="size-11 shrink-0 rounded-full md:size-10" />
          <span className="flex-1 space-y-2 pt-1">
            <Skeleton className={cn("h-3.5", ["w-1/2", "w-2/5", "w-3/5", "w-1/3"][i % 4])} />
            <Skeleton className={cn("h-3", ["w-3/4", "w-2/3", "w-5/6", "w-1/2"][i % 4])} />
          </span>
        </li>
      ))}
    </ul>
  );
}
