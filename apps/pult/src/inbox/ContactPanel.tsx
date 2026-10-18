// Карточка клиента: только то, что сервер действительно знает, сгруппированное по смыслу —
// кто это; через какой номер и кем ведётся переписка; записи из CRM (правда о записях); другие переписки этого клиента.
// Если клиент писал и на другой номер компании, здесь есть переход в ту переписку: чаты разных номеров не сливаются.
import { CalendarDays, ChevronRight, Eraser, Globe, MessageCircle, Phone, X } from "lucide-react";
import { useState } from "react";
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
    <div className="flex min-h-full flex-col bg-canvas pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      {onClose && (
        <div className="flex h-12 shrink-0 items-center justify-end px-2 max-xl:hidden">
          <IconButton icon={X} label={closeLabel} onClick={onClose} />
        </div>
      )}
      <div className="flex flex-col items-center px-5 pb-6 pt-5 text-center xl:pt-0">
        <Avatar name={contact.name || contact.profileName} size="xl" />
        <p className="mt-3 max-w-full break-words text-xl font-semibold tracking-[-0.015em]">{name}</p>
        {contact.phone && name !== formatPhone(contact.phone) && <p className="tnum mt-0.5 text-[0.9375rem] text-fg-2">{formatPhone(contact.phone)}</p>}
        {contact.profileName && contact.profileName !== name && <p className="mt-0.5 text-sm text-fg-3">В WhatsApp: {contact.profileName}</p>}
        {contact.phone && <CallAction phone={contact.phone} />}
      </div>

      <div className="px-4">
        <InsetGroup title="Переписка">
          <dl>
            <Field label="Номер">
              <span className="inline-flex items-center gap-1.5">
                {ch?.kind === "web" ? <Globe aria-hidden className="size-3.5 text-fg-3" strokeWidth={1.75} /> : <MessageCircle aria-hidden className="size-3.5 text-fg-3" strokeWidth={1.75} />}
                {channelTitle(ch)}
              </span>
              {ch && ch.kind !== "web" && (ch.name || ch.phone) && <span className="block text-xs text-fg-3">{[ch.name && ch.phone ? formatPhone(ch.phone) : "", KIND_SHORT[ch.kind]].filter(Boolean).join(", ")}</span>}
            </Field>
          </dl>
          {bot && (
            <dl>
              <Field label="Ведёт">{handling(null, bot, now).text.replace(/^Ведёт /, "")}</Field>
            </dl>
          )}
          {reply && ch?.kind === "wa_cloud" && (
            <dl>
              <Field label="Окно WhatsApp">{reply.allowed ? (reply.closesAt ? until(reply.closesAt, now) : "открыто") : reply.reason === "window" ? <span className="text-critical">закрыто</span> : "—"}</Field>
            </dl>
          )}
        </InsetGroup>

        {showBookings && (
          <InsetGroup title="Записи в CRM">
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
          const e = await store.act(convKey, "forget");
          toast(e || "Память бота в этом чате очищена", e ? "critical" : "neutral");
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
