// money переехал из worker.js в src/lib/money.js без изменений: сравниваем с прежней строкой кода на разных входах.
import { test } from "node:test";
import assert from "node:assert/strict";
import { money } from "../../src/lib/money.js";

const before = n => String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " "); // как было в worker.js

test("money: тот же результат, что у прежнего кода", () => {
  for (const n of [0, 5, 999, 1000, 6000, 12500.4, 12500.5, 1234567, -1500, "7000", "  12 ", "abc", "", null, undefined, NaN, Infinity, 1e21])
    assert.equal(money(/** @type {any} */ (n)), before(n), String(n));
  assert.equal(money(1234567), "1 234 567");
});
