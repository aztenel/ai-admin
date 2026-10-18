// Компания, в которой работает пульт, — и под ней область (филиал или номер): иерархия «компания → номер» видна сразу.
// Владелец сервиса переключается между компаниями; сотрудник видит только свою.
// Знак компании — первая буква названия: логотипов сервер пока не хранит.
import { Check, ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger, Sheet } from "@/components/overlay";
import { cn, useMedia } from "@/lib/utils";
import { store, useStore } from "@/state/store";

export function Monogram({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-9 shrink-0 place-items-center rounded-[0.625rem] bg-surface-3 text-ui font-semibold text-fg-2", className)}>
      {(name.trim()[0] || "·").toUpperCase()}
    </span>
  );
}

export function WorkspaceSwitcher({ below, demo, className }: { below?: ReactNode; demo?: boolean; className?: string }) {
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
      <span className="truncate text-xl font-semibold leading-7 tracking-[-0.015em] md:text-lg md:leading-6">{name}</span>
      {can && <ChevronDown aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={2} />}
      {demo && <span className="ml-0.5 shrink-0 rounded-md border border-line-strong px-1.5 text-xs font-medium leading-[1.125rem] text-fg-3">демо</span>}
    </>
  );
  const nameCls = cn("-ml-1 flex max-w-full items-center gap-1.5 rounded-md px-1 text-left text-fg", can && "hover:bg-surface-2");
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
      <div className="min-w-0 flex-1">
        {nameEl}
        {below}
      </div>
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
