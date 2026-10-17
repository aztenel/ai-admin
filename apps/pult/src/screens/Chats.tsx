// Экран «Чаты» по образцу D5 (Dribbble «Schedulo»): одна белая карточка — список чатов | переписка | клиент
// с выбором дня и свободного времени. Цвета — D15. Доска (B1) — второй вид списка.
import { ArrowLeft, CalendarCheck, Check, ChevronLeft, ChevronRight, Clock, Hand, Info, KanbanSquare, List, Phone, Search, StickyNote } from "lucide-react";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Chat, ChatInputArea, ChatInputField, ChatInputSubmit, ChatMessages, ChatViewport, type ChatSubmitEvent } from "@/components/ui/chat";
import { GlobalSearch, type SearchResult } from "@/components/ui/command-menu-04";
import { KanbanBoard, type KanbanColumn } from "@/components/ui/kanban-board";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { FREE_SLOTS, STAGES, type Conv, type Stage } from "@/demo/data";
import { cn } from "@/lib/utils";
import { Avatar, ChannelIcon, CountPill, LineTabs } from "./parts";

type Tab = "wait" | "bot" | "all";

const STATUS: Record<Stage, { label: string; tone: string }> = {
  wait: { label: "ждёт ответа", tone: "text-amber-700" },
  bot: { label: "ведёт бот", tone: "text-muted-foreground" },
  booked: { label: "записан", tone: "text-emerald-700" },
  done: { label: "готово", tone: "text-muted-foreground" },
};

const now = () => new Date().toTimeString().slice(0, 5);
const title = (c: Conv) => c.name ?? c.phone;
const initials = (c: Conv) => (c.name ? c.name.slice(0, 2).toUpperCase() : c.phone.slice(-2));

/** Неделя, начиная с сегодня: подписи для полоски дней. */
const week = () =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
      i,
      wd: d.toLocaleDateString("ru-RU", { weekday: "short" }),
      day: d.getDate(),
      label: i === 0 ? "сегодня" : i === 1 ? "завтра" : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }),
      range: d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }),
    };
  });

export function ChatsScreen({
  convs,
  setConvs,
  searchOpen,
  setSearchOpen,
}: {
  convs: Conv[];
  setConvs: Dispatch<SetStateAction<Conv[]>>;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
}) {
  // на широком экране сразу открыт первый чат; на телефоне и планшете — список (чат открывается нажатием, как в мессенджере)
  const [openId, setOpenId] = useState<string | null>(() => (window.matchMedia("(min-width: 1024px)").matches ? "c1" : null));
  const [tab, setTab] = useState<Tab>("wait");
  const [q, setQ] = useState("");
  const [view, setView] = useState<"list" | "board">("list");
  const [sheetChat, setSheetChat] = useState<string | null>(null); // чат панелью справа (вид «доска»)
  const [infoOpen, setInfoOpen] = useState(false); // карточка клиента панелью (узкий экран)
  const open = convs.find((c) => c.id === openId) ?? null;
  const sheetConv = convs.find((c) => c.id === sheetChat) ?? null;

  const count = (t: Tab) => convs.filter((c) => (t === "all" ? true : c.stage === t)).length;
  const needle = q.trim().toLowerCase().replace(/\s/g, "");
  const list = convs.filter(
    (c) => (tab === "all" ? true : c.stage === tab) && (!needle || ((c.name ?? "") + c.phone + (c.messages.at(-1)?.text ?? "")).toLowerCase().replace(/\s/g, "").includes(needle)),
  );

  const patch = (id: string, f: (c: Conv) => Conv) => setConvs((all) => all.map((c) => (c.id === id ? f(c) : c)));
  const event = (text: string) => ({ id: String(Date.now()) + Math.random(), who: "event" as const, text, at: now() });
  const select = (id: string) => {
    setOpenId(id);
    patch(id, (c) => ({ ...c, unread: 0 }));
  };
  const actions = {
    take: (c: Conv) => patch(c.id, (x) => ({ ...x, owner: "Айгерим", messages: [...x.messages, event("Айгерим забрала чат у бота")] })),
    done: (c: Conv) => patch(c.id, (x) => ({ ...x, stage: "done", unread: 0 })),
    send: (c: Conv, e: ChatSubmitEvent) =>
      patch(c.id, (x) => ({ ...x, owner: "Айгерим", at: now(), messages: [...x.messages, { id: String(Date.now()), who: "admin", text: e.message, at: now() }] })),
    book: (c: Conv, label: string, time: string) =>
      patch(c.id, (x) => ({ ...x, stage: "booked", booking: `${label[0].toUpperCase() + label.slice(1)}, ${time} · Запись из пульта`, messages: [...x.messages, event(`Айгерим записала: ${label}, ${time}`)] })),
  };

  const columns = useMemo<KanbanColumn[]>(
    () =>
      STAGES.map((s) => ({
        id: s.id,
        name: s.name,
        accent: s.accent,
        tasks: convs
          .filter((c) => c.stage === s.id)
          .map((c) => ({
            id: c.id,
            title: c.name ? `${c.name} · ${c.phone}` : c.phone,
            note: c.reason,
            priority: c.urgent ? "urgent" : undefined,
            category: c.channel,
            icon: <ChannelIcon channel={c.channel} className="h-3 w-3" />,
            due: c.at,
            dueSoon: s.id === "wait",
            assignees: [{ name: c.owner }],
          })),
      })),
    [convs],
  );
  const onBoard = (next: KanbanColumn[]) =>
    setConvs((all) => next.flatMap((col) => col.tasks.map((t) => ({ ...all.find((c) => c.id === t.id)!, stage: col.id as Stage }))));

  const results: SearchResult[] = convs.map((c) => ({
    id: c.id,
    kind: "chat",
    title: c.name ? `${c.name} · ${c.phone}` : c.phone,
    snippet: c.messages.at(-1)?.text ?? "",
    date: c.at,
  }));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl bg-card">
      {/* список чатов */}
      <section
        className={cn(
          "flex min-h-0 w-full min-w-0 flex-col bg-muted/50 lg:w-[330px] lg:shrink-0",
          view === "board" && "bg-card lg:w-auto lg:flex-1",
          open && view === "list" && "max-lg:hidden",
        )}
      >
        <header className="flex items-center gap-2 px-4 pb-2 pt-4">
          <h1 className="text-lg font-semibold">Чаты</h1>
          <div className="ml-auto flex items-center gap-0.5 rounded-full bg-card p-0.5 shadow-sm">
            {(["list", "board"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-label={v === "list" ? "Список" : "Доска"}
                title={v === "list" ? "Список" : "Доска"}
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cn("grid size-8 place-items-center rounded-full text-muted-foreground transition-colors", view === v && "bg-primary text-primary-foreground")}
              >
                {v === "list" ? <List className="size-4" /> : <KanbanSquare className="size-4" />}
              </button>
            ))}
          </div>
        </header>

        {view === "list" ? (
          <>
            <LineTabs
              className="mx-4"
              label="Фильтр чатов"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: "wait", name: "Ждут", count: count("wait") },
                { id: "bot", name: "Бот", count: count("bot") },
                { id: "all", name: "Все", count: count("all") },
              ]}
            />
            <label className="mx-4 my-3 flex h-10 items-center gap-2 rounded-xl border bg-card px-3">
              <Search className="size-4 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск…" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </label>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {list.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => select(c.id)}
                    className={cn(
                      "flex w-full gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-card/70",
                      c.id === openId && "bg-card shadow-sm ring-1 ring-border",
                    )}
                  >
                    <Avatar label={initials(c)} seed={c.id} urgent={c.urgent} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{title(c)}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{c.at}</span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className={cn("truncate text-[13px]", c.unread ? "font-medium text-foreground" : "text-muted-foreground")}>{c.messages.at(-1)?.text}</span>
                        {c.unread > 0 && <CountPill tone="red">{c.unread}</CountPill>}
                      </span>
                      <span className={cn("mt-1 flex items-center gap-1.5 text-xs", c.urgent ? "text-rose-600" : STATUS[c.stage].tone)}>
                        <ChannelIcon channel={c.channel} className="size-3" />
                        {c.stage === "wait" ? c.reason : STATUS[c.stage].label}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">Здесь пусто.</li>}
            </ul>
          </>
        ) : (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 pt-2">
            <KanbanBoard className="min-w-0" label="Чаты по этапам" columns={columns} onChange={onBoard} onTaskOpen={(t) => setSheetChat(t.id)} addLabel={null} />
          </div>
        )}
      </section>

      {/* переписка + клиент */}
      {view === "list" &&
        (open ? (
          <>
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              <ChatPane c={open} onBack={() => setOpenId(null)} onInfo={() => setInfoOpen(true)} actions={actions} />
            </section>
            <aside className="hidden min-h-0 w-[300px] shrink-0 overflow-y-auto border-l xl:block">
              <ClientPane c={open} onBook={actions.book} />
            </aside>
          </>
        ) : (
          <section className="hidden flex-1 place-items-center text-sm text-muted-foreground lg:grid">Выберите чат слева</section>
        ))}

      {/* вид «доска»: чат панелью справа; узкий экран: карточка клиента панелью */}
      <Sheet open={!!sheetConv} onOpenChange={(v) => !v && setSheetChat(null)}>
        <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-md">
          <SheetTitle className="sr-only">Переписка</SheetTitle>
          {sheetConv && <ChatPane c={sheetConv} onBack={() => setSheetChat(null)} actions={{ ...actions, done: (c) => (actions.done(c), setSheetChat(null)) }} backAlways />}
        </SheetContent>
      </Sheet>
      <Sheet open={infoOpen && !!open} onOpenChange={setInfoOpen}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-sm">
          <SheetTitle className="sr-only">Клиент</SheetTitle>
          {open && <ClientPane c={open} onBook={actions.book} />}
        </SheetContent>
      </Sheet>

      <GlobalSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onSelect={(r) => {
          setSearchOpen(false);
          if (view === "board") setSheetChat(r.id);
          else select(r.id);
        }}
        lastOpened={results.filter((r) => convs.find((c) => c.id === r.id)?.stage === "wait")}
        recent={results.filter((r) => convs.find((c) => c.id === r.id)?.stage !== "wait")}
        results={results}
      />
    </div>
  );
}

type Actions = {
  take: (c: Conv) => void;
  done: (c: Conv) => void;
  send: (c: Conv, e: ChatSubmitEvent) => void;
};

function ChatPane({ c, onBack, onInfo, actions, backAlways }: { c: Conv; onBack: () => void; onInfo?: () => void; actions: Actions; backAlways?: boolean }) {
  return (
    <>
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b px-4 py-2">
        <button
          type="button"
          aria-label="Назад к списку"
          onClick={onBack}
          className={cn("-ml-1 grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted", !backAlways && "lg:hidden")}
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{c.name ? `${c.name}` : c.phone}</p>
          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <ChannelIcon channel={c.channel} className="size-3" />
            {c.channel} · {c.owner === "Бот" ? "ведёт бот" : `ведёт ${c.owner}`}
            {c.name && <span className="max-sm:hidden"> · {c.phone}</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {c.owner === "Бот" && (
            <Button size="sm" className="h-9 rounded-full px-3.5" onClick={() => actions.take(c)}>
              <Hand className="size-4 lg:mr-1.5" />
              <span className="max-lg:hidden">Забрать чат</span>
            </Button>
          )}
          {c.stage !== "done" && (
            <Button size="sm" variant="outline" className="h-9 rounded-full px-3.5" onClick={() => actions.done(c)}>
              <Check className="size-4 lg:mr-1.5" />
              <span className="max-lg:hidden">Готово</span>
            </Button>
          )}
          {onInfo && (
            <button type="button" aria-label="Клиент" onClick={onInfo} className="grid size-9 place-items-center rounded-full border text-muted-foreground hover:bg-muted xl:hidden">
              <Info className="size-4" />
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <Chat onSubmit={(e) => actions.send(c, e)}>
          <ChatViewport className="flex-1 rounded-none border-0 bg-transparent px-0">
            <ChatMessages>
              <Chip>Начало переписки</Chip>
              {c.stage === "wait" && <Chip tone={c.urgent ? "rose" : "amber"}>{c.reason} — ответьте клиенту или верните чат боту</Chip>}
              {c.messages.map((m) =>
                m.who === "event" ? (
                  <Chip key={m.id}>{m.text}</Chip>
                ) : m.who === "client" ? (
                  <div key={m.id} className="my-3 flex items-start gap-2">
                    <Avatar label={initials(c)} seed={c.id} size="size-7" className="mt-0.5 text-[10px]" />
                    <div className="max-w-[min(30rem,80%)] rounded-2xl rounded-tl-md bg-muted px-4 py-2.5 text-sm">
                      <p className="whitespace-pre-wrap">{m.text}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{m.at}</p>
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="my-3 flex justify-end">
                    <div className={cn("max-w-[min(30rem,80%)] rounded-2xl rounded-tr-md px-4 py-2.5 text-sm text-white", m.who === "bot" ? "bg-bot" : "bg-primary")}>
                      <p className="whitespace-pre-wrap">{m.text}</p>
                      <p className="mt-1 text-[11px] text-white/70">{m.who === "bot" ? `бот · ${m.at}` : `Айгерим · ${m.at}`}</p>
                    </div>
                  </div>
                ),
              )}
            </ChatMessages>
          </ChatViewport>
          <ChatInputArea className="rounded-2xl">
            <ChatInputField multiline placeholder="Ответить с номера бизнеса… (Enter — отправить)" />
            <ChatInputSubmit />
          </ChatInputArea>
        </Chat>
      </div>
    </>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: "rose" | "amber" }) {
  return (
    <div className="my-3 flex justify-center">
      <span
        className={cn(
          "rounded-full border px-3 py-1 text-center text-xs",
          tone === "rose" ? "border-rose-200 bg-rose-50 text-rose-700" : tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-800" : "bg-card text-muted-foreground",
        )}
      >
        {children}
      </span>
    </div>
  );
}

function ClientPane({ c, onBook }: { c: Conv; onBook: (c: Conv, label: string, time: string) => void }) {
  const days = useMemo(week, []);
  const [day, setDay] = useState(0);
  const [slot, setSlot] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const slots = FREE_SLOTS[day] ?? [];

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-col items-center gap-1 px-5 pb-5 pt-6 text-center">
        <Avatar label={initials(c)} seed={c.id} size="size-16" className="text-lg" />
        <p className="mt-2 text-lg font-semibold">{c.name ?? "Без имени"}</p>
        <button type="button" className="text-sm font-medium text-primary hover:underline">
          Карточка клиента
        </button>
      </div>

      <div className="mx-5 space-y-2.5 border-y py-4 text-sm">
        <p className="flex items-center gap-3">
          <Phone className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">Телефон</span>
          <span className="ml-auto font-medium tabular-nums">{c.phone}</span>
        </p>
        <p className="flex items-center gap-3">
          <ChannelIcon channel={c.channel} className="size-4" />
          <span className="text-muted-foreground">Канал</span>
          <span className="ml-auto font-medium">{c.channel}</span>
        </p>
        <p className="flex items-center gap-3">
          <CalendarCheck className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">Визитов</span>
          <span className="ml-auto font-medium tabular-nums">{c.visits ?? 0}</span>
        </p>
      </div>

      {/* полоска дней и свободное время — как в D5 */}
      <div className="px-5 pt-4">
        <div className="flex items-center justify-between">
          <span className="grid size-7 place-items-center rounded-full border text-muted-foreground">
            <ChevronLeft className="size-4" />
          </span>
          <p className="text-sm font-semibold">
            {days[0].range} – {days[6].range}
          </p>
          <span className="grid size-7 place-items-center rounded-full border text-muted-foreground">
            <ChevronRight className="size-4" />
          </span>
        </div>
        <div className="mt-3 grid grid-cols-7 gap-1 text-center">
          {days.map((d) => (
            <button
              key={d.i}
              type="button"
              onClick={() => {
                setDay(d.i);
                setSlot(null);
              }}
              className={cn("flex flex-col items-center gap-1 rounded-lg py-1.5 text-xs transition-colors", day === d.i ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              <span className={cn("uppercase", day === d.i ? "text-primary-foreground/80" : "text-muted-foreground")}>{d.wd}</span>
              <span className="text-sm font-semibold tabular-nums">{d.day}</span>
            </button>
          ))}
        </div>
        <p className="mt-4 text-xs font-medium text-muted-foreground">Свободно {days[day].label}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {slots.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSlot(s === slot ? null : s)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-sm tabular-nums transition-colors",
                s === slot ? "border-primary bg-accent font-medium text-accent-foreground" : "hover:border-primary/40",
              )}
            >
              {s}
            </button>
          ))}
        </div>
        {slot && (
          <Button
            className="mt-3 h-9 w-full rounded-full"
            onClick={() => {
              onBook(c, days[day].label, slot);
              setSlot(null);
            }}
          >
            <CalendarCheck className="mr-1.5 size-4" /> Записать: {days[day].label}, {slot}
          </Button>
        )}
      </div>

      <div className="px-5 pt-5">
        <p className="text-xs font-medium text-muted-foreground">Записи</p>
        {c.booking ? (
          <div className="mt-2 rounded-xl border p-3">
            <p className="text-sm font-semibold">{c.booking.split(" · ").slice(1).join(" · ") || "Запись"}</p>
            <p className="mt-1.5 flex items-center gap-2 border-l-2 border-primary pl-2 text-sm">
              <Clock className="size-3.5 text-muted-foreground" />
              {c.booking.split(" · ")[0]}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">из журнала Altegio</p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Нет предстоящих записей</p>
        )}
      </div>

      <label className="mt-auto flex items-center gap-2 border-t px-5 py-4 text-sm">
        <StickyNote className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={notes[c.id] ?? ""}
          onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
          placeholder="Написать заметку…"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </label>
    </div>
  );
}
