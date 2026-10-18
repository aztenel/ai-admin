// Общие детали интерфейса: кнопки, аватар, счётчики, пустое состояние, полоса-предупреждение, переключатель.
// Одна деталь — одна реализация. Скругления по ступеням: 10 px — кнопки и поля, 14 px — группы и меню, 18 px — пузыри и листы.
// Значки — 20 px в кнопках и навигации, 16 px в строке текста. Касание на телефоне — не меньше 44 px (pointer-coarse).
import { UserRound, type LucideIcon } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

type Variant = "primary" | "tinted" | "secondary" | "ghost" | "outline" | "danger";
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-[0.94] active:brightness-90",
  tinted: "bg-accent-soft text-accent-ink hover:brightness-[0.97] active:brightness-95 dark:hover:brightness-110",
  secondary: "bg-surface-2 text-fg hover:bg-surface-3",
  ghost: "text-fg-2 hover:bg-surface-2 hover:text-fg",
  outline: "border border-line-strong bg-surface text-fg hover:bg-surface-2",
  danger: "text-critical hover:bg-critical-soft",
};
const SIZE = {
  // на телефоне зона нажатия маленькой кнопки — 44 px по высоте (невидимое расширение), вид не меняется
  sm: "h-8 gap-1.5 px-3 text-sm pointer-coarse:relative pointer-coarse:h-9 pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1",
  md: "h-9 gap-2 px-3.5 text-ui pointer-coarse:h-11 pointer-coarse:px-4 pointer-coarse:text-base",
  lg: "h-11 gap-2 px-4 text-base",
};

/** Классы кнопки — для ссылок, которые выглядят как кнопка (позвонить, открыть страницу). */
export const buttonClass = (variant: Variant = "secondary", size: keyof typeof SIZE = "md", className?: string) =>
  cn(
    "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-[0.625rem] font-medium transition-[background-color,filter,color] duration-100 disabled:opacity-45",
    VARIANT[variant],
    SIZE[size],
    className,
  );

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZE; icon?: LucideIcon; busy?: boolean };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", icon: Icon, busy, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} type="button" disabled={disabled || busy} aria-busy={busy || undefined} className={buttonClass(variant, size, className)} {...rest}>
      {busy ? <Spinner className="size-4 text-current" /> : Icon ? <Icon aria-hidden className="size-4 shrink-0" strokeWidth={2} /> : null}
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
        "relative inline-grid size-9 shrink-0 place-items-center rounded-[0.625rem] text-fg-2 transition-colors duration-100 hover:bg-surface-2 hover:text-fg disabled:opacity-40 pointer-coarse:size-11",
        active && "bg-selected text-selected-fg hover:bg-selected hover:text-selected-fg",
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden className="size-5" strokeWidth={1.75} />
    </button>
  );
});

const AV = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-11 text-[0.9375rem]", xl: "size-16 text-xl" };
/** Нейтральный кружок: инициалы, если есть имя, иначе значок человека (цифры номера ничего не сообщают). Без случайных цветов. */
export function Avatar({ name, size = "md", className }: { name?: string; phone?: string; size?: keyof typeof AV; className?: string }) {
  const text = name ? initials(name) : "";
  return (
    <span aria-hidden className={cn("grid shrink-0 select-none place-items-center rounded-full bg-surface-3 font-medium tracking-[0.01em] text-fg-2", AV[size], className)}>
      {text || <UserRound className="size-[46%] text-fg-3" strokeWidth={1.75} />}
    </span>
  );
}

export function CountBadge({ n, className, tone = "accent" }: { n: number; className?: string; tone?: "accent" | "critical" | "muted" }) {
  if (!n) return null;
  return (
    <span
      className={cn(
        "tnum inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-xs font-semibold",
        tone === "accent" && "bg-accent text-accent-fg",
        tone === "critical" && "bg-critical text-white dark:text-[#1b0d0b]",
        tone === "muted" && "bg-surface-3 text-fg-2",
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
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      {Icon && <Icon aria-hidden className="mb-3 size-7 text-fg-3" strokeWidth={1.5} />}
      <p className="text-base font-semibold text-fg">{title}</p>
      {text && <p className="mt-1 max-w-[32ch] text-ui text-fg-2">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Полоса-сообщение во всю ширину панели: нет связи, ошибка загрузки. */
export function Banner({ tone = "neutral", icon: Icon, children, action, className }: { tone?: "neutral" | "critical" | "accent"; icon?: LucideIcon; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div
      role={tone === "critical" ? "alert" : "status"}
      className={cn(
        "flex items-center gap-2.5 px-4 py-2 text-sm",
        tone === "critical" && "bg-critical-soft text-critical",
        tone === "accent" && "bg-selected text-selected-fg",
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
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-[0.625rem] bg-surface-2 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-ui font-medium text-fg-2 transition-colors pointer-coarse:h-10",
            value === o.id ? "bg-surface text-fg shadow-[0_1px_2px_rgb(16_24_40/0.1)] dark:bg-surface-3" : "hover:text-fg",
          )}
        >
          {o.icon && <o.icon aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />}
          <span className="truncate">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Строка «подпись — значение» в сгруппированных списках (настройки). stacked — подпись над значением, как в карточке
 *  контакта iPhone: длинное значение («ИИ-администратор, +7 700 000 12 34») не ломается по правому краю. */
export function Field({ label, children, className, stacked }: { label: string; children: ReactNode; className?: string; stacked?: boolean }) {
  if (stacked)
    return (
      <div className={cn("min-w-0 py-2.5", className)}>
        <dt className="text-sm text-fg-3">{label}</dt>
        <dd className="mt-0.5 min-w-0 text-base text-fg pointer-coarse:text-md">{children}</dd>
      </div>
    );
  return (
    <div className={cn("flex min-h-11 min-w-0 items-baseline justify-between gap-4 py-2.5", className)}>
      <dt className="shrink-0 text-ui text-fg-2 pointer-coarse:text-base">{label}</dt>
      <dd className="min-w-0 text-right text-ui text-fg pointer-coarse:text-base">{children}</dd>
    </div>
  );
}

/** Сгруппированный список на полотне — как настройки iPhone: подпись группы, белая группа, разделители с отступом. */
export function InsetGroup({ title, note, children, className }: { title?: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mb-6", className)}>
      {title && <h3 className="mb-1.5 px-4 text-sm font-medium text-fg-3">{title}</h3>}
      <div className="overflow-hidden rounded-[0.875rem] bg-surface px-4 [&>*+*]:border-t [&>*+*]:border-line">{children}</div>
      {note && <p className="mt-1.5 px-4 text-sm text-fg-3">{note}</p>}
    </section>
  );
}
