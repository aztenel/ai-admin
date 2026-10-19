// Мониторинг номера (план проверки модулей, модуль 10, 16.10.2026). Meta сообщает о падении качества номера вебхуком, но через Wazzapo
// такие события не приходят. Раз в день (10:00 по Астане) бот сам спрашивает качество и предел номера и пишет администратору,
// если качество жёлтое или красное, номер недоступен или предел уменьшился. Всё на заглушках.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { qualityRun } from "../../src/services/broadcast/quality.js";

const WZ = { WA_VIA_WINCHESTER: "wazzapo", WA_TOKEN_WINCHESTER: "wz_live_test", APP_SECRET_WINCHESTER: "hook-secret", PHONE_NUMBER_ID_WINCHESTER: "pn1", TG_CHAT_WINCHESTER: "-1001" };
const AT = Date.UTC(2026, 9, 3, 5, 3); // 10:03 по Астане
const J = o => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
const health = (quality, tier) => { net.wzReply = rec => rec.method === "GET" && rec.path === "/phone-numbers/pn1" ? J({ data: { display_phone_number: "+7 700 505 05 03", quality_rating: quality, messaging_limit_tier: tier } }) : null; };
const tg = () => net.tg.filter(t => /Winchester/.test(t.text || "")).map(t => t.text);

test("качество номера жёлтое — администратору сигнал, раз в день", async () => {
  net.reset(); health("YELLOW", "TIER_250");
  const s = mk(WZ);
  await qualityRun(s.env, AT);
  assert.equal(tg().length, 1, JSON.stringify(net.tg));
  assert.ok(/качеств/i.test(tg()[0]) && /жёлт/i.test(tg()[0]), tg()[0]);
  await qualityRun(s.env, AT + 60e3);
  assert.equal(tg().length, 1, "второй раз за день — нет");
});

test("качество зелёное и предел не менялся — тишина; предел уменьшился — сигнал", async () => {
  net.reset(); health("GREEN", "TIER_1K");
  const s = mk(WZ);
  await qualityRun(s.env, AT);
  assert.equal(tg().length, 0, JSON.stringify(net.tg));
  health("GREEN", "TIER_250");
  await qualityRun(s.env, AT + 86400e3);
  assert.equal(tg().length, 1);
  assert.ok(/250/.test(tg()[0]) && /1000/.test(tg()[0]), tg()[0]);
});

test("Wazzapo не отдаёт сведения о номере (ключ отозван) — сигнал", async () => {
  net.reset(); net.wzReply = rec => rec.method === "GET" ? new Response("{}", { status: 401 }) : null;
  const s = mk(WZ);
  await qualityRun(s.env, AT);
  assert.equal(tg().length, 1, JSON.stringify(net.tg));
});

test("не в 10 утра и у бизнеса без своего номера — ничего не проверяется", async () => {
  net.reset(); health("RED", "TIER_250");
  const s = mk(WZ);
  await qualityRun(s.env, AT + 3600e3);
  assert.equal(net.wz.length, 0);
  const s2 = mk({ TG_CHAT_WINCHESTER: "-1001" });
  await qualityRun(s2.env, AT);
  assert.equal(net.wz.length + net.graph.length, 0);
});

test("без TG_TOKEN проверка всё равно идёт и записывается (по ней автосценарий решает про маркетинг); качество не пришло при включённом автосценарии — строка в сигнале", async () => {
  net.reset(); health("GREEN", "TIER_250");
  const s = mk({ ...WZ, TG_TOKEN: "" });
  await qualityRun(s.env, AT);
  assert.equal(s.kv.json("qual:winchester").quality, "GREEN"); assert.equal(net.tg.length, 0);
  net.reset(); health("", "TIER_250");
  const s2 = mk(WZ);
  await s2.kv.api.put("bcauto:winchester", JSON.stringify({ on: true, tpl: "pora_na_strizhku" }));
  await qualityRun(s2.env, AT);
  assert.equal(tg().length, 1, JSON.stringify(net.tg)); assert.ok(/не сообщили качество/.test(tg()[0]), tg()[0]);
});
