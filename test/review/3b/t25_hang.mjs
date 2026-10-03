// altCall: the 8-second timeout covers only the wait for response headers. If Altegio sends headers and then stalls
// on the body, r.json() has no timeout (the timer is cleared right after fetch() resolves).
import { mk, show, D1, D2, J } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4250" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
h.ALT.hook = (p, m, init) => {
  if (!p.startsWith("/book_services/")) return null;
  // headers arrive at once, the body never ends; honours the AbortSignal like a real fetch would
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"success":true,"data":{"services":[')); init.signal && init.signal.addEventListener("abort", () => c.error(new Error("aborted"))); } });
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
};
h.gemini = ["Здравствуйте!"];
const t0 = Date.now();
const r = await Promise.race([h.chat("alt", "hg1", "Привет").then(d => "answered: " + d.reply), new Promise(s => setTimeout(() => s("STILL WAITING after 20 s (timeout in altCall is 8 s)"), 20000))]);
_log(`${r} | elapsed ${Date.now() - t0} ms`);
process.exit(0);
