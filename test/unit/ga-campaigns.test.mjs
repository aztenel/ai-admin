// Рассылки со второго номера (Green-API) по базе клиентов — ТЗ Winchester v3.0 (31.10.2026): черновик обычным текстом из библиотеки
// или свой, текст каждому клиенту собирает сервер (имя, мастер, дни после визита), кому не хватает данных — не пишем, с причиной;
// одобрение владельцем — не запуск; запуск со второго номера у Winchester выключен (409 ga_off), тестовая версия тоже не рассылает.
// Если запрет снять (только в проверке, правкой CLIENTS), отправка собирает текст по свежей базе и ставит отметку «писали рекламу».
// Всё на заглушках (журнал — net.altJournal, Green-API — net.ga). Номера вымышленные (+7 700 000 0x xx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { crmBuild as crmBuild0 } from "../../src/services/crm/snapshot.js";
import { grantSnap, consentSkip } from "../consent.mjs";
import { bcCreate } from "../../src/services/broadcast/create.js";
import { bcTick } from "../../src/services/broadcast/sender.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";
import { OWN } from "../texts.mjs";

const crmBuild = async (env, c, at) => { const r = await crmBuild0(env, c, at); await grantSnap(env, c.id); return r; };
const W = CLIENTS.winchester, OWNER = "owner-key-123456", STAFF_W = "staff-key-winch-0001", STAFF_B = "staff-key-barber-0001";
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", KEY_WINCHESTER: STAFF_W, KEY_BARBER: STAFF_B,
  GA_ID_WINCHESTER: "7105000081", GA_TOKEN_WINCHESTER: "ga-tok-w81", GA_ID_BARBER: "7105000082", GA_TOKEN_BARBER: "ga-tok-b82" };
const NOW = Date.now();
const day = n => new Date(NOW - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
let rid = 500;
const rec = (phone, n, o = {}) => ({ id: ++rid, datetime: `${day(n)}T12:00:00+05:00`, deleted: false, attendance: 1, staff: o.staff === null ? null : { id: 1, name: o.staff || "Тони" },
  client: { id: +String(phone).replace(/\D/g, "").slice(-6), phone, name: o.name ?? "Клиент" }, services: [{ id: 1, title: "Мужская стрижка" }] });
const ph = i => "+7700000" + String(i).padStart(4, "0");
const dg = i => ph(i).slice(1);
const gaSent = () => net.ga.filter(x => x.op === "sendMessage").map(x => ({ to: String(x.body.chatId).replace("@c.us", ""), text: x.body.message }));
// свой текст со вставками (с 02.11.2026 в библиотеке — утверждённые тексты без вставок: test/unit/campaign-final.test.mjs)
const DRAFT = { c: "winchester", ch: "ga", name: "Пора на стрижку", text: OWN.pora, lang: "ru", segment: "pora", cap: 50, from: 10, to: 20, consent: true };

async function login(s, key) {
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${encodeURIComponent(key)}&next=%2Fapp%2F` });
  assert.ok(b.cookie, "вход ключом " + key.slice(0, 9));
  return b;
}
// «Пора на стрижку»: 601 (Арман, Тони), 602 («АРМАН ЕРЛАНОВИЧ», Айдос), 603 (без имени, без мастера), 604 — «стоп»
async function base(env = ENV) {
  net.reset();
  net.altJournal = [rec(ph(601), 25, { name: "Арман" }), rec(ph(602), 30, { name: "АРМАН ЕРЛАНОВИЧ", staff: "Айдос" }), rec(ph(603), 33, { name: "Без имени", staff: null }), rec(ph(604), 28)];
  const s = mk(env);
  await crmBuild(s.env, W, NOW);
  await s.kv.api.put(`optout:winchester:${dg(604)}`, "1");
  return s;
}

test("проверка черновика со второго номера: текст из библиотеки, каждому свой, номера маской, кому не собрать — с причиной; без полей Meta", { skip: consentSkip }, async () => {
  const s = await base(), own = await login(s, OWNER), sb = await login(s, STAFF_B);
  const r = await own.post("/api/bc/check", DRAFT), t = await r.text(), d = JSON.parse(t);
  assert.equal(r.status, 200); assert.equal(d.ok, true, t);
  assert.equal(d.tplId, ""); assert.equal(d.valid, 3); assert.ok(!/\{\{1\}\}|шаблон Meta/.test(t), "без шаблонов Meta");
  assert.ok(d.samples.some(x => x.to === "+7 700 *** ** 01" && x.text.startsWith("Здравствуйте, Арман! С последней стрижки прошло 25 дней.")), JSON.stringify(d.samples));
  assert.ok(d.samples.some(x => x.text.startsWith("Здравствуйте, Арман! С последней стрижки прошло 30 дней.")), "«АРМАН ЕРЛАНОВИЧ» → «Арман»");
  assert.ok(d.samples.some(x => x.text.startsWith("Здравствуйте! С последней стрижки прошло 33 дня.")), "без имени — без обращения");
  assert.ok(d.samples.every(x => !/[{}[\]]/.test(x.text) && /https:\/\/winchester\.kz/.test(x.text) && /напишите «стоп»\.$/.test(x.text)), JSON.stringify(d.samples));
  assert.deepEqual(d.excluded, [{ code: "stop", why: "просили не писать", n: 1 }]);
  assert.ok(![601, 602, 603, 604].some(i => t.includes(dg(i))), "полных номеров базы нет");
  // текст с мастером: у клиента без мастера в истории — не собрать, он не получит
  const m = await (await own.post("/api/bc/check", { ...DRAFT, text: OWN.staff })).json();
  assert.equal(m.ok, true, JSON.stringify(m)); assert.equal(m.valid, 2);
  assert.ok(m.excluded.some(x => x.code === "nostaff" && x.why === "нет мастера в истории" && x.n === 1), JSON.stringify(m.excluded));
  assert.ok(m.samples.some(x => /к мастеру Айдос,/.test(x.text)), JSON.stringify(m.samples));
  // [скобки] — не вписаны условия: черновик не проверить
  const f = await (await own.post("/api/bc/check", { ...DRAFT, text: OWN.slot })).json();
  assert.equal(f.ok, false); assert.ok(f.errors.some(e => /впишите условия вместо \[скобок\]/.test(e)), JSON.stringify(f.errors));
  const kk = await (await own.post("/api/bc/check", { ...DRAFT, lang: "kk", text: OWN.poraKk })).json();
  assert.ok(kk.samples[0].text.startsWith("Сәлеметсіз бе"), JSON.stringify(kk.samples));
  // свой текст: строки «стоп» система сама не дописывает (финальное ТЗ рассылок, 02.11.2026) — только если владелец выбрал stop: true
  const own2 = await (await own.post("/api/bc/check", { ...DRAFT, tplId: "", text: "{имя}, ждём вас у мастера {мастер}!" })).json();
  assert.equal(own2.text, "{{client.first_name}}, ждём вас у мастера {{staff.name}}!");
  assert.equal((await own.post("/api/bc/check", { ...DRAFT, tplId: "W99" }).then(x => x.json())).ok, false);
  assert.equal((await sb.post("/api/bc/check", DRAFT)).status, 403, "сотрудник другой компании");
});

test("черновик создаётся (и сотрудником), одобряет только владелец, запуск со второго номера — 409 ga_off; одобрено не значит отправлено", { skip: consentSkip }, async () => {
  const s = await base(), own = await login(s, OWNER), sw = await login(s, STAFF_W), sb = await login(s, STAFF_B);
  const c = await (await sw.post("/api/bc/create", DRAFT)).json();
  assert.equal(c.ok, true, JSON.stringify(c));
  const b = s.kv.json("bc:winchester:" + c.b.id);
  assert.deepEqual({ ch: b.ch, src: b.src, status: b.status, render: b.render, tplId: b.tplId, total: b.total, by: b.by }, { ch: "ga", src: "crm", status: "ready", render: 1, tplId: undefined, total: 3, by: "staff" });
  assert.ok(b.msg.includes("{{visit.days_since}}") && !b.tpl, "шаблон Meta не нужен");
  assert.deepEqual(s.kv.json(`bcr:winchester:${c.b.id}:0`).map(x => x[0]).sort(), [dg(601), dg(602), dg(603)]);
  // одобрить: только владелец; рассылка остаётся «готова»
  assert.equal((await sw.post("/api/bc/act", { c: "winchester", id: c.b.id, act: "approve" })).status, 403);
  assert.equal((await sb.post("/api/bc/act", { c: "winchester", id: c.b.id, act: "approve" })).status, 403);
  let a = await (await own.post("/api/bc/act", { c: "winchester", id: c.b.id, act: "approve", op: "Кайрат" })).json();
  assert.equal(a.ok, true); assert.equal(a.b.status, "ready"); assert.equal(a.b.approvedBy, "Кайрат"); assert.ok(a.b.approvedAt > 0);
  const row = (await (await own.go("/api/bc/list?c=winchester")).json()).list.find(x => x.id === c.b.id);
  assert.equal(row.approved, true);
  // запуск: сотрудник — 403, владелец — 409 ga_off; ничего не ушло
  assert.equal((await sw.post("/api/bc/act", { c: "winchester", id: c.b.id, act: "start" })).status, 403);
  const st = await own.post("/api/bc/act", { c: "winchester", id: c.b.id, act: "start" }), sj = await st.json();
  assert.equal(st.status, 409); assert.equal(sj.error, "Запуск рассылок со второго номера выключен. Его включает владелец отдельным решением."); assert.equal(sj.code, "ga_off");
  assert.match(sj.how, /GA_BROADCAST_WINCHESTER = 1/, "владельцу — как включить");
  assert.equal(s.kv.json("bc:winchester:" + c.b.id).status, "ready"); assert.deepEqual(s.kv.json("bcrun") || [], []);
  await s.cron();
  assert.deepEqual(gaSent(), [], "ни одного сообщения");
  a = await (await own.post("/api/bc/act", { c: "winchester", id: c.b.id, act: "unapprove" })).json();
  assert.equal(a.ok, true); assert.equal(a.b.approvedBy, undefined);
  // тестовая версия: запрет второго номера — первым
  const p = mk({ ...ENV, STAGE: "preview" }), pown = await login(p, OWNER);
  p.kv.mem.set("crm:winchester:snap", s.kv.mem.get("crm:winchester:snap")); p.env.DB = s.env.DB;
  const pc = await (await pown.post("/api/bc/create", DRAFT)).json();
  assert.equal(pc.ok, true, JSON.stringify(pc));
  assert.equal((await (await pown.post("/api/bc/act", { c: "winchester", id: pc.b.id, act: "start" })).json()).code, "ga_off");
});

// 02.11.2026 (задание владельца): проба со второго номера — только владельцу и только на его номер для проверки («Автоматические
// сообщения» → «Номер для проверки»); номер из запроса не слушаем. Запрет запуска рассылок (gaNoBroadcast) пробу не держит: это не рассылка
test("проба себе со второго номера: текст на вымышленном клиенте; без номера для проверки — не уходит, текст виден; с ним — только на него", { skip: consentSkip }, async () => {
  const s = await base(), own = await login(s, OWNER);
  const r = await own.post("/api/bc/test", { ...DRAFT, to: "+7 700 000 09 99" }), j = await r.json();
  assert.equal(r.status, 409); assert.equal(j.code, "notest");
  assert.match(j.preview, /^Здравствуйте, Айгерим! С последней стрижки прошло 28 дней\./); assert.deepEqual(gaSent(), []);
  assert.equal((await own.post("/api/msg/auto", { c: "winchester", testPhone: "+7 700 000 09 97" })).status, 200);
  const ok = await (await own.post("/api/bc/test", { ...DRAFT, to: "+7 700 000 09 99", rid: "rid-probe-0001" })).json();
  assert.equal(ok.ok, true, JSON.stringify(ok)); assert.deepEqual(gaSent().map(x => x.to), ["77000000997"], "только на номер для проверки, Winchester — несмотря на запрет рассылок");
  net.reset();
  const bad = await (await own.post("/api/bc/test", { ...DRAFT, text: OWN.slotStaff, to: "+7 700 000 09 99" })).json();
  assert.match(bad.error, /впишите условия вместо \[скобок\]/i);
  net.reset();
  // у барбершопа нет ссылки на запись: текст со ссылкой не собрать — не отправляем, говорим почему
  assert.equal((await own.post("/api/msg/auto", { c: "barber", testPhone: "+7 700 000 09 98" })).status, 200);
  const nl = await own.post("/api/bc/test", { c: "barber", ch: "ga", segment: "all", text: OWN.beard, to: "+7 700 000 09 98" });
  assert.equal(nl.status, 400); assert.match((await nl.json()).error, /Нет ссылки на запись/); assert.deepEqual(gaSent(), []);
  const t = await (await own.post("/api/bc/test", { c: "barber", ch: "ga", segment: "all", text: "Здравствуйте, {имя}! Мастер {мастер} ждёт вас. " + "Если такие сообщения больше не нужны, напишите «стоп».", to: "+7 700 000 09 98" })).json();
  assert.equal(t.ok, true, JSON.stringify(t)); assert.equal(gaSent().length, 1);
  assert.equal(gaSent()[0].text, "Здравствуйте, Айгерим! Мастер Данияр ждёт вас. Если такие сообщения больше не нужны, напишите «стоп».");
  assert.equal(t.preview, gaSent()[0].text);
});

test("запрет снят (только в проверке): отправка собирает текст по свежей базе, пропускает тех, кому не собрать, ставит отметку «писали рекламу»", { skip: consentSkip }, async () => {
  const s = await base(), was = W.gaNoBroadcast;
  W.gaNoBroadcast = false;
  try {
    const r = await bcCreate(s.env, W, { ...DRAFT, text: OWN.staff }, Date.now(), "owner", { start: true });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.b.total, 2);
    for (let i = 0; i < 3; i++) { const b = s.kv.json("bc:winchester:" + r.b.id); if (b.status !== "running") break; if (b.nextAt) { b.nextAt = Date.now() - 1; s.kv.mem.set("bc:winchester:" + r.b.id, JSON.stringify(b)); } await bcTick(s.env, "winchester", r.b.id); }
    const out = gaSent();
    assert.equal(out.length, 2, JSON.stringify(out));
    assert.ok(out.some(x => x.to === dg(601) && /^Здравствуйте, Арман! С вашего визита в Winchester прошло 25 дней\. Можем записать к мастеру Тони, как в прошлый раз: https:\/\/winchester\.kz/.test(x.text)), JSON.stringify(out));
    assert.ok(out.every(x => !/[{}[\]]/.test(x.text) && x.to !== dg(603) && x.to !== dg(604)), "без скобок; без мастера и «стоп» — нет");
    const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
    assert.deepEqual((s.kv.json(`bcm:winchester:${today}`) || []).sort(), [dg(601), dg(602)], "реклама со второго номера — тоже реклама: 30 дней не писать");
    const h = s.kv.json(`h:ga:winchester:${dg(601)}`);
    assert.ok(h.turns.some(x => x.by === "bc" && /Можем записать к мастеру Тони/.test(x.text)), "в переписке — тот же текст, что ушёл");
  } finally { W.gaNoBroadcast = was; }
});

// ТЗ v4 §6 (08.11.2026): ночной снимок базы не знает о записях, сделанных сегодня, — рассылка писала рекламу тому, кто уже записался.
// Перед каждой порцией — будущие записи из журнала Altegio (как у автосценария, crmBookedNow); Altegio не ответил — ждём, а не шлём
test("ТЗ v4: записался сегодня (после ночного снимка) — рекламу не получает; Altegio не ответил — рассылка ждёт и не шлёт", { skip: consentSkip }, async () => {
  const s = await base(), was = W.gaNoBroadcast;
  W.gaNoBroadcast = false;
  try {
    const r = await bcCreate(s.env, W, { ...DRAFT, text: OWN.staff }, Date.now(), "owner", { start: true });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.b.total, 2);
    const tick = async () => { const b = s.kv.json("bc:winchester:" + r.b.id); if (b.status !== "running") return b; for (const k of ["nextAt", "retryAt"]) if (b[k]) b[k] = Date.now() - 1; s.kv.mem.set("bc:winchester:" + r.b.id, JSON.stringify(b)); await bcTick(s.env, "winchester", r.b.id); return s.kv.json("bc:winchester:" + r.b.id); };
    net.altJournalFail = 500; // журнал не читается — не видно, кто записался
    let b = await tick();
    assert.deepEqual(gaSent(), [], "без журнала — не шлём");
    assert.equal(b.status, "running"); assert.match(String(b.retryWhy), /не видно, кто записался/);
    net.altJournalFail = 0;
    const fut = rec(ph(601), -2, { name: "Арман" }); fut.attendance = 0; fut.create_date = new Date().toISOString(); // записался сегодня на послезавтра
    net.altJournal.push(fut);
    for (let i = 0; i < 4; i++) b = await tick();
    const out = gaSent();
    assert.deepEqual(out.map(x => x.to), [dg(602)], JSON.stringify(out));
    assert.ok((b.excl || 0) >= 1, JSON.stringify(b));
  } finally { W.gaNoBroadcast = was; net.altJournalFail = 0; }
});
