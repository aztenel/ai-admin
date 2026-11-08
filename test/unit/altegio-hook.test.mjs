// Вебхук Altegio (ТЗ v4, просьба владельца 08.11.2026: «нельзя, чтобы система проверяла Altegio не раз в 15 минут, а моментально?»).
// Altegio сам присылает событие о записи на /alt/<компания>?t=<пароль>; данным из события не доверяем — по нему сразу читаем журнал своим
// ключом (изменённые записи, при удалении — полное чтение) и отправляем то, что пора. Расписание (раз в минуту и раз в 15 минут) остаётся
// страховкой: событие могло не прийти. Всё на заглушках: живые события Altegio не проверены.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { jrRun } from "../../src/services/reminders/journal.js";
import { altHookPass } from "../../src/services/reminders/hook.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";
import { SCENARIOS } from "../../src/services/reminders/templates.js";

const W = CLIENTS.winchester, LOC = 133486;
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", GA_ID_WINCHESTER: "7105000091", GA_TOKEN_WINCHESTER: "ga-tok-hook", REMIND_GA_WINCHESTER: "1" };
const day = n => new Date(Date.now() + n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
let rid = 9100;
const ph = i => "+7700000" + String(i).padStart(4, "0");
const dg = i => ph(i).slice(1);
const rec = (i, o = {}) => ({ id: o.id || ++rid, datetime: `${o.date || day(1)}T${o.time || "15:00"}:00+05:00`, deleted: false, attendance: o.att ?? 0,
  create_date: o.made || new Date(Date.now() - 2 * 3600e3).toISOString(), last_change_date: o.changed || new Date().toISOString(),
  staff: { id: 1, name: "Тони" }, client: { id: 1, phone: ph(i), name: o.name || "Арман" }, services: [{ id: 1, title: "Мужская стрижка" }], short_link: "https://openhc.kz/c/AAAAA/BBBBB/" });
const sent = () => net.ga.filter(x => x.op === "sendMessage").map(x => ({ to: x.body.chatId.replace("@c.us", ""), text: x.body.message }));
const reads = () => net.alt.filter(x => /^GET \/records\//.test(x)).length;
// сценарии включены и одобрены, часы отправки — круглые сутки (проверка не зависит от того, в котором часу её запустили)
async function stand(env = ENV, on = { confirm: true, cancel: true }) {
  const s = mk(env);
  await s.kv.api.put("svtpl:winchester", JSON.stringify(Object.fromEntries(SCENARIOS.filter(x => x.auto).map(x => [x.id, { v: x.v, at: 1 }]))));
  await s.kv.api.put("msgset:winchester", JSON.stringify({ win: { from: 0, to: 24 }, s: Object.fromEntries(Object.entries(on).map(([id, v]) => [id, { on: v, at: 1, by: "test", t: id === "confirm" ? { delay: 0 } : {} }])) }));
  return s;
}
const hook = async (s, body, pass) => s.browser().go(`/alt/winchester?t=${pass ?? await altHookPass(s.env, "winchester")}`, { method: "POST", headers: { "content-type": "application/json", origin: "" }, body: JSON.stringify(body) });

test("вебхук Altegio: без пароля и с чужим паролем — 403, неизвестная компания — 404, проверка адреса (GET) — 200", async () => {
  net.reset();
  const s = await stand();
  assert.equal((await s.browser().go("/alt/winchester", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 403);
  assert.equal((await hook(s, { company_id: LOC, resource: "record", resource_id: 1, status: "create" }, "0".repeat(32))).status, 403);
  assert.equal((await s.browser().go(`/alt/nobody?t=${await altHookPass(s.env, "nobody")}`, { method: "POST", body: "{}" })).status, 404);
  assert.equal((await s.browser().go(`/alt/winchester?t=${await altHookPass(s.env, "winchester")}`)).status, 200);
  assert.equal(reads(), 0, "по отклонённым событиям Altegio не читаем");
});

test("вебхук Altegio: новая запись — «Запись подтверждена» уходит сразу, без ожидания расписания; повтор события — одно сообщение", async () => {
  net.reset();
  net.altJournal = [];
  const s = await stand();
  await jrRun(s.env, Date.now()); // первое чтение журнала (было до события)
  const r = rec(301, { made: new Date().toISOString() });
  net.altJournal.push(r);
  const res = await hook(s, { company_id: LOC, resource: "record", resource_id: r.id, status: "create", data: { id: r.id } });
  assert.equal(res.status, 200);
  assert.equal(sent().length, 1, "сообщение ушло по событию: " + JSON.stringify(sent()));
  assert.equal(sent()[0].to, dg(301));
  await hook(s, { company_id: LOC, resource: "record", resource_id: r.id, status: "create", data: { id: r.id } });
  assert.equal(sent().length, 1, "повтор события — второго сообщения нет");
});

test("вебхук Altegio: запись удалили — сообщение об отмене сразу (полное чтение журнала), не через 15 минут", async () => {
  net.reset();
  const r = rec(311, { made: new Date(Date.now() - 3 * 3600e3).toISOString() });
  net.altJournal = [r];
  const s = await stand(ENV, { cancel: true });
  await jrRun(s.env, Date.now()); // запись видели
  net.altJournal = [];
  await hook(s, { company_id: LOC, resource: "record", resource_id: r.id, status: "delete", data: { id: r.id, deleted: true } });
  assert.equal(sent().length, 1, JSON.stringify(sent()));
  assert.match(sent()[0].text, /отменена/);
});

test("вебхук Altegio: чужая локация, главный выключатель выключен, тестовая версия — 200 и ничего не читаем и не шлём", async () => {
  net.reset();
  net.altJournal = [rec(321)];
  const s = await stand();
  await hook(s, { company_id: 999, resource: "record", resource_id: 1, status: "create" });
  const { REMIND_GA_WINCHESTER, ...off } = ENV;
  const s2 = await stand(off);
  assert.equal((await hook(s2, { company_id: LOC, resource: "record", resource_id: 1, status: "create" })).status, 200);
  const s3 = await stand({ ...ENV, STAGE: "preview" });
  assert.equal((await hook(s3, { company_id: LOC, resource: "record", resource_id: 1, status: "create" })).status, 200);
  assert.equal(reads(), 0); assert.deepEqual(sent(), []);
  assert.equal((await hook(s, "не json")).status, 200, "непонятное тело — 200 без обработки (Altegio не повторяет зря)");
});

test("вебхук Altegio: адрес видит только владелец; последнее событие — время и вид, без данных клиента", async () => {
  net.reset();
  net.altJournal = [];
  const s = await stand({ ...ENV, KEY_WINCHESTER: "staff-key-winch-0001" });
  const login = async key => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${key}&next=%2Fapp%2F` }); return b; };
  const own = await login("owner-key-123456"), staff = await login("staff-key-winch-0001");
  let j = await (await own.go("/api/msg/auto?c=winchester")).json();
  assert.ok(j.hook && j.hook.url.endsWith(`/alt/winchester?t=${await altHookPass(s.env, "winchester")}`), JSON.stringify(j.hook));
  assert.equal(j.hook.last, null);
  const js = await (await staff.go("/api/msg/auto?c=winchester")).json();
  assert.ok(!JSON.stringify(js).includes(await altHookPass(s.env, "winchester")), "сотруднику пароль адреса не показываем");
  await hook(s, { company_id: LOC, resource: "record", resource_id: 5, status: "update", data: { client: { phone: "+77000000555", name: "Секрет" } } });
  j = await (await own.go("/api/msg/auto?c=winchester")).json();
  assert.equal(j.hook.last.res, "record"); assert.equal(j.hook.last.st, "update"); assert.ok(j.hook.last.at > 0);
  assert.ok(!/Секрет|7000000555/.test(JSON.stringify(j.hook)));
});
