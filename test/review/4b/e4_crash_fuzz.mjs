// E. odd HTTP inputs: does anything throw (unhandled exception = HTTP 500 in production)? Run on dev and main.
// Usage: node e4_crash_fuzz.mjs [worker]
const path = process.argv[2] || new URL("../../../worker.js", import.meta.url).pathname;
console.log = () => {}; const out = (...a) => process.stdout.write(a.join(" ") + "\n");
const worker = (await import(path)).default;
const mem = new Map();
const KV = { get: async k => mem.get(k) ?? null, put: async (k, v) => { mem.set(k, v); }, delete: async k => { mem.delete(k); } };
const env = { KV, GEMINI_KEY: "k", VERIFY_TOKEN: "vt", LEADS_KEY: "lk", TG_TOKEN: "tg", TG_CHAT: "1", ALTEGIO_SELF_CANCEL: "1", ALTEGIO_PARTNER: "partner-key", ALTEGIO_LOC_ALT: "777" };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
let altMode = "ok";
globalThis.fetch = async (u, init = {}) => {
  const url = String(u);
  if (url.includes("generativelanguage")) return J({ candidates: [{ content: { parts: [{ text: "Здравствуйте! Чем помочь?" }] }, finishReason: "STOP" }] });
  if (url.includes("telegram")) return new Response("{}");
  if (url.includes("alteg.io")) {
    if (altMode === "weird") {
      if (/book_services/.test(url)) return J({ success: true, data: { services: [null, 5, "x", { id: 1 }, { id: 2, title: { a: 1 } }, { id: 3, title: ["a"], price_min: {}, seance_length: "x" }], category: [null, { id: 1 }, 7] } });
      if (/book_staff/.test(url)) return J({ success: true, data: [null, 1, "s", { id: 1, name: 5 }, { id: 2, name: { x: 1 }, position: null, specialization: [] }, { id: 3, name: "Арман", position: "str" }] });
      if (/book_dates/.test(url)) return J({ success: true, data: { booking_dates: [null, {}, [], 1e20, "2026-10-04", -5, "x"] } });
      if (/book_times/.test(url)) return J({ success: true, data: [null, 1, "x", {}, { time: {} }, { time: ["10:00"] }, { time: "10:00", datetime: {} }] });
      return J({ success: true, data: "x" });
    }
    if (/book_services/.test(url)) return J({ success: true, data: { services: [{ id: 1, title: "Стрижка", price_min: 5000, seance_length: 3600 }], category: [] } });
    if (/book_staff/.test(url)) return J({ success: true, data: [{ id: 1, name: "Арман" }] });
    if (/book_dates/.test(url)) return J({ success: true, data: { booking_dates: ["2026-10-04"] } });
    if (/book_times/.test(url)) return J({ success: true, data: [{ time: "10:00", datetime: "2026-10-04T10:00:00+05:00" }] });
    return J({ success: true, data: null });
  }
  throw new Error("unexpected " + url);
};
const ctx = { waitUntil: p => p.catch(() => {}) };
const tries = [];
const T = (name, path, init) => tries.push([name, path, init]);
const post = (body, ct = "application/json") => ({ method: "POST", headers: { "content-type": ct, "cf-connecting-ip": "10.8.0.1" }, body });
for (const b of ["null", "[]", "5", '"x"', "{}", '{"c":null,"sid":"a","text":"x"}', '{"c":{"a":1},"sid":["x"],"text":{"t":1}}', '{"c":"alt","sid":"s1","text":["a","b"]}', '{"c":"alt","sid":"s2","text":"\\u0000\\u0001"}', '{"c":"alt","sid":"s3","text":"' + "9".repeat(700) + '"}', "{", "", '{"c":"alt","sid":"s4","text":"хочу к ' + "Арману ".repeat(80) + '"}'])
  T("POST /api/chat " + b.slice(0, 50), "/api/chat", post(b));
for (const b of ["null", "[]", "5", "{}", '{"key":"lk"}', '{"key":"lk","i":"x"}', '{"key":"lk","i":-1}', '{"key":"lk","i":1e9}', '{"key":["lk"],"i":0}']) T("POST /api/selftest " + b, "/api/selftest", post(b));
for (const q of ["?key=lk&i=-1", "?key=lk&i=1.5", "?key=lk&i=", "?key=lk&i=NaN"]) T("GET /api/selftest" + q, "/api/selftest" + q);
for (const q of ["?key=lk", "?key=lk&c=alt&loc=777", "?key=lk&c[]=alt", "?key=lk&loc[]=1", "?key=lk&c=%00", "?key=lk&loc=%F0%9F%98%80", "?key[]=lk"]) T("GET /altegio" + q, "/altegio" + q);
T("POST /altegio urlencoded ok", "/altegio", post("key=lk&c=alt&loc=&phone=%2B77011234567", "application/x-www-form-urlencoded"));
T("POST /altegio multipart garbage", "/altegio", post("garbage", "multipart/form-data; boundary=x"));
T("POST /altegio no content-type", "/altegio", { method: "POST", body: "key=lk" });
T("POST /altegio empty", "/altegio", { method: "POST" });
T("POST /altegio text/plain", "/altegio", post("key=lk", "text/plain"));
for (const q of ["?c=alt&sid=", "?c=alt", "?sid=%00", "?c[]=alt&sid=x", "?c=alt&sid=" + "a".repeat(500)]) T("GET /api/history" + q, "/api/history" + q);
for (const p of ["/leads?key=lk&c[]=x", "/leads?key=lk", "/diag?key=lk", "/selftest?key=lk", "/privacy", "/", "/?c=alt", "/chat?c=alt", "/?c[]=alt"]) T("GET " + p, p);
T("HEAD /altegio?key=lk", "/altegio?key=lk", { method: "HEAD" });
T("POST / (WA) garbage json", "/", post('{"entry":[{"changes":[{"value":{"messages":[{"id":"x1","from":null,"type":"text","text":{"body":"hi"}}]}}]}]}'));
T("POST / (WA) entry null", "/", post('{"entry":null}'));
const run = async (label) => {
  out("=== " + label);
  let bad = 0;
  for (const [name, p, init] of tries) {
    try { const r = await worker.fetch(new Request("https://x.test" + p, init), env, ctx); await r.text(); if (r.status >= 500) { bad++; out(`  HTTP ${r.status}  ${name}`); } }
    catch (e) { bad++; out(`  THROWS ${String(e).slice(0, 110)}  ← ${name}`); }
  }
  out(`  ${tries.length} requests, failures: ${bad}`);
};
await run("normal Altegio data");
altMode = "weird"; mem.clear();
await run("garbage shapes from Altegio");
mem.set("leads:dent", "not json"); mem.set("h:web:alt:s1", "{broken");
await run("corrupted KV values (leads:dent, one history)");
process.exit(0);
