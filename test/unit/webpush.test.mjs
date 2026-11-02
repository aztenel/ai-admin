// Web Push без библиотек (ТЗ v2.0 §3, 31.10.2026): шифрование сообщения (RFC 8291) сверено с примером из приложения A RFC байт в
// байт, подпись VAPID (RFC 8292) проверяется открытым ключом средствами node:crypto, адрес подписки — только службы push (SSRF).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { encrypt, vapidAuth, vapidGenerate, vapidOk, unb64u, b64u } from "../../src/services/integrations/webpush/crypto.js";
import { pushHostOk, webpushSend } from "../../src/services/integrations/webpush/client.js";
import { net } from "../harness.mjs";
import { uaKeys, decrypt } from "./webpush-ua.mjs";

const sp = s => s.replace(/\s+/g, "");

test("RFC 8291, приложение A: тот же результат шифрования байт в байт", async () => {
  const body = await encrypt(unb64u("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
    sp("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV- JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"), "BTBZMqHH6r4Tts7J_aSIgg", {
      salt: unb64u("DGv6ra1nlYgDCS1FRnbzlw"),
      asPublic: unb64u(sp("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8")),
      asPrivate: unb64u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
    });
  const header = unb64u(sp("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8"));
  const cipher = unb64u(sp("8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ"));
  assert.equal(header.length, 86, "заголовок RFC — 86 байт");
  assert.deepEqual(Buffer.from(body), Buffer.concat([header, cipher]));
});

test("случайные ключи: браузер расшифровывает своим закрытым ключом (проверка средствами node:crypto)", async () => {
  const ua = uaKeys();
  const msg = JSON.stringify({ t: "Winchester", b: "Новое сообщение · второй номер" });
  const body = await encrypt(msg, ua.p256dh, ua.auth);
  assert.equal(decrypt(ua, Buffer.from(body)), msg);
  await assert.rejects(encrypt(msg, "AAAA", ua.auth), /bad subscription keys/);
  await assert.rejects(encrypt(msg, ua.p256dh, "AAAA"), /bad subscription keys/);
});

test("VAPID: ES256 JWT на 12 часов, aud — служба push, подпись верна открытым ключом; ключи проверяются", async () => {
  const kp = await vapidGenerate();
  assert.equal(unb64u(kp.publicKey).length, 65); assert.equal(unb64u(kp.privateKey).length, 32);
  assert.equal(await vapidOk(kp), true);
  const other = await vapidGenerate();
  assert.equal(await vapidOk({ publicKey: kp.publicKey, privateKey: other.privateKey }), false, "закрытый ключ не от этого открытого");
  assert.equal(await vapidOk({ publicKey: "xx", privateKey: "yy" }), false);
  const now = Date.UTC(2026, 9, 31, 7);
  const h = await vapidAuth("https://fcm.googleapis.com/fcm/send/abc:def", kp, "mailto:owner@example.test", now);
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h);
  assert.ok(m, h); assert.equal(m[4], kp.publicKey);
  assert.deepEqual(JSON.parse(Buffer.from(m[1], "base64url").toString()), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(Buffer.from(m[2], "base64url").toString());
  assert.deepEqual(claims, { aud: "https://fcm.googleapis.com", exp: now / 1000 + 12 * 3600, sub: "mailto:owner@example.test" });
  const pub = Buffer.from(kp.publicKey, "base64url");
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(m[1] + "." + m[2]), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(m[3], "base64url")), "подпись верна");
  assert.equal(b64u(new Uint8Array([251, 255])), "-_8");
});

test("адрес подписки: только https и только службы push Apple, Google, Mozilla, Microsoft — иначе запрос не уходит", async () => {
  for (const ok of ["https://web.push.apple.com/QAbc", "https://api.push.apple.com/x", "https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=x"])
    assert.equal(pushHostOk(ok), true, ok);
  for (const bad of ["http://fcm.googleapis.com/fcm/send/abc", "https://fcm.googleapis.com:8443/x", "https://evil.example/fcm.googleapis.com/", "https://fcm.googleapis.com.evil.example/x",
    "https://user:pw@fcm.googleapis.com/x", "https://169.254.169.254/latest", "https://bot.test/api/inbox/list", "notaurl", "https://push.apple.com.evil.test/x", 42, "https://fcm.googleapis.com/" + "a".repeat(1100)])
    assert.equal(pushHostOk(bad), false, String(bad).slice(0, 60));
  net.reset();
  const ua = uaKeys(), kp = { ...(await vapidGenerate()), subject: "https://bot.test" };
  const r = await webpushSend({ endpoint: "https://evil.example/x", keys: { p256dh: ua.p256dh, auth: ua.auth } }, { t: "x" }, kp);
  assert.deepEqual(r, { ok: false, status: 0, gone: true }); assert.equal(net.push.length, 0);
  const ok = await webpushSend({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: ua.p256dh, auth: ua.auth } }, { t: "Привет" }, kp, { ttl: 60, urgency: "high", topic: "c1abc" });
  assert.deepEqual(ok, { ok: true, status: 201, gone: false });
  const rec = net.push[0];
  assert.equal(rec.headers["content-encoding"], "aes128gcm"); assert.equal(rec.headers.ttl, "60"); assert.equal(rec.headers.urgency, "high"); assert.equal(rec.headers.topic, "c1abc");
  assert.deepEqual(JSON.parse(decrypt(ua, Buffer.from(rec.body))), { t: "Привет" });
  net.pushReply = () => new Response(null, { status: 410 });
  assert.equal((await webpushSend({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: ua.p256dh, auth: ua.auth } }, { t: "x" }, kp)).gone, true, "410 — подписки больше нет");
  net.reset();
});
