// Проверочный экран нового пульта. Раскладка и цвета — по образцам с Dribbble: D15 (меню, шапка, цвета, «Записи»)
// и D5 (чаты). Компоненты — из 21st.dev (см. README). Данные вымышленные (src/demo/data.ts), к API бота не подключено.
import { Bell, CalendarCheck, ChevronDown, Inbox, Megaphone, Menu, Plus, Scissors, Search, Settings, Users, type LucideIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  AnimatedSidebar,
  AnimatedSidebarContent,
  AnimatedSidebarFooter,
  AnimatedSidebarGroup,
  AnimatedSidebarGroupContent,
  AnimatedSidebarGroupLabel,
  AnimatedSidebarHeader,
  AnimatedSidebarInset,
  AnimatedSidebarMenu,
  AnimatedSidebarMenuButton,
  AnimatedSidebarMenuItem,
  AnimatedSidebarProvider,
  AnimatedSidebarRail,
  AnimatedSidebarTrigger,
} from "@/components/ui/animated-sidebar";
import { Button } from "@/components/ui/button";
import { BOOKINGS, CLIENTS, CONVS } from "@/demo/data";
import { cn } from "@/lib/utils";
import { BotSettingsScreen } from "@/screens/BotSettings";
import { BroadcastsScreen } from "@/screens/Broadcasts";
import { ChatsScreen } from "@/screens/Chats";
import { ClientsScreen } from "@/screens/Clients";
import { CountPill } from "@/screens/parts";

// «Записи» с графиками (Recharts, ~120 КБ) грузятся отдельно — только когда раздел открыли; чаты от этого не тяжелеют
const BookingsScreen = lazy(() => import("@/screens/Bookings").then((m) => ({ default: m.BookingsScreen })));

type Section = "chats" | "bookings" | "broadcasts" | "clients" | "bot";

export default function App() {
  const [section, setSection] = useState<Section>("chats");
  const [convs, setConvs] = useState(CONVS);
  const [searchOpen, setSearchOpen] = useState(false);
  const waiting = convs.filter((c) => c.stage === "wait").length;

  // поиск — по чатам, поэтому из любого раздела переходит в «Чаты»
  const openSearch = () => {
    setSection("chats");
    setSearchOpen(true);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // dot — число на самом значке, видно только в свёрнутом меню (там подписи и «таблетки» скрыты)
  const item = (id: Section, label: string, Icon: LucideIcon, badge?: React.ReactNode, dot?: number) => (
    <AnimatedSidebarMenuItem key={id}>
      <AnimatedSidebarMenuButton
        icon={
          <span className="relative grid place-items-center">
            <Icon className="size-[18px]" />
            {!!dot && (
              <span className="absolute -right-2 -top-2 hidden h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground ring-2 ring-card group-data-[state=collapsed]/sidebar:grid">
                {dot}
              </span>
            )}
          </span>
        }
        badge={badge}
        isActive={section === id}
        onSelect={() => setSection(id)}
      >
        {label}
      </AnimatedSidebarMenuButton>
    </AnimatedSidebarMenuItem>
  );

  return (
    // меню раскрыто только на широком экране; на ноутбуке/планшете — полоса значков, чтобы чату хватало места
    <AnimatedSidebarProvider defaultOpen={window.matchMedia("(min-width: 1280px)").matches} className="h-svh min-h-0 overflow-hidden bg-card">
      <AnimatedSidebar ariaLabel="Меню пульта" collapsible="icon" variant="sidebar" className="min-h-0" panelClassName="h-full border-r-0 bg-card">
        <AnimatedSidebarHeader className="p-4 pb-2">
          <div className="flex min-h-10 items-center gap-2.5 overflow-hidden">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Scissors aria-hidden className="size-[18px]" />
            </div>
            <span className="truncate text-lg font-semibold tracking-tight group-data-[state=collapsed]/sidebar:hidden">Барбершоп</span>
          </div>
        </AnimatedSidebarHeader>
        <AnimatedSidebarContent className="px-3 pt-2">
          <AnimatedSidebarGroup>
            <AnimatedSidebarGroupLabel>Основное</AnimatedSidebarGroupLabel>
            <AnimatedSidebarGroupContent>
              <AnimatedSidebarMenu>
                {item("chats", "Чаты", Inbox, waiting ? <CountPill tone="blue">{waiting}</CountPill> : undefined, waiting)}
                {item("bookings", "Записи", CalendarCheck, <CountPill>{BOOKINGS.filter((b) => b.day === "today").length}</CountPill>)}
                {item("clients", "Клиенты", Users, <CountPill>{CLIENTS.length}</CountPill>)}
              </AnimatedSidebarMenu>
            </AnimatedSidebarGroupContent>
          </AnimatedSidebarGroup>
          <AnimatedSidebarGroup>
            <AnimatedSidebarGroupLabel>Маркетинг</AnimatedSidebarGroupLabel>
            <AnimatedSidebarGroupContent>
              <AnimatedSidebarMenu>{item("broadcasts", "Рассылки", Megaphone)}</AnimatedSidebarMenu>
            </AnimatedSidebarGroupContent>
          </AnimatedSidebarGroup>
          <AnimatedSidebarGroup>
            <AnimatedSidebarGroupLabel>Управление</AnimatedSidebarGroupLabel>
            <AnimatedSidebarGroupContent>
              <AnimatedSidebarMenu>{item("bot", "Бот", Settings)}</AnimatedSidebarMenu>
            </AnimatedSidebarGroupContent>
          </AnimatedSidebarGroup>
        </AnimatedSidebarContent>
        <AnimatedSidebarFooter className="border-none p-3">
          <button
            type="button"
            className="flex min-h-12 w-full items-center gap-3 overflow-hidden rounded-xl border p-2 text-left transition-colors hover:bg-muted/60 group-data-[state=collapsed]/sidebar:justify-center group-data-[state=collapsed]/sidebar:border-transparent group-data-[state=collapsed]/sidebar:p-0"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-orange-500 text-sm font-semibold text-white">А</span>
            <span className="min-w-0 flex-1 group-data-[state=collapsed]/sidebar:hidden">
              <span className="block truncate text-sm font-semibold">Айгерим</span>
              <span className="block truncate text-xs text-muted-foreground">администратор</span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground group-data-[state=collapsed]/sidebar:hidden" />
          </button>
        </AnimatedSidebarFooter>
        <AnimatedSidebarRail />
      </AnimatedSidebar>

      <AnimatedSidebarInset className="min-h-0 bg-card">
        {/* шапка как в D15: кнопка меню, поиск-«таблетка», круглые кнопки и синяя главная кнопка */}
        <header className="flex h-16 shrink-0 items-center gap-2 px-3 md:px-4">
          <AnimatedSidebarTrigger className="size-10 text-muted-foreground hover:bg-muted hover:text-foreground">
            <Menu aria-hidden className="size-5" />
          </AnimatedSidebarTrigger>
          <button
            type="button"
            onClick={openSearch}
            className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-full bg-muted px-4 text-sm text-muted-foreground transition-colors hover:text-foreground md:max-w-sm"
          >
            <Search className="size-4 shrink-0" />
            <span className="truncate">Поиск клиента или чата</span>
            <kbd className="ml-auto rounded-md bg-card px-1.5 text-[11px] max-md:hidden">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" aria-label="Уведомления" className="relative grid size-10 place-items-center rounded-full bg-muted text-foreground hover:bg-secondary max-sm:hidden">
              <Bell className="size-[18px]" />
              {waiting > 0 && <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-rose-500" />}
            </button>
            <button
              type="button"
              aria-label="Записи"
              onClick={() => setSection("bookings")}
              className="grid size-10 place-items-center rounded-full bg-muted text-foreground hover:bg-secondary max-sm:hidden"
            >
              <CalendarCheck className="size-[18px]" />
            </button>
            <Button className="h-10 rounded-full px-4 shadow-sm" onClick={() => setSection("bookings")}>
              <Plus className="size-4 sm:mr-1.5" />
              <span className="max-sm:hidden">Новая запись</span>
            </Button>
          </div>
        </header>

        {/* серое полотно со скруглением, на нём — белые карточки разделов */}
        <div className="flex min-h-0 flex-1 overflow-hidden bg-background p-3 md:mb-3 md:mr-3 md:rounded-3xl md:p-4">
          {/* «Чаты» не убираем со страницы, а прячем: при возврате открыт тот же чат */}
          <div className={cn("flex min-h-0 min-w-0 flex-1", section !== "chats" && "hidden")}>
            <ChatsScreen convs={convs} setConvs={setConvs} searchOpen={searchOpen} setSearchOpen={setSearchOpen} />
          </div>
          {section === "bookings" && (
            <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Загружаю записи…</p>}>
              <BookingsScreen />
            </Suspense>
          )}
          {section === "broadcasts" && <BroadcastsScreen />}
          {section === "clients" && <ClientsScreen />}
          {section === "bot" && <BotSettingsScreen />}
        </div>
      </AnimatedSidebarInset>
    </AnimatedSidebarProvider>
  );
}
