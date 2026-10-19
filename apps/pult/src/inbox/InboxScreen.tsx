// Раскладка чатов по ширине экрана:
//   телефон (< 768): один экран за раз — список → переписка → карточка клиента; «назад» — жестом или кнопкой;
//   планшет и ноутбук (768–1279): список + переписка, карточка клиента выезжает справа поверх;
//   компьютер (≥ 1280): список + переписка + карточка клиента колонкой; карточку можно скрыть, выбор запоминается.
// На телефоне список не убирается со страницы, а прячется: вернулись — та же прокрутка.
import { ChevronLeft, MessagesSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { Sheet } from "@/components/overlay";
import { EmptyState, IconButton, Button } from "@/components/ui";
import { back, navigate, type Route } from "@/lib/router";
import { cn, useMedia } from "@/lib/utils";
import { store, useStore } from "@/state/store";
import { ContactPanel } from "./ContactPanel";
import { ConversationPane } from "./ConversationPane";
import { ListPane } from "./ListPane";

const PANEL_KEY = "pult2.panel";
function usePanelPref(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) !== "0";
    } catch {
      return true;
    }
  });
  return [
    v,
    (n: boolean) => {
      setV(n);
      try {
        localStorage.setItem(PANEL_KEY, n ? "1" : "0");
      } catch {
        /* не запомнится — не страшно */
      }
    },
  ];
}

export function InboxScreen({ route }: { route: Extract<Route, { name: "inbox" }> }) {
  const ws = useStore((s) => s.workspace);
  const all = useStore((s) => s.conversations);
  const details = useStore((s) => s.details);
  const md = useMedia("(min-width: 768px)");
  const xl = useMedia("(min-width: 1280px)");
  const [panel, setPanel] = usePanelPref();
  const conv = route.conv;

  useEffect(() => {
    store.setOpen(conv ?? null);
  }, [conv]);
  // на телефоне и планшете карточка клиента — отдельный адрес; на широком экране она колонкой, адрес не нужен
  useEffect(() => {
    if (xl && route.contact && conv) navigate({ name: "inbox", conv }, { replace: true });
  }, [xl, route.contact, conv]);

  const open = (key: string) => navigate({ name: "inbox", conv: key }, { replace: !!conv });
  const summary = conv ? all.find((c) => c.key === conv) : undefined;
  const detail = conv ? details[conv]?.data : undefined;
  const contactView = !!conv && !!route.contact && !xl;
  const toggleContact = () => {
    if (!conv) return;
    if (xl) setPanel(!panel);
    else navigate({ name: "inbox", conv, contact: true });
  };
  const waiting = all.filter((c) => c.attention).length;

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1">
      <ListPane
        openKey={conv}
        onOpen={open}
        className={cn("w-full md:w-[20rem] md:shrink-0 md:border-r md:border-line lg:w-[22rem] 2xl:w-[24rem]", "max-md:absolute max-md:inset-0", conv && "max-md:invisible")}
        inert={!md && !!conv}
      />

      {conv && ws ? (
        <div
          key={md ? "pane" : conv}
          className={cn("min-w-0 flex-1", "max-md:absolute max-md:inset-0 max-md:z-10 max-md:animate-push-in", contactView && !md && "max-md:invisible")}
          inert={contactView && !md}
        >
          <ConversationPane
            convKey={conv}
            ws={ws}
            summary={summary}
            onBack={() => back({ name: "inbox" })}
            onContact={toggleContact}
            panelOpen={xl && panel}
            showPanelToggle={xl}
          />
        </div>
      ) : (
        <div className="hidden min-w-0 flex-1 items-center justify-center md:flex">
          {all.length > 0 && <EmptyState
            icon={MessagesSquare}
            title="Выберите чат"
            text={waiting ? `Ждут ответа: ${waiting}. Начните с них.` : "Слева — все переписки с клиентами."}
            action={
              waiting ? (
                <Button size="sm" variant="outline" onClick={() => store.setFilter("waiting")}>
                  Показать ждущих
                </Button>
              ) : undefined
            }
          />}
        </div>
      )}

      {xl && conv && ws && panel && (
        <aside aria-label="Карточка клиента" className="scroll-area w-[20rem] shrink-0 border-l border-line bg-canvas 2xl:w-[22.5rem]">
          <ContactPanel convKey={conv} ws={ws} detail={detail} summary={summary} all={all} onOpenOther={open} onClose={() => setPanel(false)} />
        </aside>
      )}

      {/* планшет и ноутбук: карточка выезжает справа */}
      {md && !xl && conv && ws && (
        <Sheet open={!!route.contact} onOpenChange={(v) => !v && back({ name: "inbox", conv })} title="Клиент" side="right" className="bg-canvas">
          <ContactPanel convKey={conv} ws={ws} detail={detail} summary={summary} all={all} onOpenOther={(k) => navigate({ name: "inbox", conv: k }, { replace: true })} />
        </Sheet>
      )}

      {/* телефон: карточка — отдельный экран поверх переписки */}
      {!md && contactView && ws && (
        <div className="absolute inset-0 z-20 flex animate-push-in flex-col bg-canvas">
          <header className="shrink-0 pt-safe">
            <div className="relative flex h-[3.25rem] items-center px-0.5">
              <IconButton icon={ChevronLeft} label="Назад к переписке" onClick={() => back({ name: "inbox", conv })} className="text-accent hover:text-accent [&>svg]:size-7 [&>svg]:stroke-[2]" />
              <h2 className="pointer-events-none absolute inset-x-14 text-center text-[1.0625rem] font-semibold">Клиент</h2>
            </div>
          </header>
          <div className="scroll-area min-h-0 flex-1">
            <ContactPanel convKey={conv} ws={ws} detail={detail} summary={summary} all={all} onOpenOther={(k) => navigate({ name: "inbox", conv: k }, { replace: true })} />
          </div>
        </div>
      )}
    </div>
  );
}
