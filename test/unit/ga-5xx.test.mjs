// Green-API принял сообщение, но ответил ошибкой 5xx (или не ответил вовсе): сообщение могло уйти. Автоматические напоминания по журналу
// Altegio и рассылки со второго номера такому получателю второй раз не пишут; в переписке — «неизвестно» с причиной; в отчёте рассылки —
// «неизвестно, дошло ли», а не «не отправлено». Подтверждённый отказ (4xx) — по-прежнему отказ (01.11.2026, перед приёмкой Winchester).
// До исправления 5xx считался «временным сбоем»: напоминание через минуту уходило ещё раз, получатель рассылки — через 10 минут.
// Всё на заглушках: Green-API — net.ga (запрос записывается до ответа заглушки, как если бы Green-API его принял), журнал — net.altJournal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, gaPass } from "../harness.mjs";
import { jrRun } from "../../src/services/reminders/journal.js";
import { atLocal } from "../../src/services/reminders/plan.js";
import { SCENARIOS } from "../../src/services/reminders/templates.js";
import { crmBuild as crmBuild0 } from "../../src/services/crm/snapshot.js";
import { grantSnap, consentSkip } from "../consent.mjs";
import { bcCreate } from "../../src/services/broadcast/create.js";
import { bcTick } from "../../src/services/broadcast/sender.js";
import { gaKind, gaCode, gaUnsure } from "../../src/services/integrations/greenapi/client.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";
import { autoOn, legacyOn } from "../automsg.mjs";

const W = CLIENTS.winchester, INST = { id: "7105000099", token: "ga-tok-5xx" };
const GA = { GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
const JR = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", REMIND_GA_WINCHESTER: "1", ...GA };
const sends = () => net.ga.filter(x => x.op === "sendMessage");
const J = (o, status) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
/** первая отправка — ответ reply (Green-API её уже записал), остальные — как обычно */
const firstSend = reply => { let n = 0; net.gaReply = rec => rec.op === "sendMessage" && !n++ ? reply() : null; };
const hook = (s, body) => s.call(`/ga/winchester?t=${gaPass("winchester", INST)}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ instanceData: { idInstance: +INST.id, wid: "77000000099@c.us" }, timestamp: Math.floor(Date.now() / 1000), ...body }) });

// ---- напоминания по журналу Altegio со второго номера

const P = "+77000005001", D = "77000005001";
/** напоминание «накануне» (завтра в 15:00) запланировано в 17:00; в 18:00 Green-API отвечает reply; потом — ещё несколько минут работы */
async function remind(reply) {
  net.reset();
  net.altJournal = [{ id: 95001, datetime: "2026-10-20T15:00:00+05:00", deleted: false, attendance: 0, create_date: "2026-10-18T12:00:00+05:00",
    staff: { id: 1, name: "Тони" }, client: { id: 1, phone: P, name: "Арман" }, services: [{ id: 1, title: "Мужская стрижка" }] }];
  const s = mk(JR);
  await s.kv.api.put("svtpl:winchester", JSON.stringify(Object.fromEntries(SCENARIOS.filter(x => x.auto).map(x => [x.id, { v: x.v, at: 1 }]))));
  await autoOn(s, legacyOn(CLIENTS.winchester)); // сценарии включены в разделе «Автоматические сообщения» (по умолчанию выключены)
  await jrRun(s.env, atLocal("2026-10-19", "17:00"));
  firstSend(reply);
  for (const t of ["18:00", "18:01", "18:02", "18:15", "18:30", "20:00"]) await jrRun(s.env, atLocal("2026-10-19", t));
  net.gaReply = null;
  return s;
}
const lastTurn = s => { const h = s.hist("ga", "winchester", D); return h && h.turns.filter(t => t.rm)[0]; };
const okMarks = s => [...s.kv.mem.keys()].filter(k => k.startsWith("rmok:"));
const decisions = s => s.kv.json("jrl:winchester") || [];

test("напоминание: Green-API принял, но ответил 500 — второй раз не шлём; в переписке «неизвестно» с причиной; номер не на паузе", async () => {
  const s = await remind(() => J({ message: "Internal Server Error" }, 500));
  assert.equal(sends().length, 1, "напоминание «накануне» — одна попытка, без повторов");
  const t = lastTurn(s);
  assert.equal(t && t.st, "unknown", JSON.stringify(t));
  assert.match(String(t.se || ""), /500/); assert.match(String(t.se || ""), /могло уйти/);
  assert.equal(await s.kv.api.get("jrhold:winchester"), null, "сбой у Green-API — не блокировка номера");
  const p = s.hist("ga", "winchester", D).profile || {};
  assert.ok(!p.need, "неизвестно — не «не дошло»: чат не встаёт в «Нужен ответ» как неотправленный");
  const d = decisions(s).filter(x => x.p === D);
  assert.ok(d.some(x => x.st === "unknown" && /500/.test(x.why) && /второй раз не/i.test(x.why)), JSON.stringify(d));
  assert.ok(!d.some(x => x.st === "task" || x.st === "sent"), JSON.stringify(d));
  assert.equal(okMarks(s).length, 0, "в «ушло» не считается: удачной отправки никто не подтвердил");
  assert.ok(!net.tg.some(x => /остановлены|не ушло/.test(x.text || "")), JSON.stringify(net.tg));
});

test("напоминание: 502 и 503 от Green-API — тоже «неизвестно», одна попытка", async () => {
  for (const status of [502, 503, 504]) {
    const s = await remind(() => new Response("<html>Bad Gateway</html>", { status }));
    assert.equal(sends().length, 1, "код " + status);
    assert.equal(lastTurn(s).st, "unknown", "код " + status);
  }
});

test("напоминание: 500 с номером сообщения в ответе — номер сохраняется, и отчёт Green-API «доставлено» уточняет статус", async () => {
  const s = await remind(() => J({ idMessage: "BAE5005000500", message: "Internal Server Error" }, 500));
  assert.equal(sends().length, 1);
  let t = lastTurn(s);
  assert.equal(t.st, "unknown"); assert.equal(t.mid, "BAE5005000500");
  await hook(s, { typeWebhook: "outgoingMessageStatus", chatId: D + "@c.us", idMessage: "BAE5005000500", status: "delivered", sendByApi: true });
  t = lastTurn(s);
  assert.equal(t.st, "delivered", "провайдер подтвердил доставку — статус поднялся");
});

test("напоминание (контроль): подтверждённый отказ 400 — «не ушло», задача администратору; 429 — повтор в следующую минуту", async () => {
  let s = await remind(() => J({ message: "Validation failed" }, 400));
  assert.equal(sends().length, 1);
  assert.equal(lastTurn(s).st, "failed");
  assert.equal((s.hist("ga", "winchester", D).profile || {}).need?.why, "send");
  s = await remind(() => J({ message: "Too Many Requests" }, 429));
  assert.equal(sends().length, 2, "429 — Green-API не принял: следующая минута — повтор");
  assert.equal(lastTurn(s).st, "sent");
});

// ---- рассылка со второго номера по базе (запуск выключен gaNoBroadcast — снимается только внутри проверки и возвращается)

const NOW = Date.now();
const day = n => new Date(NOW - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
let rid = 9500;
const rec = (phone, n, name, staff) => ({ id: ++rid, datetime: `${day(n)}T12:00:00+05:00`, deleted: false, attendance: 1, staff: { id: 1, name: staff },
  client: { id: +phone.replace(/\D/g, "").slice(-6), phone, name }, services: [{ id: 1, title: "Мужская стрижка" }] });
const DRAFT = { c: "winchester", ch: "ga", name: "Пора на стрижку", tplId: "M03", lang: "ru", segment: "pora", cap: 50, from: 8, to: 22, consent: true };

/** рассылка двум клиентам; первая отправка — ответ reply; фоновая отправка идёт, пока рассылка не закончится (паузы пропускаются) */
async function campaign(reply) {
  net.reset();
  net.altJournal = [rec("+77000005101", 25, "Арман", "Тони"), rec("+77000005102", 30, "Ерлан", "Айдос")];
  const s = mk({ ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", ...GA });
  await crmBuild0(s.env, W, NOW); await grantSnap(s.env, "winchester");
  const was = W.gaNoBroadcast;
  W.gaNoBroadcast = false;
  try {
    const r = await bcCreate(s.env, W, DRAFT, Date.now(), "owner", { start: true });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.b.total, 2);
    firstSend(reply);
    const key = "bc:winchester:" + r.b.id;
    for (let i = 0; i < 12; i++) {
      const b = s.kv.json(key);
      if (b.status !== "running") break;
      if (b.nextAt) b.nextAt = Date.now() - 1;
      if (b.retryAt) b.retryAt = Date.now() - 1; // «через 10 минут» — сейчас
      s.kv.mem.set(key, JSON.stringify(b));
      await bcTick(s.env, "winchester", r.b.id);
    }
    net.gaReply = null;
    return { s, b: s.kv.json(key) };
  } finally { W.gaNoBroadcast = was; }
}
const perTo = () => sends().reduce((m, x) => { const to = String(x.body.chatId).replace("@c.us", ""); m[to] = (m[to] || 0) + 1; return m; }, {});

test("рассылка со второго номера: Green-API принял, но ответил 500 — этому клиенту второй раз не пишем; в отчёте «неизвестно», не «ошибка»", { skip: consentSkip }, async () => {
  const { s, b } = await campaign(() => J({ message: "Internal Server Error" }, 500));
  const first = String(sends()[0].body.chatId).replace("@c.us", "");
  assert.deepEqual(Object.values(perTo()), [1, 1], "каждому — одно сообщение: " + JSON.stringify(perTo()));
  assert.equal(b.status, "done", JSON.stringify(b));
  assert.equal(b.sent, 1); assert.equal(b.failed || 0, 0, "неизвестно — не «не отправлено»"); assert.equal(b.unsure, 1);
  assert.ok(!(b.bad || []).some(x => x[0] === first), "в списке «не дошло» его нет");
  const t = s.hist("ga", "winchester", first).turns.find(x => x.by === "bc");
  assert.equal(t && t.st, "unknown", "в переписке — то же сообщение с «неизвестно»");
  assert.match(String(t.se || ""), /500/);
  const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  assert.ok((s.kv.json(`bcm:winchester:${today}`) || []).includes(first), "реклама могла уйти: 30 дней этому номеру рекламу не пишем");
  assert.ok(net.tg.some(x => /Неизвестно/.test(x.text || "")), "в итоге рассылки владельцу — сколько неизвестно");
});

test("рассылка со второго номера: Green-API не ответил (408, обрыв) — «неизвестно», а не «ошибка»; повтора нет", { skip: consentSkip }, async () => {
  for (const reply of [() => J({ message: "Request Timeout" }, 408), () => { throw new Error("socket hang up"); }]) {
    const { s, b } = await campaign(reply);
    const first = String(sends()[0].body.chatId).replace("@c.us", "");
    assert.deepEqual(Object.values(perTo()), [1, 1], JSON.stringify(perTo()));
    assert.equal(b.failed || 0, 0); assert.equal(b.unsure, 1);
    assert.equal(s.hist("ga", "winchester", first).turns.find(x => x.by === "bc").st, "unknown");
  }
});

test("рассылка со второго номера (контроль): подтверждённый отказ 400 — «не отправлено», клиенту не повторяем", { skip: consentSkip }, async () => {
  const { b } = await campaign(() => J({ message: "Validation failed" }, 400));
  assert.deepEqual(Object.values(perTo()), [1, 1]);
  assert.equal(b.failed, 1); assert.equal(b.unsure || 0, 0); assert.equal(b.sent, 1);
});

test("классификация: 5xx, 408, 499 и нет ответа — «неизвестно» (не повторять); 400, 401, 403, 429, 466 — подтверждённый отказ", () => {
  for (const status of [0, 408, 499, 500, 502, 503, 504]) {
    assert.equal(gaKind(gaCode({ status })), "net", "код " + status);
    assert.equal(gaUnsure({ ok: false, status }), true, "код " + status);
  }
  for (const status of [400, 401, 403, 429, 466]) { assert.notEqual(gaKind(gaCode({ status })), "net", "код " + status); assert.equal(gaUnsure({ ok: false, status }), false); }
  assert.equal(gaUnsure({ ok: false, status: 400, j: { idMessage: "BAE5" } }), true, "в ответе номер сообщения — Green-API его создал: не отказ");
});
