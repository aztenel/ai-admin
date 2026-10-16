/* Пульт чатов: одно приложение для телефона, планшета и компьютера.
   Работает в двух режимах: рабочий (настоящий API /api/inbox/*) и демо (window.__DEMO_API, всё в браузере). */
(function () {
"use strict";
var DEMO = !!window.__DEMO;
// Частота опроса сервера (миллисекунды): открытая переписка при видимой вкладке — часто, список чатов — редко
var POLL_CHAT_MS = 3000, POLL_LIST_MS = 15000;
var TAURI = window.__TAURI__ || null; // открыт в программе «Пульт» для Windows
var Q = new URLSearchParams(location.search);
var $ = function (id) { return document.getElementById(id); };
var S = { v: "chats", C: DEMO ? "demo" : (Q.get("c") || ""), f: "need", q: "", rows: [], need: 0, total: 0, client: { name: "", off: false }, cur: null, chat: null, drafts: {}, owner: false, busy: false, ready: false, theme: "auto", per: "week", stage: "", card: false, ext: null };

/* ---------- мелочи ---------- */
function add(e, k) { if (k == null || k === false) return; if (Array.isArray(k)) { k.forEach(function (x) { add(e, x); }); return; } e.appendChild(k.nodeType ? k : document.createTextNode(String(k))); }
function h(t, c, k, a) { var e = document.createElement(t); if (c) e.className = c; add(e, k); if (a) for (var n in a) { if (a[n] === false || a[n] == null) continue; e.setAttribute(n, a[n] === true ? "" : a[n]); } return e; }
function clear(e) { e.textContent = ""; return e; }
var IC = {
  bell: ['<path d="M6 9a6 6 0 0112 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20a2 2 0 004 0"/>', 1.9], plus: ['<path d="M12 5v14M5 12h14"/>', 2.4], search: ['<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 1.9],
  chev: ['<path d="M6 9l6 6 6-6"/>', 2.4], chevr: ['<path d="M9 5l7 7-7 7"/>', 2.4], back: ['<path d="M15 5l-7 7 7 7"/>', 2.4], phone: ['<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A15 15 0 013 6a2 2 0 012-2z"/>', 1.9],
  dots: ['<path d="M5 12h.01M12 12h.01M19 12h.01"/>', 2.8], bolt: ['<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>', 1.9], send: ['<path d="M12 19V5M6 11l6-6 6 6"/>', 2.4], check: ['<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.4],
  chats: ['<path d="M4 5h16v11H9l-5 4z"/>', 1.9], leads: ['<path d="M4 5h16l-6 8v6l-4-2v-4z"/>', 1.9], sum: ['<path d="M5 20V10M12 20V4M19 20v-7"/>', 1.9], bc: ['<path d="M3 11l18-7-7 18-3-8z"/>', 1.9],
  cal: ['<path d="M5 5h14v15H5zM5 10h14M9 3v4M15 3v4"/>', 1.9], clock: ['<path d="M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z"/>', 1.9], info: ['<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 1.9],
  wifi: ['<path d="M2 9a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.5h.01"/>', 1.9], refresh: ['<path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6"/>', 1.9], inbox: ['<path d="M4 13l2.5-8h11L20 13v6H4zM4 13h5l1 2h4l1-2h5"/>', 1.9],
  users: ['<path d="M16 19v-1a4 4 0 00-4-4H8a4 4 0 00-4 4v1M10 10a3 3 0 100-6 3 3 0 000 6M20 19v-1a4 4 0 00-3-3.9M15 4.2a3 3 0 010 5.6"/>', 1.9],
  book: ['<path d="M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h10"/>', 1.9], shield: ['<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>', 1.9],
  link: ['<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>', 1.9], out: ['<path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 16l-4-4 4-4M6 12h10"/>', 1.9],
  cut: ['<path d="M8.1 7.9L20 18M8.1 16.1L20 6M6 8.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM6 20.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"/>', 1.9], web: ['<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>', 1.9],
  pause: ['<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>', 1.9], nos: ['<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>', 1.9], bot: ['<rect x="5" y="8" width="14" height="10" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/>', 2],
  rec: ['<path d="M7 4h10a2 2 0 012 2v14l-3-2-2 2-2-2-2 2-2-2-3 2V6a2 2 0 012-2zM9 9h6M9 13h6"/>', 1.9], close: ['<path d="M6 6l12 12M18 6L6 18"/>', 2.4]
};
function ic(n, s) { var d = IC[n]; var w = document.createElement("span"); w.innerHTML = '<svg width="' + (s || 22) + '" height="' + (s || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + d[1] + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d[0] + '</svg>'; return w.firstChild; }
var NB = " ";
function money(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NB) + NB + "₸"; }
function p2(x) { return (x < 10 ? "0" : "") + x; }
function hm(t) { var d = new Date(t); return p2(d.getHours()) + ":" + p2(d.getMinutes()); }
function dk(t) { var d = new Date(t); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); }
var MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
function dayLabel(t) { var n = Date.now(); if (dk(t) === dk(n)) return "Сегодня"; if (dk(t) === dk(n - 864e5)) return "Вчера"; var d = new Date(t); return d.getDate() + " " + MON[d.getMonth()]; }
function rowTime(t) { if (!t) return ""; var d = new Date(t); if (dk(t) === dk(Date.now())) return hm(t); if (dk(t) === dk(Date.now() - 864e5)) return "вчера"; return p2(d.getDate()) + "." + p2(d.getMonth() + 1); }
// аватар: одинаковый серый круг с белым силуэтом человека (свой рисунок, не чужой ассет)
// (силуэт рисует CSS-градиентами в design.base.css: у аватара нет дочерних узлов — в списке из сотен чатов это меньше DOM)
function avatarEl(cls) { return h("span", "av" + (cls ? " " + cls : "")); }
function colorOf(id) { return "var(--av)"; }
// номер как +7 7XX XXX XX XX; всё, что не похоже на казахстанский/российский номер, оставляем как есть
function fmtPhone(x) {
  var s = String(x || "").trim(); if (!s) return "";
  if (/[^\d\s+()\-]/.test(s)) return s; // маска или буквы — не трогаем
  var d = s.replace(/\D/g, ""); if (d.length === 11 && (d[0] === "7" || d[0] === "8")) d = "7" + d.slice(1); else if (d.length === 10) d = "7" + d; else return s;
  return "+7 " + d.slice(1, 4) + " " + d.slice(4, 7) + " " + d.slice(7, 9) + " " + d.slice(9, 11);
}
// как подписать клиента: имя, если оно известно, иначе номер
function whoOf(nm, ph) { return String(nm || "").trim() || fmtPhone(ph) || "Гость сайта"; }
function initials(name, ph) { var w = String(name || "").trim().split(/\s+/).filter(Boolean); return w.length ? w[0][0].toUpperCase() : ""; }
function same(a, b) { return !!a && !!b && a.ch === b.ch && a.id === b.id; }
function keyOf(x) { return x.ch + ":" + x.id; }
var NEED = { human: "Просит человека", limit: "Бот не ответил", media: "Прислал файл", ai: "Сбой бота", req: "Просит отменить или перенести", lead: "Новая заявка", call: "Ждёт звонка", off: "Бот выключен", send: "Ответ не дошёл" };
var CHN = { wa: "WhatsApp", ga: "WhatsApp", web: "Сайт" };

/* ---------- слой данных ---------- */
function jf(p, b) {
  return fetch(p, b ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b), keepalive: true } : { credentials: "same-origin" }).then(function (r) {
    if (r.status === 401) { location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search + location.hash); throw 0; }
    return r.json();
  });
}
var enc = encodeURIComponent;
var API = DEMO ? window.__DEMO_API : {
  list: function (f, ch) { return jf("/api/inbox/list?c=" + enc(S.C) + "&f=" + (ch === "web" ? "all" : f) + "&ch=" + ch); },
  chat: function (ch, id) { return jf("/api/inbox/chat?c=" + enc(S.C) + "&ch=" + ch + "&id=" + enc(id)); },
  send: function (ch, id, text) { return jf("/api/inbox/send", { c: S.C, ch: ch, id: id, text: text }); },
  act: function (ch, id, act, x) { var b = { c: S.C, ch: ch, id: id, act: act }; if (x) { b.lead = x.lead; b.text = x.text; } return jf("/api/inbox/act", b); },
  me: function () { return jf("/api/inbox/me"); },
  leads: function () { return jf("/api/inbox/leads?c=" + enc(S.C)); },
  clients: function () { return jf("/api/studio/list"); }
};

/* ---------- окно, тема, клавиатура ---------- */
var root = $("root"), app = $("app");
function setTheme(t, keep) {
  S.theme = t; app.setAttribute("data-theme", t); document.documentElement.setAttribute("data-theme", t);
  if (!keep) { try { localStorage.setItem("pult.theme", t); } catch (e) {} }
  var dark = t === "dark" || (t === "auto" && !(window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches));
  // цвет полосы браузера = цвет шапки пульта (--bg). «Авто» — по системной теме (media в meta), ручной выбор — один цвет в обеих
  var tl = $("tc-l"), td = $("tc-d"), c = dark ? "#000000" : "#FFFFFF";
  if (tl) tl.setAttribute("content", t === "auto" ? "#FFFFFF" : c); if (td) td.setAttribute("content", t === "auto" ? "#000000" : c);
}
function fitViewport() {
  var vv = window.visualViewport; if (!vv) return;
  function fit() {
    root.style.setProperty("--appH", vv.height + "px"); root.style.transform = vv.offsetTop ? "translateY(" + vv.offsetTop + "px)" : "";
    app.classList.toggle("kb", window.innerHeight - vv.height > 120);
    if (document.activeElement && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName)) { var m = $("msgs"); if (m && S.cur) m.scrollTop = m.scrollHeight; }
  }
  vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); fit();
}
var toastT = 0;
// Отложенное свайп-действие: SW.pend — одно за раз; SW.ms — сколько секунд даём на «Отменить» (тесты ставят меньше)
var SW = { ms: 5000, drag: null, later: false, pend: null, endRow: null, endAt: 0, tOn: false };
// o.undo — функция: в тосте появляется кнопка «Отменить» (44 px); o.ms — сколько показывать
function toast(text, o) {
  var t = $("toast"); o = o || {}; clear(t); t.classList.toggle("act", !!o.undo); SW.tOn = !!o.undo;
  t.appendChild(h("span", "tt", text));
  if (o.undo) { var b = h("button", "tb", "Отменить", { type: "button" }); b.onclick = o.undo; t.appendChild(b); }
  t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; SW.tOn = false; }, o.ms || 3200);
}
function sheet(title, body, foot) {
  closeSheet();
  var sc = h("div", "scrim", null, { id: "scrim" }), sh = h("div", "sheet", [h("div", "grab"), title ? h("h2", "", title) : null, h("div", "sbody", body), foot || null], { role: "dialog", "aria-modal": "true", id: "sheet" });
  sc.onclick = closeSheet; app.appendChild(sc); app.appendChild(sh);
  var f = sh.querySelector("button,textarea,input"); if (f && !DEMO) try { f.focus({ preventScroll: true }); } catch (e) {}
  return sh;
}
function closeSheet() { var a = $("scrim"), b = $("sheet"); if (a) a.remove(); if (b) b.remove(); }
function opt(icon, text, sub, fn, cls) {
  var b = h("button", "opt" + (cls ? " " + cls : ""), [icon ? ic(icon, 22) : null, h("span", "", [text, sub ? h("small", "", sub) : null])], { type: "button" });
  b.onclick = function () { closeSheet(); if (fn) fn(); }; return b;
}
function notice(title, text) {
  var b = h("button", "btn pri", "Понятно", { type: "button", style: "width:calc(100% - 32px);margin:8px 16px 0" }); b.onclick = closeSheet;
  sheet(title, h("div", "note", text), b);
}
// подтверждение своим окном, а не системным confirm(): одинаково в браузере, на телефоне и в программе для Windows
function ask(title, text, yes, fn) {
  var b1 = h("button", "btn pri", yes, { type: "button", style: "flex:1" }), b2 = h("button", "btn sec", "Отмена", { type: "button", style: "flex:1" });
  b1.onclick = function () { closeSheet(); fn(); }; b2.onclick = closeSheet;
  sheet(title, h("div", "note", text), h("div", "", [b2, b1], { style: "display:flex;gap:10px;padding:8px 16px 0" }));
}
function oops(e) { S.busy = false; if (e === 0) return; netErr(true); notice("Нет связи", "Действие не выполнено, ничего не отправлено. Проверьте интернет и повторите."); }
function telHref(p) { return DEMO ? "#demo-call" : "tel:" + p; } // в демо номера вымышленные: звонок не набираем, чтобы не позвонить чужому человеку
document.addEventListener("click", function (e) { var l = e.target && e.target.closest && e.target.closest('a[href="#demo-call"]'); if (l) { e.preventDefault(); toast("В демо звонок не набирается"); } });
function netErr(on) { $("net").hidden = !on; }
window.addEventListener("online", function () { netErr(false); refresh(); });
window.addEventListener("offline", function () { if (!DEMO) netErr(true); });

/* ---------- уведомления: клиент ждёт ответа ----------
   В программе для Windows — уведомления Windows; в браузере — уведомления браузера (после разрешения кнопкой-колокольчиком).
   Новый ждущий чат = чат с пометкой «ждёт ответа», которого не было при прошлой проверке (или с новым сообщением). */
var NOTE = { seen: null };
function noteState() { // on — показываем; ask — можно спросить разрешение; off — запрещено в браузере; no — не умеем
  if (DEMO) return "no";
  if (TAURI && TAURI.notification) return "on";
  if (!("Notification" in window)) return "no";
  return Notification.permission === "granted" ? "on" : Notification.permission === "denied" ? "off" : "ask";
}
function bellUpdate() {
  if (DEMO) return; var st = noteState(), b = $("bell");
  b.hidden = st === "no" || !!(TAURI && TAURI.notification); b.classList.toggle("on", st === "on");
  b.setAttribute("aria-label", st === "on" ? "Уведомления включены" : "Включить уведомления");
  var dot = b.querySelector(".dot"); if (st === "ask" && !dot) b.appendChild(h("span", "dot")); else if (st !== "ask" && dot) dot.remove();
}
function bellClick() {
  var st = noteState();
  if (DEMO) { notice("Уведомления", "Здесь будут сообщения о том, что клиент просит человека, отменил запись или оставил заявку. В демо уведомления не приходят."); return; }
  if (st === "ask") { Notification.requestPermission().then(function (p) { bellUpdate(); toast(p === "granted" ? "Уведомления включены" : "Уведомления не включены"); }); return; }
  if (st === "on") notice("Уведомления включены", "Когда клиент ждёт ответа, придёт уведомление. Пульт должен быть открыт — можно в свёрнутой вкладке. В программе «Пульт» для Windows уведомления приходят, даже когда окно закрыто (программа остаётся у часов).");
  else notice("Уведомления запрещены", "Браузер запретил уведомления для этого сайта. Разрешите их в настройках сайта (значок слева от адреса) и обновите страницу.");
}
function noteCheck(rows) {
  var cur = {}; rows.forEach(function (r) { if (r.nd) cur[keyOf(r)] = String(r.li || r.t || "") + "|" + r.nd; });
  if (NOTE.seen && noteState() === "on") {
    var looking = function (r) { return !document.hidden && document.hasFocus && document.hasFocus() && S.cur && same(S.cur, r); }; // этот чат и так открыт перед глазами
    var fresh = rows.filter(function (r) { return r.nd && NOTE.seen[keyOf(r)] !== cur[keyOf(r)] && !looking(r); });
    if (fresh.length) notify(fresh);
  }
  NOTE.seen = cur;
}
function notify(list) {
  var r = list[0], nm = function (x) { return x.nm || x.ph || "Гость сайта"; };
  var title = list.length > 1 ? "Ждут ответа: " + list.length : "Клиент ждёт ответа";
  var body = list.length > 1 ? list.slice(0, 4).map(nm).join(", ") : nm(r) + " — " + (r.why || NEED[r.nd] || "нужен ответ") + (r.d === "u" && r.s ? ": «" + String(r.s).slice(0, 90) + "»" : "");
  if (TAURI && TAURI.notification) {
    try { TAURI.notification.sendNotification({ title: title, body: body }); } catch (e) {}
    try { TAURI.window.getCurrentWindow().requestUserAttention(2); } catch (e) {} // значок на панели задач мигает
    return;
  }
  try { var n = new Notification(title, { body: body, tag: "pult-need", icon: "/pult/icon-192.png" }); n.onclick = function () { try { window.focus(); } catch (e) {} if (list.length === 1) openChat(r.ch, r.id); n.close(); }; } catch (e) {}
}
// программа для Windows: чужие ссылки — в браузере, свои «в новой вкладке» — в этом же окне
if (TAURI) document.addEventListener("click", function (e) {
  var a = e.target && e.target.closest && e.target.closest("a[href]"); if (!a || a.getAttribute("href").charAt(0) === "#") return;
  var u; try { u = new URL(a.getAttribute("href"), location.href); } catch (x) { return; }
  if (u.origin === location.origin) { if (a.target === "_blank") { e.preventDefault(); location.href = u.href; } return; }
  e.preventDefault(); try { TAURI.opener.openUrl(u.href); } catch (x) {}
}, true);

/* ---------- навигация ---------- */
var TABS = [["chats", "Чаты", "chats"], ["broadcast", "Рассылки", "bc"], ["more", "Ещё", "dots"]];
function buildNav() {
  var n = clear($("nav"));
  TABS.forEach(function (t, i) {
    var a = h("a", "", [ic(t[2], 24), t[1], t[0] === "chats" ? h("span", "bdg", "", { id: "bdg", hidden: true }) : null], { href: "#" + t[0], "data-v": t[0] });
    a.onclick = function (e) { e.preventDefault(); go(t[0]); };
    if (t[0] === "more") n.appendChild(h("div", "sp-flex"));
    n.appendChild(a);
  });
  n.appendChild(h("span", "me", "", { id: "me" }));
}
function go(v) {
  S.v = v; S.card = false; app.classList.remove("card");
  var tab = v === "summary" ? "more" : v; // «Итоги» открываются из «Ещё»: внизу подсвечено «Ещё»
  document.querySelectorAll(".view").forEach(function (e) { e.classList.toggle("on", e.id === "v-" + v); });
  document.querySelectorAll("#nav a").forEach(function (a) { if (a.dataset.v === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  if (v !== "chats") app.classList.remove("chat"); else if (S.cur) app.classList.add("chat");
  var VV = window.__views; if (VV && VV[v]) VV[v]();
}
function setBadge() {
  var b = $("bdg"); if (!b) return; b.hidden = !S.need; b.textContent = S.need > 99 ? "99+" : S.need;
  if (S.need > (S.needWas || 0) && S.needWas != null) replay(b, "bump"); // ждущих стало больше — значок «подпрыгивает»
  S.needWas = S.need;
  document.title = (S.need ? "(" + S.need + ") " : "") + (DEMO ? "Пульт · демо" : "Чаты") + (S.client.name ? " — " + S.client.name : "");
  if (TAURI) { try { TAURI.window.getCurrentWindow().setTitle(document.title); } catch (e) {} } // в программе для Windows — заголовок окна
}

/* ---------- шапка: переключатель компании ---------- */
function bizBtn() {
  var nm = S.client.name || (DEMO ? "Барбершоп" : "Компания");
  var b = h("button", "biz glass", [h("span", "l", (nm[0] || "К").toUpperCase()), h("span", "n", nm), (S.owner || DEMO) ? ic("chev", 16) : null], { type: "button", "aria-label": "Компания: " + nm });
  b.onclick = bizSheet; return b;
}
function bizSheet() {
  if (!S.owner && !DEMO) return;
  var body = h("div", "");
  API.clients().then(function (d) {
    if (d.error) { body.appendChild(h("div", "note", d.error)); return; }
    (d.clients || []).forEach(function (c) { var o = opt(null, c.name, c.kind + " · " + c.id, function () { if (DEMO) demoSwitch(c); else location.href = "/inbox?c=" + c.id; }); if (c.id === S.C) o.classList.add("sel"); body.appendChild(o); });
  }).catch(function () { body.appendChild(h("div", "note", "Не удалось получить список компаний.")); });
  sheet("Компания", body);
}
// демо: переключение бизнеса. Данные подменяет __DEMO_API.setBiz; здесь сбрасываем всё, что относилось к прежнему бизнесу
function demoSwitch(c) {
  if (c.id === S.C) return;
  swFlush(); API.setBiz(c.id); saveDraft(); S.C = c.id; S.cur = null; S.chat = null; S.card = false; S.rows = []; touchRows(); S.leads = null; RK = {}; S.ready = false; S.shown = false; S.f = "need"; S.q = ""; S.stage = ""; S.needWas = null; $("q").value = "";
  app.classList.remove("chat", "card"); try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  skeleton(); chipsEl(); toast("Открыт бизнес: " + c.name);
  loadList().then(function () { go(S.v); });
}
function headerEl(extra) { return h("div", "hdr", [bizBtn(), h("span", "sp")].concat(extra || [])); }
function ibtn(icon, label, fn, pri) { var b = h("button", "ibtn" + (pri ? " pri" : ""), ic(icon, pri ? 24 : 22), { type: "button", "aria-label": label }); b.onclick = fn; return b; }
// заголовок экрана: большой (34/700); back — функция: слева кнопка «назад»
function titleEl(t, back) {
  var e = h("div", "ttl top" + (back ? " bk2" : ""), [back ? ibtn("back", "Назад", back) : null, h("h1", "", t)]);
  if (back) e.firstChild.classList.add("back");
  return e;
}

/* ---------- вкладка «Чаты» ---------- */
var ROWH = 72, VIRT_MIN = 200;
function chipsEl() {
  var c = clear($("chips")); c.classList.add("more");
  var defs = [["need", "Ждут ответа"], ["all", "Все"], ["leads", "Заявки"], ["pause", "Бот молчит"], ["web", "Сайт"]];
  defs.forEach(function (d) { var b = h("button", "chip" + (S.f === d[0] ? " on" : ""), d[1], { type: "button", "aria-pressed": S.f === d[0] ? "true" : "false" }); b.onclick = function () { S.f = d[0]; S.rows = []; touchRows(); S.ready = false; RK = {}; renderList(); chipsEl(); loadList(); }; c.appendChild(b); });
}
function skeleton() { LS = ""; RK = {}; VL.ok = false; var r = clear($("rows")); r.style.padding = ""; r.dataset.m = "sk"; for (var i = 0; i < 8; i++) r.appendChild(h("div", "sk-row", [h("div", "sk-av"), h("div", "sk-t", [h("div", "sk", "", { style: "width:" + (45 + (i * 13) % 35) + "%" }), h("div", "sk", "", { style: "width:" + (60 + (i * 9) % 30) + "%" })])])); }
// строка списка: аватар, имя или номер, время, одна серая строка; статус — точка, счётчик или значок (без слов-плашек)
function rowSig(r, sel) { return [r.nm, r.ph, r.s, r.d, r.li || r.t, r.un, r.nd, r.pu ? 1 : 0, r.st, sel ? 1 : 0].join("\u0001"); }
function statusIcon(name, text) { return h("span", "", ic(name, 16), { role: "img", "aria-label": text, title: text }); }
function rowEl(r, i, sel) {
  var nm = whoOf(r.nm, r.ph), hot = !!r.nd;
  var prev = (r.d === "a" ? "Вы: " : "") + (r.s || ""), rs = [];
  if (r.un) rs.push(h("span", "ub", r.un > 99 ? "99+" : r.un, { "aria-label": "Непрочитанных: " + r.un })); else if (hot) rs.push(h("span", "dn", "", { role: "img", "aria-label": "Ждёт ответа", title: "Ждёт ответа" }));
  if (r.pu) rs.push(statusIcon("pause", "Бот на паузе")); if (r.st) rs.push(statusIcon("nos", "Просил не писать"));
  var a = h("a", "row" + (sel ? " sel" : "") + (hot ? " wait" : ""), [
    avatarEl(),
    h("div", "rb", [h("div", "r1", [h("span", "nm", nm), h("span", "tm2" + (hot || r.un ? " hot" : ""), rowTime(r.li || r.t))]), h("div", "r2", [h("span", "pv", prev), rs.length ? h("span", "rs", rs) : null])])
  ], { href: "#" + r.ch + ":" + r.id, "data-paused": r.pu ? "1" : null });
  var w = h("div", "sw", a, { style: "--i:" + Math.min(i || 0, 12) }); ROWMAP.set(a, { sw: w, r: r }); return w; // обработчики — один раз на весь список (rowsBind)
}
function visibleRows() {
  var rows = S.rows.slice();
  if (S.f === "need") rows = rows.filter(function (r) { return r.nd; });
  if (S.f === "pause") rows = rows.filter(function (r) { return r.pu; });
  var q = S.q.trim().toLowerCase();
  if (q) rows = rows.filter(function (r) { return ((r.nm || "") + " " + (r.ph || "") + " " + fmtPhone(r.ph) + " " + (r.s || "")).toLowerCase().indexOf(q) >= 0; });
  return rows;
}
// отпечаток нарисованного списка: по таймеру строки обновляются, только если данные изменились (иначе нажатие в этот миг теряется)
var LS = "", CS = "", RK = {}, VL = { on: false, ok: false, f: 0, l: 0, n: 0, top: 0 };
// отпечаток строк считается один раз при их смене (touchRows), а не при каждой прокрутке длинного списка
function touchRows() { S.rsig = JSON.stringify(S.rows); }
function listSig() { return JSON.stringify([S.rsig, S.leads, S.f, S.q, S.stage, S.cur ? keyOf(S.cur) : "", S.ready]); }
// звено между нарисованными и нужными строками: переиспользуем элементы, у которых данные не изменились; порядок правим вставками
function reconcile(box, want) {
  var ref = box.firstChild;
  want.forEach(function (el) { if (el === ref) ref = ref.nextSibling; else box.insertBefore(el, ref); });
  while (ref) { var nx = ref.nextSibling; box.removeChild(ref); ref = nx; }
}
function emptyList(box, msg) { RK = {}; VL.on = false; VL.ok = false; box.style.padding = ""; box.dataset.m = "empty"; clear(box).appendChild(h("div", "empty", [h("span", "ic", ic("inbox", 26)), h("b", "", msg)])); }
function renderList() {
  if (SW.drag && SW.drag.on) { SW.later = true; return; } // палец ведёт строку: обновим, когда отпустит
  var box = $("rows"), q = S.q.trim(); LS = listSig();
  if (!S.ready) { LS = ""; skeleton(); return; }
  if (S.f === "leads") { renderLeads(box); return; }
  var rows = visibleRows();
  if (!rows.length) { emptyList(box, q ? "Ничего не найдено" : S.f === "web" ? "Чатов с сайта пока нет" : S.f === "need" ? "Никто не ждёт ответа" : S.f === "pause" ? "Бот везде отвечает сам" : "Чатов пока нет"); return; }
  if (box.dataset.m !== "rows") { clear(box); RK = {}; box.dataset.m = "rows"; }
  var n = rows.length, f = 0, l = n;
  VL.on = n > VIRT_MIN; // больше 200 чатов: в разметке только видимые строки и запас, остальное — отступы
  if (VL.on) { var sc = $("lscroll"), st = Math.max(0, sc.scrollTop - VL.top), vh = sc.clientHeight || 800; f = Math.max(0, Math.floor(st / ROWH) - 20); l = Math.min(n, Math.ceil((st + vh) / ROWH) + 20); }
  VL.f = f; VL.l = l; VL.n = n;
  box.style.paddingTop = VL.on ? f * ROWH + "px" : ""; box.style.paddingBottom = VL.on ? (n - l) * ROWH + "px" : "";
  var want = [], keep = {};
  for (var i = f; i < l; i++) {
    var r = rows[i], k = keyOf(r), sel = !!(S.cur && same(S.cur, r)), sig = rowSig(r, sel), old = RK[k];
    if (!old || old.sig !== sig) old = RK[k] = { el: rowEl(r, i, sel), sig: sig }; // изменилась только эта строка — только она и пересоздаётся
    keep[k] = 1; want.push(old.el);
  }
  for (var k2 in RK) if (!keep[k2]) delete RK[k2];
  reconcile(box, want);
  if (!S.shown) { S.shown = true; replay(box, "in"); setTimeout(function () { box.classList.remove("in"); }, 1000); } // один раз: строки появляются по очереди
  if (VL.on && !VL.ok) { VL.ok = true; VL.top = box.getBoundingClientRect().top - $("lscroll").getBoundingClientRect().top + $("lscroll").scrollTop; } // положение списка в прокрутке меряем один раз (не после каждого подмешивания: это лишний layout)
}
function leadRowEl(l) {
  var T = { cancel: "Просит отменить", change: "Просит перенести", callback: "Ждёт звонка", lead: "Заявка" }[l.kind || "lead"] || "Заявка";
  var wa = /^WhatsApp/.test(l.source || "") && l.phone, id = String(l.phone || "").replace(/\D/g, "");
  var a = h("a", "row", [avatarEl(), h("div", "rb", [h("div", "r1", [h("span", "nm", whoOf(l.name, l.phone)), h("span", "tm2", l.ts ? rowTime(l.ts) : "")]), h("div", "r2", [h("span", "pv", [l.status || T, l.service, l.time].filter(Boolean).join(" · "))])])], { href: wa ? "#wa:" + id : telHref(l.phone || "") });
  if (wa) a.onclick = function (e) { e.preventDefault(); openChat("wa", id, false); };
  return a;
}
function renderLeads(box) {
  RK = {}; VL.on = false; VL.ok = false; box.style.padding = ""; box.dataset.m = "leads";
  clear(box);
  if (!S.leads) { skeleton(); box.dataset.m = "leads"; return; }
  if (!S.leads.length) { box.appendChild(h("div", "empty", [h("span", "ic", ic("rec", 26)), h("b", "", "Заявок пока нет")])); return; }
  S.leads.forEach(function (l) { box.appendChild(leadRowEl(l)); });
}
// перезапуск анимации: снять класс, дать браузеру заметить, вернуть
function replay(e, c) { if (!e) return; e.classList.remove(c); void e.offsetWidth; e.classList.add(c); }
function loadList() {
  if (!S.C) { pickCompany(); return Promise.resolve(); }
  var want = S.f, wantList = want === "leads" ? "all" : want;
  return API.list(want === "web" ? "all" : want === "pause" || want === "leads" ? "all" : want, want === "web" ? "web" : "wa").then(function (d) {
    netErr(false); if (want !== S.f) return;
    if (d.error) { LS = ""; RK = {}; var bx = clear($("rows")); bx.dataset.m = "err"; bx.appendChild(h("div", "empty", [h("b", "", "Не получилось загрузить"), h("span", "", d.error)])); return; }
    S.ready = true; S.rows = d.chats || []; S.client = d.client || S.client; S.total = d.total || S.rows.length;
    if (want !== "web") { S.need = d.need || 0; noteCheck(S.rows); }
    swOverlay(); touchRows();
    $("bizslot").replaceChildren(bizBtn());
    setBadge(); var cs = S.need + "|" + S.f; if (cs !== CS) { CS = cs; chipsEl(); }
    if (want === "leads") return API.leads().then(function (z) { if (want !== S.f) return; S.leads = z.error ? [] : (z.leads || []); if (listSig() !== LS) renderList(); });
    if (listSig() !== LS) renderList(); // ничего не изменилось — DOM не трогаем
  }).catch(function (e) { if (e !== 0) netErr(true); });
}
function pickCompany() {
  API.clients().then(function (d) {
    LS = ""; RK = {}; var R = clear($("rows")); R.dataset.m = "pick"; if (d.error) { R.appendChild(h("div", "empty", [h("b", "", "Нет доступа"), h("span", "", d.error)])); return; }
    R.appendChild(h("div", "empty", [h("b", "", "Выберите компанию")]));
    (d.clients || []).forEach(function (c) { var a = h("a", "row", [avatarEl(), h("div", "rb", [h("span", "nm", c.name), h("span", "pv", c.kind + " · " + c.id)])], { href: "/inbox?c=" + c.id }); R.appendChild(a); });
  }).catch(function (e) { if (e !== 0) netErr(true); });
}
// прокрутка списка: компактный заголовок сверху появляется, когда большой ушёл; при >200 чатов подмешиваем строки (один раз за кадр)
var LSC = { raf: 0, sc: false };
function onListScroll() {
  if (LSC.raf) return;
  LSC.raf = requestAnimationFrame(function () {
    LSC.raf = 0; var top = $("lscroll").scrollTop, on = top > 46;
    if (on !== LSC.sc) { LSC.sc = on; $("hdr").classList.toggle("sc", on); }
    if (VL.on) { var f = Math.floor((top - VL.top) / ROWH), vh = $("lscroll").clientHeight || 800, l = Math.ceil((top - VL.top + vh) / ROWH); if ((f < VL.f + 4 && VL.f > 0) || (l > VL.l - 4 && VL.l < VL.n)) renderList(); } // подошли к краю нарисованного — подмешиваем строки
  });
}

/* ---------- свайпы по строке чата (только телефон: касание или перо, ширина < 720) ----------
   Влево — «Готово» (act resolve), вправо — «Забрать у бота» (act pause): то же, что пункты меню чата. Кнопки остаются, свайп — ускоритель.
   Отката на сервере у «Готово» нет (а «resume» заодно снял бы пометку «ждёт ответа»), поэтому действие откладывается на SW.ms:
   строка сразу показывает результат, «Отменить» просто отменяет отправку. Закрыли страницу или открыли этот чат — уходит сразу. */
var SW_ACT = { l: { a: "resolve", label: "Готово", icon: "check" }, r: { a: "pause", label: "Забрать у бота", icon: "clock" } };
function swPhone() { return root.clientWidth < 720; }
function swReduce() { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); }
function swThr(w) { return Math.max(56, Math.min(80, w * 0.35)); } // ~35% ширины или 80 px — что меньше, но не менее 56
function swCan(r, d) { return d === "l" ? !!r.nd : r.ch !== "web" && !r.pu && !r.st && !S.client.off; } // как пункты меню: «Готово» — ждущему, «Забрать» — тому, где бот ещё говорит
function swHint(sw) {
  var b = sw.querySelector(".swb"); if (b) return b;
  b = h("div", "swb", ["l", "r"].map(function (d) { return h("span", "swh " + d, [ic(SW_ACT[d].icon, 22), h("span", "", SW_ACT[d].label)]); }), { "aria-hidden": "true" });
  sw.insertBefore(b, sw.firstChild); return b;
}
// ширина экрана запоминается заранее: во время жеста layout не читаем
var VW = 390; function vwSync() { VW = root.clientWidth || VW; }
var PF = { t: 0, moved: false };
var ROWMAP = new WeakMap();
// обработчики жестов и нажатий — на общем контейнере строк, а не на каждой строке: строки создаются дёшево, в том числе при подмешивании в длинный список
function rowsBind() {
  var box = $("rows");
  box.addEventListener("pointerdown", function (e) {
    var a = e.target.closest && e.target.closest("a.row"), info = a && ROWMAP.get(a); if (!info) return;
    prefetch(info.r); // чат начинает грузиться по касанию, а не по отпусканию
    if (SW.drag || e.isPrimary === false || !(e.pointerType === "touch" || e.pointerType === "pen") || !swPhone()) return;
    SW.drag = { sw: info.sw, row: a, r: info.r, id: e.pointerId, x0: e.clientX, y0: e.clientY, on: false, x: 0, dx: 0, w: VW, dir: "", go: false, raf: 0 };
  }, { passive: true });
  box.addEventListener("pointermove", swMove, { passive: true });
  box.addEventListener("pointerup", swUp, { passive: true });
  box.addEventListener("pointercancel", swCancel, { passive: true });
  box.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a.row"), info = a && ROWMAP.get(a); if (!info) return;
    e.preventDefault(); if (SW.endRow === a && Date.now() - SW.endAt < 450) return; // клик сразу после свайпа — не открытие чата
    openChat(info.r.ch, info.r.id, false, info.r);
  });
}
// pointermove только запоминает палец; всё остальное (класс, transform) — один раз за кадр, без чтения layout
function swMove(e) {
  var g = SW.drag; if (!g || e.pointerId !== g.id) return;
  var dx = e.clientX - g.x0, dy = e.clientY - g.y0;
  if (!g.on) {
    if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { SW.drag = null; prefetchCancel(); return; } // это прокрутка списка
    if (Math.abs(dx) <= 10 || Math.abs(dx) <= Math.abs(dy)) return; // пока не жест: строка стоит, клики как раньше
    g.on = true; prefetchCancel(); try { g.row.setPointerCapture(e.pointerId); } catch (x) {}
  }
  g.dx = dx;
  if (!g.raf) g.raf = requestAnimationFrame(function () { g.raf = 0; swFrame(g); });
}
function swFrame(g) {
  if (!g.on) return;
  if (!g.sw.classList.contains("on")) { g.sw.classList.add("on", "drag"); swHint(g.sw); }
  var x = g.dx, dir = x < 0 ? "l" : "r", thr = swThr(g.w), a = Math.abs(x);
  if (!swCan(g.r, dir)) { x = 0; a = 0; dir = ""; }
  var go = a >= thr;
  if (a > thr) a = thr + (a - thr) * 0.4; // за порогом строка «тянется» туго
  a = Math.min(a, g.w * 0.75); x = dir === "l" ? -a : a;
  g.x = x; g.row.style.transform = "translate3d(" + x + "px,0,0)";
  if (dir !== g.dir) { g.dir = dir; if (dir) g.sw.setAttribute("data-d", dir); else g.sw.removeAttribute("data-d"); }
  if (go !== g.go) { g.go = go; g.sw.classList.toggle("go", go); if (go) try { navigator.vibrate && navigator.vibrate(8); } catch (x2) {} }
}
function swUp(e) {
  var g = SW.drag; if (!g || e.pointerId !== g.id) return;
  if (!g.on) { SW.drag = null; return; }
  if (g.raf) { cancelAnimationFrame(g.raf); g.raf = 0; } swFrame(g); // последнее положение пальца применяем сразу
  SW.endRow = g.row; SW.endAt = Date.now();
  try { g.row.releasePointerCapture(g.id); } catch (x) {}
  if (g.go && g.dir) swTrigger(g); else { SW.drag = null; swGo(g, 0); } // не дотянули до порога — плавно назад, ничего не делаем
}
function swCancel(e) {
  var g = SW.drag; if (!g || e.pointerId !== g.id) return;
  SW.drag = null; if (g.raf) { cancelAnimationFrame(g.raf); g.raf = 0; } if (g.on) { SW.endRow = g.row; SW.endAt = Date.now(); swGo(g, 0); }
}
// увести строку в точку to (0 — вернуть, ±ширина — «улетела») и убрать следы жеста; без анимации при reduced motion
function swGo(g, to, after) {
  var sw = g.sw, row = g.row, done = false;
  function fin() {
    if (done) return; done = true;
    sw.classList.remove("on", "drag", "snap", "go"); sw.removeAttribute("data-d"); row.style.transform = "";
    var hn = sw.querySelector(".swb"); if (hn) hn.remove();
    if (after) after();
    if (SW.later && !SW.drag) { SW.later = false; renderList(); }
  }
  if (swReduce() || Math.abs(g.x - to) < 1) { fin(); return; }
  sw.classList.remove("drag"); sw.classList.add("snap"); row.style.transform = "translate3d(" + to + "px,0,0)";
  row.addEventListener("transitionend", function te(e) { if (e.target === row && e.propertyName === "transform") { row.removeEventListener("transitionend", te); fin(); } });
  setTimeout(fin, 320);
}
function swPatchRow(r, a) { if (a === "resolve") { r.nd = ""; r.why = ""; } else r.pu = Date.now() + 12 * 3600e3; }
function swFind(k) { for (var i = 0; i < S.rows.length; i++) if (keyOf(S.rows[i]) === k) return S.rows[i]; return null; }
function swRepaint() { touchRows(); setBadge(); chipsEl(); renderList(); }
// список с сервера пришёл, а действие ещё не отправлено: показываем строку уже с действием, иначе она «вернётся» на 8–15 секунд
function swOverlay() {
  var p = SW.pend; if (!p) return;
  var r = swFind(p.k); if (!r) return;
  if (p.a === "resolve" && r.nd && S.f !== "web") S.need = Math.max(0, S.need - 1);
  swPatchRow(r, p.a);
}
function swUnpatch(p) {
  var r = swFind(p.k); if (r) { r.nd = p.was.nd; r.why = p.was.why; r.pu = p.was.pu; }
  if (p.dec) S.need++;
}
function swTrigger(g) {
  var A = SW_ACT[g.dir], k = keyOf(g.r), r = swFind(k) || g.r, // список мог обновиться, пока палец вёл строку: правим свежую строку, а не старую копию
     nm = r.nm || r.ph || "Гость сайта", dir = g.dir;
  SW.drag = null; swFlush(); // предыдущее отложенное (если было) уходит сразу: окно «Отменить» одно
  var p = SW.pend = { k: k, a: A.a, ch: r.ch, id: r.id, was: { nd: r.nd, why: r.why, pu: r.pu }, dec: A.a === "resolve" && !!r.nd, sent: false, p: null, t: setTimeout(function () { swFlush(); }, SW.ms) };
  swPatchRow(r, A.a); if (p.dec) S.need = Math.max(0, S.need - 1);
  var leaves = !visibleRows().some(function (x) { return keyOf(x) === k; });
  toast(A.a === "resolve" ? "Готово: " + nm : "Бот молчит: " + nm, { ms: SW.ms, undo: swUndo });
  swGo(g, leaves ? (dir === "l" ? -g.w : g.w) : 0, swRepaint); // ушла из списка — «улетает» в сторону свайпа, осталась — возвращается уже с новой пометкой
}
function swUndo() {
  var p = SW.pend; if (!p || p.sent) return;
  clearTimeout(p.t); SW.pend = null; swUnpatch(p); swRepaint();
  toast("Возвращено", { ms: 1800 });
}
// отправить отложенное действие сейчас; key — только если оно по этому чату; возвращает обещание или null
function swFlush(key) {
  var p = SW.pend; if (!p || (key && p.k !== key)) return null;
  if (p.sent) return p.p;
  p.sent = true; clearTimeout(p.t);
  if (SW.tOn) { clearTimeout(toastT); $("toast").hidden = true; SW.tOn = false; }
  function back() { if (SW.pend === p) SW.pend = null; }
  p.p = API.act(p.ch, p.id, p.a).then(function (d) {
    back();
    if (d && d.error) { swUnpatch(p); swRepaint(); toast(d.error, { ms: 7000 }); return; } // сервер не разрешил: строка на месте, причина словами сервера
    loadList();
  }).catch(function (e) { back(); swUnpatch(p); swRepaint(); loadList(); oops(e); });
  return p.p;
}

/* ---------- переписка ---------- */
// Переписки в памяти: открытие чата показывает сохранённое сразу, а свежее подтягивается тихо (без спиннера на месте текста).
var CC = {}, INF = {};
function chatReq(ch, id) { // один запрос на чат за раз: касание и клик не делают два одинаковых
  var k = ch + ":" + id, f = INF[k]; if (f && Date.now() - f.at < 3000) return f.p;
  var p = API.chat(ch, id); INF[k] = { p: p, at: Date.now() }; var done = function () { if (INF[k] && INF[k].p === p) delete INF[k]; }; p.then(done, done); return p;
}
function prefetch(r) {
  var k = keyOf(r), c = CC[k]; PF.moved = false; clearTimeout(PF.t);
  if (c && Date.now() - c.at < 20000) return;
  PF.t = setTimeout(function () { PF.t = 0; if (PF.moved) return; chatReq(r.ch, r.id).then(function (d) { if (d && !d.error) CC[k] = { d: d, at: Date.now() }; }).catch(function () {}); }, 90);
}
function prefetchCancel() { PF.moved = true; clearTimeout(PF.t); PF.t = 0; }
// quiet=true — открытие по ссылке (#wa:…) или кодом: запись в истории не добавляем. row — строка списка (имя и номер видны сразу).
// На телефоне открытие чата из списка — новая запись истории: жест «назад» от левого края (iOS, Android) и кнопка «назад» закрывают чат, а не уводят со страницы
function openChat(ch, id, quiet, row) {
  saveDraft(); S.cur = { ch: ch, id: id }; S.chat = null; S.card = false; app.classList.remove("card");
  $("txt").value = S.drafts[keyOf(S.cur)] || ""; fit();
  try {
    var hash = location.pathname + location.search + "#" + ch + ":" + id;
    if (!quiet && !S.pushed && swPhone()) { history.pushState({ pult: 1 }, "", hash); S.pushed = true; } else history.replaceState(S.pushed ? history.state : null, "", hash);
  } catch (e) {}
  app.classList.add("chat"); clear($("cards")); $("strip").hidden = true;
  var cached = CC[keyOf(S.cur)], hr = row || S.rows.filter(function (r) { return same(r, S.cur); })[0];
  var M = $("msgs"); if (!cached) { clear(M); M._n = null; }
  if (cached) { renderChat(cached.d, true); CP.sig = ""; } else { $("cname").textContent = hr ? whoOf(hr.nm, hr.ph) : "…"; $("cst").textContent = ""; }
  renderList();
  var pw = swFlush(keyOf(S.cur)); // отложенное действие по этому чату уходит сразу, чтобы чат открылся уже с ним
  if (pw) pw.then(function () { loadChat(true); }); else loadChat(true, false, !!cached);
  CP.sig = ""; chatPollArm(); // первый запрос — сразу, следующий — через POLL_CHAT_MS
}
function closeChat(fromPop) {
  saveDraft(); S.cur = null; S.chat = null; S.card = false; app.classList.remove("chat", "card");
  try {
    if (S.pushed && !fromPop) { S.pushed = false; S.popSkip = (S.popSkip || 0) + 1; history.back(); } // вернуть запись истории, которую добавило открытие
    else if (!fromPop) history.replaceState(null, "", location.pathname + location.search);
  } catch (e) {}
  renderList(); loadList();
}
// «назад» системы (жест от левого края, кнопка Android): сначала закрывает карточку клиента, потом чат
function onPop() {
  if (S.popSkip > 0) { S.popSkip--; return; }
  if (!S.pushed) return;
  if (S.card) { closeCard(); try { history.pushState({ pult: 1 }, "", location.pathname + location.search + (S.cur ? "#" + S.cur.ch + ":" + S.cur.id : "")); } catch (e) { S.pushed = false; } return; }
  S.pushed = false; if (S.cur) closeChat(true);
}
function saveDraft() { if (S.cur) { var v = $("txt").value; if (v) S.drafts[keyOf(S.cur)] = v; else delete S.drafts[keyOf(S.cur)]; } }
// poll=true — запрос по таймеру: не накладывается на предыдущий (CP.req) и не перерисовывает экран, если ответ не изменился
// swr=true — тихое обновление после показа сохранённой переписки
function loadChat(scroll, poll, swr) {
  if (!S.cur) return; var want = S.cur, mine = 0, quiet = poll || swr;
  if (poll) { if (CP.req && Date.now() - CP.req < 10000) return; mine = CP.req = Date.now(); } // зависший запрос через 10 с не мешает следующему
  var rel = function () { if (poll && CP.req === mine) CP.req = 0; };
  (poll ? API.chat(want.ch, want.id) : chatReq(want.ch, want.id)).then(function (d) {
    rel(); if (!same(S.cur, want)) return; if (!poll || CP.bad) { CP.bad = false; netErr(false); } // таймер сам не гасит сообщение «нет связи» от других запросов
    if (d.error) { $("cname").textContent = d.error; return; }
    var sig = quiet ? JSON.stringify(d) : ""; if (quiet && sig === CP.sig) return; // ничего не изменилось — DOM не трогаем (не мигает, выделение не сбивается)
    renderChat(d, scroll && !swr); CP.sig = sig;
  }).catch(function (e) { rel(); if (e !== 0 && same(S.cur, want)) { netErr(true); if (poll) CP.bad = true; if ($("cname").textContent === "…") $("cname").textContent = "Не удалось открыть чат"; } });
}
function stateText(d) { return d.off ? "Бот выключен" : d.stop ? "Просил не писать" : d.paused ? "Бот на паузе до " + hm(d.paused) : "Ведёт бот"; }
function bookCard(title, l1, l2) { return h("div", "bk", [h("span", "ic", ic("cal", 20)), h("span", "tx", [h("b", "", title), l1 ? h("span", "", l1) : null, l2 ? h("span", "", l2) : null])]); }
// сигнатура реплик: если уже нарисованные не изменились, дорисовываем только новые
function turnsSig(turns, n) { var a = ""; for (var i = 0; i < n; i++) { var t = turns[i]; a += t.r + (t.t || 0) + ":" + String(t.x || "").length + ";"; } return a; }
function mediaNodes(d, t, m) {
  if (!(t.m && t.m.f)) return;
  var u = "/api/inbox/media?c=" + enc(S.C) + "&ch=" + d.ch + "&id=" + enc(d.id) + "&mid=" + enc(t.m.id);
  if (t.m.k === "audio") { var au = h("audio"); au.controls = true; au.preload = "none"; au.src = u; m.appendChild(au); }
  else if (t.m.k === "image") { var im = h("img"); im.loading = "lazy"; im.alt = "фото"; im.src = u; m.appendChild(im); }
  else { m.appendChild(h("br")); m.appendChild(h("a", "", t.m.n || "Файл", { href: u, target: "_blank", rel: "noopener" })); }
}
// реплики: дата отдельной строкой, пузыри подряд от одного автора теснее; служебные строки («бот передал чат…») не показываем
function appendTurns(M, d, from, fresh0, pr) {
  var lastDay = M._day || "", pr0 = M._prev || null;
  for (var ti = from; ti < d.turns.length; ti++) {
    var t = d.turns[ti], fresh = fresh0 >= 0 && ti >= fresh0 && !(t.r === "a" && S.justSent && t.x === S.justSent); // своё сообщение уже «влетело» при отправке
    var day = t.t ? dk(t.t) : ""; if (day && day !== lastDay) { M.appendChild(h("div", "dpill", dayLabel(t.t))); lastDay = day; pr0 = null; }
    if (pr && t.t >= pr.at) { M.appendChild(h("div", "sys", "Рассылка" + (pr.name ? " «" + pr.name + "»" : "") + " от " + hm(pr.at) + ": " + pr.text)); pr = null; pr0 = null; M._prUsed = true; }
    if (t.r === "s") continue;
    if (t.r === "k") { var bc = bookCard(t.x, t.l1, t.l2); if (fresh) bc.classList.add("new"); M.appendChild(bc); pr0 = null; continue; }
    var cls = t.r === "u" ? "in" : t.r === "a" ? "adm" : "bot", grp = pr0 && pr0.r === t.r && t.t - pr0.t < 120000;
    var m = h("div", "m " + cls + (fresh ? " new" : "") + (grp ? " g" : ""));
    m.appendChild(h("span", "tx", t.x)); mediaNodes(d, t, m);
    m.appendChild(h("span", "ts", [t.r === "b" ? ic("bot", 12) : null, hm(t.t)]));
    M.appendChild(m); pr0 = { r: t.r, t: t.t };
  }
  if (pr) M.appendChild(h("div", "sys tail", "Рассылка" + (pr.name ? " «" + pr.name + "»" : "") + " от " + hm(pr.at) + ": " + pr.text)); // метка о рассылке, если клиент ещё не отвечал: при дорисовке уходит вниз
  M._day = lastDay; M._prev = pr0;
}
function renderChat(d, scroll) {
  CP.sig = "";
  var same0 = !!S.chat && S.chat.id === d.id && S.chat.ch === d.ch, prevN = same0 ? S.chat.turns.length : -1;
  S.chat = d; CC[keyOf(d)] = { d: d, at: Date.now() };
  $("cname").textContent = whoOf(d.name || d.waName, d.phone); $("cst").textContent = [d.paused && !d.off && !d.stop ? "" : stateText(d), CHN[d.ch] || ""].filter(Boolean).join(" · ");
  var call = $("call"); if (d.phone) { call.href = telHref(d.phone); call.hidden = false; } else call.hidden = true;
  renderStrip(d);
  var K = $("cards"); if (!K.querySelector("textarea")) { clear(K); (d.reqs || []).forEach(function (q) { K.appendChild(reqCard(q, d.canSend && d.open && d.ch !== "web")); }); }
  var M = $("msgs"), n = M._n, toEnd = false, bk = JSON.stringify(d.bookings);
  Array.prototype.forEach.call(M.querySelectorAll(".pend"), function (e) { e.remove(); }); // «отправляется…» заменяет настоящая реплика
  var pk = JSON.stringify(d.promo || null), inc = n != null && same0 && pk === M._pk && d.turns.length >= n && turnsSig(d.turns, n) === M._sig;
  if (inc && d.turns.length === n && bk === M._bk) { /* ничего нового: пузыри не трогаем */ }
  else {
    var atEnd = M.scrollHeight - M.scrollTop - M.clientHeight < 80, st0 = M.scrollTop;
    if (inc) { Array.prototype.forEach.call(M.querySelectorAll(".tail"), function (e) { e.remove(); }); appendTurns(M, d, n, prevN, M._prUsed ? null : d.promo); }
    else { clear(M); M._day = ""; M._prev = null; M._prUsed = false; appendTurns(M, d, 0, prevN, d.promo); }
    if (!d.turns.some(function (t) { return t.r === "k"; })) (d.bookings || []).forEach(function (b) { var c = bookCard("Запись", b); c.classList.add("tail"); M.appendChild(c); });
    M._n = d.turns.length; M._sig = turnsSig(d.turns, d.turns.length); M._bk = bk; M._pk = pk; S.justSent = "";
    toEnd = !!(scroll || !same0 || atEnd); if (!toEnd) M.scrollTop = st0; // читают старое выше — не прыгаем вниз, остаёмся на том же месте
  }
  var comp = $("comp"), wl = $("warn");
  comp.hidden = !d.canSend; wl.className = "warnl";
  var w = d.ch === "web" ? "Это чат с сайта: ответить в него нельзя. Позвоните клиенту, если он оставил номер." : !d.canSend ? "Отправка не настроена: WhatsApp этой компании ещё не подключён." : !d.open ? "Клиент писал больше 24 часов назад — WhatsApp не даст написать первым." : "";
  wl.textContent = w;
  $("txt").disabled = !d.open; fit();
  renderCard(d);
  if (toEnd) { M.scrollTop = M.scrollHeight; if (window.requestAnimationFrame) requestAnimationFrame(function () { M.scrollTop = M.scrollHeight; }); }
}
function renderStrip(d) {
  var s = clear($("strip")); s.hidden = false; s.className = "strip";
  function act(label, a) { var b = h("button", "btn pri sm", label, { type: "button" }); b.onclick = function () { doAct(a); }; return b; }
  if (d.off) { s.className = "ban"; s.appendChild(h("span", "", "Бот в этой компании выключен — отвечаете вы.")); return; }
  if (d.stop) { s.className = "ban"; s.appendChild(h("span", "", "Клиент попросил не писать ему автоматически. Бот вернётся, когда он напишет «старт».")); return; }
  if (d.paused) { s.classList.add("solo"); s.appendChild(act("Вернуть бота", "resume")); return; }
  if (d.need) { var why = d.need.why, txt = (d.need.label || NEED[why] || d.need.text || "Нужен ответ"); s.appendChild(h("span", "tag", txt)); s.appendChild(act("Забрать чат", "pause")); return; }
  s.hidden = true;
}
function reqCard(q, canMsg) {
  var T = { cancel: "Клиент просит отменить запись", change: "Клиент просит перенести запись", callback: "Нужно перезвонить клиенту", lead: "Заявка — подтвердите запись" };
  var c = h("div", "rq", [h("b", "", T[q.kind] || "Просьба клиента"), h("div", "", [q.name, q.service, q.time].filter(Boolean).join(" · "))]);
  if (q.note) c.appendChild(h("div", "mut", q.note));
  var r = h("div", "row2"), d = h("button", "btn pri", q.kind === "callback" ? "Перезвонил — закрыть" : canMsg ? "Сделано" : q.kind === "lead" ? "Позвонил и подтвердил — закрыть" : "Сделано — закрыть (клиенту написать нельзя)", { type: "button" });
  d.onclick = function () {
    if (q.kind === "callback" || !canMsg) { doAct("done", { lead: q.id, text: "" }); return; }
    r.hidden = true; var ta = h("textarea"), w = ((q.service || "").split("→")[1] || "").trim();
    ta.value = q.kind === "cancel" ? "Здравствуйте! Вашу запись отменили. Будем рады видеть вас в другой раз." : q.kind === "change" ? "Здравствуйте! Вашу запись перенесли" + (w ? ": " + w : "") + ". Ждём вас!" : "Здравствуйте! Ваша запись подтверждена: " + [q.service, q.time].filter(Boolean).join(", ") + ". Ждём вас!";
    c.appendChild(ta);
    var r2 = h("div", "row2"), s1 = h("button", "btn pri", "Отправить клиенту и закрыть", { type: "button" }), s2 = h("button", "btn sec", "Закрыть без сообщения", { type: "button" }), s3 = h("button", "btn sec", "Отмена", { type: "button" });
    s1.onclick = function () { doAct("done", { lead: q.id, text: ta.value }); }; s2.onclick = function () { doAct("done", { lead: q.id, text: "" }); }; s3.onclick = function () { clear($("cards")); loadChat(false); };
    r2.appendChild(s1); r2.appendChild(s2); r2.appendChild(s3); c.appendChild(r2);
  };
  r.appendChild(d); c.appendChild(r); return c;
}
function done(d, tgt) {
  S.busy = false;
  if (d.error) { notice("Не получилось", d.error); return; }
  if (d.warn) notice("Обратите внимание", d.warn);
  if (tgt && !same(S.cur, tgt)) { loadList(); return; }
  clear($("cards")); renderChat(d.chat, true); loadList();
}
function doAct(a, x) { if (S.busy || !S.cur) return; S.busy = true; var tgt = S.cur; API.act(tgt.ch, tgt.id, a, x).then(function (d) { done(d, tgt); }).catch(oops); }
function sendMsg() {
  var ta = $("txt"), t = ta.value.trim(); if (!t || S.busy || !S.cur) return;
  S.busy = true; var tgt = S.cur, M = $("msgs");
  S.justSent = t;
  var pend = h("div", "m adm pend new", [h("span", "tx", t), h("span", "ts", hm(Date.now()))]); M.appendChild(pend); M.scrollTop = M.scrollHeight;
  ta.value = ""; fit();
  API.send(tgt.ch, tgt.id, t).then(function (d) {
    if (d.error) { pend.remove(); if (same(S.cur, tgt)) { ta.value = t; fit(); } done(d, tgt); return; }
    delete S.drafts[keyOf(tgt)]; done(d, tgt);
  }).catch(function (e) { pend.remove(); if (same(S.cur, tgt)) { ta.value = t; fit(); } oops(e); });
}
function fit() {
  var t = $("txt"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px";
  $("send").disabled = t.disabled || !t.value.trim(); fitComp();
}
// высота плавающей панели ввода и подписи над ней — переписке снизу оставляем столько же места
function fitComp() { var c = $("comp"), w = $("warn"), cin = c.parentNode; cin.style.setProperty("--compH", c.hidden ? "0px" : c.offsetHeight + "px"); cin.style.setProperty("--warnH", w.textContent ? w.offsetHeight + "px" : "0px"); }
var QUICK = (window.__QUICK || ["Здравствуйте! Чем могу помочь?", "Подскажите, пожалуйста, ваше имя и телефон.", "Ждём вас! Если планы изменятся — напишите заранее.", "Спасибо за обращение! Перезвоню вам в течение 10 минут."]);
function addText(q) { var ta = $("txt"); if (ta.disabled) return; ta.value = (ta.value.trim() ? ta.value.replace(/\s+$/, "") + "\n\n" : "") + q; fit(); try { ta.focus(); } catch (e) {} }
function insertPay() { if (S.chat && S.chat.pay) addText(S.chat.pay); } // реквизиты из паспорта — дословно; отправляет сам администратор
// быстрый ответ — строка или { title, text }; без названия берём первые слова (до 4, не длиннее 30 знаков)
function quickParts(q) {
  var text = String(typeof q === "string" ? q : (q && q.text) || "").trim(), title = typeof q === "object" && q && q.title ? String(q.title).trim() : "";
  if (!title) {
    var flat = text.replace(/\s+/g, " "), seg = /^[^:.!?—–]+/.exec(flat), t = seg ? seg[0].trim() : ""; // первая фраза до двоеточия, точки, тире
    if (t && t.length <= 28 && t.length < flat.replace(/[\s.!?]+$/, "").length) title = t;
    else {
      var w = flat.split(" "), a = ""; for (var i = 0; i < w.length && i < 4; i++) { if ((a + " " + w[i]).trim().length > 30 && a) break; a = (a + " " + w[i]).trim(); }
      title = a.replace(/[\s,.;:!?—-]+$/, "") + (a.length < flat.length ? "…" : "");
    }
  }
  return { title: title, text: text };
}
function quickCard(q, onPick) {
  var p = quickParts(q), short = p.title.replace(/…$/, "") === p.text.replace(/[\s,.;:!?—-]+$/, ""); // короткая фраза целиком в названии — превью не повторяет её
  var c = h(onPick ? "button" : "div", "qc", [h("span", "qt", p.title), short ? null : h("span", "qx", p.text)], onPick ? { type: "button" } : null);
  if (onPick) c.onclick = function () { onPick(p.text); };
  return c;
}
function quickSheet() {
  if ($("txt").disabled) return;
  var body = h("div", "qlist");
  if (S.chat && S.chat.pay) body.appendChild(quickCard({ title: "₸ Реквизиты для оплаты", text: S.chat.pay }, function () { closeSheet(); insertPay(); }));
  QUICK.forEach(function (q) { body.appendChild(quickCard(q, function (text) { closeSheet(); var ta = $("txt"); ta.value = (ta.value ? ta.value + " " : "") + text; fit(); ta.focus(); })); });
  sheet("Быстрые ответы", body);
}
function menuSheet() {
  var d = S.chat; if (!d) return; var body = h("div", "");
  if (d.need && !(d.reqs || []).length) body.appendChild(opt("check", "Готово — убрать из «Ждут ответа»", "", function () { doAct("resolve"); }));
  if (d.ch !== "web" && !d.off) { if (d.paused && !d.stop) body.appendChild(opt("refresh", "Вернуть бота", "", function () { doAct("resume"); })); else if (!d.paused) body.appendChild(opt("clock", "Остановить бота на 12 часов", "", function () { doAct("pause"); })); }
  body.appendChild(opt("info", "Карточка клиента", "", openCard));
  body.appendChild(opt("refresh", "Очистить память бота", "бот забудет эту переписку и записи", function () { ask("Очистить память бота?", "Бот забудет эту переписку, записи и просьбы клиента. Окно WhatsApp и «стоп» останутся.", "Очистить", function () { doAct("forget"); }); }, "bad"));
  sheet(whoOf(d.name || d.waName, d.phone), body);
}

/* ---------- карточка клиента ---------- */
function openCard() { S.card = true; app.classList.add("card"); }
function closeCard() { S.card = false; app.classList.remove("card"); }
function renderCard(d) {
  var nm = whoOf(d.name || d.waName, d.phone), c = d.card || null;
  var ib = clear($("cardbody")), ft = clear($("cardfoot"));
  ib.appendChild(h("div", "who0", [avatarEl("lg"), h("span", "nm", nm, { style: "font-size:24px;margin-top:10px;max-width:100%" }), (d.name || d.waName) && d.phone ? h("span", "sub", fmtPhone(d.phone)) : null]));
  var acts = h("div", "", [], { style: "display:flex;gap:10px;width:100%" });
  var o = h("button", "btn onlyph", "Открыть чат", { type: "button", style: "flex:1" }); o.onclick = closeCard; acts.appendChild(o);
  if (d.phone) acts.appendChild(h("a", "btn", "Позвонить", { href: telHref(d.phone), style: "flex:1" }));
  ib.appendChild(acts);
  var facts = c ? c.facts : [["Канал", CHN[d.ch] || ""], ["Бот", stateText(d)], ["Запись", (d.bookings || []).join("; ") || d.booked || "нет"]].concat((d.pend || []).length ? [["Заявка", d.pend.join("; ")]] : []);
  var g = h("div", "grp"); facts.forEach(function (f) { g.appendChild(h("div", "li", [h("span", "k", f[0]), h("span", "kv", f[1])])); }); ib.appendChild(g);
  if (c && c.tags && c.tags.length) ib.appendChild(h("div", "", c.tags.map(function (t) { return h("span", "pill", t); }), { style: "display:flex;gap:8px;flex-wrap:wrap" }));
  if (c && c.note) ib.appendChild(h("div", "card", [h("span", "cap", "Заметка"), h("span", "", c.note, { style: "font-size:15px;line-height:1.4" })], { style: "padding:14px 16px;display:flex;flex-direction:column;gap:6px" }));
  ft.hidden = true;
}
/* ---------- запуск ---------- */
// опрос открытой переписки: отдельный таймер (POLL_CHAT_MS) только при видимой вкладке; в демо сервера нет
var CP = { t: 0, req: 0, sig: "", bad: false };
function chatPollArm() { clearTimeout(CP.t); if (!DEMO) CP.t = setTimeout(chatPollTick, POLL_CHAT_MS); }
function chatPollTick() {
  if (document.visibilityState === "visible" && S.cur && S.v === "chats" && !S.busy && !$("cards").querySelector("textarea")) loadChat(false, true);
  chatPollArm();
}
function refresh() {
  if (document.hidden) { if (noteState() === "on") loadList(); return; } // свёрнуто: только список — ради уведомлений
  loadList(); if (DEMO && S.cur && !S.busy && !$("cards").querySelector("textarea")) loadChat(false); } // в рабочем пульте переписку обновляет chatPollTick
function init() {
  var th = "auto"; try { th = localStorage.getItem("pult.theme") || "auto"; } catch (e) {} setTheme(/^(auto|light|dark)$/.test(th) ? th : "auto", true);
  [["bell", "bell", 22], ["back", "back", 24], ["cback", "back", 24], ["infobtn", "info", 22], ["call", "phone", 22], ["menu", "dots", 22], ["quick", "plus", 24], ["send", "send", 20], ["srchic", "search", 18]].forEach(function (x) { $(x[0]).appendChild(ic(x[1], x[2])); });
  vwSync(); fitViewport(); buildNav();
  $("bizslot").appendChild(bizBtn());
  if (DEMO) $("bell").hidden = true;
  $("bell").onclick = bellClick; bellUpdate();
  if (TAURI && TAURI.notification) { var tn = TAURI.notification; Promise.resolve(tn.isPermissionGranted()).then(function (g) { return g || tn.requestPermission(); }).catch(function () {}); }
  $("q").oninput = function () { S.q = this.value; renderList(); };
  rowsBind(); $("lscroll").addEventListener("scroll", onListScroll, { passive: true });
  $("txt").oninput = fit; $("txt").onkeydown = function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendMsg(); };
  $("send").onclick = sendMsg; $("quick").onclick = quickSheet; $("back").onclick = function () { closeChat(); }; $("menu").onclick = menuSheet; $("infobtn").onclick = openCard;
  $("who").onclick = openCard; $("cback").onclick = closeCard; $("cs").onclick = closeCard;
  window.addEventListener("resize", function () { vwSync(); VL.ok = false; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { if ($("sheet")) closeSheet(); else if (S.card) closeCard(); } });
  document.addEventListener("visibilitychange", function () { if (document.hidden) swFlush(); });
  window.addEventListener("pagehide", function () { swFlush(); }); // закрыли вкладку — отложенное действие уходит сразу
  window.addEventListener("popstate", onPop);
  window.addEventListener("hashchange", function () { var m = /^#(wa|ga|web):([\w-]+)$/.exec(location.hash); if (m && S.C && !same(S.cur, { ch: m[1], id: m[2] })) openChat(m[1], m[2], true); });
  skeleton(); chipsEl();
  API.me().then(function (d) { S.owner = !!d.owner; if (d.c && !S.C) S.C = d.c; $("me").textContent = S.owner ? "В" : "А"; $("bizslot").replaceChildren(bizBtn()); }).catch(function () {}).then(function () {
    return loadList();
  }).then(function () {
    var m = /^#(wa|ga|web):([\w-]+)$/.exec(location.hash);
    if (m && S.C) { if (m[1] === "web") S.f = "web"; openChat(m[1], m[2], true); chipsEl(); }
  });
  setInterval(refresh, DEMO ? 8000 : POLL_LIST_MS); chatPollArm();
  go("chats");
}
window.__pult = { fmtPhone: fmtPhone, whoOf: whoOf, avatarEl: avatarEl, CC: CC, loadChat: loadChat, quickCard: quickCard, tel: telHref, S: S, go: go, h: h, ic: ic, add: add, clear: clear, money: money, hm: hm, dk: dk, rowTime: rowTime, colorOf: colorOf, initials: initials, sheet: sheet, closeSheet: closeSheet, opt: opt, toast: toast, notice: notice, headerEl: headerEl, ibtn: ibtn, titleEl: titleEl, setTheme: setTheme, openChat: openChat, loadList: loadList, SW: SW, API: function () { return API; }, DEMO: DEMO, enc: enc, bizSheet: bizSheet, NB: NB, ic_: IC };
window.__pultBoot = init;
})();
