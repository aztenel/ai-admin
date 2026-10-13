// Свободное время с учётом услуги (14.10.2026): без услуги Altegio считает короткий слот и показывает свободным время,
// на которое час стрижки не помещается. Если клиент уже назвал услугу, время спрашиваем с ней; не уверены — как раньше.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, ALT_DEFAULT } from "../harness.mjs";
import { CLIENTS } from "../../src/config/builtin-clients.js";
import { altSnapshot } from "../../src/services/booking/book.js";
import { altServicesIn } from "../../src/services/booking/pick.js";

const SV = ALT_DEFAULT().services.map(x => ({ id: x.id, title: x.title }));
const ids = text => altServicesIn(SV, text).map(x => x.id);

test("услуга названа в любом падеже — находится одна", () => {
  assert.deepEqual(ids("Запишите меня на мужскую стрижку завтра в 15:00"), [101]);
  assert.deepEqual(ids("хочу детскую стрижку"), [103]);
  assert.deepEqual(ids("МУЖСКАЯ СТРИЖКА"), [101]);
});

test("не уверены — пусто: общее слово, две услуги, ничего похожего", () => {
  assert.deepEqual(ids("хочу стрижку"), []);
  assert.deepEqual(ids("мужскую стрижку и оформление бороды"), []);
  assert.deepEqual(ids("Какие у вас цены?"), []);
  assert.deepEqual(ids(""), []);
});

test("altSnapshot: услуга названа — book_times идёт с ней, не названа — как раньше", async () => {
  const env = { ALTEGIO_PARTNER: "partner-key", ALTEGIO_LOC_ALT: "9101" };
  net.reset();
  await altSnapshot(env, /** @type {any} */ (CLIENTS.alt), Date.now(), "Запишите на мужскую стрижку завтра");
  const withSv = net.alt.filter(/** @param {string} p */ p => p.includes("/book_times/"));
  assert.ok(withSv.length && withSv.every(/** @param {string} p */ p => p.includes("service_ids%5B%5D=101")), withSv.join("\n"));

  net.reset();
  env.ALTEGIO_LOC_ALT = "9102";
  await altSnapshot(env, /** @type {any} */ (CLIENTS.alt), Date.now(), "Какое время есть завтра?");
  const without = net.alt.filter(/** @param {string} p */ p => p.includes("/book_times/"));
  assert.ok(without.length && without.every(/** @param {string} p */ p => !p.includes("service_ids")), without.join("\n"));
});
