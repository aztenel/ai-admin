// Пульт Winchester, финальная доработка (02.11.2026): «прочитано» — отдельно от «Ждёт ответа» и общее для сотрудников через D1;
// «Удалить у меня» (скрыть в пульте) и «Удалить у всех» (Green-API deleteMessage: только наше сообщение второго номера, не позже
// 59 часов, один раз на все устройства). Всё на заглушках: настоящий Green-API deleteMessage не проверен — запрос и ответ взяты
// из документации Green-API (200 с пустым телом; 400 «Message by id not found»).
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, gaPass } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { sendOnceReset } from "../../src/services/inbox/send.js";
import { mergeProfile3 } from "../../src/services/chatstore/merge.js";
import { DEL_ALL_MS, delAllWhy, delRid, findTurn, turnSel } from "../../src/services/inbox/remove.js";

const skip = sqliteOk ? false : "нужна D1 на node:sqlite (Node 22+)";
const INST = { id: "7105000099", token: "ga-tok-rd" };
const GA = { GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
const D1MODE = { CHAT_STORE_WINCHESTER: "d1" };
const env = (x = {}, stage = "production") => ({ ...GA, ...(sqliteOk ? { DB: d1With(stage).db } : {}), ...x });
const A = "77000009901", HK = `h:ga:winchester:${A}`;
let seq = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
const hook = (s, body) => s.call(`/ga/winchester?t=${gaPass("winchester", INST)}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ instanceData: { idInstance: +INST.id, wid: "77000000099@c.us" }, timestamp: Math.floor(Date.now() / 1000), ...body }) });
const inbound = (s, text, id = "IN-RD-" + ++seq, from = A) => s.gaText("winchester", INST, from, text, { idMessage: id });
const login = async s => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" }); return b; };
const chatOf = async (b, id = A, ch = "ga") => (await b.go(`/api/inbox/chat?c=winchester&ch=${ch}&id=${id}`)).json();
const list = async b => (await b.go("/api/inbox/list?c=winchester&ch=wa&v=2&f=all")).json();
const rowOf = async (b, id = A) => (await list(b)).chats.find(r => r.ch === "ga" && r.id === id);
const act = (b, a, x = {}, id = A, ch = "ga") => b.post("/api/inbox/act", { c: "winchester", ch, id, act: a, op: "Айгерим", ...x });
const send = async (b, text, rid, id = A) => (await b.post("/api/inbox/send", { c: "winchester", ch: "ga", id, text, rid, op: "Айгерим" })).json();
const turnOf = (c, mid) => (c.turns || []).find(t => t.mid === mid);
const dels = () => net.ga.filter(x => x.op === "deleteMessage");
const fresh = () => { net.reset(); sendOnceReset(); };

// ---------- прочитано и «Ждёт ответа» ----------
test("прочитано — только вперёд: более позднее прочитано другого сотрудника не откатывается", () => {
  assert.equal(mergeProfile3([{ rd: 50 }], { rd: 90 }, { rd: 100 }).rd, 100, "второй запрос с более ранним прочитанным не опускает отметку");
  assert.equal(mergeProfile3([{ rd: 50 }], { rd: 120 }, { rd: 100 }).rd, 120);
});

test("D1: открытие чата снимает «новое», но не «Ждёт ответа»; второй сотрудник видит то же", { skip }, async () => {
  fresh();
  const s = mk(env(D1MODE)), a = await login(s), b2 = await login(s);
  await inbound(s, "Здравствуйте! Можно записаться на завтра?");
  const l0 = await list(a);
  assert.equal(l0.reads, true, "пульт знает: прочитанное общее (переписки в D1)");
  let r = await rowOf(a);
  assert.ok(r.nd, "ждёт ответа"); assert.ok(r.li > 0); assert.ok(!(r.rd >= r.li), "ещё никто не открыл");
  const x = await act(a, "read", { at: r.li });
  assert.equal(x.status, 200);
  const xj = await x.json();
  assert.equal(xj.ok, true); assert.ok(xj.rd >= r.li, "сервер запомнил, до какого сообщения прочитано");
  r = await rowOf(b2);
  assert.ok(r.rd >= r.li, "второй сотрудник видит: прочитано");
  assert.ok(r.nd, "«Ждёт ответа» осталось: открыть — не значит ответить");
  assert.ok((await chatOf(b2)).need, "и в самом чате — ждёт ответа");
  // повтор с тем же временем — без записи (ревизия чата не растёт)
  const rev = (await chatOf(a)).rev;
  assert.equal((await (await act(a, "read", { at: r.li })).json()).ok, true);
  assert.equal((await chatOf(a)).rev, rev, "уже прочитанное второй раз не записывается");
});

test("D1: ответ снимает «Ждёт ответа» и отмечает прочитанным; новое входящее после ответа и после «Готово» — снова в очереди и новое", { skip }, async () => {
  fresh();
  const s = mk(env(D1MODE)), a = await login(s), b2 = await login(s);
  await inbound(s, "Есть время сегодня вечером?");
  await send(a, "Да, в 19:00 у Рауана. Записать?", "out-rd-1");
  let r = await rowOf(b2);
  assert.ok(!r.nd, "ответили — не ждёт"); assert.ok(r.rd >= r.li, "ответивший прочитал"); assert.equal(r.as, "Айгерим", "ведёт ответивший");
  await wait(5);
  await inbound(s, "Да, запишите меня, пожалуйста");
  r = await rowOf(b2);
  assert.ok(r.nd, "новое входящее после ответа — снова ждёт"); assert.ok(r.li > r.rd, "и снова новое");
  let res = await act(a, "resolve");
  assert.equal(res.status, 409, "«Готово» при неотвеченном — с вопросом");
  res = await act(a, "resolve", { force: true });
  assert.equal(res.status, 200);
  r = await rowOf(b2);
  assert.ok(!r.nd); assert.equal(r.dn, 1, "готово");
  await wait(5);
  await inbound(s, "А сколько стоит борода?");
  r = await rowOf(b2);
  assert.ok(r.nd, "после «Готово» новое входящее — снова в очереди"); assert.ok(!r.dn, "и уже не «Готово»"); assert.ok(r.li > (r.rd || 0));
});

test("D1: прочитано — не позже «сейчас» и не назад", { skip }, async () => {
  fresh();
  const s = mk(env(D1MODE)), a = await login(s);
  await inbound(s, "Добрый день");
  const li = (await rowOf(a)).li;
  await act(a, "read", { at: li });
  await act(a, "read", { at: li - 60e3 });
  assert.equal((await rowOf(a)).rd, li, "более раннее прочитанное отметку не опускает");
  const far = Date.now() + 365 * 86400e3, x = await (await act(a, "read", { at: far })).json();
  assert.ok(x.rd <= Date.now(), "время из будущего — не дальше «сейчас»");
});

test("KV: «прочитано» в переписку не пишется (копия по старому чтению затёрла бы соседнюю запись) — пульт помнит его на устройстве", { skip }, async () => {
  fresh();
  const s = mk(env());
  const a = await login(s);
  await inbound(s, "Здравствуйте");
  const n0 = s.hist("ga", "winchester", A).n;
  const l = await list(a);
  assert.ok(!l.reads, "общего прочитанного без D1 нет");
  const x = await (await act(a, "read", { at: Date.now() })).json();
  assert.equal(x.ok, true); assert.equal(x.local, true);
  assert.equal(s.hist("ga", "winchester", A).n, n0, "переписка не перезаписана");
  assert.equal(s.hist("ga", "winchester", A).profile.rd, undefined);
});

// ---------- удаление сообщений ----------
test("выбор реплики и причины «нельзя удалить у всех»", () => {
  const now = Date.now(), turns = [
    { role: "user", text: "Привет", t: now - 5000, mid: "IN-1" },
    { role: "model", by: "admin", text: "Здравствуйте", t: now - 4000, mid: "OUT-1", st: "read" },
    { role: "model", text: "Напоминание", t: now - 3000, rm: "d1" },
  ];
  assert.equal(findTurn(turns, { mid: "OUT-1" }), 1);
  assert.equal(findTurn(turns, { at: now - 3000, r: "b" }), 2);
  assert.equal(findTurn(turns, { at: now - 3000, r: "a" }), -1, "автор не совпал");
  assert.equal(findTurn(turns, { mid: "нет" }), -1);
  assert.deepEqual(turnSel({ mid: "X1", at: 5 }), { mid: "X1" });
  assert.deepEqual(turnSel({ at: "123", r: "u" }), { at: 123, r: "u" });
  assert.equal(turnSel({}), null);
  assert.equal(delAllWhy(turns[0], now), "inbound");
  assert.equal(delAllWhy(turns[1], now), "");
  assert.equal(delAllWhy(turns[2], now), "nomid");
  assert.equal(delAllWhy({ ...turns[1], st: "failed" }, now), "failed");
  assert.equal(delAllWhy({ ...turns[1], t: now - DEL_ALL_MS - 1000 }, now), "old");
  assert.equal(delAllWhy({ ...turns[1], del: 1 }, now), "deleted");
  assert.equal(delAllWhy(undefined, now), "nomsg");
  assert.match(delRid("BAE5F4886AD2B6F5"), /^del-BAE5F4886AD2B6F5$/);
  assert.match(delRid("!!"), /^del-x[0-9a-z]+$/);
});

test("D1: «Удалить у меня» — скрыто в пульте у всех сотрудников и после перезагрузки; к Green-API ничего не уходит; «Вернуть»", { skip }, async () => {
  fresh();
  const s = mk(env(D1MODE)), a = await login(s), b2 = await login(s);
  await inbound(s, "Ой, это не вам", "IN-HIDE-1");
  const n0 = net.ga.length;
  let res = await act(a, "hide", { mid: "IN-HIDE-1" });
  assert.equal(res.status, 200);
  let j = await res.json();
  assert.equal(turnOf(j.chat, "IN-HIDE-1").hid, 1);
  assert.equal(net.ga.length, n0, "к Green-API ничего не ушло: у клиента сообщение остаётся");
  assert.equal(turnOf(await chatOf(b2), "IN-HIDE-1").hid, 1, "второе устройство — тоже скрыто");
  assert.equal((await rowOf(b2)).s, "Скрыто в пульте", "в списке — без текста скрытого сообщения");
  assert.ok((await chatOf(b2)).audit.some(x => x.a === "hide"), "в журнале действий чата");
  res = await act(b2, "unhide", { mid: "IN-HIDE-1" });
  assert.equal(res.status, 200);
  assert.equal(turnOf(await chatOf(a), "IN-HIDE-1").hid, undefined, "вернули — видно снова");
  // сообщение без номера — по времени и автору
  const out = await send(a, "Сейчас уточню", "out-hide-2"), mine = out.chat.turns.at(-1);
  res = await act(a, "hide", { at: mine.t, r: "a" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).chat.turns.at(-1).hid, 1);
  res = await act(a, "hide", { mid: "нет-такого" });
  assert.equal(res.status, 404);
  res = await act(a, "hide", {});
  assert.equal(res.status, 400);
});

test("D1: «Удалить у всех» — наше сообщение: deleteMessage один раз, повтор и второй сотрудник второго запроса не дают", { skip }, async () => {
  fresh();
  const s = mk(env(D1MODE)), a = await login(s), b2 = await login(s);
  await inbound(s, "Есть время сегодня?");
  const out = await send(a, "Да, в 18:00 у Рауана", "out-del-1"), mid = out.chat.turns.at(-1).mid;
  assert.ok(mid, "у нашего сообщения — номер у Green-API");
  let res = await act(a, "delete", { mid });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(dels().length, 1);
  assert.deepEqual(dels()[0].body, { chatId: A + "@c.us", idMessage: mid });
  let t = turnOf(j.chat, mid);
  assert.equal(t.del, 1); assert.equal(t.dl, 1, "удалено у всех нами");
  res = await act(a, "delete", { mid });
  assert.equal(res.status, 200, "повтор — без ошибки");
  res = await act(b2, "delete", { mid });
  assert.equal(res.status, 200, "второй сотрудник — без ошибки");
  assert.equal(dels().length, 1, "второго запроса к Green-API нет");
  t = turnOf(await chatOf(b2), mid);
  assert.equal(t.del, 1); assert.equal(t.dl, 1, "второе устройство видит то же");
  assert.equal((await rowOf(b2)).s, "Сообщение удалено");
  assert.ok((await chatOf(b2)).audit.some(x => x.a === "delete"));
});

test("D1: одновременное «Удалить у всех» с двух устройств — к Green-API один запрос", { skip }, async () => {
  fresh();
  const s = mk(env(D1MODE)), a = await login(s), b2 = await login(s);
  await inbound(s, "Добрый вечер");
  const mid = (await send(a, "Здравствуйте! Чем помочь?", "out-del-par")).chat.turns.at(-1).mid;
  net.gaReply = rec => rec.op === "deleteMessage" ? new Promise(r => setTimeout(() => r(new Response("", { status: 200 })), 60)) : null;
  const [r1, r2] = await Promise.all([act(a, "delete", { mid }), act(b2, "delete", { mid })]);
  assert.equal(dels().length, 1, "один запрос");
  assert.ok([r1.status, r2.status].includes(200));
  for (const r of [r1, r2]) if (r.status !== 200) { assert.equal(r.status, 409); assert.equal((await r.json()).code, "busy"); }
  net.gaReply = null;
  assert.equal(turnOf(await chatOf(b2), mid).del, 1);
});

test("«Удалить у всех» нельзя: сообщение клиента, срок прошёл, не дошло, основной номер (Meta), тестовая версия", { skip }, async () => {
  fresh();
  const now = Date.now(), s = mk(env());
  const a = await login(s);
  await s.kv.api.put(HK, JSON.stringify({ n: 3, profile: { li: now - 1000 }, turns: [
    { role: "model", by: "admin", text: "Старое", t: now - DEL_ALL_MS - 3600e3, mid: "OUT-OLD", st: "read" },
    { role: "model", by: "admin", text: "Не дошло", t: now - 60e3, mid: "OUT-FAIL", st: "failed" },
    { role: "user", text: "Клиент", t: now - 1000, mid: "IN-X" },
  ] }));
  for (const [mid, code] of [["IN-X", "inbound"], ["OUT-OLD", "old"], ["OUT-FAIL", "failed"]]) {
    const res = await act(a, "delete", { mid });
    assert.equal(res.status, 409, mid);
    const j = await res.json();
    assert.equal(j.code, code, mid);
    assert.ok(j.error.length > 20, "понятная причина");
  }
  assert.equal(dels().length, 0, "к Green-API ничего");
  // основной номер (Meta)
  await s.kv.api.put("h:wa:winchester:" + A, JSON.stringify({ n: 1, profile: { li: now }, turns: [{ role: "model", by: "admin", text: "Ответ", t: now - 1000, mid: "wamid.X", st: "sent" }] }));
  const w = await act(a, "delete", { mid: "wamid.X" }, A, "wa");
  assert.equal(w.status, 409); assert.equal((await w.json()).code, "channel");
  // тестовая версия: удалить у клиента нельзя (наружу ничего не уходит)
  const p = mk(env({ STAGE: "preview" }, "preview")), pa = await login(p);
  await p.kv.api.put(HK, JSON.stringify({ n: 1, profile: { li: now }, turns: [{ role: "model", by: "admin", text: "Ответ", t: now - 1000, mid: "OUT-PV", st: "sent" }] }));
  const pv = await act(pa, "delete", { mid: "OUT-PV" });
  assert.equal(pv.status, 409); assert.equal((await pv.json()).code, "preview");
  assert.equal(dels().length, 0);
  // скрыть в пульте в тестовой версии можно: наружу это не уходит
  assert.equal((await act(pa, "hide", { mid: "OUT-PV" })).status, 200);
});

test("D1: Green-API не ответил (500) — «не знаем, удалилось ли», без повтора; потом вебхук «удалено» с телефона снимает сомнение", { skip }, async () => {
  fresh();
  const s = mk(env(D1MODE)), a = await login(s);
  await inbound(s, "Здравствуйте");
  const mid = (await send(a, "Добрый день!", "out-del-500")).chat.turns.at(-1).mid;
  net.gaReply = rec => rec.op === "deleteMessage" ? new Response(JSON.stringify({ message: "Internal Server Error" }), { status: 500, headers: { "content-type": "application/json" } }) : null;
  let res = await act(a, "delete", { mid });
  assert.equal(res.status, 200);
  let j = await res.json();
  assert.match(j.warn, /Не знаем, удалилось ли/);
  let t = turnOf(j.chat, mid);
  assert.equal(t.dlu, 1); assert.equal(t.del, undefined);
  res = await act(a, "delete", { mid });
  assert.equal(dels().length, 1, "сами не повторяем");
  assert.match((await res.json()).warn || "", /Не знаем, удалилось ли/);
  net.gaReply = null;
  await hook(s, { typeWebhook: "outgoingMessageReceived", idMessage: "PH-DEL-1", senderData: { chatId: A + "@c.us", sender: "77000000099@c.us" },
    messageData: { typeMessage: "deletedMessage", deletedMessageData: { stanzaId: mid } } });
  t = turnOf(await chatOf(a), mid);
  assert.equal(t.del, 1, "WhatsApp сообщил: удалено"); assert.equal(t.dlu, undefined);
  assert.equal((await chatOf(a)).turns.length, 2, "удаление — не новое сообщение");
});

test("D1: Green-API «сообщение не найдено» — отказ без отметки; потом можно ещё раз", { skip }, async () => {
  fresh();
  const s = mk(env(D1MODE)), a = await login(s);
  await inbound(s, "Здравствуйте");
  const mid = (await send(a, "Здравствуйте!", "out-del-404")).chat.turns.at(-1).mid;
  net.gaReply = rec => rec.op === "deleteMessage" ? new Response(JSON.stringify({ message: "Message by id not found" }), { status: 400, headers: { "content-type": "application/json" } }) : null;
  let res = await act(a, "delete", { mid });
  assert.equal(res.status, 409);
  const j = await res.json();
  assert.equal(j.code, "gone"); assert.match(j.error, /не нашёл/);
  assert.equal(turnOf(await chatOf(a), mid).del, undefined, "не отмечено удалённым");
  net.gaReply = null;
  res = await act(a, "delete", { mid });
  assert.equal(res.status, 200, "отказ Green-API — можно ещё раз");
  assert.equal(dels().length, 2);
  assert.equal(turnOf(await chatOf(a), mid).del, 1);
});

test("D1: с телефона удалили наше сообщение у всех — в пульте «удалено», очередь не меняется", { skip }, async () => {
  fresh();
  const s = mk(env(D1MODE)), a = await login(s);
  await inbound(s, "Можно на 15:00?");
  const mid = (await send(a, "Да, можно", "out-del-ph")).chat.turns.at(-1).mid;
  await wait(5);
  await inbound(s, "А в 16:00?");
  await hook(s, { typeWebhook: "outgoingMessageReceived", idMessage: "PH-DEL-2", senderData: { chatId: A + "@c.us", sender: "77000000099@c.us" },
    messageData: { typeMessage: "deletedMessage", deletedMessageData: { stanzaId: mid } } });
  const c = await chatOf(a);
  assert.equal(turnOf(c, mid).del, 1);
  assert.ok(c.need, "вопрос клиента по-прежнему ждёт ответа");
});

test("D1: после скрытия и удаления «стоп» на месте, «Удалить данные клиента» удаляет чат", { skip }, async () => {
  fresh();
  const s = mk(env(D1MODE)), a = await login(s);
  await inbound(s, "Здравствуйте");
  const mid = (await send(a, "Добрый день!", "out-del-er")).chat.turns.at(-1).mid;
  await inbound(s, "стоп", "IN-STOP-1"); // бот второго номера выключен: «стоп» ложится в список отказов (optout:), не в чат
  const stopKey = `optout:winchester:${A}`;
  assert.ok(await s.kv.api.get(stopKey), "«стоп» записан");
  assert.equal((await act(a, "hide", { mid: "IN-STOP-1" })).status, 200);
  assert.equal((await act(a, "delete", { mid })).status, 200);
  assert.ok(await s.kv.api.get(stopKey), "скрытие и удаление сообщений «стоп» не снимают");
  const er = await act(a, "erase");
  assert.equal(er.status, 200);
  assert.equal((await er.json()).erased, true);
  assert.equal((await b2Chat(s)).status, 404, "чат удалён");
  assert.ok(await s.kv.api.get(stopKey), "после удаления данных «стоп» остаётся (как в /privacy)");
});
const b2Chat = async s => { const b = await login(s); return b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${A}`); };
