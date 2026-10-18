// Общая рамка второстепенных экранов: шапка с заголовком (на телефоне — компактная, с кнопкой «назад» во вложенных экранах)
// и прокручиваемое содержимое. Ширина текста ограничена — строки не растягиваются на весь монитор.
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/utils";

export function Page({ title, sub, onBack, actions, children, wide, className }: { title: string; sub?: ReactNode; onBack?: () => void; actions?: ReactNode; children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className={cn("flex h-full min-h-0 flex-1 flex-col bg-surface", className)}>
      <header className="shrink-0 pt-safe">
        <div className={cn("mx-auto flex min-h-14 w-full items-center gap-2 px-4 md:min-h-16 md:px-8 md:pt-4", wide ? "max-w-6xl" : "max-w-3xl", onBack && "pl-1 md:pl-8")}>
          {onBack && <IconButton icon={ChevronLeft} label="Назад" onClick={onBack} className="md:hidden [&>svg]:size-6" />}
          <div className="min-w-0 flex-1 py-2">
            <h1 className="truncate text-xl font-semibold tracking-[-0.01em] md:text-2xl">{title}</h1>
            {sub && <p className="mt-0.5 text-sm text-fg-2">{sub}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </header>
      <div className="scroll-area min-h-0 flex-1 pb-[calc(env(safe-area-inset-bottom)+5rem)] md:pb-10">
        <div className={cn("mx-auto w-full px-4 pt-3 md:px-8 md:pt-4", wide ? "max-w-6xl" : "max-w-3xl")}>{children}</div>
      </div>
    </div>
  );
}

/** Группа строк с подписью сверху — вместо карточки вокруг каждого элемента. */
export function Group({ title, note, children, className }: { title?: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mb-7", className)}>
      {title && <h2 className="mb-1.5 text-sm font-semibold text-fg">{title}</h2>}
      <div className="divide-y divide-line border-y border-line">{children}</div>
      {note && <p className="mt-2 text-sm text-fg-3">{note}</p>}
    </section>
  );
}
