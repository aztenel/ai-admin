// @ts-check
// Пульт чатов: HTTP-контроллер /api/inbox/* (список, чат, ответ, действия, файлы, заявки).
import { jsonP, sameOrigin } from "../lib/http.js";
import { clean, snip } from "../lib/text.js";
import { normPhone } from "../lib/phone.js";
import { isoDay } from "../lib/time.js";
import { CLIENTS, hasClient } from "../config/builtin-clients.js";
import { PAUSE_MS } from "../config/constants.js";
import { canSee } from "../services/auth/access.js";
import { CHAT_ID, NEED_TEXT } from "../services/inbox/chat.js";
import { leadPatch } from "../services/inbox/leads.js";
import { eraseClient } from "../services/inbox/erase.js";
import { loadLeads, allLeads, leadTs, logTurns, forgetChat, readForgot, applyForget, gaShared, gaRoute, gaWhy, WA_HINT } from "../services/inbox/deps.js";
import { sendGreen } from "../services/channels/greenapi.js";
import { sendWA } from "../services/channels/meta.js";
import { waRoute, waBotOff, botOff } from "../services/channels/index.js";
import { altLabel } from "../services/booking/replies.js";
import { altLoc } from "../services/booking/book.js";
import { growthReport } from "../services/digest.js";
import { mediaFile } from "../services/inbox/media.js";
import { bookingCard } from "../services/inbox/booking-card.js";
import { linesOf, lineLabel, lineChans, opsOf } from "../services/inbox/lines.js";
import { opName, opWho } from "../services/inbox/operator.js";
import { chatAudit, chatTouchOp } from "../services/inbox/audit.js";
/** @import { Env } from "../lib/types.js" */

// ================= ПУЛЬТ ЧАТОВ: администратор видит переписку и отвечает клиенту сам =================
// У официального WhatsApp нет приложения на телефоне: без пульта администратору негде ответить клиенту, а бот обещает именно это («он ответит вам здесь»).
// Список чатов — один запрос KV.list (метаданные ключей истории), чат — одно чтение ключа. Ответ администратора уходит через тот же номер, бот в этом чате замолкает на 2 часа.
/** @param {Request} request @param {Env} env @param {URL} url @param {any} s @param {any} [ctx] */
export async function inboxApi(request, env, url, s, ctx) {
  const P = url.pathname, M = request.method, q = url.searchParams;
  /** @type {Record<string, any>} */
  let b = {};
  if (M === "POST") { if (!sameOrigin(request, url)) return jsonP({ error: "Запрос отклонён." }, 403); try { b = (await request.json()) || {}; } catch (e) {} }
  const cid = String((M === "POST" ? b.c : q.get("c")) || "");
  if (!hasClient(cid) || !canSee(s, cid)) return jsonP({ error: "Нет доступа к этому клиенту." }, 403);
  const c = CLIENTS[cid], now = Date.now();

  if (M === "GET" && P === "/api/inbox/report") { // итоги за 30 дней и сравнение с прошлыми 30 днями («Итоги» в пульте)
    try { return jsonP(await growthReport(env, c, now)); } catch (e) { return jsonP({ error: "Хранилище не отвечает — попробуйте обновить через минуту." }, 503); }
  }
  if (M === "GET" && P === "/api/inbox/list") {
    const chans = q.get("ch") === "web" ? ["web"] : env.GA_ID || gaRoute(env, cid) ? ["wa", "ga"] : ["wa"], rows = [];
    let more = false;
    for (const ch of chans) {
      const prefix = `h:${ch}:${cid}:`;
      for (let cursor, page = 0; page < 3; page++) { // до 3000 чатов на канал
        let r; try { r = await env.KV.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) }); } catch (e) { return jsonP({ error: "Хранилище не отвечает — попробуйте обновить через минуту." }, 503); }
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

  if (M === "GET" && P === "/api/inbox/leads") { // последние заявки клиента для вкладки «Лиды» (те же, что на странице /leads)
    /** @type {any} */
    let leads; try { leads = await allLeads(env, cid); } catch (e) { return jsonP({ error: "Хранилище не отвечает — попробуйте обновить через минуту." }, 503); }
    return jsonP({ leads: leads.slice(-60).reverse().map((/** @type {any} */ l) => ({ id: l.id, name: l.name || "", phone: l.phone || "", service: l.service || "", time: l.time || "", note: l.note || "", status: l.status || "", kind: l.kind || "lead", source: l.source || "", ts: leadTs(l) })), partial: !!leads.unread });
  }

  const ch = String((M === "POST" ? b.ch : q.get("ch")) || ""), id = String((M === "POST" ? b.id : q.get("id")) || "");
  if (!/** @type {any} */ (CHAT_ID)[ch] || !/** @type {any} */ (CHAT_ID)[ch].test(id)) return jsonP({ error: "Чат не найден." }, 404);
  const hk = `h:${ch}:${cid}:${id}`;
  /** @type {any} */
  let h; try { h = JSON.parse((await env.KV.get(hk)) || "null"); } catch (e) { return jsonP({ error: "Хранилище не отвечает — попробуйте ещё раз." }, 503); }
  if (!h) return jsonP({ error: "Чат не найден: переписка хранится 7 дней после последнего сообщения." }, 404);
  // чат очищали, а бот в другом месте сети успел записать копию до очистки: пульт показывает то, что бот будет помнить (19.10.2026)
  const fgAt = await readForgot(env.KV, hk);
  applyForget(h, fgAt);
  let p = h.profile || {};
  const view = async () => {
    const phone = ch === "web" ? p.phone || "" : "+" + id;
    /** @type {any[]} */
    let reqs = [];
    if (phone) { try { reqs = (await loadLeads(env.KV, cid)).filter(l => l.phone === (normPhone(phone) || phone) && !l.status && (l.kind || !(l.altegio && l.altegio.record_id))).slice(-6).map(l => ({ id: l.id, kind: l.kind || "lead", name: l.name || "", service: l.service || "", time: l.time || "", note: l.note || "", at: l.at || "" })); } catch (e) {} }
    const open = ch === "ga" ? true : ch === "wa" ? !!p.li && now - p.li < 24 * 3600e3 : false;
    let promo = null; // недавняя рассылка: клиент мог ответить именно на неё
    if (ch !== "web") { try { const bl = JSON.parse((await env.KV.get("bclast:" + cid)) || "null"); if (bl && bl.text) promo = { at: bl.at, name: bl.name || "", text: bl.text }; } catch (e) {} }
    return {
      promo,
      ch, id, phone, name: p.name || "", waName: p.waName || "", turns: (h.turns || []).map((/** @type {any} */ t) => turnView(t)),
      bookings: (p.bookings || []).map((/** @type {any} */ x) => altLabel(x, "ru", now, true)), pend: (p.pend || []).map((/** @type {any} */ x) => [x.service, x.raw || [x.date, x.time].filter(Boolean).join(" ")].filter(Boolean).join(", ")), booked: !p.bookings && !p.pend ? p.booked || "" : "",
      need: p.need ? { why: p.need.why, text: /** @type {any} */ (NEED_TEXT)[p.need.why] || "", at: p.need.at || 0, ...(p.need.tp ? { tp: p.need.tp } : {}), ...(p.need.src ? { src: srcView(h.turns || [], p.need.src) } : {}) } : null,
      assignee: (p.as && p.as.n) || "", done: p.done || 0, line: { ch, label: lineLabel(cid, ch, lineChans(env, cid)) },
      audit: (p.audit || []).slice(-12), paused: p.pausedUntil > now ? p.pausedUntil : 0, stop: !!p.stop, off: ch === "web" ? !!c.off : botOff(env, c, ch), // выключатель своего номера: иначе в чате «Ведёт бот», а бот молчит (18.10.2026)
      canSend: ch !== "web" && (ch === "ga" ? !!(gaRoute(env, cid) || gaShared(env)) : !!waRoute(env, cid, p)), open, li: p.li || 0, reqs, now, ...(c.pay ? { pay: c.pay } : {})
    };
  };
  if (M === "GET" && P === "/api/inbox/chat") return jsonP(await view());
  if (M === "GET" && P === "/api/inbox/booking") { // ближайшая запись в Altegio — отдельным запросом: журнал может отвечать несколько секунд
    if (ch === "web") return jsonP({ records: [], available: false });
    try { const r = await bookingCard(env, c, "+" + id, now); return jsonP({ records: r || [], available: r !== null }); }
    catch (e) { console.log("booking card", String(e).slice(0, 120)); return jsonP({ error: "Журнал Altegio сейчас не ответил — попробуйте позже." }, 502); }
  }

  if (M === "GET" && P === "/api/inbox/media") { // файл из чата: голосовое, фото, видео, документ. Только файл этой переписки (services/inbox/media.js)
    const mid = q.get("mid"), t = mid ? (h.turns || []).find((/** @type {any} */ x) => x.m && x.m.id === mid) : (h.turns || [])[+(/** @type {any} */ (q.get("n")))];
    if (!t || !t.m || !(t.m.id || t.m.url)) return jsonP({ error: "Файл не найден." }, 404);
    const r = await mediaFile(env, cid, ch, id, p, t, String(request.headers.get("range") || "").slice(0, 100));
    if (r.ok) return r.res;
    return jsonP({ error: r.why === "big" ? "Файл больше 100 МБ — откройте его в WhatsApp на телефоне." : r.why === "gone" ? "Файл недоступен: WhatsApp хранит файлы ограниченное время. Попросите клиента прислать его ещё раз." : "Файл сейчас не открылся — попробуйте ещё раз через минуту." }, r.why === "error" ? 502 : 404);
  }
  if (M !== "POST") return jsonP({ error: "Не найдено." }, 404);

  // ответ администратора клиенту
  /** @param {string} text */
  const sendTo = async text => {
    if (ch === "web") return { ok: false, error: "В чат на сайте ответить нельзя — позвоните клиенту." };
    if (ch === "ga") { // номер Green-API клиента (или общий номер воркера, через который пришёл этот чат)
      const gr = gaRoute(env, cid) || gaShared(env);
      if (!gr) return { ok: false, error: "Green-API не настроен." };
      const r = await sendGreen(env, id + "@c.us", text, gr, true);
      if (r.ok) return { ok: true, id: r.id || "" };
      if (!r.status || r.status >= 500) return { ok: true, unknown: true, error: "" }; // ответа нет — сообщение могло уйти: статус «?», само не повторяется
      return { ok: false, error: `Green-API не принял сообщение: ${gaWhy(r, gr)}.` };
    }
    const route = waRoute(env, cid, p);
    if (!route) return { ok: false, error: `WhatsApp этого клиента не подключён: в Cloudflare нет секрета WA_TOKEN_${cid.toUpperCase()}.` };
    if (!(p.li && now - p.li < 24 * 3600e3)) return { ok: false, error: "Клиент писал больше 24 часов назад. WhatsApp разрешает написать первым только готовым шаблоном — позвоните клиенту или дождитесь его сообщения." };
    let r; try { r = await sendWA(env, id, text, route); } catch (e) { return { ok: false, error: "Не отправилось: " + String(e).slice(0, 120) }; }
    return r && r.ok ? { ok: true, id: String(r.id || "") } : { ok: false, error: "WhatsApp не принял сообщение" + (r && r.code ? ` (код ${r.code})` : "") + (r && WA_HINT[r.code] ? ": " + WA_HINT[r.code] : r && r.error ? ": " + r.error : "") + "." };
  };
  const msg = clean(String(b.text ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " "), 2000);
  const op = opName(b.op), who = opWho(s, op);
  /** реплика сотрудника с номером сообщения у провайдера и статусом (галочки, ТЗ v2.0 §2.3) @param {string} text @param {any} r */
  const adminTurn = (text, r) => ({ role: "model", text, t: now, by: "admin", ...(op ? { op } : {}), ...(r && r.id ? { mid: String(r.id).slice(0, 80), st: "sent" } : r && r.unknown ? { st: "unknown" } : {}) });
  if (M === "POST") await chatTouchOp(env, cid, op, now);
  if (P === "/api/inbox/send") {
    if (!msg) return jsonP({ error: "Напишите сообщение." }, 400);
    const r = await sendTo(msg);
    if (!r.ok) return jsonP({ error: r.error }, 409);
    // ответ остаётся в истории (его увидит и ИИ, когда бот вернётся), бот в этом чате молчит 2 часа, пометка «ждёт ответа» снимается
    let warn = "";
    try { h = await logTurns(env.KV, hk, [adminTurn(msg, r)], pr => { pr.pausedUntil = Math.max(pr.pausedUntil || 0, now + PAUSE_MS); delete pr.need; delete pr.fw; delete pr.cxAsk; delete pr.mvAsk; if (op && !pr.as) pr.as = { n: op, at: now, by: op }; }); }
    catch (e) { console.log("inbox log", String(e)); warn = "Сообщение клиенту ушло, но не сохранилось в переписке (хранилище не ответило). Второй раз не отправляйте."; } // сообщение уже у клиента: ошибка здесь привела бы к повторной отправке
    applyForget(h, fgAt); // ответ пульту — тоже без того, что забыто (копию до очистки мог записать вебхук в другом месте сети)
    p = h.profile || {};
    return jsonP({ ok: true, chat: await view(), ...(warn ? { warn } : {}) });
  }
  if (P === "/api/inbox/act") {
    const act = String(b.act || "");
    if (act === "resolve") {
      if ((await view()).reqs.length) return jsonP({ error: "В чате есть невыполненная просьба клиента (отмена, перенос, заявка или звонок). Нажмите «Сделано» в карточке — тогда чат закроется сам." }, 409);
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
      catch (e) { console.log("erase", String(e)); return jsonP({ error: "Хранилище не ответило — удалено не всё. Нажмите ещё раз через минуту." }, 503); }
    }
    else if (act === "take" || act === "assign") { // кто ведёт чат: «Взять себе» — имя этого устройства, «Назначить» — имя из списка
      const to = act === "take" ? op : opName(b.to);
      if (act === "take" && !to) return jsonP({ error: "Укажите своё имя в настройках пульта — тогда чат можно взять себе." }, 400);
      h = await logTurns(env.KV, hk, [], pr => { if (to) pr.as = { n: to, at: now, by: who }; else delete pr.as; chatAudit(pr, now, who, act === "take" ? "take" : to ? "assign" : "unassign", act === "take" ? "" : to); });
    }
    else if (act === "reopen") h = await logTurns(env.KV, hk, [], pr => { delete pr.done; chatAudit(pr, now, who, "reopen"); });
    else if (act === "resume") {
      if (p.stop) return jsonP({ error: "Клиент сам попросил не писать ему автоматически. Бот вернётся, когда клиент напишет «старт»." }, 409);
      h = await logTurns(env.KV, hk, [], pr => { delete pr.pausedUntil; delete pr.fw; delete pr.need; });
    } else if (act === "done") {
      // администратор выполнил просьбу клиента (отменил или перенёс запись, подтвердил заявку) и сообщает ему об этом
      const lid = String(b.lead || "");
      let lead = null; try { lead = (await loadLeads(env.KV, cid)).find(l => l.id === lid) || null; } catch (e) {}
      if (!lead || (lead.phone && lead.phone !== (normPhone("+" + id) || p.phone) && lead.phone !== p.phone)) return jsonP({ error: "Заявка не найдена." }, 404);
      let sent = null; if (msg) { sent = await sendTo(msg); if (!sent.ok) return jsonP({ error: sent.error }, 409); }
      await leadPatch(env, cid, lid, { status: "выполнена", note: clean((lead.note ? lead.note + " " : "") + `Выполнил ${who}${msg ? ", клиенту сообщено" : ""}.`, 600) });
      h = await logTurns(env.KV, hk, msg ? [adminTurn(msg, sent)] : [], pr => {
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
    return jsonP({ ok: true, chat: await view() });
  }
  return jsonP({ error: "Не найдено." }, 404);
}

// реплика для пульта: кто (u — клиент, a — сотрудник, b — бот или автоматическое сообщение), имя сотрудника, файл, статус отправки,
// вид автоматического сообщения (rm — напоминание или отзыв, bc — рассылка)
/** @param {any} t */
function turnView(t) {
  return { r: t.role === "user" ? "u" : t.by === "admin" ? "a" : "b", x: t.text, t: t.t || 0,
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
