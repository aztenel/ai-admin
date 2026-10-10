/* Пульт чатов: одно приложение для телефона, планшета и компьютера.
   Работает в двух режимах: рабочий (настоящий API /api/inbox/*) и демо (window.__DEMO_API, всё в браузере). */
(function () {
"use strict";
var DEMO = !!window.__DEMO;
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
var COLORS = ["#B5652A", "#3D6DB3", "#2E7A57", "#6A5AA6", "#1F7A80"];
function hashOf(s) { var x = 0; s = String(s); for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x; }
function colorOf(id) { return COLORS[hashOf(id) % COLORS.length]; }
function initials(name, ph) { var w = String(name || "").trim().split(/\s+/).filter(Boolean); if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase(); if (w.length === 1) return w[0].slice(0, 2).toUpperCase(); var d = String(ph || "").replace(/\D/g, ""); return d ? d.slice(-2) : "··"; }
function same(a, b) { return !!a && !!b && a.ch === b.ch && a.id === b.id; }
function keyOf(x) { return x.ch + ":" + x.id; }
var NEED = { human: "Просит человека", limit: "Бот не ответил", media: "Прислал файл", ai: "Сбой бота", req: "Просит отменить или перенести", lead: "Новая заявка", call: "Ждёт звонка", off: "Бот выключен" };
var CHN = { wa: "WhatsApp", ga: "WhatsApp", web: "Сайт" };

/* ---------- слой данных ---------- */
function jf(p, b) {
  return fetch(p, b ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) } : { credentials: "same-origin" }).then(function (r) {
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
  var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", dark ? "#0F1419" : "#F7F8FA");
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
function toast(text) { var o = $("toast"); o.textContent = text; o.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { o.hidden = true; }, 3200); }
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
var TABS = [["chats", "Чаты", "chats"], ["leads", "Лиды", "leads"], ["summary", "Сводка", "sum"], ["broadcast", "Рассылки", "bc"], ["more", "Ещё", "more"]];
function buildNav() {
  var n = clear($("nav"));
  TABS.forEach(function (t, i) {
    var a = h("a", "", [t[0] === "more" ? ic("dots", 24) : ic(t[2], 24), t[1], t[0] === "chats" ? h("span", "bdg", "", { id: "bdg", hidden: true }) : null], { href: "#" + t[0], "data-v": t[0] });
    a.onclick = function (e) { e.preventDefault(); go(t[0]); };
    if (t[0] === "more") n.appendChild(h("div", "sp-flex"));
    n.appendChild(a);
  });
  n.appendChild(h("span", "me", S.owner ? "В" : "А", { title: DEMO ? "Асель, администратор" : "", id: "me" }));
}
function go(v) {
  S.v = v; S.card = false; app.classList.remove("card");
  document.querySelectorAll(".view").forEach(function (e) { e.classList.toggle("on", e.id === "v-" + v); });
  document.querySelectorAll("#nav a").forEach(function (a) { if (a.dataset.v === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
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
  var b = h("button", "biz", [h("span", "l", (nm[0] || "К").toUpperCase(), { style: "background:" + (DEMO ? "#B5652A" : colorOf(S.C)) }), h("span", "n", nm), (S.owner || DEMO) ? ic("chev", 16) : null], { type: "button", "aria-label": "Компания: " + nm });
  b.onclick = bizSheet; return b;
}
function bizSheet() {
  if (!S.owner && !DEMO) return;
  var body = h("div", "");
  API.clients().then(function (d) {
    if (d.error) { body.appendChild(h("div", "note", d.error)); return; }
    (d.clients || []).forEach(function (c) { var o = opt(null, c.name, c.kind + " · " + c.id, function () { if (DEMO) toast("В демо — только этот барбершоп"); else location.href = "/inbox?c=" + c.id; }); if (c.id === S.C) o.classList.add("sel"); body.appendChild(o); });
  }).catch(function () { body.appendChild(h("div", "note", "Не удалось получить список компаний.")); });
  if (DEMO) body.appendChild(h("div", "note", "Здесь появятся ваши другие бизнесы — например, магазин телефонов. Вход один, переключаются одним нажатием."));
  sheet("Компания", body);
}
function headerEl(extra) {
  var hd = h("div", "hdr", [bizBtn(), h("span", "sp")]);
  (extra || []).forEach(function (x) { hd.appendChild(x); });
  return hd;
}
function ibtn(icon, label, fn, pri) { var b = h("button", "ibtn" + (pri ? " pri" : ""), ic(icon, pri ? 24 : 22), { type: "button", "aria-label": label }); b.onclick = fn; return b; }
function titleEl(t, meta) { return h("div", "ttl", [h("h1", "", t), h("span", "meta", meta || "")]); }

/* ---------- вкладка «Чаты» ---------- */
function chipsEl() {
  var c = clear($("chips")); c.classList.add("more");
  var defs = [["need", "Ждут ответа" + (S.need ? " " + S.need : "")], ["all", "Все"], ["pause", "Бот молчит"], ["web", "Сайт"]];
  defs.forEach(function (d) { var b = h("button", "chip" + (S.f === d[0] ? " on" : ""), d[1], { type: "button" }); b.onclick = function () { S.f = d[0]; S.rows = []; S.ready = false; renderList(); chipsEl(); loadList(); }; c.appendChild(b); });
}
function skeleton() { var r = clear($("rows")); for (var i = 0; i < 6; i++) r.appendChild(h("div", "sk-row", [h("div", "sk-av"), h("div", "sk-t", [h("div", "sk", "", { style: "width:" + (45 + (i * 13) % 35) + "%" }), h("div", "sk", "", { style: "width:" + (60 + (i * 9) % 30) + "%" })])])); }
function rowEl(r, i) {
  var nm = r.nm || r.ph || "Гость сайта", sel = S.cur && S.cur.ch === r.ch && S.cur.id === r.id;
  var hot = !!r.nd;
  var prev = (r.d === "u" ? "" : r.d === "a" ? "Вы: " : "Бот: ") + (r.s || "");
  var tag = r.nd ? h("span", "tag", r.why || NEED[r.nd] || "Нужен ответ") : r.pu ? h("span", "tag ok", "Бот молчит до " + hm(r.pu)) : r.st ? h("span", "tag mut", "Просил не писать") : null;
  var a = h("a", "row" + (sel ? " sel" : "") + (hot ? " wait" : ""), [
    h("span", "av", initials(r.nm, r.ph), { style: "--c:" + colorOf(r.id) }),
    h("div", "rb", [h("div", "r1", [h("span", "nm", nm), h("span", "tm2" + (hot || r.un ? " hot" : ""), rowTime(r.li || r.t))]),
      h("div", "r2", [h("span", "pv", prev), r.un ? h("span", "ub", r.un) : null]), tag])
  ], { href: "#" + r.ch + ":" + r.id, style: "--i:" + Math.min(i || 0, 12) });
  a.onclick = function (e) { e.preventDefault(); openChat(r.ch, r.id); };
  return a;
}
function renderList() {
  var R = clear($("rows")), rows = S.rows.slice();
  if (S.f === "pause") rows = rows.filter(function (r) { return r.pu; });
  var q = S.q.trim().toLowerCase();
  if (q) rows = rows.filter(function (r) { return ((r.nm || "") + " " + (r.ph || "") + " " + (r.s || "")).toLowerCase().indexOf(q) >= 0; });
  if (!S.ready) { skeleton(); return; }
  if (!rows.length) {
    var msg = q ? ["Ничего не найдено", "Попробуйте другое имя или номер."] : S.f === "web" ? ["Чатов с сайта пока нет", "Они появятся, когда клиенты напишут боту на сайте."] : S.f === "need" ? ["Никто не ждёт ответа", "Все чаты — на вкладке «Все»."] : S.f === "pause" ? ["Бот не молчит ни в одном чате", "Здесь появятся чаты, где вы взяли разговор на себя."] : ["Чатов пока нет", "Они появятся, когда клиенты напишут в WhatsApp."];
    R.appendChild(h("div", "empty", [h("span", "ic", ic("inbox", 26)), h("b", "", msg[0]), h("span", "", msg[1])])); return;
  }
  rows.forEach(function (r, i) { R.appendChild(rowEl(r, i)); });
  if (!S.shown) { S.shown = true; replay(R, "in"); setTimeout(function () { R.classList.remove("in"); }, 1000); } // один раз: строки появляются по очереди
}
// перезапуск анимации: снять класс, дать браузеру заметить, вернуть
function replay(e, c) { if (!e) return; e.classList.remove(c); void e.offsetWidth; e.classList.add(c); }
function loadList() {
  if (!S.C) { pickCompany(); return Promise.resolve(); }
  var want = S.f;
  return API.list(want === "web" ? "all" : want === "pause" ? "all" : want, want === "web" ? "web" : "wa").then(function (d) {
    netErr(false); if (want !== S.f) return;
    if (d.error) { clear($("rows")).appendChild(h("div", "empty", [h("b", "", "Не получилось загрузить"), h("span", "", d.error)])); return; }
    S.ready = true; S.rows = d.chats || []; S.client = d.client || S.client; S.total = d.total || S.rows.length;
    if (want !== "web") { S.need = d.need || 0; noteCheck(S.rows); }
    $("bizslot").replaceChildren(bizBtn());
    $("meta").textContent = S.need ? S.need + " ждут ответа · " + S.total + " чатов" : "ждущих нет · " + S.total + " чатов";
    setBadge(); chipsEl(); renderList();
  }).catch(function (e) { if (e !== 0) netErr(true); });
}
function pickCompany() {
  API.clients().then(function (d) {
    var R = clear($("rows")); if (d.error) { R.appendChild(h("div", "empty", [h("b", "", "Нет доступа"), h("span", "", d.error)])); return; }
    R.appendChild(h("div", "empty", [h("b", "", "Выберите компанию")]));
    (d.clients || []).forEach(function (c) { var a = h("a", "row", [h("span", "av", (c.name[0] || "К").toUpperCase(), { style: "--c:" + colorOf(c.id) }), h("div", "rb", [h("span", "nm", c.name), h("span", "pv", c.kind + " · " + c.id)])], { href: "/inbox?c=" + c.id }); R.appendChild(a); });
  }).catch(function (e) { if (e !== 0) netErr(true); });
}

/* ---------- переписка ---------- */
function openChat(ch, id) {
  saveDraft(); S.cur = { ch: ch, id: id }; S.chat = null; S.card = false; app.classList.remove("card");
  $("txt").value = S.drafts[keyOf(S.cur)] || ""; fit();
  try { history.replaceState(null, "", location.pathname + location.search + "#" + ch + ":" + id); } catch (e) {}
  app.classList.add("chat"); replay($("chatp"), "enter"); clear($("msgs")); clear($("cards")); $("strip").hidden = true; $("cname").textContent = "…"; $("cst").textContent = "";
  renderList(); loadChat(true);
}
function closeChat() {
  saveDraft(); S.cur = null; S.chat = null; S.card = false; app.classList.remove("chat", "card"); replay($("listp"), "enter");
  try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  renderList(); loadList();
}
function saveDraft() { if (S.cur) { var v = $("txt").value; if (v) S.drafts[keyOf(S.cur)] = v; else delete S.drafts[keyOf(S.cur)]; } }
function loadChat(scroll) {
  if (!S.cur) return; var want = S.cur;
  API.chat(want.ch, want.id).then(function (d) {
    if (!same(S.cur, want)) return; netErr(false);
    if (d.error) { $("cname").textContent = d.error; return; }
    renderChat(d, scroll);
  }).catch(function (e) { if (e !== 0 && same(S.cur, want)) { netErr(true); if ($("cname").textContent === "…") $("cname").textContent = "Не удалось открыть чат"; } });
}
function stateText(d) { return d.off ? "Бот выключен" : d.stop ? "Просил не писать" : d.paused ? "Бот на паузе до " + hm(d.paused) : "Ведёт бот"; }
function bookCard(title, l1, l2) { return h("div", "bk", [h("span", "ic", ic("cal", 20)), h("span", "tx", [h("b", "", title), l1 ? h("span", "", l1) : null, l2 ? h("span", "", l2) : null])]); }
function renderChat(d, scroll) {
  var prevN = S.chat && S.chat.id === d.id && S.chat.ch === d.ch ? S.chat.turns.length : -1; // реплики с этим номером и дальше — новые: им анимация появления
  var first = !S.chat || S.chat.id !== d.id || S.chat.ch !== d.ch, grew = first || !S.chat || d.turns.length !== S.chat.turns.length || JSON.stringify(d.bookings) !== JSON.stringify(S.chat.bookings), toEnd = false;
  S.chat = d;
  var nm = d.name || d.waName || d.phone || "Гость сайта";
  $("cname").textContent = nm; $("cst").textContent = [stateText(d).replace("Бот на паузе до", "Пауза до"), CHN[d.ch] || ""].filter(Boolean).join(" · ");
  $("cav").textContent = initials(d.name || d.waName, d.phone); $("cav").style.setProperty("--c", colorOf(d.id));
  var call = $("call"); if (d.phone) { call.href = telHref(d.phone); call.hidden = false; } else call.hidden = true;
  renderStrip(d);
  var K = $("cards"); if (!K.querySelector("textarea")) { clear(K); (d.reqs || []).forEach(function (q) { K.appendChild(reqCard(q, d.canSend && d.open && d.ch !== "web")); }); }
  if (grew) {
    var M = $("msgs"), atEnd = M.scrollHeight - M.scrollTop - M.clientHeight < 80; clear(M);
    var pr = d.promo, lastDay = "";
    d.turns.forEach(function (t, ti) {
      var fresh = prevN >= 0 && ti >= prevN && !(t.r === "a" && S.justSent && t.x === S.justSent); // своё сообщение уже «влетело» при отправке
      var day = t.t ? dk(t.t) : ""; if (day && day !== lastDay) { M.appendChild(h("div", "dpill", dayLabel(t.t))); lastDay = day; }
      if (pr && t.t >= pr.at) { M.appendChild(h("div", "sys", "Рассылка" + (pr.name ? " «" + pr.name + "»" : "") + " от " + hm(pr.at) + " (клиент мог ответить на неё): " + pr.text)); pr = null; }
      if (t.r === "s") { M.appendChild(h("div", "sys" + (fresh ? " new" : ""), t.x)); return; }
      if (t.r === "k") { var bc = bookCard(t.x, t.l1, t.l2); if (fresh) bc.classList.add("new"); M.appendChild(bc); return; }
      var m = h("div", "m " + (t.r === "u" ? "in" : t.r === "a" ? "adm" : "bot") + (fresh ? " new" : ""));
      if (t.r === "a") m.appendChild(h("span", "by", t.by || "Вы")); else if (t.r === "b") m.appendChild(h("span", "by", "Бот"));
      m.appendChild(h("span", "tx", t.x));
      if (t.m && t.m.f) { var u = "/api/inbox/media?c=" + enc(S.C) + "&ch=" + d.ch + "&id=" + enc(d.id) + "&mid=" + enc(t.m.id); if (t.m.k === "audio") { var au = h("audio"); au.controls = true; au.preload = "none"; au.src = u; m.appendChild(au); } else if (t.m.k === "image") { var im = h("img"); im.loading = "lazy"; im.alt = "фото"; im.src = u; m.appendChild(im); } else { m.appendChild(h("br")); m.appendChild(h("a", "", "Открыть файл", { href: u, target: "_blank", rel: "noopener" })); } }
      m.appendChild(h("span", "ts", hm(t.t))); M.appendChild(m);
    });
    if (pr) M.appendChild(h("div", "sys", "Рассылка" + (pr.name ? " «" + pr.name + "»" : "") + " от " + hm(pr.at) + ": " + pr.text));
    if (!d.turns.some(function (t) { return t.r === "k"; })) (d.bookings || []).forEach(function (b) { M.appendChild(bookCard("Запись", b)); });
    S.justSent = "";
    toEnd = !!(scroll || first || atEnd); // прокрутим в самом конце: ниже ещё меняется высота (подсказка под перепиской, поле ввода)
  }
  var comp = $("comp"), wl = $("warn");
  comp.hidden = !d.canSend; wl.className = "warnl";
  var w = d.ch === "web" ? "Это чат с сайта: ответить в него нельзя. Позвоните клиенту, если он оставил номер." : !d.canSend ? "Отправка не настроена: WhatsApp этой компании ещё не подключён." : !d.open ? "Клиент писал больше 24 часов назад — WhatsApp не даст написать первым. Позвоните ему или дождитесь сообщения." : "После вашего ответа бот молчит в этом чате 2 часа.";
  wl.textContent = w; if (d.ch === "web" || !d.canSend || !d.open) wl.classList.add("amb");
  $("send").disabled = !d.open; $("txt").disabled = !d.open;
  var pb = $("pay"); pb.hidden = !d.pay; pb.disabled = !d.open;
  renderCard(d);
  if (toEnd) { var E = $("msgs"); E.scrollTop = E.scrollHeight; if (window.requestAnimationFrame) requestAnimationFrame(function () { E.scrollTop = E.scrollHeight; }); }
}
function renderStrip(d) {
  var s = clear($("strip")); s.hidden = false; s.className = "strip";
  function act(label, a) { var b = h("button", "btn pri sm", label, { type: "button" }); b.onclick = function () { doAct(a); }; return b; }
  if (d.off) { s.className = "ban"; s.appendChild(h("span", "", "Бот в этой компании выключен — отвечаете вы.")); return; }
  if (d.stop) { s.className = "ban"; s.appendChild(h("span", "", "Клиент попросил не писать ему автоматически. Бот вернётся, когда он напишет «старт».")); return; }
  if (d.paused) { s.classList.add("ok"); s.appendChild(h("span", "tag ok", "Бот молчит до " + hm(d.paused))); s.appendChild(act("Вернуть бота", "resume")); return; }
  if (d.need) { var why = d.need.why, txt = (d.need.label || NEED[why] || d.need.text || "Нужен ответ"); s.appendChild(h("span", "tag", txt + (d.need.at ? " · " + hm(d.need.at) : ""))); s.appendChild(act("Забрать чат", "pause")); return; }
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
  var pend = h("div", "m adm pend new", [h("span", "by", "Вы"), h("span", "tx", t), h("span", "ts", hm(Date.now()))]); M.appendChild(pend); M.scrollTop = M.scrollHeight;
  ta.value = ""; fit();
  API.send(tgt.ch, tgt.id, t).then(function (d) {
    if (d.error) { pend.remove(); if (same(S.cur, tgt)) { ta.value = t; fit(); } done(d, tgt); return; }
    delete S.drafts[keyOf(tgt)]; done(d, tgt);
  }).catch(function (e) { pend.remove(); if (same(S.cur, tgt)) { ta.value = t; fit(); } oops(e); });
}
function fit() { var t = $("txt"); t.style.height = "auto"; t.style.height = Math.min(Math.max(t.scrollHeight, 44), 120) + "px"; }
var QUICK = (window.__QUICK || ["Здравствуйте! Чем могу помочь?", "Подскажите, пожалуйста, ваше имя и телефон.", "Ждём вас! Если планы изменятся — напишите заранее.", "Спасибо за обращение! Перезвоню вам в течение 10 минут."]);
function addText(q) { var ta = $("txt"); if (ta.disabled) return; ta.value = (ta.value.trim() ? ta.value.replace(/\s+$/, "") + "\n\n" : "") + q; fit(); try { ta.focus(); } catch (e) {} }
function insertPay() { if (S.chat && S.chat.pay) addText(S.chat.pay); } // реквизиты из паспорта — дословно; отправляет сам администратор
function quickSheet() {
  if ($("txt").disabled) return;
  var body = h("div", "");
  if (S.chat && S.chat.pay) { var po = h("button", "opt", h("span", "", "₸ Реквизиты для оплаты"), { type: "button" }); po.onclick = function () { closeSheet(); insertPay(); }; body.appendChild(po); } QUICK.forEach(function (q) { var o = h("button", "opt", h("span", "", q), { type: "button" }); o.onclick = function () { closeSheet(); var ta = $("txt"); ta.value = (ta.value ? ta.value + " " : "") + q; fit(); ta.focus(); }; body.appendChild(o); });
  sheet("Быстрые ответы", body);
}
function menuSheet() {
  var d = S.chat; if (!d) return; var body = h("div", "");
  if (d.need && !(d.reqs || []).length) body.appendChild(opt("check", "Готово — убрать из «Ждут ответа»", "", function () { doAct("resolve"); }));
  if (d.ch !== "web" && !d.off) { if (d.paused && !d.stop) body.appendChild(opt("refresh", "Вернуть бота", "", function () { doAct("resume"); })); else if (!d.paused) body.appendChild(opt("clock", "Остановить бота на 12 часов", "", function () { doAct("pause"); })); }
  body.appendChild(opt("info", "Карточка клиента", "", openCard));
  body.appendChild(opt("refresh", "Очистить память бота", "бот забудет эту переписку и записи — если всё уже сделано в Altegio", function () { ask("Очистить память бота?", "Бот забудет эту переписку, записи и просьбы клиента. Окно WhatsApp и «стоп» останутся.", "Очистить", function () { doAct("forget"); }); }));
  body.appendChild(opt("refresh", "Обновить переписку", "", function () { loadChat(false); }));
  sheet(d.name || d.waName || d.phone || "Гость сайта", body);
}

/* ---------- карточка клиента ---------- */
function openCard() { S.card = true; app.classList.add("card"); }
function closeCard() { S.card = false; app.classList.remove("card"); }
function renderCard(d) {
  var nm = d.name || d.waName || d.phone || "Гость сайта", c = d.card || null;
  var ib = clear($("cardbody")), ft = clear($("cardfoot"));
  ib.appendChild(h("div", "who0", [h("span", "av", initials(d.name || d.waName, d.phone), { style: "--c:" + colorOf(d.id) + ";width:88px;height:88px;font-size:32px" }), h("span", "nm", nm, { style: "font-size:24px;margin-top:10px;max-width:100%" }), h("span", "sub", [d.phone, c && c.since ? "клиент с " + c.since : ""].filter(Boolean).join(" · "))]));
  var acts = h("div", "", [], { style: "display:flex;gap:10px;width:100%" });
  var o = h("button", "btn onlyph", "Открыть чат", { type: "button", style: "flex:1" }); o.onclick = closeCard; acts.appendChild(o);
  if (d.phone) acts.appendChild(h("a", "btn", "Позвонить", { href: telHref(d.phone), style: "flex:1" }));
  ib.appendChild(acts);
  var facts = c ? c.facts : [["Канал", CHN[d.ch] || ""], ["Бот", stateText(d)], ["Запись", (d.bookings || []).join("; ") || d.booked || "нет"]].concat((d.pend || []).length ? [["Заявка", d.pend.join("; ")]] : []);
  var g = h("div", "grp"); facts.forEach(function (f) { g.appendChild(h("div", "li", [h("span", "k", f[0]), h("span", "kv", f[1])])); }); ib.appendChild(g);
  if (c && c.tags) {
    var tg = h("div", "", c.tags.map(function (t) { return h("span", "pill", t); }), { style: "display:flex;gap:8px;flex-wrap:wrap" });
    var ad = h("button", "chip", "Добавить", { type: "button", style: "border-style:dashed" }); ad.onclick = function () { tagSheet(d.id, c); }; tg.appendChild(ad);
    ib.appendChild(h("div", "card", [h("span", "cap", "Метки"), tg], { style: "padding:14px 16px;display:flex;flex-direction:column;gap:10px" }));
  }
  if (c && c.note) ib.appendChild(h("div", "card", [h("span", "cap", "Заметка для администраторов"), h("span", "", c.note, { style: "font-size:15px;line-height:1.45" })], { style: "padding:14px 16px;display:flex;flex-direction:column;gap:6px" }));
  if (c && c.next) { var b = h("button", "btn pri", "Перевести в «" + c.next + "»", { type: "button", style: "height:50px;width:100%" }); b.onclick = function () { API.stageNext(d.id).then(function (r) { toast("Этап: " + r.stage); loadChat(false); loadList(); }); }; ft.appendChild(b); ft.hidden = false; } else ft.hidden = true;
}
function tagSheet(id, c) {
  var body = h("div", ""); ["Постоянный", "Вечер", "Утро", "С сыном", "VIP", "Не любит ждать"].forEach(function (t) { var on = c.tags.indexOf(t) >= 0, b = h("button", "opt" + (on ? " sel" : ""), [h("span", "", t), on ? ic("check", 20) : null], { type: "button" }); b.onclick = function () { API.tagToggle(id, t).then(function () { closeSheet(); loadChat(false); }); }; body.appendChild(b); });
  sheet("Метки клиента", body);
}

/* ---------- запуск ---------- */
function refresh() {
  if (document.hidden) { if (noteState() === "on") loadList(); return; } // свёрнуто: только список — ради уведомлений
  loadList(); if (S.cur && !S.busy && !$("cards").querySelector("textarea")) loadChat(false); }
function init() {
  var th = "auto"; try { th = localStorage.getItem("pult.theme") || "auto"; } catch (e) {} setTheme(/^(auto|light|dark)$/.test(th) ? th : "auto", true);
  [["rfs", "refresh", 22], ["bell", "bell", 22], ["plus", "plus", 24], ["back", "back", 22], ["cback", "back", 22], ["infobtn", "info", 22], ["call", "phone", 22], ["menu", "dots", 22], ["quick", "bolt", 22], ["send", "send", 22], ["srchic", "search", 20]].forEach(function (x) { $(x[0]).appendChild(ic(x[1], x[2])); });
  fitViewport(); buildNav();
  $("bizslot").appendChild(bizBtn());
  if (DEMO) { $("bell").hidden = false; $("plus").hidden = false; $("rfs").hidden = true; }
  $("bell").onclick = bellClick; bellUpdate();
  if (TAURI && TAURI.notification) { var tn = TAURI.notification; Promise.resolve(tn.isPermissionGranted()).then(function (g) { return g || tn.requestPermission(); }).catch(function () {}); }
  $("plus").onclick = function () { window.__views.newLead(); };
  $("rfs").onclick = function () { loadList(); if (S.cur) loadChat(false); };
  $("q").oninput = function () { S.q = this.value; renderList(); };
  $("txt").oninput = fit; $("txt").onkeydown = function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendMsg(); };
  $("send").onclick = sendMsg; $("quick").onclick = quickSheet; $("pay").onclick = insertPay; $("back").onclick = closeChat; $("menu").onclick = menuSheet; $("infobtn").onclick = openCard;
  $("who").onclick = openCard; $("cback").onclick = closeCard; $("cs").onclick = closeCard;
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { if ($("sheet")) closeSheet(); else if (S.card) closeCard(); } });
  window.addEventListener("hashchange", function () { var m = /^#(wa|ga|web):([\w-]+)$/.exec(location.hash); if (m && S.C && !same(S.cur, { ch: m[1], id: m[2] })) openChat(m[1], m[2]); });
  skeleton(); chipsEl();
  API.me().then(function (d) { S.owner = !!d.owner; if (d.c && !S.C) S.C = d.c; $("me").textContent = DEMO ? "А" : S.owner ? "В" : "А"; $("bizslot").replaceChildren(bizBtn()); }).catch(function () {}).then(function () {
    return loadList();
  }).then(function () {
    var m = /^#(wa|ga|web):([\w-]+)$/.exec(location.hash);
    if (m && S.C) { if (m[1] === "web") S.f = "web"; openChat(m[1], m[2]); chipsEl(); }
  });
  setInterval(refresh, DEMO ? 8000 : 15000);
  go("chats");
}
window.__pult = { tel: telHref, S: S, go: go, h: h, ic: ic, add: add, clear: clear, money: money, hm: hm, dk: dk, rowTime: rowTime, colorOf: colorOf, initials: initials, sheet: sheet, closeSheet: closeSheet, opt: opt, toast: toast, notice: notice, headerEl: headerEl, ibtn: ibtn, titleEl: titleEl, setTheme: setTheme, openChat: openChat, loadList: loadList, API: function () { return API; }, DEMO: DEMO, enc: enc, bizSheet: bizSheet, NB: NB, ic_: IC };
window.__pultBoot = init;
})();
