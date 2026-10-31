// Лента переписки. Три голоса — три веса: клиент — нейтральный серый пузырь слева; справа бот — бледно-синий (наша
// сторона, но тихо) и человек — сплошной синий (самое важное: это сказали вы). Подпись «Бот» / «Оператор» — только когда
// отвечающий сменился. Время — мелко внутри пузыря.
// Прокрутка: новое сообщение прокручивает вниз, только если вы и так внизу; иначе — кнопка «Новые сообщения».
// Положение в каждом чате запоминается: вернулись в чат — та же точка ленты.
import { ArrowDown, BellRing, Bot, Megaphone, RotateCcw, Smartphone, Trash2, UserRound } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import type { ConversationDetail, Message } from "@/model/types";
import { dayLabel, sameDay, timeHM } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MediaView } from "./MediaView";
import { Ticks } from "./Ticks";

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

export function Messages({ convKey, detail, outbox, now, onRetry, onDrop }: { convKey: string; detail: ConversationDetail; outbox: Message[]; now: number; onRetry: (m: Message) => void; onDrop: (m: Message) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const count = detail.messages.length + outbox.length;
  const seen = useRef(count);
  const [below, setBelow] = useState(0);

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

  // поле ответа выросло или открылась клавиатура: если были внизу — остаёмся внизу
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => atEnd.current && (el.scrollTop = el.scrollHeight));
    ro.observe(el);
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
    <div className="relative min-h-0 flex-1">
      <div ref={box} onScroll={onScroll} className="scroll-area h-full" role="log" aria-label="Переписка" aria-live="polite">
        <div className="mx-auto flex max-w-[50rem] flex-col px-2.5 pb-4 pt-1 md:px-6">
          {list.length === 0 && outbox.length === 0 && <p className="py-16 text-center text-sm text-fg-3">Сообщений пока нет. Бот мог забыть эту переписку по просьбе администратора.</p>}
          {list.map((it, i) =>
            it.kind === "day" ? (
              <DayMark key={`d${it.at}`} at={it.at} now={now} />
            ) : it.kind === "campaign" ? (
              <SystemNote key={`c${i}`} icon={Megaphone}>
                Рассылка «{it.name || "без названия"}», {timeHM(it.at)}. Клиент мог ответить на неё: «{it.text.length > 140 ? it.text.slice(0, 140) + "…" : it.text}»
              </SystemNote>
            ) : (
              <Bubble key={it.m.id} m={it.m} first={it.first} last={it.last} label={it.label} />
            ),
          )}
          {outbox.map((m, i) => (
            <Fragment key={m.id}>
              <Bubble m={m} first={i === 0 && detail.messages.at(-1)?.from !== "operator"} last label={i === 0 && voice(detail.messages.filter((x) => x.from !== "contact").at(-1) || m) !== "op:"} />
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

function Bubble({ m, first, last, label }: { m: Message; first: boolean; last: boolean; label: boolean }) {
  const out = m.from !== "contact";
  // «[клиент прислал фото]» — служебная подпись сервера: у файла её не показываем (ТЗ v2.0 §2.2 — меньше технических строк)
  const isPlaceholder = !!m.media && /^\[[^\]]{1,60}\]$/.test(m.text.trim());
  const text = isPlaceholder ? "" : m.text;
  const who = label ? whoOf(m) : null;
  const dark = m.from === "operator";
  return (
    <div className={cn("flex flex-col", out ? "items-end" : "items-start", first ? "mt-3" : "mt-[3px]", m.delivery === "sending" && "animate-msg-in")}>
      {who && (
        <span className="mb-1 mt-1.5 flex items-center gap-1 px-1 text-xs font-medium text-fg-3">
          <who.Icon aria-hidden className="size-3.5" strokeWidth={1.9} />
          {who.text}
        </span>
      )}
      <div
        className={cn(
          "relative max-w-[min(30rem,82%)] rounded-[1.125rem] px-3 py-[0.4375rem] text-md leading-[1.375rem] md:max-w-[min(34rem,72%)] md:text-base md:leading-[1.3125rem]",
          m.from === "contact" && "bg-bubble-in text-fg",
          m.from === "bot" && "bg-bubble-bot text-fg",
          m.from === "operator" && "bg-bubble-op text-bubble-op-fg",
          last && (out ? "rounded-br-[0.375rem]" : "rounded-bl-[0.375rem]"),
          m.delivery === "sending" && "opacity-70",
          (m.delivery === "failed" || m.status === "failed") && "ring-1 ring-critical",
          m.reaction && "mb-3",
        )}
      >
        {m.media && <MediaView media={m.media} onDark={dark} />}
        {text && (
          <p className={cn("whitespace-pre-wrap break-words [overflow-wrap:anywhere]", m.deleted && "line-through opacity-60")}>
            {text}
            <span aria-hidden className={cn("inline-block", out ? "w-16" : m.edited || m.deleted ? "w-24" : "w-11")} />
          </p>
        )}
        <span className={cn("tnum flex items-center gap-1 text-[0.6875rem] leading-none", text ? "absolute bottom-[0.5625rem] right-3" : "mt-1 justify-end", dark ? "text-bubble-op-fg/80" : "text-fg-3")}>
          {m.deleted ? <span>удалено</span> : m.edited ? <span>изменено</span> : null}
          <time>{m.delivery === "sending" ? "…" : timeHM(m.at)}</time>
          {out && !m.delivery && <Ticks status={m.status} error={m.statusError} onDark={dark} />}
        </span>
        {m.reaction && <span aria-label={`Реакция клиента: ${m.reaction}`} className={cn("absolute -bottom-3 rounded-full border border-line bg-surface px-1.5 text-sm leading-6 shadow-sm", out ? "left-2" : "right-2")}>{m.reaction}</span>}
      </div>
      {out && m.status === "failed" && <span className="mt-1 max-w-[36ch] text-right text-xs text-critical">Не доставлено{m.statusError ? `: ${m.statusError}` : ""}</span>}
    </div>
  );
}
