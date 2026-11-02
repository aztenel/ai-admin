// Рамка мастера рассылки (общая для мастера шаблона Meta — Wizard.tsx — и мастера второго номера — GaWizard.tsx): на телефоне — шапка
// со стрелкой и полосой шагов, прокрутка и кнопки внизу (над клавиатурой); на компьютере — крупный заголовок, как у других экранов,
// и «Закрыть». Нижние вкладки на подвиде скрывает хаб. role=region с названием — по нему мастер находят проверки и читалки.
import { ChevronLeft, X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Button, IconButton } from "@/components/ui";
import { cn } from "@/lib/utils";

export function Frame({
  md,
  title,
  sub,
  onBack,
  backLabel = "Назад",
  onClose,
  step,
  steps = 0,
  scroller,
  footer,
  children,
}: {
  md: boolean;
  title: string;
  sub?: string;
  onBack: () => void;
  backLabel?: string;
  onClose?: () => void;
  /** Текущий шаг (с 0) и сколько всего шагов — полоса шагов на телефоне (и на компьютере, если шагов больше нуля и задан step). */
  step?: number;
  steps?: number;
  scroller?: RefObject<HTMLDivElement | null>;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const bar =
    step !== undefined && steps > 0 ? (
      <div aria-hidden className={cn("flex gap-1", md ? "mx-auto w-full max-w-3xl px-8 pb-3" : "px-4 pb-2")}>
        {Array.from({ length: steps }, (_, i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors", i <= step ? "bg-accent" : "bg-surface-3")} />
        ))}
      </div>
    ) : null;
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-canvas" role="region" aria-label={title}>
      <header className="shrink-0 pt-safe">
        {!md ? (
          <>
            <div className="relative flex h-[3.25rem] items-center justify-between px-0.5">
              <IconButton icon={ChevronLeft} label={backLabel} onClick={onBack} className="text-accent hover:text-accent [&>svg]:size-7 [&>svg]:stroke-[2]" />
              <h1 className="pointer-events-none absolute inset-x-14 truncate text-center text-[1.0625rem] font-semibold">{title}</h1>
              {onClose && <IconButton icon={X} label="Закрыть мастер" onClick={onClose} />}
            </div>
            {bar}
          </>
        ) : (
          <>
            <div className="mx-auto flex w-full max-w-3xl items-end gap-2 px-8 pb-4 pt-7">
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
                {sub && <p className="mt-0.5 text-ui text-fg-2">{sub}</p>}
              </div>
              <Button variant="ghost" icon={X} onClick={onClose || onBack}>
                Закрыть
              </Button>
            </div>
            {bar}
          </>
        )}
      </header>
      <div ref={scroller} className={cn("scroll-area min-h-0 flex-1", md ? "pb-10" : "pb-4")}>
        <div className={cn("mx-auto w-full max-w-3xl pt-1", md ? "px-8" : "px-4 pt-3")}>{children}</div>
      </div>
      {footer && (
        <div className={cn("shrink-0", md ? "border-t border-line bg-surface" : "border-t border-line bg-canvas")}>
          <div className={cn("mx-auto w-full max-w-3xl", md ? "px-8 py-3" : "pb-safe-kb px-4 pt-2.5")}>{footer}</div>
        </div>
      )}
    </div>
  );
}

export function Actions({ md, children }: { md: boolean; children: ReactNode }) {
  return <div className={cn("flex gap-2", md ? "flex-wrap items-center" : "flex-col")}>{children}</div>;
}
