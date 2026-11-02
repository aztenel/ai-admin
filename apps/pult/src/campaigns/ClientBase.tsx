// База клиентов из Altegio (этап 3 Winchester, ТЗ §5.1–§5.2): сколько клиентов за 90 дней, скольким можно писать сейчас, когда
// база обновлена (по Астане), скрытые номера, исключения, отметки визитов в журнале (для проверки владельцем — что ставят
// администраторы, не проверено), сегменты с числами. Нажатие на сегмент — люди сегмента с отбором и «Создать рассылку по сегменту»
// (хаб открывает мастер с этим сегментом). «Обновить базу» — только владелец: сотруднику сервер ответит 403.
// Всё — из /api/crm/segments и /api/crm/list; номера клиентов браузеру приходят только маской (полные — на сервере).
// Базу не собрать (нет ключа журнала и т. п.) и снимка нет — коротко почему, без сегментов.
import { CircleAlert, ChevronRight, DatabaseZap, RefreshCw, UserRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/overlay";
import { Button, Skeleton } from "@/components/ui";
import { plural } from "@/lib/format";
import { cn, useNow } from "@/lib/utils";
import type { CrmOverview, CrmSegment, SegmentSpec } from "@/model/campaigns";
import { Group } from "@/screens/Page";
import { store } from "@/state/store";
import { SegmentView } from "./base/SegmentView";
import { CRM_REFRESHED, CRM_STALE, Layer, Notice, nf, segRule, Stats, useBackLayer, when, whenText } from "./base/shared";
import { ATTENDANCE, errText, EXCLUDED } from "./common";
import { useLoad } from "./useLoad";

const PEOPLE: [string, string, string] = ["человек", "человека", "человек"];

type Props = { ws: string; owner: boolean; onCreate(spec: SegmentSpec): void };

export default function ClientBase({ ws, owner: ownerProp, onCreate }: Props) {
  const now = useNow();
  const crm = useLoad((src) => src.crmSegments(ws), [ws]);
  const d = crm.data;
  // роль — из ответа сервера (он же проверяет права), пока ответа нет — из хаба
  const owner = d ? d.owner : ownerProp;

  const [seg, setSeg] = useState<CrmSegment | null>(null);
  const leave = useBackLayer(seg !== null, () => setSeg(null));

  const [busy, setBusy] = useState(false);
  const [refreshErr, setRefreshErr] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // в разработке React монтирует дважды: после первого «размонтирования» снова жив
    return () => {
      alive.current = false;
    };
  }, []);
  const reload = crm.reload;
  // рассылка по базе закончила отправку — числа сегментов устарели (им 14 дней не пишем): перечитать тихо, поверх показанных
  useEffect(() => {
    const f = (e: Event) => {
      if ((e as CustomEvent<string>).detail === ws) void reload();
    };
    window.addEventListener(CRM_STALE, f);
    return () => window.removeEventListener(CRM_STALE, f);
  }, [ws, reload]);
  const refresh = useCallback(async () => {
    const src = store.source;
    if (!src) return;
    setBusy(true);
    setRefreshErr("");
    try {
      await src.crmRefresh(ws);
      if (!alive.current) return;
      await reload();
      window.dispatchEvent(new CustomEvent(CRM_REFRESHED, { detail: ws }));
      toast("База обновлена");
    } catch (e) {
      if (alive.current) setRefreshErr(errText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [ws, reload]);

  if (crm.loading) return <BaseSkeleton />;
  if (!d)
    return (
      <Group title="База клиентов из Altegio">
        <div className="pb-3">
          <Notice tone="critical" role="alert">
            Не загрузилась: {crm.error}
          </Notice>
          <Button variant="outline" icon={RefreshCw} className="mb-1" onClick={() => void crm.reload()}>
            Повторить
          </Button>
        </div>
      </Group>
    );
  // базу не собрать и снимка нет — коротко почему
  if (!d.available)
    return (
      <Group title="База клиентов из Altegio">
        <p className="py-3 text-ui text-fg-2 pointer-coarse:text-base">{d.why || "Базы клиентов у этой компании нет."}</p>
      </Group>
    );

  const info = d.info;
  const has = d.at > 0;
  const upd = has ? when(d.at, now) : null;
  const canRefresh = owner && !d.why;
  const main = d.segments.filter((s) => !s.id.startsWith("staff:"));
  const masters = d.segments.filter((s) => s.id.startsWith("staff:"));
  const tiles: CrmSegment[] = has ? [...main, { id: "all", label: "Вся база", rule: "все, кому можно писать", n: d.ok }] : [];

  return (
    <>
      <Group
        title="База клиентов из Altegio"
        note={
          has
            ? "Бот обновляет базу каждую ночь в 04:00 по журналу записей Altegio за 90 дней. По базе старше 3 дней рассылку не создать. Номера в пульте видны частично."
            : undefined
        }
      >
        {has ? (
          <Stats
            items={[
              { label: "Клиентов", value: nf.format(d.clients), sub: "за 90 дней" },
              { label: "Доступно", value: nf.format(d.ok), sub: "для рассылки" },
              { label: "Обновлена", value: upd!.time, sub: upd!.day },
            ]}
          />
        ) : (
          <p className="flex gap-2.5 py-3 text-ui text-fg-2 pointer-coarse:text-base">
            <DatabaseZap aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-3" strokeWidth={2} />
            <span>
              Базу ещё не собирали.{" "}
              {canRefresh ? "Нажмите «Обновить базу», и мы прочитаем журнал Altegio за 90 дней." : "Бот соберёт её ночью сам, или владелец обновит её сейчас."}
            </span>
          </p>
        )}

        {d.why && has && <Notice>Обновить базу сейчас нельзя: {d.why}</Notice>}
        {info && info.masked > 0 && (
          <Notice>
            Скрытых номеров: <span className="tnum">{nf.format(info.masked)}</span>: у сотрудника, чей ключ подключён к пульту, в Altegio нет права видеть телефоны
            клиентов. Этим клиентам рассылка не уйдёт.
          </Notice>
        )}
        {info && info.cut && <Notice>Журнал прочитан не весь (слишком много записей), числа могут быть меньше настоящих.</Notice>}
        {info && info.bad > 0 && (
          <Notice tone="muted">
            Неверных номеров: <span className="tnum">{nf.format(info.bad)}</span>, им не пишем.
          </Notice>
        )}
        {d.error && (
          <Notice tone="critical">
            Последнее обновление{d.errorAt ? ` (${whenText(d.errorAt, now)})` : ""} не удалось: {d.error}
          </Notice>
        )}

        {has && d.consent && !d.consent.ready && <Notice tone="critical">{d.consent.why || "Рекламу сейчас нельзя никому: нет базы согласий."}</Notice>}
        {has && (
          <div className="py-3">
            <p className="text-ui text-fg pointer-coarse:text-base">Не пишем</p>
            <p className="mt-0.5 text-sm text-fg-2">
              {(Object.keys(EXCLUDED) as (keyof CrmOverview["excluded"])[]).map((k, i) => (
                <span key={k}>
                  {i > 0 && " · "}
                  {EXCLUDED[k]}: <span className="tnum">{nf.format(d.excluded[k] || 0)}</span>
                </span>
              ))}
            </p>
          </div>
        )}
        {has && info && <Marks info={info} />}

        {canRefresh && (
          <div className="py-3">
            <Button variant="tinted" icon={RefreshCw} busy={busy} onClick={() => void refresh()} className="max-md:w-full">
              {busy ? "Читаю журнал Altegio… до минуты" : "Обновить базу"}
            </Button>
            {refreshErr && (
              <p role="alert" className="mt-2 flex gap-2 text-ui text-critical pointer-coarse:text-base">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
                <span>{refreshErr}</span>
              </p>
            )}
          </div>
        )}
      </Group>

      {has && (
        <section className="mb-6" aria-labelledby="crm-segs">
          <h3 id="crm-segs" className="mb-1.5 px-4 text-sm font-medium text-fg-3">
            Кому можно писать сейчас
          </h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {tiles.map((s) => (
              <Tile key={s.id} s={s} pora={s.id === "pora"} onOpen={() => setSeg(s)} />
            ))}
          </div>
          <p className="mt-1.5 px-4 text-sm text-fg-3">Нажмите на сегмент, чтобы увидеть людей и создать рассылку.</p>
        </section>
      )}

      {has && masters.length > 0 && (
        <Group title="По мастеру последнего визита">
          {masters.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSeg(s)}
              aria-label={`Мастер ${s.label.replace(/^Мастер:\s*/, "")}: ${nf.format(s.n)} ${plural(s.n, PEOPLE)}`}
              className="group relative -mx-4 flex min-h-12 w-[calc(100%+2rem)] items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2/60 active:bg-surface-2 focus-visible:-outline-offset-2"
            >
              <span className="grid size-[1.875rem] shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-2">
                <UserRound aria-hidden className="size-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1 truncate text-md md:text-base">{s.label.replace(/^Мастер:\s*/, "")}</span>
              <span className="tnum shrink-0 text-ui text-fg-2 pointer-coarse:text-base">{nf.format(s.n)}</span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={2} />
            </button>
          ))}
        </Group>
      )}

      <Layer open={seg !== null} onClose={() => leave()} title={seg?.label ?? ""}>
        {seg && (
          <SegmentView
            key={seg.id}
            ws={ws}
            seg={seg}
            masters={masters.map((s) => s.id.slice(6))}
            // сначала закрыть слой (и его запись истории), потом хаб откроет мастер со своей записью
            onCreate={(spec) => leave(() => onCreate(spec))}
          />
        )}
      </Layer>
    </>
  );
}

/** Плитка сегмента: название, число (кому можно писать сейчас), правило. Имя для читалок и проверок — «Сегмент «…»: N человек, …»
 *  (строка истории с тем же названием рассылки не путается с плиткой). */
function Tile({ s, pora, onOpen }: { s: CrmSegment; pora: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Сегмент «${s.label}»: ${nf.format(s.n)} ${plural(s.n, PEOPLE)}, ${segRule(s)}`}
      className={cn(
        "relative flex min-h-[6.25rem] min-w-0 flex-col items-start rounded-[0.875rem] bg-surface p-3 text-left transition-colors hover:bg-surface-2/60 active:bg-surface-2",
        pora && "ring-1 ring-inset ring-accent/35",
      )}
    >
      <span className={cn("w-full truncate text-ui font-semibold pointer-coarse:text-base", pora && "text-accent-ink")}>{s.label}</span>
      <span className="tnum mt-1 text-2xl font-semibold leading-8">{nf.format(s.n)}</span>
      <span className="mt-auto line-clamp-2 text-xs text-fg-3">{segRule(s)}</span>
    </button>
  );
}

/** Отметки визитов в журнале Altegio — для проверки: какие отметки ставят администраторы. «-1» — не пришёл, такие визиты не считаются. */
function Marks({ info }: { info: NonNullable<CrmOverview["info"]> }) {
  const keys = Object.keys(info.att || {}).sort((a, b) => (info.att[b] || 0) - (info.att[a] || 0));
  if (!keys.length && !info.records) return null;
  return (
    <div className="py-3">
      <p className="text-ui text-fg pointer-coarse:text-base">Для проверки</p>
      <p className="mt-0.5 text-sm text-fg-2">
        Прочитано записей журнала: <span className="tnum">{nf.format(info.records)}</span>, визитов: <span className="tnum">{nf.format(info.visits)}</span>.
      </p>
      {keys.length > 0 && (
        <p className="mt-0.5 text-sm text-fg-2">
          Отметки визитов в Altegio:{" "}
          {keys.map((k, i) => (
            <span key={k}>
              {i > 0 && " · "}«{k}» {ATTENDANCE[k] || "другая отметка"}: <span className="tnum">{nf.format(info.att[k] || 0)}</span>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function BaseSkeleton() {
  return (
    <section className="mb-6" aria-hidden>
      <Skeleton className="mb-2 ml-4 h-3.5 w-40" />
      <div className="rounded-[0.875rem] bg-surface px-4 py-3">
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
        <Skeleton className="mt-4 h-3 w-4/5" />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[6.25rem] rounded-[0.875rem]" />
        ))}
      </div>
    </section>
  );
}
