// Библиотека рекламных текстов (ТЗ Winchester v2.0 §5, §11 п. 13): не меньше 25 тем RU/KZ, у каждого «стоп»; правит и одобряет
// только владелец, с историей версий; [скобки] (условия акции, свободное время) — одобрить нельзя, пока не вписаны настоящие;
// предпросмотр — на клиентах сегмента с согласием, номера маской. Кампанию запускает только владелец; черновик (dev) не рассылает.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { LIBRARY, render } from "../../src/services/broadcast/library.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";

const login = async (s, key) => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${key}&next=%2Fapp%2F` }); return b; };

test("стартовая библиотека: 28 тем, у каждой русский и казахский текст с «стоп», без выдуманных скидок", () => {
  assert.ok(LIBRARY.length >= 25); assert.equal(new Set(LIBRARY.map(x => x.id)).size, LIBRARY.length);
  for (const x of LIBRARY) {
    assert.ok(x.ru && x.kk, x.id); assert.match(x.ru, /стоп/i, x.id); assert.match(x.kk, /стоп/i, x.id);
    assert.ok(!/\d+\s*%|скидк/i.test(x.ru.replace(/\[[^\]]*\]/g, "")), `${x.id}: скидка только в [скобках] — её вписывает владелец`);
  }
  assert.equal(render("{имя}, прошло {дней} дней — {мастер} ждёт", { name: "Арман Сейтов", d: 28, staff: "Тони" }, CLIENTS.winchester), "Арман, прошло 28 дней — Тони ждёт");
  assert.equal(render("{имя}, здравствуйте!", { name: "" }, CLIENTS.winchester), "Здравствуйте!", "без имени — без обращения");
});

test("правка и одобрение — только владелец; [скобки] не одобрить; история версий; свой текст", async () => {
  net.reset();
  const s = mk({ KEY_WINCHESTER: "staff-key-winch-0001" }), own = await login(s, "owner-key-123456"), staff = await login(s, "staff-key-winch-0001");
  let r = await (await own.go("/api/bc/templates?c=winchester")).json();
  assert.ok(r.items.length >= 28); assert.ok(r.items.every(x => !x.approved), "по умолчанию ничего не одобрено");
  const m24 = r.items.find(x => x.id === "M24");
  assert.match(m24.need, /акци/);
  assert.equal((await staff.post("/api/bc/templates", { c: "winchester", id: "M01", approved: true })).status, 403);
  r = await (await own.post("/api/bc/templates", { c: "winchester", id: "M24", approved: true })).json();
  assert.match(r.error, /скобок/);
  r = await (await own.post("/api/bc/templates", { c: "winchester", id: "M24", ru: "{имя}, до 30 ноября стрижка + борода по цене стрижки. Запись: {ссылка} Не хотите получать сообщения — ответьте «стоп».", kk: "{имя}, 30 қарашаға дейін. {ссылка} «стоп» деп жауап беріңіз.", approved: true, op: "Владелец" })).json();
  assert.equal(r.ok, true); assert.equal(r.item.approved, true); assert.equal(r.item.v, 2); assert.equal(r.item.history.length, 1);
  r = await (await own.post("/api/bc/templates", { c: "winchester", title: "Своё", ru: "Без отказа" })).json();
  assert.match(r.error, /стоп/);
  r = await (await own.post("/api/bc/templates", { c: "winchester", title: "Своё", ru: "{имя}, ждём вас! Ответьте «стоп», чтобы не получать." })).json();
  assert.equal(r.ok, true); assert.ok(r.item.custom);
  const list = (await (await staff.go("/api/bc/templates?c=winchester")).json()).items;
  assert.ok(list.find(x => x.id === "M24").approved && list.some(x => x.custom), "сотрудник видит одобренное и своё");
  const pv = await (await staff.post("/api/bc/templates/preview", { c: "winchester", id: "M01", lang: "kk" })).json();
  assert.equal(pv.ok, true); assert.ok(pv.list.length >= 1); assert.match(pv.list[0].text, /стоп/);
});
