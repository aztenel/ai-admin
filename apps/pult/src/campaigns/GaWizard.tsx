// «Создать рассылку» со второго номера (финальное ТЗ рассылок Winchester, 02.11.2026). Шаги ровно такие:
//  1 «Аудитория» — сегмент базы Altegio: все клиенты сегмента и сколько из них можно писать рекламу;
//  2 «Сообщение» — утверждённые тексты по категориям с поиском или свой текст; галочка строки «стоп» (по умолчанию выключена:
//    утверждённые тексты не меняем);
//  3 «Предпросмотр» — пузырь WhatsApp на настоящем имени из примера и тот же текст без имени;
//  4 «Проверка» — сколько получат, кто исключён и почему (правила компании отдельно от разрешений), «технически можно написать» и
//    «можно писать рекламу», предел сообщений в сутки (по умолчанию 50, до 300), часы и примерно сколько дней; некому писать рекламу —
//    точная причина и порядок получения согласий (consent.tsx);
//  5 «Тест» — «Отправить тест» на номер владельца (настоящая отправка Green-API, номер для проверки — из «Автоматических»);
//  6 «Сохранение и запуск» — «Сохранить черновик» (все), «Одобрить» (владелец, пока запуск выключен), «Запустить» / «Запланировать»
//    (владелец, через лист итоговой аудитории — launch.tsx); запрет кода — честная плашка, владельцу — как включить.
// Текст пульт не собирает и не меняет: имя в приветствие, строку «стоп» и текст каждому клиенту собирает сервер (/api/bc/check, /test,
// /act); в предпросмотре и в листе запуска — то, что он прислал. Без согласия и после «стоп» реклама не уходит никогда — это решает
// сервер. На телефоне — во весь экран (хаб: WizardLayer), «назад» — на прошлый шаг; после сохранения правка закрыта: рассылка уже на
// сервере — «назад» открывает её лист.
import { Check, ChevronLeft, CircleCheck, FlaskConical, MessageSquareText, RefreshCw, Search, Smartphone, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "@/components/overlay";
import { Button, Skeleton } from "@/components/ui";
import { ApiError } from "@/data/errors";
import { formatPhone, plural } from "@/lib/format";
import { cn, useMedia } from "@/lib/utils";
import type {
  BotNumberState,
  CampaignCheck,
  CampaignDetail,
  CampaignDraft,
  CrmMetrics,
  CrmSegment,
  FunnelReason,
  LibraryCat,
  LibraryItem,
  SegmentSpec,
  TemplatePreview,
  TemplateVar,
} from "@/model/campaigns";
import { store } from "@/state/store";
import { newRid } from "./autoText";
import { nf, Notice, segRule } from "./base/shared";
import { astanaWhen, errorList, errText, segmentTitle, STOP_RU } from "./common";
import { ConsentHowTo } from "./consent";
import { LaunchControls } from "./launch";
import { byCategory, matches, snippet, usable } from "./libtext";
import { DEFAULT_VARS, hasBlanks, toCanon } from "./vars";
import { WaBubble } from "./WaBubble";
import type { WizardBack } from "./Wizard";
import { Checkbox } from "./wizard/fields";
import { Actions, Frame } from "./wizard/frame";

export const GA_STEPS = ["Аудитория", "Сообщение", "Предпросмотр", "Проверка", "Тест", "Сохранение и запуск"];
const LAST = GA_STEPS.length - 1;
const SUB = ["кому отправить", "что написать", "как увидит клиент", "кто получит и сколько в день", "пробное сообщение себе", "черновик, одобрение и запуск"];
const HOURS = Array.from({ length: 15 }, (_, i) => i + 8); // 8–22
const CLIENTS: [string, string, string] = ["клиент", "клиента", "клиентов"];
const DAYS: [string, string, string] = ["день", "дня", "дней"];
const CAP_MAX = 300;

/** Все клиенты сегмента (у старого сервера — только те, кому можно писать). */
const totalOf = (s: CrmSegment) => s.total ?? s.n;

export type GaPreset = { tplId?: string; seg?: string; spec?: SegmentSpec };
type Base = { segs: CrmSegment[]; metrics: CrmMetrics | null; why: string };
type Test = { busy?: boolean; ok?: string; preview?: string; off?: string; error?: string; retry?: boolean };

export default function GaWizard({
  ws,
  owner,
  bot,
  preset,
  onClose,
  onDone,
  onMeta,
  backRef,
}: {
  ws: string;
  owner: boolean;
  bot: BotNumberState | null | undefined;
  preset?: GaPreset;
  onClose: () => void;
  /** Рассылка сохранена (или запущена) — хаб открывает её лист. */
  onDone: (id: string) => void;
  /** Вкладка «Meta» (компания без базы или без второго номера: шаблоны Meta по списку — там). */
  onMeta: () => void;
  backRef?: WizardBack;
}) {
  const md = useMedia("(min-width: 768px)");
  const [step, setStep] = useState(0);
  const [base, setBase] = useState<Base | null>(null);
  const [baseErr, setBaseErr] = useState("");
  const [seg, setSeg] = useState(preset?.seg || preset?.spec?.id || "");
  const [lib, setLib] = useState<{ items: LibraryItem[]; cats: LibraryCat[]; vars: TemplateVar[] } | null>(null);
  const [libErr, setLibErr] = useState("");
  // выбранный текст: номер текста библиотеки, "" — свой текст, null — ещё не выбран (по умолчанию ничего не выбрано)
  const [tplId, setTplId] = useState<string | null>(preset?.tplId || null);
  const [own, setOwn] = useState("");
  const [stop, setStop] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(preset?.tplId ? "" : null); // null — подобрать по сегменту
  const [chk, setChk] = useState<{ key: string; data?: CampaignCheck; error?: string } | null>(null);
  const [pv, setPv] = useState<{ key: string; data?: TemplatePreview; error?: string } | null>(null);
  const [cap, setCap] = useState(String(bot?.cap.def || 50));
  const [from, setFrom] = useState(11);
  const [to, setTo] = useState(20);
  const [testPhone, setTestPhone] = useState<string | null>(null);
  const [phoneIn, setPhoneIn] = useState("");
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [test, setTest] = useState<Test>({});
  const [tested, setTested] = useState(false);
  const rid = useRef<string | null>(null);
  const [created, setCreated] = useState<CampaignDetail | null>(null);
  const [busy, setBusy] = useState<"" | "draft" | "approve">("");
  const [errors, setErrors] = useState<string[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [retry, setRetry] = useState(0);

  // база и библиотека — при открытии мастера (он монтируется заново при каждом открытии)
  useEffect(() => {
    const src = store.source;
    if (!src) return;
    let live = true;
    src.crmSegments(ws).then(
      (d) => {
        if (!live) return;
        // «Вся база» сервер не присылает отдельным сегментом — как на экране базы: все клиенты и кому можно рекламу
        const all: CrmSegment = { id: "all", label: "Вся база", rule: "все клиенты за 90 дней", n: d.ok, total: d.clients };
        setBase({ segs: [...d.segments.filter((s) => totalOf(s) > 0 && s.id !== "all"), ...(d.available && d.at ? [all] : [])], metrics: d.metrics ?? null, why: d.consent && !d.consent.ready ? d.consent.why : "" });
        setBaseErr(!d.available ? d.why || "Базы клиентов у этой компании нет." : !d.at ? "Базу клиентов ещё не собирали. Обновите её во вкладке «Клиенты»." : "");
      },
      (e: unknown) => live && setBaseErr(errText(e) || "База клиентов не загрузилась"),
    );
    src.contactsStatus(ws).then(
      (d) => live && setIsDemo(!!d.demo),
      () => {},
    );
    src.templates(ws).then(
      (d) => live && setLib({ items: d.items, cats: d.cats || [], vars: d.vars?.length ? d.vars : DEFAULT_VARS }),
      (e: unknown) => {
        if (!live) return;
        setLib({ items: [], cats: [], vars: DEFAULT_VARS });
        setLibErr(errText(e));
      },
    );
    return () => {
      live = false;
    };
  }, [ws, retry]);

  const tpl = tplId ? lib?.items.find((x) => x.id === tplId) : undefined;
  const vars = lib?.vars || DEFAULT_VARS;
  const ownText = toCanon(own, vars);
  const text = tpl ? tpl.ru : tplId === "" ? ownText : "";
  const segment = base?.segs.find((s) => s.id === seg);
  // отбор из списка людей сегмента (дни с визита, мастер) — пока выбран тот же сегмент
  const spec: SegmentSpec = useMemo(() => (preset?.spec && preset.spec.id === seg ? preset.spec : { id: seg }), [preset?.spec, seg]);
  const capN = Math.round(+cap.replace(/\D/g, "") || 0);
  const capOk = capN >= 1 && capN <= CAP_MAX;
  const draft: CampaignDraft = useMemo(
    () => ({
      name: `${tpl ? tpl.title : "Своё сообщение"} · ${new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}`,
      source: "segment",
      channel: "bot",
      segment: spec,
      // текст из библиотеки сервер берёт сам по номеру (ту версию, что у него): пульт текст не подменяет
      ...(tpl ? { tplId: tpl.id, text: "" } : { text: ownText }),
      lang: "ru",
      stop,
      cap: capOk ? capN : 1,
      from,
      to,
      consent: true,
    }),
    [tpl, spec, ownText, stop, capN, capOk, from, to],
  );
  const key = JSON.stringify([spec, tpl?.id || "", tpl ? "" : ownText, stop]);

  // проверка на сервере: на «Предпросмотре» и «Проверке» — если выбор изменился (один запрос на выбор; переход между этими шагами
  // его не повторяет); пример — по тексту, который прислала проверка: он уже со строкой «стоп», если её выбрали
  const [rev, setRev] = useState(0);
  const chkReq = useRef("");
  const pvReq = useRef("");
  useEffect(() => {
    if (step !== 2 && step !== 3) return;
    const src = store.source, want = `${key}#${rev}`;
    if (!src || chkReq.current === want) return;
    chkReq.current = want;
    setChk({ key });
    setPv(null);
    src.checkCampaign(ws, draft).then(
      (data) => chkReq.current === want && setChk({ key, data }),
      (e: unknown) => chkReq.current === want && setChk({ key, error: errorList(e)[0] || "Проверка не прошла" }),
    );
    // draft — из key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, key, ws, rev]);
  const cd = chk?.key === key ? chk.data : undefined;
  useEffect(() => {
    if (step !== 2 || !cd) return;
    const src = store.source, want = `${key}#${rev}`;
    if (!src || pvReq.current === want) return;
    pvReq.current = want;
    const body = cd.text ? { text: cd.text } : tpl ? { id: tpl.id } : { text: ownText };
    src.templatePreview(ws, { ...body, lang: "ru", segment: spec }).then(
      (data) => pvReq.current === want && setPv({ key, data }),
      (e: unknown) => pvReq.current === want && setPv({ key, error: errText(e) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, cd, key, ws, rev]);
  const recheck = () => setRev((x) => x + 1);

  // номер для проверки владельца — при входе на «Тест» (сотруднику тест недоступен: сервер ответит 403)
  useEffect(() => {
    if (step !== 4 || !owner || testPhone !== null || !store.source) return;
    let live = true;
    store.source.autoMessages(ws).then(
      (d) => live && setTestPhone(d.test?.phone || ""),
      () => live && setTestPhone("?"), // не узнали — отправить можно, сервер сам скажет, если номера нет
    );
    return () => {
      live = false;
    };
  }, [step, owner, testPhone, ws]);

  // ---------- шаги ----------
  const scroller = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
    if (first.current) first.current = false;
    else heading.current?.focus({ preventScroll: true });
  }, [step]);

  // null — второго номера у компании нет; undefined — сведения о номерах ещё не пришли (не мешаем: сервер проверит сам)
  const noSender = bot === null ? "Второй номер (Green-API) у этой компании не подключён." : "";
  const valid = cd?.valid ?? 0;
  const canNext = [
    !!segment && !baseErr && !noSender,
    tplId !== null && !!text.trim() && !hasBlanks(text),
    !!cd,
    !!cd?.ok && valid > 0 && capOk && from < to,
    true,
    false,
  ][step];
  const go = (s: number) => !created && setStep(Math.max(0, Math.min(LAST, s)));

  const close = () => {
    if (created) {
      toast("Рассылка сохранена черновиком. Она в списке рассылок.");
      onDone(created.id);
    } else onClose();
  };
  // системное «назад» и Esc — как стрелка мастера: на телефоне — прошлый шаг; сохранённая рассылка — её лист
  useEffect(() => {
    if (!backRef) return;
    backRef.current = () => {
      if (created) {
        close();
        return true;
      }
      if (!md && step > 0) {
        setStep(step - 1);
        return true;
      }
      onClose();
      return false;
    };
    return () => {
      backRef.current = null;
    };
  });

  // ---------- тест ----------
  // rid — номер нажатия: повтор после обрыва связи (исход неизвестен) — с тем же rid, сервер второй раз не отправит
  const sendTest = async () => {
    const src = store.source;
    if (!src || test.busy) return;
    rid.current ??= newRid();
    setTest({ busy: true });
    try {
      const r = await src.gaTest(ws, draft, rid.current);
      rid.current = null;
      setTest({ ok: r.text, preview: r.preview });
      setTested(true);
    } catch (e) {
      const a = e instanceof ApiError ? e : null;
      const unsure = !a || a.offline || a.status >= 500;
      if (!unsure) rid.current = null;
      if (a?.code === "notest") {
        setTestPhone("");
        setTest({ error: "Сначала укажите номер для проверки — ниже.", preview: a.preview || "" });
      } else if (a?.code === "preview") setTest({ off: a.message, preview: a.preview || "" });
      else setTest({ error: errorList(e)[0] || "Не отправилось", preview: a?.preview || "", retry: unsure });
    }
  };
  const savePhone = async () => {
    const src = store.source;
    if (!src) return;
    setPhoneBusy(true);
    try {
      await src.autoMessageSet(ws, { testPhone: phoneIn.trim() });
      const d = await src.autoMessages(ws);
      setTestPhone(d.test?.phone || "");
      setTest({});
      toast("Номер для проверки сохранён");
    } catch (e) {
      setTest({ error: errText(e) });
    } finally {
      setPhoneBusy(false);
    }
  };

  // ---------- сохранение ----------
  const ensure = async (): Promise<CampaignDetail | null> => {
    if (created) return created;
    const src = store.source;
    if (!src) return null;
    try {
      const c = (await src.createCampaign(ws, draft)).campaign;
      setCreated(c);
      return c;
    } catch (e) {
      setErrors(errorList(e));
      return null;
    }
  };
  const save = async (approve: boolean) => {
    const src = store.source;
    if (!src || busy) return;
    setBusy(approve ? "approve" : "draft");
    setErrors([]);
    try {
      const c = await ensure();
      if (!c) return;
      if (approve) await src.campaignAct(ws, c.id, "approve");
      toast(approve ? "Рассылка одобрена. Запустить её можно, когда запуск включат." : "Черновик сохранён");
      onDone(c.id);
    } catch (e) {
      setErrors(errorList(e));
    } finally {
      setBusy("");
    }
  };

  // ---------- что показать ----------
  const launchOff = !!bot?.noBroadcast;
  const recipients = created ? created.total : valid;
  const days = recipients > 0 ? Math.ceil(recipients / Math.max(1, capN)) : 0;
  const footer =
    step < LAST ? (
      <div className="flex gap-2">
        {step > 0 && (
          <Button size="lg" icon={ChevronLeft} onClick={() => go(step - 1)}>
            Назад
          </Button>
        )}
        <Button variant="primary" size="lg" className="flex-1" disabled={!canNext} onClick={() => go(step + 1)}>
          Далее
        </Button>
      </div>
    ) : (
      <Actions md={md}>
        {created ? (
          <Button size="lg" className="max-md:w-full" onClick={close}>
            Открыть рассылку
          </Button>
        ) : (
          <Button size="lg" icon={ChevronLeft} className="max-md:w-full" onClick={() => go(step - 1)}>
            Назад
          </Button>
        )}
      </Actions>
    );

  return (
    <Frame
      md={md}
      title="Новая рассылка"
      sub={`Второй WhatsApp${bot?.phone ? ` ${formatPhone(bot.phone)}` : ""} · шаг ${step + 1} из ${GA_STEPS.length}`}
      onBack={() => (created ? close() : step > 0 ? go(step - 1) : onClose())}
      backLabel={step > 0 && !created ? "Назад" : "Закрыть"}
      onClose={close}
      step={step}
      steps={GA_STEPS.length}
      scroller={scroller}
      footer={footer}
    >
      <ol aria-label="Шаги" className="sr-only">
        {GA_STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined}>
            {s}
          </li>
        ))}
      </ol>
      <h2 ref={heading} tabIndex={-1} className="mb-1 px-1 text-[1.625rem] font-bold leading-8 tracking-[-0.022em] outline-none">
        {GA_STEPS[step]}
      </h2>
      <p className="mb-5 px-1 text-ui text-fg-2">
        Шаг {step + 1} из {GA_STEPS.length} · {SUB[step]}
      </p>
      {isDemo && step <= 3 && <p className="mb-4 rounded-xl border border-brand-gold/40 px-3 py-2 text-sm text-fg-2">Демо-база: числа и примеры на вымышленных клиентах.</p>}

      {step === 0 && (
        <Audience
          base={base}
          baseErr={baseErr}
          noSender={noSender}
          seg={seg}
          spec={spec}
          onSeg={setSeg}
          onMeta={onMeta}
          onRetry={() => (setBaseErr(""), setBase(null), setRetry((x) => x + 1))}
        />
      )}
      {step === 1 && (
        <MessageStep
          lib={lib}
          libErr={libErr}
          seg={seg}
          tplId={tplId}
          onTpl={setTplId}
          own={own}
          onOwn={setOwn}
          stop={stop}
          onStop={setStop}
          q={q}
          onQ={setQ}
          cat={cat}
          onCat={setCat}
        />
      )}
      {step === 2 && <PreviewStep chk={chk?.key === key ? chk : null} pv={pv?.key === key ? pv : null} stop={stop} onRetry={recheck} />}
      {step === 3 && (
        <CheckStep
          chk={chk?.key === key ? chk : null}
          segment={segment}
          spec={spec}
          cap={cap}
          onCap={setCap}
          capOk={capOk}
          capN={capN}
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
          onRetry={recheck}
        />
      )}
      {step === 4 && (
        <TestStep
          owner={owner}
          testPhone={testPhone}
          phoneIn={phoneIn}
          onPhoneIn={setPhoneIn}
          phoneBusy={phoneBusy}
          onSavePhone={() => void savePhone()}
          test={test}
          onSend={() => void sendTest()}
        />
      )}
      {step === 5 && (
        // сначала — кому и действия (на телефоне видны без прокрутки), ниже — что в рассылке со ссылками на шаги
        <div className="space-y-4">
          {created && (
            <p role="status" className="flex gap-2 rounded-[0.875rem] bg-positive-soft px-4 py-3 text-ui text-positive pointer-coarse:text-base">
              <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
              <span>Рассылка «{created.name}» сохранена черновиком. Получателей и текст уже не изменить: если нужно иначе — создайте новую.</span>
            </p>
          )}
          <p className="rounded-[0.875rem] bg-surface px-4 py-3 text-ui pointer-coarse:text-base">
            Получат <b className="tnum text-lg">{nf.format(recipients)}</b> {plural(recipients, CLIENTS)}
            {segment ? <span className="text-fg-2"> · {segmentTitle(spec, base?.segs || [])}</span> : null}
            <span className="block text-sm text-fg-2">
              {tpl ? `«${tpl.title}»` : "Свой текст"} · не больше {nf.format(capN)} в сутки, с {from}:00 до {to}:00
              {recipients > 0 ? ` · примерно ${nf.format(days)} ${plural(days, DAYS)}` : ""}
            </span>
          </p>
          {!!errors.length && (
            <div role="alert" className="rounded-[0.875rem] bg-critical-soft px-4 py-3 text-ui text-critical pointer-coarse:text-base">
              {errors.map((x, i) => (
                <p key={i}>{x}</p>
              ))}
            </div>
          )}
          <LaunchControls
            ws={ws}
            owner={owner}
            bot={bot}
            from={from}
            getId={async () => (await ensure())?.id ?? null}
            onLaunched={(c) => {
              toast(c.at ? `Рассылка запланирована на ${astanaWhen(c.at)} по Астане` : "Рассылка запущена: сообщения уходят по одному, в часы отправки.");
              onDone(c.id);
            }}
          />
          <div className="flex flex-col gap-2 md:flex-row">
            {owner && launchOff && (
              <Button variant="primary" size="lg" className="md:flex-1" busy={busy === "approve"} disabled={!!busy || (!!created && !!created.approved)} onClick={() => void save(true)}>
                Одобрить
              </Button>
            )}
            <Button variant={owner ? "outline" : "primary"} size="lg" className="md:flex-1" busy={busy === "draft"} disabled={!!busy} onClick={() => void save(false)}>
              Сохранить черновик
            </Button>
          </div>
          {owner && launchOff && <p className="text-sm text-fg-3">Одобрение — ваше решение о рассылке, а не отправка: клиентам ничего не уйдёт, пока запуск выключен.</p>}
          <section aria-label="Что в рассылке">
            <h3 className="mb-1.5 px-1 text-sm font-medium text-fg-3">Что в рассылке</h3>
            <dl className="divide-y divide-line rounded-[0.875rem] bg-surface px-4">
              <Sum label="Номер">
                Второй WhatsApp
                {bot?.phone ? <span className="tnum block text-sm font-normal text-fg-2">{formatPhone(bot.phone)}</span> : null}
              </Sum>
              <Sum label="Кому" edit={created ? undefined : { label: "Выбрать аудиторию", onClick: () => go(0) }}>
                {segment ? segmentTitle(spec, base?.segs || []) : "не выбрано"}
              </Sum>
              <Sum label="Сообщение" edit={created ? undefined : { label: "Выбрать сообщение", onClick: () => go(1) }}>
                {tpl ? `«${tpl.title}»` : "Свой текст"}
                {stop ? <span className="block text-sm font-normal text-fg-2">в конце — строка «стоп»</span> : null}
              </Sum>
              <Sum label="Текст" edit={created ? undefined : { label: "Посмотреть текст", onClick: () => go(2) }}>
                с именем каждого клиента в приветствии
              </Sum>
              <Sum label="Получат" edit={created ? undefined : { label: "Проверить получателей", onClick: () => go(3) }}>
                <span className="tnum">
                  {nf.format(recipients)} {plural(recipients, CLIENTS)}
                </span>
              </Sum>
              <Sum label="Тест" edit={created || !owner ? undefined : { label: "Отправить тест", onClick: () => go(4) }}>
                {tested ? "отправлен на ваш номер" : owner ? "не отправлялся" : "отправляет владелец"}
              </Sum>
            </dl>
          </section>
        </div>
      )}
    </Frame>
  );
}

/** Строка итога: подпись, значение и ссылка на шаг (подписи ссылок — как в ТЗ: «Выбрать аудиторию», «Выбрать сообщение»…). */
function Sum({ label, edit, children }: { label: string; edit?: { label: string; onClick: () => void }; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 text-ui pointer-coarse:text-base">
      <dt className="w-24 shrink-0 text-fg-2">{label}</dt>
      <dd className="min-w-0 flex-1 font-medium">
        {children}
        {edit && (
          <button type="button" onClick={edit.onClick} className="mt-0.5 block text-sm font-medium text-accent-ink underline-offset-2 hover:underline pointer-coarse:min-h-9">
            {edit.label}
          </button>
        )}
      </dd>
    </div>
  );
}

// ---------- шаг 1: аудитория ----------
function Audience({
  base,
  baseErr,
  noSender,
  seg,
  spec,
  onSeg,
  onMeta,
  onRetry,
}: {
  base: Base | null;
  baseErr: string;
  noSender: string;
  seg: string;
  spec: SegmentSpec;
  onSeg: (id: string) => void;
  onMeta: () => void;
  onRetry: () => void;
}) {
  if (noSender || baseErr)
    return (
      <div className="space-y-3">
        <Notice>{noSender || baseErr}</Notice>
        <p className="text-ui text-fg-2 pointer-coarse:text-base">Рассылки со второго номера уходят только по базе клиентов из Altegio. Рассылка шаблоном Meta по своему списку — во вкладке «Meta».</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" icon={Smartphone} onClick={onMeta}>
            Открыть «Meta»
          </Button>
          {baseErr && !noSender && (
            <Button variant="ghost" icon={RefreshCw} onClick={onRetry}>
              Повторить
            </Button>
          )}
        </div>
      </div>
    );
  if (!base) return <Skeleton className="h-64 w-full rounded-2xl" />;
  const m = base.metrics;
  const cur = base.segs.find((s) => s.id === seg);
  const filtered = spec.id === seg && (spec.from !== undefined || spec.to !== undefined || !!spec.staff);
  return (
    <div className="space-y-3">
      {m && (
        <p className="rounded-xl bg-surface px-3 py-2 text-sm text-fg-2">
          В базе <b className="tnum font-semibold text-fg">{nf.format(m.total)}</b> · номер корректный <b className="tnum font-semibold text-fg">{nf.format(m.valid)}</b> · разрешили рекламу{" "}
          <b className="tnum font-semibold text-fg">{nf.format(m.marketing)}</b> · отказались <b className="tnum font-semibold text-fg">{nf.format(m.refused)}</b>
        </p>
      )}
      {base.why && <Notice tone="critical">{base.why}</Notice>}
      <div role="radiogroup" aria-label="Сегмент" className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
        {base.segs.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={seg === s.id}
            aria-label={`${s.label}: ${nf.format(totalOf(s))} ${plural(totalOf(s), CLIENTS)}, можно рекламу: ${nf.format(s.n)}`}
            onClick={() => onSeg(s.id)}
            className="flex min-h-14 w-full items-center gap-3 px-3 py-3 text-left hover:bg-surface-2/60"
          >
            <Dot on={seg === s.id} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{s.label}</span>
              {segRule(s) && <span className="block text-sm text-fg-2">{segRule(s)}</span>}
              {seg === s.id && filtered && <span className="block text-sm text-accent-ink">Отбор: {segmentTitle(spec).replace(/^[^·]*·\s*/, "")}</span>}
            </span>
            <span className="tnum shrink-0 text-right text-sm text-fg-2">
              <span className="block">
                <Users aria-hidden className="mr-1 inline size-3.5" />
                {nf.format(totalOf(s))}
              </span>
              <span className={cn("block text-xs", s.n ? "text-positive" : "text-fg-3")}>можно рекламу: {nf.format(s.n)}</span>
            </span>
          </button>
        ))}
      </div>
      {!base.segs.length && <Notice>В базе пока нет клиентов с визитами за 90 дней.</Notice>}
      <p className="px-1 text-sm text-fg-3">Большое число — все клиенты сегмента. «Можно рекламу» — кто её получит: подтверждённое согласие, нет «стопа», не записан, не был недавно и без рекламы за 30 дней.</p>
      {cur && cur.n === 0 && (
        <Notice>
          В сегменте «{cur.label}» рекламу сейчас не получит никто. Пройти дальше можно: на шаге «Проверка» будет видно почему и как получить согласия.
        </Notice>
      )}
    </div>
  );
}

function Dot({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2", on ? "border-accent" : "border-line-strong")}>
      {on && <span className="size-2.5 rounded-full bg-accent" />}
    </span>
  );
}

// ---------- шаг 2: сообщение ----------
function MessageStep({
  lib,
  libErr,
  seg,
  tplId,
  onTpl,
  own,
  onOwn,
  stop,
  onStop,
  q,
  onQ,
  cat,
  onCat,
}: {
  lib: { items: LibraryItem[]; cats: LibraryCat[] } | null;
  libErr: string;
  seg: string;
  tplId: string | null;
  onTpl: (id: string) => void;
  own: string;
  onOwn: (v: string) => void;
  stop: boolean;
  onStop: (v: boolean) => void;
  q: string;
  onQ: (v: string) => void;
  cat: string | null;
  onCat: (v: string) => void;
}) {
  if (!lib) return <Skeleton className="h-64 w-full rounded-2xl" />;
  const ready = lib.items.filter(usable);
  const waiting = lib.items.filter((x) => !x.archived && !usable(x)).length;
  // категория по сегменту: «Пора на стрижку» → «Пора обновить стрижку» (пока не выбрали сами и текст не выбран заранее)
  const suggested = lib.cats.find((c) => c.seg && c.seg !== "all" && c.seg === seg)?.id || "";
  const curCat = cat ?? suggested;
  const cats = lib.cats.filter((c) => ready.some((x) => x.cat === c.id));
  const list = ready.filter((x) => (!curCat || q.trim() || x.cat === curCat) && matches(x, q, lib.cats));
  const groups = byCategory(list, lib.cats);
  const pick = (id: string) => onTpl(id);
  const chosen = ready.find((x) => x.id === tplId);
  return (
    <div className="space-y-3">
      {libErr && <Notice tone="critical">Тексты не загрузились: {libErr}</Notice>}
      {ready.length > 0 && (
        <>
          <label className="relative block">
            <span className="sr-only">Поиск по текстам</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" strokeWidth={2} />
            <input
              type="search"
              aria-label="Поиск по текстам"
              value={q}
              onChange={(e) => onQ(e.target.value)}
              placeholder="Название или текст"
              className="h-11 w-full rounded-[0.625rem] bg-surface pl-9 pr-9 text-md text-fg outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-ring md:h-10 md:text-base"
            />
            {q && (
              <button type="button" aria-label="Очистить поиск" onClick={() => onQ("")} className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center text-fg-3 hover:text-fg">
                <X aria-hidden className="size-4" strokeWidth={2} />
              </button>
            )}
          </label>
          <div role="radiogroup" aria-label="Категория" className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <Chip on={!curCat} onClick={() => onCat("")}>
              Все
            </Chip>
            {cats.map((c) => (
              <Chip key={c.id} on={curCat === c.id} onClick={() => onCat(c.id)}>
                {c.label}
              </Chip>
            ))}
          </div>
        </>
      )}
      <div role="radiogroup" aria-label="Сообщение" className="space-y-4">
        {groups.map((g) => (
          <section key={g.cat.id || "own"} aria-label={g.cat.label}>
            <h3 className="mb-1.5 px-1 text-sm font-medium text-fg-3">
              {g.cat.label}
              {g.cat.who ? <span className="font-normal"> · {g.cat.who}</span> : null}
            </h3>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
              {g.items.map((x) => (
                <li key={x.id}>
                  <button type="button" role="radio" aria-checked={tplId === x.id} aria-label={x.title} onClick={() => pick(x.id)} className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-surface-2/60">
                    <Dot on={tplId === x.id} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{x.title}</span>
                      {tplId === x.id ? (
                        <span className="mt-1 block whitespace-pre-line rounded-xl bg-surface-2 px-3 py-2 text-sm text-fg">{x.ru}</span>
                      ) : (
                        <span className="line-clamp-2 text-sm text-fg-2">{snippet(x.ru)}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {ready.length > 0 && !list.length && <p className="px-1 text-ui text-fg-2">Ничего не нашли. Измените поиск или выберите «Все».</p>}
        <section aria-label="Свой текст">
          <ul className="overflow-hidden rounded-2xl bg-surface">
            <li>
              <button type="button" role="radio" aria-checked={tplId === ""} aria-label="Свой текст" onClick={() => pick("")} className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-surface-2/60">
                <Dot on={tplId === ""} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Свой текст</span>
                  <span className="block text-sm text-fg-2">написать сообщение самому</span>
                </span>
              </button>
            </li>
          </ul>
        </section>
      </div>
      {tplId === "" && (
        <textarea
          aria-label="Текст сообщения"
          rows={6}
          maxLength={1000}
          value={own}
          onChange={(e) => onOwn(e.target.value)}
          placeholder="Добрый день! 👋🏻 …"
          className="block w-full resize-y rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-md leading-[1.375rem] outline-none focus:border-accent dark:bg-surface-2"
        />
      )}
      {!ready.length && !libErr && <p className="px-1 text-sm text-fg-3">Одобренных текстов в «Шаблонах» пока нет — напишите свой.</p>}
      {waiting > 0 && <p className="px-1 text-sm text-fg-3">Тексты, которые ждут одобрения владельца, здесь не показаны: их одобряют в «Шаблонах».</p>}
      {hasBlanks(tplId ? chosen?.ru || "" : tplId === "" ? own : "") && <Notice>В тексте есть [скобки]. Впишите настоящие данные или выберите другой текст.</Notice>}
      <div className="rounded-2xl bg-surface px-3">
        <Checkbox checked={stop} onChange={onStop}>
          Добавить в конце: «{STOP_RU}»
        </Checkbox>
      </div>
      <p className="flex gap-2 px-1 text-sm text-fg-3">
        <MessageSquareText aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.9} />
        <span>Имя клиента система добавит сама в приветствие: «Добрый день!» → «Добрый день, Азамат!». Если имени нет — приветствие без имени.</span>
      </p>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn("inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-ui font-medium transition-colors pointer-coarse:h-10", on ? "bg-selected text-selected-fg" : "bg-surface text-fg-2 hover:text-fg")}
    >
      {children}
    </button>
  );
}

// ---------- шаг 3: предпросмотр ----------
function PreviewStep({ chk, pv, stop, onRetry }: { chk: { data?: CampaignCheck; error?: string } | null; pv: { data?: TemplatePreview; error?: string } | null; stop: boolean; onRetry: () => void }) {
  if (chk?.error)
    return (
      <div className="space-y-3">
        <Notice tone="critical">{chk.error}</Notice>
        <Button variant="outline" icon={RefreshCw} onClick={onRetry}>
          Повторить
        </Button>
      </div>
    );
  if (!pv?.data && !pv?.error) return <Skeleton className="h-72 w-full rounded-2xl" />;
  const d = pv.data;
  const textIssues = (chk?.data?.errors || []).filter((e) => /скоб|вставк|текст/i.test(e));
  if (!d)
    return (
      <div className="space-y-3">
        <Notice tone="critical">Пример не собрался: {pv.error}</Notice>
        {chk?.data?.samples?.[0] && <WaBubble text={chk.data.samples[0].text} to={chk.data.samples[0].to} />}
      </div>
    );
  const ex = d.list[0];
  return (
    <div className="space-y-4">
      {ex && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-fg-2">
            {d.demo ? "Так увидит клиент (пример на вымышленном клиенте)" : `Так увидит ${ex.name || "клиент"}`}
            {!d.demo && ex.to ? <span className="tnum font-normal text-fg-3"> · {ex.to}</span> : null}
          </p>
          {ex.allowed === false && <p className="mb-1.5 text-sm text-fg-2">Этому клиенту реклама сейчас не уйдёт: {ex.why || "нет согласия на рекламу"}. Пример — на нём, потому что в сегменте рекламу сейчас не получит никто.</p>}
          <WaBubble text={ex.text} />
        </div>
      )}
      {d.noName?.text && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-fg-2">Тот же текст, если имени нет</p>
          <WaBubble text={d.noName.text} />
        </div>
      )}
      <p className="px-1 text-sm text-fg-3">
        У каждого клиента в приветствии — его имя. Если имени нет или оно странное (латиница, «Бро»), приветствие останется без имени.{stop ? " Строка «стоп» — в конце, как вы выбрали." : ""}
      </p>
      {textIssues.map((e) => (
        <Notice key={e} tone="critical">
          {e[0].toUpperCase() + e.slice(1)}
        </Notice>
      ))}
    </div>
  );
}

// ---------- шаг 4: проверка ----------
function CheckStep({
  chk,
  segment,
  spec,
  cap,
  onCap,
  capOk,
  capN,
  from,
  to,
  onFrom,
  onTo,
  onRetry,
}: {
  chk: { data?: CampaignCheck; error?: string } | null;
  segment?: CrmSegment;
  spec: SegmentSpec;
  cap: string;
  onCap: (v: string) => void;
  capOk: boolean;
  capN: number;
  from: number;
  to: number;
  onFrom: (v: number) => void;
  onTo: (v: number) => void;
  onRetry: () => void;
}) {
  if (chk?.error)
    return (
      <div className="space-y-3">
        <Notice tone="critical">{chk.error}</Notice>
        <Button variant="outline" icon={RefreshCw} onClick={onRetry}>
          Повторить
        </Button>
      </div>
    );
  const d = chk?.data;
  if (!d) return <Skeleton className="h-72 w-full rounded-2xl" />;
  const f = d.funnel;
  const valid = d.valid;
  const rules = (f?.rules || []).filter((x) => x.n > 0), consent = (f?.consent || []).filter((x) => x.n > 0);
  const days = valid > 0 && capN > 0 ? Math.ceil(valid / capN) : 0;
  const label = segment ? segmentTitle(spec, [segment]) : "сегменте";
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-md">
        <CircleCheck aria-hidden className={cn("size-5 shrink-0", valid ? "text-positive" : "text-fg-3")} />
        <span>
          Сообщение получат: <b className="tnum text-lg">{nf.format(valid)}</b> {plural(valid, CLIENTS)}
        </span>
      </p>
      {f && (
        <div className="rounded-2xl bg-surface px-4 py-1">
          <dl aria-label="Получатели" className="divide-y divide-line">
            {f.total > 0 && <Line label="Клиентов в базе за 90 дней">{nf.format(f.total)}</Line>}
            {f.valid > 0 && <Line label="С корректным номером">{nf.format(f.valid)}</Line>}
            <Line label={`В сегменте «${label}»`} hint="технически можно написать: номер корректный">
              {nf.format(f.segment)}
            </Line>
            <Reasons title="Не подходят по правилам" list={rules} />
            <Reasons title="Нет разрешения на рекламу" list={consent} />
            <div className="flex items-start justify-between gap-4 py-2.5 text-ui pointer-coarse:text-base">
              <dt className="font-semibold">Можно писать рекламу</dt>
              <dd className="tnum font-semibold">{nf.format(f.allowed)}</dd>
            </div>
          </dl>
        </div>
      )}
      {f?.note && <Notice tone="critical">{f.note}</Notice>}
      {!!d.errors.length && valid > 0 && (
        <Notice tone="critical">
          {d.errors.map((e) => (
            <span key={e} className="block">
              {e[0].toUpperCase() + e.slice(1)}
            </span>
          ))}
        </Notice>
      )}
      {valid === 0 && <ConsentHowTo reasons={[...consent, ...rules]} note={f?.note} />}
      {valid === 0 && d.errors.some((e) => !/некому писать/.test(e)) && (
        <Notice tone="critical">
          {d.errors
            .filter((e) => !/некому писать/.test(e))
            .map((e) => (
              <span key={e} className="block">
                {e[0].toUpperCase() + e.slice(1)}
              </span>
            ))}
        </Notice>
      )}
      <section aria-label="Сколько в день" className="rounded-2xl bg-surface px-4 py-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-fg-2">Предел сообщений в сутки</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label="Предел сообщений в сутки"
            value={cap}
            onChange={(e) => onCap(e.target.value.replace(/[^\d\s]/g, "").slice(0, 5))}
            className={cn("tnum h-11 w-full rounded-xl border bg-surface px-3 text-md outline-none focus:border-accent dark:bg-surface-2", capOk ? "border-line-strong" : "border-critical")}
          />
          <span className={cn("mt-1.5 block text-sm", capOk ? "text-fg-3" : "text-critical")}>
            {capOk ? "Сколько сообщений уйдёт со второго номера за сутки, не больше. По умолчанию 50, можно до 300." : "Число от 1 до 300."}
          </span>
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-fg-2">С</span>
            <select aria-label="Часы отправки с" value={from} onChange={(e) => onFrom(+e.target.value)} className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-md dark:bg-surface-2">
              {HOURS.slice(0, -1).map((h) => (
                <option key={h} value={h}>{`${h}:00`}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-fg-2">До</span>
            <select aria-label="Часы отправки до" value={to} onChange={(e) => onTo(+e.target.value)} className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-md dark:bg-surface-2">
              {HOURS.slice(1).map((h) => (
                <option key={h} value={h}>{`${h}:00`}</option>
              ))}
            </select>
          </label>
        </div>
        {from >= to && <p className="mt-1.5 text-sm text-critical">Время «до» должно быть позже «с».</p>}
        <p className="mt-2 text-sm text-fg-2">
          {days > 0
            ? `Сообщения уходят по одному, с паузой, только в эти часы по Астане. При пределе ${nf.format(capN)} в сутки — примерно ${nf.format(days)} ${plural(days, DAYS)}.`
            : "Сообщения уходят по одному, с паузой, только в эти часы по Астане."}
        </p>
      </section>
    </div>
  );
}

function Line({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-ui pointer-coarse:text-base">
      <dt className="min-w-0 text-fg-2">
        {label}
        {hint && <span className="block text-xs text-fg-3">{hint}</span>}
      </dt>
      <dd className="tnum shrink-0 font-medium">{children}</dd>
    </div>
  );
}

function Reasons({ title, list }: { title: string; list: FunnelReason[] }) {
  if (!list.length) return null;
  const sum = list.reduce((a, x) => a + x.n, 0);
  return (
    <div className="py-2.5 text-ui pointer-coarse:text-base">
      <div className="flex items-start justify-between gap-4">
        <dt className="text-fg-2">{title}</dt>
        <dd className="tnum font-medium">−{nf.format(sum)}</dd>
      </div>
      <ul className="mt-1 space-y-0.5 text-sm text-fg-3">
        {list.map((x) => (
          <li key={x.code} className="flex justify-between gap-3 pl-3">
            <span>{x.why || x.code}</span>
            <span className="tnum">{nf.format(x.n)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- шаг 5: тест ----------
function TestStep({
  owner,
  testPhone,
  phoneIn,
  onPhoneIn,
  phoneBusy,
  onSavePhone,
  test,
  onSend,
}: {
  owner: boolean;
  testPhone: string | null;
  phoneIn: string;
  onPhoneIn: (v: string) => void;
  phoneBusy: boolean;
  onSavePhone: () => void;
  test: Test;
  onSend: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-ui text-fg-2 pointer-coarse:text-base">Отправьте тест себе, чтобы увидеть сообщение в WhatsApp. Оно придёт со второго номера на ваш номер для проверки — клиентам на этом шаге ничего не уходит.</p>
      {!owner ? (
        <Notice tone="muted">Тест отправляет владелец — на свой номер для проверки.</Notice>
      ) : testPhone === null ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : testPhone ? (
        <div className="rounded-2xl bg-surface px-4 py-3">
          {testPhone !== "?" && (
            <p className="text-ui text-fg-2 pointer-coarse:text-base">
              Номер для проверки: <span className="tnum font-medium text-fg">{testPhone}</span>
            </p>
          )}
          <Button variant="primary" size="lg" icon={FlaskConical} className="mt-2 w-full" busy={test.busy} onClick={onSend}>
            {test.retry ? "Повторить" : "Отправить тест"}
          </Button>
          <p className="mt-1.5 text-sm text-fg-3">Сменить номер — «Рассылки» → «Автоматические» → «Номер для проверки».</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-surface px-4 py-3">
          <p className="text-ui pointer-coarse:text-base">Номер для проверки не указан. Впишите свой номер WhatsApp: он сохранится в «Автоматические» → «Номер для проверки».</p>
          <div className="mt-2 flex gap-2">
            <input
              aria-label="Номер для проверки"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phoneIn}
              onChange={(e) => onPhoneIn(e.target.value)}
              placeholder="+7 701 123 45 67"
              className="h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 text-md outline-none focus:border-accent dark:bg-surface-2"
            />
            <Button busy={phoneBusy} disabled={phoneBusy || phoneIn.replace(/\D/g, "").length < 10} onClick={onSavePhone}>
              Сохранить
            </Button>
          </div>
        </div>
      )}
      {test.ok && (
        <p role="status" className="flex gap-2 rounded-xl bg-positive-soft px-3 py-2.5 text-ui text-positive pointer-coarse:text-base">
          <Check aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.5} />
          <span className="min-w-0">{test.ok}</span>
        </p>
      )}
      {test.error && <Notice tone="critical">{test.error}</Notice>}
      {test.off !== undefined && <Notice tone="muted">{test.off || "Тест со второго номера отсюда не уходит."} Ниже — то, что пришло бы вам.</Notice>}
      {test.preview && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-fg-2">{test.ok ? "Что ушло (на вымышленном клиенте «Айгерим»)" : "Что пришло бы (на вымышленном клиенте «Айгерим»)"}</p>
          <WaBubble text={test.preview} />
        </div>
      )}
      <p className="px-1 text-sm text-fg-3">Тест можно пропустить, но лучше один раз посмотреть сообщение на телефоне.</p>
    </div>
  );
}
