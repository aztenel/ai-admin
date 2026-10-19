// Автосценарий «Пора на стрижку» (ТЗ §4.3, этап 3 Winchester): каждый день в 11:00 по Астане бот сам шлёт шаблон Meta с основного
// номера тем, у кого ровно N дней с последнего визита и кому можно писать, — не больше предела в день. Здесь: включён ли, кому написал бы
// сегодня, качество номера сегодня, свежесть базы, почему последний раз пропустил день; настройки.
// Менять может только владелец (сотруднику сервер ответит 403 — ему только смотреть). Переключатель применяется сразу, как в настройках
// iPhone; включение — с подтверждением «каждый день в 11:00 бот сам напишет до N клиентам», без шаблона — не включаем. Ошибки сервера — списком.
// Всё — из /api/bc/auto; чего сервер не знает, не показываем.
import { Repeat, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Confirm, toast } from "@/components/overlay";
import { Button, Skeleton } from "@/components/ui";
import { plural } from "@/lib/format";
import { cn, useNow } from "@/lib/utils";
import type { AutoInfo, AutoSettings } from "@/model/campaigns";
import { Group } from "@/screens/Page";
import { store } from "@/state/store";
import { CRM_REFRESHED, CRM_STALE, Notice, Switch, whenText } from "./base/shared";
import { costEstimate, errorList, LANGS, money, QUALITY } from "./common";
import { useLoad } from "./useLoad";
import { ErrorList, SelectField, TextArea, TextField } from "./wizard/fields";

const TITLE = "Автосценарий «Пора на стрижку»";
const NO_TPL = "Чтобы включить, укажите шаблон Meta категории Marketing, который одобрила Meta.";
const DAYS: [string, string, string] = ["день", "дня", "дней"];
const CLIENTS_DAT: [string, string, string] = ["клиенту", "клиентам", "клиентам"];
const CLIENTS: [string, string, string] = ["клиент", "клиента", "клиентов"];
const HOURS = Array.from({ length: 15 }, (_, i) => i + 8); // 8–22, как принимает сервер

/** Форма настроек: поля — строки, как их набирает человек; проверяет сервер (тексты его ошибок — списком). */
type Form = { days: string; tpl: string; lang: string; cap: string; from: string; to: string; text: string };
// сервер хранит переводы строк заметки как « ⏎ »
const textIn = (t: string) => (t || "").replace(/\s*⏎\s*/g, "\n");
const toForm = (s: AutoSettings): Form => ({
  days: String(s.days),
  tpl: s.tpl,
  lang: s.lang,
  cap: String(s.cap),
  from: String(s.from),
  to: String(s.to),
  text: textIn(s.text),
});
const num = (v: string) => (v.trim() === "" ? NaN : Number(v.trim().replace(",", ".")));
/** Только изменённые поля: сервер принимает и одно поле. */
function patchOf(f: Form, s: AutoSettings): Partial<AutoSettings> {
  const p: Partial<AutoSettings> = {};
  for (const k of ["days", "cap", "from", "to"] as const) if (num(f[k]) !== s[k]) p[k] = num(f[k]);
  if (f.tpl.trim() !== s.tpl) p.tpl = f.tpl.trim();
  if (f.lang !== s.lang) p.lang = f.lang;
  if (f.text.trim() !== textIn(s.text).trim()) p.text = f.text.trim();
  return p;
}
const langLabel = (id: string) => LANGS.find((l) => l.id === id)?.label || id;

export default function AutoScenario({ ws, owner: ownerProp }: { ws: string; owner: boolean }) {
  const now = useNow();
  const auto = useLoad((src) => src.autoGet(ws), [ws]);
  const d = auto.data;
  const owner = d ? d.owner : ownerProp;

  // базу обновили в блоке «База клиентов» или рассылка по базе ушла — перечитать свежесть и «кому сегодня»
  const reload = auto.reload;
  useEffect(() => {
    const f = (e: Event) => {
      if ((e as CustomEvent<string>).detail === ws) void reload();
    };
    window.addEventListener(CRM_REFRESHED, f);
    window.addEventListener(CRM_STALE, f);
    return () => {
      window.removeEventListener(CRM_REFRESHED, f);
      window.removeEventListener(CRM_STALE, f);
    };
  }, [ws, reload]);

  const [edit, setEdit] = useState<Form | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState<"" | "switch" | "form">("");
  const [ask, setAsk] = useState(false);
  const tplRef = useRef<HTMLInputElement>(null);
  const [focusTpl, setFocusTpl] = useState(0);
  const [tplErr, setTplErr] = useState("");
  useEffect(() => {
    if (focusTpl) tplRef.current?.focus();
  }, [focusTpl]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // в разработке React монтирует дважды: после первого «размонтирования» снова жив
    return () => {
      alive.current = false;
    };
  }, []);

  if (auto.loading) return <AutoSkeleton />;
  if (!d)
    return (
      <Group title={TITLE}>
        <div className="pb-3">
          <Notice tone="critical" role="alert">
            Не загрузилось: {auto.error}
          </Notice>
          <Button variant="outline" icon={RefreshCw} className="mb-1" onClick={() => void auto.reload()}>
            Повторить
          </Button>
        </div>
      </Group>
    );
  if (!d.available)
    return (
      <Group title={TITLE}>
        <p className="py-3 text-ui text-fg-2 pointer-coarse:text-base">{d.why || "У этой компании нет базы клиентов из Altegio — автосценарий недоступен."}</p>
      </Group>
    );

  const s = d.settings;
  // что включаем: открытая форма (может быть, с только что набранным шаблоном) или сохранённое
  const eff = edit ? { days: num(edit.days), cap: num(edit.cap), tpl: edit.tpl.trim(), from: num(edit.from), to: num(edit.to) } : s;

  const apply = async (patch: Partial<AutoSettings>, ok: string, mode: "switch" | "form") => {
    const src = store.source;
    if (!src) return;
    setSaving(mode);
    setErrors([]);
    setTplErr("");
    try {
      const settings = await src.autoSet(ws, patch);
      if (!alive.current) return;
      auto.set((prev) => ({ ...(prev as AutoInfo), settings }));
      if (mode === "form" || patch.on) setEdit(null);
      toast(ok);
      void auto.reload(); // «кому сегодня» и пояснение зависят от дней и предела
    } catch (e) {
      if (alive.current) setErrors(errorList(e));
    } finally {
      if (alive.current) setSaving("");
    }
  };

  const onSwitch = (on: boolean) => {
    setErrors([]);
    if (!on) {
      void apply({ on: false }, "Автосценарий выключен", "switch");
      return;
    }
    if (!eff.tpl) {
      setTplErr(NO_TPL);
      setEdit((e) => e ?? toForm(s));
      setFocusTpl((n) => n + 1);
      return;
    }
    setAsk(true);
  };
  const save = () => {
    if (!edit) return;
    const p = patchOf(edit, s);
    if (!Object.keys(p).length) {
      setEdit(null);
      setErrors([]);
      return;
    }
    void apply(p, "Настройки сохранены", "form");
  };

  const set = (p: Partial<Form>) => setEdit((e) => (e ? { ...e, ...p } : e));
  const langs = LANGS.some((l) => l.id === (edit?.lang ?? s.lang)) ? [...LANGS] : [...LANGS, { id: edit?.lang ?? s.lang, label: edit?.lang ?? s.lang }];
  const capN = Number.isFinite(eff.cap) ? eff.cap : s.cap;
  const daysN = Number.isFinite(eff.days) ? eff.days : s.days;

  return (
    <>
      <Group
        title={TITLE}
        note={`Бот пишет сам: каждый день в 11:00 по Астане берёт из базы тех, у кого ровно ${s.days} ${plural(s.days, DAYS)} с последнего визита, и шлёт им шаблон Meta с основного номера. День пропускается, если качество номера не высокое, Meta просила остановиться или база устарела, — причина придёт в Telegram.`}
      >
        <div className="flex min-h-14 items-center gap-3 py-2.5">
          <span
            className={cn("grid size-9 shrink-0 place-items-center rounded-[0.625rem]", s.on ? "bg-positive-soft text-positive" : "bg-surface-2 text-fg-2")}
          >
            <Repeat aria-hidden className="size-[1.125rem]" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.9375rem] font-semibold md:text-base">{s.on ? "Включён" : "Выключен"}</p>
            <p className="text-sm text-fg-3">
              {s.on ? `Каждый день в 11:00 · до ${s.cap} в день` : owner ? "Включите, когда шаблон одобрен Meta" : "Включает владелец"}
            </p>
          </div>
          {owner ? (
            <Switch checked={s.on} onChange={onSwitch} label={TITLE} busy={saving === "switch"} disabled={saving === "form"} />
          ) : (
            <span
              className={cn(
                "inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-sm font-medium",
                s.on ? "bg-positive-soft text-positive" : "bg-surface-2 text-fg-3",
              )}
            >
              {s.on ? "включён" : "выключен"}
            </span>
          )}
        </div>
        {errors.length > 0 && !edit && <ErrorList errors={errors} className="my-3" />}
        {d.why && (
          <Notice tone="critical">
            {s.on ? "Сейчас не сработает: " : ""}
            {d.why}
          </Notice>
        )}
        <dl className="divide-y divide-line">
          <Row label="Кому сегодня" value={d.today.total ? `${d.today.n} из ${d.today.total}` : "никому"}>
            {d.today.total
              ? `Ровно ${s.days} ${plural(s.days, DAYS)} с визита и можно писать — ${d.today.total} ${plural(d.today.total, CLIENTS)}${d.today.n < d.today.total ? `; предел — ${s.cap} в день` : ""}.${s.on ? "" : " Это если включить."}`
              : `Сейчас нет клиентов ровно с ${s.days} ${plural(s.days, DAYS)} после визита, которым можно писать.`}
          </Row>
          <QualityRow q={d.quality} now={now} />
          <Row
            label="База клиентов"
            value={d.crm.at ? `обновлена ${whenText(d.crm.at, now)}` : "ещё не собрана"}
            tone={d.crm.at && d.crm.fresh ? undefined : "critical"}
          >
            {!d.crm.at
              ? "Без базы автосценарию некому писать."
              : d.crm.fresh
                ? ""
                : "Старше 36 часов — автосценарий пропустит день: по старой базе можно написать тому, кто уже записался."}
          </Row>
        </dl>
        {d.skip && (
          <Notice>
            <span className="font-medium">Пропустил день · {whenText(d.skip.at, now)}.</span> {d.skip.why}
          </Notice>
        )}
        {d.note && <Notice>{d.note}</Notice>}
      </Group>

      <Group title="Настройки автосценария" note={owner ? undefined : "Меняет только владелец."}>
        {edit ? (
          <>
            <TextField
              label="Дней с последнего визита"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={3}
              autoComplete="off"
              value={edit.days}
              onChange={(e) => set({ days: e.target.value })}
              hint="Ровно столько — от 7 до 120. Обычно 28: месяц после стрижки."
            />
            <TextField
              ref={tplRef}
              label="Шаблон Meta (Marketing)"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              maxLength={512}
              placeholder="например, pora_na_strizhku"
              value={edit.tpl}
              onChange={(e) => {
                set({ tpl: e.target.value });
                setTplErr("");
              }}
              error={tplErr || undefined}
              hint="Название — как в кабинете Meta / Wazzapo: строчные латинские буквы, цифры и «_». Шаблон должен быть одобрен Meta. В шаблоне — одна переменная {{1}}: имя клиента."
            />
            <SelectField label="Язык шаблона" value={edit.lang} onChange={(e) => set({ lang: e.target.value })}>
              {langs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Сообщений в день, не больше"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={3}
              autoComplete="off"
              value={edit.cap}
              onChange={(e) => set({ cap: e.target.value })}
              hint="От 1 до 100. Постоянные клиенты — первыми."
            />
            <div>
              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Отправлять с" value={edit.from} onChange={(e) => set({ from: e.target.value })} className="pb-0">
                  {HOURS.map((h) => (
                    <option key={h} value={String(h)}>
                      {h}:00
                    </option>
                  ))}
                </SelectField>
                <SelectField label="до" value={edit.to} onChange={(e) => set({ to: e.target.value })} className="pb-0">
                  {HOURS.map((h) => (
                    <option key={h} value={String(h)}>
                      {h}:00
                    </option>
                  ))}
                </SelectField>
              </div>
              <p className="pb-3 pt-1.5 text-sm text-fg-3">По Астане. «До» — позже 11:00: список собирается в 11:00.</p>
            </div>
            <TextArea
              label="Текст шаблона — для администратора и бота"
              optional
              rows={3}
              maxLength={1000}
              value={edit.text}
              onChange={(e) => set({ text: e.target.value })}
              hint="Клиент может ответить на сообщение — так бот и администратор поймут, о чём оно было."
            />
            <div className="py-3">
              {/* ошибки сервера — рядом с «Сохранить», куда человек только что нажал */}
              {errors.length > 0 && <ErrorList errors={errors} className="mb-3" />}
              <div className="flex gap-2">
                <Button
                  className="flex-1 md:flex-none"
                  disabled={!!saving}
                  onClick={() => {
                    setEdit(null);
                    setErrors([]);
                    setTplErr("");
                  }}
                >
                  Отмена
                </Button>
                <Button variant="primary" className="flex-1 md:flex-none" busy={saving === "form"} disabled={saving === "switch"} onClick={save}>
                  Сохранить
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <dl className="divide-y divide-line">
              <Setting label="Дней с последнего визита">ровно {s.days}</Setting>
              <Setting label="Шаблон Meta">{s.tpl ? <span className="break-all">{s.tpl}</span> : <span className="text-fg-3">не указан</span>}</Setting>
              <Setting label="Язык шаблона">{langLabel(s.lang)}</Setting>
              <Setting label="Сообщений в день">до {s.cap}</Setting>
              <Setting label="Часы отправки">
                с {s.from}:00 до {s.to}:00
              </Setting>
              {s.text && (
                <div className="min-w-0 py-2.5">
                  <dt className="text-sm text-fg-3">Текст шаблона</dt>
                  <dd className="mt-0.5 whitespace-pre-line break-words text-ui text-fg pointer-coarse:text-base">{textIn(s.text)}</dd>
                </div>
              )}
            </dl>
            {owner && (
              <div className="py-3">
                <Button
                  variant="tinted"
                  className="max-md:w-full"
                  disabled={!!saving}
                  onClick={() => {
                    setErrors([]);
                    setTplErr("");
                    setEdit(toForm(s));
                  }}
                >
                  Изменить настройки
                </Button>
              </div>
            )}
          </>
        )}
      </Group>

      <Confirm
        open={ask}
        onOpenChange={setAsk}
        title="Включить автосценарий?"
        text={
          <>
            Каждый день в 11:00 бот сам напишет до {capN} {plural(capN, CLIENTS_DAT)} — тем, у кого ровно {daysN} {plural(daysN, DAYS)} с последнего визита.
            Шаблон «{eff.tpl}» с основного номера{Number.isFinite(eff.from) && Number.isFinite(eff.to) ? `, с ${eff.from}:00 до ${eff.to}:00` : ""}. Оценка — до{" "}
            {`≈\u00a0${money(costEstimate(capN))}`} в день, точная цена — в кабинете Meta.
          </>
        }
        yes="Включить"
        onYes={() => void apply({ ...(edit ? patchOf(edit, s) : {}), on: true }, "Автосценарий включён", "switch")}
      />
    </>
  );
}

/** Строка состояния: подпись, значение, пояснение. */
function Row({ label, value, tone, children }: { label: string; value: ReactNode; tone?: "critical" | "positive"; children?: ReactNode }) {
  return (
    <div className="min-w-0 py-2.5">
      <dt className="text-sm text-fg-3">{label}</dt>
      <dd className="mt-0.5 min-w-0">
        <span
          className={cn("tnum block text-base text-fg pointer-coarse:text-md", tone === "critical" && "text-critical", tone === "positive" && "text-positive")}
        >
          {value}
        </span>
        {children ? <span className="mt-0.5 block text-sm text-fg-2">{children}</span> : null}
      </dd>
    </div>
  );
}

/** Качество номера по последней проверке (каждый день в 10:00). Маркетинг автосценарий шлёт только при высоком.
 *  «Проверено ли сегодня» не решаем по часам браузера: в 11:00 сервер сам проверит номер ещё раз, если утром не вышло. */
function QualityRow({ q, now }: { q: AutoInfo["quality"]; now: number }) {
  if (!q)
    return (
      <Row label="Качество номера" value="ещё не проверяли">
        Проверка — каждый день в 10:00. Маркетинг автосценарий шлёт только при высоком качестве.
      </Row>
    );
  return (
    <Row label="Качество номера" value={QUALITY[q.level].label} tone={q.level === "green" ? "positive" : q.level === "unknown" ? undefined : "critical"}>
      Проверено {whenText(q.at, now)}.{q.level === "green" ? "" : " Маркетинг уходит только при высоком качестве — пока так, автосценарий пропускает день."}
    </Row>
  );
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 min-w-0 items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-ui text-fg-2 pointer-coarse:text-base">{label}</dt>
      <dd className="tnum min-w-0 text-right text-ui text-fg pointer-coarse:text-base">{children}</dd>
    </div>
  );
}

function AutoSkeleton() {
  return (
    <section className="mb-6" aria-hidden>
      <Skeleton className="mb-2 ml-4 h-3.5 w-52" />
      <div className="rounded-[0.875rem] bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-[0.625rem]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-[1.9375rem] w-[3.1875rem] rounded-full" />
        </div>
        <Skeleton className="mt-4 h-3 w-4/5" />
        <Skeleton className="mt-3 h-3 w-3/5" />
      </div>
    </section>
  );
}
