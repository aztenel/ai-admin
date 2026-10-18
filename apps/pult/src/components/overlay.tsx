// Всплывающее: меню, листы (снизу на телефоне, по центру или справа на компьютере), подтверждение, короткие уведомления.
// Доступность (фокус внутри, Esc, чтение экранными дикторами) — из Radix; вид — свой, на токенах из index.css.
import { X } from "lucide-react";
import { DropdownMenu as DM, Dialog as D } from "radix-ui";
import { useSyncExternalStore, type ReactNode } from "react";
import { cn, useMedia } from "@/lib/utils";
import { Button, IconButton } from "./ui";

// ---------- меню ----------
export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;
export function MenuContent({ children, align = "start", className, ...rest }: DM.DropdownMenuContentProps) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          "z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[14rem] max-w-[min(22rem,calc(100vw-24px))] overflow-y-auto rounded-xl border border-line bg-surface p-1 text-fg shadow-pop outline-none data-[state=open]:animate-pop-in",
          className,
        )}
        {...rest}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}
const itemCls =
  "relative flex min-h-9 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-base outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-surface-2 pointer-coarse:min-h-11";
export function MenuItem({ className, danger, ...rest }: DM.DropdownMenuItemProps & { danger?: boolean }) {
  return <DM.Item className={cn(itemCls, danger && "text-critical", className)} {...rest} />;
}
export function MenuRadioItem({ className, children, ...rest }: DM.DropdownMenuRadioItemProps) {
  return (
    <DM.RadioItem className={cn(itemCls, "pr-8 data-[state=checked]:font-medium", className)} {...rest}>
      {children}
      <DM.ItemIndicator className="absolute right-2.5 top-1/2 -translate-y-1/2">
        <span className="block size-2 rounded-full bg-accent" />
      </DM.ItemIndicator>
    </DM.RadioItem>
  );
}
export const MenuRadioGroup = DM.RadioGroup;
export function MenuLabel({ className, ...rest }: DM.DropdownMenuLabelProps) {
  return <DM.Label className={cn("px-2.5 pb-1 pt-2 text-xs font-medium text-fg-3", className)} {...rest} />;
}
export function MenuSeparator() {
  return <DM.Separator className="-mx-1 my-1 h-px bg-line" />;
}

// ---------- листы ----------
type SheetProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  /** Подпись под заголовком; для читалок — описание окна. */
  description?: ReactNode;
  /** auto — снизу на телефоне, по центру на компьютере; right — панель справа. */
  side?: "auto" | "right";
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};
export function Sheet({ open, onOpenChange, title, description, side = "auto", children, footer, className }: SheetProps) {
  const wide = useMedia("(min-width: 768px)");
  const kind = side === "right" ? "right" : wide ? "center" : "bottom";
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-scrim data-[state=open]:animate-fade-in" />
        <D.Content
          className={cn(
            "fixed z-50 flex flex-col bg-surface text-fg shadow-pop outline-none",
            kind === "bottom" && "inset-x-0 bottom-0 max-h-[min(88dvh,44rem)] rounded-t-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))] data-[state=open]:animate-sheet-in",
            kind === "center" && "left-1/2 top-1/2 max-h-[min(80dvh,40rem)] w-[min(28rem,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl pb-3 data-[state=open]:animate-pop-in",
            kind === "right" && "inset-y-0 right-0 w-[min(25rem,100vw)] border-l border-line pb-safe pt-safe data-[state=open]:animate-drawer-in",
            className,
          )}
        >
          {kind === "bottom" && <span aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong" />}
          <header className={cn("flex shrink-0 items-start gap-3 px-4 pb-2", kind === "bottom" ? "pt-2" : "pt-4")}>
            <div className="min-w-0 flex-1 pt-1.5">
              <D.Title className="text-lg font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-sm text-fg-2">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close asChild>
              <IconButton icon={X} label="Закрыть" className="-mr-1.5" />
            </D.Close>
          </header>
          <div className="scroll-area min-h-0 flex-1">{children}</div>
          {footer && <div className="shrink-0 px-4 pt-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Подтверждение необратимого действия — своё окно, одинаковое в браузере, на телефоне и в программе для Windows. */
export function Confirm({ open, onOpenChange, title, text, yes, danger, onYes }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; text: ReactNode; yes: string; danger?: boolean; onYes: () => void }) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={text}
      footer={
        <div className="flex gap-2 pb-1">
          <Button className="flex-1" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            variant={danger ? "secondary" : "primary"}
            className={cn("flex-1", danger && "text-critical")}
            onClick={() => {
              onOpenChange(false);
              onYes();
            }}
          >
            {yes}
          </Button>
        </div>
      }
    >
      {null}
    </Sheet>
  );
}

// ---------- короткие уведомления ----------
type Toast = { id: number; text: string; tone: "neutral" | "critical" };
let toasts: Toast[] = [];
const subs = new Set<() => void>();
export function toast(text: string, tone: Toast["tone"] = "neutral") {
  const t = { id: Date.now() + Math.random(), text, tone };
  toasts = [...toasts.slice(-2), t];
  subs.forEach((f) => f());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    subs.forEach((f) => f());
  }, tone === "critical" ? 6000 : 3200);
}
export function Toasts() {
  const list = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => toasts,
  );
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === "critical" ? "alert" : "status"}
          className={cn(
            "max-w-md animate-pop-in rounded-xl px-4 py-2.5 text-sm shadow-pop",
            t.tone === "critical" ? "bg-critical text-white dark:text-black" : "bg-fg text-surface",
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
