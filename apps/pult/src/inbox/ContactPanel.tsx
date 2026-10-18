// Карточка клиента: только то, что сервер действительно знает. Записи — из журнала CRM (правда о записях).
// Если клиент писал и на другой номер компании, здесь есть переход в ту переписку: чаты разных номеров не сливаются.
import { CalendarDays, ChevronRight, Eraser, Globe, MessageCircle, X } from "lucide-react";
import { useState } from "react";
import { Confirm, toast } from "@/components/overlay";
import { Avatar, Field, IconButton } from "@/components/ui";
import { channelOf, channelTitle, KIND_SHORT } from "@/model/channels";
import type { ConversationDetail, ConversationSummary, Workspace } from "@/model/types";
import { formatPhone, rowTime, until } from "@/lib/format";
import { cn, useNow } from "@/lib/utils";
import { store } from "@/state/store";
import { CallLink } from "./Composer";
import { sameContact } from "./derive";

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

  return (
    <div className="flex min-h-full flex-col">
      {onClose && (
        <div className="flex h-12 shrink-0 items-center justify-end px-2 max-xl:hidden">
          <IconButton icon={X} label={closeLabel} onClick={onClose} />
        </div>
      )}
      <div className="flex flex-col items-center px-5 pb-5 pt-2 text-center">
        <Avatar name={contact.name || contact.profileName} phone={contact.phone} size="xl" />
        <p className="mt-3 max-w-full break-words text-xl font-semibold tracking-[-0.01em]">{name}</p>
        {contact.phone && contact.name && <p className="tnum mt-0.5 text-base text-fg-2">{formatPhone(contact.phone)}</p>}
        {contact.profileName && contact.profileName !== contact.name && <p className="mt-0.5 text-sm text-fg-3">В WhatsApp: {contact.profileName}</p>}
        <CallLink phone={contact.phone} className="mt-4" />
      </div>

      <Section title="Переписка">
        <dl className="divide-y divide-line">
          <Field label="Номер">
            <span className="inline-flex items-center gap-1.5">
              {ch?.kind === "web" ? <Globe aria-hidden className="size-3.5 text-fg-3" /> : <MessageCircle aria-hidden className="size-3.5 text-fg-3" />}
              {channelTitle(ch)}
            </span>
            {ch && ch.kind !== "web" && (ch.name || ch.phone) && (
              <span className="block text-xs text-fg-3">{[ch.name && ch.phone ? formatPhone(ch.phone) : "", KIND_SHORT[ch.kind]].filter(Boolean).join(", ")}</span>
            )}
          </Field>
          {bot && <Field label="Кто ведёт">{bot.state === "paused" ? `человек, бот молчит ${until(bot.until, now)}` : bot.state === "stopped" ? "просил не писать автоматически" : bot.state === "off" ? "человек: бот выключен" : "бот"}</Field>}
          {reply && ch?.kind === "wa_cloud" && <Field label="Окно WhatsApp">{reply.allowed ? (reply.closesAt ? `открыто ${until(reply.closesAt, now)}` : "открыто") : reply.reason === "window" ? "закрыто — клиент писал больше суток назад" : "—"}</Field>}
        </dl>
      </Section>

      {detail && (detail.bookings.length > 0 || detail.pending.length > 0 || !!detail.bookedNote || ws.capabilities.booking) && (
        <Section title="Записи">
          {detail.bookings.length === 0 && detail.pending.length === 0 && !detail.bookedNote ? (
            <p className="py-2 text-sm text-fg-3">Нет записей в журнале CRM.</p>
          ) : (
            <ul className="space-y-2 py-1.5">
              {detail.bookings.map((b) => (
                <li key={b} className="flex gap-2.5 text-sm">
                  <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-3" strokeWidth={1.9} />
                  <span>{b}</span>
                </li>
              ))}
              {detail.pending.map((b) => (
                <li key={b} className="flex gap-2.5 text-sm text-fg-2">
                  <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-3" strokeWidth={1.9} />
                  <span>Ждёт подтверждения: {b}</span>
                </li>
              ))}
              {detail.bookedNote && <li className="text-sm text-fg-2">{detail.bookedNote}</li>}
            </ul>
          )}
        </Section>
      )}

      {others.length > 0 && (
        <Section title="Писал и на другой номер">
          <ul className="-mx-2">
            {others.map((o) => {
              const och = channelOf(ws, o.ref.channelId);
              return (
                <li key={o.key}>
                  <button type="button" onClick={() => onOpenOther(o.key)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-2">
                    <MessageCircle aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={1.9} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{channelTitle(och)}</span>
                      <span className="block truncate text-xs text-fg-3">{o.preview}</span>
                    </span>
                    <span className="tnum shrink-0 text-xs text-fg-3">{rowTime(o.lastAt, now)}</span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-3" />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="pb-1 pt-1 text-xs text-fg-3">Это отдельная переписка: отвечать клиенту нужно с того номера, на который он написал.</p>
        </Section>
      )}

      <div className="mt-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6">
        <button type="button" onClick={() => setForget(true)} className={cn("inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm text-critical hover:bg-critical-soft pointer-coarse:min-h-11", "-ml-2")}>
          <Eraser aria-hidden className="size-4" strokeWidth={1.9} />
          Очистить память бота
        </button>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line px-5 pt-3">
      <h3 className="pb-1 text-sm font-semibold text-fg">{title}</h3>
      {children}
    </section>
  );
}
