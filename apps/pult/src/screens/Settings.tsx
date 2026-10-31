// Настройки: только то, что работает или уже есть на сервере. Что меняется на других страницах (паспорт бота, ключи
// сотрудников, подключение номеров), — ссылкой туда, а не неработающей кнопкой здесь.
// На телефоне — список разделов → раздел (адрес #/settings/<раздел>); на компьютере — список слева, раздел справа.
import { Bell, Building2, ChevronRight, ExternalLink, KeyRound, MapPin, MessageCircle, Palette, Bot, type LucideIcon, Globe, LogOut } from "lucide-react";
import { useState, type ReactNode } from "react";
import { buttonClass, Button, Field, Segmented } from "@/components/ui";
import { channelTitle, KIND_LONG } from "@/model/channels";
import type { Channel } from "@/model/types";
import { formatPhone } from "@/lib/format";
import { askNotify, notifyState, type NotifyState } from "@/lib/notify";
import { back, navigate } from "@/lib/router";
import { useTheme, type ThemePref } from "@/lib/theme";
import { cn, useMedia } from "@/lib/utils";
import { store, useStore } from "@/state/store";
import { THEMES } from "@/shell/AppShell";
import { Group, Page } from "./Page";
import { PushSettings } from "./PushSettings";

type Section = { id: string; title: string; icon: LucideIcon; render: () => ReactNode };

export default function SettingsScreen({ section }: { section?: string }) {
  const ws = useStore((s) => s.workspace);
  const md = useMedia("(min-width: 768px)");
  const sections: Section[] = [
    { id: "company", title: "Компания", icon: Building2, render: () => <Company /> },
    { id: "channels", title: "Номера и каналы", icon: MessageCircle, render: () => <Channels /> },
    ...(ws && ws.branches.length ? [{ id: "branches", title: "Филиалы", icon: MapPin, render: () => <Branches /> }] : []),
    { id: "access", title: "Доступ", icon: KeyRound, render: () => <Access /> },
    { id: "bot", title: "Бот", icon: Bot, render: () => <BotSection /> },
    { id: "appearance", title: "Оформление", icon: Palette, render: () => <Appearance /> },
    { id: "notifications", title: "Уведомления", icon: Bell, render: () => <Notifications /> },
  ];
  const cur = sections.find((s) => s.id === section) || (md ? sections[0] : null);
  const open = (id: string) => navigate({ name: "settings", section: id }, { replace: md });

  if (!md && cur)
    return (
      <Page title={cur.title} onBack={() => back({ name: "settings" })}>
        {cur.render()}
      </Page>
    );

  return (
    <Page title="Настройки" sub={ws?.name} wide>
      <div className="md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">
        <nav aria-label="Разделы настроек">
          <ul className="max-md:overflow-hidden max-md:rounded-[0.875rem] max-md:bg-surface max-md:[&>li+li>a>span:last-of-type]:border-t max-md:[&>li+li>a>span:last-of-type]:border-line md:space-y-0.5">
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#/settings/${s.id}`}
                  onClick={(e) => (e.preventDefault(), open(s.id))}
                  aria-current={cur?.id === s.id ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 pl-4 text-base active:bg-surface-2 md:min-h-9 md:rounded-lg md:px-2.5 md:text-ui md:active:bg-transparent",
                    cur?.id === s.id ? "md:bg-selected md:font-medium md:text-selected-fg" : "md:text-fg-2 md:hover:bg-surface-3/60 md:hover:text-fg",
                  )}
                >
                  <span className="grid size-[1.875rem] shrink-0 place-items-center rounded-lg bg-surface-2 md:contents">
                    <s.icon aria-hidden className={cn("size-[1.125rem] shrink-0", cur?.id === s.id ? "text-fg-2 md:text-accent" : "text-fg-2 md:text-fg-3")} strokeWidth={1.75} />
                  </span>
                  <span className="flex min-h-12 flex-1 items-center justify-between pr-4 md:min-h-0 md:pr-0">
                    {s.title}
                    <ChevronRight aria-hidden className="size-4 text-fg-3 md:hidden" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <Logout className="mt-6 w-full justify-start rounded-[0.875rem] bg-surface px-4 md:hidden" />
        </nav>
        {md && cur && (
          <div className="min-w-0 max-w-2xl">
            <h2 className="mb-3 px-4 text-lg font-semibold">{cur.title}</h2>
            {cur.render()}
            <Logout className="mt-10" />
          </div>
        )}
      </div>
    </Page>
  );
}

function External({ page, children }: { page: "studio" | "launch" | "broadcast" | "site"; children: ReactNode }) {
  const wsId = useStore((s) => s.wsId);
  const url = wsId ? store.source?.externalUrl(page, wsId) : null;
  if (!url) return null;
  return (
    <a href={url} className={buttonClass("tinted", "md", "mb-6 h-auto min-h-9 whitespace-normal py-1.5 text-left pointer-coarse:h-auto")} target={page === "site" ? "_blank" : undefined} rel="noopener">
      {children}
      <ExternalLink aria-hidden className="size-4 opacity-80" strokeWidth={2} />
    </a>
  );
}

function Company() {
  const ws = useStore((s) => s.workspace);
  const wsId = useStore((s) => s.wsId);
  const list = useStore((s) => s.workspaces);
  const mode = useStore((s) => s.mode);
  if (!ws) return null;
  const kind = list.find((w) => w.id === wsId)?.kind;
  return (
    <>
      <Group note={mode === "demo" ? "Демо-режим: компании, номера и переписки вымышленные." : "Название и всё, что бот знает о компании, задаются в паспорте бота."}>
        <dl className="divide-y divide-line">
          <Field label="Название">{ws.name}</Field>
          {kind && <Field label="Вид">{kind}</Field>}
          <Field label="Код в адресе">
            <span className="tnum">c={ws.id}</span>
          </Field>
          <Field label="Логотип">первая буква названия — загрузки логотипа пока нет</Field>
        </dl>
      </Group>
      <External page="site">Чат на сайте</External>
    </>
  );
}

function Channels() {
  const ws = useStore((s) => s.workspace);
  const mode = useStore((s) => s.mode);
  const report = useStore((s) => s.report);
  const err = useStore((s) => s.reportError);
  if (!ws) return null;
  const list = ws.channels;
  return (
    <>
      <p className="mb-4 px-4 text-sm text-fg-2">
        Каждый чат привязан к номеру, на который написал клиент, и ответ уходит с того же номера. Если клиент писал на два номера — это две переписки одного клиента: в карточке клиента есть переход между ними.
      </p>
      <Group note={!report && !err ? "Проверяю номера…" : err ? `Состояние номеров не получено: ${err}` : undefined}>
        {list.length === 0 && <p className="py-3 text-sm text-fg-3">Пока ни одного чата — номера появятся здесь, когда будут подключены.</p>}
        {list.map((c) => (
          <ChannelRow key={c.id} c={c} branch={ws.branches.find((b) => b.id === c.branchId)?.name} />
        ))}
      </Group>
      {mode === "live" && <p className="-mt-3 mb-4 px-4 text-sm text-fg-3">Своих названий у номеров («ИИ-администратор», «Основной WhatsApp») сервер пока не хранит — показываем номер телефона и вид подключения.</p>}
      <External page="launch">Подключить номер: «Проверка запуска»</External>
    </>
  );
}

function ChannelRow({ c, branch }: { c: Channel; branch?: string }) {
  const Icon = c.kind === "web" ? Globe : MessageCircle;
  return (
    <div className="flex items-start gap-3 py-3">
      <Icon aria-hidden className="mt-px size-[1.125rem] shrink-0 text-fg-3" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <p className="min-w-0 flex-1 text-ui font-medium pointer-coarse:text-base">{channelTitle(c)}</p>
          {c.health && <span className={cn("shrink-0 text-sm font-medium", c.health.level === "ok" ? "text-positive" : "text-critical")}>{c.health.level === "ok" ? c.health.text : "нужна настройка"}</span>}
        </div>
        <p className="text-sm text-fg-2">{[c.name && c.phone ? formatPhone(c.phone) : "", KIND_LONG[c.kind], branch].filter(Boolean).join(". ")}</p>
        {c.health?.level === "warn" && <p className="mt-1 text-sm text-critical">{c.health.text}</p>}
      </div>
    </div>
  );
}

function Branches() {
  const ws = useStore((s) => s.workspace);
  if (!ws) return null;
  return (
    <Group note="Филиал объединяет свои номера: в списке чатов можно выбрать весь филиал или отдельный номер.">
      {ws.branches.map((b) => (
        <div key={b.id} className="py-3">
          <p className="text-ui font-medium pointer-coarse:text-base">{b.name}</p>
          <p className="text-sm text-fg-2">
            {[b.address, ws.channels.filter((c) => c.branchId === b.id).map(channelTitle).join(", ") || "номеров нет"].filter(Boolean).join(". ")}
          </p>
        </div>
      ))}
    </Group>
  );
}

function Access() {
  const session = useStore((s) => s.session);
  const owner = session?.role === "owner";
  return (
    <>
      <Group>
        <dl className="divide-y divide-line">
          <Field label="Вы вошли как">{owner ? "владелец сервиса" : "сотрудник компании"}</Field>
          <Field label="Что видно">{owner ? "все компании" : "чаты только этой компании"}</Field>
        </dl>
      </Group>
      <p className="-mt-3 mb-4 px-4 text-sm text-fg-3">
        {owner ? "Ключ для сотрудников компании выдаётся в «Моих ботах». Новый ключ отключает прежний." : "Ключ входа выдаёт владелец сервиса. Если ключ сменили, войдите заново."}
      </p>
      {owner && <External page="studio">Ключи сотрудников: «Мои боты»</External>}
    </>
  );
}

function BotSection() {
  const ws = useStore((s) => s.workspace);
  const session = useStore((s) => s.session);
  if (!ws) return null;
  return (
    <>
      <Group>
        <dl className="divide-y divide-line">
          <Field label="Бот">{ws.botOff ? <span className="text-critical">выключен — отвечают люди</span> : "отвечает клиентам"}</Field>
          <Field label="Запись в CRM">{ws.capabilities.booking === null ? "видно владельцу сервиса" : ws.capabilities.booking ? "есть" : "нет — заявки администратору"}</Field>
        </dl>
      </Group>
      <p className="-mt-3 mb-4 px-4 text-sm text-fg-3">Цены, график, услуги и что бот делает сам — в паспорте бота. Бот называет цены только оттуда.</p>
      {session?.role === "owner" && <External page="studio">Паспорт бота: «Мои боты»</External>}
    </>
  );
}

function Appearance() {
  const { pref, setTheme } = useTheme();
  return (
    <Group note="«Как в системе» — тема меняется вместе с настройкой телефона или компьютера. Выбор хранится в этом браузере.">
      <div className="py-3">
        <Segmented label="Тема" value={pref} onChange={(v: ThemePref) => setTheme(v)} options={THEMES} className="w-full max-w-md" />
      </div>
    </Group>
  );
}

function Notifications() {
  const mode = useStore((s) => s.mode);
  const wsId = useStore((s) => s.wsId);
  const [st, setSt] = useState<NotifyState>(notifyState);
  if (mode === "demo")
    return (
      <Group>
        <p className="py-3 text-sm text-fg-2">В демо уведомления не приходят.</p>
      </Group>
    );
  // программа для Windows (Tauri) — уведомления Windows, пока программа открыта (push там не работает)
  if ((window as unknown as { __TAURI__?: unknown }).__TAURI__)
    return (
      <Group>
        <p className="py-3 text-sm text-fg-2">{st === "on" ? "Уведомления Windows включены: когда клиент ждёт ответа, придёт уведомление, пока программа открыта." : "Уведомления Windows выключены."}</p>
        {st === "ask" && (
          <Button variant="primary" icon={Bell} className="mb-3" onClick={async () => setSt(await askNotify())}>
            Включить
          </Button>
        )}
      </Group>
    );
  return wsId ? <PushSettings ws={wsId} /> : null;
}

function Logout({ className }: { className?: string }) {
  const mode = useStore((s) => s.mode);
  const wsId = useStore((s) => s.wsId);
  const url = mode === "live" && wsId ? store.source?.externalUrl("logout", wsId) : null;
  if (!url) return null;
  return (
    <a href={url} className={buttonClass("ghost", "md", cn("-ml-2 text-critical hover:bg-critical-soft hover:text-critical max-md:ml-0", className))}>
      <LogOut aria-hidden className="size-4" strokeWidth={2} />
      Выйти
    </a>
  );
}
