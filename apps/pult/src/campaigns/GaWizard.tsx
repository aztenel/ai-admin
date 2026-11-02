// «Создать рассылку» со второго номера (ТЗ V3 «Рассылки и доступная аудитория», 31.10.2026):
// Шаблон → Кому → Аудитория → Предпросмотр → Проверка → Когда.
// Никаких полей Meta и {{1}}: текст — из библиотеки или свой, имя и данные сервер подставляет каждому клиенту сам;
// клиенту без имени — приветствие без имени. Получатели — сегмент базы клиентов: сервер считает воронку (всего → с правильным
// номером → по сегменту → исключения по правилам и по разрешениям → можно отправлять) и ничего не «добавляет»: нет согласия —
// не пишем, «стоп» — не пишем. В конце — «Сохранить черновик» (сотрудник и владелец) и «Одобрить» (владелец, после отметки
// «проверено»). «Запустить» — недоступно, пока запуск рассылок со второго номера не включён отдельным решением владельца.
// 02.11.2026: на шаге «Кому» у сегмента — все его клиенты и сколько из них можно рекламу (без согласия реклама не уходит); пример —
// и на тех, кто рекламу не получит, с пометкой «не получит: почему»; проба уходит только на номер для проверки владельца
// («Автоматические» → «Номер для проверки»; номер из пульта сервер не слушает), у пробы — номер нажатия (rid): повтор после обрыва
// связи второй раз не отправит.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, CircleCheck, FlaskConical, Users } from "lucide-react";
import { Sheet, toast } from "@/components/overlay";
import { Button, Skeleton } from "@/components/ui";
import { ApiError } from "@/data/errors";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AudienceFunnel, CampaignCheck, CampaignDraft, CrmSegment, CrmStatuses, FunnelReason, LibraryItem, SegmentSpec, TemplatePreview, TemplateVar } from "@/model/campaigns";
import { store } from "@/state/store";
import { newRid } from "./autoText";
import { nf, Notice, segRule } from "./base/shared";
import { EXCLUDED, errorList, errText, segmentTitle } from "./common";
import { DEFAULT_VARS, hasBlanks, toCanon } from "./vars";
import { WaBubble } from "./WaBubble";

const STEPS = ["Шаблон", "Кому", "Аудитория", "Предпросмотр", "Проверка", "Когда"];
const LAST = STEPS.length - 1;
const WHY: Record<string, string> = { ...EXCLUDED, blocked: "нет нужных данных для текста", noname: "нет имени" };
// причины «нет разрешения на связь» — отдельно от правил компании (ТЗ V3): без согласия и после «стоп» не пишем никогда
const CONSENT_CODES = new Set(["noconsent", "stop", "optout", "restricted", "restriction", "denied"]);
const HOURS = Array.from({ length: 15 }, (_, i) => i + 8); // 8–22
const CLIENTS: [string, string, string] = ["клиент", "клиента", "клиентов"];

/** Воронка: от сервера; у старого ответа — собрать из «кому не уйдёт». */
function funnelOf(d: CampaignCheck, seg?: CrmSegment): AudienceFunnel | null {
  if (d.funnel) return d.funnel;
  if (!d.excluded) return null;
  const list = d.excluded.filter((x) => x.n > 0).map((x) => ({ ...x, why: x.why || WHY[x.code] || x.code }));
  const rules = list.filter((x) => !CONSENT_CODES.has(x.code)), consent = list.filter((x) => CONSENT_CODES.has(x.code));
  const out = list.reduce((a, x) => a + x.n, 0);
  return { total: 0, valid: 0, segment: seg?.n ? seg.n + out : d.valid + out, rules, consent, allowed: d.valid };
}

/** Все клиенты сегмента (у старого сервера — только те, кому можно писать). */
const totalOf = (s: CrmSegment) => s.total ?? s.n;

type Preset = { tplId?: string; seg?: string; spec?: SegmentSpec };
export default function GaWizard({ ws, owner, open, preset, onClose, onDone }: { ws: string; owner: boolean; open: boolean; preset?: Preset; onClose: () => void; onDone: (id: string) => void }) {
  const [step, setStep] = useState(0);
  const [segs, setSegs] = useState<CrmSegment[] | null>(null);
  const [segErr, setSegErr] = useState("");
  const [statuses, setStatuses] = useState<CrmStatuses | null>(null);
  const [seg, setSeg] = useState("");
  const [lib, setLib] = useState<{ items: LibraryItem[]; vars: TemplateVar[] } | null>(null);
  const [tplId, setTplId] = useState(preset?.tplId || "");
  const [own, setOwn] = useState("");
  const [lang, setLang] = useState<"ru" | "kk">("ru");
  const [check, setCheck] = useState<{ data?: CampaignCheck; error?: string; busy?: boolean }>({});
  // пример на клиентах сегмента (с пометкой, кто не получит) и тот же текст без имени: сырой текст с {{…}} показывать нельзя (ТЗ v3.0 §4.2)
  const [demo, setDemo] = useState<{ list: TemplatePreview["list"]; demo: boolean; noName: string } | null>(null);
  // проба: только на номер для проверки владельца (сервер берёт его сам); null — ещё не узнали, "" — не указан
  const [testPhone, setTestPhone] = useState<string | null>(null);
  const [phoneIn, setPhoneIn] = useState("");
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [test, setTest] = useState<{ busy?: boolean; ok?: string; off?: string; code?: string; preview?: string; error?: string; retry?: boolean }>({});
  const rid = useRef<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [from, setFrom] = useState(11);
  const [to, setTo] = useState(20);
  const [cap, setCap] = useState(20);
  const [busy, setBusy] = useState("");
  // демо-база черновика: клиенты вымышленные — пишем об этом на шагах с числами и примерами
  const [isDemo, setIsDemo] = useState(false);

  // данные мастера: сегменты базы и одобренные тексты — при открытии
  useEffect(() => {
    if (!open || !store.source) return;
    let live = true;
    setStep(0);
    setTplId(preset?.tplId || "");
    setSeg(preset?.seg || "");
    setCheck({});
    setDemo(null);
    setTest({});
    setTestPhone(null);
    rid.current = null;
    setChecked(false);
    store.source.crmSegments(ws).then(
      (d) => {
        if (!live) return;
        // «Вся база» сервер не присылает отдельным сегментом — как на экране базы: все клиенты и кому можно рекламу
        const all: CrmSegment = { id: "all", label: "Вся база", rule: "все клиенты за 90 дней", n: d.ok, total: d.clients };
        // сегменты, где есть клиенты, — и те, где рекламу сейчас не получит никто: воронка на следующем шаге объяснит почему
        setSegs([...d.segments.filter((s) => totalOf(s) > 0 && s.id !== "all"), ...(d.available ? [all] : [])]);
        setStatuses(d.statuses || null);
        setSegErr(d.available ? "" : d.why || "База клиентов не подключена.");
      },
      (e: unknown) => live && setSegErr(errorList(e)[0] || "Сегменты не загрузились"),
    );
    store.source.contactsStatus(ws).then(
      (d) => live && setIsDemo(!!d.demo),
      () => {},
    );
    store.source.templates(ws).then(
      (d) => live && setLib({ items: d.items.filter((x) => !x.archived), vars: d.vars?.length ? d.vars : DEFAULT_VARS }),
      () => live && setLib({ items: [], vars: DEFAULT_VARS }),
    );
    return () => {
      live = false;
    };
  }, [open, ws, preset?.tplId, preset?.seg]);

  const tpl = lib?.items.find((x) => x.id === tplId);
  const vars = lib?.vars || DEFAULT_VARS;
  const text = tpl ? (lang === "kk" ? tpl.kk : tpl.ru) : toCanon(own, vars);
  const segment = segs?.find((s) => s.id === seg);
  // отбор из списка людей сегмента (дни с визита, мастер) — пока выбран тот же сегмент
  const spec: SegmentSpec = preset?.spec && preset.spec.id === seg ? preset.spec : { id: seg };
  const filtered = spec.from !== undefined || spec.to !== undefined || !!spec.staff;
  const draft: CampaignDraft = useMemo(
    () => ({
      name: `${tpl ? tpl.title : "Своё сообщение"} · ${new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}`,
      source: "segment",
      channel: "bot",
      segment: spec,
      tplId: tpl?.id,
      lang,
      text,
      cap,
      from,
      to,
      consent: true,
    }),
    // spec — из preset и seg
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tpl, seg, preset?.spec, lang, text, cap, from, to],
  );

  // аудитория — при входе на шаг «Аудитория» (шаблон и сегмент уже выбраны)
  useEffect(() => {
    if (!open || step !== 2 || !store.source) return;
    let live = true;
    setCheck({ busy: true });
    store.source.checkCampaign(ws, draft).then(
      (data) => live && setCheck({ data }),
      (e: unknown) => live && setCheck({ error: errorList(e)[0] || "Проверка не прошла" }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  // пример на клиентах сегмента (и на тех, кто рекламу не получит, — с причиной) и тот же текст без имени — при входе на «Предпросмотр»
  useEffect(() => {
    if (!open || step !== 3 || !store.source) return;
    let live = true;
    store.source.templatePreview(ws, { ...(tpl ? { id: tpl.id } : { text }), lang, segment: spec }).then(
      (p) => live && setDemo({ list: p.list, demo: p.demo, noName: p.noName?.text || "" }),
      // пример не собрался — тексты из проверки (только те, кому уйдёт)
      () => live && setDemo({ list: (check.data?.samples || []).map((x) => ({ to: x.to, text: x.text, allowed: true })), demo: false, noName: "" }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  // проба: номер для проверки владельца — при входе на «Проверка» (сотруднику проба недоступна, сервер ответит 403)
  useEffect(() => {
    if (!open || step !== 4 || !owner || !store.source || testPhone !== null) return;
    let live = true;
    store.source.autoMessages(ws).then(
      (d) => live && setTestPhone(d.test?.phone || ""),
      () => live && setTestPhone("?"), // не узнали — отправить можно, сервер сам скажет, если номера нет
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, owner]);

  const valid = check.data?.valid ?? 0;
  const funnel = check.data ? funnelOf(check.data, segment) : null;
  const canNext = [!!text.trim() && !hasBlanks(text), !!seg, !!check.data?.ok && valid > 0, true, true, from < to && cap >= 1][step];

  // rid — номер нажатия: повтор после обрыва связи (исход неизвестен) — с тем же rid, сервер второй раз не отправит
  const sendTest = async () => {
    const src = store.source;
    if (!src || test.busy) return;
    rid.current ??= newRid();
    setTest({ busy: true });
    try {
      const ok = await src.testSend(ws, draft, "", rid.current);
      rid.current = null;
      setTest({ ok });
    } catch (e) {
      const a = e instanceof ApiError ? e : null;
      const unsure = !a || a.offline || a.status >= 500;
      if (!unsure) rid.current = null;
      if (a?.code === "notest") {
        setTestPhone("");
        setTest({ error: "Сначала укажите номер для проверки — ниже.", preview: a.preview || "" });
      } else if (a && (a.code === "ga_off" || a.code === "preview")) setTest({ off: a.message, preview: a.preview || "" });
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
  const create = async (approve: boolean) => {
    const src = store.source;
    if (!src) return;
    setBusy(approve ? "approve" : "draft");
    try {
      const c = await src.createCampaign(ws, draft);
      if (approve) await src.campaignAct(ws, c.campaign.id, "approve");
      toast(approve ? "Рассылка одобрена. Запуск со второго номера пока выключен" : "Черновик сохранён");
      onDone(c.campaign.id);
    } catch (e) {
      toast(errorList(e)[0] || "Не получилось сохранить", "critical");
    } finally {
      setBusy("");
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Новая рассылка"
      description={`Второй WhatsApp · шаг ${step + 1} из ${STEPS.length}: ${STEPS[step]}`}
      footer={
        step < LAST ? (
          <div className="flex gap-2 pb-1">
            {step > 0 && (
              <Button icon={ChevronLeft} disabled={!!busy} onClick={() => setStep(step - 1)}>
                Назад
              </Button>
            )}
            <Button variant="primary" className="flex-1" disabled={!canNext} onClick={() => setStep(step + 1)}>
              Далее
            </Button>
          </div>
        ) : (
          // итог: три кнопки в 390 px не помещаются — главное действие отдельной строкой сверху (у сотрудника его нет)
          <div className="space-y-2 pb-1">
            {owner && (
              <Button variant="primary" className="w-full" busy={busy === "approve"} disabled={!!busy || !checked || !canNext} onClick={() => void create(true)}>
                Одобрить
              </Button>
            )}
            <div className="flex gap-2">
              <Button icon={ChevronLeft} disabled={!!busy} onClick={() => setStep(step - 1)}>
                Назад
              </Button>
              <Button variant={owner ? "secondary" : "primary"} className="flex-1" busy={busy === "draft"} disabled={!!busy || !canNext} onClick={() => void create(false)}>
                Сохранить черновик
              </Button>
            </div>
          </div>
        )
      }
    >
      <ol aria-label="Шаги" className="mb-3 flex gap-1 px-4">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={cn("h-1 flex-1 rounded-full transition-colors", i <= step ? "bg-accent" : "bg-surface-3")}>
            <span className="sr-only">{s}</span>
          </li>
        ))}
      </ol>
      <div className="space-y-3 px-4 pb-4">
        {isDemo && step >= 1 && step <= 3 && <p className="rounded-xl border border-brand-gold/40 px-3 py-2 text-sm text-fg-2">Демо-база: числа и примеры на вымышленных клиентах.</p>}
        {step === 0 &&
          (!lib ? (
            <Skeleton className="h-40 w-full rounded-2xl" />
          ) : (
            <>
              <div role="radiogroup" aria-label="Язык" className="inline-flex rounded-lg bg-surface-2 p-0.5 text-sm">
                {(["ru", "kk"] as const).map((l) => (
                  <button key={l} type="button" role="radio" aria-checked={lang === l} onClick={() => setLang(l)} className={cn("rounded-md px-3 py-1 pointer-coarse:py-1.5", lang === l ? "bg-surface font-medium text-fg shadow-sm" : "text-fg-2")}>
                    {l === "ru" ? "Русский" : "Қазақша"}
                  </button>
                ))}
              </div>
              <ul role="radiogroup" aria-label="Сообщение" className="divide-y divide-line rounded-2xl bg-surface">
                {lib.items
                  .filter((x) => x.approved)
                  .map((x) => (
                    <li key={x.id}>
                      <button type="button" role="radio" aria-checked={tplId === x.id} onClick={() => setTplId(x.id)} className="flex w-full items-start gap-3 px-3 py-3 text-left">
                        <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2", tplId === x.id ? "border-accent" : "border-line-strong")}>{tplId === x.id && <span className="size-2.5 rounded-full bg-accent" />}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{x.title}</span>
                          <span className="block text-sm text-fg-2">{x.who || x.goal}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                <li>
                  <button type="button" role="radio" aria-checked={!tplId} onClick={() => setTplId("")} className="flex w-full items-start gap-3 px-3 py-3 text-left">
                    <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2", !tplId ? "border-accent" : "border-line-strong")}>{!tplId && <span className="size-2.5 rounded-full bg-accent" />}</span>
                    <span className="font-medium">Свой текст</span>
                  </button>
                </li>
              </ul>
              {!lib.items.some((x) => x.approved) && <p className="text-sm text-fg-3">Одобренных шаблонов пока нет. Владелец одобряет их во вкладке «Шаблоны».</p>}
              {!tplId && (
                <>
                  <textarea
                    aria-label="Текст сообщения"
                    rows={5}
                    maxLength={1000}
                    value={own}
                    onChange={(e) => setOwn(e.target.value)}
                    placeholder="Здравствуйте, {Имя клиента}! …"
                    className="block w-full resize-y rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-md leading-[1.375rem] outline-none focus:border-accent"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {vars.map((v) => (
                      <button key={v.key} type="button" onClick={() => setOwn((t) => `${t}{${v.label}}`)} className="inline-flex h-8 items-center rounded-full bg-accent-soft px-3 text-sm font-medium text-accent-ink">
                        {v.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-fg-3">Строку про «стоп» сервер добавит сам, если её нет.</p>
                </>
              )}
              {hasBlanks(text) && <Notice>В тексте есть [скобки]. Впишите настоящие данные или выберите другой текст.</Notice>}
            </>
          ))}

        {step === 1 &&
          (segErr ? (
            <Notice>{segErr}</Notice>
          ) : !segs ? (
            <Skeleton className="h-40 w-full rounded-2xl" />
          ) : (
            <>
              <p className="text-sm text-fg-2">Кому отправить. Слева — все клиенты сегмента, «можно рекламу» — кто её получит: с подтверждённым согласием, без «стопа» и без рекламы за 30 дней.</p>
              {statuses && (
                <p className="rounded-xl bg-surface px-3 py-2 text-sm text-fg-2">
                  В базе <b className="tnum font-semibold text-fg">{nf.format(statuses.base)}</b> · номер верный <b className="tnum font-semibold text-fg">{nf.format(statuses.valid)}</b> · реклама можно{" "}
                  <b className="tnum font-semibold text-fg">{nf.format(statuses.marketing)}</b> · отказались <b className="tnum font-semibold text-fg">{nf.format(statuses.stopped)}</b>
                </p>
              )}
              <ul role="radiogroup" aria-label="Сегмент" className="divide-y divide-line rounded-2xl bg-surface">
                {segs.map((s) => (
                  <li key={s.id}>
                    <button type="button" role="radio" aria-checked={seg === s.id} onClick={() => setSeg(s.id)} className="flex w-full items-center gap-3 px-3 py-3 text-left">
                      <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2", seg === s.id ? "border-accent" : "border-line-strong")}>{seg === s.id && <span className="size-2.5 rounded-full bg-accent" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{s.label}</span>
                        {segRule(s) && <span className="block truncate text-sm text-fg-2">{segRule(s)}</span>}
                        {seg === s.id && filtered && <span className="block truncate text-sm text-accent-ink">Отбор: {segmentTitle(spec).replace(/^[^·]*·\s*/, "")}</span>}
                      </span>
                      <span className="tnum shrink-0 text-right text-sm text-fg-2">
                        <span className="block">
                          <Users aria-hidden className="mr-1 inline size-3.5" />
                          {nf.format(totalOf(s))}
                        </span>
                        <span className={cn("block text-xs", s.n ? "text-positive" : "text-fg-3")}>можно рекламу: {nf.format(s.n)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ))}

        {step === 2 &&
          (check.busy ? (
            <Skeleton className="h-56 w-full rounded-2xl" />
          ) : check.error ? (
            <Notice tone="critical">{check.error}</Notice>
          ) : check.data ? (
            <>
              <p className="flex items-center gap-2 text-md">
                <CircleCheck aria-hidden className={cn("size-5", valid ? "text-positive" : "text-fg-3")} />
                <span>
                  Получат: <b className="tnum">{nf.format(valid)}</b> {plural(valid, CLIENTS)}
                </span>
              </p>
              {funnel && <Funnel f={funnel} />}
              {valid === 0 && !check.data.errors.length && (
                <Notice>Некому отправить: в этом сегменте сейчас никто не может получить рекламу. Выберите другой сегмент или дождитесь согласий клиентов.</Notice>
              )}
              {!!check.data.errors.length && (
                <Notice tone="critical">
                  {check.data.errors.map((e) => (
                    <span key={e} className="block">
                      {e[0].toUpperCase() + e.slice(1)}
                    </span>
                  ))}
                </Notice>
              )}
              <p className="text-xs text-fg-3">Без согласия и после «стоп» сообщения не уходят никогда. Это решает сервер, а не пульт.</p>
            </>
          ) : null)}

        {step === 3 &&
          (!demo ? (
            <Skeleton className="h-40 w-full rounded-2xl" />
          ) : (
            <>
              {demo.list.length > 0 && <p className="text-sm font-medium text-fg-2">{demo.demo ? "Так увидит клиент" : "Так увидят клиенты"}</p>}
              {demo.list.slice(0, 3).map((x, i) => (
                <div key={i}>
                  {/* пример и на тех, кому реклама сейчас не уйдёт: им не уйдёт — так и пишем (без согласия рекламы нет) */}
                  {x.allowed === false && (
                    <p className="mb-1 text-sm font-medium text-fg-2">Не получит: {x.why || "нет согласия на рекламу"}</p>
                  )}
                  <WaBubble text={x.text} to={x.to && x.to !== "пример" ? x.to : undefined} className={cn(x.allowed === false && "opacity-60")} />
                </div>
              ))}
              {demo.demo && demo.list.length > 0 && <p className="text-xs text-fg-3">Пример на вымышленном клиенте.</p>}
              {!demo.demo && demo.list.some((x) => x.allowed === false) && (
                <p className="text-xs text-fg-3">Бледные — клиенты сегмента, которым реклама сейчас не уйдёт: их сервер пропустит.</p>
              )}
              {demo.noName && demo.noName !== demo.list[0]?.text && (
                <div>
                  <p className="mb-1 text-xs text-fg-3">Если имени клиента нет:</p>
                  <WaBubble text={demo.noName} />
                </div>
              )}
            </>
          ))}

        {step === 4 && (
          <>
            <p className="text-sm text-fg-2">Отправьте пример себе, чтобы увидеть сообщение в WhatsApp. Он придёт со второго номера на ваш номер для проверки, клиентам на этом шаге ничего не уходит.</p>
            {!owner ? (
              <Notice tone="muted">Пример себе отправляет владелец — на свой номер для проверки.</Notice>
            ) : testPhone === null ? (
              <Skeleton className="h-24 w-full rounded-xl" />
            ) : testPhone ? (
              <div className="rounded-xl bg-surface px-3 py-3">
                {testPhone !== "?" && (
                  <p className="text-sm text-fg-2">
                    Номер для проверки: <span className="tnum font-medium text-fg">{testPhone}</span>
                  </p>
                )}
                <Button variant="secondary" icon={FlaskConical} className="mt-2 w-full" busy={test.busy} onClick={() => void sendTest()}>
                  {test.retry ? "Повторить" : "Отправить пример себе"}
                </Button>
                <p className="mt-1.5 text-xs text-fg-3">Сменить номер — «Рассылки» → «Автоматические» → «Номер для проверки».</p>
              </div>
            ) : (
              <div className="rounded-xl bg-surface px-3 py-3">
                <p className="text-sm">Номер для проверки не указан. Впишите свой номер WhatsApp: он сохранится в «Автоматические» → «Номер для проверки».</p>
                <div className="mt-2 flex gap-2">
                  <input
                    aria-label="Номер для проверки"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phoneIn}
                    onChange={(e) => setPhoneIn(e.target.value)}
                    placeholder="+7 701 123 45 67"
                    className="h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 text-md outline-none focus:border-accent"
                  />
                  <Button busy={phoneBusy} disabled={phoneBusy || phoneIn.replace(/\D/g, "").length < 10} onClick={() => void savePhone()}>
                    Сохранить
                  </Button>
                </div>
              </div>
            )}
            {test.ok && (
              <p role="status" className="flex gap-2 py-1 text-ui text-positive pointer-coarse:text-base">
                <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
                <span className="min-w-0">{test.ok}</span>
              </p>
            )}
            {test.error && <Notice tone="critical">{test.error}</Notice>}
            {test.error && test.preview && <WaBubble text={test.preview} />}
            {test.off !== undefined && (
              <>
                <Notice tone="muted">{test.off || "Пробная отправка со второго номера отсюда не уходит."} Ниже то, что пришло бы вам.</Notice>
                {test.preview && <WaBubble text={test.preview} />}
              </>
            )}
            <label className="flex items-start gap-3 rounded-xl bg-surface px-3 py-3">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]" />
              <span className="text-sm">
                Я проверил текст и список получателей: {nf.format(valid)} {plural(valid, CLIENTS)}.
                {owner ? " Без этой отметки одобрить нельзя." : ""}
              </span>
            </label>
          </>
        )}

        {step === 5 && (
          <>
            <p className="text-sm text-fg-2">Сообщения уходят по одному, с паузой, только в эти часы по Астане. Кто ответит «стоп», больше ничего не получит.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-fg-2">С</span>
                <select value={from} onChange={(e) => setFrom(+e.target.value)} className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-md">
                  {HOURS.slice(0, -1).map((h) => (
                    <option key={h} value={h}>{`${h}:00`}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-fg-2">До</span>
                <select value={to} onChange={(e) => setTo(+e.target.value)} className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-md">
                  {HOURS.slice(1).map((h) => (
                    <option key={h} value={h}>{`${h}:00`}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-fg-2">Не больше в день</span>
              <input type="number" inputMode="numeric" min={1} max={300} value={cap} onChange={(e) => setCap(Math.max(1, Math.min(300, Math.round(+e.target.value || 1))))} className="tnum h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-md" />
            </label>
            {from >= to && <Notice tone="critical">Время «до» должно быть позже «с».</Notice>}
            {valid > 0 && <p className="text-sm text-fg-3">При {nf.format(cap)} в день {nf.format(valid)} {plural(valid, ["клиент получит", "клиента получат", "клиентов получат"])} сообщения примерно за {nf.format(Math.ceil(valid / cap))} {plural(Math.ceil(valid / cap), ["день", "дня", "дней"])}.</p>}
            <dl className="divide-y divide-line rounded-2xl bg-surface px-3">
              <Row label="Номер">Второй WhatsApp</Row>
              <Row label="Кому">{segment ? `${segment.label}, ${nf.format(valid)} ${plural(valid, CLIENTS)}` : "не выбрано"}</Row>
              <Row label="Сообщение">{tpl ? tpl.title : "Свой текст"}{lang === "kk" ? ", на казахском" : ""}</Row>
              <Row label="Проверено">{checked ? "да" : "нет"}</Row>
            </dl>
            {owner && !checked && <Notice tone="muted">Чтобы одобрить, вернитесь на шаг «Проверка» и отметьте, что всё проверено.</Notice>}
            <Notice tone="muted">Запуск рассылок со второго номера пока выключен. Сохраните черновик{owner ? " или одобрите его" : ""}: запустить можно будет, когда владелец включит рассылки с этого номера.</Notice>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Воронка аудитории: всего → с правильным номером → по сегменту → исключения (правила и разрешения) → можно отправлять. */
function Funnel({ f }: { f: AudienceFunnel }) {
  const rules = f.rules.filter((x) => x.n > 0), consent = f.consent.filter((x) => x.n > 0);
  return (
    <div className="rounded-2xl bg-surface px-3 py-1">
      <dl aria-label="Аудитория" className="divide-y divide-line">
        {f.total > 0 && <Row label="Клиентов в журнале Altegio">{nf.format(f.total)}</Row>}
        {f.valid > 0 && <Row label="С правильным номером">{nf.format(f.valid)}</Row>}
        <Row label="Подходят по сегменту">{nf.format(f.segment)}</Row>
        <Reasons title="Не подходят по правилам" list={rules} />
        <Reasons title="Нет разрешения на связь" list={consent} />
        <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
          <dt className="font-semibold">Можно отправлять</dt>
          <dd className="tnum font-semibold">{nf.format(f.allowed)}</dd>
        </div>
      </dl>
    </div>
  );
}

function Reasons({ title, list }: { title: string; list: FunnelReason[] }) {
  if (!list.length) return null;
  const sum = list.reduce((a, x) => a + x.n, 0);
  return (
    <div className="py-2.5 text-sm">
      <div className="flex items-start justify-between gap-4">
        <dt className="text-fg-2">{title}</dt>
        <dd className="tnum font-medium">−{nf.format(sum)}</dd>
      </div>
      <ul className="mt-1 space-y-0.5 text-fg-3">
        {list.map((x) => (
          <li key={x.code} className="flex justify-between gap-3 pl-3">
            <span>{x.why || WHY[x.code] || x.code}</span>
            <span className="tnum">{nf.format(x.n)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <dt className="shrink-0 text-fg-2">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}
