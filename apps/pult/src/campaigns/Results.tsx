// Итоги рассылок со второго номера (финальное ТЗ рассылок Winchester, 02.11.2026 §9): выбрано, допущено, ушло, не знаем, не ушло,
// доставлено, прочитано, ответили, хотят записаться, записались после, отказались. Числа — с сервера (/api/bc/get → results).
// null — «нет данных» (нет базы отметок или свежей базы клиентов), а не ноль: так и пишем. «Записались после» — совпадение по времени
// (запись или визит в Altegio в течение 14 дней после сообщения), а не доказательство, что записались из-за рассылки.
// «Ответы» — переход в «Чаты» с разделом «Ответы» (ответы клиентов на рассылки и напоминания).
import { BarChart3, ChevronRight, MessageCircleReply } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Skeleton } from "@/components/ui";
import { shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CampaignDetail, CampaignResults, CampaignRow } from "@/model/campaigns";
import { Group } from "@/screens/Page";
import { nf } from "./base/shared";
import { isScheduled } from "./common";
import { shown, statusOf } from "./History";

/** Число или «нет данных». */
const val = (v: number | null | undefined) => (v === null || v === undefined ? null : v);
function Num({ v, big }: { v: number | null | undefined; big?: boolean }) {
  const x = val(v);
  if (x === null) return <span className={cn("text-fg-3", big ? "text-base font-normal" : "font-normal")}>нет данных</span>;
  return <span className="tnum">{nf.format(x)}</span>;
}

type Line = { label: string; hint?: string; v: number | null | undefined; hide?: boolean };

/** Итоги одной рассылки: группы строк «подпись — число», пояснения — мелко под подписью. onReplies — кнопка «Ответы». */
export function ResultsGrid({ r, onReplies }: { r: CampaignResults; onReplies?: () => void }) {
  const groups: { title: string; lines: Line[] }[] = [
    {
      title: "Аудитория",
      lines: [
        { label: "Выбрано", hint: "клиентов в выбранной аудитории", v: r.selected, hide: r.selected === undefined },
        { label: "Допущено", hint: "можно писать рекламу", v: r.admitted, hide: r.admitted === undefined },
      ],
    },
    {
      title: "Отправка",
      lines: [
        { label: "Ушло", v: r.sent },
        { label: "Не знаем", hint: "сбой связи: могло уйти", v: r.unsure ?? 0, hide: r.unsure === undefined },
        { label: "Не ушло", hint: "ошибки", v: r.failed },
        { label: "Пропущено перед отправкой", hint: "записались, отказались или были недавно", v: r.skipped, hide: !r.skipped },
      ],
    },
    {
      title: "Доставка",
      lines: [
        { label: "Доставлено", v: r.delivered },
        { label: "Прочитано", hint: "если клиент не отключил отчёты о прочтении", v: r.read },
      ],
    },
    {
      title: "Отклик",
      lines: [
        { label: "Ответили", v: r.replied },
        { label: "Хотят записаться", v: r.want, hide: r.want === undefined },
        { label: "Записались после", hint: `в течение ${r.window} дней — совпадение по времени, не доказательство`, v: r.booked },
        { label: "Отказались", v: r.refused, hide: r.refused === undefined },
      ],
    },
  ];
  const noData = [r.delivered, r.read, r.replied, r.want, r.booked, r.refused].some((x) => x === null);
  return (
    <section aria-label="Итоги рассылки">
      <h3 className="mb-1.5 text-sm font-medium text-fg-3">Итоги</h3>
      <div className="space-y-2">
        {groups.map((g) => {
          const lines = g.lines.filter((l) => !l.hide);
          if (!lines.length) return null;
          return (
            <dl key={g.title} aria-label={g.title} className="divide-y divide-line rounded-[0.875rem] bg-surface-2 px-4">
              <p className="pt-2 text-xs font-medium uppercase tracking-[0.04em] text-fg-3">{g.title}</p>
              {lines.map((l) => (
                <div key={l.label} className="flex items-start justify-between gap-4 py-2">
                  <dt className="min-w-0">
                    <span className="block text-ui pointer-coarse:text-base">{l.label}</span>
                    {l.hint && <span className="block text-xs text-fg-3">{l.hint}</span>}
                  </dt>
                  <dd className="shrink-0 text-right text-lg font-semibold leading-6">
                    <Num v={l.v} />
                  </dd>
                </div>
              ))}
            </dl>
          );
        })}
      </div>
      {noData && <p className="mt-1.5 text-xs text-fg-3">«Нет данных» — отчётов о доставке или свежей базы клиентов для этого числа нет. Это не ноль.</p>}
      {r.reports === false && <p className="mt-1 text-xs text-fg-3">Отчёты Green-API о доставке и прочтении сюда не приходят: без базы отметок их негде копить.</p>}
      {onReplies && (
        <Button variant="tinted" icon={MessageCircleReply} className="mt-3 max-md:w-full" onClick={onReplies}>
          Ответы
        </Button>
      )}
    </section>
  );
}

/** Подвкладка «Результаты»: итоги каждой запущенной рассылки со второго номера, новые сверху. Сведения рассылки (с итогами) дочитываем
 *  сами — по 8 за раз: у завершённых их хаб не грузит. compact — три последних на главном виде и «Все результаты» (onAll); запущенных
 *  нет — ничего. */
export function ResultsView({
  rows,
  details,
  load,
  now,
  onOpen,
  onReplies,
  compact,
  onAll,
}: {
  rows: CampaignRow[];
  details: Record<string, CampaignDetail>;
  load: (id: string) => Promise<void>;
  now: number;
  onOpen: (id: string) => void;
  onReplies: () => void;
  compact?: boolean;
  onAll?: () => void;
}) {
  const [limit, setLimit] = useState(compact ? 3 : 8);
  const launched = useMemo(
    () => rows.filter((r) => r.channel === "bot" && r.status !== "ready" && !isScheduled(shown(r, details[r.id]), now)),
    [rows, details, now],
  );
  const list = launched.slice(0, limit);
  const want = list.filter((r) => !details[r.id]).map((r) => r.id).join(",");
  useEffect(() => {
    if (!want) return;
    for (const id of want.split(",")) void load(id).catch(() => {});
  }, [want, load]);

  if (compact)
    return launched.length ? (
      <Group title="Результаты" note="«Записались после» — совпадение по времени, а не доказательство.">
        {list.map((r) => (
          <ResultRow key={r.id} c={shown(r, details[r.id])} loaded={!!details[r.id]} now={now} onOpen={() => onOpen(r.id)} />
        ))}
        {onAll && (
          <div className="py-2">
            <Button variant="ghost" className="-mx-2 text-accent-ink" onClick={onAll}>
              Все результаты
            </Button>
          </div>
        )}
      </Group>
    ) : null;

  return (
    <>
      <div className="mb-4 flex items-start gap-3 rounded-[0.875rem] bg-surface px-4 py-3">
        <MessageCircleReply aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-gold" strokeWidth={1.9} />
        <div className="min-w-0 flex-1">
          <p className="text-ui font-medium pointer-coarse:text-base">Ответы клиентов</p>
          <p className="text-sm text-fg-2">Ответы на рассылки и напоминания — в «Чатах», раздел «Ответы».</p>
        </div>
        <Button size="sm" variant="tinted" onClick={onReplies}>
          Ответы
        </Button>
      </div>
      {!launched.length ? (
        <Group title="Результаты">
          <div className="flex items-start gap-3 py-4">
            <BarChart3 aria-hidden className="mt-0.5 size-5 shrink-0 text-fg-3" strokeWidth={1.75} />
            <p className="text-ui text-fg-2 pointer-coarse:text-base">
              Итогов пока нет: со второго номера ещё не отправляли рассылок. Когда рассылка уйдёт, здесь будет видно, сколько дошло, прочитали, ответили и записались.
            </p>
          </div>
        </Group>
      ) : (
        <Group title="Результаты" note="«Записались после» — запись или визит в Altegio в течение 14 дней после сообщения: совпадение по времени, а не доказательство.">
          {list.map((r) => (
            <ResultRow key={r.id} c={shown(r, details[r.id])} loaded={!!details[r.id]} now={now} onOpen={() => onOpen(r.id)} />
          ))}
          {launched.length > limit && (
            <div className="py-2">
              <Button variant="ghost" className="-mx-2 text-accent-ink" onClick={() => setLimit((l) => l + 8)}>
                Показать ещё {Math.min(8, launched.length - limit)}
              </Button>
            </div>
          )}
        </Group>
      )}
    </>
  );
}

function ResultRow({ c, loaded, now, onOpen }: { c: CampaignRow & Partial<CampaignDetail>; loaded: boolean; now: number; onOpen: () => void }) {
  const st = statusOf(c, now);
  const r = c.results;
  const cells: [string, number | null | undefined][] = r
    ? [
        ["Ушло", r.sent],
        ["Доставлено", r.delivered],
        ["Ответили", r.replied],
        ["Записались после", r.booked],
      ]
    : [["Ушло", c.sent]];
  return (
    <button type="button" onClick={onOpen} className="group -mx-4 block w-[calc(100%+2rem)] px-4 py-3 text-left hover:bg-surface-2/60 focus-visible:-outline-offset-2">
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[0.9375rem] font-semibold md:text-base">{c.name}</span>
          <span className="mt-0.5 block truncate text-sm text-fg-3">
            {st.label} · {[c.segment, shortDate(c.startedAt || c.createdAt, now)].filter(Boolean).join(" · ")}
          </span>
        </span>
        <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-fg-3" />
      </span>
      {!loaded ? (
        <Skeleton className="mt-2 h-10 w-full rounded-lg" />
      ) : (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
          {cells.map(([label, v]) => (
            <div key={label} className="min-w-0">
              <dt className="truncate text-xs text-fg-3">{label}</dt>
              <dd className="text-base font-semibold leading-6">
                <Num v={v} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {loaded && !r && <span className="mt-1 block text-xs text-fg-3">Подробных итогов у этой рассылки нет.</span>}
    </button>
  );
}
