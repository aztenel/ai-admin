// Вкладка «Сервисные · номер бота» нового пульта (19.10.2026): GET /api/bc/service — какие сообщения бот шлёт сам (напоминания и
// просьба об отзыве по записям, сделанным в чате с ботом), очередь ближайших с номерами маской, сколько ушло за 3 дня.
// Владелец и сотрудник компании видят, чужой сотрудник — 403. Всё на заглушках, номера вымышленные.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mk, net } from "../harness.mjs";
import { remindSend } from "../../src/services/reminders/send.js";
import { serviceInfo } from "../../src/services/reminders/info.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";

const OWNER = "owner-key-123456", STAFF_W = "staff-key-winch-0001", STAFF_B = "staff-key-barber-0001";
const ENV = { KEY_WINCHESTER: STAFF_W, KEY_BARBER: STAFF_B, GA_ID_WINCHESTER: "7105000001", GA_TOKEN_WINCHESTER: "ga-tok-w" };
// здесь — напоминания бота по записям из чата; у Winchester с 30.10.2026 — по журналу Altegio (c.jr, test/unit/journal-remind.test.mjs):
// для этих проверок режим журнала снимаем (каждый файл node --test — свой процесс)
before(() => { delete CLIENTS.winchester.jr; });
async function login(s, key) {
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${encodeURIComponent(key)}&next=%2Finbox` });
  assert.ok(b.cookie); return b;
}

test("сервисные сообщения: виды, очередь с именем и номером маской, отправлено за 3 дня; права", async () => {
  net.reset();
  const s = mk(ENV), now = Date.now();
  await s.kv.api.put("rmq:winchester", JSON.stringify([
    { k: "rv", at: now + 5 * 3600e3, ch: "ga", id: "77000001234", rec: "901", date: "2026-10-04", time: "12:00" },
    { k: "d1", at: now + 3600e3, ch: "ga", id: "77000001234", rec: "901", date: "2026-10-04", time: "12:00" },
    { k: "h2", at: now - 5 * 3600e3, ch: "ga", id: "77000005678", rec: "902", date: "2026-10-03", time: "10:00" }]));
  await s.kv.api.put("h:ga:winchester:77000001234", JSON.stringify({ turns: [], profile: { bookings: [{ name: "Арман", date: "2026-10-04", time: "12:00", record_id: 901 }] } }), { metadata: { nm: "Арман", t: now } });
  // ушли: отметки попытки (rms:) и удачной отправки (rmok:); попытка без удачи (rms: 899) — не «отправлено»
  for (const k of ["rms:winchester:900:d1", "rms:winchester:900:rv", "rmok:winchester:900:d1", "rmok:winchester:900:rv", "rms:winchester:899:d1"]) await s.kv.api.put(k, "1");
  const own = await login(s, OWNER), r = await own.go("/api/bc/service?c=winchester"), t = await r.text(), j = JSON.parse(t);
  assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store"); assert.equal(j.owner, true);
  assert.deepEqual(j.kinds.map(x => [x.k, x.on]), [["d1", true], ["h2", true], ["rv", true]]); assert.ok(/2gis/.test(j.kinds[2].link));
  assert.deepEqual(j.queue.map(x => x.k), ["d1", "rv"], "просроченное больше часа — не в очереди, по времени");
  assert.equal(j.queue[0].name, "Арман"); assert.equal(j.queue[0].phone, "+7 700 *** ** 34"); assert.equal(j.total, 2); assert.equal(j.sent3d, 2);
  assert.ok(!t.includes("77000001234") && !t.includes("77000005678"), "полных номеров нет");
  const sw = await login(s, STAFF_W), g = await sw.go("/api/bc/service?c=winchester");
  assert.equal(g.status, 200); assert.equal((await g.json()).owner, false);
  assert.equal((await (await login(s, STAFF_B)).go("/api/bc/service?c=winchester")).status, 403);
  assert.equal((await s.browser().go("/api/bc/service?c=winchester")).status, 401);
});

const inDays = (n, now) => new Date(now + n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);

// находка проверки 19.10.2026: вкладка показывала напоминания, которые бот никогда не отправит (запись отменили или перенесли, по ней
// просьба администратору, клиент написал «стоп»), и считала их в «В очереди». Правило одно — remindLive — и у пульта, и у отправки.
test("сервисные: в очереди — только то, что бот отправит; отменённая, перенесённая запись, просьба по ней и «стоп» — нет", async () => {
  net.reset();
  const s = mk(ENV), now = Date.now(), day = inDays(2, now);
  const bk = (rec, o = {}) => ({ name: "Клиент", date: day, time: "12:00", services: "Мужская стрижка", record_id: rec, ...o });
  const chats = [
    ["77000001101", { bookings: [] }], // отменил в чате (selfCancel): записи в профиле больше нет
    ["77000001102", { bookings: [bk(9102, { time: "13:00" })] }], // перенёс на 13:00 — в очереди старое 12:00
    ["77000001103", { bookings: [bk(9103)], stop: true }], // написал «стоп»
    ["77000001104", { bookings: [bk(9104, { rq: "cancel" })] }], // просит отменить — запись у администратора
    ["77000001105", { bookings: [bk(9105)] }], // всё в силе
  ];
  const q = [];
  for (const [i, [id, profile]] of chats.entries()) {
    await s.kv.api.put(`h:ga:winchester:${id}`, JSON.stringify({ turns: [], profile }), { metadata: { nm: "", t: now } });
    for (const k of ["d1", "rv"]) q.push({ k, at: now + (i + 1) * 3600e3 + (k === "rv" ? 86400e3 : 0), ch: "ga", id, rec: String(9101 + i), date: day, time: "12:00" });
  }
  q.push({ k: "h2", at: now + 7200e3, ch: "ga", id: "77000001106", rec: "9106", date: day, time: "12:00" }); // чата нет вовсе
  await s.kv.api.put("rmq:winchester", JSON.stringify(q));
  const own = await login(s, OWNER), r = await own.go("/api/bc/service?c=winchester"), j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(j.queue.map(x => [x.phone, x.k]), [["+7 700 *** ** 05", "d1"], ["+7 700 *** ** 05", "rv"]]);
  assert.equal(j.total, 2, "«В очереди» — только живые");
  // бот по тем же правилам: ни одно из убранных не отправит
  for (const x of q.filter(x => x.id !== "77000001105")) assert.equal(await remindSend(s.env, "winchester", x, x.at), false, x.id);
});

// находка проверки 19.10.2026: «Отправлено за 3 дня» считало и неудачные отправки (отметка rms: ставится до отправки — от двойной)
test("«Отправлено за 3 дня» — только ушедшие: неудачная отправка не считается и повторно не уходит", async () => {
  net.reset();
  const s = mk(ENV), now = Date.now(), day = inDays(1, now);
  for (const [id, rec] of [["77000001201", 9201], ["77000001202", 9202]])
    await s.kv.api.put(`h:ga:winchester:${id}`, JSON.stringify({ turns: [], profile: { bookings: [{ name: "Клиент", date: day, time: "12:00", record_id: rec }] } }));
  const x1 = { k: "d1", at: now, ch: "ga", id: "77000001201", rec: "9201", date: day, time: "12:00" };
  const x2 = { ...x1, id: "77000001202", rec: "9202" };
  assert.equal(await remindSend(s.env, "winchester", x1, now), true);
  net.gaReply = rec => (rec.op === "sendMessage" ? new Response("instance not authorized", { status: 466 }) : null); // номер бота не на связи
  assert.equal(await remindSend(s.env, "winchester", x2, now), false);
  net.gaReply = null;
  assert.equal(await remindSend(s.env, "winchester", x2, now), false, "отметка попытки — второй раз не шлём (могло уйти)");
  assert.equal((await serviceInfo(s.env, CLIENTS.winchester, now)).sent3d, 1);
});

// находка проверки 19.10.2026: у компании без Altegio вкладка писала «включено», хотя напоминания строятся только по записям бота в Altegio
test("сервисные: без записи через Altegio — все виды выключены, altegio: false; у Winchester — включены, altegio: true", async () => {
  net.reset();
  const s = mk(ENV), own = await login(s, OWNER);
  const d = await (await own.go("/api/bc/service?c=dent")).json();
  assert.equal(d.altegio, false);
  assert.deepEqual(d.kinds.map(x => [x.k, x.on]), [["d1", false], ["h2", false], ["rv", false]]);
  const w = await (await own.go("/api/bc/service?c=winchester")).json();
  assert.equal(w.altegio, true);
  assert.deepEqual(w.kinds.map(x => x.on), [true, true, true]);
});
