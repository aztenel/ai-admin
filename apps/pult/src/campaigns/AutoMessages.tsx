// «Автоматические сообщения» второго номера — вкладка «Автоматические · сообщения» раздела «Рассылки» (задание владельца 02.11.2026).
// Девять сценариев двумя группами: «Для записи (сервисные)» — о конкретной записи клиента, без рекламы, и «Реклама (только с согласием)»
// — отдельно, чтобы реклама не выглядела сервисным сообщением. У сценария: выключатель (только владелец; включить — с вопросом: сообщения
// уйдут настоящим клиентам), уходит ли на самом деле и почему нет, счётчики за сегодня и 7 дней, «Текст и время», «Проверить на мой
// номер», «Журнал». Сверху — уходит ли вообще (главный выключатель, второй номер, журнал Altegio, база отметок, пауза), часы отправки,
// предел за сутки и номер для проверки. Всё — с сервера (/api/msg/*, src/controllers/automsg.js); после каждого изменения перечитываем:
// настройки живут на сервере, не в браузере. Сотрудник видит то же, но ничего не меняет и не проверяет. Номера клиентов — маской.
// Ниже — ближайшие сообщения в очереди и «Проверка по журналу» (ServiceMessages.tsx). Компания без журнала Altegio (бот шлёт сам по своим
// записям) — прежний вид ServiceMessages.
import {
  Ban,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  ClipboardCheck,
  Clock,
  FlaskConical,
  Lock,
  Megaphone,
  PenLine,
  Pencil,
  Power,
  PowerOff,
  RefreshCw,
  ScrollText,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Confirm, Sheet, toast } from "@/components/overlay";
import { Button, Skeleton } from "@/components/ui";
import { ApiError } from "@/data/errors";
import { plural } from "@/lib/format";
import { cn, useNow } from "@/lib/utils";
import type { AutoMessages as AutoData, AutoMsgCounts, AutoMsgField, AutoMsgLogItem, AutoMsgScenario, AutoMsgTestResult, BotNumberState, ServiceOverview } from "@/model/campaigns";
import { Group } from "@/screens/Page";
import { store } from "@/state/store";
import { kkVars, mkDefaults, mkRender, newRid, sampleFrom, svDefaults, svLabel, svRender, SV_VARS } from "./autoText";
import { astanaDay, nf, Notice, Switch, when } from "./base/shared";
import { errText, EXCLUDED } from "./common";
import ServiceMessages, { dayWord, DryRunGroup, ServiceSkeleton, Upcoming, useServiceMessages } from "./ServiceMessages";
import { useLoad, type Loaded } from "./useLoad";
import { DEFAULT_VARS, toCanon, toHuman } from "./vars";
import { WaBubble } from "./WaBubble";
import { SelectField, TextField } from "./wizard/fields";

// счётчики и журнал меняет фоновая задача (раз в минуту) — перечитываем раз в 2 минуты, пока вкладка открыта
const POLL_MS = 120e3;
const MESSAGES: [string, string, string] = ["сообщение", "сообщения", "сообщений"];
const CLIENTS: [string, string, string] = ["клиент", "клиента", "клиентов"];
/** Почему реклама не уйдёт (коды сервера у реактивации). */
const WHY: Record<string, string> = { ...EXCLUDED, noconsent: "нет согласия на рекламу" };
// реклама со второго номера закрыта целиком — длинную причину пишем один раз над группой, у сценариев — коротко
const MK_SHORT = "Включить нельзя: реклама со второго номера выключена.";

type Item = { kind: "edit" | "test" | "log"; id: string } | { kind: "hours" };
/** Открытый лист. Номер для проверки открывают и из листа проверки — после сохранения возвращаемся в него (back). */
type Layer = Item | { kind: "phone"; back?: Item } | null;

/** Вкладка: компания с журналом Altegio — «Автоматические сообщения»; без него — что бот шлёт сам (прежний вид, над ним — обзор номера
 *  бота overview). bot — состояние второго номера из обзора раздела (на связи ли, сигнал Green-API). */
export default function AutoTab({ ws, owner, bot, overview, onMarketing }: { ws: string; owner: boolean; bot?: BotNumberState | null; overview: ReactNode; onMarketing: () => void }) {
  const svc = useServiceMessages(ws);
  if (svc.loading) return <ServiceSkeleton />;
  if (svc.data && !svc.data.journal)
    return (
      <>
        {overview}
        <ServiceMessages owner={owner} svc={svc} />
      </>
    );
  return <AutoMessages ws={ws} ownerHint={owner} svc={svc} bot={bot} onMarketing={onMarketing} />;
}

function AutoMessages({ ws, ownerHint, svc, bot, onMarketing }: { ws: string; ownerHint: boolean; svc: Loaded<ServiceOverview>; bot?: BotNumberState | null; onMarketing: () => void }) {
  const now = useNow();
  const am = useLoad((src) => src.autoMessages(ws), [ws], { pollMs: POLL_MS });
  const d = am.data;
  // роль — из ответа сервера (он же проверяет права), пока ответа нет — из хаба
  const owner = d ? d.owner : ownerHint;
  const [layer, setLayer] = useState<Layer>(null);
  const [ask, setAsk] = useState<AutoMsgScenario | null>(null);
  const [busy, setBusy] = useState("");
  const reloadAm = am.reload;
  const reloadSvc = svc.reload;
  // после изменения — заново с сервера: выключатели, текст и время, очередь ближайших (в ней только включённые сценарии)
  const reload = async () => {
    await Promise.all([reloadAm(), reloadSvc()]);
  };

  if (am.loading) return <AutoSkeleton />;
  if (!d)
    return (
      <Group title="Автоматические сообщения">
        <div className="pb-3">
          <Notice tone="critical" role="alert">
            Не загрузилось: {am.error}
          </Notice>
          <Button variant="outline" icon={RefreshCw} className="mb-1" onClick={() => void am.reload()}>
            Повторить
          </Button>
        </div>
      </Group>
    );

  const toggle = async (s: AutoMsgScenario, on: boolean) => {
    const src = store.source;
    if (!src) return;
    setBusy(s.id);
    try {
      await src.autoMessageSet(ws, { id: s.id, on });
      toast(on ? `«${s.title}» включено` : `«${s.title}» выключено`);
    } catch (e) {
      toast(errText(e), "critical");
    } finally {
      await reload();
      setBusy("");
    }
  };
  const service = d.scenarios.filter((s) => s.group === "service");
  const marketing = d.scenarios.filter((s) => s.group === "marketing");
  const cur = layer && "id" in layer ? d.scenarios.find((s) => s.id === layer.id) || null : null;

  return (
    <>
      <StatusCard d={d} bot={bot} owner={owner} onHours={() => setLayer({ kind: "hours" })} onPhone={() => setLayer({ kind: "phone" })} />
      {am.error && (
        <p role="alert" className="-mt-3 mb-4 px-4 text-sm text-critical">
          Не обновилось: {am.error}
        </p>
      )}

      <section aria-labelledby="am-service" className="mb-6">
        <h2 id="am-service" className="px-1 text-lg font-semibold">
          Для записи (сервисные)
        </h2>
        <p className="mb-3 mt-0.5 px-1 text-ui text-fg-2 pointer-coarse:text-base">
          О конкретной записи клиента, без рекламы: согласие на рекламу для них не нужно. Кто написал «стоп» или кому запрещено писать, не получит.
        </p>
        {service.map((s) => (
          <ScenarioCard key={s.id} s={s} d={d} owner={owner} busy={busy === s.id} now={now} onToggle={(on) => (on ? setAsk(s) : void toggle(s, false))} onOpen={(kind) => setLayer({ kind, id: s.id })} onMarketing={onMarketing} ws={ws} />
        ))}
      </section>

      <section aria-labelledby="am-marketing" className="mb-6">
        <h2 id="am-marketing" className="px-1 text-lg font-semibold">
          Реклама (только с согласием)
        </h2>
        <p className="mt-0.5 px-1 text-ui text-fg-2 pointer-coarse:text-base">
          Отдельно от сервисных. Уходит только тем, кто дал подтверждённое согласие на рекламу и не писал «стоп», одному клиенту не чаще раза в 30 дней. Без согласия реклама не уходит
          никому.
        </p>
        {!d.marketing.allowed && d.marketing.why && (
          <p className="mt-2 flex gap-2 px-1 text-ui text-fg pointer-coarse:text-base">
            <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-3" strokeWidth={2} />
            <span>{d.marketing.why}</span>
          </p>
        )}
        <div className="mt-3">
          {marketing.map((s) => (
            <ScenarioCard key={s.id} s={s} d={d} owner={owner} busy={busy === s.id} now={now} onToggle={(on) => (on ? setAsk(s) : void toggle(s, false))} onOpen={(kind) => setLayer({ kind, id: s.id })} onMarketing={onMarketing} ws={ws} />
          ))}
        </div>
      </section>

      {svc.data ? (
        <Upcoming d={svc.data} owner={owner} now={now} title="Ближайшие сообщения" empty="Ближайших сообщений нет. Они появятся, когда включённый сценарий найдёт подходящую запись в журнале Altegio." />
      ) : svc.error ? (
        <Group title="Ближайшие сообщения">
          <Notice tone="critical" role="alert">
            Не загрузилось: {svc.error}
          </Notice>
        </Group>
      ) : null}
      {owner && <DryRunGroup ws={ws} now={now} />}

      <Confirm
        open={!!ask}
        onOpenChange={(v) => !v && setAsk(null)}
        title={ask ? `Включить «${ask.title}»?` : ""}
        text={ask ? <ConfirmText s={ask} d={d} /> : ""}
        yes="Включить"
        onYes={() => ask && void toggle(ask, true)}
      />
      {cur && layer?.kind === "edit" && <EditSheet ws={ws} s={cur} d={d} owner={owner} onClose={() => setLayer(null)} onSaved={reload} />}
      {cur && layer?.kind === "test" && <TestSheet ws={ws} s={cur} d={d} onClose={() => setLayer(null)} onPhone={() => setLayer({ kind: "phone", back: layer })} onSent={reload} />}
      {cur && layer?.kind === "log" && <LogSheet s={cur} now={now} onClose={() => setLayer(null)} />}
      {layer?.kind === "hours" && <HoursSheet ws={ws} d={d} onClose={() => setLayer(null)} onSaved={reload} />}
      {layer?.kind === "phone" && <PhoneSheet ws={ws} d={d} onClose={() => setLayer(layer.back || null)} onSaved={reload} />}
    </>
  );
}

/** Номер телефона в предложении не разрывается на строки. */
const nb = (s: string) => s.replace(/ /g, " ");

/** Вопрос перед включением: кому и когда уйдёт, что включение одобряет текст, и что сейчас мешает отправке. */
function ConfirmText({ s, d }: { s: AutoMsgScenario; d: AutoData }) {
  const lines = [
    `Сообщения начнут уходить настоящим клиентам со второго номера${d.sender.phone ? ` ${nb(d.sender.phone)}` : ""}. ${s.who} ${s.timingText}`,
    s.group === "service" ? "Включая, вы одобряете текст сообщения. Посмотреть его и проверить на своём номере можно кнопками на карточке." : "Реклама уйдёт только тем, кто дал подтверждённое согласие и не писал «стоп».",
    d.stage === "preview" ? "Это тестовая версия: отсюда сообщения не уходят." : !d.master.on ? "Пока главный выключатель отправки выключен, клиентам ничего не уйдёт: сценарий начнёт работать, когда его включат." : "",
  ].filter(Boolean);
  return (
    <>
      {lines.map((l, i) => (
        <span key={i} className="mt-1 block first:mt-0">
          {l}
        </span>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
/** Сверху: уходят ли сообщения вообще и почему нет; второй номер, часы отправки, предел за сутки, номер для проверки.
 *  bot — второй номер в обзоре раздела: на связи ли он у Green-API (сервер «Автоматических» знает только, подключён ли). */
function StatusCard({ d, bot, owner, onHours, onPhone }: { d: AutoData; bot?: BotNumberState | null; owner: boolean; onHours: () => void; onPhone: () => void }) {
  const problems: { text: string; tone: "critical" | "warn" }[] = [];
  if (d.stage === "preview") problems.push({ text: "Это тестовая версия: отсюда сообщения клиентам не уходят.", tone: "warn" });
  // главный выключатель — переменная в Cloudflare: владельцу — как есть (её ставит он), сотруднику — простыми словами
  if (!d.master.on) problems.push({ text: owner ? d.master.why || "Главный выключатель отправки выключен." : "Отправка пока не включена: её включает владелец. Клиентам ничего не уходит.", tone: "critical" });
  if (!d.sender.ready) problems.push({ text: d.sender.why || "Второй номер не подключён.", tone: "critical" });
  else if (bot && !bot.ready) problems.push({ text: `Второй номер не на связи: ${bot.why || "Green-API не отвечает."}`, tone: "critical" });
  if (bot?.hold) problems.push({ text: `Сигнал от Green-API: ${bot.hold}`, tone: "critical" });
  if (!d.altegio.ready && d.altegio.why) problems.push({ text: d.altegio.why, tone: "warn" });
  if (d.db) problems.push({ text: d.db, tone: "critical" });
  if (d.hold) problems.push({ text: `Отправка на паузе: Green-API не принял сообщение (${d.hold.why}). Через 6 часов попробуем снова. Проверьте, не заблокирован ли номер.`, tone: "critical" });
  const stopped = problems.some((p) => p.tone === "critical") || d.stage === "preview";
  // считаем только то, что можно включить: рекламу при запрете и кампании (они в «Маркетинге») — нет
  const list = d.scenarios.filter((s) => s.id !== "campaigns" && (!s.locked || s.on));
  const live = list.filter((s) => s.live).length, on = list.filter((s) => s.on).length;
  const head = stopped ? "Сейчас клиентам ничего не уходит" : live ? `Уходят сами: ${live} из ${list.length}` : on ? "Включено, но пока не уходит" : "Все сценарии выключены";
  const sub = stopped ? "" : live ? "Остальные выключены или ждут — почему, видно на карточке." : on ? "Почему — видно на карточке сценария." : "Клиентам ничего не уходит, пока владелец не включит сценарий.";
  const tone = stopped ? "critical" : live ? "positive" : "muted";
  return (
    <section aria-label="Отправка клиентам" className="mb-6 overflow-hidden rounded-[0.875rem] bg-surface">
      <div role="status" className="flex gap-3 px-4 py-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-[0.625rem]", tone === "critical" ? "bg-critical-soft text-critical" : tone === "positive" ? "bg-positive-soft text-positive" : "bg-surface-2 text-fg-2")}>
          {tone === "critical" ? <PowerOff aria-hidden className="size-[1.125rem]" strokeWidth={2} /> : <Power aria-hidden className="size-[1.125rem]" strokeWidth={2} />}
        </span>
        <div className="min-w-0 flex-1 self-center">
          <p className="text-[0.9375rem] font-semibold md:text-base">{head}</p>
          {sub && <p className="mt-0.5 text-sm text-fg-2">{sub}</p>}
          {problems.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {problems.map((p, i) => (
                <li key={i} className={cn("flex gap-1.5 text-ui pointer-coarse:text-base", p.tone === "critical" ? "text-critical" : "text-fg")}>
                  {p.tone === "critical" ? <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} /> : <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />}
                  <span className="min-w-0">{p.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="px-4 [&>*]:border-t [&>*]:border-line">
        <SettingRow label="Второй номер" value={!d.sender.ready ? "не подключён" : [d.sender.phone || "подключён", bot ? (bot.ready ? "на связи" : "не на связи") : ""].filter(Boolean).join(" · ")} />
        <SettingRow label="Часы отправки" value={`с ${d.window.from}:00 до ${d.window.to}:00`} onClick={owner ? onHours : undefined} />
        <SettingRow label="Не больше в сутки" value={`${nf.format(d.cap)} ${plural(d.cap, MESSAGES)}`} onClick={owner ? onHours : undefined} />
        <SettingRow label="Номер для проверки" value={d.test ? d.test.phone : "не указан"} muted={!d.test} onClick={owner ? onPhone : undefined} />
      </div>
      <p className="border-t border-line px-4 py-2.5 text-sm text-fg-3">
        {owner
          ? "Время по Астане. Проверки «на мой номер» и пробные рассылки со второго номера приходят только на номер для проверки."
          : "Время по Астане. Менять настройки и проверять сообщения может только владелец."}
      </p>
    </section>
  );
}

/** Строка настройки: подпись и значение; у владельца — вся строка нажимается (как в настройках iPhone). Значение (номер телефона) не
 *  обрезается: на узком экране переносится подпись. */
function SettingRow({ label, value, muted, onClick }: { label: string; value: string; muted?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <span className="min-w-0 text-ui text-fg-2 pointer-coarse:text-base">{label}</span>
      <span className={cn("tnum ml-auto shrink-0 whitespace-nowrap text-right text-ui pointer-coarse:text-base", muted ? "text-fg-3" : "text-fg")}>{value}</span>
      {onClick && <ChevronRight aria-hidden className="-mr-1 size-4 shrink-0 text-fg-3" strokeWidth={2} />}
    </>
  );
  if (!onClick) return <div className="flex min-h-11 items-center gap-3 py-2.5">{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-label={`${label}: ${value}. Изменить`} className="flex min-h-11 w-full items-center gap-3 py-2.5 text-left active:opacity-70">
      {body}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
type CardProps = {
  ws: string;
  s: AutoMsgScenario;
  d: AutoData;
  owner: boolean;
  busy: boolean;
  now: number;
  onToggle: (on: boolean) => void;
  onOpen: (kind: "edit" | "test" | "log") => void;
  onMarketing: () => void;
};

/** Карточка сценария: что, кому и когда; выключатель; уходит ли; счётчики; действия. */
function ScenarioCard({ ws, s, d, owner, busy, now, onToggle, onOpen, onMarketing }: CardProps) {
  const camp = s.id === "campaigns";
  const lockText = s.locked && s.locked === d.marketing.why ? MK_SHORT : s.locked;
  const reason = `am-why-${s.id}`;
  return (
    <article aria-labelledby={`am-t-${s.id}`} className="mb-3 rounded-[0.875rem] bg-surface px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={`am-t-${s.id}`} className="text-[0.9375rem] font-semibold leading-snug md:text-base">
            {s.title}
          </h3>
          <p className="mt-0.5 text-sm text-fg-2">{s.who}</p>
        </div>
        {camp ? null : owner ? (
          <Switch checked={s.on} onChange={onToggle} label={s.title} disabled={!!s.locked && !s.on} busy={busy} describedBy={reason} />
        ) : (
          <span className={cn("mt-0.5 inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-sm font-medium", s.on ? "bg-positive-soft text-positive" : "bg-surface-2 text-fg-3")}>
            {s.on ? "включено" : "выключено"}
          </span>
        )}
      </div>
      <p className="mt-2 flex gap-1.5 text-sm text-fg-2">
        <Clock aria-hidden className="mt-px size-4 shrink-0 text-fg-3" strokeWidth={2} />
        <span className="min-w-0">{s.timingText}</span>
      </p>
      <p id={reason} className={cn("mt-1.5 flex gap-1.5 text-sm", s.locked && !s.on ? "text-fg-2" : !s.on ? "text-fg-3" : s.live ? "text-positive" : "text-critical")}>
        {s.locked && !s.on ? (
          <>
            <Lock aria-hidden className="mt-px size-4 shrink-0 text-fg-3" strokeWidth={2} />
            <span className="min-w-0">{lockText}</span>
          </>
        ) : !s.on ? (
          <>
            <PowerOff aria-hidden className="mt-px size-4 shrink-0" strokeWidth={2} />
            <span className="min-w-0">Выключено: клиентам не уходит.</span>
          </>
        ) : s.live ? (
          <>
            <CircleCheck aria-hidden className="mt-px size-4 shrink-0" strokeWidth={2.25} />
            <span className="min-w-0 font-medium">Включено и уходит.</span>
          </>
        ) : (
          <>
            <TriangleAlert aria-hidden className="mt-px size-4 shrink-0" strokeWidth={2} />
            <span className="min-w-0">Включено, но не уходит: {s.why || "причина неизвестна."}</span>
          </>
        )}
      </p>
      {s.on && s.by && s.at > 0 && <p className="mt-1 text-xs text-fg-3">Включил {s.by}, {whenWord(s.at, now)}.</p>}
      {s.audience !== undefined && <Audience a={s.audience} />}
      {s.id === "birthday" && owner && <BirthdayToday ws={ws} />}
      {!camp && <Counts c={s.counts} />}
      <div className="mt-3 flex flex-wrap gap-2">
        {camp ? (
          <Button size="sm" variant="tinted" icon={Megaphone} onClick={onMarketing}>
            Открыть «Маркетинг»
          </Button>
        ) : (
          <>
            <Button size="sm" variant="secondary" icon={PenLine} onClick={() => onOpen("edit")}>
              Текст и время
            </Button>
            <Button size="sm" variant="secondary" icon={ScrollText} onClick={() => onOpen("log")}>
              Журнал{s.log.length ? ` · ${s.log.length}` : ""}
            </Button>
            {owner && (
              <Button size="sm" variant="secondary" icon={FlaskConical} onClick={() => onOpen("test")}>
                Проверить на мой номер
              </Button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

/** «сегодня в 12:00», «вчера в 18:30», «28 октября в 11:00» — по Астане. */
function whenWord(t: number, now: number) {
  const w = when(t, now);
  return `${w.day} в ${w.time}`;
}

/** Счётчики: сегодня и за 7 дней — ушло, ошибки (с «неизвестно, ушло ли»), пропущено. Все нули — одной строкой (таблица нулей — шум). */
function Counts({ c }: { c: { today: AutoMsgCounts; week: AutoMsgCounts } }) {
  const w = c.week, t = c.today;
  if (!w.sent && !w.failed && !w.skipped && !t.sent && !t.failed && !t.skipped)
    return <p className="mt-2 rounded-[0.625rem] bg-surface-2 px-3 py-2 text-sm text-fg-2">За сегодня и за 7 дней: ушло 0, ошибок 0, пропущено 0.</p>;
  const row = (label: string, x: AutoMsgCounts) => (
    <tr>
      <th scope="row" className="py-0.5 pr-3 text-left font-normal text-fg-2">
        {label}
      </th>
      <td className={cn("tnum py-0.5 text-right", x.sent ? "font-semibold text-fg" : "text-fg-3")}>{nf.format(x.sent)}</td>
      <td className={cn("tnum py-0.5 text-right", x.failed ? "font-semibold text-critical" : "text-fg-3")}>{nf.format(x.failed)}</td>
      <td className={cn("tnum py-0.5 text-right", x.skipped ? "text-fg" : "text-fg-3")}>{nf.format(x.skipped)}</td>
    </tr>
  );
  return (
    <div className="mt-3 rounded-[0.625rem] bg-surface-2 px-2">
    <table className="w-full table-fixed text-sm [&_td]:px-1 [&_th]:px-1">
      <caption className="sr-only">Сколько сообщений</caption>
      <thead>
        <tr className="text-xs text-fg-3">
          <th scope="col" className="w-[28%] pt-1.5 text-left font-normal">
            <span className="sr-only">Когда</span>
          </th>
          <th scope="col" className="pt-1.5 text-right font-normal">
            ушло
          </th>
          <th scope="col" className="pt-1.5 text-right font-normal">
            ошибки
          </th>
          <th scope="col" className="pt-1.5 text-right font-normal">
            пропущено
          </th>
        </tr>
      </thead>
      <tbody className="[&>tr:last-child>*]:pb-1.5">
        {row("Сегодня", c.today)}
        {row("7 дней", c.week)}
      </tbody>
    </table>
    </div>
  );
}

/** Реактивация: сколько клиентов сегодня ровно N дней без визита и скольким из них можно рекламу (и почему остальным нельзя). */
function Audience({ a }: { a: AutoMsgScenario["audience"] }) {
  if (!a)
    return <p className="mt-1.5 text-sm text-fg-3">Сколько клиентов подходит сегодня, не узнать: база клиентов не ответила.</p>;
  if (!a.base) return <p className="mt-1.5 text-sm text-fg-3">Базы клиентов из Altegio ещё нет: подходящих клиентов не посчитать.</p>;
  const why = Object.entries(a.why).filter(([, n]) => n > 0);
  return (
    <div className="mt-1.5 flex gap-1.5 text-sm text-fg-2">
      <Users aria-hidden className="mt-px size-4 shrink-0 text-fg-3" strokeWidth={2} />
      <p className="min-w-0">
        Сегодня подходят: <b className="tnum font-semibold text-fg">{nf.format(a.total)}</b> {plural(a.total, CLIENTS)}, можно рекламу:{" "}
        <b className="tnum font-semibold text-fg">{nf.format(a.allowed)}</b>.
        {why.length > 0 && <span className="text-fg-3"> Нельзя: {why.map(([k, n]) => `${WHY[k] || k} — ${nf.format(n)}`).join(", ")}.</span>}
      </p>
    </div>
  );
}

/** День рождения: «Кто сегодня» — владелец спрашивает Altegio (только чтение), сколько именинников и скольким можно поздравить. */
function BirthdayToday({ ws }: { ws: string }) {
  const [st, setSt] = useState<{ busy?: boolean; text?: string; error?: string }>({});
  const run = async () => {
    const src = store.source;
    if (!src) return;
    setSt({ busy: true });
    try {
      const r = await src.autoMessageAudience(ws, "birthday");
      const total = r.total ?? 0;
      setSt({ text: `Сегодня день рождения: ${nf.format(total)} ${plural(total, CLIENTS)}. Поздравить можно (есть согласие на рекламу): ${nf.format(r.allowed)}.` });
    } catch (e) {
      setSt({ error: errText(e) });
    }
  };
  return (
    <div className="mt-2">
      <Button size="sm" variant="ghost" icon={Users} busy={st.busy} className="-ml-2" onClick={() => void run()}>
        Кто сегодня
      </Button>
      {st.text && (
        <p role="status" className="mt-1 text-sm text-fg">
          {st.text}
        </p>
      )}
      {st.error && (
        <p role="alert" className="mt-1 text-sm text-critical">
          {st.error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
/** Поле времени: строка, как её видит человек; проверка — как у сервера (fieldBad, время — в часы отправки). */
function fieldError(f: AutoMsgField, v: string, win: { from: number; to: number }): string {
  if (f.kind === "time") {
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(v)) return "Время вида 11:00.";
    const h = +v.slice(0, 2);
    return h < win.from || h >= win.to ? `Только в часы отправки: с ${win.from}:00 до ${win.to}:00.` : "";
  }
  if (f.kind === "choice") return (f.options || []).some((o) => o.v === v) ? "" : "Выберите из списка.";
  const n = Number(v);
  if (!Number.isInteger(n) || n < (f.min ?? 0) || n > (f.max ?? 1e6)) return `Целое число от ${f.min} до ${f.max}.`;
  if (f.step && n % f.step) return `Число, кратное ${f.step}.`;
  return "";
}
/** Время в выборе: каждые 30 минут в часы отправки (всегда «19:30», без «07:30 PM» у браузера на английском); сохранённое время вне
 *  сетки — тоже в списке. */
function timeOptions(win: { from: number; to: number }, cur: string): string[] {
  const out: string[] = [];
  for (let h = win.from; h < win.to; h++) out.push(`${String(h).padStart(2, "0")}:00`, `${String(h).padStart(2, "0")}:30`);
  if (/^\d\d:\d\d$/.test(cur) && !out.includes(cur)) out.push(cur), out.sort();
  return out;
}
/** Подпись числа в выборе: «5 мин», «3 ч», «45 дней», «20». */
function unit(f: AutoMsgField, n: number): string {
  if (f.kind === "minutes") return `${n} мин`;
  if (f.kind === "hours") return `${n} ч`;
  if (f.kind === "days") return `${n} ${plural(n, ["день", "дня", "дней"])}`;
  return String(n);
}

/** «Текст и время»: время из полей сервера, текст на русском и казахском со вставками кнопками, пример «Так увидит клиент». */
function EditSheet({ ws, s, d, owner, onClose, onSaved }: { ws: string; s: AutoMsgScenario; d: AutoData; owner: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const mk = s.group === "marketing";
  const vars = DEFAULT_VARS;
  // рекламный текст — словами ({Имя клиента}), на сервер — каноническими вставками; сервисный — как есть ({имя}, [[ … ]])
  const human = (t: string) => (mk ? toHuman(t, vars) : t);
  const canon = (t: string) => (mk ? toCanon(t, vars) : t);
  const initial = useMemo(() => ({ ru: human(s.text?.ru || ""), kk: human(s.text?.kk || "") }), [s.text?.ru, s.text?.kk]); // eslint-disable-line react-hooks/exhaustive-deps
  const [ru, setRu] = useState(initial.ru);
  const [kk, setKk] = useState(initial.kk);
  const [lang, setLang] = useState<"ru" | "kk">("ru");
  const [t, setT] = useState<Record<string, string>>(() => Object.fromEntries(s.fields.map((f) => [f.key, String(s.timing[f.key] ?? "")])));
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const refs = { ru: useRef<HTMLTextAreaElement>(null), kk: useRef<HTMLTextAreaElement>(null) };

  const visible = s.fields.filter((f) => !f.when || t[f.when.key] === f.when.is);
  const fieldErrs = Object.fromEntries(visible.map((f) => [f.key, fieldError(f, t[f.key] ?? "", d.window)]));
  const timingChanged = visible.filter((f) => String(s.timing[f.key] ?? "") !== (t[f.key] ?? ""));
  const textChanged = !!s.text && (ru !== initial.ru || kk !== initial.kk);
  const max = mk ? 1000 : 600;

  // значения вставок — из примера сервера для сохранённого текста; чего нет — вымышленная запись
  const sample = useMemo(() => {
    const base = mk ? mkDefaults(d.workspace.name) : svDefaults(d.workspace.name);
    const got = s.text ? sampleFrom(s.text.ru, s.preview, mk ? "marketing" : "service") : null;
    return { ...base, ...(got || {}) };
  }, [mk, d.workspace.name, s.text, s.preview]);
  const text = lang === "kk" && kk.trim() ? kk : ru;
  const preview = mk ? mkRender(canon(text), sample) : svRender(text, lang === "kk" && kk.trim() ? kkVars(sample) : sample);

  // вставки: у сервисного — вставки сценария и те, что уже есть в его тексте; у рекламного — подписи словами
  const chips = mk
    ? vars.filter((v) => !s.text?.vars.length || s.text.vars.includes(v.key)).map((v) => ({ label: v.label, token: `{${v.label}}` }))
    : [...new Set([...(s.text?.vars || []), ...[...(s.text?.ru || "").matchAll(/\{([^{}]+)\}/g)].map((m) => m[1])])].filter((v) => SV_VARS.includes(v)).map((v) => ({ label: svLabel(v), token: `{${v}}` }));
  const insert = (token: string) => {
    const el = refs[lang].current, cur = lang === "ru" ? ru : kk, set = lang === "ru" ? setRu : setKk;
    const a = el ? el.selectionStart : cur.length, b = el ? el.selectionEnd : cur.length;
    set(cur.slice(0, a) + token + cur.slice(b));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(a + token.length, a + token.length);
    });
  };

  const save = async () => {
    setShown(true);
    setErr("");
    if (Object.values(fieldErrs).some(Boolean)) return;
    if (s.text && !ru.trim()) return setErr("Нужен текст на русском.");
    if (!timingChanged.length && !textChanged) return onClose();
    const src = store.source;
    if (!src) return;
    const timing = Object.fromEntries(timingChanged.map((f) => [f.key, f.kind === "time" || f.kind === "choice" ? t[f.key] : Number(t[f.key])]));
    setBusy(true);
    try {
      await src.autoMessageSet(ws, { id: s.id, ...(timingChanged.length ? { timing } : {}), ...(textChanged ? { text: { ru: canon(ru.trim()), kk: canon(kk.trim()) } } : {}) });
      toast("Сохранено");
      await onSaved();
      onClose();
    } catch (e) {
      setErr(errText(e));
      void onSaved(); // часть могла сохраниться (время раньше текста) — показать, что на сервере
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(v) => !v && onClose()}
      title={s.title}
      description={owner ? "Текст и время отправки. Сохранённое сразу действует." : "Текст и время отправки. Менять их может только владелец."}
      footer={
        owner ? (
          <div className="flex gap-2 pb-1">
            <Button className="flex-1" disabled={busy} onClick={onClose}>
              Отмена
            </Button>
            <Button variant="primary" className="flex-1" busy={busy} onClick={() => void save()}>
              Сохранить
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-5 px-4 pb-4">
        <section aria-labelledby={`ed-when-${s.id}`}>
          <h3 id={`ed-when-${s.id}`} className="text-sm font-medium text-fg-3">
            Когда уходит
          </h3>
          <p className="mt-1 text-ui text-fg pointer-coarse:text-base">{s.timingText}</p>
          {owner &&
            visible.map((f) =>
              f.kind === "choice" ? (
                <fieldset key={f.key} className="mt-2">
                  <legend className="mb-1.5 text-sm font-medium text-fg-2">{f.label}</legend>
                  <div role="radiogroup" aria-label={f.label} className="space-y-1.5">
                    {(f.options || []).map((o) => (
                      <label key={o.v} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-[0.625rem] border px-3 py-2", t[f.key] === o.v ? "border-accent bg-accent-soft" : "border-line-strong")}>
                        <input type="radio" name={`${s.id}-${f.key}`} checked={t[f.key] === o.v} onChange={() => setT({ ...t, [f.key]: o.v })} className="size-[1.125rem] shrink-0 accent-[var(--accent)]" />
                        <span className="text-md md:text-base">{o.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : f.kind === "time" ? (
                <SelectField key={f.key} label={f.label} value={t[f.key] ?? ""} onChange={(e) => setT({ ...t, [f.key]: e.target.value })} error={shown ? fieldErrs[f.key] : undefined} hint={`По Астане, в часы отправки: с ${d.window.from}:00 до ${d.window.to}:00.`}>
                  {timeOptions(d.window, t[f.key] ?? "").map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </SelectField>
              ) : (
                <SelectField key={f.key} label={f.label} value={t[f.key] ?? ""} onChange={(e) => setT({ ...t, [f.key]: e.target.value })} error={shown ? fieldErrs[f.key] : undefined}>
                  {Array.from({ length: Math.floor(((f.max ?? 0) - (f.min ?? 0)) / (f.step || 1)) + 1 }, (_, i) => (f.min ?? 0) + i * (f.step || 1)).map((n) => (
                    <option key={n} value={String(n)}>
                      {unit(f, n)}
                    </option>
                  ))}
                </SelectField>
              ),
            )}
        </section>

        {s.text && owner && (
          <section aria-labelledby={`ed-text-${s.id}`}>
            <h3 id={`ed-text-${s.id}`} className="text-sm font-medium text-fg-3">
              Текст сообщения
            </h3>
            {owner ? (
              <>
                <div role="group" aria-label="Вставить данные клиента" className="mt-2 flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <button key={c.token} type="button" onClick={() => insert(c.token)} className="inline-flex h-8 items-center rounded-full bg-accent-soft px-3 text-sm font-medium text-accent-ink pointer-coarse:h-9">
                      {c.label}
                    </button>
                  ))}
                </div>
                <label className="mt-3 block text-sm font-medium text-fg-2" htmlFor={`ed-ru-${s.id}`}>
                  На русском
                </label>
                <textarea
                  id={`ed-ru-${s.id}`}
                  ref={refs.ru}
                  rows={5}
                  maxLength={max}
                  value={ru}
                  onFocus={() => setLang("ru")}
                  onChange={(e) => setRu(e.target.value)}
                  className="mt-1.5 block w-full resize-y rounded-[0.625rem] border border-line-strong bg-surface px-3 py-2.5 text-md leading-[1.375rem] outline-none focus:border-accent md:text-base pointer-coarse:text-md dark:bg-surface-2"
                />
                <label className="mt-3 block text-sm font-medium text-fg-2" htmlFor={`ed-kk-${s.id}`}>
                  На казахском <span className="font-normal text-fg-3">· необязательно</span>
                </label>
                <textarea
                  id={`ed-kk-${s.id}`}
                  ref={refs.kk}
                  rows={4}
                  maxLength={max}
                  value={kk}
                  onFocus={() => setLang("kk")}
                  onChange={(e) => setKk(e.target.value)}
                  className="mt-1.5 block w-full resize-y rounded-[0.625rem] border border-line-strong bg-surface px-3 py-2.5 text-md leading-[1.375rem] outline-none focus:border-accent md:text-base pointer-coarse:text-md dark:bg-surface-2"
                />
                <p className="mt-1.5 text-sm text-fg-3">
                  {mk
                    ? "Данные клиента подставит сервер. В конце обязательно: как отказаться («стоп»). Квадратные скобки нельзя: впишите настоящий текст."
                    : "Вставки — кнопками выше. Кусок в [[двойных скобках]] пропадает, если в нём нет данных (например, имени). Казахский уходит тем, кто пишет по-казахски; без него — русский."}
                </p>
              </>
            ) : null}
          </section>
        )}

        {s.text && (
          <section aria-labelledby={`ed-pv-${s.id}`}>
            <div className="flex items-center gap-2">
              <h3 id={`ed-pv-${s.id}`} className="flex-1 text-sm font-medium text-fg-3">
                Так увидит клиент
              </h3>
              {kk.trim() && (
                <div role="radiogroup" aria-label="Язык примера" className="inline-flex rounded-lg bg-surface-2 p-0.5 text-sm">
                  {(["ru", "kk"] as const).map((l) => (
                    <button key={l} type="button" role="radio" aria-checked={lang === l} onClick={() => setLang(l)} className={cn("rounded-md px-2.5 py-0.5 pointer-coarse:py-1.5", lang === l ? "bg-surface font-medium text-fg shadow-sm" : "text-fg-2")}>
                      {l === "ru" ? "Русский" : "Қазақша"}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <WaBubble className="mt-2" text={preview || "Текста нет."} />
            <p className="mt-1.5 text-xs text-fg-3">Пример на вымышленной записи. Настоящему клиенту подставятся его данные.</p>
          </section>
        )}
        {err && (
          <Notice tone="critical" role="alert">
            {err}
          </Notice>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
type TestState = { busy?: boolean; ok?: AutoMsgTestResult; error?: string; code?: string; preview?: string; retry?: boolean };

/** «Проверить на мой номер»: тот же текст, что клиенту, на вымышленной записи — со второго номера на номер для проверки. rid — номер
 *  нажатия: повтор после обрыва связи идёт с тем же rid (сервер второй раз не отправит), новое нажатие после ответа — новый rid. */
function TestSheet({ ws, s, d, onClose, onPhone, onSent }: { ws: string; s: AutoMsgScenario; d: AutoData; onClose: () => void; onPhone: () => void; onSent: () => Promise<void> }) {
  const [lang, setLang] = useState<"ru" | "kk">("ru");
  const [st, setSt] = useState<TestState>({});
  const rid = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);
  const send = async () => {
    const src = store.source;
    if (!src || st.busy) return;
    rid.current ??= newRid();
    setSt({ busy: true });
    try {
      const ok = await src.autoMessageTest(ws, s.id, lang, rid.current);
      rid.current = null;
      if (!alive.current) return;
      setSt({ ok });
      void onSent(); // проверка — в журнале сценария
    } catch (e) {
      const a = e instanceof ApiError ? e : null;
      // нет ответа или сбой сервера — исход неизвестен: «Повторить» с тем же rid; ответ сервера с отказом — следующее нажатие новое
      const unsure = !a || a.offline || a.status >= 500;
      if (!unsure) rid.current = null;
      if (alive.current) setSt({ error: errText(e), code: a?.code, preview: a?.preview, retry: unsure });
    }
  };
  const noPhone = !d.test || st.code === "notest";
  return (
    <Sheet
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Проверка: ${s.title}`}
      description="Тот же текст, что получит клиент, на вымышленной записи. Придёт со второго номера на ваш номер для проверки, клиентам ничего не уходит."
      footer={
        <div className="flex gap-2 pb-1">
          <Button className="flex-1" onClick={onClose}>
            Закрыть
          </Button>
          <Button variant="primary" className="flex-1" icon={FlaskConical} busy={st.busy} disabled={!d.test} onClick={() => void send()}>
            {st.retry ? "Повторить" : st.ok ? "Отправить ещё раз" : "Отправить проверку"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 px-4 pb-4">
        <dl className="rounded-[0.875rem] bg-surface-2 px-3">
          <div className="flex min-h-11 items-center justify-between gap-3 py-2">
            <dt className="text-ui text-fg-2 pointer-coarse:text-base">Куда</dt>
            <dd className={cn("tnum text-right text-ui pointer-coarse:text-base", d.test ? "text-fg" : "text-fg-3")}>{d.test ? d.test.phone : "номер для проверки не указан"}</dd>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3 border-t border-line py-2">
            <dt className="text-ui text-fg-2 pointer-coarse:text-base">С какого номера</dt>
            <dd className="tnum text-right text-ui text-fg pointer-coarse:text-base">{d.sender.phone ? `второй, ${d.sender.phone}` : "второй номер"}</dd>
          </div>
        </dl>
        {noPhone && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-ui text-fg pointer-coarse:text-base">Сначала укажите свой номер для проверки.</p>
            <Button size="sm" variant="tinted" onClick={onPhone}>
              Указать номер
            </Button>
          </div>
        )}
        {s.text?.kk && (
          <div role="radiogroup" aria-label="Язык проверки" className="inline-flex rounded-lg bg-surface-2 p-0.5 text-sm">
            {(["ru", "kk"] as const).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={lang === l} onClick={() => setLang(l)} className={cn("rounded-md px-3 py-1 pointer-coarse:py-1.5", lang === l ? "bg-surface font-medium text-fg shadow-sm" : "text-fg-2")}>
                {l === "ru" ? "Русский" : "Қазақша"}
              </button>
            ))}
          </div>
        )}
        {st.ok &&
          (() => {
            const unsure = !!st.ok.unknown;
            const Icon = unsure ? CircleHelp : CircleCheck;
            return (
              <>
                <p role="status" className={cn("flex gap-2 py-1 text-ui pointer-coarse:text-base", unsure ? "text-fg" : "text-positive")}>
                  <Icon aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
                  <span className="min-w-0">
                    {unsure
                      ? `Green-API не ответил: не знаем, ушло ли сообщение на ${nb(st.ok.to)}. Проверьте WhatsApp; это нажатие второй раз не отправится.`
                      : st.ok.dup
                        ? `Эта проверка уже отправлена на ${nb(st.ok.to)}. Проверьте WhatsApp.`
                        : `Отправлено на ${nb(st.ok.to)}. Проверьте WhatsApp.`}
                  </span>
                </p>
                {st.ok.text && <WaBubble text={st.ok.text} />}
              </>
            );
          })()}
        {st.error && (
          <>
            <Notice tone={st.code === "preview" ? "muted" : "critical"} role="alert">
              {st.error}
            </Notice>
            {st.preview && (
              <div>
                <p className="mb-1 text-xs text-fg-3">Так выглядело бы сообщение:</p>
                <WaBubble text={st.preview} />
              </div>
            )}
          </>
        )}
        {!st.ok && !st.error && s.preview && (
          <div>
            <p className="mb-1 text-xs text-fg-3">Пример текста:</p>
            <WaBubble text={s.preview} />
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
const LOG: Record<string, { word: string; icon: LucideIcon; tone: string }> = {
  sent: { word: "ушло", icon: CircleCheck, tone: "text-positive" },
  unknown: { word: "неизвестно, ушло ли", icon: CircleHelp, tone: "text-fg-2" },
  failed: { word: "не ушло, ошибка", icon: CircleAlert, tone: "text-critical" },
  task: { word: "задача администратору", icon: ClipboardCheck, tone: "text-critical" },
  skipped: { word: "пропущено", icon: Ban, tone: "text-fg-3" },
  cancelled: { word: "отменено", icon: Ban, tone: "text-fg-3" },
  test: { word: "проверка", icon: FlaskConical, tone: "text-accent-ink" },
  on: { word: "включено", icon: Power, tone: "text-positive" },
  off: { word: "выключено", icon: PowerOff, tone: "text-fg-3" },
  edit: { word: "изменено", icon: Pencil, tone: "text-fg-2" },
  planned: { word: "запланировано", icon: CalendarClock, tone: "text-fg-2" },
};

/** Журнал сценария: последние события, новые сверху — что ушло, что нет и почему, кто включал и менял. */
function LogSheet({ s, now, onClose }: { s: AutoMsgScenario; now: number; onClose: () => void }) {
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={`Журнал: ${s.title}`} description="Последние события: что ушло, что нет и почему, кто включал и менял. Время по Астане, номера видны частично.">
      <div className="px-4 pb-4">
        {s.log.length ? (
          <ul aria-label="Журнал сценария" className="divide-y divide-line rounded-[0.875rem] bg-surface-2 px-3">
            {s.log.map((x, i) => (
              <LogRow key={`${x.at}|${i}`} x={x} now={now} />
            ))}
          </ul>
        ) : (
          <p className="py-3 text-ui text-fg-2 pointer-coarse:text-base">Событий пока нет. Здесь появится, что ушло и почему, кто включал и менял сценарий.</p>
        )}
      </div>
    </Sheet>
  );
}

function LogRow({ x, now }: { x: AutoMsgLogItem; now: number }) {
  const st = LOG[x.state] || { word: x.state || "событие", icon: CircleHelp, tone: "text-fg-2" };
  const Icon = st.icon;
  // «включил владелец» — имя уже в причине, второй раз не пишем
  const who = [x.name && !x.why.includes(x.name) ? x.name : "", x.phone].filter(Boolean).join(" · ");
  const booking = x.date ? `запись на ${dayWord(x.date, now)}${x.time ? `, ${x.time}` : ""}` : x.time ? `запись на ${x.time}` : "";
  const w = when(x.at, now);
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icon aria-hidden className={cn("mt-0.5 size-[1.125rem] shrink-0", st.tone)} strokeWidth={1.9} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className={cn("min-w-0 flex-1 text-ui font-semibold pointer-coarse:text-base", st.tone === "text-critical" && "text-critical")}>{st.word}</p>
          <time dateTime={new Date(x.at).toISOString()} className="tnum shrink-0 text-sm text-fg-2">
            {`${astanaDay(x.at) === astanaDay(now) ? "сегодня" : w.day}, ${w.time}`}
          </time>
        </div>
        {x.why && <p className="mt-0.5 text-sm text-fg-2">{x.why}</p>}
        {(who || booking) && <p className="tnum mt-0.5 text-sm text-fg-3">{[who, booking].filter(Boolean).join(" · ")}</p>}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
/** Часы отправки (начало 8–12, конец 17–22, как принимает сервер) и предел сообщений за сутки (10–300). */
function HoursSheet({ ws, d, onClose, onSaved }: { ws: string; d: AutoData; onClose: () => void; onSaved: () => Promise<void> }) {
  const [from, setFrom] = useState(String(d.window.from));
  const [to, setTo] = useState(String(d.window.to));
  const [cap, setCap] = useState(String(d.cap));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const capN = Number(cap.replace(/\s/g, ""));
  const capBad = !Number.isInteger(capN) || capN < 10 || capN > 300 ? "Целое число от 10 до 300." : "";
  const save = async () => {
    const src = store.source;
    if (!src || capBad) return;
    setBusy(true);
    setErr("");
    try {
      await src.autoMessageSet(ws, { window: { from: +from, to: +to }, cap: capN });
      toast("Сохранено");
      await onSaved();
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(v) => !v && onClose()}
      title="Часы отправки и предел"
      description="Клиентам сообщения уходят только в эти часы по Астане. Предел — на все автоматические сообщения со второго номера за сутки."
      footer={
        <div className="flex gap-2 pb-1">
          <Button className="flex-1" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" className="flex-1" busy={busy} disabled={!!capBad} onClick={() => void save()}>
            Сохранить
          </Button>
        </div>
      }
    >
      <div className="px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="С" value={from} onChange={(e) => setFrom(e.target.value)}>
            {[8, 9, 10, 11, 12].map((h) => (
              <option key={h} value={String(h)}>{`${h}:00`}</option>
            ))}
          </SelectField>
          <SelectField label="До" value={to} onChange={(e) => setTo(e.target.value)}>
            {[17, 18, 19, 20, 21, 22].map((h) => (
              <option key={h} value={String(h)}>{`${h}:00`}</option>
            ))}
          </SelectField>
        </div>
        <TextField label="Не больше сообщений в сутки" inputMode="numeric" pattern="[0-9]*" value={cap} onChange={(e) => setCap(e.target.value)} error={capBad || undefined} hint="От 10 до 300. Частые сообщения с обычного WhatsApp — повод для блокировки номера." />
        {err && (
          <Notice tone="critical" role="alert">
            {err}
          </Notice>
        )}
      </div>
    </Sheet>
  );
}

/** Номер для проверки — номер владельца: туда приходят «Проверить на мой номер» и пробы рассылок со второго номера. */
function PhoneSheet({ ws, d, onClose, onSaved }: { ws: string; d: AutoData; onClose: () => void; onSaved: () => Promise<void> }) {
  const [v, setV] = useState(d.test?.phone || "");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const digits = v.replace(/\D/g, "");
  const bad = v.trim() && digits.length < 10 ? "Номер полностью, например +7 701 123 45 67." : "";
  const save = async (phone: string) => {
    const src = store.source;
    if (!src) return;
    setBusy(phone ? "save" : "clear");
    setErr("");
    try {
      await src.autoMessageSet(ws, { testPhone: phone });
      toast(phone ? "Номер для проверки сохранён" : "Номер для проверки убран");
      await onSaved();
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy("");
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(x) => !x && onClose()}
      title="Номер для проверки"
      description="Ваш номер WhatsApp. Сюда приходят проверки автоматических сообщений и пробные рассылки со второго номера, на другие номера проверки не уходят."
      footer={
        <div className="flex gap-2 pb-1">
          {d.test ? (
            <Button className="flex-1" busy={busy === "clear"} disabled={!!busy} onClick={() => void save("")}>
              Убрать номер
            </Button>
          ) : (
            <Button className="flex-1" disabled={!!busy} onClick={onClose}>
              Отмена
            </Button>
          )}
          <Button variant="primary" className="flex-1" busy={busy === "save"} disabled={!!busy || !v.trim() || !!bad} onClick={() => void save(v.trim())}>
            Сохранить
          </Button>
        </div>
      }
    >
      <div className="px-4 pb-4">
        <TextField label="Ваш номер WhatsApp" type="tel" inputMode="tel" autoComplete="tel" placeholder="+7 701 123 45 67" value={v} onChange={(e) => setV(e.target.value)} error={bad || undefined} />
        {err && (
          <Notice tone="critical" role="alert">
            {err}
          </Notice>
        )}
      </div>
    </Sheet>
  );
}

function AutoSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="mb-6 h-48 w-full rounded-[0.875rem]" />
      <Skeleton className="mb-2 ml-1 h-4 w-48" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="mb-3 h-44 w-full rounded-[0.875rem]" />
      ))}
    </div>
  );
}
