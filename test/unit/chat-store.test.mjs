// Переписки в D1 (01.11.2026, Winchester): защита от потери сообщений. Сначала — потеря в старой схеме: KV в каждой точке сети отдаёт
// свою копию, и ответ администратора по старой копии затирает входящее, пришедшее в другую точку. Потом то же и другие гонки в D1:
// два Worker, пять сообщений подряд, повтор вебхука, два администратора, сбой D1 до записи и после неизвестного итога, перенос из KV
// во время записи, повторный перенос, откат на KV, «стоп», удаление данных, срок хранения, опрос пульта по ревизии. Номера вымышленные.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, mkKV, gaPass } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { importAll, chatCheck, exportAll, chatEnv } from "../../src/services/chatstore/index.js";
import { walKick, walPending } from "../../src/services/chatstore/wal.js";
import { createHmac } from "node:crypto";

const skip = sqliteOk ? false : "нужна D1 на node:sqlite (Node 22+)";
const INST = { id: "7105000088", token: "ga-tok-store" };
const GA = { GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
const D1MODE = { CHAT_STORE_WINCHESTER: "d1" };
const B = "77000008801", HK = `h:ga:winchester:${B}`;
let seq = 0;
const hook = (s, body) => s.call(`/ga/winchester?t=${gaPass("winchester", INST)}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ instanceData: { idInstance: +INST.id, wid: "77000000088@c.us" }, timestamp: Math.floor(Date.now() / 1000), ...body }) });
const inbound = (s, text, id = "IN-" + ++seq, from = B) => s.gaText("winchester", INST, from, text, { idMessage: id });
const status = (s, mid, st) => hook(s, { typeWebhook: "outgoingMessageStatus", chatId: B + "@c.us", idMessage: mid, status: st, sendByApi: true });
const login = async s => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" }); return b; };
const chatOf = async (b, id = B) => (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${id}`)).json();
const send = (b, text, rid, id = B) => b.post("/api/inbox/send", { c: "winchester", ch: "ga", id, text, rid });
const texts = c => (c.turns || []).map(t => t.x);
const rows = (d, chat = B) => d.raw.prepare("select mkey, role, t, mid, st, data from chat_messages where ws = 'winchester' and ch = 'ga' and chat = ? order by t, id").all(chat);

// KV как в Cloudflare: общее хранилище и копии в точках сети. Прочитанное в точке сети остаётся там до конца срока (expire); своя
// запись видна в своей точке сразу, чужая — после срока. Список ключей — из общего хранилища (его отставание здесь не проверяем)
function edge(central) {
  const cache = new Map();
  const api = {
    get: async (k, o) => { if (cache.has(k)) return cache.get(k); const v = await central.api.get(k, o); cache.set(k, v); return v; },
    getWithMetadata: async k => ({ value: await api.get(k), metadata: central.meta.get(k) ?? null }),
    put: async (k, v, o) => { await central.api.put(k, v, o); cache.set(k, v); },
    delete: async k => { await central.api.delete(k); cache.delete(k); },
    list: o => central.api.list(o)
  };
  return { api, expire: () => cache.clear() };
}
/** две точки сети: вебхуки принимает W, пульт открыт в P; общее KV и общая D1 (в KV-режиме D1 нужна пульту для защиты от двойной отправки) */
function twoPlaces(extra = {}) {
  net.reset();
  const central = mkKV(), w = edge(central), p = edge(central), d = d1With("production");
  const W = mk({ ...GA, ...extra, KV: w.api, DB: d.db }), P = mk({ ...GA, ...extra, KV: p.api, DB: d.db });
  return { central, w, p, d, W, P };
}

test("KV: ответ администратора по старой копии в точке сети пульта затирает входящее (так было до D1)", { skip }, async () => {
  const { central, W, P } = twoPlaces();
  const b = await login(P);
  await inbound(W, "Здравствуйте, можно на завтра?");
  assert.deepEqual(texts(await chatOf(b)), ["Здравствуйте, можно на завтра?"], "пульт открыл чат — его точка сети запомнила копию");
  await inbound(W, "Лучше после обеда");                                       // пришло в другую точку сети
  assert.equal((await send(b, "Да, в 15:00", "rid-kv-loss-1")).status, 200);  // ответ — по копии точки сети пульта
  const left = central.json(HK).turns.map(t => t.text);
  assert.deepEqual(left, ["Здравствуйте, можно на завтра?", "Да, в 15:00"], "входящее «Лучше после обеда» потеряно — так было в KV");
});

test("D1: то же самое — входящее на месте, порядок по времени, клиенту ушёл один ответ", { skip }, async () => {
  const { central, d, W, P } = twoPlaces(D1MODE);
  const b = await login(P);
  await inbound(W, "Здравствуйте, можно на завтра?");
  assert.deepEqual(texts(await chatOf(b)), ["Здравствуйте, можно на завтра?"]);
  await inbound(W, "Лучше после обеда");
  assert.equal((await send(b, "Да, в 15:00", "rid-d1-1")).status, 200);
  const c = await chatOf(b);
  assert.deepEqual(texts(c), ["Здравствуйте, можно на завтра?", "Лучше после обеда", "Да, в 15:00"]);
  assert.equal(rows(d).length, 3);
  assert.equal(net.ga.filter(x => x.op === "sendMessage").length, 1);
  // тень в KV — тот же чат (откат на KV без потерь), без служебных полей
  assert.deepEqual(central.json(HK).turns.map(t => t.text), texts(c));
  assert.ok(!JSON.stringify(central.json(HK)).includes('"_i"'));
});

test("D1: два Worker, пять сообщений почти одновременно, ответ администратора и статус доставки — ничего не теряется и не удваивается", { skip }, async () => {
  const { d, W, P } = twoPlaces(D1MODE);
  const b = await login(P);
  await inbound(W, "Первое");
  const sent = await send(b, "Слушаю вас", "rid-five-1");
  assert.equal(sent.status, 200);
  const mid = rows(d).find(r => r.role === "model").mid;
  // пять входящих в два Worker, ответ из пульта и отчёт о доставке — одновременно
  await Promise.all([
    inbound(W, "Второе"), inbound(P, "Третье"), inbound(W, "Четвёртое"), inbound(P, "Пятое"), inbound(W, "Шестое"),
    send(b, "Минутку", "rid-five-2"), status(W, mid, "delivered"), status(P, mid, "read")
  ]);
  const got = rows(d);
  assert.deepEqual(got.filter(r => r.role === "user").map(r => JSON.parse(r.data).text).sort(), ["Второе", "Первое", "Пятое", "Третье", "Четвёртое", "Шестое"].sort());
  assert.deepEqual(got.filter(r => r.role === "model").map(r => JSON.parse(r.data).text).sort(), ["Минутку", "Слушаю вас"]);
  assert.equal(got.find(r => r.mid === mid).st, "read", "«доставлено» и «прочитано» в разных Worker — итог «прочитано»");
  assert.equal(new Set(got.map(r => r.mkey)).size, got.length, "дублей нет");
  const c = await chatOf(b);
  assert.equal(c.turns.length, 8, "пульт видит всё");
  const th = d.raw.prepare("select rev, n, need from chat_threads where ws = 'winchester' and chat = ?").get(B);
  assert.ok(th.rev >= 9, "каждое изменение — своя ревизия (позднее «доставлено» после «прочитано» ничего не меняет): " + th.rev);
});

test("D1: повтор вебхука сразу в двух Worker — одно сообщение", { skip }, async () => {
  const { d, W, P } = twoPlaces(D1MODE);
  await Promise.all([inbound(W, "Привет", "DUP-1"), inbound(P, "Привет", "DUP-1"), inbound(W, "Привет", "DUP-1")]);
  assert.equal(rows(d).length, 1);
});

test("D1: два администратора одновременно — «Взять себе» и «Создать задачу» — оба изменения остаются", { skip }, async () => {
  const { d, W, P } = twoPlaces(D1MODE);
  await inbound(W, "Нужна запись на вечер");
  const a = await login(W), b = await login(P);
  await Promise.all([
    a.post("/api/inbox/act", { c: "winchester", ch: "ga", id: B, act: "take", op: "Айгерим" }),
    b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: B, act: "task", text: "Перезвонить в 18:00", op: "Ерлан" })
  ]);
  const p = JSON.parse(d.raw.prepare("select profile from chat_threads where ws = 'winchester' and chat = ?").get(B).profile);
  assert.equal(p.as && p.as.n, "Айгерим", "кто ведёт — Айгерим");
  assert.equal(p.need && p.need.why, "task", "задача Ерлана на месте");
  assert.ok((p.audit || []).length >= 2, "в журнале оба действия: " + JSON.stringify(p.audit));
});

test("D1: сбой базы до записи — событие ждёт в журнале, после восстановления сообщение появляется один раз", { skip }, async () => {
  const { d, W, P } = twoPlaces(D1MODE);
  const b = await login(P);
  await inbound(W, "Первое");
  d.ctl.fail = sql => /chat_(threads|messages)/.test(sql) && !/sqlite_master/.test(sql);
  await inbound(W, "Пока база лежит", "IN-DOWN-1");
  assert.equal(rows(d).length, 1, "не записалось");
  assert.equal(await walPending(W.env, "winchester"), 1, "событие в журнале");
  const down = await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${B}`);
  assert.ok(down.status >= 500, "пульт честно говорит о сбое, а не показывает старое из KV: " + down.status);
  d.ctl.fail = null;
  const r = await walKick(chatEnv(W.env), "winchester", { force: true });
  assert.equal(r.done, 1);
  assert.deepEqual(texts(await chatOf(b)), ["Первое", "Пока база лежит"]);
  assert.equal(await walPending(W.env, "winchester"), 0);
  assert.equal((await walKick(chatEnv(W.env), "winchester", { force: true })).done, 0);
  await inbound(W, "Пока база лежит", "IN-DOWN-1"); // Green-API прислал то же событие ещё раз
  assert.equal(rows(d).length, 2, "второй раз не записалось");
});

test("D1: база записала, а ответ до Worker не дошёл — повтор не удваивает сообщение", { skip }, async () => {
  const { d, W, P } = twoPlaces(D1MODE);
  const real = d.db.batch;
  let once = true;
  d.db.batch = async st => { const r = await real(st); if (once && st.some(x => /update chat_threads set rev/.test(x.sql))) { once = false; throw new Error("D1_ERROR: Network connection lost."); } return r; };
  await inbound(W, "Только одно");
  d.db.batch = real;
  assert.equal(rows(d).length, 1);
  const b = await login(P);
  assert.deepEqual(texts(await chatOf(b)), ["Только одно"]);
});

test("перенос из KV: чаты и реплики, запись во время переноса, повтор — без дублей, сверка — без пропусков", { skip }, async () => {
  net.reset();
  const kv = mkKV(), d = d1With("production"), C = "77000008802";
  const old = mk({ ...GA, KV: kv.api, DB: d.db });                          // до переключения: KV
  await inbound(old, "Добрый день");
  await inbound(old, "Есть время в субботу?");
  await inbound(old, "Здравствуйте", "IN-OTHER-1", C);
  const bk = await login(old);
  assert.equal((await send(bk, "Есть, в 12:00", "rid-mig-1")).status, 200);
  const before = kv.json(HK);
  assert.equal(before.turns.length, 3);
  const neu = mk({ ...GA, ...D1MODE, KV: kv.api, DB: d.db });              // переключили: D1
  const b = await login(neu);
  // первый список переносит все чаты компании; одновременно приходит новое сообщение
  const [list] = await Promise.all([b.go("/api/inbox/list?c=winchester&v=2"), inbound(neu, "Беру 12:00")]);
  const ids = ((await list.json()).chats || []).map(x => x.id).sort();
  assert.deepEqual(ids, [B, C].sort(), "оба чата из KV в списке");
  assert.deepEqual(texts(await chatOf(b)), ["Добрый день", "Есть время в субботу?", "Есть, в 12:00", "Беру 12:00"]);
  // в это время старый Worker (ещё не обновился) записал сообщение только в KV
  await inbound(old, "Как добраться?", "IN-LATE-1");
  const again = await importAll(chatEnv(neu.env), "winchester");
  assert.equal(again.merged, 1, "повторный перенос добавил реплику, записанную по-старому: " + JSON.stringify(again));
  const third = await importAll(chatEnv(neu.env), "winchester");
  assert.equal(third.merged + third.imported, 0, "третий раз — ничего");
  assert.deepEqual(texts(await chatOf(b)), ["Добрый день", "Есть время в субботу?", "Есть, в 12:00", "Беру 12:00", "Как добраться?"]);
  const chk = await chatCheck(chatEnv(neu.env), "winchester");
  assert.equal(chk.missingChats, 0); assert.equal(chk.missingTurns, 0);
  assert.equal(chk.kvChats, 2);
  assert.ok(!JSON.stringify(chk).includes("Добрый"), "в отчёте нет текста переписок");
  const th = d.raw.prepare("select src from chat_threads where ws = 'winchester' and chat = ?").get(C);
  assert.equal(th.src, "kv");
});

test("откат на KV: после переключения новые сообщения и в тени KV; экспорт выравнивает; KV-режим видит всё", { skip }, async () => {
  net.reset();
  const kv = mkKV(), d = d1With("production");
  const neu = mk({ ...GA, ...D1MODE, KV: kv.api, DB: d.db });
  await inbound(neu, "Сообщение в D1");
  const b = await login(neu);
  assert.equal((await send(b, "Ответ в D1", "rid-rb-1")).status, 200);
  // тень могла не записаться (сбой KV) — экспорт пишет всё из D1
  kv.mem.delete(HK);
  const rep = await exportAll(chatEnv(neu.env), "winchester");
  assert.equal(rep.written, 1);
  const back = mk({ ...GA, KV: kv.api, DB: d.db });                          // вернули KV
  const bb = await login(back);
  assert.deepEqual(texts(await chatOf(bb)), ["Сообщение в D1", "Ответ в D1"]);
  const list = await (await bb.go("/api/inbox/list?c=winchester&v=2")).json();
  assert.equal(list.chats.length, 1);
});

test("D1: «стоп», «Удалить данные клиента» и срок хранения", { skip }, async () => {
  net.reset();
  const kv = mkKV(), d = d1With("production"), s = mk({ ...GA, ...D1MODE, KV: kv.api, DB: d.db }), b = await login(s);
  await inbound(s, "Здравствуйте");
  await inbound(s, "стоп");
  // бот выключен: «стоп» — отказ от сообщений (KV optout и запрет в D1), как и до переноса переписок; само сообщение — в переписке
  assert.ok(kv.mem.has(`optout:winchester:${B}`), "отказ записан");
  assert.ok(d.raw.prepare("select count(*) n from restrictions where ws = 'winchester'").get().n >= 1, "запрет в D1");
  assert.deepEqual(rows(d).map(r => JSON.parse(r.data).text), ["Здравствуйте", "стоп"]);
  const er = await b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: B, act: "erase" });
  assert.equal(er.status, 200, await er.clone().text());
  assert.equal(rows(d).length, 0, "переписка удалена из D1");
  const left = d.raw.prepare("select profile from chat_threads where ws = 'winchester' and chat = ?").get(B);
  assert.ok(!left || !/Здравствуйте/.test(left.profile), "в профиле нет текста");
  assert.ok(!kv.mem.has(HK) || !/Здравствуйте/.test(kv.mem.get(HK)), "и в тени KV");
  // срок хранения: 7 дней после последнего сообщения — чат не показывается и удаляется
  await inbound(s, "Новый чат", "IN-EXP-1", "77000008803");
  d.raw.prepare("update chat_threads set expires_at = ? where chat = '77000008803'").run(Date.now() - 1000);
  const c = await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=77000008803`);
  assert.equal(c.status, 404);
  assert.equal(d.raw.prepare("select count(*) n from chat_messages where chat = '77000008803'").get().n, 0);
});

test("D1 не подключена, а CHAT_STORE = d1 — ошибка, а не тихая запись в KV", { skip }, async () => {
  net.reset();
  const kv = mkKV(), s = mk({ ...GA, ...D1MODE, KV: kv.api });
  await inbound(s, "Здравствуйте", "IN-NODB-1");
  assert.ok(!kv.mem.has(HK), "в KV переписка не записалась");
  assert.equal(await walPending(s.env, "winchester"), 1, "сообщение не потеряно: ждёт в журнале, пока базу не подключат");
  const b = await login(s);
  const r = await b.go("/api/inbox/list?c=winchester&v=2");
  assert.ok(r.status >= 500, "список — ошибка: " + r.status);
});

test("опрос пульта: ревизия чата и версия списка — «без изменений» одним маленьким ответом", { skip }, async () => {
  net.reset();
  const kv = mkKV(), d = d1With("production"), s = mk({ ...GA, ...D1MODE, KV: kv.api, DB: d.db }), b = await login(s);
  await inbound(s, "Здравствуйте");
  const c = await chatOf(b);
  assert.ok(c.rev > 0);
  const same = await (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${B}&since=${c.rev}`)).json();
  assert.deepEqual(Object.keys(same).sort(), ["now", "rev", "same"]);
  const l = await (await b.go("/api/inbox/list?c=winchester&v=2")).json();
  assert.ok(l.ver);
  assert.equal((await (await b.go(`/api/inbox/list?c=winchester&v=2&since=${l.ver}`)).json()).same, 1);
  await inbound(s, "Ещё вопрос");
  const l2 = await (await b.go(`/api/inbox/list?c=winchester&v=2&since=${l.ver}`)).json();
  assert.ok(!l2.same && l2.ver !== l.ver && l2.chats.length === 1);
  const c2 = await (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${B}&since=${c.rev}`)).json();
  assert.deepEqual(texts(c2), ["Здравствуйте", "Ещё вопрос"]);
});

test("одна компания на D1 — у остальных защита от двойной доставки на месте: одно сообщение двумя доставками — один ответ бота", async () => {
  // прогон всех проверок с переписками в D1 нашёл: память «недавние сообщения» была привязана к объекту env.KV, а с обёрткой
  // переписок он новый на каждый запрос — две одновременные доставки снова давали два ответа (lib/kv-id.js)
  net.reset(); net.ai = ["Здравствуйте! Чем помочь?"];
  const env = { ...D1MODE, WA_VIA_BARBER: "wazzapo", WA_TOKEN_BARBER: "wz_live_test", APP_SECRET_BARBER: "hook-secret", PHONE_NUMBER_ID_BARBER: "103799815708451" };
  const s = mk(env), get = s.kv.api.get, put = s.kv.api.put, slow = ms => new Promise(r => setTimeout(r, ms));
  s.kv.api.get = async k => { await slow(5); return get(k); };
  s.kv.api.put = async (k, v, o) => { await slow(20); return put(k, v, o); };
  const wz = (dlv) => { const body = JSON.stringify({ event: "message.incoming", data: { channel: "whatsapp", phone_number_id: "103799815708451", contact: { phone: "77051113309" }, message: { id: "wamid.twice2", from: "77051113309", type: "text", text: "Здравствуйте" } } });
    return s.call("/wz/barber", { method: "POST", body, headers: { "content-type": "application/json", "x-wazzapo-delivery-id": dlv, "x-wazzapo-signature": "sha256=" + createHmac("sha256", "hook-secret").update(body).digest("hex") } }); };
  await Promise.all([wz("dlv-a"), wz("dlv-b")]);
  const sent = net.wz.filter(r => r.path === "/messages/send").map(r => r.body.text && r.body.text.body);
  assert.equal(sent.filter(t => /Чем помочь/.test(t || "")).length, 1, JSON.stringify(sent));
});

test("D1: человек ответил с телефона, пока бот думал, — бот свой ответ не отправляет (ответ человека — настоящим вебхуком в другой Worker)", { skip }, async () => {
  // та же проверка в KV (channels.test.mjs) подменяет копию чата прямо в KV; здесь ответ человека приходит вебхуком message.outgoing
  // во второй Worker, пока первый ждёт ИИ, — и думающий бот видит его в D1 перед записью своего ответа
  net.reset(); net.ai = ["Здравствуйте! Чем помочь?"];
  const kv = mkKV(), d = d1With("production");
  const env = { CHAT_STORE_BARBER: "d1", WA_VIA_BARBER: "wazzapo", WA_TOKEN_BARBER: "wz_live_test", APP_SECRET_BARBER: "hook-secret", PHONE_NUMBER_ID_BARBER: "103799815708451", KV: kv.api, DB: d.db };
  const s1 = mk(env), s2 = mk(env), from = "77051113402";
  let n = 0;
  const wz = (s, event, data) => { const body = JSON.stringify({ event, data: { channel: "whatsapp", phone_number_id: "103799815708451", ...data } });
    return s.call("/wz/barber", { method: "POST", body, headers: { "content-type": "application/json", "x-wazzapo-delivery-id": "dlv-ph-" + ++n, "x-wazzapo-signature": "sha256=" + createHmac("sha256", "hook-secret").update(body).digest("hex") } }); };
  const sends = () => net.wz.filter(r => r.path === "/messages/send");
  await wz(s1, "message.incoming", { contact: { phone: from }, message: { id: "wamid.p1", from, type: "text", text: "Здравствуйте" } });
  const before = sends().length;
  net.ai = [async () => {
    await wz(s2, "message.outgoing", { sender: { type: "user" }, contact: { phone: from }, message: { id: "wamid.phone9", to: from, type: "text", text: "Добрый день, это Тони, запишу вас сам" } });
    return "Могу записать вас на 15:00.";
  }];
  await wz(s1, "message.incoming", { contact: { phone: from }, message: { id: "wamid.p2", from, type: "text", text: "Хочу постричься сегодня" } });
  assert.equal(sends().length, before, "второго ответа поверх ответа человека нет");
  const msgs = d.raw.prepare("select data from chat_messages where ws = 'barber' and chat = ? order by t, id").all(from).map(r => JSON.parse(r.data));
  assert.ok(msgs.some(t => t.role === "user" && /постричься/.test(t.text)), "сообщение клиента в чате");
  assert.ok(msgs.some(t => t.by === "admin" && /Тони/.test(t.text)), "ответ человека в чате");
  assert.ok(!msgs.some(t => /15:00/.test(t.text)), "неотправленный ответ бота не записан: " + JSON.stringify(msgs.map(t => t.text)));
  const p = JSON.parse(d.raw.prepare("select profile from chat_threads where ws = 'barber' and chat = ?").get(from).profile);
  assert.ok(p.pausedUntil > Date.now(), "пауза осталась");
});

test("«Удалить данные клиента» убирает и его события из журнала: после восстановления базы удалённое не возвращается", { skip }, async () => {
  // находка автоматической проверки безопасности 01.11.2026: событие, ждущее записи (сбой D1), лежит в KV ibq: с номером и текстом до 3 дней —
  // удаление данных клиента его не трогало, а проигрыш вернул бы удалённое сообщение в D1
  const { d, W, P } = twoPlaces(D1MODE);
  const b = await login(P), other = "77000008804";
  await inbound(W, "Здравствуйте");
  d.ctl.fail = sql => /chat_(threads|messages)/.test(sql) && !/sqlite_master/.test(sql);
  await inbound(W, "Мой номер карты 4400 …", "IN-ERASE-1");
  await inbound(W, "Чужой чат, тоже ждёт", "IN-ERASE-2", other);
  assert.equal(await walPending(W.env, "winchester"), 2);
  d.ctl.fail = null;
  const er = await b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: B, act: "erase" });
  assert.equal(er.status, 200, await er.clone().text());
  assert.equal(await walPending(W.env, "winchester"), 1, "событие удалённого клиента убрано из журнала, чужое — осталось");
  const r = await walKick(chatEnv(W.env), "winchester", { force: true });
  assert.equal(r.done, 1);
  assert.equal(rows(d).length, 0, "удалённое не вернулось");
  assert.equal(rows(d, other).length, 1, "чужое записалось");
});
