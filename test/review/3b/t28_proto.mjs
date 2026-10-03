// Client id taken from the request and looked up as CLIENTS[id]: names inherited from Object.prototype.
import w74 from "../../../worker.js";
import w73 from "./worker73.mjs";
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
for (const [name, worker] of [["v7.3", w73], ["v7.4", w74]]) {
  const mem = new Map(), tg = [];
  const env = { KV: { get: async k => mem.get(k) ?? null, put: async (k, v) => { mem.set(k, v); }, delete: async k => { mem.delete(k); } }, GEMINI_KEY: "k", VERIFY_TOKEN: "vt", LEADS_KEY: "lk", TG_TOKEN: "tg", TG_CHAT: "1", ALTEGIO_SELF_CANCEL: "1", ALTEGIO_PARTNER: "partner-key" };
  globalThis.fetch = async (u, init = {}) => { const url = String(u); if (url.includes("telegram")) { tg.push(JSON.parse(init.body).text); return new Response("{}"); } if (url.includes("googleapis")) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Здравствуйте!" }] }, finishReason: "STOP" }] })); return new Response("{}", { status: 500 }); };
  const call = async (path, init) => { try { const r = await worker.fetch(new Request("https://x.test" + path, init), env, { waitUntil() {} }); return `HTTP ${r.status} ${(await r.text()).replace(/\s+/g, " ").slice(0, 90)}`; } catch (e) { return "UNHANDLED EXCEPTION: " + String(e).slice(0, 90); } };
  _log(`--- ${name}`);
  let i = 0;
  for (const c of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    _log(`  POST /api/chat c=${c} «Привет» → ` + await call("/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "10.5.5." + (++i) }, body: JSON.stringify({ c, sid: "p" + i, text: "Привет" }) }));
    _log(`  POST /api/chat c=${c} «стоп»   → ` + await call("/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "10.5.6." + i }, body: JSON.stringify({ c, sid: "q" + i, text: "стоп" }) }));
  }
  _log("  GET /?c=constructor → " + await call("/?c=constructor"));
  _log("  GET /leads?c=constructor&key=lk → " + await call("/leads?c=constructor&key=lk"));
  if (name === "v7.4") { _log("  GET /altegio?key=lk&c=__proto__ → " + (await call("/altegio?key=lk&c=__proto__")).slice(0, 60)); _log("  GET /altegio?key=lk&c=constructor&loc=5 → " + (await call("/altegio?key=lk&c=constructor&loc=5")).slice(0, 60)); }
  _log("  Telegram: " + JSON.stringify(tg));
}
