// Рассылка из сегмента базы клиентов Altegio и автосценарий «Пора на стрижку» (docs/tz-winchester-v2.md §4.3, §5, 19.10.2026).
// Получатели сегмента строит сервер из снимка (браузер номеров не присылает и полных не получает), отправка шаблона ставит отметку
// «писали маркетинг» (bcm:), автосценарий — ровно N дней с визита, предел в день, выключен по умолчанию, пропуск дня при жёлтом качестве.
// Всё на заглушках (журнал — net.altJournal, Meta — net.graph, Wazzapo — net.wz). Номера вымышленные (+7 700 000 0x xx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { crmBuild } from "../../src/services/crm/snapshot.js";
import { crmSegments } from "../../src/services/crm/segments.js";
import { autoRun, autoOne, autoSet, autoGet, AUTO_DEF } from "../../src/services/crm/auto.js";
import { bcCreate } from "../../src/services/broadcast/create.js";
import { bcTick } from "../../src/services/broadcast/sender.js";
import { bcmAdd } from "../../src/db/kv/crm.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";

const W = CLIENTS.winchester, OWNER = "owner-key-123456", STAFF_W = "staff-key-winch-0001", STAFF_B = "staff-key-barber-0001";
const META = { WA_TOKEN_WINCHESTER: "tok-w", PHONE_NUMBER_ID_WINCHESTER: "900333", APP_SECRET_WINCHESTER: "sec-w" };
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", KEY_WINCHESTER: STAFF_W, KEY_BARBER: STAFF_B, ...META };
const NOW = Date.now(); // часы обвязки: 3 октября 2026, 12:00 по Астане
const AT = Date.UTC(2026, 9, 3, 6, 3); // 3 октября, 11:03 по Астане — время автосценария
const day = n => new Date(NOW - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10); // n дней назад по Астане (n < 0 — вперёд)
let rid = 0;
const rec = (phone, n, o = {}) => ({ id: ++rid, datetime: `${day(n)}T12:00:00+05:00`, deleted: false, attendance: 1, staff: { id: 1, name: o.staff || "Тони" },
  client: { id: +String(phone).replace(/\D/g, "").slice(-6), phone, name: o.name ?? "Клиент" }, services: [{ id: 1, title: "Мужская стрижка" }] });
const ph = i => "+7700000" + String(i).padStart(4, "0");
const dg = i => ph(i).slice(1);
const tpls = () => net.graph.filter(g => g.body && g.body.type === "template");
const bcs = s => [...s.kv.mem.keys()].filter(k => k.startsWith(`bc:${s.cid || "winchester"}:`)).map(k => s.kv.json(k));
const FORM = { c: "winchester", name: "Пора на стрижку", tpl: "pora_na_strizhku", lang: "ru", params: "{имя}", text: "{{1}}, пора на стрижку! Чтобы не получать сообщения, ответьте СТОП", cap: 240, from: 10, to: 20, consent: true };

async function login(s, key) {
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${encodeURIComponent(key)}&next=%2Finbox` });
  assert.ok(b.cookie, "вход ключом " + key.slice(0, 9));
  return b;
}
// база: «Пора на стрижку» — 101 (Арман), 104 (постоянный), 109 (имя с пометкой администратора); 105 — «стоп»; 102, 110 — давно
async function base(env = ENV, at = NOW) {
  net.reset();
  net.altJournal = [rec(ph(101), 25, { name: "Арман" }), rec(ph(104), 80), rec(ph(104), 50), rec(ph(104), 22, { name: "Данияр" }), rec(ph(109), 33, { name: "Ерлан должник" }),
    rec(ph(105), 28), rec(ph(102), 40), rec(ph(110), 45, { staff: "Азамат" })];
  const s = mk(env);
  await crmBuild(s.env, W, at);
  await s.kv.api.put(`optout:winchester:${dg(105)}`, "1");
  return s;
}

test("проверка рассылки из сегмента: получатели из снимка, номера из браузера не берутся, в ответе — только маской", async () => {
  const s = await base(), own = await login(s, OWNER), sb = await login(s, STAFF_B);
  const r = await own.post("/api/bc/check", { ...FORM, segment: "pora", recipients: "8 701 999 00 01, Чужой" }), t = await r.text(), d = JSON.parse(t);
  assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(d.ok, true, t); assert.equal(d.valid, 3); assert.equal(d.named, 2, "«Ерлан должник» — пометка администратора, не имя");
  assert.equal(d.segment.id, "pora"); assert.equal(d.segment.label, "Пора на стрижку"); assert.equal(d.segment.total, 3);
  assert.ok(d.sample.every(x => /^\+7 700 \*\*\* \*\* \d\d — /.test(x)), JSON.stringify(d.sample));
  assert.ok(![101, 104, 109, 105].some(i => t.includes(dg(i))) && !t.includes("7019990001"), "ни полных номеров базы, ни номера из браузера");
  assert.deepEqual(d.preview, ["Данияр"]);
  assert.equal((await sb.post("/api/bc/check", { ...FORM, segment: "pora" })).status, 403, "сотрудник другой компании");
  const f = await (await own.post("/api/bc/check", { ...FORM, segment: { id: "all", from: 36, to: 60 } })).json();
  assert.equal(f.valid, 2); assert.equal(f.segment.label, "Вся база · 36–60 дн. с визита");
  const g = await (await own.post("/api/bc/check", { ...FORM, ch: "ga", text: "Привет", segment: "pora" })).json();
  assert.equal(g.ok, false); assert.ok(g.errors.some(e => /только шаблоном Meta/.test(e)), JSON.stringify(g));
  const u = await (await own.post("/api/bc/check", { ...FORM, segment: "nope" })).json();
  assert.ok(u.errors.some(e => /не найден/.test(e)), JSON.stringify(u));
});

test("создание рассылки из сегмента: список на сервере, src: crm, сегмент записан; без базы, со старой базой и пустой сегмент — отказ", async () => {
  const s = await base(), own = await login(s, OWNER), sw = await login(s, STAFF_W);
  const r = await sw.post("/api/bc/create", { ...FORM, segment: "pora", recipients: "8 701 999 00 01, Чужой" }), t = await r.text(), d = JSON.parse(t);
  assert.equal(r.status, 200, t); assert.equal(d.ok, true);
  assert.ok(![101, 104, 109].some(i => t.includes(dg(i))), "в ответе нет номеров");
  const b = s.kv.json("bc:winchester:" + d.b.id);
  assert.equal(b.src, "crm"); assert.equal(b.segId, "pora"); assert.equal(b.seg, "Пора на стрижку"); assert.equal(b.total, 3); assert.equal(b.by, "staff"); assert.equal(b.status, "ready");
  assert.deepEqual(s.kv.json(`bcr:winchester:${d.b.id}:0`), [[dg(104), "Данияр"], [dg(101), "Арман"], [dg(109), ""]], "свежие визиты первыми, имя-пометка не подставляется, номера из браузера нет");
  const st = await (await sw.post("/api/bc/create", { ...FORM, segment: "staff:Азамат" })).json();
  assert.equal(st.ok, true); assert.equal(s.kv.json(`bcr:winchester:${st.b.id}:0`).length, 1);
  const empty = await (await own.post("/api/bc/create", { ...FORM, segment: { id: "pora", staff: "Азамат" } })).json();
  assert.equal(empty.ok, false); assert.ok(empty.errors.some(e => /некому писать/.test(e)), JSON.stringify(empty));
  const nob = await own.post("/api/bc/create", { ...FORM, c: "barber", segment: "pora" }), jn = await nob.json();
  assert.equal(nob.status, 400); assert.ok(jn.errors.some(e => /базы клиентов из Altegio ещё нет/.test(e)), JSON.stringify(jn));
  const snap = s.kv.json("crm:winchester:snap"); snap.at = NOW - 4 * 86400e3; s.kv.mem.set("crm:winchester:snap", JSON.stringify(snap));
  const old = await (await own.post("/api/bc/create", { ...FORM, segment: "pora" })).json();
  assert.equal(old.ok, false); assert.ok(old.errors.some(e => /обновлялась 4 дн\. назад/.test(e)), JSON.stringify(old));
  assert.equal((await own.post("/api/bc/create", { ...FORM, segment: "pora" }, { origin: "https://evil.example" })).status, 403);
});

test("отправка шаблона Meta ставит отметку «писали маркетинг» (bcm:) — раз за порцию; ошибка — без отметки; сегменты таких больше не берут", async () => {
  const s = await base(), own = await login(s, OWNER);
  const d = await (await own.post("/api/bc/create", { ...FORM, segment: "pora" })).json();
  net.graphReply = (u, i, r) => r.body && r.body.type === "template" && r.body.to === dg(109) ? new Response(JSON.stringify({ error: { code: 131026, message: "undeliverable" } }), { status: 400 }) : null;
  assert.equal((await (await own.post("/api/bc/act", { c: "winchester", id: d.b.id, act: "start" })).json()).ok, true);
  const puts0 = s.kv.ops.put;
  await s.cron();
  net.graphReply = null;
  assert.equal(tpls().length, 3); assert.ok(tpls().every(x => x.url.includes("/900333/messages")));
  assert.equal(tpls().find(x => x.body.to === dg(101)).body.template.components[0].parameters[0].text, "Арман");
  assert.equal(tpls().find(x => x.body.to === dg(109)).body.template.components[0].parameters[0].text, "уважаемый клиент");
  const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10), k = `bcm:winchester:${today}`;
  assert.deepEqual(s.kv.json(k).sort(), [dg(101), dg(104)], "отметка — только тем, кому шаблон ушёл");
  assert.equal(s.kv.ttl.get(k), 15 * 86400); assert.ok(s.kv.ops.put - puts0 < 12, "отметка — одной записью за порцию");
  const sg = await crmSegments(s.env, W, Date.now());
  assert.equal(sg.excluded.marketed, 2); assert.equal(sg.segments.find(x => x.id === "pora").n, 1);
  // повторная рассылка из того же сегмента — только тот, кому не дошло
  const d2 = await (await own.post("/api/bc/check", { ...FORM, segment: "pora" })).json();
  assert.equal(d2.valid, 1);
  // «Номера с ошибками» рассылки из базы — только маской, и владельцу, и сотруднику: полные номера базы браузеру не уходят (находка проверки 19.10.2026)
  for (const who of [own, await login(s, STAFF_W)]) {
    const g = await who.go(`/api/bc/get?c=winchester&id=${d.b.id}&bad=1`), t = await g.text(), j = JSON.parse(t);
    assert.equal(g.status, 200); assert.deepEqual(j.bad, ["+7 700 *** ** 09 — номер не в WhatsApp или не принимает сообщения"]);
    assert.ok(!t.includes(dg(109)) && !t.includes(dg(101)), "в ответе нет полных номеров базы");
  }
});

test("отметки bcm ставит и отправка через Wazzapo; с номера Green-API — нет", async () => {
  const sW = await base({ ...ENV, WA_VIA_WINCHESTER: "wazzapo" });
  const r = await bcCreate(sW.env, W, { ...FORM, segment: "pora" }, Date.now(), "owner", { start: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  const t = await bcTick(sW.env, "winchester", r.b.id);
  assert.equal(t.state, "done"); assert.equal(net.wz.filter(x => x.path === "/messages/send").length, 3);
  const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  assert.equal(sW.kv.json(`bcm:winchester:${today}`).length, 3);
  net.reset();
  const sG = mk({ GA_ID_BARBER: "7105000009", GA_TOKEN_BARBER: "ga-tok-b" });
  const g = await bcCreate(sG.env, CLIENTS.barber, { c: "barber", ch: "ga", name: "Текст", text: "Привет, {имя}!", recipients: "87001110001, Арман", cap: 10, from: 8, to: 22, consent: true }, Date.now(), "owner", { start: true });
  assert.equal(g.ok, true, JSON.stringify(g));
  await bcTick(sG.env, "barber", g.b.id);
  assert.equal(net.ga.filter(x => x.op === "sendMessage").length, 1);
  assert.ok(![...sG.kv.mem.keys()].some(k => k.startsWith("bcm:")), "Green-API отметок не ставит");
});

test("настройки автосценария: по умолчанию выключен; видят владелец и сотрудник, меняет только владелец; проверка полей", async () => {
  const s = await base(), own = await login(s, OWNER), sw = await login(s, STAFF_W), sb = await login(s, STAFF_B);
  const g = await sw.go("/api/bc/auto?c=winchester"), j = await g.json();
  assert.equal(g.status, 200); assert.equal(g.headers.get("cache-control"), "no-store");
  assert.deepEqual(j.auto, { ...AUTO_DEF }); assert.equal(j.auto.on, false); assert.equal(j.available, true); assert.equal(j.why, ""); assert.equal(j.owner, false);
  assert.equal((await sb.go("/api/bc/auto?c=winchester")).status, 403);
  assert.equal((await s.call("/api/bc/auto?c=winchester")).status, 401);
  assert.equal((await sw.post("/api/bc/auto", { c: "winchester", on: true, tpl: "pora_na_strizhku" })).status, 403, "сотрудник не включает");
  assert.equal((await own.post("/api/bc/auto", { c: "winchester", on: true, tpl: "pora_na_strizhku" }, { origin: "https://evil.example" })).status, 403);
  assert.equal(s.kv.json("bcauto:winchester"), null);
  for (const [bad, re] of [[{ on: true }, /шаблон/], [{ tpl: "Pora Na" }, /латинские/], [{ days: 5 }, /от 7 до 120/], [{ days: 121 }, /от 7 до 120/], [{ cap: 101 }, /от 1 до 100/], [{ cap: 0 }, /от 1 до 100/], [{ from: 6 }, /8:00/], [{ from: 20, to: 11 }, /раньше/], [{ lang: "русский" }, /язык/],
    [{ from: 8, to: 10 }, /позже 11:00/], [{ from: 9, to: 11 }, /позже 11:00/]]) { // список собирается в 11:00: с часами до 11 приглашения ушли бы только назавтра
    const r = await own.post("/api/bc/auto", { c: "winchester", ...bad }), e = await r.json();
    assert.equal(r.status, 400, JSON.stringify(bad)); assert.ok(e.errors.some(x => re.test(x)), JSON.stringify([bad, e]));
  }
  const ok = await (await own.post("/api/bc/auto", { c: "winchester", on: true, tpl: "pora_na_strizhku", days: 30, cap: 15, evil: "x" })).json();
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(s.kv.json("bcauto:winchester"), { ...AUTO_DEF, on: true, tpl: "pora_na_strizhku", days: 30, cap: 15 }, "только известные поля");
  assert.equal((await own.post("/api/bc/auto", { c: "winchester", from: 9, to: 12 })).status, 200, "до 12:00 — успеет в тот же день");
  await own.post("/api/bc/auto", { c: "winchester", from: 11, to: 20 });
  const off = await (await own.post("/api/bc/auto", { c: "winchester", on: false })).json();
  assert.equal(off.auto.on, false); assert.equal(off.auto.tpl, "pora_na_strizhku", "одно поле — остальное как было");
  const nb = await own.post("/api/bc/auto", { c: "barber", on: true, tpl: "pora_na_strizhku" });
  assert.equal(nb.status, 400); assert.ok((await nb.json()).errors.some(x => /нет базы клиентов/.test(x)));
  const gb = await (await own.go("/api/bc/auto?c=barber")).json();
  assert.equal(gb.available, false); assert.ok(gb.why); assert.deepEqual(gb.today, { n: 0, total: 0 });
  await own.post("/api/bc/auto", { c: "winchester", days: 25, cap: 2 });
  const g2 = await (await own.go("/api/bc/auto?c=winchester")).json();
  assert.deepEqual(g2.today, { n: 1, total: 1 }, "25 дней — один Арман"); assert.equal(g2.crm.fresh, true); assert.equal(g2.owner, true);
  await own.post("/api/bc/auto", { c: "winchester", days: 10 });
  assert.ok(/меньше 14 дней/.test((await (await own.go("/api/bc/auto?c=winchester")).json()).note || ""));
});

// база автосценария: ровно 28 дней — 201, 202 (два визита), 203; 204 — «стоп», 205 — записан, 206 — писали маркетинг; 207 — 27 дней, 208 — 29
async function autoBase(env = ENV) {
  net.reset();
  net.altJournal = [rec(ph(201), 28, { name: "Арман" }), rec(ph(202), 60), rec(ph(202), 28, { name: "Данияр" }), rec(ph(203), 28), rec(ph(204), 28), rec(ph(205), 28), rec(ph(205), -2),
    rec(ph(206), 28), rec(ph(207), 27, { name: "Ерлан" }), rec(ph(208), 29)];
  const s = mk(env);
  await crmBuild(s.env, W, AT);
  await s.kv.api.put(`optout:winchester:${dg(204)}`, "1");
  await bcmAdd(s.env, "winchester", day(3), [dg(206)]);
  await checked(s, AT);
  return s;
}
// проверка номера WhatsApp в 10:03 дня at (qualityRun пишет qual:) — без сегодняшней проверки автосценарий день пропускает
const checked = (s, at, quality = "GREEN", limit = 0) => s.kv.api.put("qual:winchester", JSON.stringify({ quality, limit, at: at - 3600e3 }));

test("автосценарий: выключен — ничего; включён — в 11:00 ровно N дней, исключения, предел, раз в день; назавтра — следующие", async () => {
  const s = await autoBase();
  assert.equal(await autoRun(s.env, AT), 0, "по умолчанию выключен");
  assert.equal(bcs(s).length, 0); assert.ok(![...s.kv.mem.keys()].some(k => k.startsWith("bca:")), "выключенный — без отметки дня");
  assert.equal((await autoSet(s.env, W, { on: true, tpl: "pora_na_strizhku", cap: 2 })).ok, true);
  assert.equal(await autoRun(s.env, AT + 3600e3), 0, "12:03 — не время"); assert.equal(await autoRun(s.env, AT - 3600e3), 0, "10:03 — не время");
  assert.equal(await autoRun(s.env, AT), 1);
  const [b] = bcs(s);
  assert.equal(b.by, "auto"); assert.equal(b.status, "running"); assert.equal(b.src, "crm"); assert.equal(b.segId, "all"); assert.equal(b.tpl, "pora_na_strizhku");
  assert.deepEqual(b.params, ["{имя}"]); assert.equal(b.from, 11); assert.equal(b.to, 20); assert.equal(b.total, 2); assert.equal(b.name, "Пора на стрижку · 03.10");
  assert.deepEqual(s.kv.json(`bcr:winchester:${b.id}:0`), [[dg(202), "Данияр"], [dg(201), "Арман"]], "ровно 28 дней, без «стоп», записанного и уже получившего; предел 2 — постоянные первыми");
  assert.deepEqual(s.kv.json("bcrun"), [{ c: "winchester", id: b.id }]); assert.ok(/Пора на стрижку/.test(s.kv.json("bclast:winchester").text));
  assert.equal(await autoRun(s.env, AT + 60e3), 0, "второй раз за день — нет"); assert.equal(bcs(s).length, 1);
  await s.cron(); // фоновая отправка (12:00 — в часах 11–20)
  assert.deepEqual(tpls().map(x => x.body.to), [dg(202), dg(201)]);
  assert.equal(tpls()[0].body.template.components[0].parameters[0].text, "Данияр");
  assert.equal(s.kv.json(`bc:winchester:${b.id}`).status, "done");
  await checked(s, AT + 86400e3);
  const r = await autoOne(s.env, W, AT + 86400e3); // назавтра: 28 дней — у Ерлана (вчера было 27); база — суточной давности
  assert.equal(r.state, "sent"); assert.equal(r.n, 1);
  assert.deepEqual(s.kv.json(`bcr:winchester:${r.id}:0`), [[dg(207), "Ерлан"]]);
  assert.equal(net.tg.filter(x => /Пора на стрижку/.test(x.text || "") && /не отправлен/.test(x.text)).length, 0, "пропусков не было");
});

test("автосценарий пропускает день: жёлтое качество, сигнал Meta, старая база, номер не подключён, сбой хранилища — с сообщением в Telegram, один раз", async () => {
  let s = await autoBase();
  await autoSet(s.env, W, { on: true, tpl: "pora_na_strizhku" });
  await checked(s, AT, "YELLOW", 250);
  assert.equal(await autoRun(s.env, AT), 0); assert.equal(bcs(s).length, 0);
  assert.equal(net.tg.filter(x => /не отправлен/.test(x.text) && /жёлтое/.test(x.text)).length, 1, JSON.stringify(net.tg));
  assert.equal(await autoRun(s.env, AT + 120e3), 0); assert.equal(net.tg.length, 1, "сообщение — раз в день");
  await checked(s, AT + 86400e3, "GREEN", 1000);
  const ok = await autoOne(s.env, W, AT + 86400e3);
  assert.equal(ok.state, "sent", JSON.stringify(ok)); assert.equal(s.kv.json(`bc:winchester:${ok.id}`).cap, 950, "предел рассылки за сутки — предел номера с запасом");

  s = await autoBase();
  await autoSet(s.env, W, { on: true, tpl: "pora_na_strizhku" });
  await s.kv.api.put("bchold:winchester", JSON.stringify({ tpl: { pora_na_strizhku: { at: AT, why: "шаблон приостановлен Meta" } } }));
  assert.equal((await autoOne(s.env, W, AT)).state, "skip"); assert.ok(/приостановлен/.test(net.tg.at(-1).text)); assert.equal(bcs(s).length, 0);

  s = await autoBase();
  await autoSet(s.env, W, { on: true, tpl: "pora_na_strizhku" });
  await checked(s, AT + 2 * 86400e3);
  const old = await autoOne(s.env, W, AT + 2 * 86400e3);
  assert.equal(old.state, "skip"); assert.ok(/36 часов/.test(net.tg.at(-1).text)); assert.equal(bcs(s).length, 0);

  // качество номера сегодня не узнали: проверка в 10:00 не удалась (qual: не записан или вчерашний) или не сообщила качество — не «всё хорошо»
  // (находка проверки 19.10.2026: через Wazzapo вебхуков о качестве нет, эта проверка — единственный сигнал)
  for (const q of [null, { quality: "GREEN", limit: 250, at: AT - 86400e3 }, { quality: "", limit: 0, at: AT - 3600e3 }]) {
    s = await autoBase();
    await autoSet(s.env, W, { on: true, tpl: "pora_na_strizhku" });
    if (q) await s.kv.api.put("qual:winchester", JSON.stringify(q)); else s.kv.mem.delete("qual:winchester");
    const r = await autoOne(s.env, W, AT);
    assert.equal(r.state, "skip", JSON.stringify(q)); assert.ok(/сегодня не проверен/.test(net.tg.at(-1).text), JSON.stringify(q)); assert.equal(bcs(s).length, 0);
  }

  s = await autoBase({ ...ENV, WA_TOKEN_WINCHESTER: "" });
  await autoSet(s.env, W, { on: true, tpl: "pora_na_strizhku" });
  assert.equal((await autoOne(s.env, W, AT)).state, "skip"); assert.ok(/WA_TOKEN_WINCHESTER/.test(net.tg.at(-1).text)); assert.equal(bcs(s).length, 0);

  s = await autoBase(); // хранилище не отдало базу после отметки дня — владелец узнаёт, что сегодня ничего не ушло
  await autoSet(s.env, W, { on: true, tpl: "pora_na_strizhku" });
  s.kv.fail.get = k => k === "crm:winchester:snap";
  assert.equal((await autoOne(s.env, W, AT)).state, "skip"); assert.ok(/Сбой хранилища/.test(net.tg.at(-1).text)); assert.equal(bcs(s).length, 0);
  s.kv.fail.get = null;
  assert.equal((await autoOne(s.env, W, AT + 60e3)).state, "off", "день отмечен — без повторов каждую минуту");
  assert.ok(!net.tg.some(x => /7700000\d{4}/.test(x.text || "")), "в Telegram — без номеров клиентов");
});

test("автосценарий через фоновую задачу Worker: в 11:03 создаёт рассылку; сегодня некому — рассылки нет", async () => {
  const s = await autoBase();
  await autoSet(s.env, W, { on: true, tpl: "pora_na_strizhku", days: 50 });
  await s.cron(AT);
  assert.equal(bcs(s).length, 0, "ровно 50 дней — никого");
  assert.ok(s.kv.mem.has("bca:winchester:" + day(0)), "день отмечен");
  const s2 = await autoBase();
  await autoSet(s2.env, W, { on: true, tpl: "pora_na_strizhku" });
  await s2.cron(AT);
  assert.equal(bcs(s2).length, 1); assert.equal(bcs(s2)[0].total, 3);
  assert.deepEqual(await autoGet(s2.env, "winchester"), { ...AUTO_DEF, on: true, tpl: "pora_na_strizhku" });
});

// находка проверки 19.10.2026: исключения проверялись только при создании рассылки — две рассылки по пересекающимся сегментам или ручная
// «Пора на стрижку» и автосценарий писали одному человеку два платных шаблона, а кто записался после создания — всё равно получал
test("исключения — и при отправке: пересекающиеся сегменты, ручная и автосценарий — один шаблон на номер; записался после создания — не пишем; старая база — пауза", async () => {
  const s = await base(), own = await login(s, OWNER);
  const a = await (await own.post("/api/bc/create", { ...FORM, segment: "pora" })).json(); // 104 (Данияр, 3 визита, 22 дня) — и здесь,
  const p = await (await own.post("/api/bc/create", { ...FORM, name: "Постоянные", segment: "postoyannye" })).json(); // и здесь
  assert.equal(a.ok && p.ok, true, JSON.stringify([a, p]));
  for (const x of [a, p]) assert.equal((await (await own.post("/api/bc/act", { c: "winchester", id: x.b.id, act: "start" })).json()).ok, true);
  await s.cron(); await s.cron();
  const to = tpls().map(x => x.body.to);
  assert.deepEqual(to.sort(), [dg(101), dg(104), dg(109)].sort(), "один шаблон на номер");
  const ex = [a, p].map(x => s.kv.json(`bc:winchester:${x.b.id}`));
  assert.ok(ex.every(b => b.status === "done")); assert.equal((ex[0].excl || 0) + (ex[1].excl || 0), 1);
  assert.ok(net.tg.some(x => /им уже писали\): 1\./.test(x.text || "")), JSON.stringify(net.tg));

  const s2 = await autoBase(); // ручная «Пора на стрижку» создана утром, в 11:03 автосценарий берёт тех же (ровно 28 дней)
  const m = await bcCreate(s2.env, W, { ...FORM, name: "Ручная", segment: "pora" }, AT - 3600e3, "owner", { start: true });
  await autoSet(s2.env, W, { on: true, tpl: "pora_na_strizhku" });
  const r2 = await autoOne(s2.env, W, AT);
  assert.equal(m.ok, true); assert.equal(r2.state, "sent"); assert.equal(r2.n, 3);
  await s2.cron(); await s2.cron(); await s2.cron();
  assert.deepEqual(tpls().map(x => x.body.to).sort(), [dg(201), dg(202), dg(203), dg(207), dg(208)].sort(), "ручная и автосценарий — один шаблон на номер");

  const s3 = await base(), o3 = await login(s3, OWNER);
  const d3 = await (await o3.post("/api/bc/create", { ...FORM, segment: "pora" })).json();
  net.altJournal.push(rec(ph(101), -2)); await crmBuild(s3.env, W, NOW); // Арман записался после создания рассылки — новый снимок это видит
  assert.equal((await (await o3.post("/api/bc/act", { c: "winchester", id: d3.b.id, act: "start" })).json()).ok, true);
  await s3.cron();
  assert.deepEqual(tpls().map(x => x.body.to).sort(), [dg(104), dg(109)].sort(), "записавшемуся — нет");
  assert.equal(s3.kv.json(`bc:winchester:${d3.b.id}`).excl, 1);

  const s4 = await base(), o4 = await login(s4, OWNER);
  const d4 = await (await o4.post("/api/bc/create", { ...FORM, segment: "pora" })).json(), d5 = await (await o4.post("/api/bc/create", { ...FORM, segment: "pora" })).json();
  assert.equal((await (await o4.post("/api/bc/act", { c: "winchester", id: d4.b.id, act: "start" })).json()).ok, true);
  const snap = s4.kv.json("crm:winchester:snap"); snap.at = NOW - 4 * 86400e3; s4.kv.mem.set("crm:winchester:snap", JSON.stringify(snap));
  await s4.cron();
  const b4 = s4.kv.json(`bc:winchester:${d4.b.id}`);
  assert.equal(tpls().length, 0); assert.equal(b4.status, "paused"); assert.ok(/больше 3 дней/.test(b4.note), b4.note);
  const st = await o4.post("/api/bc/act", { c: "winchester", id: d5.b.id, act: "start" });
  assert.equal(st.status, 409); assert.ok(/больше 3 дней/.test((await st.json()).error));
});

// находка проверки 19.10.2026: вчерашняя рассылка автосценария ждала предела номера и назавтра уходила вместе с новой — больше предела в день
test("рассылка автосценария — только в день создания: назавтра остановлена с сообщением, не уходит", async () => {
  const s = await autoBase();
  await autoSet(s.env, W, { on: true, tpl: "pora_na_strizhku" });
  const r = await autoOne(s.env, W, AT - 86400e3); // вчера в 11:03 (29 дней сегодня — 28 вчера)
  assert.equal(r.state, "sent", JSON.stringify(r)); assert.equal(r.n, 1);
  await s.cron();
  const b = s.kv.json(`bc:winchester:${r.id}`);
  assert.equal(tpls().length, 0); assert.equal(b.status, "stopped"); assert.ok(/в день создания/.test(b.note));
  assert.ok(!(s.kv.json("bcrun") || []).some(x => x.id === r.id));
  assert.ok(net.tg.some(x => /не успел отправить всем/.test(x.text || "")), JSON.stringify(net.tg));
  const t = await autoOne(s.env, W, AT); await s.cron();
  assert.equal(t.state, "sent"); assert.deepEqual(tpls().map(x => x.body.to).sort(), [dg(201), dg(202), dg(203)].sort(), "сегодняшняя — как обычно");
});
