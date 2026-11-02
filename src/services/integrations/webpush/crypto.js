// @ts-check
// Web Push: шифрование сообщения для браузера (RFC 8291, кодировка aes128gcm) и подпись сервера VAPID (RFC 8292, ES256) —
// только WebCrypto, без библиотек (в Worker нет Node). Шифрование сверено с примером RFC 8291, приложение A
// (test/unit/webpush.test.mjs): тот же результат байт в байт.
/** @typedef {{ publicKey: string, privateKey: string }} VapidPair ключи VAPID: открытый — 65 байт (04‖x‖y), закрытый — 32 байта d, base64url */

const te = new TextEncoder();
/** @param {ArrayBuffer | Uint8Array} b */
export function b64u(b) {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** base64url → байты; не base64url — исключение. @param {string} s @returns {Uint8Array<ArrayBuffer>} */
export function unb64u(s) {
  const t = String(s).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9_-]*$/.test(t)) throw new Error("not base64url");
  const bin = atob(t.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((t.length + 3) % 4));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
/** @param {...Uint8Array} a @returns {Uint8Array<ArrayBuffer>} */
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
/** @param {Uint8Array<ArrayBuffer>} key @param {Uint8Array<ArrayBuffer>} data */
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
/** открытый ключ P-256 (65 байт) и закрытый d → JWK. @param {Uint8Array} pub @param {Uint8Array} [d] */
const jwkOf = (pub, d) => ({ kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ...(d ? { d: b64u(d) } : {}), ext: true });
/** Открытый ключ подписки браузера: 65 байт, начинается с 0x04. @param {Uint8Array} u */
export const p256Ok = u => u.length === 65 && u[0] === 4;

/**
 * Зашифровать сообщение для подписки (одна запись, rs = 4096: сообщение до ~3 КБ).
 * opt.salt, opt.asPublic + opt.asPrivate — только для проверки по примеру RFC (иначе — случайные).
 * @param {string | Uint8Array<ArrayBuffer>} payload @param {string} p256dh ключ подписки, base64url @param {string} auth секрет подписки, base64url
 * @param {{ salt?: Uint8Array<ArrayBuffer>, asPublic?: Uint8Array<ArrayBuffer>, asPrivate?: Uint8Array<ArrayBuffer> }} [opt]
 * @returns {Promise<Uint8Array<ArrayBuffer>>} тело запроса: salt ‖ rs ‖ idlen ‖ keyid ‖ шифротекст
 */
export async function encrypt(payload, p256dh, auth, opt = {}) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  if (!p256Ok(ua) || secret.length !== 16) throw new Error("bad subscription keys");
  const salt = opt.salt || crypto.getRandomValues(new Uint8Array(16));
  let asPriv, asPub;
  if (opt.asPublic && opt.asPrivate) {
    asPub = opt.asPublic;
    asPriv = await crypto.subtle.importKey("jwk", jwkOf(asPub, opt.asPrivate), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const kp = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]));
    asPriv = kp.privateKey;
    asPub = new Uint8Array(/** @type {ArrayBuffer} */ (await crypto.subtle.exportKey("raw", kp.publicKey)));
  }
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPriv, 256));
  // RFC 8291 §3.4: ключ из секрета подписки и общего секрета ECDH, затем ключ и nonce содержимого (RFC 8188)
  const prkKey = await hmac(secret, ecdh);
  const ikm = await hmac(prkKey, cat(te.encode("WebPush: info\0"), ua, asPub, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(te.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(te.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plain = cat(typeof payload === "string" ? te.encode(payload) : payload, new Uint8Array([2])); // 0x02 — последняя запись
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));
  const head = new Uint8Array(21);
  head.set(salt, 0); new DataView(head.buffer).setUint32(16, 4096); head[20] = asPub.length;
  return cat(head, asPub, ct);
}

/**
 * Заголовок Authorization по VAPID (RFC 8292): JWT ES256 на 12 часов, aud — адрес службы push (схема и хост).
 * @param {string} endpoint @param {VapidPair} keys @param {string} subject mailto: или https: (Apple без него отказывает) @param {number} now
 */
export async function vapidAuth(endpoint, keys, subject, now) {
  const enc = (/** @type {any} */ o) => b64u(te.encode(JSON.stringify(o)));
  const head = enc({ typ: "JWT", alg: "ES256" }), claims = enc({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject });
  const k = await crypto.subtle.importKey("jwk", jwkOf(unb64u(keys.publicKey), unb64u(keys.privateKey)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, te.encode(head + "." + claims)); // WebCrypto даёт r‖s — как и нужно в JWT
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

/** Новая пара ключей VAPID. @returns {Promise<VapidPair>} */
export async function vapidGenerate() {
  const kp = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]));
  const jwk = /** @type {JsonWebKey} */ (await crypto.subtle.exportKey("jwk", kp.privateKey));
  const pub = /** @type {ArrayBuffer} */ (await crypto.subtle.exportKey("raw", kp.publicKey));
  return { publicKey: b64u(pub), privateKey: String(jwk.d) };
}
/** Пара ключей пригодна: открытый — 65 байт P-256, закрытый — 32 байта и подходит к открытому. @param {any} v @returns {Promise<boolean>} */
export async function vapidOk(v) {
  try {
    if (!v || typeof v.publicKey !== "string" || typeof v.privateKey !== "string") return false;
    const pub = unb64u(v.publicKey), d = unb64u(v.privateKey);
    if (!p256Ok(pub) || d.length !== 32) return false;
    const k = await crypto.subtle.importKey("jwk", jwkOf(pub, d), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const v2 = await crypto.subtle.importKey("raw", pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const m = te.encode("vapid-check"), sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, m);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, v2, sig, m);
  } catch (e) { return false; }
}
