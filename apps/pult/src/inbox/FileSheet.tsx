// Файлы перед отправкой (второй номер, Green-API): что выбрано — миниатюры фото, у остального значок, имя и размер; убрать лишнее,
// подпись к одному файлу, «Отправить N». Что сервер не примет (больше 25 МБ, пустой, программа или страница), видно сразу и не уходит.
// На iPhone кнопка «Прикрепить» открывает системный выбор: снять фото или видео, медиатека, «Файлы».
import { FileText, Film, Image as ImageIcon, Music, Reply, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Sheet } from "@/components/overlay";
import { Button, IconButton } from "@/components/ui";
import { plural } from "@/lib/format";
import type { Quote } from "@/model/types";
import { fileKindOf } from "@/state/store";
import { fmtSize } from "./MediaView";

export const FILE_MAX = 25 * 1024 * 1024;
export const FILES_AT_ONCE = 10;
/** Что можно выбрать: фото, видео, голос и музыка, PDF и офисные документы. */
export const ACCEPT = "image/*,video/*,audio/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.odp,.zip";
// как на сервере (services/inbox/send.js, filePlan): программы, страницы, скрипты — нет; точка и пробел в конце имени не спасают
const RISKY = /\.(html?|xhtml|svg|js|mjs|exe|msi|bat|cmd|com|scr|vbs|ps1|jar|apk|app|dmg|sh|php)$/i;
const RISKY_TYPE = /^(text\/(html|javascript)|image\/svg\+xml|application\/(xhtml\+xml|(x-)?javascript|x-msdownload|vnd\.android\.package-archive))\b/i;

/** Почему файл не уйдёт (пусто — уйдёт). */
export function fileIssue(f: File): string {
  if (!f.size) return "Файл пустой";
  if (f.size > FILE_MAX) return "Больше 25 МБ. Уменьшите файл или отправьте с телефона";
  if (RISKY.test(f.name.replace(/[.\s]+$/, "")) || RISKY_TYPE.test(f.type)) return "Такие файлы из пульта не отправляются";
  return "";
}

export function FileSheet({ files, onRemove, onClose, onSend, quote, quoteWho }: { files: File[]; onRemove: (f: File) => void; onClose: () => void; onSend: (files: File[], caption: string) => void; quote?: Quote | null; quoteWho?: string }) {
  const [caption, setCaption] = useState("");
  const open = files.length > 0;
  useEffect(() => {
    if (!open) setCaption("");
  }, [open]);
  // миниатюры фото — ссылки на файл в этом браузере, освобождаются, когда список меняется
  const thumbs = useMemo(() => new Map(files.filter((f) => fileKindOf(f) === "image" && !fileIssue(f)).map((f) => [f, URL.createObjectURL(f)])), [files]);
  useEffect(() => () => thumbs.forEach((u) => URL.revokeObjectURL(u)), [thumbs]);
  const ok = files.filter((f) => !fileIssue(f));
  const one = ok.length === 1;
  const title = files.length === 1 ? "Отправить файл" : `Выбрано ${files.length} ${plural(files.length, ["файл", "файла", "файлов"])}`;
  return (
    <Sheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={title}
      description={ok.length > 1 ? "Файлы уйдут по одному, каждый отдельным сообщением." : undefined}
      footer={
        <div className="flex gap-2 pb-1">
          <Button className="flex-1" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" className="flex-1" disabled={!ok.length} onClick={() => onSend(ok, one ? caption.trim() : "")}>
            {ok.length > 1 ? `Отправить ${ok.length}` : "Отправить"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 px-4 pb-2">
        {quote && (
          <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-2">
            <Reply aria-hidden className="size-4 shrink-0 text-accent" strokeWidth={1.9} />
            <span className="min-w-0 truncate">
              Ответ{quoteWho ? ` ${quoteWho}` : ""}: {quote.text || "сообщение"}
            </span>
          </p>
        )}
        <ul aria-label="Файлы к отправке" className="space-y-2">
          {files.map((f, i) => {
            const issue = fileIssue(f), kind = fileKindOf(f), thumb = thumbs.get(f);
            const Icon = kind === "image" ? ImageIcon : kind === "video" ? Film : kind === "audio" ? Music : FileText;
            return (
              <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-2 pr-1">
                {thumb ? (
                  <img src={thumb} alt="" className="size-14 shrink-0 rounded-lg bg-surface-2 object-cover" />
                ) : (
                  <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-3">
                    <Icon aria-hidden className="size-6" strokeWidth={1.6} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui font-medium">{f.name || "Файл"}</span>
                  <span className={issue ? "block text-sm text-critical" : "block text-sm text-fg-3"}>{issue || fmtSize(f.size)}</span>
                </span>
                <IconButton icon={X} label={`Убрать ${f.name || "файл"}`} onClick={() => onRemove(f)} />
              </li>
            );
          })}
        </ul>
        {one && (
          <label className="block">
            <span className="mb-1 block text-sm text-fg-2">Подпись (необязательно)</span>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Например: наш прайс на ноябрь"
              className="block w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-md leading-6 outline-none focus:border-accent md:text-base"
            />
          </label>
        )}
      </div>
    </Sheet>
  );
}
