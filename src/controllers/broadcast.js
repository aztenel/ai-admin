// @ts-check
// Рассылки (/broadcast, /api/bc/*): создание, проверка, пуск, пауза, отчёт.
import { clean, snip } from "../lib/text.js";
import { normPhone } from "../lib/phone.js";
import { isoDay } from "../lib/time.js";
import { jsonP, sameOrigin } from "../lib/http.js";
import { ADMIN_CSS } from "../lib/css.js";
import { CLIENTS, hasClient } from "../config/builtin-clients.js";
import { BC_CHUNK, BC_STALE, BC_SLOT, BC_DAY } from "../config/constants.js";
import { canSee } from "../services/auth/access.js";
import { BC_HINT, bcCode, bcWhy } from "../services/broadcast/errors.js";
import { bcParse } from "../services/broadcast/parse.js";
import { bcSeg, bcOptouts } from "../services/broadcast/segments.js";
import { bcHold, bcHoldFor, bcFrom, bcHoldEdit, GA_STATE_TEXT, GA_STATE_BAD } from "../services/broadcast/holds.js";
import { bcRoute, bcHealth, bcGaMsg, bcGaText, bcSendGa, bcRun, bcTick, GA_CAP, GA_MSG_MAX, GA_CAPTION_MAX } from "../services/broadcast/sender.js";
import { kvRetry, bcKey, bcChunkKey, bcPut, bcGet, bcParam, sendTemplate, gaRoute, gaWhy, gaInfo } from "../services/broadcast/deps.js";
/** @import { Env } from "../lib/types.js" */

// вебхук не настроен — рассылку через Green-API не запускаем: бот не увидит, кто ответил «стоп»
const GA_HOOK_WARN = "Вебхук Green-API не настроен: бот не увидит ответы клиентов, и тем, кто ответит «стоп», рассылка будет приходить дальше. Владелец сервиса настраивает его одной кнопкой: «Проверка запуска» → «Настроить Green-API».";
/** @param {any} q @param {number} now */
const bcUsed = (q, now) => { const slot = Math.floor(now / BC_SLOT); return Object.keys(q || {}).filter(k => +k > slot - BC_DAY).reduce((a, k) => a + (+q[k] || 0), 0); };
/** @param {Request} request @param {Env} env @param {URL} url @param {any} s */
export async function bcApi(request, env, url, s) {
  const P = url.pathname, M = request.method, q = url.searchParams;
  /** @type {Record<string, any>} */
  let body = {};
  if (M === "POST") { if (!sameOrigin(request, url)) return jsonP({ error: "Запрос отклонён." }, 403); try { body = (await request.json()) || {}; } catch (e) {} }
  const cid = String((M === "POST" ? body.c : q.get("c")) || "");
  if (!hasClient(cid) || !canSee(s, cid)) return jsonP({ error: "Нет доступа к этому клиенту." }, 403);
  const c = CLIENTS[cid], now = Date.now(), route = /** @type {any} */ (bcRoute)(env, cid);
  /** @param {Record<string, any>} b */
  const pub = b => { const { bad, ...rest } = b; return { ...rest, fails: Object.entries(b.fails || {}).map(([code, n]) => ({ code: bcCode(code), n, hint: BC_HINT[code] || "" })), stalled: b.status === "running" && now - Math.max(b.last || 0, b.startedAt || 0, b.waitTill || 0, b.nextAt || 0) > BC_STALE }; }; // пауза между сообщениями Green-API — не молчание
  if (M === "GET" && P === "/api/bc/list") {
    const rows = [];
    try {
      const r = await env.KV.list({ prefix: `bc:${cid}:`, limit: 300 });
      for (const k of (r && r.keys) || []) rows.push({ id: String(k.name).split(":").pop(), ...(k.metadata || {}) });
    } catch (e) { return jsonP({ error: "Хранилище не отвечает — попробуйте через минуту." }, 503); }
    rows.sort((a, b2) => (b2.created || 0) - (a.created || 0));
    let stops = 0, hold = null, holdGa = "", fail = null, used = 0, usedGa = 0;
    try { stops = (await bcOptouts(env, cid)).size; } catch (e) {}
    try { const h = await bcHold(env, cid); hold = h ? [h.all && h.all.why].concat(Object.values(h.tpl || {}).map(x => x.why)).filter(Boolean) : null; holdGa = (h && h.ga && h.ga.why) || ""; } catch (e) {}
    try { const f = JSON.parse((await env.KV.get(`bcf:${cid}:${isoDay(now)}`)) || "null"); if (f && f.n) fail = { n: f.n, codes: Object.entries(f.codes || {}).map(([code, n]) => ({ code: bcCode(code), n, hint: BC_HINT[code] || "" })) }; } catch (e) {}
    try { used = bcUsed(JSON.parse((await env.KV.get("bcq:" + cid)) || "{}"), now); } catch (e) {}
    const health = route.error ? null : await bcHealth(env, route);
    const gr = gaRoute(env, cid);
    let ga = null; // номер Green-API клиента: привязан ли, настроен ли вебхук, сколько отправлено за сутки
    if (gr) {
      try { usedGa = bcUsed(JSON.parse((await env.KV.get("bcq:" + cid + ":ga")) || "{}"), now); } catch (e) {}
      const g = await gaInfo(env, gr);
      ga = { ready: !g.error && g.state === "authorized", state: g.state || "", phone: g.phone || "", hook: !!g.hook, why: g.error || (g.state === "authorized" ? "" : GA_STATE_TEXT[g.state] || `номер в состоянии «${clean(g.state, 30)}»`),
        warn: g.error || g.hook ? "" : GA_HOOK_WARN, used: usedGa, cap: GA_CAP, hold: holdGa };
    }
    return jsonP({ client: { id: cid, name: c.name }, owner: s.role === "owner", ready: !route.error, why: route.error || "", stops, hold, fail, used, health, ga, list: rows.slice(0, 60), now });
  }
  if (M === "GET" && P === "/api/bc/get") {
    const b = await bcGet(env, cid, String(q.get("id") || "").replace(/[^a-z0-9]/g, ""));
    if (!b) return jsonP({ error: "Рассылка не найдена." }, 404);
    return jsonP({ b: pub(b), now, ...(q.get("bad") ? { bad: (b.bad || []).map((/** @type {any[]} */ [d, code]) => `+${d} — ${BC_HINT[code] || "код " + code}`) } : {}) });
  }
  if (M !== "POST") return jsonP({ error: "Не найдено." }, 404);
  const id = String(body.id || "").replace(/[^a-z0-9]/g, "").slice(0, 24), ga = body.ch === "ga";
  const fields = () => {
    const errors = [], img = String(body.img || "").trim(), fallback = clean(body.fallback || "", 30);
    if (ga) { // Green-API: обычный текст как написан (переводы строк сохраняются), в конце — «ответьте СТОП»
      const msg = bcGaMsg(body.text);
      if (!msg) errors.push("напишите текст сообщения");
      else if (img ? msg.replace(/\{\s*(имя|name)\s*\}/gi, "x".repeat(30)).length > 1024 : msg.length > GA_MSG_MAX) errors.push(img ? `текст с картинкой — не длиннее ${GA_CAPTION_MAX} знаков (это подпись к картинке, у WhatsApp она короче обычного сообщения)` : `текст сообщения — не длиннее ${GA_MSG_MAX} знаков`); // подпись к картинке — до 1024 знаков вместе с самым длинным именем
      if (img && !(/^https:\/\/[^\s"'<>]{4,500}$/.test(img))) errors.push("картинка — ссылка, которая начинается с https://");
      return { errors, ch: "ga", img, msg, params: [], text: clean(msg.replace(/\s*\n\s*/g, " ⏎ "), 1100), fallback };
    }
    const tpl = String(body.tpl || "").trim(), lang = String(body.lang || "ru").trim();
    if (!/^[a-z0-9_]{1,512}$/.test(tpl)) errors.push("название шаблона — как в кабинете Meta: строчные латинские буквы, цифры и «_» (например, promo_october)");
    if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(lang)) errors.push("язык шаблона — код из кабинета Meta: ru, kk, en или en_US");
    if (img && !(/^https:\/\/[^\s"'<>]{4,500}$/.test(img))) errors.push("картинка — ссылка, которая начинается с https://");
    const params = (Array.isArray(body.params) ? body.params : String(body.params || "").split("\n")).map(x => clean(x, 300)).filter(Boolean).slice(0, 10);
    return { errors, tpl, lang, img, params, text: clean(String(body.text || "").replace(/\s*\n\s*/g, " ⏎ "), 1100), fallback };
  };
  const seg = ["idle", "bday"].includes(body.seg) ? body.seg : "", segDays = Math.round(+body.segDays || 0), segBad = seg && !(segDays >= 1 && segDays <= 365);
  if (P === "/api/bc/check") { // разбор списка без сохранения: сколько номеров, сколько повторов, кого пропустим
    const r0 = bcParse(body.recipients), sg = bcSeg(r0, segBad ? "" : seg, segDays, now), r = { ...r0, list: sg.list }, f = fields(), first = (r.list.find((/** @type {any} */ x) => x[1]) || [])[1] || "";
    if (segBad) f.errors.push("сегмент: число дней — от 1 до 365");
    let stop = new Set(); try { stop = await bcOptouts(env, cid); } catch (e) {}
    return jsonP({ ok: r.list.length > 0 && !f.errors.length, valid: r.list.length, named: r.list.filter((/** @type {any} */ x) => x[1]).length, dup: r.dup, bad: r.bad, badN: r.badN, cut: r.cut, stopped: r.list.filter((/** @type {any} */ x) => stop.has(x[0])).length,
      ...(seg ? { segOut: sg.out, noDate: sg.noDate, seg: sg.label } : {}),
      sample: r.list.slice(0, 5).map((/** @type {any} */ x) => "+" + x[0] + " — " + (x[1] || "без имени")), errors: f.errors, preview: ga ? (f.msg ? [bcGaText(f, first)] : []) : f.params.map(t => bcParam(t, first, f.fallback)) });
  }
  if (P === "/api/bc/test") { // пробная отправка на один номер (себе)
    const f = fields(), to = normPhone(body.to) || (/^\s*\+/.test(String(body.to || "")) && /^[1-9]\d{9,14}$/.test(String(body.to).replace(/\D/g, "")) ? "+" + String(body.to).replace(/\D/g, "") : "");
    if (f.errors.length) return jsonP({ error: f.errors.join("; ") }, 400);
    if (!to) return jsonP({ error: "Укажите свой номер полностью, например +7 701 123 45 67." }, 400);
    const rt = ga ? bcRoute(env, cid, "ga") : route;
    if (rt.error) return jsonP({ error: rt.error }, 409);
    const tk = `bct:${cid}:${Math.floor(now / 3600e3)}`, tn = +((await env.KV.get(tk)) || 0);
    if (tn >= 20) return jsonP({ error: "Слишком много пробных отправок за час — подождите." }, 429);
    try { await env.KV.put(tk, String(tn + 1), { expirationTtl: 3700 }); } catch (e) {}
    if (ga) { const r = await bcSendGa(env, to.slice(1), f, "Айгерим", rt.ga); return r.ok ? jsonP({ ok: true, text: `Сообщение отправлено на ${to} с номера Green-API — проверьте WhatsApp.` }) : jsonP({ error: `Green-API не принял сообщение (${gaWhy(r, rt.ga)}).` }, 409); }
    const r = await sendTemplate(env, to.slice(1), f, "Айгерим", rt);
    return r.ok ? jsonP({ ok: true, text: `Шаблон отправлен на ${to} — проверьте WhatsApp. Если сообщение не пришло за минуту, этот номер не принимает сообщения от компаний.` }) : jsonP({ error: `Meta не приняла шаблон (${bcWhy(r)}).` }, 409);
  }
  if (P === "/api/bc/create") {
    const r0 = bcParse(body.recipients), sg = bcSeg(r0, segBad ? "" : seg, segDays, now), f = fields(), r = { ...r0, list: sg.list }, errors = f.errors.slice();
    if (segBad) errors.push("сегмент: число дней — от 1 до 365");
    else if (seg && r0.list.length && !r.list.length) errors.push(`в сегменте «${sg.label}» никого нет${sg.noDate ? ` (без нужной даты в списке: ${sg.noDate})` : ""}`);
    const name = clean(body.name || "", 60), cap = Math.round(+body.cap || 0), from = Math.round(+body.from), to = Math.round(+body.to);
    if (name.length < 2) errors.push("дайте рассылке название — для себя");
    if (!r0.list.length) errors.push("в списке нет ни одного номера");
    if (ga && !(cap >= 1 && cap <= GA_CAP[1])) errors.push(`предел на 24 часа через Green-API — от 1 до ${GA_CAP[1]}: обычный WhatsApp блокируют за массовые рассылки`);
    else if (!(cap >= 1 && cap <= 100000)) errors.push("предел на 24 часа — число от 1 до 100 000");
    if (!(from >= 0 && to <= 24 && to > from)) errors.push("часы отправки: «с» должно быть раньше, чем «до»");
    else if (from < 8 || to > 22) errors.push("часы отправки — не раньше 8:00 и не позже 22:00: ночные сообщения вызывают жалобы, а жалобы блокируют номер");
    if (!ga && !f.text) errors.push("вставьте текст шаблона — его увидит администратор, а бот поймёт, на что отвечает клиент");
    if (body.consent !== true) errors.push("подтвердите, что эти люди — клиенты компании и не просили им не писать");
    if (errors.length) return jsonP({ ok: false, errors }, 400);
    const base = { id: now.toString(36) + Math.random().toString(36).slice(2, 5), name, ...(f.img ? { img: f.img } : {}), text: f.text, fallback: f.fallback || "уважаемый клиент", created: now, by: s.role, status: "ready", total: r.list.length, pos: 0, sent: 0, failed: 0, skipped: 0, cap, from, to, ...(sg.label ? { seg: sg.label } : {}) };
    const b = ga ? { ...base, ch: "ga", msg: f.msg } : { ...base, tpl: f.tpl, lang: f.lang, params: f.params };
    try {
      for (let k = 0; k * BC_CHUNK < r.list.length; k++) await env.KV.put(bcChunkKey(cid, b.id, k), JSON.stringify(r.list.slice(k * BC_CHUNK, (k + 1) * BC_CHUNK)), { expirationTtl: 180 * 86400 });
      await bcPut(env, cid, b);
    } catch (e) { console.log("bc create", String(e)); return jsonP({ ok: false, errors: ["не удалось сохранить список — хранилище не отвечает, попробуйте ещё раз"] }, 500); }
    return jsonP({ ok: true, b: pub(b), dup: r.dup, bad: r.badN, cut: r.cut });
  }
  const cur = id ? await bcGet(env, cid, id) : null;
  if (!cur) return jsonP({ error: "Рассылка не найдена." }, 404);
  if (P === "/api/bc/act") {
    const act = String(body.act || "");
    if (act === "start") {
      const rt = bcRoute(env, cid, cur.ch);
      if (rt.error) return jsonP({ error: rt.error }, 409);
      if (!["ready", "paused"].includes(cur.status)) return jsonP({ error: "Эту рассылку уже нельзя запустить." }, 409);
      if (cur.ch === "ga") { // номер на связи и вебхук ведёт в этот бот — иначе «стоп» клиентов до бота не дойдёт
        const g = await gaInfo(env, rt.ga);
        if (g.error) return jsonP({ error: g.error }, 409);
        if (g.state !== "authorized") return jsonP({ error: `${GA_STATE_TEXT[g.state] || `Green-API: номер в состоянии «${clean(g.state, 30)}»`}. ${GA_STATE_BAD[g.state] ? "Пока ограничение не снято, рассылку запускать нельзя." : "Запустите рассылку, когда номер будет на связи."}` }, 409);
        if (!g.hook) return jsonP({ error: GA_HOOK_WARN }, 409);
      }
      const hold = bcHoldFor(await bcHold(env, cid), cur);
      if (hold && body.force !== true) return jsonP({ confirm: `Сигнал от ${bcFrom(cur)}: ${hold.why}. Продолжать отправку опасно для номера. Всё равно продолжить?` }, 409);
      if (hold) await bcHoldEdit(env, cid, h => { if (cur.ch === "ga") delete h.ga; else { delete h.all; if (h.tpl) delete h.tpl[cur.tpl]; } });
      cur.status = "running"; cur.startedAt = now; cur.streak = 0; cur.tmp = 0;
      for (const k of ["note", "retryAt", "retryWhy", "waitNote", "waitTill", "nextAt"]) delete cur[k];
      await bcPut(env, cid, cur); await bcRun(env, cid, id, true);
      try { await env.KV.put("bclast:" + cid, JSON.stringify({ at: now, name: cur.name, text: snip(cur.text, 600) }), { expirationTtl: 7 * 86400 }); } catch (e) { console.log("bclast", String(e)); } // текст рассылки увидят ИИ (клиент может ответить на неё) и администратор в пульте
    } else if (act === "pause") { if (cur.status === "running") { cur.status = "paused"; cur.note = "Остановлена вручную."; await bcPut(env, cid, cur); } await bcRun(env, cid, id, false); }
    else if (act === "stop") { if (cur.status !== "done") { cur.status = "stopped"; delete cur.note; await bcPut(env, cid, cur); } await bcRun(env, cid, id, false); }
    else if (act === "delete") { // вместе с рассылкой удаляется и список номеров
      if (cur.status === "running") return jsonP({ error: "Сначала остановите рассылку." }, 409);
      for (let k = 0; k * BC_CHUNK < cur.total; k++) { try { await env.KV.delete(bcChunkKey(cid, id, k)); } catch (e) {} }
      await kvRetry(() => env.KV.delete(bcKey(cid, id))); await bcRun(env, cid, id, false); // рассылку могли записать секунду назад — KV просит подождать
      return jsonP({ ok: true, gone: true });
    } else return jsonP({ error: "Неизвестное действие." }, 400);
    return jsonP({ ok: true, b: pub(cur) });
  }
  if (P === "/api/bc/tick") { // порция вручную — когда фоновая отправка не работает
    let r; try { r = await /** @type {any} */ (bcTick)(env, cid, id); } catch (/** @type {any} */ e) { console.log("bc tick", String((e && e.stack) || e)); return jsonP({ error: "Сбой при отправке порции — попробуйте ещё раз через минуту." }, 500); }
    if (r.error) return jsonP({ error: r.error }, 404);
    if (r.state === "running" || r.state === "wait") await bcRun(env, cid, id, true);
    return jsonP({ ok: true, b: pub(r.b), state: r.state });
  }
  return jsonP({ error: "Не найдено." }, 404);
}
export function bcPage() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Рассылки — AI-администратор</title><style>${ADMIN_CSS}
.bar2{height:8px;border-radius:99px;background:var(--line);overflow:hidden;margin:8px 0}.bar2 i{display:block;height:100%;background:var(--acc)}.two{display:flex;gap:10px;flex-wrap:wrap}.two>div{flex:1;min-width:92px}
input[type=file]{font-size:14px;margin-top:6px}label.ck{font-weight:400;display:flex;gap:8px;align-items:flex-start}label.ck input{margin-top:4px;width:18px;height:18px}</style></head><body>
<div class="top"><b id="ttl">Рассылки</b><a id="l_in" href="/inbox">Чаты</a><a id="l_st" href="/studio" hidden>Боты</a><a href="/logout">Выйти</a></div><div class="w">
<div id="info"></div>
<div id="list"></div>
<div class="row"><button class="btn p" id="b_new">+ Новая рассылка</button></div>
<div id="form" class="card" hidden>
<h3 style="margin-top:0">Новая рассылка</h3>
<div id="chbox" hidden><label>Через что отправлять</label><label class="ck"><input type="radio" name="ch" id="ch_ga"><span>Green-API — обычным текстом с номера WhatsApp компании</span></label><label class="ck"><input type="radio" name="ch" id="ch_meta"><span>Meta — шаблоном, который одобрила Meta</span></label></div>
<p class="mut" id="p_meta">Написать клиенту первым WhatsApp разрешает только шаблоном, который одобрила Meta (кабинет Meta → WhatsApp Manager → Шаблоны сообщений). В конце шаблона добавьте строку «Чтобы не получать сообщения, ответьте СТОП» — таким клиентам рассылка больше не уйдёт.</p>
<p class="mut" id="p_ga" hidden>Сообщение уйдёт обычным текстом с номера WhatsApp компании — по одному, с паузой 1–3 минуты. За массовые рассылки WhatsApp блокирует такие номера: пишите только своим клиентам и начинайте с 30–50 сообщений в сутки. В конце бот сам добавит строку «Чтобы не получать сообщения, ответьте СТОП» — таким клиентам рассылка больше не уйдёт.</p>
<label>Название для себя</label><input type="text" id="f_name" maxlength="60" placeholder="Октябрь: скидка на стрижку">
<div class="two" id="r_tpl"><div style="flex:3"><label>Название шаблона в Meta</label><input type="text" id="f_tpl" maxlength="100" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="promo_october"></div><div><label>Язык</label><input type="text" id="f_lang" maxlength="6" value="ru" autocapitalize="off"></div></div>
<label><span id="l_text">Текст шаблона</span><small id="s_text">Скопируйте из кабинета Meta как есть. Клиенту уйдёт сам шаблон; этот текст нужен, чтобы администратор и бот знали, что было отправлено.</small></label><textarea id="f_text"></textarea>
<div id="r_params"><label>Подстановки<small>Если в шаблоне есть {{1}}, {{2}} — по одной на строке, по порядку. {имя} заменится именем клиента из списка. Если подстановок нет — оставьте пустым.</small></label><textarea id="f_params" style="min-height:60px" placeholder="{имя}"></textarea></div>
<label>Если имени в списке нет, подставить</label><input type="text" id="f_fb" maxlength="30" value="уважаемый клиент">
<label><span id="l_img">Картинка в шапке</span><small id="s_img">Только если шаблон с картинкой: ссылка на неё, начинается с https://</small></label><input type="text" id="f_img" maxlength="500" autocapitalize="off" placeholder="не обязательно">
<label>Кому<small>По клиенту на строке: номер и, если есть, имя — «8 701 123 45 67, Айгерим». Можно вставить столбцы прямо из Excel. Повторы уберутся сами.</small></label><textarea id="f_rec" style="min-height:140px"></textarea><input type="file" id="f_file" accept=".csv,.txt,text/plain,text/csv">
<label>Кому из списка<small>Для отбора нужны даты в списке: последний визит и день рождения (столбцы из Excel, «01.08.2026», «12.10.1995» или «12.10»). Строку заголовка («Телефон; Имя; Последний визит; День рождения») можно оставить.</small></label><div class="row"><select id="f_seg"><option value="">всем из списка</option><option value="idle">кто не был дольше N дней</option><option value="bday">у кого день рождения в ближайшие N дней</option></select><input type="number" id="f_segd" min="1" max="365" value="30" style="max-width:110px" aria-label="N дней"></div>
<div class="two"><div><label>Не больше за 24 часа</label><input type="number" id="f_cap" value="240" min="1"></div><div><label>С, час</label><input type="number" id="f_from" value="10" min="8" max="21"></div><div><label>До, час</label><input type="number" id="f_to" value="20" min="9" max="22"></div></div>
<p class="mut" id="caphint">У нового номера предел Meta — 250 получателей за 24 часа, после проверки компании — 2 000.</p>
<p class="mut" id="p_meta2">Первую рассылку сделайте небольшой — 50–100 постоянных клиентов. По жалобам на первые сообщения Meta судит о номере: много жалоб — и она ограничит отправку.</p>
<label class="ck"><input type="checkbox" id="f_ok"><span>Это клиенты компании: они сами оставляли номер и не просили им не писать</span></label>
<div id="fout"></div>
<div class="row"><button class="btn" id="b_chk">Проверить список</button><button class="btn p" id="b_make">Создать рассылку</button><button class="btn" id="b_cancel">Отмена</button></div>
<label>Пробная отправка себе<small>Перед рассылкой отправьте сообщение на свой номер и посмотрите, как оно выглядит.</small></label>
<div class="two"><div style="flex:3"><input type="text" id="f_to1" inputmode="tel" placeholder="+7 701 123 45 67"></div><div><button class="btn" id="b_test">Отправить</button></div></div><div id="tout"></div></div>
</div>
<script>
var $=function(i){return document.getElementById(i)},C=new URLSearchParams(location.search).get('c')||'',poll=null,live={},CH='',CAP={'':240,ga:50},HINT={'':'',ga:'Через Green-API — не больше 300 в сутки. Начинайте с 30–50: так меньше риск, что WhatsApp заблокирует номер.'};
function setCh(ch){var g=ch==='ga';CH=g?'ga':'';$('ch_ga').checked=g;$('ch_meta').checked=!g;$('p_meta').hidden=g;$('p_meta2').hidden=g;$('p_ga').hidden=!g;$('r_tpl').hidden=g;$('r_params').hidden=g;
 $('l_text').textContent=g?'Текст сообщения':'Текст шаблона';$('s_text').textContent=g?'{имя} заменится именем клиента из списка. Переносы строк и эмодзи сохранятся.':'Скопируйте из кабинета Meta как есть. Клиенту уйдёт сам шаблон; этот текст нужен, чтобы администратор и бот знали, что было отправлено.';
 $('l_img').textContent=g?'Картинка':'Картинка в шапке';$('s_img').textContent=g?'Не обязательно: ссылка на картинку (начинается с https://), текст уйдёт подписью к ней.':'Только если шаблон с картинкой: ссылка на неё, начинается с https://';
 $('f_cap').value=CAP[CH];$('f_cap').max=g?300:100000;$('caphint').textContent=HINT[CH];$('caphint').hidden=!HINT[CH]}
$('ch_ga').onchange=function(){setCh('ga')};$('ch_meta').onchange=function(){setCh('')};
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e}
function api(p,b){return fetch(p,b?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}:{}).then(function(r){if(r.status===401){location.href='/login?next='+encodeURIComponent(location.pathname+location.search);throw 0}return r.json()})}
function tm(ms){var d=new Date(ms+5*3600e3);return ('0'+d.getUTCHours()).slice(-2)+':'+('0'+d.getUTCMinutes()).slice(-2)}
var ST={ready:'готова к запуску',running:'идёт',paused:'на паузе',done:'завершена',stopped:'остановлена'},QL={GREEN:'высокое',YELLOW:'среднее — есть жалобы',RED:'низкое — много жалоб'};
function msg(box,cls,lines){box.textContent='';var m=el('div','msg '+cls);lines.forEach(function(x){m.appendChild(el('div','',x))});box.appendChild(m)}
function fail(e,box){if(e===0)return;msg(box||$('info'),'e',['Нет связи с сервером или он не ответил. Проверьте интернет и попробуйте ещё раз — ничего не потеряно.'])}
function load(){api('/api/bc/list?c='+C).then(function(d){var L=$('list'),I=$('info');L.textContent='';I.textContent='';if(d.error){msg(I,'e',[d.error]);return}
 $('ttl').textContent='Рассылки · '+d.client.name;$('l_in').href='/inbox?c='+C;$('l_st').hidden=!d.owner;
 var g=d.ga;if(!d.ready&&!g)I.appendChild(el('div','msg e',d.why));
 HINT['']='У нового номера предел Meta — 250 получателей за 24 часа, после проверки компании — 2 000.';
 if(d.health){if(d.health.error)I.appendChild(el('div','msg w',d.health.error));else{var h=d.health,t='Номер '+(h.phone||'')+(h.name?' «'+h.name+'»':'')+(QL[h.quality]?' · качество: '+QL[h.quality]:'')+(h.limit>0?' · предел Meta: '+h.limit+' получателей за 24 часа':h.limit<0?' · предел Meta: без ограничений':'');
  I.appendChild(el('div','msg '+(h.quality==='RED'?'e':h.quality==='YELLOW'?'w':'g'),t));if(h.limit>0){CAP['']=Math.max(1,Math.floor(h.limit*0.95));HINT['']='Предел Meta для этого номера — '+h.limit+' получателей за 24 часа. Оставьте небольшой запас.'}else if(h.limit<0)HINT['']='У этого номера нет суточного предела Meta. Начинайте с небольших рассылок: жалобы клиентов снижают качество номера.'}}
 if(d.hold&&d.hold.length)I.appendChild(el('div','msg e','Сигнал от Meta: '+d.hold.join('; ')+'. Рассылки остановлены.'));
 if(g){I.appendChild(el('div','msg '+(g.ready?'g':'e'),'WhatsApp через Green-API: '+(g.ready?'номер '+(g.phone||'')+' привязан':g.why)));if(g.warn){var wn=el('div','msg w',g.warn);if(d.owner){var la=el('a','',' Открыть проверку запуска');la.href='/launch?c='+C;wn.appendChild(la)}I.appendChild(wn)}
  if(g.hold)I.appendChild(el('div','msg e','Сигнал от Green-API: '+g.hold+'. Рассылки через Green-API остановлены.'))}
 $('chbox').hidden=!(g&&d.ready);if(!$('form').dataset.ch){$('form').dataset.ch=1;setCh(g&&!d.ready?'ga':'')}else $('caphint').textContent=HINT[CH];
 var p=el('p','mut','Отправлено за последние 24 часа: '+(g?(d.ready?d.used+' (Meta), ':'')+g.used+(d.ready?' (Green-API)':''):d.used)+'. Просили не писать: '+d.stops+' — им рассылки не уходят.');I.appendChild(p);
 if(d.fail)I.appendChild(el('p','mut','Не доставлено сегодня: '+d.fail.n+' ('+d.fail.codes.map(function(x){return x.n+' — '+(x.hint||'код '+x.code)}).join('; ')+').'));
 if(!d.list.length)L.appendChild(el('p','mut','Рассылок пока нет.'));
 live={};d.list.forEach(function(b){var c=el('div','card');c.id='bc'+b.id;L.appendChild(c);fillCard(c,b);if(b.status!=='done'&&b.status!=='stopped')refresh(b.id)});watch()}).catch(function(e){fail(e,$('info'))})}
function refresh(id){return api('/api/bc/get?c='+C+'&id='+id).then(function(d){var c=$('bc'+id);if(!c||d.error)return;var was=live[id];fillCard(c,d.b);if(was&&!live[id])load()}).catch(function(){})}
function watch(){clearTimeout(poll);if(!Object.keys(live).length)return;poll=setTimeout(function(){if(document.hidden){watch();return}Promise.all(Object.keys(live).map(refresh)).then(watch)},5000)}
function fillCard(c,b){c.textContent='';if(b.status==='running')live[b.id]=1;else delete live[b.id];
 c.appendChild(el('b','',b.name));c.appendChild(el('div','mut',(b.ch==='ga'?'Green-API · ':'')+(ST[b.status]||b.status)+' · отправлено '+b.sent+' из '+b.total+(b.skipped?' · просили не писать: '+b.skipped:'')+(b.failed?' · ошибок: '+b.failed:'')+(b.unsure?' · неизвестно (сбой): до '+b.unsure:'')));
 var bar=el('div','bar2'),i=el('i');i.style.width=Math.round(100*(b.pos||0)/Math.max(1,b.total))+'%';bar.appendChild(i);c.appendChild(bar);
 if(b.note&&b.status==='paused')c.appendChild(el('div','msg e',b.note));if(b.waitNote&&b.status==='running')c.appendChild(el('div','msg w',b.waitNote));
 if(b.fails&&b.fails.length)c.appendChild(el('div','mut','Ошибки: '+b.fails.map(function(x){return x.n+' — '+(x.hint||'код '+x.code)}).join('; ')));
 var out=el('div');out.id='o'+b.id;c.appendChild(out);
 var r=el('div','row');function btn(t,a,p){var e=el('button','btn'+(p?' p':''),t);e.onclick=function(){act(b.id,a,e,0,b)};r.appendChild(e);return e}
 if(b.status==='ready')btn('Запустить','start',1);if(b.status==='paused')btn('Продолжить','start',1);if(b.status==='running')btn('Пауза','pause');
 if(b.status==='running'&&b.stalled){c.appendChild(el('div','msg w','Фоновая отправка молчит больше двух минут. Можно отправить порцию вручную.'));btn('Отправить порцию сейчас','tick',1)}
 if(b.status!=='done'&&b.status!=='stopped')btn('Остановить совсем','stop');if(b.failed)btn('Номера с ошибками','bad');if(b.status!=='running')btn('Удалить','delete').className='btn d';
 c.appendChild(r);if(b.status==='running'&&!b.stalled&&!b.waitNote)c.appendChild(el('div','mut',(b.ch==='ga'?'Отправка идёт в фоне — по одному сообщению раз в 1–3 минуты.':'Отправка идёт в фоне — по порции в минуту.')+' Страницу можно закрыть: итог придёт в Telegram.'+(b.last?' Последняя отправка: '+tm(b.last)+'.':'')))}
function act(id,a,btn,force,b){var o=$('o'+id);
 if(a==='start'&&!force&&b&&!confirm((b.status==='paused'?'Продолжить':'Запустить')+' рассылку «'+b.name+'»? Сообщение получат до '+(b.total-(b.pos||0))+' человек. Остановить можно, но уже отправленное не вернуть.'))return;
 if(a==='stop'&&!confirm('Остановить рассылку совсем? Продолжить её будет нельзя.'))return;if(a==='delete'&&!confirm('Удалить рассылку вместе со списком номеров?'))return;
 if(a==='bad'){api('/api/bc/get?c='+C+'&id='+id+'&bad=1').then(function(d){o.textContent='';var p=el('pre','',(d.bad||[]).join(String.fromCharCode(10))||'нет');o.appendChild(p)}).catch(function(e){fail(e,o)});return}
 btn.disabled=true;
 var call=a==='tick'?api('/api/bc/tick',{c:C,id:id}):api('/api/bc/act',{c:C,id:id,act:a,force:!!force});
 call.then(function(d){btn.disabled=false;if(d.confirm){if(confirm(d.confirm))act(id,a,btn,1);return}if(d.error){msg(o,'e',[d.error]);return}if(d.gone){load();return}fillCard($('bc'+id),d.b);watch()}).catch(function(e){btn.disabled=false;fail(e,o)})}
function body(){return{c:C,ch:CH,name:$('f_name').value,tpl:$('f_tpl').value.trim(),lang:$('f_lang').value.trim(),img:$('f_img').value.trim(),text:$('f_text').value,params:$('f_params').value,fallback:$('f_fb').value,recipients:$('f_rec').value,seg:$('f_seg').value,segDays:$('f_segd').value,cap:$('f_cap').value,from:$('f_from').value,to:$('f_to').value,consent:$('f_ok').checked}}
$('b_new').onclick=function(){$('form').hidden=false;$('b_new').hidden=true;$('form').scrollIntoView()};$('b_cancel').onclick=function(){$('form').hidden=true;$('b_new').hidden=false};
$('f_file').onchange=function(){var f=this.files&&this.files[0];if(!f)return;if(f.size>3e6){msg($('fout'),'e',['Файл слишком большой. Нужен текстовый файл или CSV со списком номеров.']);return}var r=new FileReader();r.onload=function(){$('f_rec').value=String(r.result||'')};r.readAsText(f)};
$('b_chk').onclick=function(){api('/api/bc/check',body()).then(function(d){if(d.error){msg($('fout'),'e',[d.error]);return}var l=['Номеров: '+d.valid+(d.named?' · с именем: '+d.named:'')+(d.dup?' · повторов убрано: '+d.dup:'')+(d.stopped?' · просили не писать: '+d.stopped+' (им не уйдёт)':'')+(d.seg?' · в сегменте «'+d.seg+'»; отсеяно: '+d.segOut+(d.noDate?' (без нужной даты: '+d.noDate+')':''):'')];if(d.sample&&d.sample.length)l.push('Первые строки: '+d.sample.join('; '));
 if(d.preview&&d.preview.length&&CH!=='ga')l.push('Подстановки для первого клиента: '+d.preview.join(' | '));if(d.badN)l.push('Не понял строк: '+d.badN+' — например: '+d.bad.join(' | '));if(d.cut)l.push('Список слишком длинный: '+d.cut+' строк в конце не попадут в рассылку.');
 if(d.errors&&d.errors.length)l=l.concat(d.errors.map(function(x){return'• '+x}));msg($('fout'),d.ok?'g':'w',l);
 if(CH==='ga'&&d.preview&&d.preview[0]){var m=$('fout').firstChild;m.appendChild(el('div','','Так увидит сообщение первый клиент:'));var pv=el('div','',d.preview[0]);pv.style.cssText='white-space:pre-wrap;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin-top:4px';m.appendChild(pv)}}).catch(function(e){fail(e,$('fout'))})};
$('b_test').onclick=function(){var b=body();b.to=$('f_to1').value;var t=$('b_test');t.disabled=true;api('/api/bc/test',b).then(function(d){t.disabled=false;msg($('tout'),d.error?'e':'g',[d.error||d.text])}).catch(function(e){t.disabled=false;fail(e,$('tout'))})};
$('b_make').onclick=function(){var t=$('b_make');t.disabled=true;api('/api/bc/create',body()).then(function(d){t.disabled=false;if(!d.ok){msg($('fout'),'e',(d.errors||[d.error||'Не получилось.']).map(function(x){return'• '+x}));return}$('form').hidden=true;$('b_new').hidden=false;$('f_rec').value='';$('fout').textContent='';load()}).catch(function(e){t.disabled=false;fail(e,$('fout'))})};
document.addEventListener('visibilitychange',function(){if(!document.hidden)watch()});
load();
</script></body></html>`;
}
