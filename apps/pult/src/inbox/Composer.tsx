// Поле ответа. Ответ уходит с того номера, на который написал клиент, — это написано прямо над полем, одной строкой.
// Кнопка «Отправить» — внутри поля и оживает, когда есть текст; слева — быстрые ответы и реквизиты.
// Enter — отправить (на телефоне Enter — новая строка, отправка кнопкой). Черновик каждого чата сохраняется, пока открыт пульт.
import { ArrowUp, Banknote, MessageCircle, Phone, Zap } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, toast } from "@/components/overlay";
import { dataMode } from "@/data/source";
import { buttonClass, IconButton } from "@/components/ui";
import { channelTitle } from "@/model/channels";
import type { Channel, ReplyState } from "@/model/types";
import { until } from "@/lib/format";
import { isTouch } from "@/lib/viewport";

const drafts = new Map<string, string>();
// Общие фразы — не про конкретный бизнес (те же, что у рабочего пульта, pult/app.js QUICK)
const QUICK = ["Здравствуйте! Чем могу помочь?", "Подскажите, пожалуйста, ваше имя и телефон.", "Ждём вас! Если планы изменятся — напишите заранее.", "Спасибо за обращение! Перезвоню вам в течение 10 минут."];

export function Composer({ convKey, channel, reply, payment, botActive, multiChannel, phone, now, onSend }: { convKey: string; channel?: Channel; reply: ReplyState; payment?: string; botActive: boolean; multiChannel: boolean; phone?: string; now: number; onSend: (text: string) => void }) {
  const [text, setText] = useState(() => drafts.get(convKey) || "");
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(drafts.get(convKey) || "");
  }, [convKey]);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const change = (v: string) => {
    setText(v);
    if (v) drafts.set(convKey, v);
    else drafts.delete(convKey);
  };
  const insert = (q: string) => {
    change(text.trim() ? text.replace(/\s+$/, "") + "\n\n" + q : q);
    requestAnimationFrame(() => ta.current?.focus());
  };
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    change("");
    ta.current?.focus();
  };

  if (!reply.allowed) return <ReplyBlocked text={reply.text} phone={phone} />;

  const closesSoon = !!reply.closesAt && reply.closesAt - now < 6 * 3600e3 && reply.closesAt > now;
  const from = multiChannel && channel ? channelTitle(channel) : "";

  return (
    <div className="@container pb-safe-kb shrink-0 border-t border-line bg-surface px-2 pt-1.5 md:px-4 md:pb-3 md:pt-2">
      {(from || botActive || closesSoon) && (
        <p className="mx-auto flex max-w-[50rem] items-center gap-3 truncate px-2.5 pb-1.5 text-xs text-fg-3 md:pl-11">
          {from && (
            <span className="flex min-w-0 items-center gap-1">
              <MessageCircle aria-hidden className="size-3 shrink-0" strokeWidth={2} />
              <span className="truncate">
                С номера <span className="text-fg-2">{from}</span>
              </span>
            </span>
          )}
          {closesSoon ? (
            <span className="shrink-0 text-critical">окно WhatsApp {until(reply.closesAt!, now)}</span>
          ) : botActive ? (
            <span className="shrink-0 @max-[24rem]:hidden">бот замолчит на 2 ч</span>
          ) : null}
        </p>
      )}
      <div className="mx-auto flex max-w-[50rem] items-end gap-1">
        <Menu>
          <MenuTrigger asChild>
            <IconButton icon={Zap} label="Быстрые ответы и реквизиты" className="text-fg-3" />
          </MenuTrigger>
          <MenuContent side="top" className="w-[min(22rem,calc(100vw-24px))]">
            {payment && (
              <>
                <MenuItem onSelect={() => insert(payment)}>
                  <Banknote aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={1.75} />
                  <span className="min-w-0">
                    <span className="block">Реквизиты для оплаты</span>
                    <span className="block truncate text-xs text-fg-3">{payment}</span>
                  </span>
                </MenuItem>
                <MenuSeparator />
              </>
            )}
            <MenuLabel>Быстрые ответы</MenuLabel>
            {QUICK.map((q) => (
              <MenuItem key={q} onSelect={() => insert(q)}>
                <span className="line-clamp-2">{q}</span>
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
        <label className="flex min-h-9 min-w-0 flex-1 items-end gap-1 rounded-[1.125rem] border border-line-strong bg-surface py-[3px] pl-3.5 pr-[3px] transition-colors focus-within:border-accent pointer-coarse:min-h-10 dark:bg-surface-2">
          <span className="sr-only">Ответ клиенту</span>
          <textarea
            ref={ta}
            rows={1}
            value={text}
            onChange={(e) => change(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !isTouch()) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Сообщение"
            enterKeyHint="send"
            maxLength={2000}
            className="block max-h-40 min-h-0 w-full resize-none bg-transparent py-[3px] text-md leading-6 text-fg outline-none md:text-base md:leading-6 pointer-coarse:py-[5px] pointer-coarse:text-md"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            aria-label="Отправить"
            className="grid size-[1.875rem] shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition-[opacity,background-color] hover:brightness-95 disabled:bg-transparent disabled:text-fg-3 disabled:opacity-60 pointer-coarse:size-8"
          >
            <ArrowUp aria-hidden className="size-[1.125rem]" strokeWidth={2.4} />
          </button>
        </label>
      </div>
    </div>
  );
}

function ReplyBlocked({ text, phone }: { text: string; phone?: string }) {
  return (
    <div className="pb-safe-kb shrink-0 border-t border-line bg-canvas px-4 pt-3 md:pb-3">
      <div className="mx-auto flex max-w-[50rem] flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 basis-60 text-sm text-fg-2 md:text-ui">{text}</p>
        <CallLink phone={phone} />
      </div>
    </div>
  );
}

/** Позвонить клиенту. В демо номера вымышленные — звонок не набирается (CLAUDE.md §5.3, п. 7). */
export function CallLink({ phone, className, label = "Позвонить" }: { phone?: string; className?: string; label?: string }) {
  if (!phone) return null;
  if (dataMode() === "demo")
    return (
      <button type="button" onClick={() => toast("В демо звонок не набирается: номера вымышленные")} className={buttonClass("tinted", "sm", className)}>
        <Phone aria-hidden className="size-4" strokeWidth={2} />
        {label}
      </button>
    );
  return (
    <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className={buttonClass("tinted", "sm", className)}>
      <Phone aria-hidden className="size-4" strokeWidth={2} />
      {label}
    </a>
  );
}
