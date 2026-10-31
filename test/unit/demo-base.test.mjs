// Демо-база черновика (ТЗ v3.0 P0 «Клиенты и тестовая база», 31.10.2026): 150 вымышленных клиентов тем же путём записи, что журнал
// Altegio (D1 и снимок для рассылок), разрешения, источники, три демо-рассылки с итогами и черновик; только черновик и только владелец;
// повтор не плодит дублей; «Убрать демо-базу» удаляет только демо. Плюс миграция 0004, числа «Клиентов» (kpi), итоги рассылки,
// события календаря. Всё на заглушках; номера вымышленные (+7 700 000 60 00 … 61 49 — демо, +7 700 000 07 xx — «настоящие» в проверке).
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { sqliteOk, openD1, migrate, d1With, MIGRATIONS } from "../d1.mjs";
import { readdirSync, mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CLIENTS } from "../../src/config/builtin-clients.js";
import { demoLoad, demoPlan, demoPhones, demoPhone, demoRole, DEMO_MASTERS } from "../../src/services/contacts/demo.js";
import { contactsSegments, contactsStatus, contactsList, contactsCard } from "../../src/services/contacts/index.js";
import { consentReadyPhones, consentGate, contactAdd } from "../../src/db/d1/contacts.js";
import { consentAdd } from "../../src/db/d1/rights.js";
import { crmView, CRM_SEGS, crmSegTest } from "../../src/services/crm/segments.js";
import { GAP_MS } from "../../src/services/contacts/segments.js";
import { bcPut, bcChunksSave } from "../../src/db/kv/broadcasts.js";
import { bcmAdd, crmSave } from "../../src/db/kv/crm.js";
import { isoDay } from "../../src/lib/time.js";
import { jrPlan } from "../../src/services/reminders/journal.js";
import { jrqSave } from "../../src/db/kv/reminders.js";
import { msgEventAdd } from "../../src/db/d1/stats.js";
import { syncStep } from "../../src/services/contacts/sync.js";

const skip = sqliteOk ? false : "node:sqlite есть только в Node 22+";
const W = CLIENTS.winchester, OWNER = "owner-key-123456", STAFF_W = "staff-key-winch-0001";
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", KEY_WINCHESTER: STAFF_W };
const rows = (d, sql, ...a) => d.raw.prepare(sql).all(...a);
const one = (d, sql, ...a) => d.raw.prepare(sql).get(...a);
async function login(s, key) {
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${encodeURIComponent(key)}&next=%2Fapp%2F` });
  assert.ok(b.cookie);
  return b;
}
const preview = () => { net.reset(); const d = d1With("preview"); return { d, s: mk({ ...ENV, DB: d.db, STAGE: "preview" }) }; };
// снимок «что лежит в базе» без времени: повторная загрузка должна дать то же самое
const shape = d => ["contacts", "contact_sources", "bookings", "consents", "restrictions", "events", "outbound", "imports"].map(t => `${t}:${one(d, `select count(*) n from ${t}`).n}`).join(" ");
const kvShape = s => [...s.kv.mem.keys()].filter(k => /^(bc:|bcr:|bcm:|crm:|optout:)/.test(k)).sort().join(",");

test("миграция 0004: источник «демо» разрешён, прежние строки источников на месте, других значений нет", { skip }, () => {
  // база до 0004: 0001–0003, контакт с источником «импорт»
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  for (const f of readdirSync(MIGRATIONS).filter(f => f < "0004")) copyFileSync(new URL(f, MIGRATIONS), join(dir, f));
  const { raw } = openD1();
  migrate(raw, pathToFileURL(dir + "/"));
  raw.prepare("insert into contacts(id, ws, phone, created_at, updated_at) values ('c1', 'winchester', '77000000701', 1, 1)").run();
  raw.prepare("insert into contact_sources(contact_id, ws, source, external_id, first_seen, last_seen) values ('c1', 'winchester', 'import', '', 1, 1)").run();
  assert.throws(() => raw.prepare("insert into contact_sources(contact_id, ws, source, external_id, first_seen, last_seen) values ('c1', 'winchester', 'demo', 'demo', 1, 1)").run(), /CHECK/);
  assert.deepEqual(migrate(raw), ["0004_demo_source.sql"]);
  assert.deepEqual(raw.prepare("select source from contact_sources").all().map(r => r.source), ["import"], "строка источника перенесена");
  raw.prepare("insert into contact_sources(contact_id, ws, source, external_id, first_seen, last_seen) values ('c1', 'winchester', 'demo', 'demo', 1, 1)").run();
  assert.throws(() => raw.prepare("insert into contact_sources(contact_id, ws, source, external_id, first_seen, last_seen) values ('c1', 'winchester', 'other', '', 1, 1)").run(), /CHECK/);
  raw.prepare("delete from contacts where id = 'c1'").run();
  assert.equal(raw.prepare("select count(*) n from contact_sources").get().n, 0, "удаление контакта убирает и источники (каскад сохранён)");
});

test("демо-план: 150 вымышленных, номера из запаса, все сегменты не пустые, отмены, перенос, неявки, скрытые и неверные номера", () => {
  const now = Date.now(), p = demoPlan(now), phones = demoPhones();
  assert.equal(new Set(phones).size, 150);
  assert.ok(phones.every(x => /^770000061[0-4]\d$|^77000006[0]\d\d$/.test(x)), "только +7 700 000 60 00 … 61 49");
  assert.deepEqual(demoPlan(now).after.map(r => r.id), p.after.map(r => r.id), "одна и та же база при каждом нажатии");
  const people = new Set(p.after.filter(r => r.client && /^\+7 700 000 6/.test(r.client.phone)).map(r => r.client.phone));
  assert.equal(people.size, 140, "140 — из журнала, 10 — файл и вручную");
  assert.ok(p.after.some(r => r.client && /XXX/.test(r.client.phone)) && p.after.some(r => r.client && r.client.phone === "12345"), "скрытый и неверный номер");
  assert.ok(p.after.some(r => !r.client), "перерыв мастера");
  assert.ok(p.after.filter(r => r.attendance === -1).length >= 5, "«не пришёл»");
  const moved = p.after.filter(r => { const b = p.before.find(x => x.id === r.id); return b && b.datetime !== r.datetime; });
  assert.ok(moved.length >= 3, "перенос — та же запись с другим временем");
  assert.ok(p.after.filter(r => r.deleted && Date.parse(r.datetime) > now).length >= 3, "отменённые будущие записи");
  const staff = new Set(p.after.filter(r => r.staff).map(r => r.staff.name));
  assert.deepEqual([...staff].sort(), [...DEMO_MASTERS].sort());
  assert.ok(!["Тони", "Айдос", "Айдын", "Алишер", "Руслан", "Рауан"].some(n => staff.has(n)), "не мастера Winchester");
  const days = p.after.filter(r => r.client).map(r => Math.round((now - Date.parse(r.datetime)) / 86400e3));
  assert.ok(Math.max(...days) >= 170 && Math.min(...days) < 0, "история ~180 дней и будущие записи");
  assert.equal(p.campaigns.length, 3);
  assert.ok(p.campaigns.every(C => C.people.length >= 8 && now - C.send <= 30 * 86400e3));
});

test("загрузка демо-базы: тот же путь записи, разрешения, источники, дубли, сегменты базы и снимка; повтор — без дублей", { skip }, async () => {
  const { d, s } = preview(), now = Date.now();
  const r = await demoLoad(s.env, W, now);
  assert.equal(r.contacts, 150); assert.match(r.summary[0], /150 вымышленных клиентов/);
  assert.equal(one(d, "select count(*) n from contacts").n, 150);
  assert.equal(one(d, "select count(distinct contact_id) n from contact_sources where source = 'demo'").n, 150, "каждый помечен «демо»");
  const src = Object.fromEntries(rows(d, "select source, count(*) n from contact_sources group by source").map(x => [x.source, x.n]));
  assert.equal(src.altegio, 140); assert.ok(src.import >= 10 && src.manual >= 4, JSON.stringify(src));
  // один номер — один контакт: ручное добавление и импорт существующего номера дописывают источник
  const both = rows(d, "select contact_id, group_concat(source) s from contact_sources where source <> 'demo' group by contact_id having count(*) > 1").map(x => x.s.split(",").sort().join("+"));
  assert.ok(both.includes("altegio+import") && both.includes("import+manual"), JSON.stringify([...new Set(both)]));
  assert.equal(one(d, "select count(*) n from contacts where phone = ?", demoPhone(5)).n, 1, "добавлен вручную, а он уже был — тот же контакт");
  // журнал → записи: скрытые и неверные номера без контакта, отмена с паузой, перенос — запись изменилась, «не пришёл»
  assert.equal(one(d, "select count(*) n from bookings where contact_id is null").n, 5);
  assert.ok(one(d, "select count(*) n from restrictions where kind = 'cooldown' and lifted_at is null").n >= 3, "пауза после отмены");
  assert.ok(one(d, "select count(*) n from bookings where first_seen_at < last_seen_at and deleted = 0 and starts_at > ?", now).n >= 3, "перенесённые записи обновлены");
  assert.ok(one(d, "select count(*) n from bookings where attendance = -1").n >= 5);
  // разрешения: доли как в задании
  const latest = rows(d, "select s.state, s.confirmed from consents s where s.purpose = 'marketing' and s.id = (select max(id) from consents x where x.contact_id = s.contact_id and x.purpose = 'marketing')");
  const ok = latest.filter(x => x.state === "granted" && x.confirmed).length, file = latest.filter(x => x.state === "granted" && !x.confirmed).length;
  assert.ok(ok >= 60 && ok <= 75, "подтверждённое ≈45%: " + ok); assert.ok(file >= 18 && file <= 26, "из файла ≈15%: " + file);
  const stops = one(d, "select count(distinct contact_id) n from restrictions where kind = 'marketing_optout' and needs_review = 0 and lifted_at is null").n;
  assert.ok(stops >= 6 && stops <= 11, "«стоп» ≈5%: " + stops);
  assert.ok(rows(d, "select phone from contacts c where exists (select 1 from restrictions r where r.contact_id = c.id and r.kind = 'marketing_optout' and r.needs_review = 0)").every(x => s.kv.mem.get(`optout:winchester:${x.phone}`)), "«стоп» — и в KV");
  assert.equal(one(d, "select count(*) n from restrictions where needs_review = 1").n, 3); assert.equal(one(d, "select count(*) n from restrictions where kind = 'full_block'").n, 1);
  // сегменты базы контактов и снимка для рассылок — не пустые
  const seg = await contactsSegments(s.env, W, Date.now());
  for (const id of ["pora", "davno", "uhodyat", "ushli", "novye", "postoyannye", "zapis", "bez", "stop", "review"]) assert.ok(seg.segments.find(x => x.id === id).count > 0, id);
  assert.ok(seg.segments.filter(x => x.id.startsWith("staff:")).length === 5);
  const view = await crmView(s.env, W, Date.now());
  assert.equal(view.snap.demo, 1); assert.equal(view.snap.masked, 3); assert.equal(view.snap.bad, 2);
  for (const x of CRM_SEGS) assert.ok(view.rows.filter(x.test).length > 0, x.id);
  for (const m of DEMO_MASTERS) assert.ok(view.rows.filter(crmSegTest("staff:" + m)).length > 0, m);
  assert.ok(view.futOnly.size > 0, "записан, визита за 90 дней нет");
  // согласие — тот же список разрешённых, что у рассылки; причина есть у каждого остального
  const stopsKv = [...s.kv.mem.keys()].filter(k => k.startsWith("optout:winchester:")).map(k => k.split(":").pop());
  const ready = await consentReadyPhones(d.db, "winchester", Date.now(), stopsKv, GAP_MS), g = await consentGate(d.db, "winchester", Date.now(), stopsKv, GAP_MS);
  assert.deepEqual([...g.phones].sort(), [...ready].sort());
  assert.equal(g.phones.size + g.why.size, 150);
  // список и карточка: источник «демо» виден
  const list = await contactsList(s.env, W, Date.now(), { seg: "all" });
  assert.ok(list.items.every(x => x.sources.includes("demo")));
  const card = await contactsCard(s.env, W, Date.now(), one(d, "select id from contacts where phone = ?", demoPhone(149)).id);
  assert.deepEqual(card.contact.sources.map(x => x.source).sort(), ["demo", "import", "manual"]);
  // повтор: прежняя демо-база убирается и пишется заново — тех же размеров, без дублей
  const before = shape(d), kv = kvShape(s);
  await demoLoad(s.env, W, Date.now());
  assert.equal(shape(d), before); assert.equal(kvShape(s), kv);
  assert.equal(one(d, "select count(*) n from contacts").n, 150);
});

test("API: загрузить и убрать — только владелец и только черновик; убирается только демо, настоящие данные на месте", { skip }, async () => {
  const { d, s } = preview(), own = await login(s, OWNER), st = await login(s, STAFF_W);
  assert.equal((await st.post("/api/contacts/demo", { c: "winchester", op: "load" })).status, 403, "сотрудник — нет");
  assert.equal((await own.post("/api/contacts/demo", { c: "winchester", op: "drop" })).status, 400);
  // «настоящие» данные компании: контакт с согласием, запись, «стоп» в KV, настоящая рассылка, отметка рекламы, снимок
  const real = "77000000701", now = Date.now();
  await contactAdd(d.db, "winchester", { id: "real1", phone: real, name: "Настоящий", search: "настоящий", actor: "owner", at: now });
  await consentAdd(d.db, "winchester", { contactId: "real1", purpose: "marketing", state: "granted", basis: "письменное", source: "manual", actor: "owner", at: now, evidence: "document", confirmed: true, givenAt: now });
  d.raw.prepare("insert into bookings(ws, record_id, contact_id, starts_at, deleted, first_seen_at, last_seen_at) values ('winchester', '777', 'real1', ?, 0, ?, ?)").run(now + 86400e3, now, now);
  await s.kv.api.put("optout:winchester:77000000702", "1");
  await bcPut(s.env, "winchester", { id: "real1", name: "Настоящая", status: "done", total: 1, pos: 1, sent: 1, failed: 0, skipped: 0, created: now }); await bcChunksSave(s.env, "winchester", "real1", [[real, "Настоящий"]]);
  await bcmAdd(s.env, "winchester", isoDay(now), [real]);
  const load = await own.post("/api/contacts/demo", { c: "winchester", op: "load" }), lj = await load.json();
  assert.equal(load.status, 200, JSON.stringify(lj)); assert.equal(lj.demo, true); assert.equal(lj.contacts, 150); assert.ok(lj.report.summary.length >= 4);
  const sync = await (await own.post("/api/contacts/sync", { c: "winchester", mode: "demo" })).json();
  assert.equal(sync.ok, true); assert.equal(one(d, "select count(*) n from contacts").n, 151, "кнопка «sync, demo» — то же самое, без дублей");
  const stj = await (await own.go("/api/contacts/status?c=winchester")).json();
  assert.equal(stj.demo, true); assert.ok(stj.demoAt > 0); assert.equal(stj.demoAllowed, true);
  assert.equal((await (await st.go("/api/contacts/status?c=winchester")).json()).demoAllowed, false, "сотруднику кнопки нет");
  // список рассылок: демо помечены, настоящая — нет
  const bl = await (await own.go("/api/bc/list?c=winchester")).json();
  assert.deepEqual(bl.list.filter(x => x.demo).map(x => x.id).sort(), ["demo1", "demo2", "demo3", "demo4"]);
  assert.equal(bl.list.find(x => x.id === "real1").demo, undefined);
  // убрать
  const clr = await (await own.post("/api/contacts/demo", { c: "winchester", op: "clear" })).json();
  assert.equal(clr.ok, true); assert.equal(clr.contacts, 150); assert.equal(clr.demo, false);
  assert.deepEqual(rows(d, "select id from contacts").map(x => x.id), ["real1"]);
  assert.equal(one(d, "select count(*) n from bookings").n, 1); assert.equal(one(d, "select count(*) n from consents").n, 1);
  assert.equal(one(d, "select count(*) n from events where event_key like 'demo:%' or details like '%демо%'").n, 0);
  assert.equal(one(d, "select count(*) n from sync_state where source = 'demo'").n, 0);
  assert.ok(s.kv.mem.get("optout:winchester:77000000702"), "настоящий «стоп» на месте");
  assert.ok(![...s.kv.mem.keys()].some(k => /^optout:winchester:770000006/.test(k)), "демо-«стопы» убраны");
  assert.ok(s.kv.mem.get("bc:winchester:real1") && !s.kv.mem.get("bc:winchester:demo1") && !s.kv.mem.get("bcr:winchester:demo1:0"));
  assert.deepEqual(JSON.parse(s.kv.mem.get(`bcm:winchester:${isoDay(now)}`)), [real], "отметка рекламы — только настоящая");
  assert.equal(s.kv.mem.get("crm:winchester:snap"), undefined, "демо-снимок убран");
  assert.equal((await (await own.go("/api/contacts/status?c=winchester")).json()).demo, false);
  // настоящий снимок «Убрать демо-базу» не трогает
  await crmSave(s.env, "winchester", { at: now, list: [], futOnly: [] });
  await own.post("/api/contacts/demo", { c: "winchester", op: "clear" });
  assert.ok(s.kv.mem.get("crm:winchester:snap"));
  // боевой сайт — нельзя
  const p = mk({ ...ENV, DB: d1With("production").db }), po = await login(p, OWNER);
  const pr = await po.post("/api/contacts/demo", { c: "winchester", op: "load" });
  assert.equal(pr.status, 409); assert.match((await pr.json()).error, /только на черновике/);
  assert.equal((await po.post("/api/contacts/sync", { c: "winchester", mode: "test" })).status, 409);
});

test("числа «Клиентов» (kpi): всего, с будущей записью, в выбранном сегменте, с запретом", { skip }, async () => {
  const { d, s } = preview(), own = await login(s, OWNER);
  await demoLoad(s.env, W, Date.now());
  const a = await (await own.go("/api/contacts/segments?c=winchester")).json();
  const want = { total: 150, withBooking: one(d, "select count(*) n from contacts where next_booking_at > ?", Date.now()).n };
  assert.equal(a.kpi.total, want.total); assert.equal(a.kpi.withBooking, want.withBooking); assert.equal(a.kpi.segment, null, "сегмент не выбран");
  // запрет: «стоп» (D1 или KV), полный запрет, неоднозначный «стоп», отказ в согласии — каждый один раз
  const forbidden = rows(d, `select c.id from contacts c where exists (select 1 from restrictions r where r.contact_id = c.id and r.lifted_at is null and r.kind in ('marketing_optout', 'full_block'))
    or (select state from consents s where s.contact_id = c.id and s.purpose = 'marketing' order by s.id desc limit 1) = 'denied'`).length;
  assert.equal(a.kpi.forbidden, forbidden); assert.ok(forbidden >= 10);
  const pora = await (await own.go("/api/contacts/segments?c=winchester&seg=pora")).json();
  assert.equal(pora.kpi.segment, pora.segments.find(x => x.id === "pora").count); assert.equal(pora.kpi.total, 150);
  const m = await (await own.go(`/api/contacts/segments?c=winchester&seg=${encodeURIComponent("staff:" + DEMO_MASTERS[0])}`)).json();
  assert.equal(m.kpi.segment, m.segments.find(x => x.id === "staff:" + DEMO_MASTERS[0]).count);
  assert.equal((await (await own.go("/api/contacts/segments?c=winchester&seg=all")).json()).kpi.segment, null);
  assert.equal((await own.go("/api/contacts/segments?c=winchester&seg=nope")).status, 400);
});

test("итоги демо-рассылки: по получателям, «записались после» в окне 14 дней; список и статистика видят демо", { skip }, async () => {
  const { d, s } = preview(), own = await login(s, OWNER), now = Date.now();
  await demoLoad(s.env, W, now);
  const plan = demoPlan(now);
  for (const C of plan.campaigns) {
    const g = await (await own.go(`/api/bc/get?c=winchester&id=${C.id}`)).json();
    assert.equal(g.demo, 1); assert.equal(g.b.demo, 1);
    const R = g.results, ok = C.people.filter(x => !x.failed);
    assert.equal(R.window, 14); assert.equal(R.sent, ok.length); assert.equal(R.failed, C.people.length - ok.length);
    assert.equal(R.delivered, C.people.filter(x => x.delivered).length); assert.equal(R.read, C.people.filter(x => x.read).length); assert.equal(R.replied, C.people.filter(x => x.replied).length);
    // «записались после»: запись создана после сообщения, не позже 14 дней, не отменена — считаем по журналу плана
    const booked = ok.filter(x => plan.after.some(r => r.client && r.client.phone.replace(/\D/g, "") === x.p && !r.deleted && Date.parse(r.create_date) > x.at && Date.parse(r.create_date) <= x.at + 14 * 86400e3)).length;
    assert.equal(R.booked, booked, C.id); assert.ok(R.booked > 0, C.id + ": записались после");
    assert.ok(R.sent >= R.delivered && R.delivered >= R.read);
  }
  assert.equal((await (await own.go("/api/bc/get?c=winchester&id=demo4")).json()).results, null, "черновик — отчётов нет");
  const st = await (await own.go("/api/bc/stats?c=winchester&days=30")).json();
  assert.equal(st.by.campaign.sent, plan.campaigns.reduce((a, C) => a + C.people.filter(x => !x.failed).length, 0));
  assert.ok(st.by.campaign.replied > 0 && st.by.campaign.failed > 0);
  // запись, удалённая после — не считается; без базы D1 — null
  const id = one(d, "select b.record_id from bookings b join events e on e.contact_id = b.contact_id and e.campaign_id = 'demo1' and e.kind = 'msg_sent' where b.deleted = 0 and b.provider_created_at > e.at and b.provider_created_at <= e.at + 14 * 86400000 limit 1").record_id;
  const was = (await (await own.go("/api/bc/get?c=winchester&id=demo1")).json()).results.booked;
  d.raw.prepare("update bookings set deleted = 1 where record_id = ?").run(id);
  assert.ok((await (await own.go("/api/bc/get?c=winchester&id=demo1")).json()).results.booked <= was);
  const k = mk(ENV); await bcPut(k.env, "winchester", { id: "x1", name: "x", status: "done", total: 1, pos: 1, sent: 1, failed: 0, skipped: 0, created: now });
  assert.equal((await (await (await login(k, OWNER)).go("/api/bc/get?c=winchester&id=x1")).json()).results, null, "без D1 — null");
});

test("календарь демо: ушло и не дошло по рассылке, черновик ждёт одобрения, изменения аудитории; прежние поля на месте", { skip }, async () => {
  const { s } = preview(), own = await login(s, OWNER), now = Date.now();
  await demoLoad(s.env, W, now);
  const cal = await (await own.go("/api/bc/calendar?c=winchester")).json();
  const day = d => cal.days.find(x => x.date === d);
  assert.ok(cal.days.every(x => Array.isArray(x.events) && "service" in x && "marketing" in x), "события добавлены, прежние поля остались");
  const today = day(cal.today);
  assert.ok(today.events.some(e => e.kind === "approval" && e.id === "demo4" && /ждёт одобрения/.test(e.title) && e.n === demoPlan(now).draft.people.length), JSON.stringify(today.events));
  const C3 = demoPlan(now).campaigns[2], d3 = day(isoDay(C3.send));
  if (d3) { // последняя демо-рассылка — в этом месяце (кроме 1-го числа)
    assert.ok(d3.events.some(e => e.kind === "sent" && e.id === "demo3" && e.n === C3.people.filter(x => !x.failed).length), JSON.stringify(d3.events));
    assert.ok(d3.events.some(e => e.kind === "error" && e.id === "demo3"));
  }
  const aud = cal.days.flatMap(x => x.events.filter(e => e.kind === "audience").map(e => e.title));
  assert.ok(aud.includes("Просили не писать") && aud.includes("Дали согласие на рекламу"), JSON.stringify(aud));
  assert.ok(cal.days.every(x => x.events.every(e => typeof e.title === "string" && e.n > 0 && ["service", "campaign", "approval", "sent", "error", "audience"].includes(e.kind))));
  assert.ok(cal.days.filter(x => !x.past && !x.today).every(x => !x.events.some(e => e.kind === "sent" || e.kind === "error")), "в будущем «ушло» не придумывается");
});

test("демо-роли: доли разрешений по 150 клиентам", () => {
  const R = Array.from({ length: 150 }, (_, i) => demoRole(i));
  const n = f => R.filter(f).length;
  assert.ok(n(r => r.consent) >= 64 && n(r => r.consent) <= 72, "≈45%: " + n(r => r.consent)); assert.equal(n(r => r.fromFile), 22, "≈15%"); assert.ok(n(r => r.stop) >= 7);
});

test("календарь: рассылка идёт (с окном) и одобрена — сегодня, сервисные по видам, «ушло» напоминаний; ответы сотрудников — не событие", { skip }, async () => {
  net.reset();
  const d = d1With("production"), s = mk({ ...ENV, DB: d.db, GA_ID_WINCHESTER: "7105000095", GA_TOKEN_WINCHESTER: "ga-tok-w95", REMIND_GA_WINCHESTER: "1" }), own = await login(s, OWNER), now = Date.now();
  await bcPut(s.env, "winchester", { id: "run1", name: "Идёт", status: "running", total: 30, pos: 12, sent: 12, failed: 0, skipped: 0, created: now - 3600e3, from: 11, to: 19 });
  await bcPut(s.env, "winchester", { id: "ok1", name: "Одобрена", status: "ready", total: 7, pos: 0, sent: 0, failed: 0, skipped: 0, created: now, approvedAt: now, approvedBy: "владелец" });
  await bcPut(s.env, "winchester", { id: "dr1", name: "Черновик", status: "ready", total: 5, pos: 0, sent: 0, failed: 0, skipped: 0, created: now });
  await bcPut(s.env, "winchester", { id: "old1", name: "Готова", status: "done", total: 5, pos: 5, sent: 5, failed: 0, skipped: 0, created: now - 86400e3 });
  const tomorrow = isoDay(now + 86400e3);
  const recs = [1, 2].map(k => ({ id: 9500 + k, datetime: `${tomorrow}T${k === 1 ? "14" : "16"}:00:00+05:00`, deleted: false, attendance: 0, create_date: new Date(now - 86400e3).toISOString(),
    staff: { id: 1, name: "Дамир" }, client: { id: k, phone: "+770000007" + (50 + k), name: "Арман" }, services: [{ id: 1, title: "Мужская стрижка" }] }));
  await jrqSave(s.env, "winchester", jrPlan(W, recs, now));
  await msgEventAdd(d.db, "winchester", "msg:winchester:ga:A1:sent", "msg_sent", { ch: "ga", src: "service" }, now - 60e3);
  await msgEventAdd(d.db, "winchester", "msg:winchester:ga:A2:sent", "msg_sent", { ch: "ga", src: "admin" }, now - 60e3);
  await msgEventAdd(d.db, "winchester", "msg:winchester:ga:A3:failed", "msg_failed", { ch: "ga", src: "review" }, now - 60e3);
  const cal = await (await own.go("/api/bc/calendar?c=winchester")).json(), today = cal.days.find(x => x.today), tm = cal.days.find(x => x.date === tomorrow);
  const ev = (cell, kind, id) => cell.events.find(e => e.kind === kind && (!id || e.id === id));
  assert.equal(ev(today, "campaign", "run1").n, 18, "осталось отправить"); assert.match(ev(today, "campaign", "run1").title, /идёт · с 11:00 до 19:00/);
  assert.match(ev(today, "campaign", "ok1").title, /одобрена, ждёт запуска/); assert.equal(ev(today, "approval", "dr1").n, 5);
  assert.ok(!today.events.some(e => e.id === "old1"), "завершённая — не план");
  assert.deepEqual(today.events.filter(e => e.kind === "sent").map(e => [e.title, e.n]), [["Напоминания: ушло", 1]], "ответ сотрудника — не событие календаря");
  assert.deepEqual(today.events.filter(e => e.kind === "error").map(e => e.title), ["Просьбы об отзыве: не дошло"]);
  assert.ok(tm.service.total >= 2 && tm.events.some(e => e.kind === "service" && e.title === "Напоминания за 2 часа"), JSON.stringify(tm.events));
  assert.equal(tm.events.filter(e => e.kind === "service").reduce((a, e) => a + e.n, 0), tm.service.total, "события сервисных = очередь дня");
  assert.ok(today.events.findIndex(e => e.kind === "approval") < today.events.findIndex(e => e.kind === "campaign"), "сначала то, что ждёт решения");
});

test("две компании в одной базе: у каждой своя демо-база, ключи событий без телефонов, «убрать» одну не трогает другую", { skip }, async () => {
  const { d, s } = preview(), B = CLIENTS.barber;
  await demoLoad(s.env, W, Date.now()); await demoLoad(s.env, B, Date.now());
  const per = ws => one(d, "select count(*) n from restrictions where ws = ? and kind = 'marketing_optout' and needs_review = 0", ws).n;
  assert.equal(one(d, "select count(*) n from contacts where ws = 'barber'").n, 150);
  assert.equal(per("barber"), per("winchester"), "«стопы» второй компании записаны (ключи событий не совпали)");
  assert.equal(one(d, "select count(*) n from consents where ws = 'barber' and state = 'denied' and evidence = 'client_stop'").n, one(d, "select count(*) n from consents where ws = 'winchester' and state = 'denied' and evidence = 'client_stop'").n);
  assert.equal(one(d, "select count(*) n from events e where exists (select 1 from contacts c where instr(e.event_key, c.phone) > 0)").n, 0, "в ключах событий нет номеров");
  assert.ok(one(d, "select count(*) n from events where ws = 'barber' and campaign_id = 'demo1'").n > 0, "отчёты рассылок второй компании записаны");
  const { demoClear } = await import("../../src/services/contacts/demo.js");
  await demoClear(s.env, B, Date.now());
  assert.equal(one(d, "select count(*) n from contacts where ws = 'barber'").n, 0);
  assert.equal(one(d, "select count(*) n from contacts where ws = 'winchester'").n, 150);
  assert.ok(s.kv.mem.get("bc:winchester:demo1") && !s.kv.mem.get("bc:barber:demo1"));
});

test("настоящая синхронизация на черновике (CONTACTS_DEV_REAL=1) демо-записи «пропавшими» не считает", { skip }, async () => {
  net.reset();
  const d = d1With("preview"), s = mk({ ...ENV, DB: d.db, STAGE: "preview", CONTACTS_DEV_REAL: "1" }), now = Date.now();
  await demoLoad(s.env, W, now);
  const live = () => one(d, "select count(*) n from bookings where record_id like 'demo-%' and deleted = 0").n, before = live();
  net.altJournal = [{ id: 1, datetime: new Date(now - 5 * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10) + "T12:00:00+05:00", deleted: false, attendance: 1, staff: { id: 1, name: "Дамир" },
    client: { id: 1, phone: "+77000000799", name: "Настоящий" }, services: [{ id: 1, title: "Мужская стрижка" }] }];
  for (let k = 0; k < 6; k++) { const r = await syncStep(s.env, W, Date.now()); if (r.initial.done) break; }
  assert.equal(live(), before, "демо-записи на месте");
  assert.equal(one(d, "select count(*) n from contacts where phone = '77000000799'").n, 1, "настоящая запись загружена");
});
