// «Браузер» для проверок Web Push: ключи подписки и расшифровка сообщения (RFC 8291) средствами node:crypto — отдельно от
// WebCrypto-кода сервера, чтобы ошибка в одном не пряталась за такой же ошибкой в другом.
import { createECDH, createHmac, createDecipheriv, randomBytes } from "node:crypto";

export function uaKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const authBuf = randomBytes(16);
  return { ecdh, authBuf, p256dh: ecdh.getPublicKey().toString("base64url"), auth: authBuf.toString("base64url") };
}
/** Тело запроса службы push → текст сообщения. */
export function decrypt(ua, body) {
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  if (body.readUInt32BE(16) !== 4096) throw new Error("rs");
  const H = (k, d) => createHmac("sha256", k).update(d).digest();
  const prkKey = H(ua.authBuf, ua.ecdh.computeSecret(asPub));
  const ikm = H(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), ua.ecdh.getPublicKey(), asPub, Buffer.from([1])]));
  const prk = H(salt, ikm);
  const cek = H(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = H(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  if (plain[end] !== 2) throw new Error("нет разделителя записи");
  return plain.subarray(0, end).toString("utf8");
}
