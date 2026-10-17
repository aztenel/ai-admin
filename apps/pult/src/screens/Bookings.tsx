// Экран «Записи» по образцу D15 (Dribbble «Barbara»): цифры дня, записи по часам, выручка, загрузка, источники записей,
// недавние клиенты, записи по дням. Графики — из 21st.dev: G7 (объёмные столбики), G16 (цифры, кольцо, области),
// G26 (радиальные кольца). В настоящем пульте — из журнала Altegio; здесь данные вымышленные.
import { BarChart3, CalendarCheck, ChevronDown, PieChart, Scissors, Store, TrendingUp, UserRound, Users } from "lucide-react";
import { useState } from "react";
import { Bars3D } from "@/components/ui/chart-3d-bars";
import { RadialBars } from "@/components/ui/radial-bars";
import { AreaTrend, DonutBreakdown, KpiCard } from "@/components/ui/revenue-charts-kpi";
import { BOOKINGS, CLIENTS, type Booking } from "@/demo/data";
import { cn } from "@/lib/utils";
import { Avatar, Card, money, PageTitle } from "./parts";

const TONE: Record<Booking["status"], { time: string; label: string }> = {
  пришёл: { time: "text-emerald-600", label: "пришёл" },
  ждём: { time: "text-primary", label: "ждём" },
  отменяет: { time: "text-rose-600", label: "отменяет" },
  новая: { time: "text-amber-600", label: "новая" },
};

// выручка по месяцам, ₸ (ноябрь и декабрь ещё впереди — их нет)
const REVENUE = [
  ["Янв", 820000], ["Фев", 905000], ["Мар", 870000], ["Апр", 790000], ["Май", 1010000],
  ["Июн", 940000], ["Июл", 985000], ["Авг", 1060000], ["Сен", 1209000], ["Окт", 1245000],
].map(([label, value]) => ({ label: label as string, value: value as number }));

// записи по дням за 2 недели: бот / администратор
const DAILY = Array.from({ length: 14 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - 13 + i);
  return {
    day: d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }),
    bot: [6, 8, 7, 9, 5, 11, 12, 7, 9, 10, 8, 12, 13, 3][i],
    admin: [3, 2, 4, 3, 2, 4, 5, 3, 2, 3, 4, 3, 4, 1][i],
  };
});

const mln = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2).replace(".", ",")} млн ₸` : `${Math.round(v / 1000)} тыс ₸`);

export function BookingsScreen() {
  const [day, setDay] = useState<Booking["day"]>("today");
  const list = BOOKINGS.filter((b) => b.day === day).sort((a, b) => a.time.localeCompare(b.time));
  const [selected, setSelected] = useState<string | null>(list.find((b) => b.status === "ждём")?.id ?? null);
  const came = list.filter((b) => b.status === "пришёл").length;
  const active = list.filter((b) => b.status !== "отменяет").length;
  const byBot = list.filter((b) => b.source === "бот").length;
  const sum = list.filter((b) => b.status !== "отменяет").reduce((s, b) => s + b.price, 0);

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <PageTitle title="Записи">
        <span className="flex h-10 items-center gap-2 rounded-full bg-card px-4 text-sm font-medium max-sm:hidden">
          <Store className="size-4" /> Барбершоп «Демо»
        </span>
        <div className="flex h-10 items-center gap-0.5 rounded-full bg-card p-1 text-sm font-medium">
          {(["today", "tomorrow"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDay(d);
                setSelected(null);
              }}
              className={cn("h-8 rounded-full px-3.5 transition-colors", day === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {d === "today" ? "Сегодня" : "Завтра"}
            </button>
          ))}
          <ChevronDown className="mx-1 size-4 text-muted-foreground max-sm:hidden" />
        </div>
      </PageTitle>

      {/* цифры дня: синяя плитка как в D15 + плитки G16 с маленьким графиком */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="relative overflow-hidden rounded-2xl bg-primary p-5 text-primary-foreground">
          <div aria-hidden className="absolute -right-6 -top-10 size-40 rotate-12 rounded-3xl bg-white/10" />
          <div aria-hidden className="absolute -bottom-12 right-10 size-32 rotate-45 rounded-3xl bg-white/10" />
          <p className="relative flex items-center gap-2 text-sm font-medium">
            <Users className="size-4" /> Клиентов за месяц
          </p>
          <p className="relative mt-3 text-3xl font-semibold tabular-nums">
            842 <span className="text-sm font-medium text-white/80">+4,2%</span>
          </p>
          <p className="relative mt-2 text-xs text-white/80">из них новых — 96</p>
        </div>
        <KpiCard
          className="rounded-2xl p-5 ring-0"
          label={day === "today" ? `Записей сегодня · через бота ${byBot}` : `Записей завтра · через бота ${byBot}`}
          value={list.length}
          delta={0.333}
          period="к прошлой неделе"
          trend={[3, 5, 4, 6, 5, 3, list.length]}
        />
        <KpiCard className="rounded-2xl p-5 ring-0" label="Ожидаемая выручка" value={money(sum)} delta={0.12} period="к прошлой неделе" trend={[22, 26, 24, 31, 27, 25, sum / 1000]} />
        <KpiCard className="rounded-2xl p-5 ring-0" label="Выручка за месяц" value={money(1245000)} delta={0.03} period="к сентябрю" trend={REVENUE.map((r) => r.value)} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {/* записи по часам — как «Today's Appointments» в D15 */}
        <Card title={day === "today" ? "Записи на сегодня" : "Записи на завтра"} icon={<CalendarCheck className="size-4" />} action={<span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{list.length} всего</span>}>
          <ol className="px-5 pb-5">
            {list.map((b) => {
              const t = TONE[b.status];
              const isSel = b.id === selected;
              return (
                <li key={b.id} className="grid grid-cols-[3.5rem_1fr] items-center gap-3 py-1.5">
                  <span className="text-sm tabular-nums text-muted-foreground">{b.time.replace(":", ".")}</span>
                  <button
                    type="button"
                    onClick={() => setSelected(isSel ? null : b.id)}
                    className={cn(
                      "rounded-lg border border-transparent px-3 py-1.5 text-left transition-colors",
                      isSel ? "border-primary bg-card shadow-sm ring-1 ring-primary" : "hover:bg-muted/60",
                    )}
                  >
                    <span className={cn("block text-xs font-semibold tabular-nums", t.time)}>
                      {b.time} · {t.label}
                    </span>
                    <span className="block text-sm font-semibold">
                      {b.client} <span className="font-normal text-muted-foreground">({b.service})</span> <span className="text-muted-foreground">| {b.master}</span>
                    </span>
                    {isSel && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {b.phone} · {money(b.price)} · {b.source === "бот" ? "записал бот" : "записал администратор"}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </Card>

        {/* выручка по месяцам — G7, объёмные столбики */}
        <Card
          title="Выручка по месяцам"
          icon={<BarChart3 className="size-4" />}
          action={
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <TrendingUp className="size-3.5" /> +3%
            </span>
          }
        >
          <div className="px-3 pb-3">
            <Bars3D data={REVENUE} seriesLabel="Выручка" format={money} />
          </div>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {/* загрузка — G26, радиальные кольца */}
        <Card title="Загрузка за день" icon={<Scissors className="size-4" />}>
          <div className="grid items-center gap-4 px-5 pb-5 sm:grid-cols-[1fr_auto] md:grid-cols-1 2xl:grid-cols-[1fr_auto]">
            <RadialBars
              center="73%"
              centerLabel="занято"
              data={[
                { key: "salon", label: "Весь салон", value: 73, slot: 1 },
                { key: "arman", label: "Арман", value: 82, slot: 2 },
                { key: "daniyar", label: "Данияр", value: 64, slot: 3 },
              ]}
            />
            <ul className="space-y-2 text-sm">
              {[
                ["Весь салон", 73, "bg-chart-1"],
                ["Арман", 82, "bg-chart-2"],
                ["Данияр", 64, "bg-chart-3"],
              ].map(([name, v, c]) => (
                <li key={name as string} className="flex items-center justify-between gap-6">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className={cn("h-2.5 w-2.5 rounded-[3px]", c as string)} />
                    {name}
                  </span>
                  <span className="font-semibold tabular-nums">{v}%</span>
                </li>
              ))}
              <li className="pt-1 text-xs text-muted-foreground">
                пришли {came} из {active} · {list.length - active} отменяет
              </li>
            </ul>
          </div>
        </Card>

        {/* откуда записи — G16, кольцо */}
        <Card title="Откуда записи за месяц" icon={<PieChart className="size-4" />}>
          <div className="px-5 pb-5">
            <DonutBreakdown
              size={150}
              centerLabel="записей"
              description="Источники записей за месяц"
              data={[
                { label: "Бот в WhatsApp", value: 182, slot: 1 },
                { label: "Бот на сайте", value: 31, slot: 2 },
                { label: "Администратор", value: 60, slot: 4 },
                { label: "Без записи", value: 11, slot: 5 },
              ]}
            />
          </div>
        </Card>

        {/* недавние клиенты */}
        <Card title="Недавние клиенты" icon={<UserRound className="size-4" />} className="md:col-span-2 xl:col-span-1">
          <ul className="divide-y px-5 pb-3">
            {CLIENTS.filter((c) => c.name !== "Без имени")
              .slice(0, 4)
              .map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2.5">
                  <Avatar label={c.name.slice(0, 2).toUpperCase()} seed={c.id} size="size-10" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{c.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.master} · {c.last}
                    </span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-primary">{c.visits}</span>
                </li>
              ))}
          </ul>
        </Card>
      </div>

      {/* записи по дням — G16, области */}
      <Card title="Записи по дням: бот и администратор" icon={<TrendingUp className="size-4" />} className="mt-3">
        <div className="px-5 pb-5">
          <AreaTrend
            data={DAILY}
            xKey="day"
            height={220}
            description="Записи за две недели: сколько записал бот и сколько администратор"
            series={[
              { key: "bot", label: "Записал бот", slot: 1 },
              { key: "admin", label: "Записал администратор", slot: 4 },
            ]}
          />
        </div>
      </Card>
      <p className="px-1 py-3 text-xs text-muted-foreground">В настоящем пульте — из журнала Altegio. Здесь данные вымышленные. Выручка: {mln(1245000)} в октябре.</p>
    </div>
  );
}
