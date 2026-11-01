// Приёмка второго номера Winchester (Green-API) на настоящем коде и заглушках — сценарии Г1–Г13 из
// docs/runbooks/winchester-acceptance.md. Окружение — как на боевом сайте после запуска (docs/runbooks/winchester-go-live.md): своя
// база D1 с отметкой production, без STAGE, бот на втором номере выключен (gaOff), рассылки с него запрещены (gaNoBroadcast).
// Пульт /app/ и старый /inbox (и программа для Windows) ходят в один и тот же API — здесь проверяется он; кнопки обоих пультов —
// apps/pult/scripts/e2e-send-rid.mjs и e2e-inbox.mjs. Номера вымышленные (+7 700 000 xx xx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, gaPass } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { optedOut } from "../../src/db/kv/reminders.js";

const skip = sqliteOk ? false : "нужна D1 на node:sqlite (Node 22+)";
const INST = { id: "7105000055", token: "ga-tok-accept" };
const GA_W = { GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const sends = () => net.ga.filter(x => x.op === "sendMessage");
const uploads = () => net.ga.filter(x => x.op === "sendFileByUpload");
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
let seq = 0;
const login = async s => {
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" });
  return b;
};
/** вебхук Green-API на адрес Winchester с паролем (как настраивает «Настроить Green-API») */
const hook = (s, body, t = gaPass("winchester", INST)) => s.call(`/ga/winchester?t=${t}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ instanceData: { idInstance: +INST.id, wid: "77000000055@c.us" }, timestamp: Math.floor(Date.now() / 1000), ...body }) });
const status = (s, to, id, st, desc) => hook(s, { typeWebhook: "outgoingMessageStatus", chatId: to + "@c.us", idMessage: id, status: st, sendByApi: true, ...(desc ? { description: desc } : {}) });
const chat = async (b, id) => (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${id}`)).json();
const send = (b, id, text, rid, extra = {}) => b.post("/api/inbox/send", { c: "winchester", ch: "ga", id, text, rid, ...extra });
/** сайт Winchester после запуска: своя база production, чат второго номера с первым сообщением клиента */
async function site(first = "Здравствуйте! Можно записаться на завтра?") {
  net.reset();
  const d = d1With("production"), s = mk({ ...GA_W, DB: d.db }), b = await login(s), from = "7700000" + String(5100 + ++seq);
  if (first) await s.gaText("winchester", INST, from, first, { idMessage: "IN-" + from });
  return { d, s, b, from };
}

test("Г1 номер на связи и вебхук — полный адрес этого сайта с паролем; чужой пароль не принимается", { skip }, async () => {
  const { s, b, from } = await site(null);
  net.gaSettings[INST.id] = { webhookUrl: `https://bot.test/ga/winchester?t=${gaPass("winchester", INST)}`, incomingWebhook: "yes" };
  const st = await (await b.go("/api/launch/status?c=winchester")).json();
  const by = re => (st.checks || []).find(x => re.test(x.title || ""));
  assert.equal(by(/^WhatsApp \(Green-API\)/).ok, true, JSON.stringify(st.checks));
  assert.match(by(/вебхук/i).text, /настроен на bot\.test/);
  assert.equal(by(/вебхук/i).ok, true);
  const bad = await hook(s, { typeWebhook: "incomingMessageReceived", idMessage: "IN-BAD", senderData: { chatId: from + "@c.us" }, messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "чужой" } } }, "wrong-password");
  assert.ok([401, 403].includes(bad.status), String(bad.status));
  assert.equal(s.hist("ga", "winchester", from), null, "сообщение с чужим паролем не сохраняется");
});

test("Г2 входящий текст — чат второго номера в пульте, «нужен ответ», бот молчит", { skip }, async () => {
  const { s, b, from } = await site();
  const list = await (await b.go("/api/inbox/list?c=winchester&v=2")).json();
  const row = (list.chats || []).find(x => x.ch === "ga" && x.id === from);
  assert.ok(row, JSON.stringify(list.chats));
  const c = await chat(b, from);
  assert.equal(c.line.label, "Второй номер");
  assert.ok(c.need, "чат ждёт ответа администратора");
  assert.equal(c.canSend, true, String(c.sendOff || ""));
  assert.equal(sends().length, 0, "бот на втором номере не отвечает");
  void s;
});

test("Г3 ответ из пульта уходит один раз; отчёты Green-API sent → delivered → read; «не доставлено» — с причиной", { skip }, async () => {
  const { s, b, from } = await site();
  assert.equal((await send(b, from, "Да, есть время в 15:00", "acc-rid-0003")).status, 200);
  assert.equal(sends().length, 1);
  assert.equal(sends()[0].body.chatId, from + "@c.us");
  const t = () => s.hist("ga", "winchester", from).turns.find(x => x.text === "Да, есть время в 15:00");
  const mid = t().mid;
  assert.ok(mid, "у ответа номер сообщения Green-API");
  for (const st of ["sent", "delivered", "read"]) { await status(s, from, mid, st); assert.equal(t().st, st); }
  assert.equal((await chat(b, from)).need, null, "ответили — чат больше не ждёт");
  assert.equal((await send(b, from, "Адрес: Кабанбай Батыра 18", "acc-rid-0003b")).status, 200);
  const mid2 = s.hist("ga", "winchester", from).turns.at(-1).mid;
  await status(s, from, mid2, "failed", "Error: Timed Out");
  const u = s.hist("ga", "winchester", from).turns.at(-1);
  assert.equal(u.st, "failed"); assert.ok(u.se);
});

test("Г4 повторное нажатие «Отправить» (тот же номер отправки, в том числе одновременно) — одно сообщение", { skip }, async () => {
  const { b, from } = await site();
  const [r1, r2] = await Promise.all([send(b, from, "Ждём вас", "acc-rid-0004"), send(b, from, "Ждём вас", "acc-rid-0004")]);
  assert.ok([r1.status, r2.status].every(x => x === 200 || x === 409), `${r1.status} ${r2.status}`);
  assert.equal((await send(b, from, "Ждём вас", "acc-rid-0004")).status, 200);
  assert.equal(sends().length, 1, "клиенту ушло " + sends().length);
});

test("Г5 Green-API принял сообщение, но ответ потерян (обрыв, 5xx) — «не знаем, ушло ли», повтор не отправляет", { skip }, async () => {
  for (const reply of [() => { throw new Error("socket hang up"); }, () => J({ message: "Internal Server Error" }, 500)]) {
    const { s, b, from } = await site();
    net.gaReply = rec => rec.op === "sendMessage" ? reply() : null;
    const r = await send(b, from, "Записали вас на 15:00", "acc-rid-0005");
    assert.equal(r.status, 200);
    assert.match(String((await r.json()).warn || ""), /Не знаем, ушло ли/);
    net.gaReply = null;
    assert.equal((await send(b, from, "Записали вас на 15:00", "acc-rid-0005")).status, 200);
    assert.equal(sends().length, 1, "второй раз не отправлено");
    assert.equal(s.hist("ga", "winchester", from).turns.at(-1).st, "unknown");
  }
});

test("Г6 фото и документ от клиента — в переписке; файл открывается из пульта (сервер берёт его сам, ссылок наружу нет)", { skip }, async () => {
  const { s, b, from } = await site();
  net.mediaReply = url => url.includes("/acc/photo.jpg") ? new Response(PNG, { headers: { "content-type": "image/jpeg" } })
    : url.includes("/acc/price.pdf") ? new Response("%PDF-1.4 test", { headers: { "content-type": "application/pdf" } }) : null;
  await hook(s, { typeWebhook: "incomingMessageReceived", idMessage: "IN-IMG-" + from, senderData: { chatId: from + "@c.us" }, messageData: { typeMessage: "imageMessage", fileMessageData: { downloadUrl: "https://media.green-api.test/acc/photo.jpg", mimeType: "image/jpeg", caption: "Вот такую стрижку" } } });
  await hook(s, { typeWebhook: "incomingMessageReceived", idMessage: "IN-DOC-" + from, senderData: { chatId: from + "@c.us" }, messageData: { typeMessage: "documentMessage", fileMessageData: { downloadUrl: "https://media.green-api.test/acc/price.pdf", mimeType: "application/pdf", fileName: "Прайс.pdf" } } });
  const turns = s.hist("ga", "winchester", from).turns;
  assert.ok(turns.some(t => t.mid === "IN-IMG-" + from && t.m), "фото в переписке");
  assert.ok(turns.some(t => t.mid === "IN-DOC-" + from && t.m), "документ в переписке");
  const img = await b.go(`/api/inbox/media?c=winchester&ch=ga&id=${from}&mid=IN-IMG-${from}`);
  assert.equal(img.status, 200); assert.match(img.headers.get("content-type") || "", /image\//);
  const doc = await b.go(`/api/inbox/media?c=winchester&ch=ga&id=${from}&mid=IN-DOC-${from}`);
  assert.equal(doc.status, 200); assert.match(doc.headers.get("content-type") || "", /pdf/);
  assert.ok(!net.tg.some(m => /green-api\.test/.test(JSON.stringify(m))), "ссылка на файл не уходит в Telegram");
});

test("Г7 файл из пульта уходит один раз; повтор с тем же номером отправки — без второй загрузки", { skip }, async () => {
  const { s, b, from } = await site();
  const fileSend = () => { const fd = new FormData(); fd.set("file", new Blob([PNG], { type: "image/png" }), "схема.png"); fd.set("caption", "Схема проезда"); fd.set("rid", "acc-file-0007"); return b.go(`/api/inbox/send-file?c=winchester&ch=ga&id=${from}`, { method: "POST", body: fd }); };
  assert.equal((await fileSend()).status, 200);
  assert.equal((await fileSend()).status, 200);
  assert.equal(uploads().length, 1);
  assert.ok(s.hist("ga", "winchester", from).turns.some(t => t.m && t.m.name), "файл в переписке");
});

test("Г8 ответ цитатой — Green-API получает номер цитируемого сообщения; чужое сообщение процитировать нельзя", { skip }, async () => {
  const { s, b, from } = await site("Во сколько я записан?");
  const qmid = s.hist("ga", "winchester", from).turns.find(t => t.text === "Во сколько я записан?").mid;
  assert.equal((await send(b, from, "Завтра в 15:00 у Тони", "acc-rid-0008", { quote: qmid })).status, 200);
  assert.equal(sends()[0].body.quotedMessageId, qmid);
  const r = await send(b, from, "Ещё раз", "acc-rid-0008b", { quote: "NOT-IN-THIS-CHAT" });
  assert.notEqual(r.status, 200, "цитата чужого сообщения не отправляется");
  assert.equal(sends().length, 1);
});

test("Г9 ответ администратора с телефона второго номера — в переписке как ответ человека, чат больше не ждёт", { skip }, async () => {
  const { s, b, from } = await site();
  await hook(s, { typeWebhook: "outgoingMessageReceived", idMessage: "OUT-PH-" + from, senderData: { chatId: from + "@c.us", sender: "77000000055@c.us" }, messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "Да, ждём завтра в 15:00" } } });
  const t = s.hist("ga", "winchester", from).turns.at(-1);
  assert.equal(t.text, "Да, ждём завтра в 15:00"); assert.equal(t.by, "admin");
  assert.equal((await chat(b, from)).need, null);
  assert.equal(sends().length, 0, "бот не дописал своего");
});

test("Г10 «Отправить клиенту и закрыть»: одно сообщение, заявка выполнена, повтор не дублирует", { skip }, async () => {
  const { s, b, from } = await site("Перенесите меня на 16:00, пожалуйста");
  // номер заявки — как у настоящих: время в base36 и 4 знака (по нему считается срок хранения заявки, leadTs)
  const lid = Date.now().toString(36) + "acc1";
  await s.env.KV.put("leads:winchester", JSON.stringify([{ id: lid, kind: "change", name: "Клиент", phone: "", service: "Мужская стрижка", time: "завтра 16:00", at: new Date().toISOString() }]));
  const done = () => b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "done", lead: lid, text: "Перенесли на 16:00, ждём вас", rid: "dn-" + lid + "-acc1" });
  for (let i = 0; i < 2; i++) { const r = await done(); assert.equal(r.status, 200, await r.text()); }
  assert.equal(sends().length, 1);
  const lead = JSON.parse(await s.env.KV.get("leads:winchester"))[0];
  assert.equal(lead.status, "выполнена");
  assert.equal(s.hist("ga", "winchester", from).turns.filter(t => t.text === "Перенесли на 16:00, ждём вас").length, 1);
});

// «Просил не писать» в самом чате второго номера ставит бот (p.stop); при выключенном боте запрет виден в карточке клиента (раздел
// «Клиенты», D1) и соблюдается напоминаниями и рассылками — пометки в чате нет (P2, docs/runbooks/winchester-acceptance.md)
test("Г11 «стоп» от клиента — запрет в KV и в базе D1, напоминания его видят, бот молчит", { skip }, async () => {
  const { d, s, from } = await site();
  await s.gaText("winchester", INST, from, "Стоп", { idMessage: "IN-STOP-" + from });
  assert.ok(await s.env.KV.get(`optout:winchester:${from}`), "запрет в KV");
  const r = d.raw.prepare("select r.kind from restrictions r join contacts c on c.id = r.contact_id where c.phone = ?").all(from);
  assert.deepEqual(r.map(x => x.kind), ["marketing_optout"], "запрет в D1");
  assert.equal(await optedOut(s.env, "winchester", from), true, "напоминания по журналу этому номеру не уйдут");
  assert.equal(sends().length, 0);
});

test("Г12 бот на втором номере выключен: вопрос клиента идёт администратору; BOT_GA_WINCHESTER = 0 — так же", { skip }, async () => {
  for (const extra of [{}, { BOT_GA_WINCHESTER: "0" }]) {
    net.reset();
    const s = mk({ ...GA_W, DB: d1With("production").db, ...extra }), b = await login(s), from = "7700000" + String(5100 + ++seq);
    await s.gaText("winchester", INST, from, "Сколько стоит стрижка?");
    assert.equal(sends().length, 0, "бот не ответил");
    assert.ok((await chat(b, from)).need, "вопрос ждёт администратора");
  }
});

test("Г13 рассылки со второго номера запрещены: пульт пишет почему, запуск — 409 ga_off", { skip }, async () => {
  const { b } = await site(null);
  const list = await (await b.go("/api/bc/list?c=winchester")).json();
  assert.match(String(list.ga && list.ga.bcOff || ""), /выключен/);
  // черновик по списку можно создать (как в старом /broadcast), а запустить — нет
  const created = await (await b.post("/api/bc/create", { c: "winchester", ch: "ga", name: "Проба", text: "Здравствуйте, {имя}!", fallback: "", recipients: "77000005198, Арман\n77000005199, Ерлан", cap: 50, from: 10, to: 20, consent: true })).json();
  assert.ok(created && created.b && created.b.id, JSON.stringify(created));
  const r = await b.post("/api/bc/act", { c: "winchester", id: created.b.id, act: "start" });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, "ga_off");
  assert.equal(sends().length, 0);
});
