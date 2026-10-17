// Экран «Бот»: паспорт компании (что бот знает) и что бот делает сам.
import { Bot, BookOpen } from "lucide-react";
import { useState } from "react";
import { BOT_SWITCHES, PASSPORT } from "@/demo/data";
import { Card, PageTitle, Toggle } from "./parts";

export function BotSettingsScreen() {
  const [sw, setSw] = useState(BOT_SWITCHES);
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <PageTitle title="Бот" />
      <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        <Card title="Что бот знает о компании" icon={<BookOpen className="size-4" />}>
          <dl className="divide-y px-5">
            {PASSPORT.map((p) => (
              <div key={p.label} className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
                <dt className="text-sm text-muted-foreground">{p.label}</dt>
                <dd className="text-sm font-medium">{p.value}</dd>
              </div>
            ))}
          </dl>
          <p className="px-5 pb-4 pt-2 text-xs text-muted-foreground">Цены бот называет только отсюда. Меняется на странице «Мои боты».</p>
        </Card>
        <Card title="Что бот делает сам" icon={<Bot className="size-4" />}>
          <ul className="divide-y px-5">
            {sw.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-4 py-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{s.label}</span>
                  <span className="block text-xs text-muted-foreground">{s.hint}</span>
                </span>
                <Toggle label={s.label} on={s.on} onChange={(on) => setSw((all) => all.map((x) => (x.id === s.id ? { ...x, on } : x)))} />
              </li>
            ))}
          </ul>
          <p className="px-5 pb-4 pt-2 text-xs text-muted-foreground">Здесь переключатели только для вида — настоящие настройки не меняются.</p>
        </Card>
      </div>
    </div>
  );
}
