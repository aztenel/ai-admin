// Обзор номеров компании для раздела «Рассылки» (решение владельца 19.10.2026: два вида рассылок — два номера).
// Основной номер (Meta / Wazzapo) — вкладка «Маркетинг»: качество по оценке Meta, предел за 24 часа, сколько ушло, сигнал Meta
// «остановиться» (снять его может только владелец — сотруднику кнопку не показываем, сервер ответит 403).
// Номер бота (Green-API) — вкладка «Сервисные»: на связи ли, ведёт ли вебхук в бота, сколько ушло рассылками за 24 часа.
// Всё — из /api/bc/list (CampaignsOverview); чего сервер не знает, не показываем.
import { Bot, CircleAlert, CircleCheck, OctagonAlert, Smartphone, TriangleAlert, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Confirm, toast } from "@/components/overlay";
import { Button, Field, Skeleton } from "@/components/ui";
import { formatPhone, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CampaignsOverview, NumberQuality } from "@/model/campaigns";
import { Group } from "@/screens/Page";
import { store } from "@/state/store";
import { errText, QUALITY } from "./common";

const nf = new Intl.NumberFormat("ru-RU");

/** Плитка со значком в начале строки — как в настройках. */
function Tile({ icon: Icon, tone = "muted" }: { icon: LucideIcon; tone?: "muted" | "critical" }) {
  return (
    <span className={cn("grid size-9 shrink-0 place-items-center rounded-[0.625rem]", tone === "critical" ? "bg-critical-soft text-critical" : "bg-surface-2 text-fg-2")}>
      <Icon aria-hidden className="size-[1.125rem]" strokeWidth={1.9} />
    </span>
  );
}

/** Шапка группы номера: значок, телефон, как подключён и короткий итог справа. */
function NumberHead({ icon, phone, sub, badge, tone }: { icon: LucideIcon; phone: string; sub: string; badge?: ReactNode; tone?: "muted" | "critical" }) {
  return (
    <div className="flex min-h-14 items-center gap-3 py-2.5">
      <Tile icon={icon} tone={tone} />
      <div className="min-w-0 flex-1">
        <p className="tnum truncate text-[0.9375rem] font-semibold md:text-base">{phone}</p>
        <p className="line-clamp-2 text-sm text-fg-3">{sub}</p>
      </div>
      {badge}
    </div>
  );
}

/** Качество номера: зелёное — точка и «высокое»; жёлтое — треугольник (жёлтого цвета в палитре нет: смысл — словами); красное — красным.
 *  Над плашкой — подпись «Качество», как у чисел ниже: одно «высокое» непонятно о чём (находка проверки 19.10.2026). Подпись — над
 *  плашкой, а не в ней: иначе на телефоне не помещался номер. */
function QualityBadge({ q }: { q: NumberQuality }) {
  const label = QUALITY[q].label.split(" — ")[0];
  return (
    <span className="flex shrink-0 flex-col items-end gap-0.5">
      <span className="text-xs text-fg-3">Качество</span>
      <QualityPill q={q} label={label} />
    </span>
  );
}
function QualityPill({ q, label }: { q: NumberQuality; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium",
        q === "green" && "bg-positive-soft text-positive",
        q === "yellow" && "bg-surface-2 text-fg",
        q === "red" && "bg-critical-soft text-critical",
        q === "unknown" && "bg-surface-2 text-fg-3",
      )}
    >
      {q === "yellow" ? <TriangleAlert aria-hidden className="size-3.5" strokeWidth={2.25} /> : <span aria-hidden className={cn("size-2 rounded-full", q === "green" ? "bg-positive" : q === "red" ? "bg-critical" : "bg-fg-3")} />}
      <span>{label}</span>
    </span>
  );
}

/** Три числа в ряд: качество, предел, отправлено. */
function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="min-w-0 px-3 py-3 first:pl-0 last:pr-0">
      <dt className="truncate text-xs text-fg-3">{label}</dt>
      <dd className="mt-0.5 min-w-0">
        <span className="tnum block truncate text-lg font-semibold leading-6">{value}</span>
        {sub && <span className="block truncate text-xs text-fg-3">{sub}</span>}
      </dd>
    </div>
  );
}

/** Красная плашка «остановиться» над группой номера. */
function HoldBox({ title, lines, foot, action }: { title: string; lines: string[]; foot: string; action?: ReactNode }) {
  return (
    <section role="alert" className="mb-4 rounded-[0.875rem] bg-critical-soft px-4 py-3 text-critical">
      <p className="flex items-center gap-2 text-[0.9375rem] font-semibold md:text-base">
        <OctagonAlert aria-hidden className="size-[1.125rem] shrink-0" strokeWidth={2} />
        {title}
      </p>
      <ul className="mt-1 space-y-0.5 text-ui text-fg pointer-coarse:text-base">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      <p className="mt-1 text-sm text-fg-2">{foot}</p>
      {action && <div className="mt-3">{action}</div>}
    </section>
  );
}

/** Основной номер (Meta / Wazzapo): качество, предел, отправлено за сутки, сигнал Meta, недоставленные сегодня. */
export function MainNumber({ ws, ov, owner, onChanged }: { ws: string; ov: CampaignsOverview; owner: boolean; onChanged: () => void }) {
  const m = ov.main;
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);

  const clear = async () => {
    const src = store.source;
    if (!src) return;
    setBusy(true);
    try {
      await src.clearMetaHold(ws);
      toast("Сигнал Meta снят");
      onChanged();
    } catch (e) {
      toast(errText(e), "critical");
    } finally {
      setBusy(false);
    }
  };

  const limit = m.limit > 0 ? nf.format(m.limit) : m.limit < 0 ? "без предела" : "—";

  return (
    <>
      {m.hold.length > 0 && (
        <HoldBox
          title="Сигнал от Meta: остановиться"
          lines={m.hold}
          foot={owner ? "Рассылки с основного номера остановлены. Снимайте сигнал, только если причина устранена." : "Рассылки с основного номера остановлены. Снять сигнал может владелец."}
          action={
            owner ? (
              <Button variant="secondary" className="bg-surface text-critical hover:bg-surface hover:brightness-[0.97] dark:bg-surface-2" busy={busy} onClick={() => setAsk(true)}>
                Снять сигнал Meta
              </Button>
            ) : undefined
          }
        />
      )}
      <Group
        title="Основной номер"
        note={m.ready ? "Отсюда уходят рассылки шаблонами Meta. Тем, кто ответил «стоп», рассылки не уходят." : undefined}
      >
        <NumberHead
          icon={Smartphone}
          tone={m.ready ? "muted" : "critical"}
          phone={m.phone ? formatPhone(m.phone) : m.ready ? "Номер подключён" : "Не подключён"}
          sub={[m.name ? `«${m.name}»` : "WhatsApp Business", "шаблоны Meta"].join(" · ")}
          badge={m.ready ? <QualityBadge q={m.quality} /> : undefined}
        />
        {!m.ready ? (
          <p className="flex gap-2 py-3 text-ui text-critical pointer-coarse:text-base">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
            <span>{m.why || "Основной номер не подключён к рассылкам."}</span>
          </p>
        ) : (
          <dl className="grid grid-cols-3 divide-x divide-line">
            <Stat label="Предел Meta" value={limit} sub={m.limit ? "за 24 часа" : "неизвестен"} />
            <Stat label="Отправлено" value={nf.format(m.used24h)} sub="за 24 часа" />
            <Stat label="Отказались" value={nf.format(ov.optouts)} sub="от рассылок" />
          </dl>
        )}
        {m.ready && (m.quality === "yellow" || m.quality === "red") && (
          <p className={cn("flex gap-2 py-3 text-ui pointer-coarse:text-base", m.quality === "red" ? "text-critical" : "text-fg")}>
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
            <span>
              Качество {QUALITY[m.quality].label}. Пишите реже и только тем, кто ждёт ваших сообщений, иначе Meta может ограничить номер.
            </span>
          </p>
        )}
        {m.ready && m.quality === "unknown" && !m.infoError && <p className="py-3 text-sm text-fg-3">Качество номера Meta не сообщила.</p>}
        {m.infoError && (
          <p className="flex gap-2 py-3 text-sm text-fg-2">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-fg-3" strokeWidth={2} />
            <span>Сведения о номере не получены: {m.infoError} Номер при этом может работать.</span>
          </p>
        )}
        {m.failedToday && m.failedToday.n > 0 && (
          <div className="py-3">
            <p className="text-ui pointer-coarse:text-base">
              Не доставлено сегодня: <span className="tnum font-semibold">{nf.format(m.failedToday.n)}</span>
            </p>
            {m.failedToday.codes.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-sm text-fg-2">
                {m.failedToday.codes.map((c) => (
                  <li key={String(c.code)}>
                    <span className="tnum">{c.n}</span>: {c.hint || `код ${c.code}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Group>
      <Confirm
        open={ask}
        onOpenChange={setAsk}
        title="Снять сигнал Meta?"
        text="Делайте это, только если причина устранена (например, шаблон снова одобрен). Остановленные рассылки останутся на паузе — их продолжают кнопкой «Продолжить»."
        yes="Снять сигнал"
        onYes={() => void clear()}
      />
    </>
  );
}

/** Номер бота (Green-API): на связи ли, вебхук, отправлено рассылками за сутки, сигнал Green-API. Рассылок с него в пульте нет. */
export function BotNumber({ ov }: { ov: CampaignsOverview }) {
  const b = ov.bot;
  if (!b)
    return (
      <Group title="Второй WhatsApp">
        <NumberHead icon={Bot} phone="Не подключён" sub="Green-API · обычный WhatsApp" />
        <p className="py-3 text-ui text-fg-2 pointer-coarse:text-base">Номера бота (Green-API) у компании нет. Напоминания и просьбу об отзыве бот шлёт с того номера, куда писал клиент.</p>
      </Group>
    );
  return (
    <>
      {b.hold && <HoldBox title="Сигнал от Green-API" lines={[b.hold]} foot="WhatsApp ограничил номер. Сигнал снимется сам через 14 дней." />}
      <Group title="Второй WhatsApp" note="Отсюда уходят напоминания и ответы клиентам.">
        <NumberHead
          icon={Bot}
          tone={b.ready ? "muted" : "critical"}
          phone={b.phone ? formatPhone(b.phone) : "Номер бота"}
          sub="Green-API · обычный WhatsApp"
          badge={
            <span className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium", b.ready ? "bg-positive-soft text-positive" : "bg-critical-soft text-critical")}>
              {b.ready ? <CircleCheck aria-hidden className="size-3.5" strokeWidth={2.25} /> : <CircleAlert aria-hidden className="size-3.5" strokeWidth={2.25} />}
              {b.ready ? "на связи" : "не на связи"}
            </span>
          }
        />
        <dl className="divide-y divide-line">
          {!b.ready && (
            <Field label="Связь" stacked>
              <span className="text-critical">{b.why || "Номер не на связи."}</span>
            </Field>
          )}
          <Field label="Входящие">
            {b.hook ? <span className="text-positive">приходят в пульт</span> : <span className="text-critical">не приходят</span>}
          </Field>
          {!b.hook && b.warn && <p className="py-2.5 text-sm text-fg-2">{b.warn}</p>}
          <Field label="Рассылками за 24 часа">
            <span className="tnum">
              {nf.format(b.used24h)} {plural(b.used24h, ["сообщение", "сообщения", "сообщений"])}
            </span>
          </Field>
        </dl>
      </Group>
    </>
  );
}

/** Пока обзор грузится — серые полосы на месте группы номера. */
export function NumberSkeleton() {
  return (
    <section className="mb-6" aria-hidden>
      <Skeleton className="mb-2 ml-4 h-3.5 w-28" />
      <div className="rounded-[0.875rem] bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-[0.625rem]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Карточка канала маркетинга (ТЗ v3.0 §2.2, §5.1): «Второй WhatsApp», на связи ли, можно ли запускать рассылки, главное действие.
 *  Запуск со второго номера — отдельное решение владельца: пока он выключен на сервере, здесь так и написано. */
export function ChannelCard({ ov, onCreate }: { ov: CampaignsOverview; onCreate: () => void }) {
  const b = ov.bot;
  const off = !!b?.noBroadcast;
  return (
    <section aria-label="Канал рассылок" className="mb-4 rounded-2xl bg-surface p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink">
          <Smartphone aria-hidden className="size-5" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[1.0625rem] font-semibold">Второй WhatsApp</p>
          <p className="text-sm text-fg-2">{b?.phone ? formatPhone(b.phone) : "номер не подключён"}</p>
        </div>
        {b && (
          <span className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium", b.ready ? "bg-positive-soft text-positive" : "bg-critical-soft text-critical")}>
            {b.ready ? <CircleCheck aria-hidden className="size-3.5" strokeWidth={2.25} /> : <CircleAlert aria-hidden className="size-3.5" strokeWidth={2.25} />}
            {b.ready ? "На связи" : "Нет соединения"}
          </span>
        )}
      </div>
      {b && (
        <p className={cn("mt-3 text-sm", off ? "text-fg-2" : "text-positive")}>
          {off ? "Запуск рассылок выключен. Черновики, проверка и одобрение работают." : "Рассылки с этого номера можно запускать."}
        </p>
      )}
      <Button variant="primary" size="lg" className="mt-3 w-full md:hidden" onClick={onCreate}>
        Создать рассылку
      </Button>
    </section>
  );
}
