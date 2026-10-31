// Файлы в переписке (ТЗ v2.0 §2.4): голосовое — свой плеер (пауза, перемотка, длительность, скорость 1× / 1.5× / 2×), фото —
// миниатюра и просмотр на весь экран, видео — встроенный плеер, документ — имя, размер, открыть или скачать.
// Файл отдаёт наш сервер (/api/inbox/media, вход обязателен), ключей и ссылок провайдера в браузере нет.
// Голосовые WhatsApp — Ogg Opus: Safari на iPhone (до iOS 18.4) их не играет — тогда файл расшифровывается здесь же
// (ogg-opus-decoder, грузится только когда нужен) и играется как WAV. Не открылось — понятная причина, сообщение остаётся.
import { Download, FileText, Image as ImageIcon, MapPin, Pause, Phone, Play, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Message } from "@/model/types";
import { cn } from "@/lib/utils";

type Media = NonNullable<Message["media"]>;
const fmtDur = (s: number) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");
const fmtSize = (n?: number) => (!n ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`);

/** Текст ошибки сервера (он пишет понятные причины: «Файл недоступен: WhatsApp хранит файлы ограниченное время…»). */
async function why(url: string) {
  try {
    const r = await fetch(url, { credentials: "same-origin", headers: { range: "bytes=0-0" } });
    if (r.ok || r.status === 206) return "";
    const j = (await r.json().catch(() => null)) as { error?: string } | null;
    return j?.error || "Файл недоступен.";
  } catch {
    return "Нет связи — файл не загрузился.";
  }
}

export function MediaView({ media, onDark }: { media: Media; onDark: boolean }) {
  if (!media.url) return <Unavailable kind={media.kind} text="Файл не сохранился в переписке." />;
  if (media.kind === "image" || media.kind === "sticker") return <ImageView url={media.url} />;
  if (media.kind === "audio") return <VoicePlayer url={media.url} onDark={onDark} />;
  if (media.kind === "video") return <VideoView url={media.url} />;
  if (media.kind === "location" || media.kind === "contact") return <Unavailable kind={media.kind} text={media.kind === "location" ? "Геолокация — откройте в WhatsApp" : "Контакт — откройте в WhatsApp"} />;
  return <DocView media={media} />;
}

function Unavailable({ kind, text }: { kind: Media["kind"]; text: string }) {
  const Icon = kind === "image" ? ImageIcon : kind === "video" ? Video : kind === "location" ? MapPin : kind === "contact" ? Phone : FileText;
  return (
    <span className="mb-1 flex items-start gap-2 text-sm opacity-85">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      <span>{text}</span>
    </span>
  );
}

function ImageView({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  if (err) return <Unavailable kind="image" text={err} />;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="-mx-1.5 -mt-0.5 mb-1 block overflow-hidden rounded-xl" aria-label="Открыть фото">
        <img src={url} alt="Фото от клиента" loading="lazy" onError={() => why(url).then((t) => setErr(t || "Фото не открылось."))} className="max-h-80 w-full min-w-40 bg-surface-2 object-cover" />
      </button>
      {open && <Lightbox url={url} onClose={() => setOpen(false)} />}
    </>
  );
}

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Фото" className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 pb-safe pt-safe" onClick={onClose}>
      <img src={url} alt="Фото от клиента" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
      <div className="absolute right-3 top-[calc(var(--safe-t)+0.75rem)] flex gap-2">
        <a href={url} download className="grid size-11 place-items-center rounded-full bg-white/15 text-white" aria-label="Скачать фото" onClick={(e) => e.stopPropagation()}>
          <Download aria-hidden className="size-5" />
        </a>
        <button type="button" onClick={onClose} className="grid size-11 place-items-center rounded-full bg-white/15 text-white" aria-label="Закрыть">
          <X aria-hidden className="size-5" />
        </button>
      </div>
    </div>
  );
}

function VideoView({ url }: { url: string }) {
  const [err, setErr] = useState("");
  if (err) return <Unavailable kind="video" text={err} />;
  return (
    <video controls playsInline preload="metadata" src={url} onError={() => why(url).then((t) => setErr(t || "Видео не воспроизводится в браузере — скачайте файл."))} className="-mx-1.5 -mt-0.5 mb-1 block max-h-80 w-full min-w-48 rounded-xl bg-black" />
  );
}

function DocView({ media }: { media: Media }) {
  const name = media.name || "Файл";
  const pdf = /pdf/i.test(media.mime || "") || /\.pdf$/i.test(name);
  return (
    <span className="mb-1 flex items-center gap-2.5">
      <FileText aria-hidden className="size-8 shrink-0 opacity-75" strokeWidth={1.5} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block text-xs opacity-75">{[fmtSize(media.size), pdf ? "PDF" : ""].filter(Boolean).join(" · ") || "Документ"}</span>
      </span>
      {pdf && (
        <a href={media.url} target="_blank" rel="noopener" className="text-sm font-medium underline underline-offset-2">
          Открыть
        </a>
      )}
      <a href={media.url} download={name} className="grid size-9 place-items-center rounded-full bg-black/5 dark:bg-white/10" aria-label={`Скачать ${name}`}>
        <Download aria-hidden className="size-4" />
      </a>
    </span>
  );
}

const SPEEDS = [1, 1.5, 2];
/** Играет ли браузер Ogg Opus сам (Chrome, Firefox, новые Safari) — иначе расшифровываем. */
const oggNative = () => typeof document !== "undefined" && !!document.createElement("audio").canPlayType('audio/ogg; codecs="opus"');

/** PCM → WAV (16 бит, моно) — его играет любой браузер, Safari на iPhone тоже. */
function wav(channels: Float32Array[], rate: number) {
  const ch = channels[0] || new Float32Array(0), n = ch.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, ch[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

async function decodeOgg(url: string): Promise<string> {
  const r = await fetch(url, { credentials: "same-origin" });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Голосовое недоступно.");
  const bytes = new Uint8Array(await r.arrayBuffer());
  const { OggOpusDecoder } = await import("ogg-opus-decoder");
  const dec = new OggOpusDecoder();
  await dec.ready;
  try {
    const out = await dec.decodeFile(bytes);
    return URL.createObjectURL(wav(out.channelData, out.sampleRate));
  } finally {
    dec.free();
  }
}

export function VoicePlayer({ url, onDark }: { url: string; onDark: boolean }) {
  const a = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState("");
  const [state, setState] = useState<"idle" | "prep" | "play" | "pause" | "error">("idle");
  const [err, setErr] = useState("");
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [speed, setSpeed] = useState(1);
  useEffect(() => () => void (src.startsWith("blob:") && URL.revokeObjectURL(src)), [src]);

  const start = async () => {
    const el = a.current;
    if (!el) return;
    if (state === "play") return el.pause();
    if (!src) {
      setState("prep");
      try {
        // сначала как есть; Safari, который не знает Ogg Opus, — через расшифровку
        const s = oggNative() ? url : await decodeOgg(url);
        setSrc(s);
        el.src = s;
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Голосовое недоступно.");
        return setState("error");
      }
    }
    el.playbackRate = speed;
    try {
      await el.play();
    } catch {
      /* ошибку покажет onError */
    }
  };
  const onError = async () => {
    // нативно не вышло (старый Safari, обрезанный файл) — пробуем расшифровать, иначе — причина с сервера
    if (src === url) {
      try {
        const s = await decodeOgg(url);
        setSrc(s);
        if (a.current) {
          a.current.src = s;
          a.current.playbackRate = speed;
          await a.current.play().catch(() => {});
        }
        return;
      } catch {
        /* ниже — текст причины */
      }
    }
    setErr((await why(url)) || "Голосовое не воспроизводится.");
    setState("error");
  };

  if (state === "error") return <Unavailable kind="audio" text={err} />;
  const pct = dur ? Math.min(100, (t / dur) * 100) : 0;
  return (
    <div className="mb-1 flex w-64 max-w-full items-center gap-2.5">
      <button
        type="button"
        onClick={start}
        aria-label={state === "play" ? "Пауза" : "Слушать голосовое"}
        className={cn("grid size-10 shrink-0 place-items-center rounded-full", onDark ? "bg-white/20 text-current" : "bg-accent text-white")}
      >
        {state === "play" ? <Pause aria-hidden className="size-5" fill="currentColor" /> : state === "prep" ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Play aria-hidden className="ml-0.5 size-5" fill="currentColor" />}
      </button>
      <span className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={dur || 0}
          step={0.1}
          value={t}
          aria-label="Перемотка"
          disabled={!dur}
          onChange={(e) => a.current && (a.current.currentTime = +e.target.value)}
          className="block h-1.5 w-full cursor-pointer appearance-none rounded-full bg-current/25 accent-current"
          style={{ background: `linear-gradient(to right, currentColor ${pct}%, color-mix(in srgb, currentColor 25%, transparent) ${pct}%)` }}
        />
        <span className="tnum mt-1 flex justify-between text-[0.6875rem] opacity-75">
          <span>{fmtDur(state === "idle" ? dur : t)}</span>
          <span>{state === "prep" ? "готовлю…" : fmtDur(dur)}</span>
        </span>
      </span>
      <button
        type="button"
        onClick={() => {
          const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
          setSpeed(next);
          if (a.current) a.current.playbackRate = next;
        }}
        aria-label={`Скорость ${speed}×`}
        className="tnum h-7 shrink-0 rounded-full bg-black/5 px-2 text-xs font-semibold dark:bg-white/10"
      >
        {String(speed).replace(".", ",")}×
      </button>
      <audio
        ref={a}
        preload="none"
        onPlay={() => setState("play")}
        onPause={() => setState("pause")}
        onEnded={() => (setState("pause"), setT(0))}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onDurationChange={(e) => setDur(e.currentTarget.duration)}
        onError={() => src && onError()}
      />
    </div>
  );
}
