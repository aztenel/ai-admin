// Аналитика исходящих (ТЗ v2.0 §8, 31.10.2026): отчёты Green-API о доставке → числа по напоминаниям, отзывам, рассылкам и ответам
// сотрудников; повтор отчёта (Green-API повторяет вебхук каждую минуту) второй раз не считается; ответ клиента на напоминание — один раз
// на сообщение; ошибка после доставки не считается; без базы D1 — честное «нет данных». Номера вымышленные.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, gaPass } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";

const skip = sqliteOk ? false : "node:sqlite есть только в Node 22+";
const INST = { id: "7105000077", token: "ga-tok-w" };
const ENV = { GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
const login = async s => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" }); return b; };
const hook = (s, body) => s.call(`/ga/winchester?t=${gaPass("winchester", INST)}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ instanceData: { idInstance: +INST.id, wid: "77000000077@c.us" }, timestamp: Math.floor(Date.now() / 1000), ...body }) });
const status = (s, to, id, st) => hook(s, { typeWebhook: "outgoingMessageStatus", chatId: to + "@c.us", idMessage: id, status: st, sendByApi: true });
const seed = async (s, to, turns) => { await s.kv.api.put(`h:ga:winchester:${to}`, JSON.stringify({ n: turns.length, turns, profile: {} })); await s.kv.api.put(`wa:niche:ga:${to}`, "winchester"); };
const stats = async b => (await (await b.go("/api/bc/stats?c=winchester&days=7")).json());

test("отчёты о доставке и ответы → числа по видам сообщений; повтор вебхука и поздняя ошибка не считаются", { skip }, async () => {
  net.reset();
  const d = d1With("production"), s = mk({ ...ENV, DB: d.db }), b = await login(s), T = Date.now();
  await seed(s, "77000000901", [{ role: "model", text: "Напоминаем о записи завтра в 15:00", t: T - 3600e3, rm: "d1", mid: "R-1", st: "sent" }]);
  await seed(s, "77000000902", [{ role: "model", text: "Акция", t: T - 3600e3, bc: "b1", by: "bc", mid: "B-1", st: "sent" }]);
  await seed(s, "77000000903", [{ role: "model", text: "Оставьте отзыв", t: T - 3600e3, rm: "rv", mid: "V-1", st: "sent" }]);
  for (const st of ["delivered", "delivered", "read", "sent"]) await status(s, "77000000901", "R-1", st); // порядок любой, повторы
  await status(s, "77000000902", "B-1", "sent"); await status(s, "77000000902", "B-1", "failed"); await status(s, "77000000902", "B-1", "failed");
  await status(s, "77000000903", "V-1", "delivered"); await status(s, "77000000903", "V-1", "failed"); // уже доставлено — ошибка не считается
  await s.gaText("winchester", INST, "77000000901", "А можно на 16:00?");
  await s.gaText("winchester", INST, "77000000901", "Или на 17:00");
  await s.gaText("winchester", INST, "77000000903", "Спасибо 👍"); // «спасибо» — не в очередь, но это ответ: считается
  await s.settle();
  const r = await stats(b);
  assert.equal(r.available, true, JSON.stringify(r));
  assert.deepEqual(r.by.service, { sent: 1, delivered: 1, read: 1, failed: 0, replied: 1 });
  assert.deepEqual(r.by.campaign, { sent: 1, delivered: 0, read: 0, failed: 1, replied: 0 });
  assert.deepEqual(r.by.review, { sent: 1, delivered: 1, read: 0, failed: 0, replied: 1 });
  const ev = d.raw.prepare("select event_key, details from events where kind like 'msg_%'").all();
  assert.ok(!ev.some(e => /7700000090/.test(e.event_key + e.details)), "номеров в журнале событий нет");
  // ответ сотрудника из пульта — свой источник; его галочки тоже считаются
  const sent = await b.go("/api/inbox/send", { method: "POST", headers: { "content-type": "application/json", origin: "https://bot.test" }, body: JSON.stringify({ c: "winchester", ch: "ga", id: "77000000901", text: "Да, 16:00 свободно", op: "Айгерим" }) });
  assert.equal(sent.status, 200, await sent.text());
  const h = s.kv.json("h:ga:winchester:77000000901"), mine = h.turns.at(-1);
  assert.equal(mine.by, "admin"); assert.ok(mine.mid);
  await status(s, "77000000901", mine.mid, "read");
  assert.deepEqual((await stats(b)).by.admin, { sent: 1, delivered: 0, read: 1, failed: 0, replied: 0 });
});

test("без базы D1 (боевой сайт сейчас) — числа не копятся, экран говорит об этом; без входа — 401", async () => {
  net.reset();
  const s = mk(ENV), b = await login(s);
  const r = await stats(b);
  assert.equal(r.available, false); assert.match(r.why, /D1/); assert.equal(r.by.service.sent, 0);
  assert.equal((await s.browser().go("/api/bc/stats?c=winchester")).status, 401);
});
