// Выбор области: все чаты, филиал или один номер. Иерархия «филиал → номера» видна прямо в списке выбора.
// На телефоне — лист снизу (крупные строки под палец), на компьютере — выпадающее меню.
import { Check, ChevronDown, Globe, MessageCircle } from "lucide-react";
import { useState } from "react";
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger, Sheet } from "@/components/overlay";
import { channelTitle, KIND_SHORT, scopeTitle, type Scope } from "@/model/channels";
import type { Channel, ConversationSummary, Workspace } from "@/model/types";
import { formatPhone } from "@/lib/format";
import { cn, useMedia } from "@/lib/utils";

type Opt = { value: string; scope: Scope; title: string; sub?: string; waiting: number; indent?: boolean; icon?: "web" | "wa" };
const enc = (s: Scope) => (s.kind === "all" ? "all" : `${s.kind}:${s.id}`);

function options(ws: Workspace, list: ConversationSummary[]): { group?: string; items: Opt[] }[] {
  const waitingOn = (ids: string[]) => list.filter((c) => c.attention && ids.includes(c.ref.channelId)).length;
  const chOpt = (c: Channel, indent = false): Opt => ({
    value: `channel:${c.id}`,
    scope: { kind: "channel", id: c.id },
    title: channelTitle(c),
    sub: c.kind === "web" ? undefined : [c.name && c.phone ? formatPhone(c.phone) : "", KIND_SHORT[c.kind]].filter(Boolean).join(", "),
    waiting: waitingOn([c.id]),
    indent,
    icon: c.kind === "web" ? "web" : "wa",
  });
  const all: Opt = { value: "all", scope: { kind: "all" }, title: ws.branches.length > 1 ? "Все филиалы" : "Все номера", waiting: list.filter((c) => c.attention).length };
  if (ws.branches.length > 1) {
    const groups: { group?: string; items: Opt[] }[] = [{ items: [all] }];
    for (const b of ws.branches) {
      const chs = ws.channels.filter((c) => c.branchId === b.id);
      groups.push({ group: b.name, items: [{ value: `branch:${b.id}`, scope: { kind: "branch", id: b.id }, title: `Весь филиал`, sub: b.address, waiting: waitingOn(chs.map((c) => c.id)) }, ...chs.map((c) => chOpt(c, true))] });
    }
    const common = ws.channels.filter((c) => !c.branchId);
    if (common.length) groups.push({ group: "Общие", items: common.map((c) => chOpt(c)) });
    return groups;
  }
  return [{ items: [all] }, { items: ws.channels.map((c) => chOpt(c)) }];
}

export function ScopePicker({ ws, list, scope, onChange }: { ws: Workspace; list: ConversationSummary[]; scope: Scope; onChange: (s: Scope) => void }) {
  const wide = useMedia("(min-width: 768px)");
  const [open, setOpen] = useState(false);
  const groups = options(ws, list);
  const flat = groups.flatMap((g) => g.items);
  const cur = enc(scope);
  const pick = (v: string) => {
    const o = flat.find((x) => x.value === v);
    if (o) onChange(o.scope);
    setOpen(false);
  };
  const trigger = (
    <button
      type="button"
      onClick={wide ? undefined : () => setOpen(true)}
      className="relative -ml-1 inline-flex h-6 max-w-full items-center gap-1 rounded-md px-1 text-sm text-fg-2 after:absolute after:-inset-x-1 after:-inset-y-2.5 hover:bg-surface-2 hover:text-fg"
    >
      <span className="truncate">{scopeTitle(ws, scope)}</span>
      <ChevronDown aria-hidden className="size-3.5 shrink-0 text-fg-3" strokeWidth={2.2} />
    </button>
  );

  if (wide)
    return (
      <Menu>
        <MenuTrigger asChild>{trigger}</MenuTrigger>
        <MenuContent className="w-[19rem]">
          <MenuRadioGroup value={cur} onValueChange={pick}>
            {groups.map((g, i) => (
              <div key={i}>
                {i > 0 && <MenuSeparator />}
                {g.group && <MenuLabel>{g.group}</MenuLabel>}
                {g.items.map((o) => (
                  <MenuRadioItem key={o.value} value={o.value} className={cn(o.indent && "pl-4")}>
                    <OptBody o={o} />
                  </MenuRadioItem>
                ))}
              </div>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
    );

  return (
    <>
      {trigger}
      <Sheet open={open} onOpenChange={setOpen} title="Какие чаты показать" description={ws.branches.length > 1 ? "Филиал или отдельный номер" : "Все номера или один"}>
        <div className="pb-2">
          {groups.map((g, i) => (
            <div key={i} className={cn(i > 0 && "mt-2 border-t border-line pt-2")}>
              {g.group && <p className="px-4 pb-1 pt-1 text-sm font-medium text-fg-3">{g.group}</p>}
              {g.items.map((o) => (
                <button key={o.value} type="button" aria-pressed={o.value === cur} onClick={() => pick(o.value)} className={cn("flex min-h-14 w-full items-center gap-3 px-4 text-left active:bg-surface-2", o.indent && "pl-7")}>
                  <OptBody o={o} />
                  <Check aria-hidden className={cn("size-5 shrink-0 text-accent-ink", o.value !== cur && "invisible")} strokeWidth={2.2} />
                </button>
              ))}
            </div>
          ))}
        </div>
      </Sheet>
    </>
  );
}

function OptBody({ o }: { o: Opt }) {
  const Icon = o.icon === "web" ? Globe : o.icon === "wa" ? MessageCircle : null;
  return (
    <>
      {Icon && <Icon aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={1.9} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base">{o.title}</span>
        {o.sub && <span className="block truncate text-xs text-fg-3">{o.sub}</span>}
      </span>
      {o.waiting > 0 && (
        <span className="tnum shrink-0 text-sm font-medium text-critical" aria-label={`ждут ответа: ${o.waiting}`}>
          {o.waiting}
        </span>
      )}
    </>
  );
}
