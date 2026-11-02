// Компания, в которой работает пульт, — крупный заголовок экрана чатов (как «Входящие» в Почте iPhone).
// Выбор номера или филиала стоит справа на той же строке (ScopePicker). Владелец сервиса переключается между компаниями;
// сотрудник видит только свою.
// Знак компании — первая буква названия: логотипов сервер пока не хранит.
import { Check, ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger, Sheet } from "@/components/overlay";
import { cn, useMedia } from "@/lib/utils";
import { store, useStore } from "@/state/store";

export function Monogram({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-9 shrink-0 place-items-center rounded-[0.625rem] bg-fg text-ui font-semibold text-surface", className)}>
      {(name.trim()[0] || "·").toUpperCase()}
    </span>
  );
}

export function WorkspaceSwitcher({ className, compact }: { className?: string; compact?: boolean }) {
  const ws = useStore((s) => s.workspace);
  const list = useStore((s) => s.workspaces);
  const wsId = useStore((s) => s.wsId);
  const wide = useMedia("(min-width: 768px)");
  const [open, setOpen] = useState(false);
  const name = ws?.name || list.find((w) => w.id === wsId)?.name || "Компания";
  const can = list.length > 1;
  const pick = (id: string) => {
    setOpen(false);
    if (id !== wsId) store.selectWorkspace(id);
  };

  const label = (
    <>
      <span className={cn("truncate", compact ? "text-ui font-medium text-fg-2" : "text-[1.625rem] font-bold leading-8 tracking-[-0.022em] md:text-xl md:font-semibold md:leading-7 md:tracking-[-0.015em]")}>{name}</span>
      {can && <ChevronDown aria-hidden className={cn("shrink-0 text-fg-3", compact ? "size-4" : "mt-0.5 size-[1.125rem]")} strokeWidth={2.25} />}
    </>
  );
  // компактная строка: без отрицательного отступа — он уменьшает расчётную ширину на 4 px, и название обрезалось («Winches…»)
  const nameCls = cn("relative flex max-w-full items-center gap-1 rounded-lg text-left text-fg after:absolute after:inset-x-0 after:-inset-y-2", compact ? "" : "-ml-1 px-1", can && "hover:bg-surface-2");
  let nameEl: ReactNode = (
    <div className={nameCls} title={name}>
      {label}
    </div>
  );
  if (can && wide)
    nameEl = (
      <Menu>
        <MenuTrigger asChild>
          <button type="button" className={nameCls} aria-label={`Компания: ${name}. Сменить`}>
            {label}
          </button>
        </MenuTrigger>
        <MenuContent className="w-[18rem]">
          <MenuLabel>Компании</MenuLabel>
          <MenuRadioGroup value={wsId || ""} onValueChange={pick}>
            {list.map((w) => (
              <MenuRadioItem key={w.id} value={w.id}>
                <Monogram name={w.name} className="size-7 rounded-md text-xs" />
                <span className="min-w-0">
                  <span className="block truncate">{w.name}</span>
                  {w.kind && <span className="block truncate text-xs text-fg-3">{w.kind}</span>}
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
    );
  else if (can)
    nameEl = (
      <button type="button" className={nameCls} onClick={() => setOpen(true)} aria-label={`Компания: ${name}. Сменить`}>
        {label}
      </button>
    );

  return (
    <div className={cn("flex min-w-0 items-center", className)}>
      {/* в строке под заголовком (compact) без flex-1: иначе ширина считается от нуля и название обрезается («Winches…») */}
      <div className={cn("min-w-0", !compact && "flex-1")}>{nameEl}</div>
      {can && !wide && (
        <Sheet open={open} onOpenChange={setOpen} title="Компании">
          <div className="pb-2">
            {list.map((w) => (
              <button key={w.id} type="button" onClick={() => pick(w.id)} aria-pressed={w.id === wsId} className="flex min-h-14 w-full items-center gap-3 px-4 text-left active:bg-surface-2">
                <Monogram name={w.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base">{w.name}</span>
                  {w.kind && <span className="block truncate text-xs text-fg-3">{w.kind}</span>}
                </span>
                <Check aria-hidden className={cn("size-5 text-accent", w.id !== wsId && "invisible")} strokeWidth={2.25} />
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
