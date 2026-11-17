// Приложение CRM (iPhone, значок на экране «Домой»). Данные — только через /api/* (сервер src/worker.js), здесь — экран.
// Без библиотек и без сборки: модуль браузера. Правила этапов и оценки — общие с сервером (score.js).
import { score, STAGES, ACTIVE, CALL_RESULTS, BOOKINGS, IMPRESSIONS } from "./score.js";

const SN = Object.fromEntries(STAGES.map(s => [s[0], s]));
const $ = id => /** @type {HTMLElement} */ (document.getElementById(id));
const val = id => { const e = /** @type {HTMLInputElement | null} */ (document.getElementById(id)); return e ? e.value.trim() : ""; };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const digits = s => String(s || "").replace(/\D/g, "");
const money = n => (+n || 0).toLocaleString("ru-RU") + " ₸";
const short = n => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(".0", "") + " млн" : n >= 1000 ? Math.round(n / 1000) + "к" : String(n || 0));
/** номер для звонка: 8 701… и 701… → +7 701… */
const dial = p => { let d = digits(p); if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1); if (d.length === 10) d = "7" + d; return d; };
const phones = s => String(s || "").split(/[;,\n]/).map(x => x.trim()).filter(Boolean);
const day0 = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const DAY = 864e5;
const fmt = t => {
  if (!t) return ""; const d = new Date(+t), td = day0(), dd = day0(d), hm = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (dd === td) return "сегодня " + hm; if (dd === td + DAY) return "завтра " + hm; if (dd === td - DAY) return "вчера " + hm;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) + " " + hm;
};
const toInput = t => { if (!t) return ""; const d = new Date(+t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fromInput = s => { const t = s ? new Date(s).getTime() : NaN; return Number.isFinite(t) ? t : null; };
const at = (plusDays, h, m = 0) => { const d = new Date(day0() + plusDays * DAY); d.setHours(h, m, 0, 0); return d.getTime(); };
const store = { get: k => { try { return localStorage.getItem("crm." + k) || ""; } catch (e) { return ""; } }, set: (k, v) => { try { localStorage.setItem("crm." + k, v); } catch (e) {} } };

const ICON_CALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>';
const ICON_WA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z"/></svg>';

/* ---------- состояние ---------- */
const S = {
  tab: "today", f: { stage: "all", grade: "all", city: "", niche: "", sort: "score", q: "" },
  items: /** @type {any[]} */ ([]), total: 0, meta: { cities: [], niches: [], bookings: [] },
  today: /** @type {any} */ (null), funnel: /** @type {any} */ (null),
  cur: /** @type {any} */ (null), pick: "", form: /** @type {Record<string, any>} */ ({}), busy: false
};

/* ---------- сервер ---------- */
class ApiError extends Error { constructor(message, code, data) { super(message); this.code = code; this.data = data; } }
async function api(path, { method = "GET", body } = {}) {
  let r;
  try { r = await fetch(path, { method, credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { $("net").textContent = "Нет связи"; throw new ApiError("Нет связи. Проверьте интернет и повторите.", "net"); }
  $("net").textContent = "";
  const j = await r.json().catch(() => null);
  if (r.status === 401) { showLogin(); throw new ApiError("Нужен вход", "auth"); }
  if (!r.ok || !j || j.ok === false) throw new ApiError((j && j.error) || "Ошибка " + r.status, (j && j.code) || "error", j);
  return j;
}
let toastTimer = 0;
function toast(t) { $("toast").textContent = t; $("toast").hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $("toast").hidden = true; }, 3500); }
const oops = e => { if (e && e.code !== "auth") toast(e.message || "Не получилось"); };

/* ---------- вход ---------- */
function showLogin() { $("app").hidden = true; closeSheet(); $("login").hidden = false; }
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault(); $("loginErr").textContent = "";
  try {
    const r = await fetch("/api/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: val("loginKey") }) });
    const j = await r.json().catch(() => null);
    if (!r.ok) { $("loginErr").textContent = (j && j.error) || "Не получилось войти"; return; }
    /** @type {HTMLInputElement} */ ($("loginKey")).value = ""; await start();
  } catch (err) { $("loginErr").textContent = "Нет связи. Проверьте интернет."; }
});

/* ---------- карточка в списке ---------- */
const gradeBox = l => '<span class="gr ' + (l.grade || "N") + '" aria-label="Оценка ' + (l.grade || "нет") + '">' + (l.grade || "?") + '</span>';
const qual = l => [l.rating ? "★ " + l.rating : "", l.reviews != null ? l.reviews + " отз." : "", l.masters != null ? l.masters + " маст." : "", l.ig_followers != null ? "IG " + short(l.ig_followers) : ""].filter(Boolean).join(" · ");
function card(l, why) {
  const s = SN[l.stage] || SN.new, p0 = phones(l.phones)[0];
  const tags = ['<span class="tag s-' + s[2] + '">' + s[1] + '</span>', l.booking && l.booking !== "Нет" ? '<span class="tag">' + esc(l.booking) + '</span>' : "",
    l.branches > 1 ? '<span class="tag net">сеть · ' + l.branches + '</span>' : "", l.lpr_name ? '<span class="tag">' + esc(l.lpr_name) + '</span>' : "",
    l.prepay ? '<span class="tag s-good">' + money(l.prepay) + '</span>' : ""].join("");
  const sub = why || [l.city, l.address].filter(Boolean).map(esc).join(" · "), q = qual(l);
  return '<article class="lead"><button class="top" data-open="' + l.id + '">' + gradeBox(l) + '<span class="body"><div class="nm">' + esc(l.name) + '</div>' +
    (sub ? '<div class="meta">' + sub + '</div>' : "") + (q ? '<div class="meta">' + esc(q) + '</div>' : "") + '<div class="tags">' + tags + '</div></span></button>' +
    '<div class="acts">' + (p0 ? '<a class="btn call" href="tel:+' + dial(p0) + '">' + ICON_CALL + 'Позвонить</a><a class="btn wa" href="https://wa.me/' + dial(p0) + '" target="_blank" rel="noopener" aria-label="Написать в WhatsApp">' + ICON_WA + '</a>'
      : '<span class="btn">Нет номера</span><span></span>') + '<button class="btn" data-open="' + l.id + '" data-touch="1">Итог</button></div></article>';
}
const list = (arr, why) => arr.length ? '<div class="list">' + arr.map(l => card(l, why && why(l))).join("") + '</div>' : "";
const sec = (title, n, html, cls = "") => '<div class="sec-h ' + cls + '"><h2>' + title + '</h2><span>' + n + '</span></div>' + html;
const whenNext = l => "<b>" + esc(fmt(l.next_at)) + "</b>" + (l.next_what ? " · " + esc(l.next_what) : "");

/* ---------- разделы ---------- */
async function loadToday() {
  const from = day0(), week = from - ((new Date().getDay() + 6) % 7) * DAY;
  S.today = await api(`/api/today?from=${from}&to=${from + DAY}&week=${week}`);
}
function viewToday() {
  const t = S.today; if (!t) return '<div class="empty">Загружаю…</div>';
  let h = sec("Встречи сегодня", t.meetToday.length, list(t.meetToday, l => "<b>" + esc(fmt(l.meet_at)) + "</b>" + (l.address ? " · " + esc(l.address) : "")) || '<div class="empty">Сегодня встреч нет. После звонка отметьте «Встреча назначена» — она появится здесь.</div>');
  if (t.overdue.length) h += sec("Пора перезвонить", t.overdue.length, list(t.overdue, whenNext), "alert");
  if (t.later.length) h += sec("Позже сегодня", t.later.length, list(t.later, whenNext));
  if (t.meetPassed.length) h += sec("Встреча прошла — отметьте итог", t.meetPassed.length, list(t.meetPassed, l => "Была " + esc(fmt(l.meet_at))), "alert");
  h += sec("Новые — звонить", t.freshTotal, list(t.fresh) || '<div class="empty">Новых лидов нет. Нажмите «+», чтобы добавить первого.</div>');
  if (t.freshTotal > t.fresh.length) h += '<button class="btn more" data-goto="new">Все новые (' + t.freshTotal + ')</button>';
  return h;
}
function renderStats() {
  const s = (S.today && S.today.stats) || { calls: 0, lpr: 0, meets: 0, prepayWeek: 0 };
  $("stats").innerHTML = '<div class="st"><b>' + s.calls + '</b><span>звонков сегодня</span></div><div class="st"><b>' + s.lpr + '</b><span>ЛПР сегодня</span></div><div class="st"><b>' + s.meets + '</b><span>встреч назначено</span></div><div class="st"><b>' + short(s.prepayWeek) + '</b><span>предоплат за неделю</span></div>';
  const due = S.today ? S.today.due : 0; $("bToday").hidden = !due; $("bToday").textContent = String(due);
}

async function loadLeads(more = false) {
  const f = S.f, p = new URLSearchParams({ stage: f.stage, sort: f.sort, limit: "50", offset: String(more ? S.items.length : 0) });
  if (f.grade !== "all") p.set("grade", f.grade === "?" ? "" : f.grade);
  if (f.city) p.set("city", f.city); if (f.niche) p.set("niche", f.niche); if (f.q) p.set("q", f.q);
  const r = await api("/api/leads?" + p);
  S.items = more ? S.items.concat(r.items) : r.items; S.total = r.total;
}
function viewLeads() {
  const why = l => (l.next_at && ACTIVE.includes(l.stage) ? "Следующий шаг: " + whenNext(l) : "");
  return (S.items.length ? '<div class="note">Найдено: ' + S.total + '</div>' + list(S.items, why) : '<div class="empty">Ничего не найдено. Измените фильтры или добавьте лида кнопкой «+».</div>') +
    (S.total > S.items.length ? '<button class="btn more" id="more">Показать ещё (' + (S.total - S.items.length) + ')</button>' : "");
}
function renderFilters() {
  const f = S.f, chip = (attr, v, label, on) => '<button class="chip" data-' + attr + '="' + esc(v) + '" aria-pressed="' + on + '">' + esc(label) + '</button>';
  $("chipsGrade").innerHTML = [["all", "Все оценки"], ["A", "A · сильные"], ["B", "B · средние"], ["C", "C · слабые"], ["?", "? · мало данных"]].map(o => chip("grade", o[0], o[1], f.grade === o[0])).join("");
  $("chipsStage").innerHTML = [["all", "Все этапы"], ["work", "В работе"], ...STAGES.map(s => [s[0], s[1]])].map(o => chip("stage", o[0], o[1], f.stage === o[0])).join("");
  const sel = (id, label, cur, opts) => '<select id="' + id + '" aria-label="' + label + '"><option value="">' + label + '</option>' + opts.map(o => '<option' + (o === cur ? " selected" : "") + '>' + esc(o) + '</option>').join("") + '</select>';
  $("selects").innerHTML = (S.meta.cities.length > 1 ? sel("fCity", "Все города", f.city, S.meta.cities) : "") + (S.meta.niches.length > 1 ? sel("fNiche", "Все ниши", f.niche, S.meta.niches) : "") +
    '<select id="fSort" aria-label="Порядок">' + [["score", "По оценке"], ["recent", "Недавние"], ["next", "По следующему шагу"]].map(o => '<option value="' + o[0] + '"' + (f.sort === o[0] ? " selected" : "") + '>' + o[1] + '</option>').join("") + '</select>';
}

async function loadFunnel() { S.funnel = await api("/api/funnel"); }
function viewFunnel() {
  const f = S.funnel; if (!f) return '<div class="empty">Загружаю…</div>';
  const by = s => f.byStage[s] || 0, total = STAGES.reduce((a, s) => a + by(s[0]), 0), max = Math.max(1, ...STAGES.filter(s => s[0] !== "new").map(s => by(s[0])));
  const c = f.calls, pct = (a, b) => (b ? " (" + Math.round(a / b * 100) + "%)" : "");
  return '<div class="money"><div class="st"><b>' + money(f.paid.prepay) + '</b><span>предоплат всего</span></div><div class="st"><b>' + money(f.paid.price) + '</b><span>сумма сделок</span></div>' +
    '<div class="st"><b>' + c.calls7 + '</b><span>звонков за 7 дней</span></div><div class="st"><b>' + total + '</b><span>лидов в базе</span></div></div>' +
    sec("Этапы", "нажмите, чтобы открыть", '<div class="fun">' + STAGES.map(s => '<button class="frow" data-goto="' + s[0] + '"><span>' + s[1] + '</span><b>' + by(s[0]) + '</b>' + (s[0] === "new" ? "" : '<span class="bar"><i data-w="' + Math.round(by(s[0]) / max * 100) + '"></i></span>') + '</button>').join("") + '</div>') +
    sec("Оценки", "", '<div class="plain">' + ["A", "B", "C", "?"].map(g => g + ": <b>" + (f.byGrade[g] || 0) + "</b>").join(" · ") + '</div>') +
    sec("Конверсия", "за всё время", '<div class="plain">Звонков: <b>' + c.calls + '</b> · дозвон: <b>' + c.reach + '</b>' + pct(c.reach, c.calls) + '<br>Назначено встреч: <b>' + c.meets + '</b>' + pct(c.meets, c.calls) + ' от звонков<br>Предоплат: <b>' + f.paid.n + '</b>' + pct(f.paid.n, c.meets) + ' от встреч</div>') +
    sec("Данные", "", '<a class="ghost" href="/api/export.csv" download>Скачать все лиды (CSV для Excel)</a><div class="f"><label for="meName">Ваше имя — подставится в скрипт</label><input id="meName" value="' + esc(store.get("me")) + '" placeholder="Имя"></div><button class="ghost danger" id="logout">Выйти</button>');
}

function viewScript() {
  const me = esc(store.get("me") || "[имя]");
  return `<div class="sc">
<details open><summary>Администратору · 30 секунд</summary><div class="in">
<div class="say"><b>Начало</b>Здравствуйте! Меня зовут ${me}. Подскажите, как к вам обращаться? … [Имя], я работаю с барбершопами: официальные сообщения WhatsApp от имени барбершопа и возврат клиентов, которые перестали ходить. Подготовил короткий разбор по вашему барбершопу для владельца. Как его зовут и как удобнее передать — дадите его WhatsApp?</div>
<div class="say"><b>Польза админу</b>Подтверждения и напоминания о записи уходят сами, клиенты записываются без звонков.</div>
<div class="say"><b>Не дают номер</b>Понимаю. Тогда передайте: звонил ${me}, по клиентам, которые перестали ходить. Когда он обычно на месте? Я заеду сам, это пять минут.</div>
</div></details>
<details><summary>Владельцу · встреча</summary><div class="in">
<div class="say"><b>20 секунд</b>[Имя], добрый день, я ${me}. Сразу скажу: я не делаю просто сайты и не настраиваю рекламу. Я возвращаю клиентов, которые у вас уже были. Две минуты удобно?</div>
<div class="say"><b>Факты</b>Посмотрел вас: [N] отзывов в 2ГИС, [N] мастеров — значит, в базе тысячи клиентов, и часть не была больше двух месяцев. А WhatsApp у вас обычный: официальное сообщение с кнопкой «Записаться» с него не отправить, а массовые сообщения с обычного номера блокируют.</div>
<div class="say"><b>Вопрос</b>Вы знаете, сколько клиентов не были у вас больше двух месяцев?</div>
<div class="say"><b>Закрытие</b>Покажу за 15 минут у вас, на ваших цифрах. Сегодня в 16:00 или в 18:00?</div>
</div></details>
<details><summary>На встрече · закрыть</summary><div class="in">
<div class="say"><b>Деньги</b>Предоплата — это пара процентов вашего месячного оборота. А чтобы окупить весь пакет, нужно вернуть несколько десятков клиентов из тысяч в базе. Посчитаем на ваших цифрах.</div>
<div class="say"><b>Честно о результате</b>Говорить только то, что уже проверено: что подключено, что работает, какие сообщения доходят. Цифр возврата не обещать, пока их нет.</div>
<div class="say"><b>Закрытие</b>Если начинаем сегодня, завтра подключаю. Удобно Kaspi или переводом? — и молчать.</div>
</div></details>
<details><summary>Возражения</summary><div class="in">
<div class="obj"><q>А название будет вместо номера?</q>Название будет в каждом сообщении, сверху, и кнопки. Название вместо номера в шапке чата Meta включает после подтверждения компании — подаю заявку по вашим документам. Срок решает Meta, обещать дату не могу.</div>
<div class="obj"><q>Сколько стоит?</q>Зависит от размера. На встрече посчитаю, сколько клиентов нужно вернуть, чтобы окупилось.</div>
<div class="obj"><q>Пришлите информацию</q>Пришлю. Но цифры вашей базы лучше показать — сегодня в 16 или в 18?</div>
<div class="obj"><q>В системе записи уже есть уведомления</q>Это напоминания тем, кто уже записан. Я возвращаю тех, кто не записан и перестал ходить.</div>
<div class="obj"><q>Пишем клиентам сами</q>С обычного номера массовые сообщения блокируют, и не видно, кто вернулся. Здесь официально и с отчётом.</div>
<div class="obj"><q>Боюсь блокировки</q>Пишем только вашим клиентам, небольшими порциями, с кнопкой «Отписаться», качество номера смотрим каждый день. Это по правилам Meta.</div>
<div class="obj"><q>Надо подумать</q>Конечно. Что именно — цену или результат? Созвонимся в четверг в 12:00, скажете да или нет.</div>
</div></details>
<details><summary>Окупаемость · калькулятор</summary><div class="in">
<div class="grid2"><div class="f"><label for="cChek">Чек, ₸</label><input id="cChek" inputmode="numeric" value="${esc(store.get("chek") || "7000")}"></div><div class="f"><label for="cPack">Пакет, ₸</label><input id="cPack" inputmode="numeric" value="${esc(store.get("pack"))}" placeholder="цена пакета"></div></div>
<div class="out" id="cOut"></div>
</div></details>
<details><summary>Чего не говорить</summary><div class="in">
<div>Не обещать название вместо номера и «зелёную галочку» — это решает Meta.</div>
<div>Не обещать процент возврата и «без блокировок» — только «по правилам Meta» и «посчитаем на ваших цифрах».</div>
<div>Не выдумывать общих знакомых и фактов.</div>
</div></details></div>`;
}
function calc() {
  const c = +digits(val("cChek")), p = +digits(val("cPack")); store.set("chek", String(c || "")); store.set("pack", String(p || ""));
  $("cOut").textContent = c && p ? "Окупится, если вернуть " + Math.ceil(p / c) + " клиентов" : "Впишите чек и цену пакета";
}

const TITLES = { today: "Сегодня", leads: "Лиды", funnel: "Воронка", script: "Скрипт" };
function render() {
  $("ttl").textContent = TITLES[S.tab];
  document.querySelectorAll("nav button").forEach(b => b.setAttribute("aria-current", /** @type {HTMLElement} */ (b).dataset.tab === S.tab ? "page" : "false"));
  $("filters").hidden = S.tab !== "leads"; $("fab").hidden = S.tab === "script";
  renderStats();
  if (S.tab === "leads") renderFilters();
  $("view").innerHTML = S.tab === "today" ? viewToday() : S.tab === "leads" ? viewLeads() : S.tab === "funnel" ? viewFunnel() : viewScript();
  // ширина полосок — через свойство, а не атрибут style в разметке: так требует политика безопасности страницы
  $("view").querySelectorAll("[data-w]").forEach(e => { /** @type {HTMLElement} */ (e).style.width = /** @type {HTMLElement} */ (e).dataset.w + "%"; });
  if (S.tab === "script") calc();
}
async function refresh() {
  try {
    if (S.tab === "today") await loadToday();
    else if (S.tab === "leads") await Promise.all([loadLeads(), loadToday()]);
    else if (S.tab === "funnel") await Promise.all([loadFunnel(), loadToday()]);
  } catch (e) { oops(e); }
  render();
}
async function go(tab) { S.tab = tab; render(); window.scrollTo(0, 0); await refresh(); }

/* ---------- форма лида (новый и правка) ---------- */
const seg = (name, opts, cur) => '<div class="grid3">' + opts.map(o => '<button type="button" class="opt" data-seg="' + name + '" data-v="' + o[0] + '" aria-pressed="' + (String(cur ?? "") === String(o[0])) + '">' + o[1] + '</button>').join("") + '</div>';
function formHtml(l) {
  const f = (id, label, v, ph = "", mode = "") => '<div class="f"><label for="' + id + '">' + label + '</label><input id="' + id + '" value="' + esc(v ?? "") + '" placeholder="' + esc(ph) + '"' + (mode ? ' inputmode="' + mode + '"' : "") + ' autocomplete="off"></div>';
  const dl = (id, arr) => '<datalist id="' + id + '">' + arr.map(o => '<option value="' + esc(o) + '">').join("") + '</datalist>';
  S.form = { ig_alive: l.ig_alive ?? "", impression: l.impression ?? "" };
  return '<div class="scorebox" id="scoreBox"></div>' +
    f("dName", "Название", l.name, "Barbershop …") + f("dPhone", "Телефон (несколько — через ;)", l.phones, "+7 7__ ___ __ __", "tel") +
    '<div class="grid2"><div class="f"><label for="dCity">Город</label><input id="dCity" list="dlCity" value="' + esc(l.city ?? "") + '" placeholder="Астана" autocomplete="off">' + dl("dlCity", S.meta.cities) + '</div>' +
    '<div class="f"><label for="dNiche">Ниша</label><input id="dNiche" list="dlNiche" value="' + esc(l.niche ?? "") + '" placeholder="Барбершоп" autocomplete="off">' + dl("dlNiche", S.meta.niches) + '</div></div>' +
    f("dAddr", "Адрес", l.address, "Кабанбай батыра, 18") +
    '<div class="sec"><div class="lbl">Оценка: 2ГИС</div><div class="grid2">' + f("dReviews", "Отзывов", l.reviews, "380", "numeric") + f("dRating", "Рейтинг", l.rating, "4.9", "decimal") + '</div></div>' +
    '<div class="sec"><div class="lbl">Оценка: мастера и филиалы</div><div class="grid2">' + f("dMasters", "Мастеров", l.masters, "6", "numeric") + f("dBranches", "Филиалов", l.branches, "1", "numeric") + '</div></div>' +
    '<div class="sec"><div class="lbl">Оценка: Instagram и впечатление</div>' + f("dIg", "Подписчиков", l.ig_followers, "12000", "numeric") +
    '<div class="f"><span class="l">Профиль живой (посты за последний месяц)</span>' + seg("ig_alive", [[1, "Да"], [0, "Нет"], ["", "Не смотрел"]], l.ig_alive) + '</div>' +
    '<div class="f"><span class="l">Ваше впечатление</span>' + seg("impression", IMPRESSIONS, l.impression) + '</div></div>' +
    '<div class="sec"><div class="lbl">Ссылки и запись</div>' + f("dGis", "2ГИС", l.gis_url, "https://2gis.kz/…", "url") + f("dInsta", "Instagram", l.instagram, "@barbershop", "url") +
    '<div class="f"><label for="dBooking">Система записи</label><select id="dBooking"><option value="">Не знаю</option>' + BOOKINGS.map(b => '<option' + (l.booking === b ? " selected" : "") + '>' + b + '</option>').join("") + '</select></div>' +
    f("dBook", "Ссылка на онлайн-запись", l.booking_url, "https://n….alteg.io", "url") + f("dChek", "Чек стрижки, ₸", l.avg_check, "7000", "numeric") + '</div>' +
    '<div class="sec"><div class="lbl">Кто решает</div><div class="grid2">' + f("dLpr", "Имя ЛПР", l.lpr_name, "Ерлан, владелец") + f("dLprPh", "WhatsApp ЛПР", l.lpr_phone, "+7 7__", "tel") + '</div></div>' +
    '<div class="f"><label for="dNote">Заметки</label><textarea id="dNote" placeholder="Что увидели в 2ГИС и Instagram">' + esc(l.notes ?? "") + '</textarea></div>';
}
function readForm() {
  const n = id => (val(id) === "" ? null : val(id));
  return { name: val("dName"), phones: val("dPhone"), city: val("dCity"), niche: val("dNiche"), address: val("dAddr"), reviews: n("dReviews"), rating: n("dRating"), masters: n("dMasters"), branches: n("dBranches"),
    ig_followers: n("dIg"), ig_alive: S.form.ig_alive === "" ? null : +S.form.ig_alive, impression: S.form.impression === "" ? null : +S.form.impression, gis_url: val("dGis"), instagram: val("dInsta"),
    booking: val("dBooking"), booking_url: val("dBook"), avg_check: n("dChek"), lpr_name: val("dLpr"), lpr_phone: val("dLprPh"), notes: val("dNote") };
}
function showScore() {
  const box = document.getElementById("scoreBox"); if (!box) return;
  const f = readForm(), s = score({ ...f, rating: f.rating === null ? null : String(f.rating).replace(",", ".") });
  box.innerHTML = '<span class="gr ' + (s.grade || "N") + '">' + (s.grade || "?") + '</span><span><span class="t">' + (s.grade ? "Оценка " + s.score + " из 100" : "Мало данных для оценки") + '</span><div class="note">Заполнено признаков: ' + s.filled + ' из 7' + (s.grade ? "" : " — нужно хотя бы 3") + '</div></span>';
}
const FIELD_IDS = { name: "dName", phones: "dPhone", rating: "dRating", reviews: "dReviews", masters: "dMasters", branches: "dBranches", ig_followers: "dIg", gis_url: "dGis", instagram: "dInsta", booking_url: "dBook", avg_check: "dChek", meet_at: "tMeet", prepay: "tPrepay", next_at: "tNext" };
function markBad(e) { const id = e && e.data && FIELD_IDS[e.data.field]; const el = id && document.getElementById(id); if (el) { el.classList.add("bad"); el.scrollIntoView({ block: "center" }); el.focus(); } }

function openSheet(html) { $("sheet").innerHTML = html; $("scrim").hidden = false; $("sheet").hidden = false; $("sheet").scrollTop = 0; }
function closeSheet() { $("scrim").hidden = true; $("sheet").hidden = true; S.cur = null; }

function openNew(keep = {}) {
  S.cur = null; S.force = false;
  openSheet('<div class="grab"></div><div class="sh-h"><div><h2>Новый лид</h2></div><button class="x" data-close aria-label="Закрыть">×</button></div>' +
    formHtml({ city: store.get("city"), niche: store.get("niche"), ...keep }) + '<button class="primary" id="nSave">Сохранить</button><button class="ghost" id="nSaveMore">Сохранить и добавить ещё</button>');
  showScore(); $("dName").focus();
}
async function saveNew(more) {
  if (S.busy) return; const f = readForm();
  if (!f.name) { $("dName").classList.add("bad"); $("dName").focus(); toast("Впишите название"); return; }
  S.busy = true;
  try {
    const r = await api("/api/leads", { method: "POST", body: { ...f, force: !!S.force } });
    store.set("city", f.city); store.set("niche", f.niche); S.force = false;
    for (const k of ["cities", "niches"]) { const v = k === "cities" ? f.city : f.niche; if (v && !S.meta[k].includes(v)) S.meta[k].push(v); }
    toast("Добавлен: " + r.lead.name + (r.lead.grade ? " · оценка " + r.lead.grade : ""));
    if (more) openNew(); else closeSheet();
    refresh();
  } catch (e) {
    if (e.code === "dup") { S.force = true; toast(e.message + ". Нажмите «Сохранить» ещё раз, если это другой бизнес."); }
    else { oops(e); markBad(e); }
  } finally { S.busy = false; }
}

/* ---------- карточка лида ---------- */
async function openLead(id, toTouch) {
  let r; try { r = await api("/api/leads/" + id); } catch (e) { oops(e); return; }
  const l = r.lead, s = SN[l.stage] || SN.new, ps = phones(l.phones); S.cur = l; S.pick = "";
  const links = [l.gis_url && ["2ГИС", l.gis_url], l.instagram && ["Instagram", l.instagram], l.booking_url && ["Онлайн-запись", l.booking_url]].filter(Boolean);
  const sc = score(l), q = qual(l);
  const quick = (target, opts) => '<div class="quick">' + opts.map(o => '<button type="button" class="chip" data-set="' + target + '" data-t="' + o[1] + '">' + o[0] + '</button>').join("") + '</div>';
  openSheet('<div class="grab"></div><div class="sh-h">' + gradeBox(l) + '<div><h2>' + esc(l.name) + '</h2><div class="meta">' + [l.niche, l.city, l.address].filter(Boolean).map(esc).join(" · ") + '</div>' +
    '<div class="meta">' + (sc.grade ? "Оценка " + sc.score + " из 100" : "Мало данных для оценки") + (q ? " · " + esc(q) : "") + (l.impression ? " · " + IMPRESSIONS[l.impression - 1][1].toLowerCase() : "") + '</div>' +
    '<div class="tags"><span class="tag s-' + s[2] + '">' + s[1] + '</span>' + (l.booking ? '<span class="tag">' + esc(l.booking) + '</span>' : "") + (l.lpr_name ? '<span class="tag">ЛПР: ' + esc(l.lpr_name) + '</span>' : "") + (l.next_at && ACTIVE.includes(l.stage) ? '<span class="tag">шаг: ' + esc(fmt(l.next_at)) + '</span>' : "") +
    (l.meet_at && l.stage === "meet" ? '<span class="tag s-good">встреча: ' + esc(fmt(l.meet_at)) + '</span>' : "") + (l.prepay ? '<span class="tag s-good">предоплата ' + money(l.prepay) + '</span>' : "") + '</div></div><button class="x" data-close aria-label="Закрыть">×</button></div>' +
    '<div class="sec"><div class="lbl">Телефон</div>' + (ps.length ? ps.map(p => '<div class="phone"><span class="num">' + esc(p) + '</span><a class="btn call" href="tel:+' + dial(p) + '" aria-label="Позвонить">' + ICON_CALL + '</a><a class="btn wa" href="https://wa.me/' + dial(p) + '" target="_blank" rel="noopener" aria-label="WhatsApp">' + ICON_WA + '</a><button class="btn" data-copy="' + esc(p) + '">Копир.</button></div>').join("") : '<div class="note">Номера нет — впишите ниже в «Данные и оценка».</div>') +
    (l.lpr_phone ? '<div class="phone"><span class="num">ЛПР' + (l.lpr_name ? " " + esc(l.lpr_name) : "") + ': ' + esc(l.lpr_phone) + '</span><a class="btn call" href="tel:+' + dial(l.lpr_phone) + '" aria-label="Позвонить ЛПР">' + ICON_CALL + '</a><a class="btn wa" href="https://wa.me/' + dial(l.lpr_phone) + '" target="_blank" rel="noopener" aria-label="WhatsApp ЛПР">' + ICON_WA + '</a></div>' : "") + '</div>' +
    (links.length ? '<div class="sec"><div class="links">' + links.map(x => '<a href="' + esc(x[1]) + '" target="_blank" rel="noopener">' + x[0] + '</a>').join("") + '</div></div>' : "") +
    (l.notes ? '<div class="sec"><div class="lbl">Заметки</div><div class="hi">' + esc(l.notes) + '</div></div>' : "") +
    '<div class="sec" id="touch"><div class="lbl">Итог звонка или касания</div><div class="grid2">' + CALL_RESULTS.map(c => '<button type="button" class="opt" data-res="' + c + '" aria-pressed="false">' + SN[c][1] + '</button>').join("") + '</div>' +
    '<div class="f"><label for="tNote">Что сказали</label><textarea id="tNote" placeholder="Админ Айгерим, владелец бывает после 12, просил перезвонить в четверг"></textarea></div>' +
    '<div class="f" id="tMeetBox" hidden><label for="tMeet">Встреча: когда</label><input id="tMeet" type="datetime-local">' + quick("tMeet", [["Сегодня 17:00", at(0, 17)], ["Завтра 11:00", at(1, 11)], ["Завтра 15:00", at(1, 15)], ["Послезавтра 11:00", at(2, 11)]]) + '</div>' +
    '<div class="grid2" id="tPayBox" hidden><div class="f"><label for="tPrepay">Предоплата, ₸</label><input id="tPrepay" inputmode="numeric" placeholder="170000"></div><div class="f"><label for="tPrice">Сумма сделки, ₸</label><input id="tPrice" inputmode="numeric" value="' + esc(l.price ?? "") + '" placeholder="340000"></div></div>' +
    '<div class="f"><label for="tNext">Следующий шаг: когда</label><input id="tNext" type="datetime-local">' + quick("tNext", [["Через 2 часа", Date.now() + 2 * 3600e3], ["Сегодня 18:00", at(0, 18)], ["Завтра 11:00", at(1, 11)], ["Завтра 15:00", at(1, 15)], ["Через 3 дня", at(3, 11)]]) + '</div>' +
    '<div class="f"><label for="tWhat">Что сделать</label><input id="tWhat" placeholder="Позвонить владельцу" autocomplete="off"></div>' +
    '<button class="primary" id="tSave">Записать</button></div>' +
    '<div class="sec"><div class="lbl">Этап вручную</div><div class="stages">' + STAGES.map(z => '<button type="button" class="chip" data-setst="' + z[0] + '" aria-pressed="' + (z[0] === l.stage) + '">' + z[1] + '</button>').join("") + '</div></div>' +
    '<details class="blk"><summary>Данные и оценка</summary><div class="in">' + formHtml(l) + '<button class="primary" id="dSave">Сохранить данные</button><button class="ghost danger" id="dDel">Удалить лида</button><div id="delAsk" hidden><div class="note">Удалить лида и его историю из списков? </div><button class="ghost danger" id="dDelYes">Да, удалить</button></div></div></details>' +
    '<div class="sec"><div class="lbl">История · ' + r.touches.length + '</div><div class="hist">' + r.touches.map(t => '<div class="hi"><time>' + esc(fmt(t.at)) + '</time><b>' + esc((SN[t.stage] || [0, t.stage])[1]) + '</b>' + (t.note ? " — " + esc(t.note) : "") + '</div>').join("") + '</div></div>');
  showScore();
  if (toTouch) $("touch").scrollIntoView({ block: "start" });
}
async function saveTouch() {
  if (S.busy || !S.cur) return; const id = S.cur.id, name = S.cur.name, pick = S.pick;
  const body = { result: pick || undefined, note: val("tNote"), next_at: fromInput(val("tNext")), next_what: val("tWhat") };
  if (pick === "meet") body.meet_at = fromInput(val("tMeet"));
  if (pick === "paid" || pick === "think") { body.prepay = digits(val("tPrepay")) || null; body.price = digits(val("tPrice")) || null; }
  S.busy = true;
  try { await api("/api/leads/" + id + "/touch", { method: "POST", body }); closeSheet(); toast((pick ? SN[pick][1] : "Записано") + " · " + name); await refresh(); }
  catch (e) { oops(e); markBad(e); } finally { S.busy = false; }
}
async function saveData() {
  if (S.busy || !S.cur) return; const id = S.cur.id; S.busy = true;
  try { await api("/api/leads/" + id, { method: "PATCH", body: readForm() }); toast("Данные сохранены"); await openLead(id); refresh(); }
  catch (e) { oops(e); markBad(e); } finally { S.busy = false; }
}
async function setStage(st) {
  if (S.busy || !S.cur || st === S.cur.stage) return; const id = S.cur.id; S.busy = true;
  try { await api("/api/leads/" + id, { method: "PATCH", body: { stage: st } }); toast("Этап: " + SN[st][1]); await openLead(id); refresh(); }
  catch (e) { oops(e); } finally { S.busy = false; }
}

/* ---------- события ---------- */
document.addEventListener("click", e => {
  const t = /** @type {HTMLElement} */ (e.target), hit = sel => /** @type {HTMLElement | null} */ (t.closest(sel));
  let el;
  if ((el = hit("[data-open]"))) { openLead(el.dataset.open, !!el.dataset.touch); return; }
  if ((el = hit("[data-res]"))) { S.pick = S.pick === el.dataset.res ? "" : el.dataset.res || ""; document.querySelectorAll("[data-res]").forEach(b => b.setAttribute("aria-pressed", String(/** @type {HTMLElement} */ (b).dataset.res === S.pick))); $("tMeetBox").hidden = S.pick !== "meet"; $("tPayBox").hidden = !(S.pick === "paid" || S.pick === "think");
    // «перезвонить» и «думает» без срока теряются — подставляем срок, его можно поменять
    const nx = /** @type {HTMLInputElement} */ ($("tNext")); if (!nx.value || nx.dataset.auto) { const v = S.pick === "cb" ? at(1, 11) : S.pick === "think" ? at(2, 12) : 0; nx.value = v ? toInput(v) : ""; nx.dataset.auto = v ? "1" : ""; }
    return; }
  if ((el = hit("[data-seg]"))) { const k = el.dataset.seg || ""; S.form[k] = el.dataset.v; document.querySelectorAll('[data-seg="' + k + '"]').forEach(b => b.setAttribute("aria-pressed", String(b === el))); showScore(); return; }
  if ((el = hit("[data-set]"))) { const inp = /** @type {HTMLInputElement} */ ($(el.dataset.set || "")); inp.value = toInput(+(el.dataset.t || 0)); inp.dataset.auto = ""; return; }
  if ((el = hit("[data-copy]"))) { const v = el.dataset.copy || ""; try { navigator.clipboard.writeText(v).then(() => toast("Номер скопирован"), () => toast(v)); } catch (err) { toast(v); } return; }
  if ((el = hit("[data-setst]"))) { setStage(el.dataset.setst); return; }
  if ((el = hit("nav button"))) { go(el.dataset.tab); return; }
  if ((el = hit("[data-grade]"))) { S.f.grade = el.dataset.grade || "all"; refresh(); return; }
  if ((el = hit("[data-stage]"))) { S.f.stage = el.dataset.stage || "all"; refresh(); return; }
  if ((el = hit("[data-goto]"))) { S.f = { ...S.f, stage: el.dataset.goto || "all", grade: "all", q: "" }; /** @type {HTMLInputElement} */ ($("q")).value = ""; go("leads"); return; }
  if (hit("[data-close]")) { closeSheet(); return; }
  const id = t.id;
  if (id === "more") { loadLeads(true).then(render, oops); return; }
  if (id === "tSave") { saveTouch(); return; }
  if (id === "dSave") { saveData(); return; }
  if (id === "nSave") { saveNew(false); return; }
  if (id === "nSaveMore") { saveNew(true); return; }
  if (id === "dDel") { $("delAsk").hidden = false; return; }
  if (id === "dDelYes" && S.cur) { const cur = S.cur; api("/api/leads/" + cur.id, { method: "DELETE", body: {} }).then(() => { closeSheet(); toast("Удалён: " + cur.name); refresh(); }, oops); return; }
  if (id === "logout") { api("/api/logout", { method: "POST", body: {} }).then(showLogin, showLogin); return; }
});
document.addEventListener("input", e => {
  const t = /** @type {HTMLInputElement} */ (e.target);
  t.classList.remove("bad"); if (t.id === "tNext") t.dataset.auto = "";
  if (t.id === "cChek" || t.id === "cPack") calc();
  else if (t.id === "meName") store.set("me", t.value.trim());
  else if (t.closest("#sheet") && /^d[A-Z]/.test(t.id)) { showScore(); S.force = false; }
});
document.addEventListener("change", e => {
  const t = /** @type {HTMLSelectElement} */ (e.target);
  if (t.id === "fCity") { S.f.city = t.value; refresh(); } else if (t.id === "fNiche") { S.f.niche = t.value; refresh(); } else if (t.id === "fSort") { S.f.sort = t.value; refresh(); }
});
let qTimer = 0;
$("q").addEventListener("input", e => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.f.q = /** @type {HTMLInputElement} */ (e.target).value.trim(); refresh(); }, 300); });
$("scrim").addEventListener("click", closeSheet);
$("fab").addEventListener("click", () => openNew());
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });
// вернулись в приложение после звонка — обновить «Сегодня» (перезвоны могли стать просроченными)
document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("app").hidden && $("sheet").hidden) refresh(); });

async function start() {
  let me; try { me = await api("/api/me"); } catch (e) { if (e.code !== "auth") { $("login").hidden = false; $("loginErr").textContent = e.message; } return; }
  S.meta = { cities: me.cities, niches: me.niches, bookings: me.bookings };
  $("login").hidden = true; $("app").hidden = false;
  await go("today");
}
start();
