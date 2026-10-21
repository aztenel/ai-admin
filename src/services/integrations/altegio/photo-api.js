// @ts-check
// Altegio: фото мастера для онлайн-записи на сайте (services/sitebook/photo.js). Адрес картинки берётся только из ответа book_staff
// (altPhotoUrl), а не из запроса посетителя: иначе через наш Worker можно было бы скачивать что угодно (SSRF). Загрузка — только
// https с хостов Altegio, без перенаправлений, не дольше 5 с, не больше max байт и только PNG, JPEG, WebP, GIF, AVIF — тип узнаём по
// первым байтам, а не по заголовку (SVG со скриптом на нашем адресе был бы XSS).
// book_staff Winchester (разведка 21.10.2026): avatar — 100×100, avatar_big — 800×800, image_group.images.{sm,norm,origin} — 100, 220,
// 800 на assets.alteg.io; без фото — заглушка Altegio be.cdn.alteg.io/images/no-master(-sm).png и image_group [] (виджет рисует букву).

// хосты картинок Altegio: assets.alteg.io — фото мастеров; api/app/www.app/be.cdn — встречаются в документации и ответах Altegio
export const PHOTO_HOSTS = new Set(["assets.alteg.io", "api.alteg.io", "app.alteg.io", "www.app.alteg.io", "be.cdn.alteg.io"]);
export const PHOTO_MS = 5000;

// адрес годится: https, хост Altegio, без логина и порта, не заглушка «нет фото»
/** @param {any} u @returns {string} адрес или "" */
export function photoUrlOk(u) {
  if (typeof u !== "string" || u.length > 500) return "";
  let x;
  try { x = new URL(u); } catch (e) { return ""; }
  if (x.protocol !== "https:" || !PHOTO_HOSTS.has(x.hostname) || x.port || x.username || x.password) return "";
  if (/\/images\/no-master/i.test(x.pathname)) return "";
  return x.href;
}

// фото мастера из ответа book_staff: 220×220 (image_group norm) — круг 48–64 px на экране с плотностью ×3; нет — avatar (100×100),
// потом avatar_big (800×800, может не уложиться в предел размера)
/** @param {any} m @returns {string} адрес картинки или "" (фото нет) */
export function altPhotoUrl(m) {
  const g = m && m.image_group && typeof m.image_group === "object" && !Array.isArray(m.image_group) ? m.image_group.images || {} : {};
  for (const u of [g.norm && g.norm.path, m && m.avatar, g.sm && g.sm.path, m && m.avatar_big, g.origin && g.origin.path]) { const ok = photoUrlOk(u); if (ok) return ok; }
  return "";
}

// тип картинки по первым байтам или ""
/** @param {Uint8Array} b */
export function imageType(b) {
  const at = /** @param {number} i @param {string} s */ (i, s) => [...s].every((ch, k) => b[i + k] === ch.charCodeAt(0));
  if (b.length >= 8 && b[0] === 0x89 && at(1, "PNG\r\n\x1a\n")) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (b.length >= 6 && (at(0, "GIF87a") || at(0, "GIF89a"))) return "image/gif";
  if (b.length >= 12 && at(4, "ftypavif")) return "image/avif";
  return "";
}

/**
 * Загрузить фото мастера. Бросает ошибку с понятным текстом (в журнал), если адрес не Altegio, ответ не 200 (перенаправление тоже),
 * тип не image/*, байты не картинка или больше max
 * @param {string} url @param {number} max @returns {Promise<{ bytes: Uint8Array, type: string }>}
 */
export async function altPhotoFetch(url, max) {
  const u = photoUrlOk(url);
  if (!u) throw new Error("фото: адрес не Altegio");
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), PHOTO_MS);
  try {
    const r = await fetch(u, { method: "GET", redirect: "manual", signal: ac.signal, headers: { accept: "image/png,image/jpeg,image/webp,image/gif,image/avif" } });
    if (r.status !== 200) { try { await r.body?.cancel(); } catch (e) {} throw new Error("фото: ответ " + r.status); }
    const ct = String(r.headers.get("content-type") || "").toLowerCase();
    if (ct && !ct.startsWith("image/") && !ct.startsWith("application/octet-stream")) { try { await r.body?.cancel(); } catch (e) {} throw new Error("фото: не картинка " + ct.slice(0, 40)); }
    const len = r.headers.get("content-length");
    if (len !== null && +len > max) { try { await r.body?.cancel(); } catch (e) {} throw new Error("фото: больше предела"); }
    if (!r.body) throw new Error("фото: пустой ответ");
    const reader = r.body.getReader(), parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > max) { try { await reader.cancel(); } catch (e) {} throw new Error("фото: больше предела"); }
      parts.push(value);
    }
    const bytes = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { bytes.set(p, o); o += p.byteLength; }
    const type = imageType(bytes);
    if (!type) throw new Error("фото: байты не картинка");
    return { bytes, type };
  } catch (e) {
    if (ac.signal.aborted) throw new Error("фото: Altegio не ответил за 5 с");
    throw e;
  } finally { clearTimeout(timer); }
}
