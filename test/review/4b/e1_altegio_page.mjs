// E. /altegio GET/POST: auth, escaping, loc validation, trial booking flow and all its failure branches.
import { mk, D1, J } from "./lib.mjs";
const h = await mk(); const log = h.quiet();
const pre = t => (t.match(/<pre>([\s\S]*?)<\/pre>/) || [, "(no <pre>)"])[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const get = async q => { const r = await h.call("/altegio" + q); return { s: r.status, t: await r.text() }; };
const post = async o => { const r = await h.call("/altegio", h.form(o)); return { s: r.status, t: await r.text() }; };

log("######## 1. auth");
for (const q of ["", "?key=", "?key=wrong", "?key=vt", "?key=lk&x=1", "?c=alt&key=lk "]) { const r = await get(q); log(`GET /altegio${q} → ${r.s}`); }
log("POST no key →", (await post({ phone: "+77011234567" })).s, "| POST wrong key →", (await post({ key: "x", phone: "+77011234567" })).s, "| POST key only in query →", (await h.call("/altegio?key=lk", h.form({ phone: "+77011234567" }))).status,
  "| POST json body →", (await h.call("/altegio", { method: "POST", headers: { "content-type": "application/json" }, body: '{"key":"lk"}' })).status, "| PUT →", (await h.call("/altegio?key=lk", { method: "PUT" })).status);
h.ALT.records.length = 0;
{ const e2 = { ...h.env }; delete e2.LEADS_KEY; const r = await h.worker.fetch(new Request("https://x.test/altegio?key=vt"), e2, {}); log("LEADS_KEY unset, key=VERIFY_TOKEN →", r.status);
  delete e2.VERIFY_TOKEN; for (const k of ["", "undefined", "null"]) log(`no LEADS_KEY and no VERIFY_TOKEN, key=${JSON.stringify(k)} →`, (await h.worker.fetch(new Request("https://x.test/altegio?key=" + k), e2, {})).status);
  log("…and without ?key at all →", (await h.worker.fetch(new Request("https://x.test/altegio"), e2, {})).status); }

log("\n######## 2. loc validation (default location of client alt in this env = 9301)");
h.loc(9301);
for (const loc of ["abc", "12a", "0", "000", " 9302 ", "-5", "1e3", "9302.0", "１２３", "9".repeat(13), "9302"]) { const r = await get("?key=lk&loc=" + encodeURIComponent(loc)); log(`loc=${JSON.stringify(loc)} → ${pre(r.t).split("\n").slice(1, 2).join(" ")}`); }

log("\n######## 3. escaping");
h.loc(9303, d => { d.services[0].title = '<script>alert(1)</script> "Стрижка" & <b>'; d.staff[0].name = '<img src=x onerror=alert(2)>'; d.staff[0].specialization = '"><svg onload=alert(3)>'; });
let r = await get('?key=lk&loc=9303&c=' + encodeURIComponent('"><script>alert(4)</script>'));
log("raw <script / <img / <svg in page:", /<script>alert|<img src=x|<svg onload/.test(r.t), "| hidden inputs:", (r.t.match(/<input type="hidden"[^>]*>/g) || []).join(" "));
r = await get('?key=lk&loc=' + encodeURIComponent('"><script>alert(5)</script>'));
log("bad loc echoed escaped:", !/<script>alert\(5\)/.test(r.t), "|", pre(r.t).split("\n")[1]);
h.ALT.hook = path => /book_services\/9304/.test(path) ? J({ success: false, meta: { message: '<img src=x onerror=alert(6)>' } }, 403) : null;
r = await get("?key=lk&loc=9304"); log("error message from Altegio escaped:", !/<img src=x onerror=alert\(6\)>/.test(r.t), "|", pre(r.t).split("\n")[2]);
h.ALT.hook = null;

log("\n######## 4. trial booking: every branch (POST with phone)");
const trial = async (name, loc, hook, phone = "+7 701 123 45 67", prep) => {
  h.loc(loc, prep); h.ALT.hook = hook || null; h.ALT.calls.length = 0; h.ALT.records.length = 0; h.ALT.deleted.length = 0;
  const t0 = Date.now(); const r = await post({ key: "lk", c: "alt", loc: "", phone });
  const lines = pre(r.t).split("\n"); const i = lines.findIndex(l => /^Пробная запись|^Удаление/.test(l));
  log(`--- ${name}  (${Date.now() - t0} ms; POST book_record: ${h.ALT.calls.filter(x => /POST \/book_record/.test(x)).length}, DELETE: ${h.ALT.calls.filter(x => /^DELETE/.test(x)).length})\n` + lines.slice(i < 0 ? -3 : i).filter(l => l && !/^Чат с записью/.test(l)).map(l => "    " + l).join("\n"));
  h.ALT.hook = null;
};
const rec = (extra) => (path, method) => /book_record/.test(path) && method === "POST" ? extra() : null;
const del = (resp) => (path, method) => method === "DELETE" ? resp() : null;
await trial("a. success", 9310);
await trial("b. delete → 500", 9311, del(() => J({ success: false, meta: { message: "Server error" } }, 500)));
await trial("c. delete → 404", 9312, del(() => J({ success: false, meta: {} }, 404)));
await trial("d. delete → 403", 9313, del(() => J({ success: false, meta: { message: "Forbidden" } }, 403)));
await trial("e. delete → network error", 9314, del(() => Promise.reject(new Error("net"))));
await trial("f. record without hash", 9315, rec(() => J({ success: true, data: [{ id: 1, record_id: 777 }] }, 201)));
await trial("g. record without record_id", 9316, rec(() => J({ success: true, data: [{ id: 1 }] }, 201)));
await trial("h. book_record → 201, empty body", 9317, rec(() => new Response(null, { status: 201 })));
await trial("i. book_record → 201, body is not JSON", 9318, rec(() => new Response("Created", { status: 201 })));
await trial("j. book_record → 200, HTML page (proxy)", 9319, rec(() => new Response("<html>ok</html>", { status: 200 })));
await trial("k. book_record → 500", 9320, rec(() => J({ success: false, meta: { message: "Server error" } }, 500)));
await trial("l. book_record → 502 HTML", 9321, rec(() => new Response("<html>bad gateway</html>", { status: 502 })));
await trial("m. book_record → network error", 9322, rec(() => Promise.reject(new Error("net"))));
await trial("n. book_record → 422 code 433 (slot taken)", 9323, rec(() => J({ success: false, meta: { message: "Ошибка", errors: [{ code: 433, message: "Selected time slot is already taken" }] } }, 422)));
await trial("o. book_record → 422 code 432 (SMS code)", 9324, rec(() => J({ success: false, meta: { errors: [{ code: 432, message: "Incorrect SMS verification code" }] } }, 422)));
await trial("p. book_record → 422 code 431, message mentions «код страны»", 9325, rec(() => J({ success: false, meta: { errors: [{ code: 431, message: "Неверный код страны в номере телефона" }] } }, 422)));
await trial("q. book_record → 404 (per docs: team member does not provide the service)", 9326, rec(() => J({ success: false, meta: { message: "Not found" } }, 404)));
await trial("r. book_record → 429 twice", 9327, rec(() => J({ success: false, meta: { message: "Too Many Requests" } }, 429)));
await trial("s. book_record → 200 success:false", 9328, rec(() => J({ success: false, meta: { message: "Online booking is disabled" } }, 200)));
await trial("t. bad phone", 9329, null, "12345");
await trial("u. no free time", 9330, null, undefined, d => { d.times = { 0: [] }; });
await trial("v. no services", 9331, null, undefined, d => { d.services = []; });
await trial("w. book_check fails 404, book_record is still attempted?", 9332, (path) => /book_check/.test(path) ? J({ success: false, meta: { message: "Not found" } }, 404) : null);
await trial("x. record created, hash present, DELETE answers 200 success:false", 9333, del(() => J({ success: false, meta: { message: "Cannot delete" } }, 200)));
log("\n######## 5. GET with ?phone= must not create anything");
h.loc(9340); h.ALT.calls.length = 0; await get("?key=lk&phone=%2B77011234567"); log("POST book_record calls on GET:", h.ALT.calls.filter(x => /POST \/book_record/.test(x)).length);
process.exit(0);
