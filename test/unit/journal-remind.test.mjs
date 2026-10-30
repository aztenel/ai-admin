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

test("бот на втором номере Winchester выключен по умолчанию, BOT_GA_WINCHESTER = 1 включает; у других компаний — как было", () => {
  assert.equal(botOff({}, W, "ga"), true);
  assert.equal(botOff({ BOT_GA_WINCHESTER: "1" }, W, "ga"), false);
  assert.equal(botOff({}, CLIENTS.barber, "ga"), !!CLIENTS.barber.gaOff);
});

test("накануне в 18:00 напоминание уходит со второго номера, один раз; в пульте — переписка с именем из Altegio", async () => {
  net.reset();
  net.altJournal = [rec(ph(211), TOM, "15:00", { id: 11, name: "Арман", staff: "Айдос", svc: "Мужская стрижка" }), rec(ph(212), TOM, "12:30", { id: 12 })];
  const s = mk(ENV);
  await jrRun(s.env, at(TODAY, "17:00"));
  assert.deepEqual(sent(), [], "в 17:00 ещё рано");
  assert.ok(net.alt.some(x => /^GET \/records\/133486\?start_date=2026-10-18&end_date=2026-10-20/.test(x)), net.alt.join("\n"));
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
  const s = mk(ENV);
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
  const s = mk(ENV);
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
  const s = mk(ENV);
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
  const s = mk(ENV);
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
  const s = mk(ENV);
  await jrRun(s.env, at(TODAY, "13:00"));
  for (const t of ["14:00", "15:00", "16:00", "17:01"]) await jrRun(s.env, at(TODAY, t));
  assert.deepEqual(sent(), []);
});

test("Green-API отказал (номер заблокирован) — пауза и сигнал в Telegram; 429 — попытка в следующую минуту", async () => {
  net.reset();
  net.altJournal = [rec(ph(271), TOM, "15:00", { id: 71 }), rec(ph(272), TOM, "16:00", { id: 72 })];
  const s = mk(ENV);
  await jrRun(s.env, at(TODAY, "17:00"));
  net.gaReply = r => r.op === "sendMessage" ? new Response(JSON.stringify({ message: "Too Many Requests" }), { status: 429 }) : null;
  await jrRun(s.env, at(TODAY, "18:00"));
  net.gaReply = null;
  await jrRun(s.env, at(TODAY, "18:01"));
  assert.equal(net.ga.filter(x => x.op === "sendMessage").length, 3, "429 — повтор: одно не ушло и ушло со второй попытки, второе ушло");
  assert.equal(new Set(sent().map(x => x.to)).size, 2);

  net.reset();
  net.altJournal = [rec(ph(273), TOM, "15:00", { id: 73 }), rec(ph(274), TOM, "16:00", { id: 74 }), rec(ph(275), TOM, "17:00", { id: 75 })];
  const s2 = mk(ENV);
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
    const s = mk(ENV);
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
  const s = mk({ ...ENV, KEY_WINCHESTER: "staff-key-winch-0001", KEY_BARBER: "staff-key-barber-0001" });
  await jrRun(s.env, now); // журнал читается по «сейчас» обвязки: запись завтра — d1, h2, rv в очереди
  const login = async key => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${key}&next=%2Finbox` }); return b; };
  const own = await login("owner-key-123456"), r = await own.go("/api/bc/service?c=winchester"), t = await r.text(), j = JSON.parse(t);
  assert.equal(r.status, 200);
  assert.equal(j.journal, true); assert.equal(j.botOff, false, "бот выключен, но напоминания уходят — предупреждения «не будет» нет");
  assert.equal(j.altegio, true); assert.deepEqual(j.kinds.map(x => [x.k, x.on]), [["d1", true], ["h2", true], ["rv", true]]);
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
  assert.deepEqual(j.kinds.map(x => x.on), [false, false, false]);
});
