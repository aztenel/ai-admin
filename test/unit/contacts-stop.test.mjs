// Этап 1 D1 (31.10.2026): «СТОП» без опоры на повторную доставку вебхука Green-API. Запрет пишется в KV и D1; не записалось одно —
// след для починки; не записалось никуда или вебхук не пришёл вовсе — сверка журнала входящих Green-API находит «стоп» сама.
// Неоднозначный «стоп» — только в D1, «ждёт решения». Перенос «стопов» из KV в D1. Номера вымышленные.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { CLIENTS } from "../../src/config/builtin-clients.js";
import { stopSweep, syncFix, optoutMigrate, stopRecord, stopPending } from "../../src/services/contacts/stops.js";
import { contactsCard, contactsStatus, contactsReview, contactsSegments } from "../../src/services/contacts/index.js";

const skip = sqliteOk ? false : "node:sqlite есть только в Node 22+";
const W = CLIENTS.winchester, INST = { id: "7105000077", token: "ga-tok-w" };
const ENV = { GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
const P1 = "77000000801", P2 = "77000000802", P3 = "77000000803";
const rows = (d, sql, ...a) => d.raw.prepare(sql).all(...a);
const restr = (d, phone) => rows(d, "select r.* from restrictions r join contacts c on c.id = r.contact_id where c.phone = ?", phone);
const journal = list => { net.gaReply = rec => rec.op === "lastIncomingMessages" ? new Response(JSON.stringify(list), { headers: { "content-type": "application/json" } }) : null; };
const msg = (phone, text, id) => ({ type: "incoming", idMessage: id, timestamp: Math.floor(Date.now() / 1000) - 60, typeMessage: "textMessage", chatId: phone + "@c.us", senderName: "Клиент", textMessage: text });

test("«стоп» во второй номер (бот выключен): KV и D1, повтор вебхука — один запрет и одно событие", { skip }, async () => {
  net.reset();
  const d = d1With("production"), s = mk({ ...ENV, DB: d.db });
  await s.gaText("winchester", INST, P1, "СТОП", { idMessage: "IN-STOP-1" });
  await s.gaText("winchester", INST, P1, "СТОП", { idMessage: "IN-STOP-1" });
  assert.ok(s.kv.mem.get(`optout:winchester:${P1}`), "зеркало в KV");
  const r = restr(d, P1);
  assert.equal(r.length, 1); assert.equal(r[0].kind, "marketing_optout"); assert.equal(r[0].needs_review, 0);
  assert.equal(rows(d, "select count(*) n from events where kind = 'stop'")[0].n, 1);
  assert.equal(net.ga.filter(x => x.op === "sendMessage").length, 0, "бот на втором номере молчит");
});

test("KV не записался: запрет уже в D1, расхождение открыто, починка дописывает зеркало и закрывает", { skip }, async () => {
  net.reset();
  const d = d1With("production"), s = mk({ ...ENV, DB: d.db });
  s.kv.fail.put = k => k.startsWith("optout:");
  await s.gaText("winchester", INST, P2, "отписаться", { idMessage: "IN-STOP-2" });
  assert.equal(s.kv.mem.get(`optout:winchester:${P2}`), undefined);
  assert.equal(restr(d, P2).length, 1, "запрет в D1 действует");
  assert.equal(rows(d, "select count(*) n from sync_issues where kind = 'kv_write' and resolved_at is null")[0].n, 1);
  assert.ok(net.tg.some(m => /записан не во все хранилища/.test(m.text)), "сигнал в Telegram");
  const st = await contactsStatus(s.env, W, Date.now(), true);
  assert.equal(st.checks.find(c => c.id === "issues").level, "bad");
  s.kv.fail.put = null;
  assert.ok(await syncFix(s.env, Date.now(), true) >= 1);
  assert.ok(s.kv.mem.get(`optout:winchester:${P2}`), "зеркало дописано");
  assert.equal(rows(d, "select count(*) n from sync_issues where resolved_at is null")[0].n, 0);
});

test("D1 не ответила: «стоп» в KV и отметка syncerr:, починка переносит в D1, когда база снова отвечает", { skip }, async () => {
  net.reset();
  const d = d1With("production"), s = mk({ ...ENV, DB: d.db });
  await contactsStatus(s.env, W, Date.now(), true); // база проверена и в кэше
  d.ctl.fail = sql => /restrictions|contacts/.test(sql);
  await s.gaText("winchester", INST, P3, "Не пишите мне больше", { idMessage: "IN-STOP-3" });
  assert.ok(s.kv.mem.get(`optout:winchester:${P3}`));
  assert.ok(s.kv.mem.get(`syncerr:winchester:${P3}`), "след для починки");
  assert.equal(restr(d, P3).length, 0);
  d.ctl.fail = null;
  assert.ok(await syncFix(s.env, Date.now() + 61e3, true) >= 1);
  assert.equal(restr(d, P3).length, 1);
  assert.equal(s.kv.mem.get(`syncerr:winchester:${P3}`), undefined, "след убран");
});

test("вебхук не пришёл (или не записалось никуда): сверка журнала Green-API находит «стоп» и записывает", { skip }, async () => {
  net.reset();
  const d = d1With("production"), s = mk({ ...ENV, DB: d.db });
  // 1) не записалось никуда: KV и D1 отказали — «стоп» в памяти и сигнал
  s.kv.fail.put = () => true; d.ctl.fail = () => true;
  const r = await stopRecord(s.env, { ws: "winchester", phone: P1, kind: "stop", source: "chat_stop", at: Date.now() });
  assert.deepEqual(r, { kv: "fail", d1: "fail" });
  assert.ok(stopPending() >= 1);
  assert.ok(net.tg.some(m => /не записался ни в одно хранилище/.test(m.text)));
  s.kv.fail.put = null; d.ctl.fail = null;
  // 2) вебхук второго «стопа» не пришёл вовсе — только журнал входящих Green-API
  journal([msg(P2, "стоп", "IN-LOST-2"), msg(P3, "добрый день, есть время завтра?", "IN-3"), msg("77000000999", "Стоп, я перепутал время", "IN-4"), { ...msg("1", "стоп", "IN-G"), chatId: "120363000@g.us" }]);
  const out = await stopSweep(s.env, Date.now() + 61e3, { only: "winchester", force: true });
  assert.equal(out[0].ok, true); assert.equal(out[0].found, 1); assert.equal(out[0].review, 1);
  const q = net.ga.find(x => x.op === "lastIncomingMessages");
  assert.match(q.url, /lastIncomingMessages\/ga-tok-w\?minutes=\d+$/);
  assert.ok(s.kv.mem.get(`optout:winchester:${P2}`)); assert.equal(restr(d, P2).length, 1);
  assert.equal(s.kv.mem.get(`optout:winchester:77000000999`), undefined, "неоднозначный — не в KV");
  assert.equal(restr(d, "77000000999")[0].needs_review, 1);
  assert.ok(net.tg.some(m => /Сверка журнала Green-API нашла «стоп»/.test(m.text)));
  // повторная сверка — ничего нового, без второго сигнала
  const tg = net.tg.length;
  const out2 = await stopSweep(s.env, Date.now() + 700e3, { only: "winchester", force: true });
  assert.equal(out2[0].found, 0); assert.equal(net.tg.length, tg);
  assert.equal(restr(d, P2).length, 1);
  // починка из памяти дописывает первый «стоп»
  await syncFix(s.env, Date.now() + 120e3, true);
  assert.ok(s.kv.mem.get(`optout:winchester:${P1}`)); assert.equal(restr(d, P1).length, 1);
  // Green-API не ответил — ошибка видна на экране
  net.gaReply = rec => rec.op === "lastIncomingMessages" ? new Response("err", { status: 500 }) : null;
  const bad = await stopSweep(s.env, Date.now() + 800e3, { only: "winchester", force: true });
  assert.equal(bad[0].ok, false);
  const st = await contactsStatus(s.env, W, Date.now(), true);
  assert.match(st.stops.lastError, /500/);
});

test("неоднозначный «стоп»: маркетинг закрыт до решения; «оставить» — запрет подтверждён и в KV; ясный «стоп» снимает пометку", { skip }, async () => {
  net.reset();
  const d = d1With("production"), s = mk({ ...ENV, DB: d.db });
  await s.gaText("winchester", INST, P1, "стоп, я перепутал время", { idMessage: "IN-A1" });
  assert.equal(s.kv.mem.get(`optout:winchester:${P1}`), undefined);
  const r = restr(d, P1);
  assert.equal(r.length, 1); assert.equal(r[0].needs_review, 1);
  const id = rows(d, "select id from contacts where phone = ?", P1)[0].id;
  const card = await contactsCard(s.env, W, Date.now(), id);
  assert.ok(card.restrictions[0].review && card.canMarket.reasons.some(x => /ждёт решения/.test(x)));
  assert.equal((await contactsSegments(s.env, W, Date.now())).segments.find(x => x.id === "review").count, 1);
  // сотрудник не может снять запрет — ни словом, ни подменой типа (["lift"] через String() был бы «lift»)
  await assert.rejects(contactsReview(s.env, W, Date.now(), { id, rid: r[0].id, decision: "lift", reason: "просто так" }, "staff", false), e => e.code === "forbidden");
  await assert.rejects(contactsReview(s.env, W, Date.now(), { id, rid: r[0].id, decision: ["lift"], reason: "просто так" }, "staff", false), e => e.code === "input");
  assert.equal(restr(d, P1)[0].lifted_at, null, "запрет на месте");
  await contactsReview(s.env, W, Date.now(), { id, rid: r[0].id, decision: "keep" }, "staff", false);
  assert.equal(restr(d, P1)[0].needs_review, 0);
  assert.ok(s.kv.mem.get(`optout:winchester:${P1}`), "подтверждённый запрет — и для бота");
  // другой: неоднозначный, потом ясный «стоп» — пометка снимается, строка одна
  await s.gaText("winchester", INST, P2, "не пишите пока", { idMessage: "IN-A2" });
  await s.gaText("winchester", INST, P2, "стоп", { idMessage: "IN-A3" });
  const r2 = restr(d, P2);
  assert.equal(r2.length, 1); assert.equal(r2[0].needs_review, 0);
});

test("бот включён: «стоп» записывает и бот (think), и D1", { skip }, async () => {
  net.reset();
  const d = d1With("production"), s = mk({ ...ENV, DB: d.db, BOT_GA_WINCHESTER: "1" });
  net.ai = ["Здравствуйте!"];
  await s.gaText("winchester", INST, P3, "здравствуйте", { idMessage: "IN-B1" });
  await s.gaText("winchester", INST, P3, "стоп", { idMessage: "IN-B2" });
  assert.ok(s.kv.mem.get(`optout:winchester:${P3}`));
  assert.equal(restr(d, P3).length, 1);
});

test("боевой сайт без D1: «стоп» — как раньше в KV; KV отказал — память, сигнал и сверка журнала", { skip }, async () => {
  net.reset();
  const s = mk({ ...ENV });
  await s.gaText("winchester", INST, P1, "стоп", { idMessage: "IN-C1" });
  assert.ok(s.kv.mem.get(`optout:winchester:${P1}`));
  s.kv.fail.put = k => k.startsWith("optout:");
  await s.gaText("winchester", INST, P2, "стоп", { idMessage: "IN-C2" });
  assert.ok(net.tg.some(m => /не записался ни в одно хранилище/.test(m.text)));
  s.kv.fail.put = null;
  journal([msg(P2, "стоп", "IN-C2")]);
  await stopSweep(s.env, Date.now(), { only: "winchester", force: true });
  assert.ok(s.kv.mem.get(`optout:winchester:${P2}`), "сверка дописала");
});

test("перенос «стопов» из KV в D1: проверка без записи, перенос, повтор ничего не добавляет, ключи KV не удаляются", { skip }, async () => {
  net.reset();
  const d = d1With("production"), s = mk({ ...ENV, DB: d.db });
  await s.kv.api.put(`optout:winchester:${P1}`, String(Date.now() - 86400e3));
  await s.kv.api.put(`optout:winchester:${P2}`, "meta:" + (Date.now() - 2 * 86400e3));
  await s.kv.api.put(`optout:winchester:bad-key`, "1");
  await s.kv.api.put(`optout:barber:${P3}`, "1");
  const dry = await optoutMigrate(s.env, "winchester", Date.now(), true);
  assert.equal(dry.keys, 3); assert.equal(dry.bad, 1); assert.equal(dry.meta, 1); assert.equal(dry.before, 0);
  assert.equal(rows(d, "select count(*) n from restrictions")[0].n, 0, "проверка ничего не пишет");
  const m1 = await optoutMigrate(s.env, "winchester", Date.now(), false);
  assert.equal(m1.added, 2); assert.equal(m1.after, 2);
  assert.ok(m1.summary.some(l => /совпадает ✅/.test(l)));
  assert.equal(restr(d, P2)[0].reason, "Meta stop button");
  const m2 = await optoutMigrate(s.env, "winchester", Date.now(), false);
  assert.equal(m2.added, 0); assert.equal(m2.after, 2);
  assert.ok(s.kv.mem.get(`optout:winchester:${P1}`) && s.kv.mem.get(`optout:winchester:${P2}`), "ключи KV на месте");
  assert.equal(restr(d, P3).length, 0, "чужая компания не тронута");
});
