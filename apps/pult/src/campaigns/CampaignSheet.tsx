// Одна рассылка: ход, почему стоит или чего ждёт, действия и «Не дошло — почему». Лист снизу на телефоне, панель справа на компьютере.
// Действия и подтверждения — как на старой странице /broadcast (её больше нет в пульте): «Запустить»/«Продолжить» — с числом получателей,
// у шаблонов больше 100 получателей — второе подтверждение с оценкой суммы; сервер спросил про сигнал «остановиться» (409 confirm) —
// вопрос сервера и тот же запрос с force — только владельцу: запуск при сигнале снимает сигнал для всего номера (сотруднику сервер
// отвечает 403, а его вопрос пульт показывает как причину). «Остановить совсем» и «Удалить» — необратимы, с подтверждением.
// Старые рассылки с номера бота (Green-API) не запускаются и не продолжаются из пульта (решение владельца 19.10.2026): их можно
// поставить на паузу, остановить и удалить. Ход идущей рассылки опрашивает хаб (useCampaignDetails), сюда приходят свежие сведения.
import { CircleAlert, Clock, ListX, Pause, Play, Send, Square, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Confirm, Sheet, toast } from "@/components/overlay";
import { Button, Field, Skeleton } from "@/components/ui";
import { plural, shortDate, timeHM } from "@/lib/format";
import { cn, useMedia } from "@/lib/utils";
import type { CampaignAct, CampaignDetail, CampaignRow } from "@/model/campaigns";
import { store } from "@/state/store";
import { CHANNEL_LABEL, CONFIRM_OVER, costText, errText, ownerOnly, progressPct, type Tone } from "./common";
import { statusOf } from "./History";

const nf = new Intl.NumberFormat("ru-RU");
const TONE: Record<Tone, string> = { ok: "text-positive", run: "text-accent-ink", warn: "text-fg", critical: "text-critical", muted: "text-fg-3" };
const DONE_TOAST: Record<CampaignAct, string> = { start: "Рассылка запущена", pause: "Рассылка на паузе", stop: "Рассылка остановлена", delete: "Рассылка удалена" };
const TICK_TOAST: Record<string, string> = {
  running: "Порция отправлена",
  wait: "Сейчас отправлять рано: рассылка ждёт часов отправки, предела или паузы",
  busy: "Порция уже отправляется",
  done: "Рассылка завершена",
  paused: "Рассылка встала на паузу",
  stopped: "Рассылка остановлена",
};
const BY: Record<string, string> = { owner: "владелец", staff: "сотрудник", auto: "автосценарий «Пора на стрижку»" };
const MANUAL = "Остановлена вручную.";

type Ask = { title: string; text: ReactNode; yes: string; danger?: boolean; run: () => void };
type Bad = { loading: boolean; lines?: string[]; error?: string };

export function CampaignSheet({
  ws,
  id,
  row,
  detail,
  now,
  open,
  owner,
  onOpenChange,
  onChange,
  load,
  onDeleted,
  onStarted,
}: {
  ws: string;
  id: string;
  /** Строка из истории — пока рассылка целиком не загружена. */
  row?: CampaignRow;
  /** Рассылка целиком — свежая (опрос хаба). */
  detail?: CampaignDetail;
  now: number;
  open: boolean;
  /** Владелец: только ему — «Всё равно продолжить» при сигнале «остановиться». */
  owner: boolean;
  onOpenChange: (v: boolean) => void;
  /** Ответ действия — свежие сведения рассылки. */
  onChange: (d: CampaignDetail) => void;
  /** Перечитать рассылку (useCampaignDetails: ответ, который обогнал более свежий, не применяется). */
  load: (id: string) => Promise<void>;
  onDeleted: (id: string) => void;
  /** Запуск прошёл — хаб перечитывает обзор (сигнал Meta мог сняться). */
  onStarted: () => void;
}) {
  const md = useMedia("(min-width: 768px)");
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState<CampaignAct | "tick" | null>(null);
  const [err, setErr] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [bad, setBad] = useState<Bad | null>(null);

  // открыли — рассылку целиком заново: строка списка без заметок, сведения хаба могли отстать
  useEffect(() => {
    setErr("");
    setBad(null);
    setLoadErr("");
    if (!open) return;
    let live = true;
    load(id).catch((e) => live && setLoadErr(errText(e)));
    return () => {
      live = false;
    };
    // load не в зависимостях: перезапрашиваем только при открытии и смене рассылки
  }, [open, ws, id]);

  const c: (CampaignRow & Partial<CampaignDetail>) | undefined = detail ?? row;

  const act = async (a: CampaignAct, force = false) => {
    const src = store.source;
    if (!src || !c) return;
    setBusy(a);
    setErr("");
    try {
      const r = await src.campaignAct(ws, c.id, a, force);
      if (r.kind === "confirm") {
        if (owner) setAsk({ title: "Есть сигнал «остановиться»", text: r.question, yes: "Всё равно продолжить", danger: true, run: () => void act(a, true) });
        else setErr(ownerOnly(r.question));
      } else if (r.kind === "deleted") {
        toast(DONE_TOAST.delete);
        onDeleted(c.id);
      } else {
        onChange(r.campaign);
        toast(a === "start" && r.campaign.status !== "running" ? r.campaign.note || "Готово" : DONE_TOAST[a]);
        if (a === "start") onStarted();
      }
    } catch (e) {
      setErr(errText(e));
      // запуск не удался, а рассылка на сервере могла измениться (очередь не записалась — сервер ставит её на паузу): перечитываем,
      // иначе лист показывал бы «Готова к запуску» и «Запустить» вместо «Продолжить» (находка проверки 19.10.2026)
      if (a === "start") void load(c.id).catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  const tick = async () => {
    const src = store.source;
    if (!src || !c) return;
    setBusy("tick");
    setErr("");
    try {
      const r = await src.campaignTick(ws, c.id);
      onChange(r.campaign);
      toast(TICK_TOAST[r.state] || "Готово");
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const loadBad = async () => {
    const src = store.source;
    if (!src || !c) return;
    setBad({ loading: true });
    try {
      const r = await src.campaignBad(ws, c.id);
      setBad({ loading: false, lines: r.lines });
    } catch (e) {
      setBad({ loading: false, error: errText(e) });
    }
  };

  /** «Запустить»/«Продолжить»: подтверждение с числом получателей; у шаблонов больше 100 — второе, с оценкой суммы. */
  const askStart = () => {
    if (!c) return;
    const left = Math.max(0, c.total - c.pos);
    const verb = c.status === "paused" ? "Продолжить" : "Запустить";
    const main = c.channel === "main";
    const big: Ask = {
      title: `Отправить ${nf.format(left)} ${plural(left, ["сообщение", "сообщения", "сообщений"])}?`,
      text: `Это большая рассылка шаблоном Meta. ${costText("main", left)}`,
      yes: `Да, ${verb.toLowerCase()}`,
      run: () => void act("start"),
    };
    setAsk({
      title: `${verb} рассылку?`,
      text: `«${c.name}»: сообщение получат до ${nf.format(left)} ${plural(left, ["человека", "человек", "человек"])}. Остановить можно, но уже отправленное не вернуть.${main ? ` ${costText("main", left)}` : ""}`,
      yes: verb,
      run: () => (main && left > CONFIRM_OVER ? setAsk(big) : void act("start")),
    });
  };

  const st = c ? statusOf(c) : null;
  const isBot = c?.channel === "bot";
  const finished = c?.status === "done" || c?.status === "stopped";
  const mainAction =
    c && !isBot && (c.status === "ready" || c.status === "paused") ? (
      <Button variant="primary" size="lg" icon={Play} className="w-full" busy={busy === "start"} disabled={!!busy && busy !== "start"} onClick={askStart}>
        {c.status === "paused" ? "Продолжить" : "Запустить"}
      </Button>
    ) : c?.status === "running" ? (
      <Button variant="secondary" size="lg" icon={Pause} className="w-full" busy={busy === "pause"} disabled={!!busy && busy !== "pause"} onClick={() => void act("pause")}>
        Пауза
      </Button>
    ) : null;

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        side={md ? "right" : "auto"}
        title={c?.name || "Рассылка"}
        description={c && st ? <span className={cn("font-medium", TONE[st.tone])}>{st.label}</span> : undefined}
        footer={mainAction ? <div className="pb-1">{mainAction}</div> : undefined}
      >
        <div className="space-y-5 px-4 pb-4 pt-1">
          {!c ? (
            loadErr ? (
              <p role="alert" className="flex gap-2 text-ui text-critical">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
                {loadErr}
              </p>
            ) : (
              <div className="space-y-3" aria-hidden>
                <Skeleton className="h-24 w-full rounded-[0.875rem]" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            )
          ) : (
            <>
              <Progress c={c} />
              <Notes c={c} now={now} />

              {err && (
                <p role="alert" className="flex gap-2 text-ui text-critical pointer-coarse:text-base">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
                  <span>{err}</span>
                </p>
              )}

              {c.status === "running" && c.stalled && !isBot && (
                <div className="rounded-[0.875rem] bg-surface-2 px-4 py-3">
                  <p className="text-ui pointer-coarse:text-base">Фоновая отправка молчит больше двух минут. Можно отправить порцию вручную.</p>
                  <Button variant="outline" icon={Send} className="mt-3" busy={busy === "tick"} disabled={!!busy && busy !== "tick"} onClick={() => void tick()}>
                    Отправить порцию сейчас
                  </Button>
                </div>
              )}

              {isBot && !finished && (
                <p className="text-sm text-fg-2">
                  Это рассылка с номера бота. Запускать и продолжать такие рассылки в пульте нельзя: массовые сообщения с обычного WhatsApp — главная причина блокировок. Остановить или удалить — можно.
                </p>
              )}

              {(c.failed > 0 || (c.fails && c.fails.length > 0)) && (
                <section>
                  <h3 className="mb-1.5 text-sm font-medium text-fg-3">Почему не дошло</h3>
                  {c.fails && c.fails.length > 0 && (
                    <ul className="space-y-1 text-ui pointer-coarse:text-base">
                      {c.fails.map((f) => (
                        <li key={String(f.code)}>
                          <span className="tnum font-medium">{nf.format(f.n)}</span> — {f.hint || `ошибка ${f.code}`}
                        </li>
                      ))}
                    </ul>
                  )}
                  {c.failed > 0 &&
                    (bad?.lines ? (
                      bad.lines.length ? (
                        <ul aria-label="Кому не дошло" className="tnum mt-2 max-h-64 space-y-1 overflow-y-auto rounded-[0.625rem] bg-surface-2 px-3 py-2 text-sm text-fg-2">
                          {bad.lines.map((l, i) => (
                            <li key={i}>{l}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-sm text-fg-3">Номеров с ошибками нет.</p>
                      )
                    ) : (
                      <>
                        <Button variant="outline" icon={ListX} className="mt-2" busy={bad?.loading} onClick={() => void loadBad()}>
                          Не дошло — почему
                        </Button>
                        {bad?.error && <p className="mt-2 text-sm text-critical">{bad.error}</p>}
                      </>
                    ))}
                </section>
              )}

              <Details c={c} now={now} />

              {(c.message || c.text) && (
                <section>
                  <h3 className="mb-1.5 text-sm font-medium text-fg-3">{isBot ? "Сообщение" : "Текст шаблона — его видят администратор и бот"}</h3>
                  <p className="max-w-[90%] whitespace-pre-wrap break-words rounded-[1.125rem] rounded-tl-md bg-bubble-bot px-3 py-[0.4375rem] text-md md:text-base">{c.message || c.text}</p>
                </section>
              )}

              <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                {!finished && (
                  <Button
                    variant="danger"
                    icon={Square}
                    busy={busy === "stop"}
                    disabled={!!busy && busy !== "stop"}
                    onClick={() =>
                      setAsk({ title: "Остановить рассылку совсем?", text: "Продолжить её будет нельзя. Уже отправленное не вернуть.", yes: "Остановить", danger: true, run: () => void act("stop") })
                    }
                  >
                    Остановить совсем
                  </Button>
                )}
                {c.status !== "running" && (
                  <Button
                    variant="danger"
                    icon={Trash2}
                    busy={busy === "delete"}
                    disabled={!!busy && busy !== "delete"}
                    onClick={() => setAsk({ title: "Удалить рассылку?", text: "Рассылка удалится вместе со списком номеров.", yes: "Удалить", danger: true, run: () => void act("delete") })}
                  >
                    Удалить
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </Sheet>
      <Confirm
        open={!!ask}
        onOpenChange={(v) => !v && setAsk(null)}
        title={ask?.title || ""}
        text={ask?.text || ""}
        yes={ask?.yes || "Да"}
        danger={ask?.danger}
        onYes={() => ask?.run()}
      />
    </>
  );
}

/** Ход: сколько ушло из скольких, полоска, остальное — мелко. */
function Progress({ c }: { c: CampaignRow & Partial<CampaignDetail> }) {
  const pct = progressPct(c);
  const extra = [
    c.failed ? `не дошло ${nf.format(c.failed)}` : "",
    c.skipped ? `просили не писать ${nf.format(c.skipped)}` : "",
    c.excluded ? `уже записались или им писали ${nf.format(c.excluded)}` : "",
    c.unsure ? `неизвестно, дошло ли (сбой), — до ${nf.format(c.unsure)}` : "",
  ].filter(Boolean);
  return (
    <section className="rounded-[0.875rem] bg-surface-2 px-4 py-3">
      <p className="tnum text-2xl font-semibold leading-8">
        {nf.format(c.sent)} <span className="text-base font-normal text-fg-2">из {nf.format(c.total)} отправлено</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Ход рассылки" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={cn("h-full rounded-full", c.status === "done" ? "bg-positive" : c.status === "stopped" ? "bg-fg-3/60" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
      {extra.length > 0 && <p className="tnum mt-2 text-sm text-fg-2">{extra.join(" · ")}</p>}
    </section>
  );
}

/** Почему стоит, чего ждёт, когда повтор — словами сервера. */
function Notes({ c, now }: { c: CampaignRow & Partial<CampaignDetail>; now: number }) {
  const out: ReactNode[] = [];
  if (c.status === "running") {
    if (c.waitNote)
      out.push(
        <p key="wait" className="flex gap-2 text-ui pointer-coarse:text-base">
          <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-3" strokeWidth={2} />
          <span>{c.waitNote}</span>
        </p>,
      );
    if (c.retryAt)
      out.push(
        <p key="retry" className="text-ui pointer-coarse:text-base">
          Временный отказ{c.retryWhy ? `: ${c.retryWhy}` : ""} — повторю в {timeHM(c.retryAt)}.
        </p>,
      );
    out.push(
      <p key="bg" className="text-sm text-fg-2">
        Отправка идёт в фоне — {c.channel === "bot" ? "по одному сообщению раз в 1–3 минуты" : "по порции в минуту"}. Лист можно закрыть: итог придёт в Telegram.
        {c.lastSentAt ? ` Последняя отправка: ${shortDate(c.lastSentAt, now)}.` : ""}
      </p>,
    );
  }
  if ((c.status === "paused" || c.status === "stopped") && c.note) {
    const plain = c.note === MANUAL;
    out.push(
      <p key="note" role={plain ? undefined : "alert"} className={cn("rounded-[0.875rem] px-4 py-3 text-ui pointer-coarse:text-base", plain ? "bg-surface-2 text-fg" : "bg-critical-soft text-critical")}>
        {c.note}
      </p>,
    );
  }
  return out.length ? <div className="space-y-2">{out}</div> : null;
}

/** Подробности: номер, кому, шаблон, часы, предел, кто и когда. */
function Details({ c, now }: { c: CampaignRow & Partial<CampaignDetail>; now: number }) {
  const who = c.source === "crm" ? `база клиентов${c.segment ? `: ${c.segment}` : ""}` : `по списку${c.segment ? ` · ${c.segment}` : ""}`;
  return (
    <section>
      <h3 className="mb-0.5 text-sm font-medium text-fg-3">Подробно</h3>
      <dl className="divide-y divide-line">
        <Field label="Номер">{CHANNEL_LABEL[c.channel]}</Field>
        <Field label="Кому">{who}</Field>
        {c.template && (
          <Field label="Шаблон Meta">
            <span className="break-all">{c.template}</span>
            {c.lang ? <span className="text-fg-3"> · {c.lang}</span> : null}
          </Field>
        )}
        {c.from !== undefined && c.to !== undefined && (
          <Field label="Часы отправки">
            <span className="tnum">
              {c.from}:00–{c.to}:00
            </span>{" "}
            <span className="text-fg-3">по Астане</span>
          </Field>
        )}
        {!!c.cap && (
          <Field label="Предел за 24 часа">
            <span className="tnum">{nf.format(c.cap)}</span> <span className="text-fg-3">на номер</span>
          </Field>
        )}
        {c.image && <Field label="Картинка">есть</Field>}
        <Field label="Создана">
          {shortDate(c.createdAt, now)}
          {c.by && BY[c.by] ? <span className="text-fg-3"> · {BY[c.by]}</span> : null}
        </Field>
        {!!c.crmAt && <Field label="База на момент создания">{shortDate(c.crmAt, now)}</Field>}
        {!!c.startedAt && <Field label="Запущена">{shortDate(c.startedAt, now)}</Field>}
        {!!c.lastSentAt && c.status !== "running" && <Field label="Последняя отправка">{shortDate(c.lastSentAt, now)}</Field>}
        {!!c.doneAt && <Field label="Завершена">{shortDate(c.doneAt, now)}</Field>}
      </dl>
    </section>
  );
}
