// Сайт и вход (план проверки модулей, модуль 6, 16.10.2026): ключ сотрудника для встроенного бота (Winchester — пока в коде, не в паспорте).
// Раньше «Выдать ключ» работал только для ботов из паспорта: управляющему Winchester ключ можно было дать лишь через секрет KEY_WINCHESTER в Cloudflare.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";

const login = async (s, key) => { const b = s.browser(); const r = await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=" + encodeURIComponent(key) + "&next=%2Finbox" }); return { b, r }; };

test("владелец выдаёт ключ сотрудника встроенному боту Winchester; сотрудник видит только пульт Winchester", async () => {
  net.reset();
  const s = mk();
  const { b: own } = await login(s, "owner-key-123456");
  const r = await own.post("/api/studio/key", { id: "winchester" });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.ok(/^[a-z0-9-]{15,}$/.test(d.key || ""), JSON.stringify(d));
  assert.ok(!JSON.stringify([...s.kv.mem.values()]).includes(d.key), "в хранилище только отпечаток ключа");
  const { b: st, r: lr } = await login(s, d.key);
  assert.equal(lr.status, 303, "ключ подошёл");
  assert.equal((await st.go("/api/inbox/list?c=winchester")).status, 200, "пульт Winchester открыт");
  assert.equal((await st.go("/api/inbox/list?c=barber")).status, 403, "чужой бизнес закрыт");
  assert.notEqual((await st.go("/studio")).status, 200, "страница владельца закрыта");
  const list = await (await own.go("/api/studio/list")).json();
  assert.equal(list.clients.find(c => c.id === "winchester").key, true, "в списке видно, что ключ выдан");
  // новый ключ — прежний перестаёт действовать, и вход по нему тоже
  const d2 = await (await own.post("/api/studio/key", { id: "winchester" })).json();
  assert.notEqual(d2.key, d.key);
  assert.equal((await st.go("/api/inbox/list?c=winchester")).status === 200, false, "прежняя сессия закрыта");
  assert.notEqual((await login(s, d.key)).r.status, 303, "прежний ключ не подходит");
});

test("ключ демо-бота не выдаётся тому, кого нет", async () => {
  net.reset();
  const s = mk();
  const { b: own } = await login(s, "owner-key-123456");
  assert.equal((await own.post("/api/studio/key", { id: "nosuchbot" })).status, 400);
});
