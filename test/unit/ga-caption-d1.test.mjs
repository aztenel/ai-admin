// Переписки в D1, второй номер (Green-API): фото или файл с подписью. У Green-API подпись приходит в том же событии, что и файл, —
// в переписке это две реплики с одним номером сообщения (idMessage): по нему работают цитата, правка и удаление. Ключ строки в D1
// строился из номера сообщения, и вторая реплика (подпись) отбрасывалась как повтор: в пульте оставалось «[клиент прислал фото]»
// без текста клиента (находка проверки журнала вебхуков, 02.11.2026). Подпись теперь помечена (cap) — свой ключ строки; старые
// переписки из KV при переносе размечаются так же (capMark), чтобы подписи не пропали и тогда.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, gaPass } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { capMark, mkeyOf } from "../../src/services/chatstore/merge.js";

const skip = sqliteOk ? false : "нужна D1 на node:sqlite (Node 22+)";
const INST = { id: "7105000077", token: "ga-tok-cap" };
const GA = { GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
const D1MODE = { CHAT_STORE_WINCHESTER: "d1" };
const A = "77000007701";
const hook = (s, body) => s.call(`/ga/winchester?t=${gaPass("winchester", INST)}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ instanceData: { idInstance: +INST.id, wid: "77000000077@c.us" }, timestamp: Math.floor(Date.now() / 1000), ...body }) });
const photo = (s, id, caption) => hook(s, { typeWebhook: "incomingMessageReceived", idMessage: id, senderData: { chatId: A + "@c.us", sender: A + "@c.us", senderName: "Арман" },
  messageData: { typeMessage: "imageMessage", fileMessageData: { downloadUrl: "https://media.green-api.test/p.png", mimeType: "image/png", caption } } });
const login = async s => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" }); return b; };
const chatOf = async b => (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${A}`)).json();
const rows = d => d.raw.prepare("select mkey, role, mid from chat_messages where ws = 'winchester' and ch = 'ga' and chat = ? order by t, id").all(A);

test("разметка подписи: реплика без файла с номером файла перед ней — подпись; ключи строк разные, у прочих — прежние", () => {
  const t = Date.now(), turns = [
    { role: "user", text: "Привет", t: t - 3, mid: "M1" },
    { role: "user", text: "[клиент прислал фото]", t: t - 2, mid: "M2", m: { k: "image", id: "M2" } },
    { role: "user", text: "Так можно?", t: t - 2, mid: "M2" },
    { role: "model", by: "admin", text: "Да", t: t - 1, mid: "M3", st: "sent" },
  ];
  const marked = capMark(turns);
  assert.equal(marked[2].cap, 1, "подпись помечена");
  assert.equal(marked[0].cap, undefined); assert.equal(marked[1].cap, undefined); assert.equal(marked[3].cap, undefined);
  assert.notEqual(mkeyOf(marked[1]), mkeyOf(marked[2]), "у файла и подписи — разные ключи");
  assert.equal(mkeyOf(marked[0]), mkeyOf(turns[0]), "ключи остальных реплик не меняются (уже записанные строки D1 не задваиваются)");
  assert.equal(mkeyOf(marked[1]), mkeyOf(turns[1]));
  assert.equal(capMark(marked)[2], marked[2], "повторная разметка ничего не меняет");
});

test("D1: фото с подписью со второго номера — и файл, и подпись; повтор события — без дублей", { skip }, async () => {
  net.reset();
  const d = d1With("production"), s = mk({ ...GA, ...D1MODE, DB: d.db }), b = await login(s);
  await photo(s, "IN-CAP-1", "Вот такую стрижку можно на завтра?");
  let c = await chatOf(b);
  const mine = c.turns.filter(x => x.mid === "IN-CAP-1");
  assert.equal(mine.length, 2, "файл и подпись: " + JSON.stringify(c.turns.map(x => x.x)));
  assert.ok(mine.some(x => x.m && x.m.k === "image"));
  assert.ok(mine.some(x => x.x === "Вот такую стрижку можно на завтра?"), "текст клиента на месте");
  assert.equal(rows(d).length, 2);
  await photo(s, "IN-CAP-1", "Вот такую стрижку можно на завтра?"); // Green-API повторил доставку
  assert.equal(rows(d).length, 2, "повтор события — без новых строк");
  c = await chatOf(b);
  assert.ok(c.need, "клиент ждёт ответа");
});

test("D1: старая переписка из KV с подписью к фото — при переносе подпись не пропадает", { skip }, async () => {
  net.reset();
  const d = d1With("production"), s = mk({ ...GA, ...D1MODE, DB: d.db }), b = await login(s), t = Date.now() - 60e3;
  await s.kv.api.put(`h:ga:winchester:${A}`, JSON.stringify({ n: 2, profile: { li: t }, turns: [
    { role: "user", text: "[клиент прислал фото]", t, mid: "OLD-1", m: { k: "image", id: "OLD-1" } },
    { role: "user", text: "Подпись из прошлого", t, mid: "OLD-1" },
  ] }));
  const c = await chatOf(b); // первое чтение переносит чат из KV
  assert.deepEqual(c.turns.map(x => x.x), ["[клиент прислал фото]", "Подпись из прошлого"]);
  assert.equal(rows(d).length, 2);
});
