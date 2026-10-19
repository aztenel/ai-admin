// Сервисные сообщения — вкладка «Сервисные · номер бота» (решение владельца 19.10.2026). Это не рассылки: бот шлёт их сам, без
// администраторов, только по записям, которые клиент сделал в чате с ботом, и с того номера, куда клиент писал (у Winchester — номер бота).
// ЗАГЛУШКА: что включено, очередь и что ушло (GET /api/bc/service) покажет полная версия этого компонента — её пишет отдельная задача.
// Пока — только объяснение, без данных: придумывать числа нельзя.
import { BellRing, CalendarClock, Star, type LucideIcon } from "lucide-react";
import { Group } from "@/screens/Page";

const KINDS: { icon: LucideIcon; text: string }[] = [
  { icon: CalendarClock, text: "Накануне в 18:00 — напоминание о записи" },
  { icon: BellRing, text: "За 2 часа — напоминание" },
  { icon: Star, text: "Через 3 часа после визита — просьба оставить отзыв" },
];

export default function ServiceMessages(_props: { ws: string; owner: boolean }) {
  return (
    <Group title="Сервисные сообщения" note="Отправляет бот сам, с номера бота. Администратору ничего делать не нужно.">
      <ul>
        {KINDS.map((k, i) => (
          <li key={k.text} className={i ? "flex min-h-12 items-center gap-3 border-t border-line py-2.5" : "flex min-h-12 items-center gap-3 py-2.5"}>
            <span className="grid size-9 shrink-0 place-items-center rounded-[0.625rem] bg-surface-2 text-fg-2">
              <k.icon aria-hidden className="size-[1.125rem]" strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1 text-base pointer-coarse:text-md">{k.text}</span>
          </li>
        ))}
      </ul>
    </Group>
  );
}
