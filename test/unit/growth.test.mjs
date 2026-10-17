// Отчёт роста за 30 дней (план проверки модулей, модуль 10, 16.10.2026): итоги за последние 30 дней из заявок и чатов, прошлые 30 дней —
// из дневных итогов, которые бот сохраняет каждую ночь (заявки хранятся только 30 дней). Всё на заглушках.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { dayStatsRun, growthReport } from "../../src/services/digest.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";
import { isoDay } from "../../src/lib/time.js";

const ENV = { TG_CHAT_WINCHESTER: "-1001" };
const lead = (o, ago) => ({ id: (Date.now() - ago).toString(36) + "abcd", ts: Date.now() - ago, name: "Тимур", phone: "+77000000001", ...o });

test("дневные итоги сохраняются ночью, отчёт сравнивает 30 дней с прошлыми 30", async () => {
  net.reset();
  const s = mk(ENV), now = Date.now();
  s.kv.mem.set("leads:winchester", JSON.stringify([lead({ altegio: { record_id: 1 } }, 2 * 86400e3), lead({ altegio: { record_id: 2 } }, 3 * 86400e3), lead({}, 4 * 86400e3), lead({ kind: "callback" }, 5 * 86400e3)]));
  for (let i = 31; i <= 60; i++) s.kv.mem.set(`ds:winchester:${isoDay(now - i * 86400e3)}`, JSON.stringify({ wa: 1, web: 0, alt: i % 30 === 0 ? 1 : 0, req: 0, cb: 0, cx: 0 }));
  const r = await growthReport(s.env, CLIENTS.winchester, now);
  assert.deepEqual(r.cur, { chats: 0, alt: 2, req: 1, cb: 1, cx: 0 });
  assert.deepEqual(r.prev, { chats: 30, alt: 1, req: 0, cb: 0, cx: 0 });
  // ночной снимок: 00:05 по Астане 4 октября — итоги 3 октября
  const at = Date.UTC(2026, 9, 3, 19, 5);
  s.kv.mem.set("leads:winchester", JSON.stringify([lead({ altegio: { record_id: 3 } }, now - Date.UTC(2026, 9, 3, 6, 0))]));
  assert.ok(await dayStatsRun(s.env, at) >= 1);
  assert.deepEqual(s.kv.json("ds:winchester:2026-10-03"), { wa: 0, web: 0, alt: 1, req: 0, cb: 0, cx: 0 });
  assert.equal(s.kv.mem.has("ds:barber:2026-10-03"), false, "демо-боту итоги не копятся");
});

test("пульт: итоги за 30 дней доступны сотруднику своего бизнеса; прошлого периода нет — prev пустой", async () => {
  net.reset();
  const s = mk(ENV), b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Finbox" });
  const r = await (await b.go("/api/inbox/report?c=winchester")).json();
  assert.equal(r.days, 30); assert.equal(r.prev, null); assert.ok(r.cur && typeof r.cur.alt === "number", JSON.stringify(r));
  assert.equal((await s.browser().go("/api/inbox/report?c=winchester")).status === 200, false, "без входа — нет");
});
