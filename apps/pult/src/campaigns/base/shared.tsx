// Общее для базы клиентов и автосценария (ClientBase.tsx, AutoScenario.tsx): время по Астане, числа в ряд, строка-предупреждение,
// переключатель, слой во весь экран (телефон) или панель справа (компьютер) и «назад», который закрывает слой.
// Время — по Астане (Asia/Almaty), как у сервера: база собирается в 04:00, автосценарий пишет в 11:00 по Астане, а пульт могут
// открыть с компьютера в другом часовом поясе.
import { ChevronLeft, CircleAlert, TriangleAlert, X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/utils";

export const TZ = "Asia/Almaty";
/** Событие «базу клиентов обновили» (detail — id компании): автосценарий перечитывает свежесть базы. */
export const CRM_REFRESHED = "pult:crm-refreshed";
/** Событие «рассылка по базе закончила отправку» (detail — id компании): числа сегментов и «кому сегодня» устарели — тем, кому
 *  ушёл шаблон, 14 дней не пишем. Без него плитка «Пора на стрижку» показывала бы прежнее число до «Обновить» (находка 19.10.2026). */
export const CRM_STALE = "pult:crm-stale";
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Части времени по Астане: «2026-10-19», часы и минуты. */
function parts(t: number) {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(t)) p[x.type] = x.value;
  return { day: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, y: +p.year, m: +p.month, d: +p.day };
}

/** День по Астане ГГГГ-ММ-ДД. */
export const astanaDay = (t: number) => parts(t).day;

/** Когда по Астане: { day: «сегодня» | «вчера» | «18 октября», time: «04:00» }. */
export function when(t: number, now: number): { day: string; time: string } {
  const a = parts(t);
  const day =
    a.day === parts(now).day ? "сегодня" : a.day === parts(now - 864e5).day ? "вчера" : `${a.d} ${MON[a.m - 1]}${a.y !== parts(now).y ? ` ${a.y}` : ""}`;
  return { day, time: a.hm };
}
/** «сегодня в 04:00», «18 октября в 11:00». */
export function whenText(t: number, now: number): string {
  const w = when(t, now);
  return `${w.day} в ${w.time}`;
}

/** День визита ГГГГ-ММ-ДД (как его отдаёт сервер) → «12 октября»; другой год — с годом. */
export function visitDay(iso: string, now: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso || "";
  return `${+m[3]} ${MON[+m[2] - 1]}${+m[1] !== parts(now).y ? ` ${m[1]}` : ""}`;
}

export const nf = new Intl.NumberFormat("ru-RU");

/** Правило сегмента одной формой: сервер пишет «последний визит 21–35 дней назад», но «36–60 дней» — приводим ко второму виду первого. */
export function segRule(seg: { id: string; rule: string }): string {
  const r = (seg.rule || "").trim();
  if (!r) return seg.id === "all" ? "все, кому можно писать" : "";
  return /^\d+–\d+ дн/.test(r) ? `последний визит ${r} назад` : r;
}

/** Числа в ряд (как в обзоре номера): подпись, крупное число, пояснение. */
export function Stats({ items }: { items: { label: string; value: ReactNode; sub?: string }[] }) {
  return (
    <dl className={cn("grid divide-x divide-line", items.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {items.map((s) => (
        <div key={s.label} className="min-w-0 px-3 py-3 first:pl-0 last:pr-0">
          <dt className="truncate text-xs text-fg-3">{s.label}</dt>
          <dd className="mt-0.5 min-w-0">
            <span className="tnum block truncate text-lg font-semibold leading-6">{s.value}</span>
            {s.sub && <span className="block truncate text-xs text-fg-3">{s.sub}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Строка-пояснение внутри группы: предупреждение (треугольник) или ошибка (красным). */
export function Notice({ tone = "warn", children, role }: { tone?: "warn" | "critical" | "muted"; children: ReactNode; role?: "alert" | "status" }) {
  const Icon = tone === "critical" ? CircleAlert : TriangleAlert;
  return (
    <p
      role={role}
      className={cn("flex gap-2 py-3 text-ui pointer-coarse:text-base", tone === "critical" ? "text-critical" : tone === "muted" ? "text-fg-2" : "text-fg")}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone === "muted" && "text-fg-3")} strokeWidth={2} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Переключатель «вкл/выкл», как в настройках iPhone: применяется сразу. Зона нажатия на телефоне — 44 px. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  busy,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[1.9375rem] w-[3.1875rem] shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 disabled:opacity-50",
        "after:absolute after:-inset-x-1 after:-inset-y-1.5 pointer-coarse:after:-inset-y-2",
        checked ? "bg-positive" : "bg-surface-3 dark:bg-line-strong",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-[1.6875rem] rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.18)] transition-transform duration-200",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

/**
 * Слой поверх раздела: на телефоне — экран во весь размер (выезжает справа, «назад» — синяя стрелка), на компьютере — панель справа.
 * Внутри корня пульта, а не в <body>: его высоту и сдвиг при открытой клавиатуре iPhone задаёт lib/viewport.ts — поля слоя
 * не уходят под клавиатуру. children сами решают, что прокручивается (обычно — прокрутка и закреплённый низ).
 */
export function Layer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const root = document.querySelector<HTMLElement>(".app-root");
  return (
    <D.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <D.Portal container={root ?? undefined}>
        <D.Overlay className="absolute inset-0 z-40 bg-scrim data-[state=open]:animate-fade-in max-md:hidden" />
        <D.Content
          aria-describedby={undefined}
          className={cn(
            "absolute z-50 flex flex-col bg-canvas text-fg outline-none",
            "max-md:inset-0 max-md:data-[state=open]:animate-push-in",
            "md:inset-y-0 md:right-0 md:w-[min(32rem,100%)] md:border-l md:border-line md:shadow-pop md:data-[state=open]:animate-drawer-in",
          )}
        >
          <header className="shrink-0 pt-safe md:border-b md:border-line md:bg-surface md:pt-0">
            <div className="relative flex h-[3.25rem] items-center gap-2 px-0.5 md:h-14 md:pl-6 md:pr-3">
              <IconButton
                icon={ChevronLeft}
                label="Назад"
                onClick={onClose}
                className="text-accent hover:text-accent md:hidden [&>svg]:size-7 [&>svg]:stroke-[2]"
              />
              <D.Title className="pointer-events-none absolute inset-x-14 truncate text-center text-[1.0625rem] font-semibold md:pointer-events-auto md:static md:flex-1 md:text-left md:text-lg">
                {title}
              </D.Title>
              <IconButton icon={X} label="Закрыть" onClick={onClose} className="max-md:hidden" />
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/**
 * Открытый слой — своя запись истории (как листы хаба): жест «назад» на iPhone и кнопка «Назад» в Android закрывают слой, а не уводят
 * из раздела. Адрес не меняется — роутер экран не переключает. Возвращает leave(after?): закрыть слой через историю и, когда она
 * вернулась на место, выполнить after. Так хаб может сразу открыть мастер со своей записью истории: если бы наш history.back()
 * пришёл после его pushState, он закрыл бы мастер.
 * Хук держать в компоненте, который смонтирован и при закрытом слое: при монтировании React в разработке повторяет эффекты.
 */
export function useBackLayer(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  const cur = useRef<{ mine: boolean; after?: () => void } | null>(null);
  useEffect(() => {
    if (!open) return;
    const st = history.state && typeof history.state === "object" ? history.state : {};
    const depth = typeof st.pultDepth === "number" ? st.pultDepth : 0;
    history.pushState({ ...st, pultDepth: depth + 1, pultLayer: 1 }, "", location.href);
    const me: { mine: boolean; after?: () => void } = { mine: true };
    cur.current = me;
    const onPop = () => {
      me.mine = false;
      window.removeEventListener("popstate", onPop);
      closeRef.current();
      const after = me.after;
      me.after = undefined;
      after?.();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (cur.current === me) cur.current = null;
      // закрыли не жестом — убрать свою запись, если она ещё сверху
      if (me.mine && history.state?.pultLayer) history.back();
    };
  }, [open]);
  return useCallback((after?: () => void) => {
    const me = cur.current;
    if (me?.mine && history.state?.pultLayer) {
      me.after = after;
      history.back();
    } else {
      closeRef.current();
      after?.();
    }
  }, []);
}
