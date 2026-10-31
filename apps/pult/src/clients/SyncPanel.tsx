// Панель «Синхронизация и проверки» (только владелец): синхронизация с журналом Altegio — первичная загрузка, окна (вчера…2 недели,
// записи на 60 дней, визиты за месяц), когда прошло и какие ошибки; проверки данных; сверка «стопов» по журналу входящих Green-API
// (не надеемся, что Green-API повторит потерянный вебхук); перенос старого списка «стоп» из KV. Кнопки:
//   «Синхронизировать сейчас» — одна порция (на черновике нет: настоящий Altegio там читается только проверкой без записи);
//   «Проверка без записи» — читает журнал и считает, что изменилось бы, ничего не записывая;
//   «Проверить поля Altegio» — какие поля отдаёт журнал (только чтение, без имён и номеров в ответе);
//   «Тестовые клиенты» — только на черновике: вымышленные клиенты через тот же код записи.
// Итог каждого действия — строками ниже кнопок; состояние перечитывается.
// Проверка, которой ещё не было (уровень unknown), — серый «?» и «ещё не проверено», а не зелёная галочка (жалоба владельца 31.10.2026:
// «ещё не было» выглядело как успех). Уровень показывается как прислал сервер — число 0 не делает проверку успешной.
import { CircleAlert, CircleCheck, CircleHelp, DatabaseZap, FlaskConical, ListChecks, RefreshCw, ScanSearch, ShieldAlert, TriangleAlert, Users } from "lucide-react";
import { useState } from "react";
import { Notice, nf, whenText } from "@/campaigns/base/shared";
import { Confirm } from "@/components/overlay";
import { Button, Field, InsetGroup } from "@/components/ui";
import { cn, useNow } from "@/lib/utils";
import type { CheckLevel, ContactsStatus, StopsAction, SyncMode } from "@/model/contacts";
import { store } from "@/state/store";
import { errMsg, scopeText } from "./common";

type Out = { title: string; lines: string[]; error?: boolean };

export function SyncPanel({ ws, status, onChanged }: { ws: string; status: ContactsStatus; onChanged: () => void }) {
  const now = useNow();
  const [d, setD] = useState(status);
  const [busy, setBusy] = useState("");
  const [out, setOut] = useState<Out | null>(null);
  const [ask, setAsk] = useState(false);
  const s = d.sync;

  const reload = async () => {
    try {
      setD(await store.source!.contactsStatus(ws));
    } catch {
      // состояние не перечиталось — останется прежнее, итог действия уже показан
    }
  };
  const act = async (key: string, title: string, f: () => Promise<string[]>) => {
    setBusy(key);
    setOut(null);
    try {
      const lines = await f();
      setOut({ title, lines: lines.length ? lines : ["Готово."] });
      onChanged();
    } catch (e) {
      setOut({ title, lines: [errMsg(e)], error: true });
    } finally {
      setBusy("");
      void reload();
    }
  };
  const sync = (mode: SyncMode, title: string) =>
    act(mode, title, async () => {
      const r = await store.source!.syncContacts(ws, mode);
      setD((x) => ({ ...x, sync: r.sync }));
      return r.report?.summary || [];
    });
  const probe = () => act("probe", "Проверка полей Altegio", async () => (await store.source!.probeAltegio(ws)).summary);
  const stops = (a: StopsAction, title: string) => act(a, title, () => store.source!.stopsAction(ws, a));

  return (
    <div className="scroll-area min-h-0 flex-1">
      <div className="px-4 pb-[max(1.5rem,var(--safe-b))] pt-2 md:px-6 md:pt-5">
        <InsetGroup title="Altegio">
          {!s.available ? (
            <p className="py-3 text-ui text-fg-2 pointer-coarse:text-base">{s.why || "Altegio не подключён."}</p>
          ) : (
            <>
              {s.dryOnly && (
                <Notice tone="muted">Это тестовая версия: настоящий Altegio здесь только проверяется, данные клиентов сюда не загружаются. Для показа экрана есть тестовые клиенты.</Notice>
              )}
              {!s.dryOnly && (
                <div className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-ui pointer-coarse:text-base">Первичная загрузка</p>
                    <p className="tnum text-sm text-fg-2">{s.initial.done ? "готово" : `${s.initial.pct}%`}</p>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Первичная загрузка"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={s.initial.done ? 100 : s.initial.pct}
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"
                  >
                    <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${s.initial.done ? 100 : s.initial.pct}%` }} />
                  </div>
                  {s.initial.from && (
                    <p className="mt-1.5 text-sm text-fg-3">
                      Журнал с {s.initial.from} по {s.initial.to}
                      {!s.initial.done && s.initial.cursor ? `, дошли до ${s.initial.cursor}` : ""}
                    </p>
                  )}
                </div>
              )}
              <dl>
                <Field label="Последняя удачная">{s.lastOkAt ? whenText(s.lastOkAt, now) : "ещё не было"}</Field>
                {s.running && <Field label="Сейчас">идёт загрузка…</Field>}
              </dl>
              {s.lastError && (
                <Notice tone="critical">
                  Ошибка{s.lastErrorAt ? ` ${whenText(s.lastErrorAt, now)}` : ""}: {s.lastError}
                </Notice>
              )}
              {s.windows.length > 0 && (
                <ul aria-label="Окна синхронизации">
                  {s.windows.map((w) => (
                    <li key={w.scope} className="py-2.5">
                      <p className="text-ui pointer-coarse:text-base">{w.label}</p>
                      <p className={cn("text-sm", w.lastError ? "text-critical" : "text-fg-3")}>
                        {w.lastOkAt ? `прошла ${whenText(w.lastOkAt, now)}` : "ещё не было"}
                        {w.lastError ? ` · ошибка: ${w.lastError}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <Directory s={s} now={now} />
              {s.stats && (
                <p className="py-3 text-sm text-fg-2">
                  Последняя загрузка: записей журнала {nf.format(s.stats.records)}, клиентов {nf.format(s.stats.contacts)}, записей в базе {nf.format(s.stats.bookings)}, удалённых{" "}
                  {nf.format(s.stats.deleted)}; скрытых номеров {nf.format(s.stats.masked)}, неверных {nf.format(s.stats.bad)}.
                </p>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2 py-3">
            {s.available && !s.dryOnly && (
              <Button variant="primary" icon={RefreshCw} busy={busy === "step"} disabled={!!busy || s.running} onClick={() => void sync("step", "Синхронизация")}>
                Синхронизировать сейчас
              </Button>
            )}
            {s.available && (
              <Button variant="tinted" icon={ScanSearch} busy={busy === "dry"} disabled={!!busy} onClick={() => void sync("dry", "Проверка без записи")}>
                Проверка без записи
              </Button>
            )}
            {s.available && (
              <Button variant="tinted" icon={DatabaseZap} busy={busy === "probe"} disabled={!!busy} onClick={() => void probe()}>
                Проверить поля Altegio
              </Button>
            )}
            {d.stage === "preview" && (
              <Button variant="secondary" icon={FlaskConical} busy={busy === "test"} disabled={!!busy} onClick={() => void sync("test", "Тестовые клиенты")}>
                Тестовые клиенты
              </Button>
            )}
          </div>
          {out && <Output out={out} />}
        </InsetGroup>

        {d.probe && (
          <InsetGroup title={`Поля журнала Altegio · ${whenText(d.probe.at, now)}`}>
            <ul aria-label="Поля журнала Altegio" className="py-2">
              {d.probe.summary.map((l, i) => (
                <li key={i} className="py-1 text-ui text-fg pointer-coarse:text-base">
                  {l}
                </li>
              ))}
            </ul>
          </InsetGroup>
        )}

        <InsetGroup title="Проверки данных">
          {d.checks.length === 0 ? (
            <p className="py-3 text-ui text-fg-3 pointer-coarse:text-base">Проверок пока нет.</p>
          ) : (
            <ul aria-label="Проверки данных">
              {d.checks.map((c) => (
                <li key={c.id} className="flex gap-2.5 py-2.5" data-level={c.level}>
                  <Level level={c.level} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className={cn("text-ui pointer-coarse:text-base", c.level === "unknown" && "text-fg-2")}>{c.label}</span>
                      <span className="tnum shrink-0 text-sm text-fg-2">{c.level === "unknown" ? "—" : nf.format(c.count)}</span>
                    </span>
                    {c.level === "unknown" ? (
                      <span className="block text-sm text-fg-3">{c.hint || "Ещё не проверено."}</span>
                    ) : (
                      c.hint && (c.count > 0 || c.level !== "ok") && <span className="block text-sm text-fg-3">{c.hint}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </InsetGroup>

        <InsetGroup title="«Стоп» во втором номере" note="Сверяем входящие второго номера и находим «стоп», даже если сообщение до нас не дошло.">
          {d.stops.channel ? (
            <dl>
              <Field label="Последняя сверка">{d.stops.lastOkAt ? whenText(d.stops.lastOkAt, now) : "ещё не было"}</Field>
              <Field label="Нашла новых «стоп»">{nf.format(d.stops.found)}</Field>
            </dl>
          ) : (
            <p className="py-3 text-ui text-fg-2 pointer-coarse:text-base">Второго номера у компании нет, сверять нечего.</p>
          )}
          {d.stops.lastError && <Notice tone="critical">Ошибка сверки: {d.stops.lastError}</Notice>}
          <div className="flex flex-wrap gap-2 py-3">
            <Button variant="tinted" icon={ShieldAlert} busy={busy === "sweep"} disabled={!!busy || !d.stops.channel} onClick={() => void stops("sweep", "Сверка «стопов»")}>
              Сверить «стопы»
            </Button>
          </div>
        </InsetGroup>

        <InsetGroup title="Старый список «стоп»" note="Номера, которые просили не писать, из прежнего хранилища. Перенос ничего не удаляет; повторный перенос безопасен.">
          <div className="flex flex-wrap gap-2 py-3">
            <Button variant="tinted" icon={ListChecks} busy={busy === "migrate-check"} disabled={!!busy} onClick={() => void stops("migrate-check", "Перенос «стопов»: проверка")}>
              Проверить
            </Button>
            <Button variant="secondary" icon={Users} busy={busy === "migrate"} disabled={!!busy} onClick={() => setAsk(true)}>
              Перенести
            </Button>
          </div>
        </InsetGroup>

        {d.errors.length > 0 && (
          <InsetGroup title="Последние ошибки">
            <ul aria-label="Последние ошибки">
              {d.errors.slice(0, 10).map((e, i) => (
                <li key={i} className="py-2.5">
                  <p className="text-ui text-critical pointer-coarse:text-base">{e.text}</p>
                  <p className="text-sm text-fg-3">{[whenText(e.at, now), e.scope && scopeText(e.scope)].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
          </InsetGroup>
        )}
      </div>
      <Confirm
        open={ask}
        onOpenChange={setAsk}
        title="Перенести старый список «стоп»?"
        text="Номера из прежнего хранилища попадут в базу как запреты рекламы. Ничего не удаляется; если номер уже есть — второй запрет не появится."
        yes="Перенести"
        onYes={() => void stops("migrate", "Перенос «стопов»")}
      />
    </div>
  );
}

function Output({ out }: { out: Out }) {
  return (
    <div role="status" aria-label={out.title} className={cn("mb-3 rounded-[0.625rem] px-3 py-2.5", out.error ? "bg-critical-soft text-critical" : "bg-surface-2 text-fg")}>
      <p className="mb-1 text-sm font-medium">{out.title}</p>
      <ul className="space-y-0.5 text-sm">
        {out.lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

const LEVEL: Record<CheckLevel, { label: string; cls: string }> = {
  ok: { label: "в порядке", cls: "text-positive" },
  warn: { label: "внимание", cls: "text-fg-2" },
  bad: { label: "ошибка", cls: "text-critical" },
  unknown: { label: "ещё не проверено", cls: "text-fg-3" },
};
function Level({ level }: { level: CheckLevel }) {
  const Icon = level === "ok" ? CircleCheck : level === "warn" ? TriangleAlert : level === "unknown" ? CircleHelp : CircleAlert;
  const l = LEVEL[level] || LEVEL.unknown;
  return <Icon role="img" aria-label={l.label} className={cn("mt-0.5 size-4 shrink-0", l.cls)} strokeWidth={2} />;
}

/** Справочник клиентов Altegio: вся база, а не только те, кто был в журнале за 2 года. */
function Directory({ s, now }: { s: ContactsStatus["sync"]; now: number }) {
  const d = s.directory;
  if (!d) return null;
  return (
    <div className="py-3" aria-label="Справочник клиентов Altegio">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-ui pointer-coarse:text-base">Справочник клиентов Altegio</p>
        <p className="tnum text-sm text-fg-2">{d.total ? `${nf.format(Math.round((d.total * (d.done ? 100 : d.pct)) / 100))} из ${nf.format(d.total)}` : d.done ? "готово" : `${d.pct}%`}</p>
      </div>
      <p className={cn("text-sm", d.lastError ? "text-critical" : "text-fg-3")}>
        {d.lastError ? `Ошибка: ${d.lastError}` : d.lastOkAt ? `${d.done ? "прочитан" : "читается"} · ${whenText(d.lastOkAt, now)}` : s.dryOnly ? "в тестовой версии только проверка" : "ещё не читался"}
      </p>
    </div>
  );
}
