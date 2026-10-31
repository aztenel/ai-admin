// Сервисные сообщения по журналу Altegio со второго номера — ТЗ Winchester v2.0 §4 (31.10.2026): версия записи в отметке «уже
// отправляли» (перенос с тем же номером записи), отмена старых задач, неявка и сбой отправки — задача администратору, текст —
// только одобренный владельцем, язык чата, проверка по журналу без отправки и без записи. Всё на заглушках (net.altJournal,
// net.ga), номера вымышленные (+7 700 000 3x xx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { jrRun, jrPlan } from "../../src/services/reminders/journal.js";
import { SCENARIOS, svText, render } from "../../src/services/reminders/templates.js";
import { atLocal, remindText } from "../../src/services/reminders/plan.js";
import { jrqSave } from "../../src/db/kv/reminders.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";

const W = CLIENTS.winchester, INST = { id: "7105000099", token: "ga-tok-sv" };
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token, REMIND_GA_WINCHESTER: "1" };
const TODAY = "2026-10-19", TOM = "2026-10-20", YDAY = "2026-10-18";
const at = (date, time) => atLocal(date, time);
let rid = 900;
const rec = (phone, date, time, o = {}) => ({ id: o.id || ++rid, datetime: `${date}T${time}:00+05:00`, deleted: !!o.del, attendance: o.att ?? 0,
  create_date: o.made || `${YDAY}T12:00:00+05:00`, staff: { id: o.sid || 1, name: o.staff || "Тони" }, client: { id: 1, phone, name: o.name ?? "Клиент" },
  services: [{ id: o.svcId || 1, title: o.svc || "Мужская стрижка" }] });
const ph = i => "+7700000" + String(i).padStart(4, "0");
const dg = i => ph(i).slice(1);
const sent = () => net.ga.filter(x => x.op === "sendMessage").map(x => ({ to: x.body.chatId.replace("@c.us", ""), text: x.body.message }));
// владелец одобрил тексты (svtpl:<клиент>): без одобрения ничего не уходит
const approve = async (s, ids = SCENARIOS.filter(x => x.auto).map(x => x.id)) =>
  s.kv.api.put("svtpl:winchester", JSON.stringify(Object.fromEntries(ids.map(id => [id, { v: SCENARIOS.find(x => x.id === id).v, at: 1 }]))));
const login = async (s, key) => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${key}&next=%2Finbox` }); return b; };
const post = (b, path, body) => b.post(path, body);
const log = s => s.kv.json("jrl:winchester") || [];

test("каталог: S01–S18, у каждого режим; тексты напоминаний те же, что раньше (ru, kk, en); шаблон без данных — без пустых кусков", () => {
  assert.deepEqual(SCENARIOS.map(x => x.id), Array.from({ length: 18 }, (_, i) => "S" + String(i + 1).padStart(2, "0")));
  for (const x of SCENARIOS) {
    assert.ok(["auto", "reply", "task", "off"].includes(x.mode), x.id);
    assert.ok(x.title && x.trigger && x.v >= 1, x.id);
    if (x.auto) assert.ok(x.ru.length && x.kk.length, x.id + ": RU и KZ"); // свой вид в очереди — свой текст
  }
  const b = { time: "15:00", services: "Мужская стрижка", staffName: "Айдос" };
  assert.equal(remindText(W, b, "d1"), "Напоминаем: завтра в 15:00 вас ждут в «Winchester» — Мужская стрижка · Айдос. Если планы изменились, напишите сюда.");
  assert.equal(remindText(W, { time: "15:00" }, "d1", "kk"), "Еске салу: «Winchester» сізді ертең сағат 15:00-де күтеді. Жоспарыңыз өзгерсе, осында жазыңыз.");
  assert.match(remindText(W, b, "h2"), /^Ждём вас сегодня в 15:00 в «Winchester» \(Мужская стрижка · Айдос\)\. Адрес: Астана, проспект Кабанбай Батыра, 18\. /);
  assert.match(remindText(W, b, "rv", "en"), /^Thank you for visiting «Winchester»! We'd be grateful for a review: https:\/\/2gis/);
  assert.equal(render("Здравствуйте[[, {имя}]]! В {время}[[ — {мастер}]].", { имя: "", время: "12:00", мастер: "Тони" }), "Здравствуйте! В 12:00 — Тони.");
  const s01 = svText(W, "s01", { name: "Арман Каримов", date: TOM, time: "15:00", services: "Мужская стрижка", staffName: "Айдос" }, "ru");
  assert.equal(s01.sc, "S01");
  assert.ok(/Арман!/.test(s01.text) && /20 октября в 15:00/.test(s01.text) && /Кабанбай Батыра/.test(s01.text) && !/Каримов/.test(s01.text), s01.text);
  assert.match(svText(W, "s01", { date: TOM, time: "15:00" }, "kk").text, /20 қазан/);
});

test("версия записи: перенос с тем же номером записи — новое напоминание с новым временем, старое «за 2 часа» отменено", async () => {
  net.reset();
  const a = rec(ph(301), TOM, "15:00", { id: 3001, name: "Арман" });
  net.altJournal = [a];
  const s = mk(ENV); await approve(s);
  await jrRun(s.env, at(TODAY, "17:50"));
  await jrRun(s.env, at(TODAY, "18:00"));
  assert.equal(sent().length, 1); assert.match(sent()[0].text, /завтра в 15:00/);
  a.datetime = `${TOM}T19:00:00+05:00`; // администратор перенёс в Altegio — номер записи тот же
  await jrRun(s.env, at(TODAY, "18:20")); // журнал перечитан
  await jrRun(s.env, at(TODAY, "18:21"));
  assert.equal(sent().length, 2, JSON.stringify(sent()));
  assert.match(sent()[1].text, /завтра в 19:00/);
  const L = log(s);
  assert.ok(L.some(x => x.k === "h2" && x.time === "15:00" && x.st === "cancelled" && /перенес/.test(x.why)), JSON.stringify(L));
  assert.ok(L.filter(x => x.st === "sent").length === 2);
  await jrRun(s.env, at(TODAY, "18:40")); await jrRun(s.env, at(TODAY, "18:41"));
  assert.equal(sent().length, 2, "повторно не шлём");
  // общая отметка с напоминаниями бота — с версией: бот по этой записи второй раз не напомнит
  assert.ok(String(await s.kv.api.get("rms:winchester:3001:d1")).length > 1);
});

test("переход со старых отметок: отметка без версии («1» — бот или прежний код) не даёт отправить второй раз", async () => {
  net.reset();
  net.altJournal = [rec(ph(311), TOM, "15:00", { id: 3011 })];
  const s = mk(ENV); await approve(s);
  await s.kv.api.put("rms:winchester:3011:d1", "1", { expirationTtl: 3 * 86400 });
  await jrRun(s.env, at(TODAY, "17:50")); await jrRun(s.env, at(TODAY, "18:00"));
  assert.deepEqual(sent(), []);
  assert.ok(log(s).some(x => x.rec === "3011" && x.st === "skipped" && /уже отправ/.test(x.why)), JSON.stringify(log(s)));
});

test("удалена, время прошло, не пришёл — не шлём; неявка — задача администратору в чате, один раз", async () => {
  net.reset();
  const del = rec(ph(321), TOM, "15:00", { id: 3021 }), past = rec(ph(322), TODAY, "11:00", { id: 3022 }), miss = rec(ph(323), TODAY, "12:00", { id: 3023, att: -1, name: "Ерлан" });
  net.altJournal = [del, past, miss];
  const s = mk(ENV); await approve(s);
  await jrRun(s.env, at(TODAY, "17:50"));
  del.deleted = true;
  // напоминание по записи, время которой уже прошло (очередь осталась с прошлого запуска), — не уходит
  const q = JSON.parse(await s.kv.api.get("jrq:winchester"));
  q.push({ rec: "3022", p: dg(322), n: "Клиент", date: TODAY, time: "11:00", staff: "Тони", svc: "Мужская стрижка", k: "h2", at: at(TODAY, "17:55") }); // очередь до версий записи (без v)
  await jrqSave(s.env, "winchester", q);
  await jrRun(s.env, at(TODAY, "18:00")); await jrRun(s.env, at(TODAY, "18:01"));
  assert.deepEqual(sent(), [], JSON.stringify(sent()));
  const L = log(s);
  assert.ok(L.some(x => x.rec === "3021" && /удален/.test(x.why)), JSON.stringify(L));
  assert.ok(L.some(x => x.rec === "3022" && /прошл/.test(x.why)), JSON.stringify(L));
  const h = s.hist("ga", "winchester", dg(323));
  assert.equal(h.profile.need.why, "noshow"); assert.equal(h.turns.length, 0, "клиенту ничего не пишем");
  const t0 = h.profile.need.at;
  await jrRun(s.env, at(TODAY, "18:30"));
  assert.equal(s.hist("ga", "winchester", dg(323)).profile.need.at, t0, "второй раз задачу не поднимаем");
  assert.ok(L.some(x => x.rec === "3023" && x.st === "task"), JSON.stringify(L));
});

test("сбой отправки: не больше 3 попыток, потом задача администратору (чат «не дошло», сообщение со статусом failed) и один Telegram", async () => {
  net.reset();
  net.altJournal = [rec(ph(331), TOM, "15:00", { id: 3031, name: "Тимур" })];
  const s = mk(ENV); await approve(s);
  await jrRun(s.env, at(TODAY, "17:50"));
  net.gaReply = r => r.op === "sendMessage" ? new Response(JSON.stringify({ message: "Too Many Requests" }), { status: 429 }) : null;
  for (const t of ["18:00", "18:01", "18:02", "18:03", "18:04"]) await jrRun(s.env, at(TODAY, t));
  assert.equal(net.ga.filter(x => x.op === "sendMessage").length, 3, "три попытки — и всё");
  const h = s.hist("ga", "winchester", dg(331));
  assert.equal(h.profile.need.why, "send");
  const t = h.turns.at(-1);
  assert.equal(t.st, "failed"); assert.equal(t.rm, "d1"); assert.ok(t.se, "причина ошибки");
  assert.equal(net.tg.filter(x => /не ушл|не дош/i.test(x.text || "")).length, 1, JSON.stringify(net.tg));
  assert.ok(log(s).some(x => x.rec === "3031" && x.st === "task"));
  net.gaReply = null;
});

test("номера нет в WhatsApp (400) — сразу задача; обрыв связи — «неизвестно», без повтора и без задачи", async () => {
  net.reset();
  net.altJournal = [rec(ph(341), TOM, "15:00", { id: 3041 }), rec(ph(342), TOM, "16:00", { id: 3042 })];
  const s = mk(ENV); await approve(s);
  await jrRun(s.env, at(TODAY, "17:50"));
  net.gaReply = r => r.op === "sendMessage" ? (r.body.chatId.startsWith(dg(341)) ? new Response(JSON.stringify({ message: "Bad Request" }), { status: 400 }) : new Response("", { status: 499 })) : null;
  for (const t of ["18:00", "18:01", "18:02"]) await jrRun(s.env, at(TODAY, t));
  assert.equal(net.ga.filter(x => x.op === "sendMessage").length, 2, "каждое — один раз");
  assert.equal(s.hist("ga", "winchester", dg(341)).profile.need.why, "send");
  const u = s.hist("ga", "winchester", dg(342));
  assert.equal(u.turns.at(-1).st, "unknown"); assert.ok(!u.profile.need, "неизвестно — не задача: могло уйти");
  net.gaReply = null;
});

test("исходящее в переписке — с номером сообщения Green-API и статусом sent; язык — как у чата (kk)", async () => {
  net.reset();
  net.altJournal = [rec(ph(351), TOM, "15:00", { id: 3051 }), rec(ph(352), TOM, "16:00", { id: 3052 })];
  const s = mk(ENV); await approve(s);
  await s.kv.api.put(`h:ga:winchester:${dg(352)}`, JSON.stringify({ n: 1, turns: [{ role: "user", text: "Сәлем", t: 1 }], profile: { lang: "kk" } }));
  await jrRun(s.env, at(TODAY, "17:50")); await jrRun(s.env, at(TODAY, "18:00"));
  const t = s.hist("ga", "winchester", dg(351)).turns.at(-1);
  assert.match(t.mid, /^GA\d+$/); assert.equal(t.st, "sent"); assert.equal(t.rm, "d1");
  assert.match(sent().find(x => x.to === dg(352)).text, /^Еске салу/);
  assert.match(sent().find(x => x.to === dg(351)).text, /^Напоминаем/);
});

test("текст не одобрен владельцем — не уходит; одобрение старой версии не подходит", async () => {
  net.reset();
  net.altJournal = [rec(ph(361), TOM, "15:00", { id: 3061 })];
  const s = mk(ENV);
  await jrRun(s.env, at(TODAY, "17:50")); await jrRun(s.env, at(TODAY, "18:00"));
  assert.deepEqual(sent(), []);
  assert.ok(log(s).some(x => x.rec === "3061" && /не одобрен/.test(x.why)), JSON.stringify(log(s)));
  const S03 = SCENARIOS.find(x => x.id === "S03");
  await s.kv.api.put("svtpl:winchester", JSON.stringify({ S03: { v: S03.v - 1, at: 1 } }));
  await jrRun(s.env, at(TODAY, "18:30"));
  assert.deepEqual(sent(), [], "одобрена прежняя версия текста");
});

test("S01 подтверждение новой записи: выключено по умолчанию; включено и одобрено — свежей записи из журнала, но не старой и не записи бота", async () => {
  const now = at(TODAY, "12:00");
  const fresh = rec(ph(371), TOM, "15:00", { id: 3071, made: `${TODAY}T11:50:00+05:00`, name: "Арман" });
  const old = rec(ph(372), TOM, "16:00", { id: 3072, made: `${YDAY}T12:00:00+05:00` }); // вчера — подтверждать поздно
  assert.ok(!jrPlan(W, [fresh], now).some(x => x.k === "s01"), "по умолчанию выключено");
  const was = W.jr.s01; W.jr.s01 = true;
  try {
    const items = jrPlan(W, [fresh, old], now);
    assert.deepEqual(items.filter(x => x.k === "s01").map(x => x.rec), ["3071"]);
    net.reset();
    const bot = rec(ph(373), TOM, "17:00", { id: 3073, made: `${TODAY}T11:55:00+05:00` });
    net.altJournal = [fresh, old, bot];
    const s = mk(ENV); await approve(s);
    await s.kv.api.put(`h:ga:winchester:${dg(373)}`, JSON.stringify({ n: 1, turns: [], profile: { bookings: [{ record_id: 3073, date: TOM, time: "17:00" }] } }));
    await jrRun(s.env, now); await jrRun(s.env, now + 6 * 60e3); await jrRun(s.env, now + 7 * 60e3);
    const s01 = sent().filter(x => /Вы записаны/.test(x.text));
    assert.deepEqual(s01.map(x => x.to), [dg(371)], JSON.stringify(sent()));
    assert.match(s01[0].text, /Арман/); assert.match(s01[0].text, /Кабанбай Батыра/);
  } finally { W.jr.s01 = was; }
});

test("проверка по журналу без отправки: только владелец, номера маской, имя — только первое слово, ничего не пишет и не шлёт", async () => {
  net.reset();
  const now = Date.now(), tom = new Date(now + 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
  const made = "2026-09-01T12:00:00+05:00";
  net.altJournal = [rec(ph(381), tom, "15:00", { id: 3081, name: "Арман Каримов", made }), rec(ph(382), tom, "16:00", { id: 3082, made }), rec("+7 700 XXX-X1-05", tom, "17:00", { id: 3083, made })];
  const { REMIND_GA_WINCHESTER, ...off } = ENV; // отправка выключена — проверка всё равно работает
  const s = mk({ ...off, KEY_WINCHESTER: "staff-key-winch-0001" });
  await s.kv.api.put(`optout:winchester:${dg(382)}`, "1");
  const own = await login(s, "owner-key-123456"), staff = await login(s, "staff-key-winch-0001");
  assert.equal((await post(staff, "/api/bc/service/dry", { c: "winchester" })).status, 403);
  const before = { ...s.kv.ops };
  const r = await post(own, "/api/bc/service/dry", { c: "winchester" }), txt = await r.text(), j = JSON.parse(txt);
  assert.equal(r.status, 200, txt);
  assert.equal(s.kv.ops.put, before.put, "в KV ничего не записано"); assert.equal(s.kv.ops.del, before.del);
  assert.deepEqual(sent(), []);
  assert.equal(j.enabled, false); assert.equal(j.records, 3);
  assert.ok(!txt.includes(dg(381)) && !txt.includes(dg(382)) && !txt.includes("Каримов"), txt);
  const a = j.items.filter(x => x.phone === "+7 700 *** ** 81");
  assert.ok(a.length >= 2 && a.every(x => x.name === "Арман" && x.text), JSON.stringify(a));
  assert.ok(j.items.some(x => x.phone === "+7 700 *** ** 82" && x.status === "skip" && /не писать/.test(x.why)), JSON.stringify(j.items));
  assert.ok(j.skipped.some(x => /скрыт|номер/.test(x.why)), JSON.stringify(j.skipped));
  assert.ok(j.items.some(x => x.status === "skip" && /не одобрен/.test(x.why)), "тексты не одобрены — так и сказано");
});

test("пульт: каталог в /api/bc/service; одобрить текст может только владелец; журнал решений — номера маской", async () => {
  net.reset();
  const s = mk({ ...ENV, KEY_WINCHESTER: "staff-key-winch-0001" });
  const own = await login(s, "owner-key-123456"), staff = await login(s, "staff-key-winch-0001");
  const j = await (await own.go("/api/bc/service?c=winchester")).json();
  assert.equal(j.catalog.length, 18);
  const s03 = j.catalog.find(x => x.id === "S03");
  assert.equal(s03.mode, "auto"); assert.equal(s03.approved, false); assert.ok(s03.preview.ru && s03.preview.kk, JSON.stringify(s03));
  assert.equal((await post(staff, "/api/bc/service/approve", { c: "winchester", id: "S03", v: s03.v })).status, 403);
  assert.equal((await post(own, "/api/bc/service/approve", { c: "winchester", id: "S03", v: s03.v - 1 })).status, 409, "одобряют текущую версию");
  assert.equal((await post(own, "/api/bc/service/approve", { c: "winchester", id: "S08", v: 1 })).status, 400, "S08 сам не уходит — одобрять нечего");
  assert.equal((await post(own, "/api/bc/service/approve", { c: "winchester", id: "S03", v: s03.v })).status, 200);
  assert.equal((await (await own.go("/api/bc/service?c=winchester")).json()).catalog.find(x => x.id === "S03").approved, true);
  assert.equal((await post(own, "/api/bc/service/approve", { c: "winchester", id: "S03", v: s03.v, on: false })).status, 200);
  assert.equal((await (await own.go("/api/bc/service?c=winchester")).json()).catalog.find(x => x.id === "S03").approved, false, "одобрение снимается");
  await s.kv.api.put("jrl:winchester", JSON.stringify([{ t: 1, k: "d1", rec: "1", p: dg(391), n: "Арман", date: TOM, time: "15:00", st: "cancelled", why: "запись перенесена" }]));
  const t = await (await own.go("/api/bc/service?c=winchester")).text();
  assert.ok(t.includes("+7 700 *** ** 91") && !t.includes(dg(391)), t.slice(0, 400));
});
