// Разделы мастера рассылки: кому, сообщение (шаблон Meta), часы и предел, проверка (предпросмотр, стоимость, пробная себе), запуск.
// На телефоне — по одному на экран, на компьютере — одной формой. Тексты сервера (ошибки, правила, ответ пробной отправки) — как есть.
import { CircleCheck, FileUp, Plus, RefreshCw, SlidersHorizontal, TriangleAlert, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Banner, Button, Field, IconButton, Segmented, Skeleton, Spinner } from "@/components/ui";
import { formatPhone, plural, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CampaignCheck, CampaignDraft, CampaignsOverview, CrmOverview } from "@/model/campaigns";
import { Group } from "@/screens/Page";
import { store } from "@/state/store";
import { checkErrors, costEstimate, errText, LANGS, MARKETING_PRICE_KZT, money, QUALITY, segmentTitle } from "../common";
import type { Loaded } from "../useLoad";
import { Checkbox, ErrorList, Note, RadioRow, SelectField, TextArea, TextField } from "./fields";
import { segRule } from "../base/shared";
import { capNum, cleanParams, templateVars, type BaseState, type Errs, type Form, type Resolved } from "./form";
import { fillTemplate, TemplatePreview } from "./Preview";

type P = { f: Form; set: (p: Partial<Form>) => void; r: Resolved; errs: Errs };
const nf = new Intl.NumberFormat("ru-RU");
const people = (n: number) => `${nf.format(n)} ${plural(n, ["человек", "человека", "человек"])}`;
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Заголовок раздела на компьютере (на телефоне заголовок шага — в рамке мастера). */
export function SectionTitle({ n, children, show }: { n: number; children: ReactNode; show: boolean }) {
  if (!show) return null;
  return (
    <h2 className="mb-3 mt-2 flex items-baseline gap-2 px-1 text-lg font-semibold tracking-[-0.01em]">
      <span className="tnum text-fg-3">{n}.</span>
      {children}
    </h2>
  );
}

// ---------- 1. Кому ----------
export function RecipientsSection({ f, set, r, errs, crm, base, owner }: P & { crm: Loaded<CrmOverview>; base: BaseState; owner: boolean }) {
  return (
    <>
      {base === "loading" ? (
        <div className="mb-6 space-y-2">
          <Skeleton className="h-10 rounded-[0.625rem]" />
          <Skeleton className="h-40 rounded-[0.875rem]" />
        </div>
      ) : base === "none" ? (
        <p className="mb-4 px-1 text-sm text-fg-2">
          {crm.error && !crm.data ? `База клиентов не загрузилась: ${crm.error}` : "Базы клиентов из Altegio у компании нет — вставьте список номеров."}
          {crm.error && !crm.data && (
            <button type="button" onClick={() => void crm.reload()} className="ml-1 inline-flex items-center font-medium text-accent-ink underline-offset-2 hover:underline pointer-coarse:min-h-11">
              Повторить
            </button>
          )}
        </p>
      ) : (
        <Segmented
          label="Откуда получатели"
          value={r.source}
          onChange={(v) => set({ source: v })}
          options={[
            { id: "segment", label: "База клиентов" },
            { id: "list", label: "Список номеров" },
          ]}
          className="mb-5 flex w-full"
        />
      )}
      {base !== "loading" && (r.source === "segment" ? <SegmentPicker f={f} set={set} r={r} errs={errs} crm={crm.data} base={base} owner={owner} /> : <ListInput f={f} set={set} r={r} errs={errs} />)}
    </>
  );
}

function SegmentPicker({ f, set, r, errs, crm, base, owner }: P & { crm?: CrmOverview; base: BaseState; owner: boolean }) {
  if (base !== "ready" || !crm)
    return (
      <Group>
        <p className="py-3 text-ui text-fg-2 pointer-coarse:text-base">
          {base === "empty"
            ? owner
              ? "Базы клиентов ещё нет. Нажмите «Обновить базу» в разделе «База клиентов» — бот прочитает журнал Altegio (до минуты)."
              : "Базы клиентов ещё нет. Её собирает владелец кнопкой «Обновить базу» в разделе «База клиентов»."
            : "Базы клиентов у компании нет. Выберите «Список номеров»."}
        </p>
      </Group>
    );
  const main = crm.segments.filter((s) => !s.id.startsWith("staff:"));
  const staff = crm.segments.filter((s) => s.id.startsWith("staff:"));
  const pick = (id: string) => set({ segId: id });
  const masters = Array.from(new Set([...staff.map((s) => s.id.slice(6)), ...(f.staff ? [f.staff] : [])]));
  return (
    <>
      {errs.segId && <ErrorList errors={[errs.segId]} title="Не выбран сегмент" className="mb-4" />}
      <Group title="Сегмент базы" note={`База обновлена ${shortDate(crm.at, Date.now())}. Можно писать ${nf.format(crm.ok)} из ${nf.format(crm.clients)}: кто просил не писать, записан, был меньше 14 дней назад или уже получал рассылку за 14 дней — не входят.`}>
        <div role="radiogroup" aria-label="Сегмент базы" className="[&>*+*]:border-t [&>*+*]:border-line">
          {main.map((s) => (
            <RadioRow key={s.id} name="seg" checked={r.spec.id === s.id} onSelect={() => pick(s.id)} title={s.label} sub={segRule(s)} aside={nf.format(s.n)} />
          ))}
          <RadioRow name="seg" checked={r.spec.id === "all"} onSelect={() => pick("all")} title="Вся база" sub="все, кому можно писать сейчас" aside={nf.format(crm.ok)} />
        </div>
      </Group>
      {staff.length > 0 && (
        <Group title="Клиенты мастера">
          <div role="radiogroup" aria-label="Клиенты мастера" className="[&>*+*]:border-t [&>*+*]:border-line">
            {staff.map((s) => (
              <RadioRow key={s.id} name="seg" checked={r.spec.id === s.id} onSelect={() => pick(s.id)} title={s.label} sub={segRule(s)} aside={nf.format(s.n)} />
            ))}
          </div>
        </Group>
      )}
      {!f.filters ? (
        <Button variant="ghost" icon={SlidersHorizontal} onClick={() => set({ filters: true })} className="-mt-3 mb-5 text-accent-ink hover:text-accent-ink">
          Уточнить: дни с визита, мастер
        </Button>
      ) : (
        <>
          <Group title="Уточнение">
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Дней с визита: от" inputMode="numeric" value={f.dayFrom} onChange={(e) => set({ dayFrom: e.target.value })} placeholder="0" aria-invalid={errs.days ? true : undefined} />
              <TextField label="до" inputMode="numeric" value={f.dayTo} onChange={(e) => set({ dayTo: e.target.value })} placeholder="400" aria-invalid={errs.days ? true : undefined} />
            </div>
            {errs.days && <p data-error className="py-2 text-sm text-critical">{errs.days}</p>}
            {masters.length > 0 && (
              <SelectField label="Мастер последнего визита" value={f.staff} onChange={(e) => set({ staff: e.target.value })}>
                <option value="">Любой</option>
                {masters.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </SelectField>
            )}
          </Group>
          <Note>
            Сколько людей подходит — покажет проверка.{" "}
            <button type="button" onClick={() => set({ filters: false, dayFrom: "", dayTo: "", staff: "" })} className="inline-flex items-center font-medium text-accent-ink hover:underline pointer-coarse:min-h-11">
              Убрать уточнение
            </button>
          </Note>
        </>
      )}
    </>
  );
}

function ListInput({ f, set, errs }: P) {
  const [fileErr, setFileErr] = useState("");
  const onFile = async (file: File | undefined) => {
    setFileErr("");
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) return setFileErr("Файл больше 3 МБ — вставьте список текстом.");
    try {
      set({ recipients: await file.text() });
    } catch {
      setFileErr("Файл не прочитался. Скопируйте столбцы из Excel и вставьте сюда.");
    }
  };
  return (
    <>
      <Group>
        <TextArea
          label="Номера и имена"
          rows={7}
          value={f.recipients}
          onChange={(e) => set({ recipients: e.target.value })}
          placeholder={"+7 7XX XXX XX XX, Айгерим\n+7 7XX XXX XX XX, Арман"}
          error={errs.recipients}
          hint="По клиенту на строке: номер и имя через запятую. Из Excel — выделите столбцы с номером и именем, скопируйте и вставьте. Повторы и тех, кто просил не писать, бот уберёт сам."
          spellCheck={false}
        />
        <div className="py-3">
          <label className="inline-flex">
            <input type="file" accept=".csv,.txt,text/csv,text/plain" className="peer sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
            <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[0.625rem] border border-line-strong bg-surface px-3.5 text-ui font-medium text-fg hover:bg-surface-2 peer-focus-visible:outline-2 peer-focus-visible:outline-ring pointer-coarse:h-11 pointer-coarse:text-base">
              <FileUp aria-hidden className="size-4" strokeWidth={2} />
              Загрузить из файла .csv или .txt
            </span>
          </label>
          {fileErr && <p className="mt-1.5 text-sm text-critical">{fileErr}</p>}
        </div>
      </Group>
      <Group>
        <SelectField label="Кому из списка" value={f.listKind} onChange={(e) => set({ listKind: e.target.value as Form["listKind"] })}>
          <option value="">Всем из списка</option>
          <option value="idle">Кто не был дольше N дней</option>
          <option value="bday">У кого день рождения в ближайшие N дней</option>
        </SelectField>
        {f.listKind && (
          <TextField
            label="Сколько дней"
            inputMode="numeric"
            value={f.listDays}
            onChange={(e) => set({ listDays: e.target.value })}
            error={errs.listDays}
            hint={f.listKind === "idle" ? "Нужен столбец с датой последнего визита." : "Нужен столбец с днём рождения."}
          />
        )}
      </Group>
    </>
  );
}

// ---------- 2. Сообщение (шаблон Meta) ----------
export function MessageSection({ f, set, errs }: P) {
  const vars = templateVars(f.text);
  const n = cleanParams(f.params).length;
  // число переменных и подстановок не совпало — Meta не примет шаблон (#132000), рассылка встанет на первом же сообщении. Чаще всего:
  // текст без {{1}}, а подстановка {имя} осталась по умолчанию (находка проверки 19.10.2026)
  const mismatch = !!f.text.trim() && vars !== n;
  const setParam = (i: number, v: string) => set({ params: f.params.map((p, j) => (j === i ? v : p)) });
  return (
    <>
      <Group>
        <TextField
          label="Название шаблона в Meta"
          value={f.tpl}
          onChange={(e) => set({ tpl: e.target.value })}
          placeholder="например, promo_october"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          error={errs.tpl}
          hint="Как в кабинете Meta или Wazzapo. Шаблон должен быть одобрен, категория «Маркетинг»."
        />
        <div className="py-3">
          <p id="wz-lang" className="mb-1.5 text-sm font-medium text-fg-2">
            Язык шаблона
          </p>
          <Segmented label="Язык шаблона" value={f.lang} onChange={(v) => set({ lang: v })} options={LANGS.map((l) => ({ id: l.id, label: l.label }))} className="flex w-full" />
        </div>
      </Group>
      <Group>
        <TextArea
          label="Текст шаблона"
          rows={5}
          maxLength={1100}
          value={f.text}
          onChange={(e) => set({ text: e.target.value })}
          placeholder={"Например: Здравствуйте, {{1}}! Давно вас не видели…\nЧтобы не получать сообщения, ответьте СТОП"}
          error={errs.text}
          hint="Скопируйте из кабинета Meta, вместе с {{1}}. Его увидят администратор и бот — клиент может ответить на рассылку."
        />
      </Group>
      <Group
        title="Подстановки"
        note={
          <>
            Что поставить вместо {"{{1}}"}, {"{{2}}"}… — по порядку. {"{имя}"} — имя клиента. В шаблоне нет переменных — уберите все строки.
          </>
        }
      >
        {f.params.map((p, i) => (
          <div key={i} className="flex items-end gap-1">
            <TextField label={`Вместо {{${i + 1}}}`} value={p} onChange={(e) => setParam(i, e.target.value)} maxLength={300} className="flex-1" />
            <IconButton icon={X} label={`Убрать подстановку ${i + 1}`} onClick={() => set({ params: f.params.filter((_, j) => j !== i) })} className="mb-3" />
          </div>
        ))}
        {f.params.length < 10 && (
          <div className="flex flex-wrap gap-2 py-2.5">
            <Button variant="ghost" size="sm" icon={Plus} onClick={() => set({ params: [...f.params, ""] })} className="text-accent-ink hover:text-accent-ink">
              Добавить подстановку
            </Button>
            {!f.params.some((x) => /\{\s*имя\s*\}/i.test(x)) && (
              <Button variant="ghost" size="sm" onClick={() => set({ params: [...f.params, "{имя}"] })} className="text-accent-ink hover:text-accent-ink">
                + {"{имя}"}
              </Button>
            )}
          </div>
        )}
        <TextField
          label="Если имени нет, подставить"
          value={f.fallback}
          onChange={(e) => set({ fallback: e.target.value })}
          placeholder="уважаемый клиент"
          maxLength={30}
          error={errs.fallback}
        />
      </Group>
      {(errs.params || mismatch) && (
        <p data-error={errs.params ? "" : undefined} className={cn("-mt-3 mb-6 flex items-start gap-1.5 px-4 text-sm", errs.params ? "text-critical" : "text-fg-2")}>
          <TriangleAlert aria-hidden className="mt-px size-4 shrink-0" strokeWidth={2} />
          {errs.params ||
            (vars === 0
              ? `В тексте шаблона нет переменных, а ${n === 1 ? "подстановка есть" : `подстановок ${n}`}. Уберите ${n === 1 ? "строку «Вместо {{1}}»" : "строки подстановок"}, иначе Meta не примет шаблон.`
              : `В тексте шаблона ${vars} ${plural(vars, ["переменная", "переменные", "переменных"])}, а подстановок ${n}. Если число не совпадает, Meta не примет шаблон — проверьте пробной отправкой.`)}
        </p>
      )}
      <Group>
        <TextField
          label="Картинка — ссылка"
          optional
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={f.img}
          onChange={(e) => set({ img: e.target.value })}
          placeholder="https://…"
          error={errs.img}
          hint="Только если в шаблоне Meta есть картинка в шапке."
        />
      </Group>
    </>
  );
}

// ---------- 3. Часы и предел ----------
export function HoursSection({ f, set, errs, ov }: P & { ov: CampaignsOverview }) {
  const m = ov.main;
  const limit = m.limit === -1 ? "без ограничений" : m.limit > 0 ? `${nf.format(m.limit)} получателей за 24 часа` : "неизвестен";
  return (
    <>
      <Group title="Часы отправки по Астане" note="Шаблоны — с 11:00 до 20:00: так меньше жалоб. Вне этих часов рассылка ждёт и продолжает сама.">
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="С" value={String(f.from)} onChange={(e) => set({ from: Number(e.target.value) })} error={errs.hours}>
            {Array.from({ length: 14 }, (_, i) => i + 8).map((h) => (
              <option key={h} value={h}>
                {hh(h)}
              </option>
            ))}
          </SelectField>
          <SelectField label="До" value={String(f.to)} onChange={(e) => set({ to: Number(e.target.value) })}>
            {Array.from({ length: 14 }, (_, i) => i + 9).map((h) => (
              <option key={h} value={h}>
                {hh(h)}
              </option>
            ))}
          </SelectField>
        </div>
      </Group>
      <Group
        note={
          <>
            Предел Meta для номера: {limit}. Он общий для всех рассылок с этого номера; отправлено за последние сутки: {nf.format(m.used24h)}.
            {m.limit > 0 ? " По умолчанию — 95% предела, с запасом." : " По умолчанию — 240."}
          </>
        }
      >
        <TextField label="Не больше за 24 часа" inputMode="numeric" value={f.cap} onChange={(e) => set({ cap: e.target.value })} error={errs.cap} className="max-w-[16rem]" />
      </Group>
      <Group title="Когда">
        <dl>
          <Field label="Начало">сразу после запуска</Field>
        </dl>
      </Group>
      <Note>Отложенного запуска пока нет: рассылка начинается, как только вы её запустите, и идёт только в часы отправки.</Note>
    </>
  );
}

// ---------- 4. Проверка ----------
export function CheckSection({
  f,
  r,
  res,
  checking,
  error,
  stale,
  onCheck,
  draft,
  ws,
  desktop,
}: {
  f: Form;
  r: Resolved;
  res: CampaignCheck | null;
  checking: boolean;
  error: string;
  stale: boolean;
  onCheck: () => void;
  draft: CampaignDraft;
  ws: string;
  desktop: boolean;
}) {
  const errors = res ? checkErrors(res.errors) : [];
  return (
    <>
      {desktop && (
        <div className="mb-5 flex flex-wrap items-center gap-3 px-1">
          <Button variant={!res || stale ? "primary" : "outline"} icon={RefreshCw} busy={checking} onClick={onCheck}>
            {res ? "Проверить ещё раз" : "Проверить"}
          </Button>
          <span className="text-sm text-fg-3">
            {!res ? "Сервер посчитает получателей и покажет, как сообщение увидит клиент. Ничего не отправляется." : stale ? "Данные изменились — проверьте ещё раз." : ""}
          </span>
        </div>
      )}
      {!res && checking && (
        <div className="flex items-center gap-2.5 px-1 py-6 text-ui text-fg-2">
          <Spinner /> Проверяю рассылку…
        </div>
      )}
      {error && (
        <ErrorList title="Проверка не прошла" errors={[error]} />
      )}
      {res && (
        <div className={cn(stale && "opacity-55")} aria-busy={checking || undefined}>
          <ErrorList title="Нужно исправить" errors={errors} />
          <CheckSummary res={res} r={r} />
          {res.valid > 0 && (
            <>
              <Group title="Как увидит клиент">
                <div className="py-3">
                  <TemplatePreview
                    text={fillTemplate(f.text.trim(), res.preview, cleanParams(f.params), draft.fallback || "")}
                    image={!!f.img.trim()}
                    time={hh(f.from)}
                    extra={templateVars(f.text) === 0 && res.preview.length ? res.preview : undefined}
                  />
                </div>
              </Group>
              <Note>
                Значения — для первого клиента с именем. Если имени нет, будет «{draft.fallback}».
                {unfilled(f.text, res.preview) && (
                  <span className="mt-1 flex items-start gap-1.5 text-critical">
                    <TriangleAlert aria-hidden className="mt-px size-4 shrink-0" strokeWidth={2} />
                    {`${unfilled(f.text, res.preview)} нечем заменить — добавьте подстановку в разделе «Сообщение», иначе Meta не примет шаблон.`}
                  </span>
                )}
              </Note>
              <Cost n={res.valid} cap={draft.cap} />
            </>
          )}
        </div>
      )}
      {!desktop && (error || (res && !res.ok)) && (
        <div className="mb-6 px-1">
          <p className="mb-3 text-sm text-fg-2">Исправить можно на прошлых шагах — стрелка «назад» вверху.</p>
          <Button variant="outline" icon={RefreshCw} busy={checking} onClick={onCheck}>
            Проверить ещё раз
          </Button>
        </div>
      )}
      {res && res.ok && !stale && <TestSend ws={ws} draft={draft} />}
    </>
  );
}

/** Переменные {{n}} в тексте шаблона, для которых нет подстановки («{{2}}, {{3}}»), или "". */
function unfilled(text: string, values: string[]): string {
  const miss = Array.from(new Set(Array.from(text.matchAll(/\{\{\s*(\d{1,2})\s*\}\}/g), (m) => Number(m[1])))).filter((i) => !values[i - 1]);
  return miss.map((i) => `{{${i}}}`).join(", ");
}
/** Пример получателя: номер из вставленного списка — с пробелами для чтения; маску базы («+7 700 *** ** 44») не трогаем. */
const sampleLine = (s: string) => (s.includes("*") ? s : s.replace(/^\+?\d{10,15}/, (m) => formatPhone(m)));

function CheckSummary({ res, r }: { res: CampaignCheck; r: Resolved }) {
  const rows: [string, ReactNode][] = [];
  if (res.segment) rows.push(["Сегмент", res.segment.label], ["База от", shortDate(res.segment.at, Date.now())]);
  if (res.named) rows.push(["С именем", nf.format(res.named)]);
  if (res.dup) rows.push(["Повторов убрано", nf.format(res.dup)]);
  if (res.stopped) rows.push(["Просили не писать — им не уйдёт", nf.format(res.stopped)]);
  if (res.listFilter) rows.push([res.listFilter.label, `не подошли ${nf.format(res.listFilter.out)}${res.listFilter.noDate ? `, без даты ${nf.format(res.listFilter.noDate)}` : ""}`]);
  if (res.cut) rows.push(["Отброшено сверх 20 000", nf.format(res.cut)]);
  return (
    <>
      <Group title="Получатели">
        <div className="flex items-baseline justify-between gap-4 py-3">
          <span className="text-ui text-fg-2 pointer-coarse:text-base">{r.source === "segment" ? "Получат шаблон" : "Номеров в списке"}</span>
          <span className="tnum text-2xl font-semibold tracking-[-0.01em]">{nf.format(res.valid)}</span>
        </div>
        {rows.length > 0 && (
          <dl className="divide-y divide-line">
            {rows.map(([k, v]) => (
              <Field key={k} label={k}>
                <span className="tnum">{v}</span>
              </Field>
            ))}
          </dl>
        )}
        {res.badN > 0 && (
          <div className="py-3 text-ui pointer-coarse:text-base">
            <p className="text-fg">
              Не понял строк: <span className="tnum">{nf.format(res.badN)}</span> — им не уйдёт.
            </p>
            {res.bad.length > 0 && <p className="mt-1 break-words text-sm text-fg-3">Например: {res.bad.slice(0, 3).map((b) => `«${b}»`).join(", ")}</p>}
          </div>
        )}
        {res.sample.length > 0 && (
          <div className="py-3">
            <p className="mb-1 text-sm text-fg-3">Первые получатели</p>
            <ul className="space-y-0.5 text-ui text-fg-2 pointer-coarse:text-base">
              {res.sample.map((s, i) => (
                <li key={i} className="tnum truncate">
                  {sampleLine(s)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Group>
    </>
  );
}

function Cost({ n, cap }: { n: number; cap: number }) {
  const days = cap > 0 && n > cap ? Math.ceil(n / cap) : 0;
  return (
    <>
      <Group title="Стоимость">
        <div className="flex items-baseline justify-between gap-4 py-3">
          <span className="text-ui text-fg-2 pointer-coarse:text-base">Оценка</span>
          <span className="tnum text-xl font-semibold">{`≈\u00a0${money(costEstimate(n))}`}</span>
        </div>
      </Group>
      <Note>
        {nf.format(n)} × {String(MARKETING_PRICE_KZT).replace(".", ",")} ₸ за шаблон «Маркетинг». Это оценка: точная цена — в кабинете Meta.
        {days > 1 && ` В сутки уйдёт не больше ${nf.format(cap)} — на всех понадобится около ${days} ${plural(days, ["дня", "дней", "дней"])}.`}
      </Note>
    </>
  );
}

function TestSend({ ws, draft }: { ws: string; draft: CampaignDraft }) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async () => {
    const src = store.source;
    if (!to.trim()) return setOut({ ok: false, text: "Впишите свой номер WhatsApp." });
    if (!src) return;
    setBusy(true);
    setOut(null);
    try {
      setOut({ ok: true, text: await src.testSend(ws, draft, to.trim()) });
    } catch (e) {
      setOut({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Group title="Пробная отправка себе">
        <TextField
          label="Ваш номер WhatsApp"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void send()}
          placeholder="+7 7XX XXX XX XX"
          hint="Шаблон придёт с основного номера; вместо имени — «Айгерим». Так видно, принимает ли Meta шаблон."
        />
        <div className="py-3">
          <Button variant="outline" busy={busy} onClick={() => void send()}>
            Отправить пробное
          </Button>
          {out && (
            <p role={out.ok ? "status" : "alert"} className={cn("mt-2 flex items-start gap-1.5 text-ui pointer-coarse:text-base", out.ok ? "text-positive" : "text-critical")}>
              {out.ok ? <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} /> : <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />}
              <span>{out.text}</span>
            </p>
          )}
        </div>
      </Group>
    </>
  );
}

// ---------- 5. Запуск ----------
export function LaunchSection({ f, set, r, errs, ov, res, name, errors }: P & { ov: CampaignsOverview; res: CampaignCheck | null; name: string; errors: string[] }) {
  const m = ov.main;
  const n = res?.valid || 0;
  const q = m.quality === "yellow" || m.quality === "red" ? QUALITY[m.quality] : null;
  return (
    <>
      {m.hold.length > 0 && (
        <Banner tone="critical" icon={TriangleAlert} className="mb-4 rounded-[0.875rem] py-3">
          Сигнал от Meta: {m.hold.join("; ")}. Если он касается этого шаблона, перед запуском пульт спросит ещё раз.
        </Banner>
      )}
      {q && (
        <Banner icon={TriangleAlert} className="mb-4 rounded-[0.875rem] py-3">
          Качество номера: {q.label}. Начните с небольшого сегмента — жалобы снижают предел Meta.
        </Banner>
      )}
      <Group title="Итог">
        <dl className="divide-y divide-line">
          <Field label="Кому">{r.source === "segment" ? res?.segment?.label || segmentTitle(r.spec, r.segments) : "список номеров"}</Field>
          <Field label="Получат">
            <span className="tnum">{res ? people(n) : "—"}</span>
          </Field>
          <Field label="С номера">{m.phone ? formatPhone(m.phone) : "основного"}</Field>
          <Field label="Шаблон">
            <span className="break-all">
              {f.tpl.trim() || "—"} · {f.lang}
            </span>
          </Field>
          <Field label="Часы">
            <span className="tnum">
              {hh(f.from)}–{hh(f.to)}
            </span>
          </Field>
          <Field label="В сутки">
            <span className="tnum">не больше {nf.format(capNum(f.cap) || 0)}</span>
          </Field>
          <Field label="Стоимость">
            <span className="tnum">{`≈\u00a0${money(costEstimate(n))}`}</span>
          </Field>
        </dl>
      </Group>
      <Group>
        <TextField label="Название — для себя" value={name} onChange={(e) => set({ name: e.target.value, nameTouched: true })} maxLength={60} error={errs.name} />
      </Group>
      <Group>
        <Checkbox checked={f.consent} onChange={(v) => set({ consent: v })} error={errs.consent}>
          Это клиенты компании: они сами оставили номер и не просили им не писать.
        </Checkbox>
      </Group>
      <ErrorList errors={errors} />
    </>
  );
}
