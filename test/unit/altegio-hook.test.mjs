// Вебхук Altegio (ТЗ v4, просьба владельца 08.11.2026: «нельзя, чтобы система проверяла Altegio не раз в 15 минут, а моментально?»).
// Altegio сам присылает событие о записи на /alt/<компания>?t=<пароль>. Событие — только «звонок»: отметка, что в Altegio что-то
// изменилось (и как читать журнал: изменённые записи, весь журнал при удалении, бонусы при оплате). Сам запрос Altegio не читает и
// ничего не отправляет: журнал читает и сообщения отправляет одна фоновая проверка раз в минуту — так второй номер не выходит за
// 2 сообщения в минуту (находка проверки 08.11.2026: каждое событие запускало свою отправку — 8 сообщений за 4,5 с), проходы не
// мешают друг другу, а оборванный запрос не теряет сообщение. Событие ускоряет только то, чего минутная проверка без него не видела:
// отмену (было до 15 минут) и бонусы при оплате без изменения записи. Всё на заглушках: живые события Altegio не проверены.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { jrRun } from "../../src/services/reminders/journal.js";
import { altHookPass } from "../../src/services/reminders/hook.js";
import { leaseTake } from "../../src/db/d1/sync.js";
import { SCENARIOS } from "../../src/services/reminders/templates.js";

const LOC = 133486;
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", GA_ID_WINCHESTER: "7105000091", GA_TOKEN_WINCHESTER: "ga-tok-hook", REMIND_GA_WINCHESTER: "1" };
const day = n => new Date(Date.now() + n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
let rid = 9100;
const ph = i => "+7700000" + String(i).padStart(4, "0");
const dg = i => ph(i).slice(1);
const rec = (i, o = {}) => ({ id: o.id || ++rid, datetime: `${o.date || day(1)}T${o.time || "15:00"}:00+05:00`, deleted: false, attendance: o.att ?? 0,
  create_date: o.made || new Date(Date.now() - 2 * 3600e3).toISOString(), last_change_date: o.changed || new Date().toISOString(),
  staff: { id: 1, name: "Тони" }, client: { id: 1, phone: ph(i), name: o.name || "Арман" }, services: [{ id: 1, title: "Мужская стрижка" }], short_link: "https://openhc.kz/c/AAAAA/BBBBB/" });
const sent = () => net.ga.filter(x => x.op === "sendMessage").map(x => ({ to: x.body.chatId.replace("@c.us", ""), text: x.body.message }));
const reads = () => net.alt.filter(x => /^GET \/(records|visit|loyalty)\//.test(x)).length;
// сценарии включены и одобрены, часы отправки — круглые сутки (проверка не зависит от того, в котором часу её запустили)
async function stand(env = ENV, on = { confirm: true, cancel: true }) {
  const s = mk(env);
  await s.kv.api.put("svtpl:winchester", JSON.stringify(Object.fromEntries(SCENARIOS.filter(x => x.auto).map(x => [x.id, { v: x.v, at: 1 }]))));
  await s.kv.api.put("msgset:winchester", JSON.stringify({ win: { from: 0, to: 24 }, s: Object.fromEntries(Object.entries(on).map(([id, v]) => [id, { on: v, at: 1, by: "test", t: id === "confirm" ? { delay: 0 } : {} }])) }));
  return s;
}
const hook = async (s, body, pass) => s.browser().go(`/alt/winchester?t=${pass ?? await altHookPass(s.env, "winchester")}`, { method: "POST", headers: { "content-type": "application/json", origin: "" }, body: JSON.stringify(body) });
const withD1 = (x = {}) => ({ ...ENV, ...x, ...(sqliteOk ? { DB: d1With("production").db } : {}) });

test("вебхук Altegio: без пароля и с чужим паролем — 403, неизвестная компания — 404, проверка адреса (GET) — 200", async () => {
  net.reset();
  const s = await stand();
  assert.equal((await s.browser().go("/alt/winchester", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 403);
  assert.equal((await hook(s, { company_id: LOC, resource: "record", resource_id: 1, status: "create" }, "0".repeat(32))).status, 403);
  assert.equal((await s.browser().go(`/alt/nobody?t=${await altHookPass(s.env, "nobody")}`, { method: "POST", body: "{}" })).status, 404);
  assert.equal((await s.browser().go(`/alt/winchester?t=${await altHookPass(s.env, "winchester")}`)).status, 200);
  assert.equal(reads(), 0, "по отклонённым событиям Altegio не читаем");
});

test("вебхук Altegio: новая запись — в самом запросе Altegio не читаем и не шлём; «Запись подтверждена» уходит в ближайшую минуту; повтор события — одно сообщение", async () => {
  net.reset();
  net.altJournal = [];
  const s = await stand();
  const t0 = Date.now();
  await jrRun(s.env, t0); // первое чтение журнала (было до события)
  const r = rec(301, { made: new Date().toISOString() });
  net.altJournal.push(r);
  const r0 = reads();
  const res = await hook(s, { company_id: LOC, resource: "record", resource_id: r.id, status: "create", data: { id: r.id } });
  assert.equal(res.status, 200);
  assert.equal(reads(), r0, "запрос вебхука журнал не читает");
  assert.deepEqual(sent(), [], "и ничего не отправляет");
  await jrRun(s.env, t0 + 60e3); // фоновая проверка в следующую минуту
  assert.equal(sent().length, 1, "сообщение ушло: " + JSON.stringify(sent()));
  assert.equal(sent()[0].to, dg(301));
  await hook(s, { company_id: LOC, resource: "record", resource_id: r.id, status: "create", data: { id: r.id } });
  await jrRun(s.env, t0 + 120e3);
  assert.equal(sent().length, 1, "повтор события — второго сообщения нет");
});

test("вебхук Altegio: запись удалили — отмена в ближайшую минуту (полное чтение по событию), без события — не раньше полного чтения раз в 15 минут", async () => {
  net.reset();
  const r = rec(311, { made: new Date(Date.now() - 3 * 3600e3).toISOString() });
  net.altJournal = [r];
  const s = await stand(ENV, { cancel: true });
  const t0 = Date.now();
  await jrRun(s.env, t0); // запись видели
  net.altJournal = [];
  const r0 = reads();
  await jrRun(s.env, t0 + 60e3);
  assert.equal(reads(), r0, "без события и без подтверждения минутная проверка журнал не читает");
  assert.deepEqual(sent(), []);
  await hook(s, { company_id: LOC, resource: "record", resource_id: r.id, status: "delete", data: { id: r.id, deleted: true } });
  assert.deepEqual(sent(), [], "в самом запросе — не шлём");
  await jrRun(s.env, t0 + 120e3);
  assert.deepEqual(sent(), [], "об отмене — через 3 минуты: администратор мог «перенести» запись удалением и новой записью");
  const r1 = reads();
  await jrRun(s.env, t0 + 300e3);
  assert.equal(sent().length, 1, JSON.stringify(sent()));
  assert.match(sent()[0].text, /отменена/);
  assert.ok(reads() - r1 <= 1, "событие обработано — дальше журнал не читаем заново (только сверка дня записи перед отправкой)");
});

test("вебхук Altegio: чужая локация, событие не о записи и не об оплате, главный выключатель выключен, тестовая версия — 200, отметки нет", async () => {
  net.reset();
  net.altJournal = [rec(321)];
  const t0 = Date.now();
  const s = await stand(ENV, { cancel: true });
  await jrRun(s.env, t0);
  const r0 = reads();
  assert.equal((await hook(s, { company_id: 999, resource: "record", resource_id: 1, status: "create" })).status, 200);
  for (const res of ["client", "goods_operations_sale", "staff"]) assert.equal((await hook(s, { company_id: LOC, resource: res, resource_id: 1, status: "update" })).status, 200);
  await jrRun(s.env, t0 + 60e3);
  assert.equal(reads(), r0, "журнал по таким событиям не читаем");
  const { REMIND_GA_WINCHESTER, ...off } = ENV;
  const s2 = await stand(off);
  assert.equal((await hook(s2, { company_id: LOC, resource: "record", resource_id: 1, status: "create" })).status, 200);
  const s3 = await stand({ ...ENV, STAGE: "preview" }, { cancel: true });
  await jrRun(s3.env, t0);
  const r3 = reads();
  assert.equal((await hook(s3, { company_id: LOC, resource: "record", resource_id: 1, status: "delete" })).status, 200);
  await jrRun(s3.env, t0 + 60e3);
  assert.equal(reads(), r3); assert.deepEqual(sent(), []);
});

// находки разведки документации Altegio (08.11.2026): событие могло быть больше предела или нечитаемым — не теряем его, а читаем журнал;
// отмена может прийти «изменением» с deleted; оплата и бонусы — событиями finances_operation / loyalty_card, а запись при этом не меняется
test("вебхук Altegio: нечитаемое или большое тело с верным паролем — всё равно читаем журнал в ближайшую минуту (событие не теряем)", async () => {
  net.reset();
  net.altJournal = [];
  const s = await stand(ENV, { cancel: true }); // только отмена: без события минутная проверка журнал не читает
  const t0 = Date.now();
  await jrRun(s.env, t0);
  const pass = await altHookPass(s.env, "winchester");
  assert.equal((await s.browser().go(`/alt/winchester?t=${pass}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{не json" })).status, 200);
  assert.equal((await s.browser().go(`/alt/winchester?t=${pass}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company_id: LOC, resource: "record", resource_id: 1, status: "update", data: { x: "y".repeat(300 * 1024) } }) })).status, 200);
  const r0 = reads();
  await jrRun(s.env, t0 + 60e3);
  assert.ok(reads() > r0, "журнал прочитан по событию");
});

test("вебхук Altegio: отмена пришла «изменением» с deleted — сообщение об отмене в ближайшую минуту", async () => {
  net.reset();
  const r = rec(331, { made: new Date(Date.now() - 3 * 3600e3).toISOString() });
  net.altJournal = [r];
  const s = await stand(ENV, { cancel: true });
  const t0 = Date.now();
  await jrRun(s.env, t0);
  net.altJournal = [];
  await hook(s, { company_id: LOC, resource: "record", resource_id: r.id, status: "update", data: { id: r.id, deleted: true } });
  await jrRun(s.env, t0 + 60e3); await jrRun(s.env, t0 + 240e3);
  assert.equal(sent().length, 1); assert.match(sent()[0].text, /отменена/);
});

test("вебхук Altegio: оплата (finances_operation) — бонусы в ближайшую минуту, даже если запись не менялась 20 минут; второе событие — без повтора", async () => {
  net.reset();
  const today = day(0), t = new Date(Date.now() + 5 * 3600e3).toISOString().slice(11, 16);
  const r = rec(341, { date: today, time: t, att: 1, made: new Date(Date.now() - 5 * 3600e3).toISOString(), changed: new Date(Date.now() - 20 * 60e3).toISOString() });
  Object.assign(r, { visit_id: 9341 }); r.client.id = 7341;
  net.altJournal = [r];
  net.altLoyalty = { cards: { 7341: [{ id: 77, balance: 1500 }] }, details: { 9341: { loyalty_transactions: [] } } };
  const s = await stand(ENV, { bonusIn: true });
  const t0 = Date.now();
  await jrRun(s.env, t0); // визит виден, операций ещё нет
  assert.deepEqual(sent(), []);
  const ts = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 19).replace("T", " ");
  net.altLoyalty.details[9341].loyalty_transactions.push({ id: 8341, card_id: 77, amount: 400, created_date: ts });
  await jrRun(s.env, t0 + 60e3);
  assert.deepEqual(sent(), [], "без события запись не менялась — бонусы увидим только через 15 минут");
  await hook(s, { company_id: LOC, resource: "finances_operation", resource_id: 901, status: "create", data: { id: 901, record_id: r.id, amount: 7000 } });
  await jrRun(s.env, t0 + 120e3);
  assert.deepEqual(sent().map(x => x.text), ["Начислено бонусов: 400\nДоступно: 1500"]);
  await hook(s, { company_id: LOC, resource: "loyalty_card", resource_id: 77, status: "update", data: { id: 77, balance: 1500 } });
  await jrRun(s.env, t0 + 180e3);
  assert.equal(sent().length, 1, "второе событие о той же оплате — без повтора");
});

// находка проверки 08.11.2026: каждое событие запускало свою отправку — 8 подтверждений за 4,5 с с неофициального номера
test("вебхук Altegio: пачка событий не обходит предел второго номера — не больше 2 сообщений в минуту", async () => {
  net.reset();
  net.altJournal = [];
  const s = await stand(ENV, { confirm: true });
  const t0 = Date.now();
  await jrRun(s.env, t0);
  for (let i = 0; i < 8; i++) net.altJournal.push(rec(351 + i, { made: new Date().toISOString() }));
  for (let i = 0; i < 6; i++) await hook(s, { company_id: LOC, resource: "record", resource_id: 1, status: "create" });
  assert.deepEqual(sent(), [], "события сами не шлют");
  await jrRun(s.env, t0 + 60e3);
  assert.equal(sent().length, 2);
  await Promise.all([jrRun(s.env, t0 + 120e3), jrRun(s.env, t0 + 120e3)]); // две фоновые задачи разом — один проход
  assert.equal(sent().length, 4, JSON.stringify(sent()));
  assert.equal(new Set(sent().map(x => x.to)).size, 4, "без дублей");
});

test("вебхук Altegio: событие во время прохода по журналу не теряется — следующая минута читает журнал ещё раз", async () => {
  net.reset();
  const r = rec(361, { made: new Date(Date.now() - 3 * 3600e3).toISOString() });
  net.altJournal = [r];
  const s = await stand(ENV, { cancel: true });
  const t0 = Date.now();
  await jrRun(s.env, t0 - 120e3);
  await hook(s, { company_id: LOC, resource: "record", resource_id: r.id, status: "update" });
  // проход, начатый до события (в фоновой задаче время прохода — время её запуска): событие пришло, когда журнал уже прочитан
  await jrRun(s.env, t0 - 60e3);
  net.altJournal = [];
  const r0 = reads();
  await jrRun(s.env, t0 + 60e3);
  assert.ok(reads() > r0, "событие осталось — журнал прочитан снова");
  const r1 = reads();
  await jrRun(s.env, t0 + 120e3);
  assert.equal(reads(), r1, "обработано — больше не читаем");
});

test("вебхук Altegio: с базой D1 отметка события — в D1; проход по журналу один на компанию (аренда в D1)", { skip: !sqliteOk }, async () => {
  net.reset();
  const r = rec(371, { made: new Date(Date.now() - 3 * 3600e3).toISOString() });
  net.altJournal = [r];
  const s = await stand(withD1(), { cancel: true });
  const t0 = Date.now();
  await jrRun(s.env, t0);
  net.altJournal = [];
  await hook(s, { company_id: LOC, resource: "record", resource_id: r.id, status: "delete" });
  const rows = (await s.env.DB.prepare("select scope from sync_state where ws = 'winchester' and source = 'althook'").all()).results;
  assert.deepEqual(rows.map(x => x.scope), ["full"]);
  assert.equal(await s.kv.api.get("jrw:winchester:full"), null, "с базой — не в KV");
  // проход уже идёт в другом экземпляре Worker (аренда занята) — эта фоновая задача журнал не читает и не шлёт
  assert.equal(await leaseTake(s.env.DB, "winchester", "jr", "other-worker", Date.now(), 60e3), true);
  const r0 = reads();
  await jrRun(s.env, t0 + 60e3);
  assert.equal(reads(), r0); assert.deepEqual(sent(), []);
  await s.env.DB.prepare("update sync_state set lease_until = 0 where ws = 'winchester' and source = 'jr'").run(); // тот проход кончился
  await jrRun(s.env, t0 + 120e3); await jrRun(s.env, t0 + 300e3);
  assert.equal(sent().length, 1); assert.match(sent()[0].text, /отменена/);
});

test("вебхук Altegio: отметку события не записать (хранилище не отвечает) — 503, Altegio повторит", async () => {
  net.reset();
  const s = await stand({ ...ENV, DB: undefined }); // без базы D1 — отметка в KV
  s.kv.fail.put = k => k.startsWith("jrw:");
  assert.equal((await hook(s, { company_id: LOC, resource: "record", resource_id: 1, status: "create" })).status, 503);
  s.kv.fail.put = null;
  assert.equal((await hook(s, { company_id: LOC, resource: "record", resource_id: 1, status: "create" })).status, 200);
  if (sqliteOk) { // база D1 у адреса есть, но не та (отметка другой стадии) — не пишем мимо неё в KV: 503
    const s2 = await stand({ ...ENV, DB: d1With("preview").db });
    assert.equal((await hook(s2, { company_id: LOC, resource: "record", resource_id: 1, status: "create" })).status, 503);
    assert.equal(await s2.kv.api.get("jrw:winchester:fast"), null);
  }
});

test("вебхук Altegio: адрес видит только владелец; последнее событие — время и вид, без данных клиента; почему события не обрабатываются", async () => {
  net.reset();
  net.altJournal = [];
  const s = await stand({ ...ENV, KEY_WINCHESTER: "staff-key-winch-0001" });
  const login = async (st, key) => { const b = st.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${key}&next=%2Fapp%2F` }); return b; };
  const own = await login(s, "owner-key-123456"), staff = await login(s, "staff-key-winch-0001");
  let j = await (await own.go("/api/msg/auto?c=winchester")).json();
  assert.ok(j.hook && j.hook.url.endsWith(`/alt/winchester?t=${await altHookPass(s.env, "winchester")}`), JSON.stringify(j.hook));
  assert.equal(j.hook.last, null); assert.equal(j.hook.on, true); assert.equal(j.hook.why, "");
  const js = await (await staff.go("/api/msg/auto?c=winchester")).json();
  assert.ok(!JSON.stringify(js).includes(await altHookPass(s.env, "winchester")), "сотруднику пароль адреса не показываем");
  await hook(s, { company_id: LOC, resource: "record", resource_id: 5, status: "update", data: { client: { phone: "+77000000555", name: "Секрет" } } });
  j = await (await own.go("/api/msg/auto?c=winchester")).json();
  assert.equal(j.hook.last.res, "record"); assert.equal(j.hook.last.st, "update"); assert.ok(j.hook.last.at > 0);
  assert.ok(!/Секрет|7000000555/.test(JSON.stringify(j.hook)));
  // главный выключатель выключен, тестовая версия — адрес показываем, но честно пишем, что события не обрабатываются
  const { REMIND_GA_WINCHESTER, ...off } = ENV;
  const s2 = await stand(off);
  const j2 = await (await (await login(s2, "owner-key-123456")).go("/api/msg/auto?c=winchester")).json();
  assert.equal(j2.hook.on, false); assert.match(j2.hook.why, /выключ/);
  const s3 = await stand({ ...ENV, STAGE: "preview" });
  const j3 = await (await (await login(s3, "owner-key-123456")).go("/api/msg/auto?c=winchester")).json();
  assert.equal(j3.hook.on, false); assert.match(j3.hook.why, /тестов/i);
});
