// Каналы (номера WhatsApp и чат на сайте): как называть их человеку и как сводить сведения из разных ответов сервера.
import type { Channel, ChannelKind, Workspace } from "./types";
import { formatPhone, phoneTail } from "@/lib/format";

export const channelKind = (code: string): ChannelKind => (code === "wa" ? "wa_cloud" : code === "ga" ? "green_api" : "web");

/** Вид подключения — коротко, для строки списка, когда своего названия у номера нет. */
export const KIND_SHORT: Record<ChannelKind, string> = { wa_cloud: "WhatsApp API", green_api: "WhatsApp", web: "Сайт" };
/** Вид подключения — для настроек: как этот номер работает. */
export const KIND_LONG: Record<ChannelKind, string> = {
  wa_cloud: "Официальный WhatsApp Business",
  green_api: "WhatsApp, привязан по QR-коду",
  web: "Чат на сайте компании",
};

/** Название канала: своё имя → номер телефона → вид подключения. */
export function channelTitle(c: Channel | undefined): string {
  if (!c) return "Канал";
  if (c.name) return c.name;
  if (c.kind === "web") return "Чат на сайте";
  return c.phone ? formatPhone(c.phone) : KIND_SHORT[c.kind];
}

/** Подпись канала в строке чата: короче названия, с последними цифрами номера, чтобы два номера не путались. */
export function channelBadge(c: Channel | undefined): string {
  if (!c) return "";
  if (c.name) return c.name;
  if (c.kind === "web") return "Сайт";
  const tail = c.phone ? phoneTail(c.phone) : "";
  return tail ? `${KIND_SHORT[c.kind]} ${tail}` : KIND_SHORT[c.kind];
}

/** Сведения о номерах приходят двумя путями: по чатам (какие каналы есть) и из отчёта (телефон и состояние). */
export function mergeChannels(fromChats: Channel[], fromReport: Channel[] | undefined): Channel[] {
  if (!fromReport) return fromChats;
  const out = new Map<string, Channel>();
  for (const c of fromChats) out.set(c.id, c);
  for (const r of fromReport) out.set(r.id, { ...(out.get(r.id) || r), ...r, name: out.get(r.id)?.name || r.name });
  const rank = (id: string) => {
    const i = ["wa", "ga", "web"].indexOf(id);
    return i < 0 ? 99 : i;
  };
  return [...out.values()].sort((a, b) => rank(a.id) - rank(b.id));
}

export const channelOf = (ws: Workspace | null, id: string) => ws?.channels.find((c) => c.id === id);

/** Область просмотра: все чаты, один филиал или один номер. */
export type Scope = { kind: "all" } | { kind: "branch"; id: string } | { kind: "channel"; id: string };

export function scopeChannels(ws: Workspace, scope: Scope): Set<string> | null {
  if (scope.kind === "all") return null;
  if (scope.kind === "channel") return new Set([scope.id]);
  return new Set(ws.channels.filter((c) => c.branchId === scope.id).map((c) => c.id));
}

export function scopeTitle(ws: Workspace, scope: Scope): string {
  if (scope.kind === "channel") return channelTitle(channelOf(ws, scope.id));
  if (scope.kind === "branch") return ws.branches.find((b) => b.id === scope.id)?.name || "Филиал";
  return ws.branches.length > 1 ? "Все филиалы" : ws.channels.length > 1 ? "Все номера" : "Все чаты";
}

/** Сохранённая область ещё существует? Номер могли отключить, филиал — удалить. */
export function validScope(ws: Workspace, s: Scope): Scope {
  if (s.kind === "channel" && ws.channels.some((c) => c.id === s.id)) return s;
  if (s.kind === "branch" && ws.branches.some((b) => b.id === s.id)) return s;
  return { kind: "all" };
}
