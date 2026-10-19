// Пульт чатов: каркас, разделы и состояния запуска (вход, выбор компании, ошибка).
// Чаты — в основной сборке (открываются первыми); заявки, рассылки и настройки грузятся при первом открытии.
import { CircleAlert, RefreshCw } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { ChunkBoundary } from "@/components/boundary";
import { Toasts } from "@/components/overlay";
import { Button, EmptyState, Spinner } from "@/components/ui";
import { InboxScreen } from "@/inbox/InboxScreen";
import { useRoute } from "@/lib/router";
import { useThemeBoot } from "@/lib/theme";
import { AppShell } from "@/shell/AppShell";
import { Monogram } from "@/shell/WorkspaceSwitcher";
import { store, useStore } from "@/state/store";

const RequestsScreen = lazy(() => import("@/screens/Requests"));
const CampaignsScreen = lazy(() => import("@/screens/Campaigns"));
const SettingsScreen = lazy(() => import("@/screens/Settings"));

export default function App() {
  useThemeBoot();
  const route = useRoute();
  const phase = useStore((s) => s.phase);
  const error = useStore((s) => s.error);
  const ws = useStore((s) => s.workspace);
  const all = useStore((s) => s.conversations);

  useEffect(() => {
    store.boot();
  }, []);

  // заголовок вкладки и окна программы для Windows: сколько ждут ответа и какая компания
  const waiting = all.filter((c) => c.attention).length;
  useEffect(() => {
    document.title = `${waiting ? `(${waiting}) ` : ""}Чаты${ws ? ` — ${ws.name}` : ""}`;
  }, [waiting, ws]);

  if (phase === "pick") return <PickWorkspace />;
  if (phase === "error" && !ws)
    return (
      <div className="app-root grid place-items-center bg-surface px-6">
        <EmptyState icon={CircleAlert} title="Пульт не открылся" text={error} action={<Button variant="primary" icon={RefreshCw} onClick={() => location.reload()}>Обновить</Button>} />
      </div>
    );

  return (
    <AppShell route={route}>
      {route.name === "inbox" ? (
        <InboxScreen route={route} />
      ) : (
        // раздел — отдельным файлом: не загрузился (нет связи) — «Повторить», а не пустой экран; смена раздела — рамка заново
        <ChunkBoundary key={route.name}>
          <Suspense
            fallback={
              <div className="grid flex-1 place-items-center">
                <Spinner />
              </div>
            }
          >
            {route.name === "requests" && <RequestsScreen />}
            {route.name === "campaigns" && <CampaignsScreen />}
            {route.name === "settings" && <SettingsScreen section={route.section} />}
          </Suspense>
        </ChunkBoundary>
      )}
      <Toasts />
    </AppShell>
  );
}

/** Владелец сервиса открыл пульт без ?c= — выбрать компанию. */
function PickWorkspace() {
  const list = useStore((s) => s.workspaces);
  return (
    <div className="app-root scroll-area bg-surface pt-safe">
      <div className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">Выберите компанию</h1>
        <p className="mt-1 text-sm text-fg-2">Пульт открывает чаты одной компании. Сменить её можно в любой момент — нажмите на название над списком чатов.</p>
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {list.map((w) => (
            <li key={w.id}>
              <button type="button" onClick={() => store.selectWorkspace(w.id)} className="flex min-h-14 w-full items-center gap-3 py-2 text-left hover:bg-surface-2 md:-mx-2 md:w-[calc(100%+1rem)] md:rounded-lg md:px-2">
                <Monogram name={w.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium">{w.name}</span>
                  <span className="block truncate text-xs text-fg-3">{[w.kind, w.id].filter(Boolean).join(", ")}</span>
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="py-6 text-sm text-fg-3">Компаний нет — создайте бота в «Моих ботах».</li>}
        </ul>
      </div>
    </div>
  );
}
