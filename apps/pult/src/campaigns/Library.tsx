// «Библиотека текстов» во вкладке «Маркетинг» (ТЗ v2.0 §5, 31.10.2026): 28 стартовых тем на русском и казахском (сервер —
// src/services/broadcast/library.js) и свои тексты владельца. Владелец правит текст и одобряет его; текст с [скобками] (условия акции,
// имя мастера) одобрить нельзя — сначала вписать настоящие условия. Одобрение — решение владельца о тексте, а не отправка: с основного
// номера реклама уходит только шаблоном, который одобрила Meta, — текст отсюда владелец подаёт в Meta как шаблон. Сотрудник видит
// тексты, но не правит. Пример — на 3–5 клиентах сегмента (номера маской) или на вымышленном, если базы нет.
import { useState } from "react";
import { BookOpenText } from "lucide-react";
import { toast } from "@/components/overlay";
import { Button, Skeleton } from "@/components/ui";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LibraryItem, TemplatePreview } from "@/model/campaigns";
import { Group } from "@/screens/Page";
import { store } from "@/state/store";
import { nf, Notice } from "./base/shared";
import { errorList } from "./common";
import { useLoad } from "./useLoad";
import { TextArea } from "./wizard/fields";

const FIRST = 5;
const NOTE =
  "Готовые темы на русском и казахском. Одобрение — ваше решение о тексте; с основного номера реклама уходит только шаблоном, который одобрила Meta. Слова в {фигурных скобках} бот подставит сам, [квадратные] — впишите перед одобрением.";

export default function Library({ ws, owner }: { ws: string; owner: boolean }) {
  const lib = useLoad((src) => src.templates(ws), [ws]);
  const [all, setAll] = useState(false);
  if (lib.loading)
    return (
      <Group title="Библиотека текстов">
        <Skeleton className="my-3 h-24 w-full rounded-xl" />
      </Group>
    );
  if (!lib.data)
    return (
      <Group title="Библиотека текстов">
        <Notice tone="critical" role="alert">
          Тексты не загрузились: {lib.error}
        </Notice>
      </Group>
    );
  const items = lib.data.items, ok = items.filter((x) => x.approved).length, shown = all ? items : items.slice(0, FIRST);
  const canEdit = owner && lib.data.owner;
  return (
    <Group title="Библиотека текстов" note={NOTE}>
      <p className="flex items-center gap-2 py-3 text-ui text-fg-2 pointer-coarse:text-base">
        <BookOpenText aria-hidden className="size-5 shrink-0 text-fg-3" strokeWidth={1.75} />
        <span>
          {nf.format(items.length)} {plural(items.length, ["текст", "текста", "текстов"])}, одобрено {nf.format(ok)}
        </span>
      </p>
      <ul aria-label="Библиотека текстов" className="divide-y divide-line border-t border-line">
        {shown.map((x) => (
          <ItemRow key={x.id} ws={ws} x={x} canEdit={canEdit} onSaved={(it) => lib.set((d) => ({ ...d!, items: d!.items.map((i) => (i.id === it.id ? { ...i, ...it } : i)) }))} />
        ))}
      </ul>
      {items.length > FIRST && (
        <Button variant="ghost" className="my-2 w-full" onClick={() => setAll((v) => !v)}>
          {all ? "Свернуть" : `Показать все ${nf.format(items.length)}`}
        </Button>
      )}
    </Group>
  );
}

function ItemRow({ ws, x, canEdit, onSaved }: { ws: string; x: LibraryItem; canEdit: boolean; onSaved: (it: LibraryItem) => void }) {
  const [open, setOpen] = useState(false), [lang, setLang] = useState<"ru" | "kk">("ru");
  const [edit, setEdit] = useState<{ ru: string; kk: string } | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [pv, setPv] = useState<TemplatePreview | null>(null);
  const brackets = /\[[^\]]*\]/.test(x.ru) || /\[[^\]]*\]/.test(x.kk);
  const save = async (approved: boolean, text = edit) => {
    const src = store.source;
    if (!src) return;
    setBusy(true);
    setErr("");
    try {
      const it = await src.templateSave(ws, { id: x.id, title: x.title, goal: x.goal, ru: (text || x).ru, kk: (text || x).kk, approved });
      onSaved(it);
      setEdit(null);
      setPv(null);
      toast(approved ? `«${x.title}» одобрен` : text ? `«${x.title}» сохранён` : `Одобрение «${x.title}» снято`);
    } catch (e) {
      setErr(errorList(e)[0] || "Не получилось сохранить.");
    } finally {
      setBusy(false);
    }
  };
  const preview = async () => {
    const src = store.source;
    if (!src) return;
    try {
      setPv(await src.templatePreview(ws, x.id, lang));
    } catch (e) {
      setErr(errorList(e)[0] || "Пример не загрузился.");
    }
  };
  const id = `lib-${x.id}`;
  return (
    <li className="py-2.5">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] font-semibold md:text-base">{x.title}</span>
          {x.goal && <span className="block text-sm text-fg-2">{x.goal}</span>}
        </span>
        <span className={cn("mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs font-medium", x.approved ? "bg-positive-soft text-positive" : "bg-surface-2 text-fg-2")}>
          {x.approved ? "одобрен" : brackets ? "нужно дописать" : "не одобрен"}
        </span>
      </button>
      {open && (
        <div id={id} className="mt-2">
          <div role="group" aria-label={`Язык текста «${x.title}»`} className="mb-1.5 inline-flex rounded-lg bg-surface-2 p-0.5 text-sm">
            {(["ru", "kk"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => {
                  setLang(l);
                  setPv(null);
                }}
                className={cn("rounded-md px-2.5 py-0.5 pointer-coarse:py-1.5", lang === l ? "bg-surface font-medium text-fg shadow-sm" : "text-fg-2")}
              >
                {l === "ru" ? "Русский" : "Қазақша"}
              </button>
            ))}
          </div>
          {edit ? (
            <TextArea
              label={lang === "ru" ? "Текст на русском" : "Текст на казахском"}
              rows={5}
              value={edit[lang]}
              onChange={(e) => setEdit({ ...edit, [lang]: e.target.value })}
              maxLength={1000}
            />
          ) : (
            <p className="whitespace-pre-line rounded-xl bg-surface-2 px-3 py-2 text-sm text-fg-2">{x[lang] || "Текста на этом языке нет."}</p>
          )}
          {x.need && !x.approved && <p className="mt-1 text-sm text-fg-3">Перед одобрением впишите: {x.need}.</p>}
          {pv && (
            <div className="mt-2" aria-live="polite">
              <p className="text-xs text-fg-3">{pv.demo ? "Так увидит клиент (пример на вымышленном клиенте):" : "Так увидят клиенты сегмента:"}</p>
              {pv.list.map((r, i) => (
                <p key={i} className="mt-1 whitespace-pre-line rounded-xl border border-line px-3 py-2 text-sm">
                  <span className="tnum block text-xs text-fg-3">{r.to}</span>
                  {r.text}
                </p>
              ))}
            </div>
          )}
          {err && (
            <p role="alert" className="mt-1 text-sm text-critical">
              {err}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {!edit && (
              <Button size="sm" variant="ghost" onClick={() => void preview()}>
                Пример
              </Button>
            )}
            {canEdit && !edit && (
              <Button size="sm" variant="ghost" onClick={() => setEdit({ ru: x.ru, kk: x.kk })}>
                Изменить
              </Button>
            )}
            {canEdit && edit && (
              <>
                <Button size="sm" variant="primary" busy={busy} disabled={busy} onClick={() => void save(false, edit)}>
                  Сохранить
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEdit(null)}>
                  Отмена
                </Button>
              </>
            )}
            {canEdit && !edit && (
              <Button size="sm" variant={x.approved ? "secondary" : "primary"} busy={busy} disabled={busy || (!x.approved && brackets)} onClick={() => void save(!x.approved, null)}>
                {x.approved ? "Снять одобрение" : "Одобрить текст"}
              </Button>
            )}
          </div>
          {x.v && x.at ? <p className="mt-1.5 text-xs text-fg-3">Версия {x.v}{x.by ? `, правил: ${x.by}` : ""}</p> : null}
        </div>
      )}
    </li>
  );
}
