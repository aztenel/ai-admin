// Напоминания и отзывы (план проверки модулей, модуль 8, 16.10.2026). WhatsApp через Meta и Wazzapo разрешает обычный текст только
// в 24-часовом окне после сообщения клиента. Напоминание «накануне в 18:00» и просьба об отзыве через 3 часа после визита почти всегда
// за окном — бот их молча не отправлял. Вне окна — одобренный шаблон Meta (TPL_REMIND_<ID>, TPL_REVIEW_<ID>). Всё на заглушках.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";

const WZ = { WA_VIA_WINCHESTER: "wazzapo", WA_TOKEN_WINCHESTER: "wz_live_test", APP_SECRET_WINCHESTER: "hook-secret", PHONE_NUMBER_ID_WINCHESTER: "103799815708451" };
const from = "77051116601";
/** чат с записью (её сделал бот: есть номер в Altegio), клиент писал 3 дня назад; в очереди — напоминание или отзыв, время пришло */
function setup(s, k, liAgo = 3 * 86400e3) {
  const now = Date.now();
  s.kv.mem.set(`h:wa:winchester:${from}`, JSON.stringify({ n: 2, turns: [], profile: { li: now - liAgo, bookings: [{ record_id: 777001, name: "Тимур", date: "2026-10-04", time: "10:00", services: "Мужская стрижка", staffName: "Айдос" }] } }));
  s.kv.mem.set("rmq:winchester", JSON.stringify([{ k, at: now - 1000, ch: "wa", id: from, rec: "777001", date: "2026-10-04", time: "10:00" }]));
  s.kv.mem.set("rmidx", JSON.stringify(["winchester"]));
}
const sends = () => net.wz.filter(r => r.path === "/messages/send").map(r => r.body);

test("напоминание вне 24-часового окна уходит шаблоном Meta с подстановками", async () => {
  net.reset();
  const s = mk({ ...WZ, TPL_REMIND_WINCHESTER: "booking_reminder" });
  setup(s, "d1");
  await s.cron();
  const out = sends();
  assert.equal(out.length, 1, JSON.stringify(net.wz));
  assert.equal(out[0].type, "template");
  assert.equal(out[0].template.name, "booking_reminder");
  const p = out[0].template.components[0].parameters.map(x => x.text);
  assert.deepEqual(p, ["Winchester", "завтра", "10:00", "Мужская стрижка · Айдос"]);
  const h = s.kv.json(`h:wa:winchester:${from}`);
  assert.ok(h.turns.some(t => t.rm === "d1"), "напоминание видно в переписке");
});

test("просьба об отзыве вне окна уходит шаблоном со ссылкой 2ГИС", async () => {
  net.reset();
  const s = mk({ ...WZ, TPL_REVIEW_WINCHESTER: "review_request" });
  setup(s, "rv");
  await s.cron();
  const out = sends();
  assert.equal(out.length, 1, JSON.stringify(net.wz));
  assert.equal(out[0].template.name, "review_request");
  assert.deepEqual(out[0].template.components[0].parameters.map(x => x.text), ["Winchester", "https://2gis.kz/astana/firm/70000001038239111/tab/reviews"]);
});

test("вне окна и без шаблона — не отправляется (как раньше); в окне — обычным текстом, шаблон не нужен", async () => {
  net.reset();
  let s = mk(WZ);
  setup(s, "d1");
  await s.cron();
  assert.equal(sends().length, 0);
  net.reset();
  s = mk({ ...WZ, TPL_REMIND_WINCHESTER: "booking_reminder" });
  setup(s, "d1", 3600e3);
  await s.cron();
  const out = sends();
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "text", JSON.stringify(out[0]));
});
