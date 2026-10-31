// Каркас: на планшете и компьютере — узкая полоса разделов слева, на телефоне — вкладки снизу (прячутся внутри переписки,
// как в мессенджерах). Разделов немного: ежедневная работа — чаты и заявки; база клиентов — «Клиенты»; редкое — в настройках.
import { logoutWith } from "@/lib/push";
import { ClipboardList, Contact, Laptop, LogOut, UserRound, Megaphone, MessagesSquare, Moon, Settings, Sun, WifiOff, type LucideIcon } from "lucide-react";
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
    { id: "clients", label: "Клиенты", icon: Contact },
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
  // открытая карточка клиента на телефоне — экран во весь размер, как переписка: вкладки снизу прячем
  const inClient = route.name === "clients" && !!route.id;

  return (
    <div ref={setRoot} className="app-root flex bg-surface text-fg">
      <nav aria-label="Разделы" className="hidden w-[calc(4.5rem+var(--safe-l))] shrink-0 flex-col items-center border-r border-line bg-canvas pb-[max(0.75rem,var(--safe-b))] pt-[max(0.875rem,var(--safe-t))] pl-safe md:flex">
        <ul className="flex flex-col gap-2">
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

      {/* iPhone горизонтально: вырез экрана бывает и справа — содержимое не заходит под него */}
      <main className="relative flex min-w-0 flex-1 flex-col md:pr-safe">{children}</main>

      {!inConversation && !deepSettings && !inClient && (
        <nav aria-label="Разделы" className="hide-kb pb-safe absolute inset-x-0 bottom-0 z-30 border-t border-line bg-surface md:hidden">
          <ul className="flex">
            {items.map((it) => (
              <li key={it.id} className="flex-1">
                <a
                  href={href({ name: it.id } as Route)}
                  onClick={(e) => (e.preventDefault(), go(it.id))}
                  aria-current={route.name === it.id ? "page" : undefined}
                  className={cn("relative flex h-[3.125rem] flex-col items-center justify-center gap-[3px] text-[0.6875rem] font-medium leading-none", route.name === it.id ? "text-accent" : "text-fg-3")}
                >
                  <it.icon aria-hidden className="size-6" strokeWidth={route.name === it.id ? 2 : 1.6} />
                  {it.label}
                  {!!it.badge && <CountBadge n={it.badge} tone="critical" className="absolute left-[calc(50%+0.25rem)] top-1 ring-2 ring-surface" />}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {offline && (
        <div role="status" className="pointer-events-none fixed left-1/2 top-[calc(var(--safe-t)+0.5rem)] z-50 inline-flex -translate-x-1/2 animate-pop-in items-center gap-2 rounded-full bg-fg px-3.5 py-1.5 text-sm text-surface shadow-pop">
          <WifiOff aria-hidden className="size-4" strokeWidth={2} />
          Нет связи. Показаны последние данные
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
      className={cn("group flex w-16 flex-col items-center gap-1 text-[0.6875rem] font-medium leading-none", active ? "text-fg" : "text-fg-3 hover:text-fg-2")}
    >
      <span className={cn("relative grid h-8 w-11 place-items-center rounded-[0.625rem] transition-colors", active ? "bg-selected text-accent" : "group-hover:bg-surface-3")}>
        <it.icon aria-hidden className="size-5" strokeWidth={active ? 2 : 1.75} />
        {!!it.badge && <CountBadge n={it.badge} tone="critical" className="absolute -right-1.5 -top-1.5 ring-2 ring-canvas" />}
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
        <button ref={trigger} type="button" aria-label={`${role}: тема и выход`} title={role} className="grid size-9 place-items-center rounded-full bg-surface-3 text-fg-3 hover:text-fg pointer-coarse:size-11">
          <UserRound aria-hidden className="size-[1.125rem]" strokeWidth={1.75} />
        </button>
      </MenuTrigger>
      <MenuContent side="right" align="end" className="w-60">
        <MenuLabel>{role}</MenuLabel>
        <MenuSeparator />
        <MenuLabel>Тема</MenuLabel>
        <MenuRadioGroup value={pref} onValueChange={(v) => setTheme(v as ThemePref)}>
          {THEMES.map((t) => (
            <MenuRadioItem key={t.id} value={t.id}>
              <t.icon aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
              {t.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem onSelect={() => go("settings")}>
          <Settings aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
          Настройки
        </MenuItem>
        {logout && (
          <MenuItem onSelect={() => void logoutWith(logout, wsId)}>
            <LogOut aria-hidden className="size-4 text-fg-3" strokeWidth={1.75} />
            Выйти
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}
