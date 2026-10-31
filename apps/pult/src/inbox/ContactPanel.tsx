// Карточка клиента: только то, что сервер действительно знает, сгруппированное по смыслу —
// кто это; через какой номер и кем ведётся переписка; записи из CRM (правда о записях); другие переписки этого клиента.
// Если клиент писал и на другой номер компании, здесь есть переход в ту переписку: чаты разных номеров не сливаются.
import { CalendarDays, ChevronRight, Eraser, Globe, MessageCircle, Phone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getOperator } from "@/lib/operator";
import type { BookingCard } from "@/model/types";
import { Ticks } from "./Ticks";
import { Confirm, toast } from "@/components/overlay";
import { Avatar, buttonClass, Field, IconButton, InsetGroup } from "@/components/ui";
import { dataMode } from "@/data/source";
import { channelOf, channelTitle, KIND_SHORT } from "@/model/channels";
import type { ConversationDetail, ConversationSummary, Workspace } from "@/model/types";
import { formatPhone, rowTime, until } from "@/lib/format";
import { useNow } from "@/lib/utils";
import { store } from "@/state/store";
import { sameContact } from "./derive";
import { handling } from "./handling";

export function ContactPanel({ convKey, ws, detail, summary, all, onOpenOther, onClose, closeLabel = "Скрыть карточку" }: { convKey: string; ws: Workspace; detail?: ConversationDetail; summary?: ConversationSummary; all: ConversationSummary[]; onOpenOther: (key: string) => void; onClose?: () => void; closeLabel?: string }) {
  const now = useNow();
  const [forget, setForget] = useState(false);
  const contact = detail?.contact || summary?.contact;
  const ch = channelOf(ws, (detail?.ref || summary?.ref)?.channelId || "");
  if (!contact) return null;
  const name = contact.name || contact.profileName || (contact.phone ? formatPhone(contact.phone) : "Гость сайта");
  const others = sameContact(all, convKey, contact.key);
  const bot = detail?.bot || summary?.bot;
  const reply = detail?.reply;
  const showBookings = !!detail && (detail.bookings.length > 0 || detail.pending.length > 0 || !!detail.bookedNote || !!ws.capabilities.booking);

  return (
    <div className="flex min-h-full flex-col bg-canvas pb-[max(1.25rem,var(--safe-b))]">
      {onClose && (
        <div className="flex h-12 shrink-0 items-center justify-end px-2 max-xl:hidden">
          <IconButton icon={X} label={closeLabel} onClick={onClose} />
        </div>
      )}
      <div className="flex flex-col items-center px-5 pb-6 pt-5 text-center xl:pt-0">
        <Avatar name={contact.name || contact.profileName} size="xl" />
        <p className="mt-3 max-w-full break-words text-[1.375rem] font-bold leading-7 tracking-[-0.02em] md:text-xl md:font-semibold">{name}</p>
        {contact.phone && name !== formatPhone(contact.phone) && <p className="tnum mt-0.5 text-[0.9375rem] text-fg-2">{formatPhone(contact.phone)}</p>}
        {contact.profileName && contact.profileName !== name && <p className="mt-0.5 text-sm text-fg-3">В WhatsApp: {contact.profileName}</p>}
        {contact.phone && <CallAction phone={contact.phone} />}
      </div>

      <div className="px-4">
        <InsetGroup title="Переписка">
          <dl>
            <Field stacked label="Номер компании">
              <span className="flex items-center gap-1.5">
                {ch?.kind === "web" ? <Globe aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={1.75} /> : <MessageCircle aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={1.75} />}
                <span className="min-w-0 truncate">{detail?.line?.label || channelTitle(ch)}</span>
              </span>
              {ch && ch.kind !== "web" && (ch.name || ch.phone) && <span className="tnum mt-0.5 block text-sm text-fg-3">{[ch.name && ch.phone ? formatPhone(ch.phone) : "", KIND_SHORT[ch.kind]].filter(Boolean).join(" · ")}</span>}
            </Field>
          </dl>
          {bot && (
            <dl>
              <Field stacked label="Кто ведёт">
                {(() => {
                  const as = detail?.assignee || summary?.assignee;
                  if (as) return as === getOperator() ? `${as} (вы)` : as;
                  if (bot.state === "off") return "Ни за кем не закреплён";
                  const t = handling(null, bot, now).text.replace(/^Ведёт /, "");
                  return t.charAt(0).toUpperCase() + t.slice(1);
                })()}
              </Field>
            </dl>
          )}
          <Origin detail={detail} now={now} />
          {reply && ch?.kind === "wa_cloud" && (
            <dl>
              <Field stacked label="Окно WhatsApp для ответа">
                {reply.allowed ? (reply.closesAt ? `Открыто ${until(reply.closesAt, now)}` : "Открыто") : reply.reason === "window" ? <span className="text-critical">Закрыто</span> : "—"}
              </Field>
            </dl>
          )}
        </InsetGroup>

        {ch && ch.kind !== "web" && ws.capabilities.booking !== false && <NearestBookings convKey={convKey} />}

        {showBookings && (detail!.bookings.length > 0 || detail!.pending.length > 0 || !!detail!.bookedNote) && (
          <InsetGroup title="Записи, сделанные ботом">
            {detail!.bookings.length === 0 && detail!.pending.length === 0 && !detail!.bookedNote ? (
              <p className="py-3 text-ui text-fg-3">В журнале нет записей</p>
            ) : (
              <>
                {detail!.bookings.map((b) => (
                  <p key={b} className="flex gap-2.5 py-2.5 text-ui">
                    <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-3" strokeWidth={1.75} />
                    <span>{b}</span>
                  </p>
                ))}
                {detail!.pending.map((b) => (
                  <p key={b} className="flex gap-2.5 py-2.5 text-ui text-fg-2">
                    <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-3" strokeWidth={1.75} />
                    <span>Ждёт подтверждения: {b}</span>
                  </p>
                ))}
                {detail!.bookedNote && <p className="py-2.5 text-ui text-fg-2">{detail!.bookedNote}</p>}
              </>
            )}
          </InsetGroup>
        )}

        {others.length > 0 && (
          <InsetGroup title="Писал и на другой номер" note="Это отдельная переписка: отвечают с того номера, на который клиент написал.">
            {others.map((o) => (
              <button key={o.key} type="button" onClick={() => onOpenOther(o.key)} className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                <MessageCircle aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui font-medium">{channelTitle(channelOf(ws, o.ref.channelId))}</span>
                  <span className="block truncate text-sm text-fg-3">{o.preview}</span>
                </span>
                <span className="tnum shrink-0 text-xs text-fg-3">{rowTime(o.lastAt, now)}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-3" />
              </button>
            ))}
          </InsetGroup>
        )}

        <InsetGroup>
          <button type="button" onClick={() => setForget(true)} className="-mx-4 flex min-h-11 w-[calc(100%+2rem)] items-center gap-2.5 px-4 text-left text-ui text-critical hover:bg-critical-soft pointer-coarse:text-base">
            <Eraser aria-hidden className="size-4" strokeWidth={1.75} />
            Очистить память бота
          </button>
        </InsetGroup>
      </div>
      <Confirm
        open={forget}
        onOpenChange={setForget}
        title="Очистить память бота?"
        text="Бот забудет эту переписку, записи и просьбы клиента — например, если всё уже сделано в CRM. Окно WhatsApp и отказ от рассылок останутся."
        yes="Очистить"
        danger
        onYes={async () => {
          const r = await store.act(convKey, "forget");
          toast(r && "error" in r ? r.error : "Память бота в этом чате очищена", r ? "critical" : "neutral");
        }}
      />
    </div>
  );
}

/** «Позвонить» под именем, как в карточке контакта iPhone. В демо номера вымышленные — звонок не набирается. */
function CallAction({ phone }: { phone: string }) {
  const cls = buttonClass("tinted", "md", "mt-4 min-w-36");
  const body = (
    <>
      <Phone aria-hidden className="size-4" strokeWidth={2} />
      Позвонить
    </>
  );
  if (dataMode() === "demo")
    return (
      <button type="button" className={cls} onClick={() => toast("В демо звонок не набирается: номера вымышленные")}>
        {body}
      </button>
    );
  return (
    <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className={cls}>
      {body}
    </a>
  );
}

const ACT: Record<string, string> = { take: "взял(а) чат себе", assign: "передал(а) чат", unassign: "снял закрепление", close: "закрыл чат", "close-unanswered": "закрыл без ответа", reopen: "открыл снова", done: "выполнил просьбу" };

/** Откуда диалог: ответ на напоминание или рассылку — с текстом нашего сообщения; иначе — последнее автоматическое сообщение
 *  клиенту и его статус; ниже — кто что делал в чате. */
function Origin({ detail, now }: { detail?: ConversationDetail; now: number }) {
  if (!detail) return null;
  const src = detail.attention?.source;
  const lastAuto = [...detail.messages].reverse().find((m) => m.auto);
  return (
    <>
      {src ? (
        <dl>
          <Field stacked label={src.kind === "rm" ? "Ответ на напоминание" : "Ответ на рассылку"}>
            <span className="text-fg-2">«{src.text || "…"}»</span>
            {src.at ? <span className="mt-0.5 block text-sm text-fg-3">отправлено {rowTime(src.at, now)}</span> : null}
          </Field>
        </dl>
      ) : lastAuto ? (
        <dl>
          <Field stacked label={lastAuto.auto === "service" ? "Последнее напоминание" : "Последняя рассылка"}>
            <span className="line-clamp-2 text-fg-2">«{lastAuto.text}»</span>
            <span className="mt-0.5 flex items-center gap-1 text-sm text-fg-3">
              {rowTime(lastAuto.at, now)} <Ticks status={lastAuto.status} error={lastAuto.statusError} />
            </span>
          </Field>
        </dl>
      ) : null}
      {!!detail.audit?.length && (
        <dl>
          <Field stacked label="Действия в чате">
            {detail.audit.slice(-4).reverse().map((x) => (
              <span key={x.at + x.act} className="block text-sm text-fg-2">
                {rowTime(x.at, now)} · {x.who} {ACT[x.act] || x.act}
                {x.to ? `: ${x.to}` : ""}
              </span>
            ))}
          </Field>
        </dl>
      )}
    </>
  );
}

/** Ближайшие записи клиента в Altegio (журнал только читается). */
function NearestBookings({ convKey }: { convKey: string }) {
  const [st, setSt] = useState<{ loading: boolean; error?: string; available?: boolean; records: BookingCard[] }>({ loading: true, records: [] });
  useEffect(() => {
    let live = true;
    setSt({ loading: true, records: [] });
    store.bookingCard(convKey).then(
      (r) => live && setSt({ loading: false, available: r.available, records: r.records }),
      (e: unknown) => live && setSt({ loading: false, error: e instanceof Error ? e.message : "Журнал не ответил", records: [] }),
    );
    return () => void (live = false);
  }, [convKey]);
  if (!st.loading && st.available === false) return null;
  return (
    <InsetGroup title="Записи в Altegio" note="Из журнала Altegio — это правда о записях. Изменить запись — в Altegio.">
      {st.loading ? (
        <p className="py-3 text-ui text-fg-3">Смотрю журнал…</p>
      ) : st.error ? (
        <p className="py-3 text-ui text-critical">{st.error}</p>
      ) : st.records.length === 0 ? (
        <p className="py-3 text-ui text-fg-3">Ближайших записей нет</p>
      ) : (
        st.records.map((r) => (
          <p key={r.id} className="flex gap-2.5 py-2.5 text-ui">
            <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-3" strokeWidth={1.75} />
            <span className="min-w-0">
              <span className="block font-medium">
                {dayShort(r.date)}, {r.time} · {r.staff || "мастер не указан"}
              </span>
              <span className="block text-fg-2">
                {r.services || "услуга не указана"}
                {r.minutes ? ` · ${r.minutes} мин` : ""}
              </span>
              <span className="block text-sm text-fg-3">
                {r.state} · {r.source} · № {r.id}
              </span>
            </span>
          </p>
        ))
      )}
    </InsetGroup>
  );
}
const DAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"], MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
/** «пт, 1 ноя» — по дате записи (она уже по Астане). */
const dayShort = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  if (!y || !m || !dd) return d;
  return `${DAYS[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]}, ${dd} ${MONTHS[m - 1]}`;
};
