// Поля формы мастера рассылки: строка, текст, выбор из списка, число, флажок, строка-переключатель, список ошибок.
// Свой файл, а не ui.tsx: мастер грузится лениво, его поля не должны попадать в первое открытие пульта (бюджет JS, README).
// Поля — 16 px на телефоне (iPhone не увеличивает страницу при фокусе) и не ниже 44 px; подпись над полем, подсказка и ошибка — под ним.
import { Check, ChevronDown, CircleAlert } from "lucide-react";
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const box =
  "w-full min-w-0 rounded-[0.625rem] border border-line-strong bg-surface px-3 text-md text-fg outline-none transition-colors focus:border-accent md:text-base pointer-coarse:text-md dark:bg-surface-2";

type Wrap = { label: string; hint?: ReactNode; error?: string; className?: string; optional?: boolean };

/** Подпись, поле, подсказка и ошибка — одна строка группы (Group). id связывает подпись, подсказку и ошибку с полем. */
function Row({ id, label, hint, error, optional, className, children }: Wrap & { id: string; children: ReactNode }) {
  return (
    <div className={cn("min-w-0 py-3", className)}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-fg-2">
        {label}
        {optional && <span className="font-normal text-fg-3"> · необязательно</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 flex items-start gap-1.5 text-sm text-critical">
          <CircleAlert aria-hidden className="mt-px size-4 shrink-0" strokeWidth={2} />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-fg-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
const described = (id: string, w: Wrap) => [w.error ? `${id}-err` : "", w.hint ? `${id}-hint` : ""].filter(Boolean).join(" ") || undefined;

export const TextField = forwardRef<HTMLInputElement, Wrap & Omit<InputHTMLAttributes<HTMLInputElement>, "className">>(function TextField(
  { label, hint, error, optional, className, id: given, ...rest },
  ref,
) {
  const auto = useId();
  const id = given || auto;
  return (
    <Row id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={described(id, { label, hint, error })}
        className={cn(box, "h-11 md:h-10 pointer-coarse:h-11", error && "border-critical focus:border-critical")}
        {...rest}
      />
    </Row>
  );
});

export function TextArea({ label, hint, error, optional, className, id: given, ...rest }: Wrap & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">) {
  const auto = useId();
  const id = given || auto;
  return (
    <Row id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={described(id, { label, hint, error })}
        className={cn(box, "block resize-y py-2.5 leading-[1.375rem]", error && "border-critical focus:border-critical")}
        {...rest}
      />
    </Row>
  );
}

/** Родной выбор из списка: на iPhone — колесо, на компьютере — меню системы. */
export function SelectField({ label, hint, error, optional, className, id: given, children, ...rest }: Wrap & Omit<SelectHTMLAttributes<HTMLSelectElement>, "className">) {
  const auto = useId();
  const id = given || auto;
  return (
    <Row id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
      <span className="relative block">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={described(id, { label, hint, error })}
          className={cn(box, "h-11 cursor-pointer appearance-none pr-9 md:h-10 pointer-coarse:h-11", error && "border-critical")}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" strokeWidth={2} />
      </span>
    </Row>
  );
}

/** Флажок: настоящий input (клавиатура, читалки) — прозрачный поверх всей строки, вид — свой квадрат с галочкой. */
export function Checkbox({ checked, onChange, children, error, className }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; error?: string; className?: string }) {
  const id = useId();
  return (
    <div className={cn("py-3", className)}>
      <label htmlFor={id} className="relative flex min-h-11 cursor-pointer items-start gap-3">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-invalid={error ? true : undefined} className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none opacity-0" />
        <span
          aria-hidden
          className={cn(
            "mt-0.5 grid size-[1.375rem] shrink-0 place-items-center rounded-md border-2 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
            checked ? "border-accent bg-accent text-accent-fg" : error ? "border-critical" : "border-line-strong bg-surface dark:bg-surface-2",
          )}
        >
          {checked && <Check className="size-4" strokeWidth={3} />}
        </span>
        <span className="text-md text-fg md:text-base pointer-coarse:text-md">{children}</span>
      </label>
      {error && <p className="mt-1 pl-[2.125rem] text-sm text-critical">{error}</p>}
    </div>
  );
}

/** Строка выбора одного из многих (сегменты базы): кружок, название, правило, число справа. Вся строка — зона нажатия. */
export function RadioRow({ name, checked, onSelect, title, sub, aside, disabled }: { name: string; checked: boolean; onSelect: () => void; title: string; sub?: string; aside?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("relative -mx-4 flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60 active:bg-surface-2", disabled && "cursor-default opacity-50 hover:bg-transparent")}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onSelect} className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-default" />
      <span
        aria-hidden
        className={cn(
          "grid size-[1.375rem] shrink-0 place-items-center rounded-full border-2 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
          checked ? "border-accent" : "border-line-strong",
        )}
      >
        {checked && <span className="size-2.5 rounded-full bg-accent" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-md text-fg md:text-base pointer-coarse:text-md">{title}</span>
        {sub && <span className="block truncate text-sm text-fg-3">{sub}</span>}
      </span>
      {aside != null && <span className="tnum shrink-0 text-ui text-fg-2 pointer-coarse:text-base">{aside}</span>}
    </label>
  );
}

/** Ошибки сервера или формы — списком рядом с формой (тексты сервера как есть). */
export function ErrorList({ title, errors, className }: { title?: string; errors: string[]; className?: string }) {
  if (!errors.length) return null;
  return (
    <div role="alert" data-error className={cn("mb-6 rounded-[0.875rem] bg-critical-soft px-4 py-3 text-critical", className)}>
      <p className="flex items-center gap-2 text-ui font-semibold pointer-coarse:text-base">
        <CircleAlert aria-hidden className="size-4 shrink-0" strokeWidth={2} />
        {title || (errors.length > 1 ? "Исправьте, пожалуйста" : "Не получилось")}
      </p>
      <ul className="mt-1.5 list-disc space-y-1 pl-6 text-ui pointer-coarse:text-base">
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </div>
  );
}

/** Пояснение под группой (как в настройках). */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("-mt-4 mb-6 px-4 text-sm text-fg-3", className)}>{children}</p>;
}
