// Рассылки: список и ход отправки — из /api/bc/list. Создают и запускают рассылки пока на странице /broadcast
// (там проверка списка, пробная отправка и защита номера) — сюда она не переносится, чтобы не было двух разных мастеров.
import { CircleAlert, ExternalLink, Megaphone, RefreshCw } from "lucide-react";
import { buttonClass, Button, EmptyState, IconButton, Skeleton } from "@/components/ui";
import { channelTitle, channelOf } from "@/model/channels";
import type { Campaign } from "@/model/types";
import { plural, shortDate } from "@/lib/format";
import { cn, useNow } from "@/lib/utils";
import { store, useStore } from "@/state/store";
import { Group, Page } from "./Page";

const STATUS: Record<string, [string, "ok" | "run" | "muted" | "warn"]> = {
  ready: ["Готова к запуску", "muted"],
  running: ["Идёт отправка", "run"],
  paused: ["На паузе", "warn"],
  stopped: ["Остановлена", "muted"],
  done: ["Завершена", "ok"],
};

export default function CampaignsScreen() {
  const report = useStore((s) => s.report);
  const err = useStore((s) => s.reportError);
  const ws = useStore((s) => s.workspace);
  const wsId = useStore((s) => s.wsId);
  const refreshing = useStore((s) => s.refreshing);
  const now = useNow();
  const ext = wsId ? store.source?.externalUrl("broadcast", wsId) : null;

  const manage = ext ? (
    <a href={ext} className={buttonClass("tinted", "md")}>
      Создать рассылку
      <ExternalLink aria-hidden className="size-4" strokeWidth={2} />
    </a>
  ) : null;

  return (
    <Page
      title="Рассылки"
      sub={report ? `${report.campaigns.length ? `${report.campaigns.length} ${plural(report.campaigns.length, ["рассылка", "рассылки", "рассылок"])}` : "Рассылок пока нет"}${report.optouts ? `, отписались: ${report.optouts}` : ""}` : undefined}
      actions={
        <>
          <IconButton icon={RefreshCw} label="Обновить" onClick={() => store.poll(true)} className={cn(refreshing && "[&>svg]:animate-spin")} />
          <span className="max-sm:hidden">{manage}</span>
        </>
      }
    >
      {!report && !err ? (
        <div className="space-y-4 pt-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : !report ? (
        <EmptyState icon={CircleAlert} title="Рассылки не загрузились" text={err} action={<Button variant="outline" icon={RefreshCw} onClick={() => store.poll(true)}>Повторить</Button>} />
      ) : report.campaigns.length === 0 ? (
        <EmptyState icon={Megaphone} title="Рассылок пока нет" text="Рассылка уходит по одному сообщению с паузой, в рабочие часы. Тем, кто ответил «стоп», не пишем." action={manage} />
      ) : (
        <>
          <Group note={ext ? "Создание, запуск и пауза — на странице рассылок: там же проверка списка и пробная отправка." : "В демо рассылки не отправляются."}>
            {report.campaigns.map((c) => (
              <Row key={c.id} c={c} now={now} channel={ws && ws.channels.length > 1 && c.channelId ? channelTitle(channelOf(ws, c.channelId)) : ""} />
            ))}
          </Group>
          {manage && <div className="sm:hidden">{manage}</div>}
        </>
      )}
    </Page>
  );
}

function Row({ c, now, channel }: { c: Campaign; now: number; channel: string }) {
  const [label, tone] = STATUS[c.status] || [c.status, "muted"];
  const pct = c.total ? Math.round((c.sent / c.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.9375rem] font-semibold md:text-base">{c.name}</p>
        <p className="mt-0.5 truncate text-sm text-fg-3">{[shortDate(c.createdAt, now), channel].filter(Boolean).join(", ")}</p>
      </div>
      <div className="flex items-center gap-4 sm:w-72">
        <div className="min-w-0 flex-1">
          <div className="flex justify-between text-xs text-fg-2">
            <span className="tnum">
              {c.total ? `${c.sent} из ${c.total}` : "список не загружен"}
              {c.failed ? <span className="text-critical">, не дошло {c.failed}</span> : null}
            </span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <div className={cn("h-full rounded-full", tone === "run" || tone === "warn" ? "bg-accent" : "bg-fg-3/60")} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <span className={cn("w-32 shrink-0 text-right text-sm font-medium", tone === "ok" && "text-positive", tone === "run" && "text-accent", tone === "warn" && "text-fg-2", tone === "muted" && "text-fg-3")}>{label}</span>
      </div>
    </div>
  );
}
