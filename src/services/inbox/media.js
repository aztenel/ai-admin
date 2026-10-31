// @ts-check
// Файл из переписки для пульта (ТЗ v2.0 §2.4, 31.10.2026): голосовое, фото, видео, документ. Ключи провайдеров и их ссылки в браузер
// не уходят — файл отдаёт сервер, только тому, кто вошёл и видит эту компанию (проверяет контроллер), и только файл этой переписки.
// Green-API: ссылка из вебхука живёт ограниченное время («ограничено WhatsApp», срок не указан) — не открылась, берём новую
// (downloadFile по номеру сообщения); 500 там — файла у WhatsApp уже нет. Safari на iPhone воспроизводит аудио и видео только
// с запросами Range — заголовок передаём провайдеру и возвращаем 206. Опасные типы (html, svg, программы) — только скачать:
// иначе такой «файл клиента» исполнился бы на нашем адресе. Файлы не храним — каждый раз берём у провайдера.
/** @import { Env } from "../../lib/types.js" */
import { GRAPH } from "../../config/constants.js";
import { gaRoute, gaShared } from "../integrations/greenapi/webhook.js";
import { gaCall } from "../integrations/greenapi/client.js";
import { waCreds } from "../integrations/meta/client.js";
import { wzOn, wzMedia } from "../channels/wazzapo.js";
import { waRoute } from "../channels/index.js";

export const MEDIA_MAX = 100 * 1024 * 1024; // у Green-API файлы до 100 МБ
// открываются в браузере; остальное — скачивание
const INLINE = /^(image\/(jpeg|png|webp|gif|heic|heif)|audio\/[a-z0-9.+-]+|video\/(mp4|3gpp|quicktime|webm|mpeg)|application\/pdf)$/i;
const RISKY = /\.(html?|xhtml|svg|js|mjs|exe|msi|bat|cmd|com|scr|vbs|ps1|jar|apk|app|dmg|sh|php)$/i;

/** Тип и как отдавать: { type, inline }. @param {string} type @param {string} [name] */
export function mediaKind(type, name) {
  const t = String(type || "").split(";")[0].trim().toLowerCase();
  if (name && RISKY.test(name)) return { type: "application/octet-stream", inline: false };
  return INLINE.test(t) ? { type: t, inline: true } : { type: "application/octet-stream", inline: false };
}
/** Имя для «Сохранить как»: без путей и кавычек. @param {any} name @param {string} kind */
export const fileName = (name, kind) => String(name || "").replace(/[\\/"\r\n\u0000-\u001f]/g, "").replace(/^\.+/, "").slice(0, 120) || ({ audio: "voice.ogg", image: "photo.jpg", video: "video.mp4", document: "file" })[kind] || "file";

/** Ответ провайдера → наш ответ браузеру. @param {Response} r @param {any} m реплика.m */
function relay(r, m) {
  const len = +(r.headers.get("content-length") || 0);
  if (len > MEDIA_MAX) return null;
  const k = mediaKind(r.headers.get("content-type") || m.mime || "", m.name);
  const h = new Headers({ "content-type": k.type, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'", "accept-ranges": "bytes",
    "content-disposition": `${k.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(fileName(m.name, m.k))}` });
  for (const x of ["content-length", "content-range"]) { const v = r.headers.get(x); if (v) h.set(x, v); }
  return new Response(r.body, { status: r.status === 206 ? 206 : 200, headers: h });
}
/** @param {string} url @param {string} range @param {Record<string, string>} [auth] */
async function get(url, range, auth) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("bad url");
  return fetch(u.href, { headers: { ...(auth || {}), ...(range ? { range } : {}) } });
}

/**
 * @param {Env} env @param {string} cid @param {string} ch @param {string} chatDigits @param {any} p профиль чата @param {any} t реплика с файлом @param {string} range заголовок Range браузера
 * @returns {Promise<{ ok: true, res: Response } | { ok: false, why: "gone" | "big" | "error" }>}
 */
export async function mediaFile(env, cid, ch, chatDigits, p, t, range) {
  const m = t.m || {};
  try {
    if (ch === "ga") {
      if (m.url) {
        const r = await get(m.url, range).catch(() => null);
        if (r && (r.ok || r.status === 206)) { const x = relay(r, m); return x ? { ok: true, res: x } : { ok: false, why: "big" }; }
        if (r) r.body && r.body.cancel();
      }
      // старая ссылка не открылась — новая у Green-API по номеру сообщения
      const gr = gaRoute(env, cid) || gaShared(env);
      if (!gr || !m.id) return { ok: false, why: "gone" };
      const d = await gaCall(gr, "downloadFile", { chatId: chatDigits + "@c.us", idMessage: m.id }, 10000);
      if (!d.ok) return { ok: false, why: d.status === 500 || d.status === 400 ? "gone" : "error" };
      const u = String((d.j && d.j.downloadUrl) || "");
      if (!/^https:\/\//.test(u)) return { ok: false, why: "gone" };
      const r = await get(u, range);
      if (!(r.ok || r.status === 206)) return { ok: false, why: "gone" };
      const x = relay(r, m); return x ? { ok: true, res: x } : { ok: false, why: "big" };
    }
    if (m.url) { // старые записи Meta: ссылка была сохранена
      const r = await get(m.url, range);
      if (!(r.ok || r.status === 206)) return { ok: false, why: "gone" };
      const x = relay(r, m); return x ? { ok: true, res: x } : { ok: false, why: "big" };
    }
    const route = waRoute(env, cid, p); if (!route || !m.id) return { ok: false, why: "gone" };
    const token = waCreds(env, route).token;
    if (wzOn(env, cid)) { // номер через партнёра Meta Wazzapo: файл отдаёт их API
      const r = await wzMedia(env, token, m.id); if (!r) return { ok: false, why: "gone" };
      const x = relay(r, m); return x ? { ok: true, res: x } : { ok: false, why: "big" };
    }
    const meta = await fetch(`${GRAPH}/${encodeURIComponent(m.id)}`, { headers: { authorization: "Bearer " + token } });
    if (!meta.ok) return { ok: false, why: "gone" };
    const mu = String((/** @type {any} */ (await meta.json())).url || ""); if (!/^https:\/\//.test(mu)) return { ok: false, why: "gone" };
    const r = await get(mu, range, { authorization: "Bearer " + token });
    if (!(r.ok || r.status === 206)) return { ok: false, why: "gone" };
    const x = relay(r, m); return x ? { ok: true, res: x } : { ok: false, why: "big" };
  } catch (e) { console.log("media", String(e).slice(0, 120)); return { ok: false, why: "error" }; }
}
