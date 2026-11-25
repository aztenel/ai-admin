// «Только Meta» у Winchester (решение владельца 19.11.2026: «дальше только по Meta, желательно через Wazzapo»): второй номер (Green-API)
// отключён целиком (gaDisabled, GA_LINE_WINCHESTER), сервисные сообщения по журналу Altegio уходят с основного номера одобренными
// шаблонами Meta через Wazzapo (jr.via = "wa", waTpl, REMIND_WA_WINCHESTER). Всё на заглушках: журнал — net.altJournal, Wazzapo — net.wz.
// Номера вымышленные (+7 700 000 7x xx). Вживую не проверено: нужен оплаченный тариф Wazzapo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { autoOn } from "../automsg.mjs";
import { jrRun } from "../../src/services/reminders/journal.js";
import { jrTpl, jrTplFill, waKind } from "../../src/services/reminders/watpl.js";
import { gaRoute } from "../../src/services/integrations/greenapi/webhook.js";
import { atLocal } from "../../src/services/reminders/plan.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";

const W = CLIENTS.winchester;
// как будет на боевом сайте после оплаты Wazzapo: второй номер в Cloudflare ещё есть, но отключён в паспорте
const ENV = { GA_LINE_WINCHESTER: "", REMIND_VIA_WINCHESTER: "", ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok",
  GA_ID_WINCHESTER: "7105000077", GA_TOKEN_WINCHESTER: "ga-tok-meta-only",
  WA_VIA_WINCHESTER: "wazzapo", WA_TOKEN_WINCHESTER: "wz_live_meta", APP_SECRET_WINCHESTER: "hook-meta", PHONE_NUMBER_ID_WINCHESTER: "pn-702",
  REMIND_WA_WINCHESTER: "1", ...(sqliteOk ? { DB: d1With("production").db } : {}) };
const TODAY = "2026-11-20", TOM = "2026-11-21", YDAY = "2026-11-19";
const at = (d, t) => atLocal(d, t);
const rec = (phone, date, time, o = {}) => ({ id: o.id, datetime: `${date}T${time}:00+05:00`, deleted: false, attendance: o.att ?? 0,
  create_date: o.made || `${YDAY}T12:00:00+05:00`, staff: { id: 1, name: o.staff || "Тони" }, client: { id: 1, phone, name: o.name ?? "Арман" },
  services: [{ id: 1, title: o.svc || "Мужская стрижка" }] });
const tpls = () => net.wz.filter(x => x.path === "/messages/send").map(x => ({ to: x.body.to, type: x.body.type, name: x.body.template && x.body.template.name,
  lang: x.body.template && x.body.template.language.code, params: ((x.body.template && x.body.template.components) || []).flatMap(c => c.parameters.map(p => p.text)) }));
const login = async (s, key) => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${key}&next=%2Fapp%2F` }); return b; };

test("второй номер отключён: в паспорте — нет номера Green-API; GA_LINE_WINCHESTER = 1 возвращает", () => {
  assert.equal(gaRoute({ GA_ID_WINCHESTER: "1", GA_TOKEN_WINCHESTER: "t" }, "winchester"), null);
  assert.equal(gaRoute({ GA_ID: "1", GA_TOKEN: "t", GA_CLIENT: "winchester" }, "winchester"), null, "общий номер, закреплённый за Winchester, — тоже нет");
  assert.ok(gaRoute({ GA_ID_WINCHESTER: "1", GA_TOKEN_WINCHESTER: "t", GA_LINE_WINCHESTER: "1" }, "winchester"));
  assert.ok(gaRoute({ GA_ID_BARBER: "1", GA_TOKEN_BARBER: "t" }, "barber"), "у других компаний — как раньше");
});

test("шаблоны: подстановки по записи журнала, язык как в кабинете Pushon (ru), без имени — «дорогой гость», нет мастера — не шлём", () => {
  const t = jrTpl({}, W, "s01");
  assert.equal(t.name, "zapis_podtverzhdena_1794696655812"); assert.equal(t.lang, "ru");
  const f = jrTplFill(W, t, { name: "Арман Ерланович", date: "2026-11-21", time: "15:00", services: "Мужская стрижка", staffName: "Тони" });
  assert.deepEqual(f.params, ["Мужская стрижка", "Тони", "21 ноября", "15:00"]);
  assert.equal(f.text, "Вы записаны на услугу: Мужская стрижка\nБарбер: Тони\nДата: 21 ноября в 15:00.\nЕсли нужно перенести или отменить, напишите сюда.");
  assert.equal(jrTplFill(W, jrTpl({}, W, "rv"), { name: "", services: "Стрижка", staffName: "Тони" }).params[0], "дорогой гость");
  assert.equal(jrTplFill(W, t, { name: "Арман", date: "2026-11-21", time: "15:00", services: "Стрижка", staffName: "" }).miss, "мастер");
  // 22.11.2026: на 777 одобрены «сегодня», «перенос», «отмена»
  assert.deepEqual(jrTplFill(W, jrTpl({}, W, "h2"), { time: "15:00", services: "Мужская стрижка", staffName: "Тони" }).params, ["15:00", "Тони", "Мужская стрижка"]);
  assert.equal(jrTplFill(W, jrTpl({}, W, "s06"), { date: "2026-11-22", time: "15:00", staffName: "Тони" }).text, "Ваша запись перенесена. Новое время: 22 ноября в 15:00, барбер Тони. Если время не подходит, напишите сюда.");
  assert.deepEqual(jrTplFill(W, jrTpl({}, W, "cx"), { date: "2026-11-22", time: "15:00" }).params, ["22 ноября", "15:00"]);
  assert.equal(jrTpl({ TPL_S01_WINCHESTER: "zapis_v2:ru" }, W, "s01").name, "zapis_v2");
  assert.equal(jrTpl({ TPL_S01_WINCHESTER: "zapis_v2:ru" }, W, "s01").lang, "ru");
  assert.equal(waKind({ ok: false, status: 0, code: 0 }), "net");
  assert.equal(waKind({ ok: false, status: 502, code: 131026 }), "fail");
  assert.equal(waKind({ ok: false, status: 404, code: 404 }), "stop");
  assert.equal(waKind({ ok: false, status: 400, code: 132001 }), "stop");
  assert.equal(waKind({ ok: false, status: 429, code: 429 }), "temp");
});

test("подтверждение и напоминание уходят шаблоном Meta через Wazzapo, в переписке основного номера; второй номер молчит", async () => {
  net.reset();
  net.altJournal = [rec("+77000007001", TOM, "15:00", { id: 7001, made: `${TODAY}T11:00:00+05:00` })];
  const s = mk(ENV);
  await autoOn(s, { confirm: true, remind24: true });
  for (const t of ["11:15", "11:30", "18:00", "18:01"]) await jrRun(s.env, at(TODAY, t));
  const got = tpls();
  assert.deepEqual(got.map(x => x.name), ["zapis_podtverzhdena_1794696655812", "napominanie_nakanune_1794697831874"], JSON.stringify(got));
  assert.ok(got.every(x => x.type === "template" && x.lang === "ru" && x.to === "77000007001"));
  assert.deepEqual(got[0].params, ["Мужская стрижка", "Тони", "21 ноября", "15:00"]);
  assert.deepEqual(got[1].params, ["15:00", "Мужская стрижка", "Тони"]);
  assert.equal(net.ga.filter(x => x.op === "sendMessage").length, 0, "со второго номера — ничего");
  const h = s.kv.json("h:wa:winchester:77000007001");
  assert.ok(h && h.turns.some(x => /^Вы записаны на услугу: Мужская стрижка/.test(x.text) && x.st === "sent"), "в переписке — текст шаблона");
  assert.equal(s.kv.json("h:ga:winchester:77000007001"), null);
  // журнал прочитан ещё раз — повторов нет
  await jrRun(s.env, at(TODAY, "18:30"));
  assert.equal(tpls().length, 2);
});

test("без REMIND_WA_WINCHESTER — ничего; шаблон не принят (нет в кабинете) — пауза и сигнал владельцу", async () => {
  net.reset();
  net.altJournal = [rec("+77000007011", TOM, "15:00", { id: 7011, made: `${TODAY}T11:00:00+05:00` })];
  const { REMIND_WA_WINCHESTER, ...off } = ENV;
  const s0 = mk(off); await autoOn(s0, { confirm: true });
  for (const t of ["11:15", "11:30"]) await jrRun(s0.env, at(TODAY, t));
  assert.equal(tpls().length, 0);
  net.reset();
  net.altJournal = [rec("+77000007012", TOM, "15:00", { id: 7012, made: `${TODAY}T11:00:00+05:00` })];
  net.wzReply = r => r.path === "/messages/send" ? new Response(JSON.stringify({ error: { code: "TEMPLATE_NOT_FOUND", message: "template not found" } }), { status: 404, headers: { "content-type": "application/json" } }) : null;
  const s = mk(ENV); await autoOn(s, { confirm: true });
  for (const t of ["11:15", "11:30"]) await jrRun(s.env, at(TODAY, t));
  assert.equal(tpls().length, 1);
  assert.ok(net.tg.some(x => /сервисные сообщения \(шаблоны Meta\) остановлены/.test(x.text)), JSON.stringify(net.tg.map(x => x.text)));
});

test("пульт: «Автоматические сообщения» — основной номер, тексты шаблонов, текст не правится, отмена — своим шаблоном (22.11.2026); проверка на свой номер — шаблоном", async () => {
  net.reset();
  const s = mk(ENV), own = await login(s, "owner-key-123456");
  const j = await (await own.go("/api/msg/auto?c=winchester")).json();
  assert.equal(j.sender.via, "wa"); assert.equal(j.sender.ready, true); assert.equal(j.master.on, true);
  const conf = j.scenarios.find(x => x.id === "confirm");
  assert.equal(conf.tpl.name, "zapis_podtverzhdena_1794696655812"); assert.equal(conf.text.tpl, true);
  assert.match(conf.preview, /^Вы записаны на услугу: /);
  const cx = j.scenarios.find(x => x.id === "cancel");
  assert.equal(cx.tpl.name, "zapis_otmenena_1795230838630"); assert.match(cx.preview, /^Ваша запись на .+ отменена/);
  assert.match(j.scenarios.find(x => x.id === "birthday").locked, /рассылкой шаблоном Meta/);
  let r = await own.post("/api/msg/auto", { c: "winchester", id: "confirm", text: { ru: "Свой текст" } });
  assert.equal(r.status, 409);
  r = await own.post("/api/msg/auto", { c: "winchester", id: "cancel", on: true });
  assert.equal(r.status, 200, await r.text());
  r = await own.post("/api/msg/auto", { c: "winchester", id: "confirm", on: true });
  assert.equal(r.status, 200, await r.text());
  await own.post("/api/msg/auto", { c: "winchester", testPhone: "+7 700 000 70 99" });
  r = await own.post("/api/msg/test", { c: "winchester", id: "confirm", rid: "test-meta-0001" });
  const tj = await r.json();
  assert.equal(r.status, 200, JSON.stringify(tj));
  assert.deepEqual(tpls().map(x => [x.name, x.to]), [["zapis_podtverzhdena_1794696655812", "77000007099"]]);
  assert.equal(net.ga.length, 0);
});

test("через Pushon (номер 777, 21.11.2026): подтверждение уходит шаблоном Pushon с полным названием и языком ru, в переписке основного номера", async () => {
  net.reset();
  net.altJournal = [rec("+77000007021", TOM, "15:00", { id: 7021, made: `${TODAY}T11:00:00+05:00` })];
  const s = mk({ ...ENV, WA_VIA_WINCHESTER: "pushon", WA_TOKEN_WINCHESTER: "po-key-test", PHONE_NUMBER_ID_WINCHESTER: "po-channel-1", APP_SECRET_WINCHESTER: "po-hook-pass" });
  await autoOn(s, { confirm: true });
  for (const t of ["11:15", "11:30"]) await jrRun(s.env, at(TODAY, t));
  const sent = net.po.filter(x => x.path === "/send-template-message");
  assert.equal(sent.length, 1, JSON.stringify(net.po.map(x => x.path)));
  const b = sent[0].body;
  assert.equal(b.templateName, "zapis_podtverzhdena_1794696655812"); assert.equal(b.templateLanguage, "ru"); assert.equal(b.channelId, "po-channel-1");
  assert.deepEqual(b.components[0].parameters.map(p => p.text), ["Мужская стрижка", "Тони", "21 ноября", "15:00"]);
  assert.equal(net.wz.length, 0, "Wazzapo не трогаем");
  const h = s.kv.json("h:wa:winchester:77000007021");
  assert.ok(h && h.turns.some(x => /^Вы записаны на услугу: Мужская стрижка/.test(x.text) && x.st === "sent"));
});

test("Pushon 402 (закончились сообщения, 25.11.2026): не задача администратору — ждёт и уходит после пополнения; уже упавшие — снова в очередь", async () => {
  net.reset();
  net.altJournal = [rec("+77000007031", TOM, "15:00", { id: 7031, made: `${TODAY}T11:00:00+05:00` })];
  const PO = { ...ENV, WA_VIA_WINCHESTER: "pushon", WA_TOKEN_WINCHESTER: "po-key-test", PHONE_NUMBER_ID_WINCHESTER: "po-channel-1", APP_SECRET_WINCHESTER: "po-hook-pass" };
  const s = mk(PO);
  await autoOn(s, { confirm: true });
  let paid = false;
  net.poReply = r => !paid && r.path === "/send-template-message" ? new Response(JSON.stringify({ error: "PAYMENT_REQUIRED", details: "quota" }), { status: 402, headers: { "content-type": "application/json" } }) : null;
  for (const t of ["11:15", "11:30"]) await jrRun(s.env, at(TODAY, t));
  const sends = () => net.po.filter(x => x.path === "/send-template-message");
  assert.equal(sends().length, 1, "попытка была");
  assert.equal(waKind({ ok: false, status: 402, code: 402, error: "PAYMENT_REQUIRED" }), "pay");
  let h = s.kv.json("h:wa:winchester:77000007031");
  assert.ok(!h || !(h.profile && h.profile.need), "не «ответ не дошёл» администратору");
  assert.ok(net.tg.some(x => /закончились служебные сообщения/.test(x.text)), JSON.stringify(net.tg.map(x => x.text)));
  await jrRun(s.env, at(TODAY, "11:35"));
  assert.equal(sends().length, 1, "пауза 15 минут — без новых попыток");
  paid = true;
  await jrRun(s.env, at(TODAY, "11:50"));
  assert.equal(sends().length, 2, "после пополнения ушло само");
  h = s.kv.json("h:wa:winchester:77000007031");
  assert.ok(h.turns.some(x => x.st === "sent"));
  await jrRun(s.env, at(TODAY, "12:10"));
  assert.equal(sends().length, 2, "второй раз не шлём");
});

test("Pushon 402 до правки: задача администратору в журнале решений → отметка попытки снимается, сообщение уходит, «ответ не дошёл» снимается", async () => {
  net.reset();
  net.altJournal = [rec("+77000007041", TOM, "15:00", { id: 7041, made: `${TODAY}T11:00:00+05:00` })];
  const PO = { ...ENV, WA_VIA_WINCHESTER: "pushon", WA_TOKEN_WINCHESTER: "po-key-test", PHONE_NUMBER_ID_WINCHESTER: "po-channel-1", APP_SECRET_WINCHESTER: "po-hook-pass" };
  const s = mk(PO);
  await autoOn(s, { confirm: true });
  await jrRun(s.env, at(TODAY, "11:15")); // журнал уже читали (как на боевом), подтверждение ещё не пора
  assert.equal(net.po.length, 0);
  // как было до правки: отметка попытки стоит, в журнале решений — «задача администратору» с кодом 402, в чате — «ответ не дошёл»
  const t0 = at(TODAY, "11:16");
  await s.env.KV.put("rms:winchester:7041:s01", `${TOM}T15:00`, { expirationTtl: 86400 });
  await s.env.KV.put(`rms:winchester:ga:7041:s01:${TOM}T15:00`, "1", { expirationTtl: 86400 });
  await s.env.KV.put("jrl:winchester", JSON.stringify([{ t: t0, k: "s01", rec: "7041", p: "77000007041", n: "Арман", date: TOM, time: "15:00", st: "task", why: "не ушло (код 402: PAYMENT_REQUIRED), задача администратору" }]), { expirationTtl: 86400 });
  await s.env.KV.put("h:wa:winchester:77000007041", JSON.stringify({ turns: [{ role: "model", text: "x", t: t0, st: "failed" }], profile: { need: { at: t0, why: "send" } } }), { expirationTtl: 86400 });
  await jrRun(s.env, at(TODAY, "11:40"));
  const sent = net.po.filter(x => x.path === "/send-template-message");
  assert.equal(sent.length, 1, JSON.stringify(net.po.map(x => x.path)));
  const h = s.kv.json("h:wa:winchester:77000007041");
  assert.ok(!h.profile.need, "пометка «ответ не дошёл» снята: " + JSON.stringify(h.profile) + JSON.stringify(h.turns.map(t => [t.st, t.rm])));
  await jrRun(s.env, at(TODAY, "12:00"));
  assert.equal(net.po.filter(x => x.path === "/send-template-message").length, 1, "повторно не шлём");
});

test("с основного номера (Pushon) — до 20 сообщений в минуту, а не 2 (25.11.2026)", async () => {
  net.reset();
  net.altJournal = Array.from({ length: 6 }, (_, i) => rec("+7700000705" + i, TOM, "15:00", { id: 7050 + i, made: `${TODAY}T11:00:00+05:00` }));
  const s = mk({ ...ENV, WA_VIA_WINCHESTER: "pushon", WA_TOKEN_WINCHESTER: "po-key-test", PHONE_NUMBER_ID_WINCHESTER: "po-channel-1", APP_SECRET_WINCHESTER: "po-hook-pass" });
  await autoOn(s, { confirm: true });
  for (const t of ["11:15", "11:30"]) await jrRun(s.env, at(TODAY, t));
  assert.equal(net.po.filter(x => x.path === "/send-template-message").length, 6, "все шесть подтверждений — за одну минуту");
});
