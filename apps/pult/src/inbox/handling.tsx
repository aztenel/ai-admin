// Кто ведёт переписку — одно описание для строки списка, шапки и карточки клиента.
// Это режим (бот или человек), а не канал: номер, на который написал клиент, показывается отдельно.
import { BellOff, Bot, PowerOff, UserRound, type LucideIcon } from "lucide-react";
import type { Attention, BotState } from "@/model/types";
import { until, waited } from "@/lib/format";

export type Handling = { icon: LucideIcon | null; text: string; short: string; tone: "critical" | "muted" };

export function handling(attention: Attention, bot: BotState, now: number): Handling {
  if (attention) {
    const w = attention.since ? waited(attention.since, now) : "";
    return { icon: null, text: attention.label + (w ? `, ждёт ${w}` : ""), short: attention.label + (w ? ` · ${w}` : ""), tone: "critical" };
  }
  if (bot.state === "paused") return { icon: UserRound, text: `Ведёт человек, бот молчит ${until(bot.until, now)}`, short: `Человек, ${until(bot.until, now)}`, tone: "muted" };
  if (bot.state === "stopped") return { icon: BellOff, text: "Просил не писать автоматически", short: "Просил не писать", tone: "muted" };
  if (bot.state === "off") return { icon: PowerOff, text: "Бот выключен, отвечает человек", short: "Бот выключен", tone: "muted" };
  return { icon: Bot, text: "Ведёт бот", short: "Бот", tone: "muted" };
}
