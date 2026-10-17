// Экран «Рассылки»: автоматические сообщения и разовые рассылки по базе.
import { Megaphone, Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BROADCASTS, type Broadcast } from "@/demo/data";
import { cn } from "@/lib/utils";
import { Card, PageTitle } from "./parts";

const pct = (a?: number, b?: number) => (a && b ? Math.round((a / b) * 100) : 0);

export function BroadcastsScreen() {
  const auto = BROADCASTS.filter((b) => b.kind === "auto");
  const once = BROADCASTS.filter((b) => b.kind === "once");
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <PageTitle title="Рассылки">
        <Button className="h-10 rounded-full px-4">
          <Plus className="size-4 sm:mr-1.5" />
          <span className="max-sm:hidden">Новая рассылка</span>
        </Button>
      </PageTitle>
      <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
        <Card title="Автоматически" icon={<Repeat className="size-4" />}>
          <ul className="divide-y px-5 pb-3">
            {auto.map((b) => (
              <li key={b.id} className="py-3">
                <p className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">{b.name}</span>
                  <Status b={b} />
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {b.when} · {b.audience}
                </p>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Разовые" icon={<Megaphone className="size-4" />}>
          <ul className="divide-y px-5 pb-3">
            {once.map((b) => (
              <li key={b.id} className="grid gap-2 py-3.5 md:grid-cols-[1fr_16rem_6rem] md:items-center md:gap-6">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{b.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {b.audience}
                    {b.when !== "—" ? ` · ${b.when}` : ""}
                  </span>
                </span>
                {b.sent ? (
                  <span className="text-xs text-muted-foreground">
                    <span className="mb-1 flex justify-between">
                      <span>
                        отправлено <b className="font-semibold text-foreground tabular-nums">{b.sent}</b> · прочитали {pct(b.read, b.delivered)}%
                      </span>
                      <span>
                        ответили <b className="font-semibold text-foreground tabular-nums">{b.replied}</b>
                      </span>
                    </span>
                    <span className="block h-2 overflow-hidden rounded-full bg-accent">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${pct(b.read, b.sent)}%` }} />
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">ещё не отправлена</span>
                )}
                <span className="md:text-right">
                  <Status b={b} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <p className="px-1 py-3 text-xs text-muted-foreground">
        Сообщение тем, кто не писал 24 часа, уходит только шаблоном Meta. Ответ «стоп» отписывает клиента от рассылок.
      </p>
    </div>
  );
}

function Status({ b }: { b: Broadcast }) {
  const on = b.status === "включено" || b.status === "отправлена";
  return <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", on ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground")}>{b.status}</span>;
}
