// Настройки: только то, что работает или уже есть на сервере. Что меняется на других страницах (паспорт бота, ключи
// сотрудников, подключение номеров), — ссылкой туда, а не неработающей кнопкой здесь.
// На телефоне — список разделов → раздел (адрес #/settings/<раздел>); на компьютере — список слева, раздел справа.
import { logoutWith } from "@/lib/push";
import { Activity, Bell, Building2, ChevronRight, ExternalLink, KeyRound, MapPin, MessageCircle, Palette, Bot, type LucideIcon, Globe, LogOut } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { SyncPanel } from "@/clients/SyncPanel";
import type { ContactsStatus } from "@/model/contacts";
import { buttonClass, Button, Field, Segmented } from "@/components/ui";
import { channelTitle, KIND_LONG } from "@/model/channels";
import type { Channel } from "@/model/types";
import { formatPhone } from "@/lib/format";
import { askNotify, notifyState, type NotifyState } from "@/lib/notify";
import { back, navigate } from "@/lib/router";
import { setBrand, setChatBg, useLook, useTheme, type BrandPref, type ChatBg, type ThemePref } from "@/lib/theme";
import { cn, useMedia } from "@/lib/utils";
import { store, useStore } from "@/state/store";
import { THEMES } from "@/shell/AppShell";
import { Group, Page } from "./Page";
import { PushSettings } from "./PushSettings";

type Section = { id: string; title: string; icon: LucideIcon; render: () => ReactNode };

export default function SettingsScreen({ section }: { section?: string }) {
  const owner = useStore((st) => st.session?.role) === "owner";
  const ws = useStore((s) => s.workspace);
  const md = useMedia("(min-width: 768px)");
  const sections: Section[] = [
    { id: "company", title: "Компания", icon: Building2, render: () => <Company /> },
    { id: "channels", title: "Номера и каналы", icon: MessageCircle, render: () => <Channels /> },
    ...(ws && ws.branches.length ? [{ id: "branches", title: "Филиалы", icon: MapPin, render: () => <Branches /> }] : []),
    { id: "access", title: "Сотрудники и доступ", icon: KeyRound, render: () => <Access /> },
    { id: "bot", title: "Бот", icon: Bot, render: () => <BotSection /> },
    { id: "appearance", title: "Оформление", icon: Palette, render: () => <Appearance /> },
    { id: "notifications", title: "Уведомления", icon: Bell, render: () => <Notifications /> },
    // ТЗ v3.0 §2.1: технические проверки отдельно от настроек и только владельцу
    ...(owner ? [{ id: "diagnostics", title: "Диагностика", icon: Activity, render: () => <Diagnostics /> }] : []),
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
          <Field label="Логотип">первая буква названия</Field>
        </dl>
      </Group>
      <External page="site">Чат на сайте</External>
    </>
  );
}

function Channels() {
  const ws = useStore((s) => s.workspace);
  const owner = useStore((s) => s.session?.role) === "owner";
  const mode = useStore((s) => s.mode);
  const report = useStore((s) => s.report);
  const err = useStore((s) => s.reportError);
  if (!ws) return null;
  const list = ws.channels;
  return (
    <>
      <p className="mb-4 px-4 text-sm text-fg-2">Ответ уходит с того номера, на который написал клиент.</p>
      <Group note={!report && !err ? "Проверяю номера…" : err ? `Состояние номеров не получено: ${err}` : undefined}>
        {list.length === 0 && <p className="py-3 text-sm text-fg-3">Номера появятся здесь после подключения.</p>}
        {list.map((c) => (
          <ChannelRow key={c.id} c={c} branch={ws.branches.find((b) => b.id === c.branchId)?.name} />
        ))}
      </Group>
      <SiteBooking />
      {mode === "live" && owner && <External page="launch">Подключить номер</External>}
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

/** Запись с сайта (ТЗ v3.0 §9, DATA-02): режим — с сервера, без секретов. «Проверка без записи» — время проверяется, а в журнал
 *  Altegio запись вносит администратор по заявке; сайт тогда пишет клиенту «заявка отправлена», а не «вы записаны». */
function SiteBooking() {
  const ws = useStore((s) => s.wsId);
  const site = useStore((s) => (ws ? s.session?.site?.[ws] : undefined));
  if (!site) return null;
  const text = site === "live" ? "Включена: запись сразу попадает в Altegio" : site === "dry" ? "Проверка без записи: заявка уходит администратору, он записывает клиента сам" : "Выключена: кнопки сайта ведут в WhatsApp";
  return (
    <Group title="Запись с сайта">
      <dl className="divide-y divide-line">
        <Field label="Режим">{text}</Field>
      </dl>
    </Group>
  );
}

/** Диагностика — только владельцу: проверки базы клиентов и связи с Altegio (раньше — баннер на экране «Клиенты»). */
function Diagnostics() {
  const ws = useStore((s) => s.wsId);
  const mode = useStore((s) => s.mode);
  const [st, setSt] = useState<{ data?: ContactsStatus; error?: string; rev: number }>({ rev: 0 });
  useEffect(() => {
    let live = true;
    if (!ws || !store.source) return;
    store.source.contactsStatus(ws).then(
      (data) => live && setSt((x) => ({ ...x, data, error: undefined })),
      (e: unknown) => live && setSt((x) => ({ ...x, error: e instanceof Error ? e.message : "Не загрузилось" })),
    );
    return () => {
      live = false;
    };
  }, [ws, st.rev]);
  if (mode === "demo") return <Group><p className="py-3 text-sm text-fg-2">В демо диагностики нет.</p></Group>;
  if (!ws) return null;
  if (st.error) return <Group><p role="alert" className="py-3 text-sm text-critical">Не загрузилось: {st.error}</p></Group>;
  if (!st.data) return <Group><p className="py-3 text-sm text-fg-3">Загружаю…</p></Group>;
  if (!st.data.ready) return <Group><p className="py-3 text-sm text-fg-2">{st.data.why || "База клиентов на этом адресе не подключена."}</p></Group>;
  return <SyncPanel ws={ws} status={st.data} onChanged={() => setSt((x) => ({ ...x, rev: x.rev + 1 }))} />;
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
          <Field label="Вы вошли как">{owner ? "владелец" : "сотрудник компании"}</Field>
          <Field label="Что видно">{owner ? "все компании" : "чаты только этой компании"}</Field>
        </dl>
      </Group>
      <p className="-mt-3 mb-4 px-4 text-sm text-fg-3">
        {owner ? "Ключ для сотрудников выдаётся на странице ботов. Новый ключ отключает прежний." : "Ключ входа выдаёт владелец. Если ключ сменили, войдите заново."}
      </p>
      {owner && <External page="studio">Ключи сотрудников</External>}
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
          <Field label="Бот">{ws.botOff ? "выключен, отвечают администраторы" : "отвечает клиентам"}</Field>
          <Field label="Запись в Altegio">{ws.capabilities.booking === null ? "видно владельцу" : ws.capabilities.booking ? "есть" : "нет, заявки уходят администратору"}</Field>
        </dl>
      </Group>
      <p className="-mt-3 mb-4 px-4 text-sm text-fg-3">Цены, график и услуги бот берёт из паспорта бота.</p>
      {session?.role === "owner" && <External page="studio">Паспорт бота</External>}
    </>
  );
}

const BGS: { id: ChatBg; label: string }[] = [
  { id: "plain", label: "Однотонный" },
  { id: "pattern", label: "Узор" },
  { id: "leather", label: "Кожа" },
];
function Appearance() {
  const { pref, setTheme } = useTheme();
  const look = useLook();
  // «Как у компании»: у Winchester — фирменное оформление, у остальных — нейтральное
  const brands: { id: BrandPref; label: string }[] = [
    { id: "auto", label: look.company === "winchester" ? "Winchester" : "Как у компании" },
    { id: look.company === "winchester" ? "neutral" : "winchester", label: look.company === "winchester" ? "Нейтральное" : "Winchester" },
  ];
  const brandValue: BrandPref = look.brand === "auto" ? "auto" : look.company === "winchester" ? (look.brand === "neutral" ? "neutral" : "auto") : look.brand === "winchester" ? "winchester" : "auto";
  return (
    <>
      <Group title="Оформление">
        <div className="py-3">
          <Segmented label="Оформление" value={brandValue} onChange={(v: BrandPref) => setBrand(v)} options={brands} className="w-full max-w-md" />
        </div>
      </Group>
      <Group title="Режим" note="«Как в системе» меняется вместе с настройкой телефона или компьютера.">
        <div className="py-3">
          <Segmented label="Режим" value={pref} onChange={(v: ThemePref) => setTheme(v)} options={THEMES} className="w-full max-w-md" />
        </div>
      </Group>
      <Group title="Фон переписки">
        <div role="radiogroup" aria-label="Фон переписки" className="grid grid-cols-3 gap-3 py-3">
          {BGS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={look.bg === b.id}
              onClick={() => setChatBg(b.id)}
              className={cn("group flex flex-col items-center gap-2 rounded-2xl p-1.5 text-sm transition-colors", look.bg === b.id ? "bg-selected text-selected-fg" : "text-fg-2 hover:bg-surface-2")}
            >
              <span className="block w-full">
                <span className={cn("chat-bg relative block h-24 w-full overflow-hidden rounded-xl border border-line", `chat-bg-${b.id}`)}>
                  <span className="absolute left-2 top-3 h-4 w-14 rounded-lg bg-bubble-in shadow-card" />
                  <span className="absolute right-2 top-9 h-4 w-12 rounded-lg bg-bubble-op" />
                  <span className="absolute left-2 top-[3.75rem] h-4 w-10 rounded-lg bg-bubble-in shadow-card" />
                </span>
              </span>
              <span className={cn("font-medium", look.bg === b.id && "font-semibold")}>{b.label}</span>
            </button>
          ))}
        </div>
      </Group>
    </>
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
    <a href={url} onClick={(e) => (e.preventDefault(), void logoutWith(url, wsId))} className={buttonClass("ghost", "md", cn("-ml-2 text-critical hover:bg-critical-soft hover:text-critical max-md:ml-0", className))}>
      <LogOut aria-hidden className="size-4" strokeWidth={2} />
      Выйти
    </a>
  );
}
