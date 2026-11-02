// Выпуск Winchester в production (02.11.2026), условие владельца: «никаких сообщений клиентам, даже при сбое D1». Бот компании на
// номере выключен (Winchester: waOff, gaOff), но при сбое обработки входящего (например, D1 не ответила) handleWAText всё равно слал
// клиенту «Спасибо за сообщение! Администратор ответит…» — правило «клиент не остаётся без ответа» для включённого бота. Теперь при
// выключенном боте клиенту не пишем ничего, сигнал администратору остаётся; у включённого бота — как раньше. Номера вымышленные.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { net, mk, mkKV } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";

const skip = sqliteOk ? false : "нужна D1 на node:sqlite (Node 22+)";
const META = { WA_TOKEN_WINCHESTER: "meta-tok-q", APP_SECRET_WINCHESTER: "sec-q", PHONE_NUMBER_ID_WINCHESTER: "555000777" };
const WZ = { WA_VIA_WINCHESTER: "wazzapo", WA_TOKEN_WINCHESTER: "wz_live_q", APP_SECRET_WINCHESTER: "hook-q", PHONE_NUMBER_ID_WINCHESTER: "103799815700001" };
const INST = { id: "7107000088", token: "ga-tok-quiet" };
const GA = { GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
const D1MODE = { CHAT_STORE_WINCHESTER: "d1" };
const A = "77000008801";

/** D1 не отвечает на запросы переписок (как сбой связи с базой) */
const down = d => { d.ctl.fail = sql => /chat_(threads|messages)/.test(sql) && !/sqlite_master/.test(sql); };
function place(extra) { net.reset(); const kv = mkKV(), d = d1With("production"); return { d, s: mk({ ...extra, KV: kv.api, DB: d.db }) }; }
const metaIn = (s, id, text) => s.waPost("/wa/winchester", { id, from: A, type: "text", text: { body: text } }, { secret: "sec-q" });
const metaSent = () => net.graph.filter(g => g.method === "POST" && g.body && g.body.to === A).length;
let n = 0;
const wzIn = (s, id, text) => {
  const body = JSON.stringify({ event: "message.incoming", timestamp: "2026-10-03T07:00:00.000Z", data: { channel: "whatsapp", phone_number_id: "103799815700001",
    contact: { phone: A, name: "Айгерим" }, message: { id, from: A, type: "text", text, timestamp: "1791010000" } } });
  return s.call("/wz/winchester", { method: "POST", body, headers: { "content-type": "application/json", "x-wazzapo-delivery-id": "dlv-q-" + ++n,
    "x-wazzapo-signature": "sha256=" + createHmac("sha256", "hook-q").update(body).digest("hex") } });
};
const wzSent = () => net.wz.filter(r => r.path === "/messages/send" && r.body && r.body.to === A).length;
const gaSent = () => net.ga.filter(x => x.op === "sendMessage" || x.op === "sendFileByUpload").length;

test("бот выключен, D1 не ответила при входящем (Meta): клиенту ничего не уходит, администратору — сигнал", { skip }, async () => {
  const { d, s } = place({ ...META, ...D1MODE });
  assert.equal((await metaIn(s, "wamid.Q-1", "Здравствуйте")).status, 200);
  const tg = net.tg.length;
  down(d);
  assert.equal((await metaIn(s, "wamid.Q-2", "Можно на завтра?")).status, 200);
  assert.equal(metaSent(), 0, "клиенту не ушло ни «спасибо за сообщение», ни другое");
  assert.ok(net.tg.length > tg, "администратору — сигнал в Telegram");
});

test("бот выключен, D1 не ответила при входящем (Wazzapo): клиенту ничего не уходит", { skip }, async () => {
  const { d, s } = place({ ...WZ, ...D1MODE });
  assert.equal((await wzIn(s, "wamid.QZ-1", "Здравствуйте")).status, 200);
  down(d);
  assert.equal((await wzIn(s, "wamid.QZ-2", "Хочу записаться")).status, 200);
  assert.equal(wzSent(), 0);
});

test("бот выключен, D1 не ответила при входящем (второй номер, Green-API): клиенту ничего не уходит", { skip }, async () => {
  const { d, s } = place({ ...GA, ...D1MODE });
  await s.gaText("winchester", INST, A, "Здравствуйте", { idMessage: "GQ-1" });
  down(d);
  await s.gaText("winchester", INST, A, "Вы тут?", { idMessage: "GQ-2" });
  assert.equal(gaSent(), 0);
});

test("бот включён (BOT_WA_WINCHESTER=1) — при сбое клиенту, как раньше, «спасибо за сообщение»: правило касается только выключенного бота", { skip }, async () => {
  const { d, s } = place({ ...META, ...D1MODE, BOT_WA_WINCHESTER: "1" });
  net.ai = ["Здравствуйте!"];
  assert.equal((await metaIn(s, "wamid.Q-10", "Здравствуйте")).status, 200);
  const was = metaSent();
  down(d);
  net.ai = ["Записала."];
  assert.equal((await metaIn(s, "wamid.Q-11", "Можно на завтра?")).status, 200);
  assert.ok(metaSent() > was, "клиент не остался без ответа");
});
