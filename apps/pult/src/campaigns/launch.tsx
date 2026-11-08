// Запуск рассылки со второго номера (финальное ТЗ рассылок Winchester, 02.11.2026) — общее для мастера (GaWizard) и листа рассылки
// (CampaignSheet). Запускает и планирует только владелец. Порядок задаёт сервер (/api/bc/act, act: start):
//  1) есть сигнал о номере («WhatsApp временно ограничил номер») — вопрос сервера (409 { confirm } без final); «Всё равно запустить» —
//     тот же запрос с force, и force дальше идёт в каждом запросе этого запуска (иначе сервер спросит про сигнал снова);
//  2) итоговая аудитория и точный текст (409 { confirm, final }) — лист «Запустить рассылку?»: «Сообщение получат N из M», текст
//     пузырём WhatsApp, предел в сутки, часы и примерно дней;
//  3) «Запустить» — тот же запрос с sure и n (то самое число, которое видел владелец); число изменилось — сервер снова присылает итог,
//     лист показывает новое число и просит подтвердить ещё раз. force аудиторию не подтверждает — только sure и совпавшее n.
// at («Запланировать») — миллисекунды числом. Запрет (ga_off) — честная плашка с текстом сервера как есть; владельцу — как включить
// (how, если сервер его прислал). Текст сообщения пульт не меняет: в листе — ровно то, что прислал сервер.
import { CalendarClock, CircleAlert, Lock, Rocket } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Confirm, Sheet } from "@/components/overlay";
import { Button, Segmented } from "@/components/ui";
import { ApiError } from "@/data/errors";
import { plural } from "@/lib/format";
import { cn, useNow } from "@/lib/utils";
import type { BotNumberState, CampaignDetail, LaunchFinal } from "@/model/campaigns";
import { store } from "@/state/store";
import { nf } from "./base/shared";
import { AT_MAX, AT_MIN, astanaWhen, errorList, fromAstanaInput, toAstanaInput, tomorrowAt } from "./common";
import { WaBubble } from "./WaBubble";

const CLIENTS: [string, string, string] = ["клиент", "клиента", "клиентов"];
const DAYS: [string, string, string] = ["день", "дня", "дней"];

/** Запуск выключен (у Winchester — до решения владельца): почему — словами сервера, как есть; владельцу — как включить (свёрнуто:
 *  это настройка, а не ежедневная работа). */
export function GaOffNotice({ why, how, className }: { why: string; how?: string; className?: string }) {
  return (
    <section role="status" aria-label="Запуск выключен" className={cn("rounded-[0.875rem] border border-line-strong bg-surface px-4 py-3", className)}>
      <p className="flex items-center gap-2 text-[0.9375rem] font-semibold md:text-base">
        <Lock aria-hidden className="size-[1.125rem] shrink-0 text-brand-gold" strokeWidth={1.9} />
        Запуск выключен
      </p>
      <p className="mt-1 text-ui text-fg pointer-coarse:text-base">{why || "Запуск рассылок со второго номера выключен. Его включает владелец отдельным решением."}</p>
      <p className="mt-1 text-sm text-fg-2">Черновик, проверка получателей, тест на ваш номер и одобрение работают.</p>
      {how && (
        <details className="group mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-fg-2">
          <summary className="cursor-pointer list-none font-medium text-accent-ink pointer-coarse:py-1 [&::-webkit-details-marker]:hidden">Как включить</summary>
          <p className="mt-1">{how}</p>
        </details>
      )}
    </section>
  );
}

/** Почему запуск сейчас не пройдёт — по сведениям о номере (сервер проверит это же сам). Пусто — номер готов. Сигнал Green-API
 *  запуск не закрывает: сервер спросит о нём, решает владелец. */
export function botBlock(bot: BotNumberState | null | undefined): string {
  if (bot === undefined) return ""; // сведения о номере ещё не пришли — сервер проверит сам
  if (!bot) return "Второй номер не подключён.";
  if (!bot.ready) return bot.why || "Второй номер не на связи.";
  if (!bot.hook) return bot.warn || "Ответы клиентов не приходят в пульт: номер не настроен до конца.";
  return "";
}

/** force — владелец уже ответил «Всё равно запустить» на вопрос о сигнале: идёт в каждом следующем запросе этого запуска. */
type St = { busy: "" | "start" | "confirm"; id?: string; at?: number; final?: LaunchFinal; prevN?: number; hold?: string; force?: boolean; off?: { why: string; how?: string }; errors?: string[] };

/**
 * Кнопки запуска: «Сразу» или «Запланировать» (дата и время по Астане), лист итоговой аудитории, вопрос о сигнале Green-API.
 * getId — номер рассылки (мастер сначала сохраняет её черновиком); from — первый час отправки (для «завтра в …»).
 * Сотруднику — только пояснение: запускает владелец. Запрет кода — плашка вместо кнопок.
 */
export function LaunchControls({
  ws,
  owner,
  bot,
  from,
  getId,
  onLaunched,
  verb = "Запустить",
  before,
}: {
  ws: string;
  owner: boolean;
  bot: BotNumberState | null | undefined;
  from: number;
  getId: () => Promise<string | null>;
  onLaunched: (c: CampaignDetail) => void;
  /** «Продолжить» — у рассылки на паузе (итог сервер не спрашивает). */
  verb?: string;
  /** Что показать над кнопками (например, «Сохранить черновик»). */
  before?: ReactNode;
}) {
  const now = useNow(60e3);
  const [mode, setMode] = useState<"now" | "plan">("now");
  const [when, setWhen] = useState(() => toAstanaInput(tomorrowAt(Date.now(), from || 11)));
  const [st, setSt] = useState<St>({ busy: "" });
  const at = mode === "plan" ? fromAstanaInput(when) : 0;
  const atBad = mode === "plan" && (!at || at < now + AT_MIN || at > now + AT_MAX);

  const off = bot?.noBroadcast ? { why: bot.noBroadcast, how: bot.how } : st.off;
  if (!owner)
    return (
      <>
        {before}
        <p className="rounded-[0.875rem] bg-surface-2 px-4 py-3 text-sm text-fg-2">Запускает владелец: он проверит итоговую аудиторию и текст и подтвердит запуск.</p>
      </>
    );
  if (off) return (
    <>
      {before}
      <GaOffNotice why={off.why} how={off.how} />
    </>
  );
  const blocked = botBlock(bot);

  const run = async (opts: { sure?: number; force?: boolean } = {}) => {
    const src = store.source;
    if (!src || st.busy) return;
    setSt((s) => ({ ...s, busy: opts.sure !== undefined ? "confirm" : "start", errors: undefined }));
    try {
      const id = st.id || (await getId());
      if (!id) return setSt((s) => ({ ...s, busy: "" }));
      // в одном запуске время не меняется: какое было у первого запроса, то и в подтверждениях
      const plan = st.final || st.force ? st.at : at || undefined;
      const force = !!(opts.force || st.force);
      const r = await src.campaignLaunch(ws, id, { ...(plan ? { at: plan } : {}), ...(opts.sure !== undefined ? { sure: true, n: opts.sure } : {}), ...(force ? { force: true } : {}) });
      if (r.kind === "final") return setSt((s) => ({ busy: "", id, at: plan, force, final: r.final, prevN: s.final && s.final.n !== r.final.n ? s.final.n : undefined }));
      // сигнал о номере: вопрос сервера — решает владелец («Всё равно запустить» — с force)
      if (r.kind === "confirm") return setSt((s) => ({ ...s, busy: "", id, at: plan, force: false, final: undefined, hold: r.question }));
      setSt({ busy: "" });
      onLaunched(r.campaign);
    } catch (e) {
      const a = e instanceof ApiError ? e : null;
      // запрет — текст сервера как есть; how — только если сервер его прислал (владельцу, когда запрет общий)
      if (a?.code === "ga_off") setSt({ busy: "", off: { why: a.message, how: a.how } });
      else setSt((s) => ({ ...s, busy: "", final: undefined, hold: undefined, force: false, errors: errorList(e) }));
    }
  };

  return (
    <>
      {before}
      <div className="space-y-3">
        <Segmented
          label="Когда начать"
          value={mode}
          onChange={setMode}
          options={[
            { id: "now", label: "Сразу" },
            { id: "plan", label: "Запланировать", icon: CalendarClock },
          ]}
          className="w-full"
        />
        {mode === "plan" && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-fg-2">Дата и время начала, по Астане</span>
            <input
              type="datetime-local"
              aria-label="Дата и время начала"
              value={when}
              min={toAstanaInput(now + AT_MIN + 60e3)}
              max={toAstanaInput(now + AT_MAX - 60e3)}
              onChange={(e) => setWhen(e.target.value)}
              className="h-11 w-full min-w-0 rounded-[0.625rem] border border-line-strong bg-surface px-3 text-md text-fg outline-none focus:border-accent dark:bg-surface-2"
            />
            <span className={cn("mt-1.5 block text-sm", atBad ? "text-critical" : "text-fg-3")}>
              {atBad ? "Выберите время не раньше чем через 5 минут и не позже чем через 30 дней." : `Начнётся ${astanaWhen(at)}. Дальше — только в часы отправки.`}
            </span>
          </label>
        )}
        {blocked && (
          <p className="flex gap-2 text-sm text-critical">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
            <span>{blocked}</span>
          </p>
        )}
        {!blocked && bot?.hold && (
          <p className="flex gap-2 text-sm text-critical">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
            <span>Сигнал от Green-API: {bot.hold}. Перед запуском спросим, продолжать ли: отправка при сигнале опасна для номера.</span>
          </p>
        )}
        <Button variant="primary" size="lg" icon={mode === "plan" ? CalendarClock : Rocket} className="w-full" busy={st.busy === "start"} disabled={!!st.busy || atBad || !!blocked} onClick={() => void run()}>
          {mode === "plan" ? "Запланировать" : verb}
        </Button>
        {!!st.errors?.length && (
          <div role="alert" className="rounded-[0.875rem] bg-critical-soft px-4 py-3 text-ui text-critical pointer-coarse:text-base">
            {st.errors.map((x, i) => (
              <p key={i}>{x}</p>
            ))}
          </div>
        )}
      </div>
      <LaunchConfirm
        final={st.final}
        prevN={st.prevN}
        busy={st.busy === "confirm"}
        onYes={() => st.final && void run({ sure: st.final.n })}
        // отмена — весь запуск заново: и вопрос о сигнале, и итог аудитории
        onCancel={() => setSt((s) => ({ ...s, final: undefined, prevN: undefined, force: false }))}
      />
      <Confirm
        open={!!st.hold}
        onOpenChange={(v) => !v && setSt((s) => ({ ...s, hold: undefined }))}
        title="Есть сигнал о номере"
        text={st.hold || ""}
        yes="Всё равно запустить"
        danger
        onYes={() => void run({ force: true })}
      />
    </>
  );
}

/** Лист итоговой аудитории перед запуском: сколько получат, точный текст, предел и часы. «Запустить» — подтверждение именно этого числа. */
export function LaunchConfirm({ final, prevN, busy, onYes, onCancel }: { final?: LaunchFinal; prevN?: number; busy: boolean; onYes: () => void; onCancel: () => void }) {
  const f = final;
  const title = f?.at ? "Запланировать рассылку?" : "Запустить рассылку?";
  return (
    <Sheet
      open={!!f}
      onOpenChange={(v) => !v && !busy && onCancel()}
      title={title}
      description="Проверьте итоговую аудиторию и текст. Остановить можно, но отправленное не вернуть."
      footer={
        <div className="flex gap-2 pb-1">
          <Button className="flex-1" disabled={busy} onClick={onCancel}>
            Отмена
          </Button>
          <Button variant="primary" className="flex-1" icon={f?.at ? CalendarClock : Rocket} busy={busy} onClick={onYes}>
            {f?.at ? "Запланировать" : "Запустить"}
          </Button>
        </div>
      }
    >
      {f && (
        <div className="space-y-3 px-4 pb-3">
          {prevN !== undefined && (
            <p role="alert" className="rounded-xl bg-critical-soft px-3 py-2 text-sm text-critical">
              Число получателей изменилось: было {nf.format(prevN)}, стало {nf.format(f.n)}. Проверьте и подтвердите ещё раз.
            </p>
          )}
          <p className="text-md md:text-base">
            Сообщение получат <b className="tnum text-2xl font-semibold">{nf.format(f.n)}</b> из <span className="tnum">{nf.format(f.rest)}</span>{" "}
            <span className="text-fg-2">{plural(f.rest, CLIENTS)}</span>
          </p>
          {f.rest > f.n && <p className="text-sm text-fg-2">Остальным сейчас нельзя: нет согласия на рекламу, просили не писать, записаны, были недавно или реклама уже была.</p>}
          {f.sample && (
            <div>
              <p className="mb-1 text-sm font-medium text-fg-2">Точный текст</p>
              <WaBubble text={f.sample} />
              <p className="mt-1 text-xs text-fg-3">Так получит первый клиент. У остальных — их имя в приветствии; если имени нет — приветствие без имени.</p>
            </div>
          )}
          <dl className="divide-y divide-line rounded-xl bg-surface-2 px-3 text-sm">
            <Row label="Предел сообщений в сутки">{nf.format(f.cap)}</Row>
            <Row label="Часы отправки">
              с {f.from}:00 до {f.to}:00 по Астане
            </Row>
            <Row label="Примерно">
              {nf.format(f.days)} {plural(f.days, DAYS)}
            </Row>
            {f.at ? <Row label="Начнётся">{astanaWhen(f.at)} по Астане</Row> : null}
          </dl>
        </div>
      )}
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="text-fg-2">{label}</dt>
      <dd className="tnum min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}
