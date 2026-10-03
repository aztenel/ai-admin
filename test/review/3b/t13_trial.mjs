// /altegio trial booking (POST): what the owner sees in the unhappy paths. A REAL record is created by this button.
import { mk, show, D1, D2, J } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4130" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
const pre = t => t.slice(t.indexOf("<pre>") + 5, t.indexOf("</pre>")).replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
const tail = t => pre(t).split("\n").slice(-6).join("\n");
async function trial(label, hook, formExtra = {}) {
  h.ALT.hook = hook; h.ALT.records.length = 0; h.ALT.deleted.length = 0; h.ALT.calls.length = 0;
  const r = await h.call("/altegio", h.form({ key: "lk", phone: "+7 701 123 45 67", ...formExtra }));
  const t = await r.text();
  _log(`\n=== ${label}\nHTTP ${r.status}; records created in Altegio stub: ${h.ALT.records.length}; deleted: ${JSON.stringify(h.ALT.deleted)}\n` + tail(t));
  return t;
}
await trial("happy path", null);
await trial("creation OK, DELETE fails with 500", (p, m) => m === "DELETE" ? J({ success: false, meta: { message: "Server error" } }, 500) : null);
await trial("creation OK, DELETE fails with 404", (p, m) => m === "DELETE" ? J({ success: false, meta: {} }, 404) : null);
await trial("creation OK, DELETE times out (network error)", (p, m) => { if (m === "DELETE") throw new Error("aborted"); return null; });
await trial("creation OK but the answer has no record_hash", (p, m, init) => { if (p.startsWith("/book_record/")) { h.ALT.records.push(JSON.parse(init.body)); return J({ success: true, data: [{ id: 1, record_id: 777001 }], meta: [] }, 201); } if (m === "DELETE") return J({ success: false, meta: { message: "Not found" } }, 404); return null; });
await trial("record created in Altegio, but the answer has another shape (no record_id)", (p, m, init) => { if (p.startsWith("/book_record/")) { h.ALT.records.push(JSON.parse(init.body)); return J({ success: true, data: { id: 777002, hash: "abc" }, meta: [] }, 201); } return null; });
await trial("record created in Altegio, but the answer is lost (timeout after the server processed it)", (p, m, init) => { if (p.startsWith("/book_record/")) { h.ALT.records.push(JSON.parse(init.body)); throw new Error("aborted"); } return null; });
await trial("book_record → 422 code 433", (p, m) => p.startsWith("/book_record/") ? J({ success: false, meta: { message: "Ошибка", errors: [{ code: 433, message: "Selected time slot is already taken" }] } }, 422) : null);
await trial("book_times has no datetime field (fallback exists in chat, not here)", async (p, m) => { const mm = p.match(/^\/book_times\/\d+\/(\d+)\/(\d{4}-\d{2}-\d{2})/); return mm ? J({ success: true, data: [{ time: "10:00", seance_length: 3600 }], meta: [] }) : null; });

_log("\n=== auth matrix");
const st = async (label, path, init) => _log(`${label} → ${(await h.call(path, init)).status}`);
h.ALT.hook = null; h.ALT.records.length = 0;
await st("GET  /altegio (no key)", "/altegio");
await st("GET  /altegio?key=bad", "/altegio?key=bad");
await st("HEAD /altegio?key=bad", "/altegio?key=bad", { method: "HEAD" });
await st("POST /altegio form key=bad", "/altegio", h.form({ key: "bad", phone: "+77011234567" }));
await st("POST /altegio?key=lk (key only in URL, form without key)", "/altegio?key=lk", h.form({ phone: "+77011234567" }));
await st("POST /altegio?key=lk (JSON body)", "/altegio?key=lk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "lk", phone: "+77011234567" }) });
await st("POST /altegio (no body)", "/altegio?key=lk", { method: "POST" });
await st("GET  /altegio?key=lk&phone=+77011234567 (must not create)", "/altegio?key=lk&phone=%2B77011234567");
await st("PUT  /altegio?key=lk", "/altegio?key=lk", { method: "PUT" });
await st("GET  /api/selftest (no key)", "/api/selftest?i=0");
await st("GET  /api/selftest?key=bad", "/api/selftest?key=bad&i=0");
await st("GET  /diag (no key)", "/diag");
_log("records created by the auth matrix: " + h.ALT.records.length);
// empty LEADS_KEY and VERIFY_TOKEN → nobody can open
const saveK = [h.env.LEADS_KEY, h.env.VERIFY_TOKEN]; h.env.LEADS_KEY = ""; h.env.VERIFY_TOKEN = "";
await st("no LEADS_KEY/VERIFY_TOKEN: GET /altegio?key=", "/altegio?key=");
await st("no LEADS_KEY/VERIFY_TOKEN: GET /altegio", "/altegio");
await st("no LEADS_KEY/VERIFY_TOKEN: POST /altegio key=''", "/altegio", h.form({ key: "", phone: "+77011234567" }));
await st("no LEADS_KEY/VERIFY_TOKEN: GET /api/selftest?key=&i=0", "/api/selftest?key=&i=0");
[h.env.LEADS_KEY, h.env.VERIFY_TOKEN] = saveK;
