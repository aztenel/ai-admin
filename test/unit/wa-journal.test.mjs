// Журнал вебхуков основного номера для переписок в D1 (01.11.2026, условие до переключения боевого сайта, docs/runbooks/winchester-go-live.md §8):
// Meta (/wa/<id>, общий номер POST /) и Wazzapo (/wz/<id>) отвечают «200» сразу и пишут переписку уже после ответа — сбой D1 в эту
// минуту терял бы входящее основного номера: после «200» Meta и Wazzapo его не повторяют. Теперь событие сначала ложится в журнал KV,
// а проигрыш — тем же кодом, без дублей и без сообщений клиенту. Сначала — проверки, которые повторяют потерю, потом исправление.
// Номера вымышленные.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { net, mk, mkKV } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { chatEnv } from "../../src/services/chatstore/index.js";
import { walKick, walPending } from "../../src/services/chatstore/wal.js";

const skip = sqliteOk ? false : "нужна D1 на node:sqlite (Node 22+)";
const META = { WA_TOKEN_WINCHESTER: "meta-tok-w", APP_SECRET_WINCHESTER: "sec-w", PHONE_NUMBER_ID_WINCHESTER: "555000222" };
const WZ = { WA_VIA_WINCHESTER: "wazzapo", WA_TOKEN_WINCHESTER: "wz_live_test", APP_SECRET_WINCHESTER: "hook-secret", PHONE_NUMBER_ID_WINCHESTER: "103799815708451" };
const SHARED = { WA_TOKEN: "meta-tok-0", APP_SECRET: "sec-0", WA_CLIENT: "winchester", PHONE_NUMBER_ID: "555000444" };
const D1MODE = { CHAT_STORE_WINCHESTER: "d1" };
const A = "77000009901", B = "77000009902";

/** D1 не отвечает на запросы переписок (как сбой связи с базой) */
const down = d => { d.ctl.fail = sql => /chat_(threads|messages)/.test(sql) && !/sqlite_master/.test(sql); };
const rows = (d, chat = A, ws = "winchester") => d.raw.prepare("select mkey, role, mid, data from chat_messages where ws = ? and ch = 'wa' and chat = ? order by t, id").all(ws, chat);
const texts = (d, chat = A, ws) => rows(d, chat, ws).map(r => JSON.parse(r.data).text);
const thread = (d, chat = A, ws = "winchester") => { const r = d.raw.prepare("select profile from chat_threads where ws = ? and ch = 'wa' and chat = ?").get(ws, chat); return r ? JSON.parse(r.profile) : null; };
const ibq = kv => [...kv.mem.keys()].filter(k => k.startsWith("ibq:"));
const login = async s => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" }); return b; };
const kick = (s, cid = "winchester") => walKick(chatEnv(s.env), cid, { force: true });
/** одна копия Worker: своё KV и своя D1 @param {Record<string, string>} extra */
function place(extra) { net.reset(); const kv = mkKV(), d = d1With("production"); return { kv, d, s: mk({ ...extra, KV: kv.api, DB: d.db }) }; }

// Meta: уведомление с сообщениями (тело и подпись — как у Meta, test/harness.mjs)
const tx = (id, from, body) => ({ id, from, type: "text", text: { body } });
const meta = (s, msgs, o = {}) => s.waPost(o.path || "/wa/winchester", msgs, { secret: o.secret || "sec-w", ...(o.raw ? { raw: o.raw } : {}) });
const sent = to => net.graph.filter(g => g.method === "POST" && g.body && g.body.to === to).length;
// Wazzapo: событие с подписью; X-Wazzapo-Delivery-Id одинаков у всех повторов одного события (документация Wazzapo)
let n = 0;
function wz(s, event, data, delivery) {
  const body = JSON.stringify({ event, timestamp: "2026-10-03T07:00:00.000Z", data: { channel: "whatsapp", phone_number_id: "103799815708451", ...data } });
  return s.call("/wz/winchester", { method: "POST", body, headers: { "content-type": "application/json", "x-wazzapo-delivery-id": delivery || "dlv-wj-" + ++n, "x-wazzapo-signature": "sha256=" + createHmac("sha256", "hook-secret").update(body).digest("hex") } });
}
const wzIn = (s, id, from, text, delivery) => wz(s, "message.incoming", { contact: { phone: from, name: "Айгерим" }, message: { id, from, type: "text", text, timestamp: "1791010000" } }, delivery);
const wzSent = to => net.wz.filter(r => r.path === "/messages/send" && r.body && r.body.to === to).length;

test("Meta: D1 не ответила во время вебхука — входящее ждёт в журнале и после восстановления появляется один раз; попытки при лежащей базе клиенту не пишут", { skip }, async () => {
  const { kv, d, s } = place({ ...META, ...D1MODE });
  assert.equal((await meta(s, tx("wamid.WJ-1", A, "Здравствуйте"))).status, 200);
  down(d);
  const r = await meta(s, tx("wamid.WJ-2", A, "Можно на завтра в 15:00?"));
  assert.equal(r.status, 200, "Meta получила «200» — повторять не будет");
  assert.deepEqual(texts(d), ["Здравствуйте"], "не записалось");
  assert.equal(await walPending(s.env, "winchester"), 1, "событие в журнале");
  // база ещё лежит: проигрыш не проходит, событие остаётся, а клиенту ничего не уходит (ни ответа, ни «спасибо за сообщение»)
  const was = sent(A);
  for (let i = 0; i < 2; i++) assert.equal((await kick(s)).failed, 1);
  assert.equal(sent(A), was, "попытки проигрыша клиенту не пишут");
  assert.equal(await walPending(s.env, "winchester"), 1);
  d.ctl.fail = null;
  const k = await kick(s);
  assert.equal(k.done, 1, JSON.stringify(k));
  assert.deepEqual(texts(d), ["Здравствуйте", "Можно на завтра в 15:00?"]);
  assert.equal(rows(d)[1].mid, "wamid.WJ-2", "у реплики — номер сообщения у Meta: по нему строка в D1 одна при любом повторе");
  assert.equal(thread(d).need && thread(d).need.why, "off", "в пульте — «Нужен ответ»");
  assert.equal(sent(A), was, "и после восстановления проигрыш клиенту не пишет");
  assert.equal(await walPending(s.env, "winchester"), 0);
  assert.equal((await kick(s)).done, 0, "второй проигрыш — нечего");
  await meta(s, tx("wamid.WJ-2", A, "Можно на завтра в 15:00?")); // Meta прислала то же уведомление ещё раз
  assert.equal(rows(d).length, 2, "дубля нет");
  assert.deepEqual(ibq(kv), []);
});

test("Wazzapo: то же — событие ложится в журнал уже в формате Meta, после восстановления записывается один раз", { skip }, async () => {
  const { kv, d, s } = place({ ...WZ, ...D1MODE });
  assert.equal((await wzIn(s, "wamid.WZJ-1", A, "Здравствуйте")).status, 200);
  down(d);
  const r = await wzIn(s, "wamid.WZJ-2", A, "Хочу записаться к Тони", "dlv-wzj-2");
  d.ctl.fail = null;
  assert.equal(r.status, 200);
  const was = wzSent(A); // сбой при первой обработке — «Спасибо за сообщение…», как и раньше (handleWAText)
  assert.equal(await walPending(s.env, "winchester"), 1, "событие в журнале");
  const v = JSON.parse(kv.mem.get(ibq(kv)[0]));
  assert.equal(v.src, "wa");
  assert.ok(Array.isArray(v.body.entry), "в журнале — тело в формате Meta: проигрыш идёт тем же кодом, что у Meta");
  assert.equal((await kick(s)).done, 1);
  assert.deepEqual(texts(d), ["Здравствуйте", "Хочу записаться к Тони"]);
  assert.equal(wzSent(A), was, "проигрыш клиенту ничего не отправил");
  assert.equal((await wzIn(s, "wamid.WZJ-2", A, "Хочу записаться к Тони", "dlv-wzj-2")).status, 200); // Wazzapo повторил доставку
  assert.equal(rows(d).length, 2, "дубля нет");
  assert.equal(await walPending(s.env, "winchester"), 0);
});

test("Meta повторила уведомление, когда база уже работала: повтор («уже видели») не убирает из журнала первую, не записанную доставку", { skip }, async () => {
  // Meta: «These retries can result in duplicate webhook notifications» — у каждой доставки своя запись журнала
  const { d, s } = place({ ...META, ...D1MODE });
  await meta(s, tx("wamid.WJ-D0", A, "Здравствуйте"));
  down(d);
  await meta(s, tx("wamid.WJ-D1", A, "Буду в 16:00"));
  d.ctl.fail = null;
  assert.equal((await meta(s, tx("wamid.WJ-D1", A, "Буду в 16:00"))).status, 200);
  assert.deepEqual(texts(d), ["Здравствуйте"], "повтор отсечён отметкой «уже видели» первой доставки");
  assert.ok(await walPending(s.env, "winchester") >= 1, "первая доставка ждёт в журнале");
  await kick(s);
  assert.deepEqual(texts(d), ["Здравствуйте", "Буду в 16:00"], "сообщение не потеряно и не удвоено");
  assert.equal(await walPending(s.env, "winchester"), 0);
});

test("сообщение записалось, а сбой D1 был позже в той же обработке: проигрыш его не удваивает и закрытый чат снова не открывает", { skip }, async () => {
  const { d, s } = place({ ...META, ...D1MODE });
  const b = await login(s);
  await meta(s, tx("wamid.WJ-U0", A, "Здравствуйте"));
  const real = d.db.batch;
  d.db.batch = async st => { const r = await real(st); if (st.some(x => /insert or ignore into chat_messages/.test(x.sql) && (x.args || []).includes("m:wamid.WJ-U1:u"))) down(d); return r; }; // записалось — и база легла
  await meta(s, tx("wamid.WJ-U1", A, "Спасибо, буду"));
  d.db.batch = real; d.ctl.fail = null;
  assert.deepEqual(texts(d), ["Здравствуйте", "Спасибо, буду"]);
  assert.equal(await walPending(s.env, "winchester"), 1, "сбой был — событие в журнале");
  assert.equal((await b.post("/api/inbox/act", { c: "winchester", ch: "wa", id: A, act: "resolve", force: true })).status, 200); // администратор закрыл чат
  assert.equal((await kick(s)).done, 1);
  assert.deepEqual(texts(d), ["Здравствуйте", "Спасибо, буду"], "дубля нет");
  const p = thread(d);
  assert.ok(!p.need && p.done, "чат остался закрытым: " + JSON.stringify({ need: p.need, done: p.done }));
});

test("фото с подписью при лежащей базе — после восстановления в чате и файл, и подпись, по одному разу", { skip }, async () => {
  const { d, s } = place({ ...META, ...D1MODE });
  down(d);
  await meta(s, { id: "wamid.WJ-P1", from: A, type: "image", image: { id: "media-77", mime_type: "image/jpeg", caption: "Вот такую стрижку хочу" } });
  d.ctl.fail = null;
  assert.equal((await kick(s)).done, 1);
  assert.deepEqual(texts(d), ["[клиент прислал фото]", "Вот такую стрижку хочу"]);
  assert.deepEqual(rows(d).map(r => r.mid), ["wamid.WJ-P1", "c:wamid.WJ-P1"], "у файла и подписи — свои ключи строк");
  assert.equal((await kick(s)).done, 0);
  await meta(s, { id: "wamid.WJ-P1", from: A, type: "image", image: { id: "media-77", mime_type: "image/jpeg", caption: "Вот такую стрижку хочу" } }); // повтор Meta
  assert.equal(rows(d).length, 2);
});

test("одно уведомление Meta сразу в двух точках сети (база работает) — одна строка в D1", { skip }, async () => {
  net.reset();
  const central = mkKV(), d = d1With("production"), slow = ms => new Promise(r => setTimeout(r, ms));
  // две точки сети: своя копия KV у каждой (память «уже видели» у них разная), обе читают «не видели» до отметки другой
  const edge = () => ({ get: async (k, o) => { await slow(5); return central.api.get(k, o); }, getWithMetadata: k => central.api.getWithMetadata(k), put: async (k, v, o) => { await slow(20); return central.api.put(k, v, o); }, delete: k => central.api.delete(k), list: o => central.api.list(o) });
  const W = mk({ ...META, ...D1MODE, KV: edge(), DB: d.db }), P = mk({ ...META, ...D1MODE, KV: edge(), DB: d.db });
  await Promise.all([meta(W, tx("wamid.WJ-2W", A, "Здравствуйте")), meta(P, tx("wamid.WJ-2W", A, "Здравствуйте"))]);
  assert.equal(rows(d).length, 1, JSON.stringify(rows(d)));
});

test("журнал KV не записался: «200» Meta — только после записи в D1; D1 тоже лежит — 503, повтор Meta записывает один раз", { skip }, async () => {
  const { kv, d, s } = place({ ...META, ...D1MODE });
  await meta(s, tx("wamid.WJ-K0", A, "Здравствуйте"));
  const put0 = kv.api.put;
  kv.api.put = async (k, v, o) => { if (k.startsWith("ibq:")) throw new Error("KV PUT failed: 500"); return put0(k, v, o); };
  // журнал не пишется, D1 работает: обработка сразу, «200» после записи
  let r = await meta(s, tx("wamid.WJ-K1", A, "Журнал не записался, база есть"));
  assert.equal(r.status, 200);
  assert.deepEqual(texts(d), ["Здравствуйте", "Журнал не записался, база есть"]);
  // ни журнала, ни базы: не подтверждаем — Meta повторит
  down(d);
  r = await meta(s, tx("wamid.WJ-K2", A, "Ни журнала, ни базы"));
  assert.ok(r.status >= 500, "не 200: " + r.status);
  d.ctl.fail = null; kv.api.put = put0;
  r = await meta(s, tx("wamid.WJ-K2", A, "Ни журнала, ни базы"));   // повтор Meta того же уведомления
  assert.equal(r.status, 200);
  r = await meta(s, tx("wamid.WJ-K2", A, "Ни журнала, ни базы"));   // и ещё раз — дубля нет
  assert.deepEqual(texts(d), ["Здравствуйте", "Журнал не записался, база есть", "Ни журнала, ни базы"]);
});

test("Wazzapo: журнал KV не записался и D1 лежит — 503; повтор Wazzapo (тот же Delivery-Id) записывает один раз", { skip }, async () => {
  const { kv, d, s } = place({ ...WZ, ...D1MODE });
  await wzIn(s, "wamid.WZK-0", A, "Здравствуйте");
  const put0 = kv.api.put;
  kv.api.put = async (k, v, o) => { if (k.startsWith("ibq:")) throw new Error("KV PUT failed: 500"); return put0(k, v, o); };
  down(d);
  let r = await wzIn(s, "wamid.WZK-1", A, "Ни журнала, ни базы", "dlv-wzk-1");
  assert.ok(r.status >= 500, "не 200: " + r.status);
  d.ctl.fail = null; kv.api.put = put0;
  r = await wzIn(s, "wamid.WZK-1", A, "Ни журнала, ни базы", "dlv-wzk-1"); // отметки «доставка уже была» и «то же сообщение» сняты
  assert.equal(r.status, 200);
  r = await wzIn(s, "wamid.WZK-1", A, "Ни журнала, ни базы", "dlv-wzk-1");
  assert.deepEqual(texts(d), ["Здравствуйте", "Ни журнала, ни базы"]);
});

test("«Удалить данные клиента» убирает его события Meta из журнала — и из уведомления, где сообщения разных клиентов", { skip }, async () => {
  const { kv, d, s } = place({ ...META, ...D1MODE });
  const b = await login(s);
  await meta(s, tx("wamid.WJ-E0", A, "Здравствуйте"));
  down(d);
  await meta(s, tx("wamid.WJ-E1", A, "Мой номер карты 4400 …"));
  await meta(s, tx("wamid.WJ-E2", B, "Чужой чат, тоже ждёт"));
  await meta(s, [tx("wamid.WJ-E3", A, "Ещё от удаляемого 4400"), tx("wamid.WJ-E4", B, "Ещё из чужого чата")]); // одно уведомление — два клиента
  d.ctl.fail = null;
  assert.equal(await walPending(s.env, "winchester"), 3);
  const er = await b.post("/api/inbox/act", { c: "winchester", ch: "wa", id: A, act: "erase" });
  assert.equal(er.status, 200, await er.clone().text());
  assert.equal(await walPending(s.env, "winchester"), 2, "событие удалённого клиента убрано, общее уведомление — без его сообщения");
  assert.ok(!ibq(kv).some(k => /4400|Ещё от удаляемого/.test(kv.mem.get(k))), "текста удалённого клиента в журнале нет");
  const k = await kick(s);
  assert.equal(k.done, 2, JSON.stringify(k));
  assert.equal(rows(d, A).length, 0, "удалённое не вернулось");
  assert.deepEqual(texts(d, B), ["Чужой чат, тоже ждёт", "Ещё из чужого чата"]);
});

test("Wazzapo: «Удалить данные клиента» убирает и его события из журнала", { skip }, async () => {
  const { d, s } = place({ ...WZ, ...D1MODE });
  const b = await login(s);
  await wzIn(s, "wamid.WZE-0", A, "Здравствуйте");
  down(d);
  await wzIn(s, "wamid.WZE-1", A, "Мой адрес …");
  await wzIn(s, "wamid.WZE-2", B, "Чужой чат");
  d.ctl.fail = null;
  assert.equal(await walPending(s.env, "winchester"), 2);
  assert.equal((await b.post("/api/inbox/act", { c: "winchester", ch: "wa", id: A, act: "erase" })).status, 200);
  assert.equal(await walPending(s.env, "winchester"), 1);
  await kick(s);
  assert.equal(rows(d, A).length, 0);
  assert.deepEqual(texts(d, B), ["Чужой чат"]);
});

test("бот включён: проигрыш журнала записывает сообщение для администратора, но клиенту второй раз не пишет", { skip }, async () => {
  net.reset(); net.ai = ["Здравствуйте! Чем помочь?"];
  const kv = mkKV(), d = d1With("production"), C = "77051119901", hook = { path: "/wa/barber", secret: "sec-b" };
  const s = mk({ CHAT_STORE_BARBER: "d1", WA_TOKEN_BARBER: "meta-tok-b", APP_SECRET_BARBER: "sec-b", PHONE_NUMBER_ID_BARBER: "555000333", KV: kv.api, DB: d.db });
  await meta(s, tx("wamid.BOT-0", C, "Здравствуйте"), hook);
  assert.ok(sent(C) >= 1, "бот ответил");
  down(d);
  net.ai = ["Есть сегодня в 15:00."];
  await meta(s, tx("wamid.BOT-1", C, "А сегодня можно?"), hook);
  const was = sent(C); // при сбое — «Спасибо за сообщение! Администратор ответит…» (thinkSafe), как раньше
  assert.equal(await walPending(s.env, "barber"), 1);
  assert.equal((await kick(s, "barber")).failed, 1, "база ещё лежит");
  d.ctl.fail = null;
  net.ai = ["Конечно, записываю вас на 15:00."];
  assert.equal((await kick(s, "barber")).done, 1);
  assert.equal(sent(C), was, "проигрыш клиенту ничего не отправил: " + JSON.stringify(s.sentTo(C)));
  const turns = d.raw.prepare("select data from chat_messages where ws = 'barber' and ch = 'wa' and chat = ? order by t, id").all(C).map(r => JSON.parse(r.data));
  assert.equal(turns.filter(t => t.role === "user" && t.text === "А сегодня можно?").length, 1, "сообщение клиента в чате один раз");
  assert.ok(!turns.some(t => /записываю/.test(t.text)), "ответа бота, которого клиент не получал, в чате нет");
  assert.equal(thread(d, C, "barber").need.why, "ai", "в пульте — «Сбой бота»: ответит администратор");
});

test("общий номер Meta (POST /, WA_CLIENT) с подписью — тоже через журнал", { skip }, async () => {
  const { d, s } = place({ ...SHARED, ...D1MODE });
  down(d);
  assert.equal((await meta(s, tx("wamid.SH-1", A, "Здравствуйте"), { path: "/", secret: "sec-0" })).status, 200);
  d.ctl.fail = null;
  assert.equal(await walPending(s.env, "winchester"), 1);
  assert.equal((await kick(s)).done, 1);
  assert.deepEqual(texts(d), ["Здравствуйте"]);
});

test("ответ с телефона (smb_message_echoes) при лежащей базе — после восстановления в чате один раз, бот на паузе", { skip }, async () => {
  const { d, s } = place({ ...META, ...D1MODE });
  await meta(s, tx("wamid.WJ-H0", A, "Здравствуйте"));
  const echo = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "waba1", changes: [{ field: "smb_message_echoes", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "77000000000", phone_number_id: "555000222" },
    message_echoes: [{ from: "77000000000", to: A, id: "wamid.ECHO-1", timestamp: "1791010000", type: "text", text: { body: "Это администратор, запишу вас сам" } }] } }] }] });
  down(d);
  assert.equal((await meta(s, [], { raw: echo })).status, 200);
  d.ctl.fail = null;
  assert.equal(await walPending(s.env, "winchester"), 1);
  assert.equal((await kick(s)).done, 1);
  await meta(s, [], { raw: echo }); // Meta повторила уведомление
  const admin = rows(d).map(r => JSON.parse(r.data)).filter(t => t.by === "admin");
  assert.deepEqual(admin.map(t => t.text), ["Это администратор, запишу вас сам"]);
  assert.ok(thread(d).pausedUntil > Date.now(), "бот на паузе");
});

test("отчёты о доставке Meta переписку не пишут — в журнал не идут", { skip }, async () => {
  const { kv, s } = place({ ...META, ...D1MODE });
  const st = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "waba1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "555000222" },
    statuses: [{ id: "wamid.out.1", status: "delivered", recipient_id: A, timestamp: "1791010000" }] } }] }] });
  const puts = [], put0 = kv.api.put;
  kv.api.put = async (k, v, o) => { if (k.startsWith("ibq:")) puts.push(k); return put0(k, v, o); };
  assert.equal((await meta(s, [], { raw: st })).status, 200);
  kv.api.put = put0;
  assert.deepEqual(puts, []);
});

test("переписки в KV (боевой сайт): у Meta, Wazzapo и общего номера журнала нет, «200» сразу, реплика — как раньше", async () => {
  for (const [env, post] of [
    [META, s => meta(s, tx("wamid.KV-1", A, "Здравствуйте"))],
    [WZ, s => wzIn(s, "wamid.KV-2", A, "Здравствуйте")],
    [SHARED, s => meta(s, tx("wamid.KV-3", A, "Здравствуйте"), { path: "/", secret: "sec-0" })]
  ]) {
    net.reset();
    const kv = mkKV(), s = mk({ ...env, CHAT_STORE: "kv", KV: kv.api }); // CHAT_STORE = kv — и при прогоне всех проверок с переписками в D1
    const r = await post(s);
    assert.equal(r.status, 200);
    assert.deepEqual(ibq(kv), [], "журнала нет");
    const h = kv.json(`h:wa:winchester:${A}`);
    assert.deepEqual(h.turns.map(t => t.text), ["Здравствуйте"]);
    assert.ok(!h.turns.some(t => "mid" in t), "реплика — как раньше, без номера сообщения");
  }
});
