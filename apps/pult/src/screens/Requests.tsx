// Заявки: просьбы клиентов, которые ждут человека (заявка, отмена, перенос, звонок), и уже выполненные.
// Данные — /api/inbox/leads (те же, что на странице /leads). Нажатие открывает переписку, если она есть в списке чатов.
import { CalendarClock, ChevronRight, CircleAlert, ClipboardCheck, ClipboardList, PhoneCall, RefreshCw, Repeat } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, IconButton, Skeleton } from "@/components/ui";
import { channelBadge, channelOf } from "@/model/channels";
import type { Lead } from "@/model/types";
import { formatPhone, shortDate } from "@/lib/format";
import { navigate } from "@/lib/router";
import { cn, useNow } from "@/lib/utils";
import { store, useStore } from "@/state/store";
import { Group, Page } from "./Page";

const KIND = { lead: ["Заявка", ClipboardCheck], cancel: ["Просит отменить", CalendarClock], change: ["Просит перенести", Repeat], callback: ["Ждёт звонка", PhoneCall] } as const;

export default function RequestsScreen() {
  const wsId = useStore((s) => s.wsId);
  const ws = useStore((s) => s.workspace);
  const convs = useStore((s) => s.conversations);
  const mode = useStore((s) => s.mode);
  const [st, setSt] = useState<{ list?: Lead[]; error?: string; loading: boolean }>({ loading: true });
  const now = useNow();

  const load = useCallback(async () => {
    if (!store.source || !wsId) return;
    setSt((s) => ({ ...s, loading: true, error: undefined }));
    try {
      setSt({ list: await store.source.leads(wsId), loading: false });
    } catch (e) {
      setSt({ loading: false, error: e instanceof Error ? e.message : "Не удалось загрузить заявки." });
    }
  }, [wsId]);
  useEffect(() => {
    load();
  }, [load]);

  const open = (l: Lead) => {
    const d = l.phone.replace(/\D/g, "");
    const c = convs.find((x) => x.contact.key === d && (!l.channelId || x.ref.channelId === l.channelId)) || convs.find((x) => d && x.contact.key === d);
    if (c) navigate({ name: "inbox", conv: c.key });
    else if (l.phone && mode === "live") location.href = `tel:${l.phone.replace(/[^\d+]/g, "")}`;
  };

  const list = st.list || [];
  const openList = list.filter((l) => !l.status).sort((a, b) => b.at - a.at);
  const doneList = list.filter((l) => l.status).sort((a, b) => b.at - a.at);

  return (
    <Page
      title="Заявки"
      sub={st.list?.length ? (openList.length ? `Не выполнено: ${openList.length}` : "Все просьбы выполнены") : undefined}
      actions={<IconButton icon={RefreshCw} label="Обновить" onClick={load} className={cn(st.loading && st.list && "[&>svg]:animate-spin")} />}
    >
      {st.loading && !st.list ? (
        <div className="space-y-4 pt-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-9 rounded-[0.625rem]" />
              <div className="flex-1 space-y-2 pt-1">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : st.error ? (
        <EmptyState icon={CircleAlert} title="Заявки не загрузились" text={st.error} action={<Button variant="outline" icon={RefreshCw} onClick={load}>Повторить</Button>} />
      ) : list.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Заявок пока нет" text="Они появятся, когда клиент оставит заявку, попросит перенести запись или перезвонить." />
      ) : (
        <>
          {openList.length > 0 && (
            <Group title="Ждут человека">
              {openList.map((l) => (
                <Row key={l.id} l={l} now={now} badge={ws && ws.channels.length > 1 && l.channelId ? channelBadge(channelOf(ws, l.channelId)) : ""} onOpen={() => open(l)} />
              ))}
            </Group>
          )}
          {doneList.length > 0 && (
            <Group title="Выполнены">
              {doneList.slice(0, 40).map((l) => (
                <Row key={l.id} l={l} now={now} done badge={ws && ws.channels.length > 1 && l.channelId ? channelBadge(channelOf(ws, l.channelId)) : ""} onOpen={() => open(l)} />
              ))}
            </Group>
          )}
        </>
      )}
    </Page>
  );
}

function Row({ l, now, done, badge, onOpen }: { l: Lead; now: number; done?: boolean; badge: string; onOpen: () => void }) {
  const [label, Icon] = KIND[l.kind];
  const what = [l.service, l.time].filter(Boolean).join(", ");
  return (
    <button type="button" onClick={onOpen} className="group -mx-4 flex w-[calc(100%+2rem)] items-start gap-3 px-4 py-3 text-left hover:bg-surface-2/60">
      <span className={cn("mt-px grid size-9 shrink-0 place-items-center rounded-[0.625rem]", done ? "bg-surface-2 text-fg-3" : "bg-critical-soft text-critical")}>
        <Icon aria-hidden className="size-[1.125rem]" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-[0.9375rem] font-semibold md:text-base", done && "text-fg-2")}>
            {label}
            {l.name ? `: ${l.name}` : ""}
          </span>
          {done && l.status && <span className="shrink-0 text-sm font-medium text-positive">{l.status}</span>}
        </span>
        {what && <span className="mt-0.5 block text-sm text-fg-2 md:text-ui">{what}</span>}
        {l.note && <span className="mt-0.5 line-clamp-2 text-sm text-fg-3">{l.note}</span>}
        <span className="mt-1 flex items-center gap-3 text-xs text-fg-3">
          <span className="tnum whitespace-nowrap">{shortDate(l.at, now)}</span>
          <span className="tnum whitespace-nowrap">{l.phone ? formatPhone(l.phone) : "без телефона"}</span>
          {badge && <span className="min-w-0 truncate max-sm:hidden">{badge}</span>}
        </span>
      </span>
      <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-fg-3 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100" />
    </button>
  );
}
