// Раздел «Рассылки» — хаб. Три вкладки (02.11.2026):
//  · «Маркетинг · рассылки» — главный канал рассылок — второй номер (Green-API): «Создать рассылку» сразу открывает мастер второго номера
//    (GaWizard: шаблон → кому → аудитория → пример → проверка → когда), без вопроса «С какого номера?». База клиентов со статусами,
//    история. Основной номер и шаблоны Meta (обзор номера, автосценарий «Пора на стрижку», мастер шаблона Meta) — отдельной свёрнутой
//    группой «Meta — неактивный канал»: ими по-прежнему можно пользоваться. У компании без базы клиентов (мастеру второго номера некого
//    выбрать) главный канал — основной номер, как раньше.
//  · «Автоматические · сообщения» — девять сценариев второго номера (AutoMessages.tsx): сервисные о записи и реклама с согласием,
//    у каждого выключатель, текст и время, проверка на свой номер и журнал. Компания без журнала Altegio — что бот шлёт сам.
//  · «Календарь · план и итоги» — план на дни вперёд (сервисные и реклама отдельно) и итоги доставки (Plan.tsx).
// Рассылки с номера бота текстом по списку пульт не создаёт. Старая страница /broadcast не нужна — ссылки на неё здесь нет.
// Мастер — полноэкранный лист на телефоне (внутри корня пульта, чтобы клавиатура iPhone не закрывала поля — lib/viewport.ts) и большой
// лист по центру на компьютере. Открытый лист — своя запись истории: жест «назад» закрывает лист, а не уводит из раздела; в мастере на
// телефоне «назад» — на прошлый шаг (как стрелка мастера), созданную, но не запущенную рассылку — в её лист (Wizard: backRef).
// Выбранная вкладка запоминается на этом устройстве (localStorage pult2.campaigns.tab; прежнее значение «service» — это «Автоматические»).
import { ChevronDown, CircleAlert, Megaphone, Plus, RefreshCw, Smartphone } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import AutoScenario from "@/campaigns/AutoScenario";
import AutoTab from "@/campaigns/AutoMessages";
import { CRM_STALE } from "@/campaigns/base/shared";
import { CampaignSheet } from "@/campaigns/CampaignSheet";
import ClientBase from "@/campaigns/ClientBase";
import { CampaignList, ListSkeleton, UNFINISHED, useCampaignDetails } from "@/campaigns/History";
import { BotNumber, ChannelCard, MainNumber, NumberSkeleton } from "@/campaigns/Overview";
import GaWizard from "@/campaigns/GaWizard";
import Library from "@/campaigns/Library";
import Plan from "@/campaigns/Plan";
import { QUALITY } from "@/campaigns/common";
import { useLoad } from "@/campaigns/useLoad";
import { ChunkBoundary } from "@/components/boundary";
import { Sheet } from "@/components/overlay";
import { Button, EmptyState, IconButton, Spinner } from "@/components/ui";
import { formatPhone } from "@/lib/format";
import { cn, useNow } from "@/lib/utils";
import type { CampaignsOverview, CampaignStatus, SegmentSpec } from "@/model/campaigns";
import type { WizardBack } from "@/campaigns/Wizard";
import { useStore } from "@/state/store";
import { Group, Page } from "./Page";

// мастер — отдельный кусок: грузится, только когда его открыли
const Wizard = lazy(() => import("@/campaigns/Wizard"));

type Tab = "marketing" | "auto" | "plan";
const TAB_KEY = "pult2.campaigns.tab";
function readTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    // «service» — прежняя вкладка «Сервисные»: её место заняли «Автоматические сообщения»
    return v === "auto" || v === "service" ? "auto" : v === "plan" ? "plan" : "marketing";
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
  { id: "marketing", title: "Маркетинг", sub: "рассылки" },
  { id: "auto", title: "Автоматические", sub: "сообщения" },
  { id: "plan", title: "Календарь", sub: "план и итоги" },
];

type Preset = { segment?: SegmentSpec; channel?: "main" | "bot" };
type Layer = { kind: "wizard"; preset?: Preset } | { kind: "ga"; tplId?: string; spec?: SegmentSpec } | { kind: "campaign"; id: string } | { kind: "nomain" };
// подвкладки маркетинга (ТЗ v3.0 §2.2): рассылки и аудитории · шаблоны · журнал прошедших
type Sub = "campaigns" | "templates" | "journal";
const SUB_KEY = "pult2.campaigns.sub";
const SUBS: { id: Sub; label: string }[] = [
  { id: "campaigns", label: "Рассылки" },
  { id: "templates", label: "Шаблоны" },
  { id: "journal", label: "Журнал" },
];
function readSub(): Sub {
  try {
    const v = localStorage.getItem(SUB_KEY);
    return v === "templates" || v === "journal" ? v : "campaigns";
  } catch {
    return "campaigns";
  }
}

const NO_MAIN = "Рассылки шаблонами Meta уходят только с основного номера, а он не подключён.";

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
  const [sub, setSubState] = useState<Sub>(readSub);
  const setSub = (v: Sub) => {
    setSubState(v);
    try {
      localStorage.setItem(SUB_KEY, v);
    } catch {
      /* частный режим */
    }
  };
  const ov = useLoad((src) => src.campaignsOverview(ws), [ws]);
  const crm = useLoad((src) => src.crmSegments(ws), [ws]);
  // «Обновить» перечитывает и вложенные блоки (база, автосценарий, автоматические) — заново их монтируем
  const [rev, setRev] = useState(0);
  // «Meta — неактивный канал» раскрыта: помним, пока открыт раздел (переход по подвкладкам её не сворачивает)
  const [metaOpen, setMetaOpen] = useState(false);
  const [layer, setLayer] = useState<Layer | null>(null);
  const closeLayer = useCallback(() => setLayer(null), []);
  // мастер сам отвечает на «назад» и Esc (шаг назад, лист созданной рассылки); пока он не загрузился — просто закрыть
  const wizBack: WizardBack = useRef<(() => boolean) | null>(null);
  const back = () => {
    if (layer?.kind === "wizard" && wizBack.current) return wizBack.current();
    closeLayer();
    return false;
  };
  useBackClose(layer !== null, back);

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
  // главный канал рассылок — второй номер (02.11.2026), если он есть и есть база клиентов: мастер второго номера пишет только по базе
  const gaMain = !!ov.data?.bot && hasBase;
  const loading = ov.loading || crm.loading;

  // «Создать рассылку»: второй номер — сразу его мастер; шаблоном Meta — из группы «Meta — неактивный канал» (channel: "main")
  const newCampaign = (preset?: Preset) =>
    setLayer(
      gaMain && preset?.channel !== "main"
        ? { kind: "ga", spec: preset?.segment }
        : ov.data && !ov.data.main.ready
          ? { kind: "nomain" }
          : { kind: "wizard", preset: preset && { segment: preset.segment, channel: "main" } },
    );
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
            <Button variant="primary" icon={Plus} className="max-md:hidden" disabled={loading} onClick={() => newCampaign()}>
              Создать рассылку
            </Button>
          )}
        </>
      }
    >
      <Tabs value={tab} onChange={setTab} />

      {tab === "marketing" ? (
        <div role="tabpanel" id="cmp-panel-marketing" aria-labelledby="cmp-tab-marketing">
          {loading ? <NumberSkeleton /> : ov.data ? <ChannelCard ov={ov.data} channel={gaMain ? "bot" : "main"} onCreate={() => newCampaign()} /> : loadError}
          {staleError}
          <SubTabs value={sub} onChange={setSub} />
          {sub === "campaigns" && (
            <>
              <CampaignList title="В работе и черновики" rows={active} details={det.details} now={now} onOpen={openCampaign} page={30} />
              {!ov.loading && ov.data && !active.length && (
                <Group title="В работе и черновики">
                  <p className="py-4 text-ui text-fg-2 pointer-coarse:text-base">Рассылок пока нет. Нажмите «Создать рассылку» или выберите аудиторию ниже.</p>
                </Group>
              )}
              {hasBase && <ClientBase key={`base${rev}`} ws={ws} owner={owner} channel={gaMain ? "bot" : "main"} onCreate={(spec: SegmentSpec) => newCampaign({ segment: spec })} />}
              {ov.data &&
                !loading &&
                (gaMain ? (
                  <MetaSection ws={ws} ov={ov.data} owner={owner} hasBase={hasBase} rev={rev} open={metaOpen} onToggle={() => setMetaOpen((v) => !v)} onChanged={() => void ov.reload()} onCreate={() => newCampaign({ channel: "main" })} />
                ) : (
                  <>
                    <h2 className="mb-2 mt-6 px-4 text-sm font-medium text-fg-3">Основной номер, шаблоны Meta</h2>
                    <MainNumber ws={ws} ov={ov.data} owner={owner} onChanged={() => void ov.reload()} />
                    {hasBase && <AutoScenario key={`auto${rev}`} ws={ws} owner={owner} />}
                  </>
                ))}
            </>
          )}
          {sub === "templates" && <Library key={`lib${rev}`} ws={ws} owner={owner} onUse={(x) => setLayer({ kind: "ga", tplId: x.id })} />}
          {sub === "journal" &&
            (ov.loading ? (
              <ListSkeleton />
            ) : past.length ? (
              <CampaignList title="Прошедшие рассылки" rows={past} details={det.details} now={now} onOpen={openCampaign} />
            ) : (
              <Group title="Прошедшие рассылки">
                <p className="py-4 text-ui text-fg-2 pointer-coarse:text-base">Завершённых рассылок пока нет.</p>
              </Group>
            ))}
        </div>
      ) : tab === "auto" ? (
        <div role="tabpanel" id="cmp-panel-auto" aria-labelledby="cmp-tab-auto">
          {staleError}
          <AutoTab key={`auto${rev}`} ws={ws} owner={owner} bot={ov.data?.bot} overview={ov.loading ? <NumberSkeleton /> : ov.data ? <BotNumber ov={ov.data} /> : failed ? loadError : null} onMarketing={() => setTab("marketing")} />
        </div>
      ) : (
        <div role="tabpanel" id="cmp-panel-plan" aria-labelledby="cmp-tab-plan">
          <Plan key={`plan${rev}`} ws={ws} />
        </div>
      )}

      <WizardLayer
        ws={ws}
        open={layer?.kind === "wizard"}
        preset={layer?.kind === "wizard" ? layer.preset : undefined}
        backRef={wizBack}
        onClose={closeLayer}
        onDone={(id) => {
          // рассылка создана (и, может быть, запущена) — открываем её лист вместо мастера и перечитываем обзор
          setLayer({ kind: "campaign", id });
          void ov.reload();
        }}
      />

      <GaWizard
        ws={ws}
        owner={owner}
        open={layer?.kind === "ga"}
        preset={layer?.kind === "ga" ? { tplId: layer.tplId, seg: layer.spec?.id, spec: layer.spec } : undefined}
        onClose={closeLayer}
        onDone={(id) => {
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
          owner={owner}
          onOpenChange={(v) => !v && closeLayer()}
          onChange={det.upsert}
          load={det.load}
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

/** «Meta — неактивный канал» (02.11.2026): основной номер и шаблоны Meta свёрнуты — рассылки идут со второго номера. Внутри — обзор номера
 *  (качество, предел, сигнал Meta), «Рассылка шаблоном Meta» (прежний мастер) и автосценарий «Пора на стрижку». Сигнал Meta «остановиться»
 *  виден и в свёрнутом виде. Раскрыта ли — помнит хаб, пока открыт раздел. */
function MetaSection({ ws, ov, owner, hasBase, rev, open, onToggle, onChanged, onCreate }: { ws: string; ov: CampaignsOverview; owner: boolean; hasBase: boolean; rev: number; open: boolean; onToggle: () => void; onChanged: () => void; onCreate: () => void }) {
  const m = ov.main;
  const state = !m.ready ? "не подключён" : [m.phone ? formatPhone(m.phone) : "подключён", m.quality !== "unknown" ? `качество ${QUALITY[m.quality].label.split(",")[0]}` : ""].filter(Boolean).join(" · ");
  return (
    <section aria-label="Meta — неактивный канал" className="mb-6 mt-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="meta-body"
        onClick={onToggle}
        className="flex w-full items-start gap-3 rounded-[0.875rem] bg-surface px-4 py-3 text-left hover:brightness-[0.99] active:bg-surface-2"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-[0.625rem] bg-surface-2 text-fg-3">
          <Smartphone aria-hidden className="size-[1.125rem]" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] font-semibold md:text-base">Meta — неактивный канал</span>
          <span className="block text-sm text-fg-2">Основной номер и шаблоны Meta. Сейчас рассылки идут со второго номера.</span>
          <span className="tnum block text-sm text-fg-3">{state}</span>
          {m.hold.length > 0 && <span className="block text-sm font-medium text-critical">Есть сигнал Meta «остановиться»</span>}
        </span>
        <ChevronDown aria-hidden className={cn("mt-2 size-5 shrink-0 text-fg-3 transition-transform", open && "rotate-180")} strokeWidth={2} />
      </button>
      {open && (
        <div id="meta-body" className="mt-4">
          <MainNumber ws={ws} ov={ov} owner={owner} onChanged={onChanged} />
          <div className="-mt-3 mb-6 px-1">
            <Button variant="outline" icon={Megaphone} className="max-md:w-full" onClick={onCreate}>
              Рассылка шаблоном Meta
            </Button>
            <p className="mt-1.5 px-3 text-sm text-fg-3">С основного номера, только шаблоном, который одобрила Meta. Платно: цена — в кабинете Meta.</p>
          </div>
          {hasBase && <AutoScenario key={`auto${rev}`} ws={ws} owner={owner} />}
        </div>
      )}
    </section>
  );
}

/** Подвкладки маркетинга: Рассылки · Шаблоны · Журнал. */
function SubTabs({ value, onChange }: { value: Sub; onChange: (v: Sub) => void }) {
  return (
    <div role="tablist" aria-label="Маркетинг" className="mb-4 flex gap-5 border-b border-line px-1">
      {SUBS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn("relative -mb-px h-10 text-ui font-medium transition-colors pointer-coarse:h-11 pointer-coarse:text-base", value === t.id ? "text-fg" : "text-fg-2 hover:text-fg")}
        >
          {t.label}
          {value === t.id && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-brand-gold" />}
        </button>
      ))}
    </div>
  );
}

/** Вкладки «Маркетинг · рассылки» / «Автоматические · сообщения» / «Календарь · план и итоги». На телефоне — в две строки (средняя
 *  шире: «Автоматические» — самое длинное слово), на компьютере — в одну. */
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
    <div role="tablist" aria-label="Вид рассылок" className="mb-5 grid grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)_minmax(0,1fr)] gap-0.5 rounded-[0.75rem] bg-surface-3 p-0.5 md:grid-cols-3 dark:bg-surface-2">
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
              "flex min-w-0 flex-col items-center justify-center rounded-[0.625rem] px-1.5 py-1.5 text-center transition-colors max-md:min-h-12 md:min-h-9 md:flex-row md:gap-1 md:px-2 md:pointer-coarse:min-h-11",
              on ? "bg-surface text-fg shadow-[0_1px_2px_rgb(16_24_40/0.1)] dark:bg-surface-3" : "text-fg-2 hover:text-fg",
            )}
          >
            <span className="max-w-full truncate text-ui font-semibold pointer-coarse:text-base">{t.title}</span>
            <span aria-hidden className="text-fg-2 max-md:hidden">
              {" · "}
            </span>
            {/* подпись — text-fg-2 и у неактивной вкладки: fg-3 на заливке вкладок — 4.39:1, ниже 4.5:1 (находка проверки 19.10.2026) */}
            <span className="max-w-full truncate text-xs text-fg-2 md:text-ui">{t.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Мастер «Новая рассылка»: на телефоне — во весь экран (снизу вверх), на компьютере — большой лист по центру. */
function WizardLayer({ ws, open, preset, backRef, onClose, onDone }: { ws: string; open: boolean; preset?: Preset; backRef: WizardBack; onClose: () => void; onDone: (id: string) => void }) {
  // внутри корня пульта: его высоту и сдвиг при открытой клавиатуре iPhone задаёт lib/viewport.ts — поля мастера не уходят под клавиатуру
  const root = document.querySelector<HTMLElement>(".app-root");
  return (
    // Esc — как «назад» мастера: созданную, но не запущенную рассылку открывает в списке, а не бросает черновиком
    <D.Root open={open} onOpenChange={(v) => !v && (backRef.current ? backRef.current() : onClose())}>
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
          <ChunkBoundary what="Мастер рассылки" onClose={onClose}>
            <Suspense
              fallback={
                <div className="grid flex-1 place-items-center">
                  <Spinner />
                </div>
              }
            >
              {open && <Wizard ws={ws} preset={preset} onClose={onClose} onDone={onDone} backRef={backRef} />}
            </Suspense>
          </ChunkBoundary>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Открытый лист — своя запись истории: жест «назад» на iPhone и кнопка «Назад» в Android закрывают лист, а не уводят из раздела.
 *  Адрес не меняется, поэтому роутер (lib/router.ts) экран не переключает. back() вернул true — лист остался (мастер ушёл на прошлый
 *  шаг или открылся лист созданной рассылки): запись истории ставим снова, следующее «назад» опять придёт сюда. */
function useBackClose(open: boolean, back: () => boolean) {
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    if (!open) return;
    const st = history.state && typeof history.state === "object" ? history.state : {};
    const depth = typeof st.pultDepth === "number" ? st.pultDepth : 0;
    const push = () => history.pushState({ ...st, pultDepth: depth + 1, pultLayer: 1 }, "", location.href);
    push();
    let mine = true;
    const onPop = () => {
      if (backRef.current()) push();
      else mine = false;
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // закрыли кнопкой — убрать свою запись, если она ещё сверху (переход в другой раздел мог её заменить)
      if (mine && history.state?.pultLayer) history.back();
    };
  }, [open]);
}
