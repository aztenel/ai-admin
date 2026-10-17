// Данные и безопасность (план проверки модулей, модуль 11, 17.10.2026): удаление данных клиента по его просьбе.
// /privacy обещает «удалим в течение 10 дней», а кнопки у владельца не было — только ручная чистка ключей в Cloudflare. Всё на заглушках.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, D1 } from "../harness.mjs";

const ENV = { ALTEGIO_PARTNER: "partner-key", WA_TOKEN_WINCHESTER: "tok-w", APP_SECRET_WINCHESTER: "sec-w", BOT_WA_WINCHESTER: "1" }; // бот в WhatsApp Winchester по умолчанию выключен (wa-off.test.mjs)
const AI = `Записала.\n[ЗАЯВКА] Имя: Тимур; Телефон: указан; Услуга: Мужская стрижка; Мастер: любой; Дата: ${D1}; Время: 10:00`;
const login = async (s, key) => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=" + encodeURIComponent(key) + "&next=%2Finbox" }); return b; };
const reset = () => { net.reset(); net.altGone = []; net.altBusy = false; net.altCheckBusy = false; net.altGetFail = 0; net.altGetPlain = false; net.altJournalFail = 0; net.altData = null; };
const keysWith = (s, d) => [...s.kv.mem.entries()].filter(([k, v]) => k.includes(d) || String(v && (v.value ?? v)).includes(d)).map(([k]) => k);

test("владелец удаляет данные клиента: переписка, заявки, согласие — удалены, другие клиенты не тронуты", async () => {
  reset(); net.ai = [AI, AI];
  const s = mk(ENV), from = "77000000097", other = "77000000098";
  await s.waText("/wa/winchester", from, "Тимур, мужская стрижка завтра в 10:00", { secret: "sec-w" });
  await s.waText("/wa/winchester", other, "Тимур, мужская стрижка завтра в 10:00", { secret: "sec-w" });
  assert.ok(keysWith(s, from.slice(1)).length >= 3, "до удаления данные есть: " + keysWith(s, from.slice(1)));
  const own = await login(s, "owner-key-123456");
  const r = await own.post("/api/inbox/act", { c: "winchester", ch: "wa", id: from, act: "erase" });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.ok(d.erased && d.leads >= 1, JSON.stringify(d));
  assert.deepEqual(keysWith(s, from.slice(1)), [], "номера клиента больше нет в хранилище");
  assert.ok(keysWith(s, other.slice(1)).length >= 3, "данные другого клиента на месте");
  assert.equal((await own.go(`/api/inbox/chat?c=winchester&ch=wa&id=${from}`)).status, 404);
});

test("клиент писал «стоп» — после удаления отметка остаётся, бот ему не пишет", async () => {
  reset(); net.ai = ["Здравствуйте!"];
  const s = mk(ENV), from = "77000000099";
  await s.waText("/wa/winchester", from, "Здравствуйте", { secret: "sec-w" });
  await s.waText("/wa/winchester", from, "стоп", { secret: "sec-w" });
  const own = await login(s, "owner-key-123456");
  assert.equal((await own.post("/api/inbox/act", { c: "winchester", ch: "wa", id: from, act: "erase" })).status, 200);
  const h = s.hist("wa", "winchester", from);
  assert.deepEqual(h.turns, []);
  assert.deepEqual(Object.keys(h.profile).sort(), ["pausedUntil", "stop"], JSON.stringify(h.profile));
  const n = s.sentTo(from).length; net.ai = ["Здравствуйте! Чем помочь?"];
  await s.waText("/wa/winchester", from, "Привет", { secret: "sec-w" });
  assert.equal(s.sentTo(from).length, n, "бот молчит: " + JSON.stringify(s.sentTo(from).slice(n)));
});

test("сотрудник удалить данные не может", async () => {
  reset(); net.ai = ["Здравствуйте!"];
  const s = mk(ENV), from = "77000000090";
  await s.waText("/wa/winchester", from, "Здравствуйте", { secret: "sec-w" });
  const own = await login(s, "owner-key-123456");
  const key = (await (await own.post("/api/studio/key", { id: "winchester" })).json()).key;
  const st = await login(s, key);
  assert.equal((await st.post("/api/inbox/act", { c: "winchester", ch: "wa", id: from, act: "erase" })).status, 403);
  assert.ok(s.hist("wa", "winchester", from).turns.length, "переписка на месте");
});

test("веб-чат: посетитель указал чужой номер — удаление чата не трогает заявки и согласие этого номера (автопроверка безопасности, 17.10.2026)", async () => {
  reset(); net.ai = [AI];
  const s = mk(ENV), victim = "77000000091";
  await s.waText("/wa/winchester", victim, "Тимур, мужская стрижка завтра в 10:00", { secret: "sec-w" });
  const before = keysWith(s, victim.slice(1)).sort();
  net.ai = ["Здравствуйте! Чем помочь?"];
  await s.chat("winchester", "web-erase-1", "Здравствуйте, мой номер +7 700 000 00 91");
  const own = await login(s, "owner-key-123456");
  const r = await own.post("/api/inbox/act", { c: "winchester", ch: "web", id: "web-erase-1", act: "erase" });
  assert.equal(r.status, 200, await r.text());
  assert.deepEqual(keysWith(s, victim.slice(1)).filter(k => !k.startsWith("h:web:")).sort(), before.filter(k => !k.startsWith("h:web:")), "данные владельца номера на месте");
});
