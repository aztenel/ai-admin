// Пульт и старая копия переписки в KV (живая проверка стенда ai-admin-test, 01.11.2026). Вебхуки Green-API принимает одна точка
// сети Cloudflare, пульт администратора читает другая: KV там отдаёт копию, прочитанную раньше, до cacheTtl секунд (по умолчанию 60).
// Владелец: «очень большая задержка сообщений, галочек именно в самом пульте, а на ватсапп приходит мгновенно» — до 2 минут и часто
// только после обновления страницы. Здесь: переписку читаем с наименьшим сроком, который принимает Cloudflare (30 с), а галочки
// открытого чата берём ещё и из D1 — она согласована сразу. Номера вымышленные.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, gaPass } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";

const skip = sqliteOk ? false : "node:sqlite есть только в Node 22+";
const INST = { id: "7105000077", token: "ga-tok-w" };
const ENV = { GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
const B = "77000000951", HK = `h:ga:winchester:${B}`;
const login = async s => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" }); return b; };
const hook = (s, body) => s.call(`/ga/winchester?t=${gaPass("winchester", INST)}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ instanceData: { idInstance: +INST.id, wid: "77000000077@c.us" }, timestamp: Math.floor(Date.now() / 1000), ...body }) });
const status = (s, id, st) => hook(s, { typeWebhook: "outgoingMessageStatus", chatId: B + "@c.us", idMessage: id, status: st, sendByApi: true });
const send = (b, text, rid) => b.post("/api/inbox/send", { c: "winchester", ch: "ga", id: B, text, rid });
const chat = async b => (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${B}`)).json();
/** чтения KV по ключу переписки: с какими настройками */
const spyGets = s => {
  const real = s.kv.api.get, seen = [];
  s.kv.api.get = async (k, ...rest) => { if (k === HK) seen.push(rest[0]); return real(k, ...rest); };
  return { seen, off: () => { s.kv.api.get = real; } };
};

test("переписку читают со сроком 30 с: пульт (чат, ответ), входящее, отчёт о доставке, ответ с телефона", { skip }, async () => {
  net.reset();
  const s = mk({ ...ENV, DB: d1With("production").db }), b = await login(s), spy = spyGets(s);
  await s.gaText("winchester", INST, B, "Здравствуйте, можно на завтра?");
  assert.equal((await send(b, "Здравствуйте! Да, на 15:00", "rid-stale-0001")).status, 200);
  const mid = s.kv.json(HK).turns.at(-1).mid;
  assert.ok(mid, "Green-API вернул номер сообщения");
  await status(s, mid, "delivered");
  await hook(s, { typeWebhook: "outgoingMessageReceived", chatId: B + "@c.us", idMessage: "PHONE-951-1", senderData: { chatId: B + "@c.us", sender: "77000000077@c.us" }, messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "Ответ с телефона" } } });
  await chat(b);
  await s.settle();
  spy.off();
  assert.ok(spy.seen.length >= 5, "чтений переписки: " + spy.seen.length);
  assert.deepEqual(spy.seen.filter(o => !(o && o.cacheTtl === 30)), [], "каждое чтение — с cacheTtl 30 (по умолчанию копия живёт 60 с)");
});

test("старая копия переписки: галочки открытого чата — из D1, без записи в KV", { skip }, async () => {
  net.reset();
  const d = d1With("production"), s = mk({ ...ENV, DB: d.db }), b = await login(s);
  await s.gaText("winchester", INST, B, "Добрый день");
  assert.equal((await send(b, "Здравствуйте! Слушаю вас", "rid-stale-0002")).status, 200);
  const old = s.kv.mem.get(HK), mid = s.kv.json(HK).turns.at(-1).mid;
  await status(s, mid, "delivered");
  await status(s, mid, "read");
  assert.equal(s.kv.json(HK).turns.at(-1).st, "read", "отчёты записаны");
  // точка сети пульта ещё отдаёт копию до отчётов (как на стенде: «в списке синие, в чате одна галочка»)
  const real = s.kv.api.get, puts = s.kv.ops.put;
  s.kv.api.get = async (k, ...rest) => (k === HK ? old : real(k, ...rest));
  const c = await chat(b);
  s.kv.api.get = real;
  const mine = c.turns.at(-1);
  assert.equal(mine.r, "a");
  assert.equal(mine.st, "read", "две синие — из D1, хотя копия переписки старая");
  assert.equal(c.turns.at(-2).r, "u");
  assert.equal(c.turns.at(-2).st, undefined, "у сообщения клиента статуса нет");
  assert.equal(s.kv.ops.put, puts, "чтение чата ничего не записывает");
});

test("галочки из D1 не понижают статус и не трогают чужие сообщения; без D1 — как в копии", { skip }, async () => {
  net.reset();
  const d = d1With("production"), s = mk({ ...ENV, DB: d.db }), b = await login(s);
  await s.gaText("winchester", INST, B, "Привет");
  assert.equal((await send(b, "Первое", "rid-stale-0003")).status, 200);
  const m1 = s.kv.json(HK).turns.at(-1).mid;
  assert.equal((await send(b, "Второе", "rid-stale-0004")).status, 200);
  const m2 = s.kv.json(HK).turns.at(-1).mid;
  await status(s, m1, "read");
  await status(s, m2, "delivered");
  const c = await chat(b);
  assert.deepEqual(c.turns.filter(t => t.r === "a").map(t => t.st), ["read", "delivered"]);
  // KV уже «прочитано», а в D1 только «доставлено» — остаётся «прочитано»
  const h = s.kv.json(HK); h.turns.at(-1).st = "read"; await s.kv.api.put(HK, JSON.stringify(h));
  assert.equal((await chat(b)).turns.at(-1).st, "read", "D1 не понижает статус");
  // тот же чат на Worker без D1: статусы — как в копии переписки, чат открывается
  const s2 = mk({ ...ENV }), b2 = await login(s2);
  await s2.kv.api.put(HK, s.kv.mem.get(HK)); await s2.kv.api.put(`wa:niche:ga:${B}`, "winchester");
  const c2 = await chat(b2);
  assert.deepEqual(c2.turns.filter(t => t.r === "a").map(t => t.st), ["read", "read"]);
});

test("среда Cloudflare не приняла cacheTtl — чтение без него, чат и отправка работают", { skip }, async () => {
  net.reset();
  const s = mk({ ...ENV, DB: d1With("production").db }), b = await login(s), real = s.kv.api.get;
  s.kv.api.get = async (k, ...rest) => { if (rest[0] && rest[0].cacheTtl !== undefined) throw new TypeError("KV GET failed: Invalid cacheTtl 30, expected at least 60"); return real(k, ...rest); };
  await s.gaText("winchester", INST, B, "Есть время сегодня?");
  assert.equal((await send(b, "Да, в 18:00", "rid-stale-0005")).status, 200);
  const c = await chat(b);
  s.kv.api.get = real;
  assert.deepEqual(c.turns.map(t => t.x), ["Есть время сегодня?", "Да, в 18:00"]);
  // хранилище не отвечает совсем — как раньше: «Сервер не отвечает», а не пустой чат
  s.kv.fail.get = k => k === HK;
  const down = await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${B}`);
  s.kv.fail.get = null;
  assert.equal(down.status, 503);
});
