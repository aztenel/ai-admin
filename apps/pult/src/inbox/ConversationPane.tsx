// Переписка: шапка (кто, через какой номер, кто ведёт) и в ней же — плашка состояния с главным действием; лента;
// просьба клиента карточкой над полем ответа; поле ответа. Шапка показывается сразу по строке списка — не ждём загрузки.
// На телефоне у «назад» — сколько ещё чатов ждут человека (как число непрочитанных у «назад» в «Сообщениях» iPhone).
import { BellOff, CheckCheck, ChevronLeft, CircleAlert, Eraser, Globe, Hand, MessageCircle, MoreHorizontal, PanelRight, Phone, RefreshCw, RotateCcw, Undo2, UserRound, UserRoundCheck, Users, CalendarClock, ListTodo, Clock3 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Confirm, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Sheet, toast } from "@/components/overlay";
import { getOperator, setOperator } from "@/lib/operator";
import { Avatar, Button, EmptyState, IconButton, Skeleton } from "@/components/ui";
import { dataMode } from "@/data/source";
import { channelOf, channelTitle } from "@/model/channels";
import type { BotState, ChatAction, ChatActionExtra, ConversationDetail, ConversationSummary, Message, Workspace } from "@/model/types";
import { formatPhone, until, waited } from "@/lib/format";
import { cn, useNow } from "@/lib/utils";
import { store, useStore } from "@/state/store";
import { Composer } from "./Composer";
import { Messages } from "./Messages";
import { RequestCard } from "./RequestCard";
import { TimesSheet } from "./TimesSheet";

const EMPTY: Message[] = [];


export function ConversationPane({
  convKey,
  ws,
  summary,
  onBack,
  onContact,
  panelOpen,
  showPanelToggle,
}: {
  convKey: string;
  ws: Workspace;
  summary?: ConversationSummary;
  onBack: () => void;
  onContact: () => void;
  panelOpen: boolean;
  showPanelToggle: boolean;
}) {
  const ds = useStore((s) => s.details[convKey]);
  const outbox = useStore((s) => s.outbox[convKey]) || EMPTY;
  const now = useNow(20e3);
  const d = ds?.data;
  const ch = channelOf(ws, (d?.ref || summary?.ref)?.channelId || "");
  const contact = d?.contact || summary?.contact;
  const name = contact?.name || contact?.profileName || (contact?.phone ? formatPhone(contact.phone) : ch?.kind === "web" ? "Гость сайта" : "Без имени");
  const bot = d?.bot || summary?.bot || { state: "active" };
  const [confirmForget, setConfirmForget] = useState(false);
  const othersWaiting = useStore((s) => s.conversations.reduce((n, c) => n + (c.attention && c.key !== convKey ? 1 : 0), 0));

  const [ask, setAsk] = useState<{ text: string; a: ChatAction; ok: string; extra?: ChatActionExtra } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [timesOpen, setTimesOpen] = useState(false);
  const me = getOperator();
  const assignee = d?.assignee || summary?.assignee;
  const done = d ? d.done : summary?.done;
  const attention = d?.attention || summary?.attention;
  const act = async (a: ChatAction, ok: string, extra?: ChatActionExtra) => {
    const r = await store.act(convKey, a, extra);
    // сервер спрашивает перед действием (например, «клиент ждёт ответа — закрыть?»): спрашиваем человека и повторяем с force
    if (r && "confirm" in r) return setAsk({ text: r.confirm, a, ok, extra });
    toast(r ? r.error : ok, r ? "critical" : "neutral");
  };
  const take = () => (me ? act("take", "Чат у вас") : setAssignOpen(true));
  const close = () => act("resolve", "Чат закрыт");
  const send = async (text: string, retryId?: string) => {
    const r = await store.send(convKey, text, retryId);
    if (r?.ok && r.warning) toast(r.warning, "critical");
  };

  return (
    <section aria-label={`Переписка: ${name}`} className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <header className="shrink-0 border-b border-line pt-safe">
        <div className="@container flex h-[3.25rem] items-center gap-1 pr-1.5 md:h-[3.75rem] md:pl-4 md:pr-3">
          <button
            type="button"
            onClick={onBack}
            aria-label={othersWaiting ? `Назад к чатам. Ждут ответа: ${othersWaiting}` : "Назад к чатам"}
            className="flex h-11 min-w-11 shrink-0 items-center pl-1 pr-0.5 text-accent active:opacity-60 md:hidden"
          >
            <ChevronLeft aria-hidden className="size-7" strokeWidth={2.1} />
            {othersWaiting > 0 && <span className="tnum -ml-1 min-w-5 rounded-full bg-accent-soft px-1.5 text-center text-sm font-semibold leading-5 text-accent-ink">{othersWaiting}</span>}
          </button>
          <button type="button" onClick={onContact} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[0.625rem] py-1 pr-2 text-left md:-ml-1.5 md:pl-1.5 md:hover:bg-surface-2" aria-label={`${name}: карточка клиента`}>
            <Avatar name={contact?.name || contact?.profileName} size="sm" className="size-9 text-sm md:size-10" />
            <span className="min-w-0">
              <span className="block truncate text-[1.0625rem] font-semibold leading-[1.375rem] tracking-[-0.012em]">{name}</span>
              <span className="flex min-w-0 items-center gap-1 text-sm leading-[1.125rem] text-fg-3">
                {ch && (ch.kind === "web" ? <Globe aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} /> : <MessageCircle aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />)}
                {/* на какой номер написал клиент (основной или второй) и кто ведёт чат (ТЗ v2.0 §2.2) */}
                <span className="truncate">{d?.line?.label || (ch ? channelTitle(ch) : "")}</span>
                {assignee ? <span className="min-w-0 truncate whitespace-nowrap">· ведёт {assignee === me ? "вы" : assignee}</span> : bot.state === "active" ? <span className="shrink-0 whitespace-nowrap @max-[24rem]:hidden">· бот</span> : null}
              </span>
            </span>
          </button>
          <div className="flex shrink-0 items-center">
            {contact?.phone && <CallIcon phone={contact.phone} />}
            <Menu>
              <MenuTrigger asChild>
                <IconButton icon={MoreHorizontal} label="Действия с чатом" />
              </MenuTrigger>
              <MenuContent align="end">
                {assignee !== me || !me ? (
                  <MenuItem onSelect={take}>
                    <UserRoundCheck aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                    Взять себе
                  </MenuItem>
                ) : null}
                <MenuItem onSelect={() => setAssignOpen(true)}>
                  <Users aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                  {assignee ? "Передать другому…" : "Назначить…"}
                </MenuItem>
                {!done || attention ? (
                  <MenuItem onSelect={close}>
                    <CheckCheck aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                    Готово
                  </MenuItem>
                ) : (
                  <MenuItem onSelect={() => act("reopen", "Чат снова открыт")}>
                    <Undo2 aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                    Открыть снова
                  </MenuItem>
                )}
                <MenuItem onSelect={() => setTimesOpen(true)}>
                  <CalendarClock aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                  Свободное время…
                </MenuItem>
                <MenuItem onSelect={() => { const t = prompt("Что нужно сделать? Задача останется в списке «Нужен ответ», пока чат не закроют."); if (t && t.trim()) void act("task", "Задача добавлена", { text: t.trim() } as ChatActionExtra); }}>
                  <ListTodo aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                  Создать задачу…
                </MenuItem>
                <MenuItem onSelect={() => { const m = prompt("Клиент опаздывает. На сколько минут?", "10"); if (m !== null) void act("late", "Отметили: клиент опаздывает", { min: +m || 0 } as ChatActionExtra); }}>
                  <Clock3 aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                  Клиент опаздывает…
                </MenuItem>
                <MenuSeparator />
                {bot.state === "active" && (
                  <MenuItem onSelect={() => act("pause", "Чат у вас: бот молчит 12 часов")}>
                    <Hand aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                    Взять чат: бот замолчит на 12 часов
                  </MenuItem>
                )}
                {bot.state === "paused" && (
                  <MenuItem onSelect={() => act("resume", "Бот снова отвечает в этом чате")}>
                    <RotateCcw aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                    Вернуть бота
                  </MenuItem>
                )}
                <MenuItem onSelect={() => store.loadConversation(convKey)}>
                  <RefreshCw aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                  Обновить переписку
                </MenuItem>
                <MenuSeparator />
                <MenuItem danger onSelect={() => setConfirmForget(true)}>
                  <Eraser aria-hidden className="size-4" strokeWidth={1.75} />
                  Очистить память бота
                </MenuItem>
              </MenuContent>
            </Menu>
            {/* карточку открывает нажатие на имя (как в «Сообщениях» iPhone); отдельная кнопка — только на широком экране, где карточка — колонка */}
            {showPanelToggle && <IconButton icon={PanelRight} label={panelOpen ? "Скрыть карточку клиента" : "Показать карточку клиента"} active={panelOpen} onClick={onContact} aria-pressed={panelOpen} />}
          </div>
        </div>
        <StatusStrip d={d} summary={summary} bot={bot} now={now} me={me} assignee={assignee} onAct={act} onTake={take} onClose={close} />
      </header>

      {d ? (
        <>
          <Messages
            convKey={convKey}
            detail={d}
            outbox={outbox}
            now={now}
            onRetry={(m) => send(m.text, m.id)}
            onDrop={(m) => store.dropOutgoing(convKey, m.id)}
          />
          {d.requests.map((q) => (
            <RequestCard key={q.id} q={q} since={d.attention?.since} now={now} canMessage={d.reply.allowed} booking={!!ws.capabilities.booking} onDone={(text) => store.complete(convKey, q.id, text)} />
          ))}
          <Composer
            convKey={convKey}
            channel={ch}
            reply={d.reply}
            payment={d.payment}
            botActive={d.bot.state === "active"}
            multiChannel={ws.channels.filter((c) => c.kind !== "web").length > 1}
            phone={d.contact.phone}
            now={now}
            onSend={(t) => send(t)}
            onTimes={ws.capabilities.booking ? () => setTimesOpen(true) : undefined}
            address={ws.branches.find((b) => b.address)?.address}
          />
        </>
      ) : ds?.error ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState icon={CircleAlert} title="Переписку не открыть" text={ds.error} action={<Button variant="outline" icon={RefreshCw} onClick={() => store.loadConversation(convKey)}>Повторить</Button>} />
        </div>
      ) : (
        <ThreadSkeleton />
      )}

      <Confirm open={!!ask} onOpenChange={(v) => !v && setAsk(null)} title="Закрыть чат?" text={ask?.text || ""} yes="Закрыть без ответа" onYes={() => ask && act(ask.a, ask.ok, { ...ask.extra, force: true })} />
      <TimesSheet open={timesOpen} onOpenChange={setTimesOpen} />
      <AssignSheet
        open={assignOpen}
        onOpenChange={setAssignOpen}
        me={me}
        assignee={assignee}
        onPick={async (name, self) => {
          setAssignOpen(false);
          if (self) {
            setOperator(name);
            await act("take", "Чат у вас");
          } else await act("assign", name ? `Чат передан: ${name}` : "Чат ни за кем не закреплён", { to: name });
        }}
      />
      <Confirm
        open={confirmForget}
        onOpenChange={setConfirmForget}
        title="Очистить память бота?"
        text="Бот забудет эту переписку, записи и просьбы клиента. Например, если всё уже сделано в Altegio. Отказ клиента от рассылок останется."
        yes="Очистить"
        danger
        onYes={() => act("forget", "Память бота в этом чате очищена")}
      />
    </section>
  );
}

function CallIcon({ phone }: { phone: string }) {
  if (dataMode() === "demo") return <IconButton icon={Phone} label="Позвонить" onClick={() => toast("В демо звонок не набирается: номера вымышленные")} />;
  return (
    <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} aria-label="Позвонить" title="Позвонить" className="inline-grid size-9 place-items-center rounded-lg text-fg-2 hover:bg-surface-2 hover:text-fg pointer-coarse:size-11">
      <Phone aria-hidden className="size-5" strokeWidth={1.75} />
    </a>
  );
}

/** Плашка в шапке: что сейчас нужно от человека и одно главное действие. Нет повода — плашки нет (ТЗ v2.0 §2.2):
 *  «бот выключен» больше не висит в каждом чате — это видно по пустой плашке и по шапке. Клиент ждёт — розовая с красной точкой. */
function StatusStrip({ d, summary, bot, now, me, assignee, onAct, onTake, onClose }: { d?: ConversationDetail; summary?: ConversationSummary; bot: BotState; now: number; me: string; assignee?: string; onAct: (a: ChatAction, ok: string) => void; onTake: () => void; onClose: () => void }) {
  const attention = d ? d.attention : summary?.attention;
  // невыполненная просьба описана карточкой над полем ответа — плашка её не повторяет
  if (attention && d?.requests.length) return null;
  let body: ReactNode = null, mark: ReactNode = null, action: ReactNode = null;
  if (attention) {
    // макет Figma «Переписка»: красноватая полоса во всю ширину, «Ждёт ответа 5 мин · просит перенести», справа главное действие
    const src = attention.source && attention.topic ? (attention.source.kind === "rm" ? " · ответ на напоминание" : " · ответ на рассылку") : "";
    const w = attention.since ? waited(attention.since, now) : "";
    const what = attention.label ? attention.label[0].toLowerCase() + attention.label.slice(1) : "";
    body = (
      <span className="font-medium text-critical">
        {w ? (w === "только что" ? "Ждёт ответа" : `Ждёт ответа ${w}`) : attention.label}
        {w && what ? ` · ${what}` : ""}
        {src}
      </span>
    );
    action =
      bot.state === "active" ? (
        <Button size="sm" variant="primary" onClick={() => onAct("pause", "Чат у вас: бот молчит 12 часов")}>
          Взять чат
        </Button>
      ) : !assignee || (me && assignee !== me) ? (
        <Button size="sm" variant="primary" onClick={onTake}>
          Взять себе
        </Button>
      ) : (
        <Button size="sm" variant="secondary" className="bg-surface dark:bg-surface-3 dark:hover:brightness-125" onClick={onClose}>
          Готово
        </Button>
      );
  } else if (bot.state === "paused") {
    mark = <UserRound aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={1.75} />;
    body = (
      <>
        <span className="font-medium text-fg">Ведёте вы</span> · бот молчит {until(bot.until, now)}
      </>
    );
    action = (
      <Button size="sm" variant="secondary" className="bg-surface text-accent-ink dark:bg-surface-3 dark:hover:brightness-125" onClick={() => onAct("resume", "Бот снова отвечает в этом чате")}>
        Вернуть бота
      </Button>
    );
  } else if (bot.state === "stopped") {
    mark = <BellOff aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={1.75} />;
    body = <>Просил не писать автоматически. Ответить вручную можно.</>;
  }
  if (!body) return null;
  if (attention)
    return (
      <div className="flex min-h-11 items-center gap-2.5 bg-critical-soft py-1.5 pl-4 pr-2 md:pl-5 md:pr-4">
        <p className="min-w-0 flex-1 text-sm leading-[1.125rem] md:text-ui">{body}</p>
        {action}
      </div>
    );
  return (
    <div className="px-2.5 pb-2.5 md:px-4">
      <div className={cn("flex min-h-11 items-center gap-2.5 rounded-xl py-1.5 pl-3 pr-1.5", attention ? "bg-critical-soft" : "bg-surface-2", !action && "pr-3")}>
        {mark}
        <p className="min-w-0 flex-1 text-sm leading-[1.125rem] text-fg-2 md:text-ui">{body}</p>
        {action}
      </div>
    </div>
  );
}

/** Кому передать чат: сотрудники, которые работали в пульте, или новое имя. Своё имя запоминается на этом устройстве. */
function AssignSheet({ open, onOpenChange, me, assignee, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; me: string; assignee?: string; onPick: (name: string, self: boolean) => void }) {
  const ops = useStore((s) => s.operators);
  const [name, setName] = useState("");
  const others = ops.filter((n) => n !== me && n !== assignee);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={me ? "Кому передать чат" : "Как вас зовут?"} description={me ? "Сотрудник увидит чат в разделе «Мои»." : "Имя увидят коллеги в чате; оно запомнится на этом устройстве."}>
      <div className="space-y-2 px-4 pb-4">
        {!me && (
          <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), name.trim() && onPick(name.trim(), true))}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Например, Айгерим" aria-label="Ваше имя" className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-md outline-none focus:border-accent" />
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              Взять себе
            </Button>
          </form>
        )}
        {me &&
          others.map((n) => (
            <Button key={n} variant="secondary" className="w-full justify-start" onClick={() => onPick(n, false)}>
              {n}
            </Button>
          ))}
        {me && (
          <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), name.trim() && onPick(name.trim(), false))}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Другое имя" aria-label="Имя сотрудника" className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-md outline-none focus:border-accent" />
            <Button type="submit" variant="secondary" disabled={!name.trim()}>
              Передать
            </Button>
          </form>
        )}
        {me && assignee && (
          <Button variant="ghost" className="w-full" onClick={() => onPick("", false)}>
            Ни за кем не закреплять
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function ThreadSkeleton() {
  return (
    <div aria-label="Загружаю переписку" className="flex flex-1 flex-col justify-end gap-3 px-4 pb-6 md:px-6">
      <Skeleton className="h-10 w-2/3 rounded-2xl" />
      <Skeleton className="ml-auto h-14 w-1/2 rounded-2xl" />
      <Skeleton className="h-8 w-2/5 rounded-2xl" />
      <Skeleton className="ml-auto h-10 w-3/5 rounded-2xl" />
    </div>
  );
}
