// Ограничение подбора ключа (8 неверных за 10 минут с адреса, loginBlocked в src/services/auth/session.js). Находка проверки
// безопасности 19.10.2026: при неверной попытке счётчик в KV перезаписывался числом из памяти своего экземпляра Worker — запросы на
// разные экземпляры сбрасывали общий счётчик. Теперь при ошибке берётся большее из памяти и KV.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mk } from "../harness.mjs";
import { loginBlocked } from "../../src/services/auth/session.js";

const req = ip => new Request("https://x.test/login", { method: "POST", headers: { "cf-connecting-ip": ip } });

test("неверные ключи с других экземпляров Worker (счётчик в KV) учитываются при новой ошибке", async () => {
  const s = mk({}), ip = "203.0.113.77";
  assert.equal(await loginBlocked(s.env, req(ip), true), false); // одна ошибка на этом экземпляре
  const k = [...s.kv.mem.keys()].find(x => x.startsWith("lg:"));
  assert.ok(k, "счётчик в KV");
  s.kv.mem.set(k, "7"); // на других экземплярах уже было 7 неверных попыток
  assert.equal(await loginBlocked(s.env, req(ip), true), true, "восьмая неверная — блок");
  assert.equal(+s.kv.mem.get(k), 8, "в KV не меньше, чем было");
  assert.equal(await loginBlocked(s.env, req(ip), false), true);
});
