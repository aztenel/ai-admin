// ТЗ Winchester v2.0 (31.10.2026), P0: очередь «Нужен ответ», ответ сотрудника с его именем, галочки по вебхукам Green-API, «Готово»
// с подтверждением, назначение, правка/удаление/реакция, номер канала. Второй номер Winchester — Green-API, бот выключен.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, gaPass } from "../harness.mjs";

const INST = { id: "7105000077", token: "ga-tok-w" };
const ENV = { GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
const login = async s => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" }); return b; };
let n = 0;
/** любой вебхук Green-API на номер Winchester */
const hook = (s, body) => s.call(`/ga/winchester?t=${gaPass("winchester", INST)}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ instanceData: { idInstance: +INST.id, wid: "77000000077@c.us" }, timestamp: Math.floor(Date.now() / 1000), ...body }) });
const fromPhone = (s, to, text) => hook(s, { typeWebhook: "outgoingMessageReceived", idMessage: "OUT-" + (++n), senderData: { chatId: to + "@c.us", sender: "77000000077@c.us" }, messageData: { typeMessage: "textMessage", textMessageData: { textMessage: text } } });
const status = (s, to, id, st, desc) => hook(s, { typeWebhook: "outgoingMessageStatus", chatId: to + "@c.us", idMessage: id, status: st, sendByApi: true, ...(desc ? { description: desc } : {}) });
const list = async b => (await (await b.go("/api/inbox/list?c=winchester&v=2")).json());
const chat = async (b, id) => (await (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${id}`)).json());

test("исходящее без ответа клиента — не в очереди и не в списке чатов; ответ клиента — в очереди с темой", async () => {
  net.reset();
  const s = mk(ENV), b = await login(s);
  await fromPhone(s, "77000000301", "Добрый день! Приглашаем на стрижку");
  await s.settle();
  let L = await list(b);
  assert.equal(L.chats.length, 0, "только наше сообщение — не переписка");
  assert.equal(L.outOnly, 1);
  assert.equal(L.lines.ga.label, "Второй номер");
  await s.gaText("winchester", INST, "77000000301", "Здравствуйте, а на завтра в 15:00 можно?");
  L = await list(b);
  assert.equal(L.chats.length, 1); assert.equal(L.outOnly, 0);
  const r = L.chats[0];
  assert.equal(r.nd, "off"); assert.equal(r.tp, "book");
  assert.equal(L.need, 1);
});

test("«спасибо» после нашего ответа не ставит в очередь; ответ сотрудника — с именем, номером сообщения и галочкой", async () => {
  net.reset();
  const s = mk(ENV), b = await login(s), from = "77000000302";
  await s.gaText("winchester", INST, from, "Можно перенести запись на пятницу?");
  let c = await chat(b, from);
  assert.equal(c.need.tp, "move");
  const r = await (await b.post("/api/inbox/send", { c: "winchester", ch: "ga", id: from, text: "Да, перенесли на пятницу 15:00", op: "Айгерим" })).json();
  assert.equal(r.ok, true);
  assert.equal(r.chat.need, null); assert.equal(r.chat.assignee, "Айгерим", "ответил — ведёт чат");
  const mine = r.chat.turns.at(-1);
  assert.equal(mine.op, "Айгерим"); assert.equal(mine.st, "sent");
  const mid = net.ga.filter(x => x.op === "sendMessage").length ? s.hist("ga", "winchester", from).turns.at(-1).mid : "";
  assert.ok(mid, "номер сообщения Green-API сохранён");
  await s.gaText("winchester", INST, from, "Спасибо!");
  c = await chat(b, from);
  assert.equal(c.need, null, "благодарность — не повод");
  // галочки: доставлено → прочитано; поздний «sent» и повтор не понижают
  for (const st of ["delivered", "read", "sent", "read"]) await status(s, from, mid, st);
  await s.settle();
  assert.equal(s.hist("ga", "winchester", from).turns.find(t => t.mid === mid).st, "read");
  assert.equal((await list(b)).chats[0].ls, undefined, "последнее сообщение — клиента, галочки в списке нет");
  await status(s, from, mid, "failed", "Error: Timed Out");
  await s.settle();
  assert.equal(s.hist("ga", "winchester", from).turns.find(t => t.mid === mid).st, "read", "прочитанное не становится ошибкой");
});

test("ошибка отправки — без галочек, с причиной; ответ с телефона снимает очередь и тоже получает статус", async () => {
  net.reset();
  const s = mk(ENV), b = await login(s), from = "77000000303";
  await s.gaText("winchester", INST, from, "Есть свободное время сегодня?");
  await fromPhone(s, from, "Да, в 18:00 у Тони");
  await s.settle();
  const t = s.hist("ga", "winchester", from).turns.at(-1);
  assert.equal(t.by, "admin"); assert.equal(t.st, "sent"); assert.ok(t.mid);
  assert.equal((await chat(b, from)).need, null, "человек ответил с телефона");
  await status(s, from, t.mid, "noAccount");
  await s.settle();
  const u = s.hist("ga", "winchester", from).turns.at(-1);
  assert.equal(u.st, "failed"); assert.equal(u.se, "noAccount");
});

test("«Готово» при неотвеченном вопросе — только с подтверждением; назначение, «Взять себе», журнал действий", async () => {
  net.reset();
  const s = mk(ENV), b = await login(s), from = "77000000304";
  await s.gaText("winchester", INST, from, "Во сколько я записан?");
  let r = await b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "resolve" });
  assert.equal(r.status, 409); assert.match((await r.json()).confirm, /ждёт ответа/);
  r = await b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "take" });
  assert.equal(r.status, 400, "без имени на устройстве взять себе нельзя");
  r = await (await b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "take", op: "Ержан" })).json();
  assert.equal(r.chat.assignee, "Ержан");
  r = await (await b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "assign", to: "Айгерим", op: "Ержан" })).json();
  assert.equal(r.chat.assignee, "Айгерим");
  r = await (await b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "resolve", force: true, op: "Айгерим" })).json();
  assert.equal(r.chat.need, null); assert.ok(r.chat.done);
  assert.deepEqual(r.chat.audit.map(x => x.a), ["take", "assign", "close-unanswered"]);
  assert.equal(r.chat.audit.at(-1).w, "Айгерим");
  const L = await list(b);
  assert.equal(L.chats[0].dn, 1); assert.equal(L.chats[0].as, "Айгерим");
  assert.ok(L.ops.includes("Ержан") && L.ops.includes("Айгерим"), "имена — для списка «Назначить»");
  await s.gaText("winchester", INST, from, "Ау?");
  assert.equal((await list(b)).chats[0].dn, undefined, "клиент написал снова — чат снова открыт");
});

test("клиент исправил, удалил сообщение, поставил реакцию — меняется та же реплика, очередь не трогается", async () => {
  net.reset();
  const s = mk(ENV), b = await login(s), from = "77000000305";
  await s.gaText("winchester", INST, from, "Запишите на 14:00", { idMessage: "IN-EDIT-1" });
  await hook(s, { typeWebhook: "incomingMessageReceived", idMessage: "IN-EDIT-2", senderData: { chatId: from + "@c.us", sender: from + "@c.us" }, messageData: { typeMessage: "editedMessage", editedMessageData: { textMessage: "Запишите на 15:00", stanzaId: "IN-EDIT-1" } } });
  await s.settle();
  let h = s.hist("ga", "winchester", from);
  assert.equal(h.turns.filter(t => t.role === "user").length, 1, "правка — не новое сообщение");
  assert.equal(h.turns[0].text, "Запишите на 15:00"); assert.equal(h.turns[0].ed, 1);
  const r = await (await b.post("/api/inbox/send", { c: "winchester", ch: "ga", id: from, text: "Записали на 15:00" })).json();
  const mid = s.hist("ga", "winchester", from).turns.at(-1).mid;
  await hook(s, { typeWebhook: "incomingMessageReceived", idMessage: "IN-R-1", senderData: { chatId: from + "@c.us" }, messageData: { typeMessage: "reactionMessage", extendedTextMessageData: { text: "👍" }, quotedMessage: { stanzaId: mid } } });
  await hook(s, { typeWebhook: "incomingMessageReceived", idMessage: "IN-D-1", senderData: { chatId: from + "@c.us" }, messageData: { typeMessage: "deletedMessage", deletedMessageData: { stanzaId: "IN-EDIT-1" } } });
  await s.settle();
  h = s.hist("ga", "winchester", from);
  assert.equal(h.turns.at(-1).re, "👍"); assert.equal(h.turns[0].del, 1);
  const c = await chat(b, from);
  assert.equal(c.need, null, "реакция и удаление не поднимают очередь");
  assert.equal(c.turns[0].del, 1); assert.equal(c.turns.at(-1).re, "👍");
  assert.ok(r.ok);
});

test("ответ на напоминание: «спасибо» — не повод, просьба перенести — в очереди с пометкой «ответ на напоминание»; в Telegram нет ссылки на файл", async () => {
  net.reset();
  const s = mk(ENV), b = await login(s), from = "77000000306";
  await s.kv.api.put(`h:ga:winchester:${from}`, JSON.stringify({ n: 1, turns: [{ role: "model", text: "Напоминаем: завтра в 15:00 у Тони", t: Date.now() - 3600e3, rm: "d1", mid: "RM-1", st: "delivered" }], profile: {} }));
  await s.gaText("winchester", INST, from, "Спасибо!");
  assert.equal((await chat(b, from)).need, null);
  await s.gaText("winchester", INST, from, "А можно перенести на 17:00?");
  const c = await chat(b, from);
  assert.equal(c.need.tp, "move"); assert.equal(c.need.src.k, "rm"); assert.match(c.need.src.text, /Напоминаем/);
  assert.equal(c.turns[0].auto, "service"); assert.equal(c.turns[0].st, "delivered");
  await hook(s, { typeWebhook: "incomingMessageReceived", idMessage: "IN-IMG-1", senderData: { chatId: from + "@c.us", senderName: "К" }, messageData: { typeMessage: "imageMessage", fileMessageData: { downloadUrl: "https://sw-media.storage.greenapi.net/secret/abc.jpg", mimeType: "image/jpeg", caption: "" } } });
  await s.settle();
  assert.ok(!net.tg.some(m => /greenapi\.net|https?:\/\//.test(m.text || JSON.stringify(m))), "закрытая ссылка на файл не уходит в Telegram");
  const img = s.hist("ga", "winchester", from).turns.at(-1);
  assert.equal(img.mid, "IN-IMG-1"); assert.equal(img.m.id, "IN-IMG-1");
});

test("файл из чата: только этой переписки, новая ссылка у Green-API, Range для iPhone, опасный тип — только скачать", async () => {
  net.reset();
  const s = mk(ENV), b = await login(s), from = "77000000307";
  const voice = new Uint8Array(4000).fill(7);
  net.img = []; // адрес → ответ (заглушка картинок/файлов в harness)
  await hook(s, { typeWebhook: "incomingMessageReceived", idMessage: "IN-V-1", senderData: { chatId: from + "@c.us" }, messageData: { typeMessage: "audioMessage", fileMessageData: { downloadUrl: "https://media.green-api.test/old/voice.ogg", mimeType: "audio/ogg; codecs=opus" } } });
  await hook(s, { typeWebhook: "incomingMessageReceived", idMessage: "IN-DOC-1", senderData: { chatId: from + "@c.us" }, messageData: { typeMessage: "documentMessage", fileMessageData: { downloadUrl: "https://media.green-api.test/doc/page.html", mimeType: "text/html", fileName: "прайс.html" } } });
  await s.settle();
  // старая ссылка устарела (403), новая — через downloadFile; файл поддерживает Range
  net.mediaReply = (url, init) => {
    if (url.includes("/old/")) return new Response("expired", { status: 403 });
    const range = init && init.headers && init.headers.range;
    if (url.includes("/fresh/")) return range ? new Response(voice.slice(0, 100), { status: 206, headers: { "content-type": "audio/ogg", "content-range": "bytes 0-99/4000", "content-length": "100" } }) : new Response(voice, { headers: { "content-type": "audio/ogg", "content-length": "4000" } });
    if (url.includes("/doc/")) return new Response("<script>alert(1)</script>", { headers: { "content-type": "text/html" } });
    return null;
  };
  net.gaReply = rec => rec.op === "downloadFile" ? new Response(JSON.stringify({ downloadUrl: "https://media.green-api.test/fresh/voice.ogg" }), { headers: { "content-type": "application/json" } }) : null;
  let r = await b.go(`/api/inbox/media?c=winchester&ch=ga&id=${from}&mid=IN-V-1`, { headers: { range: "bytes=0-99" } });
  assert.equal(r.status, 206); assert.equal(r.headers.get("content-range"), "bytes 0-99/4000"); assert.equal(r.headers.get("content-type"), "audio/ogg");
  assert.ok(net.ga.some(x => x.op === "downloadFile" && x.body.idMessage === "IN-V-1"));
  r = await b.go(`/api/inbox/media?c=winchester&ch=ga&id=${from}&mid=IN-DOC-1`);
  assert.equal(r.headers.get("content-type"), "application/octet-stream"); assert.match(r.headers.get("content-disposition"), /^attachment/);
  assert.match(r.headers.get("content-security-policy"), /sandbox/);
  // файла у WhatsApp уже нет — понятная ошибка, сообщение в чате остаётся
  net.gaReply = rec => rec.op === "downloadFile" ? new Response(JSON.stringify({ message: "file not found" }), { status: 500, headers: { "content-type": "application/json" } }) : null;
  net.mediaReply = url => url.includes("/old/") ? new Response("x", { status: 403 }) : null;
  r = await b.go(`/api/inbox/media?c=winchester&ch=ga&id=${from}&mid=IN-V-1`);
  assert.equal(r.status, 404); assert.match((await r.json()).error, /недоступен/);
  assert.ok(s.hist("ga", "winchester", from).turns.some(t => t.mid === "IN-V-1"));
  // чужой файл (не из этой переписки) — нет
  r = await b.go(`/api/inbox/media?c=winchester&ch=ga&id=${from}&mid=IN-X`);
  assert.equal(r.status, 404);
  const anon = s.browser();
  assert.equal((await anon.go(`/api/inbox/media?c=winchester&ch=ga&id=${from}&mid=IN-V-1`)).status, 401);
});

test("карточка ближайшей записи Altegio: только чтение журнала, по номеру клиента, раз в 3 минуты на локацию", async () => {
  net.reset();
  const { bookingCardReset } = await import("../../src/services/inbox/booking-card.js");
  bookingCardReset();
  const s = mk({ ...ENV, ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok" }), b = await login(s), from = "77000000308";
  const day = n => new Date(Date.now() + n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
  net.altJournal = [
    { id: 501, datetime: `${day(1)}T15:00:00+05:00`, deleted: false, attendance: 0, confirmed: 1, online: true, seance_length: 3600, staff: { id: 1, name: "Тони" }, client: { id: 9, phone: "+" + from, name: "Клиент" }, services: [{ id: 1, title: "Мужская стрижка" }] },
    { id: 502, datetime: `${day(3)}T12:00:00+05:00`, deleted: false, attendance: 0, comment: "Запись с сайта winchester.kz", staff: { id: 2, name: "Рауан" }, client: { id: 9, phone: "+" + from, name: "Клиент" }, services: [{ id: 2, title: "Борода" }] },
    { id: 503, datetime: `${day(2)}T12:00:00+05:00`, deleted: true, staff: { id: 2, name: "Рауан" }, client: { id: 9, phone: "+" + from, name: "Клиент" }, services: [] },
    { id: 504, datetime: `${day(1)}T11:00:00+05:00`, deleted: false, staff: { id: 2, name: "Рауан" }, client: { id: 10, phone: "+77000000999", name: "Другой" }, services: [] },
  ];
  await s.gaText("winchester", INST, from, "Во сколько я записан?");
  const r = await (await b.go(`/api/inbox/booking?c=winchester&ch=ga&id=${from}`)).json();
  assert.equal(r.available, true);
  assert.deepEqual(r.records.map(x => [x.id, x.staff, x.state, x.source]), [["501", "Тони", "подтверждена", "онлайн-запись"], ["502", "Рауан", "ожидается", "сайт"]]);
  assert.equal(r.records[0].time, "15:00"); assert.equal(r.records[0].minutes, 60);
  const reads = net.alt.length;
  await b.go(`/api/inbox/booking?c=winchester&ch=ga&id=${from}`);
  assert.equal(net.alt.length, reads, "второй раз — из памяти");
  assert.ok(net.alt.every(x => x.startsWith("GET ")), "только чтение Altegio");
  const noKey = mk(ENV), b2 = await login(noKey);
  await noKey.gaText("winchester", INST, from, "Привет");
  assert.equal((await (await b2.go(`/api/inbox/booking?c=winchester&ch=ga&id=${from}`)).json()).available, false);
});

test("задача по чату — в очереди «Нужен ответ» до «Готово»; отметка «опаздывает» — в журнале чата", async () => {
  net.reset();
  const s = mk(ENV), b = await login(s), from = "77000000309";
  await s.gaText("winchester", INST, from, "Буду минут на 10 позже");
  await b.post("/api/inbox/send", { c: "winchester", ch: "ga", id: from, text: "Хорошо, ждём", op: "Айгерим" });
  let r = await (await b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "late", min: 10, op: "Айгерим" })).json();
  assert.equal(r.chat.late.min, 10); assert.equal(r.chat.audit.at(-1).a, "late");
  assert.equal((await b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "task", text: "" })).status, 400);
  r = await (await b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "task", text: "Предупредить мастера Тони", op: "Айгерим" })).json();
  assert.equal(r.chat.need.why, "task"); assert.equal(r.chat.need.text, "Предупредить мастера Тони");
  assert.equal((await list(b)).chats.find(x => x.id === from).nd, "task");
  r = await (await b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "resolve", force: true, op: "Айгерим" })).json();
  assert.equal(r.chat.need, null);
  const nowa = await (await b.go("/api/inbox/times?c=winchester")).json();
  assert.equal(nowa.available, false, "без ключа Altegio — «свободное время недоступно», а не ошибка");
});
