// База клиентов из журнала Altegio (docs/tz-winchester-v2.md §4–§5.1, 19.10.2026): снимок за 90 дней, сегменты и исключения,
// API пульта (/api/crm/*: номера маской, права), обновление кнопкой и ночью. Всё на заглушках: журнал — net.altJournal (страницы, даты).
// Номера вымышленные (+7 700 000 0x xx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { crmBuild, crmFold, crmRun } from "../../src/services/crm/snapshot.js";
import { crmSegments, crmPick, crmView, daysSince } from "../../src/services/crm/segments.js";
import { altRecordsRange } from "../../src/services/integrations/altegio/records-api.js";
import { bcmAdd } from "../../src/db/kv/crm.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";

const W = CLIENTS.winchester, OWNER = "owner-key-123456", STAFF_W = "staff-key-winch-0001", STAFF_B = "staff-key-barber-0001";
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", KEY_WINCHESTER: STAFF_W, KEY_BARBER: STAFF_B };
const NOW = Date.now(); // часы обвязки: 3 октября 2026, 12:00 по Астане
const day = n => new Date(NOW - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10); // n дней назад по Астане (n < 0 — вперёд)
let rid = 0;
// запись журнала, как её отдаёт Altegio: n дней назад (отрицательное — будущая), attendance 1 — пришёл, -1 — не пришёл
const rec = (phone, n, o = {}) => ({ id: ++rid, datetime: `${day(n)}T${o.t || "12:00"}:00+05:00`, deleted: !!o.del, attendance: o.att ?? 1, ...(o.va !== undefined ? { visit_attendance: o.va } : {}),
  staff: { id: 1, name: o.staff || "Тони" }, client: { id: o.cid || +String(phone).replace(/\D/g, "").slice(-6) || 1, phone, name: o.name ?? "Клиент" }, services: [{ id: 1, title: o.svc || "Мужская стрижка" }] });
const ph = i => "+7700000" + String(i).padStart(4, "0"); // +77000000101 и т. п.
const dg = i => ph(i).slice(1);

async function login(s, key) {
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${encodeURIComponent(key)}&next=%2Finbox` });
  assert.ok(b.cookie, "вход ключом " + key.slice(0, 9));
  return b;
}

test("снимок: визиты, неявки, удалённые, будущие записи, скрытые и неверные номера, несколько страниц", async () => {
  net.reset();
  net.altJournal = [
    rec(ph(101), 50, { name: "Арман", staff: "Тони" }), rec(ph(101), 25, { name: "Арман К.", staff: "Азамат", svc: "Premium" }),   // 2 визита, последний — у Азамата
    rec(ph(102), 30), rec(ph(102), 5, { att: -1 }),                                                                              // неявка — не визит
    rec(ph(103), 10, { del: true }),                                                                                             // удалённая — нет в базе
    rec(ph(104), 40), rec(ph(104), -3),                                                                                          // есть будущая запись
    rec("+7 700 XXX-X1-05", 20, { cid: 5 }), rec("+7 700 XXX-X1-05", 60, { cid: 5 }),                                           // скрытый номер — один клиент
    rec("12345", 15, { cid: 6 }),                                                                                                // неверный номер
    rec(ph(107), 12, { svc: "Мужская стрижка" }), rec(ph(107), 12, { t: "13:00", svc: "Моделирование бороды" }),                // две записи одного дня — один визит
    rec(ph(108), 100),                                                                                                           // старше 90 дней — вне окна
    rec(ph(109), 8, { att: 0, va: -1 }),                                                                                         // visit_attendance = -1 — не пришёл
    ...Array.from({ length: 450 }, (_, i) => rec(ph(1000 + i), 1 + (i % 89)))                                                   // ещё 450 клиентов — три страницы по 200
  ];
  const s = mk(ENV);
  const meta = await crmBuild(s.env, W, NOW);
  const pages = net.alt.filter(x => /^GET \/records\/133486\?/.test(x));
  assert.equal(pages.length, 3, pages.join("\n"));
  assert.ok(pages.every(x => x.includes(`start_date=${day(90)}`) && x.includes(`end_date=${day(-60)}`) && x.includes("count=200")), pages[0]);
  assert.equal(meta.records, net.altJournal.length - 1, "запись старше 90 дней Altegio не отдал");
  assert.equal(meta.masked, 1); assert.equal(meta.bad, 1); assert.equal(meta.cut, false);
  assert.equal(meta.clients, 4 + 450, JSON.stringify(meta)); // 101, 102, 104, 107 и 450 других
  assert.ok(meta.att["1"] > 450 && meta.att["-1"] === 1 && meta.att["0"] === 1, JSON.stringify(meta.att));
  assert.ok(!("list" in meta), "мета-данные — без списка");
  const snap = s.kv.json("crm:winchester:snap"), by = Object.fromEntries(snap.list.map(x => [x.p, x]));
  assert.ok(s.kv.ttl.get("crm:winchester:snap") >= 29 * 86400);
  assert.deepEqual({ ...by[dg(101)] }, { p: dg(101), n: "Арман К.", last: day(25), first: day(50), v: 2, staff: "Азамат", svc: "Premium" });
  assert.equal(by[dg(102)].v, 1); assert.equal(by[dg(102)].last, day(30));
  assert.ok(!by[dg(103)] && !by[dg(108)] && !by[dg(109)], "удалённая, вне окна, неявка — не в базе");
  assert.equal(by[dg(104)].fut, 1); assert.ok(!("fut" in by[dg(101)]));
  assert.equal(by[dg(107)].v, 1); assert.equal(by[dg(107)].svc, "Мужская стрижка + Моделирование бороды");
  assert.ok(!JSON.stringify(snap).includes("XXX"), "скрытые номера в список не попали");
});

test("журнал длиннее предела страниц — cut: true; без ключа журнала — понятная ошибка и ни одного запроса", async () => {
  net.reset();
  net.altJournal = Array.from({ length: 450 }, (_, i) => rec(ph(2000 + i), 3));
  const s = mk(ENV);
  const r = await altRecordsRange(s.env, "usr-tok", 133486, day(90), day(-60), 2);
  assert.equal(r.list.length, 400); assert.equal(r.cut, true); assert.equal(r.pages, 2);
  net.alt.length = 0;
  const s2 = mk({ ALTEGIO_PARTNER: "partner-test" });
  await assert.rejects(crmBuild(s2.env, W, NOW), e => /ALTEGIO_USER_WINCHESTER/.test(e.message) && e.code === "setup");
  assert.equal(net.alt.length, 0);
});

test("Altegio не пускает ключ — текст для владельца, ошибка видна в сегментах, прежняя база остаётся", async () => {
  net.reset();
  net.altJournal = [rec(ph(101), 25)];
  const s = mk(ENV);
  await crmBuild(s.env, W, NOW);
  net.altJournalFail = 401;
  try { await assert.rejects(crmBuild(s.env, W, NOW + 60e3), e => e.code === "altegio" && /ключ/.test(e.message) && !/Unauthorized/.test(e.message)); }
  finally { net.altJournalFail = 0; }
  const sg = await crmSegments(s.env, W, NOW + 120e3);
  assert.equal(sg.clients, 1);
  assert.ok(/ключ/.test(sg.error || ""), JSON.stringify(sg));
});

// база для сегментов: у каждого номера своя причина попасть или не попасть
async function segBase() {
  net.reset();
  net.altJournal = [
    rec(ph(101), 25),                                         // пора
    rec(ph(102), 40),                                         // давно
    rec(ph(103), 70),                                         // уходят
    rec(ph(104), 80), rec(ph(104), 50), rec(ph(104), 22),     // пора, постоянный
    rec(ph(105), 28),                                         // написал «стоп»
    rec(ph(106), 30), rec(ph(106), -2),                       // записан на послезавтра
    rec(ph(107), 10),                                         // был 10 дней назад
    rec(ph(108), 33),                                         // писали маркетинг 5 дней назад
    rec(ph(109), 33),                                         // писали 20 дней назад — уже можно
    rec(ph(110), 45, { staff: "Азамат" })                     // давно, у Азамата
  ];
  const s = mk(ENV);
  await crmBuild(s.env, W, NOW);
  await s.kv.api.put(`optout:winchester:${dg(105)}`, "1");
  await bcmAdd(s.env, "winchester", day(5), ["+" + dg(108)]);
  await bcmAdd(s.env, "winchester", day(20), [dg(109)]);
  return s;
}

test("сегменты: числа по правилам и исключения (стоп, будущая запись, меньше 14 дней, маркетинг за 14 дней)", async () => {
  const s = await segBase();
  const sg = await crmSegments(s.env, W, NOW);
  const n = Object.fromEntries(sg.segments.map(x => [x.id, x.n]));
  assert.deepEqual(n, { pora: 3, davno: 2, uhodyat: 1, novye: 5, postoyannye: 1, "staff:Азамат": 1, "staff:Тони": 5 }, JSON.stringify(sg.segments));
  assert.deepEqual(sg.excluded, { stop: 1, fut: 1, recent: 1, marketed: 1 });
  assert.equal(sg.clients, 10); assert.equal(sg.ok, 6);
  assert.equal(sg.info.clients, 10); assert.ok(!("list" in sg.info));
  assert.equal(s.kv.ttl.get(`bcm:winchester:${day(5)}`), 15 * 86400);
  assert.deepEqual(s.kv.json(`bcm:winchester:${day(5)}`), [dg(108)], "отметка — цифры без «+»");
});

test("crmPick: полные номера на сервере, ровно N дней, фильтры, неизвестный сегмент", async () => {
  const s = await segBase();
  const pora = await crmPick(s.env, W, "pora", NOW);
  assert.deepEqual(pora.map(x => x.phone), [dg(104), dg(101), dg(109)], "свежие визиты первыми; номера — цифры без «+»");
  assert.deepEqual(Object.keys(pora[0]).sort(), ["d", "last", "name", "phone", "staff", "svc", "v"]);
  assert.deepEqual((await crmPick(s.env, W, "all", NOW, { days: 25 })).map(x => x.phone), [dg(101)]);
  assert.deepEqual((await crmPick(s.env, W, "all", NOW, { days: 28 })), [], "28 дней — только «стоп»");
  assert.deepEqual((await crmPick(s.env, W, "all", NOW, { from: 36, to: 60 })).map(x => x.phone), [dg(102), dg(110)]);
  assert.deepEqual((await crmPick(s.env, W, "staff:Азамат", NOW)).map(x => x.phone), [dg(110)]);
  const view = await crmView(s.env, W, NOW);
  assert.equal((await crmPick(s.env, W, "davno", NOW, { view })).length, 2, "уже прочитанный снимок");
  assert.equal(await crmPick(s.env, W, "nope", NOW), null);
  assert.equal(await crmPick(s.env, W, "staff:", NOW), null);
  const empty = mk(ENV);
  assert.deepEqual(await crmPick(empty.env, W, "pora", NOW), [], "снимка нет — никого");
});

test("дни с визита — от полуночи по Астане", () => {
  const t0 = Date.UTC(2026, 9, 2, 19, 30); // 3 октября, 00:30 по Астане
  assert.equal(daysSince("2026-10-02", t0), 1);
  assert.equal(daysSince("2026-10-02", Date.UTC(2026, 9, 3, 18, 59)), 1); // 23:59
  assert.equal(daysSince("2026-09-05", t0), 28);
  assert.equal(crmFold([rec(ph(101), 0, { t: "11:00" }), rec(ph(102), 0, { t: "18:00" })], NOW).list.length, 1, "сегодня позже — будущая запись, а не визит");
});

test("API: сегменты — владелец и сотрудник своей компании, чужой — 403, гость — 401; список — номера маской, по 50", async () => {
  net.reset();
  net.altJournal = Array.from({ length: 120 }, (_, i) => rec(ph(300 + i), 25, { name: "Гость " + i }));
  const s = mk(ENV);
  await crmBuild(s.env, W, Date.now());
  const own = await login(s, OWNER), sw = await login(s, STAFF_W), sb = await login(s, STAFF_B);
  for (const b of [own, sw]) {
    const r = await b.go("/api/crm/segments?c=winchester");
    assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store");
    const j = await r.json();
    assert.equal(j.segments.find(x => x.id === "pora").n, 120); assert.equal(j.why, ""); assert.equal(j.info.records, 120);
  }
  assert.equal((await sb.go("/api/crm/segments?c=winchester")).status, 403);
  assert.equal((await sb.go("/api/crm/list?c=winchester&seg=pora")).status, 403);
  assert.equal((await s.call("/api/crm/segments?c=winchester")).status, 401);
  const r1 = await sw.go("/api/crm/list?c=winchester&seg=pora"), t1 = await r1.text(), j1 = JSON.parse(t1);
  assert.equal(r1.headers.get("cache-control"), "no-store");
  assert.equal(j1.total, 120); assert.equal(j1.pages, 3); assert.equal(j1.list.length, 50); assert.equal(j1.per, 50);
  assert.ok(!/\d{7,}/.test(t1), "полных номеров нет");
  assert.ok(!t1.includes(dg(300)) && j1.list.every(x => /^\+7 700 \*\*\* \*\* \d\d$/.test(x.phone)), JSON.stringify(j1.list[0]));
  const j3 = await (await own.go("/api/crm/list?c=winchester&seg=pora&page=3")).json();
  assert.equal(j3.list.length, 20);
  assert.equal((await own.go("/api/crm/list?c=winchester&seg=nope")).status, 400);
  assert.equal((await own.go("/api/crm/list?c=winchester&seg=all&from=-5")).status, 400);
  assert.equal((await (await own.go("/api/crm/list?c=winchester&seg=all&from=26")).json()).total, 0);
});

test("API: обновить базу — только владелец и только со своей страницы; без ключа журнала — понятный отказ", async () => {
  net.reset();
  net.altJournal = [rec(ph(101), 25), rec(ph(102), 40)];
  const s = mk(ENV), own = await login(s, OWNER), sw = await login(s, STAFF_W);
  assert.equal((await sw.post("/api/crm/refresh", { c: "winchester" })).status, 403);
  assert.equal(s.kv.json("crm:winchester:snap"), null, "сотрудник базу не обновил");
  assert.equal((await own.post("/api/crm/refresh", { c: "winchester" }, { origin: "https://evil.example" })).status, 403);
  assert.equal(s.kv.json("crm:winchester:snap"), null);
  const r = await own.post("/api/crm/refresh", { c: "winchester" }), j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.ok, true); assert.equal(j.clients, 2); assert.ok(!("list" in j));
  const r2 = await own.post("/api/crm/refresh", { c: "barber" }), j2 = await r2.json();
  assert.equal(r2.status, 409); assert.ok(/ALTEGIO_LOC_BARBER/.test(j2.error), j2.error);
  const sg = await (await own.go("/api/crm/segments?c=barber")).json();
  assert.equal(sg.at, 0); assert.ok(sg.why); assert.deepEqual(sg.segments.map(x => x.n), [0, 0, 0, 0, 0]);
});

test("ночью в 04:00 — снимок Winchester раз в день; в другой час и без ключа журнала — ничего", async () => {
  net.reset();
  net.altJournal = [rec(ph(101), 25)];
  const AT = Date.UTC(2026, 9, 2, 23, 3); // 3 октября, 04:03 по Астане
  const s = mk(ENV);
  const calls = () => net.alt.filter(x => /^GET \/records\//.test(x)).length;
  assert.equal(await crmRun(s.env, AT + 3600e3), 0); assert.equal(calls(), 0, "05:03 — не время");
  assert.equal(await crmRun(s.env, AT), 1); assert.equal(calls(), 1);
  assert.equal(s.kv.json("crm:winchester:snap").clients, 1);
  assert.equal(await crmRun(s.env, AT + 60e3), 0); assert.equal(calls(), 1, "второй раз за день — нет");
  assert.equal(await crmRun(s.env, AT + 86400e3), 1, "на следующую ночь — снова");
  const s2 = mk({ ALTEGIO_PARTNER: "partner-test" });
  assert.equal(await crmRun(s2.env, AT), 0); assert.equal(calls(), 2);
  await s.cron(AT + 2 * 86400e3); // через фоновую задачу Worker
  assert.equal(calls(), 3);
});
