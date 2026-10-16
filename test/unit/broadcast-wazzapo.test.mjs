// Рассылки (план проверки модулей, модуль 7, 16.10.2026): код ошибки Meta, который Wazzapo может отдать только в тексте ошибки.
// От кода зависит, что делать: 131050 — человек запретил рекламу в WhatsApp (больше ему не писать), 131031/131048 — ограничение номера
// (рассылки на паузу). Формат ошибок Wazzapo в документации не описан — проверяем правдоподобные виды. Всё на заглушках.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { net, mk } from "../harness.mjs";
import { sendTemplate } from "../../src/services/channels/templates.js";

const ENV = { WA_VIA_BARBER: "wazzapo", WA_TOKEN_BARBER: "wz_live_test", APP_SECRET_BARBER: "hook-secret", PHONE_NUMBER_ID_BARBER: "103799815708451" };
const J = (o, status) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const route = { client: "barber", pnid: "103799815708451", quiet: true };

for (const [title, body] of [
  ["код Meta в тексте ошибки", { error: { code: 502, message: "(#131050) Unable to deliver message: user has stopped marketing messages" } }],
  ["код Meta в отдельном поле", { error: { code: "META_ERROR", meta_code: 131050, message: "Meta rejected" } }],
  ["ошибка строкой", { error: "Meta API error 131050: user opted out of marketing messages" }]
]) {
  test("шаблон через Wazzapo не принят: " + title + " — бот видит код Meta 131050", async () => {
    net.reset();
    net.wzReply = rec => rec.path === "/messages/send" ? J(body, 502) : null;
    const s = mk(ENV);
    const r = await sendTemplate(s.env, "77051115501", { tpl: "promo_october", lang: "ru", params: [] }, "", route);
    assert.equal(r.ok, false);
    assert.equal(r.code, 131050, JSON.stringify(r));
  });
}

test("статус «не доставлено» от Wazzapo с кодом Meta в тексте — клиент попадает в «не писать»", async () => {
  net.reset();
  const s = mk(ENV);
  const body = JSON.stringify({ event: "message.status", data: { channel: "whatsapp", phone_number_id: "103799815708451", message_id: "wzm-1", status: "failed", to: "77051115502", error: { message: "(#131050) User has stopped marketing messages" } } });
  const r = await s.call("/wz/barber", { method: "POST", body, headers: { "content-type": "application/json", "x-wazzapo-delivery-id": "dlv-bc-1", "x-wazzapo-signature": "sha256=" + createHmac("sha256", "hook-secret").update(body).digest("hex") } });
  assert.equal(r.status, 200);
  assert.ok(s.kv.mem.has("optout:barber:77051115502"), [...s.kv.mem.keys()].filter(k => k.startsWith("optout")).join(","));
});
