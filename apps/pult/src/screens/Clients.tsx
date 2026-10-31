// Раздел «Клиенты» (этап 1 плана D1, 31.10.2026): единая база контактов компании — из журнала Altegio, импорта и ручного добавления.
// Сверху — состояние синхронизации с Altegio (владельцу — кнопкой в панель «Синхронизация и проверки»), поиск, сегменты-чипы
// с числами; ниже — люди по 50 с «Ещё». Номера в списке — только маской, как их отдал сервер (/api/contacts/list); полный номер —
// в карточке одного клиента. Карточка — своя запись истории (#/clients/<id>): жест «назад» закрывает её. «Добавить клиента» —
// лист; импорт и панель синхронизации — слой во весь экран (телефон) или панель справа (компьютер).
// База не подключена (нет D1 — боевой сайт до решения владельца) — спокойный экран с причиной, без запросов, которые ответят 503.
import { Activity, CalendarDays, CircleAlert, CircleCheck, Contact, Database, Ellipsis, RefreshCw, Search, Upload, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Layer, useBackLayer, whenText, nf } from "@/campaigns/base/shared";
import { useLoad } from "@/campaigns/useLoad";
import { AddClient } from "@/clients/AddClient";
import { ClientCard } from "@/clients/ClientCard";
import { agoText, dayText, errMsg, useFetch } from "@/clients/common";
import { ImportFlow } from "@/clients/ImportFlow";
import { SyncPanel } from "@/clients/SyncPanel";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/overlay";
import { Avatar, Button, EmptyState, IconButton, Skeleton, Spinner } from "@/components/ui";
import { plural } from "@/lib/format";
import { back, navigate, type Route } from "@/lib/router";
import { cn, useNow } from "@/lib/utils";
import type { ContactRow, ContactsStatus } from "@/model/contacts";
import { store, useStore } from "@/state/store";
import { Page } from "./Page";

const VISITS: [string, string, string] = ["визит", "визита", "визитов"];

export default function ClientsScreen({ route }: { route: Extract<Route, { name: "clients" }> }) {
  const ws = useStore((s) => s.wsId);
  const name = useStore((s) => s.workspace?.name);
  if (!ws)
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner />
      </div>
    );
  // смена компании — всё заново
  return <Hub key={ws} ws={ws} name={name} openId={route.id} />;
}

type Layer2 = "import" | "sync" | null;

function Hub({ ws, name, openId }: { ws: string; name?: string; openId?: string }) {
  const now = useNow();
  const sessionOwner = useStore((s) => s.session?.role) === "owner";
  // пока идёт загрузка с Altegio — состояние раз в 5 секунд
  const st = useLoad((src) => src.contactsStatus(ws), [ws], { pollMs: 5000, pollWhile: (d) => d.sync.running });
  const ready = !!st.data?.ready;
  const owner = st.data ? st.data.owner : sessionOwner;

  // «Изменилось» (импорт, синхронизация, карточка) — перечитать числа, сегменты и список
  const [rev, setRev] = useState(0);
  const changed = useCallback(() => {
    setRev((r) => r + 1);
    void st.reload();
  }, [st.reload]);

  const segs = useFetch(() => store.source!.contactSegments(ws), [ws, rev], ready);

  // поиск — через 400 мс тишины; сегмент — сразу
  const [q, setQ] = useState("");
  const [qa, setQa] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQa(q.trim()), 400);
    return () => window.clearTimeout(t);
  }, [q]);
  const [seg, setSeg] = useState("");

  const [rows, setRows] = useState<ContactRow[]>([]);
  const [page, setPage] = useState({ page: 0, pages: 0, total: 0 });
  const [listLoading, setListLoading] = useState(true);
  const [listErr, setListErr] = useState("");
  const [more, setMore] = useState(false);
  const seq = useRef(0);
  const loadList = useCallback(
    async (p: number) => {
      const src = store.source;
      if (!src) return;
      const my = p === 1 ? ++seq.current : seq.current;
      if (p === 1) setListLoading(true);
      else setMore(true);
      setListErr("");
      try {
        const d = await src.contactList(ws, { q: qa, seg, page: p });
        if (my !== seq.current) return;
        setRows((cur) => (p === 1 ? d.items : [...cur, ...d.items]));
        setPage({ page: d.page, pages: d.pages, total: d.total });
      } catch (e) {
        if (my === seq.current) setListErr(errMsg(e));
      } finally {
        if (my === seq.current) {
          setListLoading(false);
          setMore(false);
        }
      }
    },
    [ws, qa, seg],
  );
  useEffect(() => {
    if (!ready) return;
    void loadList(1);
    return () => {
      seq.current++;
    };
  }, [ready, loadList, rev]);

  // слои: «Добавить клиента» — лист; импорт и синхронизация — слой со своей записью истории
  const [adding, setAdding] = useState(false);
  const [layer, setLayer] = useState<Layer2>(null);
  const closeLayer = useCallback(() => setLayer(null), []);
  useBackLayer(layer !== null, closeLayer);
  const [dupId, setDupId] = useState("");
  const open = (id: string) => navigate({ name: "clients", id });
  const closeCard = () => back({ name: "clients" });
  const [cardTitle, setCardTitle] = useState("");

  const refresh = () => {
    setRev((r) => r + 1);
    void st.reload();
  };

  if (st.loading)
    return (
      <Page title="Клиенты" sub={name}>
        <ListSkeleton />
      </Page>
    );
  if (!st.data)
    return (
      <Page title="Клиенты" sub={name}>
        <EmptyState
          icon={CircleAlert}
          title="Клиенты не загрузились"
          text={st.error}
          action={
            <Button variant="outline" icon={RefreshCw} onClick={() => void st.reload()}>
              Повторить
            </Button>
          }
        />
      </Page>
    );
  const d = st.data;
  if (!d.ready)
    return (
      <Page title="Клиенты" sub={name}>
        <EmptyState icon={Database} title="База клиентов ещё не подключена" text={d.why || "Клиенты появятся здесь, когда база будет подключена."} />
      </Page>
    );

  // перечитывание поверх показанного списка (после действия, другой поиск) — без «скелета»: строки остаются, пока не придёт ответ
  const firstLoad = listLoading && rows.length === 0;
  const empty = !listLoading && !listErr && rows.length === 0;
  const filtered = !!qa || !!seg;
  // «Все» — своя кнопка экрана (число из status); такой же сегмент сервера не дублируем
  const segList = (segs.data?.segments || []).filter((s) => s.id !== "all");

  return (
    <Page
      title="Клиенты"
      sub={name}
      actions={
        <>
          <IconButton icon={RefreshCw} label="Обновить" onClick={refresh} className={cn((st.refreshing || listLoading) && "[&>svg]:animate-spin")} />
          {/* ТЗ v3.0 §2.1: одно главное действие наверху; импорт и проверки — в меню «⋯» */}
          <Menu>
            <MenuTrigger asChild>
              <IconButton icon={Ellipsis} label="Ещё действия" />
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={() => setLayer("import")}>
                <Upload aria-hidden className="size-4" /> Импорт из файла
              </MenuItem>
              {owner && (
                <MenuItem onSelect={() => navigate({ name: "settings", section: "diagnostics" })}>
                  <Activity aria-hidden className="size-4" /> Проверка базы и Altegio
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
          <IconButton icon={UserPlus} label="Добавить клиента" onClick={() => setAdding(true)} className="md:hidden" />
          <Button variant="primary" icon={UserPlus} className="max-md:hidden" onClick={() => setAdding(true)}>
            Добавить
          </Button>
        </>
      }
    >
      <SyncLine d={d} now={now} owner={owner} />
      {st.error && <p role="alert" className="mb-3 px-1 text-sm text-critical">Не обновилось: {st.error}</p>}

      <label className="relative mb-3 block">
        <span className="sr-only">Поиск по имени или номеру</span>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" strokeWidth={2} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Имя или номер"
          enterKeyHint="search"
          autoComplete="off"
          className="h-11 w-full rounded-[0.625rem] bg-surface-2 pl-9 pr-9 text-md text-fg outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-ring md:h-10 md:text-base"
        />
        {q && (
          <button type="button" aria-label="Очистить поиск" onClick={() => setQ("")} className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center text-fg-3 hover:text-fg">
            <X aria-hidden className="size-4" strokeWidth={2} />
          </button>
        )}
      </label>

      <div role="group" aria-label="Сегменты" className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        <Chip on={!seg} onClick={() => setSeg("")} label="Все" n={d.counts.contacts} />
        {segList.map((s) => (
          <Chip key={s.id} on={seg === s.id} onClick={() => setSeg(seg === s.id ? "" : s.id)} label={s.label} n={s.count} title={`${s.rule}. Можно писать рекламу: ${s.ready}`} />
        ))}
        {segs.loading && !segList.length && <Skeleton className="h-9 w-40 rounded-full" />}
      </div>
      <p className="mb-4 px-1 text-sm text-fg-3">
        <span className="tnum">{nf.format(d.counts.contacts)}</span> {plural(d.counts.contacts, ["клиент", "клиента", "клиентов"])} · с визитами{" "}
        <span className="tnum">{nf.format(d.counts.withVisits)}</span> · записаны вперёд <span className="tnum">{nf.format(d.counts.upcoming)}</span> · «стоп»{" "}
        <span className="tnum">{nf.format(d.counts.stops)}</span>
        {d.counts.review > 0 && (
          <>
            {" "}
            · <span className="text-fg-2">ждут решения {nf.format(d.counts.review)}</span>
          </>
        )}
      </p>

      {listErr && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[0.875rem] bg-critical-soft px-4 py-3 text-ui text-critical">
          <CircleAlert aria-hidden className="size-4 shrink-0" strokeWidth={2} />
          <span className="min-w-0 flex-1">Список не загрузился: {listErr}</span>
          <Button variant="outline" size="sm" onClick={() => void loadList(1)}>
            Повторить
          </Button>
        </div>
      )}

      {firstLoad ? (
        <ListSkeleton />
      ) : empty ? (
        filtered ? (
          <EmptyState icon={Search} title="Никого не нашли" text="Проверьте имя или номер или выберите «Все»." />
        ) : (
          <EmptyState
            icon={Contact}
            title="Клиентов пока нет"
            text={
              d.sync.available
                ? "Здесь пока нет клиентов. После подключения Altegio они появятся в списке. Можно добавить клиента вручную или загрузить файл."
                : "Добавьте клиента вручную или загрузите список из файла (CSV или Excel)."
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>
                  Добавить клиента
                </Button>
                <Button variant="outline" icon={Upload} onClick={() => setLayer("import")}>
                  Импорт
                </Button>
              </div>
            }
          />
        )
      ) : (
        <section aria-label="Список клиентов" aria-busy={listLoading || undefined} className={cn("mb-6 transition-opacity", listLoading && "opacity-60")}>
          <ul aria-label="Клиенты" className="overflow-hidden rounded-[0.875rem] bg-surface [&>li+li]:border-t [&>li+li]:border-line">
            {rows.map((r) => (
              <li key={r.id}>
                <Row r={r} now={now} onOpen={() => open(r.id)} />
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-3 px-1">
            <p className="text-sm text-fg-3">
              Показано <span className="tnum">{nf.format(rows.length)}</span> из <span className="tnum">{nf.format(page.total)}</span>
            </p>
            {page.page < page.pages && (
              <Button variant="tinted" size="sm" busy={more} onClick={() => void loadList(page.page + 1)}>
                Ещё
              </Button>
            )}
          </div>
        </section>
      )}

      <AddClient
        ws={ws}
        open={adding}
        onOpenChange={setAdding}
        onDone={(id, created) => {
          setAdding(false);
          setDupId(created ? "" : id);
          if (created) changed();
          open(id);
        }}
      />

      <Layer open={!!openId} onClose={closeCard} title={cardTitle || "Клиент"}>
        {openId && (
          <ClientCard
            key={openId}
            ws={ws}
            id={openId}
            owner={owner}
            dup={dupId === openId}
            onTitle={setCardTitle}
            onChanged={changed}
          />
        )}
      </Layer>

      <Layer open={layer === "import"} onClose={closeLayer} title="Импорт клиентов">
        {layer === "import" && <ImportFlow ws={ws} onDone={changed} onClose={closeLayer} />}
      </Layer>

      <Layer open={layer === "sync"} onClose={closeLayer} title="Синхронизация и проверки">
        {layer === "sync" && <SyncPanel ws={ws} status={d} onChanged={changed} />}
      </Layer>
    </Page>
  );
}

/** Строка о базе (ТЗ v3.0 §2.2): когда обновлялась и ошибка, если есть. Подробности и проверки — Настройки → Диагностика. */
function SyncLine({ d, now, owner }: { d: ContactsStatus; now: number; owner: boolean }) {
  const s = d.sync;
  const failed = !!s.lastError && (!s.lastOkAt || (s.lastErrorAt || 0) > s.lastOkAt);
  if (!s.available || (!failed && !s.lastOkAt && !s.running)) return null;
  const text = failed ? "Базу из Altegio не удалось обновить." : s.running ? "Обновляем базу из Altegio…" : `Обновлено ${ago(s.lastOkAt!, now)}`;
  return (
    <p role={failed ? "alert" : "status"} className={cn("mb-3 flex items-center gap-2 px-1 text-sm", failed ? "text-critical" : "text-fg-3")}>
      {failed ? <CircleAlert aria-hidden className="size-4 shrink-0" strokeWidth={2} /> : <CircleCheck aria-hidden className="size-4 shrink-0 text-positive" strokeWidth={2} />}
      <span className="min-w-0">
        {text}
        {failed && owner && (
          <button type="button" onClick={() => navigate({ name: "settings", section: "diagnostics" })} className="ml-1.5 font-medium text-accent-ink underline-offset-2 hover:underline">
            Подробнее
          </button>
        )}
      </span>
    </p>
  );
}
const ago = (t: number, now: number) => {
  const m = Math.max(0, Math.round((now - t) / 60e3));
  return m < 1 ? "только что" : m < 60 ? `${m} мин назад` : m < 24 * 60 ? `${Math.round(m / 60)} ч назад` : agoText(t, now);
};

function Chip({ on, onClick, label, n, title }: { on: boolean; onClick: () => void; label: string; n: number; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-ui font-medium transition-colors pointer-coarse:h-10",
        on ? "bg-accent text-accent-fg" : "bg-surface text-fg hover:bg-surface-2",
      )}
    >
      {label}
      <span className={cn("tnum text-sm", on ? "text-accent-fg/85" : "text-fg-3")}>{nf.format(n)}</span>
    </button>
  );
}

/** Метка в строке клиента: «стоп», «согласие», «запись». */
export function Pill({ tone, children }: { tone: "critical" | "positive" | "accent" | "muted" | "warn"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium",
        tone === "critical" && "bg-critical-soft text-critical",
        tone === "positive" && "bg-positive-soft text-positive",
        tone === "accent" && "bg-accent-soft text-accent-ink",
        tone === "muted" && "bg-surface-2 text-fg-2",
        tone === "warn" && "bg-surface-2 text-fg ring-1 ring-inset ring-line-strong",
      )}
    >
      {children}
    </span>
  );
}

function Row({ r, now, onOpen }: { r: ContactRow; now: number; onOpen: () => void }) {
  // дни с визита — от сервера (календарь Астаны), чтобы не зависеть от часового пояса телефона
  const meta = [r.phone, r.lastVisitAt ? `был ${agoText(r.lastVisitAt, now, r.daysAgo)}` : "визитов нет", r.visits ? `${r.visits} ${plural(r.visits, VISITS)}` : "", r.lastStaff].filter(Boolean);
  const pills = r.fullBlock || r.stop || r.review || r.consent === "granted" || !!r.nextBookingAt;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-14 w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-surface-2/60 active:bg-surface-2 focus-visible:-outline-offset-2"
    >
      <Avatar name={r.name} size="md" className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-base font-medium", !r.name && "text-fg-2")}>{r.name || "Без имени"}</span>
        <span className="tnum line-clamp-2 block text-sm text-fg-2">{meta.join(" · ")}</span>
        {pills && (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {r.fullBlock && <Pill tone="critical">не писать вообще</Pill>}
            {r.stop && <Pill tone="critical">«стоп»</Pill>}
            {r.review && <Pill tone="muted">«стоп» ждёт решения</Pill>}
            {r.consent === "granted" && (r.consentConfirmed ? <Pill tone="positive">согласие на рекламу</Pill> : <Pill tone="warn">согласие не подтверждено</Pill>)}
            {r.nextBookingAt && (
              <Pill tone="accent">
                <CalendarDays aria-hidden className="size-3.5" strokeWidth={2} />
                запись {dayText(r.nextBookingAt, now)}
              </Pill>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden className="mb-6 overflow-hidden rounded-[0.875rem] bg-surface">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 border-line px-4 py-3 [&+&]:border-t">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-2 h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
