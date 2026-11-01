// Голосовые из пульта (02.11.2026). WhatsApp показывает голосовым только Ogg с кодеком Opus (Green-API узнаёт вид по расширению
// файла: .ogg — голосовое, .m4a — обычный аудиофайл). Браузеры записывают по-разному (MediaRecorder): Firefox — сразу Ogg Opus,
// Chrome и Android — WebM с тем же Opus внутри (его здесь перекладываем в Ogg без перекодирования: те же пакеты, другая обёртка),
// Safari на iPhone — MP4 с AAC: перекодировать его в браузере без тяжёлой библиотеки нельзя, такая запись уходит аудиофайлом,
// и пульт говорит об этом заранее. Что поддерживает браузер, спрашиваем у него самого (isTypeSupported), а не угадываем по устройству.

/** Форматы записи — от лучшего: Ogg Opus (готовое голосовое), WebM Opus (переложим в Ogg), MP4/AAC (аудиофайл). */
const PREFER = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/aac", "audio/webm"];

export type RecKind = "ogg" | "webm" | "mp4" | "other";
export const recKind = (mime: string): RecKind => {
  const t = mime.toLowerCase();
  if (t.startsWith("audio/ogg")) return "ogg";
  if (t.startsWith("audio/webm") || t.startsWith("video/webm")) return "webm";
  if (t.startsWith("audio/mp4") || t.startsWith("audio/aac") || t.startsWith("audio/x-m4a") || t.startsWith("video/mp4")) return "mp4";
  return "other";
};

/** Можно ли записывать голос в этом браузере: нужен безопасный адрес (https), доступ к микрофону и MediaRecorder. */
export function voiceSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";
}
/** Тип записи для MediaRecorder: первый из PREFER, который браузер умеет. "" — пусть выберет сам. */
export function pickMime(): string {
  const MR = typeof window !== "undefined" ? window.MediaRecorder : undefined;
  if (!MR?.isTypeSupported) return "";
  return PREFER.find((t) => {
    try {
      return MR.isTypeSupported(t);
    } catch {
      return false;
    }
  }) || "";
}
/** Уйдёт ли запись этим браузером настоящим голосовым (Ogg Opus) или аудиофайлом. */
export function sendsAsVoice(mime: string): boolean {
  const k = recKind(mime);
  return k === "ogg" || (k === "webm" && /opus/i.test(mime || "audio/webm;codecs=opus"));
}

// ---------- WebM (Matroska) → Ogg Opus: те же пакеты Opus, другая обёртка (RFC 7845)

const ID = { EBML: 0x1a45dfa3, Segment: 0x18538067, Cluster: 0x1f43b675, Tracks: 0x1654ae6b, TrackEntry: 0xae, Audio: 0xe1, BlockGroup: 0xa0, Block: 0xa1, SimpleBlock: 0xa3, CodecID: 0x86, CodecPrivate: 0x63a2, Channels: 0x9f, CodecDelay: 0x56aa, TrackNumber: 0xd7 };
// элементы-контейнеры, внутрь которых входим (у записи MediaRecorder размер Segment и Cluster часто «неизвестен» — читаем подряд)
const MASTER = new Set([ID.Segment, ID.Cluster, ID.Tracks, ID.TrackEntry, ID.Audio, ID.BlockGroup]);

/** Число переменной длины EBML. id: метка длины остаётся в значении (так записаны номера элементов). → [значение, длина, «неизвестно»] */
function vint(b: Uint8Array, p: number, id: boolean): [number, number, boolean] {
  const first = b[p];
  if (first === undefined || first === 0) throw new Error("bad vint");
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || p + len > b.length) throw new Error("bad vint");
  let v = id ? first : first & (0xff >> len);
  let ones = (first & (0xff >> len)) === 0xff >> len;
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[p + i];
    if (b[p + i] !== 0xff) ones = false;
  }
  return [v, len, !id && ones];
}
const uintBE = (b: Uint8Array, p: number, n: number) => {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[p + i];
  return v;
};

/** Сколько отсчётов (48 кГц) в пакете Opus — по его первому байту (RFC 6716 §3.1). */
export function opusSamples(pkt: Uint8Array): number {
  if (!pkt.length) return 0;
  const toc = pkt[0], cfg = toc >> 3;
  const ms10 = cfg < 12 ? [10, 20, 40, 60][cfg & 3] * 10 : cfg < 16 ? [10, 20][cfg & 1] * 10 : [2.5, 5, 10, 20][cfg & 3] * 10; // в десятых мс
  const c = toc & 3, frames = c === 0 ? 1 : c === 3 ? (pkt[1] ?? 0) & 0x3f : 2;
  return Math.round((frames * ms10 * 48) / 10);
}

type Parsed = { head: Uint8Array | null; channels: number; delayNs: number; packets: Uint8Array[]; track: number };

function parseWebm(b: Uint8Array): Parsed {
  const out: Parsed = { head: null, channels: 0, delayNs: 0, packets: [], track: 0 };
  let opusTrack = 0, curTrack = 0, curOpus = false;
  let p = 0;
  while (p < b.length) {
    const [id, il] = vint(b, p, true);
    const [size, sl, unknown] = vint(b, p + il, false);
    const body = p + il + sl;
    if (MASTER.has(id)) {
      if (id === ID.TrackEntry) {
        curTrack = 0;
        curOpus = false;
      }
      p = body; // содержимое читаем подряд: и при известном, и при «неизвестном» размере
      continue;
    }
    if (unknown || body + size > b.length) {
      // обрезанный хвост (запись остановили посреди блока) — берём, что успели
      if (id === ID.SimpleBlock || id === ID.Block) break;
      throw new Error("bad element");
    }
    if (id === ID.TrackNumber) curTrack = uintBE(b, body, size);
    else if (id === ID.CodecID) {
      curOpus = new TextDecoder().decode(b.subarray(body, body + size)).replace(/\0+$/, "") === "A_OPUS";
      if (curOpus && curTrack) opusTrack = curTrack;
    } else if (id === ID.CodecPrivate) {
      const cp = b.subarray(body, body + size);
      if (cp.length >= 19 && new TextDecoder().decode(cp.subarray(0, 8)) === "OpusHead") out.head = cp.slice();
    } else if (id === ID.Channels) out.channels = uintBE(b, body, size);
    else if (id === ID.CodecDelay) out.delayNs = uintBE(b, body, size);
    else if (id === ID.SimpleBlock || id === ID.Block) {
      if (curOpus && curTrack && !opusTrack) opusTrack = curTrack;
      const [tn, tl] = vint(b, body, false);
      const flags = b[body + tl + 2];
      const data = b.subarray(body + tl + 3, body + size);
      if ((!opusTrack || tn === opusTrack) && data.length) {
        if (flags & 0x06) throw new Error("laced"); // MediaRecorder блоки не склеивает; склеенные — не наш случай
        out.packets.push(data.slice());
        out.track = tn;
      }
    }
    p = body + size;
  }
  return out;
}

// CRC-32 Ogg: многочлен 0x04c11db7, без отражения, начальное значение 0
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();
export function oggCrc(b: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < b.length; i++) c = ((c << 8) ^ CRC[((c >>> 24) ^ b[i]) & 0xff]) >>> 0;
  return c >>> 0;
}

function page(packets: Uint8Array[], granule: number, serial: number, seq: number, flags: number): Uint8Array {
  const lace: number[] = [];
  for (const pk of packets) {
    let n = pk.length;
    while (n >= 255) {
      lace.push(255);
      n -= 255;
    }
    lace.push(n);
  }
  const bodyLen = packets.reduce((s, x) => s + x.length, 0);
  const out = new Uint8Array(27 + lace.length + bodyLen);
  const dv = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  out[4] = 0;
  out[5] = flags;
  dv.setUint32(6, granule >>> 0, true);
  dv.setUint32(10, Math.floor(granule / 4294967296), true);
  dv.setUint32(14, serial, true);
  dv.setUint32(18, seq, true);
  out[26] = lace.length;
  out.set(lace, 27);
  let o = 27 + lace.length;
  for (const pk of packets) {
    out.set(pk, o);
    o += pk.length;
  }
  dv.setUint32(22, oggCrc(out), true);
  return out;
}

function opusHead(channels: number, preSkip: number): Uint8Array {
  const h = new Uint8Array(19);
  const dv = new DataView(h.buffer);
  h.set(new TextEncoder().encode("OpusHead"), 0);
  h[8] = 1;
  h[9] = channels;
  dv.setUint16(10, preSkip, true);
  dv.setUint32(12, 48000, true);
  dv.setInt16(16, 0, true);
  h[18] = 0;
  return h;
}
function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode("ai-admin pult");
  const t = new Uint8Array(8 + 4 + vendor.length + 4);
  const dv = new DataView(t.buffer);
  t.set(new TextEncoder().encode("OpusTags"), 0);
  dv.setUint32(8, vendor.length, true);
  t.set(vendor, 12);
  dv.setUint32(12 + vendor.length, 0, true);
  return t;
}

/** WebM с Opus (запись Chrome, Android) → Ogg Opus: голосовое WhatsApp. Ошибка — если внутри не Opus или файл не читается.
 *  → файл и длительность в мс. */
export function webmToOgg(webm: Uint8Array): { ogg: Uint8Array<ArrayBuffer>; ms: number } {
  const w = parseWebm(webm);
  if (!w.packets.length) throw new Error("no opus packets");
  let head = w.head;
  if (!head) head = opusHead(w.channels === 2 ? 2 : 1, w.delayNs ? Math.round((w.delayNs / 1e9) * 48000) : 312);
  if (head[9] < 1 || head[9] > 2 || head[18] !== 0) throw new Error("unsupported channels");
  const serial = (Math.random() * 0xffffffff) >>> 0;
  const pages: Uint8Array[] = [page([head], 0, serial, 0, 0x02), page([opusTags()], 0, serial, 1, 0)];
  let granule = 0, seq = 2, cur: Uint8Array[] = [], segs = 0;
  const flush = (last: boolean) => {
    pages.push(page(cur, granule, serial, seq++, last ? 0x04 : 0));
    cur = [];
    segs = 0;
  };
  w.packets.forEach((pk, i) => {
    const need = Math.floor(pk.length / 255) + 1;
    if (cur.length && (segs + need > 255 || cur.length >= 50)) flush(false); // ~1 с на страницу
    cur.push(pk);
    segs += need;
    granule += opusSamples(pk);
    if (i === w.packets.length - 1) flush(true);
  });
  const total = pages.reduce((s, x) => s + x.length, 0);
  const ogg = new Uint8Array(total);
  let o = 0;
  for (const pg of pages) {
    ogg.set(pg, o);
    o += pg.length;
  }
  const preSkip = new DataView(head.buffer, head.byteOffset).getUint16(10, true);
  return { ogg, ms: Math.max(0, Math.round(((granule - preSkip) / 48000) * 1000)) };
}

/** Запись → файл для отправки: Ogg Opus (голосовое) или как записал браузер (MP4/AAC — аудиофайл). */
export async function voiceFile(blob: Blob, mime: string, at: number): Promise<{ file: File; voice: boolean }> {
  const stamp = new Date(at).toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const k = recKind(mime || blob.type);
  if (k === "ogg") return { file: new File([blob], `voice-${stamp}.ogg`, { type: "audio/ogg" }), voice: true };
  if (k === "webm") {
    const { ogg } = webmToOgg(new Uint8Array(await blob.arrayBuffer()));
    return { file: new File([ogg], `voice-${stamp}.ogg`, { type: "audio/ogg" }), voice: true };
  }
  if (k === "mp4") return { file: new File([blob], `voice-${stamp}.m4a`, { type: "audio/mp4" }), voice: false };
  throw new Error("unsupported");
}
