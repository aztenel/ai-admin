// Общие детали интерфейса: кнопки, аватар, счётчики, пустое состояние, полоса-предупреждение, переключатель.
// Одна деталь — одна реализация; размеры касания на телефоне — не меньше 44 px (pointer-coarse).
import { UserRound, type LucideIcon } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger";
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-[0.96] active:brightness-[0.92]",
  secondary: "bg-surface-2 text-fg hover:bg-surface-3",
  ghost: "text-fg-2 hover:bg-surface-2 hover:text-fg",
  outline: "border border-line-strong bg-surface text-fg hover:bg-surface-2",
  danger: "text-critical hover:bg-critical-soft",
};
const SIZE = {
  sm: "h-8 gap-1.5 px-2.5 text-sm pointer-coarse:h-10",
  md: "h-9 gap-2 px-3.5 text-base pointer-coarse:h-11 pointer-coarse:px-4",
  lg: "h-11 gap-2 px-4 text-md",
};

/** Классы кнопки — для ссылок, которые выглядят как кнопка (позвонить, открыть страницу). */
export const buttonClass = (variant: Variant = "secondary", size: keyof typeof SIZE = "md", className?: string) =>
  cn(
    "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-lg font-medium transition-[background-color,filter,color] duration-100 disabled:opacity-50",
    VARIANT[variant],
    SIZE[size],
    className,
  );

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZE; icon?: LucideIcon; busy?: boolean };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", icon: Icon, busy, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {busy ? <Spinner className="size-4" /> : Icon ? <Icon aria-hidden className="size-4 shrink-0" strokeWidth={2} /> : null}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; active?: boolean }>(function IconButton(
  { icon: Icon, label, active, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-grid size-9 shrink-0 place-items-center rounded-lg text-fg-2 transition-colors duration-100 hover:bg-surface-2 hover:text-fg disabled:opacity-40 pointer-coarse:size-11",
        active && "bg-surface-3 text-fg",
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden className="size-[1.1875rem]" strokeWidth={1.9} />
    </button>
  );
});

const AV = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-12 text-base", xl: "size-16 text-xl" };
/** Нейтральный кружок с инициалами — без случайных цветов. Фото появится, когда сервер начнёт их отдавать. */
export function Avatar({ name, phone, size = "md", className }: { name?: string; phone?: string; size?: keyof typeof AV; className?: string }) {
  const text = name || phone ? initials(name, phone) : "";
  return (
    <span aria-hidden className={cn("grid shrink-0 select-none place-items-center rounded-full bg-surface-3 font-medium text-fg-2", AV[size], className)}>
      {text || <UserRound className="size-[45%]" strokeWidth={1.8} />}
    </span>
  );
}

export function CountBadge({ n, className, tone = "accent" }: { n: number; className?: string; tone?: "accent" | "muted" }) {
  if (!n) return null;
  return (
    <span
      className={cn(
        "tnum inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-xs font-semibold",
        tone === "accent" ? "bg-accent text-accent-fg" : "bg-surface-3 text-fg-2",
        className,
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={cn("size-5 animate-spin text-fg-3", className)} fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-md bg-surface-2", className)} />;
}

/** Пустой экран говорит, что делать дальше, а не «здесь пусто». */
export function EmptyState({ icon: Icon, title, text, action, className }: { icon?: LucideIcon; title: string; text?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {Icon && (
        <span className="mb-3 grid size-11 place-items-center rounded-full bg-surface-2 text-fg-3">
          <Icon aria-hidden className="size-5" strokeWidth={1.8} />
        </span>
      )}
      <p className="text-base font-semibold text-fg">{title}</p>
      {text && <p className="mt-1 max-w-[30ch] text-sm text-fg-2">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Полоса-сообщение во всю ширину панели: нет связи, ошибка загрузки, демо. */
export function Banner({ tone = "neutral", icon: Icon, children, action, className }: { tone?: "neutral" | "critical" | "accent"; icon?: LucideIcon; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div
      role={tone === "critical" ? "alert" : "status"}
      className={cn(
        "flex items-center gap-2.5 px-4 py-2 text-sm",
        tone === "critical" && "bg-critical-soft text-critical",
        tone === "accent" && "bg-accent-soft text-accent-ink",
        tone === "neutral" && "bg-surface-2 text-fg-2",
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-4 shrink-0" strokeWidth={2} />}
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; icon?: LucideIcon }[]; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-lg bg-surface-2 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium text-fg-2 transition-colors pointer-coarse:h-10",
            value === o.id ? "bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08)] dark:bg-surface-3" : "hover:text-fg",
          )}
        >
          {o.icon && <o.icon aria-hidden className="size-4 shrink-0" strokeWidth={1.9} />}
          <span className="truncate">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Строка «подпись — значение» в карточке клиента и настройках. */
export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-baseline justify-between gap-4 py-2.5", className)}>
      <dt className="shrink-0 text-sm text-fg-2">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-fg">{children}</dd>
    </div>
  );
}
