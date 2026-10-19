// «Как увидит клиент»: пузырь WhatsApp с текстом шаблона, в который подставлены значения для первого клиента с именем
// (их считает сервер в /api/bc/check → preview). Картинку из ссылки не загружаем: чужой адрес может не открыться
// или быть запрещён правилами страницы — показываем место под неё.
import { ImageIcon } from "lucide-react";
import { withName } from "../common";

const NAME_RE = /\{\s*(имя|name)\s*\}/i;

/** Текст шаблона с подстановками: {{1}}, {{2}}… — значения по порядку; {имя} прямо в тексте — имя (или чем его заменить). */
export function fillTemplate(text: string, values: string[], params: string[], fallback: string): string {
  const filled = text.replace(/\{\{\s*(\d{1,2})\s*\}\}/g, (m, i: string) => values[Number(i) - 1] ?? m);
  return withName(filled, nameFrom(values, params) || fallback);
}

/** Имя первого клиента — из значения той подстановки, где стоит {имя} (в том числе «Здравствуйте, {имя}!»). */
function nameFrom(values: string[], params: string[]): string {
  const at = params.findIndex((p) => NAME_RE.test(p));
  const v = at >= 0 ? values[at] : undefined;
  if (!v) return "";
  const [pre, post = ""] = params[at].split(NAME_RE).filter((_, i) => i !== 1);
  return v.startsWith(pre) && v.endsWith(post) && v.length > pre.length + post.length ? v.slice(pre.length, v.length - post.length) : "";
}

export function TemplatePreview({ text, image, time, extra }: { text: string; image: boolean; time: string; extra?: string[] }) {
  return (
    <figure className="rounded-[0.875rem] bg-canvas p-3" aria-label="Как увидит клиент">
      <div className="max-w-[min(20rem,88%)] overflow-hidden rounded-[1.125rem] rounded-bl-[0.375rem] bg-surface shadow-card">
        {image && (
          <div className="m-1 mb-0 grid aspect-[16/9] place-items-center rounded-[0.875rem] bg-surface-3 text-fg-3">
            <span className="flex flex-col items-center gap-1 text-xs">
              <ImageIcon aria-hidden className="size-6" strokeWidth={1.5} />
              Картинка из шаблона
            </span>
          </div>
        )}
        <p className="whitespace-pre-wrap break-words px-3 pb-1.5 pt-[0.4375rem] text-md leading-[1.375rem] text-fg [overflow-wrap:anywhere] md:text-base md:leading-[1.3125rem]">
          {text || <span className="text-fg-3">Текст шаблона появится здесь</span>}
        </p>
        <p className="tnum px-3 pb-1.5 text-right text-[0.6875rem] leading-none text-fg-3">{time}</p>
      </div>
      {extra && extra.length > 0 && <p className="mt-2 px-1 text-sm text-fg-2">Подстановки: {extra.join(" · ")}</p>}
    </figure>
  );
}
