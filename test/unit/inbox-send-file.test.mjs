// «Полноценные чаты» P0 (31.10.2026): сотрудник отправляет файлы из пульта со второго номера (Green-API, sendFileByUpload на хосте
// media), отвечает на конкретное сообщение (цитата), без двойной отправки: обрыв или 5xx — статус «unknown» и ни одного повтора,
// тот же rid второй раз — ни одного второго запроса к Green-API. Официальный номер (Meta) и чат сайта файлов из пульта не отправляют.
// Всё на заглушках (test/harness.mjs): настоящий Green-API не проверен — адрес media, поля формы и ответ (idMessage, urlFile) взяты
// из документации Green-API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, gaPass } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { FILE_MAX, fileKind, uploadName, quoteText, sendOnceReset } from "../../src/services/inbox/send.js";
import { gaMediaBase } from "../../src/services/integrations/greenapi/client.js";

const INST = { id: "7105000077", token: "ga-tok-w" };
const ENV = { GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token, WA_TOKEN_WINCHESTER: "tok-w", APP_SECRET_WINCHESTER: "sec-w", PHONE_NUMBER_ID_WINCHESTER: "900333" };
// отправка со второго номера идёт только с отметкой в D1 (аудит 31.10.2026): у каждого «сайта» — своя база, как у боевого
// (meta.stage = production); на Node 20 node:sqlite нет — эти проверки пропускаются, их проходят Node 22 и 24
const skip = sqliteOk ? false : "нужна D1 на node:sqlite (Node 22+)";
const env = (x = {}) => ({ ...ENV, ...(sqliteOk ? { DB: d1With("production").db } : {}), ...x });
let ridN = 0;
const login = async s => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" }); return b; };
const hook = (s, body) => s.call(`/ga/winchester?t=${gaPass("winchester", INST)}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ instanceData: { idInstance: +INST.id, wid: "77000000077@c.us" }, timestamp: Math.floor(Date.now() / 1000), ...body }) });
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
/** POST /api/inbox/send-file: c, ch, id — в адресе, файл и поля — multipart */
const sendFile = (b, id, { name = "photo.png", type = "image/png", bytes = PNG, caption, quote, rid = "rid-auto-" + (++ridN), op, ch = "ga", c = "winchester" } = {}) => {
  const fd = new FormData();
  fd.set("file", new Blob([bytes], { type }), name);
  if (caption) fd.set("caption", caption);
  if (quote) fd.set("quote", quote);
  if (rid) fd.set("rid", rid);
  if (op) fd.set("op", op);
  return b.go(`/api/inbox/send-file?c=${c}&ch=${ch}&id=${id}`, { method: "POST", body: fd });
};
const uploads = () => net.ga.filter(x => x.op === "sendFileByUpload");
const fresh = () => { net.reset(); sendOnceReset(); };

test("адрес для файлов Green-API — хост media; вид и имя файла", () => {
  assert.equal(gaMediaBase("https://1103.api.green-api.com"), "https://1103.media.green-api.com");
  assert.equal(gaMediaBase("https://api.green-api.com/"), "https://media.green-api.com");
  assert.equal(gaMediaBase(""), "https://media.green-api.com");
  assert.equal(fileKind("image/jpeg", "a.jpg"), "image"); assert.equal(fileKind("video/quicktime", "a.mov"), "video");
  assert.equal(fileKind("audio/ogg", "v.ogg"), "audio"); assert.equal(fileKind("application/pdf", "a.pdf"), "document");
  assert.equal(fileKind("", "scan.PNG"), "image"); assert.equal(fileKind("image/heic", "a.heic"), "document", "HEIC WhatsApp не покажет фото — уходит файлом");
  assert.equal(uploadName("Прайс", "application/pdf", "document"), "Прайс.pdf", "без расширения Green-API не поймёт вид файла");
  assert.equal(uploadName("../../etc/x.png", "image/png", "image"), "etcx.png", "без путей");
  assert.equal(quoteText({ text: "[клиент прислал фото]", m: { k: "image" } }), "Фото");
  assert.equal(quoteText({ text: "[клиент прислал файл]", m: { k: "document", name: "Прайс.pdf" } }), "Файл «Прайс.pdf»");
});

test("фото уходит через sendFileByUpload на хост media: реплика с файлом, номером сообщения, статусом; файл открывается в пульте", { skip }, async () => {
  fresh();
  const s = mk(env()), b = await login(s), from = "77000000401";
  await s.gaText("winchester", INST, from, "Пришлите, пожалуйста, прайс");
  let c = await (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${from}`)).json();
  assert.equal(c.canFiles, true); assert.equal(c.canQuote, true);
  assert.ok(c.turns[0].mid, "у сообщения клиента — номер у Green-API (на него можно ответить)");
  const r = await sendFile(b, from, { caption: "Вот наш прайс", op: "Айгерим", rid: "rid-photo-1" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.warn, undefined);
  const up = uploads();
  assert.equal(up.length, 1);
  assert.equal(up[0].host, "media.green-api.com", "файлы — на хост media");
  assert.equal(up[0].inst, INST.id); assert.equal(up[0].form.chatId, from + "@c.us"); assert.equal(up[0].form.fileName, "photo.png");
  assert.equal(up[0].form.caption, "Вот наш прайс"); assert.equal(up[0].form.file.size, PNG.length); assert.equal(up[0].form.quotedMessageId, undefined);
  const t = s.hist("ga", "winchester", from).turns.at(-1);
  assert.equal(t.by, "admin"); assert.equal(t.op, "Айгерим"); assert.equal(t.text, "Вот наш прайс"); assert.equal(t.st, "sent");
  assert.ok(t.mid && t.mid === t.m.id, "номер сообщения — и у реплики, и у файла");
  assert.deepEqual({ k: t.m.k, name: t.m.name, mime: t.m.mime, size: t.m.size }, { k: "image", name: "photo.png", mime: "image/png", size: PNG.length });
  assert.match(t.m.url, /^https:\/\/media\.green-api\.test\/out\//);
  const v = j.chat.turns.at(-1);
  assert.equal(v.r, "a"); assert.equal(v.mid, t.mid); assert.equal(v.m.k, "image"); assert.equal(v.m.f, true); assert.equal(v.st, "sent");
  assert.ok(s.hist("ga", "winchester", from).profile.pausedUntil > Date.now(), "бот замолкает, как после текста");
  // файл открывается через тот же адрес, что и файлы клиента: ссылка из ответа на отправку
  net.mediaReply = url => url.startsWith("https://media.green-api.test/out/") ? new Response(PNG, { headers: { "content-type": "image/png", "content-length": String(PNG.length) } }) : null;
  let m = await b.go(`/api/inbox/media?c=winchester&ch=ga&id=${from}&mid=${encodeURIComponent(t.mid)}`);
  assert.equal(m.status, 200); assert.equal(m.headers.get("content-type"), "image/png"); assert.equal((await m.arrayBuffer()).byteLength, PNG.length);
  // ссылка устарела — новая у Green-API по номеру сообщения (downloadFile работает и для исходящих)
  net.mediaReply = url => url.includes("/out/") ? new Response("expired", { status: 403 }) : url.includes("/fresh/") ? new Response(PNG, { headers: { "content-type": "image/png" } }) : null;
  net.gaReply = rec => rec.op === "downloadFile" ? new Response(JSON.stringify({ downloadUrl: "https://media.green-api.test/fresh/p.png" }), { headers: { "content-type": "application/json" } }) : null;
  m = await b.go(`/api/inbox/media?c=winchester&ch=ga&id=${from}&mid=${encodeURIComponent(t.mid)}`);
  assert.equal(m.status, 200);
  assert.ok(net.ga.some(x => x.op === "downloadFile" && x.body.idMessage === t.mid && x.body.chatId === from + "@c.us"));
});

test("PDF без подписи: служебная строка для ИИ, вид «документ»; в списке чатов — последнее сообщение наше", { skip }, async () => {
  fresh();
  const s = mk(env()), b = await login(s), from = "77000000402";
  await s.gaText("winchester", INST, from, "Нужен договор");
  const j = await (await sendFile(b, from, { name: "Договор.pdf", type: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4\n%%EOF") })).json();
  const t = s.hist("ga", "winchester", from).turns.at(-1);
  assert.equal(t.text, "[сотрудник отправил файл]"); assert.equal(t.m.k, "document"); assert.equal(t.m.name, "Договор.pdf");
  assert.equal(j.chat.turns.at(-1).m.name, "Договор.pdf");
  const L = await (await b.go("/api/inbox/list?c=winchester&v=2")).json();
  assert.equal(L.chats.find(x => x.id === from).d, "a");
});

test("Green-API ответил 500 или не ответил: статус «unknown», ровно один запрос, понятное предупреждение; повтор с тем же rid не отправляет", { skip }, async () => {
  fresh();
  const s = mk(env()), b = await login(s), from = "77000000403";
  await s.gaText("winchester", INST, from, "Скиньте фото работ");
  net.gaReply = rec => rec.op === "sendFileByUpload" ? new Response(JSON.stringify({ message: "Internal Server Error" }), { status: 500, headers: { "content-type": "application/json" } }) : null;
  let r = await sendFile(b, from, { rid: "rid-500-0001" });
  assert.equal(r.status, 200);
  let j = await r.json();
  assert.equal(j.warn, "Не знаем, ушло ли сообщение. Проверьте в WhatsApp, прежде чем отправлять ещё раз.");
  assert.equal(uploads().length, 1, "само не повторяется");
  let t = s.hist("ga", "winchester", from).turns.at(-1);
  assert.equal(t.st, "unknown"); assert.equal(t.mid, undefined); assert.equal(t.m.k, "image"); assert.equal(j.chat.turns.at(-1).st, "unknown");
  // браузер повторил тот же запрос (обрыв связи после отправки): клиенту второй раз не уходит
  r = await sendFile(b, from, { rid: "rid-500-0001" });
  j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.dup, true); assert.match(j.warn, /Не знаем, ушло ли/);
  assert.equal(uploads().length, 1);
  assert.equal(s.hist("ga", "winchester", from).turns.filter(x => x.by === "admin").length, 1, "в переписке — одна реплика");
  // связь оборвалась (fetch бросил) — тоже «unknown» и один запрос
  net.gaReply = rec => { if (rec.op === "sendFileByUpload") throw new Error("connection reset"); return null; };
  r = await sendFile(b, from, { rid: "rid-net-0001", name: "work.jpg", type: "image/jpeg" });
  j = await r.json();
  assert.equal(r.status, 200); assert.match(j.warn, /Не знаем, ушло ли/);
  assert.equal(uploads().length, 2, "второй файл — один запрос, без повтора");
  t = s.hist("ga", "winchester", from).turns.at(-1);
  assert.equal(t.st, "unknown"); assert.equal(t.m.name, "work.jpg");
  // текст: тот же порядок — 5xx → «unknown» и предупреждение, без повтора
  net.gaReply = rec => rec.op === "sendMessage" ? new Response("{}", { status: 502 }) : null;
  j = await (await b.post("/api/inbox/send", { c: "winchester", ch: "ga", id: from, text: "Отправили?", rid: "rid-text-500" })).json();
  assert.match(j.warn, /Не знаем, ушло ли/); assert.equal(net.ga.filter(x => x.op === "sendMessage").length, 1);
});

test("тот же rid дважды — один запрос к Green-API (файл и текст); отказ Green-API (4xx) снимает отметку — «Повторить» отправляет", { skip }, async () => {
  fresh();
  const s = mk(env()), b = await login(s), from = "77000000404";
  await s.gaText("winchester", INST, from, "Здравствуйте");
  const [r1, r2] = await Promise.all([sendFile(b, from, { rid: "rid-twice-01" }), sendFile(b, from, { rid: "rid-twice-01" })]);
  const codes = [r1.status, r2.status].sort();
  assert.equal(uploads().length, 1, "двойное нажатие — один файл клиенту");
  assert.ok(codes[0] === 200 && (codes[1] === 200 || codes[1] === 409), String(codes));
  const again = await (await sendFile(b, from, { rid: "rid-twice-01" })).json();
  assert.equal(again.dup, true); assert.equal(uploads().length, 1);
  assert.equal(s.hist("ga", "winchester", from).turns.filter(x => x.by === "admin").length, 1);
  // текст с rid
  await b.post("/api/inbox/send", { c: "winchester", ch: "ga", id: from, text: "Ждём вас", rid: "rid-text-001" });
  const d = await (await b.post("/api/inbox/send", { c: "winchester", ch: "ga", id: from, text: "Ждём вас", rid: "rid-text-001" })).json();
  assert.equal(d.dup, true); assert.equal(net.ga.filter(x => x.op === "sendMessage").length, 1);
  // новый экземпляр Worker (память пуста) — отметка в D1 держит
  sendOnceReset();
  assert.equal((await (await sendFile(b, from, { rid: "rid-twice-01" })).json()).dup, true); assert.equal(uploads().length, 1);
  // Green-API отказал (ничего не ушло) — ошибка с причиной; тот же rid можно отправить снова
  net.gaReply = rec => rec.op === "sendFileByUpload" ? new Response(JSON.stringify({ message: "Bad Request" }), { status: 400, headers: { "content-type": "application/json" } }) : null;
  let r = await sendFile(b, from, { rid: "rid-fail-001" });
  assert.equal(r.status, 409); assert.match((await r.json()).error, /^Green-API не принял файл/);
  net.gaReply = null;
  r = await sendFile(b, from, { rid: "rid-fail-001" });
  assert.equal(r.status, 200); assert.equal((await r.json()).dup, undefined);
  assert.equal(uploads().length, 3);
});

test("большой файл — 413, опасный тип и пустой файл — 400, понятным языком; Green-API не вызывается", { skip }, async () => {
  fresh();
  const s = mk(env()), b = await login(s), from = "77000000405";
  await s.gaText("winchester", INST, from, "Привет");
  let r = await sendFile(b, from, { name: "big.mp4", type: "video/mp4", bytes: new Uint8Array(FILE_MAX + 1) });
  assert.equal(r.status, 413); assert.match((await r.json()).error, /больше 25 МБ/);
  r = await sendFile(b, from, { name: "huge.mp4", type: "video/mp4", bytes: new Uint8Array(FILE_MAX + 512 * 1024) });
  assert.equal(r.status, 413, "тело больше предела не дочитывается"); assert.match((await r.json()).error, /больше 25 МБ/);
  r = await sendFile(b, from, { name: "page.html", type: "text/html", bytes: new TextEncoder().encode("<script>1</script>") });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /нельзя/);
  r = await sendFile(b, from, { name: "empty.pdf", type: "application/pdf", bytes: new Uint8Array(0) });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /пустой/);
  r = await b.go(`/api/inbox/send-file?c=winchester&ch=ga&id=${from}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /Выберите файл/);
  assert.equal(uploads().length, 0);
});

test("опасный тип не проходит под другим именем: точка или пробел в конце, кавычка в имени, тип файла html/svg (ревью безопасности 31.10.2026)", { skip }, async () => {
  fresh();
  const s = mk(env()), b = await login(s), from = "77000000409";
  await s.gaText("winchester", INST, from, "Привет");
  const evil = new TextEncoder().encode("<script>alert(1)</script>");
  for (const [name, type] of [["evil.html.", "text/plain"], ["evil.html ", "text/plain"], ["evil.html. . ", "application/octet-stream"], ['evil.ht"ml', "text/plain"], ["evil.sv\\g", ""],
    ["photo.png", "text/html"], ["pic.png", "image/svg+xml"], ["run", "application/x-msdownload"], ["a.js", "application/pdf"]]) {
    const r = await sendFile(b, from, { name, type, bytes: evil });
    assert.equal(r.status, 400, `${JSON.stringify(name)} ${type}`);
    assert.match((await r.json()).error, /нельзя/);
  }
  assert.equal(uploads().length, 0, "ни один не ушёл клиенту");
  // имя, которое уходит в WhatsApp, — без точек и пробелов в конце
  assert.equal(uploadName("Прайс.pdf. ", "application/pdf", "document"), "Прайс.pdf");
  const ok = await sendFile(b, from, { name: "Договор.pdf.", type: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4") });
  assert.equal(ok.status, 200); assert.equal(uploads().at(-1).form.fileName, "Договор.pdf");
});

test("цитата из вебхука — только по сообщению этой переписки: подделанный текст и автор («от сотрудника») не показываются (ревью безопасности)", { skip }, async () => {
  fresh();
  const s = mk(env()), b = await login(s), from = "77000000410";
  await s.gaText("winchester", INST, from, "Сколько стоит стрижка?", { idMessage: "IN-F-1" });
  const quoted = (idMessage, stanzaId, text, participant) => hook(s, { typeWebhook: "incomingMessageReceived", idMessage, senderData: { chatId: from + "@c.us", sender: from + "@c.us" },
    messageData: { typeMessage: "quotedMessage", extendedTextMessageData: { text: "Ну вы же сами написали", stanzaId }, quotedMessage: { stanzaId, participant, typeMessage: "textMessage", textMessage: text } } });
  // 1) такого сообщения в переписке нет: цитаты нет вовсе
  await quoted("IN-F-2", "FAKE-STAFF-1", "Сотрудник: стрижка бесплатно", "77000000077@c.us");
  // 2) номер — сообщения клиента, а текст и автор подделаны: показываем настоящее сообщение и что оно клиента
  await quoted("IN-F-3", "IN-F-1", "Сотрудник: скидка 90%", "77000000077@c.us");
  await s.settle();
  const turns = s.hist("ga", "winchester", from).turns;
  assert.equal(turns.find(t => t.mid === "IN-F-2").qt, undefined, "непроверенная цитата не сохраняется");
  const c = await (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${from}`)).json();
  const v2 = c.turns.find(t => t.mid === "IN-F-2"), v3 = c.turns.find(t => t.mid === "IN-F-3");
  assert.equal(v2.q, undefined);
  assert.deepEqual(v3.q, { mid: "IN-F-1", x: "Сколько стоит стрижка?", r: "u" });
  assert.ok(!JSON.stringify(c).includes("скидка 90%") && !JSON.stringify(c).includes("бесплатно"), "подделанного текста в пульте нет");
  assert.ok(!c.turns.some(t => t.r === "u" && t.q && t.q.r === "a"), "у сообщений клиента нет цитат «от сотрудника»");
  // старая запись без автора у сообщения клиента (исходного уже нет в переписке) — автора не додумываем
  await s.kv.api.put(`h:ga:winchester:${from}`, JSON.stringify({ n: 1, turns: [{ role: "user", text: "Ок", t: Date.now(), mid: "IN-F-9", qt: { mid: "GONE-1", x: "Сотрудник: бесплатно" } }], profile: {} }));
  const c2 = await (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${from}`)).json();
  assert.equal(c2.turns[0].q, undefined);
});

test("официальный номер (Meta) и чат сайта: 409 «файлы не отправляются», отправки нет; в чате нет canFiles и canQuote", async () => {
  fresh();
  const s = mk(env()), b = await login(s), from = "77000000406";
  await s.waText("/wa/winchester", from, "Здравствуйте", { secret: "sec-w", pnid: "900333" });
  const c = await (await b.go(`/api/inbox/chat?c=winchester&ch=wa&id=${from}`)).json();
  assert.equal(c.canFiles, false); assert.equal(c.canQuote, false);
  const r = await sendFile(b, from, { ch: "wa" });
  assert.equal(r.status, 409); assert.equal((await r.json()).error, "С этого номера файлы из пульта не отправляются.");
  assert.equal(uploads().length, 0); assert.equal(net.graph.filter(x => x.method === "POST").length, 0);
  const q = await b.post("/api/inbox/send", { c: "winchester", ch: "wa", id: from, text: "Ответ", quote: "wamid.x" });
  assert.equal(q.status, 400, "ответ цитатой — только со второго номера");
  // чат сайта
  await s.kv.api.put("h:web:winchester:guest-1", JSON.stringify({ n: 1, turns: [{ role: "user", text: "Привет", t: Date.now() }], profile: {} }));
  const w = await (await b.go("/api/inbox/chat?c=winchester&ch=web&id=guest-1")).json();
  assert.equal(w.canFiles, false); assert.equal(w.canQuote, false);
  const wr = await sendFile(b, "guest-1", { ch: "web" });
  assert.equal(wr.status, 409); assert.equal((await wr.json()).error, "С этого номера файлы из пульта не отправляются.");
  // без номера Green-API у компании — не на что отправлять
  const s2 = mk({}), b2 = await login(s2);
  await s2.kv.api.put(`h:ga:winchester:${from}`, JSON.stringify({ n: 1, turns: [{ role: "user", text: "Привет", t: Date.now(), mid: "IN-1" }], profile: {} }));
  const c2 = await (await b2.go(`/api/inbox/chat?c=winchester&ch=ga&id=${from}`)).json();
  assert.equal(c2.canFiles, false);
  assert.equal((await sendFile(b2, from)).status, 409);
  // чужой сайт — отказ до чтения файла
  const evil = await b.go(`/api/inbox/send-file?c=winchester&ch=ga&id=${from}`, { method: "POST", headers: { origin: "https://evil.example" }, body: new FormData() });
  assert.equal(evil.status, 403);
});

test("ответ на сообщение: quotedMessageId в sendMessage и в форме файла, цитата в реплике и в пульте; цитата клиента из вебхука", { skip }, async () => {
  fresh();
  const s = mk(env()), b = await login(s), from = "77000000407";
  await s.gaText("winchester", INST, from, "Можно на завтра в 15:00?", { idMessage: "IN-Q-1" });
  let j = await (await b.post("/api/inbox/send", { c: "winchester", ch: "ga", id: from, text: "Да, записали", quote: "IN-Q-1", rid: "rid-quote-1" })).json();
  const sm = net.ga.filter(x => x.op === "sendMessage").at(-1);
  assert.equal(sm.body.quotedMessageId, "IN-Q-1");
  let t = s.hist("ga", "winchester", from).turns.at(-1);
  assert.deepEqual(t.qt, { mid: "IN-Q-1", x: "Можно на завтра в 15:00?", r: "u" });
  assert.deepEqual(j.chat.turns.at(-1).q, { mid: "IN-Q-1", x: "Можно на завтра в 15:00?", r: "u" });
  const ourMid = t.mid;
  // файл ответом на сообщение
  j = await (await sendFile(b, from, { quote: "IN-Q-1", rid: "rid-quote-2" })).json();
  assert.equal(uploads().at(-1).form.quotedMessageId, "IN-Q-1");
  assert.equal(j.chat.turns.at(-1).q.mid, "IN-Q-1");
  // сообщения нет в переписке — не отправляем
  const r = await b.post("/api/inbox/send", { c: "winchester", ch: "ga", id: from, text: "Ок", quote: "NOPE-1" });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /не найдено/);
  // клиент ответил цитатой на наше сообщение
  await hook(s, { typeWebhook: "incomingMessageReceived", idMessage: "IN-Q-2", senderData: { chatId: from + "@c.us", sender: from + "@c.us" },
    messageData: { typeMessage: "quotedMessage", extendedTextMessageData: { text: "Спасибо, буду", stanzaId: ourMid }, quotedMessage: { stanzaId: ourMid, participant: "77000000077@c.us", typeMessage: "textMessage", textMessage: "Да, записали" } } });
  await s.settle();
  t = s.hist("ga", "winchester", from).turns.at(-1);
  assert.equal(t.role, "user"); assert.equal(t.text, "Спасибо, буду"); assert.equal(t.mid, "IN-Q-2"); assert.equal(t.qt.mid, ourMid);
  const c = await (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${from}`)).json();
  assert.deepEqual(c.turns.at(-1).q, { mid: ourMid, x: "Да, записали", r: "a" });
});

test("бот на втором номере включён: у сообщения клиента тоже есть номер (mid) — на него можно ответить цитатой", { skip }, async () => {
  fresh();
  const DI = { id: "7105000088", token: "ga-tok-d" };
  const s = mk({ GA_ID_DENT: DI.id, GA_TOKEN_DENT: DI.token, DB: d1With("production").db }), b = await login(s), from = "77000000408";
  net.ai = ["Здравствуйте! Чем помочь?"];
  await s.gaText("dent", DI, from, "Сколько стоит чистка?", { idMessage: "IN-BOT-1" });
  const h = s.hist("ga", "dent", from);
  assert.equal(h.turns.find(x => x.role === "user").mid, "IN-BOT-1");
  const c = await (await b.go(`/api/inbox/chat?c=dent&ch=ga&id=${from}`)).json();
  assert.equal(c.turns.find(x => x.r === "u").mid, "IN-BOT-1"); assert.equal(c.canQuote, true);
});
