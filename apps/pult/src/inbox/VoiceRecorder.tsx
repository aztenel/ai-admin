// Голосовое из пульта (02.11.2026): кнопка микрофона вместо «Отправить», пока поле пустое (как в WhatsApp). Нажали — браузер
// спрашивает микрофон, идёт запись с таймером; «Стоп» — прослушать и отправить или удалить; «Отменить» — запись выбрасывается.
// Отправка — тем же путём, что файлы (send-file, номер отправки rid и защита D1 от двойной отправки): второй раз не уйдёт.
// Запись прервалась (звонок, свернули пульт, отключили микрофон) — что успели записать, остаётся для прослушивания.
// Ogg Opus или WebM Opus уходят настоящим голосовым WhatsApp; MP4 с iPhone — аудиофайлом, и пульт пишет об этом до отправки.
import { Mic, SendHorizontal, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/overlay";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { pickMime, sendsAsVoice, voiceFile, voiceSupported } from "@/lib/voice";
import { VoicePlayer } from "./MediaView";

const MAX_MS = 10 * 60e3; // дольше — запись останавливается сама (файл до ~3 МБ, Green-API принимает до 100 МБ)
const MIN_MS = 800; // короче — случайное нажатие: не отправляем
const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

export type Recorded = { blob: Blob; mime: string; ms: number; url: string; voice: boolean };
type State = { st: "idle" } | { st: "asking" } | { st: "rec"; started: number } | ({ st: "ready" } & Recorded);

/** Почему не записалось — по ошибке браузера, простыми словами. */
function micError(e: unknown): string {
  const n = e instanceof DOMException || e instanceof Error ? e.name : "";
  if (n === "NotAllowedError" || n === "SecurityError")
    return "Нет доступа к микрофону. Разрешите микрофон для этого сайта: на iPhone — Настройки → Safari → Микрофон (или «аА» в адресной строке → Настройки веб-сайта), в Chrome — значок слева от адреса.";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "Микрофон не найден. Подключите микрофон или откройте пульт на телефоне.";
  if (n === "NotReadableError" || n === "AbortError") return "Микрофон занят другим приложением (звонок, диктофон). Закройте его и попробуйте снова.";
  return "Запись не началась. Попробуйте ещё раз или откройте пульт в Safari или Chrome.";
}

export function useVoiceRecorder() {
  const [s, setS] = useState<State>({ st: "idle" });
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const drop = useRef(false); // «Отменить»: остановленную запись выбросить
  const [now, setNow] = useState(0);

  const release = () => {
    stream.current?.getTracks().forEach((t) => t.stop()); // значок микрофона гаснет сразу
    stream.current = null;
    rec.current = null;
  };
  const clearReady = useCallback(() => {
    setS((cur) => {
      if (cur.st === "ready") URL.revokeObjectURL(cur.url);
      return { st: "idle" };
    });
  }, []);

  const stop = useCallback((why?: string) => {
    const r = rec.current;
    if (!r || r.state === "inactive") return;
    if (why) toast(why);
    try {
      r.stop();
    } catch {
      release();
      setS({ st: "idle" });
    }
  }, []);
  const cancel = useCallback(() => {
    if (rec.current && rec.current.state !== "inactive") {
      drop.current = true;
      stop();
    } else clearReady();
  }, [stop, clearReady]);

  const start = useCallback(async () => {
    if (!voiceSupported()) return toast("Запись голоса в этом браузере недоступна. Откройте пульт в Safari или Chrome.", "critical");
    setS({ st: "asking" });
    let ms: MediaStream;
    try {
      ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (e) {
      setS({ st: "idle" });
      return toast(micError(e), "critical");
    }
    const want = pickMime();
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(ms, want ? { mimeType: want, audioBitsPerSecond: 32000 } : undefined);
    } catch {
      try {
        r = new MediaRecorder(ms);
      } catch (e) {
        ms.getTracks().forEach((t) => t.stop());
        setS({ st: "idle" });
        return toast(micError(e), "critical");
      }
    }
    stream.current = ms;
    rec.current = r;
    chunks.current = [];
    drop.current = false;
    r.ondataavailable = (e) => e.data && e.data.size > 0 && chunks.current.push(e.data);
    r.onerror = () => stop("Запись прервалась. Прослушайте, что успели записать, и отправьте или удалите.");
    r.onstop = () => {
      const msLen = Date.now() - started.current, type = r.mimeType || want || chunks.current[0]?.type || "";
      const blob = new Blob(chunks.current, type ? { type } : undefined);
      chunks.current = [];
      release();
      if (drop.current || !blob.size) return setS({ st: "idle" });
      if (msLen < MIN_MS) {
        toast("Слишком короткая запись. Нажмите микрофон и говорите, затем «Стоп».");
        return setS({ st: "idle" });
      }
      setS({ st: "ready", blob, mime: type, ms: msLen, url: URL.createObjectURL(blob), voice: sendsAsVoice(type) });
    };
    // микрофон отключили или его забрал звонок — останавливаем, записанное остаётся
    ms.getAudioTracks().forEach((t) => (t.onended = () => stop("Запись прервалась. Прослушайте, что успели записать, и отправьте или удалите.")));
    started.current = Date.now();
    try {
      r.start(1000);
    } catch (e) {
      release();
      setS({ st: "idle" });
      return toast(micError(e), "critical");
    }
    setS({ st: "rec", started: started.current });
  }, [stop]);

  // таймер записи и предел длины
  useEffect(() => {
    if (s.st !== "rec") return;
    setNow(Date.now());
    const t = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() - s.started >= MAX_MS) stop("Запись остановлена: голосовое — не длиннее 10 минут.");
    }, 250);
    return () => window.clearInterval(t);
  }, [s, stop]);
  // свернули пульт или погас экран (iPhone останавливает запись сам) — останавливаем, записанное остаётся
  useEffect(() => {
    if (s.st !== "rec") return;
    const v = () => document.hidden && stop();
    document.addEventListener("visibilitychange", v);
    window.addEventListener("pagehide", v);
    return () => {
      document.removeEventListener("visibilitychange", v);
      window.removeEventListener("pagehide", v);
    };
  }, [s.st, stop]);
  // ушли из чата — микрофон освобождается, запись выбрасывается
  useEffect(() => () => {
    drop.current = true;
    try {
      rec.current?.stop();
    } catch {
      /* уже остановлена */
    }
    release();
  }, []);

  return { s, elapsed: s.st === "rec" ? Math.max(0, now - s.started) : 0, start, stop, cancel, clearReady };
}

/** Кнопка микрофона на месте «Отправить», пока поле пустое. */
export function MicButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label="Записать голосовое"
      title="Записать голосовое"
      className="relative grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition-[opacity,background-color] after:absolute after:-inset-1 hover:brightness-95 disabled:opacity-60"
    >
      {busy ? <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Mic aria-hidden className="size-[1.125rem]" strokeWidth={2.2} />}
    </button>
  );
}

/** Полоса записи и прослушивания — на месте поля ввода. onSend получает готовый файл (Ogg — голосовое, M4A — аудиофайл). */
export function VoiceBar({ r, onSend }: { r: ReturnType<typeof useVoiceRecorder>; onSend: (file: File, ms: number) => void }) {
  const [busy, setBusy] = useState(false);
  const s = r.s;
  if (s.st === "rec" || s.st === "asking")
    return (
      <div className="flex min-h-10 min-w-0 flex-1 items-center gap-2" role="group" aria-label="Запись голосового">
        <IconButton icon={Trash2} label="Отменить запись" onClick={r.cancel} disabled={s.st === "asking"} />
        <span className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[1.25rem] bg-surface-2 px-3.5">
          <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full bg-critical", s.st === "rec" && "animate-pulse")} />
          <span className="tnum text-md font-medium text-fg md:text-base" aria-live="off">
            {s.st === "asking" ? "Разрешите микрофон…" : fmt(r.elapsed)}
          </span>
          <span className="min-w-0 truncate text-sm text-fg-3">{s.st === "rec" ? "Идёт запись" : ""}</span>
        </span>
        <button
          type="button"
          onClick={() => r.stop()}
          disabled={s.st !== "rec"}
          aria-label="Остановить запись"
          className="relative grid size-10 shrink-0 place-items-center rounded-full bg-critical text-surface after:absolute after:-inset-1 disabled:opacity-50"
        >
          <Square aria-hidden className="size-4" fill="currentColor" strokeWidth={0} />
        </button>
      </div>
    );
  if (s.st !== "ready") return null;
  const send = async () => {
    if (busy) return; // двойное нажатие — одна отправка
    setBusy(true);
    try {
      const { file } = await voiceFile(s.blob, s.mime, Date.now());
      onSend(file, s.ms);
      r.clearReady();
    } catch {
      toast("Не удалось подготовить голосовое. Запишите ещё раз.", "critical");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex min-h-10 min-w-0 items-center gap-2" role="group" aria-label="Голосовое перед отправкой">
        <IconButton icon={Trash2} label="Удалить запись" onClick={r.clearReady} disabled={busy} />
        <span className="flex min-w-0 flex-1 items-center rounded-[1.25rem] bg-surface-2 px-2 py-1">
          <VoicePlayer url={s.url} onDark={false} mime={s.mime} dur={s.ms / 1000} />
        </span>
        <button
          type="button"
          onClick={send}
          disabled={busy}
          aria-label="Отправить голосовое"
          className="relative grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-fg after:absolute after:-inset-1 hover:brightness-95 disabled:opacity-60"
        >
          {busy ? <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <SendHorizontal aria-hidden className="size-[1.125rem]" strokeWidth={2.2} />}
        </button>
      </div>
      {!s.voice && (
        <p className="px-12 text-xs leading-4 text-fg-3">
          Этот браузер записывает только в формате M4A: уйдёт аудиофайлом, а не голосовым. Голосовым уходят записи из Chrome и Firefox.
        </p>
      )}
    </div>
  );
}
