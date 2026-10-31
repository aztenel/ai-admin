// Что показать в списке: область (филиал, номер), фильтр и поиск. Только отбор того, что сервер уже разрешил этому
// пользователю, — чужих данных здесь нет и быть не может (права проверяет сервер, CLAUDE.md §5.3).
import { scopeChannels, type Scope } from "@/model/channels";
import type { ConversationSummary, Workspace } from "@/model/types";
import type { Filter } from "@/state/store";

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, "");

export function inScope(ws: Workspace, scope: Scope, list: ConversationSummary[]) {
  const ids = scopeChannels(ws, scope);
  return ids ? list.filter((c) => ids.has(c.ref.channelId)) : list;
}

const BOOKING_TOPICS = new Set(["book", "move", "cancel", "late", "time"]);
const REQUESTS = new Set(["req", "lead", "call"]);
/** Разделы чатов (ТЗ v2.0 §2.1). «Мои» — по имени сотрудника на этом устройстве (lib/operator.ts). */
export const filterTest = (me: string): Record<Filter, (c: ConversationSummary) => boolean> => ({
  waiting: (c) => !!c.attention,
  booking: (c) => !!c.attention && (BOOKING_TOPICS.has(c.attention.topic || "") || REQUESTS.has(c.attention.reason)),
  replies: (c) => !!c.attention?.source || (!!c.attention && c.attention.reason === "reply"),
  mine: (c) => !!me && c.assignee === me && (!c.done || !!c.attention),
  all: (c) => c.inbound,
  done: (c) => !!c.done && !c.attention,
});

/** Поиск — по имени, номеру и последнему сообщению; во всех чатах выбранной области, без учёта фильтра. */
export function search(list: ConversationSummary[], q: string) {
  const n = norm(q);
  if (!n) return list;
  const d = q.replace(/\D/g, "");
  return list.filter((c) => norm(`${c.contact.name || ""}${c.contact.phone || ""}${c.preview}`).includes(n) || (d.length >= 3 && (c.contact.phone || "").replace(/\D/g, "").includes(d)));
}

export function counts(list: ConversationSummary[], me: string): Record<Filter, number> {
  const t = filterTest(me), n = (f: Filter) => list.filter(t[f]).length;
  return { waiting: n("waiting"), booking: n("booking"), replies: n("replies"), mine: n("mine"), all: n("all"), done: n("done") };
}

/** Другие чаты того же клиента — через другие номера компании. Переписки не сливаем: у каждого номера своя. */
export function sameContact(list: ConversationSummary[], key: string, contactKey: string) {
  if (contactKey.startsWith("web:")) return [];
  return list.filter((c) => c.key !== key && c.contact.key === contactKey);
}
