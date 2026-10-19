// Вкладка «Сервисные · номер бота» нового пульта (19.10.2026): GET /api/bc/service — какие сообщения бот шлёт сам (напоминания и
// просьба об отзыве по записям, сделанным в чате с ботом), очередь ближайших с номерами маской, сколько ушло за 3 дня.
// Владелец и сотрудник компании видят, чужой сотрудник — 403. Всё на заглушках, номера вымышленные.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mk, net } from "../harness.mjs";

const OWNER = "owner-key-123456", STAFF_W = "staff-key-winch-0001", STAFF_B = "staff-key-barber-0001";
const ENV = { KEY_WINCHESTER: STAFF_W, KEY_BARBER: STAFF_B, GA_ID_WINCHESTER: "7105000001", GA_TOKEN_WINCHESTER: "ga-tok-w" };
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
  await s.kv.api.put("h:ga:winchester:77000001234", JSON.stringify({ turns: [], profile: {} }), { metadata: { nm: "Арман", t: now } });
  await s.kv.api.put("rms:winchester:900:d1", "1"); await s.kv.api.put("rms:winchester:900:rv", "1");
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
