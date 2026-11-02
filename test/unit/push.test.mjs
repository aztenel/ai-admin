// Push-уведомления пульта (ТЗ v2.0 §3, 31.10.2026): /api/push/* (права, своя компания, свой сайт, проверка подписки), ключи VAPID
// (свои в KV или из переменных), pushNotify — кому уходит (ответственный, виды, «не беспокоить», важное — всегда и в Telegram),
// что видно на экране блокировки (без текста и имени клиента, пока сотрудник сам не включил), повтор события — одно
// уведомление, отозванная подписка (410) и подписка на старый ключ — удаляются. Всё на заглушках служб push.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { pushNotify, prefsOf, quietNow, vapidKeys } from "../../src/services/notifications/push.js";
import { vapidGenerate } from "../../src/services/integrations/webpush/crypto.js";
import { local } from "../../src/lib/time.js";
import { uaKeys, decrypt } from "./webpush-ua.mjs";

const OWNER = "owner-key-123456", STAFF_W = "staff-key-winch-0001", STAFF_B = "staff-key-barber-0001";
const ENV = { KEY_WINCHESTER: STAFF_W, KEY_BARBER: STAFF_B };
let n = 0;
const device = (host = "https://fcm.googleapis.com/fcm/send/") => { const ua = uaKeys(); return { ua, sub: { endpoint: host + "dev" + (++n) + "-" + Date.now(), keys: { p256dh: ua.p256dh, auth: ua.auth } } }; };
async function login(s, key) {
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${encodeURIComponent(key)}&next=%2Fapp%2F` });
  assert.ok(b.cookie, "вошли");
  return b;
}
const post = async (b, path, body, headers) => { const r = await b.post(path, body, headers); return { status: r.status, j: await r.json() }; };
/** что пришло на устройство: последнее сообщение в его адрес */
const got = d => net.push.filter(r => r.url === d.sub.endpoint).map(r => JSON.parse(decrypt(d.ua, Buffer.from(r.body))));

test("API: только вошедшим, только своей компании и со своего сайта; подписка проверяется (служба push, ключи)", async () => {
  net.reset();
  const s = mk(ENV), guest = s.browser(), own = await login(s, OWNER), staff = await login(s, STAFF_W), d = device();
  assert.equal((await guest.go("/api/push/config?c=winchester")).status, 401);
  assert.equal((await post(guest, "/api/push/subscribe", { c: "winchester", sub: d.sub })).status, 401);
  assert.equal((await post(staff, "/api/push/subscribe", { c: "barber", sub: d.sub })).status, 403, "сотрудник чужой компании");
  assert.equal((await staff.go("/api/push/config?c=barber")).status, 403);
  assert.equal((await post(staff, "/api/push/subscribe", { c: "winchester", sub: d.sub }, { origin: "https://evil.example" })).status, 403, "чужой сайт");
  for (const bad of [{ ...d.sub, endpoint: "https://evil.example/push" }, { ...d.sub, endpoint: "http://fcm.googleapis.com/fcm/send/x" }, { ...d.sub, keys: { p256dh: "AAAA", auth: d.sub.keys.auth } },
    { ...d.sub, keys: { p256dh: d.sub.keys.p256dh, auth: "AAAA" } }, { endpoint: d.sub.endpoint }, "строка"]) {
    const r = await post(staff, "/api/push/subscribe", { c: "winchester", sub: bad });
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 80)); assert.match(r.j.error, /подписку/);
  }
  const big = await staff.go("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ c: "winchester", pad: "x".repeat(9000) }) });
  assert.equal(big.status, 413);
  const cfg = await (await staff.go("/api/push/config?c=winchester")).json();
  assert.equal(cfg.enabled, true); assert.match(cfg.key, /^B[\w-]{86}$/, "открытый ключ VAPID — 65 байт");
  assert.equal((await (await own.go("/api/push/config?c=winchester")).json()).key, cfg.key, "один ключ сервера");
  assert.equal(s.kv.json("push:vapid").publicKey, cfg.key, "ключи созданы сами и лежат в KV");
  const sub = await post(staff, "/api/push/subscribe", { c: "winchester", sub: d.sub, op: " Айгерим ", prefs: { text: true, kinds: { send_failed: false } } });
  assert.equal(sub.status, 200); assert.equal(sub.j.op, "Айгерим"); assert.equal(sub.j.prefs.text, true); assert.equal(sub.j.prefs.kinds.send_failed, false); assert.equal(sub.j.prefs.kinds.inbound, true);
  const keys = [...s.kv.mem.keys()].filter(k => k.startsWith("wp:winchester:"));
  assert.equal(keys.length, 1); assert.ok(!keys[0].includes("fcm"), "в имени ключа — отпечаток, а не адрес");
  const stored = s.kv.json(keys[0]);
  assert.equal(stored.role, "staff"); assert.equal(stored.vk, cfg.key); assert.equal(s.kv.ttl.get(keys[0]), 120 * 86400);
  assert.equal((await (await staff.go("/api/push/config?c=winchester")).json()).devices, 1);
  // повторная подписка того же устройства — та же запись, имя и настройки сохраняются
  const again = await post(staff, "/api/push/subscribe", { c: "winchester", sub: d.sub });
  assert.equal(again.j.op, "Айгерим"); assert.equal(again.j.prefs.text, true);
  assert.equal([...s.kv.mem.keys()].filter(k => k.startsWith("wp:winchester:")).length, 1);
  const pr = await post(staff, "/api/push/prefs", { c: "winchester", endpoint: d.sub.endpoint, prefs: { quiet: { from: 22, to: 8 } } });
  assert.deepEqual(pr.j.prefs.quiet, { from: 22, to: 8 }); assert.equal(pr.j.prefs.text, false, "настройки заменяются целиком");
  assert.equal((await post(staff, "/api/push/prefs", { c: "winchester", endpoint: "https://fcm.googleapis.com/fcm/send/nope", prefs: {} })).status, 404);
  assert.equal((await post(staff, "/api/push/unsubscribe", { c: "winchester", endpoint: d.sub.endpoint })).status, 200);
  assert.equal([...s.kv.mem.keys()].filter(k => k.startsWith("wp:winchester:")).length, 0);
  assert.equal((await post(staff, "/api/push/nope", { c: "winchester" })).status, 404);
});

test("проверка: уведомление только на это устройство, не чаще раза в 10 секунд; отозванная подписка удаляется", async () => {
  net.reset();
  const s = mk(ENV), staff = await login(s, STAFF_W), a = device("https://web.push.apple.com/"), b = device();
  await post(staff, "/api/push/subscribe", { c: "winchester", sub: a.sub, op: "Айгерим" });
  await post(staff, "/api/push/subscribe", { c: "winchester", sub: b.sub, op: "Данияр" });
  const r = await post(staff, "/api/push/test", { c: "winchester", endpoint: a.sub.endpoint });
  assert.equal(r.status, 200);
  assert.equal(net.push.length, 1); assert.equal(net.push[0].url, a.sub.endpoint);
  assert.deepEqual(got(a)[0], { t: "Winchester", b: "Проверка: уведомления на этом устройстве работают", u: "/app/?c=winchester#/settings/notifications", g: "test", k: "test" });
  assert.match(net.push[0].headers.authorization, /^vapid t=.+, k=B/);
  assert.equal((await post(staff, "/api/push/test", { c: "winchester", endpoint: a.sub.endpoint })).status, 429);
  net.pushReply = () => new Response(null, { status: 410 });
  assert.equal((await post(staff, "/api/push/test", { c: "winchester", endpoint: b.sub.endpoint })).status, 410);
  assert.equal([...s.kv.mem.keys()].filter(k => k.startsWith("wp:winchester:")).length, 1, "отозванная подписка удалена");
});

test("pushNotify: ответственному — на его устройства, без текста и имени на экране блокировки; текст — только если включено", async () => {
  net.reset();
  const s = mk(ENV), staff = await login(s, STAFF_W), own = await login(s, OWNER);
  const ai = device("https://web.push.apple.com/"), da = device(), ow = device("https://updates.push.services.mozilla.com/wpush/v2/");
  await post(staff, "/api/push/subscribe", { c: "winchester", sub: ai.sub, op: "Айгерим" });
  await post(staff, "/api/push/subscribe", { c: "winchester", sub: da.sub, op: "Данияр", prefs: { text: true } });
  await post(own, "/api/push/subscribe", { c: "winchester", sub: ow.sub });
  await post(own, "/api/push/subscribe", { c: "barber", sub: device().sub }); // другая компания — не получает
  const ev = { kind: "inbound", key: "GA-IN-1", chat: { ch: "ga", id: "77001112001" }, title: "Ерлан", text: "Здравствуйте! Есть время сегодня?", line: "второй номер", badge: 3 };
  const r1 = await pushNotify(s.env, "winchester", { ...ev, assignee: "айгерим" });
  assert.deepEqual(r1, { sent: 1, skipped: 2 });
  const m = got(ai)[0];
  assert.deepEqual(m, { t: "Winchester", b: "Новое сообщение · второй номер", u: "/app/?c=winchester#/inbox/ga%3A77001112001", g: m.g, k: "inbound", c: "ga:77001112001", n: 3 });
  assert.ok(!/7700111/.test(m.g), "в метке нет номера клиента");
  const rec = net.push.find(x => x.url === ai.sub.endpoint);
  assert.ok(!/7700111/.test(rec.headers.topic || "") && rec.headers.topic === m.g, "в Topic (видно службе push) — тоже без номера");
  assert.equal(rec.headers.urgency, "high"); assert.equal(rec.headers.ttl, String(6 * 3600));
  // без ответственного — всем устройствам компании; у Данияра включён текст
  const r2 = await pushNotify(s.env, "winchester", { ...ev, key: "GA-IN-2" });
  assert.deepEqual(r2, { sent: 3, skipped: 0 });
  assert.deepEqual(got(da).at(-1), { t: "Ерлан", b: "второй номер: Здравствуйте! Есть время сегодня?", u: m.u, g: m.g, k: "inbound", c: "ga:77001112001", n: 3 });
  assert.equal(got(ow).at(-1).b, "Новое сообщение · второй номер", "у владельца текст не включён");
  // ответственный без устройств — всем
  assert.equal((await pushNotify(s.env, "winchester", { ...ev, key: "GA-IN-3", assignee: "Нурлан" })).sent, 3);
  // повтор события (вебхук пришёл дважды) — одно уведомление; и в другом экземпляре Worker (отметка в KV)
  const before = net.push.length;
  assert.deepEqual(await pushNotify(s.env, "winchester", { ...ev, key: "GA-IN-3" }), { sent: 0, skipped: 0 });
  assert.equal(net.push.length, before);
  assert.ok([...s.kv.mem.keys()].some(k => k.startsWith("wpd:winchester:inbound:")), "отметка «уже отправляли» в KV");
  assert.equal(s.kv.ttl.get([...s.kv.mem.keys()].find(k => k.startsWith("wpd:winchester:"))), 600);
  // неизвестный вид и чужая компания — ничего, без исключения
  assert.deepEqual(await pushNotify(s.env, "winchester", { kind: "spam", key: "x" }), { sent: 0, skipped: 0 });
  assert.deepEqual(await pushNotify(s.env, "nope", { ...ev, key: "x" }), { sent: 0, skipped: 0 });
  // служба push не отвечает — исключения нет, не отправлено
  net.pushReply = () => { throw new Error("связь оборвалась"); };
  assert.deepEqual(await pushNotify(s.env, "winchester", { ...ev, key: "GA-IN-4" }), { sent: 0, skipped: 3 });
});

test("pushNotify: виды и «не беспокоить» по часам Астаны; «номер не работает» — всегда и в Telegram; 410 и старый ключ — подписка удаляется", async () => {
  net.reset();
  const s = mk(ENV), staff = await login(s, STAFF_W), h = local(Date.now()).getUTCHours();
  const q = device(), off = device(), ok = device();
  await post(staff, "/api/push/subscribe", { c: "winchester", sub: q.sub, op: "Тихий", prefs: { quiet: { from: h, to: (h + 1) % 24 } } });
  await post(staff, "/api/push/subscribe", { c: "winchester", sub: off.sub, op: "Без ответов на рассылки", prefs: { kinds: { campaign_reply: false } } });
  await post(staff, "/api/push/subscribe", { c: "winchester", sub: ok.sub, op: "Все" });
  const r = await pushNotify(s.env, "winchester", { kind: "campaign_reply", key: "R1", chat: { ch: "ga", id: "77001112002" } });
  assert.deepEqual(r, { sent: 1, skipped: 2 });
  assert.equal(got(ok)[0].b, "Ответ на рассылку");
  const tg0 = net.tg.length;
  const c = await pushNotify(s.env, "winchester", { kind: "channel_down", key: "D1", critical: true, line: "второй номер" });
  assert.equal(c.sent, 3, "важное — и в «не беспокоить»");
  assert.equal(got(q).at(-1).b, "Номер WhatsApp не работает · второй номер");
  assert.equal(net.tg.length, tg0 + 1); assert.match(net.tg.at(-1).text, /Winchester: Номер WhatsApp не работает \(второй номер\)/);
  assert.equal(net.push.find(x => x.url === q.sub.endpoint).headers.ttl, "86400");
  // отозванная подписка (410) удаляется; подписка на прежний ключ сервера — тоже (пульт подпишет заново)
  net.pushReply = rec => rec.url === off.sub.endpoint ? new Response(null, { status: 410 }) : null;
  await pushNotify(s.env, "winchester", { kind: "inbound", key: "I1" });
  const left = [...s.kv.mem.keys()].filter(k => k.startsWith("wp:winchester:"));
  assert.equal(left.length, 2);
  const k0 = left.find(k => s.kv.json(k).op === "Все");
  s.kv.mem.set(k0, JSON.stringify({ ...s.kv.json(k0), vk: "Bstale" }));
  const pushes = net.push.length;
  await pushNotify(s.env, "winchester", { kind: "inbound", key: "I2" });
  assert.equal(net.push.filter(x => x.url === ok.sub.endpoint).length, net.push.slice(0, pushes).filter(x => x.url === ok.sub.endpoint).length, "на старый ключ не отправляли");
  assert.equal([...s.kv.mem.keys()].filter(k => k.startsWith("wp:winchester:")).length, 1);
});

test("настройки устройства и «не беспокоить» через полночь", () => {
  assert.deepEqual(prefsOf(null), { kinds: { inbound: true, campaign_reply: true, booking_change: true, unassigned: true, send_failed: true, channel_down: true }, quiet: null, text: false });
  assert.equal(prefsOf({ text: "yes" }).text, false, "только настоящее true");
  assert.equal(prefsOf({ quiet: { from: 9, to: 9 } }).quiet, null);
  assert.equal(prefsOf({ quiet: { from: 25, to: 8 } }).quiet, null);
  const at = (hh) => Date.UTC(2026, 9, 31, hh - 5, 30); // часы Астаны
  const p = prefsOf({ quiet: { from: 22, to: 8 } });
  assert.equal(quietNow(p, at(23)), true); assert.equal(quietNow(p, at(3)), true); assert.equal(quietNow(p, at(8)), false); assert.equal(quietNow(p, at(12)), false);
  assert.equal(quietNow(prefsOf({ quiet: { from: 13, to: 15 } }), at(14)), true);
});

test("ключи VAPID из переменных важнее KV; неверные — push выключен, а не подменён", async () => {
  net.reset();
  const kp = await vapidGenerate();
  const s = mk({ ...ENV, VAPID_PUBLIC_KEY: kp.publicKey, VAPID_PRIVATE_KEY: kp.privateKey, VAPID_SUBJECT: "mailto:owner@example.test" });
  const k = await vapidKeys(s.env);
  assert.equal(k.publicKey, kp.publicKey); assert.equal(k.subject, "mailto:owner@example.test"); assert.equal(s.kv.mem.has("push:vapid"), false);
  const bad = mk({ ...ENV, VAPID_PUBLIC_KEY: kp.publicKey, VAPID_PRIVATE_KEY: (await vapidGenerate()).privateKey });
  assert.equal(await vapidKeys(bad.env), null);
  const staff = await login(bad, STAFF_W);
  const cfg = await (await staff.go("/api/push/config?c=winchester")).json();
  assert.equal(cfg.enabled, false); assert.match(cfg.why, /VAPID/);
});

test("уволенному сотруднику (ключ сменили) и после истёкшего входа уведомления не приходят — подписка удаляется (проверка безопасности 31.10.2026)", async () => {
  net.reset();
  const env = { ...ENV };
  const s = mk(env), staff = await login(s, STAFF_W), own = await login(s, OWNER), ds = device(), dow = device();
  assert.equal((await post(staff, "/api/push/subscribe", { c: "winchester", sub: ds.sub, op: "Ержан" })).status, 200);
  assert.equal((await post(own, "/api/push/subscribe", { c: "winchester", sub: dow.sub, op: "Владелец" })).status, 200);
  let r = await pushNotify(s.env, "winchester", { kind: "inbound", key: "k1", chat: { ch: "ga", id: "77000000001" } });
  assert.equal(r.sent, 2);
  const stored = [...s.kv.mem.entries()].filter(([k]) => k.startsWith("wp:winchester:")).map(([, v]) => JSON.parse(v));
  assert.ok(stored.every(x => x.until > Date.now()), "подписка помнит срок входа");
  // владелец сменил ключ сотрудника — прежний сотрудник больше не получает
  s.env.KEY_WINCHESTER = "staff-key-winch-NEW-0002";
  net.push.length = 0;
  r = await pushNotify(s.env, "winchester", { kind: "inbound", key: "k2", chat: { ch: "ga", id: "77000000001" } });
  assert.equal(r.sent, 1); assert.ok(!net.push.some(x => x.url === ds.sub.endpoint), "старому сотруднику — ничего");
  assert.equal([...s.kv.mem.keys()].filter(k => k.startsWith("wp:winchester:")).length, 1, "его подписка удалена");
  // вход владельца истёк — подписка тоже перестаёт действовать
  for (const [k, v] of s.kv.mem.entries()) if (k.startsWith("wp:winchester:")) { const j = JSON.parse(v); j.until = Date.now() - 1000; s.kv.mem.set(k, JSON.stringify(j)); }
  net.push.length = 0;
  r = await pushNotify(s.env, "winchester", { kind: "inbound", key: "k3", chat: { ch: "ga", id: "77000000001" } });
  assert.equal(r.sent, 0); assert.equal(net.push.length, 0);
});
