// Невыполненная просьба клиента — над полем ответа. «Сделано» закрывает её и (если можно) сразу сообщает клиенту:
// текст готов, его можно поправить. Тот же порядок, что в рабочем пульте: сервер сам отмечает заявку и снимает «ждёт ответа».
import { CalendarClock, ClipboardCheck, PhoneCall, Repeat } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import type { ChatRequest } from "@/model/types";
import { waited } from "@/lib/format";
import { cn } from "@/lib/utils";

const TITLE: Record<ChatRequest["kind"], string> = { cancel: "Просит отменить запись", change: "Просит перенести запись", callback: "Просит перезвонить", lead: "Новая заявка" };
const ICON = { cancel: CalendarClock, change: Repeat, callback: PhoneCall, lead: ClipboardCheck } as const;

function template(q: ChatRequest, booking: boolean): string {
  const to = (q.service.split("→")[1] || "").trim();
  if (q.kind === "cancel") return "Здравствуйте! Вашу запись отменили. Будем рады видеть вас в другой раз.";
  if (q.kind === "change") return `Здравствуйте! Вашу запись перенесли${to ? `: ${to}` : ""}. Ждём вас!`;
  const what = [q.service, q.time].filter(Boolean).join(", ");
  return booking ? `Здравствуйте! Ваша запись подтверждена${what ? `: ${what}` : ""}. Ждём вас!` : `Здравствуйте! Ваша заявка принята${what ? `: ${what}` : ""}. Мы свяжемся с вами.`;
}

export function RequestCard({ q, since, now, canMessage, booking, onDone }: { q: ChatRequest; since?: number; now: number; canMessage: boolean; booking: boolean; onDone: (text: string) => Promise<string | null> }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(() => template(q, booking));
  const [busy, setBusy] = useState<"send" | "close" | null>(null);
  const [err, setErr] = useState("");
  const Icon = ICON[q.kind];
  const run = async (kind: "send" | "close") => {
    setBusy(kind);
    setErr("");
    const e = await onDone(kind === "send" ? text.trim() : "");
    setBusy(null);
    if (e) setErr(e);
  };
  const details = [q.name, q.service].filter(Boolean).join(", ");
  return (
    <div className="border-t border-line bg-canvas px-4 py-3">
      <div className="mx-auto max-w-[50rem]">
        <div className="flex items-start gap-3">
          <Icon aria-hidden className="mt-[3px] size-[1.125rem] shrink-0 text-critical" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <p className="text-[0.9375rem] font-semibold leading-5 md:text-base">{TITLE[q.kind]}</p>
            {since ? <p className="mt-0.5 text-sm leading-5 text-critical">ждёт {waited(since, now)}</p> : null}
            <div className="mt-1 space-y-px text-sm leading-5 text-fg-2 md:text-ui">
              {details && <p>{details}</p>}
              {q.time && <p>Время: {q.time}</p>}
              {q.note && <p className="text-fg-3">{q.note}</p>}
            </div>
          </div>
          {!edit && (
            <Button
              size="sm"
              variant="primary"
              busy={busy === "close"}
              onClick={() => (q.kind === "callback" || !canMessage ? run("close") : setEdit(true))}
              className="shrink-0"
            >
              {q.kind === "callback" ? "Перезвонил" : "Сделано"}
            </Button>
          )}
        </div>
        {edit && (
          <div className="mt-3 md:pl-[1.875rem]">
            <label className="block">
              <span className="mb-1 block text-xs text-fg-3">Сообщение клиенту</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-[0.625rem] border border-line-strong bg-surface px-3 py-2 text-md text-fg outline-none focus:border-accent/60 md:text-base dark:bg-surface-2"
              />
            </label>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2 sm:flex sm:flex-wrap">
              <Button variant="primary" className="col-span-2" busy={busy === "send"} disabled={!text.trim() || !!busy} onClick={() => run("send")}>
                Отправить и закрыть
              </Button>
              <Button variant="outline" busy={busy === "close"} disabled={!!busy} onClick={() => run("close")}>
                Закрыть без сообщения
              </Button>
              <Button variant="ghost" disabled={!!busy} onClick={() => setEdit(false)}>
                Отмена
              </Button>
            </div>
          </div>
        )}
        {!canMessage && q.kind !== "callback" && !edit && <p className="mt-1.5 text-xs text-fg-3 md:pl-[1.875rem]">Написать клиенту сейчас нельзя — сообщите ему по телефону.</p>}
        {err && <p className={cn("mt-2 text-sm text-critical md:pl-[1.875rem]")}>{err}</p>}
      </div>
    </div>
  );
}
