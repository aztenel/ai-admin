// @ts-check
// Чтение .xlsx без библиотек (импорт контактов, 31.10.2026): .xlsx — zip-архив с XML. Читаем центральный каталог, распаковываем
// DecompressionStream («deflate-raw» есть и в Worker, и в Node) только общие строки и первый лист. Формулы, даты и стили не нужны —
// берём текст ячеек. Старый .xls (двоичный) не читаем: просим сохранить как .xlsx или .csv.

const MAX_UNZIP = 30 * 1024 * 1024; // распакованный лист больше 30 МБ — не читаем (защита от «zip-бомбы»)

/** @param {Uint8Array} b @param {number} i */
const u16 = (b, i) => b[i] | (b[i + 1] << 8);
/** @param {Uint8Array} b @param {number} i */
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** имена файлов архива → где лежат. Ошибка — не zip. @param {Uint8Array} b */
function zipIndex(b) {
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("not zip");
  const n = u16(b, e + 10);
  let p = u32(b, e + 16);
  /** @type {Map<string, { method: number, comp: number, size: number, local: number }>} */
  const out = new Map();
  for (let k = 0; k < n; k++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new Error("bad zip");
    const nameLen = u16(b, p + 28), extra = u16(b, p + 30), comment = u16(b, p + 32);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    out.set(name, { method: u16(b, p + 10), comp: u32(b, p + 20), size: u32(b, p + 24), local: u32(b, p + 42) });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

/** @param {Uint8Array} b @param {{ method: number, comp: number, size: number, local: number }} f */
async function unzip(b, f) {
  if (f.size > MAX_UNZIP) throw new Error("too big");
  const l = f.local;
  if (u32(b, l) !== 0x04034b50) throw new Error("bad zip");
  const start = l + 30 + u16(b, l + 26) + u16(b, l + 28), data = b.subarray(start, start + f.comp);
  if (f.method === 0) return new TextDecoder().decode(data);
  if (f.method !== 8) throw new Error("zip method");
  const reader = new Blob([/** @type {any} */ (data)]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_UNZIP) { try { await reader.cancel(); } catch (e) {} throw new Error("too big"); }
    parts.push(value);
  }
  const all = new Uint8Array(total);
  let o = 0; for (const x of parts) { all.set(x, o); o += x.length; }
  return new TextDecoder().decode(all);
}

/** @param {string} s */
const xmlText = s => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");
/** «B12» → 1. @param {string} ref */
const colOf = ref => { let n = 0; for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
// номер, записанный числом, Excel хранит как 77001234567 или 7.7001234567E10
/** @param {string} v */
const num = v => /^-?\d+(\.\d+)?E\+?\d+$/i.test(v) && Math.abs(+v) < 2 ** 53 ? (+v).toFixed(0) : v.replace(/\.0+$/, "");

/** Это .xlsx (zip)? @param {Uint8Array} b */
export const isZip = b => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/**
 * Первый лист .xlsx → строки ячеек (текст). Ошибка — файл не .xlsx или повреждён.
 * @param {Uint8Array} b
 * @param {number} [max] больше строк не читаем
 * @returns {Promise<string[][]>}
 */
export async function xlsxRows(b, max = 20000) {
  const z = zipIndex(b);
  const read = async (/** @type {string} */ n) => { const f = z.get(n); return f ? unzip(b, f) : null; };
  const ssXml = await read("xl/sharedStrings.xml");
  const shared = ssXml ? [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(t => xmlText(t[1])).join("")) : [];
  // первый лист — по порядку в книге (workbook.xml → связи), иначе sheet1.xml
  let sheet = "";
  const wb = await read("xl/workbook.xml"), rels = await read("xl/_rels/workbook.xml.rels");
  const rid = wb && (/<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb) || [])[1];
  if (rid && rels) { const t = (new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels) || new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels) || [])[1]; if (t) sheet = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, ""); }
  if (!z.has(sheet)) sheet = [...z.keys()].filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, c) => +(/\d+/.exec(a) || [0])[0] - +(/\d+/.exec(c) || [0])[0])[0] || "";
  const xml = sheet ? await read(sheet) : null;
  if (!xml) throw new Error("no sheet");
  /** @type {string[][]} */
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    /** @type {string[]} */
    const row = [];
    let next = 0;
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || "", r = (/\br="([A-Z]+\d+)"/.exec(attrs) || [])[1], t = (/\bt="(\w+)"/.exec(attrs) || [])[1] || "n";
      const at = r ? colOf(r) : next;
      next = at + 1;
      const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
      let s = "";
      if (t === "s") s = shared[+(v || -1)] ?? "";
      else if (t === "inlineStr") s = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => xmlText(x[1])).join("");
      else if (v !== undefined) s = t === "n" ? num(xmlText(v)) : xmlText(v);
      if (at < 200) row[at] = s;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = "";
    if (row.some(x => x.trim())) rows.push(row);
    if (rows.length >= max + 1) break;
  }
  return rows;
}
