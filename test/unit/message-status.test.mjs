// Статус исходящего сообщения (ТЗ v2.0 §2.3): только растёт, поздний «sent» не опускает «read», ошибка — только до доставки.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stNext, stOf, stErr } from "../../src/services/inbox/status.js";
import { opName, opWho } from "../../src/services/inbox/operator.js";

test("статусы Green-API → наши; порядок не важен", () => {
  assert.equal(stOf("pending"), "queued"); assert.equal(stOf("noAccount"), "failed"); assert.equal(stOf("yellowCard"), "failed"); assert.equal(stOf("что-то"), "");
  let s; for (const e of ["sent", "delivered", "read"]) s = stNext(s, e) || s;
  assert.equal(s, "read");
  assert.equal(stNext("read", "sent"), null, "поздний sent не понижает read");
  assert.equal(stNext("read", "delivered"), null);
  assert.equal(stNext("delivered", "read"), "read");
  assert.equal(stNext("sent", "read"), "read", "delivered бывает пропущен");
  assert.equal(stNext("read", "read"), null, "повтор вебхука — без смены");
  assert.equal(stNext("sent", "failed"), "failed");
  assert.equal(stNext("unknown", "sent"), "sent", "обрыв, а провайдер потом сообщил");
  assert.equal(stNext("delivered", "failed"), null, "доставленное не становится недоставленным");
  assert.equal(stNext("failed", "read"), "read");
  assert.equal(stNext("failed", "sent"), null);
  assert.equal(stErr("failed", "Error: Timed Out to +7 777 123 45 67"), "Error: Timed Out to …");
});

test("имя сотрудника с устройства: чистится, без него — роль", () => {
  assert.equal(opName("  Айгерим <b>\n "), "Айгерим b");
  assert.equal(opName("x".repeat(50)).length, 32);
  assert.equal(opWho({ role: "owner" }, ""), "владелец");
  assert.equal(opWho({ role: "staff" }, " Айгерим "), "Айгерим");
});
