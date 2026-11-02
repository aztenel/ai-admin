// Сценарии проверки ТЗ Winchester v3.0 (31.10.2026, сервер на заглушках): (5) клиент записался — после обновления базы он уходит из
// «Пора на стрижку» и из кандидатов рекламы, а напоминание о новой записи встаёт в очередь; (6) клиент написал «стоп» — запрет в D1 и
// KV, он исключён из всех проверок рассылок (основной и второй номер, автосценарий, пример текста, «Клиенты»), воронка показывает его в
// разрешениях; (4) на демо-базе проверка рассылки отдаёт воронку с непустыми причинами. Номера вымышленные (+7 700 000 08 xx, демо 60–61 xx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { CLIENTS } from "../../src/config/builtin-clients.js";
import { crmBuild } from "../../src/services/crm/snapshot.js";
import { crmPick } from "../../src/services/crm/segments.js";
import { syncStep } from "../../src/services/contacts/sync.js";
import { contactsSegments, contactsCard } from "../../src/services/contacts/index.js";
import { demoLoad } from "../../src/services/contacts/demo.js";
import { jrRun } from "../../src/services/reminders/journal.js";
import { autoOn, legacyOn } from "../automsg.mjs";
import { jrqLoad } from "../../src/db/kv/reminders.js";
import { consentAdd } from "../../src/db/d1/rights.js";
import { contactsByPhones } from "../../src/db/d1/contacts.js";
import { autoSave } from "../../src/db/kv/crm.js";
import { OWN } from "../texts.mjs";

const skip = sqliteOk ? false : "node:sqlite есть только в Node 22+";
const W = CLIENTS.winchester, OWNER = "owner-key-123456", INST = { id: "7105000093", token: "ga-tok-w93" };
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token, REMIND_GA_WINCHESTER: "1" };
const NOW = Date.now();
const day = n => new Date(NOW - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
const dg = i => "7700000" + String(i).padStart(4, "0");
let rid = 8000;
const rec = (i, n, o = {}) => ({ id: o.id || ++rid, datetime: `${day(n)}T${o.t || "12:00"}:00+05:00`, create_date: o.made || `${day(n + 2)}T10:00:00+05:00`, deleted: false, attendance: n > 0 ? 1 : 0,
  staff: { id: 1, name: "Дамир" }, client: { id: i, phone: "+" + dg(i), name: o.name || "Арман" }, services: [{ id: 1, title: "Мужская стрижка" }] });
const sum = l => l.reduce((a, x) => a + x.n, 0);
async function login(s) {
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${OWNER}&next=%2Fapp%2F` });
  return b;
}
const META = { c: "winchester", name: "Пора", tpl: "promo_pora", lang: "ru", text: "Здравствуйте, {{1}}!", params: ["{имя}"], segment: "pora", cap: 100, from: 10, to: 20, consent: true };
const GA = { c: "winchester", ch: "ga", name: "Пора", text: OWN.pora, lang: "ru", segment: "pora", cap: 50, from: 10, to: 20, consent: true };
// база на боевом адресе (у него синхронизация журнала в D1 разрешена): клиенты «Пора на стрижку» с подтверждённым согласием
async function base(people) {
  net.reset(); rid = 8000;
  const d = d1With("production"), s = mk({ ...ENV, DB: d.db });
  net.altJournal = people.map(([i, n]) => rec(i, n));
  for (let k = 0; k < 6; k++) { const r = await syncStep(s.env, W, Date.now()); if (r.initial.done) break; }
  await crmBuild(s.env, W, Date.now());
  const ids = await contactsByPhones(d.db, "winchester", people.map(([i]) => dg(i)));
  for (const [, x] of ids) await consentAdd(d.db, "winchester", { contactId: x.id, purpose: "marketing", state: "granted", basis: "письменное", source: "manual", actor: "owner", at: 1, evidence: "document", confirmed: true, givenAt: 1 });
  return { d, s };
}
const inPora = async (s, i) => ((await crmPick(s.env, W, "pora", Date.now())) || []).some(x => x.phone === dg(i));

test("(5) клиент записался: после обновления базы он не в «Пора на стрижку» и не в кандидатах рекламы, напоминание о записи — в очереди", { skip }, async () => {
  const { d, s } = await base([[801, 25], [802, 27]]), own = await login(s);
  assert.equal(await inPora(s, 801), true);
  const before = (await (await own.post("/api/bc/check", META)).json()).funnel;
  assert.equal(before.allowed, 2);
  assert.equal((await contactsSegments(s.env, W, Date.now())).segments.find(x => x.id === "pora").ready, 2);
  // 801 записался на завтра в 15:00 (запись в журнале Altegio сделана только что)
  const made = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 19) + "+05:00", fresh = rec(801, -1, { t: "15:00", made, id: 8901 });
  net.altJournal.push(fresh);
  await crmBuild(s.env, W, Date.now()); // снимок базы для рассылок (ночью или кнопкой «Обновить базу»)
  await syncStep(s.env, W, Date.now() + 16 * 60e3, { force: true }); // база контактов D1: окно «ближайшие дни»
  assert.equal(await inPora(s, 801), false, "в рекламу «Пора на стрижку» не попадёт");
  const after = (await (await own.post("/api/bc/check", META)).json()).funnel;
  assert.equal(after.allowed, 1); assert.equal(after.rules.find(x => x.code === "fut").n, 1, "в воронке — «уже записаны»");
  const seg = await contactsSegments(s.env, W, Date.now() + 16 * 60e3);
  assert.equal(seg.segments.find(x => x.id === "pora").ready, 1); assert.equal(seg.segments.find(x => x.id === "zapis").count, 1);
  assert.ok(d.raw.prepare("select next_booking_at from contacts where phone = ?").get(dg(801)).next_booking_at > Date.now());
  // напоминания по журналу Altegio со второго номера: новая запись — накануне и за 2 часа
  await autoOn(s, legacyOn(CLIENTS.winchester)); // сценарии включены в «Автоматических сообщениях» (по умолчанию выключены)
  await jrRun(s.env, Date.now());
  const q = (await jrqLoad(s.env, "winchester")).filter(x => x.rec === "8901");
  assert.deepEqual(q.map(x => x.k).sort(), ["d1", "h2", "rv"].filter(k => q.some(x => x.k === k)).sort());
  assert.ok(q.some(x => x.k === "d1") && q.some(x => x.k === "h2"), JSON.stringify(q.map(x => x.k)));
  assert.ok(q.every(x => x.p === dg(801) && x.time === "15:00"));
});

test("(6) клиент написал «стоп»: запрет в D1 и KV, исключён из всех проверок рассылок, в воронке — в разрешениях", { skip }, async () => {
  const { d, s } = await base([[811, 24], [812, 26], [813, 30]]), own = await login(s);
  await autoSave(s.env, "winchester", { on: false, days: 26, tpl: "pora_auto", lang: "ru", cap: 20, from: 11, to: 20 });
  const autoBefore = (await (await own.go("/api/bc/auto?c=winchester")).json()).today.total;
  assert.equal(autoBefore, 1, "автосценарий «ровно 26 дней» написал бы 812");
  await s.gaText("winchester", INST, dg(812), "СТОП", { idMessage: "IN-STOP-812" });
  assert.ok(s.kv.mem.get(`optout:winchester:${dg(812)}`), "«стоп» в KV");
  const r = d.raw.prepare("select r.kind, r.needs_review from restrictions r join contacts c on c.id = r.contact_id where c.phone = ?").all(dg(812));
  assert.deepEqual(r.map(x => [x.kind, x.needs_review]), [["marketing_optout", 0]], "«стоп» в D1");
  // основной номер, второй номер, «вся база», автосценарий, пример текста, «Клиенты» — никто не напишет 812
  for (const body of [META, GA, { ...META, segment: "all" }, { ...GA, segment: "all" }]) {
    const c = await (await own.post("/api/bc/check", body)).json(), f = c.funnel;
    assert.ok(!JSON.stringify(c.sample || []).includes("** 12") && !(c.samples || []).some(x => x.to.endsWith("** 12")), "812 не среди получателей: " + JSON.stringify(c.sample));
    assert.equal(f.consent.find(x => x.code === "stop").n, 1, "в разрешениях: «стоп»");
    assert.ok(!f.rules.some(x => x.code === "stop"));
    assert.equal(f.segment - sum(f.rules) - sum(f.consent), f.allowed); assert.equal(f.allowed, c.valid);
  }
  assert.equal(await inPora(s, 812), false);
  assert.equal((await (await own.go("/api/bc/auto?c=winchester")).json()).today.total, 0, "автосценарий ему не напишет");
  const pv = await (await own.post("/api/bc/templates/preview", { c: "winchester", id: "W02", segment: "pora" })).json();
  assert.equal(pv.ok, true); assert.equal(pv.demo, false); assert.equal(pv.list.length, 2, "пример — на двух других клиентах «Пора»");
  assert.ok(!pv.list.some(x => String(x.to).endsWith("** 12")), "пример текста — не на нём");
  const seg = await contactsSegments(s.env, W, Date.now());
  assert.equal(seg.segments.find(x => x.id === "pora").ready, 2); assert.equal(seg.kpi.forbidden, 1);
  const card = await contactsCard(s.env, W, Date.now(), d.raw.prepare("select id from contacts where phone = ?").get(dg(812)).id);
  assert.equal(card.canMarket.ok, false); assert.equal(card.consent.marketing.state, "denied", "«стоп» — и отказ в согласии");
});

test("(4) демо-база: проверка рассылки отдаёт воронку с непустыми причинами — правила и разрешения", { skip }, async () => {
  net.reset();
  const d = d1With("preview"), s = mk({ ...ENV, DB: d.db, STAGE: "preview" }), own = await login(s);
  await demoLoad(s.env, W, Date.now());
  for (const body of [{ ...META, segment: "all" }, { ...GA, segment: "all" }, META, { ...META, segment: "davno" }]) {
    const c = await (await own.post("/api/bc/check", body)).json(), f = c.funnel;
    assert.ok(f && f.total > f.valid && f.valid >= f.segment && f.segment > 0, JSON.stringify(f));
    assert.ok(f.rules.length > 0 && f.consent.length > 0, JSON.stringify(f));
    assert.equal(f.segment - sum(f.rules) - sum(f.consent), f.allowed); assert.equal(f.allowed, c.valid);
  }
  const all = (await (await own.post("/api/bc/check", { ...META, segment: "all" })).json()).funnel;
  for (const k of ["marketed", "recent", "fut", "cooldown"]) assert.ok(all.rules.some(x => x.code === k), "правило " + k);
  for (const k of ["stop", "noconsent", "unconfirmed"]) assert.ok(all.consent.some(x => x.code === k), "разрешение " + k);
  assert.ok(all.allowed > 0, "кому-то можно");
});
