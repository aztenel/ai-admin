// Как сообщение увидит клиент в WhatsApp (ТЗ v3.0 §4.2): только готовый текст — без {{…}}, [скобок] и служебных пометок.
// Цвета — как в WhatsApp, а не как в пульте: администратор сразу узнаёт, что это вид у клиента.
import { CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function WaBubble({ text, to, className }: { text: string; to?: string; className?: string }) {
  return (
    <figure className={cn("overflow-hidden rounded-2xl border border-line", className)}>
      <figcaption className="flex items-center gap-2 bg-[#075e54] px-3 py-2 text-sm font-medium text-white">
        <span aria-hidden className="grid size-6 place-items-center rounded-full bg-white/20 text-xs">W</span>
        <span className="min-w-0 truncate">Winchester</span>
        {to && <span className="ml-auto shrink-0 text-xs font-normal text-white/80">{to}</span>}
      </figcaption>
      <div className="bg-[#efe7dd] px-3 py-3 dark:bg-[#0b141a]">
        <p className="relative ml-auto max-w-[92%] whitespace-pre-line rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 pb-5 pt-2 text-[0.9375rem] leading-snug text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-[#e9edef]">
          {text}
          <span className="absolute bottom-1 right-2 flex items-center gap-0.5 text-[0.6875rem] text-[#667781] dark:text-[#8696a0]">
            12:00 <CheckCheck aria-hidden className="size-3.5 text-[#53bdeb]" strokeWidth={2.4} />
          </span>
        </p>
      </div>
    </figure>
  );
}
