// Этап 1 D1 (31.10.2026): синхронизация журнала Altegio → контакты. Первичная загрузка, окна по расписанию, удалённые и перенесённые
// записи, «не пришёл», сегменты меняются вместе с записями, аренда, восстановление после сбоев Altegio и D1, подозрительно пустой ответ,
// черновик (только проверка без записи и тестовые клиенты), проба полей. Всё на заглушках, номера вымышленные (+7 700 000 xx xx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { CLIENTS } from "../../src/config/builtin-clients.js";
import { syncStep, syncDry, syncTest, testJournal } from "../../src/services/contacts/sync.js";
import { altProbe } from "../../src/services/contacts/probe.js";
import { contactsSegments, contactsList, contactsCard, contactsStatus } from "../../src/services/contacts/index.js";

const skip = sqliteOk ? false : "node:sqlite есть только в Node 22+";
const W = CLIENTS.winchester, NOW = Date.now(); // часы обвязки: 3 октября 2026, 12:00 по Астане
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok" };
const day = n => new Date(NOW - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10); // n дней назад по Астане (n < 0 — вперёд)
let rid = 0;
const rec = (phone, n, o = {}) => ({ id: o.id || ++rid, datetime: `${day(n)}T${o.t || "12:00"}:00+05:00`, deleted: !!o.del, attendance: o.att ?? (n > 0 ? 1 : 0), ...(o.va !== undefined ? { visit_attendance: o.va } : {}),
  create_date: `${day(n + 3)}T10:00:00+05:00`, staff: { id: 1, name: o.staff || "Тони" }, client: phone === null ? undefined : { id: o.cid || 1, phone, name: o.name ?? "Клиент" }, services: [{ id: 1, title: o.svc || "Мужская стрижка" }] });
const ph = i => "+7700000" + String(i).padStart(4, "0");
const dg = i => ph(i).slice(1);
const prod = () => { const d = d1With("production"); return { d, s: mk({ ...ENV, DB: d.db }) }; };
const byPhone = (d, i) => d.raw.prepare("select * from contacts where ws = 'winchester' and phone = ?").get(dg(i));
const seg = async (env, id) => (await contactsSegments(env, W, Date.now())).segments.find(x => x.id === id);
async function full(env, now = Date.now()) { let r; for (let i = 0; i < 5; i++) { r = await syncStep(env, W, now); if (r.initial.done) return r; } return r; }

test("первичная загрузка: будущее, потом прошлое окнами; визиты по дням, «не пришёл», удалённые, скрытые номера, перерывы", { skip }, async () => {
  net.reset(); rid = 0;
  net.altJournal = [
    rec(ph(101), 50, { name: "Арман" }), rec(ph(101), 25, { name: "Арман К.", staff: "Азамат", svc: "Premium" }),
    rec(ph(102), 30), rec(ph(102), 5, { att: -1 }),
    rec(ph(103), 10, { del: true }),
    rec(ph(104), 40), rec(ph(104), -3, { staff: "Рауан" }),
    rec("+7 700 XXX-X1-05", 20, { cid: 5 }),
    rec(ph(107), 12), rec(ph(107), 12, { t: "13:00", svc: "Борода" }),
    rec(ph(108), 400), rec(ph(109), 8, { att: 0, va: -1 }),
    rec(null, 3) // перерыв мастера — записи без клиента
  ];
  const { d, s } = prod();
  const r = await full(s.env);
  assert.equal(r.initial.done, true, JSON.stringify(r.initial));
  const reqs = net.alt.filter(x => /^GET \/records\/133486\?/.test(x));
  assert.ok(reqs[0].includes(`start_date=${day(0)}`) && reqs[0].includes(`end_date=${day(-60)}`), "сначала будущее: " + reqs[0]);
  assert.ok(reqs.length >= 50 && reqs.length < 70, "прошлое окнами по 14 дней на 2 года: " + reqs.length);
  const a = byPhone(d, 101);
  assert.equal(a.name, "Арман К."); assert.equal(a.visits, 2); assert.equal(a.last_staff, "Азамат"); assert.equal(a.last_service, "Premium");
  assert.equal(byPhone(d, 102).visits, 1, "неявка — не визит");
  assert.equal(byPhone(d, 103).visits, 0, "удалённая запись — не визит");
  assert.ok(byPhone(d, 104).next_booking_at > NOW, "будущая запись");
  assert.equal(byPhone(d, 107).visits, 1, "две записи одного дня — один визит");
  assert.equal(byPhone(d, 108).visits, 1, "визит больше года назад тоже загружен");
  assert.equal(byPhone(d, 109).visits, 0, "visit_attendance = -1 — не пришёл");
  assert.equal(d.raw.prepare("select count(*) n from bookings where contact_id is null").get().n, 1, "скрытый номер: запись есть, контакта нет");
  assert.equal(d.raw.prepare("select count(*) n from bookings").get().n, net.altJournal.length - 1, "перерыв мастера не записан");
  // повторный проход без изменений ничего не переписывает
  const before = d.raw.prepare("select sum(last_seen_at) t from bookings").get().t;
  await syncStep(s.env, W, NOW + 16 * 60e3, { force: true });
  assert.equal(d.raw.prepare("select sum(last_seen_at) t from bookings").get().t, before, "неизменённые записи не переписаны");
  const st = await contactsStatus(s.env, W, Date.now(), true);
  assert.equal(st.sync.initial.done, true); assert.equal(st.sync.initial.pct, 100);
  assert.equal(st.checks.find(c => c.id === "visits").level, "ok");
  assert.equal(st.checks.find(c => c.id === "orphans").count, 1);
});

test("новые и изменённые записи меняют сегменты: записался — ушёл из «Пора», запись удалили — вернулся, «не пришёл» — визит пропал", { skip }, async () => {
  net.reset(); rid = 0;
  net.altJournal = [rec(ph(201), 25, { name: "Ерлан" }), rec(ph(202), 23), rec(ph(203), 50), rec(ph(203), 30)];
  const { d, s } = prod();
  await full(s.env);
  assert.equal((await seg(s.env, "pora")).count, 3);
  assert.equal((await seg(s.env, "zapis")).count, 0);
  // записался на послезавтра
  const fut = rec(ph(201), -2, { name: "Ерлан" });
  net.altJournal.push(fut);
  await syncStep(s.env, W, Date.now(), { force: true });
  assert.equal((await seg(s.env, "zapis")).count, 1, "новая запись — в «Есть запись»");
  const list = await contactsList(s.env, W, Date.now(), { seg: "pora" });
  assert.equal(list.items.find(x => x.phone.endsWith("01")).nextBookingAt > NOW, true);
  // администратор удалил запись — из журнала пропала
  net.altJournal.splice(net.altJournal.indexOf(fut), 1);
  await syncStep(s.env, W, Date.now() + 16 * 60e3, { force: true });
  assert.equal((await seg(s.env, "zapis")).count, 0, "удалённая запись — снова без записи");
  assert.equal(d.raw.prepare("select deleted from bookings where record_id = ?").get(String(fut.id)).deleted, 1);
  // администратор отметил «не пришёл» на визите 30 дней назад (окно «прошлое» — раз в сутки после 04:00)
  net.altJournal.find(x => x.client.phone === ph(203) && x.datetime.startsWith(day(30))).attendance = -1;
  await syncStep(s.env, W, Date.now() + 24 * 3600e3, { force: true });
  const c = byPhone(d, 203);
  assert.equal(c.visits, 1); assert.equal(Math.round((NOW - c.last_visit_at) / 86400e3), 50);
  assert.equal((await seg(s.env, "davno")).count, 1, "последний визит 50 дней назад — «Давно не были»");
  assert.equal((await seg(s.env, "pora")).count, 2, "и ушёл из «Пора на стрижку»");
  // перенос записи на другой день — та же запись (id), новое время
  const mv = rec(ph(202), -5); net.altJournal.push(mv);
  await syncStep(s.env, W, Date.now() + 25 * 3600e3, { force: true });
  mv.datetime = `${day(-9)}T15:00:00+05:00`;
  await syncStep(s.env, W, Date.now() + 26 * 3600e3, { force: true });
  assert.equal(d.raw.prepare("select count(*) n from bookings where record_id = ?").get(String(mv.id)).n, 1);
  assert.equal(Math.round((byPhone(d, 202).next_booking_at - NOW) / 86400e3), 9);
});

test("сбой Altegio посреди первичной загрузки: ошибка видна, курсор не потерян, продолжение без дублей", { skip }, async () => {
  net.reset(); rid = 0;
  net.altJournal = Array.from({ length: 60 }, (_, i) => rec(ph(300 + i), 5 + i * 10, { name: "Клиент " + i }));
  const { d, s } = prod();
  let calls = 0;
  Object.defineProperty(net, "altJournalFail", { configurable: true, get: () => (++calls > 12 ? 503 : 0) });
  await assert.rejects(full(s.env), e => e.code === "altegio" && /Altegio не отдал журнал \(ошибка 503\)/.test(e.message));
  Object.defineProperty(net, "altJournalFail", { configurable: true, writable: true, value: 0 });
  const st = await contactsStatus(s.env, W, Date.now(), true);
  assert.match(st.sync.lastError, /503/);
  assert.ok(st.errors.some(e => /503/.test(e.text)), "ошибка — в журнале");
  assert.ok(st.sync.initial.pct > 0 && st.sync.initial.pct < 100, "загрузка продвинулась: " + st.sync.initial.pct);
  const part = d.raw.prepare("select count(*) n from contacts").get().n;
  assert.ok(part > 0 && part < 60, String(part));
  const reqs = net.alt.length;
  await full(s.env);
  assert.ok(net.alt.length - reqs < 60, "продолжение с того же окна, а не сначала");
  assert.equal(d.raw.prepare("select count(*) n from contacts").get().n, 60);
  assert.equal(d.raw.prepare("select count(*) n from bookings").get().n, 60);
  const st2 = await contactsStatus(s.env, W, Date.now(), true);
  assert.equal(st2.sync.lastError, null, "удачный проход снимает ошибку");
  assert.equal(st2.sync.initial.done, true);
});

test("сбой D1 посреди окна: пачка откатывается целиком, следующий проход дописывает; две синхронизации одновременно не идут", { skip }, async () => {
  net.reset(); rid = 0;
  net.altJournal = [rec(ph(401), 20), rec(ph(402), -4)];
  const { d, s } = prod();
  await full(s.env);
  net.altJournal.push(rec(ph(403), -6), rec(ph(401), -7));
  d.ctl.fail = sql => /insert into bookings/.test(sql);
  await assert.rejects(syncStep(s.env, W, Date.now(), { force: true }), e => e.code === "store");
  assert.equal(byPhone(d, 403), undefined, "контакт из упавшей пачки не записан (откат)");
  d.ctl.fail = null;
  await syncStep(s.env, W, Date.now(), { force: true });
  assert.ok(byPhone(d, 403).next_booking_at > NOW);
  assert.ok(byPhone(d, 401).next_booking_at > NOW, "сводка старого клиента пересчитана");
  const both = await Promise.allSettled([syncStep(s.env, W, Date.now(), { force: true }), syncStep(s.env, W, Date.now(), { force: true })]);
  assert.deepEqual(both.map(x => x.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(both.find(x => x.status === "rejected").reason.code, "busy");
});

test("подозрительно пустой ответ Altegio не помечает записи удалёнными", { skip }, async () => {
  net.reset(); rid = 0;
  net.altJournal = Array.from({ length: 30 }, (_, i) => rec(ph(500 + i), -1 - (i % 10)));
  const { d, s } = prod();
  await full(s.env);
  net.altJournal = [];
  await syncStep(s.env, W, Date.now(), { force: true });
  assert.equal(d.raw.prepare("select count(*) n from bookings where deleted = 1").get().n, 0);
  const st = await contactsStatus(s.env, W, Date.now(), true);
  assert.ok(st.errors.some(e => /удалённые не отмечаю/.test(e.text)), JSON.stringify(st.errors));
});

test("черновик: настоящий Altegio в базу не пишется — только проверка без записи; тестовые клиенты проходят тот же путь", { skip }, async () => {
  net.reset(); rid = 0;
  net.altJournal = [rec(ph(601), 25), rec(ph(602), 40), rec("+7 700 XXX-X1-05", 20)];
  const d = d1With("preview"), s = mk({ ...ENV, DB: d.db, STAGE: "preview" });
  await assert.rejects(syncStep(s.env, W, Date.now()), e => e.code === "preview");
  const dry = await syncDry(s.env, W, Date.now());
  assert.equal(dry.numbers.contacts, 2); assert.equal(dry.numbers.masked, 1);
  assert.ok(dry.summary.some(l => /В базу ничего не записано/.test(l)));
  assert.equal(d.raw.prepare("select count(*) n from contacts").get().n, 0, "номера настоящих клиентов в черновик не попали");
  assert.ok(!/7700000060/.test(JSON.stringify(d.raw.prepare("select details from events").all())), "в журнале — только числа");
  const t = await syncTest(s.env, W, Date.now());
  assert.match(t.summary[0], /Тестовые клиенты: 40/);
  assert.ok(d.raw.prepare("select count(*) n from contacts").get().n === 40);
  assert.ok(d.raw.prepare("select count(*) n from contacts where phone not like '7700000%'").get().n === 0, "только +7 700 000 xx xx");
  const card = await contactsCard(s.env, W, Date.now(), d.raw.prepare("select id from contacts where visits >= 3 limit 1").get().id);
  assert.ok(card.visits.length >= 3 && card.contact.phone.startsWith("+7 700 000"));
  assert.equal(testJournal(NOW).filter(r => r.deleted).length, 1);
  await assert.rejects(syncTest(mk({ ...ENV, DB: d1With("production").db }).env, W, Date.now()), e => e.code === "preview", "на боевом — нельзя");
});

test("проба полей Altegio: только имена полей, доли и числа — без имён и номеров; отчёт в журнале", { skip }, async () => {
  net.reset(); rid = 0;
  net.altJournal = [rec(ph(701), 5, { name: "Секретное Имя" }), rec(ph(702), -2), rec("+7 700 XXX-X1-05", 3)];
  const d = d1With("preview"), s = mk({ ...ENV, DB: d.db, STAGE: "preview" });
  const r = await altProbe(s.env, W, Date.now());
  const txt = JSON.stringify(r);
  assert.ok(r.summary.some(l => /create_date\): 3 из 3, вид 9999-99-99T99:99:99\+99:99/.test(l)), r.summary.join("\n"));
  assert.ok(r.summary.some(l => /Номера клиентов: полные 2, скрытые 1/.test(l)), r.summary.join("\n"));
  assert.ok(r.summary.some(l => /changed_after/.test(l)));
  assert.ok(!/Секретное|77000000701|7700000/.test(txt), "без имён и номеров");
  const ev = d.raw.prepare("select details from events where kind = 'altegio_probe'").get();
  assert.ok(ev && !/Секретное/.test(ev.details));
  const st = await contactsStatus(s.env, W, Date.now(), true);
  assert.ok(st.probe && st.probe.summary.length >= 5);
  const bad = await altProbe(mk({ DB: d.db, STAGE: "preview" }).env, W, Date.now());
  assert.equal(bad.ok, false); assert.match(bad.summary[0], /ALTEGIO_PARTNER/);
});
