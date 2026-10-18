// Каркас: на планшете и компьютере — узкая полоса разделов слева, на телефоне — вкладки снизу (прячутся внутри переписки,
// как в мессенджерах). Разделов немного: ежедневная работа — чаты и заявки; редкое — в настройках.
import { ClipboardList, Laptop, LogOut, UserRound, Megaphone, MessagesSquare, Moon, Settings, Sun, WifiOff, type LucideIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/overlay";
import { CountBadge } from "@/components/ui";
import { href, navigate, type Route } from "@/lib/router";
import { useTheme, type ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useVisualViewport } from "@/lib/viewport";
import { store, useStore } from "@/state/store";

type Item = { id: Route["name"]; label: string; icon: LucideIcon; badge?: number };

export const THEMES: { id: ThemePref; label: string; icon: LucideIcon }[] = [
  { id: "auto", label: "Как в системе", icon: Laptop },
  { id: "light", label: "Светлая", icon: Sun },
  { id: "dark", label: "Тёмная", icon: Moon },
];

function useItems(): Item[] {
  const all = useStore((s) => s.conversations);
  const ws = useStore((s) => s.workspace);
  const waiting = all.filter((c) => c.attention).length;
  return [
    { id: "inbox", label: "Чаты", icon: MessagesSquare, badge: waiting },
    { id: "requests", label: "Заявки", icon: ClipboardList },
    ...(ws?.capabilities.campaigns !== false ? [{ id: "campaigns" as const, label: "Рассылки", icon: Megaphone }] : []),
    { id: "settings", label: "Настройки", icon: Settings },
  ];
}

const go = (id: Route["name"]) => navigate({ name: id } as Route, { replace: true });

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useVisualViewport(root);
  const items = useItems();
  const offline = useStore((s) => s.offline);
  const inConversation = route.name === "inbox" && !!route.conv;
  const deepSettings = route.name === "settings" && !!route.section;

  return (
    <div ref={setRoot} className="app-root flex bg-surface text-fg">
      <nav aria-label="Разделы" className="hidden w-[4.75rem] shrink-0 flex-col items-center border-r border-line bg-canvas pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] pl-safe md:flex">
        <ul className="flex flex-col gap-1">
          {items.map((it) => (
            <li key={it.id}>
              <RailLink it={it} active={route.name === it.id} />
            </li>
          ))}
        </ul>
        <div className="mt-auto">
          <AccountMenu />
        </div>
      </nav>

      <main className="relative flex min-w-0 flex-1 flex-col">{children}</main>

      {!inConversation && !deepSettings && (
        <nav aria-label="Разделы" className="pb-safe absolute inset-x-0 bottom-0 z-30 border-t border-line bg-surface md:hidden">
          <ul className="flex">
            {items.map((it) => (
              <li key={it.id} className="flex-1">
                <a
                  href={href({ name: it.id } as Route)}
                  onClick={(e) => (e.preventDefault(), go(it.id))}
                  aria-current={route.name === it.id ? "page" : undefined}
                  className={cn("relative flex h-[3.25rem] flex-col items-center justify-center gap-0.5 text-xs font-medium", route.name === it.id ? "text-fg" : "text-fg-3")}
                >
                  <it.icon aria-hidden className={cn("size-6", route.name === it.id && "text-accent-ink")} strokeWidth={route.name === it.id ? 2.1 : 1.8} />
                  {it.label}
                  {!!it.badge && <CountBadge n={it.badge} className="absolute left-[calc(50%+0.375rem)] top-1" />}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {offline && (
        <div role="status" className="pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top)+0.5rem)] z-50 inline-flex -translate-x-1/2 animate-pop-in items-center gap-2 rounded-full bg-fg px-3.5 py-1.5 text-sm text-surface shadow-pop">
          <WifiOff aria-hidden className="size-4" strokeWidth={2} />
          Нет связи — показаны последние данные
        </div>
      )}
    </div>
  );
}

function RailLink({ it, active }: { it: Item; active: boolean }) {
  return (
    <a
      href={href({ name: it.id } as Route)}
      onClick={(e) => (e.preventDefault(), go(it.id))}
      aria-current={active ? "page" : undefined}
      className={cn("group flex w-16 flex-col items-center gap-1 rounded-lg py-1.5 text-xs font-medium", active ? "text-fg" : "text-fg-2 hover:text-fg")}
    >
      <span className={cn("relative grid h-8 w-12 place-items-center rounded-full transition-colors", active ? "bg-accent-soft text-accent-ink" : "group-hover:bg-surface-3")}>
        <it.icon aria-hidden className="size-5" strokeWidth={active ? 2.1 : 1.8} />
        {!!it.badge && <CountBadge n={it.badge} className="absolute -right-1 -top-1 ring-2 ring-canvas" />}
      </span>
      {it.label}
    </a>
  );
}

/** Кто вошёл, тема и выход — в одном меню внизу полосы разделов. */
function AccountMenu() {
  const session = useStore((s) => s.session);
  const mode = useStore((s) => s.mode);
  const wsId = useStore((s) => s.wsId);
  const { pref, setTheme } = useTheme();
  const role = session?.role === "owner" ? "Владелец сервиса" : "Сотрудник компании";
  const logout = mode === "live" && wsId ? store.source?.externalUrl("logout", wsId) : null;
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Menu>
      <MenuTrigger asChild>
        <button ref={trigger} type="button" aria-label={`${role}: тема и выход`} title={role} className="grid size-10 place-items-center rounded-full bg-surface-3 text-fg-2 hover:text-fg">
          <UserRound aria-hidden className="size-5" strokeWidth={1.9} />
        </button>
      </MenuTrigger>
      <MenuContent side="right" align="end" className="w-60">
        <MenuLabel>{role}</MenuLabel>
        <MenuSeparator />
        <MenuLabel>Тема</MenuLabel>
        <MenuRadioGroup value={pref} onValueChange={(v) => setTheme(v as ThemePref)}>
          {THEMES.map((t) => (
            <MenuRadioItem key={t.id} value={t.id}>
              <t.icon aria-hidden className="size-4 text-fg-3" strokeWidth={1.9} />
              {t.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem onSelect={() => go("settings")}>
          <Settings aria-hidden className="size-4 text-fg-3" strokeWidth={1.9} />
          Настройки
        </MenuItem>
        {logout && (
          <MenuItem onSelect={() => (location.href = logout)}>
            <LogOut aria-hidden className="size-4 text-fg-3" strokeWidth={1.9} />
            Выйти
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}
