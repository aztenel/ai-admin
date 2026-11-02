// Общая рамка второстепенных экранов: полотно, заголовок и сгруппированные списки (как настройки iPhone и Mac).
// Вложенный экран на телефоне — синяя стрелка «назад» и заголовок по центру; ширина содержимого ограничена.
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton, InsetGroup, ModeBadge } from "@/components/ui";
import { cn } from "@/lib/utils";

export function Page({ title, sub, onBack, actions, children, wide, className }: { title: string; sub?: ReactNode; onBack?: () => void; actions?: ReactNode; children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className={cn("flex h-full min-h-0 flex-1 flex-col bg-canvas", className)}>
      <header className="shrink-0 pt-safe">
        {onBack && (
          <div className="relative flex h-[3.25rem] items-center px-0.5 md:hidden">
            <IconButton icon={ChevronLeft} label="Назад" onClick={onBack} className="text-accent hover:text-accent [&>svg]:size-7 [&>svg]:stroke-[2]" />
            <h1 className="pointer-events-none absolute inset-x-14 truncate text-center text-[1.0625rem] font-semibold">{title}</h1>
          </div>
        )}
        <div className={cn("mx-auto flex w-full items-end gap-2 px-4 pb-3 pt-4 md:px-8 md:pb-4 md:pt-7", wide ? "max-w-6xl" : "max-w-3xl", onBack && "max-md:hidden")}>
          <div className="min-w-0 flex-1">
            <h1 className="title-display truncate text-[1.75rem] font-bold leading-9 tracking-[-0.022em] md:text-[1.75rem] md:font-semibold md:tracking-[-0.02em]">{title}</h1>
            <p className="mt-0.5 flex min-w-0 items-center gap-2 text-ui text-fg-2 empty:hidden">
              {sub && <span className="truncate">{sub}</span>}
              <ModeBadge />
            </p>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
      </header>
      {/* relative: невидимые подписи для читалок (sr-only — position: absolute) остаются внутри прокрутки; без этого они растягивали
          корень пульта, и на компьютере экран съезжал вверх (находка проверки раздела «Рассылки» 19.10.2026) */}
      <div className="scroll-area pb-tabbar relative min-h-0 flex-1 pb-[calc(var(--safe-b)+5rem)] md:pb-10">
        <div className={cn("mx-auto w-full px-4 pt-1 md:px-8", wide ? "max-w-6xl" : "max-w-3xl")}>{children}</div>
      </div>
    </div>
  );
}

/** Группа строк с подписью — вместо карточки вокруг каждого элемента. */
export const Group = InsetGroup;
