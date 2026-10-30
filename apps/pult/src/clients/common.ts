// Общее для раздела «Клиенты»: подписи видов запретов, источников и действий импорта, даты по Астане, загрузка с отменой.
// Файл подключают только экраны раздела (грузятся при первом открытии) — в первое открытие пульта он не попадает.
import { useCallback, useEffect, useRef, useState } from "react";
import { astanaDay, when } from "@/campaigns/base/shared";
import { plural } from "@/lib/format";
import type { ConsentState, ImportAction, RestrictionKind } from "@/model/contacts";

export const KIND_LABEL: Record<RestrictionKind, string> = {
  marketing_optout: "Не писать рекламу",
  full_block: "Не писать вообще",
  sender_block: "Не писать с этого номера",
  cooldown: "Пауза",
  undeliverable: "Номера нет в WhatsApp",
};
/** Откуда контакт или кто поставил запрет — словами. Незнакомое (сервер новее пульта) — как есть. */
const SOURCE: Record<string, string> = {
  altegio: "Altegio",
  import: "из файла",
  manual: "вручную",
  chat: "переписка",
  site: "сайт",
  chat_stop: "клиент написал «стоп»",
  ga_sweep: "клиент написал «стоп» (сверка журнала Green-API)",
  meta_131050: "Meta: клиент отписался от рассылок",
  meta_button: "кнопка «стоп» в шаблоне Meta",
  admin: "поставил человек",
  kv_migration: "перенос из старого списка «стоп»",
  test: "тестовые данные",
};
export const sourceText = (s: string) => SOURCE[s] || s;
/** Где случилась ошибка синхронизации — словами. */
const SCOPE: Record<string, string> = {
  hot: "вчера и 2 недели вперёд",
  future: "записи на 60 дней",
  past: "визиты за месяц",
  initial: "первичная загрузка",
  stops: "сверка «стоп»",
  probe: "проверка полей",
  import: "импорт",
};
export const scopeText = (s: string) => SCOPE[s] || s;
export const CONSENT_LABEL: Record<ConsentState, string> = { granted: "Есть", denied: "Отказ", unknown: "Не известно" };
export const ACTION_LABEL: Record<ImportAction, string> = { new: "Новый", update: "Обновится имя", same: "Без изменений", dup: "Дубль в файле", invalid: "Неверный номер" };

const DAY = 864e5;
const dayNo = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY;
/** Сколько дней по календарю Астаны прошло с t (визит вчера в 20:00 — 1 день и утром, и вечером, как у сервера). */
export const daysAgo = (t: number, now: number) => dayNo(astanaDay(now)) - dayNo(astanaDay(t));
const DAYS: [string, string, string] = ["день", "дня", "дней"];
/** «сегодня», «вчера», «25 дней назад». */
export function agoText(t: number, now: number): string {
  const d = daysAgo(t, now);
  return d <= 0 ? "сегодня" : d === 1 ? "вчера" : `${d} ${plural(d, DAYS)} назад`;
}
/** «сегодня в 15:00», «завтра в 12:00», «5 ноября в 12:00» — по Астане. */
export function dateTime(t: number, now: number): string {
  if (astanaDay(t) === astanaDay(now + DAY)) return `завтра в ${when(t, now).time}`;
  const w = when(t, now);
  return `${w.day} в ${w.time}`;
}
/** «сегодня», «вчера», «завтра», «5 ноября» — день без времени. */
export function dayText(t: number, now: number): string {
  if (astanaDay(t) === astanaDay(now + DAY)) return "завтра";
  return when(t, now).day;
}

/**
 * Загрузка по запросу, без опроса: ответ на прежний запрос (сменили поиск, закрыли карточку) не применяется.
 * enabled = false — не грузить (например, пока база не подключена: иначе в консоли — ошибка 503).
 */
export function useFetch<T>(load: () => Promise<T>, deps: readonly unknown[], enabled = true) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(enabled);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useCallback(async (keep = true) => {
    const my = ++seq.current;
    setLoading(true);
    if (!keep) setData(undefined);
    try {
      const d = await loadRef.current();
      if (my !== seq.current) return;
      setData(d);
      setError("");
    } catch (e) {
      if (my !== seq.current) return;
      setError(errMsg(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void run(false);
    return () => {
      seq.current++;
    };
  }, [enabled, ...deps]);
  return { data, error, loading, reload: () => run(true) };
}

/** Текст ошибки для человека (сервер пишет понятные причины). */
export function errMsg(e: unknown): string {
  return e instanceof Error && "status" in e ? e.message : "Что-то пошло не так. Попробуйте ещё раз.";
}
/** Поле формы с ошибкой из ответа сервера ({ error, field }). */
export const errField = (e: unknown) => (e && typeof e === "object" && "field" in e ? String((e as { field?: string }).field || "") : "");
