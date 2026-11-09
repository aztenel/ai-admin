// «Автоматические сообщения» второго номера (задание владельца 02.11.2026): девять сценариев, у каждого выключатель, текст, время,
// счётчики, журнал и проверка на номер владельца. Всё выключено по умолчанию; реклама — только с подтверждённым согласием и пока снят
// запрет gaNoBroadcast (в проверках его снимают правкой CLIENTS); Altegio — только чтение. Всё на заглушках: журнал — net.altJournal,
// справочник — net.altClients, Green-API — net.ga. Номера вымышленные (+7 700 000 6x xx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, gaPass } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { autoOn } from "../automsg.mjs";
import { jrRun, jrPlan, sendOnceAuto } from "../../src/services/reminders/journal.js";
import { mkRun } from "../../src/services/automsg/marketing.js";
import { autoSettings } from "../../src/services/automsg/catalog.js";
import { atLocal } from "../../src/services/reminders/plan.js";
import { SCENARIOS } from "../../src/services/reminders/templates.js";
import { jrqLoad } from "../../src/db/kv/reminders.js";
import { contactAdd } from "../../src/db/d1/contacts.js";
import { consentAdd, restrictionAdd } from "../../src/db/d1/rights.js";
import { syncStep } from "../../src/services/contacts/sync.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";

const skip = sqliteOk ? false : "нужна D1 на node:sqlite (Node 22+)";
const W = CLIENTS.winchester, INST = { id: "7105000066", token: "ga-tok-auto" };
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token, REMIND_GA_WINCHESTER: "1",
  KEY_WINCHESTER: "staff-key-winch-0001", KEY_BARBER: "staff-key-barber-0001" };
const TODAY = "2026-10-19", TOM = "2026-10-20", YDAY = "2026-10-18";
const at = (date, time) => atLocal(date, time);
let rid = 6000;
const rec = (phone, date, time, o = {}) => ({ id: o.id || ++rid, datetime: `${date}T${time}:00+05:00`, deleted: false, attendance: o.att ?? 0,
  create_date: o.made || `${YDAY}T12:00:00+05:00`, staff: { id: o.sid || 1, name: o.staff || "Тони" }, client: { id: 1, phone, name: o.name ?? "Клиент" },
  services: [{ id: 1, title: o.svc || "Мужская стрижка" }] });
const ph = i => "+7700000" + String(i).padStart(4, "0");
const dg = i => ph(i).slice(1);
const sent = () => net.ga.filter(x => x.op === "sendMessage").map(x => ({ to: x.body.chatId.replace("@c.us", ""), text: x.body.message }));
const login = async (s, key) => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${key}&next=%2Fapp%2F` }); return b; };
const OWNER = "owner-key-123456", STAFF = "staff-key-winch-0001", OTHER = "staff-key-barber-0001";
const info = async b => (await b.go("/api/msg/auto?c=winchester")).json();
const sc = (j, id) => j.scenarios.find(x => x.id === id);
const set = (b, body) => b.post("/api/msg/auto", { c: "winchester", ...body });
// тексты одобрены владельцем (как было до раздела): без этого сервисные не уходят
const approveAll = s => s.kv.api.put("svtpl:winchester", JSON.stringify(Object.fromEntries(SCENARIOS.filter(x => x.auto).map(x => [x.id, { v: x.v, at: 1 }]))));
const log = s => s.kv.json("jrl:winchester") || [];
const withD1 = (x = {}) => ({ ...ENV, ...x, ...(sqliteOk ? { DB: d1With("production").db } : {}) });

test("по умолчанию всё выключено: одиннадцать сценариев (с бонусами, ТЗ v4), ни один не шлёт; без главного выключателя — сказано почему; сотрудник видит, но не меняет", async () => {
  net.reset();
  const { REMIND_GA_WINCHESTER, ...off } = ENV;
  const s = mk(off), own = await login(s, OWNER), staff = await login(s, STAFF), other = await login(s, OTHER);
  const j = await info(own);
  assert.deepEqual(j.scenarios.map(x => x.id), ["confirm", "remind24", "remind3", "move", "cancel", "review", "bonusIn", "bonusOut", "birthday", "reactivate", "campaigns"]);
  assert.ok(j.scenarios.every(x => x.on === false && x.live === false), "всё выключено");
  assert.deepEqual(j.scenarios.filter(x => x.group === "service").map(x => x.id), ["confirm", "remind24", "remind3", "move", "cancel", "review", "bonusIn", "bonusOut"]);
  assert.equal(j.master.on, false); assert.match(j.master.why, /REMIND_GA_WINCHESTER/);
  assert.equal(j.owner, true); assert.equal(j.window.from, 10); assert.equal(j.window.to, 21);
  assert.match(sc(j, "birthday").locked, /Реклама со второго номера выключена/, "gaNoBroadcast держит рекламу");
  assert.match(sc(j, "campaigns").locked, /Запуск рассылок со второго номера выключен/);
  assert.ok(sc(j, "remind24").text.ru && sc(j, "remind24").preview, "текст и пример на вымышленной записи");
  assert.ok(/За 24 часа до визита/.test(sc(j, "remind24").timingText), sc(j, "remind24").timingText);
  const js = await info(staff);
  assert.equal(js.owner, false);
  assert.equal((await set(staff, { id: "remind24", on: true })).status, 403, "сотрудник не включает");
  assert.equal((await other.go("/api/msg/auto?c=winchester")).status, 403, "чужая компания");
  assert.equal((await s.browser().go("/api/msg/auto?c=winchester")).status, 401);
  // главный выключатель включён, тексты одобрены, а сценарии — нет: клиентам ничего не уходит
  net.altJournal = [rec(ph(6001), TOM, "15:00", { id: 6001 })];
  const s2 = mk(ENV); await approveAll(s2);
  for (const t of ["12:00", "15:00", "18:00", "18:01"]) await jrRun(s2.env, at(TODAY, t));
  await jrRun(s2.env, at(TOM, "12:00")); await jrRun(s2.env, at(TOM, "13:00"));
  assert.deepEqual(sent(), [], "ни одного сообщения");
});

test("владелец включает сценарий: текст одобряется им же, в журнале «включил»; реклама и кампании при запрете не включаются; выключил — стоящие в очереди не уходят", async () => {
  net.reset();
  net.altJournal = [rec(ph(6011), TOM, "15:00", { id: 6011, name: "Арман" })];
  const s = mk(ENV), own = await login(s, OWNER);
  assert.equal((await set(own, { id: "remind24", timing: { mode: "eve", eve: "18:00" } })).status, 200);
  let r = await set(own, { id: "remind24", on: true, op: "Азамат" });
  assert.equal(r.status, 200, await r.text());
  let j = await info(own);
  assert.equal(sc(j, "remind24").on, true); assert.equal(sc(j, "remind24").text.approved, true);
  assert.ok(sc(j, "remind24").log.some(x => x.st === "on" && /включил Азамат/.test(x.why)), JSON.stringify(sc(j, "remind24").log));
  assert.ok(s.kv.json("svtpl:winchester").S03, "текст одобрен при включении");
  r = await set(own, { id: "birthday", on: true });
  assert.equal(r.status, 409); assert.equal((await r.json()).code, "locked");
  assert.equal((await set(own, { id: "campaigns", on: true })).status, 409);
  // напоминание накануне в 18:00 стоит в очереди; владелец выключил сценарий в 17:30 — оно не уходит
  await jrRun(s.env, at(TODAY, "17:00"));
  assert.ok((await jrqLoad(s.env, "winchester")).some(x => x.k === "d1"), "в очереди");
  assert.equal((await set(own, { id: "remind24", on: false })).status, 200);
  await jrRun(s.env, at(TODAY, "18:00")); await jrRun(s.env, at(TODAY, "18:20"));
  assert.deepEqual(sent(), []);
  assert.ok(log(s).some(x => x.k === "d1" && /выключен/.test(x.why)), JSON.stringify(log(s)));
  // включили снова в 18:30 — напоминание «на 18:00» задним числом не уходит
  s.kv.mem.set("msgset:winchester", JSON.stringify({ ...s.kv.json("msgset:winchester"), s: { ...s.kv.json("msgset:winchester").s, remind24: { on: true, at: at(TODAY, "18:30"), by: "т", t: { mode: "eve", eve: "18:00" } } } }));
  await jrRun(s.env, at(TODAY, "18:35")); await jrRun(s.env, at(TODAY, "18:51"));
  assert.deepEqual(sent(), [], "включили позже, чем должно было уйти");
  j = await info(own);
  assert.ok(sc(j, "remind24").log.some(x => /включили позже|выключен/.test(x.why)));
});

test("время и часы отправки: значения проверяются; сохранённое видно после нового входа (как после перезагрузки страницы)", async () => {
  net.reset();
  const s = mk(ENV), own = await login(s, OWNER);
  assert.equal((await set(own, { id: "remind3", timing: { hours: 7 } })).status, 400);
  assert.equal((await set(own, { id: "remind3", timing: { minutes: 3 } })).status, 400, "чужое поле");
  assert.equal((await set(own, { id: "remind3", timing: { hours: 3 } })).status, 200);
  assert.equal((await set(own, { id: "confirm", timing: { delay: 7 } })).status, 400, "кратно 5");
  assert.equal((await set(own, { id: "remind24", timing: { mode: "eve", eve: "19:30" } })).status, 200);
  assert.equal((await set(own, { id: "reactivate", timing: { time: "23:00" } })).status, 400, "вне часов отправки");
  assert.equal((await set(own, { id: "reactivate", timing: { days: 60, time: "12:30", cap: 10 } })).status, 200);
  assert.equal((await set(own, { window: { from: 7, to: 21 } })).status, 400);
  assert.equal((await set(own, { window: { from: 9, to: 20 }, cap: 100 })).status, 200);
  assert.equal((await set(own, { cap: 5000 })).status, 400);
  const again = await login(s, OWNER), j = await info(again);
  assert.equal(sc(j, "remind3").timing.hours, 3); assert.match(sc(j, "remind3").timingText, /За 3 ч до визита, если это время с 9:00 до 20:00/);
  assert.deepEqual(sc(j, "remind24").timing, { mode: "eve", eve: "19:30" }); assert.match(sc(j, "remind24").timingText, /Накануне визита в 19:30/);
  assert.deepEqual(sc(j, "reactivate").timing, { days: 60, time: "12:30", cap: 10 });
  assert.deepEqual(j.window, { from: 9, to: 20 }); assert.equal(j.cap, 100);
  assert.ok(sc(j, "remind3").log.some(x => x.st === "edit"), "изменение — в журнале сценария");
});

test("текст: владелец правит сервисный — новая версия сразу одобрена и уходит она; неизвестная вставка — отказ; рекламный — только с «стоп»", async () => {
  net.reset();
  net.altJournal = [rec(ph(6021), TOM, "15:00", { id: 6021, name: "Арман" })];
  const s = mk(ENV), own = await login(s, OWNER);
  assert.equal((await set(own, { id: "remind24", text: { ru: "Завтра {когда} ждём вас." } })).status, 400);
  let r = await set(own, { id: "remind24", text: { ru: "Арман? Нет: {имя}, завтра в {время} ждём вас в {компания}.", kk: "" } });
  assert.equal(r.status, 200, await r.text());
  let j = await info(own);
  assert.match(sc(j, "remind24").text.ru, /завтра в \{время\} ждём вас/); assert.equal(sc(j, "remind24").text.approved, true); assert.equal(sc(j, "remind24").text.own, true);
  assert.match(sc(j, "remind24").preview, /15:00/);
  await set(own, { id: "remind24", timing: { mode: "eve", eve: "18:00" } }); await set(own, { id: "remind24", on: true });
  await jrRun(s.env, at(TODAY, "17:00")); await jrRun(s.env, at(TODAY, "18:00"));
  assert.equal(sent().length, 1); assert.match(sent()[0].text, /^Арман\? Нет: Арман, завтра в 15:00 ждём вас в Winchester/);
  // рекламный текст
  assert.equal((await set(own, { id: "birthday", text: { ru: "С днём рождения!" } })).status, 400, "нет отказа");
  assert.equal((await set(own, { id: "birthday", text: { ru: "С днём рождения! Скидка [сколько]. Если такие сообщения не нужны, напишите «стоп»." } })).status, 400, "[скобки]");
  r = await set(own, { id: "birthday", text: { ru: "{{client.first_name}}, с днём рождения от {{company.name}}! Если такие сообщения не нужны, напишите «стоп»." } });
  assert.equal(r.status, 200, await r.text());
  j = await info(own);
  assert.equal(sc(j, "birthday").text.v, 1); assert.match(sc(j, "birthday").preview, /^Арман, с днём рождения от Winchester!/);
});

test("проверка на мой номер: только номер владельца, тот же текст, что клиенту; в журнале «проверка»; тестовая версия — не уходит; не больше 20 за час", async () => {
  net.reset();
  const s = mk(withD1()), own = await login(s, OWNER), staff = await login(s, STAFF);
  let r = await own.post("/api/msg/test", { c: "winchester", id: "remind24", rid: "rid-auto-0001" });
  assert.equal(r.status, 409); let j = await r.json();
  assert.equal(j.code, "notest"); assert.match(j.preview, /Winchester/, "текст виден и без номера");
  assert.equal((await set(own, { testPhone: "8 701 000 99" })).status, 400);
  assert.equal((await set(own, { testPhone: "+7 701 000 99 88" })).status, 200);
  assert.equal((await info(own)).test.phone, "+7 701 000 99 88");
  assert.equal((await info(staff)).test.phone, "+7 701 *** ** 88", "сотруднику — маской");
  assert.equal((await staff.post("/api/msg/test", { c: "winchester", id: "remind24", rid: "rid-auto-0002" })).status, 403);
  r = await own.post("/api/msg/test", { c: "winchester", id: "remind24", rid: "rid-auto-0003", to: "+7 700 000 00 01" });
  j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.deepEqual(sent().map(x => x.to), ["77010009988"], "только на номер владельца, «to» из запроса не слушаем");
  assert.equal(sent()[0].text, j.text); assert.match(j.text, /завтра в 15:00/);
  if (sqliteOk) { // двойное нажатие — одно сообщение (отметка в D1)
    r = await own.post("/api/msg/test", { c: "winchester", id: "remind24", rid: "rid-auto-0003" });
    assert.equal(r.status, 200); assert.equal((await r.json()).dup, true); assert.equal(sent().length, 1);
  }
  // реклама со второго номера запрещена, но проверка на свой номер — можно: это не рассылка
  r = await own.post("/api/msg/test", { c: "winchester", id: "birthday", rid: "rid-auto-0004" });
  assert.equal(r.status, 200); assert.match(sent().at(-1).text, /с днём рождения/i); assert.match(sent().at(-1).text, /стоп/);
  const t = await info(own);
  assert.ok(sc(t, "remind24").log.some(x => x.st === "test"), "проверка — в журнале сценария");
  assert.equal(sc(t, "remind24").counts.today.sent, 0, "проверка не считается отправкой клиенту");
  // тестовая версия сайта — проверка не уходит, текст показан
  const p = mk({ ...ENV, STAGE: "preview" }), pown = await login(p, OWNER);
  await set(pown, { testPhone: "+7 701 000 99 88" });
  const was = sent().length;
  r = await pown.post("/api/msg/test", { c: "winchester", id: "remind3", rid: "rid-auto-0005" });
  assert.equal(r.status, 409); j = await r.json(); assert.equal(j.code, "preview"); assert.ok(j.preview);
  assert.equal(sent().length, was);
  // не больше 20 проверок за час
  s.kv.mem.set(`mst:winchester:${Math.floor(Date.now() / 3600e3)}`, "20");
  assert.equal((await own.post("/api/msg/test", { c: "winchester", id: "remind3", rid: "rid-auto-0006" })).status, 429);
});

test("напоминание за 24 часа: в часы отправки; раньше 10:00 — в 10:00 накануне, позже 21:00 — в 20:30; записался меньше чем за сутки — без него", () => {
  const set24 = autoSettings(W, { s: { remind24: { on: true, at: 1, t: { mode: "24h" } } } }), now = at(TODAY, "08:00");
  const items = jrPlan(W, [rec(ph(6031), TOM, "15:00", { id: 1 }), rec(ph(6032), TOM, "09:00", { id: 2 }), rec(ph(6033), TOM, "21:30", { id: 3 }),
    rec(ph(6034), TOM, "15:00", { id: 4, made: `${TODAY}T16:00:00+05:00` })], now, set24);
  const d1 = id => items.find(x => x.rec === String(id) && x.k === "d1");
  assert.equal(d1(1).at, at(TODAY, "15:00")); assert.equal(d1(2).at, at(TODAY, "10:00")); assert.equal(d1(3).at, at(TODAY, "20:30"));
  assert.equal(d1(4), undefined, "записался сегодня в 16:00 на завтра 15:00 — напоминать не нужно");
  assert.ok(items.every(x => x.k === "d1"), "остальные сценарии выключены");
});

test("напоминание за несколько часов (по умолчанию 3, от 1 до 6): только в часы отправки, если записался заранее", () => {
  const plan = (hours, recs, now) => jrPlan(W, recs, now, autoSettings(W, { s: { remind3: { on: true, at: 1, t: { hours } } } }));
  const r = [rec(ph(6041), TOM, "15:00", { id: 1 }), rec(ph(6042), TOM, "11:00", { id: 2 }), rec(ph(6043), TOM, "15:00", { id: 3, made: `${TOM}T10:30:00+05:00` })];
  let items = plan(3, r, at(TODAY, "12:00"));
  assert.deepEqual(items.map(x => [x.rec, x.k, x.at]), [["1", "h2", at(TOM, "12:00")]], "11:00 − 3 ч = 8:00 — рано; записался за 4,5 часа — не напоминаем");
  items = plan(1, r, at(TODAY, "12:00"));
  assert.deepEqual(items.map(x => [x.rec, x.at]), [["1", at(TOM, "14:00")], ["2", at(TOM, "10:00")], ["3", at(TOM, "14:00")]]);
  assert.equal(autoSettings(W, { s: { remind3: { on: true, t: { hours: 9 } } } }).s.remind3.t.hours, 3, "неверное значение — по умолчанию");
});

test("перенос: сообщение с новым временем даже без напоминаний; повторное чтение журнала — без повторов; несколько изменений подряд — одно сообщение с последним временем", async () => {
  net.reset();
  net.altJournal = [rec(ph(6051), TOM, "15:00", { id: 6051, name: "Арман" })];
  const s = mk(ENV); await approveAll(s); await autoOn(s, { move: true });
  await jrRun(s.env, at(TODAY, "12:00"));
  assert.deepEqual(sent(), [], "первое чтение — только запоминаем записи");
  net.altJournal = [rec(ph(6051), TOM, "17:00", { id: 6051, name: "Арман" })];
  await jrRun(s.env, at(TODAY, "12:16"));
  assert.deepEqual(sent(), [], "о переносе — через 3 минуты: вдруг запись поправят ещё раз");
  await jrRun(s.env, at(TODAY, "12:19"));
  assert.equal(sent().length, 1, JSON.stringify(log(s))); assert.match(sent()[0].text, /перенесена на 20 октября, 17:00/);
  await jrRun(s.env, at(TODAY, "12:32")); await jrRun(s.env, at(TODAY, "12:48"));
  assert.equal(sent().length, 1, "тот же журнал — повторов нет");
  // между чтениями запись меняли дважды (18:00, потом 19:00) — уходит одно сообщение с последним временем
  net.altJournal = [rec(ph(6051), TOM, "19:00", { id: 6051, name: "Арман" })];
  await jrRun(s.env, at(TODAY, "13:04")); await jrRun(s.env, at(TODAY, "13:20"));
  assert.equal(sent().length, 2); assert.match(sent()[1].text, /19:00/);
  // перенос записи, которую удалили бы из окна, — найден по журналу на 60 дней: тоже перенос, не отмена
  await autoOn(s, { move: true, cancel: true });
  net.altJournal = [rec(ph(6051), "2026-11-20", "15:00", { id: 6051, name: "Арман" })];
  await jrRun(s.env, at(TODAY, "13:36")); await jrRun(s.env, at(TODAY, "13:39"));
  assert.equal(sent().length, 3); assert.match(sent()[2].text, /перенесена на 20 ноября, 15:00/); assert.ok(!/отменена/.test(sent()[2].text));
});

test("отмена: запись удалили — одно сообщение об отмене; журнал не прочитался — не отмена; удалили сразу после создания и прошедшую — не пишем; вернули до отправки — не пишем", async () => {
  net.reset();
  const A = rec(ph(6061), TOM, "15:00", { id: 6061, name: "Ерлан" }), B = rec(ph(6062), TOM, "16:00", { id: 6062 }), C = rec(ph(6063), TOM, "17:00", { id: 6063 }),
    D = rec(ph(6064), TOM, "18:00", { id: 6064 }), E = rec(ph(6065), TODAY, "09:00", { id: 6065 });
  net.altJournal = [A, B, C, D, E];
  const s = mk(ENV); await approveAll(s); await autoOn(s, { cancel: true });
  await jrRun(s.env, at(TODAY, "12:00"));
  net.altJournalFail = 500; // журнал не прочитался — ничего не «отменено»
  await jrRun(s.env, at(TODAY, "12:16"));
  net.altJournalFail = 0;
  assert.deepEqual(sent(), []);
  net.altJournal = [B, C, D]; // A удалили; E (сегодня в 9:00) уже прошла — о ней не пишем
  await jrRun(s.env, at(TODAY, "12:32")); await jrRun(s.env, at(TODAY, "12:35"));
  assert.equal(sent().length, 1); assert.equal(sent()[0].to, dg(6061));
  assert.match(sent()[0].text, /Ерлан! Ваша запись в Winchester на 20 октября в 15:00 отменена/);
  await jrRun(s.env, at(TODAY, "12:48")); await jrRun(s.env, at(TODAY, "13:04"));
  assert.equal(sent().length, 1, "повторно не пишем");
  // удалили сразу три записи: через 3 минуты две уходят, третью успели вернуть — о ней не пишем
  net.altJournal = [];
  await jrRun(s.env, at(TODAY, "13:20")); await jrRun(s.env, at(TODAY, "13:23"));
  assert.equal(sent().length, 3);
  const left = [B, C, D].find(x => !sent().some(y => y.to === x.client.phone.slice(1)));
  net.altJournal = [left];
  await jrRun(s.env, at(TODAY, "13:24"));
  assert.equal(sent().length, 3, "вернули — не пишем");
  assert.ok(log(s).some(x => x.k === "cx" && /снова есть в Altegio/.test(x.why)), JSON.stringify(log(s).filter(x => x.k === "cx")));
  // запись создали и удалили за несколько минут (ошибка администратора) — клиенту не пишем
  const F = rec(ph(6066), TOM, "19:00", { id: 6066, made: `${TODAY}T13:30:00+05:00` });
  net.altJournal = [left, F];
  await jrRun(s.env, at(TODAY, "13:36"));
  net.altJournal = [left];
  await jrRun(s.env, at(TODAY, "13:52"));
  assert.ok(!sent().some(x => x.to === dg(6066)), "создана в 13:30 и удалена к 13:52: ошибка администратора, клиенту не пишем");
  assert.ok(log(s).some(x => x.k === "cx" && x.rec === "6066" && /сразу после создания/.test(x.why)), JSON.stringify(log(s).filter(x => x.k === "cx")));
  // счётчики дня (по Астане) — в msgn:<клиент>:<день>; в пульте — «сегодня» и «за 7 дней»
  assert.ok(s.kv.json(`msgn:winchester:${TODAY}`).cancel.s >= 3, JSON.stringify(s.kv.json(`msgn:winchester:${TODAY}`)));
});

test("подтверждение записи: только новой, с выбранной задержкой; перенос до подтверждения — одно подтверждение с новым временем", async () => {
  net.reset();
  const A = rec(ph(6071), TOM, "15:00", { id: 6071, made: `${TODAY}T11:58:00+05:00`, name: "Айдос" }), OLD = rec(ph(6072), TOM, "16:00", { id: 6072 });
  net.altJournal = [OLD];
  const s = mk(ENV); await approveAll(s); await autoOn(s, { confirm: true, move: true }, { confirm: { delay: 10 } });
  await jrRun(s.env, at(TODAY, "11:30")); // отправка уже работала
  net.altJournal = [OLD, A];
  await jrRun(s.env, at(TODAY, "11:46")); await jrRun(s.env, at(TODAY, "12:02"));
  assert.deepEqual(sent(), [], "новая запись: подтверждение через 10 минут после записи (12:08)");
  net.altJournal = [OLD, rec(ph(6071), TOM, "17:00", { id: 6071, made: `${TODAY}T11:58:00+05:00`, name: "Айдос" })]; // перенесли до подтверждения
  await jrRun(s.env, at(TODAY, "12:18"));
  assert.equal(sent().length, 1, JSON.stringify(log(s)));
  assert.match(sent()[0].text, /Айдос! Вы записаны в Winchester на 20 октября в 17:00/, "одно подтверждение — сразу с новым временем");
  assert.ok(!sent().some(x => /перенесена/.test(x.text)), "о переносе отдельно не пишем");
  assert.ok(!sent().some(x => x.to === dg(6072)), "старой записи подтверждение не шлём");
});

test("ТЗ v4: подтверждение сразу — новую запись видит быстрое чтение журнала раз в минуту; повторно не шлём и ничего не переписываем", async () => {
  net.reset();
  const OLD = rec(ph(6091), TOM, "16:00", { id: 6091 });
  net.altJournal = [OLD];
  const s = mk(ENV); await approveAll(s); await autoOn(s, { confirm: true });
  await jrRun(s.env, at(TODAY, "12:00")); // полное чтение журнала
  net.altJournal = [OLD, rec(ph(6092), TOM, "15:00", { id: 6092, made: `${TODAY}T12:03:00+05:00`, name: "Айдос" })];
  net.alt.length = 0;
  await jrRun(s.env, at(TODAY, "12:04")); // до следующего полного чтения 11 минут — быстрое чтение изменённых записей
  assert.ok(net.alt.some(x => /^GET \/records\/133486\?changed_after=/.test(x)), net.alt.join("\n"));
  assert.ok(!net.alt.some(x => x.includes(`start_date=${YDAY}`)), "полное чтение (со вчера на 14 дней) не нужно; перед отправкой — только день записи: " + net.alt.join("\n"));
  assert.equal(sent().length, 1, JSON.stringify(log(s)));
  assert.equal(sent()[0].to, dg(6092)); assert.match(sent()[0].text, /Айдос! Вы записаны в Winchester на 20 октября в 15:00/);
  const before = [s.kv.mem.get("jrb:winchester"), s.kv.mem.get("jrq:winchester")];
  await jrRun(s.env, at(TODAY, "12:05")); await jrRun(s.env, at(TODAY, "12:06"));
  assert.equal(sent().length, 1, "та же запись в окне быстрого чтения — второго сообщения нет");
  assert.deepEqual([s.kv.mem.get("jrb:winchester"), s.kv.mem.get("jrq:winchester")], before, "ничего нового — хранилище не переписано");
  // только напоминания, без подтверждения и переноса — быстрого чтения нет (лишние запросы к Altegio не нужны)
  const s2 = mk(ENV); await approveAll(s2); await autoOn(s2, { remind24: true });
  await jrRun(s2.env, at(TODAY, "12:00")); net.alt.length = 0;
  await jrRun(s2.env, at(TODAY, "12:04"));
  assert.ok(!net.alt.some(x => /^GET \/records\//.test(x)), net.alt.join("\n"));
});

test("ТЗ v4: текст подтверждения как в уведомлении Altegio — вариант b2", () => {
  const sc = SCENARIOS.find(x => x.id === "S01");
  assert.equal(sc.ru.length, 2);
  assert.equal(sc.ru[1], "Вы записаны[[ на услугу: {услуга}]]\n[[Барбер: {мастер}\n]]Дата: {дата с годом} в {время}.[[\nДетали: {детали}]]");
});

test("дубли: одна запись, вид и версия — одно сообщение, даже если отметка в KV потерялась (отметка D1); две одновременные отправки с одним ключом — одна", { skip }, async () => {
  net.reset();
  net.altJournal = [rec(ph(6081), TOM, "15:00", { id: 6081 })];
  const s = mk(withD1()); await approveAll(s); await autoOn(s, { remind24: true });
  await jrRun(s.env, at(TODAY, "17:00")); await jrRun(s.env, at(TODAY, "18:00"));
  assert.equal(sent().length, 1);
  // в другой точке сети отметка KV ещё не видна: задача снова в очереди, отметки rms: нет
  for (const k of [...s.kv.mem.keys()].filter(k => k.startsWith("rms:"))) s.kv.mem.delete(k);
  const q = [{ rec: "6081", v: (await jrqLoad(s.env, "winchester"))[0]?.v, k: "d1", at: at(TODAY, "18:00"), p: dg(6081), n: "Клиент", date: TOM, time: "15:00", staff: "Тони", svc: "Мужская стрижка" }];
  const ver = s.kv.json("jrb:winchester")["6081"].v;
  q[0].v = ver;
  s.kv.mem.set("jrq:winchester", JSON.stringify(q));
  await jrRun(s.env, at(TODAY, "18:02"));
  assert.equal(sent().length, 1, "отметка D1 не дала отправить второй раз");
  assert.ok(log(s).some(x => /отметка в базе/.test(x.why)), JSON.stringify(log(s)));
  let calls = 0;
  const fn = async () => { calls++; await new Promise(r => setTimeout(r, 5)); return { ok: true, id: "X" }; };
  const both = await Promise.all([sendOnceAuto(s.env, "winchester", "77000006082", "a-d1-1-x", fn), sendOnceAuto(s.env, "winchester", "77000006082", "a-d1-1-x", fn)]);
  assert.equal(calls, 1); assert.ok(both.some(x => "dup" in x));
});

test("повторная доставка вебхука о статусе: второго сообщения нет, счётчики не двоятся, галочки — по последнему статусу", async () => {
  net.reset();
  net.altJournal = [rec(ph(6091), TOM, "15:00", { id: 6091 })];
  const s = mk(withD1()); await approveAll(s); await autoOn(s, { remind24: true });
  await jrRun(s.env, at(TODAY, "17:00")); await jrRun(s.env, at(TODAY, "18:00"));
  assert.equal(sent().length, 1);
  const mid = s.hist("ga", "winchester", dg(6091)).turns.at(-1).mid;
  assert.ok(mid);
  const hook = body => s.call(`/ga/winchester?t=${gaPass("winchester", INST)}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ instanceData: { idInstance: +INST.id, wid: "77000000077@c.us" }, timestamp: Math.floor(Date.now() / 1000), ...body }) });
  for (let i = 0; i < 2; i++) assert.equal((await hook({ typeWebhook: "outgoingMessageStatus", chatId: dg(6091) + "@c.us", idMessage: mid, status: "delivered", sendByApi: true })).status, 200);
  await hook({ typeWebhook: "outgoingMessageStatus", chatId: dg(6091) + "@c.us", idMessage: mid, status: "read", sendByApi: true });
  await hook({ typeWebhook: "outgoingMessageStatus", chatId: dg(6091) + "@c.us", idMessage: mid, status: "delivered", sendByApi: true });
  await jrRun(s.env, at(TODAY, "18:30"));
  assert.equal(sent().length, 1, "второго сообщения нет");
  assert.equal(s.hist("ga", "winchester", dg(6091)).turns.at(-1).st, "read", "статус только растёт");
  assert.equal(s.kv.json(`msgn:winchester:${TODAY}`).remind24.s, 1, "счётчик «ушло» — один раз");
});

test("отказы: «стоп» и полный запрет закрывают и сервисные; отказ от рекламы в Altegio — только рекламу", { skip }, async () => {
  net.reset();
  const d = d1With("production");
  net.altJournal = [rec(ph(6101), TOM, "15:00", { id: 6101 }), rec(ph(6102), TOM, "15:30", { id: 6102 }), rec(ph(6103), TOM, "16:00", { id: 6103 }), rec(ph(6104), TOM, "16:30", { id: 6104 })];
  const s = mk({ ...ENV, DB: d.db }); await approveAll(s); await autoOn(s, { remind24: true });
  await s.kv.api.put(`optout:winchester:${dg(6101)}`, "1");
  for (const [i, kind, source] of [[6102, "full_block", "admin"], [6103, "marketing_optout", "altegio"]]) {
    const r = await contactAdd(d.db, "winchester", { id: "c" + i, phone: dg(i), name: "", search: dg(i), at: 1, actor: "owner" });
    await restrictionAdd(d.db, "winchester", { contactId: (r && r.id) || "c" + i, kind, reason: "проверка", source, actor: "owner", at: 1 });
  }
  await jrRun(s.env, at(TODAY, "17:00")); await jrRun(s.env, at(TODAY, "18:00")); await jrRun(s.env, at(TODAY, "18:01"));
  assert.deepEqual(sent().map(x => x.to).sort(), [dg(6103), dg(6104)], "«стоп» и полный запрет — нет; отказ от рекламы — сервисное уходит");
});

test("реклама при запрете gaNoBroadcast: день рождения и реактивация не шлют, даже если включены в хранилище; Altegio не спрашиваем", async () => {
  net.reset();
  net.altClients = [{ id: 1, name: "Арман", phone: ph(6111), bd: "1990-10-19" }];
  const s = mk(withD1());
  await autoOn(s, { birthday: true, reactivate: true });
  await mkRun(s.env, at(TODAY, "11:00")); await mkRun(s.env, at(TODAY, "12:00")); await mkRun(s.env, at(TODAY, "12:01"));
  assert.deepEqual(sent(), []);
  assert.ok(!net.alt.some(x => /clients\/search/.test(x)), net.alt.join("\n"));
});

test("день рождения (запрет снят в проверке): только с подтверждённым согласием, без «стопа», раз в год, в выбранное время, с отказом в тексте", { skip }, async () => {
  net.reset();
  const was = W.gaNoBroadcast; W.gaNoBroadcast = false;
  try {
    const d = d1With("production");
    net.altClients = [{ id: 1, name: "Арман Каримов", phone: ph(6121), bd: "1990-10-19" }, { id: 2, name: "Ерлан", phone: ph(6122), bd: "1985-10-19" },
      { id: 3, name: "Айдос", phone: ph(6123), bd: "1985-10-19" }, { id: 4, name: "Тимур", phone: ph(6124), bd: "1992-05-01" }];
    const s = mk({ ...ENV, DB: d.db });
    for (const i of [6121, 6123]) {
      const r = await contactAdd(d.db, "winchester", { id: "c" + i, phone: dg(i), name: "", search: dg(i), at: 1, actor: "owner" });
      await consentAdd(d.db, "winchester", { contactId: (r && r.id) || "c" + i, purpose: "marketing", state: "granted", basis: "письменное согласие", source: "manual", actor: "owner", at: 1, evidence: "document", evidenceRef: "тест", confirmed: true, givenAt: 1 });
    }
    await s.kv.api.put(`optout:winchester:${dg(6123)}`, "1");
    const own = await login(s, OWNER);
    assert.equal((await set(own, { id: "birthday", on: true })).status, 200, "запрет снят — включается");
    await mkRun(s.env, at(TODAY, "10:59"));
    assert.deepEqual(sent(), [], "до выбранного времени (11:00) — нет");
    await mkRun(s.env, at(TODAY, "11:00")); await mkRun(s.env, at(TODAY, "11:01"));
    assert.deepEqual(sent().map(x => x.to), [dg(6121)], "только с согласием и без «стопа»");
    assert.match(sent()[0].text, /^Арман, с днём рождения!/); assert.match(sent()[0].text, /«стоп»/);
    assert.ok(net.alt.filter(x => /clients\/search/.test(x)).length >= 1);
    assert.deepEqual(net.alt.filter(x => !/^GET /.test(x) && !/^POST \/locations\/\d+\/clients\/search$/.test(x)), [], "Altegio — только чтение");
    await mkRun(s.env, at(TODAY, "15:00")); await mkRun(s.env, at(TOM, "11:00"));
    assert.equal(sent().length, 1, "раз в год и только в свой день");
    assert.ok(s.kv.json(`bcm:winchester:${TODAY}`).includes(dg(6121)), "реклама за день — отметка (30 дней ничего рекламного)");
    assert.equal(s.kv.json(`msgn:winchester:${TODAY}`).birthday.s, 1);
    assert.ok(sc(await info(own), "birthday").log.some(x => x.st === "planned"));
  } finally { W.gaNoBroadcast = was; }
});

test("реактивация (запрет снят в проверке): ровно N дней с визита, только с согласием, не больше предела в день", { skip }, async () => {
  net.reset();
  const was = W.gaNoBroadcast; W.gaNoBroadcast = false;
  try {
    const d = d1With("production"), now = at(TODAY, "12:00");
    const last = n => new Date(now - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
    const s = mk({ ...ENV, DB: d.db });
    await s.kv.api.put("crm:winchester:snap", JSON.stringify({ at: now, list: [
      { p: dg(6131), n: "Арман", last: last(45), first: last(100), v: 2, staff: "Тони", svc: "Мужская стрижка" },
      { p: dg(6132), n: "Ерлан", last: last(45), first: last(100), v: 2, staff: "Тони", svc: "Мужская стрижка" },
      { p: dg(6133), n: "Айдос", last: last(45), first: last(100), v: 2, staff: "Тони", svc: "Мужская стрижка" },
      { p: dg(6134), n: "Тимур", last: last(44), first: last(100), v: 2, staff: "Тони", svc: "Мужская стрижка" }], futOnly: [] }));
    for (const i of [6131, 6132, 6134]) {
      const r = await contactAdd(d.db, "winchester", { id: "c" + i, phone: dg(i), name: "", search: dg(i), at: 1, actor: "owner" });
      await consentAdd(d.db, "winchester", { contactId: (r && r.id) || "c" + i, purpose: "marketing", state: "granted", basis: "письменное согласие", source: "manual", actor: "owner", at: 1, evidence: "document", evidenceRef: "тест", confirmed: true, givenAt: 1 });
    }
    await autoOn(s, { reactivate: true }, { reactivate: { days: 45, time: "12:00", cap: 1 } });
    await mkRun(s.env, now); await mkRun(s.env, now + 60e3); await mkRun(s.env, now + 120e3);
    assert.equal(sent().length, 1, "предел 1 в день");
    assert.ok([dg(6131), dg(6132)].includes(sent()[0].to), "45 дней и согласие; без согласия (6133) и 44 дня (6134) — нет");
    assert.match(sent()[0].text, /Давно вас не видели в Winchester/);
  } finally { W.gaNoBroadcast = was; }
});

test("база клиентов без согласий: клиенты видны в сегментах, списке и примере текста со статусами; реклама — 0, сервисные — все без «стопа»", async () => {
  net.reset();
  const now = Date.now(), last = n => new Date(now - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
  const s = mk(withD1());
  await s.kv.api.put("crm:winchester:snap", JSON.stringify({ at: now, masked: 2, bad: 1, list: [
    { p: dg(6141), n: "Арман", last: last(25), first: last(80), v: 2, staff: "Тони", svc: "Мужская стрижка" },
    { p: dg(6142), n: "Ерлан", last: last(28), first: last(80), v: 1, staff: "Рауан", svc: "Мужская стрижка", fut: 1 },
    { p: dg(6143), n: "Айдос", last: last(30), first: last(80), v: 3, staff: "Тони", svc: "Борода" }], futOnly: [dg(6144)] }));
  await s.kv.api.put(`optout:winchester:${dg(6143)}`, "1");
  const own = await login(s, OWNER);
  const seg = await (await own.go("/api/crm/segments?c=winchester")).json();
  assert.deepEqual(seg.statuses, { base: 7, valid: 4, booked: 2, service: 3, marketing: 0, stopped: 1, refused: 0, ready: 0, invalid: 3 });
  const pora = seg.segments.find(x => x.id === "pora");
  assert.equal(pora.n, 0, "рекламу сейчас получат — 0"); assert.equal(pora.total, 3, "но в сегменте трое");
  assert.equal(pora.st.service, 2); assert.equal(pora.st.stopped, 1);
  let r = await (await own.go("/api/crm/list?c=winchester&seg=pora")).json();
  assert.equal(r.total, 0, "старый список — только кому можно");
  r = await (await own.go("/api/crm/list?c=winchester&seg=pora&all=1")).json();
  assert.equal(r.total, 3); assert.equal(r.all, true);
  assert.deepEqual(r.list.map(x => [x.name, x.why]), [["Арман", "нет согласия на рекламу"], ["Ерлан", "нет согласия на рекламу"], ["Айдос", "просил не писать («стоп»)"]]);
  assert.ok(r.list.every(x => x.phone.includes("***")), "номера маской");
  assert.deepEqual(r.list[1].st, { booked: true, service: true, marketing: false, stopped: false, refused: false, ready: false });
  const pv = await (await own.post("/api/bc/templates/preview", { c: "winchester", id: "W02", lang: "ru", segment: "pora" })).json();
  assert.equal(pv.demo, false, "пример — на настоящих клиентах сегмента");
  assert.ok(pv.list.length >= 2 && pv.list.every(x => x.allowed === false && x.why), JSON.stringify(pv.list));
  assert.match(pv.list[0].text, /^Здравствуйте, Арман!/);
});

test("Altegio «не получать массовые уведомления» — отказ от рекламы (раньше терялся), сервисные не закрывает; флаг сняли — отказ снят", { skip }, async () => {
  net.reset();
  const d = d1With("production"), now = Date.now(), day = n => new Date(now - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
  net.altJournal = [rec(ph(6151), day(10), "12:00", { id: 6151 })];
  net.altClients = [{ id: 1, name: "Арман", phone: ph(6151), last_visit_date: day(10), visits_count: 3, nomass: true }, { id: 2, name: "Ерлан", phone: ph(6152), last_visit_date: day(20), visits_count: 1 }];
  const s = mk({ ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", DB: d.db });
  for (let i = 0; i < 6; i++) await syncStep(s.env, W, now + i * 16 * 60e3, { force: true });
  const row = d.raw.prepare("select r.* from restrictions r join contacts c on c.id = r.contact_id where c.phone = ? and r.source = 'altegio'").get(dg(6151));
  assert.ok(row && row.kind === "marketing_optout" && !row.lifted_at, "отказ из Altegio записан");
  const { marketingGate } = await import("../../src/services/contacts/gate.js");
  const g = await marketingGate(s.env, W, now);
  assert.equal(g.reasons.get(dg(6151)), "denied", "реклама закрыта как отказ, а не как «стоп»");
  // флаг сняли в Altegio — следующий полный проход справочника снимает отказ
  net.altClients[0].nomass = false;
  for (let i = 0; i < 6; i++) await syncStep(s.env, W, now + 8 * 86400e3 + i * 16 * 60e3, { force: true });
  const again = d.raw.prepare("select r.* from restrictions r join contacts c on c.id = r.contact_id where c.phone = ? and r.source = 'altegio'").get(dg(6151));
  assert.ok(again.lifted_at, "отказ снят");
  assert.deepEqual(net.alt.filter(x => !/^GET /.test(x) && !/^POST \/locations\/\d+\/clients\/search$/.test(x)), [], "Altegio — только чтение");
});

test("база контактов D1 у адреса есть, но не ответила: сервисное сообщение не уходит (полный запрет есть только в D1), ответила — уходит", { skip }, async () => {
  net.reset();
  net.altJournal = [rec(ph(6161), TOM, "15:00", { id: 6161 })];
  const good = d1With("production").db;
  const s = mk({ ...ENV, DB: good }); await approveAll(s); await autoOn(s, { remind24: true });
  await jrRun(s.env, at(TODAY, "17:00"));
  s.env.DB = { prepare() { throw new Error("D1 не отвечает"); }, batch() { throw new Error("D1 не отвечает"); } };
  await jrRun(s.env, at(TODAY, "18:00"));
  assert.deepEqual(sent(), [], "закрыто при сомнении");
  assert.ok(log(s).some(x => x.k === "d1" && /база клиентов не ответила/.test(x.why)), JSON.stringify(log(s)));
  s.env.DB = good;
  await jrRun(s.env, at(TODAY, "18:05"));
  assert.equal(sent().length, 1, "база ответила — ушло");
});

test("отказы Altegio на нескольких страницах: ставятся все; снимаются только по полному списку прохода; список потерян посреди прохода — не снимаем", { skip }, async () => {
  net.reset();
  const d = d1With("production"), now = Date.now(), day = n => new Date(now - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
  net.altJournal = [];
  net.altClients = Array.from({ length: 205 }, (_, i) => ({ id: i + 1, name: "Клиент " + i, phone: "+7700002" + String(i).padStart(4, "0"), last_visit_date: day(10 + (i % 50)), visits_count: 2, nomass: true }));
  const s = mk({ ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", DB: d.db });
  const active = () => d.raw.prepare("select count(*) n from restrictions where ws = 'winchester' and source = 'altegio' and kind = 'marketing_optout' and lifted_at is null").get().n;
  for (let i = 0; i < 8; i++) await syncStep(s.env, W, now + i * 16 * 60e3, { force: true });
  assert.equal(active(), 205, "все отказы с обеих страниц поставлены");
  // у одного клиента флаг сняли — следующий полный проход снимает только его отказ
  net.altClients[3].nomass = false;
  for (let i = 0; i < 8; i++) await syncStep(s.env, W, now + 8 * 86400e3 + i * 16 * 60e3, { force: true });
  assert.equal(active(), 204);
  // курсор посреди прохода без списка первой страницы (прежняя версия кода): снимать по неполному списку нельзя
  for (const c of net.altClients.slice(0, 200)) c.nomass = false; // будто бы на первой странице флагов больше нет — но эту страницу в проходе не читали
  const row = d.raw.prepare("select cursor from sync_state where ws = 'winchester' and scope = 'clients'").get();
  const cur = { ...JSON.parse(row.cursor || "{}"), page: 2, phase: "nomass", done: false };
  delete cur.nm;
  d.raw.prepare("update sync_state set cursor = ?, last_ok_at = null where ws = 'winchester' and scope = 'clients'").run(JSON.stringify(cur));
  await syncStep(s.env, W, now + 16 * 86400e3, { force: true });
  const after = d.raw.prepare("select cursor, last_ok_at from sync_state where ws = 'winchester' and scope = 'clients'").get();
  assert.ok(after.last_ok_at && JSON.parse(after.cursor).done, "проход дошёл до конца: " + after.cursor);
  assert.equal(active(), 204, "список неполный — ни один отказ не снят");
});

test("время и текст одним запросом: ошибка в тексте не оставляет сохранённым новое время; вставки для кнопок — и те, что уже в тексте", async () => {
  net.reset();
  const s = mk(ENV), own = await login(s, OWNER);
  const r = await set(own, { id: "remind3", timing: { hours: 5 }, text: { ru: "Ждём вас {когда-нибудь}." } });
  assert.equal(r.status, 400);
  const j = await info(own);
  assert.equal(sc(j, "remind3").timing.hours, 3, "время не сохранилось");
  assert.ok(sc(j, "remind24").text.vars.includes("компания") && sc(j, "remind24").text.vars.includes("услуга и мастер"), JSON.stringify(sc(j, "remind24").text.vars));
  assert.equal((await set(own, { id: "remind3", timing: { hours: 5 }, text: { ru: "Ждём вас сегодня в {время}." } })).status, 200);
  const k = sc(await info(own), "remind3");
  assert.equal(k.timing.hours, 5); assert.equal(k.text.ru, "Ждём вас сегодня в {время}.");
});

// ТЗ v4 §6 (08.11.2026): реклама автосообщений не видела записей, сделанных сегодня; поздравление не проверяло запись и недавний визит
const grant = async (d, list) => { for (const i of list) {
  const r = await contactAdd(d.db, "winchester", { id: "c" + i, phone: dg(i), name: "", search: dg(i), at: 1, actor: "owner" });
  await consentAdd(d.db, "winchester", { contactId: (r && r.id) || "c" + i, purpose: "marketing", state: "granted", basis: "письменное согласие", source: "manual", actor: "owner", at: 1, evidence: "document", evidenceRef: "тест", confirmed: true, givenAt: 1 });
} };

test("ТЗ v4: день рождения — не поздравляем рекламой того, кто записан или был меньше 14 дней назад; Altegio не ответил — день пропущен", { skip }, async () => {
  net.reset();
  const was = W.gaNoBroadcast; W.gaNoBroadcast = false;
  try {
    const d = d1With("production");
    net.altClients = [{ id: 1, name: "Арман", phone: ph(6201), bd: "1990-10-19", last_visit_date: "2026-08-01 12:00:00" },
      { id: 2, name: "Ерлан", phone: ph(6202), bd: "1985-10-19", last_visit_date: "2026-10-12 12:00:00" }, // был 7 дней назад
      { id: 3, name: "Айдос", phone: ph(6203), bd: "1985-10-19", last_visit_date: "2026-07-01 12:00:00" }]; // записан на завтра
    net.altJournal = [rec(ph(6203), TOM, "15:00", { id: 6203 })];
    const s = mk({ ...ENV, DB: d.db });
    await grant(d, [6201, 6202, 6203]);
    await autoOn(s, { birthday: true }, { birthday: { time: "11:00" } });
    await mkRun(s.env, at(TODAY, "11:00")); await mkRun(s.env, at(TODAY, "11:01"));
    assert.deepEqual(sent().map(x => x.to), [dg(6201)], JSON.stringify(sent()));
    // в другой компании того же дня Altegio не отвечает: поздравлений нет, в журнале — почему
    net.reset();
    net.altClients = [{ id: 1, name: "Арман", phone: ph(6201), bd: "1990-10-19" }];
    net.altJournalFail = 500;
    const s2 = mk({ ...ENV, DB: d1With("production").db });
    await autoOn(s2, { birthday: true }, { birthday: { time: "11:00" } });
    await mkRun(s2.env, at(TODAY, "11:00")); await mkRun(s2.env, at(TODAY, "11:01"));
    assert.deepEqual(sent(), []);
    assert.ok(JSON.parse((await s2.kv.api.get("jrl:winchester")) || "[]").some(x => /не удалось собрать получателей/.test(x.why)));
  } finally { W.gaNoBroadcast = was; net.altJournalFail = 0; }
});

test("ТЗ v4: реактивация — записался сегодня (после ночного снимка) — не пишем: ни при сборе, ни перед отправкой", { skip }, async () => {
  net.reset();
  const was = W.gaNoBroadcast; W.gaNoBroadcast = false;
  try {
    const d = d1With("production"), now = at(TODAY, "12:00");
    const last = n => new Date(now - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
    const s = mk({ ...ENV, DB: d.db });
    const row = i => ({ p: dg(i), n: "Клиент", last: last(45), first: last(100), v: 2, staff: "Тони", svc: "Мужская стрижка" });
    await s.kv.api.put("crm:winchester:snap", JSON.stringify({ at: now, list: [row(6211), row(6212), row(6213)], futOnly: [] }));
    await grant(d, [6211, 6212, 6213]);
    net.altJournal = [rec(ph(6211), TOM, "15:00", { id: 6211 })]; // записался утром, снимок ночью этого не знал
    await autoOn(s, { reactivate: true }, { reactivate: { days: 45, time: "12:00", cap: 10 } });
    await mkRun(s.env, now); // собрал очередь: 6212 и 6213; ушло не больше 2 за минуту
    const first = sent().map(x => x.to);
    assert.ok(!first.includes(dg(6211)), "записанного утром нет в очереди");
    const rest = [dg(6212), dg(6213)].filter(p => !first.includes(p));
    for (const p of rest) net.altJournal.push(rec("+" + p, TOM, "16:00", { id: +p.slice(-4) + 10 })); // ещё один записался после сбора очереди
    await mkRun(s.env, now + 60e3); await mkRun(s.env, now + 120e3);
    assert.deepEqual(sent().map(x => x.to).filter(p => rest.includes(p)), [], "записался после сбора очереди — перед отправкой проверили");
  } finally { W.gaNoBroadcast = was; }
});

test("ТЗ v4: перенос и отмена, замеченные вечером после часов отправки, уходят утром (раньше пропадали: «время отправки прошло»)", async () => {
  net.reset();
  const A = rec(ph(6221), "2026-10-21", "15:00", { id: 6221, name: "Арман" }), B = rec(ph(6222), "2026-10-21", "16:00", { id: 6222, name: "Ерлан" });
  net.altJournal = [A, B];
  const s = mk(ENV); await approveAll(s); await autoOn(s, { move: true, cancel: true });
  await jrRun(s.env, at(TODAY, "22:00"));
  net.altJournal = [rec(ph(6221), "2026-10-21", "17:00", { id: 6221, name: "Арман" })]; // перенесли A, удалили B — в 22:15
  await jrRun(s.env, at(TODAY, "22:16"));
  assert.deepEqual(sent(), [], "ночью не пишем");
  for (const t of ["23:00", "07:00"]) await jrRun(s.env, t === "23:00" ? at(TODAY, t) : at(TOM, t));
  assert.deepEqual(sent(), []);
  await jrRun(s.env, at(TOM, "10:00")); await jrRun(s.env, at(TOM, "10:01"));
  const out = sent();
  assert.equal(out.length, 2, JSON.stringify(log(s).filter(x => x.k === "s06" || x.k === "cx")));
  assert.ok(out.some(x => x.to === dg(6221) && /17:00/.test(x.text)) && out.some(x => x.to === dg(6222) && /отменена/.test(x.text)), JSON.stringify(out));
});
