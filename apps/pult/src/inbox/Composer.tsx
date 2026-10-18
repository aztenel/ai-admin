// Поле ответа. Ответ уходит с того номера, на который написал клиент, — это написано прямо над полем.
// Enter — отправить (на телефоне Enter — новая строка, отправка кнопкой). Черновик каждого чата сохраняется, пока открыт пульт.
import { ArrowUp, Banknote, Phone, Zap } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, toast } from "@/components/overlay";
import { dataMode } from "@/data/source";
import { buttonClass, IconButton } from "@/components/ui";
import { channelTitle } from "@/model/channels";
import type { Channel, ReplyState } from "@/model/types";
import { until } from "@/lib/format";
import { isTouch } from "@/lib/viewport";
import { cn } from "@/lib/utils";

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

  const closesSoon = reply.closesAt && reply.closesAt - now < 6 * 3600e3 && reply.closesAt > now;
  const hint = [
    multiChannel && channel ? `Ответ уйдёт с номера «${channelTitle(channel)}».` : "",
    botActive ? "Бот замолчит в этом чате на 2 часа." : "",
    closesSoon ? `Окно WhatsApp открыто ${until(reply.closesAt!, now)} — потом написать первым будет нельзя.` : "",
  ].filter(Boolean).join(" ");

  return (
    <div className="pb-safe-kb shrink-0 border-t border-line bg-surface px-2 pt-2 md:px-4 md:pb-3">
      {hint && <p className={cn("mx-auto mb-1.5 max-w-[52rem] px-2 text-xs [@media(max-height:500px)]:truncate", closesSoon ? "text-accent-ink" : "text-fg-3")}>{hint}</p>}
      <div className="mx-auto flex max-w-[52rem] items-end gap-1">
        <Menu>
          <MenuTrigger asChild>
            <IconButton icon={Zap} label="Быстрые ответы" className="mb-px" />
          </MenuTrigger>
          <MenuContent side="top" className="w-[min(22rem,calc(100vw-24px))]">
            {payment && (
              <>
                <MenuItem onSelect={() => insert(payment)}>
                  <Banknote aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={1.9} />
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
        <label className="flex min-h-10 min-w-0 flex-1 items-end rounded-[1.25rem] border border-line-strong bg-surface px-3.5 focus-within:border-fg-3 pointer-coarse:min-h-11">
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
            className="block max-h-40 min-h-0 w-full resize-none bg-transparent py-2 text-md leading-6 text-fg outline-none md:py-[0.4375rem] md:text-base pointer-coarse:py-2.5 pointer-coarse:text-md"
          />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          aria-label="Отправить"
          className="mb-px grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition-[opacity,filter] hover:brightness-95 disabled:bg-surface-3 disabled:text-fg-3 pointer-coarse:size-11"
        >
          <ArrowUp aria-hidden className="size-5" strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

function ReplyBlocked({ text, phone }: { text: string; phone?: string }) {
  return (
    <div className="pb-safe-kb shrink-0 border-t border-line bg-surface px-4 pt-3 md:pb-3">
      <div className="mx-auto flex max-w-[52rem] flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 basis-60 text-sm text-fg-2">{text}</p>
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
      <button type="button" onClick={() => toast("В демо звонок не набирается: номера вымышленные")} className={buttonClass("outline", "sm", className)}>
        <Phone aria-hidden className="size-4" strokeWidth={2} />
        {label}
      </button>
    );
  return (
    <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className={buttonClass("outline", "sm", className)}>
      <Phone aria-hidden className="size-4" strokeWidth={2} />
      {label}
    </a>
  );
}
