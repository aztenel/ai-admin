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

export const FILTER_TEST: Record<Filter, (c: ConversationSummary) => boolean> = {
  all: () => true,
  waiting: (c) => !!c.attention,
  operator: (c) => c.bot.state === "paused",
  unread: (c) => c.unread || !!c.unreadCount,
};

/** Поиск — по имени, номеру и последнему сообщению; во всех чатах выбранной области, без учёта фильтра. */
export function search(list: ConversationSummary[], q: string) {
  const n = norm(q);
  if (!n) return list;
  const d = q.replace(/\D/g, "");
  return list.filter((c) => norm(`${c.contact.name || ""}${c.contact.phone || ""}${c.preview}`).includes(n) || (d.length >= 3 && (c.contact.phone || "").replace(/\D/g, "").includes(d)));
}

export function counts(list: ConversationSummary[]): Record<Filter, number> {
  return { all: list.length, waiting: list.filter(FILTER_TEST.waiting).length, operator: list.filter(FILTER_TEST.operator).length, unread: list.filter(FILTER_TEST.unread).length };
}

/** Другие чаты того же клиента — через другие номера компании. Переписки не сливаем: у каждого номера своя. */
export function sameContact(list: ConversationSummary[], key: string, contactKey: string) {
  if (contactKey.startsWith("web:")) return [];
  return list.filter((c) => c.key !== key && c.contact.key === contactKey);
}
