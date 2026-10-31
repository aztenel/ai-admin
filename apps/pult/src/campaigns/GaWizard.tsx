// «Создать рассылку» со второго номера (ТЗ v3.0 §5.2, 31.10.2026): Кому → Сообщение → Проверка → Когда → Итог.
// Никаких полей Meta и {{1}}: текст — из библиотеки или свой, имя и данные сервер подставляет каждому клиенту сам;
// клиенту без имени — приветствие без имени. Получатели — сегмент базы клиентов, только с подтверждённым согласием,
// без «стоп» и не чаще раза в 30 дней (исключения сервер считает и показывает причинами).
// Итог: «Сохранить черновик» (сотрудник и владелец), «Одобрить» (владелец). «Запустить» — недоступно, пока запуск рассылок
// со второго номера не включён отдельным решением владельца (сервер всё равно ответит отказом). Реальных отправок здесь нет.
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, CircleCheck, Users } from "lucide-react";
import { Sheet, toast } from "@/components/overlay";
import { Button, Skeleton } from "@/components/ui";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CampaignCheck, CampaignDraft, CrmSegment, LibraryItem, TemplateVar } from "@/model/campaigns";
import { store } from "@/state/store";
import { nf, Notice, segRule } from "./base/shared";
import { EXCLUDED, errorList } from "./common";
import { DEFAULT_VARS, hasBlanks, toCanon } from "./vars";
import { WaBubble } from "./WaBubble";

const STEPS = ["Кому", "Сообщение", "Проверка", "Когда", "Итог"];
const WHY: Record<string, string> = { ...EXCLUDED, blocked: "нет нужных данных для текста", noname: "нет имени" };
const HOURS = Array.from({ length: 15 }, (_, i) => i + 8); // 8–22

export default function GaWizard({ ws, owner, open, preset, onClose, onDone }: { ws: string; owner: boolean; open: boolean; preset?: { tplId?: string; seg?: string }; onClose: () => void; onDone: (id: string) => void }) {
  const [step, setStep] = useState(0);
  const [segs, setSegs] = useState<CrmSegment[] | null>(null);
  const [segErr, setSegErr] = useState("");
  const [seg, setSeg] = useState("");
  const [lib, setLib] = useState<{ items: LibraryItem[]; vars: TemplateVar[] } | null>(null);
  const [tplId, setTplId] = useState(preset?.tplId || "");
  const [own, setOwn] = useState("");
  const [lang, setLang] = useState<"ru" | "kk">("ru");
  const [check, setCheck] = useState<{ data?: CampaignCheck; error?: string; busy?: boolean }>({});
  // некому писать (нет базы, нет согласий) — пример на вымышленном клиенте: сырой текст с {{…}} показывать нельзя (ТЗ v3.0 §4.2)
  const [demo, setDemo] = useState("");
  const [from, setFrom] = useState(11);
  const [to, setTo] = useState(20);
  const [cap, setCap] = useState(20);
  const [busy, setBusy] = useState("");

  // данные мастера: сегменты базы и одобренные тексты — при открытии
  useEffect(() => {
    if (!open || !store.source) return;
    let live = true;
    setStep(0);
    setTplId(preset?.tplId || "");
    setSeg(preset?.seg || "");
    setCheck({});
    store.source.crmSegments(ws).then(
      (d) => {
        if (!live) return;
        // «Вся база» сервер не присылает отдельным сегментом — как на экране базы, собираем из числа «можно писать»
        const all: CrmSegment = { id: "all", label: "Вся база", rule: "все, кому можно писать", n: d.ok };
        setSegs([...d.segments.filter((s) => s.n > 0 && s.id !== "all"), ...(d.available ? [all] : [])]);
        setSegErr(d.available ? "" : d.why || "База клиентов не подключена.");
      },
      (e: unknown) => live && setSegErr(errorList(e)[0] || "Сегменты не загрузились"),
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
  const draft: CampaignDraft = useMemo(
    () => ({
      name: `${tpl ? tpl.title : "Своё сообщение"} · ${new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}`,
      source: "segment",
      channel: "bot",
      segment: { id: seg },
      tplId: tpl?.id,
      lang,
      text,
      cap,
      from,
      to,
      consent: true,
    }),
    [tpl, seg, lang, text, cap, from, to],
  );

  // проверка — при входе на шаг «Проверка»
  useEffect(() => {
    if (!open || step !== 2 || !store.source) return;
    let live = true;
    setCheck({ busy: true });
    setDemo("");
    const src = store.source;
    src.checkCampaign(ws, draft).then(
      (data) => {
        if (!live) return;
        setCheck({ data });
        if (!data.samples?.length)
          src.templatePreview(ws, tpl ? { id: tpl.id, lang } : { text, lang }).then(
            (p) => live && setDemo(p.list[0]?.text || ""),
            () => {},
          );
      },
      (e: unknown) => live && setCheck({ error: errorList(e)[0] || "Проверка не прошла" }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  const valid = check.data?.valid ?? 0;
  const canNext = [!!seg, !!text.trim() && !hasBlanks(text), !!check.data?.ok && valid > 0, from < to && cap >= 1, true][step];
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
        step < 4 ? (
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
              <Button variant="primary" className="w-full" busy={busy === "approve"} disabled={!!busy} onClick={() => void create(true)}>
                Одобрить
              </Button>
            )}
            <div className="flex gap-2">
              <Button icon={ChevronLeft} disabled={!!busy} onClick={() => setStep(step - 1)}>
                Назад
              </Button>
              <Button variant={owner ? "secondary" : "primary"} className="flex-1" busy={busy === "draft"} disabled={!!busy} onClick={() => void create(false)}>
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
        {step === 0 &&
          (segErr ? (
            <Notice>{segErr}</Notice>
          ) : !segs ? (
            <Skeleton className="h-40 w-full rounded-2xl" />
          ) : (
            <>
              <p className="text-sm text-fg-2">Кому отправить. Числа уже без тех, кто просил не писать, без согласия или получал рекламу за 30 дней.</p>
              <ul role="radiogroup" aria-label="Сегмент" className="divide-y divide-line rounded-2xl bg-surface">
                {segs.map((s) => (
                  <li key={s.id}>
                    <button type="button" role="radio" aria-checked={seg === s.id} onClick={() => setSeg(s.id)} className="flex w-full items-center gap-3 px-3 py-3 text-left">
                      <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2", seg === s.id ? "border-accent" : "border-line-strong")}>{seg === s.id && <span className="size-2.5 rounded-full bg-accent" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{s.label}</span>
                        {segRule(s) && <span className="block truncate text-sm text-fg-2">{segRule(s)}</span>}
                      </span>
                      <span className="tnum shrink-0 text-sm text-fg-2">
                        <Users aria-hidden className="mr-1 inline size-3.5" />
                        {nf.format(s.n)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ))}

        {step === 1 &&
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

        {step === 2 &&
          (check.busy ? (
            <Skeleton className="h-48 w-full rounded-2xl" />
          ) : check.error ? (
            <Notice tone="critical">{check.error}</Notice>
          ) : check.data ? (
            <>
              <p className="flex items-center gap-2 text-md">
                <CircleCheck aria-hidden className={cn("size-5", valid ? "text-positive" : "text-fg-3")} />
                <span>
                  Получат: <b className="tnum">{nf.format(valid)}</b> {plural(valid, ["клиент", "клиента", "клиентов"])}
                </span>
              </p>
              {!!check.data.excluded?.filter((x) => x.n > 0).length && (
                <div className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
                  <p className="mb-1 font-medium text-fg-2">Не получат</p>
                  <ul className="space-y-0.5 text-fg-2">
                    {check.data.excluded
                      .filter((x) => x.n > 0)
                      .map((x) => (
                        <li key={x.code} className="flex justify-between gap-3">
                          <span>{x.why || WHY[x.code] || x.code}</span>
                          <span className="tnum">{nf.format(x.n)}</span>
                        </li>
                      ))}
                  </ul>
                </div>
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
              {(!!check.data.samples?.length || !!demo) && <p className="text-sm font-medium text-fg-2">Так увидят клиенты</p>}
              {check.data.samples?.length ? (
                check.data.samples.slice(0, 3).map((x, i) => <WaBubble key={i} text={x.text} to={x.to || undefined} />)
              ) : demo ? (
                <>
                  <WaBubble text={demo} />
                  <p className="text-xs text-fg-3">Пример на вымышленном клиенте.</p>
                </>
              ) : null}
            </>
          ) : null)}

        {step === 3 && (
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
          </>
        )}

        {step === 4 && (
          <>
            <dl className="divide-y divide-line rounded-2xl bg-surface px-3">
              <Row label="Номер">Второй WhatsApp</Row>
              <Row label="Кому">{segment ? `${segment.label}, ${nf.format(valid)} ${plural(valid, ["клиент", "клиента", "клиентов"])}` : "—"}</Row>
              <Row label="Сообщение">{tpl ? tpl.title : "Свой текст"}{lang === "kk" ? ", на казахском" : ""}</Row>
              <Row label="Когда">{`с ${from}:00 до ${to}:00, не больше ${cap} в день`}</Row>
            </dl>
            {check.data?.samples?.[0] && <WaBubble text={check.data.samples[0].text} to={check.data.samples[0].to} />}
            <Notice tone="muted">Запуск рассылок со второго номера пока выключен. Сохраните черновик{owner ? " или одобрите его" : ""}: запустить можно будет, когда владелец включит рассылки с этого номера.</Notice>
          </>
        )}
      </div>
    </Sheet>
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
