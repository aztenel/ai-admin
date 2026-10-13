// Кто отменяет записи в Altegio: у пробного клиента alt бот отменяет сам (включено 14.10.2026), у остальных, включая настоящих клиентов, — администратор.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENTS } from "../../src/config/builtin-clients.js";
import { altSelfCancel } from "../../src/services/booking/book.js";

test("пробный клиент alt: бот отменяет сам", () => {
  assert.equal(altSelfCancel({}, /** @type {any} */ (CLIENTS.alt)), true);
});

test("настоящий клиент winchester: отмену делает администратор", () => {
  assert.equal(altSelfCancel({}, /** @type {any} */ (CLIENTS.winchester)), false);
});

test("переменная для одного клиента сильнее настройки в коде", () => {
  assert.equal(altSelfCancel({ ALTEGIO_SELF_CANCEL_ALT: "0" }, /** @type {any} */ (CLIENTS.alt)), false);
  assert.equal(altSelfCancel({ ALTEGIO_SELF_CANCEL_WINCHESTER: "1" }, /** @type {any} */ (CLIENTS.winchester)), true);
});

test("все остальные встроенные клиенты: по умолчанию администратор", () => {
  for (const [id, c] of Object.entries(CLIENTS)) if (id !== "alt") assert.equal(altSelfCancel({}, /** @type {any} */ (c)), false, id);
});
