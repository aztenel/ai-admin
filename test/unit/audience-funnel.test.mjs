// Воронка рассылки (ТЗ v3.0 P0 «Рассылки и доступная аудитория», 31.10.2026): POST /api/bc/check с сегментом базы — сколько всего,
// с правильным номером, в сегменте, кого исключили правила компании и кого — разрешения на связь, сколько можно отправить. Кого
// исключать, воронка не меняет: числа сходятся с тем, кому уйдёт (allowed = valid), каждый человек — один раз, по первой причине;
// «стоп» и отсутствие согласия — в разрешениях, отсутствие согласия согласием не считается. Заглушки; номера вымышленные (+7 700 000 07 xx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { crmBuild } from "../../src/services/crm/snapshot.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";
import { contactAdd } from "../../src/db/d1/contacts.js";
import { consentAdd, restrictionAdd } from "../../src/db/d1/rights.js";
import { bcmAdd } from "../../src/db/kv/crm.js";
import { isoDay } from "../../src/lib/time.js";
import { OWN } from "../texts.mjs";

const skip = sqliteOk ? false : "node:sqlite есть только в Node 22+";
const W = CLIENTS.winchester, OWNER = "owner-key-123456";
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", GA_ID_WINCHESTER: "7105000091", GA_TOKEN_WINCHESTER: "ga-tok-w91" };
const NOW = Date.now();
const day = n => new Date(NOW - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
const dg = i => "7700000" + String(i).padStart(4, "0");
let rid = 7000;
const rec = (i, n, o = {}) => ({ id: ++rid, datetime: `${day(n)}T12:00:00+05:00`, deleted: false, attendance: n > 0 ? 1 : 0, staff: o.staff === null ? null : { id: 1, name: o.staff || "Дамир" },
  client: { id: i, phone: o.phone || "+" + dg(i), name: o.name ?? "Клиент " + i }, services: [{ id: 1, title: "Мужская стрижка" }] });
const sum = l => l.reduce((a, x) => a + x.n, 0);
const code = (l, c) => (l.find(x => x.code === c) || { n: 0 }).n;
async function login(s) {
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${OWNER}&next=%2Fapp%2F` });
  return b;
}
const META = { c: "winchester", name: "Пора", tpl: "promo_pora", lang: "ru", text: "Здравствуйте, {{1}}!", params: ["{имя}"], segment: "pora", cap: 100, from: 10, to: 20, consent: true };
const GA = { c: "winchester", ch: "ga", name: "Пора", text: OWN.staff, lang: "ru", segment: "pora", cap: 50, from: 10, to: 20, consent: true };

// база: у каждого в «Пора на стрижку» (21–35 дней) своя причина; 708 — две причины («стоп» и будущая запись) — считается один раз
async function base(withD1 = true) {
  net.reset(); rid = 7000;
  const d = withD1 ? d1With("production") : null, s = mk({ ...ENV, ...(d ? { DB: d.db } : {}) }), now = Date.now();
  net.altJournal = [
    rec(701, 25), rec(702, 26), rec(703, 27), rec(704, 28), rec(705, 29), rec(705, -3), rec(706, 30), rec(707, 24), rec(708, 31), rec(708, -5),
    rec(709, 22), rec(710, 23), rec(711, 21, { staff: null }), rec(712, 5), rec(713, 33), rec(714, 34), rec(715, -4),
    rec(790, 25, { phone: "+7 700 XXX-X7-90" }), rec(791, 26, { phone: "12345" })
  ];
  await crmBuild(s.env, W, now);
  if (!d) return { s, d };
  const cid = i => "k" + i;
  for (const i of [701, 702, 703, 704, 705, 706, 707, 708, 709, 710, 711, 712, 713, 714, 715]) await contactAdd(d.db, "winchester", { id: cid(i), phone: dg(i), name: "", search: dg(i), actor: "owner", at: 1 });
  const yes = i => consentAdd(d.db, "winchester", { contactId: cid(i), purpose: "marketing", state: "granted", basis: "письменное", source: "manual", actor: "owner", at: 2, evidence: "document", confirmed: true, givenAt: 2 });
  for (const i of [701, 702, 705, 706, 707, 708, 709, 711, 712, 713, 714, 715]) await yes(i); // 703 — согласия нет вовсе
  await consentAdd(d.db, "winchester", { contactId: cid(704), purpose: "marketing", state: "granted", basis: "анкета", source: "import", actor: "owner", at: 3, evidence: "import", confirmed: false });
  await consentAdd(d.db, "winchester", { contactId: cid(710), purpose: "marketing", state: "denied", basis: "отказ", source: "manual", actor: "owner", at: 3, confirmed: true, givenAt: 3 });
  await s.kv.api.put(`optout:winchester:${dg(702)}`, "1"); await s.kv.api.put(`optout:winchester:${dg(708)}`, "1"); // «стоп» в KV
  await restrictionAdd(d.db, "winchester", { contactId: cid(709), kind: "marketing_optout", reason: "STOP", source: "chat_stop", actor: "webhook", at: 4 }); // «стоп» только в D1
  await restrictionAdd(d.db, "winchester", { contactId: cid(713), kind: "marketing_optout", reason: "«пока не пишите»", source: "chat_stop", actor: "webhook", review: true, at: 4 });
  await restrictionAdd(d.db, "winchester", { contactId: cid(714), kind: "full_block", reason: "не писать вообще", source: "admin", actor: "owner", at: 4 });
  d.raw.prepare("insert into restrictions (ws, contact_id, kind, channel, until_at, reason, source, actor, created_at) values ('winchester', ?, 'cooldown', '', ?, 'Запись отменена', 'booking_cancelled', 'sync', ?)").run(cid(707), now + 5 * 86400e3, now);
  await bcmAdd(s.env, "winchester", isoDay(now - 86400e3), [dg(706)]); // вчера ушла реклама
  return { s, d };
}

test("воронка Meta: всего → с номером → сегмент → правила и разрешения → можно; сходится с тем, кому уйдёт", { skip }, async () => {
  const { s } = await base(), own = await login(s);
  const r = await (await own.post("/api/bc/check", META)).json(), f = r.funnel;
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(f.total, 17, "15 с номером + скрытый + неверный"); assert.equal(f.valid, 15, "с будущей записью без визита за 90 дней — тоже в базе");
  assert.equal(f.segment, 13);
  assert.deepEqual(Object.fromEntries(f.rules.map(x => [x.code, x.n])), { fut: 1, marketed: 1, cooldown: 1 });
  assert.deepEqual(Object.fromEntries(f.consent.map(x => [x.code, x.n])), { stop: 3, noconsent: 1, unconfirmed: 1, denied: 1, review: 1, block: 1 });
  assert.equal(f.allowed, 2); assert.equal(f.allowed, r.valid, "можно отправлять = получатели проверки");
  assert.equal(f.segment - sum(f.rules) - sum(f.consent), f.allowed, "каждый — один раз");
  assert.equal(code(f.rules, "fut"), 1, "708 со «стопом» и записью — только в «стоп»");
  assert.ok([...f.rules, ...f.consent].every(x => typeof x.why === "string" && x.why.length > 3 && x.why !== x.code && /[а-яё]/.test(x.why)), "причины словами");
  assert.match(f.consent.find(x => x.code === "stop").why, /стоп/); assert.match(f.rules.find(x => x.code === "cooldown").why, /отмен/);
  assert.ok(!JSON.stringify(f).includes(dg(701)), "в воронке только числа");
  // прежние поля проверки на месте
  assert.ok(Array.isArray(r.excluded) && r.segment && r.segment.total === 2);
});

test("воронка второго номера: «нет данных для текста» — в правилах; числа сходятся; без сегмента воронки нет", { skip }, async () => {
  const { s } = await base(), own = await login(s);
  const r = await (await own.post("/api/bc/check", GA)).json(), f = r.funnel;
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(code(f.rules, "nostaff"), 1, "у 711 нет мастера в истории — текст с мастером не собрать");
  assert.equal(f.allowed, 1); assert.equal(f.allowed, r.valid);
  assert.equal(f.segment - sum(f.rules) - sum(f.consent), f.allowed);
  assert.equal(sum(r.excluded), f.segment - f.allowed, "прежний список причин — те же люди");
  const all = await (await own.post("/api/bc/check", { ...GA, segment: "all" })).json();
  assert.equal(all.funnel.segment, 15 - 1, "«вся база» — все с визитом за 90 дней (715 — только запись впереди)");
  assert.equal(code(all.funnel.rules, "recent"), 1, "712 был 5 дней назад");
  assert.equal(all.funnel.segment - sum(all.funnel.rules) - sum(all.funnel.consent), all.funnel.allowed);
  const list = await (await own.post("/api/bc/check", { c: "winchester", ch: "ga", text: "Привет, {имя}", recipients: "+77000000701" })).json();
  assert.equal("funnel" in list, false, "список из Excel — без воронки");
  const bad = await (await own.post("/api/bc/check", { ...META, segment: "nope" })).json();
  assert.equal(bad.funnel, null, "сегмент не найден — воронки нет, ошибка в errors"); assert.ok(bad.errors.length);
});

test("без базы согласий: никто не получит, все — «нет согласия», причина видна; отсутствие согласия не считается согласием", { skip }, async () => {
  const { s } = await base(false), own = await login(s);
  const f = (await (await own.post("/api/bc/check", META)).json()).funnel;
  assert.equal(f.allowed, 0);
  assert.equal(sum(f.consent), f.segment); assert.deepEqual(f.consent.map(x => x.code), ["noconsent"]);
  assert.match(f.note, /базы согласий/i);
});
