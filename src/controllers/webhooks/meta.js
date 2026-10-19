// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 3)
// Вебхуки и обработчики сообщений WhatsApp (Meta Cloud API) и общая логика текста/медиа для обоих каналов.
import { CLIENTS, hasClient } from "../../config/builtin-clients.js";
import { MAX_LEN, WA_BATCH } from "../../config/constants.js";
import { normPhone, redact, maskPhones } from "../../lib/phone.js";
import { snip } from "../../lib/text.js";
import { metaSigOk } from "../../lib/crypto.js";
import { ipKey } from "../../services/booking/limits.js";
import { fixedOf, nicheOf, seenBefore, waCoex, markOptout, botOff } from "../../services/channels/index.js";
import { sendWA } from "../../services/channels/meta.js";
import { waSignal, waFailed } from "../../services/broadcast/holds.js";
import { notifyOnce } from "../../services/notifications/telegram.js";
import { thinkSafe, dropAsk, STOP } from "../../services/conversation/orchestrator.js";
import { consentText, fallbackText, mediaReply } from "../../services/conversation/fallbacks.js";
import { detectLang } from "../../services/conversation/language.js";
import { readHist, putHist, logTurns, waErr, notify } from "../../services/channels/deps.js";
/** @import { Env } from "../../lib/types.js" */

export { consentText }; // текст согласия на трёх языках — services/conversation/fallbacks.js

const hooks = new Map(); // вебхук без подписи: запросов в минуту с адреса
/** @param {any} request */
export const hookBurst = request => {
  const ip = ipKey(request.headers.get("cf-connecting-ip") || "local"), now = Date.now(), b = (hooks.get(ip) || []).filter(/** @param {number} t */ t => now - t < 60e3);
  b.push(now); hooks.set(ip, b); if (hooks.size > 2000) hooks.clear();
  return b.length > 30;
};

export const MENU = Object.values(CLIENTS).filter(c => !c.hidden);
export const MENU_TEXT = "Это демо AI-администратора. Выберите бизнес, и я отвечу как его администратор:\n" +
  MENU.map((c, i) => `${i + 1} — ${c.name} (${c.kind})`).join("\n") + "\n\nНапишите цифру. Сменить бизнес: «меню».";

// Общая логика WhatsApp: channel = "wa" (Meta) или "ga" (Green-API). send(text) — отправка ответа.

// Ответ бота не дошёл до клиента: сигнал в Telegram уходит раз в 10 минут на бизнес, поэтому каждый такой чат ещё и помечается в пульте —
// иначе клиенты, которым ответ не дошёл после первого сигнала, остались бы без ответа и без пометки
/** @param {Env} env @param {string} channel @param {string} fromDigits @param {any} wx @param {(t: string) => Promise<any>} send @returns {(t: string) => Promise<any>} */
export const watchSend = (env, channel, fromDigits, wx, send) => async t => {
  const r = await send(t);
  if (r && r.ok === false) {
    try {
      const niche = await nicheOf(env, channel, fromDigits, wx);
      if (niche) await logTurns(env.KV, `h:${channel}:${niche}:${fromDigits}`, [], p => { if (!p.stop) p.need = { at: Date.now(), why: "send" }; });
    } catch (e) { console.log("unsent mark", String(e)); }
  }
  return r;
};

// Сбой хранилища или сети не должен оставить клиента WhatsApp без ответа, а администратора — без сигнала
/** @param {Env} env @param {any} channel @param {any} fromDigits @param {any} text @param {any} send @param {any} wx */
export async function handleWAText(env, channel, fromDigits, text, send, wx) {
  const phone = normPhone(fromDigits) || "+" + fromDigits;
  let sent = false;
  /** @param {any} t */
  const say = async t => { await send(t); sent = true; };
  try { return await waText(env, channel, fromDigits, text, say, phone, wx); }
  catch (/** @type {any} */ e) {
    console.log("wa text", String((e && e.stack) || e));
    if (!sent) { try { await send(fallbackText(detectLang(text, ""))); } catch (e2) { console.log("wa send", String(e2)); } }
    try { await notifyOnce(env, "wa:" + fromDigits, `⚠️ Сбой бота в WhatsApp — клиент мог не получить ответ, ответьте ему сами\n${phone}\nСообщение: «${redact(String(text)).slice(0, 200)}»\n${String(e).slice(0, 200)}`, wx && wx.client); } catch (e2) {}
  }
}
/** @param {Env} env @param {any} channel @param {any} fromDigits @param {any} text @param {any} send @param {any} phone @param {any} wx */
export async function waText(env, channel, fromDigits, text, send, phone, wx) {
  const fixed = fixedOf(env, channel, wx);
  const nicheKey = `wa:niche:${channel}:${fromDigits}`;
  const consentKey = wx && wx.client ? `consent:${channel}:${wx.client}:${fromDigits}` : `consent:${channel}:${fromDigits}`; // у каждой компании своё согласие
  let niche = await nicheOf(env, channel, fromDigits, wx);
  const histKey = () => `h:${channel}:${niche}:${fromDigits}`;

  if (niche && CLIENTS[niche] && botOff(env, CLIENTS[niche], channel)) { // бот выключен владельцем: сообщение ложится в пульт чатов, отвечает администратор; до «меню» и согласия — бот не пишет ничего
    const now = Date.now();
    if (STOP.test(text)) await markOptout(env, niche, fromDigits); // «стоп» на рассылку записываем и при выключенном боте
    await logTurns(env.KV, histKey(), [{ role: "user", text: maskPhones(redact(String(text).slice(0, MAX_LEN))), t: now }], p => { p.li = now; p.need = { at: now, why: "off" }; if (!p.phone) p.phone = phone; if (wx && wx.name && !p.waName) p.waName = snip(wx.name, 40); });
    try { await notifyOnce(env, "off:" + niche + ":" + fromDigits, `✉️ Бот выключен, клиент пишет в WhatsApp — ответьте ему в пульте чатов — ${CLIENTS[niche].name}\n${phone}\nСообщение: «${redact(String(text)).slice(0, 300)}»`, niche); } catch (e) {}
    return;
  }
  if (/^(меню|menu|сброс|reset|\/start)$/i.test(text)) {
    if (niche) {
      // разговор начинается заново, но то, что уже сделано, бот помнит: записи, заявки и ограничения. Паузу и «стоп» эта команда клиента снимает
      const p = ((await readHist(env, histKey())) || {}).profile || {}, /** @type {Record<string, any>} */ keep = {};
      // forgot — отметка «Очистить память бота»: без неё старые заявки возвращались бы в чат, а очистка из ключа fg:… стёрла бы то, что «сброс» оставляет
      for (const k of ["bookings", "pend", "gone", "cbAt", "adminLeads", "delFails", "booked", "leadId", "leadSig", "day", "hoAt", "req", "unk", "name", "phone", "waName", "need", "forgot"]) if (p[k] !== undefined && p[k] !== null) keep[k] = p[k];
      if (Object.keys(keep).length) await putHist(env.KV, histKey(), { n: 0, turns: [], profile: keep });
      else await env.KV.delete(histKey());
    }
    if (hasClient(fixed)) return send("Диалог начат заново. " + CLIENTS[fixed].greeting);
    await env.KV.delete(nicheKey);
    return send(MENU_TEXT);
  }
  if (!niche) {
    const n = +text.trim();
    const pick = MENU[n - 1] || MENU.find(c => text.toLowerCase().includes(c.kind.split(" ")[0].slice(0, 6)));
    if (!pick) return send(MENU_TEXT);
    await env.KV.put(nicheKey, pick.id, { expirationTtl: 30 * 86400 });
    await env.KV.put(consentKey, "1", { expirationTtl: 30 * 86400 });
    return send(`${pick.greeting}\n\n${consentText(env, pick)}`);
  }
  /** @type {any[]} */ const later = [];
  // без подписи Meta бот сам в расписание не записывает; в официальном WhatsApp переписки на телефоне нет — сообщения клиента, пока бот молчит, пересылаются администратору
  const r = /** @type {any} */ (await thinkSafe(env, env.KV, niche, histKey(), text, channel === "ga" ? "WhatsApp" : "WhatsApp API", { channel: "wa", phone, untrusted: channel === "wa" && !(wx && wx.client ? wx.signed : env.APP_SECRET), forward: channel === "wa", waName: (wx && wx.name) || "", pnid: (wx && wx.pnid) || "", origin: (wx && wx.origin) || "", defer: /** @param {any} f */ f => later.push(f) }));
  try {
    if (r.paused) return; // клиентом занимается администратор — бот молчит
    if (r.isNew) {
      let known = false; // сбой хранилища на отметке о согласии не должен оставить клиента без ответа
      try { known = !!(await env.KV.get(consentKey)); if (!known) await env.KV.put(consentKey, "1", { expirationTtl: 30 * 86400 }); } catch (e) { console.log("consent", String(e)); }
      if (!known) await send(consentText(env, CLIENTS[niche], detectLang(text, ""))); // на языке первого сообщения клиента
    }
    if (r.reply) await send(r.reply);
  } finally { await Promise.allSettled(later.map(/** @param {any} f */ f => f())); } // уведомления администратору — после ответа клиенту
}

// Голосовые, фото, файлы, геолокация, стикеры: вежливый ответ + уведомление администратору
/** @type {Record<string, string>} */
export const MEDIA_LABEL = { audio: "🎤 Голосовое", image: "🖼 Фото", video: "🎬 Видео", document: "📄 Файл", location: "📍 Геолокация", contact: "👤 Контакт" };
/** @type {Record<string, string>} */
export const MEDIA_WORD = { audio: "голосовое сообщение", image: "фото", video: "видео", document: "файл", location: "геолокацию", contact: "контакт" };
/** @param {Env} env @param {any} channel @param {any} fromDigits @param {any} kind @param {any} link @param {any} caption @param {any} send @param {any} wx @param {any} media */
export async function handleWAMedia(env, channel, fromDigits, kind, link, caption, send, wx, media) {
  const niche = await nicheOf(env, channel, fromDigits, wx);
  if (!niche) return send(MENU_TEXT);
  const c = CLIENTS[niche];
  const hk = `h:${channel}:${niche}:${fromDigits}`;
  let h = null; try { h = await readHist(env, hk); } catch (e) { console.log("history read", String(e)); }
  const paused = h?.profile?.pausedUntil > Date.now();
  if (kind !== "sticker" && (!paused || h.profile.stop || channel === "wa")) { // на паузе администратор сам видит чат — кроме «стоп» и официального WhatsApp, где переписки на телефоне нет
    try {
      const tk = `nt:${channel}:${fromDigits}`; // не чаще раза в 2 минуты на чат
      if (!(await env.KV.get(tk))) {
        await env.KV.put(tk, "1", { expirationTtl: 120 });
        const phone = normPhone(fromDigits) || "+" + fromDigits;
        await notify(env, `${MEDIA_LABEL[kind] || "Сообщение"} от клиента — ${c.name}\n${phone}${caption ? `\nПодпись: «${caption.slice(0, 200)}»` : ""}${link ? `\n${link}` : ""}`, c.id);
      }
    } catch (e) { console.log("media note", String(e)); }
  }
  // что прислал клиент, остаётся в истории чата: администратор видит это в пульте (и может открыть файл), а ИИ знает, что клиент что-то присылал
  const now = Date.now(), m = { k: kind, ...(media && media.id ? { id: String(media.id).slice(0, 120) } : {}), ...(media && media.mime ? { mime: String(media.mime).slice(0, 60) } : {}), ...(link ? { url: String(link).slice(0, 500) } : {}) };
  const inTurn = kind === "sticker" ? null : { role: "user", text: `[клиент прислал ${MEDIA_WORD[kind] || "сообщение"}]`, t: now, m };
  /** @param {any} reply */
  const note = async (reply) => {
    if (!inTurn) return;
    try {
      await logTurns(env.KV, hk, reply ? [inTurn, { role: "model", text: reply, t: now }] : [inTurn], p => {
        delete p.cxAsk; delete p.mvAsk; // бот спросил «Отменить запись …?», а клиент ответил голосовым или картинкой: вопрос снимается, следующее «ок» записи не удалит
        p.li = now; if (!p.stop) p.need = { at: now, why: paused ? "human" : "media" };
        if (wx && wx.name && !p.waName) p.waName = snip(wx.name, 40);
      });
    } catch (e) { console.log("history", String(e)); }
  };
  if ((paused || botOff(env, c, channel)) && !caption) return note(""); // бот выключен — файл виден в пульте, ответ не уходит
  if (caption) { await note(""); return handleWAText(env, channel, fromDigits, caption, send, wx); }
  const reply = mediaReply(kind, (h && h.profile && h.profile.lang) || "ru"); // на языке чата
  if (kind === "sticker" && (h?.profile?.cxAsk || h?.profile?.mvAsk)) { try { await dropAsk(env.KV, hk); } catch (e) { console.log("history", String(e)); } }
  await note(reply);
  return send(reply);
}


// --- Meta WhatsApp Cloud API (официальный, для боевых клиентов)
// В одном запросе Meta может прислать несколько сообщений (разных клиентов и одного клиента подряд) — обрабатываем все:
// разных клиентов — одновременно, сообщения одного клиента — по порядку.

/** @param {any} body @param {Env} env @param {any} wx */
export async function handleWhatsApp(body, env, wx = /** @type {any} */ ({})) {
  const jobs = [];
  for (const entry of (body && body.entry) || []) for (const ch of (entry && entry.changes) || []) {
    const val = (ch && ch.value) || {};
    if (ch && (ch.field === "smb_message_echoes" || ch.field === "history")) { // режим «сосуществование»: сообщения, написанные с телефона в приложении WhatsApp Business, и история чатов
      if (wx.signed) { try { await waCoex(env, wx, String(ch.field), val); } catch (/** @type {any} */ e) { console.log("wa coex", String((e && e.stack) || e)); } }
      continue;
    }
    if (ch && ch.field && ch.field !== "messages") { // не сообщение, а сигнал Meta: шаблон приостановлен, аккаунт ограничен, человек запретил рекламу
      if (wx.signed) { try { await waSignal(env, wx, String(ch.field), val); } catch (/** @type {any} */ e) { console.log("wa signal", String((e && e.stack) || e)); } } // без подписи Meta сигналам не верим: иначе посторонний мог бы «отписать» всю базу или остановить рассылки
      continue;
    }
    const fails = (val.statuses || []).filter(/** @param {any} st */ st => st && st.status === "failed").map(/** @param {any} st */ st => { const e = (st.errors || [])[0] || {}; return { code: +e.code || 0, to: String(st.recipient_id || "").replace(/\D/g, ""), e }; });
    if (fails.length) {
      const e = fails[0].e;
      await waErr(env, "доставка", e.code, e.title || e.message, e.error_data?.details);
      if (wx.signed) { try { await waFailed(env, wx, fails); } catch (/** @type {any} */ x) { console.log("wa failed", String((x && x.stack) || x)); } }
    }
    const names = new Map((val.contacts || []).map(/** @param {any} k */ k => [k && k.wa_id, (k && k.profile && k.profile.name) || ""]));
    const pnid = (val.metadata && val.metadata.phone_number_id) || "";
    for (const msg of val.messages || []) if (msg && msg.from && msg.id) jobs.push({ msg, wx: { ...wx, pnid: wx.pnid || pnid, name: names.get(msg.from) || "" } });
  }
  if (!jobs.length) return;
  const bySender = new Map();
  jobs.slice(0, WA_BATCH).forEach(j => bySender.set(j.msg.from, (bySender.get(j.msg.from) || []).concat([j])));
  await Promise.allSettled([...bySender.values()].map(async list => {
    for (const j of list) { try { await handleWAMessage(env, j.msg, j.wx); } catch (/** @type {any} */ e) { console.log("wa msg", String((e && e.stack) || e)); } }
  }));
  for (const j of jobs.slice(WA_BATCH)) { // «стоп» из хвоста пачки фиксируем у всех, даже у тех, кого бот не обрабатывает
    const m = j.msg, t = m.type === "text" ? (m.text?.body || "") : m.type === "button" ? (m.button?.text || "") : "";
    if (t && STOP.test(t.trim())) { try { const niche = await nicheOf(env, "wa", m.from, j.wx); if (niche) await markOptout(env, niche, String(m.from).replace(/\D/g, "")); } catch (e) { console.log("wa optout", String(e)); } }
  }
  const rest = jobs.slice(WA_BATCH, WA_BATCH + 60);
  if (rest.length) { // на эти сообщения бот не отвечает (лимиты одного запроса), но они не теряются: лежат в чатах и помечены для администратора
    for (const j of rest) {
      try {
        if (await seenBefore(env, j.msg.id)) continue;
        const niche = await nicheOf(env, "wa", j.msg.from, j.wx);
        if (!niche) continue;
        const t = j.msg.type === "text" ? (j.msg.text?.body || "") : j.msg.type === "button" ? (j.msg.button?.text || "") : `[${j.msg.type}]`, now = Date.now();
        await logTurns(env.KV, `h:wa:${niche}:${j.msg.from}`, [{ role: "user", text: maskPhones(redact(String(t).slice(0, MAX_LEN))), t: now }], p => { p.li = now; p.need = { at: now, why: "limit" }; if (j.wx.name && !p.waName) p.waName = snip(j.wx.name, 40); });
      } catch (e) { console.log("wa rest", String(e)); }
    }
    try { await notifyOnce(env, "waburst:" + (wx.client || ""), `⚠️ В WhatsApp пришло сразу ${jobs.length} сообщений — на ${jobs.length - WA_BATCH} бот не ответил. Они лежат в пульте чатов с пометкой — ответьте клиентам сами.`, wx.client); } catch (e) {}
  }
}
/** @param {Env} env @param {any} msg @param {any} wx */
export async function handleWAMessage(env, msg, wx) {
  if (await seenBefore(env, msg.id)) return;
  const from = String(msg.from).replace(/\D/g, ""), send = watchSend(env, "wa", from, wx, t => sendWA(env, from, t, wx));
  if (!from) return;
  if (msg.type === "text") return handleWAText(env, "wa", from, (msg.text?.body || "").trim(), send, wx);
  // нажатие кнопки в шаблоне рассылки («Записаться») или в интерактивном сообщении — это ответ клиента: обрабатываем как текст
  const pressed = msg.type === "button" ? msg.button?.text || msg.button?.payload : msg.type === "interactive" ? msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title : "";
  if (pressed) return handleWAText(env, "wa", from, String(pressed).trim(), send, wx);
  /** @type {Record<string, string>} */
  const kinds = { audio: "audio", voice: "audio", image: "image", video: "video", document: "document", sticker: "sticker", location: "location", contacts: "contact" };
  if (kinds[msg.type]) { const o = msg[msg.type] || {}; return handleWAMedia(env, "wa", from, kinds[msg.type], null, (o.caption || "").trim(), send, wx, { id: o.id || "", mime: o.mime_type || "" }); }
  // реакции и прочее — без ответа
}

// Вебхук WhatsApp клиента со своим номером и своим приложением Meta: https://<воркер>/wa/<id>.
// Подпись проверяется секретом APP_SECRET_<ID>, ответ уходит с токеном WA_TOKEN_<ID> с того номера, на который написали. Без секрета сообщения не принимаем
/** @param {any} request @param {Env} env @param {any} ctx @param {any} id @param {any} origin */
export async function handleWAClient(request, env, ctx, id, origin) {
  if (request.method !== "POST") return new Response("OK"); // проверку адреса (hub.mode=subscribe) обрабатывает общий блок выше
  if (!hasClient(id)) return new Response("Unknown client", { status: 404 });
  const secret = env["APP_SECRET_" + id.toUpperCase()], raw = await request.text();
  if (!secret) return new Response("APP_SECRET is not set for this client", { status: 403 });
  if (!(await metaSigOk(secret, raw, request.headers.get("x-hub-signature-256")))) return new Response("Bad signature", { status: 403 });
  let body = null; try { body = JSON.parse(raw); } catch (e) {}
  if (body) ctx.waitUntil(handleWhatsApp(body, env, { client: id, signed: true, origin }).catch(err => console.log("wa error", err)));
  return new Response("OK");
}
