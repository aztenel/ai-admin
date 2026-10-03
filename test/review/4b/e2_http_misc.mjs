// E. handleWebChat pub(), /leads, /api/history, /api/selftest, hasClient, chat page script (fake DOM), tooMany limits.
import { mk, D1, J } from "./lib.mjs";
import vm from "node:vm";
const h = await mk({ env: { KEY_ALT: "ka", KEY_DENT: "kd" } }); const log = h.quiet();

log("######## 1. what goes to the browser after a booking (one record, two records, a request to the administrator)");
h.loc(9401, d => { d.times = { 0: ["10:00", "11:00", "13:00"], 11: ["10:00", "11:00", "13:00"], 12: ["10:00", "11:00", "13:00"] }; });
h.gemini = ["Записала вас.\n" + h.tag("Азамат", "Мужская стрижка", "Арман", D1, "11:00")];
let d = await h.chat("alt", "p1", "Азамат, +7 701 400 10 01, мужская стрижка завтра в 11:00 к Арману");
log(JSON.stringify(d));
h.gemini = ["Записала вас обоих.\n" + h.tag("Азамат", "Мужская стрижка", "Арман", D1, "13:00") + "\n" + h.tag("Данияр", "Детская стрижка", "Ерлан", D1, "13:00")];
d = await h.chat("alt", "p2", "Азамат и сын Данияр, +7 701 400 10 02, завтра в 13:00: мне мужскую к Арману, сыну детскую к Ерлану");
log(JSON.stringify(d));
h.ALT.hook = (path, method) => /book_record/.test(path) ? J({ success: false, meta: { message: "Server error <b>x</b>" } }, 500) : null;
h.gemini = ["Записала вас.\n" + h.tag("Марат", "Мужская стрижка", "любой", D1, "10:00")];
d = await h.chat("alt", "p3", "Марат, +7 701 400 10 03, мужская стрижка завтра в 10:00");
h.ALT.hook = null;
log(JSON.stringify(d));
const all = JSON.stringify([d]) + (await (await h.call("/api/history?c=alt&sid=p1")).text()) + (await (await h.call("/api/history?c=alt&sid=p2")).text());
log("record_hash or note anywhere in browser-visible JSON:", /hash555|record_hash|"note"|НЕ записан|ВОЗМОЖНО/.test(JSON.stringify(d) + all));
log("KV leads keep hash+note for the administrator:", h.leads("alt").map(l => `${l.name}: note=${JSON.stringify(l.note)} hash=${l.altegio ? l.altegio.record_hash : "-"}`).join(" || "));

log("\n######## 2. /leads");
for (const q of ["", "?key=x", "?key=lk", "?c=alt&key=ka", "?c=alt&key=kd", "?c=dent&key=ka", "?c=constructor&key=lk", "?c=__proto__&key=ka", "?c=alt&key="]) { const r = await h.call("/leads" + q); const t = await r.text(); log(`GET /leads${q} → ${r.status}${r.status === 200 ? " | blocks: " + (t.match(/<h3>[^<]*<\/h3>/g) || []).join("") : ""}`); }
h.gemini = ['Записала вас.\n[ЗАЯВКА] Имя: <img src=x onerror=alert(1)>; Телефон: указан; Услуга: <script>alert(2)</script>; Время: завтра <b>10:00</b>'];
await h.chat("dent", "x1", "+7 701 400 10 04 запишите");
let t = await (await h.call("/leads?key=lk")).text();
log("XSS payload from an LLM tag rendered raw on /leads:", /<img src=x|<script>alert|<b>10:00/.test(t), "| note with HTML from Altegio escaped:", !/Server error <b>x<\/b>/.test(t) && /Server error &lt;b&gt;x/.test(t));
log("hash on /leads page:", /hash555/.test(t));

log("\n######## 3. /api/history and hasClient");
for (const c of ["alt", "constructor", "__proto__", "toString", "hasOwnProperty", "ALT", "", "nope"]) {
  const r = await h.call(`/api/history?c=${c}&sid=p1`); const j = await r.json();
  const pg = await h.call(`/?c=${c}`); const pt = await pg.text();
  h.gemini = ["Здравствуйте!"]; const ch = await h.chatIp(c, "hc-" + (c || "empty"), "Привет", "10.77.0." + (c.length + 1));
  const al = await h.call(`/altegio?key=lk&c=${c}`);
  log(`c=${JSON.stringify(c)}: history ${r.status} turns=${j.turns.length} | page ${pg.status} ${/<title>([^<]*)/.exec(pt)[1]} | chat ${ch.__status} ${JSON.stringify(ch.reply).slice(0, 40)} | /altegio ${al.status}`);
}
log("history without sid →", JSON.stringify(await (await h.call("/api/history?c=alt")).json()), "| profile leaked in history:", /profile|bookings|record_hash/.test(await (await h.call("/api/history?c=alt&sid=p1")).text()));

log("\n######## 4. /api/selftest auth");
h.gemini = ["Имплантация под ключ от 300 000 ₸ за зуб. Записать вас завтра?"];
for (const [m, q, body] of [["GET", "", null], ["GET", "?key=x&i=0", null], ["GET", "?key=lk&i=999", null], ["GET", "?key=lk&i=abc", null], ["GET", "?key=lk", null], ["POST", "", { key: "x", i: 0 }], ["POST", "", { i: 0 }], ["POST", "", { key: "lk", i: 0 }]]) {
  const r = await h.call("/api/selftest" + q, m === "POST" ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const tx = await r.text(); log(`${m} /api/selftest${q}${body ? " " + JSON.stringify(body) : ""} → ${r.status} ${tx.slice(0, 70).replace(/\n/g, " ")}`);
}
log("selftest wrote to the real leads list:", h.leads("dent").some(l => /автотест/.test(l.source)));

log("\n######## 5. chat page script in a fake DOM: several lead cards, cancel card");
const page = await (await h.call("/?c=alt")).text();
const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
function fakeDom(responses) {
  const mkEl = tag => ({ tag, children: [], className: "", _text: "", set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text + this.children.map(c => c.textContent).join(""); },
    set innerHTML(v) { this.children = []; this._text = ""; }, appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); }, remove() { this.gone = true; }, scrollTop: 0, scrollHeight: 0, value: "", onclick: null, onsubmit: null });
  const els = { ch: mkEl("main"), cp: mkEl("div"), in: mkEl("input"), f: mkEl("form"), rs: mkEl("button") };
  const sandbox = { document: { getElementById: id => els[id], createElement: mkEl }, localStorage: { getItem: () => "sid-1", setItem() {} }, crypto: { randomUUID: () => "u" }, performance: { now: () => 0 },
    fetch: async (u) => ({ json: async () => (String(u).startsWith("/api/history") ? { turns: [] } : responses.shift()) }), console, Date, setTimeout };
  vm.createContext(sandbox); vm.runInContext(script, sandbox);
  return { els, sandbox };
}
const cards = els => els.ch.children.filter(c => c.className === "lead" && !c.gone).map(c => c.textContent);
const chipsOf = els => els.cp.children.map(c => c.textContent);
for (const [name, resp] of [
  ["one Altegio record", { reply: "Записала вас", lead: { name: "Азамат", phone: "+77014001001", service: "Мужская стрижка · Арман", time: "завтра, в 11:00", altegio: { record_id: 555001 } }, offer: [] }],
  ["two records", { reply: "Записала вас", lead: { name: "Данияр", phone: "+7", service: "Детская", time: "13:00", altegio: { record_id: 2 } }, leads: [{ name: "Азамат", phone: "+7", service: "Мужская", time: "13:00", altegio: { record_id: 1 } }, { name: "Данияр", phone: "+7", service: "Детская", time: "13:00", altegio: { record_id: 2 } }], offer: [] }],
  ["record + request to admin in one reply", { reply: "…", lead: { name: "B", phone: "+7", service: "s", time: "t" }, leads: [{ name: "A", phone: "+7", service: "s", time: "t", altegio: { record_id: 1 } }, { name: "B", phone: "+7", service: "s", time: "t" }], offer: [] }],
  ["dry-run record (record_id 0)", { reply: "…", lead: { name: "A", phone: "+7", service: "s", time: "t", altegio: { record_id: 0 } }, offer: [] }],
  ["cancel done", { reply: "Отменила", cancel: true, cancelDone: true, lead: null, offer: [] }],
  ["cancel passed to admin", { reply: "Передала", cancel: true, cancelDone: false, lead: null, offer: [] }],
  ["move: cancel + new record", { reply: "Перенесла", cancel: true, cancelDone: true, lead: { name: "A", phone: "+7", service: "s", time: "t", altegio: { record_id: 3 } }, offer: [] }],
  ["HTML in fields", { reply: "<b>x</b>", lead: { name: "<img src=x onerror=1>", phone: "+7", service: "<script>", time: "t" }, offer: ["<i>10:00</i>"] }],
  ["offer chips", { reply: "Свободно 10:00 и 11:00", lead: null, offer: ["10:00", "11:00"] }],
]) {
  const { els, sandbox } = fakeDom([resp]); await new Promise(r => setTimeout(r, 5));
  await sandbox.send ? null : null; await vm.runInContext("send('тест')", sandbox); await new Promise(r => setTimeout(r, 5));
  log(`  ${name}: cards=${JSON.stringify(cards(els))} chips=${JSON.stringify(chipsOf(els))}`);
}
process.exit(0);
