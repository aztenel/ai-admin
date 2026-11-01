// @ts-check
// Пульт чатов: HTTP-контроллер /api/inbox/* (список, чат, ответ, файл клиенту, действия, файлы, заявки).
import { jsonP, sameOrigin, readCapped } from "../lib/http.js";
import { clean, snip } from "../lib/text.js";
import { normPhone } from "../lib/phone.js";
import { isoDay } from "../lib/time.js";
import { CLIENTS, hasClient } from "../config/builtin-clients.js";
import { PAUSE_MS, HIST_KEEP } from "../config/constants.js";
import { canSee } from "../services/auth/access.js";
import { CHAT_ID, NEED_TEXT } from "../services/inbox/chat.js";
import { leadPatch } from "../services/inbox/leads.js";
import { eraseClient } from "../services/inbox/erase.js";
import { loadLeads, allLeads, leadTs, logTurns, forgetChat, readForgot, applyForget, histGet, gaRoute, gaWhy, WA_HINT } from "../services/inbox/deps.js";
import { stFresh } from "../services/inbox/status.js";
import { sendGreen } from "../services/channels/greenapi.js";
import { sendWA } from "../services/channels/meta.js";
import { waRoute, waBotOff, botOff } from "../services/channels/index.js";
import { altLabel } from "../services/booking/replies.js";
import { altLoc } from "../services/booking/book.js";
import { growthReport } from "../services/digest.js";
import { mediaFile } from "../services/inbox/media.js";
import { siteConf } from "../services/sitebook/config.js";
import { siteCatalog } from "../services/sitebook/catalog.js";
import { siteTimes } from "../services/sitebook/slots.js";
import { bookingCard } from "../services/inbox/booking-card.js";
import { linesOf, lineLabel, lineChans, opsOf } from "../services/inbox/lines.js";
import { opName, opWho } from "../services/inbox/operator.js";
import { chatAudit, chatTouchOp } from "../services/inbox/audit.js";
import { FILE_MAX, FILE_WORD, TOO_BIG, NO_FILES, QUOTE_GONE, BUSY, UNKNOWN_SENT, filePlan, quoteOf, quoteView, gaSendFile, sendOnce, sendDbOff } from "../services/inbox/send.js";
import { isPreview, PREVIEW_SEND } from "../lib/stage.js";
/** @import { Env } from "../lib/types.js" */

// кто вошёл и что показать в шапке пульта (ТЗ v3.0, 31.10.2026): оформление компании (brand: «winchester» — фирменные цвета, у
// остальных — нейтральные), тестовая это версия или боевой сайт (stage) и режим записи с сайта (site: off — выключена, dry —
// проверка без записи, заявки администратору, live — настоящая запись). Сотрудник — только о своей компании; владелец — brand null,
// а оформление каждой компании — в brands. Секретов и ключей здесь нет
/** @param {Env} env @param {any} s */
export function inboxMe(env, s) {
  const staff = s.role === "staff", ids = staff ? (hasClient(s.cid) ? [s.cid] : []) : Object.keys(CLIENTS);
  const brands = /** @type {Record<string, string>} */ ({}), site = /** @type {Record<string, string>} */ ({});
  for (const id of ids) {
    const c = CLIENTS[id];
    if (c.brand) brands[id] = String(c.brand);
    const sc = siteConf(env, c);
    if (sc) site[id] = sc.mode;
  }
  return { owner: !staff, c: staff ? s.cid : "", brand: staff ? brands[s.cid] || null : null, brands, stage: env.STAGE === "preview" ? "preview" : "production", site };
}

// ================= ПУЛЬТ ЧАТОВ: администратор видит переписку и отвечает клиенту сам =================
// У официального WhatsApp нет приложения на телефоне: без пульта администратору негде ответить клиенту, а бот обещает именно это («он ответит вам здесь»).
// Список чатов — один запрос KV.list (метаданные ключей истории), чат — одно чтение ключа. Ответ администратора уходит через тот же номер, бот в этом чате замолкает на 2 часа.
/** @param {Request} request @param {Env} env @param {URL} url @param {any} s @param {any} [ctx] */
export async function inboxApi(request, env, url, s, ctx) {
  const P = url.pathname, M = request.method, q = url.searchParams;
  // файл клиенту: тело — сам файл (multipart), поэтому компания и чат — в адресе, а тело читается только после проверки прав
  const isFile = M === "POST" && P === "/api/inbox/send-file", jb = M === "POST" && !isFile;
  /** @type {Record<string, any>} */
  let b = {};
  if (M === "POST") { if (!sameOrigin(request, url)) return jsonP({ error: "Запрос отклонён." }, 403); if (jb) { try { b = (await request.json()) || {}; } catch (e) {} } }
  const cid = String((jb ? b.c : q.get("c")) || "");
  if (!hasClient(cid) || !canSee(s, cid)) return jsonP({ error: "Нет доступа к этому клиенту." }, 403);
  const c = CLIENTS[cid], now = Date.now();

  if (M === "GET" && P === "/api/inbox/report") { // итоги за 30 дней и сравнение с прошлыми 30 днями («Итоги» в пульте)
    try { return jsonP(await growthReport(env, c, now)); } catch (e) { return jsonP({ error: "Сервер не отвечает. Попробуйте обновить через минуту." }, 503); }
  }
  if (M === "GET" && P === "/api/inbox/list") {
    const chans = q.get("ch") === "web" ? ["web"] : env.GA_ID || gaRoute(env, cid) ? ["wa", "ga"] : ["wa"], rows = [];
    let more = false;
    for (const ch of chans) {
      const prefix = `h:${ch}:${cid}:`;
      for (let cursor, page = 0; page < 3; page++) { // до 3000 чатов на канал
        let r; try { r = await env.KV.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) }); } catch (e) { return jsonP({ error: "Сервер не отвечает. Попробуйте обновить через минуту." }, 503); }
        for (const k of (r && r.keys) || []) {
          const m = k.metadata || {}, id = String(k.name).slice(prefix.length);
          if (!/** @type {any} */ (CHAT_ID)[ch].test(id)) continue;
          rows.push({ ch, id, t: m.t || 0, li: m.li || 0, s: m.s || "", d: m.d || "", nm: m.nm || "", ph: ch === "web" ? m.ph || "" : "+" + id, nd: m.nd || "", pu: m.pu > now ? m.pu : 0, st: m.st ? 1 : 0, bk: m.bk || 0,
            ...(m.tp ? { tp: m.tp } : {}), ...(m.rs ? { rs: m.rs } : {}), ...(m.as ? { as: m.as } : {}), ...(m.dn ? { dn: 1 } : {}), ...(m.ls ? { ls: m.ls } : {}) });
        }
        if (!r || r.list_complete || !r.cursor) break;
        cursor = r.cursor; if (page === 2) more = true;
      }
    }
    rows.sort((a, b2) => (b2.li || b2.t) - (a.li || a.t));
    const need = rows.filter(r => r.nd).length;
    const client = { id: cid, name: c.name, off: waBotOff(env, c), ...(chans.length === 2 && env["WA_TOKEN_" + cid.toUpperCase()] ? { two: true, offGa: botOff(env, c, "ga") } : {}) };
    if (q.get("v") === "2") {
      // новый пульт (ТЗ v2.0 §2.1): все чаты, где клиент писал (до 1000), и отдельно — сколько чатов только с нашими сообщениями
      // (напоминания, ответы с телефона без ответа клиента): раньше они занимали 200 мест списка и вытесняли настоящие переписки
      const inb = rows.filter(r => r.li || r.d === "u" || r.nd), out = rows.filter(r => !(r.li || r.d === "u" || r.nd));
      const lines = await linesOf(env, cid, lineChans(env, cid), ctx);
      return jsonP({ client, lines, ops: await opsOf(env, cid), need, total: inb.length, outOnly: out.length, more: more || inb.length > 1000,
        chats: (q.get("f") === "out" ? out.slice(0, 300) : inb.slice(0, 1000)), now });
    }
    return jsonP({ client, need, total: rows.length, more, chats: (q.get("f") === "need" ? rows.filter(r => r.nd) : rows).slice(0, 200), now });
  }

  // свободное время из Altegio прямо в пульте (ТЗ v2.0 §7, «Посмотреть время»): те же расчёты, что у записи с сайта (мастер, услуги,
  // помещается ли услуга целиком) — только чтение, ничего не записывается
  if (M === "GET" && (P === "/api/inbox/catalog" || P === "/api/inbox/times")) {
    const conf = siteConf(env, c);
    if (!conf || !env.ALTEGIO_PARTNER || !(conf.loc > 0)) return jsonP({ available: false, why: "Свободное время видно у компании с онлайн-записью Altegio." });
    try {
      const r = P === "/api/inbox/catalog" ? await siteCatalog(env, c, conf, now) : await siteTimes(env, c, conf, q, now);
      return jsonP({ available: true, ...(r.res || {}) }, r.http === 200 ? 200 : r.http || 502);
    } catch (e) { console.log("inbox times", String(e).slice(0, 120)); return jsonP({ error: "Altegio сейчас не ответил. Попробуйте через минуту." }, 502); }
  }
  if (M === "GET" && P === "/api/inbox/leads") { // последние заявки клиента для вкладки «Лиды» (те же, что на странице /leads)
    /** @type {any} */
    let leads; try { leads = await allLeads(env, cid); } catch (e) { return jsonP({ error: "Сервер не отвечает. Попробуйте обновить через минуту." }, 503); }
    return jsonP({ leads: leads.slice(-60).reverse().map((/** @type {any} */ l) => ({ id: l.id, name: l.name || "", phone: l.phone || "", service: l.service || "", time: l.time || "", note: l.note || "", status: l.status || "", kind: l.kind || "lead", source: l.source || "", ts: leadTs(l) })), partial: !!leads.unread });
  }

  const ch = String((jb ? b.ch : q.get("ch")) || ""), id = String((jb ? b.id : q.get("id")) || "");
  if (!/** @type {any} */ (CHAT_ID)[ch] || !/** @type {any} */ (CHAT_ID)[ch].test(id)) return jsonP({ error: "Чат не найден." }, 404);
  const hk = `h:${ch}:${cid}:${id}`;
  /** @type {any} */
  let h; try { h = JSON.parse((await histGet(env.KV, hk)) || "null"); } catch (e) { return jsonP({ error: "Сервер не отвечает. Попробуйте ещё раз." }, 503); }
  if (!h) return jsonP({ error: "Чат не найден: переписка хранится 7 дней после последнего сообщения." }, 404);
  // чат очищали, а бот в другом месте сети успел записать копию до очистки: пульт показывает то, что бот будет помнить (19.10.2026)
  const fgAt = await readForgot(env.KV, hk);
  applyForget(h, fgAt);
  let p = h.profile || {};
  // номер Green-API — только свой у компании или общий, закреплённый за ней (gaRoute): чужой общий номер не подставляется (аудит 31.10.2026)
  const gaOn = ch === "ga" && !!gaRoute(env, cid);
  // почему из пульта сейчас нельзя отправить — пульт показывает это заранее, а не после нажатия: черновик клиентам не пишет;
  // второму номеру нужна база для защиты от двойной отправки (без неё Green-API не вызывается)
  const sendOffOf = async () => ch === "web" ? "" : isPreview(env) ? PREVIEW_SEND : ch === "ga" && gaOn ? await sendDbOff(env, now) : "";
  const view = async () => {
    const phone = ch === "web" ? p.phone || "" : "+" + id, sendOff = await sendOffOf();
    const fresh = await stFresh(env, cid, ch, h.turns || [], now); // галочки из D1, если копия переписки здесь ещё старая (01.11.2026)
    /** @type {any[]} */
    let reqs = [];
    if (phone) { try { reqs = (await loadLeads(env.KV, cid)).filter(l => l.phone === (normPhone(phone) || phone) && !l.status && (l.kind || !(l.altegio && l.altegio.record_id))).slice(-6).map(l => ({ id: l.id, kind: l.kind || "lead", name: l.name || "", service: l.service || "", time: l.time || "", note: l.note || "", at: l.at || "" })); } catch (e) {} }
    const open = ch === "ga" ? true : ch === "wa" ? !!p.li && now - p.li < 24 * 3600e3 : false;
    let promo = null; // недавняя рассылка: клиент мог ответить именно на неё
    if (ch !== "web") { try { const bl = JSON.parse((await env.KV.get("bclast:" + cid)) || "null"); if (bl && bl.text) promo = { at: bl.at, name: bl.name || "", text: bl.text }; } catch (e) {} }
    return {
      promo,
      ch, id, phone, name: p.name || "", waName: p.waName || "", turns: (h.turns || []).map((/** @type {any} */ t) => turnView(t && t.mid && fresh.has(String(t.mid)) ? { ...t, st: fresh.get(String(t.mid)), se: undefined } : t, h.turns || [])),
      bookings: (p.bookings || []).map((/** @type {any} */ x) => altLabel(x, "ru", now, true)), pend: (p.pend || []).map((/** @type {any} */ x) => [x.service, x.raw || [x.date, x.time].filter(Boolean).join(" ")].filter(Boolean).join(", ")), booked: !p.bookings && !p.pend ? p.booked || "" : "",
      late: p.late && now - p.late.at < 6 * 3600e3 ? p.late : null,
      need: p.need ? { why: p.need.why, text: p.need.why === "task" ? String(p.need.text || "задача") : /** @type {any} */ (NEED_TEXT)[p.need.why] || "", at: p.need.at || 0, ...(p.need.tp ? { tp: p.need.tp } : {}), ...(p.need.src ? { src: srcView(h.turns || [], p.need.src) } : {}) } : null,
      assignee: (p.as && p.as.n) || "", done: p.done || 0, line: { ch, label: lineLabel(cid, ch, lineChans(env, cid)) },
      audit: (p.audit || []).slice(-12), paused: p.pausedUntil > now ? p.pausedUntil : 0, stop: !!p.stop, off: ch === "web" ? !!c.off : botOff(env, c, ch), // выключатель своего номера: иначе в чате «Ведёт бот», а бот молчит (18.10.2026)
      canSend: ch !== "web" && !sendOff && (ch === "ga" ? gaOn : !!waRoute(env, cid, p)), open, li: p.li || 0, reqs, now, ...(c.pay ? { pay: c.pay } : {}),
      ...(sendOff ? { sendOff } : {}),
      // файлы и ответ на конкретное сообщение — только со второго номера (Green-API): у Meta и чата сайта из пульта этого нет
      canFiles: gaOn && !sendOff, canQuote: gaOn && !sendOff
    };
  };
  if (M === "GET" && P === "/api/inbox/chat") return jsonP(await view());
  if (M === "GET" && P === "/api/inbox/booking") { // ближайшая запись в Altegio — отдельным запросом: журнал может отвечать несколько секунд
    if (ch === "web") return jsonP({ records: [], available: false });
    try { const r = await bookingCard(env, c, "+" + id, now); return jsonP({ records: r || [], available: r !== null }); }
    catch (e) { console.log("booking card", String(e).slice(0, 120)); return jsonP({ error: "Журнал Altegio сейчас не ответил. Попробуйте позже." }, 502); }
  }

  if (M === "GET" && P === "/api/inbox/media") { // файл из чата: голосовое, фото, видео, документ. Только файл этой переписки (services/inbox/media.js)
    const mid = q.get("mid"), t = mid ? (h.turns || []).find((/** @type {any} */ x) => x.m && x.m.id === mid) : (h.turns || [])[+(/** @type {any} */ (q.get("n")))];
    if (!t || !t.m || !(t.m.id || t.m.url)) return jsonP({ error: "Файл не найден." }, 404);
    const r = await mediaFile(env, cid, ch, id, p, t, String(request.headers.get("range") || "").slice(0, 100));
    if (r.ok) return r.res;
    return jsonP({ error: r.why === "big" ? "Файл больше 100 МБ. Откройте его в WhatsApp на телефоне." : r.why === "gone" ? "Файл недоступен: WhatsApp хранит файлы ограниченное время. Попросите клиента прислать его ещё раз." : "Файл сейчас не открылся. Попробуйте ещё раз через минуту." }, r.why === "error" ? 502 : 404);
  }
  if (M !== "POST") return jsonP({ error: "Не найдено." }, 404);

  /** @type {{ blob: Blob, name: string, mime: string, size: number } | null} */
  let file = null;
  // черновик клиентам не пишет ни с какого номера (аудит 31.10.2026): отказ до чтения тела и до обращения к провайдеру
  if ((P === "/api/inbox/send" || isFile) && isPreview(env)) return jsonP({ error: PREVIEW_SEND, code: "preview" }, 409);
  if (isFile) { // со второго номера (Green-API); у Meta и чата сайта отправки файлов из пульта нет — и тело не читаем
    if (ch !== "ga") return jsonP({ error: NO_FILES }, 409);
    if (!gaOn) return jsonP({ error: "Отправка с этого номера не настроена. Её включает владелец в настройках номеров." }, 409);
    const up = await readUpload(request);
    if (!up.ok) return jsonP({ error: up.error }, up.status);
    file = up.file; b = up.fields;
  }

  // ответ администратора клиенту; quote — номер сообщения у Green-API, на которое это ответ
  /** @param {string} text @param {string} [quote] @returns {Promise<{ ok: boolean, id?: string, unknown?: boolean, error?: string }>} */
  const sendTo = async (text, quote) => {
    if (ch === "web") return { ok: false, error: "В чат на сайте ответить нельзя. Позвоните клиенту." };
    if (ch === "ga") { // номер Green-API компании: свой или общий, закреплённый за ней (чужой общий номер — нет, аудит 31.10.2026)
      const gr = gaRoute(env, cid);
      if (!gr) return { ok: false, error: "Второй номер этой компании не подключён к пульту." };
      const r = await sendGreen(env, id + "@c.us", text, gr, true, quote);
      if (r.ok) return { ok: true, id: r.id || "" };
      if (r.code === "ga:net" || r.status >= 500) return { ok: true, unknown: true, error: "" }; // ответа нет, обрыв (499), срок (408), 5xx — сообщение могло уйти: статус «?», само не повторяется
      return { ok: false, error: `Green-API не принял сообщение: ${gaWhy(r, gr)}.` };
    }
    const route = waRoute(env, cid, p);
    if (!route) return { ok: false, error: `WhatsApp этого клиента не подключён: в Cloudflare нет секрета WA_TOKEN_${cid.toUpperCase()}.` };
    if (!(p.li && now - p.li < 24 * 3600e3)) return { ok: false, error: "Клиент писал больше 24 часов назад. WhatsApp разрешает написать первым только готовым шаблоном. Позвоните клиенту или дождитесь его сообщения." };
    let r; try { r = await sendWA(env, id, text, route); } catch (e) { return { ok: false, error: "Не отправилось: " + String(e).slice(0, 120) }; }
    return r && r.ok ? { ok: true, id: String(r.id || "") } : { ok: false, error: "WhatsApp не принял сообщение" + (r && r.code ? ` (код ${r.code})` : "") + (r && WA_HINT[r.code] ? ": " + WA_HINT[r.code] : r && r.error ? ": " + r.error : "") + "." };
  };
  const msg = clean(String(b.text ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " "), 2000);
  const op = opName(b.op), who = opWho(s, op);
  /** реплика сотрудника с номером сообщения у провайдера и статусом (галочки, ТЗ v2.0 §2.3) @param {string} text @param {any} r */
  const adminTurn = (text, r) => ({ role: "model", text, t: now, by: "admin", ...(op ? { op } : {}), ...(r && r.id ? { mid: String(r.id).slice(0, 80), st: "sent" } : r && r.unknown ? { st: "unknown" } : {}) });
  if (M === "POST") await chatTouchOp(env, cid, op, now);
  // ответ остаётся в истории (его увидит и ИИ, когда бот вернётся), бот в этом чате молчит 2 часа, пометка «ждёт ответа» снимается
  /** @param {any} turn @param {{ unknown?: boolean }} r */
  const saveReply = async (turn, r) => {
    let warn = r.unknown ? UNKNOWN_SENT : ""; // ответа на отправку нет: само не повторяется, сотрудник проверяет в WhatsApp
    try { h = await logTurns(env.KV, hk, [turn], pr => { pr.pausedUntil = Math.max(pr.pausedUntil || 0, now + PAUSE_MS); delete pr.need; delete pr.fw; delete pr.cxAsk; delete pr.mvAsk; if (op && !pr.as) pr.as = { n: op, at: now, by: op }; }); }
    catch (e) { console.log("inbox log", String(e)); warn = "Сообщение клиенту ушло, но не сохранилось в переписке (хранилище не ответило). Второй раз не отправляйте."; } // сообщение уже у клиента: ошибка здесь привела бы к повторной отправке
    applyForget(h, fgAt); // ответ пульту — тоже без того, что забыто (копию до очистки мог записать вебхук в другом месте сети)
    p = h.profile || {};
    return jsonP({ ok: true, chat: await view(), ...(warn ? { warn } : {}) });
  };
  // тот же rid второй раз (двойное нажатие, повтор запроса браузером после обрыва): клиенту ничего не уходит, пульт получает переписку
  /** @param {{ dup: string, unknown?: boolean }} r */
  const dupAnswer = async r => r.dup === "busy" ? jsonP({ error: BUSY, code: "busy" }, 409) : jsonP({ ok: true, dup: true, chat: await view(), ...(r.unknown ? { warn: UNKNOWN_SENT } : {}) });
  // отправка не начиналась: нет номера отправки (rid) или базы для защиты от двойной отправки — клиенту ничего не ушло
  /** @param {{ status: number, code: string, error: string }} x */
  const blockedAnswer = x => jsonP({ error: x.error, code: x.code }, x.status);
  const rid = String(b.rid || "").slice(0, 64), quoteId = String(b.quote || "").slice(0, 80);
  // ответ на конкретное сообщение (цитата WhatsApp): только со второго номера и только на сообщение этой переписки
  const qt = quoteId ? quoteOf(h.turns || [], quoteId) : null;
  if ((P === "/api/inbox/send" || isFile) && quoteId) {
    if (!gaOn) return jsonP({ error: "На этом номере ответить на конкретное сообщение нельзя." }, 400);
    if (!qt) return jsonP({ error: QUOTE_GONE }, 400);
  }
  if (P === "/api/inbox/send") {
    if (!msg) return jsonP({ error: "Напишите сообщение." }, 400);
    const r = await sendOnce(env, cid, ch, id, rid, () => sendTo(msg, qt ? qt.mid : ""));
    if ("blocked" in r) return blockedAnswer(r.blocked);
    if ("dup" in r) return dupAnswer(r);
    if (!r.ok) return jsonP({ error: r.error }, 409);
    return saveReply({ ...adminTurn(msg, r), ...(qt ? { qt } : {}) }, r);
  }
  if (isFile && file) {
    const plan = filePlan(file); // опасный тип — по итоговому имени, исходному имени и типу файла
    if (!plan.ok) return jsonP({ error: plan.error }, plan.status);
    const f = file, { kind, name } = plan;
    const r = await sendOnce(env, cid, ch, id, rid, () => gaSendFile(env, cid, id, { blob: f.blob, name }, msg, qt ? qt.mid : ""));
    if ("blocked" in r) return blockedAnswer(r.blocked);
    if ("dup" in r) return dupAnswer(r);
    if (!r.ok) return jsonP({ error: r.error }, 409);
    // файл в истории — как у клиента: вид, имя, тип, размер, номер сообщения (по нему файл открывается в пульте: downloadFile)
    // и ссылка Green-API из ответа на отправку (её пробуем первой). Подпись — текстом реплики; без подписи — служебная строка для ИИ
    const m = { k: kind, name, ...(f.mime ? { mime: f.mime.slice(0, 60) } : {}), size: f.size, ...(r.id ? { id: r.id } : {}), ...("url" in r && r.url ? { url: r.url } : {}) };
    return saveReply({ ...adminTurn(msg || `[сотрудник отправил ${FILE_WORD[kind]}]`, r), m, ...(qt ? { qt } : {}) }, r);
  }
  if (P === "/api/inbox/act") {
    const act = String(b.act || "");
    let actWarn = ""; // «не знаем, ушло ли» у сообщения клиенту при «Отправить клиенту и закрыть»
    if (act === "resolve") {
      if ((await view()).reqs.length) return jsonP({ error: "В чате есть невыполненная просьба клиента (отмена, перенос, заявка или звонок). Нажмите «Сделано» в карточке, тогда чат закроется сам." }, 409);
      if (p.need && !b.force) return jsonP({ confirm: "Клиент ждёт ответа. Закрыть чат без ответа?" }, 409); // ТЗ v2.0 §2.5: закрытие с вопросом — только с подтверждением
      h = await logTurns(env.KV, hk, [], pr => { delete pr.need; pr.done = now; chatAudit(pr, now, who, p.need ? "close-unanswered" : "close"); });
    }
    else if (act === "pause") h = await logTurns(env.KV, hk, [], pr => { pr.pausedUntil = Math.max(pr.pausedUntil || 0, now + 12 * 3600e3); });
    else if (act === "forget") { // бот забывает переписку, записи и просьбы этого чата (например, всё уже сделано в Altegio); окно WhatsApp и «стоп» остаются
      const ph0 = normPhone(p.phone || "") || (ch !== "web" ? normPhone("+" + id) : ""), L0 = altLoc(env, c);
      h = await forgetChat(env.KV, hk, Date.now()); // время очистки — и в чате, и отдельным ключом: копия чата из другого места сети её не затрёт
      if (L0 && ph0) try { await env.KV.delete(`bk:${L0}:${ph0}:${isoDay(Date.now())}`); } catch (e) { console.log("forget limit", String(e)); } // дневной предел записей этого номера — заново
    }
    else if (act === "erase") { // клиент попросил удалить его данные (/privacy): только владелец, отменить нельзя
      if (s.role !== "owner") return jsonP({ error: "Удалить данные клиента может только владелец." }, 403);
      // веб-чат: номер набрал посетитель, он мог быть чужим — удаляем только сам чат, без заявок и согласий по этому номеру (автопроверка безопасности, 17.10.2026)
      const ph = ch === "web" ? "" : normPhone("+" + id);
      try { const r = await eraseClient(env, cid, ch, id, ph, String(altLoc(env, c) || ""), now); return jsonP({ ok: true, erased: true, leads: r.leads }); }
      catch (e) { console.log("erase", String(e)); return jsonP({ error: "Сервер не ответил, удалено не всё. Нажмите ещё раз через минуту." }, 503); }
    }
    else if (act === "take" || act === "assign") { // кто ведёт чат: «Взять себе» — имя этого устройства, «Назначить» — имя из списка
      const to = act === "take" ? op : opName(b.to);
      if (act === "take" && !to) return jsonP({ error: "Укажите своё имя в настройках пульта, тогда чат можно взять себе." }, 400);
      h = await logTurns(env.KV, hk, [], pr => { if (to) pr.as = { n: to, at: now, by: who }; else delete pr.as; chatAudit(pr, now, who, act === "take" ? "take" : to ? "assign" : "unassign", act === "take" ? "" : to); });
    }
    else if (act === "reopen") h = await logTurns(env.KV, hk, [], pr => { delete pr.done; chatAudit(pr, now, who, "reopen"); });
    else if (act === "late") { // клиент предупредил об опоздании (ТЗ v2.0 §4 S09, §7): отметка в чате, мастера предупреждает сотрудник сам
      const min = Math.max(0, Math.min(180, Math.round(+b.min || 0)));
      h = await logTurns(env.KV, hk, [], pr => { pr.late = { at: now, min }; chatAudit(pr, now, who, "late", min ? `${min} мин` : ""); });
    }
    else if (act === "task") { // задача по чату — в очереди «Нужен ответ», пока её не закроют «Готово»
      const text = clean(String(b.text || ""), 200);
      if (!text) return jsonP({ error: "Напишите, что нужно сделать." }, 400);
      h = await logTurns(env.KV, hk, [], pr => { pr.need = { at: now, why: "task", text }; delete pr.done; chatAudit(pr, now, who, "task", text.slice(0, 32)); });
    }
    else if (act === "resume") {
      if (p.stop) return jsonP({ error: "Клиент сам попросил не писать ему автоматически. Бот вернётся, когда клиент напишет «старт»." }, 409);
      h = await logTurns(env.KV, hk, [], pr => { delete pr.pausedUntil; delete pr.fw; delete pr.need; });
    } else if (act === "done") {
      // администратор выполнил просьбу клиента (отменил или перенёс запись, подтвердил заявку) и сообщает ему об этом
      const lid = String(b.lead || "");
      let lead = null; try { lead = (await loadLeads(env.KV, cid)).find(l => l.id === lid) || null; } catch (e) {}
      if (!lead || (lead.phone && lead.phone !== (normPhone("+" + id) || p.phone) && lead.phone !== p.phone)) return jsonP({ error: "Заявка не найдена." }, 404);
      // сообщение клиенту при закрытии просьбы — та же защита, что у ответа (аудит 31.10.2026): черновик не отправляет, второй номер —
      // только с rid и отметкой в D1, двойное нажатие «Отправить клиенту и закрыть» второй раз не отправляет
      /** @type {any} */ let sent = null, again = false;
      if (msg) {
        if (isPreview(env)) return jsonP({ error: PREVIEW_SEND, code: "preview" }, 409);
        const r = await sendOnce(env, cid, ch, id, rid, () => sendTo(msg));
        if ("blocked" in r) return blockedAnswer(r.blocked);
        if ("dup" in r) {
          // этот rid уже отправлен (ревью PR №2, F5): клиенту второй раз не пишем, но закрытие заявки и запись в историю доделываем —
          // первый запрос мог упасть после отправки. Уже доделано (реплика с этим rid в истории) — ничего не меняем
          if (r.dup === "busy") return dupAnswer(r);
          sent = { ok: true, ...(r.id ? { id: r.id } : {}), ...(r.unknown ? { unknown: true } : {}) }; again = true;
        } else if (!r.ok) return jsonP({ error: r.error }, 409);
        else sent = r;
      }
      if (sent && sent.unknown) actWarn = UNKNOWN_SENT;
      const turnRid = msg && /^[A-Za-z0-9_-]{6,64}$/.test(rid) ? rid : "";
      if (!(again && lead.status === "выполнена")) await leadPatch(env, cid, lid, { status: "выполнена", note: clean((lead.note ? lead.note + " " : "") + `Выполнил ${who}${msg ? ", клиенту сообщено" : ""}.`, 600) });
      h = await logTurns(env.KV, hk, [], (pr, hh) => {
        if (turnRid && (hh.turns || []).some((/** @type {any} */ t) => t.rid === turnRid)) return; // этот rid уже записан — повтор ничего не дублирует
        if (msg) hh.turns = (hh.turns || []).concat([{ ...adminTurn(msg, sent), ...(turnRid ? { rid: turnRid } : {}) }]).slice(-HIST_KEEP);
        chatAudit(pr, now, who, "done", lead.kind || "lead");
        if (lead.kind === "cancel" || lead.kind === "change") {
          // запись в расписании изменил человек: бот больше не считает прежнюю запись действующей и знает, что сказал клиенту администратор
          const had = (pr.bookings || []).some((/** @type {any} */ x) => x.rq);
          if (pr.bookings) pr.bookings = pr.bookings.filter((/** @type {any} */ x) => had ? !x.rq : false);
          delete pr.req;
          pr.adminDid = { at: now, kind: lead.kind, text: snip(msg || (lead.kind === "cancel" ? "запись отменена" : "запись перенесена"), 300) };
          if (pr.bookings && !pr.bookings.length) delete pr.bookings;
          pr.booked = [(pr.bookings || []).map((/** @type {any} */ x) => altLabel(x, "ru", now, true)).join("; "), `администратор ${lead.kind === "cancel" ? "отменил запись клиента" : "перенёс запись клиента"}${msg ? ` и написал ему: «${snip(msg, 200)}»` : ""}`].filter(Boolean).join(". ");
        }
        else if ((pr.pend || []).some((/** @type {any} */ x) => x.leadId === lid)) {
          // заявку на запись администратор выполнил сам (записал в Altegio вручную): она больше не «ждёт администратора» — иначе бот так и отвечал бы клиенту
          // «Ваша заявка у администратора» (16.10.2026, режим «без записи» у Winchester). Номера записи в Altegio у бота нет — правду покажет журнал
          pr.pend = pr.pend.filter((/** @type {any} */ x) => x.leadId !== lid);
          if (!pr.pend.length) delete pr.pend;
          pr.adminDid = { at: now, kind: "book", text: snip(msg || "запись подтверждена", 300) };
          pr.booked = [(pr.bookings || []).map((/** @type {any} */ x) => altLabel(x, "ru", now, true)).join("; "), `администратор записал клиента: ${snip(`${lead.service || ""}, ${lead.time || ""}`, 200)}${msg ? ` и написал ему: «${snip(msg, 200)}»` : ""}`].filter(Boolean).join(". ");
        }
        if (msg) pr.pausedUntil = Math.max(pr.pausedUntil || 0, now + 10 * 60e3); // короткая пауза: клиент, скорее всего, ответит «спасибо»
        delete pr.need;
      });
    } else return jsonP({ error: "Неизвестное действие." }, 400);
    applyForget(h, fgAt);
    p = h.profile || {};
    return jsonP({ ok: true, chat: await view(), ...(actWarn ? { warn: actWarn } : {}) });
  }
  return jsonP({ error: "Не найдено." }, 404);
}

// реплика для пульта: кто (u — клиент, a — сотрудник, b — бот или автоматическое сообщение), имя сотрудника, файл, статус отправки,
// вид автоматического сообщения (rm — напоминание или отзыв, bc — рассылка), номер сообщения у провайдера (mid — на него можно
// ответить цитатой) и цитата, если реплика — ответ на другое сообщение (q: { mid, x — начало текста, r — чьё })
/** @param {any} t @param {any[]} turns */
function turnView(t, turns) {
  const q = quoteView(turns, t);
  return { r: t.role === "user" ? "u" : t.by === "admin" ? "a" : "b", x: t.text, t: t.t || 0, ...(t.mid ? { mid: String(t.mid) } : {}), ...(q ? { q } : {}),
    ...(t.m ? { m: { k: t.m.k, id: t.m.id || "", f: !!(t.m.id || t.m.url), ...(t.m.name ? { name: String(t.m.name).slice(0, 120) } : {}), ...(t.m.size ? { size: +t.m.size || 0 } : {}), ...(t.m.mime ? { mime: String(t.m.mime).slice(0, 60) } : {}) } } : {}),
    ...(t.op ? { op: t.op } : {}), ...(t.st ? { st: t.st } : {}), ...(t.se ? { se: t.se } : {}), ...(t.rm ? { auto: "service" } : t.bc ? { auto: "campaign" } : {}),
    ...(t.ed ? { ed: 1 } : {}), ...(t.del ? { del: 1 } : {}), ...(t.re ? { re: String(t.re).slice(0, 8) } : {}) };
}
// на что ответил клиент: текст нашего автоматического сообщения (коротко) и когда оно ушло
/** @param {any[]} turns @param {any} src */
function srcView(turns, src) {
  const t = turns.find(x => x && x.role !== "user" && +x.t === +src.at);
  return { k: src.k, at: src.at || 0, text: t ? snip(t.text, 140) : "" };
}

// файл из пульта: multipart/form-data — file, caption, quote, op, rid. Тело читаем сами с пределом: без Content-Length (или с ложным)
// formData() прочитал бы всё целиком
/** @param {Request} request */
async function readUpload(request) {
  const fail = (/** @type {number} */ status, /** @type {string} */ error) => ({ ok: /** @type {const} */ (false), status, error });
  const ct = request.headers.get("content-type") || "";
  if (!ct.startsWith("multipart/form-data")) return fail(400, "Выберите файл.");
  const raw = await readCapped(request, FILE_MAX + 256 * 1024);
  if (!raw) return fail(413, TOO_BIG);
  /** @type {FormData} */ let f;
  try { f = await new Response(/** @type {any} */ (raw), { headers: { "content-type": ct } }).formData(); }
  catch (e) { return fail(400, "Файл не прочитался. Выберите его ещё раз."); }
  const up = /** @type {any} */ (f.get("file"));
  if (!up || typeof up === "string" || typeof up.arrayBuffer !== "function") return fail(400, "Выберите файл.");
  const str = (/** @type {string} */ k) => { const v = f.get(k); return typeof v === "string" ? v : ""; };
  return { ok: /** @type {const} */ (true), file: { blob: /** @type {Blob} */ (up), name: String(up.name || "").slice(0, 200), mime: String(up.type || "").slice(0, 100), size: +up.size || 0 },
    fields: { text: str("caption").slice(0, 4000), quote: str("quote"), op: str("op"), rid: str("rid") } };
}
