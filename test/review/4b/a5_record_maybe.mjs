// A. book_record answers 2xx but the body is not JSON (proxy page, truncated/garbled answer): is the administrator told that a record may exist?
// + book_times with service filter answers 404 for a master who does not provide the service (what the docs call 404).
import { mk, D1, J } from "./lib.mjs";
const h = await mk(); const log = h.quiet();
const run = async (name, loc, hook, master = "любой") => {
  h.loc(loc); h.ALT.hook = hook; h.calls.tg.length = 0; h.ALT.calls.length = 0;
  h.gemini = ["Записала вас.\n" + h.tag("Азамат", "Мужская стрижка", master, D1, "11:00")];
  const d = await h.chat("alt", "m" + loc, `Азамат, ${h.phone()}, мужская стрижка завтра в 11:00`);
  const lead = h.leads("alt").at(-1) || {};
  log(`--- ${name}\n    reply   : ${d.reply}\n    telegram: ${JSON.stringify(h.calls.tg.map(x => x.split("\n")[0] + " … " + x.split("\n").at(-1)))}\n    lead note for the administrator: ${JSON.stringify(lead.note)} | POST book_record sent: ${h.ALT.calls.filter(x => /POST \/book_record/.test(x)).length}`);
  h.ALT.hook = null;
};
const rec = f => (path, method) => /book_record/.test(path) && method === "POST" ? f() : null;
await run("book_record → 201 Created, body «Created» (not JSON)", 9801, rec(() => new Response("Created", { status: 201 })));
await run("book_record → 200, HTML page", 9802, rec(() => new Response("<html><body>OK</body></html>", { status: 200 })));
await run("control: book_record → 201, empty body", 9803, rec(() => new Response(null, { status: 201 })));
await run("control: book_record → 500", 9804, rec(() => J({ success: false, meta: { message: "Server error" } }, 500)));
await run("book_times?service_ids → 404 for the chosen master (he does not provide the service); common list showed 11:00 as free", 9805,
  (path) => /book_times\/9805\/11\/.*service_ids/.test(path) ? J({ success: false, data: null, meta: { message: "Not found" } }, 404) : null, "Арман");
process.exit(0);
