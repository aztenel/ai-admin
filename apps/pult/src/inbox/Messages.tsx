// Лента переписки. Клиент — серый пузырь слева; справа бот (тихий пузырь с рамкой) и человек (тёплый шафрановый оттенок):
// кто ответил, видно и по подписи над группой, и по виду пузыря — без ярких заливок.
// Прокрутка: новое сообщение прокручивает вниз, только если вы и так внизу; иначе — кнопка «Новые сообщения».
// Положение в каждом чате запоминается: вернулись в чат — та же точка ленты.
import { ArrowDown, Bot, FileText, Image as ImageIcon, Megaphone, Mic, Phone, RotateCcw, Trash2, UserRound, Video } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import type { ConversationDetail, Message } from "@/model/types";
import { dayLabel, sameDay, timeHM } from "@/lib/format";
import { cn } from "@/lib/utils";

const positions = new Map<string, { top: number; count: number }>();
const GROUP_GAP = 6 * 60e3;

type Item = { kind: "day"; at: number } | { kind: "campaign"; at: number; name: string; text: string } | { kind: "msg"; m: Message; first: boolean; last: boolean };

function items(messages: Message[], campaign: ConversationDetail["campaign"]): Item[] {
  const out: Item[] = [];
  let prev: Message | null = null;
  let promo = campaign;
  messages.forEach((m, i) => {
    if (m.at && (!prev || !sameDay(prev.at, m.at))) out.push({ kind: "day", at: m.at });
    if (promo && m.at >= promo.at) {
      out.push({ kind: "campaign", ...promo });
      promo = undefined;
    }
    const next = messages[i + 1];
    const same = (a: Message | null | undefined, b: Message | null | undefined) => !!a && !!b && a.from === b.from && a.via === b.via && Math.abs(b.at - a.at) < GROUP_GAP && sameDay(a.at, b.at);
    out.push({ kind: "msg", m, first: !same(prev, m), last: !same(m, next) });
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

  const list = items(detail.messages, detail.campaign);
  return (
    <div className="relative min-h-0 flex-1">
      <div ref={box} onScroll={onScroll} className="scroll-area h-full" role="log" aria-label="Переписка" aria-live="polite">
        <div className="mx-auto flex max-w-[52rem] flex-col px-3 pb-3 pt-2 md:px-6">
          {list.length === 0 && outbox.length === 0 && <p className="py-16 text-center text-sm text-fg-3">Сообщений пока нет. Бот мог забыть эту переписку по просьбе администратора.</p>}
          {list.map((it, i) =>
            it.kind === "day" ? (
              <DayMark key={`d${it.at}`} at={it.at} now={now} />
            ) : it.kind === "campaign" ? (
              <SystemNote key={`c${i}`} icon={Megaphone}>
                Рассылка «{it.name || "без названия"}», {timeHM(it.at)}. Клиент мог ответить на неё: «{it.text.length > 140 ? it.text.slice(0, 140) + "…" : it.text}»
              </SystemNote>
            ) : (
              <Bubble key={it.m.id} m={it.m} first={it.first} last={it.last} />
            ),
          )}
          {outbox.map((m, i) => (
            <Fragment key={m.id}>
              <Bubble m={m} first={i === 0 && detail.messages.at(-1)?.from !== "operator"} last />
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
          className="absolute bottom-3 left-1/2 inline-flex h-9 -translate-x-1/2 animate-pop-in items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm font-medium text-fg shadow-pop"
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
    <div className="my-3 flex justify-center">
      <span className="px-2.5 py-0.5 text-xs font-medium text-fg-3">{dayLabel(at, now)}</span>
    </div>
  );
}

function SystemNote({ icon: Icon, children }: { icon: typeof Megaphone; children: ReactNode }) {
  return (
    <p className="mx-auto my-3 flex max-w-[34rem] items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-2">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-3" strokeWidth={1.9} />
      <span>{children}</span>
    </p>
  );
}

const MEDIA_ICON = { audio: Mic, image: ImageIcon, video: Video, document: FileText, sticker: ImageIcon, location: FileText, contact: Phone } as const;
const MEDIA_NAME = { audio: "Голосовое", image: "Фото", video: "Видео", document: "Файл", sticker: "Стикер", location: "Геолокация", contact: "Контакт" } as const;

function Bubble({ m, first, last }: { m: Message; first: boolean; last: boolean }) {
  const out = m.from !== "contact";
  const isPlaceholder = !!m.media && /^\[[^\]]{1,24}\]$/.test(m.text.trim());
  const text = isPlaceholder ? "" : m.text;
  const who = m.from === "bot" ? "Бот" : m.from === "operator" ? (m.via === "phone" ? "Оператор, с телефона" : "Оператор") : "";
  return (
    <div className={cn("flex flex-col", out ? "items-end" : "items-start", first ? "mt-2.5" : "mt-0.5", m.delivery === "sending" && "animate-msg-in")}>
      {first && who && (
        <span className="mb-1 flex items-center gap-1 px-1 text-xs text-fg-3">
          {m.from === "bot" ? <Bot aria-hidden className="size-3.5" strokeWidth={2} /> : <UserRound aria-hidden className="size-3.5" strokeWidth={2} />}
          {who}
        </span>
      )}
      <div
        className={cn(
          "relative max-w-[min(34rem,84%)] rounded-[1.125rem] px-3.5 py-2 text-md md:max-w-[min(36rem,74%)] md:text-base",
          m.from === "contact" && "bg-bubble-in text-fg",
          m.from === "bot" && "border border-bubble-bot-line bg-bubble-bot text-fg",
          m.from === "operator" && "bg-bubble-op text-bubble-op-fg",
          last && (out ? "rounded-br-md" : "rounded-bl-md"),
          m.delivery === "sending" && "opacity-70",
          m.delivery === "failed" && "ring-1 ring-critical",
        )}
      >
        {m.media && <Media m={m} />}
        {text && (
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {text}
            <span aria-hidden className="inline-block w-12" />
          </p>
        )}
        <time className={cn("tnum text-xs", text ? "absolute bottom-1.5 right-3" : "mt-1 block text-right", m.from === "operator" ? "text-bubble-op-fg/60" : "text-fg-3")}>
          {m.delivery === "sending" ? "…" : timeHM(m.at)}
        </time>
      </div>
    </div>
  );
}

function Media({ m }: { m: Message }) {
  const media = m.media!;
  const Icon = MEDIA_ICON[media.kind];
  if (media.url && media.kind === "image")
    return (
      <a href={media.url} target="_blank" rel="noopener" className="-mx-1.5 -mt-0.5 mb-1 block overflow-hidden rounded-xl">
        <img src={media.url} alt="Фото от клиента" loading="lazy" className="max-h-80 w-full min-w-40 bg-surface-2 object-cover" />
      </a>
    );
  if (media.url && media.kind === "audio") return <audio controls preload="none" src={media.url} className="mb-1 h-10 w-64 max-w-full" />;
  return (
    <span className="mb-1 flex items-center gap-2 text-sm">
      <Icon aria-hidden className="size-4 shrink-0 opacity-70" strokeWidth={1.9} />
      {media.url ? (
        <a href={media.url} target="_blank" rel="noopener" className="underline underline-offset-2">
          {MEDIA_NAME[media.kind]} — открыть
        </a>
      ) : (
        <span className="opacity-80">{MEDIA_NAME[media.kind]} — посмотреть в пульте нельзя</span>
      )}
    </span>
  );
}
