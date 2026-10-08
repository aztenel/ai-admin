/* Вкладки «Лиды», «Сводка», «Рассылки», «Ещё». В демо — на вымышленных данных; в рабочем режиме — то, что есть в боте, и ссылки на готовые страницы. */
(function () {
"use strict";
var P = window.__pult, S = P.S, h = P.h, ic = P.ic, clear = P.clear, DEMO = P.DEMO, NB = P.NB;
var $ = function (id) { return document.getElementById(id); };
function api() { return P.API(); }
function scrollBox(el, kids, nonav) { var s = h("div", "scroll" + (nonav ? " nonav" : ""), kids); el.appendChild(s); return s; }
function stack(kids) { return h("div", "pad stack", kids); }
function ext(path) { return path + "?c=" + P.enc(S.C); }
function linkRow(icon, text, sub, href, blank) { var a = h("a", "li tap", [ic(icon, 24), h("span", "t", [text, sub ? h("small", "", sub) : null]), ic("chevr", 16)], { href: href, target: blank ? "_blank" : null, rel: blank ? "noopener" : null }); return a; }
function tapRow(icon, text, val, fn) { var b = h("button", "li tap", [ic(icon, 24), h("span", "t", text), val ? h("span", "v", val) : null, ic("chevr", 16)], { type: "button" }); b.onclick = fn; return b; }
function tag(text, cls) { return h("span", "tag" + (cls ? " " + cls : ""), text); }
function mount(id) { return clear($("v-" + id)); }

/* ---------- Лиды ---------- */
function leads() {
  var v = mount("leads");
  v.appendChild(P.headerEl(DEMO ? [P.ibtn("plus", "Новый лид", newLead, true)] : []));
  if (!DEMO) { liveLeads(v); return; }
  api().leads().then(function (d) {
    clear(v); v.appendChild(P.headerEl([P.ibtn("plus", "Новый лид", newLead, true)]));
    var total = d.leads.length, sum = d.leads.reduce(function (a, l) { return a + (l.sum || 0); }, 0);
    v.appendChild(P.titleEl("Лиды", total + " за неделю · ≈" + Math.round(sum / 1000) + NB + "тыс." + NB + "₸"));
    var st = h("div", "stages");
    d.stages.forEach(function (s) { var b = h("button", "stg" + (S.stage === s.name ? " on" : ""), [h("span", "k", s.name), h("span", "v", s.n), h("span", "s", s.sum ? Math.round(s.sum / 1000) + NB + "тыс." + NB + "₸" : "—")], { type: "button" }); b.onclick = function () { S.stage = S.stage === s.name ? "" : s.name; leads(); }; st.appendChild(b); });
    v.appendChild(st);
    var sc = h("div", "scroll"); v.appendChild(sc);
    var list = d.leads.filter(function (l) { return !S.stage || l.stage === S.stage; });
    if (!list.length) sc.appendChild(h("div", "empty", [h("span", "ic", ic("leads", 26)), h("b", "", "В этом этапе пока пусто")]));
    list.forEach(function (l) {
      var a = h("a", "row", [h("span", "av", P.initials(l.name), { style: "--c:" + P.colorOf(l.id) }), h("div", "rb", [
        h("div", "r1", [h("span", "nm", l.name), h("span", "amt", l.sum ? P.money(l.sum) : "")]), h("span", "pv", l.what),
        h("div", "r3", [l.flag ? tag(l.flag) : h("span"), h("span", "nx", l.next || "")])])], { href: "#" + (l.ch || "wa") + ":" + l.id });
      a.onclick = function (e) { e.preventDefault(); P.go("chats"); if (l.ch === "web") { S.f = "web"; } P.openChat(l.ch || "wa", l.id); }; sc.appendChild(a);
    });
    if (d.tasks && d.tasks.length) sc.appendChild(stack([h("div", "card", [h("div", "h3", "На сегодня", { style: "margin-bottom:2px" })].concat(d.tasks.map(function (t) { return h("div", "task", [h("span", "tt", t.time), h("span", "tx", t.text)]); })), { style: "padding:14px 16px 4px" })]));
  });
}
function liveLeads(v) {
  v.appendChild(P.titleEl("Заявки", ""));
  var sc = h("div", "scroll"); v.appendChild(sc);
  sc.appendChild(h("div", "empty", [h("span", "ic", ic("leads", 26)), h("b", "", "Загружаю…")]));
  api().leads().then(function (d) {
    clear(sc); if (d.error) { sc.appendChild(h("div", "empty", [h("b", "", "Не получилось загрузить"), h("span", "", d.error)])); return; }
    $("v-leads").querySelector(".meta").textContent = d.leads.length ? d.leads.length + " последних" : "";
    if (!d.leads.length) { sc.appendChild(h("div", "empty", [h("span", "ic", ic("leads", 26)), h("b", "", "Заявок пока нет"), h("span", "", "Они появятся, когда клиент оставит заявку или попросит перенести запись.")])); }
    d.leads.forEach(function (l) {
      var T = { cancel: "Просит отменить", change: "Просит перенести", callback: "Ждёт звонка", lead: "Заявка" }[l.kind || "lead"] || "Заявка";
      var wa = /^WhatsApp/.test(l.source || "") && l.phone, id = String(l.phone || "").replace(/\D/g, "");
      var a = h("a", "row", [h("span", "av", P.initials(l.name, l.phone), { style: "--c:" + P.colorOf(l.phone || l.id) }), h("div", "rb", [
        h("div", "r1", [h("span", "nm", l.name || "Имя не указано"), h("span", "tm2", l.ts ? P.rowTime(l.ts) : "")]), h("span", "pv", [l.service, l.time].filter(Boolean).join(" · ")),
        h("div", "r3", [l.status ? tag(l.status, "mut") : tag(T), h("span", "nx", l.phone || "без телефона")])])], { href: wa ? "#wa:" + id : P.tel(l.phone || "") });
      if (wa) a.onclick = function (e) { e.preventDefault(); P.go("chats"); P.openChat("wa", id); };
      sc.appendChild(a);
    });
    sc.appendChild(stack([linkRow("rec", "Все заявки в старом виде", "страница /leads", ext("/leads"))]));
  }).catch(function (e) { if (e !== 0) { clear(sc); sc.appendChild(h("div", "empty", [h("b", "", "Нет связи"), h("span", "", "Попробуйте ещё раз позже.")])); } });
}
function newLead() {
  if (!DEMO) return;
  var name = h("input", "", "", { type: "text", placeholder: "Имя", "aria-label": "Имя", style: "width:100%;height:48px;border-radius:14px;background:var(--bg);border:1px solid var(--line);padding:0 14px;font-size:16px;color:var(--fg);outline:0" });
  var what = h("input", "", "", { type: "text", placeholder: "Что хочет: например, стрижка завтра в 18:00", "aria-label": "Запрос", style: "width:100%;height:48px;border-radius:14px;background:var(--bg);border:1px solid var(--line);padding:0 14px;font-size:16px;color:var(--fg);outline:0" });
  var ok = h("button", "btn pri", "Добавить лид", { type: "button", style: "width:calc(100% - 32px);margin:12px 16px 0" });
  ok.onclick = function () { if (!name.value.trim()) { name.focus(); return; } api().newLead({ name: name.value.trim(), what: what.value.trim() }).then(function () { P.closeSheet(); P.toast("Лид добавлен в «Новый»"); if (S.v === "leads") leads(); else P.loadList(); }); };
  P.sheet("Новый лид", h("div", "", [name, what], { style: "display:flex;flex-direction:column;gap:10px;padding:0 16px" }), ok);
}

/* ---------- Сводка ---------- */
function summary() {
  var v = mount("summary");
  v.appendChild(P.headerEl([]));
  v.appendChild(P.titleEl("Сводка", DEMO ? "демо-данные" : ""));
  var sc = h("div", "scroll");
  if (!DEMO) {
    v.appendChild(sc);
    var box = stack([]); sc.appendChild(box);
    api().list("all", "wa").then(function (d) {
      if (d.error) { box.appendChild(h("div", "empty", [h("b", "", "Не получилось загрузить"), h("span", "", d.error)])); return; }
      var rows = d.chats || [], need = rows.filter(function (r) { return r.nd; }).length, paused = rows.filter(function (r) { return r.pu; }).length, bk = rows.filter(function (r) { return r.bk; }).length;
      box.appendChild(h("div", "tiles", [tile(rows.length, "Чатов"), tile(need, "Ждут ответа"), tile(bk, "С записью")]));
      var g = h("div", "grp"); [["Ждут ответа человека", need, need > 0, function () { S.f = "need"; S.ready = false; P.go("chats"); P.loadList(); }], ["Бот молчит (вы взяли чат)", paused, false, function () { S.f = "pause"; S.ready = false; P.go("chats"); P.loadList(); }]].forEach(function (a) { var b = h("button", "att", [h("span", "a", a[0]), h("span", "cnt" + (a[2] ? " hot" : ""), a[1])], { type: "button", style: "width:100%;text-align:left" }); b.onclick = a[3]; g.appendChild(b); }); box.appendChild(g);
      box.appendChild(h("div", "card", [h("span", "cap", "Выручка и воронка"), h("span", "", "В рабочем режиме пока не считаются: для этого пульт должен получать записи и оплаты. Сейчас здесь — сколько чатов и сколько из них ждут вас.", { style: "font-size:14px;line-height:1.45;color:var(--fg2)" })], { style: "padding:16px;display:flex;flex-direction:column;gap:6px" }));
    }).catch(function (e) { if (e !== 0) box.appendChild(h("div", "empty", [h("b", "", "Нет связи")])); });
    return;
  }
  var pr = h("div", "chips"); [["day", "Сегодня"], ["week", "Неделя"], ["month", "Месяц"]].forEach(function (p) { var b = h("button", "chip" + (S.per === p[0] ? " on" : ""), p[1], { type: "button" }); b.onclick = function () { S.per = p[0]; summary(); }; pr.appendChild(b); }); v.appendChild(pr); v.appendChild(sc);
  api().summary(S.per).then(function (d) {
    var bars = h("div", "spark", d.bars.map(function (x, i) { return h("i", i >= d.bars.length - 2 ? "on" : "", "", { style: "height:" + x + "%" }); }), { "aria-hidden": "true" });
    var funnel = h("div", "card", [h("span", "h3", "Воронка · " + d.label)].concat(d.funnel.map(function (f) { return h("div", "", [h("div", "", [h("span", "", f[0]), h("span", "", f[1], { style: "font-weight:600" })], { style: "display:flex;justify-content:space-between;font-size:15px" }), h("div", "bar", h("i", "", "", { style: "width:" + f[2] + "%;background:" + (f[3] ? "var(--red)" : f[2] === 100 ? "var(--fg2)" : "var(--acbg)") }))], { style: "display:flex;flex-direction:column;gap:6px" }); })), { style: "padding:16px;display:flex;flex-direction:column;gap:12px" });
    var att = h("div", "grp"); d.attn.forEach(function (a) { var b = h("button", "att", [h("span", "a", a[0]), h("span", "cnt" + (a[2] ? " hot" : ""), a[1])], { type: "button", style: "width:100%;text-align:left" }); b.onclick = function () { if (a[3]) { S.f = a[3]; S.ready = false; P.go("chats"); P.loadList(); } }; att.appendChild(b); });
    sc.appendChild(stack([h("div", "card hero", [h("span", "cap", "Выручка по записям из чатов"), h("div", "big", d.money), h("span", "dl", d.delta), bars, h("span", "", "по прайсу услуг, не из кассы", { style: "font-size:12px;color:var(--fg2);margin-top:4px" })]),
      h("div", "tiles", d.tiles.map(function (t) { return tile(t[0], t[1]); })), funnel, att]));
  });
}
function tile(v, k) { return h("div", "tile", [h("span", "v", v), h("span", "k", k)]); }

/* ---------- Рассылки ---------- */
function broadcast() {
  var v = mount("broadcast");
  v.appendChild(P.headerEl(DEMO ? [P.ibtn("plus", "Новая рассылка", function () { P.notice("Новая рассылка", "В демо рассылки не отправляются. В рабочем режиме: пишете текст (через Green-API) или выбираете одобренный Meta шаблон, вставляете список клиентов — бот отправляет понемногу в рабочие часы."); }, true)] : []));
  v.appendChild(P.titleEl("Рассылки", DEMO ? "небольшими порциями" : ""));
  var sc = h("div", "scroll"); v.appendChild(sc);
  if (!DEMO) {
    sc.appendChild(stack([
      h("div", "card", [h("span", "h3", "Рассылки клиентам"), h("span", "", "Через Meta — по одобренным шаблонам, через Green-API — обычным текстом, по одному сообщению с паузой. Отправляет бот сам, в рабочие часы. Тем, кто написал «стоп», не пишем.", { style: "font-size:14px;line-height:1.45;color:var(--fg2)" }), h("a", "btn pri", "Открыть рассылки", { href: ext("/broadcast"), style: "margin-top:4px" })], { style: "padding:16px;display:flex;flex-direction:column;gap:10px" })
    ])); return;
  }
  api().broadcasts().then(function (d) {
    var run = d.running;
    var top = h("div", "card", [
      h("div", "", [h("span", "cap", "Отправлено сегодня"), tag(run ? "Идёт" : "На паузе", run ? "ok" : "mut")], { style: "display:flex;justify-content:space-between;align-items:baseline" }),
      h("div", "", [h("span", "big xl", d.sent), h("span", "", "из " + d.limit + " в день", { style: "font-size:16px;color:var(--fg2)" })], { style: "display:flex;align-items:baseline;gap:6px" }),
      h("div", "bar", h("i", "", "", { style: "width:" + Math.round(d.sent / d.limit * 100) + "%" })),
      h("span", "", "Отправка с 10:00 до 20:00, между сообщениями пауза 30–150 секунд", { style: "font-size:13px;color:var(--fg2);line-height:1.4" }),
      h("div", "", [(function () { var b = h("button", "btn sec", run ? "Пауза" : "Продолжить", { type: "button", style: "flex:1" }); b.onclick = function () { api().broadcastToggle().then(broadcast); }; return b; })(), (function () { var b = h("button", "btn sec", "Лимит и часы", { type: "button", style: "flex:1" }); b.onclick = function () { P.notice("Лимит и часы", "Лимит " + d.limit + " сообщений в сутки и часы отправки 10:00–20:00 защищают номер от блокировки. В рабочем режиме их задаёт администратор."); }; return b; })()], { style: "display:flex;gap:10px;margin-top:2px" })
    ], { style: "padding:16px;display:flex;flex-direction:column;gap:10px" });
    var g = h("div", "grp"); d.items.forEach(function (it) { g.appendChild(h("div", "li", [h("span", "av sm", ic(it.icon, 24), { style: "--c:" + it.color + ";width:48px;height:48px" }), h("div", "", [h("span", "nm", it.name, { style: "font-size:16px;white-space:normal" }), tag(it.status, it.statusCls), h("span", "nx", it.sub, { style: "white-space:normal" })], { style: "flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;padding:10px 0" })])); });
    var guard = h("div", "card", [h("span", "h3", "Защита номера")].concat(d.guards.map(function (t) { return h("div", "", [h("span", "", ic("check", 20), { style: "color:var(--ac);margin-top:1px" }), h("span", "", t, { style: "font-size:14px;line-height:1.4" })], { style: "display:flex;gap:10px;align-items:flex-start" }); }), [h("span", "", "Гарантии от блокировки номера нет, поэтому лимит держим малым.", { style: "font-size:12px;color:var(--fg2);line-height:1.4" })]), { style: "padding:16px;display:flex;flex-direction:column;gap:10px" });
    sc.appendChild(stack([top, g, guard]));
  });
}

/* ---------- Ещё ---------- */
function more() {
  var v = mount("more");
  v.appendChild(h("div", "ttl", h("h1", "", "Ещё"), { style: "padding-top:calc(var(--sat) + 14px)" }));
  var sc = h("div", "scroll"); v.appendChild(sc);
  var nm = S.client.name || (DEMO ? "Барбершоп" : "Компания");
  var biz = h("div", "card", [h("span", "av", (nm[0] || "К").toUpperCase(), { style: "--c:" + (DEMO ? "#AF611C" : P.colorOf(S.C)) + ";width:60px;height:60px;font-size:24px;font-weight:600" }),
    h("div", "", [h("span", "nm", nm, { style: "font-size:19px" }), DEMO ? tag("WhatsApp подключён", "ok") : null, h("span", "nx", DEMO ? "Запись через Altegio" : S.C)], { style: "flex:1;min-width:0;display:flex;flex-direction:column;gap:2px" })], { style: "padding:14px 16px;display:flex;align-items:center;gap:14px" });
  if (S.owner || DEMO) { var cb = h("button", "ibtn", ic("chev"), { type: "button", style: "background:var(--s2)", "aria-label": "Сменить компанию" }); cb.onclick = P.bizSheet; biz.appendChild(cb); }
  var themes = h("div", "seg"); [["auto", "Авто"], ["light", "Светлая"], ["dark", "Тёмная"]].forEach(function (t) { var b = h("button", S.theme === t[0] ? "on" : "", t[1], { type: "button", style: "flex:1;height:40px;border-radius:20px;font-size:15px;font-weight:500;color:" + (S.theme === t[0] ? "var(--fg)" : "var(--fg2)") + ";background:" + (S.theme === t[0] ? "var(--bg)" : "transparent") }); b.onclick = function () { P.setTheme(t[0]); more(); }; themes.appendChild(b); });
  var kids = [biz, h("div", "", [h("span", "cap", "Тема оформления", { style: "padding:0 6px" }), themes], { style: "display:flex;flex-direction:column;gap:6px" })];
  if (DEMO) {
    kids.push(h("div", "grp", [
      tapRow("bolt", "Быстрые ответы", String((window.__QUICK || []).length), function () { var b = h("div", ""); (window.__QUICK || []).forEach(function (q) { b.appendChild(h("div", "kv2", h("span", "", q))); }); P.sheet("Быстрые ответы", b); }),
      tapRow("book", "База знаний бота", "", function () { api().kb().then(function (k) { var b = h("div", ""); b.appendChild(h("div", "note", "Из этого бот берёт цены, мастеров и график. Если здесь написано неверно, бот ответит неверно.")); k.rows.forEach(function (r) { b.appendChild(h("div", "kv2", [h("span", "", r[0]), h("span", "", r[1])])); }); P.sheet("База знаний бота", b); }); }),
      tapRow("cut", "Мастера и услуги", "3 мастера", function () { api().kb().then(function (k) { var b = h("div", ""); k.services.forEach(function (r) { b.appendChild(h("div", "kv2", [h("span", "", r[0]), h("span", "", r[1])])); }); b.appendChild(h("div", "note", "Мастера: " + k.masters)); P.sheet("Мастера и услуги", b); }); }),
      tapRow("clock", "График работы", "10:00–22:00", function () { P.notice("График работы", "Ежедневно с 10:00 до 22:00. Бот предлагает только свободные окна из расписания и не записывает вне рабочих часов."); })
    ]));
    kids.push(h("div", "grp", [
      tapRow("link", "Подключения", "3 из 3", function () { var b = h("div", ""); [["WhatsApp", "подключён"], ["Altegio (запись)", "подключено"], ["Telegram (уведомления)", "подключён"]].forEach(function (r) { b.appendChild(h("div", "kv2", [h("span", "", r[0]), h("span", "", r[1])])); }); P.sheet("Подключения", b); }),
      tapRow("users", "Команда и роли", "3", function () { var b = h("div", ""); [["Асель", "администратор"], ["Бакыт", "администратор"], ["Кайрат", "владелец"]].forEach(function (r) { b.appendChild(h("div", "kv2", [h("span", "", r[0]), h("span", "", r[1])])); }); b.appendChild(h("div", "note", "Администратор видит чаты и отвечает клиентам. Владелец видит ещё и сводку.")); P.sheet("Команда и роли", b); })
    ]));
    kids.push(h("div", "grp", [linkRow("chats", "Написать боту на сайте", "живой бот, который отвечает клиентам", "/?c=barber", true)]));
  } else {
    var g1 = [linkRow("rec", "Заявки", "", ext("/leads")), linkRow("bc", "Рассылки", "", ext("/broadcast")), linkRow("chats", "Бот на сайте", "тот, что видят клиенты", "/?c=" + P.enc(S.C), true)];
    if (S.owner) { g1.push(linkRow("shield", "Проверка запуска", "", ext("/launch"))); g1.push(linkRow("users", "Боты и сотрудники", "", "/studio")); }
    kids.push(h("div", "grp", g1)); kids.push(h("div", "grp", [linkRow("out", "Выйти", "", "/logout")]));
  }
  sc.appendChild(stack(kids));
}
window.__views = { leads: leads, summary: summary, broadcast: broadcast, more: more, newLead: newLead };
})();
