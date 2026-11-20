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
  assert.equal(jrTpl({}, W, "cx"), null, "у отмены шаблона нет");
  assert.equal(jrTpl({}, W, "h2"), null, "на 777 нет шаблона «сегодня»");
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

test("пульт: «Автоматические сообщения» — основной номер, тексты шаблонов, текст не правится, у отмены шаблона нет; проверка на свой номер — шаблоном", async () => {
  net.reset();
  const s = mk(ENV), own = await login(s, "owner-key-123456");
  const j = await (await own.go("/api/msg/auto?c=winchester")).json();
  assert.equal(j.sender.via, "wa"); assert.equal(j.sender.ready, true); assert.equal(j.master.on, true);
  const conf = j.scenarios.find(x => x.id === "confirm");
  assert.equal(conf.tpl.name, "zapis_podtverzhdena_1794696655812"); assert.equal(conf.text.tpl, true);
  assert.match(conf.preview, /^Вы записаны на услугу: /);
  assert.match(j.scenarios.find(x => x.id === "cancel").why, /нет одобренного шаблона Meta/);
  assert.match(j.scenarios.find(x => x.id === "birthday").locked, /рассылкой шаблоном Meta/);
  let r = await own.post("/api/msg/auto", { c: "winchester", id: "confirm", text: { ru: "Свой текст" } });
  assert.equal(r.status, 409);
  r = await own.post("/api/msg/auto", { c: "winchester", id: "cancel", on: true });
  assert.equal(r.status, 409);
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
