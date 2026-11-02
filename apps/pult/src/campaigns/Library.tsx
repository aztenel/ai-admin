// «Шаблоны» — библиотека текстов рассылок второго номера (финальное ТЗ рассылок Winchester, 02.11.2026): 28 текстов, которые
// утвердил владелец, в 7 категориях, только русский, без вставок — имя клиента в приветствие ставит сервер. Поиск по названию и тексту,
// категории — чипами и группами. По нажатию — лист: пузырь WhatsApp на настоящем имени клиента из базы и тот же текст без имени;
// «Использовать» — сразу мастер рассылки с этим текстом; владельцу — «Изменить» (сохраняется своей новой версией, одобрение снимается),
// «Копировать» (копия — свой текст), «Одобрить», архив своих текстов, «Новый текст». У нетронутых стартовых — «Утверждённая редакция».
// Казахская вкладка — только если у текста есть казахский вариант (у стартовых его нет). Переменных вида {{…}} пульт не показывает.
// Сотрудник смотрит и «Использует» одобренные тексты; править и одобрять — только владелец (так решает сервер).
import { BookOpenText, Copy, Pencil, Plus, Search, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Sheet, toast } from "@/components/overlay";
import { Button, Skeleton } from "@/components/ui";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LibraryCat, LibraryItem, TemplateLibrary, TemplatePreview } from "@/model/campaigns";
import { Group } from "@/screens/Page";
import { store } from "@/state/store";
import { nf, Notice } from "./base/shared";
import { errorList } from "./common";
import { byCategory, EDITION, LIB_STATUS, libStatus, matches, snippet, usable } from "./libtext";
import { useLoad } from "./useLoad";
import { DEFAULT_VARS, hasBlanks, toCanon, toHuman } from "./vars";
import { WaBubble } from "./WaBubble";

const TEXTS: [string, string, string] = ["текст", "текста", "текстов"];
type Show = string; // "" — все, id категории, "own" — свои, "archive" — архив

export default function Library({ ws, owner, onUse }: { ws: string; owner: boolean; onUse?: (x: LibraryItem) => void }) {
  const lib = useLoad((src) => src.templates(ws), [ws]);
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("");
  const [open, setOpen] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const d = lib.data;
  const cats = useMemo(() => d?.cats || [], [d]);
  const items = useMemo(() => (d ? d.items : []), [d]);
  const live = items.filter((x) => !x.archived);
  const list = useMemo(() => {
    const base = show === "archive" ? items.filter((x) => x.archived) : show === "own" ? live.filter((x) => x.custom) : live.filter((x) => !show || q.trim() || x.cat === show);
    return base.filter((x) => matches(x, q, cats));
  }, [items, live, show, q, cats]);

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
  const approved = live.filter((x) => x.approved).length;
  const canEdit = owner && d.owner;
  const shownCats = cats.filter((c) => live.some((x) => x.cat === c.id));
  const cur = open ? d.items.find((x) => x.id === open) || null : null;
  const update = (it: LibraryItem) => lib.set((v) => ({ ...(v || d), items: (v || d).items.some((i) => i.id === it.id) ? (v || d).items.map((i) => (i.id === it.id ? { ...i, ...it } : i)) : [...(v || d).items, it] }));
  const groups = byCategory(list, cats);

  return (
    <>
      <div className="mb-3 flex items-center gap-2 px-1">
        <p className="flex min-w-0 flex-1 items-center gap-2 text-ui text-fg-2 pointer-coarse:text-base">
          <BookOpenText aria-hidden className="size-5 shrink-0 text-brand-gold" strokeWidth={1.75} />
          <span>
            {/* числа не отрываются от слов при переносе на телефоне */}
            <span className="whitespace-nowrap">
              <b className="tnum font-semibold text-fg">{nf.format(live.length)}</b> {plural(live.length, TEXTS)}
            </span>{" "}
            · <span className="whitespace-nowrap">одобрено <b className="tnum font-semibold text-fg">{nf.format(approved)}</b></span>
            {live.length - approved > 0 && (
              <>
                {" "}
                · <span className="whitespace-nowrap">ждут одобрения <b className="tnum font-semibold text-fg">{nf.format(live.length - approved)}</b></span>
              </>
            )}
          </span>
        </p>
        {canEdit && (
          <Button size="sm" variant="tinted" icon={Plus} onClick={() => setCreate(true)}>
            Новый текст
          </Button>
        )}
      </div>
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
      {(shownCats.length > 1 || live.some((x) => x.custom) || items.some((x) => x.archived)) && (
        <div role="radiogroup" aria-label="Категория" className="no-scrollbar -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <Chip on={!show} onClick={() => setShow("")}>
            Все
          </Chip>
          {shownCats.map((c) => (
            <Chip key={c.id} on={show === c.id} onClick={() => setShow(show === c.id ? "" : c.id)}>
              {c.label}
            </Chip>
          ))}
          {live.some((x) => x.custom) && (
            <Chip on={show === "own"} onClick={() => setShow(show === "own" ? "" : "own")}>
              Свои
            </Chip>
          )}
          {items.some((x) => x.archived) && (
            <Chip on={show === "archive"} onClick={() => setShow(show === "archive" ? "" : "archive")}>
              Архив
            </Chip>
          )}
        </div>
      )}
      {!items.length ? (
        <Group>
          <p className="py-5 text-ui text-fg-2 pointer-coarse:text-base">Текстов пока нет.{canEdit ? " Нажмите «Новый текст», чтобы написать свой." : " Их добавляет владелец."}</p>
        </Group>
      ) : list.length ? (
        <div aria-label="Шаблоны">
          {groups.map((g) => (
            <Group key={g.cat.id || "own"} title={g.cat.who ? `${g.cat.label} · ${g.cat.who}` : g.cat.label}>
              <ul aria-label={g.cat.label} className="divide-y divide-line">
                {g.items.map((x) => (
                  <li key={x.id}>
                    <ItemRow x={x} onOpen={() => setOpen(x.id)} />
                  </li>
                ))}
              </ul>
            </Group>
          ))}
        </div>
      ) : (
        <Group>
          <p className="py-6 text-center text-ui text-fg-2">Ничего не нашли. Измените поиск или выберите «Все».</p>
        </Group>
      )}
      <TemplateSheet
        ws={ws}
        lib={d}
        item={cur}
        canEdit={canEdit}
        onClose={() => setOpen(null)}
        onSaved={update}
        onOpen={(id) => setOpen(id)}
        onUse={onUse}
      />
      {canEdit && (
        <NewText
          ws={ws}
          cats={cats}
          open={create}
          onClose={() => setCreate(false)}
          onSaved={(it) => {
            update(it);
            setCreate(false);
            setOpen(it.id);
          }}
        />
      )}
    </>
  );
}

function ItemRow({ x, onOpen }: { x: LibraryItem; onOpen: () => void }) {
  const st = LIB_STATUS[libStatus(x)];
  return (
    <button type="button" onClick={onOpen} aria-label={x.title} className="flex w-full items-start gap-3 py-3 text-left">
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-[0.9375rem] font-semibold md:text-base">{x.title}</span>
          <span className={cn("mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs font-medium", st.cls)}>{st.label}</span>
        </span>
        <span className="mt-0.5 line-clamp-2 text-sm text-fg-2">{snippet(x.ru)}</span>
      </span>
    </button>
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

/** Лист текста: как увидит клиент (пузырь WhatsApp с настоящим именем и вариант без имени) или правка; действия. */
function TemplateSheet({
  ws,
  lib,
  item,
  canEdit,
  onClose,
  onSaved,
  onOpen,
  onUse,
}: {
  ws: string;
  lib: TemplateLibrary;
  item: LibraryItem | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (it: LibraryItem) => void;
  onOpen: (id: string) => void;
  onUse?: (x: LibraryItem) => void;
}) {
  const [edit, setEdit] = useState<{ title: string; ru: string; kk: string } | null>(null);
  const [lang, setLang] = useState<"ru" | "kk">("ru");
  const [pv, setPv] = useState<{ key: string; data?: TemplatePreview; error?: string } | null>(null);
  const [busy, setBusy] = useState("");
  const vars = lib.vars?.length ? lib.vars : DEFAULT_VARS;
  const hasKk = !!item?.kk?.trim();
  const key = item ? `${item.id}:${item.v || 0}:${lang}` : "";
  // пример — при открытии, смене языка и после сохранения (новая версия): на клиенте из базы, имя — в приветствии
  useEffect(() => {
    if (!item || edit || !store.source) return;
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
  }, [key, !!edit, ws]);
  const close = () => {
    setEdit(null);
    setPv(null);
    setLang("ru");
    onClose();
  };
  if (!item) return null;
  const st = libStatus(item);
  const cat = (lib.cats || []).find((c) => c.id === item.cat);
  const src = store.source;

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
  const approve = (on: boolean) => src && run(on ? "approve" : "unapprove", () => src.templateSave(ws, { id: item.id, title: item.title, ru: item.ru, kk: item.kk, approved: on }), on ? "Текст одобрен" : "Одобрение снято");
  const saveEdit = async () => {
    if (!src || !edit) return;
    const it = await run("save", () => src.templateSave(ws, { id: item.id, title: edit.title.trim() || item.title, ru: toCanon(edit.ru, vars), kk: toCanon(edit.kk, vars) }), "Сохранено: это новая версия текста. Одобрите её, чтобы использовать в рассылке.");
    if (it) setEdit(null);
  };
  const duplicate = async () => {
    if (!src) return;
    const it = await run("dup", () => src.templateAction(ws, item.id, "duplicate"), "Копия сохранена — это ваш текст, его можно изменить");
    if (it) {
      setPv(null);
      onOpen(it.id);
    }
  };
  const ready = usable(item);
  const ex = pv?.key === key ? pv.data?.list[0] : undefined;

  return (
    <Sheet
      open
      onOpenChange={(v) => !v && close()}
      title={item.title}
      description={[cat?.label, cat?.who || item.who].filter(Boolean).join(" · ") || undefined}
      footer={
        edit ? (
          <div className="flex gap-2 pb-1">
            <Button className="flex-1" disabled={!!busy} onClick={() => setEdit(null)}>
              Отмена
            </Button>
            <Button variant="primary" className="flex-1" busy={busy === "save"} disabled={!!busy || !edit.ru.trim()} onClick={() => void saveEdit()}>
              Сохранить
            </Button>
          </div>
        ) : onUse ? (
          <div className="pb-1">
            <Button variant="primary" size="lg" icon={Send} className="w-full" disabled={!ready} onClick={() => (close(), onUse(item))}>
              Использовать
            </Button>
            {!ready && <p className="mt-1.5 text-center text-sm text-fg-3">{item.archived ? "Текст в архиве." : "Использовать можно одобренный текст."}</p>}
          </div>
        ) : undefined
      }
    >
      <div className="space-y-3 px-4 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex h-6 items-center rounded-full px-2 text-xs font-medium", LIB_STATUS[st].cls)}>{LIB_STATUS[st].label}</span>
          {/* казахская вкладка — только если казахский текст есть (у утверждённых стартовых его нет) */}
          {hasKk && !edit && (
            <div role="radiogroup" aria-label="Язык" className="inline-flex rounded-lg bg-surface-2 p-0.5 text-sm">
              {(["ru", "kk"] as const).map((l) => (
                <button key={l} type="button" role="radio" aria-checked={lang === l} onClick={() => setLang(l)} className={cn("rounded-md px-3 py-1 pointer-coarse:py-1.5", lang === l ? "bg-surface font-medium text-fg shadow-sm" : "text-fg-2")}>
                  {l === "ru" ? "Русский" : "Қазақша"}
                </button>
              ))}
            </div>
          )}
        </div>
        {lang === "kk" && hasKk && !item.kkChecked && !edit && <p className="text-sm text-fg-3">Казахский текст ещё не проверил носитель языка.</p>}
        {/* действия владельца — сверху, над примером: на телефоне пример длинный, кнопки под ним не видно */}
        {canEdit && !edit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" icon={Pencil} onClick={() => setEdit({ title: item.title, ru: toHuman(item.ru, vars), kk: toHuman(item.kk, vars) })}>
              Изменить
            </Button>
            <Button size="sm" variant="outline" icon={Copy} busy={busy === "dup"} disabled={!!busy} onClick={() => void duplicate()}>
              Копировать
            </Button>
            {!item.archived && (
              <Button size="sm" variant={item.approved ? "ghost" : "tinted"} busy={busy === "approve" || busy === "unapprove"} disabled={!!busy || (!item.approved && hasBlanks(item.ru))} onClick={() => void approve(!item.approved)}>
                {item.approved ? "Снять одобрение" : "Одобрить"}
              </Button>
            )}
            {item.custom && (
              <Button size="sm" variant="ghost" busy={busy === "arch"} disabled={!!busy} onClick={() => src && void run("arch", () => src.templateAction(ws, item.id, item.archived ? "restore" : "archive"), item.archived ? "Текст возвращён" : "Текст в архиве").then(close)}>
                {item.archived ? "Вернуть из архива" : "В архив"}
              </Button>
            )}
          </div>
        )}

        {edit ? (
          <>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-fg-2">Название для себя</span>
              <input
                aria-label="Название"
                value={edit.title}
                maxLength={80}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-md outline-none focus:border-accent dark:bg-surface-2"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-fg-2">Текст</span>
              <textarea
                aria-label="Текст на русском"
                rows={9}
                maxLength={1000}
                value={edit.ru}
                onChange={(e) => setEdit({ ...edit, ru: e.target.value })}
                className="block w-full resize-y rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-md leading-[1.375rem] outline-none focus:border-accent dark:bg-surface-2"
              />
            </label>
            {hasKk && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-fg-2">Текст на казахском</span>
                <textarea
                  aria-label="Текст на казахском"
                  rows={5}
                  maxLength={1000}
                  value={edit.kk}
                  onChange={(e) => setEdit({ ...edit, kk: e.target.value })}
                  className="block w-full resize-y rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-md leading-[1.375rem] outline-none focus:border-accent dark:bg-surface-2"
                />
              </label>
            )}
            <p className="text-sm text-fg-3">
              Имя клиента система добавит сама в приветствие: «Добрый день!» → «Добрый день, Азамат!». Сохранится новой версией — одобрите её, чтобы использовать в рассылке.
              {item.approved && !item.custom ? " Утверждённая редакция останется в истории версий." : ""}
            </p>
            {hasBlanks(edit.ru) && <Notice>В тексте есть [скобки]: впишите настоящие данные, иначе текст не одобрить.</Notice>}
          </>
        ) : pv?.key === key && pv.data ? (
          <>
            {ex && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-fg-2">
                  {pv.data.demo ? "Так увидит клиент (пример на вымышленном клиенте)" : `Так увидит ${ex.name || "клиент"}`}
                  {!pv.data.demo && ex.to && ex.to !== "пример" ? <span className="tnum font-normal text-fg-3"> · {ex.to}</span> : null}
                </p>
                <WaBubble text={ex.text} />
              </div>
            )}
            {pv.data.noName?.text && pv.data.noName.text !== ex?.text && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-fg-2">Тот же текст, если имени нет</p>
                <WaBubble text={pv.data.noName.text} />
              </div>
            )}
            {ex?.allowed === false && <p className="text-xs text-fg-3">Пример на клиенте, которому реклама сейчас не уйдёт: {ex.why || "нет согласия на рекламу"}.</p>}
            {(pv.data.blocked || hasBlanks(item.ru)) && <Notice>Перед отправкой впишите настоящие условия вместо [скобок]{pv.data.missing?.length ? ` и данные: ${pv.data.missing.join(", ")}` : ""}.</Notice>}
          </>
        ) : pv?.key === key && pv.error ? (
          <Notice tone="critical">{pv.error}</Notice>
        ) : (
          <Skeleton className="h-40 w-full rounded-2xl" />
        )}

        {item.check && !edit && (
          <div className="rounded-xl bg-surface-2 px-3 py-2.5">
            <p className="text-xs font-medium text-fg-3">Что проверить перед отправкой</p>
            <p className="text-sm text-fg">{item.check}</p>
          </div>
        )}
        {!edit && (
          <p className="text-xs text-fg-3">
            {st === "edition"
              ? `${EDITION}: текст утвердил владелец.`
              : [item.v && item.v > 1 ? `Версия ${item.v}` : "", item.by ? `правил: ${item.by}` : "", item.approved && item.approvedBy ? `одобрил: ${item.approvedBy}` : ""].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/** Свой новый текст (только владелец): название, категория, текст. Сохраняется неодобренным — одобрить можно сразу в его листе. */
function NewText({ ws, cats, open, onClose, onSaved }: { ws: string; cats: LibraryCat[]; open: boolean; onClose: () => void; onSaved: (it: LibraryItem) => void }) {
  const [title, setTitle] = useState("");
  const [cat, setCat] = useState("");
  const [ru, setRu] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const src = store.source;
    if (!src) return;
    setBusy(true);
    try {
      const it = await src.templateSave(ws, { title: title.trim(), cat: cat || cats[0]?.id, ru: ru.trim() });
      toast("Текст сохранён. Одобрите его, чтобы использовать в рассылке.");
      setTitle("");
      setRu("");
      onSaved(it);
    } catch (e) {
      toast(errorList(e)[0] || "Не получилось сохранить", "critical");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Новый текст"
      description="Свой текст для рассылок со второго номера."
      footer={
        <div className="flex gap-2 pb-1">
          <Button className="flex-1" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" className="flex-1" busy={busy} disabled={busy || title.trim().length < 2 || !ru.trim()} onClick={() => void save()}>
            Сохранить
          </Button>
        </div>
      }
    >
      <div className="space-y-3 px-4 pb-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-fg-2">Название для себя</span>
          <input aria-label="Название" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-md outline-none focus:border-accent dark:bg-surface-2" />
        </label>
        {cats.length > 0 && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-fg-2">Категория</span>
            <select aria-label="Категория" value={cat || cats[0].id} onChange={(e) => setCat(e.target.value)} className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-md dark:bg-surface-2">
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-fg-2">Текст</span>
          <textarea
            aria-label="Текст на русском"
            rows={8}
            maxLength={1000}
            value={ru}
            onChange={(e) => setRu(e.target.value)}
            placeholder="Добрый день! 👋🏻 …"
            className="block w-full resize-y rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-md leading-[1.375rem] outline-none focus:border-accent dark:bg-surface-2"
          />
        </label>
        <p className="text-sm text-fg-3">Имя клиента система добавит сама в приветствие: «Добрый день!» → «Добрый день, Азамат!». Если имени нет — приветствие без имени.</p>
      </div>
    </Sheet>
  );
}
