// Общие мелочи экранов пульта: заголовок страницы, белая карточка, аватар, значок канала, вкладки, переключатель.
// Вид — по образцам D5 (чаты) и D15 (цвета, записи) с Dribbble.
import { Globe, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Крупный заголовок страницы на сером полотне (как «Dashboard» в D15) и кнопки справа. */
export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 pb-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

/** Белая скруглённая карточка на сером полотне. */
export function Card({ title, icon, action, className, children }: { title?: string; icon?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("rounded-2xl bg-card", className)}>
      {title && (
        <header className="flex items-center gap-2 px-5 pb-2 pt-4">
          {icon && <span className="text-foreground">{icon}</span>}
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {action && <div className="ml-auto">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Серая «таблетка» со счётчиком (как «32», «1 284» в меню D15). */
export function CountPill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "dark" | "red" | "blue" }) {
  return (
    <span
      className={cn(
        "inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "dark" && "bg-foreground text-background",
        tone === "red" && "bg-rose-500 text-white",
        tone === "blue" && "bg-primary text-primary-foreground",
      )}
    >
      {children}
    </span>
  );
}

const AVATAR_TONES = ["bg-teal-600", "bg-violet-500", "bg-rose-500", "bg-orange-500", "bg-sky-600", "bg-emerald-600", "bg-fuchsia-600", "bg-amber-600", "bg-indigo-500"];

/** Цветной кружок с инициалами (как в D5). Цвет постоянный для одного и того же ключа. */
export function Avatar({ label, seed, urgent, size = "size-10", className }: { label: string; seed: string; urgent?: boolean; size?: string; className?: string }) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={cn("relative grid shrink-0 place-items-center rounded-full text-sm font-semibold text-white", AVATAR_TONES[h % AVATAR_TONES.length], size, className)}>
      {label}
      {urgent && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-card bg-rose-500" />}
    </span>
  );
}

export function ChannelIcon({ channel, className }: { channel: "WhatsApp" | "Сайт"; className?: string }) {
  return channel === "Сайт" ? (
    <Globe aria-label="Сайт" className={cn("shrink-0 text-sky-600", className)} strokeWidth={2.25} />
  ) : (
    <MessageCircle aria-label="WhatsApp" className={cn("shrink-0 text-emerald-600", className)} strokeWidth={2.25} />
  );
}

/** Вкладки во всю ширину с подчёркиванием и тёмным счётчиком (как «Active 24 / Archive 12» в D5). */
export function LineTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: { id: T; name: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <nav className={cn("flex shrink-0 border-b", className)} aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          aria-current={value === t.id ? "page" : undefined}
          className={cn(
            "-mb-px flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-sm transition-colors",
            value === t.id ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.name}
          {t.count !== undefined && <CountPill tone={value === t.id ? "dark" : "muted"}>{t.count}</CountPill>}
        </button>
      ))}
    </nav>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "bg-primary" : "bg-input",
      )}
    >
      <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[left]", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

export const money = (n: number) => n.toLocaleString("ru-RU").replace(/ /g, " ") + " ₸";
