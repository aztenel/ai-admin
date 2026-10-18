// Переписка: шапка (кто, через какой номер, кто ведёт), полоса состояния с главным действием, лента, просьбы, поле ответа.
// Шапка показывается сразу по строке списка — не ждём загрузки переписки.
import { BellOff, CheckCheck, ChevronLeft, CircleAlert, Eraser, Globe, Hand, Info, MessageCircle, MoreHorizontal, PanelRight, Phone, PowerOff, RefreshCw, RotateCcw, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Confirm, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, toast } from "@/components/overlay";
import { Avatar, Button, EmptyState, IconButton, Skeleton } from "@/components/ui";
import { dataMode } from "@/data/source";
import { channelOf, channelTitle } from "@/model/channels";
import type { BotState, ConversationDetail, ConversationSummary, Message, Workspace } from "@/model/types";
import { formatPhone, until, waited } from "@/lib/format";
import { useNow } from "@/lib/utils";
import { store, useStore } from "@/state/store";
import { Composer } from "./Composer";
import { Messages } from "./Messages";
import { handling } from "./handling";
import { RequestCard } from "./RequestCard";

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

  const act = async (a: "pause" | "resume" | "resolve" | "forget", ok: string) => {
    const e = await store.act(convKey, a);
    toast(e || ok, e ? "critical" : "neutral");
  };
  const send = async (text: string, retryId?: string) => {
    const r = await store.send(convKey, text, retryId);
    if (r?.ok && r.warning) toast(r.warning, "critical");
  };

  const h = handling(null, bot, now);
  return (
    <section aria-label={`Переписка: ${name}`} className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <header className="shrink-0 border-b border-line pt-safe">
        <div className="@container flex h-[3.25rem] items-center gap-0.5 pl-0.5 pr-1.5 md:h-[3.75rem] md:gap-1 md:pl-4 md:pr-3">
          <IconButton icon={ChevronLeft} label="Назад к чатам" onClick={onBack} className="text-accent hover:text-accent md:hidden [&>svg]:size-7 [&>svg]:stroke-[2]" />
          <button type="button" onClick={onContact} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[0.625rem] py-1 pr-2 text-left md:-ml-1.5 md:pl-1.5 md:hover:bg-surface-2" aria-label={`${name}: карточка клиента`}>
            <Avatar name={contact?.name || contact?.profileName} size="sm" className="md:size-9" />
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold leading-5 tracking-[-0.005em] md:text-[1.0625rem] md:leading-6">{name}</span>
              <span className="flex min-w-0 items-center gap-3 text-sm leading-[1.125rem] text-fg-3">
                {ch && (
                  <span className="flex min-w-0 items-center gap-1 text-fg-2">
                    {ch.kind === "web" ? <Globe aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} /> : <MessageCircle aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />}
                    <span className="truncate">{channelTitle(ch)}</span>
                  </span>
                )}
                <span className="flex shrink-0 items-center gap-1" title={h.text}>
                  {h.icon && <h.icon aria-hidden className="size-3.5" strokeWidth={1.75} />}
                  <span className="@max-[26rem]:sr-only">{h.short.split(",")[0]}</span>
                </span>
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
                {bot.state === "active" && (
                  <MenuItem onSelect={() => act("pause", "Чат у вас: бот молчит 12 часов")}>
                    <Hand aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                    Взять чат — бот замолчит на 12 часов
                  </MenuItem>
                )}
                {bot.state === "paused" && (
                  <MenuItem onSelect={() => act("resume", "Бот снова отвечает в этом чате")}>
                    <RotateCcw aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                    Вернуть бота
                  </MenuItem>
                )}
                {(d?.attention || summary?.attention) && (
                  <MenuItem onSelect={() => act("resolve", "Убрано из «Ждут ответа»")}>
                    <CheckCheck aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                    Готово — убрать из «Ждут ответа»
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
            {showPanelToggle ? (
              <IconButton icon={PanelRight} label={panelOpen ? "Скрыть карточку клиента" : "Показать карточку клиента"} active={panelOpen} onClick={onContact} aria-pressed={panelOpen} />
            ) : (
              <IconButton icon={Info} label="Карточка клиента" onClick={onContact} className="max-md:hidden" />
            )}
          </div>
        </div>
      </header>

      <StatusStrip d={d} summary={summary} bot={bot} now={now} onAct={act} />

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
          />
        </>
      ) : ds?.error ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState icon={CircleAlert} title="Переписку не открыть" text={ds.error} action={<Button variant="outline" icon={RefreshCw} onClick={() => store.loadConversation(convKey)}>Повторить</Button>} />
        </div>
      ) : (
        <ThreadSkeleton />
      )}

      <Confirm
        open={confirmForget}
        onOpenChange={setConfirmForget}
        title="Очистить память бота?"
        text="Бот забудет эту переписку, записи и просьбы клиента — например, если всё уже сделано в CRM. Окно WhatsApp и отказ от рассылок останутся."
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

/** Полоса под шапкой: что сейчас нужно от человека и одно главное действие. Нет повода — полосы нет. */
function StatusStrip({ d, summary, bot, now, onAct }: { d?: ConversationDetail; summary?: ConversationSummary; bot: BotState; now: number; onAct: (a: "pause" | "resume" | "resolve", ok: string) => void }) {
  const attention = d ? d.attention : summary?.attention;
  // невыполненная просьба описана карточкой над полем ответа — полоса её не повторяет
  if (attention && d?.requests.length) return null;
  let body: ReactNode = null, mark: ReactNode = null, action: ReactNode = null;
  if (attention) {
    mark = <span aria-hidden className="mx-1 size-2 shrink-0 rounded-full bg-critical" />;
    body = (
      <>
        <span className="font-medium text-fg">{attention.label}</span>
        {attention.since ? <span className="whitespace-nowrap text-critical">, ждёт {waited(attention.since, now)}</span> : null}
      </>
    );
    action =
      bot.state === "active" ? (
        <Button size="sm" variant="primary" onClick={() => onAct("pause", "Чат у вас: бот молчит 12 часов")}>
          Взять чат
        </Button>
      ) : (
        <Button size="sm" variant="tinted" onClick={() => onAct("resolve", "Убрано из «Ждут ответа»")}>
          Готово
        </Button>
      );
  } else if (bot.state === "paused") {
    mark = <UserRound aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={1.75} />;
    body = <>Ведёт человек: бот молчит {until(bot.until, now)}</>;
    action = (
      <Button size="sm" variant="tinted" onClick={() => onAct("resume", "Бот снова отвечает в этом чате")}>
        Вернуть бота
      </Button>
    );
  } else if (bot.state === "stopped") {
    mark = <BellOff aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={1.75} />;
    body = <>Клиент попросил не писать ему автоматически — бот вернётся, когда он напишет «старт». Ответить вручную можно.</>;
  } else if (bot.state === "off") {
    mark = <PowerOff aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={1.75} />;
    body = <>Бот в этой компании выключен — отвечаете вы.</>;
  }
  if (!body) return null;
  return (
    <div className="flex min-h-11 shrink-0 items-center gap-2.5 border-b border-line bg-canvas px-4 py-1.5 md:min-h-12 md:px-5">
      {mark}
      <p className="min-w-0 flex-1 text-sm text-fg-2 md:text-ui">{body}</p>
      {action}
    </div>
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
