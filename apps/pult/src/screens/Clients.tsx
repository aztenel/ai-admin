// Экран «Клиенты»: база с поиском по имени и номеру.
import { Search } from "lucide-react";
import { useState } from "react";
import { CLIENTS } from "@/demo/data";
import { cn } from "@/lib/utils";
import { Avatar, Card, PageTitle } from "./parts";

const COLS = "md:grid-cols-[2.5rem_1.2fr_1fr_5rem_9rem_6rem_7rem]";

export function ClientsScreen() {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase().replace(/\s/g, "");
  const list = CLIENTS.filter((c) => (c.name + c.phone).toLowerCase().replace(/\s/g, "").includes(needle));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageTitle title="Клиенты">
        <span className="rounded-full bg-card px-4 py-2 text-sm font-medium tabular-nums">{CLIENTS.length} в базе</span>
      </PageTitle>
      <Card className="flex min-h-0 flex-1 flex-col">
        <div className="p-4">
          <label className="flex h-10 items-center gap-2 rounded-full bg-muted px-4 md:max-w-sm">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Имя или номер телефона"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>
        <div className={cn("hidden shrink-0 gap-4 border-y bg-muted/50 px-5 py-2.5 text-xs font-medium text-muted-foreground md:grid", COLS)}>
          <span />
          <span>Клиент</span>
          <span>Телефон</span>
          <span className="text-right">Визитов</span>
          <span>Последний визит</span>
          <span>Мастер</span>
          <span>Рассылки</span>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {list.map((c) => (
            <li key={c.id} className={cn("grid grid-cols-[2.5rem_1fr_auto] items-center gap-x-3 border-b px-5 py-3 last:border-b-0 hover:bg-muted/40 md:gap-x-4", COLS)}>
              <Avatar label={c.name === "Без имени" ? c.phone.slice(-2) : c.name.slice(0, 2).toUpperCase()} seed={c.id} size="size-9" className="text-xs" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{c.name}</span>
                <span className="block truncate text-xs text-muted-foreground md:hidden">
                  {c.phone} · {c.last}
                </span>
              </span>
              <span className="text-right text-sm font-semibold tabular-nums text-primary md:hidden">{c.visits}</span>
              <span className="hidden truncate text-sm tabular-nums md:block">{c.phone}</span>
              <span className="hidden text-right text-sm font-semibold tabular-nums md:block">{c.visits}</span>
              <span className="hidden truncate text-sm text-muted-foreground md:block">{c.last}</span>
              <span className="hidden truncate text-sm text-muted-foreground md:block">{c.master}</span>
              <span className="hidden md:block">
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", c.optout ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700")}>
                  {c.optout ? "отказался" : "получает"}
                </span>
              </span>
            </li>
          ))}
          {list.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">Никого не нашли.</li>}
        </ul>
      </Card>
    </div>
  );
}
