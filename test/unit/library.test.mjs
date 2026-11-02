// Библиотека рекламных текстов: с 02.11.2026 (финальное ТЗ рассылок Winchester) стартовые тексты — 28 утверждённых владельцем
// (W01–W28, слово в слово — test/unit/campaign-final.test.mjs). Здесь — общие правила: правит, одобряет, копирует и убирает в архив
// только владелец, с историей версий; свои тексты со вставками ({{client.first_name}}), старые вставки переводятся в новые;
// [скобки] (свободное время, акция) — «нужны данные», одобрить нельзя. Пример — на клиентах сегмента или на вымышленном клиенте,
// и тот же текст без имени. Кампанию запускает только владелец; тестовая версия (dev) не рассылает.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { LIBRARY, STOP_RU, companyOf } from "../../src/services/broadcast/library.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";

const login = async (s, key) => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${key}&next=%2Fapp%2F` }); return b; };
const W = CLIENTS.winchester;

test("GET /api/bc/templates: вставки с подписями, рубрики, числа, статусы; правит и одобряет только владелец; [скобки] не одобрить; история версий", async () => {
  net.reset();
  const s = mk({ KEY_WINCHESTER: "staff-key-winch-0001", KEY_BARBER: "staff-key-barber-0001" }), own = await login(s, "owner-key-123456"), staff = await login(s, "staff-key-winch-0001");
  let r = await (await own.go("/api/bc/templates?c=winchester")).json();
  assert.deepEqual(Object.keys(r).sort(), ["cats", "counts", "items", "owner", "vars"]);
  assert.equal(r.vars.length, 7); assert.ok(r.vars.every(x => x.key && x.label && x.sample), JSON.stringify(r.vars));
  assert.equal(r.vars.find(x => x.key === "company.name").sample, "Winchester");
  assert.equal(r.cats.length, 7);
  assert.deepEqual(r.counts, { total: 28, approved: 28, review: 0, facts: 0, archived: 0 });
  assert.equal((await staff.post("/api/bc/templates", { c: "winchester", id: "W01", approved: false })).status, 403);
  assert.equal((await (await login(s, "staff-key-barber-0001")).go("/api/bc/templates?c=winchester")).status, 403, "сотрудник другой компании");
  // свой текст с [скобками]: «нужны данные», одобрить нельзя; старые вставки при сохранении переводятся в новые
  r = await (await own.post("/api/bc/templates", { c: "winchester", title: "Акция", cat: "occasions", ru: "{имя}, до [дата] стрижка и борода по цене стрижки. Запись: {ссылка}", approved: true })).json();
  assert.match(r.error, /скобок/);
  r = await (await own.post("/api/bc/templates", { c: "winchester", title: "Акция", cat: "occasions", ru: "{имя}, до [дата] стрижка и борода по цене стрижки. Запись: {ссылка}" })).json();
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.item.status, "facts"); assert.equal(r.item.custom, true);
  assert.equal(r.item.ru, "{{client.first_name}}, до [дата] стрижка и борода по цене стрижки. Запись: {{booking.url}}");
  const id = r.item.id;
  r = await (await own.post("/api/bc/templates", { c: "winchester", id, ru: "{имя}, до 30 ноября стрижка и борода по цене стрижки. Запись: {ссылка}\n\n" + STOP_RU, approved: true, op: "Владелец" })).json();
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.item.approved, true); assert.equal(r.item.status, "approved"); assert.equal(r.item.v, 2); assert.equal(r.item.history.length, 1);
  assert.equal(r.item.approvedBy, "Владелец");
  // изменили текст одобренного — одобрение снимается; только одобрение, текст тот же — версия та же
  r = await (await own.post("/api/bc/templates", { c: "winchester", id, ru: r.item.ru.replace("30 ноября", "1 декабря") })).json();
  assert.equal(r.item.approved, false); assert.equal(r.item.status, "review"); assert.equal(r.item.v, 3);
  r = await (await own.post("/api/bc/templates", { c: "winchester", id, approved: true })).json();
  assert.equal(r.item.approved, true); assert.equal(r.item.v, 3);
  r = await (await own.post("/api/bc/templates", { c: "winchester", title: "Своё", ru: "{{client.first_name}}, ждём вас! {{x.y}}" })).json();
  assert.match(r.error, /Неизвестная вставка/);
  r = await (await own.post("/api/bc/templates", { c: "winchester", title: "Без отказа", cat: "warm", ru: "Добрый день! Ждём вас 😊" })).json();
  assert.equal(r.ok, true, "строка «стоп» в своём тексте не обязательна (её добавляют в мастере рассылки)");
  const g = await (await staff.go("/api/bc/templates?c=winchester")).json();
  assert.ok(g.items.some(x => x.custom && x.approved), "сотрудник видит одобренное и своё");
  assert.equal(g.counts.total, 30); assert.equal(g.counts.approved, 29); assert.equal(g.owner, false);
});

test("POST /api/bc/templates/action: копия, архив, вернуть — только владелец", async () => {
  net.reset();
  const s = mk({ KEY_WINCHESTER: "staff-key-winch-0001" }), own = await login(s, "owner-key-123456"), staff = await login(s, "staff-key-winch-0001");
  assert.equal((await staff.post("/api/bc/templates/action", { c: "winchester", id: "W01", action: "duplicate" })).status, 403);
  let r = await (await own.post("/api/bc/templates/action", { c: "winchester", id: "W01", action: "duplicate" })).json();
  assert.equal(r.ok, true); assert.match(r.item.id, /^U/); assert.equal(r.item.title, "Знакомые лица (копия)");
  assert.equal(r.item.custom, true); assert.equal(r.item.approved, false); assert.equal(r.item.cat, "warm"); assert.equal(r.item.ru, LIBRARY[0].ru);
  const copy = r.item.id;
  r = await (await own.post("/api/bc/templates/action", { c: "winchester", id: "W02", action: "archive" })).json();
  assert.equal(r.ok, true); assert.equal(r.item.archived, true);
  r = await (await own.post("/api/bc/templates/action", { c: "winchester", id: copy, action: "archive" })).json();
  let list = await (await own.go("/api/bc/templates?c=winchester")).json();
  assert.deepEqual(list.counts, { total: 27, approved: 27, review: 0, facts: 0, archived: 2 });
  assert.equal(list.items.find(x => x.id === copy).title, "Знакомые лица (копия)", "копия в архиве цела");
  r = await (await own.post("/api/bc/templates/action", { c: "winchester", id: "W02", action: "restore" })).json();
  assert.equal(r.item.archived, false);
  list = await (await own.go("/api/bc/templates?c=winchester")).json();
  assert.equal(list.counts.archived, 1); assert.equal(list.items.find(x => x.id === "W02").ru, LIBRARY[1].ru, "текст стартовой темы не тронут");
  assert.equal((await own.post("/api/bc/templates/action", { c: "winchester", id: "W99", action: "archive" })).status, 404);
  assert.equal((await own.post("/api/bc/templates/action", { c: "winchester", id: "W01", action: "delete" })).status, 400);
});

test("пример: на вымышленном клиенте, если базы нет; тот же текст без имени; [скобки] — с причиной; свой текст", async () => {
  net.reset();
  const s = mk({ KEY_WINCHESTER: "staff-key-winch-0001" }), staff = await login(s, "staff-key-winch-0001");
  let pv = await (await staff.post("/api/bc/templates/preview", { c: "winchester", id: "W01" })).json();
  assert.equal(pv.ok, true); assert.equal(pv.demo, true); assert.equal(pv.lang, "ru");
  assert.deepEqual(Object.keys(pv).sort(), ["blocked", "demo", "issues", "lang", "list", "missing", "noName", "ok"]);
  assert.deepEqual(Object.keys(pv.list[0]).sort(), ["issues", "name", "text", "to"]);
  assert.equal(pv.list[0].to, "пример"); assert.equal(pv.list[0].name, "Арман");
  assert.equal(pv.list[0].text, LIBRARY[0].ru.replace("Добрый день!", "Добрый день, Арман!"));
  assert.equal(pv.noName.text, LIBRARY[0].ru); assert.equal(pv.blocked, false);
  pv = await (await staff.post("/api/bc/templates/preview", { c: "winchester", text: "Сегодня у мастера {мастер} есть время: [время]. Записать вас?" })).json();
  assert.equal(pv.blocked, true); assert.deepEqual(pv.list[0].issues, ["Впишите условия вместо [скобок]"]); assert.ok(!/[[\]{}]/.test(pv.list[0].text));
  pv = await (await staff.post("/api/bc/templates/preview", { c: "winchester", text: "{имя}, мастер {мастер} ждёт. {{booking.url}}" })).json();
  assert.equal(pv.list[0].text, "Арман, мастер Данияр ждёт. https://winchester.kz");
  assert.equal(pv.noName.text, "Мастер Данияр ждёт. https://winchester.kz");
  assert.equal((await staff.post("/api/bc/templates/preview", { c: "winchester", id: "W99" })).status, 404);
  assert.equal((await staff.post("/api/bc/templates/preview", { c: "winchester" })).status, 400);
  assert.equal(companyOf(W).url, "https://winchester.kz");
});

test("тестовая версия (STAGE=preview) рассылку не запускает: проверка и создание работают, запуск — 409, и BC_DEV_REAL этого не меняет (аудит 31.10.2026); боевой сайт — запускает", async () => {
  net.reset();
  const META = { WA_TOKEN_BARBER: "tok-barber", APP_SECRET_BARBER: "sec-barber", PHONE_NUMBER_ID_BARBER: "900222" };
  const FORM = { c: "barber", name: "Октябрь", tpl: "promo_october", lang: "ru", text: "Здравствуйте, {{1}}! Чтобы не получать сообщения, ответьте СТОП", params: "{имя}", recipients: "+7 701 111 00 01, Арман", cap: 100, from: 10, to: 20, consent: true };
  for (const [extra, want] of [[{ STAGE: "preview" }, 409], [{ STAGE: "preview", BC_DEV_REAL: "1" }, 409], [{}, 200]]) {
    const s = mk({ ...META, ...extra }), own = await login(s, "owner-key-123456");
    const c = await (await own.post("/api/bc/create", FORM)).json();
    assert.equal(c.ok, true, JSON.stringify(c));
    const r = await own.post("/api/bc/act", { c: "barber", id: c.b.id, act: "start" });
    assert.equal(r.status, want);
    if (want === 409) { const j = await r.json(); assert.match(j.error, /тестовая версия/); assert.equal(j.code, "preview"); }
  }
});
