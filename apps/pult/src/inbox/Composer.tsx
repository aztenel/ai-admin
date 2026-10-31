// Поле ответа. Ответ уходит с того номера, на который написал клиент, — это написано прямо над полем, мелко, по линии текста.
// Кнопка «Отправить» — внутри поля и оживает, когда есть текст; слева — быстрые ответы и реквизиты.
// Enter — отправить (на телефоне Enter — новая строка, отправка кнопкой). Черновик каждого чата сохраняется, пока открыт пульт.
import { Banknote, Phone, SendHorizontal, Zap } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, toast } from "@/components/overlay";
import { dataMode } from "@/data/source";
import { buttonClass, IconButton } from "@/components/ui";
import { channelTitle } from "@/model/channels";
import type { Channel, ReplyState } from "@/model/types";
import { until } from "@/lib/format";
import { isTouch } from "@/lib/viewport";
import { store } from "@/state/store";

const drafts = new Map<string, string>();
const FROM: Record<string, string> = { "Основной WhatsApp": "с основного номера", "Второй WhatsApp": "со второго номера" };
// Быстрые ответы (ТЗ v3.0 §7): короткие фразы администратора. «Когда моя запись?» — только из журнала Altegio (карточка записи),
// «Свободное время» открывает список свободного времени из Altegio; выдуманных данных в ответах нет.
const QUICK: { label: string; text: string }[] = [
  { label: "Перенос", text: "Подскажите, на какой день и время вам удобно перенести запись?" },
  { label: "Отмена", text: "Запись отменили. Если захотите записаться снова, напишите нам." },
  { label: "Ждём вас", text: "Ждём вас! Если планы изменятся, напишите заранее." },
  { label: "Уточнить имя", text: "Подскажите, пожалуйста, как к вам обращаться?" },
];
const MON_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const dayText = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${+m[3]} ${MON_GEN[+m[2] - 1]}` : d;
};

export function Composer({ convKey, channel, reply, payment, botActive, multiChannel, phone, now, onSend, onTimes, address }: { convKey: string; channel?: Channel; reply: ReplyState; payment?: string; botActive: boolean; multiChannel: boolean; phone?: string; now: number; onSend: (text: string) => void; onTimes?: () => void; address?: string }) {
  // ближайшая запись клиента из журнала Altegio — для ответа «Когда моя запись?»; грузится при открытии меню
  const [visit, setVisit] = useState<{ key: string; text: string | null } | null>(null);
  const loadVisit = () => {
    if (visit?.key === convKey) return;
    setVisit({ key: convKey, text: null });
    store.bookingCard(convKey).then(
      (c) => {
        const r = c.records?.find((x) => x.state !== "deleted") || c.records?.[0];
        setVisit({ key: convKey, text: r ? `Вы записаны на ${dayText(r.date)} в ${r.time}${r.staff ? `, мастер ${r.staff}` : ""}. Ждём вас!` : null });
      },
      () => setVisit({ key: convKey, text: null }),
    );
  };
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
        // подпись выровнена по началу текста в поле: читается как подпись к полю, а не как ещё одна строка экрана
        <p className="mx-auto flex max-w-[50rem] items-center gap-1 truncate pb-1 pl-[3.4375rem] pr-3 text-xs leading-4 text-fg-3 pointer-coarse:pl-[3.9375rem]">
          {from && (
            <span className="min-w-0 truncate">
              {FROM[from] ? <>Ответ уйдёт <span className="font-medium text-fg-2">{FROM[from]}</span></> : <>Ответ уйдёт с номера <span className="font-medium text-fg-2">{from}</span></>}
            </span>
          )}
          {closesSoon ? (
            <span className="shrink-0 font-medium text-critical">{from ? "· " : ""}написать можно {until(reply.closesAt!, now)}</span>
          ) : botActive ? (
            <span className="shrink-0 @max-[24rem]:hidden">{from ? "· " : ""}бот замолчит на 2 ч</span>
          ) : null}
        </p>
      )}
      <div className="mx-auto flex max-w-[50rem] items-end gap-2">
        <Menu onOpenChange={(v) => v && loadVisit()}>
          <MenuTrigger asChild>
            <IconButton icon={Zap} label="Быстрые ответы и реквизиты" className="text-brand-gold" />
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
            {visit?.key === convKey && visit.text && (
              <MenuItem onSelect={() => insert(visit.text!)}>
                <span className="min-w-0">
                  <span className="block font-medium">Когда запись</span>
                  <span className="line-clamp-2 text-xs text-fg-3">{visit.text}</span>
                </span>
              </MenuItem>
            )}
            {onTimes && (
              <MenuItem onSelect={onTimes}>
                <span className="font-medium">Свободное время…</span>
              </MenuItem>
            )}
            {address && (
              <MenuItem onSelect={() => insert(`Наш адрес: ${address}.`)}>
                <span className="min-w-0">
                  <span className="block font-medium">Адрес</span>
                  <span className="line-clamp-1 text-xs text-fg-3">{address}</span>
                </span>
              </MenuItem>
            )}
            {QUICK.map((q) => (
              <MenuItem key={q.label} onSelect={() => insert(q.text)}>
                <span className="min-w-0">
                  <span className="block font-medium">{q.label}</span>
                  <span className="line-clamp-2 text-xs text-fg-3">{q.text}</span>
                </span>
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
        {/* макет Figma «Переписка»: поле — капсула без рамки, отправка — отдельная круглая кнопка справа */}
        <label className="flex min-h-10 min-w-0 flex-1 items-end rounded-[1.25rem] bg-surface-2 px-3.5 py-[5px] outline-ring focus-within:outline-2">
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
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          aria-label="Отправить"
          className="relative grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition-[opacity,background-color] after:absolute after:-inset-1 hover:brightness-95 disabled:opacity-40"
        >
          <SendHorizontal aria-hidden className="size-[1.125rem]" strokeWidth={2.2} />
        </button>
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
