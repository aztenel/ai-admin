// Каналы WhatsApp (план проверки модулей, модуль 1, 16.10.2026): дыры, найденные чтением кода. Сначала сценарий, который повторяет проблему, потом исправление.
// Всё на заглушках: Wazzapo — по их документации, вживую не проверено.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { net, mk } from "../harness.mjs";

const ENV = { WA_VIA_BARBER: "wazzapo", WA_TOKEN_BARBER: "wz_live_test", APP_SECRET_BARBER: "hook-secret", PHONE_NUMBER_ID_BARBER: "103799815708451" };
const sign = body => "sha256=" + createHmac("sha256", "hook-secret").update(body).digest("hex");
let n = 0;
function hook(s, event, data, delivery) {
  const body = JSON.stringify({ event, data: { channel: "whatsapp", phone_number_id: "103799815708451", ...data } });
  return s.call("/wz/barber", { method: "POST", body, headers: { "content-type": "application/json", "x-wazzapo-delivery-id": delivery || "dlv-ch-" + (++n), "x-wazzapo-signature": sign(body) } });
}
const incoming = (s, from, text, id) => hook(s, "message.incoming", { contact: { phone: from }, message: { id: id || "wamid.ch" + (++n), from, type: "text", text } });
const sends = () => net.wz.filter(r => r.path === "/messages/send");
const sentText = () => sends().map(r => r.body.text && r.body.text.body);

test("своё сообщение бота в message.outgoing с другим id (событие пришло раньше ответа на отправку) — бот не ставит себя на паузу", async () => {
  net.reset(); net.ai = ["Здравствуйте! Стрижка — 3 000 ₸."];
  net.wzReply = rec => rec.path === "/messages/send" ? new Response(JSON.stringify({ status: "accepted" }), { status: 200, headers: { "content-type": "application/json" } }) : null; // id в ответе нет: отметить своё по id нельзя
  const s = mk(ENV);
  await incoming(s, "77051113301", "Сколько стоит стрижка?");
  const out = sentText();
  assert.ok(out.length >= 2, "новому клиенту — согласие и ответ: " + JSON.stringify(out));
  for (const t of out) await hook(s, "message.outgoing", { sender: { type: "agent" }, contact: { phone: "77051113301" }, message: { id: "wamid.out." + (++n), to: "77051113301", type: "text", text: t } });
  const h = s.hist("wa", "barber", "77051113301");
  assert.ok(!(h.profile.pausedUntil > Date.now()), "бот не замолчал из-за своих же сообщений");
  assert.ok(!h.turns.some(t => t.by === "admin"), JSON.stringify(h.turns));
  net.ai = ["Есть сегодня в 15:00."];
  await incoming(s, "77051113301", "А сегодня можно?");
  assert.ok(sentText().some(t => /15:00/.test(t)), "бот продолжает отвечать");
});

test("человек ответил с телефона, пока бот думал, — бот свой ответ не отправляет", async () => {
  net.reset(); net.ai = ["Здравствуйте! Чем помочь?"];
  const s = mk(ENV);
  await incoming(s, "77051113302", "Здравствуйте");
  const before = sends().length;
  const hk = "h:wa:barber:77051113302";
  net.ai = [() => { // пока ИИ пишет ответ, администратор ответил клиенту с телефона (как это делает waCoex)
    const h = s.kv.json(hk), now = Date.now();
    h.turns.push({ role: "model", text: "Добрый день, это Тони, запишу вас сам", t: now, by: "admin", m: "phone" }); h.n++; h.profile.pausedUntil = now + 2 * 3600e3;
    s.kv.mem.set(hk, JSON.stringify(h));
    return "Могу записать вас на 15:00.";
  }];
  await incoming(s, "77051113302", "Хочу постричься сегодня");
  assert.equal(sends().length, before, "второго ответа поверх ответа человека нет: " + JSON.stringify(sentText()));
  const h = s.hist("wa", "barber", "77051113302");
  assert.ok(h.turns.some(t => t.role === "user" && /постричься/.test(t.text)), "сообщение клиента в чате");
  assert.ok(h.turns.some(t => t.by === "admin"), "ответ человека в чате");
  assert.ok(!h.turns.some(t => /15:00/.test(t.text)), "неотправленный ответ бота в чат не записан: " + JSON.stringify(h.turns));
  assert.ok(h.profile.pausedUntil > Date.now(), "пауза осталась");
});

test("ответ бота не дошёл (ошибка Wazzapo) — каждый такой чат помечен в пульте, хотя в Telegram сигнал раз в 10 минут", async () => {
  net.reset(); net.ai = ["Здравствуйте!"];
  net.wzReply = rec => rec.path === "/messages/send" ? new Response(JSON.stringify({ error: { code: 502, message: "Meta rejected" } }), { status: 502 }) : null;
  const s = mk(ENV);
  await incoming(s, "77051113303", "Здравствуйте");
  await incoming(s, "77051113304", "Добрый день");
  for (const id of ["77051113303", "77051113304"]) {
    const h = s.hist("wa", "barber", id);
    assert.equal(h && h.profile.need && h.profile.need.why, "send", id + ": " + JSON.stringify(h && h.profile));
  }
  assert.equal(net.tg.filter(t => /не доходят/.test(t.text || "")).length, 1, "Telegram — один раз");
});

test("ответ бота не дошёл (Green-API) — чат помечен в пульте", async () => {
  net.reset(); net.ai = ["Здравствуйте!"];
  net.gaReply = rec => rec.op === "sendMessage" ? new Response(JSON.stringify({ message: "quota exceeded" }), { status: 466 }) : null;
  const inst = { id: "1101000001", token: "ga-token-1" };
  const s = mk({ GA_ID_BARBER: inst.id, GA_TOKEN_BARBER: inst.token });
  await s.gaText("barber", inst, "77051113305", "Здравствуйте");
  const h = s.hist("ga", "barber", "77051113305");
  assert.equal(h && h.profile.need && h.profile.need.why, "send", JSON.stringify(h && h.profile));
});

test("Meta напрямую: обрыв связи при отправке — администратор узнаёт, чат помечен", async () => {
  net.reset(); net.ai = ["Здравствуйте!"];
  net.graphReply = (url, init) => { if (/\/messages$/.test(url) && init.method === "POST") throw new TypeError("fetch failed"); return null; };
  const s = mk({ WA_TOKEN_AUTO: "meta-token", APP_SECRET_AUTO: "sec-b", PHONE_NUMBER_ID_AUTO: "555000111" }); // другой бизнес: сигнал «не доходят» — раз в 10 минут на бизнес
  await s.waText("/wa/auto", "77051113306", "Здравствуйте", { secret: "sec-b" });
  assert.ok(net.tg.some(t => /не доходят/.test(t.text || "") && /Meta не ответила/.test(t.text || "")), JSON.stringify(net.tg.map(t => t.text)));
  const h = s.hist("wa", "auto", "77051113306");
  assert.equal(h && h.profile.need && h.profile.need.why, "send", JSON.stringify(h && h.profile));
});

test("Wazzapo: id сообщения не в message.id, а в data.message_id — сообщение не теряется", async () => {
  net.reset(); net.ai = ["Здравствуйте! Чем помочь?"];
  const s = mk(ENV);
  await hook(s, "message.incoming", { message_id: "wamid.top1", contact: { phone: "77051113307" }, message: { from: "77051113307", type: "text", text: "Здравствуйте" } });
  assert.ok(sentText().some(t => /Чем помочь/.test(t)), JSON.stringify(net.wz));
});

test("одно сообщение пришло двумя доставками одновременно (вебхук добавлен в кабинете дважды) — ответ один", async () => {
  net.reset(); net.ai = ["Здравствуйте! Чем помочь?"];
  const s = mk(ENV), get = s.kv.api.get, put = s.kv.api.put, slow = ms => new Promise(r => setTimeout(r, ms));
  s.kv.api.get = async k => { await slow(5); return get(k); }; // настоящий KV отвечает не мгновенно: обе доставки успевают прочитать «не видели» до отметки
  s.kv.api.put = async (k, v, o) => { await slow(20); return put(k, v, o); };
  await Promise.all([incoming(s, "77051113308", "Здравствуйте", "wamid.twice"), incoming(s, "77051113308", "Здравствуйте", "wamid.twice")]);
  assert.equal(sentText().filter(t => /Чем помочь/.test(t)).length, 1, JSON.stringify(sentText()));
});

// 16.10.2026, живой показ Winchester через Wazzapo: бот ответил дважды — второй раз «Ничего страшного, если сообщение удалили»,
// и дважды «Передала администратору, он подтвердит отмену». Как Wazzapo присылает удаление и правку, в документации нет — проверяем все правдоподобные виды
test("клиент удалил сообщение — бот не отвечает на уведомление об удалении (в любом виде)", async () => {
  net.reset(); net.ai = ["Здравствуйте! Чем помочь?"];
  const s = mk(ENV);
  await incoming(s, "77051113309", "Хочу записаться на стрижку");
  const before = sends().length;
  net.ai = ["Ничего страшного, если сообщение удалили 👌"];
  const cases = [
    { type: "revoked", text: "" },
    { type: "deleted" },
    { type: "text", text: "This message was deleted" },
    { type: "text", text: "🚫 Это сообщение удалено" },
    { type: "text", text: "Отмените запись", deleted: true },
    { type: "text", text: "Отмените запись", is_revoked: true },
    { type: "unsupported", text: "" }
  ];
  for (const m of cases) await hook(s, "message.incoming", { contact: { phone: "77051113309" }, message: { id: "wamid.del" + (++n), from: "77051113309", ...m } });
  assert.equal(sends().length, before, "ответов на удаление нет: " + JSON.stringify(sentText().slice(before)));
});

test("клиент исправил сообщение — бот второй раз не отвечает", async () => {
  net.reset(); net.ai = ["Передала администратору, он подтвердит отмену."];
  const s = mk(ENV);
  await incoming(s, "77051113310", "Отмените мою запись");
  const before = sends().length;
  await hook(s, "message.incoming", { contact: { phone: "77051113310" }, message: { id: "wamid.ed" + (++n), from: "77051113310", type: "text", text: "Отмените мою запись, пожалуйста", edited: true } });
  await hook(s, "message.incoming", { contact: { phone: "77051113310" }, message: { id: "wamid.ed" + (++n), from: "77051113310", type: "edited", text: "Отмените мою запись!" } });
  assert.equal(sends().length, before, JSON.stringify(sentText().slice(before)));
});

test("то же сообщение (тот же текст и время отправки) пришло с другим id — ответ один", async () => {
  net.reset(); net.ai = ["Передала администратору, он подтвердит отмену."];
  const s = mk(ENV);
  const msg = { from: "77051113311", type: "text", text: "Отмените запись на завтра", timestamp: "1791010000" };
  await hook(s, "message.incoming", { contact: { phone: "77051113311" }, message: { id: "wamid.a1", ...msg } });
  await hook(s, "message.incoming", { contact: { phone: "77051113311" }, message: { id: "wamid.a2", ...msg } });
  assert.equal(sentText().filter(t => /подтвердит отмену/.test(t)).length, 1, JSON.stringify(sentText()));
});

test("тот же короткий ответ клиента в разное время — бот отвечает на оба", async () => {
  net.reset(); net.ai = ["Хорошо 👌"];
  const s = mk(ENV);
  await hook(s, "message.incoming", { contact: { phone: "77051113312" }, message: { id: "wamid.b1", from: "77051113312", type: "text", text: "да", timestamp: "1791010000" } });
  const one = sends().length;
  await hook(s, "message.incoming", { contact: { phone: "77051113312" }, message: { id: "wamid.b2", from: "77051113312", type: "text", text: "да", timestamp: "1791010090" } });
  assert.ok(sends().length > one, "второе «да» — не повтор");
});

test("пульт: ответ администратора клиенту Wazzapo уходит через Wazzapo и не задваивается, когда Wazzapo присылает о нём message.outgoing", async () => {
  net.reset(); net.ai = ["Здравствуйте! Чем помочь?"];
  const s = mk(ENV), from = "77051113313";
  await incoming(s, from, "Здравствуйте");
  const own = s.browser();
  await own.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Finbox" });
  const r = await own.post("/api/inbox/send", { c: "barber", ch: "wa", id: from, text: "Это администратор, запишу вас сам" });
  assert.equal(r.status, 200, await r.text());
  assert.ok(sends().some(x => x.body.text && /запишу вас сам/.test(x.body.text.body)), "ушло через Wazzapo");
  await hook(s, "message.outgoing", { sender: { type: "agent" }, contact: { phone: from }, message: { id: "wamid.pult1", to: from, type: "text", text: "Это администратор, запишу вас сам" } });
  const turns = s.hist("wa", "barber", from).turns.filter(t => /запишу вас сам/.test(t.text));
  assert.equal(turns.length, 1, JSON.stringify(turns));
});
