// Лента переписки. Три голоса — три веса: клиент — нейтральный серый пузырь слева; справа бот — бледно-синий (наша
// сторона, но тихо) и человек — сплошной синий (самое важное: это сказали вы). Подпись «Бот» / «Оператор» — только когда
// отвечающий сменился. Время — мелко внутри пузыря.
// Прокрутка: новое сообщение прокручивает вниз, только если вы и так внизу; иначе — кнопка «Новые сообщения».
// Положение в каждом чате запоминается: вернулись в чат — та же точка ленты.
// Действия с сообщением («Ответить», «Копировать», «Открыть», «Удалить у меня», «Удалить у всех»): на телефоне — долгое нажатие,
// на компьютере — «⋯» при наведении и правая кнопка мыши. Ответить цитатой можно только на втором номере (Green-API) и только на
// сообщение с номером у провайдера. «Удалить у меня» скрывает сообщение в пульте у всех сотрудников (у клиента оно остаётся, «Вернуть»
// показывает снова); «Удалить у всех» — только наше сообщение второго номера, не позже ~2,5 суток, после подтверждения (02.11.2026).
import { ArrowDown, BellRing, Bot, Copy, EyeOff, Megaphone, MoreHorizontal, Maximize2, Reply, RotateCcw, Smartphone, Trash2, UserRound } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { Confirm, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, toast } from "@/components/overlay";
import type { ConversationDetail, Message, Quote, Sender } from "@/model/types";
import { dayLabel, sameDay, timeHM } from "@/lib/format";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { Lightbox, MediaView, openMedia, type Viewer } from "./MediaView";
import { Ticks } from "./Ticks";

/** «[клиент прислал фото]», «[сотрудник отправил файл]» — служебная подпись сервера у файла: её не показываем и не копируем. */
export const isPlaceholder = (m: Message) => !!m.media && /^\[[^\]]{1,60}\]$/.test(m.text.trim());
const MEDIA_NAME: Record<string, string> = { audio: "Голосовое", image: "Фото", video: "Видео", document: "Файл", sticker: "Стикер", location: "Геолокация", contact: "Контакт" };
/** Коротко, о чём сообщение — для цитаты. */
export function quoteOfMessage(m: Message): Quote | null {
  if (!m.mid) return null;
  const text = isPlaceholder(m) || !m.text.trim() ? (m.media ? MEDIA_NAME[m.media.kind] + (m.media.name && m.media.kind === "document" ? ` «${m.media.name}»` : "") : "") : m.text.replace(/\s+/g, " ").trim().slice(0, 120);
  return { mid: m.mid, text, from: m.from };
}
export const quoteWho = (from: Sender, contactName?: string) => (from === "contact" ? contactName || "Клиент" : from === "bot" ? "Бот" : "Сотрудник");
const UNKNOWN_NOTE = "Не знаем, ушло ли сообщение. Проверьте в WhatsApp, прежде чем отправлять ещё раз.";
const DEL_UNKNOWN_NOTE = "Не знаем, удалилось ли сообщение у клиента. Проверьте в WhatsApp на телефоне.";
/** «Удалить у всех» WhatsApp разрешает около 60 часов после отправки — пульт предлагает его до 59 часов (сервер проверяет так же) */
const DEL_ALL_MS = 59 * 3600e3;

const positions = new Map<string, { top: number; count: number }>();
const GROUP_GAP = 6 * 60e3;

type Item = { kind: "day"; at: number } | { kind: "campaign"; at: number; name: string; text: string } | { kind: "msg"; m: Message; first: boolean; last: boolean; label: boolean };
// кто говорит: сотрудник (по имени), ответ с телефона, бот, напоминание, рассылка — подпись над первым сообщением группы
const voice = (m: Message) => (m.from === "operator" ? `op:${m.via || ""}:${m.operator || ""}` : m.auto ? `auto:${m.auto}` : m.from);

function items(messages: Message[], campaign: ConversationDetail["campaign"]): Item[] {
  const out: Item[] = [];
  let prev: Message | null = null;
  let promo = campaign;
  // подпись «Бот» / «Оператор» — над первым ответом и когда отвечающий сменился, а не над каждой группой
  let lastVoice = "";
  messages.forEach((m, i) => {
    if (m.at && (!prev || !sameDay(prev.at, m.at))) out.push({ kind: "day", at: m.at });
    if (promo && m.at >= promo.at) {
      out.push({ kind: "campaign", ...promo });
      promo = undefined;
    }
    const next = messages[i + 1];
    const same = (a: Message | null | undefined, b: Message | null | undefined) => !!a && !!b && voice(a) === voice(b) && Math.abs(b.at - a.at) < GROUP_GAP && sameDay(a.at, b.at);
    const first = !same(prev, m);
    const v = m.from === "contact" ? "" : voice(m);
    out.push({ kind: "msg", m, first, last: !same(m, next), label: first && !!v && v !== lastVoice });
    if (v) lastVoice = v;
    prev = m;
  });
  if (promo) out.push({ kind: "campaign", ...promo });
  return out;
}

export function Messages({ convKey, detail, outbox, now, onRetry, onDrop, onReply, onHide, onDeleteAll }: { convKey: string; detail: ConversationDetail; outbox: Message[]; now: number; onRetry: (m: Message) => void; onDrop: (m: Message) => void; onReply?: (q: Quote) => void; onHide?: (m: Message, hide: boolean) => void; onDeleteAll?: (m: Message) => void }) {
  const [delAsk, setDelAsk] = useState<Message | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const count = detail.messages.length + outbox.length;
  const seen = useRef(count);
  const [below, setBelow] = useState(0);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const reply = detail.canQuote ? onReply : undefined;
  const contactName = detail.contact.name || detail.contact.profileName;

  // нажали на цитату — к исходному сообщению, если оно в загруженной переписке, и подсветить его на миг
  const jump = useCallback((mid: string) => {
    const el = box.current?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(mid)}"]`);
    if (!el) return toast("Исходного сообщения уже нет в переписке.");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("msg-flash");
    void el.offsetWidth;
    el.classList.add("msg-flash");
    setTimeout(() => el.classList.remove("msg-flash"), 1600);
  }, []);

  const toEnd = useCallback((smooth = false) => {
    const el = box.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    atEnd.current = true;
    setBelow(0);
  }, []);

  // открыли чат: на сохранённое место, если с тех пор ничего не пришло, иначе — к последнему сообщению
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const p = positions.get(convKey);
    if (p && p.count === count && p.top >= 0) {
      el.scrollTop = p.top;
      atEnd.current = el.scrollHeight - p.top - el.clientHeight < 80;
    } else toEnd();
    seen.current = count;
  }, [convKey]);

  // пришли новые сообщения
  useLayoutEffect(() => {
    if (count === seen.current) return;
    const grew = count - seen.current;
    seen.current = count;
    const mine = outbox.length > 0 && outbox.at(-1)?.delivery === "sending";
    if (atEnd.current || mine) toEnd(!mine);
    else if (grew > 0) setBelow((b) => b + grew);
  }, [count, outbox, toEnd]);

  // поле ответа выросло, открылась клавиатура, догрузилась картинка: если были внизу — остаёмся внизу; если читали выше — место не прыгает
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => atEnd.current && (el.scrollTop = el.scrollHeight));
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atEnd.current && below) setBelow(0);
    positions.set(convKey, { top: atEnd.current ? -1 : el.scrollTop, count });
  };

  // «последняя рассылка компании» раньше показывалась в каждом чате как «клиент мог ответить на неё» — без связи с этим клиентом.
  // Теперь наши автоматические сообщения видны в самой ленте с подписью «Напоминание» / «Рассылка» (ТЗ v2.0 §2.1)
  const list = items(detail.messages, undefined);
  return (
    <div className="chat-bg relative min-h-0 flex-1">
      <div ref={box} onScroll={onScroll} className="scroll-area h-full" role="log" aria-label="Переписка" aria-live="polite">
        <div className="mx-auto flex max-w-[50rem] flex-col px-2.5 pb-4 pt-1 md:px-6">
          {list.length === 0 && outbox.length === 0 && <p className="py-16 text-center text-sm text-fg-3">Сообщений пока нет.</p>}
          {list.map((it, i) =>
            it.kind === "day" ? (
              <DayMark key={`d${it.at}`} at={it.at} now={now} />
            ) : it.kind === "campaign" ? (
              <SystemNote key={`c${i}`} icon={Megaphone}>
                Рассылка {it.name ? `«${it.name}»` : ""} в {timeHM(it.at)}. Клиент мог ответить на неё.
              </SystemNote>
            ) : it.m.hidden ? (
              <HiddenNote key={it.m.id} m={it.m} first={it.first} onShow={onHide ? () => onHide(it.m, false) : undefined} />
            ) : (
              <Bubble key={it.m.id} m={it.m} first={it.first} last={it.last} label={it.label} onReply={reply} onOpen={setViewer} onJump={jump} contactName={contactName} now={now} onHide={onHide} onDeleteAll={onDeleteAll ? setDelAsk : undefined} />
            ),
          )}
          {outbox.map((m, i) => (
            <Fragment key={m.id}>
              <Bubble m={m} first={i === 0 && detail.messages.at(-1)?.from !== "operator"} last label={i === 0 && voice(detail.messages.filter((x) => x.from !== "contact").at(-1) || m) !== "op:"} onOpen={setViewer} onJump={jump} contactName={contactName} />
              {m.delivery === "failed" && (
                <div className="mb-2 mt-1 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-right text-xs text-critical">
                  <span className="max-w-[36ch]">{m.error || "Не отправлено"}</span>
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => onRetry(m)}>
                      Повторить
                    </Button>
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onDrop(m)}>
                      Удалить
                    </Button>
                  </span>
                </div>
              )}
            </Fragment>
          ))}
        </div>
      </div>
      {below > 0 && (
        <button
          type="button"
          onClick={() => toEnd(true)}
          className="absolute bottom-3 left-1/2 inline-flex h-8 -translate-x-1/2 animate-pop-in items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm font-medium text-accent shadow-pop dark:bg-surface-2"
        >
          <ArrowDown aria-hidden className="size-4" strokeWidth={2} />
          Новые сообщения
        </button>
      )}
      {viewer && <Lightbox v={viewer} onClose={() => setViewer(null)} />}
      <Confirm
        open={!!delAsk}
        onOpenChange={(v) => !v && setDelAsk(null)}
        title="Удалить у всех?"
        text="Сообщение пропадёт у клиента в WhatsApp. Вернуть его будет нельзя. В пульте останется отметка «удалено у всех»."
        yes="Удалить у всех"
        danger
        onYes={() => delAsk && onDeleteAll?.(delAsk)}
      />
    </div>
  );
}

/** Скрытое в пульте сообщение («Удалить у меня»): одна строка на его месте и «Вернуть». У клиента в WhatsApp оно осталось. */
function HiddenNote({ m, first, onShow }: { m: Message; first: boolean; onShow?: () => void }) {
  const out = m.from !== "contact";
  return (
    <div data-mid={m.mid || undefined} className={cn("flex", out ? "justify-end" : "justify-start", first ? "mt-3" : "mt-[3px]")}>
      <span className="inline-flex max-w-[82%] items-center gap-1.5 rounded-full bg-surface/85 px-3 py-1 text-xs text-fg-3 ring-1 ring-line">
        <EyeOff aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="truncate">Скрыто в пульте · {timeHM(m.at)}</span>
        {onShow && (
          <button type="button" onClick={onShow} className="shrink-0 font-medium text-accent-ink underline-offset-2 hover:underline">
            Вернуть
          </button>
        )}
      </span>
    </div>
  );
}

function DayMark({ at, now }: { at: number; now: number }) {
  return (
    <div className="mb-1 mt-5 flex justify-center first:mt-3">
      <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-fg-3">{dayLabel(at, now)}</span>
    </div>
  );
}

function SystemNote({ icon: Icon, children }: { icon: typeof Megaphone; children: ReactNode }) {
  return (
    <p className="mx-auto my-4 flex max-w-[30rem] items-start gap-2 px-2 text-sm text-fg-3">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      <span>{children}</span>
    </p>
  );
}

function whoOf(m: Message) {
  if (m.from === "operator") return { text: m.operator || (m.via === "phone" ? "С телефона" : "Сотрудник"), Icon: m.via === "phone" ? Smartphone : UserRound };
  if (m.auto === "service") return { text: "Напоминание", Icon: BellRing };
  if (m.auto === "campaign") return { text: "Рассылка", Icon: Megaphone };
  if (m.from === "bot") return { text: "Бот", Icon: Bot };
  return null;
}

type BubbleProps = { m: Message; first: boolean; last: boolean; label: boolean; onReply?: (q: Quote) => void; onOpen: (v: Viewer) => void; onJump: (mid: string) => void; contactName?: string; now?: number; onHide?: (m: Message, hide: boolean) => void; onDeleteAll?: (m: Message) => void };

function Bubble({ m, first, last, label, onReply, onOpen, onJump, contactName, now = Date.now(), onHide, onDeleteAll }: BubbleProps) {
  const out = m.from !== "contact";
  // «[клиент прислал фото]» — служебная подпись сервера: у файла её не показываем (ТЗ v2.0 §2.2 — меньше технических строк)
  const text = isPlaceholder(m) ? "" : m.text;
  const who = label ? whoOf(m) : null;
  // макет Figma «Переписка»: у напоминания и рассылки подпись внутри пузыря, латунью; у сотрудника и бота — над пузырём
  const inside = !!who && (m.auto === "service" || m.auto === "campaign");
  const dark = m.from === "operator";
  // что можно сделать с сообщением: ответить цитатой (второй номер, есть номер у провайдера), копировать текст, открыть файл
  const q = onReply && !m.delivery && !m.deleted ? quoteOfMessage(m) : null;
  const canOpen = !!m.media?.url && !m.delivery && !m.deleted && ["image", "sticker", "video", "document"].includes(m.media.kind);
  // удалить у всех — только наше сообщение с номером у провайдера, которое дошло (или могло дойти) и не старше ~2,5 суток
  const canDelAll = !!onDeleteAll && out && !!m.mid && !m.deleted && !m.delivery && m.status !== "failed" && now - m.at <= DEL_ALL_MS;
  const canHide = !!onHide && !m.delivery;
  const acts = !m.delivery && (!!q || !!text.trim() || canOpen || canHide || canDelAll);
  const [menu, setMenu] = useState(false);
  const press = useLongPress(() => acts && setMenu(true));
  const sendingFile = m.delivery === "sending" && m.hasFile;
  return (
    <div className={cn("flex flex-col", out ? "items-end" : "items-start", first ? "mt-3" : "mt-[3px]", m.delivery === "sending" && "animate-msg-in")}>
      {who && !inside && (
        <span className="mb-1 mt-1.5 flex items-center gap-1 px-1 text-xs font-medium text-fg-3">
          <who.Icon aria-hidden className="size-3.5" strokeWidth={1.9} />
          {who.text}
        </span>
      )}
      <div className={cn("group/msg flex w-full items-center gap-1", out ? "flex-row-reverse" : "flex-row")}>
        <div
          data-mid={m.mid || undefined}
          {...(acts ? press : {})}
          onContextMenu={acts ? (e) => (e.preventDefault(), setMenu(true)) : undefined}
          className={cn(
            "relative min-w-0 max-w-[min(30rem,82%)] rounded-[1.125rem] px-3 py-[0.4375rem] text-md leading-[1.375rem] md:max-w-[min(34rem,72%)] md:text-base md:leading-[1.3125rem]",
            // долгое нажатие на телефоне открывает действия — без системного меню выделения и «Сохранить картинку»
            acts && "pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]",
            m.from === "contact" && "bg-bubble-in text-fg",
            m.from === "bot" && "bg-bubble-bot text-fg",
            m.from === "operator" && "bg-bubble-op text-bubble-op-fg",
            last && (out ? "rounded-br-[0.375rem]" : "rounded-bl-[0.375rem]"),
            m.delivery === "sending" && "opacity-70",
            (m.delivery === "failed" || m.status === "failed") && "ring-1 ring-critical",
            m.reaction && "mb-3",
          )}
        >
          {inside && <span className="mb-0.5 mt-0.5 block text-xs font-medium text-brand-gold">{who.text}</span>}
          {m.quote && <QuoteBlock q={m.quote} dark={dark} contactName={contactName} onJump={onJump} />}
          {m.media && !m.deleted && <MediaView media={m.media} onDark={dark} onOpen={onOpen} mine={out} />}
          {m.media && m.deleted && !text && <p className="italic opacity-70">Файл удалён<span aria-hidden className="inline-block w-24" /></p>}
          {text && (
            <p className={cn("whitespace-pre-wrap break-words [overflow-wrap:anywhere]", m.deleted && "line-through opacity-60")}>
              {text}
              <span aria-hidden className={cn("inline-block", sendingFile ? "w-28" : m.deletedByUs ? "w-36" : out ? "w-16" : m.edited || m.deleted ? "w-24" : "w-11")} />
            </p>
          )}
          <span className={cn("tnum flex items-center gap-1 text-[0.6875rem] leading-none", text ? "absolute bottom-[0.5625rem] right-3" : "mt-1 justify-end", dark ? "text-bubble-op-fg/80" : "text-fg-3")}>
            {m.deleted ? <span>{m.deletedByUs ? "удалено у всех" : "удалено"}</span> : m.edited ? <span>изменено</span> : null}
            {sendingFile ? (
              <span className="flex items-center gap-1">
                <span aria-hidden className="size-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                отправляется
              </span>
            ) : (
              <time>{m.delivery === "sending" ? "…" : timeHM(m.at)}</time>
            )}
            {out && !m.delivery && <Ticks status={m.status} error={m.statusError} onDark={dark} />}
          </span>
          {m.reaction && <span aria-label={`Реакция клиента: ${m.reaction}`} className={cn("absolute -bottom-3 rounded-full border border-line bg-surface px-1.5 text-sm leading-6 shadow-sm", out ? "left-2" : "right-2")}>{m.reaction}</span>}
        </div>
        {acts && (
          <Menu open={menu} onOpenChange={setMenu}>
            <MenuTrigger asChild>
              {/* на компьютере — при наведении на сообщение; на телефоне невидима (действия — долгим нажатием), но меню открывается рядом с ней */}
              <button
                type="button"
                aria-label="Действия с сообщением"
                className="grid size-7 shrink-0 place-items-center rounded-full text-fg-3 opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg focus-visible:opacity-100 group-hover/msg:opacity-100 data-[state=open]:opacity-100 pointer-coarse:pointer-events-none pointer-coarse:opacity-0!"
              >
                <MoreHorizontal aria-hidden className="size-4" strokeWidth={2} />
              </button>
            </MenuTrigger>
            <MenuContent align={out ? "end" : "start"} className="min-w-[11rem]">
              {q && (
                <MenuItem onSelect={() => onReply?.(q)}>
                  <Reply aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                  Ответить
                </MenuItem>
              )}
              {!!text.trim() && (
                <MenuItem onSelect={() => void copyText(text).then((ok) => toast(ok ? "Текст скопирован" : "Не удалось скопировать. Выделите текст и скопируйте вручную.", ok ? "neutral" : "critical"))}>
                  <Copy aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                  Копировать
                </MenuItem>
              )}
              {canOpen && m.media && (
                <MenuItem onSelect={() => openMedia(m.media!, onOpen)}>
                  <Maximize2 aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                  Открыть
                </MenuItem>
              )}
              {(canHide || canDelAll) && (!!q || !!text.trim() || canOpen) && <MenuSeparator />}
              {canHide && (
                <MenuItem onSelect={() => onHide?.(m, true)}>
                  <EyeOff aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
                  Удалить у меня
                </MenuItem>
              )}
              {canDelAll && (
                <MenuItem danger onSelect={() => onDeleteAll?.(m)}>
                  <Trash2 aria-hidden className="size-4" strokeWidth={1.75} />
                  Удалить у всех
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        )}
      </div>
      {out && m.status === "failed" && <span className="mt-1 max-w-[36ch] text-right text-xs text-critical">Не доставлено{m.statusError ? `: ${m.statusError}` : ""}</span>}
      {/* ответа на отправку не было: сообщение могло уйти, само не повторяется (CLAUDE.md §5.2) */}
      {/* причина (02.11.2026): «нет связи с Green-API…», «Green-API ответил 500…» — чтобы было понятно, что проверять */}
      {out && m.status === "unknown" && !m.delivery && <span className="mt-1 max-w-[36ch] text-right text-xs text-fg-2">{UNKNOWN_NOTE}{m.statusError ? ` Причина: ${m.statusError}.` : ""}</span>}
      {out && m.deleteUnknown && !m.deleted && <span className="mt-1 max-w-[36ch] text-right text-xs text-fg-2">{DEL_UNKNOWN_NOTE}</span>}
    </div>
  );
}

/** Цитата в пузыре: чьё сообщение и его начало; нажатие — к исходному сообщению. */
function QuoteBlock({ q, dark, contactName, onJump }: { q: Quote; dark: boolean; contactName?: string; onJump: (mid: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onJump(q.mid)}
      aria-label={`Ответ на сообщение: ${quoteWho(q.from, contactName)}. ${q.text}. Показать сообщение`}
      className={cn(
        "-mx-1.5 mb-1 mt-0.5 block w-[calc(100%+0.75rem)] min-w-36 rounded-[0.625rem] border-l-[3px] px-2 py-1 text-left text-sm leading-[1.125rem]",
        dark ? "border-bubble-op-fg/70 bg-black/15 hover:bg-black/20" : "border-accent bg-black/[0.045] hover:bg-black/[0.07] dark:bg-white/[0.07] dark:hover:bg-white/[0.1]",
      )}
    >
      <span className={cn("block truncate text-xs font-semibold", dark ? "text-bubble-op-fg" : "text-accent-ink")}>{quoteWho(q.from, contactName)}</span>
      <span className={cn("line-clamp-2 break-words", dark ? "text-bubble-op-fg/85" : "text-fg-2")}>{q.text || "Сообщение"}</span>
    </button>
  );
}

/** Долгое нажатие пальцем (450 мс, без сдвига): открыть действия. Обычное касание и прокрутка ленты работают как раньше;
 *  касание, которое закончилось долгим нажатием, не открывает фото под пальцем. */
function useLongPress(fire: () => void) {
  const t = useRef(0), start = useRef<{ x: number; y: number } | null>(null), fired = useRef(false);
  const stop = () => {
    clearTimeout(t.current);
    start.current = null;
  };
  return {
    onPointerDown: (e: RPointerEvent) => {
      if (e.pointerType !== "touch") return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clearTimeout(t.current);
      t.current = window.setTimeout(() => {
        fired.current = true;
        start.current = null;
        navigator.vibrate?.(8);
        fire();
      }, 450);
    },
    onPointerMove: (e: RPointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) stop();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onClickCapture: (e: RMouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
