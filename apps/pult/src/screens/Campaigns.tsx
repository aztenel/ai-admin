// Раздел «Рассылки» — хаб (финальное ТЗ рассылок Winchester, 02.11.2026). Четыре вкладки:
//  · «Маркетинг · рассылки» — главный канал — второй номер (Green-API): статус номера (на связи / нет связи / не настроен до конца) и
//    запуска, «Создать рассылку» (всегда мастер второго номера, GaWizard), подвкладки «Рассылки» (группы «Черновики и запланированные»,
//    «Идут», «Завершённые и остановленные» и «Ответы» — переход в «Чаты»), «Шаблоны» (библиотека текстов), «Клиенты» (база Altegio,
//    десять чисел и сегменты), «Результаты» (итоги рассылок);
//  · «Автоматические · сообщения» — девять сценариев второго номера (AutoMessages.tsx);
//  · «Календарь · план и итоги» — план на дни вперёд и итоги доставки (Plan.tsx);
//  · «Meta» — основной номер и шаблоны Meta: у компании, где главный канал — второй номер, это честно «неактивный канал»; внутри —
//    обзор номера, «Рассылка шаблоном Meta» (мастер Wizard.tsx), автосценарий «Пора на стрижку» и рассылки шаблонами Meta.
// Мастера — во весь экран на телефоне (внутри корня пульта: клавиатура iPhone не закрывает поля — lib/viewport.ts) и большим листом по
// центру на компьютере. Открытый лист — своя запись истории: жест «назад» закрывает лист, в мастере на телефоне — прошлый шаг (backRef).
// Вкладка и подвкладка запоминаются на этом устройстве (pult2.campaigns.tab / .sub; прежние «service» — это «Автоматические», «journal» —
// «Рассылки»).
import { ChevronRight, CircleAlert, Megaphone, MessageCircleReply, Plus, RefreshCw, Smartphone } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import AutoScenario from "@/campaigns/AutoScenario";
import AutoTab from "@/campaigns/AutoMessages";
import { CRM_STALE } from "@/campaigns/base/shared";
import { CampaignSheet } from "@/campaigns/CampaignSheet";
import ClientBase from "@/campaigns/ClientBase";
import { CampaignList, ListSkeleton, shown, UNFINISHED, useCampaignDetails } from "@/campaigns/History";
import { BotNumber, ChannelCard, MainNumber, NumberSkeleton } from "@/campaigns/Overview";
import type { GaPreset } from "@/campaigns/GaWizard";
import Library from "@/campaigns/Library";
import Plan from "@/campaigns/Plan";
import { ResultsView } from "@/campaigns/Results";
import { isScheduled } from "@/campaigns/common";
import { useLoad } from "@/campaigns/useLoad";
import { ChunkBoundary } from "@/components/boundary";
import { Sheet } from "@/components/overlay";
import { Button, EmptyState, IconButton, Spinner } from "@/components/ui";
import { navigate } from "@/lib/router";
import { cn, useNow } from "@/lib/utils";
import type { CampaignRow, CampaignsOverview, SegmentSpec } from "@/model/campaigns";
import type { WizardBack } from "@/campaigns/Wizard";
import { store, useStore } from "@/state/store";
import { Group, Page } from "./Page";

// мастера — отдельные куски: грузятся, только когда их открыли
const Wizard = lazy(() => import("@/campaigns/Wizard"));
const GaWizard = lazy(() => import("@/campaigns/GaWizard"));

type Tab = "marketing" | "auto" | "plan" | "meta";
const TAB_KEY = "pult2.campaigns.tab";
function readTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    // «service» — прежняя вкладка «Сервисные»: её место заняли «Автоматические сообщения»
    return v === "auto" || v === "service" ? "auto" : v === "plan" ? "plan" : v === "meta" ? "meta" : "marketing";
  } catch {
    return "marketing";
  }
}
function save(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // приватный режим Safari и т. п. — выбор просто не запомнится
  }
}

type Layer = { kind: "meta"; preset?: { segment?: SegmentSpec } } | { kind: "ga"; preset?: GaPreset } | { kind: "campaign"; id: string } | { kind: "nomain" };
// подвкладки маркетинга: рассылки · шаблоны · клиенты (база и сегменты) · результаты
type Sub = "campaigns" | "templates" | "clients" | "results";
const SUB_KEY = "pult2.campaigns.sub";
const SUBS: { id: Sub; label: string }[] = [
  { id: "campaigns", label: "Рассылки" },
  { id: "templates", label: "Шаблоны" },
  { id: "clients", label: "Клиенты" },
  { id: "results", label: "Результаты" },
];
function readSub(): Sub {
  try {
    const v = localStorage.getItem(SUB_KEY);
    return v === "templates" || v === "clients" || v === "results" ? v : "campaigns";
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
    save(TAB_KEY, t);
  };
  const [sub, setSubState] = useState<Sub>(readSub);
  const setSub = (v: Sub) => {
    setSubState(v);
    save(SUB_KEY, v);
  };
  const ov = useLoad((src) => src.campaignsOverview(ws), [ws]);
  const crm = useLoad((src) => src.crmSegments(ws), [ws]);
  // «Обновить» перечитывает и вложенные блоки (база, автосценарий, автоматические) — заново их монтируем
  const [rev, setRev] = useState(0);
  const [layer, setLayer] = useState<Layer | null>(null);
  const closeLayer = useCallback(() => setLayer(null), []);
  // мастер сам отвечает на «назад» и Esc (шаг назад, лист созданной рассылки); пока он не загрузился — просто закрыть
  const wizBack: WizardBack = useRef<(() => boolean) | null>(null);
  const isWizard = layer?.kind === "meta" || layer?.kind === "ga";
  const back = () => {
    if (isWizard && wizBack.current) return wizBack.current();
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
  const s = (r: CampaignRow) => shown(r, det.details[r.id]);
  // второй номер — по группам: черновики и запланированные (уже «идёт», но ждёт времени запуска) · идут и на паузе · завершённые
  const ga = visible.filter((r) => r.channel === "bot");
  const drafts = ga.filter((r) => s(r).status === "ready" || isScheduled(s(r), now));
  const going = ga.filter((r) => (s(r).status === "running" && !isScheduled(s(r), now)) || s(r).status === "paused");
  const finished = ga.filter((r) => s(r).status === "done" || s(r).status === "stopped");
  const meta = visible.filter((r) => r.channel === "main");
  const metaActive = meta.filter((r) => UNFINISHED.has(s(r).status));
  const metaPast = meta.filter((r) => !UNFINISHED.has(s(r).status));
  // база и автосценарий — только у компании с базой клиентов; сбой загрузки — пусть база сама покажет ошибку
  const hasBase = crm.data ? crm.data.available : !!crm.error;
  // второй номер — главный канал рассылок, если он есть и есть база клиентов (мастер второго номера пишет только по базе)
  const gaMain = !!ov.data?.bot && hasBase;
  const loading = ov.loading;

  // «Создать рассылку» — всегда мастер второго номера; шаблоном Meta — во вкладке «Meta»
  const newCampaign = (preset?: GaPreset) => setLayer({ kind: "ga", preset });
  const newMeta = () => setLayer(ov.data && !ov.data.main.ready ? { kind: "nomain" } : { kind: "meta" });
  const refresh = () => {
    void ov.reload();
    void crm.reload();
    setRev((r) => r + 1);
  };
  /** «Ответы» — в «Чаты», раздел «Ответы» (ответы клиентов на рассылки и напоминания). */
  const openReplies = () => {
    setLayer(null);
    store.setFilter("replies");
    navigate({ name: "inbox" });
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
  const tabs = [
    { id: "marketing" as const, title: "Маркетинг", sub: "рассылки" },
    { id: "auto" as const, title: "Автоматические", sub: "сообщения" },
    { id: "plan" as const, title: "Календарь", sub: "план и итоги" },
    { id: "meta" as const, title: "Meta", sub: gaMain ? "неактивный канал" : "шаблоны" },
  ];

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
      <Tabs value={tab} onChange={setTab} tabs={tabs} />

      {tab === "marketing" ? (
        <div role="tabpanel" id="cmp-panel-marketing" aria-labelledby="cmp-tab-marketing">
          {loading ? <NumberSkeleton /> : ov.data ? <ChannelCard ov={ov.data} onCreate={() => newCampaign()} /> : loadError}
          {staleError}
          <SubTabs value={sub} onChange={setSub} />
          {sub === "campaigns" &&
            (loading ? (
              <ListSkeleton />
            ) : (
              <>
                <CampaignList title="Черновики и запланированные" rows={drafts} details={det.details} now={now} onOpen={openCampaign} page={30} />
                <CampaignList title="Идут" rows={going} details={det.details} now={now} onOpen={openCampaign} page={30} />
                <CampaignList title="Завершённые и остановленные" rows={finished} details={det.details} now={now} onOpen={openCampaign} page={10} />
                {ov.data && !ga.length && (
                  <Group>
                    <p className="py-4 text-ui text-fg-2 pointer-coarse:text-base">
                      Рассылок со второго номера пока нет. Нажмите «Создать рассылку»: выберите клиентов и сообщение, проверьте получателей и отправьте тест себе.
                    </p>
                  </Group>
                )}
                <LinkRow icon={MessageCircleReply} title="Ответы" text="Ответы клиентов на рассылки и напоминания — в «Чатах»" onClick={openReplies} />
                {/* итоги трёх последних запущенных — сразу на главном виде; все — во вкладке «Результаты» */}
                <ResultsView rows={visible} details={det.details} load={det.load} now={now} onOpen={openCampaign} onReplies={openReplies} compact onAll={() => setSub("results")} />
              </>
            ))}
          {sub === "templates" && <Library key={`lib${rev}`} ws={ws} owner={owner} onUse={(x) => newCampaign({ tplId: x.id, ...(x.seg ? { seg: x.seg } : {}) })} />}
          {sub === "clients" &&
            (hasBase ? (
              <ClientBase key={`base${rev}`} ws={ws} owner={owner} channel="bot" onCreate={(spec: SegmentSpec) => newCampaign({ seg: spec.id, spec })} />
            ) : crm.loading ? (
              <ListSkeleton />
            ) : (
              <Group title="База клиентов из Altegio">
                <p className="py-3 text-ui text-fg-2 pointer-coarse:text-base">{crm.data?.why || "Базы клиентов у этой компании нет."}</p>
              </Group>
            ))}
          {sub === "results" && (loading ? <ListSkeleton /> : <ResultsView rows={visible} details={det.details} load={det.load} now={now} onOpen={openCampaign} onReplies={openReplies} />)}
        </div>
      ) : tab === "auto" ? (
        <div role="tabpanel" id="cmp-panel-auto" aria-labelledby="cmp-tab-auto">
          {staleError}
          <AutoTab key={`auto${rev}`} ws={ws} owner={owner} bot={ov.data?.bot} overview={ov.loading ? <NumberSkeleton /> : ov.data ? <BotNumber ov={ov.data} /> : failed ? loadError : null} onMarketing={() => setTab("marketing")} />
        </div>
      ) : tab === "plan" ? (
        <div role="tabpanel" id="cmp-panel-plan" aria-labelledby="cmp-tab-plan">
          <Plan key={`plan${rev}`} ws={ws} />
        </div>
      ) : (
        <div role="tabpanel" id="cmp-panel-meta" aria-labelledby="cmp-tab-meta">
          {staleError}
          {loading ? (
            <NumberSkeleton />
          ) : ov.data ? (
            <MetaPanel ws={ws} ov={ov.data} owner={owner} gaMain={gaMain} hasBase={hasBase} rev={rev} onChanged={() => void ov.reload()} onCreate={newMeta}>
              <CampaignList title="Рассылки шаблонами Meta: в работе" rows={metaActive} details={det.details} now={now} onOpen={openCampaign} page={30} />
              <CampaignList title="Прошедшие рассылки шаблонами Meta" rows={metaPast} details={det.details} now={now} onOpen={openCampaign} />
            </MetaPanel>
          ) : (
            loadError
          )}
        </div>
      )}

      <WizardLayer open={isWizard} backRef={wizBack} onClose={closeLayer}>
        {layer?.kind === "meta" && (
          <Wizard
            ws={ws}
            preset={layer.preset}
            onClose={closeLayer}
            backRef={wizBack}
            onDone={(id) => {
              // рассылка создана (и, может быть, запущена) — открываем её лист вместо мастера и перечитываем обзор
              setLayer({ kind: "campaign", id });
              void ov.reload();
            }}
          />
        )}
        {layer?.kind === "ga" && (
          <GaWizard
            ws={ws}
            owner={owner}
            bot={ov.data?.bot}
            preset={layer.preset}
            backRef={wizBack}
            onClose={closeLayer}
            onMeta={() => {
              closeLayer();
              setTab("meta");
            }}
            onDone={(id) => {
              // мастер могли открыть из «Шаблонов» или «Клиентов» — после листа рассылки владелец должен увидеть её в «Черновиках»
              setSub("campaigns");
              setLayer({ kind: "campaign", id });
              void ov.reload();
              window.dispatchEvent(new CustomEvent(CRM_STALE, { detail: ws }));
            }}
          />
        )}
      </WizardLayer>

      {lid && (
        <CampaignSheet
          ws={ws}
          id={lid}
          row={rows?.find((r) => r.id === lid)}
          detail={det.details[lid]}
          now={now}
          open
          owner={owner}
          bot={ov.data?.bot}
          onReplies={openReplies}
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
        title="Рассылка шаблоном Meta"
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

/** Строка-переход: значок, название, пояснение, стрелка (как в настройках iPhone). */
function LinkRow({ icon: Icon, title, text, onClick }: { icon: typeof Megaphone; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={`${title}: ${text}`} className="mb-3 flex w-full items-center gap-3 rounded-[0.875rem] bg-surface px-4 py-3 text-left hover:brightness-[0.99] active:bg-surface-2">
      <span className="grid size-9 shrink-0 place-items-center rounded-[0.625rem] bg-surface-2 text-brand-gold">
        <Icon aria-hidden className="size-[1.125rem]" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-semibold md:text-base">{title}</span>
        <span className="block text-sm text-fg-2">{text}</span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={2} />
    </button>
  );
}

/** Вкладка «Meta»: честный статус канала (у компании, где главный канал — второй номер, — неактивный), обзор основного номера,
 *  «Рассылка шаблоном Meta», автосценарий «Пора на стрижку» (шаблон Meta) и рассылки шаблонами Meta (children). */
function MetaPanel({ ws, ov, owner, gaMain, hasBase, rev, onChanged, onCreate, children }: { ws: string; ov: CampaignsOverview; owner: boolean; gaMain: boolean; hasBase: boolean; rev: number; onChanged: () => void; onCreate: () => void; children: ReactNode }) {
  return (
    <>
      <section aria-label="Канал Meta" className="mb-4 rounded-2xl bg-surface p-4 shadow-card">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-3">
            <Smartphone aria-hidden className="size-5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[1.0625rem] font-semibold">{gaMain ? "Meta — неактивный канал" : "Основной номер · шаблоны Meta"}</p>
            <p className="text-sm text-fg-2">
              {gaMain
                ? "Рассылки сейчас идут со второго номера. Здесь — то, что работает через Meta: рассылка шаблоном, который одобрила Meta, и автосценарий «Пора на стрижку»."
                : "Рассылки с основного номера — только шаблоном, который одобрила Meta. Платно: цена — в кабинете Meta."}
            </p>
          </div>
        </div>
        {ov.main.hold.length > 0 && <p className="mt-3 text-sm font-medium text-critical">Есть сигнал Meta «остановиться» — подробно ниже.</p>}
      </section>
      <MainNumber ws={ws} ov={ov} owner={owner} onChanged={onChanged} />
      <div className="-mt-3 mb-6 px-1">
        <Button variant="outline" icon={Megaphone} className="max-md:w-full" onClick={onCreate}>
          Рассылка шаблоном Meta
        </Button>
        <p className="mt-1.5 px-3 text-sm text-fg-3">С основного номера, только шаблоном, который одобрила Meta. Платно: цена — в кабинете Meta.</p>
      </div>
      {hasBase && <AutoScenario key={`auto${rev}`} ws={ws} owner={owner} />}
      {children}
    </>
  );
}

/** Подвкладки маркетинга: Рассылки · Шаблоны · Клиенты · Результаты. */
function SubTabs({ value, onChange }: { value: Sub; onChange: (v: Sub) => void }) {
  return (
    <div role="tablist" aria-label="Маркетинг" className="mb-4 flex gap-4 border-b border-line px-1 md:gap-6">
      {SUBS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn("relative -mb-px h-10 shrink-0 text-ui font-medium transition-colors pointer-coarse:h-11", value === t.id ? "text-fg" : "text-fg-2 hover:text-fg")}
        >
          {t.label}
          {value === t.id && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-brand-gold" />}
        </button>
      ))}
    </div>
  );
}

/** Вкладки «Маркетинг» / «Автоматические» / «Календарь» / «Meta». На телефоне — одной строкой, только названия (четыре подписи в 390 px
 *  не помещаются; полное название — для читалок); на компьютере — в две строки: название и подпись («рассылки», «неактивный канал»). */
function Tabs({ value, onChange, tabs }: { value: Tab; onChange: (t: Tab) => void; tabs: { id: Tab; title: string; sub: string }[] }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const j = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[j].id);
    refs.current[j]?.focus();
  };
  return (
    <div role="tablist" aria-label="Вид рассылок" className="mb-5 flex gap-0.5 rounded-[0.75rem] bg-surface-3 p-0.5 dark:bg-surface-2">
      {tabs.map((t, i) => {
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
            aria-label={`${t.title} · ${t.sub}`}
            aria-selected={on}
            aria-controls={`cmp-panel-${t.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "flex min-h-11 min-w-0 flex-auto flex-col items-center justify-center rounded-[0.625rem] px-1 py-1 text-center transition-colors md:min-h-12 md:flex-1 md:px-2",
              on ? "bg-surface text-fg shadow-[0_1px_2px_rgb(16_24_40/0.1)] dark:bg-surface-3" : "text-fg-2 hover:text-fg",
            )}
          >
            <span className="max-w-full truncate text-sm font-semibold md:text-ui">{t.title}</span>
            {/* подпись — text-fg-2 и у неактивной вкладки: fg-3 на заливке вкладок — 4.39:1, ниже 4.5:1 (находка проверки 19.10.2026) */}
            <span aria-hidden className="max-w-full truncate text-xs text-fg-2 max-md:hidden">
              {t.sub}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Мастер «Новая рассылка»: на телефоне — во весь экран (снизу вверх), на компьютере — большой лист по центру. */
function WizardLayer({ open, backRef, onClose, children }: { open: boolean; backRef: WizardBack; onClose: () => void; children: ReactNode }) {
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
              {open && children}
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
