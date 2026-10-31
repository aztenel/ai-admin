// /api/inbox/me (ТЗ Winchester v3.0, 31.10.2026): оформление компании (brand), тестовая версия или боевой сайт (stage), режим записи
// с сайта (site: off / dry / live) — для шапки пульта и раздела «Номера и каналы». Сотрудник — только о своей компании; секретов нет.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";

const login = async (s, key) => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${key}&next=%2Fapp%2F` }); return b; };
const ENV = { KEY_WINCHESTER: "staff-key-winch-0001", KEY_BARBER: "staff-key-barber-0001" };
const me = async b => { const r = await b.go("/api/inbox/me"); assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store"); return r.json(); };

test("владелец: brand null, оформление по компаниям, боевой сайт, запись с сайта выключена без ключа Altegio", async () => {
  net.reset();
  const s = mk(ENV), d = await me(await login(s, "owner-key-123456"));
  assert.deepEqual(d, { owner: true, c: "", brand: null, brands: { winchester: "winchester" }, stage: "production", site: { winchester: "off" } });
});

test("сотрудник Winchester: своё оформление и режим записи с сайта (проверка без записи, настоящая — переменной); тестовая версия", async () => {
  net.reset();
  for (const [extra, mode] of [[{ ALTEGIO_PARTNER: "partner-test" }, "dry"], [{ ALTEGIO_PARTNER: "partner-test", SITE_BOOKING_WINCHESTER: "1" }, "live"], [{ ALTEGIO_PARTNER: "partner-test", SITE_BOOKING_WINCHESTER: "0" }, "off"]]) {
    const s = mk({ ...ENV, ...extra, STAGE: "preview" }), d = await me(await login(s, "staff-key-winch-0001"));
    assert.deepEqual(d, { owner: false, c: "winchester", brand: "winchester", brands: { winchester: "winchester" }, stage: "preview", site: { winchester: mode } });
    assert.ok(!JSON.stringify(d).includes("partner-test"), "без ключей");
  }
});

test("сотрудник другой компании: нейтральное оформление, о Winchester ничего", async () => {
  net.reset();
  const s = mk({ ...ENV, ALTEGIO_PARTNER: "partner-test" }), d = await me(await login(s, "staff-key-barber-0001"));
  assert.deepEqual(d, { owner: false, c: "barber", brand: null, brands: {}, stage: "production", site: {} });
});
