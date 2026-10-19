// Загрузка данных экрана раздела «Рассылки»: первая загрузка, «Обновить», ошибка текстом сервера и опрос, пока это нужно
// (например, пока рассылка идёт). Опрос не идёт в свёрнутой вкладке и останавливается, когда экран закрыт.
// Только чтение: POST из эффекта не делать (в разработке React запускает эффекты дважды).
import { useCallback, useEffect, useRef, useState } from "react";
import type { DataSource } from "@/data/source";
import { store } from "@/state/store";
import { errText } from "./common";

export type Loaded<T> = {
  data?: T;
  /** Текст ошибки последней загрузки (данные прошлой удачной остаются в data). */
  error?: string;
  /** Первая загрузка (данных ещё нет). */
  loading: boolean;
  /** Повторная загрузка поверх показанных данных. */
  refreshing: boolean;
  /** Загрузить заново (после действия, кнопкой «Обновить»). */
  reload(): Promise<void>;
  /** Подменить данные ответом действия (например, рассылкой после «Пауза»), не дожидаясь перезагрузки. */
  set(d: T | ((prev: T | undefined) => T)): void;
};

/**
 * const ov = useLoad((src) => src.campaignsOverview(ws), [ws]);
 * const c = useLoad((src) => src.campaign(ws, id), [ws, id], { pollMs: 5000, pollWhile: (c) => c.status === "running" });
 * deps — когда менять запрос (компания, рассылка, страница): при смене прежние данные сбрасываются.
 */
export function useLoad<T>(load: (src: DataSource) => Promise<T>, deps: readonly unknown[], opts: { pollMs?: number; pollWhile?: (d: T) => boolean } = {}): Loaded<T> {
  const [st, setSt] = useState<{ data?: T; error?: string; loading: boolean; refreshing: boolean }>({ loading: true, refreshing: false });
  const loadRef = useRef(load);
  loadRef.current = load;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const seq = useRef(0);
  const dataRef = useRef<T | undefined>(undefined);

  const run = useCallback(async () => {
    const my = ++seq.current;
    const src = store.source;
    if (!src) {
      setSt({ loading: false, refreshing: false, error: "Пульт ещё загружается — попробуйте через секунду." });
      return;
    }
    setSt((s) => ({ ...s, refreshing: !s.loading }));
    try {
      const data = await loadRef.current(src);
      if (my !== seq.current) return; // пришёл ответ на прежний запрос (сменили компанию или страницу)
      dataRef.current = data;
      setSt({ data, loading: false, refreshing: false });
    } catch (e) {
      if (my !== seq.current) return;
      setSt((s) => ({ ...s, error: errText(e), loading: false, refreshing: false }));
    }
  }, []);

  // смена запроса: прежние данные — не про то, сбрасываем
  useEffect(() => {
    dataRef.current = undefined;
    setSt({ loading: true, refreshing: false });
    void run();
    return () => {
      seq.current++; // ответы на запросы закрытого экрана не применяются
    };
  }, deps);

  // опрос, пока pollWhile(data) — только видимая вкладка; вернулись во вкладку — сразу обновить
  const polling = !!opts.pollMs && st.data !== undefined && (!opts.pollWhile || opts.pollWhile(st.data));
  useEffect(() => {
    if (!polling) return;
    const tick = () => {
      if (!document.hidden) void run();
    };
    const t = window.setInterval(tick, optsRef.current.pollMs);
    const vis = () => {
      if (!document.hidden) void run();
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [polling, run]);

  const set = useCallback((d: T | ((prev: T | undefined) => T)) => {
    seq.current++; // свежий ответ действия важнее опроса, который ещё в пути
    const next = typeof d === "function" ? (d as (p: T | undefined) => T)(dataRef.current) : d;
    dataRef.current = next;
    setSt({ data: next, loading: false, refreshing: false });
  }, []);

  return { ...st, reload: run, set };
}
