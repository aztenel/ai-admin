// @ts-check
// Служебные страницы Altegio для владельца: /altegio (проверка связи с расписанием) и /altegio/user (проверка ключа пользователя).
import { esc, clean } from "../lib/text.js";
import { normPhone } from "../lib/phone.js";
import { money } from "../lib/money.js";
import { TZ, isoDay } from "../lib/time.js";
import { OWNER_BASE } from "../lib/css.js";
import { CLIENTS, hasClient } from "../config/builtin-clients.js";
import { ALT_DAYS, ALT_JOURNAL_DAYS } from "../config/constants.js";
import { altSelfCancel, altLoc, thin } from "../services/booking/book.js";
import { altUserKey } from "../services/booking/journal.js";
import { altText, altCall, altCache, altBase, altDates, altDropTimes, altTimes, altRecord, altEmailErr, ALT_EMAIL_TIP } from "../services/diag/deps.js";
/** @import { Env } from "../lib/types.js" */

// /altegio — проверка связи с расписанием: что бот видит в Altegio.
// Без телефона ничего не создаёт. С телефоном делает пробную запись на первое свободное время и сразу удаляет её.
/** @param {Env} env @param {string} cid @param {any} locArg @param {any} bookPhone */
export async function altDiag(env, cid, locArg, bookPhone) {
  const out = [], c = (hasClient(cid) && CLIENTS[cid]) || CLIENTS.alt, locStr = String(locArg || "").trim(), now = Date.now();
  out.push("Altegio: ключ разработчика " + (env.ALTEGIO_PARTNER ? "задан ✅" : "НЕ задан ❌ — Cloudflare → Settings → Variables and Secrets → Secret ALTEGIO_PARTNER"));
  if (locStr && (!/^\d{1,12}$/.test(locStr) || +locStr === 0)) { out.push(`Локация: ❌ номер «${clean(locStr, 30)}» не распознан — в адресе после loc= нужны только цифры`); return out.join("\n"); }
  const loc = +locStr || altLoc(env, c);
  if (loc < 0) { out.push(`Локация: ❌ в переменной ALTEGIO_LOC_${String(c.id).toUpperCase()} опечатка — нужны только цифры. Пока она не исправлена, бот не видит расписание`); return out.join("\n"); }
  out.push("Локация: " + (loc ? loc + (locStr ? " (из адреса страницы)" : ` (клиент «${c.name}»)`) : "не указана ❌"));
  out.push("Отмена и перенос: " + (altSelfCancel(env, c) ? "бот делает сам (включено ALTEGIO_SELF_CANCEL)" : "бот передаёт просьбу клиента администратору, сам в расписании ничего не удаляет"));
  const tgOn = !!env.TG_TOKEN && String(env["TG_CHAT_" + String(c.id).toUpperCase()] || env.TG_CHAT || "").split(/[,\s]+/).filter(Boolean).length > 0;
  out.push("Уведомления администратору (Telegram): " + (tgOn ? "настроены ✅" : "НЕ настроены ❌ — заявки и просьбы об отмене видны только на странице /leads; до запуска задайте TG_TOKEN и TG_CHAT"));
  { // журнал записей (ключ пользователя): с ним бот берёт записи клиента из CRM
    const ju = altUserKey(env, c), nm = "ALTEGIO_USER_" + String(c.id).toUpperCase();
    if (!ju) out.push(`Журнал записей: ключ ${nm} не задан — бот помнит записи сам и не видит, что администратор их удалил или перенёс (получить ключ — /altegio/user?c=${c.id})`);
    else if (loc > 0) { try { const d = await altCall(env, "GET", `/records/${loc}?start_date=${isoDay(now)}&end_date=${isoDay(now + ALT_JOURNAL_DAYS * 86400e3)}&count=200`, null, ju); out.push(`Журнал записей: читается ✅ (${Array.isArray(d) ? d.length : 0} записей на ${ALT_JOURNAL_DAYS} дней вперёд) — записи клиента бот берёт из CRM`); }
      catch (/** @type {any} */ e) { out.push(`Журнал записей: ❌ ключ ${nm} не подошёл (${e.status || ""} ${clean(e.message || "", 100)}) — получите новый на /altegio/user?c=${c.id}`); } }
  }
  if (!env.ALTEGIO_PARTNER || !loc) return out.join("\n");
  /** @param {any} e @returns {string} */
  const hint = e => e.status === 401 ? " → ключ разработчика неверный или отозван" : e.status === 403 ? " → у ключа нет доступа к этой локации или онлайн-запись выключена"
    : e.status === 404 ? " → локация с таким номером не найдена" : e.status === 429 ? " → слишком много запросов, повторите через минуту" : "";
  /** @type {any} */
  let lastErr = null;
  /** @param {string} name @param {() => Promise<any>} fn @param {(e: any) => string} [tip] */
  const step = async (name, fn, tip = hint) => { try { return await fn(); } catch (/** @type {any} */ e) { lastErr = e; out.push(`${name}: ❌ ${e.status || ""} ${e.message}${tip(e)}`); return null; } };
  altCache.clear(); // проверка всегда по свежим данным
  const base = await step("Услуги и мастера", () => altBase(env, loc, now));
  if (!base) return out.join("\n");
  /** @param {number} shown @param {number} total */
  const part = (shown, total) => total > shown ? ` (бот видит первые ${shown} из ${total})` : "";
  out.push("Услуги: " + (base.services.length ? "✅ " + base.services.length + part(base.services.length, base.total.services) : "❌ 0 — добавьте услуги и разрешите для них онлайн-запись"));
  base.services.slice(0, 15).forEach((/** @type {any} */ x) => out.push(`  · ${x.title} — ${x.min ? "от " + money(x.min) + " ₸" : "цена не указана"}${x.minutes ? ", " + x.minutes + " мин" : ""}`));
  out.push("Мастера: " + (base.staff.length ? "✅ " + base.staff.length + part(base.staff.length, base.total.staff) + " — " + base.staff.map((/** @type {any} */ m) => m.name + (m.busy ? " (сейчас без свободного времени)" : "")).join(", ") : "❌ 0 — добавьте сотрудника с графиком работы и разрешите к нему онлайн-запись"));
  const dates = (await step("Свободные даты", async () => altDates(await altCall(env, "GET", `/book_dates/${loc}?date_from=${isoDay(now)}&date_to=${isoDay(now + 21 * 86400e3)}`), now).slice(0, ALT_DAYS))) || [];
  out.push("Ближайшие даты с записью: " + (dates.join(", ") || "нет ❌ — у мастеров нет рабочего графика на ближайшие 3 недели"));
  let first = null;
  for (const d of dates) {
    const t = await step("Время на " + d, () => altTimes(env, loc, 0, d, null, now, true));
    if (t) { out.push(`  ${d}: ${thin(t.map((/** @type {any} */ x) => x.time)).join(", ") || "свободного времени нет"}`); if (!first && t[0]) first = { date: d, ...t[0], datetime: t[0].datetime || `${d}T${t[0].time.padStart(5, "0")}:00+0${TZ}:00` }; }
  }
  if (first && base.services[0]) {
    const appointments = [{ id: 1, services: [base.services[0].id], staff_id: 0, datetime: first.datetime }];
    const ok = await step("Пробная проверка записи (без создания)", async () => { await altCall(env, "POST", `/book_check/${loc}`, { appointments }); return true; });
    if (ok) out.push(`Пробная проверка записи (без создания): ✅ ${base.services[0].title}, ${first.date} в ${first.time}`);
  }
  if (bookPhone) {
    const ph = normPhone(bookPhone);
    out.push("");
    if (!ph) out.push("Пробная запись: ❌ номер телефона не распознан — нужен казахстанский мобильный, например +7 701 123 45 67");
    else if (!first || !base.services[0]) out.push("Пробная запись: ❌ нет свободного времени или услуг для записи");
    else {
      // мастер — конкретный, у которого это время свободно: так видно, как Altegio показывает время мастера с записью
      /** @type {any} */
      let pick = null;
      for (const m of base.staff.slice(0, 12)) { try { const t = await altTimes(env, loc, m.id, first.date, [base.services[0].id], now, true); if (t.some((/** @type {any} */ x) => x.time === first.time)) { pick = m; break; } } catch (e) {} }
      const appointments = [{ id: 1, services: [base.services[0].id], staff_id: pick ? pick.id : 0, datetime: first.datetime }];
      const where = `${first.date} в ${first.time}${pick ? ", мастер " + pick.name : ""}, клиент «Проверка бота (можно удалить)»`;
      const body = { phone: ph, fullname: "Проверка бота (можно удалить)", comment: "Пробная запись AI-администратора: создаётся и сразу удаляется", appointments };
      lastErr = null;
      /** @type {any} */
      let sent = null, needEmail = false;
      const rec = await step("Пробная запись", async () => {
        let r;
        try { r = await altRecord(env, loc, body); }
        catch (/** @type {any} */ e) { // пустой email не подошёл — пробуем с почтой владельца, чтобы понять, в email ли дело
          if (!altEmailErr(e) || !env.OWNER_EMAIL) throw e;
          needEmail = true; r = await altRecord(env, loc, { ...body, email: env.OWNER_EMAIL });
        }
        sent = r.sent;
        return (Array.isArray(r.data) ? r.data[0] : r.data) || {};
      }, (/** @type {any} */ e) => e.status === 404 ? " → услуга недоступна для онлайн-записи или локация не найдена" : altEmailErr(e) ? " → " + ALT_EMAIL_TIP : hint(e));
      if (needEmail) out.push(`⚠️ ${ALT_EMAIL_TIP}. Пока это не сделано, бот будет передавать записи администратору заявками (для пробы взята почта OWNER_EMAIL).`);
      if (rec && rec.record_id) {
        out.push(`Пробная запись: создана ✅ № ${rec.record_id} — ${base.services[0].title}, ${first.date} в ${first.time}`);
        if (sent && !/^\+/.test(String(sent.phone))) out.push("  (номер телефона Altegio принял только цифрами, без «+» — бот это учитывает)");
        // занято ли время мастера, пока запись есть, и свободно ли после удаления — по этому бот может замечать записи, удалённые администратором
        const seeTime = async () => {
          if (!pick) return "мастер не выбран";
          let a1, a2, a3;
          try { a1 = (await altTimes(env, loc, pick.id, first.date, [], now, true)).some((/** @type {any} */ x) => x.time === first.time) ? "свободно" : "занято"; } catch (/** @type {any} */ e) { a1 = "ошибка " + (e.status || ""); }
          try { a2 = (await altTimes(env, loc, pick.id, first.date, [base.services[0].id], now, true)).some((/** @type {any} */ x) => x.time === first.time) ? "свободно" : "занято"; } catch (/** @type {any} */ e) { a2 = "ошибка " + (e.status || ""); }
          try { await altCall(env, "POST", `/book_check/${loc}`, { appointments }); a3 = "проходит"; } catch (/** @type {any} */ e) { a3 = `не проходит (${e.code || e.status || ""} ${clean(e.message, 60)})`; }
          return `время мастера: ${a1}; с услугой: ${a2}; проверка записи: ${a3}`;
        };
        if (pick) out.push(`С записью (мастер ${pick.name}, ${first.time}) — ${await seeTime()}`);
        const del = rec.record_hash ? await step("Удаление пробной записи", async () => { await altCall(env, "DELETE", `/user/records/${rec.record_id}/${rec.record_hash}`); return true; },
          (/** @type {any} */ e) => e.status === 404 ? " → запись не найдена: возможно, её уже удалили" : hint(e)) : (out.push("Удаление пробной записи: ❌ Altegio не прислал код записи, без него бот не может её удалить"), null);
        out.push(del ? "Удаление пробной записи: ✅ — бот умеет и записывать, и отменять" : `⚠️ Пробную запись удалите вручную в журнале Altegio: ${where}`);
        if (del && pick) out.push(`После удаления — ${await seeTime()}`);
      } else if (rec) out.push(`Пробная запись: ⚠️ Altegio ответил без номера записи — запись могла создаться. Проверьте журнал Altegio: ${where}`);
      else if (lastErr && (!lastErr.status || lastErr.status >= 500 || (lastErr.status >= 200 && lastErr.status < 300))) out.push(`  → понятного ответа нет: запись могла создаться. Проверьте журнал Altegio: ${where}`);
      else if (lastErr && lastErr.code === 432) out.push("  → локация требует код из SMS: отключите подтверждение номера в настройках онлайн-записи Altegio, иначе бот будет передавать заявки администратору");
      else if (lastErr) out.push("  → запись не создана");
    }
  }
  if (!locStr) out.push("", `Чат с записью в это расписание: /?c=${c.id}`);
  return out.join("\n");
}

// Проверка ключа пользователя Altegio (вход логином и паролем салона): видит ли бот журнал записей.
// Пароль никуда не сохраняется и не пишется в журнал; ключ пользователя на странице не показывается.
/** @param {Env} env @param {string} cid @param {any} login @param {any} password @param {any} phone */
export async function altUserProbe(env, cid, login, password, phone) { // → { text, token }
  const out = [], c = (hasClient(cid) && CLIENTS[cid]) || CLIENTS.alt, loc = altLoc(env, c), now = Date.now();
  if (!env.ALTEGIO_PARTNER) return { text: "Altegio: не задан ключ разработчика ALTEGIO_PARTNER" };
  if (!loc) return { text: `У бота «${c.name}» не задан номер локации Altegio` };
  out.push(`Локация: ${loc} (бот «${c.name}»)`);
  /** @param {any} e */
  const err = e => `ошибка ${e.status || ""}${e.code ? " код " + e.code : ""} ${clean(e.message || "", 160)}`.trim();
  let token = "";
  try { const d = await altCall(env, "POST", "/auth", { login: clean(login, 120), password: String(password || "").slice(0, 200) }); token = (d && d.user_token) || ""; out.push(token ? `Вход в Altegio: ✅ ключ пользователя получен${d.name ? " (" + altText(d.name, 40) + ")" : ""}` : "Вход в Altegio: ⚠️ ответ без user_token, поля: " + Object.keys(d || {}).slice(0, 12).join(", ")); }
  catch (e) { out.push("Вход в Altegio: ❌ " + err(e)); return { text: out.join("\n"), token }; }
  if (!token) return { text: out.join("\n"), token };
  const from = isoDay(now), to = isoDay(now + 14 * 86400e3), q = `start_date=${from}&end_date=${to}`;
  const ways = [["записи (records)", `/records/${loc}?${q}&count=200`], ["записи (appointments)", `/locations/${loc}/appointments?${q}`]];
  /** @param {any} p */
  const mask = p => { const d = String(p || "").replace(/\D/g, ""); return d ? "…" + d.slice(-4) : "—"; };
  /** @param {any} r */
  const recOf = r => ({ id: r.id || r.record_id, at: r.datetime || r.date || r.start_at || "", staff: altText((r.staff && r.staff.name) || r.staff_name || "", 40), phone: (r.client && r.client.phone) || r.phone || "", del: "deleted" in r ? JSON.stringify(r.deleted) : "нет поля", svc: altText(((r.services || [])[0] || {}).title || "", 40) });
  /** @type {any} */
  let way = null;
  /** @param {boolean} show */
  const list = async (show) => {
    for (const [name, path] of way ? [way] : ways) {
      try {
        const d = await altCall(env, "GET", path, null, token), arr = Array.isArray(d) ? d : (d && (d.data || d.records || d.appointments)) || [];
        if (!Array.isArray(arr)) { if (show) out.push(`${name}: ⚠️ ответ не список, поля: ${Object.keys(d || {}).slice(0, 12).join(", ")}`); continue; }
        if (!way) { way = [name, path]; }
        if (show) {
          out.push(`${name}: ✅ ${arr.length} на ${from} … ${to}`);
          if (arr[0]) out.push("  поля записи: " + Object.keys(arr[0]).slice(0, 24).join(", "));
          for (const r of arr.slice(0, 5).map(recOf)) out.push(`  № ${r.id} — ${r.at}, ${r.svc || "?"}, мастер ${r.staff || "?"}, телефон ${mask(r.phone)}, deleted: ${r.del}`);
        }
        return arr;
      } catch (e) { if (show) out.push(`${name}: ❌ ${err(e)}`); }
    }
    return null;
  };
  const first = await list(true);
  if (!first || !phone) return { text: out.join("\n") + (first ? "" : "\n\nЖурнал записей этим ключом не читается."), token };
  // пробная запись: видна ли она в журнале и что с ней после удаления
  const ph = normPhone(phone);
  if (!ph) { out.push("", "Пробная запись: ❌ номер телефона не распознан"); return { text: out.join("\n"), token }; }
  try {
    const base = await altBase(env, loc, now), dates = altDates(await altCall(env, "GET", `/book_dates/${loc}`), now);
    let slot = null, day = "";
    for (const d of dates.slice(0, 3)) { const t = await altTimes(env, loc, 0, d, null, now, true); if (t[0]) { slot = t[0]; day = d; break; } }
    if (!slot || !base.services[0]) { out.push("", "Пробная запись: ❌ нет свободного времени"); return { text: out.join("\n"), token }; }
    const appointments = [{ id: 1, services: [base.services[0].id], staff_id: 0, datetime: slot.datetime || `${day}T${slot.time.padStart(5, "0")}:00+0${TZ}:00` }];
    const rec = (x => (Array.isArray(x) ? x[0] : x) || {})((await altRecord(env, loc, { phone: ph, fullname: "Проверка бота (можно удалить)", comment: "Проверка журнала: создаётся и сразу удаляется", appointments })).data);
    if (!rec.record_id) { out.push("", "Пробная запись: ⚠️ Altegio не вернул номер записи — проверьте журнал"); return { text: out.join("\n"), token }; }
    out.push("", `Пробная запись: создана № ${rec.record_id} — ${day} в ${slot.time}`);
    const find = async () => { const a = await list(false); if (!a) return "журнал не прочитан"; const r = a.find(x => String(x.id || x.record_id) === String(rec.record_id)); if (!r) return "в журнале её нет"; const v = recOf(r); return `в журнале есть: мастер ${v.staff || "?"}, телефон ${mask(v.phone)}, deleted: ${v.del}`; };
    const one = async () => { const res = []; for (const [n, p] of [["record", `/record/${loc}/${rec.record_id}`], ["appointments", `/locations/${loc}/appointments/${rec.record_id}`]]) { try { const d = await altCall(env, "GET", p, null, token); res.push(`${n}: ✅ deleted: ${d && "deleted" in d ? JSON.stringify(d.deleted) : "нет поля"}${d && d.staff && d.staff.name ? ", мастер " + altText(d.staff.name, 40) : ""}`); } catch (e) { res.push(`${n}: ${err(e)}`); } } return res.join("; "); };
    out.push(`  с записью — ${await find()}`, `  чтение одной записи — ${await one()}`);
    try { await altCall(env, "DELETE", `/user/records/${rec.record_id}/${rec.record_hash}`); altDropTimes(loc); out.push("  удалена ✅"); }
    catch (e) { out.push(`  ⚠️ не удалилась (${err(e)}) — удалите вручную в журнале: ${day} ${slot.time}`); return { text: out.join("\n"), token }; }
    out.push(`  после удаления — ${await find()}`, `  чтение одной записи — ${await one()}`);
  } catch (e) { out.push("Пробная запись: ❌ " + err(e)); }
  return { text: out.join("\n"), token };
}
/** @param {any} body @param {string} cid @param {any} key @param {any} [token] @param {string} [slug] */
export function altUserPage(body, cid, key, token, slug) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Журнал Altegio</title>
<style>${OWNER_BASE}.w{max-width:900px}
pre{white-space:pre-wrap;word-wrap:break-word;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;margin:0 0 14px;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace}
form{display:grid;gap:8px}input{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:10px;padding:11px 12px;font-size:16px}
button{background:var(--acc);color:#fff;border:0;border-radius:10px;padding:12px 16px;font:600 15px inherit;cursor:pointer}p{color:var(--muted);line-height:1.5;font-size:14px}</style></head>
<body><div class="top"><b>Журнал Altegio</b><a href="/admin">Панель</a><a href="/logout">Выйти</a></div><div class="w"><h1>Проверка ключа пользователя</h1>${body ? `<pre>${esc(body)}</pre>` : ""}
${token ? `<details style="margin:0 0 14px"><summary style="cursor:pointer;font-weight:600">Ключ для Cloudflare — открыть, только чтобы скопировать (в чат не присылать)</summary>
<p>Cloudflare → Workers → ai-admin → Settings → Variables and Secrets → Add: тип <b>Secret</b>, имя <b>${esc(slug)}</b>, значение — ключ ниже. Для черновиков — то же в разделе Previews. Ключ действует, пока не сменён пароль в Altegio.</p>
<input readonly value="${esc(token)}" onfocus="this.select()" style="width:100%"></details>` : ""}
<form method="post" action="/altegio/user"><input type="hidden" name="c" value="${esc(cid)}"><input type="hidden" name="key" value="${esc(key || "")}">
<input name="login" autocomplete="username" placeholder="Логин Altegio (почта или телефон)" required>
<input name="password" type="password" autocomplete="current-password" placeholder="Пароль Altegio" required>
<input name="phone" type="tel" placeholder="Ваш телефон для пробной записи (можно не заполнять)">
<button>Проверить</button></form>
<p>Логин и пароль нужны один раз, чтобы Altegio выдал боту ключ пользователя. Бот их не сохраняет. Пробная запись создаётся и сразу удаляется: так видно, показывает ли журнал запись и её удаление.</p></div></body></html>`;
}
/** @param {string} body @param {string} key @param {string} cid @param {any} loc */
export function altPage(body, key, cid, loc) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Проверка Altegio</title>
<style>${OWNER_BASE}.w{max-width:900px}
pre{white-space:pre-wrap;word-wrap:break-word;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;margin:0;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace}
form{margin-top:14px;display:flex;gap:8px;flex-wrap:wrap}input[type=tel]{flex:1;min-width:200px;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:10px;padding:11px 12px;font-size:16px}
button{background:var(--acc);color:#fff;border:0;border-radius:10px;padding:11px 16px;font:600 15px inherit;cursor:pointer}p{color:var(--muted);line-height:1.5;font-size:14px}</style></head>
<body><div class="top"><b>Расписание Altegio</b><a href="/admin">Панель</a><a href="/logout">Выйти</a></div><div class="w"><pre>${esc(body)}</pre>
<form method="post" action="/altegio"><input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="c" value="${esc(cid)}"><input type="hidden" name="loc" value="${esc(loc)}">
<input type="tel" name="phone" placeholder="Ваш телефон: +7 701 123 45 67" aria-label="Телефон для пробной записи" required><button>Пробная запись</button></form>
<p>Пробная запись создаётся на первое свободное время и сразу удаляется. Так проверяется весь путь: телефон, запись, отмена. Укажите свой номер: Altegio может отправить на него уведомление.</p></div></body></html>`;
}
