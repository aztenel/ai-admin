/* Экраны «Рассылки», «Ещё» и «Итоги» (открываются из «Ещё»). В демо — на вымышленных данных; в рабочем режиме — то, что есть в боте, и ссылки на готовые страницы. Заявки — фильтр в списке чатов. */
(function () {
"use strict";
var P = window.__pult, S = P.S, h = P.h, ic = P.ic, clear = P.clear, DEMO = P.DEMO, NB = P.NB;
function prof() { return DEMO && P.API().profile ? P.API().profile() : null; } // демо: подписи бизнеса (барбершоп / магазин телефонов)
var $ = function (id) { return document.getElementById(id); };
function api() { return P.API(); }
function scrollBox(el, kids, nonav) { var s = h("div", "scroll" + (nonav ? " nonav" : ""), kids); el.appendChild(s); return s; }
function stack(kids) { return h("div", "pad stack", kids); }
function ext(path) { return path + "?c=" + P.enc(S.C); }
function linkRow(icon, text, sub, href, blank) { var a = h("a", "li tap", [ic(icon, 24), h("span", "t", [text, sub ? h("small", "", sub) : null]), ic("chevr", 16)], { href: href, target: blank ? "_blank" : null, rel: blank ? "noopener" : null }); return a; }
function tapRow(icon, text, val, fn) { var b = h("button", "li tap", [ic(icon, 24), h("span", "t", text), val ? h("span", "v", val) : null, ic("chevr", 16)], { type: "button" }); b.onclick = fn; return b; }
function tag(text, cls) { return h("span", "tag" + (cls ? " " + cls : ""), text); }
function mount(id) { return clear($("v-" + id)); }

/* ---------- Итоги ---------- */
function summary() {
  var v = mount("summary");
  v.appendChild(P.titleEl("Итоги", function () { P.go("more"); }));
  var sc = h("div", "scroll"); 
  if (!DEMO) {
    v.appendChild(sc);
    var box = stack([]); sc.appendChild(box);
    api().list("all", "wa").then(function (d) {
      if (d.error) { box.appendChild(h("div", "empty", [h("b", "", "Не получилось загрузить"), h("span", "", d.error)])); return; }
      var rows = d.chats || [], need = rows.filter(function (r) { return r.nd; }).length, paused = rows.filter(function (r) { return r.pu; }).length, bk = rows.filter(function (r) { return r.bk; }).length;
      box.appendChild(h("div", "tiles", [tile(rows.length, "Чатов"), tile(need, "Ждут ответа"), tile(bk, "С записью")]));
      var g = h("div", "grp"); [["Ждут ответа человека", need, need > 0, "need"], ["Бот молчит", paused, false, "pause"]].forEach(function (a) { var b = h("button", "att", [h("span", "a", a[0]), h("span", "cnt" + (a[2] ? " hot" : ""), a[1])], { type: "button", style: "width:100%;text-align:left" }); b.onclick = function () { S.f = a[3]; S.ready = false; P.go("chats"); P.loadList(); }; g.appendChild(b); });
      box.appendChild(g);
    }).catch(function (e) { if (e !== 0) box.appendChild(h("div", "empty", [h("b", "", "Нет связи")])); });
    return;
  }
  var pr = h("div", "chips"); [["day", "Сегодня"], ["week", "Неделя"], ["month", "Месяц"]].forEach(function (p) { var b = h("button", "chip" + (S.per === p[0] ? " on" : ""), p[1], { type: "button" }); b.onclick = function () { S.per = p[0]; summary(); }; pr.appendChild(b); }); v.appendChild(pr); v.appendChild(sc);
  api().summary(S.per).then(function (d) {
    var bars = h("div", "spark", d.bars.map(function (x, i) { return h("i", i >= d.bars.length - 2 ? "on" : "", "", { style: "height:" + x + "%" }); }), { "aria-hidden": "true" });
    var funnel = h("div", "card", [h("span", "h3", "Воронка · " + d.label)].concat(d.funnel.map(function (f) { return h("div", "", [h("div", "", [h("span", "", f[0]), h("span", "", f[1], { style: "font-weight:600" })], { style: "display:flex;justify-content:space-between;font-size:15px" }), h("div", "bar", h("i", "", "", { style: "width:" + f[2] + "%" + (f[3] ? ";background:var(--red)" : f[2] === 100 ? ";background:var(--fg2)" : "") }))], { style: "display:flex;flex-direction:column;gap:6px" }); })), { style: "padding:16px;display:flex;flex-direction:column;gap:12px" });
    var att = h("div", "grp"); d.attn.forEach(function (a) { var b = h("button", "att", [h("span", "a", a[0]), h("span", "cnt" + (a[2] ? " hot" : ""), a[1])], { type: "button", style: "width:100%;text-align:left" }); b.onclick = function () { if (a[3]) { S.f = a[3]; S.ready = false; P.go("chats"); P.loadList(); } }; att.appendChild(b); });
    sc.appendChild(stack([h("div", "card hero", [h("span", "cap", "Выручка по записям из чатов"), h("div", "big", d.money), h("span", "dl", d.delta), bars]),
      h("div", "tiles", d.tiles.map(function (t) { return tile(t[0], t[1]); })), funnel, att]));
  });
}
function tile(v, k) { return h("div", "tile", [h("span", "v", v), h("span", "k", k)]); }

/* ---------- Рассылки ---------- */
function broadcast() {
  var v = mount("broadcast");
  v.appendChild(P.titleEl("Рассылки"));
  var sc = h("div", "scroll"); v.appendChild(sc);
  if (!DEMO) {
    sc.appendChild(stack([h("a", "btn pri", "Открыть рассылки", { href: ext("/broadcast") })]));
    return;
  }
  api().broadcasts().then(function (d) {
    var run = d.running;
    var top = h("div", "card", [
      h("div", "", [h("span", "cap", "Отправлено сегодня"), tag(run ? "Идёт" : "На паузе", run ? "ok" : "mut")], { style: "display:flex;justify-content:space-between;align-items:baseline" }),
      h("div", "", [h("span", "big xl", d.sent), h("span", "", "из " + d.limit + " в день", { style: "font-size:17px;color:var(--fg2)" })], { style: "display:flex;align-items:baseline;gap:6px" }),
      h("div", "bar", h("i", "", "", { style: "width:" + Math.round(d.sent / d.limit * 100) + "%" })),
      (function () { var b = h("button", "btn sec", run ? "Пауза" : "Продолжить", { type: "button" }); b.onclick = function () { api().broadcastToggle().then(broadcast); }; return b; })()
    ], { style: "padding:16px;display:flex;flex-direction:column;gap:12px" });
    var g = h("div", "grp"); d.items.forEach(function (it) { g.appendChild(h("div", "li", [h("span", "ico", ic(it.icon, 22)), h("div", "", [h("span", "nm", it.name, { style: "white-space:normal" }), tag(it.status, it.statusCls), h("span", "nx", it.sub, { style: "white-space:normal" })], { style: "flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;padding:10px 0" })])); });
    sc.appendChild(stack([top, g]));
  });
}

/* ---------- Ещё ---------- */
function more() {
  var v = mount("more");
  v.appendChild(P.titleEl("Ещё"));
  var sc = h("div", "scroll"); v.appendChild(sc);
  var nm = S.client.name || (DEMO ? "Барбершоп" : "Компания"), pf = prof();
  var biz = h("div", "card", [P.avatarEl("lg"), h("div", "", [h("span", "nm", nm, { style: "font-size:20px" }), h("span", "nx", DEMO ? pf.sub : S.C)], { style: "flex:1;min-width:0;display:flex;flex-direction:column;gap:2px" })], { style: "padding:14px 16px;display:flex;align-items:center;gap:14px" });
  biz.firstChild.style.cssText = "width:60px;height:60px";
  if (S.owner || DEMO) { var cb = h("button", "ibtn", ic("chev"), { type: "button", style: "background:var(--s2)", "aria-label": "Сменить компанию" }); cb.onclick = P.bizSheet; biz.appendChild(cb); }
  var themes = h("div", "seg"); [["auto", "Авто"], ["light", "Светлая"], ["dark", "Тёмная"]].forEach(function (t) { var b = h("button", S.theme === t[0] ? "on" : "", t[1], { type: "button", "aria-pressed": S.theme === t[0] ? "true" : "false" }); b.onclick = function () { P.setTheme(t[0]); more(); }; themes.appendChild(b); });
  var kids = [biz, themes, h("div", "grp", [tapRow("sum", "Итоги", "", function () { P.go("summary"); })])];
  if (DEMO) {
    kids.push(h("div", "grp", [
      tapRow("bolt", "Быстрые ответы", String((window.__QUICK || []).length), function () { var b = h("div", "qlist"); (window.__QUICK || []).forEach(function (q) { b.appendChild(P.quickCard(q)); }); P.sheet("Быстрые ответы", b); }),
      tapRow("book", "База знаний бота", "", function () { api().kb().then(function (k) { var b = h("div", ""); k.rows.forEach(function (r) { b.appendChild(h("div", "kv2", [h("span", "", r[0]), h("span", "", r[1])])); }); P.sheet("База знаний бота", b); }); }),
      tapRow(pf.svc[0], pf.svc[1], pf.svc[2], function () { api().kb().then(function (k) { var b = h("div", ""); k.services.forEach(function (r) { b.appendChild(h("div", "kv2", [h("span", "", r[0]), h("span", "", r[1])])); }); b.appendChild(h("div", "note", pf.staff + ": " + k.masters)); P.sheet("Мастера и услуги", b); }); }),
      tapRow("clock", "График работы", pf.hours, function () { P.notice("График работы", pf.hoursText); })
    ]));
    kids.push(h("div", "grp", [
      tapRow("link", "Подключения", pf.connVal, function () { var b = h("div", ""); pf.conn.forEach(function (r) { b.appendChild(h("div", "kv2", [h("span", "", r[0]), h("span", "", r[1])])); }); P.sheet("Подключения", b); }),
      tapRow("users", "Команда и роли", String(pf.team.length), function () { var b = h("div", ""); pf.team.forEach(function (r) { b.appendChild(h("div", "kv2", [h("span", "", r[0]), h("span", "", r[1])])); }); P.sheet("Команда и роли", b); })
    ]));
    if (pf.web) kids.push(h("div", "grp", [linkRow("chats", "Написать боту на сайте", "", pf.web, true)]));
  } else {
    var g1 = [linkRow("rec", "Все заявки", "", ext("/leads")), linkRow("bc", "Рассылки", "", ext("/broadcast")), linkRow("chats", "Бот на сайте", "", "/?c=" + P.enc(S.C), true)];
    if (S.owner) { g1.push(linkRow("shield", "Проверка запуска", "", ext("/launch"))); g1.push(linkRow("users", "Боты и сотрудники", "", "/studio")); }
    kids.push(h("div", "grp", g1)); kids.push(h("div", "grp", [linkRow("out", "Выйти", "", "/logout")]));
  }
  // программа для Windows: свои уведомления и значок у часов. В самой программе этот пункт не нужен
  if (!window.__TAURI__) kids.push(h("div", "grp", [linkRow("link", "Программа для Windows", "", "https://github.com/aztenel/ai-admin/releases", true)]));
  sc.appendChild(stack(kids));
}
window.__views = { summary: summary, broadcast: broadcast, more: more };
})();
