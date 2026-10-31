// Библиотека рекламных текстов (ТЗ Winchester v2.0 §5, v3.0 31.10.2026): 28 тем RU/KZ простым языком, у каждого — строка «стоп»,
// рубрика, для кого, что проверить; вставки — новые ({{client.first_name}}); выдуманного нет. Правит, одобряет, копирует и убирает
// в архив только владелец, с историей версий; [скобки] (свободное время, акция) — «нужны данные», одобрить нельзя, пока не вписаны.
// Пример — на клиентах сегмента с согласием (номера маской) или на вымышленном клиенте, и тот же текст без имени.
// Кампанию запускает только владелец; тестовая версия (dev) не рассылает.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { LIBRARY, CATS, STOP_RU, STOP_KK, companyOf } from "../../src/services/broadcast/library.js";
import { render, dataFor, usedVars, VARS } from "../../src/services/broadcast/render.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";

const login = async (s, key) => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${key}&next=%2Fapp%2F` }); return b; };
const W = CLIENTS.winchester, KEYS = new Set(VARS.map(x => x.key));
// выдуманные факты и приёмы, которых в текстах быть не должно (ТЗ v3.0)
const FAKE = /спокойнее|любимое кресло|скучает|скучаем|обычно вы|VIP|\d+\s*%|скидк|только для вас|эксклюзив/i;

test("стартовая библиотека: 28 тем, рубрика, для кого и что проверить, RU и KZ со строкой «стоп», без выдуманного и тире-разделителей", () => {
  assert.equal(LIBRARY.length, 28); assert.deepEqual(LIBRARY.map(x => x.id), Array.from({ length: 28 }, (_, i) => "M" + String(i + 1).padStart(2, "0")));
  assert.deepEqual(CATS.map(x => x.label), ["Приглашения", "Давно не были", "Свободное время", "Постоянные клиенты", "Услуги", "Поводы", "Персональные"]);
  for (const x of LIBRARY) {
    assert.ok(CATS.some(c => c.id === x.cat), x.id + ": рубрика");
    assert.ok(x.title && x.who && x.goal && x.check, x.id + ": название, для кого, цель, что проверить");
    assert.ok(Array.isArray(x.needs) && x.kkChecked === false, x.id);
    assert.ok(x.ru.endsWith("\n\n" + STOP_RU) && x.kk.endsWith("\n\n" + STOP_KK), x.id + ": строка «стоп»");
    assert.equal(STOP_RU, "Если такие сообщения больше не нужны, напишите «стоп».");
    const body = x.ru.slice(0, -STOP_RU.length).replace(/\[[^\]]*\]/g, "");
    assert.ok(!FAKE.test(body), `${x.id}: выдуманное: ${x.ru}`);
    for (const t of [x.ru, x.kk, x.title, x.who, x.check]) assert.ok(!/ — |\{\{1\}\}|\{(имя|мастер|ссылка|дней|компания|услуга)\}/.test(t), `${x.id}: без тире и старых вставок: ${t}`);
    for (const k of [...usedVars(x.ru), ...usedVars(x.kk)]) assert.ok(KEYS.has(k), `${x.id}: вставка ${k}`);
    assert.ok(body.trim().split(/(?<=[.!?])\s+/).filter(Boolean).length <= 3, `${x.id}: 1–3 предложения: ${body}`);
    const br = /[[\]]/.test(x.ru);
    assert.equal(br, x.needs.length > 0, `${x.id}: [скобки] — ровно у тем, где нужны настоящие данные`);
    assert.equal(/[[\]]/.test(x.kk), br, x.id + ": и в казахском");
    // с полными данными — собирается (кроме тем с [скобками]); без имени — без «, !»
    for (const t of [x.ru, x.kk]) {
      const r = render(t, dataFor({ name: "Арман", staff: "Тони", svc: "Мужская стрижка", d: 28 }, companyOf(W)));
      assert.equal(r.blocked, br, `${x.id}: ${JSON.stringify(r)}`);
      const n = render(t, dataFor({ name: "", staff: "Тони", svc: "Мужская стрижка", d: 28 }, companyOf(W)));
      assert.ok(!/,\s*[!?.]|^\s*,|[ \t]{2,}/.test(n.text), `${x.id} без имени: ${n.text}`);
      if (!br) assert.ok(/^\p{Lu}/u.test(n.text), `${x.id} без имени — с заглавной: ${n.text}`);
    }
  }
  for (const id of ["M06", "M07", "M08", "M09", "M21"]) assert.deepEqual(LIBRARY.find(x => x.id === id).needs, ["slot"], id);
  assert.equal(companyOf(W).url, "https://winchester.kz");
});

test("GET /api/bc/templates: вставки с подписями, рубрики, числа, статусы; правит и одобряет только владелец; [скобки] не одобрить; история версий", async () => {
  net.reset();
  const s = mk({ KEY_WINCHESTER: "staff-key-winch-0001", KEY_BARBER: "staff-key-barber-0001" }), own = await login(s, "owner-key-123456"), staff = await login(s, "staff-key-winch-0001");
  let r = await (await own.go("/api/bc/templates?c=winchester")).json();
  assert.deepEqual(Object.keys(r).sort(), ["cats", "counts", "items", "owner", "vars"]);
  assert.equal(r.vars.length, 7); assert.ok(r.vars.every(x => x.key && x.label && x.sample), JSON.stringify(r.vars));
  assert.equal(r.vars.find(x => x.key === "company.name").sample, "Winchester");
  assert.equal(r.cats.length, 7);
  assert.deepEqual(r.counts, { total: 28, approved: 0, review: 28, facts: 12, archived: 0 });
  assert.ok(r.items.every(x => !x.approved && x.kkChecked === false && ["review", "facts"].includes(x.status)), "по умолчанию ничего не одобрено");
  const m24 = r.items.find(x => x.id === "M24");
  assert.equal(m24.status, "facts"); assert.deepEqual(m24.needs, ["offer"]); assert.equal(r.items.find(x => x.id === "M01").status, "review");
  assert.equal((await staff.post("/api/bc/templates", { c: "winchester", id: "M01", approved: true })).status, 403);
  assert.equal((await (await login(s, "staff-key-barber-0001")).go("/api/bc/templates?c=winchester")).status, 403, "сотрудник другой компании");
  r = await (await own.post("/api/bc/templates", { c: "winchester", id: "M24", approved: true })).json();
  assert.match(r.error, /скобок/);
  // старые вставки при сохранении переводятся в новые
  r = await (await own.post("/api/bc/templates", { c: "winchester", id: "M24", ru: "{имя}, до 30 ноября стрижка и борода по цене стрижки. Запись: {ссылка}\n\n" + STOP_RU, kk: "{имя}, 30 қарашаға дейін. {ссылка} «стоп» деп жазыңыз.", approved: true, op: "Владелец" })).json();
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.item.approved, true); assert.equal(r.item.status, "approved"); assert.equal(r.item.v, 2); assert.equal(r.item.history.length, 1);
  assert.ok(r.item.ru.startsWith("{{client.first_name}}, до 30 ноября") && r.item.ru.includes("{{booking.url}}\n\n"), r.item.ru);
  assert.equal(r.item.approvedBy, "Владелец");
  // изменили текст одобренного — одобрение снимается
  r = await (await own.post("/api/bc/templates", { c: "winchester", id: "M24", ru: r.item.ru.replace("30 ноября", "1 декабря") })).json();
  assert.equal(r.item.approved, false); assert.equal(r.item.status, "review"); assert.equal(r.item.v, 3);
  // только одобрение, текст тот же — версия та же
  r = await (await own.post("/api/bc/templates", { c: "winchester", id: "M24", approved: true })).json();
  assert.equal(r.item.approved, true); assert.equal(r.item.v, 3);
  r = await (await own.post("/api/bc/templates", { c: "winchester", title: "Своё", ru: "Без отказа" })).json();
  assert.match(r.error, /стоп/);
  r = await (await own.post("/api/bc/templates", { c: "winchester", title: "Своё", ru: "{{client.first_name}}, ждём вас! {{x.y}} " + STOP_RU })).json();
  assert.match(r.error, /Неизвестная вставка/);
  r = await (await own.post("/api/bc/templates", { c: "winchester", title: "Своё", cat: "invite", ru: "{имя}, ждём вас! " + STOP_RU })).json();
  assert.equal(r.ok, true); assert.ok(r.item.custom); assert.equal(r.item.cat, "invite");
  const g = await (await staff.go("/api/bc/templates?c=winchester")).json();
  assert.ok(g.items.find(x => x.id === "M24").approved && g.items.some(x => x.custom), "сотрудник видит одобренное и своё");
  assert.equal(g.counts.total, 29); assert.equal(g.counts.approved, 1); assert.equal(g.owner, false);
});

test("POST /api/bc/templates/action: копия, архив, вернуть — только владелец", async () => {
  net.reset();
  const s = mk({ KEY_WINCHESTER: "staff-key-winch-0001" }), own = await login(s, "owner-key-123456"), staff = await login(s, "staff-key-winch-0001");
  assert.equal((await staff.post("/api/bc/templates/action", { c: "winchester", id: "M01", action: "duplicate" })).status, 403);
  let r = await (await own.post("/api/bc/templates/action", { c: "winchester", id: "M01", action: "duplicate" })).json();
  assert.equal(r.ok, true); assert.match(r.item.id, /^U/); assert.equal(r.item.title, "Пора обновить стрижку (копия)");
  assert.equal(r.item.custom, true); assert.equal(r.item.approved, false); assert.equal(r.item.cat, "invite"); assert.equal(r.item.ru, LIBRARY[0].ru);
  const copy = r.item.id;
  r = await (await own.post("/api/bc/templates/action", { c: "winchester", id: "M02", action: "archive" })).json();
  assert.equal(r.ok, true); assert.equal(r.item.archived, true);
  r = await (await own.post("/api/bc/templates/action", { c: "winchester", id: copy, action: "archive" })).json();
  let list = await (await own.go("/api/bc/templates?c=winchester")).json();
  assert.deepEqual(list.counts, { total: 27, approved: 0, review: 27, facts: 12, archived: 2 });
  assert.equal(list.items.find(x => x.id === copy).title, "Пора обновить стрижку (копия)", "копия в архиве цела");
  r = await (await own.post("/api/bc/templates/action", { c: "winchester", id: "M02", action: "restore" })).json();
  assert.equal(r.item.archived, false);
  list = await (await own.go("/api/bc/templates?c=winchester")).json();
  assert.equal(list.counts.archived, 1); assert.equal(list.items.find(x => x.id === "M02").ru, LIBRARY[1].ru, "текст стартовой темы не тронут");
  assert.equal((await own.post("/api/bc/templates/action", { c: "winchester", id: "M99", action: "archive" })).status, 404);
  assert.equal((await own.post("/api/bc/templates/action", { c: "winchester", id: "M01", action: "delete" })).status, 400);
});

test("пример: на вымышленном клиенте, если базы нет; тот же текст без имени; [скобки] — с причиной; свой текст", async () => {
  net.reset();
  const s = mk({ KEY_WINCHESTER: "staff-key-winch-0001" }), staff = await login(s, "staff-key-winch-0001");
  let pv = await (await staff.post("/api/bc/templates/preview", { c: "winchester", id: "M01", lang: "kk" })).json();
  assert.equal(pv.ok, true); assert.equal(pv.demo, true); assert.equal(pv.lang, "kk");
  assert.deepEqual(Object.keys(pv).sort(), ["blocked", "demo", "issues", "lang", "list", "missing", "noName", "ok"]);
  assert.deepEqual(Object.keys(pv.list[0]).sort(), ["issues", "name", "text", "to"]);
  assert.equal(pv.list[0].to, "пример"); assert.equal(pv.list[0].name, "Арман");
  assert.match(pv.list[0].text, /^Сәлеметсіз бе, Арман! Соңғы шаш алдырғаныңызға 28 күн болды\./); assert.match(pv.list[0].text, /https:\/\/winchester\.kz/); assert.match(pv.list[0].text, /стоп/);
  assert.match(pv.noName.text, /^Сәлеметсіз бе! Соңғы/); assert.equal(pv.blocked, false);
  pv = await (await staff.post("/api/bc/templates/preview", { c: "winchester", id: "M06", lang: "ru" })).json();
  assert.equal(pv.blocked, true); assert.deepEqual(pv.list[0].issues, ["Впишите условия вместо [скобок]"]); assert.ok(!/[[\]{}]/.test(pv.list[0].text));
  pv = await (await staff.post("/api/bc/templates/preview", { c: "winchester", text: "{имя}, мастер {мастер} ждёт. {{booking.url}}" })).json();
  assert.equal(pv.list[0].text, "Арман, мастер Данияр ждёт. https://winchester.kz");
  assert.equal(pv.noName.text, "Мастер Данияр ждёт. https://winchester.kz");
  assert.equal((await staff.post("/api/bc/templates/preview", { c: "winchester", id: "M99" })).status, 404);
  assert.equal((await staff.post("/api/bc/templates/preview", { c: "winchester" })).status, 400);
});

test("тестовая версия (STAGE=preview) рассылку не запускает: проверка и создание работают, запуск — 409; BC_DEV_REAL=1 (заглушки) — запускает", async () => {
  net.reset();
  const META = { WA_TOKEN_BARBER: "tok-barber", APP_SECRET_BARBER: "sec-barber", PHONE_NUMBER_ID_BARBER: "900222" };
  const FORM = { c: "barber", name: "Октябрь", tpl: "promo_october", lang: "ru", text: "Здравствуйте, {{1}}! Чтобы не получать сообщения, ответьте СТОП", params: "{имя}", recipients: "+7 701 111 00 01, Арман", cap: 100, from: 10, to: 20, consent: true };
  for (const [extra, want] of [[{}, 409], [{ BC_DEV_REAL: "1" }, 200]]) {
    const s = mk({ STAGE: "preview", ...META, ...extra }), own = await login(s, "owner-key-123456");
    const c = await (await own.post("/api/bc/create", FORM)).json();
    assert.equal(c.ok, true, JSON.stringify(c));
    const r = await own.post("/api/bc/act", { c: "barber", id: c.b.id, act: "start" });
    assert.equal(r.status, want);
    if (want === 409) { const j = await r.json(); assert.match(j.error, /тестовая версия/); assert.equal(j.code, "preview"); }
  }
});
