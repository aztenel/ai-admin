// Поля для раздела «Рассылки» нового пульта (apps/pult, 19.10.2026): в /api/bc/list у номера бота — почему с него нельзя рассылать
// (ga.bcOff, Winchester: gaNoBroadcast), в строках списка — кто создал, откуда получатели, сегмент и шаблон (by, src, seg, tpl):
// история рассылок без чтения каждой рассылки. Метаданные KV — не больше 1024 байт даже с длинными названиями.
// Всё на заглушках; номера вымышленные (+7 700 000 0x xx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { crmBuild as crmBuild0 } from "../../src/services/crm/snapshot.js";
import { grantSnap, consentSkip } from "../consent.mjs";
// рассылки по базе — только с подтверждённым согласием (31.10.2026): в проверках согласие выдаётся всем клиентам снимка (test/consent.mjs)
const crmBuild = async (env, c, at) => { const r = await crmBuild0(env, c, at); await grantSnap(env, c.id); return r; };
import { bcMeta } from "../../src/db/kv/broadcasts.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";

const OWNER = "owner-key-123456", STAFF_W = "staff-key-winch-0001";
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", KEY_WINCHESTER: STAFF_W,
  WA_TOKEN_WINCHESTER: "tok-w", PHONE_NUMBER_ID_WINCHESTER: "900333", APP_SECRET_WINCHESTER: "sec-w",
  GA_ID_WINCHESTER: "7105000071", GA_TOKEN_WINCHESTER: "ga-tok-w", GA_ID_BARBER: "7105000072", GA_TOKEN_BARBER: "ga-tok-b",
  WA_TOKEN_BARBER: "tok-b", PHONE_NUMBER_ID_BARBER: "900444", APP_SECRET_BARBER: "sec-b" };
const NOW = Date.now();
const day = n => new Date(NOW - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
let rid = 0;
const rec = (phone, n) => ({ id: ++rid, datetime: `${day(n)}T12:00:00+05:00`, deleted: false, attendance: 1, staff: { id: 1, name: "Мастер 1" },
  client: { id: +String(phone).replace(/\D/g, "").slice(-6), phone, name: "Клиент" }, services: [{ id: 1, title: "Мужская стрижка" }] });
const ph = i => "+7700000" + String(i).padStart(4, "0");
const FORM = { c: "winchester", name: "Пора на стрижку", tpl: "pora_na_strizhku", lang: "ru", params: "{имя}", text: "{{1}}, пора на стрижку! Чтобы не получать сообщения, ответьте СТОП", cap: 240, from: 10, to: 20, consent: true };

async function login(s, key) {
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${encodeURIComponent(key)}&next=%2Finbox` });
  assert.ok(b.cookie, "вход ключом " + key.slice(0, 9));
  return b;
}

test("/api/bc/list: у номера бота Winchester — почему рассылки выключены, у других компаний — пусто", async () => {
  net.reset();
  const s = mk(ENV), own = await login(s, OWNER), sw = await login(s, STAFF_W);
  for (const b of [own, sw]) {
    const d = await (await b.go("/api/bc/list?c=winchester")).json();
    assert.ok(d.ga, JSON.stringify(d));
    assert.equal(d.ga.bcOff, "Запуск рассылок со второго номера выключен. Его включает владелец отдельным решением.");
    assert.equal(d.ready, true, "основной номер готов — его рассылки не тронуты");
  }
  const b = await (await own.go("/api/bc/list?c=barber")).json();
  assert.equal(b.ga.bcOff, "", "у барбершопа рассылки с номера Green-API разрешены");
  assert.equal(CLIENTS.barber.gaNoBroadcast, undefined);
});

test("/api/bc/list: строка рассылки — кто создал, откуда получатели, сегмент и шаблон", { skip: consentSkip }, async () => {
  net.reset();
  net.altJournal = [rec(ph(101), 25), rec(ph(102), 30), rec(ph(103), 40)];
  const s = mk(ENV);
  await crmBuild(s.env, CLIENTS.winchester, NOW);
  const own = await login(s, OWNER), sw = await login(s, STAFF_W);
  const seg = await (await sw.post("/api/bc/create", { ...FORM, segment: "pora" })).json();
  assert.equal(seg.ok, true, JSON.stringify(seg));
  const list = await (await own.post("/api/bc/create", { ...FORM, name: "Список", recipients: "8 700 000 02 01, Айгерим" })).json();
  assert.equal(list.ok, true, JSON.stringify(list));
  const ga = await (await own.post("/api/bc/create", { c: "barber", ch: "ga", name: "Скидка", text: "{имя}, скидка 10% до пятницы!", recipients: "8 700 000 03 01, Данияр", cap: 50, from: 10, to: 20, consent: true })).json();
  assert.equal(ga.ok, true, JSON.stringify(ga));

  const rows = (await (await own.go("/api/bc/list?c=winchester")).json()).list;
  const r1 = rows.find(r => r.id === seg.b.id), r2 = rows.find(r => r.id === list.b.id);
  assert.deepEqual({ by: r1.by, src: r1.src, seg: r1.seg, tpl: r1.tpl, ch: r1.ch }, { by: "staff", src: "crm", seg: "Пора на стрижку", tpl: "pora_na_strizhku", ch: undefined });
  assert.deepEqual({ by: r2.by, src: r2.src, seg: r2.seg, tpl: r2.tpl }, { by: "owner", src: undefined, seg: undefined, tpl: "pora_na_strizhku" });
  const t = JSON.stringify(rows);
  assert.ok(![101, 102, 103].some(i => t.includes(ph(i).slice(1))) && !t.includes("7000000201"), "в списке рассылок нет номеров");
  const r3 = (await (await own.go("/api/bc/list?c=barber")).json()).list.find(r => r.id === ga.b.id);
  assert.deepEqual({ by: r3.by, ch: r3.ch, tpl: r3.tpl, src: r3.src }, { by: "owner", ch: "ga", tpl: undefined, src: undefined });
});

test("метаданные строки — не больше 1024 байт даже с длинными названием, сегментом и шаблоном", () => {
  const m = bcMeta({ name: "Ж".repeat(300), status: "running", total: 100000, pos: 99999, sent: 99999, failed: 99999, skipped: 99999, excl: 99999, created: NOW, ch: "ga",
    by: "auto", src: "crm", seg: "Давно не были · 40–60 дн. с визита · мастер " + "Щ".repeat(200), tpl: "a".repeat(512) });
  assert.ok(Buffer.byteLength(JSON.stringify(m), "utf8") <= 1024, String(Buffer.byteLength(JSON.stringify(m), "utf8")));
  assert.equal(m.by, "auto"); assert.equal(m.src, "crm"); assert.equal(m.tpl.length, 60); assert.equal(m.seg.length, 60);
  assert.deepEqual(Object.keys(bcMeta({ name: "x", status: "ready", total: 1, pos: 0, sent: 0, failed: 0, skipped: 0, created: NOW })).sort(), ["created", "failed", "name", "pos", "sent", "skipped", "status", "total"], "старые рассылки без новых полей — как раньше");
});

// находка проверки 19.10.2026: сотрудник снимал сигнал Meta «остановиться» для всего номера кнопкой «Всё равно запустить» (force), хотя
// «Снять сигнал Meta» ему не показывают и сервер его не разрешает. Теперь при сигнале сотрудник получает 403 без вопроса, сигнал на месте;
// владелец — вопрос, в котором сказано, что сигнал снимется для всех рассылок с номера и для автосценария.
test("сигнал Meta: сотрудник не снимает его запуском рассылки (403, сигнал на месте); владелец — вопрос с последствием, потом force", async () => {
  net.reset();
  const s = mk(ENV), own = await login(s, OWNER), sw = await login(s, STAFF_W);
  const made = await (await sw.post("/api/bc/create", { ...FORM, name: "Список", recipients: "8 700 000 02 01, Айгерим" })).json();
  assert.equal(made.ok, true, JSON.stringify(made));
  const id = made.b.id;
  await s.kv.api.put("bchold:winchester", JSON.stringify({ all: { at: NOW, why: "Meta ограничила аккаунт WhatsApp" } }));
  for (const force of [false, true]) {
    const r = await sw.post("/api/bc/act", { c: "winchester", id, act: "start", force }), d = await r.json();
    assert.equal(r.status, 403, JSON.stringify(d));
    assert.match(d.error, /только владелец/); assert.equal(d.confirm, undefined);
  }
  assert.ok(s.kv.json("bchold:winchester"), "сигнал на месте");
  assert.equal(s.kv.json(`bc:winchester:${id}`).status, "ready");
  const q = await own.post("/api/bc/act", { c: "winchester", id, act: "start" }), qd = await q.json();
  assert.equal(q.status, 409);
  assert.match(qd.confirm, /снимется для всех рассылок с основного номера и для автосценария/);
  assert.match(qd.confirm, /Всё равно продолжить\?$/);
  const ok = await (await own.post("/api/bc/act", { c: "winchester", id, act: "start", force: true })).json();
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(s.kv.json("bchold:winchester"), null, "владелец снял сигнал");
});
