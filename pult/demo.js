/* Демо пульта: вымышленный барбершоп, всё живёт в браузере и никуда не отправляется. Цены и мастера — как у демо-бота «Демо Барбер» (/?c=barber). */
window.__DEMO = true;
window.__QUICK = [
  "Здравствуйте! Чем могу помочь?",
  "Подскажите, пожалуйста, ваше имя и телефон.",
  "Адрес: Астана, ул. Примерная, 40, 1 этаж, отдельный вход. Есть парковка.",
  "Оплата — Kaspi или наличными. Ждём вас!",
  "Спасибо за обращение! Перезвоню вам в течение 10 минут."
];
(function () {
  var MIN = 60000, now = Date.now();
  function ago(m) { return now - m * MIN; }
  var ADMIN = "Асель · администратор";
  var STAGES = ["Новый", "В работе", "Записан", "Оплатил", "Потерян"];
  var NB = " ";
  function u(m, x) { return { r: "u", x: x, t: ago(m) }; }
  function b(m, x) { return { r: "b", x: x, t: ago(m) }; }
  function a(m, x) { return { r: "a", x: x, t: ago(m), by: ADMIN }; }
  function s(m, x) { return { r: "s", x: x, t: ago(m) }; }
  function k(m, title, l1, l2) { return { r: "k", x: title, l1: l1, l2: l2, t: ago(m) }; }
  function card(stage, sum, next, o) { o = o || {}; return { stage: stage, sum: sum, next: next || "", visits: o.visits || 0, last: o.last || "ещё не был", master: o.master || "не выбран", src: o.src || "WhatsApp", since: o.since || "", tags: o.tags || [], note: o.note || "" }; }
  var chats = [
    { ch: "wa", id: "demo-01", nm: "Айдос Акберов", ph: "+7 705 ••• •• 01", nd: "human", needAt: ago(4), un: 2, reply: "Тогда на 19:00 к Арману, пожалуйста.",
      turns: [u(26, "Здравствуйте, сколько стоит стрижка с бородой?"), b(26, "Стрижка + борода — от 9 000 ₸, около 1,5 часа. У Армана на 20% дороже (10 800 ₸). Записать вас?"), u(22, "К Арману можно сегодня после 18:00?"), b(22, "Сегодня у Армана свободно 19:00 и 20:30. Какое время выбираете?"), u(4, "Мне нужен человек, это срочно"), s(4, "Бот передал чат администратору · этап: Новый → В работе")],
      card: card("В работе", 10800, "ответить сейчас", { master: "Арман", tags: ["Вечер"], note: "Просит только вечер после 18:00. Новый клиент, пришёл по рекомендации.", since: "сегодня" }), what: "Стрижка + борода, сегодня после 18:00", flag: "Просит человека" },
    { ch: "wa", id: "demo-02", nm: "Мадина Темирова", ph: "+7 705 ••• •• 02", nd: "human", why: "Спор о цене", needAt: ago(18), un: 1, reply: "Хорошо, запишите на субботу к Даурену.",
      turns: [u(31, "Добрый день! Сколько стоит детская стрижка?"), b(31, "Детская стрижка (до 12 лет) — от 4 000 ₸, около 40 минут. Записать?"), u(18, "Почему так дорого? У других дешевле")],
      card: card("В работе", 4000, "напомнить в 17:00", { tags: ["С сыном"], note: "Сомневается в цене. Можно предложить запись к Даурену." }), what: "Детская стрижка, сомневается в цене", flag: "Спор о цене" },
    { ch: "wa", id: "demo-03", nm: "Данияр С.", ph: "+7 705 ••• •• 03", nd: "req", un: 1, bookings: ["пт 9 окт, 17:00 · Стрижка · Ерлан"], reply: "Спасибо, жду подтверждения.",
      reqs: [{ id: "L1", kind: "change", name: "Данияр С.", service: "Стрижка → сб 10 окт, 15:00", time: "пт 9 окт, 17:00", note: "" }],
      turns: [b(300, "Записала вас на пятницу, 17:00, к Ерлану. Ждём вас!"), u(55, "Здравствуйте, можно перенести запись на субботу?"), b(55, "Передала просьбу администратору — он свяжется с вами и подтвердит перенос.")],
      card: card("Записан", 6000, "подтвердить перенос", { visits: 4, last: "3 недели назад", master: "Ерлан", tags: ["Постоянный"] }), what: "Перенос записи с пятницы на субботу", flag: "Ждёт администратора" },
    { ch: "wa", id: "demo-04", nm: "Ерлан Касымов", ph: "+7 705 ••• •• 04", reply: "Спасибо!",
      turns: [u(100, "Здравствуйте, на сегодня есть что-нибудь?"), b(99, "Сегодня свободно 18:30 и 20:00. Какое подойдёт?"), u(95, "18:30"), a(92, "Записал вас на 18:30, до встречи!")],
      card: card("Записан", 6000, "визит сегодня 18:30", { visits: 9, last: "месяц назад", master: "Ерлан", tags: ["Постоянный"] }), what: "Стрижка, сегодня 18:30", flag: "" },
    { ch: "wa", id: "demo-05", nm: "Нурлан Б.", ph: "+7 705 ••• •• 05", bookings: ["завтра, 17:30 · Стрижка + борода · Арман"], reply: "Спасибо!",
      turns: [u(130, "Хочу записаться на завтра к Арману, стрижка и борода"), b(130, "Свободно завтра в 17:30. Записать?"), u(128, "Да, пожалуйста"), b(128, "Записала вас на завтра, 17:30, к Арману. Ждём вас!"), k(128, "Запись создана", "Стрижка + борода · Арман", "завтра, 17:30 · 10 800 ₸")],
      card: card("Записан", 10800, "визит завтра 17:30", { visits: 2, last: "2 месяца назад", master: "Арман" }), what: "Стрижка + борода, завтра 17:30", flag: "" },
    { ch: "wa", id: "demo-06", nm: "Санжар Ж.", ph: "+7 705 ••• •• 06", reply: "Понял, подумаю.",
      turns: [u(190, "Сколько стоит королевское бритьё?"), b(190, "Королевское бритьё опасной бритвой — от 6 000 ₸, около часа. Записать вас?")],
      card: card("Новый", 6000, "ждёт ответа клиента", {}), what: "Королевское бритьё", flag: "" },
    { ch: "wa", id: "demo-07", nm: "Тимур К.", ph: "+7 705 ••• •• 07", bookings: ["сегодня, 15:00 · Стрижка · Даурен"], reply: "До встречи!",
      turns: [u(260, "Могу сегодня в 15:00?"), b(259, "Да, 15:00 свободно у Даурена. Записала вас!"), u(250, "Спасибо, буду в 15:00")],
      card: card("Оплатил", 6000, "", { visits: 6, last: "сегодня", master: "Даурен", tags: ["Постоянный", "Утро"] }), what: "Стрижка, сегодня 15:00", flag: "" },
    { ch: "wa", id: "demo-08", nm: "Алибек Н.", ph: "+7 705 ••• •• 08", pu: now + 105 * MIN, reply: "Подойдёт, буду в 16:30.",
      turns: [u(70, "Хочу камуфляж седины, сколько?"), b(70, "Камуфляж седины — от 5 000 ₸, около 40 минут. На какой день записать?"), u(66, "А можно сегодня?"), a(62, "Здравствуйте, Алибек! Сегодня есть 16:30 у Даурена. Подойдёт?")],
      card: card("В работе", 5000, "ждём ответ клиента", { master: "Даурен" }), what: "Камуфляж седины, сегодня", flag: "" },
    { ch: "web", id: "webdemo0001", nm: "", ph: "+7 701 ••• •• 12", nd: "lead", needAt: ago(40), un: 1, canSend: false,
      reqs: [{ id: "L2", kind: "lead", name: "Рустем", service: "Стрижка", time: "сегодня вечером", note: "" }],
      turns: [u(46, "Есть запись на сегодня вечером?"), b(46, "Сегодня вечером свободно 19:00 и 20:30. Оставьте имя и телефон — запишу."), u(41, "Рустем, 8 701 999 00 12"), b(40, "Спасибо, Рустем! Передала заявку администратору — он подтвердит запись.")],
      card: card("Новый", 6000, "позвонить и подтвердить", { src: "Сайт" }), what: "Стрижка, сегодня вечером", flag: "Новая заявка" },
    { ch: "wa", id: "demo-10", nm: "Ержан А.", ph: "+7 705 ••• •• 10", reply: "Хорошо.",
      turns: [u(1500, "Нужна ли предоплата?"), b(1500, "Предоплата не нужна: оплата на месте, Kaspi или наличными.")],
      card: card("Новый", 0, "", {}), what: "Вопрос про предоплату", flag: "" },
    { ch: "wa", id: "demo-11", nm: "Дастан Л.", ph: "+7 705 ••• •• 11",
      turns: [u(2900, "Сколько стоит стрижка машинкой?"), b(2900, "Стрижка машинкой — от 4 000 ₸, около 30 минут. Записать?")],
      card: card("Потерян", 4000, "", { note: "Не ответил после цены." }), what: "Стрижка машинкой", flag: "" },
    { ch: "wa", id: "demo-12", nm: "Айбек М.", ph: "+7 705 ••• •• 12",
      turns: [u(3000, "Есть окно на выходные?"), b(3000, "В субботу свободно 11:00 и 15:30. Какое подходит?")],
      card: card("Потерян", 6000, "", { note: "Не ответил на предложение времени." }), what: "Окно на выходные", flag: "" }
  ];
  function find(ch, id) { for (var i = 0; i < chats.length; i++) if (chats[i].ch === ch && chats[i].id === id) return chats[i]; return null; }
  function lastMsg(c) { for (var i = c.turns.length - 1; i >= 0; i--) if (/^[uba]$/.test(c.turns[i].r)) return c.turns[i]; return c.turns[c.turns.length - 1]; }
  function nextStage(c) { var i = STAGES.indexOf(c.card.stage); return i >= 0 && i < 3 ? STAGES[i + 1] : null; }
  function facts(c) {
    var d = c.card;
    return [["Этап", d.stage], ["Сумма", d.sum ? String(d.sum).replace(/\B(?=(\d{3})+(?!\d))/g, NB) + NB + "₸" : "—"], ["Что дальше", d.next || "—"], ["Последний визит", d.last], ["Визитов", String(d.visits)], ["Мастер", d.master], ["Источник", d.src]];
  }
  function row(c) {
    var m = lastMsg(c);
    return { ch: c.ch, id: c.id, t: m.t, li: m.t, s: m.x.replace(/\s+/g, " ").slice(0, 120), d: m.r, nm: c.nm, ph: c.ph, nd: c.nd || "", why: c.why || "", pu: c.pu > Date.now() ? c.pu : 0, st: 0, bk: (c.bookings || []).length ? 1 : 0, un: c.un || 0 };
  }
  function view(c) {
    var open = c.ch !== "web", ps = c.pu > Date.now() ? c.pu : 0;
    return { ch: c.ch, id: c.id, phone: c.ph, name: c.nm, waName: "", turns: c.turns.map(function (t) { return { r: t.r, x: t.x, t: t.t, by: t.by, l1: t.l1, l2: t.l2 }; }), bookings: (c.bookings || []).slice(), pend: [], booked: "",
      need: c.nd ? { why: c.nd, text: "", label: c.why || "", at: c.needAt || 0 } : null, paused: ps, stop: false, off: false, canSend: c.canSend !== false && open, open: open, li: lastMsg(c).t, reqs: (c.reqs || []).slice(), promo: null, now: Date.now(),
      card: { facts: facts(c), tags: c.card.tags.slice(), note: c.card.note, since: c.card.since, next: nextStage(c) } };
  }
  function ok(v) { return Promise.resolve(v); }
  var broadcastRunning = true;
  window.__DEMO_API = {
    me: function () { return ok({ owner: true, c: "demo" }); },
    clients: function () { return ok({ clients: [{ id: "demo", name: "Барбершоп", kind: "барбершоп" }] }); },
    list: function (f, ch) {
      var rows = chats.filter(function (c) { return (ch === "web") === (c.ch === "web"); }).map(row).sort(function (x, y) { return y.t - x.t; });
      var need = chats.filter(function (c) { return c.nd; }).length;
      return ok({ client: { id: "demo", name: "Барбершоп", off: false }, need: need, total: rows.length, chats: f === "need" ? rows.filter(function (r) { return r.nd; }) : rows, now: Date.now() });
    },
    chat: function (ch, id) { var c = find(ch, id); if (!c) return ok({ error: "Чат не найден." }); c.un = 0; return ok(view(c)); },
    send: function (ch, id, text) {
      var c = find(ch, id); if (!c) return ok({ error: "Чат не найден." });
      if (c.ch === "web") return ok({ error: "В чат на сайте ответить нельзя — позвоните клиенту." });
      c.turns.push({ r: "a", x: text, t: Date.now(), by: ADMIN }); c.pu = Date.now() + 120 * MIN; delete c.nd; delete c.why;
      if (c.reply) { var reply = c.reply; setTimeout(function () { c.turns.push({ r: "u", x: reply, t: Date.now() }); c.un = (c.un || 0) + 1; c.nd = "human"; c.needAt = Date.now(); c.why = ""; }, 6000); }
      return ok({ ok: true, chat: view(c) });
    },
    act: function (ch, id, act, x) {
      var c = find(ch, id); if (!c) return ok({ error: "Чат не найден." });
      if (act === "resolve") { if ((c.reqs || []).length) return ok({ error: "В чате есть невыполненная просьба клиента (отмена, перенос, заявка или звонок). Нажмите «Сделано» в карточке — тогда чат закроется сам." }); delete c.nd; delete c.why; }
      else if (act === "pause") c.pu = Date.now() + 12 * 60 * MIN;
      else if (act === "resume") { delete c.pu; delete c.nd; delete c.why; }
      else if (act === "done") {
        c.reqs = (c.reqs || []).filter(function (q) { return q.id !== x.lead; });
        if (x.text) c.turns.push({ r: "a", x: x.text, t: Date.now(), by: ADMIN });
        if (!c.reqs.length) { delete c.nd; delete c.why; }
        if (c.id === "demo-03") { c.bookings = ["сб 10 окт, 15:00 · Стрижка · Ерлан"]; c.card.stage = "Записан"; c.card.next = "визит в субботу"; }
        if (c.ch === "web") { c.card.stage = "Записан"; c.card.next = "визит сегодня вечером"; }
      }
      return ok({ ok: true, chat: view(c) });
    },
    stageNext: function (id) { var c = find("wa", id) || find("web", id) || chats.filter(function (z) { return z.id === id; })[0]; var n = nextStage(c); if (n) { c.card.stage = n; c.card.next = n === "Записан" ? "ждём визит" : n === "Оплатил" ? "" : "ответить клиенту"; } return ok({ stage: c.card.stage }); },
    tagToggle: function (id, t) { var c = chats.filter(function (z) { return z.id === id; })[0], i = c.card.tags.indexOf(t); if (i >= 0) c.card.tags.splice(i, 1); else c.card.tags.push(t); return ok({}); },
    leads: function () {
      var L = chats.filter(function (c) { return c.card.stage; }).map(function (c) { return { id: c.id, ch: c.ch, name: c.nm || (c.reqs && c.reqs[0] && c.reqs[0].name) || "Гость сайта", sum: c.card.sum, what: c.what || "", flag: c.nd ? (c.why || ({ human: "Просит человека", req: "Ждёт администратора", lead: "Новая заявка" }[c.nd])) : "", next: c.card.next, stage: c.card.stage, t: lastMsg(c).t, hot: c.nd ? 1 : 0 }; });
      L.sort(function (x, y) { return y.hot - x.hot || y.t - x.t; });
      var stages = STAGES.map(function (n) { var z = L.filter(function (l) { return l.stage === n; }); return { name: n, n: z.length, sum: z.reduce(function (p, l) { return p + l.sum; }, 0) }; });
      return ok({ stages: stages, leads: L, tasks: [{ time: "17:00", text: "Напомнить Мадине про детскую стрижку" }, { time: "18:30", text: "Запись: Ерлан К., стрижка" }] });
    },
    newLead: function (o) { var id = "demo-" + (50 + chats.length); chats.push({ ch: "wa", id: id, nm: o.name, ph: "+7 7•• ••• •• ••", turns: [{ r: "u", x: o.what || "Хочу записаться", t: Date.now() }], card: card("Новый", 0, "ответить клиенту", {}), what: o.what || "Запись", un: 1 }); return ok({}); },
    summary: function (per) {
      var need = chats.filter(function (c) { return c.nd; }).length, req = chats.filter(function (c) { return c.reqs && c.reqs.length; }).length;
      var D = {
        day: { label: "за день", money: "≈32" + NB + "400" + NB + "₸", delta: "+6" + NB + "000" + NB + "₸ ко вчера", bars: [20, 40, 35, 55, 70, 90, 60], tiles: [["3", "Записей"], ["6" + NB + "сек", "Время ответа"], ["0", "Без ответа"]], funnel: [["Обратились", "5", 100], ["Записались", "3", 60], ["Пришли", "1", 20], ["Потеряны", "0", 0, true]] },
        week: { label: "за неделю", money: "≈168" + NB + "000" + NB + "₸", delta: "+42" + NB + "000" + NB + "₸ к прошлой неделе", bars: [35, 55, 45, 70, 60, 100, 80], tiles: [["14", "Записей"], ["7" + NB + "сек", "Время ответа"], ["0", "Без ответа"]], funnel: [["Обратились", "24", 100], ["Записались", "14", 58], ["Оплатили или пришли", "6", 25], ["Потеряны", "2", 8, true]] },
        month: { label: "за месяц", money: "≈612" + NB + "000" + NB + "₸", delta: "+96" + NB + "000" + NB + "₸ к прошлому месяцу", bars: [50, 62, 58, 75, 70, 92, 100], tiles: [["58", "Записей"], ["8" + NB + "сек", "Время ответа"], ["2", "Без ответа"]], funnel: [["Обратились", "96", 100], ["Записались", "58", 60], ["Оплатили или пришли", "41", 43], ["Потеряны", "9", 9, true]] }
      }[per] || null;
      D.attn = [["Ждут ответа человека", String(need), true, "need"], ["Просьбы об отмене и переносе", String(req), false, "need"], ["Клиенты 45+ дней без визита", "37", false, null]];
      return ok(D);
    },
    broadcasts: function () {
      return ok({ running: broadcastRunning, sent: 34, limit: 50, guards: ["Слово «стоп» от клиента: больше ему не пишем", "Автопауза, если растут ошибки отправки", "Не пишем тем, кто отказался от рассылок (12 человек)"],
        items: [{ name: "Вернуть тех, кто не был 45+ дней", status: "Идёт · 34 из 50 сегодня", statusCls: "ok", sub: "Ответили 6 · записались 3", icon: "bc", color: "#1E8549" },
                { name: "Акция выходного дня", status: "Черновик", statusCls: "mut", sub: "Список: 120 клиентов · ещё не запущена", icon: "chats", color: "#5B6670" },
                { name: "Напоминание за 2 часа до записи", status: "Работает само", statusCls: "ok", sub: "Сегодня отправлено 11", icon: "clock", color: "#2F6FD6" }] });
    },
    broadcastToggle: function () { broadcastRunning = !broadcastRunning; return ok({}); },
    kb: function () {
      return ok({ rows: [["Адрес", "Астана, ул. Примерная, 40"], ["Телефон", "+7 700 ••• •• 40"], ["Часы", "ежедневно 10:00–22:00"], ["Оплата", "Kaspi, наличные"], ["Парковка", "есть"], ["Акции", "сейчас нет"]],
        services: [["Мужская стрижка", "от 6 000 ₸"], ["Стрижка машинкой", "от 4 000 ₸"], ["Детская стрижка (до 12 лет)", "от 4 000 ₸"], ["Оформление бороды", "от 4 000 ₸"], ["Стрижка + борода", "от 9 000 ₸"], ["Королевское бритьё", "от 6 000 ₸"], ["Камуфляж седины", "от 5 000 ₸"], ["Укладка", "от 2 000 ₸"]],
        masters: "Арман (топ-барбер, цены на 20% выше), Ерлан, Даурен." });
    }
  };
})();
