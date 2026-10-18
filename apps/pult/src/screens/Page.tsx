// Общая рамка второстепенных экранов: полотно, заголовок и сгруппированные списки (как настройки iPhone и Mac).
// Вложенный экран на телефоне — синяя стрелка «назад» и заголовок по центру; ширина содержимого ограничена.
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton, InsetGroup } from "@/components/ui";
import { cn } from "@/lib/utils";

export function Page({ title, sub, onBack, actions, children, wide, className }: { title: string; sub?: ReactNode; onBack?: () => void; actions?: ReactNode; children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className={cn("flex h-full min-h-0 flex-1 flex-col bg-canvas", className)}>
      <header className="shrink-0 pt-safe">
        {onBack && (
          <div className="relative flex h-[3.25rem] items-center px-0.5 md:hidden">
            <IconButton icon={ChevronLeft} label="Назад" onClick={onBack} className="text-accent hover:text-accent [&>svg]:size-7 [&>svg]:stroke-[2]" />
            <h1 className="pointer-events-none absolute inset-x-14 truncate text-center text-base font-semibold">{title}</h1>
          </div>
        )}
        <div className={cn("mx-auto flex w-full items-end gap-2 px-4 pb-3 pt-3 md:px-8 md:pb-4 md:pt-7", wide ? "max-w-6xl" : "max-w-3xl", onBack && "max-md:hidden")}>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[1.625rem] font-semibold leading-8 tracking-[-0.02em] md:text-2xl">{title}</h1>
            {sub && <p className="mt-0.5 text-ui text-fg-2">{sub}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
      </header>
      <div className="scroll-area min-h-0 flex-1 pb-[calc(env(safe-area-inset-bottom)+5rem)] md:pb-10">
        <div className={cn("mx-auto w-full px-4 pt-1 md:px-8", wide ? "max-w-6xl" : "max-w-3xl")}>{children}</div>
      </div>
    </div>
  );
}

/** Группа строк с подписью — вместо карточки вокруг каждого элемента. */
export const Group = InsetGroup;
