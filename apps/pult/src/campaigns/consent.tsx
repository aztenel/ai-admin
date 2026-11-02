// Как получить согласия на рекламу (финальное ТЗ рассылок Winchester, 02.11.2026): реклама со второго номера уходит только тем, кто
// дал подтверждённое согласие. Когда некому писать рекламу — точная причина (сервер считает её в воронке) и рабочий порядок: спрашивать
// по одному, в переписке или на визите (массово такой вопрос не рассылать), готовый текст с «Скопировать» и где отметить ответ клиента.
// Пути — как в карточке клиента раздела «Клиенты» (ClientCard.tsx): «Изменить согласие» → «Есть» → «Клиент сам написал в WhatsApp».
// Разрешения, полученные раньше (WhatsApp на телефоне салона, анкеты), в Altegio вносить не нужно (задание владельца 02.11.2026): в карточке
// — «Письменное согласие» (где хранится и дата) или списком — «Импорт из файла» с подтверждением владельца (ImportFlow.tsx).
import { Copy, ShieldCheck, UsersRound } from "lucide-react";
import { toast } from "@/components/overlay";
import { Button } from "@/components/ui";
import { copyText } from "@/lib/clipboard";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";
import type { FunnelReason } from "@/model/campaigns";
import { useStore } from "@/state/store";
import { nf } from "./base/shared";

/** Вопрос клиенту — дословно из ТЗ; название компании — её собственное. */
export const consentQuestion = (company: string) =>
  `Можно мы иногда будем присылать вам новости и предложения ${company || "Winchester"} в WhatsApp? Если да, ответьте «да». Отказаться можно в любой момент: напишите «стоп».`;

/** Порядок получения согласий. reasons — почему рекламу сейчас не получит никто (воронка сервера); compact — без заголовка группы. */
export function ConsentHowTo({ reasons, note, className }: { reasons?: FunnelReason[]; note?: string; className?: string }) {
  const company = useStore((s) => s.workspace?.name) || "";
  const text = consentQuestion(company);
  const list = (reasons || []).filter((x) => x.n > 0);
  const copy = async () => {
    const ok = await copyText(text);
    toast(ok ? "Текст скопирован" : "Не получилось скопировать: выделите текст и скопируйте вручную", ok ? "neutral" : "critical");
  };
  return (
    <section aria-label="Как получить согласия" className={cn("rounded-[0.875rem] bg-surface px-4 py-3", className)}>
      <p className="flex items-center gap-2 text-[0.9375rem] font-semibold md:text-base">
        <ShieldCheck aria-hidden className="size-[1.125rem] shrink-0 text-brand-gold" strokeWidth={1.9} />
        Рекламу сейчас не получит никто
      </p>
      {(list.length > 0 || note) && (
        <div className="mt-1.5 text-sm text-fg-2">
          {note && <p>{note}</p>}
          {list.length > 0 && (
            <ul className="mt-0.5 space-y-0.5">
              {list.map((x) => (
                <li key={x.code} className="flex justify-between gap-3">
                  <span>{x.why}</span>
                  <span className="tnum shrink-0">{nf.format(x.n)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="mt-3 text-sm font-medium text-fg">Как получить согласия</p>
      <p className="mt-0.5 text-sm text-fg-2">Спрашивайте по одному — в переписке или на визите, массово такой вопрос не рассылайте.</p>
      <figure className="mt-2 rounded-xl bg-surface-2 px-3 py-2.5">
        <blockquote className="text-sm text-fg">{text}</blockquote>
        <Button size="sm" variant="tinted" icon={Copy} className="mt-2" onClick={() => void copy()}>
          Скопировать
        </Button>
      </figure>
      <p className="mt-2 text-sm text-fg-2">
        Клиент ответил «да» — откройте его в разделе «Клиенты»: «Изменить согласие» → «Есть» → «Клиент сам написал в WhatsApp».
      </p>
      <p className="mt-2 text-sm text-fg-2">
        Разрешения уже есть (в WhatsApp на телефоне салона, анкеты) — в Altegio их вносить не нужно. По одному: в карточке «Письменное согласие», где хранится и
        дата. Списком: «Клиенты» → «Импорт из файла» с колонкой «Согласие» и отметкой владельца «клиенты сами разрешили рекламу».
      </p>
      <Button size="sm" variant="outline" icon={UsersRound} className="mt-2" onClick={() => navigate({ name: "clients" })}>
        Открыть «Клиенты»
      </Button>
    </section>
  );
}
