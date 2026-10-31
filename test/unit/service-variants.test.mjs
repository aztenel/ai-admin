// Варианты текстов сервисных сообщений (ТЗ Winchester v3.0, SRV-01, 31.10.2026): у сценария несколько вариантов текста — встроенные
// и свои у владельца (RU обязателен, KZ — нет); владелец выбирает действующий, одобрение — у действующего варианта и его версии;
// отправка — только действующим одобренным; задним числом не шлём (одобрили позже, чем сообщение должно было уйти — не уходит).
// Рубрики сценариев. Всё на заглушках (net.altJournal, net.ga), номера вымышленные (+7 700 000 4x xx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { jrRun } from "../../src/services/reminders/journal.js";
import { SCENARIOS, SV_CATS, variantsOf, activeOf, approvedVariant } from "../../src/services/reminders/templates.js";
import { atLocal } from "../../src/services/reminders/plan.js";

const INST = { id: "7105000098", token: "ga-tok-var" };
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token, REMIND_GA_WINCHESTER: "1",
  KEY_WINCHESTER: "staff-key-winch-0001", KEY_BARBER: "staff-key-barber-0001" };
const TODAY = "2026-10-19", TOM = "2026-10-20", YDAY = "2026-10-18";
const at = (date, time) => atLocal(date, time);
let rid = 4000;
const rec = (phone, date, time, o = {}) => ({ id: o.id || ++rid, datetime: `${date}T${time}:00+05:00`, deleted: false, attendance: 0,
  create_date: `${YDAY}T12:00:00+05:00`, staff: { id: 1, name: o.staff || "Тони" }, client: { id: 1, phone, name: o.name ?? "Клиент" }, services: [{ id: 1, title: "Мужская стрижка" }] });
const ph = i => "+7700000" + String(i).padStart(4, "0");
const dg = i => ph(i).slice(1);
const sent = () => net.ga.filter(x => x.op === "sendMessage").map(x => ({ to: x.body.chatId.replace("@c.us", ""), text: x.body.message }));
const login = async (s, key) => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${key}&next=%2Fapp%2F` }); return b; };
const cat = async (b, id) => (await (await b.go("/api/bc/service?c=winchester")).json()).catalog.find(x => x.id === id);
const MINE = "Завтра в {время} ждём вас в {компания}[[, мастер {мастер}]]. Если планы изменились, напишите сюда.";

test("каталог: рубрики, у сценария — варианты текста (встроенные), действующий — первый; KZ, если нет своего, — по-русски", () => {
  assert.deepEqual(SV_CATS.map(x => x.label), ["Запись", "Напоминания", "Изменения", "Опоздания и неявки", "После визита", "Ошибки и задачи"]);
  const s03 = SCENARIOS.find(x => x.id === "S03");
  assert.deepEqual(variantsOf(s03).map(x => [x.id, x.builtin, x.v]), [["b1", true, s03.v], ["b2", true, s03.v]]);
  assert.equal(activeOf(s03, {}).id, "b1");
  assert.equal(activeOf(s03, { S03: { active: "nope" } }).id, "b1", "нет такого — первый встроенный");
  const own = { S03: { active: "u1x", list: [{ id: "u1x", ru: "Свой", kk: "", v: 3 }] } };
  assert.equal(activeOf(s03, own).id, "u1x");
  assert.equal(approvedVariant(s03, { S03: { v: s03.v, at: 1 } }, own), null, "одобрен встроенный, а действует свой");
  assert.equal(approvedVariant(s03, { S03: { v: 3, at: 1, var: "u1x" } }, own).ru, "Свой");
  assert.equal(approvedVariant(s03, { S03: { v: s03.v, at: 1 } }, {}).id, "b1", "одобрение до вариантов — первого встроенного");
});

test("свой вариант: создаёт и выбирает владелец, одобряет действующий; отправка — им; правка снимает одобрение", async () => {
  net.reset();
  net.altJournal = [rec(ph(401), TOM, "15:00", { id: 4401, name: "Арман", staff: "Айдос" })];
  const s = mk(ENV), own = await login(s, "owner-key-123456"), staff = await login(s, "staff-key-winch-0001"), other = await login(s, "staff-key-barber-0001");
  let c = await cat(own, "S03");
  assert.equal(c.cat, "remind"); assert.equal(c.catLabel, "Напоминания"); assert.equal(c.active, "b1");
  assert.deepEqual(c.variants.map(x => [x.id, x.active, x.approved, x.builtin]), [["b1", true, false, true], ["b2", false, false, true]]);
  assert.deepEqual((await (await own.go("/api/bc/service?c=winchester")).json()).cats, SV_CATS);
  assert.equal((await staff.post("/api/bc/service/variant", { c: "winchester", id: "S03", ru: MINE })).status, 403, "сотрудник не меняет");
  assert.equal((await other.post("/api/bc/service/variant", { c: "winchester", id: "S03", ru: MINE })).status, 403, "чужая компания");
  let r = await (await own.post("/api/bc/service/variant", { c: "winchester", id: "S03", ru: MINE, active: true, op: "Кайрат" })).json();
  assert.equal(r.ok, true, JSON.stringify(r)); assert.match(r.variant, /^u/); assert.equal(r.active, r.variant);
  const mine = r.variant;
  c = await cat(own, "S03");
  assert.equal(c.active, mine); assert.equal(c.v, 1); assert.equal(c.approved, false); assert.match(c.preview.ru, /^Завтра в 15:00 ждём вас в Winchester, мастер Данияр\./);
  // одобрить: только действующий и его версию
  assert.equal((await own.post("/api/bc/service/approve", { c: "winchester", id: "S03", v: SCENARIOS.find(x => x.id === "S03").v, variant: "b1" })).status, 409);
  assert.equal((await own.post("/api/bc/service/approve", { c: "winchester", id: "S03", v: 1, variant: mine })).status, 200);
  c = await cat(own, "S03");
  assert.equal(c.approved, true); assert.ok(c.variants.find(x => x.id === mine).approved && !c.variants.find(x => x.id === "b1").approved);
  await jrRun(s.env, at(TODAY, "17:50")); await jrRun(s.env, at(TODAY, "18:00"));
  assert.deepEqual(sent(), [{ to: dg(401), text: "Завтра в 15:00 ждём вас в Winchester, мастер Айдос. Если планы изменились, напишите сюда." }]);
  // правка своего варианта — новая версия, прежнее одобрение к ней не подходит
  r = await (await own.post("/api/bc/service/variant", { c: "winchester", id: "S03", variant: mine, ru: MINE.replace("ждём вас", "будем ждать вас") })).json();
  assert.equal(r.ok, true); assert.equal(r.variants.find(x => x.id === mine).v, 2); assert.equal(r.variants.find(x => x.id === mine).approved, false);
  assert.equal((await cat(own, "S03")).approved, false);
  // вернуть встроенный: одобрение было у своего — не подходит
  r = await (await own.post("/api/bc/service/variant", { c: "winchester", id: "S03", variant: "b2", active: true })).json();
  assert.equal(r.active, "b2"); assert.equal((await cat(own, "S03")).approved, false);
});

test("свой вариант: проверки текста; встроенный не меняется; сценарий без текста; не больше пяти своих", async () => {
  net.reset();
  const s = mk(ENV), own = await login(s, "owner-key-123456");
  const post = b => own.post("/api/bc/service/variant", { c: "winchester", id: "S03", ...b });
  let r = await post({ ru: "Ждём в {время} {погода}" }); assert.equal(r.status, 400); assert.match((await r.json()).error, /Неизвестная вставка \{погода\}/);
  r = await post({ ru: "Ждём в [время]" }); assert.equal(r.status, 400); assert.match((await r.json()).error, /квадратные скобки/);
  r = await post({ ru: "" }); assert.equal(r.status, 400);
  r = await post({ variant: "b1", ru: "Другой" }); assert.equal(r.status, 400); assert.match((await r.json()).error, /Встроенный текст не меняется/);
  r = await post({ variant: "u404", ru: "Другой" }); assert.equal(r.status, 404);
  assert.equal((await own.post("/api/bc/service/variant", { c: "winchester", id: "S08", ru: "Мастер заболел" })).status, 400, "сценарий без текста клиенту");
  assert.equal((await own.post("/api/bc/service/variant", { c: "winchester", id: "S99", ru: "x" })).status, 404);
  for (let i = 0; i < 5; i++) assert.equal((await post({ ru: `Вариант ${i}: ждём в {время}`, kk: `Нұсқа ${i}: {время}` })).status, 200, "вариант " + i);
  r = await post({ ru: "Шестой" }); assert.equal(r.status, 400); assert.match((await r.json()).error, /не больше пяти/);
  assert.equal((await own.post("/api/bc/service/variant", { c: "barber", id: "S03", ru: "x" })).status, 404, "у компании без напоминаний по журналу");
});

test("задним числом не шлём: одобрили позже, чем сообщение должно было уйти, — оно не уходит, причина в журнале; KZ нет — по-русски", async () => {
  net.reset();
  net.altJournal = [rec(ph(411), TOM, "15:00", { id: 4411 }), rec(ph(412), TOM, "16:00", { id: 4412 })];
  const s = mk(ENV);
  const S03 = SCENARIOS.find(x => x.id === "S03");
  await s.kv.api.put(`h:ga:winchester:${dg(412)}`, JSON.stringify({ n: 1, turns: [{ role: "user", text: "Сәлем", t: 1 }], profile: { lang: "kk" } }));
  await jrRun(s.env, at(TODAY, "17:50")); await jrRun(s.env, at(TODAY, "18:00")); // не одобрено — ждёт
  assert.deepEqual(sent(), []);
  await s.kv.api.put("svtpl:winchester", JSON.stringify({ S03: { v: S03.v, at: at(TODAY, "18:20"), var: "b1" } })); // одобрили в 18:20
  await jrRun(s.env, at(TODAY, "18:30"));
  assert.deepEqual(sent(), [], "сообщение 18:00 после одобрения в 18:20 не уходит");
  assert.ok((s.kv.json("jrl:winchester") || []).some(x => x.rec === "4411" && /одобрен позже/.test(x.why)), JSON.stringify(s.kv.json("jrl:winchester")));
  // отправку только что включили (первое чтение журнала): напоминание, время которого уже прошло, не уходит; будущее — уходит
  net.reset();
  net.altJournal = [rec(ph(414), TOM, "15:00", { id: 4414 }), rec(ph(415), TODAY, "21:00", { id: 4415 })];
  const s1 = mk(ENV);
  await s1.kv.api.put("svtpl:winchester", JSON.stringify({ S03: { v: S03.v, at: 1 }, S04: { v: SCENARIOS.find(x => x.id === "S04").v, at: 1 } }));
  await jrRun(s1.env, at(TODAY, "18:10")); // накануне в 18:00 по записи 4414 — уже прошло
  assert.ok(!sent().some(x => x.to === dg(414)), JSON.stringify(sent()));
  assert.ok((s1.kv.json("jrl:winchester") || []).some(x => x.rec === "4414" && /задним числом/.test(x.why)), JSON.stringify(s1.kv.json("jrl:winchester")));
  await jrRun(s1.env, at(TODAY, "19:00")); await jrRun(s1.env, at(TODAY, "19:01"));
  assert.ok(sent().some(x => x.to === dg(415) && /^Ждём вас сегодня в 21:00/.test(x.text)), "за 2 часа (19:00) — после включения, уходит: " + JSON.stringify(sent()));
  // свой вариант без KZ: клиенту, который пишет по-казахски, — по-русски
  net.reset();
  net.altJournal = [rec(ph(413), TOM, "15:00", { id: 4413 })];
  const s2 = mk(ENV);
  await s2.kv.api.put(`h:ga:winchester:${dg(413)}`, JSON.stringify({ n: 1, turns: [{ role: "user", text: "Сәлем", t: 1 }], profile: { lang: "kk" } }));
  await s2.kv.api.put("svtpl:winchester:var", JSON.stringify({ S03: { active: "uabc", list: [{ id: "uabc", ru: "Ждём завтра в {время}.", kk: "", v: 1 }] } }));
  await s2.kv.api.put("svtpl:winchester", JSON.stringify({ S03: { v: 1, at: 1, var: "uabc" } }));
  await jrRun(s2.env, at(TODAY, "17:50")); await jrRun(s2.env, at(TODAY, "18:00"));
  assert.deepEqual(sent(), [{ to: dg(413), text: "Ждём завтра в 15:00." }]);
});
