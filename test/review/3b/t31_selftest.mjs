import { mk, show, D1, D2, J } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4310" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
h.gemini = ["Имплантация под ключ от 300 000 ₸ за зуб. Записать вас завтра в 10:00 или 11:00?"];
for (const q of ["i=0", "", "i=", "i=abc", "i=-1", "i=999", "i=1.5", "i=1e1", "i=51", "i=52", "i=0&i=5", "i=0x10"]) {
  const n0 = h.calls.gemini.length;
  const r = await h.call("/api/selftest?key=lk" + (q ? "&" + q : "")); const t = await r.text();
  _log(`GET /api/selftest?key=lk&${q} → ${r.status} ${t.slice(0, 70)}… | LLM calls: ${h.calls.gemini.length - n0}`);
}
let n0 = h.calls.gemini.length;
let r = await h.call("/api/selftest?key=lk&i=0", { method: "HEAD" }); _log(`HEAD /api/selftest?key=lk&i=0 → ${r.status} | LLM calls: ${h.calls.gemini.length - n0}`);
const a0 = h.ALT.calls.length; r = await h.call("/altegio?key=lk", { method: "HEAD" }); _log(`HEAD /altegio?key=lk → ${r.status} | Altegio calls: ${h.ALT.calls.length - a0} (${[...new Set(h.ALT.calls.slice(a0).map(x => x.split("/")[1]))].join(",")}) | records: ${h.ALT.records.length}`);
_log("KV keys after selftests: " + JSON.stringify([...h.mem.keys()]));
