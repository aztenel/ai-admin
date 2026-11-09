// Напоминания и просьба об отзыве по журналу Altegio со второго номера (Green-API), без бота (30.10.2026, решение владельца:
// второй номер Winchester — только исходящие сообщения с 10:00 до 21:00; бот на нём выключен). Записи — все из журнала: сделанные
// администратором, с сайта, онлайн. Всё на заглушках: журнал — net.altJournal, Green-API — net.ga. Номера вымышленные (+7 700 000 0x xx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { jrPlan, jrRun } from "../../src/services/reminders/journal.js";
import { atLocal } from "../../src/services/reminders/plan.js";
import { botOff } from "../../src/services/channels/index.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";
import { SCENARIOS } from "../../src/services/reminders/templates.js";
import { autoOn, legacyOn } from "../automsg.mjs";

const W = CLIENTS.winchester, INST = { id: "7105000088", token: "ga-tok-jr" };
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token, REMIND_GA_WINCHESTER: "1" };
const TODAY = "2026-10-19", TOM = "2026-10-20", YDAY = "2026-10-18";
const at = (date, time) => atLocal(date, time);
let rid = 500;
// запись журнала, как её отдаёт Altegio. attendance: 1 — пришёл, 0 — ждём, 2 — подтвердил, -1 — не пришёл
const rec = (phone, date, time, o = {}) => ({ id: o.id || ++rid, datetime: `${date}T${time}:00+05:00`, deleted: !!o.del, attendance: o.att ?? 0,
  create_date: o.made || `${YDAY}T12:00:00+05:00`, staff: { id: 1, name: o.staff || "Тони" }, client: { id: 1, phone, name: o.name ?? "Клиент" },
  services: [{ id: 1, title: o.svc || "Мужская стрижка" }] });
const ph = i => "+7700000" + String(i).padStart(4, "0");
const dg = i => ph(i).slice(1);
const sent = () => net.ga.filter(x => x.op === "sendMessage").map(x => ({ to: x.body.chatId.replace("@c.us", ""), text: x.body.message }));
// тексты одобрены владельцем (svtpl:<клиент>, ТЗ v2.0 §4): без одобрения ничего не уходит — это проверяет service-scenarios.test.mjs
// и включил сценарии в разделе «Автоматические сообщения» (02.11.2026: по умолчанию всё выключено) — как было: накануне в 18:00, за 2 часа, отзыв
const approve = async s => { await s.kv.api.put("svtpl:winchester", JSON.stringify(Object.fromEntries(SCENARIOS.filter(x => x.auto).map(x => [x.id, { v: x.v, at: 1 }])))); await autoOn(s, legacyOn(W)); };
const kinds = (items, id) => items.filter(x => x.rec === String(id)).map(x => x.k).sort();

test("план: накануне в 18:00, за 2 часа (только с 10 до 21), отзыв после визита; удалённые, скрытые номера и неявки — без сообщений", () => {
  const now = at(TODAY, "17:00");
  const items = jrPlan(W, [
    rec(ph(201), TOM, "15:00", { id: 1 }),                                   // всё: накануне, за 2 часа, отзыв
    rec(ph(202), TOM, "11:00", { id: 2 }),                                   // за 2 часа — это 9:00, раньше 10:00: только накануне и отзыв
    rec(ph(203), TOM, "15:00", { id: 3, del: true }),                        // удалена
    rec("+7 700 XXX-X1-04", TOM, "15:00", { id: 4 }),                        // скрытый номер
    rec(ph(205), TOM, "15:00", { id: 5, att: -1 }),                          // не пришёл
    rec(ph(206), TOM, "20:00", { id: 6 }),                                   // отзыв — после 21:00, значит, на следующий день в 11:00
    rec(ph(207), TOM, "16:00", { id: 7, made: `${TODAY}T18:30:00+05:00` }), // записался после 18:00 накануне — «накануне» уже не шлём
    { id: 8, datetime: `${TOM}T13:00:00+05:00`, deleted: false, staff: { id: 1, name: "Тони" } } // перерыв мастера без клиента
  ], now);
  assert.deepEqual(kinds(items, 1), ["d1", "h2", "rv"]);
  assert.deepEqual(kinds(items, 2), ["d1", "rv"]);
  assert.deepEqual(kinds(items, 3), []); assert.deepEqual(kinds(items, 4), []); assert.deepEqual(kinds(items, 5), []); assert.deepEqual(kinds(items, 8), []);
  assert.deepEqual(kinds(items, 7), ["h2", "rv"]);
  const one = items.find(x => x.rec === "1" && x.k === "d1"), h2 = items.find(x => x.rec === "1" && x.k === "h2");
  assert.equal(one.at, at(TODAY, "18:00")); assert.equal(h2.at, at(TOM, "13:00"));
  assert.equal(items.find(x => x.rec === "1" && x.k === "rv").at, at(TOM, "18:00"), "отзыв — через 3 часа после начала");
  assert.equal(items.find(x => x.rec === "6" && x.k === "rv").at, atLocal(TOM, "11:00", 1), "после 21:00 — утром в 11:00");
  assert.equal(one.p, dg(201)); assert.equal(one.date, TOM); assert.equal(one.time, "15:00");
  assert.ok(!JSON.stringify(items).includes("XXX"), "скрытый номер не попадает в очередь");
});

test("ТЗ v4: напоминание по выбору клиента на сайте — одно, в выбранное время; «не напоминать» — без напоминаний; остальные записи как обычно", () => {
  const now = at(TODAY, "09:00"), set = { win: { from: 10, to: 21 }, cap: 150, s: {
    confirm: { on: false, t: { delay: 0 } }, remind24: { on: true, t: { mode: "24h", eve: "18:00" } }, remind3: { on: true, t: { hours: 3 } },
    move: { on: false, t: {} }, cancel: { on: false, t: {} }, review: { on: true, t: { hours: 3 } } } };
  const list = [rec(ph(301), TOM, "15:00", { id: 31 }), rec(ph(302), TOM, "15:00", { id: 32 }), rec(ph(303), TOM, "15:00", { id: 33 }),
    rec(ph(304), TOM, "15:00", { id: 34 }), rec(ph(305), TOM, "10:30", { id: 35 })];
  const site = { 32: { h: 1 }, 33: { h: 24 }, 34: { h: 0 }, 35: { h: 1 } };
  const all = jrPlan(W, list, now, set, site);
  assert.deepEqual(kinds(all, 31), ["d1", "h2", "rv"], "без выбора — обычные напоминания");
  assert.deepEqual(kinds(all, 32), ["h2", "rv"]); assert.equal(all.find(x => x.rec === "32" && x.k === "h2").at, at(TOM, "14:00"), "за 1 час");
  assert.deepEqual(kinds(all, 33), ["d1", "rv"]); assert.equal(all.find(x => x.rec === "33" && x.k === "d1").at, at(TODAY, "15:00"), "за сутки");
  assert.deepEqual(kinds(all, 34), ["rv"], "«не напоминать» — без напоминаний, отзыв остаётся");
  assert.deepEqual(kinds(all, 35), ["rv"], "визит в 10:30, за 1 час — 9:30, раньше часов отправки: не шлём");
  // сценарий выключен в пульте — по выбору клиента тоже не шлём (текст и одобрение — у сценария)
  const off = jrPlan(W, list, now, { ...set, s: { ...set.s, remind3: { on: false, t: { hours: 3 } } } }, site);
  assert.deepEqual(kinds(off, 32), ["rv"]);
});

test("ТЗ v4: выбор с сайта читается из хранилища — «за 1 час» уходит в 14:00, накануне в 18:00 не уходит", async () => {
  net.reset();
  net.altJournal = [rec(ph(311), TOM, "15:00", { id: 41, name: "Арман" })];
  const s = mk(ENV); await approve(s);
  await s.kv.api.put("sbn:winchester", JSON.stringify({ 41: { h: 1, t: at(TOM, "15:00") } }));
  await jrRun(s.env, at(TODAY, "17:59")); await jrRun(s.env, at(TODAY, "18:00")); await jrRun(s.env, at(TODAY, "18:20"));
  assert.deepEqual(sent(), [], "накануне не шлём: клиент выбрал «за 1 час»");
  await jrRun(s.env, at(TOM, "14:00"));
  assert.equal(sent().length, 1, JSON.stringify(s.kv.json("jrq:winchester")));
  assert.equal(sent()[0].to, dg(311)); assert.match(sent()[0].text, /15:00/);
});

test("бот на втором номере Winchester выключен по умолчанию, BOT_GA_WINCHESTER = 1 включает; у других компаний — как было", () => {
  assert.equal(botOff({}, W, "ga"), true);
  assert.equal(botOff({ BOT_GA_WINCHESTER: "1" }, W, "ga"), false);
  assert.equal(botOff({}, CLIENTS.barber, "ga"), !!CLIENTS.barber.gaOff);
});

test("накануне в 18:00 напоминание уходит со второго номера, один раз; в пульте — переписка с именем из Altegio", async () => {
  net.reset();
  net.altJournal = [rec(ph(211), TOM, "15:00", { id: 11, name: "Арман", staff: "Айдос", svc: "Мужская стрижка" }), rec(ph(212), TOM, "12:30", { id: 12 })];
  const s = mk(ENV); await approve(s);
  await jrRun(s.env, at(TODAY, "17:00"));
  assert.deepEqual(sent(), [], "в 17:00 ещё рано");
  assert.ok(net.alt.some(x => /^GET \/records\/133486\?start_date=2026-10-18&end_date=2026-11-02/.test(x)), net.alt.join("\n"));
  await jrRun(s.env, at(TODAY, "18:00"));
  const out = sent();
  assert.equal(out.length, 2, JSON.stringify(out));
  const a = out.find(x => x.to === dg(211));
  assert.ok(/завтра в 15:00/.test(a.text) && /Winchester/.test(a.text) && /Айдос/.test(a.text), a.text);
  const h = s.hist("ga", "winchester", dg(211));
  assert.equal(h.turns.at(-1).rm, "d1"); assert.equal(h.profile.waName, "Арман");
  assert.ok(await s.kv.api.get(`rmok:winchester:11:d1`), "отметка «ушло» — для вкладки «Сервисные»");
  await jrRun(s.env, at(TODAY, "18:01"));
  await jrRun(s.env, at(TODAY, "18:20"));
  assert.equal(sent().length, 2, "повторно не шлём");
});

test("не больше двух сообщений в минуту: остальные — в следующие минуты", async () => {
  net.reset();
  net.altJournal = [1, 2, 3, 4, 5].map(i => rec(ph(220 + i), TOM, `1${i}:00`, { id: 20 + i }));
  const s = mk(ENV); await approve(s);
  await jrRun(s.env, at(TODAY, "17:55"));
  await jrRun(s.env, at(TODAY, "18:00")); assert.equal(sent().length, 2);
  await jrRun(s.env, at(TODAY, "18:01")); assert.equal(sent().length, 4);
  await jrRun(s.env, at(TODAY, "18:02")); assert.equal(sent().length, 5);
  assert.equal(new Set(sent().map(x => x.to)).size, 5);
});

test("перед отправкой запись перечитывается: удалили или перенесли — напоминание по старому времени не уходит", async () => {
  net.reset();
  const a = rec(ph(231), TOM, "15:00", { id: 31 }), b = rec(ph(232), TOM, "16:00", { id: 32 }), c = rec(ph(233), TOM, "17:00", { id: 33 });
  net.altJournal = [a, b, c];
  const s = mk(ENV); await approve(s);
  await jrRun(s.env, at(TODAY, "17:50"));
  a.deleted = true; b.datetime = `${TOM}T12:00:00+05:00`; c.attendance = -1;
  await jrRun(s.env, at(TODAY, "18:00")); await jrRun(s.env, at(TODAY, "18:01"));
  assert.deepEqual(sent(), [], JSON.stringify(sent()));
  await jrRun(s.env, at(TODAY, "18:05")); // журнал перечитан заново: перенесённой записи — напоминание с новым временем
  await jrRun(s.env, at(TODAY, "18:06"));
  assert.equal(sent().length, 1, JSON.stringify(sent()));
  assert.ok(/завтра в 12:00/.test(sent()[0].text), sent()[0].text);
});

test("«стоп» — не пишем; после 21:00 не пишем", async () => {
  net.reset();
  net.altJournal = [rec(ph(241), TOM, "15:00", { id: 41 }), rec(ph(242), TOM, "16:00", { id: 42 }), rec(ph(243), TODAY, "17:30", { id: 43, att: 1 })];
  const s = mk(ENV); await approve(s);
  await s.kv.api.put(`optout:winchester:${dg(241)}`, "1");
  await jrRun(s.env, at(TODAY, "17:00"));
  await jrRun(s.env, at(TODAY, "18:00"));
  assert.deepEqual(sent().map(x => x.to), [dg(242)], "тому, кто просил не писать, — ничего");
  await jrRun(s.env, at(TODAY, "21:05")); // отзыв о визите в 17:30 — в 20:30; в 21:05 ещё «не опоздал», но уже поздно писать
  await jrRun(s.env, at(TODAY, "23:40"));
  assert.equal(sent().length, 1, JSON.stringify(sent()));
});

test("отзыв: только если администратор отметил «пришёл», со ссылкой на 2ГИС; одному клиенту — не чаще раза в 60 дней", async () => {
  net.reset();
  const v = rec(ph(251), TODAY, "12:00", { id: 51, att: 0 });
  net.altJournal = [v];
  const s = mk(ENV); await approve(s);
  await jrRun(s.env, at(TODAY, "14:00"));
  await jrRun(s.env, at(TODAY, "15:00"));
  assert.deepEqual(sent(), [], "«пришёл» не отмечен — ждём");
  v.attendance = 1;
  await jrRun(s.env, at(TODAY, "15:30"));
  assert.equal(sent().length, 1);
  assert.ok(sent()[0].text.includes(W.review), sent()[0].text);
  net.altJournal.push(rec(ph(251), TOM, "12:00", { id: 52, att: 1 }));
  await jrRun(s.env, at(TOM, "15:00")); await jrRun(s.env, at(TOM, "15:01"));
  assert.equal(sent().filter(x => x.text.includes(W.review)).length, 1, "второй визит через день — без второй просьбы");
});

test("отзыв без отметки «пришёл» за 3 часа — не шлём вовсе", async () => {
  net.reset();
  net.altJournal = [rec(ph(261), TODAY, "11:00", { id: 61, att: 2 })];
  const s = mk(ENV); await approve(s);
  await jrRun(s.env, at(TODAY, "13:00"));
  for (const t of ["14:00", "15:00", "16:00", "17:01"]) await jrRun(s.env, at(TODAY, t));
  assert.deepEqual(sent(), []);
});

test("Green-API отказал (номер заблокирован) — пауза и сигнал в Telegram; 429 — попытка в следующую минуту", async () => {
  net.reset();
  net.altJournal = [rec(ph(271), TOM, "15:00", { id: 71 }), rec(ph(272), TOM, "16:00", { id: 72 })];
  const s = mk(ENV); await approve(s);
  await jrRun(s.env, at(TODAY, "17:00"));
  net.gaReply = r => r.op === "sendMessage" ? new Response(JSON.stringify({ message: "Too Many Requests" }), { status: 429 }) : null;
  await jrRun(s.env, at(TODAY, "18:00"));
  net.gaReply = null;
  await jrRun(s.env, at(TODAY, "18:01"));
  assert.equal(net.ga.filter(x => x.op === "sendMessage").length, 3, "429 — повтор: одно не ушло и ушло со второй попытки, второе ушло");
  assert.equal(new Set(sent().map(x => x.to)).size, 2);

  net.reset();
  net.altJournal = [rec(ph(273), TOM, "15:00", { id: 73 }), rec(ph(274), TOM, "16:00", { id: 74 }), rec(ph(275), TOM, "17:00", { id: 75 })];
  const s2 = mk(ENV); await approve(s2);
  await jrRun(s2.env, at(TODAY, "17:00"));
  net.gaReply = r => r.op === "sendMessage" ? new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }) : null;
  await jrRun(s2.env, at(TODAY, "18:00"));
  const tries = net.ga.filter(x => x.op === "sendMessage").length;
  assert.equal(tries, 1, "после отказа номера в эту минуту больше не шлём");
  assert.ok(net.tg.some(x => /Напоминания .*остановлены|остановлены/.test(x.text || "")), JSON.stringify(net.tg));
  await jrRun(s2.env, at(TODAY, "18:01")); await jrRun(s2.env, at(TODAY, "18:02"));
  assert.equal(net.ga.filter(x => x.op === "sendMessage").length, tries, "пауза: не шлём");
});

test("предел в сутки: сверх него не шлём, в Telegram — один сигнал", async () => {
  net.reset();
  const was = W.jr.cap; W.jr.cap = 2;
  try {
    net.altJournal = [1, 2, 3].map(i => rec(ph(280 + i), TOM, `1${i}:00`, { id: 80 + i }));
    const s = mk(ENV); await approve(s);
    await jrRun(s.env, at(TODAY, "17:00"));
    for (const t of ["18:00", "18:01", "18:02", "18:03"]) await jrRun(s.env, at(TODAY, t));
    assert.equal(sent().length, 2);
    assert.equal(net.tg.filter(x => /предел/i.test(x.text || "")).length, 1, JSON.stringify(net.tg));
  } finally { W.jr.cap = was; }
});

test("без ключа журнала или без номера Green-API — ничего не читаем и не шлём; у компаний без jr — тоже", async () => {
  net.reset();
  net.altJournal = [rec(ph(291), TOM, "15:00", { id: 91 })];
  const s = mk({ ALTEGIO_PARTNER: "partner-test", GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token });
  await jrRun(s.env, at(TODAY, "17:00")); await jrRun(s.env, at(TODAY, "18:00"));
  const s2 = mk({ ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok" });
  await jrRun(s2.env, at(TODAY, "17:00")); await jrRun(s2.env, at(TODAY, "18:00"));
  assert.deepEqual(sent(), []);
  assert.ok(!net.alt.some(x => /^GET \/records\//.test(x)), net.alt.join("\n"));
  assert.ok(Object.values(CLIENTS).filter(c => c.jr).every(c => c.id === "winchester"), "пока только Winchester");
});

test("пульт, вкладка «Сервисные»: очередь по журналу — имя из Altegio, номер маской; пауза номера видна; чужой сотрудник — 403", async () => {
  net.reset();
  const now = Date.now(), tom = new Date(now + 86400e3 + 5 * 3600e3).toISOString().slice(0, 10); // часы обвязки: «завтра» по Астане
  net.altJournal = [rec(ph(301), tom, "15:00", { id: 101, name: "Ерлан" })];
  const s = mk({ ...ENV, KEY_WINCHESTER: "staff-key-winch-0001", KEY_BARBER: "staff-key-barber-0001" }); await approve(s);
  await jrRun(s.env, now); // журнал читается по «сейчас» обвязки: запись завтра — d1, h2, rv в очереди
  const login = async key => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${key}&next=%2Finbox` }); return b; };
  const own = await login("owner-key-123456"), r = await own.go("/api/bc/service?c=winchester"), t = await r.text(), j = JSON.parse(t);
  assert.equal(r.status, 200);
  assert.equal(j.journal, true); assert.equal(j.botOff, false, "бот выключен, но напоминания уходят — предупреждения «не будет» нет");
  assert.equal(j.altegio, true);
  assert.deepEqual(j.kinds.map(x => [x.k, x.on]), [["s01", false], ["d1", true], ["h2", true], ["s06", false], ["cx", false], ["rv", true], ["bi", false], ["bo", false]], "подтверждение, перенос, отмена и бонусы — выключены, пока владелец не включит");
  assert.ok(j.kinds.filter(x => x.on).every(x => x.approved), "тексты одобрены");
  assert.ok(j.queue.length >= 1 && j.queue.every(x => x.name === "Ерлан" && x.phone === "+7 700 *** ** 01" && x.ch === "ga"), JSON.stringify(j.queue));
  assert.ok(!t.includes(dg(301)), "полного номера нет");
  assert.equal(j.hold, null);
  await s.kv.api.put("jrhold:winchester", JSON.stringify({ at: now, why: "Green-API ответил 403" }));
  assert.ok(/403/.test((await (await own.go("/api/bc/service?c=winchester")).json()).hold.why));
  assert.equal((await (await login("staff-key-barber-0001")).go("/api/bc/service?c=winchester")).status, 403);
});

test("без REMIND_GA_WINCHESTER = 1 напоминания выключены: журнал не читаем, не шлём; во вкладке «Сервисные» — выключено", async () => {
  net.reset();
  const now = Date.now(), tom = new Date(now + 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
  net.altJournal = [rec(ph(311), TOM, "15:00", { id: 111 }), rec(ph(312), tom, "15:00", { id: 112 })];
  const { REMIND_GA_WINCHESTER, ...off } = ENV;
  for (const v of [undefined, "0", "нет"]) {
    const s = mk(v === undefined ? off : { ...off, REMIND_GA_WINCHESTER: v });
    await jrRun(s.env, at(TODAY, "17:00")); await jrRun(s.env, at(TODAY, "18:00"));
    assert.equal(await s.kv.api.get("jrq:winchester"), null);
  }
  assert.deepEqual(sent(), []);
  assert.ok(!net.alt.some(x => /^GET \/records\//.test(x)), net.alt.join("\n"));
  const s = mk(off), b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Finbox" });
  const j = await (await b.go("/api/bc/service?c=winchester")).json();
  assert.equal(j.journal, true); assert.equal(j.enabled, false);
  assert.deepEqual(j.kinds.map(x => x.on), [false, false, false, false, false, false, false, false]);
});

// ТЗ v4 (08.11.2026): благодарность как в уведомлении Altegio Winchester — через N часов после окончания визита, с «Контролем качества»
// (ссылка Altegio по записи) и 2ГИС; «Запись подтверждена» со ссылкой «Детали»; бонусы из деталей визита и баланса карты
const useVariant = async (s, sc, variant) => {
  const x = SCENARIOS.find(y => y.id === sc);
  const ap = JSON.parse((await s.kv.api.get("svtpl:winchester")) || "{}");
  ap[sc] = { v: x.v, at: 1, var: variant };
  await s.kv.api.put("svtpl:winchester", JSON.stringify(ap));
  const own = JSON.parse((await s.kv.api.get("svtpl:winchester:var")) || "{}");
  own[sc] = { active: variant, list: [] };
  await s.kv.api.put("svtpl:winchester:var", JSON.stringify(own));
};

test("ТЗ v4: благодарность через 1 час после окончания визита — текст как у Altegio, «Контроль качества» из ссылки записи, 2ГИС; после каждого визита", async () => {
  net.reset();
  const v = rec(ph(401), TODAY, "12:00", { id: 4001, att: 1, name: "Кайрат", staff: "Тони (Рауан М.)" });
  v.seance_length = 3600; v.short_link = "http://openhc.kz/c/OWaqc/qONAj/";
  net.altJournal = [v];
  const s = mk(ENV); await approve(s); await autoOn(s, { review: true }, { review: { hours: 1, gap: 0 } });
  await useVariant(s, "S12", "b3");
  await jrRun(s.env, at(TODAY, "13:30"));
  await jrRun(s.env, at(TODAY, "13:59"));
  assert.deepEqual(sent(), [], "визит кончился в 13:00 — благодарность в 14:00");
  await jrRun(s.env, at(TODAY, "14:00"));
  assert.equal(sent().length, 1);
  assert.equal(sent()[0].text, "Кайрат, благодарим за визит!\nВаш мастер Тони (Рауан М.) порадуется отзыву о своей работе\nУслуга: Мужская стрижка\n\nКонтроль качества: http://openhc.kz/e/OWaqc/\n2ГИС: https://go.2gis.com/mrkUN");
  // следующий визит через день — снова благодарность (как у Altegio: после каждого визита)
  const w = rec(ph(401), TOM, "12:00", { id: 4002, att: 1, name: "Кайрат" });
  w.seance_length = 1800; w.short_link = "javascript:alert(1)";
  net.altJournal.push(w);
  await jrRun(s.env, at(TOM, "13:20")); await jrRun(s.env, at(TOM, "13:30")); await jrRun(s.env, at(TOM, "13:31"));
  assert.equal(sent().length, 2, JSON.stringify(sent()));
  assert.equal(sent()[1].text, "Кайрат, благодарим за визит!\nВаш мастер Тони порадуется отзыву о своей работе\nУслуга: Мужская стрижка\n\n2ГИС: https://go.2gis.com/mrkUN", "чужая ссылка — без строки «Контроль качества»");
});

test("ТЗ v4: благодарность — «не чаще раза в N дней» из настроек; без имени — с заглавной буквы", async () => {
  net.reset();
  const a = rec(ph(411), TODAY, "12:00", { id: 4101, att: 1, name: "89771" }), b = rec(ph(411), TOM, "12:00", { id: 4102, att: 1, name: "89771" });
  net.altJournal = [a, b];
  const s = mk(ENV); await approve(s); await autoOn(s, { review: true }, { review: { hours: 0, gap: 30 } });
  await useVariant(s, "S12", "b3");
  await jrRun(s.env, at(TODAY, "11:00")); // первое чтение журнала (то, что должно было уйти раньше, задним числом не шлём)
  await jrRun(s.env, at(TODAY, "12:00")); await jrRun(s.env, at(TODAY, "12:01"));
  assert.equal(sent().length, 1);
  assert.match(sent()[0].text, /^Благодарим за визит!\nВаш мастер Тони/, sent()[0].text);
  await jrRun(s.env, at(TOM, "12:30")); await jrRun(s.env, at(TOM, "12:31"));
  assert.equal(sent().length, 1, "второй визит через день — не чаще раза в 30 дней");
});

test("ТЗ v4: «Запись подтверждена» со ссылкой «Детали» из записи Altegio — как в уведомлении Altegio", async () => {
  net.reset();
  const r = rec(ph(421), TOM, "12:30", { id: 4201, made: `${TODAY}T15:00:00+05:00`, staff: "Тони (Рауан М.)" });
  r.short_link = "http://openhc.kz/c/OS0oy/HOtyz/";
  net.altJournal = [r];
  const s = mk(ENV); await approve(s); await autoOn(s, { confirm: true }, { confirm: { delay: 0 } });
  await useVariant(s, "S01", "b2");
  await jrRun(s.env, at(TODAY, "15:01"));
  assert.equal(sent().length, 1);
  assert.equal(sent()[0].text, "Вы записаны на услугу: Мужская стрижка\nБарбер: Тони (Рауан М.)\nДата: 20 октября 2026 в 12:30.\nДетали: http://openhc.kz/c/OS0oy/HOtyz/");
});

const paid = (i, time, o = {}) => {
  const r = rec(ph(i), TODAY, time, { id: o.id, att: 1, name: "Кайрат" });
  Object.assign(r, { visit_id: o.visit, paid_full: 1, last_change_date: `${TODAY}T${o.changed || time}:00+05:00` });
  r.client.id = o.client;
  return r;
};

test("ТЗ v4: бонусы — «Начислено бонусов» и «Списано бонусов» с балансом карты за 1–2 минуты после оплаты; одна операция — одно сообщение", async () => {
  net.reset();
  const r = paid(431, "12:00", { id: 4301, visit: 9301, client: 7301, changed: "13:10" });
  net.altJournal = [r];
  net.altLoyalty = { types: [{ id: 31134, title: "Бонусы" }], cards: { 7301: [{ id: 55, balance: 1200 }] }, details: { 9301: { loyalty_transactions: [
    { id: 8001, card_id: 55, amount: 400, is_loyalty_withdraw: false, is_discount: false, created_date: `${TODAY} 13:09:00` },
    { id: 8002, card_id: 55, amount: -300, is_loyalty_withdraw: true, created_date: `${TODAY} 13:09:00` },
    { id: 8003, card_id: 55, amount: 10, is_discount: true, created_date: `${TODAY} 13:09:00` }, // скидка картой — не бонусы
    { id: 8004, card_id: 0, certificate_id: 3, amount: 5000, created_date: `${TODAY} 13:09:00` }, // сертификат — не бонусы
  ] } } };
  const s = mk(ENV); await approve(s); await autoOn(s, { bonusIn: true, bonusOut: true });
  await jrRun(s.env, at(TODAY, "13:00")); // полное чтение: оплаты ещё нет
  r.last_change_date = `${TODAY}T13:10:00+05:00`;
  await jrRun(s.env, at(TODAY, "13:11")); // быстрый проход видит изменённую запись
  await jrRun(s.env, at(TODAY, "13:12"));
  const texts = sent().map(x => x.text).sort();
  assert.deepEqual(texts, ["Начислено бонусов: 400\nДоступно: 1200", "Списано бонусов: 300.\nИтоговый баланс: 1200."], JSON.stringify(sent()));
  assert.ok(sent().every(x => x.to === dg(431)));
  for (const t of ["13:13", "13:30", "14:00"]) await jrRun(s.env, at(TODAY, t));
  assert.equal(sent().length, 2, "повторное чтение журнала — без дублей");
  assert.ok(!net.alt.some(x => !/^GET /.test(x) && !/clients\/search/.test(x)), "только чтение Altegio: " + net.alt.filter(x => !/^GET /.test(x)).join(", "));
});

test("ТЗ v4: бонусы — без права «Лояльность» ничего не шлём и пишем почему; старая операция и выключенный сценарий — не шлём", async () => {
  net.reset();
  const r = paid(441, "11:00", { id: 4401, visit: 9401, client: 7401, changed: "12:00" });
  net.altJournal = [r];
  net.altLoyalty = null; // 403, как у сотрудника без права
  const s = mk(ENV); await approve(s); await autoOn(s, { bonusIn: true });
  await jrRun(s.env, at(TODAY, "12:01"));
  assert.deepEqual(sent(), []);
  const log = JSON.parse((await s.kv.api.get("jrl:winchester")) || "[]");
  assert.ok(log.some(x => /права «Лояльность»/.test(x.why)), JSON.stringify(log));
  // право дали, но операция была 5 часов назад — задним числом не пишем
  net.altLoyalty = { cards: { 7401: [{ id: 56, balance: 900 }] }, details: { 9401: { loyalty_transactions: [{ id: 8101, card_id: 56, amount: 300, created_date: `${TODAY} 07:00:00` }] } } };
  r.last_change_date = `${TODAY}T12:20:00+05:00`;
  await jrRun(s.env, at(TODAY, "12:21"));
  assert.deepEqual(sent(), []);
  // списание при выключенном «Списано бонусов» — не шлём, начисление — шлём
  net.altLoyalty.details[9401].loyalty_transactions.push({ id: 8102, card_id: 56, amount: 200, is_loyalty_withdraw: true, created_date: `${TODAY} 12:29:00` },
    { id: 8103, card_id: 56, amount: 350, created_date: `${TODAY} 12:29:00` });
  r.last_change_date = `${TODAY}T12:30:00+05:00`;
  await jrRun(s.env, at(TODAY, "12:31")); await jrRun(s.env, at(TODAY, "12:32"));
  assert.deepEqual(sent().map(x => x.text), ["Начислено бонусов: 350\nДоступно: 900"]);
});

test("ТЗ v4: бонусы после 21:00 — утром в начале часов отправки", async () => {
  net.reset();
  const r = paid(451, "20:00", { id: 4501, visit: 9501, client: 7501, changed: "21:30" });
  net.altJournal = [r];
  net.altLoyalty = { cards: { 7501: [{ id: 57, balance: 700 }] }, details: { 9501: { loyalty_transactions: [{ id: 8201, card_id: 57, amount: 300, created_date: `${TODAY} 21:29:00` }] } } };
  const s = mk(ENV); await approve(s); await autoOn(s, { bonusIn: true });
  await jrRun(s.env, at(TODAY, "21:31"));
  assert.deepEqual(sent(), [], "вечером не шлём");
  await jrRun(s.env, at(TOM, "10:00"));
  assert.deepEqual(sent().map(x => x.text), ["Начислено бонусов: 300\nДоступно: 700"]);
});

// ТЗ v4, проверка владельца 08.11.2026: «Проверка без отправки» показывала прежние тексты — тексты как у Altegio лежали вторым и третьим
// вариантом и ждали ручного выбора. У Winchester они действующие по умолчанию (SV_DEFAULT_WINCHESTER = 0 — прежние); дата — с годом, как у Altegio
test("ТЗ v4: у Winchester по умолчанию действуют тексты как у Altegio — подтверждение с годом и «Детали», благодарность с «Контролем качества»", async () => {
  net.reset();
  const { jrDry } = await import("../../src/services/reminders/journal.js");
  const a = rec(ph(461), TOM, "12:30", { id: 4601, made: `${TODAY}T15:00:00+05:00`, staff: "Тони (Рауан М.)", name: "Кайрат" });
  a.short_link = "https://openhc.kz/c/OS0oy/HOtyz/";
  const b = rec(ph(462), TODAY, "12:00", { id: 4602, att: 1, staff: "Тони (Рауан М.)", name: "Кайрат" });
  b.seance_length = 3600; b.short_link = "https://openhc.kz/c/OWaqc/qONAj/";
  net.altJournal = [a, b];
  const s = mk({ ...ENV, SV_DEFAULT_WINCHESTER: "1" });
  await autoOn(s, { confirm: true, review: true }, { confirm: { delay: 0 }, review: { hours: 1, gap: 0 } });
  const dry = await jrDry(s.env, W, at(TODAY, "13:30"));
  const conf = dry.items.find(x => x.k === "s01"), thx = dry.items.find(x => x.k === "rv");
  assert.equal(conf.text, "Вы записаны на услугу: Мужская стрижка\nБарбер: Тони (Рауан М.)\nДата: 20 октября 2026 в 12:30.\nДетали: https://openhc.kz/c/OS0oy/HOtyz/", "проверка без отправки — тексты как у Altegio: " + conf.text);
  assert.equal(thx.text, "Кайрат, благодарим за визит!\nВаш мастер Тони (Рауан М.) порадуется отзыву о своей работе\nУслуга: Мужская стрижка\n\nКонтроль качества: https://openhc.kz/e/OWaqc/\n2ГИС: https://go.2gis.com/mrkUN");
  // владелец включает сценарий в пульте — одобряется действующий (вариант Altegio), и уходит именно он
  const own = s.browser();
  await own.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" });
  for (const id of ["confirm", "review"]) assert.equal((await own.post("/api/msg/auto", { c: "winchester", id, on: false })).status, 200);
  for (const id of ["confirm", "review"]) assert.equal((await own.post("/api/msg/auto", { c: "winchester", id, on: true })).status, 200);
  const ap = s.kv.json("svtpl:winchester");
  assert.equal(ap.S01.var, "b2"); assert.equal(ap.S12.var, "b3");
  // включили позже, чем должно было уйти, — задним числом не шлём; новая запись — уходит текстом Altegio
  net.altJournal = [a, b, { ...rec(ph(463), TOM, "16:00", { id: 4603, made: new Date(Date.now()).toISOString(), staff: "Айдос" }), short_link: "https://openhc.kz/c/AAAAA/BBBBB/" }];
  const now = Date.now();
  await jrRun(s.env, now + 60e3); await jrRun(s.env, now + 120e3);
  const c3 = sent().find(x => x.to === dg(463));
  if (c3) assert.match(c3.text, /^Вы записаны на услугу: Мужская стрижка\nБарбер: Айдос\nДата: \d+ [а-я]+ \d{4} в 16:00\.\nДетали: https:\/\/openhc\.kz\/c\/AAAAA\/BBBBB\/$/, c3.text);
});

test("ТЗ v4: SV_DEFAULT_WINCHESTER = 0 — прежние тексты (первый вариант), выбор владельца важнее умолчания", async () => {
  net.reset();
  const { jrDry } = await import("../../src/services/reminders/journal.js");
  const a = rec(ph(471), TOM, "12:30", { id: 4701, made: `${TODAY}T15:00:00+05:00` });
  net.altJournal = [a];
  const s = mk({ ...ENV, SV_DEFAULT_WINCHESTER: "0" });
  await autoOn(s, { confirm: true }, { confirm: { delay: 0 } });
  assert.match((await jrDry(s.env, W, at(TODAY, "15:30"))).items.find(x => x.k === "s01").text, /^Здравствуйте/);
  const s2 = mk({ ...ENV, SV_DEFAULT_WINCHESTER: "1" });
  await autoOn(s2, { confirm: true }, { confirm: { delay: 0 } });
  await s2.kv.api.put("svtpl:winchester:var", JSON.stringify({ S01: { active: "b1", list: [] } })); // владелец сам выбрал прежний
  assert.match((await jrDry(s2.env, W, at(TODAY, "15:30"))).items.find(x => x.k === "s01").text, /^Здравствуйте/);
});

// ── находки проверки 08.11.2026 (вебхук Altegio делает изменения записи видимыми сразу — дубли и потери, которых раньше почти не было) ──
const sentTo = i => sent().filter(x => x.to === dg(i));

test("находка 08.11: благодарность — одна на запись, даже если запись поправили после отправки (добавили услугу)", async () => {
  net.reset();
  const v = rec(ph(501), TODAY, "12:00", { id: 5001, att: 1, name: "Кайрат" });
  v.seance_length = 3600;
  net.altJournal = [v];
  const s = mk(ENV); await approve(s); await autoOn(s, { review: true }, { review: { hours: 1, gap: 0 } });
  await jrRun(s.env, at(TODAY, "11:00"));
  await jrRun(s.env, at(TODAY, "14:00"));
  assert.equal(sentTo(501).length, 1);
  v.services.push({ id: 2, title: "Борода" }); // администратор дописал услугу в прошедшую запись
  for (const t of ["14:20", "14:40", "15:00"]) await jrRun(s.env, at(TODAY, t));
  assert.equal(sentTo(501).length, 1, "вторая благодарность после правки записи: " + JSON.stringify(sent()));
});

test("находка 08.11: два визита одного клиента в один день — одна благодарность («после каждого визита», но не дважды за день)", async () => {
  net.reset();
  const a = rec(ph(502), TODAY, "12:00", { id: 5011, att: 1 }), b = rec(ph(502), TODAY, "13:00", { id: 5012, att: 1, staff: "Айдос" });
  a.seance_length = 3600; b.seance_length = 3600;
  net.altJournal = [a, b];
  const s = mk(ENV); await approve(s); await autoOn(s, { review: true }, { review: { hours: 1, gap: 0 } });
  await jrRun(s.env, at(TODAY, "11:00"));
  for (const t of ["14:00", "15:00", "15:01"]) await jrRun(s.env, at(TODAY, t));
  assert.equal(sentTo(502).length, 1, JSON.stringify(sent()));
  const log = JSON.parse((await s.kv.api.get("jrl:winchester")) || "[]");
  assert.ok(log.some(x => x.k === "rv" && /уже отправляли/.test(x.why)), JSON.stringify(log));
});

test("находка 08.11: «Запись подтверждена» — одна на запись и время: дописали услугу — второго нет; перенесли время — новое подтверждение", async () => {
  net.reset();
  const r = rec(ph(503), TOM, "12:30", { id: 5021, made: `${TODAY}T15:00:00+05:00` });
  net.altJournal = [r];
  const s = mk(ENV); await approve(s); await autoOn(s, { confirm: true }, { confirm: { delay: 0 } });
  await jrRun(s.env, at(TODAY, "15:01"));
  assert.equal(sentTo(503).length, 1);
  r.services.push({ id: 2, title: "Борода" }); r.last_change_date = `${TODAY}T15:04:00+05:00`;
  await jrRun(s.env, at(TODAY, "15:05")); await jrRun(s.env, at(TODAY, "15:06"));
  assert.equal(sentTo(503).length, 1, "дописали услугу — второго «Вы записаны» нет: " + JSON.stringify(sent()));
  r.datetime = `${TOM}T14:00:00+05:00`; r.last_change_date = `${TODAY}T15:10:00+05:00`;
  await jrRun(s.env, at(TODAY, "15:11")); await jrRun(s.env, at(TODAY, "15:12"));
  assert.equal(sentTo(503).length, 2, "время перенесли — подтверждение с новым временем");
  assert.match(sentTo(503)[1].text, /14:00/);
});

test("находка 08.11: бонусы — одна операция визита из двух записей (два мастера) — одно сообщение", async () => {
  net.reset();
  const a = paid(504, "12:00", { id: 5031, visit: 9531, client: 7531, changed: "13:10" }), b = paid(504, "12:00", { id: 5032, visit: 9531, client: 7531, changed: "13:10" });
  b.staff = { id: 2, name: "Айдос" };
  net.altJournal = [a, b];
  net.altLoyalty = { cards: { 7531: [{ id: 58, balance: 800 }] }, details: { 9531: { loyalty_transactions: [{ id: 8301, card_id: 58, amount: 400, created_date: `${TODAY} 13:09:00` }] } } };
  const s = mk(ENV); await approve(s); await autoOn(s, { bonusIn: true });
  await jrRun(s.env, at(TODAY, "13:11")); await jrRun(s.env, at(TODAY, "13:12")); await jrRun(s.env, at(TODAY, "13:30"));
  assert.deepEqual(sent().map(x => x.text), ["Начислено бонусов: 400\nДоступно: 800"]);
});

test("находка 08.11: операция с бонусами без даты — время окончания визита: старый визит — не пишем задним числом, только что кончился — пишем", async () => {
  net.reset();
  const old = paid(505, "12:00", { id: 5041, visit: 9541, client: 7541, changed: "17:20" }), now1 = paid(506, "16:00", { id: 5042, visit: 9542, client: 7542, changed: "17:20" });
  old.seance_length = 3600; now1.seance_length = 3600;
  net.altJournal = [old, now1];
  net.altLoyalty = { cards: { 7541: [{ id: 59, balance: 500 }], 7542: [{ id: 60, balance: 600 }] }, details: {
    9541: { loyalty_transactions: [{ id: 8401, card_id: 59, amount: 100 }] }, 9542: { loyalty_transactions: [{ id: 8402, card_id: 60, amount: 200, created_date: "" }] } } };
  const s = mk(ENV); await approve(s); await autoOn(s, { bonusIn: true });
  await jrRun(s.env, at(TODAY, "17:30")); await jrRun(s.env, at(TODAY, "17:31"));
  assert.deepEqual(sent().map(x => x.to + " " + x.text), [dg(506) + " Начислено бонусов: 200\nДоступно: 600"]);
});

test("находка 08.11: бонусы, отложенные на утро, уходят, даже если вечером в записи поправили услуги", async () => {
  net.reset();
  const r = paid(507, "20:00", { id: 5051, visit: 9551, client: 7551, changed: "21:30" });
  net.altJournal = [r];
  net.altLoyalty = { cards: { 7551: [{ id: 61, balance: 900 }] }, details: { 9551: { loyalty_transactions: [{ id: 8501, card_id: 61, amount: 300, created_date: `${TODAY} 21:29:00` }] } } };
  const s = mk(ENV); await approve(s); await autoOn(s, { bonusIn: true });
  await jrRun(s.env, at(TODAY, "21:31"));
  r.services.push({ id: 2, title: "Борода" }); r.last_change_date = `${TODAY}T21:40:00+05:00`;
  await jrRun(s.env, at(TODAY, "21:41"));
  await jrRun(s.env, at(TOM, "10:00"));
  assert.deepEqual(sent().map(x => x.text), ["Начислено бонусов: 300\nДоступно: 900"]);
});

test("находка 08.11: отмена, замеченная перед концом часов отправки и не успевшая уйти (2 в минуту), уходит утром, а не пропадает", async () => {
  net.reset();
  const list = [1, 2, 3].map(i => rec(ph(510 + i), TOM, "15:00", { id: 5060 + i }));
  net.altJournal = list.slice();
  const s = mk(ENV); await approve(s); await autoOn(s, { cancel: true });
  await jrRun(s.env, at(TODAY, "20:36")); // записи видели
  net.altJournal = [];
  await jrRun(s.env, at(TODAY, "20:56")); // полное чтение (прошло 20 минут): три отмены — через 3 минуты (вдруг запись вернут)
  assert.deepEqual(sent(), []);
  await jrRun(s.env, at(TODAY, "20:59")); // уходят две
  assert.equal(sent().length, 2);
  await jrRun(s.env, at(TODAY, "21:00")); await jrRun(s.env, at(TODAY, "23:00"));
  assert.equal(sent().length, 2, "ночью не шлём");
  await jrRun(s.env, at(TOM, "10:00"));
  assert.equal(sent().length, 3, "третья отмена — утром: " + JSON.stringify(sent()));
  assert.match(sent()[2].text, /отменена/);
});

test("находка 08.11: запись удалили и клиент тут же записался заново — об отмене не пишем (утром тоже)", async () => {
  net.reset();
  const a = rec(ph(521), TOM, "15:00", { id: 5071 }), c2 = rec(ph(522), TOM, "15:00", { id: 5072 });
  net.altJournal = [a, c2];
  const s = mk(ENV); await approve(s); await autoOn(s, { cancel: true });
  await jrRun(s.env, at(TODAY, "20:40"));
  // администратор «перенёс» запись удалением и новой записью (21:05); у второго клиента — просто отмена
  net.altJournal = [rec(ph(521), TOM, "16:00", { id: 5073, made: `${TODAY}T21:05:00+05:00` })];
  await jrRun(s.env, at(TODAY, "21:10"));
  await jrRun(s.env, at(TOM, "10:00")); await jrRun(s.env, at(TOM, "10:01"));
  assert.deepEqual(sent().map(x => x.to), [dg(522)], JSON.stringify(sent()));
  const log = JSON.parse((await s.kv.api.get("jrl:winchester")) || "[]");
  assert.ok(log.some(x => x.k === "cx" && x.p === dg(521) && /записался заново/.test(x.why)), JSON.stringify(log));
});
