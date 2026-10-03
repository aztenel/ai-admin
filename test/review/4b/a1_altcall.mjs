// A. altCall: overall deadline incl. body, one retry on 429, error shapes, non-JSON.
import * as W from "./worker.x.mjs";
const env = { ALTEGIO_PARTNER: "k" };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
let handler, calls = 0, lastSignal = null;
globalThis.fetch = (u, init) => { calls++; lastSignal = init.signal; return handler(u, init, calls); };
async function run(name, h, method = "GET", path = "/book_services/1", body) {
  handler = h; calls = 0; const t0 = Date.now();
  let out;
  try { const d = await W.altCall(env, method, path, body); out = "OK data=" + JSON.stringify(d); }
  catch (e) { out = `ERR status=${e.status} code=${e.code} message=${JSON.stringify(e.message)}`; }
  console.log(`${name}\n   → ${out} | ${Date.now() - t0} ms | fetch calls ${calls} | aborted=${lastSignal && lastSignal.aborted}`);
}
const stalledBody = (status = 200) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"success":true,"da')); /* never closes */ } }), { status });
await run("1. 200 JSON", () => J({ success: true, data: { a: 1 } }));
await run("2. headers come, body stalls forever (200)", () => stalledBody());
await run("3. fetch never resolves", (u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))));
await run("4. 429 then 200", (u, i, n) => n === 1 ? J({ success: false, meta: { message: "Too Many Requests" } }, 429) : J({ success: true, data: [1] }));
await run("5. 429 twice", () => J({ success: false, meta: { message: "Too Many Requests" } }, 429));
await run("6. 429, then the retry stalls", (u, i, n) => n === 1 ? J({}, 429) : stalledBody());
await run("7. 200 non-JSON (HTML)", () => new Response("<html>ok</html>", { status: 200 }));
await run("8. POST book_record → 201 non-JSON body", () => new Response("Created", { status: 201 }), "POST", "/book_record/1", { x: 1 });
await run("9. 502 HTML", () => new Response("<html>Bad gateway</html>", { status: 502 }));
await run("10. 201 empty body", () => new Response(null, { status: 201 }), "POST", "/book_record/1", {});
await run("11. 204 DELETE", () => new Response(null, { status: 204 }), "DELETE", "/user/records/1/h");
await run("12. 200 success:false", () => J({ success: false, data: null, meta: { message: "Online booking is disabled" } }));
await run("13. 422 errors as list", () => J({ success: false, meta: { message: "Ошибка", errors: [{ code: 433, message: "Slot taken" }] } }, 422));
await run("14. 422 errors as object", () => J({ success: false, meta: { message: "Ошибка", errors: { code: 433, message: "Slot taken" } } }, 422));
await run("15. 422 errors as dict field→list", () => J({ success: false, meta: { message: "Ошибка", errors: { phone: ["Invalid phone format"] } } }, 422));
await run("16. 422 code only in meta", () => J({ success: false, meta: { code: 431, message: "Phone format" } }, 422));
await run("17. 422 errors at top level", () => J({ success: false, errors: [{ code: 436, message: "No staff" }], meta: [] }, 422));
await run("18. 422 errors: dict field→{code,message}", () => J({ success: false, meta: { errors: { appointments: { code: 437, message: "Overlap" } } } }, 422));
await run("19. 422 errors as string", () => J({ success: false, meta: { errors: "Bad" } }, 422));
await run("20. 404 JSON without message", () => J({ success: false, data: null, meta: {} }, 404));
await run("21. 200 JSON `true`", () => new Response("true", { status: 200 }));
await run("22. 200 JSON array at top level", () => new Response("[1,2]", { status: 200 }));
await run("23. network error", () => Promise.reject(new TypeError("fetch failed")));
await run("24. no key", () => J({}), "GET", "/x").catch(() => {});
handler = () => J({}); try { await W.altCall({}, "GET", "/x"); } catch (e) { console.log("25. env without ALTEGIO_PARTNER →", e.status, e.message); }
process.exit(0);
