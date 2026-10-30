// Импорт клиентов из файла (CSV, Excel .xlsx, текст) или вставленного текста: сначала предпросмотр — сколько новых, у кого обновится
// имя, сколько без изменений, дублей в самом файле и неверных номеров, строки с причинами (номера маской), — потом «Загрузить N».
// До подтверждения в базе ничего не меняется; «Отменить» удаляет предпросмотр на сервере. Импорт не снимает запреты. Согласия из файла
// ставятся, только если указано основание (где клиенты соглашались) — без него колонка согласия не используется. Даже с основанием
// «да» из файла записывается как НЕ подтверждённое: реклама таким клиентам не уйдёт, пока согласие не подтвердят в карточке; клиентам,
// которые сами отказывались, «да» из файла не ставится вовсе (31.10.2026, правило владельца).
import { CircleAlert, CircleCheck, FileUp, ListChecks } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Notice } from "@/campaigns/base/shared";
import { TextArea, TextField } from "@/campaigns/wizard/fields";
import { Button, InsetGroup } from "@/components/ui";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ImportAction, ImportDone, ImportPreview } from "@/model/contacts";
import { store } from "@/state/store";
import { ACTION_LABEL, errMsg } from "./common";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ".csv,.xlsx,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ORDER: ImportAction[] = ["new", "update", "same", "dup", "invalid"];
const TONE: Record<ImportAction, string> = { new: "text-positive", update: "text-accent-ink", same: "text-fg-2", dup: "text-fg-2", invalid: "text-critical" };
const ROWS: [string, string, string] = ["строка", "строки", "строк"];

export function ImportFlow({ ws, onDone, onClose }: { ws: string; onDone: () => void; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [pv, setPv] = useState<ImportPreview | null>(null);
  const [basis, setBasis] = useState("");
  const [done, setDone] = useState<ImportDone | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const check = async () => {
    setErr("");
    if (!file && !text.trim()) return setErr("Выберите файл или вставьте список.");
    if (file && file.size > MAX_BYTES) return setErr("Файл больше 5 МБ — разделите его на части.");
    setBusy("check");
    try {
      setPv(await store.source!.importPreview(ws, file ? { file } : { text }));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy("");
    }
  };
  const confirm = async () => {
    if (!pv) return;
    setErr("");
    setBusy("confirm");
    try {
      const r = await store.source!.importConfirm(ws, pv.id, pv.hasConsent && basis.trim() ? basis.trim() : undefined);
      setDone(r);
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy("");
    }
  };
  const discard = async () => {
    if (pv) {
      setBusy("discard");
      try {
        await store.source!.importDiscard(ws, pv.id);
      } catch {
        // предпросмотр сервер удалит сам; закрываем в любом случае
      } finally {
        setBusy("");
      }
    }
    onClose();
  };

  if (done)
    return (
      <div className="scroll-area min-h-0 flex-1 px-4 pt-4 md:px-6 md:pt-6">
        <div className="mb-6 flex gap-2.5 rounded-[0.875rem] bg-positive-soft px-4 py-3 text-ui text-positive pointer-coarse:text-base" role="status">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
          <span>
            Загружено. Новых клиентов: <b className="tnum">{done.created}</b>, обновлено имён: <b className="tnum">{done.updated}</b>
            {done.consents ? (
              <>
                , согласий и отказов записано: <b className="tnum">{done.consents}</b>
              </>
            ) : null}
            .
          </span>
        </div>
        {(done.consentsUnconfirmed > 0 || done.consentsSkipped > 0) && (
          <ul aria-label="Согласия из файла" className="mb-6 space-y-2 px-1 text-ui text-fg-2 pointer-coarse:text-base">
            {done.consentsUnconfirmed > 0 && (
              <li>
                Согласий «да» из файла: <b className="tnum text-fg">{done.consentsUnconfirmed}</b> — не подтверждены. Реклама им не уйдёт, пока не подтвердите согласие в карточке клиента.
              </li>
            )}
            {done.consentsSkipped > 0 && (
              <li>
                Пропущено: <b className="tnum text-fg">{done.consentsSkipped}</b> — клиент сам отказывался от рассылок, «да» из файла этого не отменяет.
              </li>
            )}
          </ul>
        )}
        <Button variant="primary" size="lg" className="w-full md:w-auto" onClick={onClose}>
          Готово
        </Button>
      </div>
    );

  if (!pv)
    return (
      <>
        <div className="scroll-area min-h-0 flex-1">
          <div className="px-4 pb-6 pt-2 md:px-6 md:pt-5">
            <p className="mb-5 px-4 text-ui text-fg-2 pointer-coarse:text-base">
              Нужна колонка с номером телефона; имя и согласие — по желанию. Первая строка может быть заголовком («Телефон», «Имя», «Согласие»). Сначала бот покажет,
              что изменится, — в базе ничего не меняется, пока вы не нажмёте «Загрузить».
            </p>
            <InsetGroup title="Файл">
              <div className="py-3">
                <input
                  ref={input}
                  type="file"
                  accept={ACCEPT}
                  className="sr-only"
                  aria-label="Файл со списком клиентов"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] || null);
                    setErr("");
                  }}
                />
                <Button variant="tinted" icon={FileUp} onClick={() => input.current?.click()}>
                  {file ? "Выбрать другой файл" : "Выбрать файл"}
                </Button>
                <p className="mt-2 text-sm text-fg-3">{file ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} КБ` : "CSV, Excel (.xlsx) или текст, до 5 МБ. Старый .xls — сохраните как .xlsx."}</p>
                {file && (
                  <Button variant="ghost" size="sm" className="mt-1" onClick={() => (setFile(null), input.current && (input.current.value = ""))}>
                    Убрать файл
                  </Button>
                )}
              </div>
            </InsetGroup>
            {!file && (
              <InsetGroup title="Или вставьте список">
                <TextArea
                  label="Строки из таблицы"
                  rows={6}
                  placeholder={"Телефон;Имя\n+7 700 000 00 01;Арман\n8 700 000 00 02;Данияр"}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  hint="Можно скопировать прямо из Excel или Google Таблиц."
                />
              </InsetGroup>
            )}
            {err && (
              <Notice tone="critical" role="alert">
                {err}
              </Notice>
            )}
          </div>
        </div>
        <Footer>
          <Button onClick={onClose} className="flex-1 md:flex-none">
            Отмена
          </Button>
          <Button variant="primary" icon={ListChecks} busy={busy === "check"} onClick={() => void check()} className="flex-1 md:flex-none">
            Проверить
          </Button>
        </Footer>
      </>
    );

  const load = pv.counts.new + pv.counts.update;
  const consentRows = pv.hasConsent;
  const problems = pv.counts.dup + pv.counts.invalid;
  return (
    <>
      <div className="scroll-area min-h-0 flex-1">
        <div className="px-4 pb-6 pt-2 md:px-6 md:pt-5">
          <p className="mb-4 px-4 text-ui text-fg-2 pointer-coarse:text-base">
            В файле <span className="tnum">{pv.total}</span> {plural(pv.total, ROWS)}. Пока ничего не загружено.
          </p>
          <ul aria-label="Итог проверки" className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-5">
            {ORDER.map((a) => (
              <li key={a} className="rounded-[0.875rem] bg-surface px-3 py-2.5">
                <p className="truncate text-xs text-fg-3">{ACTION_LABEL[a]}</p>
                <p className={cn("tnum text-lg font-semibold leading-6", pv.counts[a] ? TONE[a] : "text-fg-3")}>{pv.counts[a]}</p>
              </li>
            ))}
          </ul>
          <InsetGroup title="Колонки">
            <p className="py-3 text-ui text-fg-2 pointer-coarse:text-base">
              Номер — {pv.columns.phone ? `«${pv.columns.phone}»` : "не нашли"}; имя — {pv.columns.name ? `«${pv.columns.name}»` : "нет"}; согласие —{" "}
              {pv.columns.consent ? `«${pv.columns.consent}»` : "нет"}.
            </p>
          </InsetGroup>
          {consentRows && (
            <InsetGroup title="Согласие из файла" note="Например: «анкета в салоне, 2025» или «согласие при записи на сайте».">
              <TextField label="Основание согласия" maxLength={120} value={basis} onChange={(e) => setBasis(e.target.value)} />
              {!basis.trim() && <Notice>Без основания согласия из файла не ставятся — клиенты загрузятся без согласия на рекламу.</Notice>}
              <Notice tone="muted">
                {pv.consentNote ||
                  "Даже с основанием «да» из файла будет не подтверждено: реклама таким клиентам не уйдёт, пока согласие не подтвердят в карточке. Тем, кто сам отказывался, «да» из файла не ставится."}
              </Notice>
            </InsetGroup>
          )}
          {problems > 0 && <Notice tone="muted">Дубли и неверные номера не загружаются — исправьте их в файле, если нужно.</Notice>}
          <InsetGroup title={pv.rows.length < pv.total ? `Строки (первые ${pv.rows.length})` : "Строки"}>
            <ul aria-label="Строки файла">
              {pv.rows.map((r) => (
                <li key={r.row} className="flex items-start justify-between gap-3 border-line py-2.5 [&+&]:border-t">
                  <span className="min-w-0">
                    <span className="block truncate text-ui pointer-coarse:text-base">
                      <span className="tnum text-fg-3">{r.row}.</span> {r.name || <span className="text-fg-3">без имени</span>}
                    </span>
                    <span className="tnum block truncate text-sm text-fg-2">{r.phone || "—"}</span>
                    {r.error && (
                      <span className="mt-0.5 flex gap-1.5 text-sm text-critical">
                        <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
                        {r.error}
                      </span>
                    )}
                  </span>
                  <span className={cn("shrink-0 text-sm font-medium", TONE[r.action])}>{ACTION_LABEL[r.action]}</span>
                </li>
              ))}
            </ul>
          </InsetGroup>
          {err && (
            <Notice tone="critical" role="alert">
              {err}
            </Notice>
          )}
        </div>
      </div>
      <Footer>
        <Button busy={busy === "discard"} onClick={() => void discard()} className="flex-1 md:flex-none">
          Отменить
        </Button>
        <Button variant="primary" busy={busy === "confirm"} disabled={!load && !(consentRows && basis.trim())} onClick={() => void confirm()} className="flex-1 md:flex-none">
          {load ? `Загрузить ${load}` : consentRows && basis.trim() ? "Записать согласия" : "Нечего загружать"}
        </Button>
      </Footer>
    </>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 gap-2 border-t border-line bg-surface px-4 pb-[max(0.75rem,var(--safe-b))] pt-3 md:justify-end md:px-6">{children}</div>;
}
