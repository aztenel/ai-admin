// Раздел «Рассылки» — хаб (этап 3 Winchester). Решение владельца 19.10.2026 (главнее ТЗ): два вида рассылок — две вкладки,
// у каждого вида свой номер.
//  · «Маркетинг · основной номер» — шаблоны Meta: обзор номера (качество, предел, сигнал Meta), рассылки в работе, база клиентов
//    и сегменты, автосценарий «Пора на стрижку», история, «Новая рассылка» (мастер — только основной номер, без выбора номера).
//  · «Сервисные · номер бота» — сообщения, которые бот шлёт сам (напоминания, просьба об отзыве): обзор номера бота и ServiceMessages.
// Рассылок с номера бота (Green-API) в пульте не создают: массовые сообщения с обычного WhatsApp — главная причина блокировок.
// Старая страница /broadcast не нужна — ссылки на неё здесь нет.
// Мастер — полноэкранный лист на телефоне (внутри корня пульта, чтобы клавиатура iPhone не закрывала поля — lib/viewport.ts) и большой
// лист по центру на компьютере. Открытый лист — своя запись истории: жест «назад» закрывает лист, а не уводит из раздела.
// Выбранная вкладка запоминается на этом устройстве (localStorage pult2.campaigns.tab).
import { CircleAlert, Plus, RefreshCw } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import AutoScenario from "@/campaigns/AutoScenario";
import { CRM_STALE } from "@/campaigns/base/shared";
import { CampaignSheet } from "@/campaigns/CampaignSheet";
import ClientBase from "@/campaigns/ClientBase";
import { CampaignList, ListSkeleton, UNFINISHED, useCampaignDetails } from "@/campaigns/History";
import { BotNumber, MainNumber, NumberSkeleton } from "@/campaigns/Overview";
import ServiceMessages from "@/campaigns/ServiceMessages";
import { useLoad } from "@/campaigns/useLoad";
import { Sheet } from "@/components/overlay";
import { Button, EmptyState, IconButton, Spinner } from "@/components/ui";
import { cn, useNow } from "@/lib/utils";
import type { CampaignStatus, SegmentSpec } from "@/model/campaigns";
import { useStore } from "@/state/store";
import { Group, Page } from "./Page";

// мастер — отдельный кусок: грузится, только когда его открыли
const Wizard = lazy(() => import("@/campaigns/Wizard"));

type Tab = "marketing" | "service";
const TAB_KEY = "pult2.campaigns.tab";
function readTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === "service" ? "service" : "marketing";
  } catch {
    return "marketing";
  }
}
function saveTab(t: Tab) {
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    // приватный режим Safari и т. п. — вкладка просто не запомнится
  }
}
const TABS: { id: Tab; title: string; sub: string }[] = [
  { id: "marketing", title: "Маркетинг", sub: "основной номер" },
  { id: "service", title: "Сервисные", sub: "номер бота" },
];

type Preset = { segment?: SegmentSpec; channel?: "main" | "bot" };
type Layer = { kind: "wizard"; preset?: Preset } | { kind: "campaign"; id: string } | { kind: "nomain" };

const NO_MAIN = "Маркетинговые рассылки — только с основного номера WhatsApp (Meta). Он не подключён.";

export default function CampaignsScreen() {
  const ws = useStore((s) => s.wsId);
  const name = useStore((s) => s.workspace?.name);
  if (!ws)
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner />
      </div>
    );
  // смена компании — всё заново (пульт и так уводит на «Чаты»)
  return <Hub key={ws} ws={ws} name={name} />;
}

function Hub({ ws, name }: { ws: string; name?: string }) {
  const sessionOwner = useStore((s) => s.session?.role) === "owner";
  const now = useNow();
  const [tab, setTabState] = useState<Tab>(readTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    saveTab(t);
  };
  const ov = useLoad((src) => src.campaignsOverview(ws), [ws]);
  const crm = useLoad((src) => src.crmSegments(ws), [ws]);
  // «Обновить» перечитывает и вложенные блоки (база, автосценарий, сервисные) — заново их монтируем
  const [rev, setRev] = useState(0);
  const [layer, setLayer] = useState<Layer | null>(null);
  const closeLayer = useCallback(() => setLayer(null), []);
  useBackClose(layer !== null, closeLayer);

  const reloadOv = ov.reload;
  const reloadCrm = crm.reload;
  const rows = ov.data?.campaigns;
  // рассылка перестала идти: обзор (отправлено за 24 часа) и числа базы (кому ушло, тем 14 дней не пишем) — заново
  const det = useCampaignDetails(ws, rows, layer?.kind === "campaign" ? layer.id : null, () => {
    void reloadOv();
    void reloadCrm();
    window.dispatchEvent(new CustomEvent(CRM_STALE, { detail: ws }));
  });
  // роль — из ответа сервера (он же проверяет права), пока ответа нет — из сессии
  const owner = ov.data ? ov.data.owner : sessionOwner;
  const visible = (rows || []).filter((r) => !det.gone.has(r.id));
  const isActive = (id: string, status: CampaignStatus) => UNFINISHED.has(det.details[id]?.status ?? status);
  const active = visible.filter((r) => isActive(r.id, r.status));
  const past = visible.filter((r) => !isActive(r.id, r.status));
  // база и автосценарий — только у компании с базой клиентов; сбой загрузки — пусть база сама покажет ошибку
  const hasBase = crm.data ? crm.data.available : !!crm.error;

  const newCampaign = (preset?: Preset) => setLayer(ov.data && !ov.data.main.ready ? { kind: "nomain" } : { kind: "wizard", preset });
  const refresh = () => {
    void ov.reload();
    void crm.reload();
    setRev((r) => r + 1);
  };

  const failed = !ov.data && !ov.loading;
  const loadError = (
    <EmptyState
      icon={CircleAlert}
      title="Рассылки не загрузились"
      text={ov.error}
      action={
        <Button variant="outline" icon={RefreshCw} onClick={() => void ov.reload()}>
          Повторить
        </Button>
      }
    />
  );
  const staleError = ov.data && ov.error ? <p role="alert" className="-mt-3 mb-4 px-4 text-sm text-critical">Не обновилось: {ov.error}</p> : null;
  const openCampaign = (id: string) => setLayer({ kind: "campaign", id });
  const lid = layer?.kind === "campaign" ? layer.id : "";

  return (
    <Page
      title="Рассылки"
      sub={name}
      actions={
        <>
          <IconButton icon={RefreshCw} label="Обновить" onClick={refresh} className={cn((ov.refreshing || crm.refreshing) && "[&>svg]:animate-spin")} />
          {tab === "marketing" && (
            <Button variant="primary" icon={Plus} className="max-md:hidden" disabled={ov.loading} onClick={() => newCampaign()}>
              Новая рассылка
            </Button>
          )}
        </>
      }
    >
      <Tabs value={tab} onChange={setTab} />

      {tab === "marketing" ? (
        <div role="tabpanel" id="cmp-panel-marketing" aria-labelledby="cmp-tab-marketing">
          {ov.loading ? <NumberSkeleton /> : ov.data ? <MainNumber ws={ws} ov={ov.data} owner={owner} onChanged={() => void ov.reload()} /> : loadError}
          {staleError}
          <Button variant="primary" size="lg" icon={Plus} className="mb-6 w-full md:hidden" disabled={ov.loading} onClick={() => newCampaign()}>
            Новая рассылка
          </Button>
          <CampaignList title="В работе" rows={active} details={det.details} now={now} onOpen={openCampaign} page={30} />
          {hasBase && <ClientBase key={`base${rev}`} ws={ws} owner={owner} onCreate={(spec: SegmentSpec) => newCampaign({ segment: spec, channel: "main" })} />}
          {hasBase && <AutoScenario key={`auto${rev}`} ws={ws} owner={owner} />}
          {ov.loading ? (
            <ListSkeleton />
          ) : past.length ? (
            <CampaignList title="История" rows={past} details={det.details} now={now} onOpen={openCampaign} />
          ) : ov.data && !active.length ? (
            <Group title="История">
              <p className="py-4 text-ui text-fg-2 pointer-coarse:text-base">
                {ov.data.main.ready
                  ? `Рассылок пока нет. Нажмите «Новая рассылка»${hasBase ? " или выберите сегмент в базе клиентов" : ""}. Сообщения уходят порциями, в часы отправки; тем, кто ответил «стоп», не пишем.`
                  : "Рассылок пока нет."}
              </p>
            </Group>
          ) : null}
        </div>
      ) : (
        <div role="tabpanel" id="cmp-panel-service" aria-labelledby="cmp-tab-service">
          {ov.loading ? <NumberSkeleton /> : ov.data ? <BotNumber ov={ov.data} /> : failed ? loadError : null}
          {staleError}
          <ServiceMessages key={`svc${rev}`} ws={ws} owner={owner} />
        </div>
      )}

      <WizardLayer
        ws={ws}
        open={layer?.kind === "wizard"}
        preset={layer?.kind === "wizard" ? layer.preset : undefined}
        onClose={closeLayer}
        onDone={(id) => {
          // рассылка создана (и, может быть, запущена) — открываем её лист вместо мастера и перечитываем обзор
          setLayer({ kind: "campaign", id });
          void ov.reload();
        }}
      />

      {lid && (
        <CampaignSheet
          ws={ws}
          id={lid}
          row={rows?.find((r) => r.id === lid)}
          detail={det.details[lid]}
          now={now}
          open
          onOpenChange={(v) => !v && closeLayer()}
          onChange={det.upsert}
          onDeleted={(id) => {
            det.remove(id);
            closeLayer();
            void ov.reload();
          }}
          onStarted={() => void ov.reload()}
        />
      )}

      <Sheet
        open={layer?.kind === "nomain"}
        onOpenChange={(v) => !v && closeLayer()}
        title="Новая рассылка"
        description={NO_MAIN}
        footer={
          <Button variant="primary" className="mb-1 w-full" onClick={closeLayer}>
            Понятно
          </Button>
        }
      >
        {owner && ov.data?.main.why ? <p className="px-4 pb-2 text-sm text-fg-3">Что не так: {ov.data.main.why}</p> : null}
      </Sheet>
    </Page>
  );
}

/** Вкладки «Маркетинг · основной номер» / «Сервисные · номер бота». На телефоне — в две строки, на компьютере — в одну. */
function Tabs({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const j = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    onChange(TABS[j].id);
    refs.current[j]?.focus();
  };
  return (
    <div role="tablist" aria-label="Вид рассылок" className="mb-5 grid grid-cols-2 gap-0.5 rounded-[0.75rem] bg-surface-3 p-0.5 dark:bg-surface-2">
      {TABS.map((t, i) => {
        const on = value === t.id;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`cmp-tab-${t.id}`}
            aria-selected={on}
            aria-controls={`cmp-panel-${t.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "flex min-w-0 flex-col items-center justify-center rounded-[0.625rem] px-2 py-1.5 text-center transition-colors max-md:min-h-12 md:min-h-9 md:flex-row md:gap-1 md:pointer-coarse:min-h-11",
              on ? "bg-surface text-fg shadow-[0_1px_2px_rgb(16_24_40/0.1)] dark:bg-surface-3" : "text-fg-2 hover:text-fg",
            )}
          >
            <span className="truncate text-ui font-semibold pointer-coarse:text-base">{t.title}</span>
            <span className="text-fg-3 max-md:sr-only"> · </span>
            <span className={cn("truncate text-xs md:text-ui", on ? "text-fg-2" : "text-fg-3")}>{t.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Мастер «Новая рассылка»: на телефоне — во весь экран (снизу вверх), на компьютере — большой лист по центру. */
function WizardLayer({ ws, open, preset, onClose, onDone }: { ws: string; open: boolean; preset?: Preset; onClose: () => void; onDone: (id: string) => void }) {
  // внутри корня пульта: его высоту и сдвиг при открытой клавиатуре iPhone задаёт lib/viewport.ts — поля мастера не уходят под клавиатуру
  const root = document.querySelector<HTMLElement>(".app-root");
  return (
    <D.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <D.Portal container={root ?? undefined}>
        <D.Overlay className="absolute inset-0 z-40 bg-scrim data-[state=open]:animate-fade-in max-md:hidden" />
        <D.Content
          aria-describedby={undefined}
          // случайное касание мимо листа на компьютере не должно стирать начатую рассылку; закрыть — кнопкой мастера или Esc
          onPointerDownOutside={(e) => e.preventDefault()}
          className={cn(
            "absolute z-50 flex flex-col overflow-hidden bg-canvas text-fg outline-none",
            "max-md:inset-0 max-md:data-[state=open]:animate-sheet-in",
            "md:left-1/2 md:top-1/2 md:h-[min(calc(100%-3rem),56rem)] md:w-[min(52rem,calc(100%-3rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[1.125rem] md:shadow-pop md:data-[state=open]:animate-pop-in",
          )}
        >
          <D.Title className="sr-only">Новая рассылка</D.Title>
          <Suspense
            fallback={
              <div className="grid flex-1 place-items-center">
                <Spinner />
              </div>
            }
          >
            {open && <Wizard ws={ws} preset={preset} onClose={onClose} onDone={onDone} />}
          </Suspense>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Открытый лист — своя запись истории: жест «назад» на iPhone и кнопка «Назад» в Android закрывают лист, а не уводят из раздела.
 *  Адрес не меняется, поэтому роутер (lib/router.ts) экран не переключает. */
function useBackClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const st = history.state && typeof history.state === "object" ? history.state : {};
    const depth = typeof st.pultDepth === "number" ? st.pultDepth : 0;
    history.pushState({ ...st, pultDepth: depth + 1, pultLayer: 1 }, "", location.href);
    let mine = true;
    const onPop = () => {
      mine = false;
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // закрыли кнопкой — убрать свою запись, если она ещё сверху (переход в другой раздел мог её заменить)
      if (mine && history.state?.pultLayer) history.back();
    };
  }, [open]);
}
