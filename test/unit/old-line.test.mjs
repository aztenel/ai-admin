// Выпуск Winchester в production (02.11.2026), условие владельца 7: на боевом сайте второй номер был другим инстансом Green-API, а
// подключаем номер владельца. Переписка хранится по номеру клиента без номера, на который он писал, — старые чаты прежнего номера
// выглядели бы чатами нового, и ответ из пульта ушёл бы клиенту уже с нового номера. GA_SINCE_<ID> — время подключения нынешнего
// номера: в чате без сообщения клиента после него отправка из пульта закрыта (текст, файл, «Отправить клиенту и закрыть»,
// «Удалить у всех»), история видна и не удаляется. Номера вымышленные.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { gaSince } from "../../src/services/inbox/lines.js";
import { sendOnceReset } from "../../src/services/inbox/send.js";

const skip = sqliteOk ? false : "нужна D1 на node:sqlite (Node 22+)";
const INST = { id: "7107000099", token: "ga-tok-line" };
const env = (x = {}) => ({ GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token, ...(sqliteOk ? { DB: d1With("production").db } : {}), ...x });
const OLD = "77000009911", NEW = "77000009912";
const login = async s => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" }); return b; };
const gaOut = () => net.ga.filter(x => ["sendMessage", "sendFileByUpload", "deleteMessage"].includes(x.op)).length;
let n = 0;
const send = (b, to, text = "Здравствуйте!") => b.post("/api/inbox/send", { c: "winchester", ch: "ga", id: to, text, rid: "out-line-" + ++n });
const file = (b, to) => { const fd = new FormData(); fd.set("file", new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: "image/png" }), "a.png"); fd.set("rid", "file-line-" + ++n);
  return b.go(`/api/inbox/send-file?c=winchester&ch=ga&id=${to}`, { method: "POST", body: fd }); };
const chat = async (b, to) => (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${to}`)).json();
const pause = ms => new Promise(r => setTimeout(r, ms));

test("время подключения номера: «2026-11-02 14:05» — по Астане, ISO, миллисекунды; нет — 0 (проверки нет); не разобрать — закрыто", () => {
  assert.equal(gaSince({}, "winchester"), 0);
  assert.equal(gaSince({ GA_SINCE_WINCHESTER: "2026-11-02 14:05" }, "winchester"), Date.parse("2026-11-02T09:05:00Z"));
  assert.equal(gaSince({ GA_SINCE_WINCHESTER: "2026-11-02T09:05:00Z" }, "winchester"), Date.parse("2026-11-02T09:05:00Z"));
  assert.equal(gaSince({ GA_SINCE_WINCHESTER: "1793610300000" }, "winchester"), 1793610300000);
  assert.equal(gaSince({ GA_SINCE_WINCHESTER: "завтра" }, "winchester"), Infinity);
});

test("старый чат второго номера: отправка из пульта закрыта (текст, файл, «Отправить и закрыть», «Удалить у всех»), история видна; новый — как обычно", { skip }, async () => {
  net.reset(); sendOnceReset();
  const s = mk(env()), b = await login(s);
  await s.gaText("winchester", INST, OLD, "Здравствуйте, это старый номер?", { idMessage: "OLD-1" });
  const li = s.hist("ga", "winchester", OLD).profile.li;
  assert.equal((await send(b, OLD, "до смены номера")).status, 200, "без GA_SINCE — как раньше");
  const was = gaOut();
  s.env.GA_SINCE_WINCHESTER = String(li + 1); // номер сменили после последнего сообщения этого клиента
  await pause(5);
  let c = await chat(b, OLD);
  assert.equal(c.canSend, false); assert.equal(c.canFiles, false); assert.equal(c.canQuote, false);
  assert.match(c.sendOff || "", /прежнего второго номера/);
  assert.ok(c.turns.some(t => /старый номер/.test(t.x)), "история на месте");
  let r = await send(b, OLD);
  assert.equal(r.status, 409); assert.equal((await r.json()).code, "oldline");
  r = await file(b, OLD);
  assert.equal(r.status, 409); assert.equal((await r.json()).code, "oldline");
  const mid = c.turns.find(t => t.mid && t.r === "a")?.mid;
  r = await b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: OLD, act: "delete", mid: mid || "X" });
  assert.equal(r.status, 409); assert.equal((await r.json()).code, "oldline");
  assert.equal(gaOut(), was, "к Green-API ничего не ушло");
  // «Готово» без сообщения клиенту и «Удалить у меня» — можно: клиенту ничего не уходит
  assert.equal((await b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: OLD, act: "resolve", force: 1 })).status, 200);
  // новый клиент нового номера — отвечаем как обычно
  await s.gaText("winchester", INST, NEW, "Здравствуйте!", { idMessage: "NEW-1" });
  c = await chat(b, NEW);
  assert.equal(c.canSend, true); assert.equal(c.sendOff, undefined);
  assert.equal((await send(b, NEW)).status, 200);
  assert.equal(gaOut(), was + 1);
  // прежний клиент написал уже на новый номер — его чат открыт
  await s.gaText("winchester", INST, OLD, "Пишу на новый номер", { idMessage: "OLD-2" });
  assert.equal((await chat(b, OLD)).canSend, true);
  assert.equal((await send(b, OLD)).status, 200);
});

test("«Отправить клиенту и закрыть» в старом чате второго номера — отказ до отправки; значение не разобрать — закрыто во всех чатах второго номера", { skip }, async () => {
  net.reset(); sendOnceReset();
  const s = mk(env()), b = await login(s);
  await s.gaText("winchester", INST, OLD, "Отмените, пожалуйста, запись", { idMessage: "OLD-3" });
  s.env.GA_SINCE_WINCHESTER = "завтра";
  const was = gaOut();
  const r = await b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: OLD, act: "done", lead: "x", text: "Отменили", rid: "out-line-done" });
  assert.ok([404, 409].includes(r.status), "заявки нет или отказ — клиенту ничего не уходит");
  assert.equal((await send(b, OLD)).status, 409);
  assert.equal(gaOut(), was);
  delete s.env.GA_SINCE_WINCHESTER;
  assert.equal((await send(b, OLD)).status, 200, "переменную убрали — как раньше");
});
