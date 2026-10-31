// Галочки исходящего (ТЗ v2.0 §2.3): часы — ещё не отправлено, одна серая — отправлено, две серые — доставлено, две синие —
// прочитано, ошибка — красный знак и причина, «?» — ответа на отправку не было (могло уйти, само не повторяется).
// Нет статуса от провайдера — ничего не рисуем: галочек без подтверждения не бывает.
import { AlertCircle, Check, CheckCheck, CircleHelp, Clock } from "lucide-react";
import type { DeliveryStatus } from "@/model/types";
import { cn } from "@/lib/utils";

export const STATUS_TEXT: Record<DeliveryStatus, string> = {
  queued: "Ещё не отправлено",
  sent: "Отправлено",
  delivered: "Доставлено",
  read: "Прочитано",
  failed: "Не доставлено",
  unknown: "Неизвестно, ушло ли: ответа от WhatsApp не было. Не отправляйте второй раз — проверьте в телефоне",
};

export function Ticks({ status, error, className, onDark }: { status?: DeliveryStatus; error?: string; className?: string; onDark?: boolean }) {
  if (!status) return null;
  const label = status === "failed" && error ? `${STATUS_TEXT.failed}: ${error}` : STATUS_TEXT[status];
  const cls = cn("inline-block size-[0.875rem] shrink-0 align-[-2px]", className);
  const muted = onDark ? "text-bubble-op-fg/75" : "text-fg-3";
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex">
      {status === "queued" && <Clock aria-hidden className={cn(cls, muted)} strokeWidth={2} />}
      {status === "sent" && <Check aria-hidden className={cn(cls, muted)} strokeWidth={2.2} />}
      {status === "delivered" && <CheckCheck aria-hidden className={cn(cls, muted)} strokeWidth={2.2} />}
      {status === "read" && <CheckCheck aria-hidden className={cn(cls, onDark ? "text-[#9fe0ff]" : "text-[#34b7f1]")} strokeWidth={2.4} />}
      {status === "failed" && <AlertCircle aria-hidden className={cn(cls, onDark ? "text-[#ffd0d0]" : "text-critical")} strokeWidth={2.2} />}
      {status === "unknown" && <CircleHelp aria-hidden className={cn(cls, muted)} strokeWidth={2} />}
    </span>
  );
}
