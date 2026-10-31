// «Шаблоны» во вкладке «Маркетинг» (ТЗ v3.0 §4.2, 31.10.2026). Все тексты библиотеки видны всегда: 28 стартовых тем и свои.
// Наверху — сколько всего, сколько одобрено и сколько на проверке. Поиск, фильтр (Все / Готовы / На проверке) и категории.
// По нажатию — лист: как сообщение увидит клиент (пузырь WhatsApp с подставленным именем и вариант без имени) или редактор.
// В редакторе переменные — словами в фигурных скобках ({Имя клиента}), вставка — кнопками; сервер хранит канонические имена.
// Одобрение — решение владельца о тексте, а не отправка. Казахский текст помечен, пока его не проверил носитель языка.
// Сотрудник смотрит и может «Использовать» одобренный текст в рассылке; править и одобрять — только владелец.
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, Copy, Search, Send, X } from "lucide-react";
import { Sheet, toast } from "@/components/overlay";
import { Button, Skeleton } from "@/components/ui";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LibraryItem, TemplateLibrary, TemplatePreview } from "@/model/campaigns";
import { Group } from "@/screens/Page";
import { store } from "@/state/store";
import { nf, Notice } from "./base/shared";
import { errorList } from "./common";
import { useLoad } from "./useLoad";
import { DEFAULT_VARS, hasBlanks, toCanon, toHuman } from "./vars";
import { WaBubble } from "./WaBubble";

type Show = "all" | "ready" | "review";
const STATUS: Record<NonNullable<LibraryItem["status"]>, { label: string; cls: string }> = {
  approved: { label: "Одобрен", cls: "bg-positive-soft text-positive" },
  review: { label: "На проверке", cls: "bg-surface-2 text-fg-2" },
  facts: { label: "Нужны данные", cls: "bg-accent-soft text-accent-ink" },
};
const statusOf = (x: LibraryItem): NonNullable<LibraryItem["status"]> => x.status || (x.approved ? "approved" : hasBlanks(x.ru) ? "facts" : "review");

export default function Library({ ws, owner, onUse }: { ws: string; owner: boolean; onUse?: (x: LibraryItem) => void }) {
  const lib = useLoad((src) => src.templates(ws), [ws]);
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [cat, setCat] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const d = lib.data;
  const items = useMemo(() => (d ? d.items.filter((x) => !x.archived) : []), [d]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter(
      (x) =>
        (!cat || x.cat === cat) &&
        (show === "all" || (show === "ready" ? statusOf(x) === "approved" : statusOf(x) !== "approved")) &&
        (!s || `${x.title} ${x.who || ""} ${x.goal} ${x.ru}`.toLowerCase().includes(s)),
    );
  }, [items, q, show, cat]);

  if (lib.loading)
    return (
      <div aria-hidden className="space-y-3 py-2">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  if (!d)
    return (
      <Notice tone="critical" role="alert">
        Шаблоны не загрузились: {lib.error}
      </Notice>
    );
  const approved = items.filter((x) => statusOf(x) === "approved").length;
  const cats = (d.cats || []).filter((c) => items.some((x) => x.cat === c.id));
  const cur = open ? d.items.find((x) => x.id === open) || null : null;
  const canEdit = owner && d.owner;
  const update = (it: LibraryItem) => lib.set((v) => ({ ...(v || d), items: (v || d).items.some((i) => i.id === it.id) ? (v || d).items.map((i) => (i.id === it.id ? { ...i, ...it } : i)) : [it, ...(v || d).items] }));

  return (
    <>
      <p className="mb-3 flex items-center gap-2 px-1 text-ui text-fg-2 pointer-coarse:text-base">
        <BookOpenText aria-hidden className="size-5 shrink-0 text-brand-gold" strokeWidth={1.75} />
        <span>
          <b className="tnum font-semibold text-fg">{nf.format(items.length)}</b> {plural(items.length, ["шаблон", "шаблона", "шаблонов"])} · одобрено{" "}
          <b className="tnum font-semibold text-fg">{nf.format(approved)}</b> · на проверке <b className="tnum font-semibold text-fg">{nf.format(items.length - approved)}</b>
        </span>
      </p>
      <label className="relative mb-3 block">
        <span className="sr-only">Поиск по шаблонам</span>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" strokeWidth={2} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Название или текст"
          className="h-11 w-full rounded-[0.625rem] bg-surface pl-9 pr-9 text-md text-fg outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-ring md:h-10 md:text-base"
        />
        {q && (
          <button type="button" aria-label="Очистить поиск" onClick={() => setQ("")} className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center text-fg-3 hover:text-fg">
            <X aria-hidden className="size-4" strokeWidth={2} />
          </button>
        )}
      </label>
      <div role="radiogroup" aria-label="Какие шаблоны показать" className="no-scrollbar -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {(
          [
            ["all", "Все"],
            ["ready", "Готовы"],
            ["review", "На проверке"],
          ] as [Show, string][]
        ).map(([id, label]) => (
          <Chip key={id} on={show === id} onClick={() => setShow(id)}>
            {label}
          </Chip>
        ))}
        <span aria-hidden className="mx-1 w-px shrink-0 bg-line" />
        {cats.map((c) => (
          <Chip key={c.id} on={cat === c.id} onClick={() => setCat(cat === c.id ? "" : c.id)}>
            {c.label}
          </Chip>
        ))}
      </div>
      <Group>
        {list.length ? (
          <ul aria-label="Шаблоны" className="divide-y divide-line">
            {list.map((x) => {
              const st = STATUS[statusOf(x)];
              return (
                <li key={x.id}>
                  <button type="button" onClick={() => setOpen(x.id)} className="flex w-full items-start gap-3 py-3 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.9375rem] font-semibold md:text-base">{x.title}</span>
                      <span className="block truncate text-sm text-fg-2">{x.who || x.goal}</span>
                    </span>
                    <span className={cn("mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs font-medium", st.cls)}>{st.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-6 text-center text-ui text-fg-2">Ничего не нашли. Измените поиск или фильтр.</p>
        )}
      </Group>
      <TemplateSheet ws={ws} lib={d} item={cur} canEdit={canEdit} onClose={() => setOpen(null)} onSaved={update} onUse={onUse} />
    </>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-ui font-medium transition-colors pointer-coarse:h-10",
        on ? "bg-selected text-selected-fg" : "bg-surface text-fg-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/** Лист шаблона: «Пример клиента» (как увидит клиент) или «Редактор»; RU / KZ; что проверить; действия. */
function TemplateSheet({ ws, lib, item, canEdit, onClose, onSaved, onUse }: { ws: string; lib: TemplateLibrary; item: LibraryItem | null; canEdit: boolean; onClose: () => void; onSaved: (it: LibraryItem) => void; onUse?: (x: LibraryItem) => void }) {
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [lang, setLang] = useState<"ru" | "kk">("ru");
  const [draft, setDraft] = useState<{ ru: string; kk: string } | null>(null);
  const [pv, setPv] = useState<{ key: string; data?: TemplatePreview; error?: string } | null>(null);
  const [busy, setBusy] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);
  const vars = lib.vars?.length ? lib.vars : DEFAULT_VARS;
  const key = item ? `${item.id}:${item.v || 0}:${lang}` : "";
  // пример грузится при открытии, смене языка и после сохранения (новая версия)
  useEffect(() => {
    if (!item || mode !== "preview" || !store.source) return;
    let live = true;
    setPv({ key });
    store.source.templatePreview(ws, { id: item.id, lang }).then(
      (data) => live && setPv({ key, data }),
      (e: unknown) => live && setPv({ key, error: errorList(e)[0] || "Пример не загрузился" }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mode, ws]);
  const close = () => {
    setMode("preview");
    setDraft(null);
    setPv(null);
    setLang("ru");
    onClose();
  };
  if (!item) return null;
  const st = statusOf(item);
  const blanks = hasBlanks(item.ru) || hasBlanks(item.kk);

  const run = async (name: string, f: () => Promise<LibraryItem>, done: string) => {
    setBusy(name);
    try {
      const it = await f();
      onSaved(it);
      toast(done);
      return it;
    } catch (e) {
      toast(errorList(e)[0] || "Не получилось", "critical");
      return null;
    } finally {
      setBusy("");
    }
  };
  const src = store.source;
  const save = (approved: boolean, text?: { ru: string; kk: string }) =>
    src && run(approved ? "approve" : "save", () => src.templateSave(ws, { id: item.id, title: item.title, goal: item.goal, ru: toCanon((text || item).ru, vars), kk: toCanon((text || item).kk, vars), approved }), approved ? "Шаблон одобрен" : text ? "Изменения сохранены" : "Одобрение снято");
  const insert = (label: string) => {
    if (!draft) return;
    const el = ta.current, tok = `{${label}}`, cur = draft[lang];
    const a = el ? el.selectionStart : cur.length, b = el ? el.selectionEnd : cur.length;
    const next = cur.slice(0, a) + tok + cur.slice(b);
    setDraft({ ...draft, [lang]: next });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(a + tok.length, a + tok.length);
    });
  };

  return (
    <Sheet
      open
      onOpenChange={(v) => !v && close()}
      title={item.title}
      description={item.who || item.goal}
      footer={
        mode === "edit" && draft ? (
          <div className="flex gap-2 pb-1">
            <Button className="flex-1" disabled={!!busy} onClick={() => (setMode("preview"), setDraft(null))}>
              Отмена
            </Button>
            <Button variant="primary" className="flex-1" busy={busy === "save"} disabled={!!busy || !draft.ru.trim()} onClick={() => void save(false, draft)?.then((it) => it && (setMode("preview"), setDraft(null)))}>
              Сохранить
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 pb-1">
            {onUse && (
              <Button variant={st === "approved" ? "primary" : "secondary"} icon={Send} className="min-w-[9rem] flex-1" disabled={st !== "approved"} onClick={() => (close(), onUse(item))}>
                Использовать
              </Button>
            )}
            {canEdit && (
              <Button variant={st === "approved" ? "secondary" : "primary"} className="min-w-[9rem] flex-1" busy={busy === "approve"} disabled={!!busy || (!item.approved && blanks)} onClick={() => void save(!item.approved)}>
                {item.approved ? "Снять одобрение" : "Одобрить"}
              </Button>
            )}
          </div>
        )
      }
    >
      <div className="space-y-3 px-4 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Вид" className="inline-flex rounded-lg bg-surface-2 p-0.5 text-sm">
            {(
              [
                ["preview", "Пример клиента"],
                ["edit", "Редактор"],
              ] as const
            ).map(([m, label]) =>
              m === "edit" && !canEdit ? null : (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => {
                    setMode(m);
                    if (m === "edit" && !draft) setDraft({ ru: toHuman(item.ru, vars), kk: toHuman(item.kk, vars) });
                  }}
                  className={cn("rounded-md px-3 py-1 pointer-coarse:py-1.5", mode === m ? "bg-surface font-medium text-fg shadow-sm" : "text-fg-2")}
                >
                  {label}
                </button>
              ),
            )}
          </div>
          <div role="radiogroup" aria-label="Язык" className="inline-flex rounded-lg bg-surface-2 p-0.5 text-sm">
            {(["ru", "kk"] as const).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={lang === l} onClick={() => setLang(l)} className={cn("rounded-md px-3 py-1 pointer-coarse:py-1.5", lang === l ? "bg-surface font-medium text-fg shadow-sm" : "text-fg-2")}>
                {l === "ru" ? "Русский" : "Қазақша"}
              </button>
            ))}
          </div>
        </div>
        {lang === "kk" && !item.kkChecked && <p className="text-sm text-fg-3">Казахский текст ещё не проверил носитель языка.</p>}

        {mode === "preview" ? (
          pv?.data ? (
            <>
              <WaBubble text={pv.data.list[0]?.text || ""} to={pv.data.list[0]?.to && pv.data.list[0].to !== "пример" ? pv.data.list[0].to : undefined} />
              {pv.data.noName?.text && pv.data.noName.text !== pv.data.list[0]?.text && (
                <div>
                  <p className="mb-1 text-xs text-fg-3">Если имени клиента нет:</p>
                  <WaBubble text={pv.data.noName.text} />
                </div>
              )}
              {pv.data.demo && <p className="text-xs text-fg-3">Пример на вымышленном клиенте.</p>}
              {(pv.data.blocked || blanks) && <Notice>Перед отправкой впишите настоящие условия вместо [скобок]{pv.data.missing?.length ? ` и данные: ${pv.data.missing.join(", ")}` : ""}.</Notice>}
            </>
          ) : pv?.error ? (
            <Notice tone="critical">{pv.error}</Notice>
          ) : (
            <Skeleton className="h-32 w-full rounded-2xl" />
          )
        ) : draft ? (
          <>
            <textarea
              ref={ta}
              aria-label={lang === "ru" ? "Текст на русском" : "Текст на казахском"}
              rows={6}
              maxLength={1000}
              value={draft[lang]}
              onChange={(e) => setDraft({ ...draft, [lang]: e.target.value })}
              className="block w-full resize-y rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-md leading-[1.375rem] outline-none focus:border-accent"
            />
            <div className="flex flex-wrap gap-1.5" aria-label="Вставить в текст">
              {vars.map((v) => (
                <button key={v.key} type="button" onClick={() => insert(v.label)} className="inline-flex h-8 items-center gap-1 rounded-full bg-accent-soft px-3 text-sm font-medium text-accent-ink hover:brightness-95">
                  <Copy aria-hidden className="size-3.5" /> {v.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-fg-3">Если имени клиента нет, приветствие получится без имени. Квадратные скобки, например [дата], впишите перед одобрением.</p>
          </>
        ) : null}

        {item.check && (
          <div className="rounded-xl bg-surface-2 px-3 py-2.5">
            <p className="text-xs font-medium text-fg-3">Что проверить перед отправкой</p>
            <p className="text-sm text-fg">{item.check}</p>
          </div>
        )}
        {canEdit && mode === "preview" && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => (setMode("edit"), setDraft({ ru: toHuman(item.ru, vars), kk: toHuman(item.kk, vars) }))}>
              Изменить
            </Button>
            <Button size="sm" variant="ghost" busy={busy === "dup"} disabled={!!busy} onClick={() => src && void run("dup", () => src.templateAction(ws, item.id, "duplicate"), "Копия создана")}>
              Дублировать
            </Button>
            {item.custom && (
              <Button size="sm" variant="ghost" busy={busy === "arch"} disabled={!!busy} onClick={() => src && void run("arch", () => src.templateAction(ws, item.id, item.archived ? "restore" : "archive"), item.archived ? "Шаблон возвращён" : "Шаблон в архиве").then(close)}>
                {item.archived ? "Вернуть из архива" : "В архив"}
              </Button>
            )}
          </div>
        )}
        {item.v && item.at ? <p className="text-xs text-fg-3">Версия {item.v}{item.by ? `, правил: ${item.by}` : ""}</p> : null}
      </div>
    </Sheet>
  );
}
