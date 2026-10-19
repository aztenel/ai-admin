// История рассылок: строки из /api/bc/list и полные сведения незавершённых (/api/bc/get) — заметка «почему пауза»,
// «продолжу в …», «фон молчит». Как старая страница /broadcast: для готовых, идущих и стоящих на паузе сразу берём рассылку целиком,
// идущие опрашиваем раз в 5 с (только видимая вкладка). Рассылка перестала идти — один раз перечитываем обзор (дорогой запрос:
// сервер спрашивает Meta и Green-API) — там пределы и «отправлено за 24 часа».
// Старые рассылки с номера бота (ch "ga") показываются с подписью «номер бота»: создавать и запускать их в пульте нельзя (решение владельца 19.10.2026).
import { Bot, ChevronRight, List, Megaphone, Repeat, UsersRound, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Skeleton } from "@/components/ui";
import { shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CampaignDetail, CampaignRow, CampaignStatus } from "@/model/campaigns";
import { Group } from "@/screens/Page";
import { store } from "@/state/store";
import { progressPct, progressText, STATUS, type Tone } from "./common";

const POLL_MS = 5000;
/** Не завершены: для них нужна рассылка целиком (заметка, ожидание). */
export const UNFINISHED: ReadonlySet<CampaignStatus> = new Set(["ready", "running", "paused"]);

export type Shown = CampaignRow & Partial<CampaignDetail>;

/** Строка с последними сведениями: полная рассылка новее строки списка (её опрашиваем). */
export const shown = (r: CampaignRow, d?: CampaignDetail): Shown => (d ? { ...r, ...d } : r);

/**
 * Полные сведения незавершённых рассылок и опрос идущих. extra — рассылка, открытая в листе (её опрашиваем, даже если строки
 * в списке ещё нет: только что создана). onSettled — рассылка перестала идти (перечитать обзор).
 */
export function useCampaignDetails(ws: string, rows: CampaignRow[] | undefined, extra: string | null, onSettled: () => void) {
  const [details, setDetails] = useState<Record<string, CampaignDetail>>({});
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const ref = useRef(details);
  ref.current = details;
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // смена компании — прежние сведения не про то (экран обычно и так закрывается: пульт уводит на «Чаты»)
  useEffect(() => {
    setDetails({});
    setGone(new Set());
  }, [ws]);

  // номер последнего запроса или действия по каждой рассылке: ответ опроса, ушедшего раньше «Пауза», приходит позже ответа «Пауза» и
  // затирал его — лист снова показывал «Идёт отправка» (находка проверки 19.10.2026). Применяем только ответ самого свежего.
  const ver = useRef<Record<string, number>>({});
  const bump = (id: string) => (ver.current[id] = (ver.current[id] || 0) + 1);
  const apply = useCallback((d: CampaignDetail) => {
    const was = ref.current[d.id];
    ref.current = { ...ref.current, [d.id]: d }; // два ответа подряд до перерисовки: второй видит первый
    setDetails((prev) => ({ ...prev, [d.id]: d }));
    if (was && was.status === "running" && d.status !== "running") settledRef.current();
  }, []);
  /** Ответ действия (запуск, пауза…) — свежее любого опроса, который ещё в пути. */
  const upsert = useCallback(
    (d: CampaignDetail) => {
      bump(d.id);
      apply(d);
    },
    [apply],
  );
  const remove = useCallback((id: string) => {
    setGone((prev) => new Set(prev).add(id));
    setDetails((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  /** Перечитать рассылку целиком. Ошибка — исключением (лист покажет её); ответ, который обогнали, не применяется. */
  const load = useCallback(
    async (id: string) => {
      const src = store.source;
      if (!src) return;
      const my = bump(id);
      const d = await src.campaign(ws, id);
      if (alive.current && ver.current[id] === my) apply(d);
    },
    [ws, apply],
  );
  // опрос и дочитывание: ошибку не показываем — строка списка остаётся как есть, ошибку покажет лист рассылки, если её открыть
  const fetchOne = useCallback((id: string) => load(id).catch(() => {}), [load]);

  // незавершённые без полных сведений (или сведения отстали от строки) — дочитать
  useEffect(() => {
    if (!rows) return;
    for (const r of rows) {
      if (!UNFINISHED.has(r.status)) continue;
      const d = ref.current[r.id];
      if (!d || d.status !== r.status || d.pos !== r.pos) void fetchOne(r.id);
    }
  }, [rows, fetchOne]);

  // опрос идущих — только видимая вкладка; вернулись во вкладку — сразу
  const running = useMemo(() => {
    const ids = (rows || []).filter((r) => (details[r.id]?.status ?? r.status) === "running").map((r) => r.id);
    if (extra && details[extra]?.status === "running" && !ids.includes(extra)) ids.push(extra);
    return ids.join(",");
  }, [rows, details, extra]);
  useEffect(() => {
    if (!running) return;
    const ids = running.split(",");
    const tick = () => {
      if (!document.hidden) ids.forEach((id) => void fetchOne(id));
    };
    const t = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [running, fetchOne]);

  return { details, gone, upsert, remove, load };
}

const TONE: Record<Tone, string> = {
  ok: "text-positive",
  run: "text-accent-ink",
  warn: "text-fg",
  critical: "text-critical",
  muted: "text-fg-3",
};

/** Статус словами. Рассылку с номера бота в пульте не запускают — «готова к запуску» ей не пишем. */
export function statusOf(c: Pick<CampaignRow, "status" | "channel">): { label: string; tone: Tone } {
  if (c.channel === "bot" && c.status === "ready") return { label: "Не запущена", tone: "muted" };
  return STATUS[c.status] || { label: c.status, tone: "muted" };
}

function kindOf(c: Shown): { icon: LucideIcon; label: string } {
  if (c.channel === "bot") return { icon: Bot, label: "номер бота, обычный текст" };
  if (c.by === "auto") return { icon: Repeat, label: "автосценарий" };
  if (c.source === "crm") return { icon: UsersRound, label: c.segment ? `база: ${c.segment}` : "база клиентов" };
  return { icon: c.source === "list" ? List : Megaphone, label: c.segment ? `список: ${c.segment}` : "по списку" };
}

/** Почему стоит или чего ждёт — одной строкой под ходом (полная фраза — в листе рассылки). */
function noteOf(c: Shown): { text: string; critical: boolean } | null {
  if (c.status === "running" && c.stalled) return { text: "Фоновая отправка молчит больше двух минут — откройте, чтобы отправить порцию.", critical: true };
  if (c.status === "running" && c.waitNote) return { text: c.waitNote, critical: false };
  if ((c.status === "paused" || c.status === "stopped") && c.note) return { text: c.note, critical: c.status === "paused" && c.note !== "Остановлена вручную." };
  return null;
}

function Row({ c, now, onOpen }: { c: Shown; now: number; onOpen: () => void }) {
  const st = statusOf(c);
  const k = kindOf(c);
  const note = noteOf(c);
  const pct = progressPct(c);
  const by = c.by === "staff" ? "сотрудник" : "";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group -mx-4 flex w-[calc(100%+2rem)] items-start gap-3 px-4 py-3 text-left hover:bg-surface-2/60 focus-visible:-outline-offset-2"
    >
      <span className={cn("mt-px grid size-9 shrink-0 place-items-center rounded-[0.625rem]", c.status === "running" ? "bg-accent-soft text-accent-ink" : "bg-surface-2 text-fg-2")}>
        <k.icon aria-hidden className="size-[1.125rem]" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[0.9375rem] font-semibold md:text-base">{c.name}</span>
        <span className="mt-0.5 block truncate text-sm text-fg-3">
          <span className={cn("font-medium", TONE[st.tone])}>{st.label}</span>
          {" · "}
          {[k.label, shortDate(c.createdAt, now), by].filter(Boolean).join(" · ")}
        </span>
        {c.status === "ready" && c.total > 0 && (
          <span className="tnum mt-1 block text-xs text-fg-2">
            получателей: {c.total}
          </span>
        )}
        {c.status !== "ready" && c.total > 0 && (
          <span className="mt-2 block">
            <span className="block h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
              <span className={cn("block h-full rounded-full", c.status === "running" || c.status === "paused" ? "bg-accent" : c.status === "done" ? "bg-positive" : "bg-fg-3/60")} style={{ width: `${pct}%` }} />
            </span>
            <span className="tnum mt-1 block text-xs text-fg-2">{progressText(c)}</span>
          </span>
        )}
        {c.total === 0 && <span className="mt-1 block text-xs text-fg-3">получателей нет</span>}
        {note && <span className={cn("mt-1 line-clamp-2 text-sm", note.critical ? "text-critical" : "text-fg-2")}>{note.text}</span>}
      </span>
      <ChevronRight aria-hidden className="mt-2.5 size-4 shrink-0 text-fg-3 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100" />
    </button>
  );
}

/** Группа рассылок: в работе (готовы, идут, на паузе) или завершённые. Длинную историю раскрываем по 15. */
export function CampaignList({
  title,
  rows,
  details,
  now,
  onOpen,
  note,
  page = 15,
}: {
  title: string;
  rows: CampaignRow[];
  details: Record<string, CampaignDetail>;
  now: number;
  onOpen: (id: string) => void;
  note?: string;
  page?: number;
}) {
  const [limit, setLimit] = useState(page);
  if (!rows.length) return null;
  const list = rows.slice(0, limit);
  return (
    <Group title={title} note={note}>
      {list.map((r) => (
        <Row key={r.id} c={shown(r, details[r.id])} now={now} onOpen={() => onOpen(r.id)} />
      ))}
      {rows.length > limit && (
        <div className="py-2">
          <Button variant="ghost" className="-mx-2 text-accent-ink" onClick={() => setLimit((l) => l + page)}>
            Показать ещё {Math.min(page, rows.length - limit)}
          </Button>
        </div>
      )}
    </Group>
  );
}

export function ListSkeleton() {
  return (
    <section className="mb-6" aria-hidden>
      <Skeleton className="mb-2 ml-4 h-3.5 w-32" />
      <div className="space-y-4 rounded-[0.875rem] bg-surface px-4 py-3.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-9 rounded-[0.625rem]" />
            <div className="flex-1 space-y-2 pt-0.5">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-1 w-full" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
