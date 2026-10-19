// Мастер «Новая рассылка» — ТОЛЬКО маркетинг с основного номера шаблоном Meta (решение владельца 19.10.2026: выбора номера нет,
// текстом с номера бота рассылки в пульте не создаются). Получатели — сегмент базы клиентов Altegio или вставленный список.
// На телефоне — по шагам (кому → сообщение → часы и предел → проверка, предпросмотр, стоимость, пробная себе → согласие и запуск),
// на компьютере — одной формой. Проверка, создание и запуск — сервер (/api/bc/check, /create, /act start); его тексты — как есть.
// Основного номера нет — мастер не открывается, только объяснение. Черновик живёт в памяти вкладки: случайный жест «назад» его не стирает.
import { ChevronLeft, CircleAlert, Megaphone, RefreshCw, Rocket, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Confirm, toast } from "@/components/overlay";
import { Button, EmptyState, IconButton, Skeleton } from "@/components/ui";
import { formatPhone, plural } from "@/lib/format";
import { cn, useMedia } from "@/lib/utils";
import type { CampaignCheck, CampaignDetail, SegmentSpec } from "@/model/campaigns";
import { Group } from "@/screens/Page";
import { store } from "@/state/store";
import { CONFIRM_OVER, costEstimate, defaultCap, errorList, errText, MARKETING_PRICE_KZT, money } from "./common";
import { useLoad } from "./useLoad";
import { ErrorList } from "./wizard/fields";
import { baseState, checkKey, initialForm, nameOf, resolve, STEP_CHECK, STEP_LAUNCH, STEPS, toDraft, validate, type Errs, type Form } from "./wizard/form";
import { CheckSection, HoursSection, LaunchSection, MessageSection, RecipientsSection, SectionTitle } from "./wizard/steps";

type Props = { ws: string; preset?: { segment?: SegmentSpec; channel?: "main" | "bot" }; onClose(): void; onDone(id: string): void };

/** Черновики по компаниям — только в памяти вкладки (не в localStorage: в списке могут быть номера клиентов). */
const drafts = new Map<string, { form: Form; step: number }>();
const nf = new Intl.NumberFormat("ru-RU");

export default function Wizard({ ws, preset, onClose, onDone }: Props) {
  const md = useMedia("(min-width: 768px)");
  const ov = useLoad((s) => s.campaignsOverview(ws), [ws]);
  const crm = useLoad((s) => s.crmSegments(ws), [ws]);
  const [now] = useState(() => Date.now());

  // черновик: из памяти (если открыли просто «Новая рассылка») или с сегментом из базы клиентов
  const [saved] = useState(() => (preset?.segment ? undefined : drafts.get(ws)));
  const [f, setF] = useState<Form>(() => saved?.form ?? initialForm(preset));
  const [step, setStep] = useState(() => (saved ? Math.min(saved.step, 2) : preset?.segment ? 1 : 0));
  const [restored, setRestored] = useState(!!saved);
  const [shown, setShown] = useState<number[]>([]); // шаги, у которых уже показываем ошибки
  const life = useRef({ f, step, touched: false, done: false });
  life.current.f = f;
  life.current.step = step;
  useEffect(
    () => () => {
      const l = life.current;
      if (l.touched && !l.done) drafts.set(ws, { form: l.f, step: l.step });
    },
    [ws],
  );
  const set = (p: Partial<Form>) => {
    life.current.touched = true;
    setF((x) => ({ ...x, ...p }));
  };

  // предел в сутки по умолчанию — предел номера Meta × 0,95 (или 240), когда узнали предел
  useEffect(() => {
    const d = ov.data;
    if (d) setF((x) => (x.cap === "" ? { ...x, cap: String(defaultCap("main", d)) } : x));
  }, [ov.data]);

  const base = baseState(crm.data, crm.loading);
  const r = useMemo(() => resolve(f, crm.data, base), [f, crm.data, base]);
  const draft = useMemo(() => toDraft(f, r, now), [f, r, now]);
  const key = checkKey(draft);
  const errs: Errs = Object.assign({}, ...shown.map((s) => validate(s, f, r)));

  // ---------- проверка на сервере ----------
  const [chk, setChk] = useState<{ key: string; res: CampaignCheck } | null>(null);
  const [checking, setChecking] = useState(false);
  const [chkErr, setChkErr] = useState("");
  const seq = useRef(0);
  const fresh = !!chk && chk.key === key;
  const checkOk = fresh && chk!.res.ok && !chk!.res.errors.length;
  const runCheck = async () => {
    const src = store.source;
    if (!src) return;
    const my = ++seq.current;
    setChecking(true);
    setChkErr("");
    try {
      const res = await src.checkCampaign(ws, draft);
      if (my === seq.current) setChk({ key, res });
    } catch (e) {
      if (my === seq.current) setChkErr(errText(e));
    } finally {
      if (my === seq.current) setChecking(false);
    }
  };

  /** Показать первую ошибку после отрисовки: поле — с фокусом, ошибку выбора — прокруткой (на телефоне она бывает под кнопками). */
  const showFirstError = () =>
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>("[data-wizard] [aria-invalid='true'], [data-wizard] [data-error]");
      el?.scrollIntoView({ block: "center" });
      if (el && el.matches("input, textarea, select")) el.focus({ preventScroll: true });
    });

  // ---------- создание и запуск ----------
  const [busy, setBusy] = useState<"" | "create" | "start">("");
  const [launchErrs, setLaunchErrs] = useState<string[]>([]);
  const [created, setCreated] = useState<CampaignDetail | null>(null);
  const [ask, setAsk] = useState<null | { kind: "sum" } | { kind: "server"; question: string }>(null);
  /** Вопрос сервера, на который ответили «Отмена» (сигнал Meta), — показываем его как причину. */
  const [declined, setDeclined] = useState("");
  const n = chk?.res.valid || 0;

  const leave = (c: CampaignDetail, text: string) => {
    life.current.done = true;
    drafts.delete(ws);
    toast(text);
    onDone(c.id);
  };
  const start = async (c: CampaignDetail, force = false) => {
    const src = store.source;
    if (!src) return;
    setBusy("start");
    setLaunchErrs([]);
    try {
      const res = await src.campaignAct(ws, c.id, "start", force);
      if (res.kind === "confirm") {
        // сигнал Meta: сервер спрашивает — рассылка уже создана, дальше только «запустить» или «открыть в списке»
        setCreated(c);
        setBusy("");
        setDeclined(res.question);
        setAsk({ kind: "server", question: res.question });
        return;
      }
      if (res.kind === "deleted") return leave(c, "Рассылки больше нет.");
      leave(res.campaign, res.campaign.waitNote ? `Рассылка запущена. ${res.campaign.waitNote}` : "Рассылка запущена — сообщения уходят в фоне.");
    } catch (e) {
      setCreated(c);
      setBusy("");
      setLaunchErrs([errText(e)]);
    }
  };
  /** Создать (если ещё не создана) и, если startNow, запустить. Повторное нажатие после ошибки запуска не создаёт вторую рассылку. */
  const launch = async (startNow: boolean) => {
    const src = store.source;
    if (!src || busy) return;
    if (created) return startNow ? start(created) : leave(created, "Рассылка создана. Запустить её можно в списке рассылок.");
    setBusy("create");
    setLaunchErrs([]);
    let c: CampaignDetail;
    try {
      c = (await src.createCampaign(ws, draft)).campaign;
    } catch (e) {
      setBusy("");
      setLaunchErrs(errorList(e));
      return;
    }
    if (!startNow) return leave(c, "Рассылка создана. Запустить её можно в списке рассылок.");
    await start(c);
  };
  const onLaunch = (startNow: boolean) => {
    const e = validate(STEP_LAUNCH, f, r);
    setShown((s) => (s.includes(STEP_LAUNCH) ? s : [...s, STEP_LAUNCH]));
    if (Object.keys(e).length) return showFirstError();
    if (!checkOk) return setLaunchErrs(["Сначала проверьте рассылку — кнопка «Проверить» выше."]);
    // больше 100 получателей — второе подтверждение с суммой (ТЗ §5.3)
    if (startNow && n > CONFIRM_OVER) return setAsk({ kind: "sum" });
    void launch(startNow);
  };

  // ---------- шаги на телефоне ----------
  const scroller = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
    if (firstStep.current) firstStep.current = false;
    else heading.current?.focus({ preventScroll: true });
  }, [step]);
  const firstErrorStep = (upto: number) => {
    for (let s = 0; s <= upto; s++) if (Object.keys(validate(s, f, r)).length) return s;
    return -1;
  };
  const next = () => {
    if (step < STEP_CHECK) {
      const bad = firstErrorStep(step);
      if (bad >= 0) {
        setShown((s) => Array.from(new Set([...s, ...Array.from({ length: step + 1 }, (_, i) => i)])));
        if (bad !== step) setStep(bad);
        return;
      }
      if (step === STEP_CHECK - 1 && !fresh) void runCheck();
      setStep(step + 1);
    } else if (step === STEP_CHECK && checkOk) setStep(STEP_LAUNCH);
  };
  const close = () => (created ? leave(created, "Рассылка создана, но не запущена — она в списке рассылок.") : onClose());
  const prev = () => (step > 0 && !created ? setStep(step - 1) : close());
  // на компьютере «Проверить» проверяет и поля всех разделов
  const checkAll = () => {
    const bad = firstErrorStep(STEP_CHECK - 1);
    setShown((s) => Array.from(new Set([...s, 0, 1, 2])));
    if (bad >= 0) {
        showFirstError();
      return;
    }
    void runCheck();
  };
  const restart = () => {
    drafts.delete(ws);
    life.current.touched = false;
    setF(initialForm(preset));
    setShown([]);
    setChk(null);
    setRestored(false);
    setStep(0);
    const d = ov.data;
    if (d) setF((x) => ({ ...x, cap: String(defaultCap("main", d)) }));
  };

  // ---------- что показать ----------
  const ovd = ov.data;
  const subtitle = ovd?.main.phone ? `С основного номера ${formatPhone(ovd.main.phone)} · шаблон Meta` : "С основного номера · шаблон Meta";
  const confirms = (
    <>
      <Confirm
        open={ask?.kind === "sum"}
        onOpenChange={(v) => !v && setAsk(null)}
        title={`Отправить ${nf.format(n)} ${plural(n, ["клиенту", "клиентам", "клиентам"])}?`}
        text={`Оценка стоимости: ≈\u00a0${money(costEstimate(n))} (${nf.format(n)} × ${String(MARKETING_PRICE_KZT).replace(".", ",")} ₸), точная цена — в кабинете Meta. Остановить можно, но отправленное не вернуть.`}
        yes={`Да, запустить · ≈\u00a0${money(costEstimate(n))}`}
        onYes={() => {
          setAsk(null);
          void launch(true);
        }}
      />
      <Confirm
        open={ask?.kind === "server"}
        onOpenChange={(v) => !v && setAsk(null)}
        title="Запустить, несмотря на сигнал?"
        text={ask?.kind === "server" ? ask.question : ""}
        yes="Всё равно запустить"
        danger
        onYes={() => {
          setAsk(null);
          if (created) void start(created, true);
        }}
      />
    </>
  );

  if (!ovd)
    return (
      <Frame md={md} title="Новая рассылка" onBack={onClose}>
        {ov.error ? (
          <EmptyState icon={CircleAlert} title="Не удалось открыть мастер" text={ov.error} action={<Button variant="outline" icon={RefreshCw} onClick={() => void ov.reload()}>Повторить</Button>} />
        ) : (
          <div className="space-y-3 pt-2">
            <Skeleton className="h-10 rounded-[0.625rem]" />
            <Skeleton className="h-44 rounded-[0.875rem]" />
            <Skeleton className="h-24 rounded-[0.875rem]" />
          </div>
        )}
      </Frame>
    );

  // у компании нет основного номера (Meta / Wazzapo) — маркетинговую рассылку не сделать
  if (!ovd.main.ready)
    return (
      <Frame md={md} title="Новая рассылка" onBack={onClose}>
        <EmptyState
          icon={Megaphone}
          title="Основной номер не подключён"
          text={
            <>
              Маркетинговые рассылки — только с основного номера WhatsApp (Meta). Он не подключён.
              {ovd.owner && ovd.main.why && <span className="mt-2 block text-sm text-fg-3">{ovd.main.why}</span>}
            </>
          }
          action={<Button variant="outline" onClick={onClose}>Назад к рассылкам</Button>}
        />
      </Frame>
    );

  // создана, но не запустилась (ошибка запуска или «нет» на вопрос о сигнале Meta) — без правки полей: рассылка уже на сервере
  if (created)
    return (
      <Frame
        md={md}
        title="Новая рассылка"
        onBack={close}
        footer={
          <Actions md={md}>
            <Button variant="primary" size="lg" icon={Rocket} busy={busy === "start"} onClick={() => void start(created)} className="max-md:w-full">
              Запустить
            </Button>
            <Button variant="outline" size="lg" disabled={!!busy} onClick={close} className="max-md:w-full">
              Открыть в списке рассылок
            </Button>
          </Actions>
        }
      >
        <Group>
          <div className="py-4">
            <p className="text-lg font-semibold">Рассылка «{created.name}» создана, но ещё не запущена</p>
            <p className="mt-1 text-ui text-fg-2 pointer-coarse:text-base">
              Получат: {nf.format(created.total)}. Запустить можно сейчас или позже — в списке рассылок.
            </p>
          </div>
        </Group>
        {launchErrs.length > 0 ? (
          <ErrorList title="Почему не запустилась" errors={launchErrs} />
        ) : (
          !busy && !ask && declined && <ErrorList title="Запуск не подтверждён" errors={[declined]} />
        )}
        {confirms}
      </Frame>
    );

  const p = { f, set, r, errs };
  const sections = [
    <RecipientsSection key={0} {...p} crm={crm} base={base} owner={ovd.owner} />,
    <MessageSection key={1} {...p} />,
    <HoursSection key={2} {...p} ov={ovd} />,
    <CheckSection key={3} f={f} r={r} res={chk?.res || null} checking={checking} error={chkErr} stale={!!chk && !fresh} onCheck={md ? checkAll : () => void runCheck()} draft={draft} ws={ws} desktop={md} />,
    <LaunchSection key={4} {...p} ov={ovd} res={fresh ? chk!.res : null} name={nameOf(f, r, now)} errors={launchErrs} />,
  ];
  const restoredNote = restored && (
    <p className="mb-4 flex flex-wrap items-center gap-x-2 rounded-[0.875rem] bg-selected px-4 py-2.5 text-sm text-selected-fg">
      Продолжаем черновик.
      <button type="button" onClick={restart} className="font-medium underline-offset-2 hover:underline">
        Начать заново
      </button>
    </p>
  );
  const launchButtons = (
    <>
      <Button variant="primary" size="lg" icon={Rocket} busy={busy !== ""} disabled={md && !checkOk} onClick={() => onLaunch(true)} className="max-md:w-full">
        Создать и запустить
      </Button>
      <Button variant="outline" size="lg" disabled={!!busy || (md && !checkOk)} onClick={() => onLaunch(false)} className="max-md:w-full">
        Создать, запустить позже
      </Button>
    </>
  );

  // компьютер: одна форма
  if (md)
    return (
      <Frame md title="Новая рассылка" sub={subtitle} onBack={onClose}>
        <div data-wizard>
          {restoredNote}
          {sections.map((s, i) => (
            <section key={i} aria-labelledby={`wz-s${i}`} className="mb-4">
              <SectionTitle n={i + 1} show>
                <span id={`wz-s${i}`}>{STEPS[i]}</span>
              </SectionTitle>
              {s}
            </section>
          ))}
          <div className="mb-10 flex flex-wrap items-center gap-2 px-1">
            {launchButtons}
            {!checkOk && (
              <span className="text-sm text-fg-3">
                {!chk ? "Сначала нажмите «Проверить» в разделе «Проверка»." : !fresh ? "Данные изменились — проверьте ещё раз." : "Исправьте то, что нашла проверка, и проверьте ещё раз."}
              </span>
            )}
          </div>
        </div>
        {confirms}
      </Frame>
    );

  // телефон: по шагам
  return (
    <Frame
      md={false}
      title="Новая рассылка"
      onBack={prev}
      backLabel={step > 0 ? "Назад" : "Закрыть"}
      onClose={step > 0 ? close : undefined}
      step={step}
      scroller={scroller}
      footer={
        <Actions md={false}>
          {step < STEP_CHECK && (
            <Button variant="primary" size="lg" onClick={next} className="w-full">
              Далее
            </Button>
          )}
          {step === STEP_CHECK && (
            <Button variant="primary" size="lg" disabled={!checkOk || checking} busy={checking} onClick={next} className="w-full">
              Далее
            </Button>
          )}
          {step === STEP_LAUNCH && launchButtons}
        </Actions>
      }
    >
      <div data-wizard>
        <h2 ref={heading} tabIndex={-1} className="mb-1 px-1 text-[1.625rem] font-bold leading-8 tracking-[-0.022em] outline-none">
          {STEPS[step]}
        </h2>
        <p className="mb-5 px-1 text-ui text-fg-2">
          Шаг {step + 1} из {STEPS.length}
          {step === 0 && ` · ${subtitle.charAt(0).toLowerCase()}${subtitle.slice(1)}`}
        </p>
        {step === 0 && restoredNote}
        {sections[step]}
      </div>
      {confirms}
    </Frame>
  );
}

/** Рамка мастера: на телефоне — шапка со стрелкой и полосой шагов, прокрутка и кнопки внизу (над клавиатурой);
 *  на компьютере — крупный заголовок, как у других экранов, и «Закрыть». Нижние вкладки на подвиде скрывает хаб. */
function Frame({
  md,
  title,
  sub,
  onBack,
  backLabel = "Назад",
  onClose,
  step,
  scroller,
  footer,
  children,
}: {
  md: boolean;
  title: string;
  sub?: string;
  onBack: () => void;
  backLabel?: string;
  onClose?: () => void;
  step?: number;
  scroller?: RefObject<HTMLDivElement | null>;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-canvas" role="region" aria-label={title}>
      <header className="shrink-0 pt-safe">
        {!md ? (
          <>
            <div className="relative flex h-[3.25rem] items-center justify-between px-0.5">
              <IconButton icon={ChevronLeft} label={backLabel} onClick={onBack} className="text-accent hover:text-accent [&>svg]:size-7 [&>svg]:stroke-[2]" />
              <h1 className="pointer-events-none absolute inset-x-14 truncate text-center text-[1.0625rem] font-semibold">{title}</h1>
              {onClose && <IconButton icon={X} label="Закрыть мастер" onClick={onClose} />}
            </div>
            {step !== undefined && (
              <div aria-hidden className="flex gap-1 px-4 pb-2">
                {STEPS.map((_, i) => (
                  <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors", i <= step ? "bg-accent" : "bg-surface-3")} />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl items-end gap-2 px-8 pb-4 pt-7">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
              {sub && <p className="mt-0.5 text-ui text-fg-2">{sub}</p>}
            </div>
            <Button variant="ghost" icon={X} onClick={onBack}>
              Закрыть
            </Button>
          </div>
        )}
      </header>
      <div ref={scroller} className={cn("scroll-area min-h-0 flex-1", md ? "pb-10" : "pb-4")}>
        <div className={cn("mx-auto w-full max-w-3xl pt-1", md ? "px-8" : "px-4 pt-3")}>{children}</div>
      </div>
      {footer && (
        <div className={cn("shrink-0", md ? "border-t border-line bg-surface" : "border-t border-line bg-canvas")}>
          <div className={cn("mx-auto w-full max-w-3xl", md ? "px-8 py-3" : "pb-safe-kb px-4 pt-2.5")}>{footer}</div>
        </div>
      )}
    </div>
  );
}

function Actions({ md, children }: { md: boolean; children: ReactNode }) {
  return <div className={cn("flex gap-2", md ? "flex-wrap items-center" : "flex-col")}>{children}</div>;
}
