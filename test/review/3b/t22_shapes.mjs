// Data shapes: thin(), hm(), altDates(), flags in services/staff, /altegio?loc= label.
import { mk, show, D0, D1, D2, D3, J, iso } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4220" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
let n = 0;
const windows = () => (h.sys().match(/Свободные окна для записи[^\n]*\n((?:- [^\n]*\n?)+)/) || ["", ""])[1].trim();
const pre = t => t.slice(t.indexOf("<pre>") + 5, t.indexOf("</pre>"));
const grid = (from, to, step) => { const o = []; for (let m = from; m <= to; m += step) o.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`); return o; };

_log("=== A. thin(): what the LLM sees of a day");
for (const [label, times] of [["30-min grid at :15/:45, 9:15–20:45 (24 slots)", grid(555, 1245, 30)], ["15-min grid 9:00–21:00 (49 slots)", grid(540, 1260, 15)], ["20-min grid 9:10–20:50 (36 slots)", grid(550, 1250, 20)], ["45-min grid 9:00–21:00 (17 slots)", grid(540, 1260, 45)]]) {
  const loc = String(4220 + (++n)); h.env.ALTEGIO_LOC_ALT = loc; const D = h.dataFor(loc); D.times = { 0: times, 11: times, 12: times }; D.dates = [D1];
  h.gemini = ["Вечером свободного времени нет. Могу предложить утро. Подойдёт?"]; const d = await h.chat("alt", "t" + n, "Есть время завтра вечером, после работы?");
  _log(`  ${label}\n     prompt: ${windows()}`);
}
// the LLM is honest about what it sees; the real evening slots exist
_log("\n=== B. time formats coming from Altegio (book_times.time) and from the LLM tag");
for (const [label, altTime, tagTime] of [["Altegio «09:30», tag «09:30»", "09:30", "09:30"], ["Altegio «9:30», tag «9:30»", "9:30", "9:30"], ["Altegio «09:30:00»", "09:30:00", "09:30"], ["Altegio «10:00:00»", "10:00:00", "10:00"],
  ["tag «9:30 утра»", "09:30", "9:30 утра"], ["tag «10:00 утра»", "10:00", "10:00 утра"], ["tag «09:30:00»", "09:30", "09:30:00"], ["tag «10.00»", "10:00", "10.00"], ["tag «в 10:00»", "10:00", "в 10:00"], ["tag «10:00–11:00»", "10:00", "10:00–11:00"], ["tag «9:30-10:30»", "09:30", "9:30-10:30"]]) {
  const loc = String(4220 + (++n)); h.env.ALTEGIO_LOC_ALT = loc; h.ALT.records.length = 0;
  h.ALT.hook = (p) => { const m = p.match(/^\/book_times\/\d+\/\d+\/(\d{4}-\d{2}-\d{2})/); return m ? J({ success: true, data: [{ time: altTime, datetime: `${m[1]}T${altTime.slice(0, 5).padStart(5, "0")}:00+05:00` }], meta: [] }) : null; };
  h.gemini = ["Записала.\n" + h.tag("Тимур", "Мужская стрижка", "любой", D1, tagTime)];
  const d = await h.chat("alt", "t" + n, `Тимур, +7 702 6${String(10 + n).padStart(2, "0")} 22 33, мужская стрижка завтра`);
  _log(`  ${label.padEnd(30)} prompt: ${windows().split("\n")[0].replace(/^.*\): /, "")} → ${h.ALT.records.length ? "BOOKED " + h.ALT.records[0].appointments[0].datetime : (d.lead ? "ADMIN LEAD (" + d.lead.note + ")" : "asks: " + d.reply.slice(0, 60))}`);
}
h.ALT.hook = null;

_log("\n=== C. book_dates shapes");
const today = D0, ts = d => Math.floor(Date.parse(d + "T00:00:00+05:00") / 1000);
for (const [label, data] of [["ISO strings", { booking_dates: [D1, D2] }], ["unix seconds (midnight Astana)", { booking_dates: [ts(D1), ts(D2)] }], ["unix seconds (midnight UTC)", { booking_dates: [Date.parse(D1 + "T00:00:00Z") / 1000] }], ["unix seconds (midnight UTC+6)", { booking_dates: [Date.parse(D1 + "T00:00:00+06:00") / 1000] }],
  ["only booking_days {month:[days]}", { booking_days: { [+D1.slice(5, 7)]: [+D1.slice(8, 10), +D2.slice(8, 10)] }, booking_dates: [] }], ["today + yesterday + 4 more", { booking_dates: [iso(Date.now() - 86400e3), D0, D1, D2, D3] }], ["empty", { booking_dates: [], booking_days: {} }], ["data: null", null], ["booking_dates: {} (object)", { booking_dates: {} }]]) {
  const loc = String(4220 + (++n)); h.env.ALTEGIO_LOC_ALT = loc; h.dataFor(loc).dates = [D0, D1, D2, D3];
  h.ALT.hook = (p) => p.startsWith("/book_dates/") ? J({ success: true, data, meta: [] }) : null;
  h.gemini = ["Здравствуйте!"]; const d = await h.chat("alt", "t" + n, "Привет");
  let body; try { const r = await h.call(`/altegio?key=lk&loc=${loc}`); body = r.status === 200 ? (pre(await r.text()).match(/Ближайшие даты[^\n]*/) || ["?"])[0] : "HTTP " + r.status; } catch (e) { body = "UNHANDLED EXCEPTION in worker.fetch: " + e; }
  _log(`  ${label.padEnd(34)} chat: ${windows().replace(/\n/g, " | ").slice(0, 150)}\n  ${"".padEnd(34)} /altegio: ${body}`);
}
h.ALT.hook = null;

_log("\n=== D. flags: active '0' (string), bookable 0, hidden 1, fired 0, no seance_length, price 0");
h.env.ALTEGIO_LOC_ALT = "4290"; const D = h.dataFor("4290");
D.services = [{ id: 1, title: "A active:'0'", active: "0", price_min: 1000 }, { id: 2, title: "B active:true без длительности и цены", active: true }, { id: 3, title: "C price_min '5000.50' строкой", active: 1, price_min: "5000.50", seance_length: "1800" }, { id: 4, title: "D без active", price_min: 3000, price_max: 9000 }, { id: 0, title: "E id 0" }, { id: 6, title: "" }];
D.staff = [{ id: 1, name: "bookable 0", bookable: 0 }, { id: 2, name: "bookable '0'", bookable: "0" }, { id: 3, name: "hidden 1", bookable: true, hidden: 1 }, { id: 4, name: "fired '0'", bookable: true, fired: "0" }, { id: 5, name: "status 1 (удалён?)", bookable: true, status: 1 }, { id: 6, name: "без bookable" }];
h.gemini = ["Здравствуйте!"]; await h.chat("alt", "t" + (++n), "Привет");
const sys = h.sys(); _log(sys.slice(sys.indexOf("- Услуги для записи"), sys.indexOf("Свободные окна для записи")).trim());

_log("\n=== E. /altegio?loc=… parsing");
for (const loc of ["4290", "4290abc", "abc", "0", "-5", "1e3", " 4290 ", "4290.7"]) { const t = pre(await (await h.call(`/altegio?key=lk&loc=${encodeURIComponent(loc)}`)).text()); _log(`  loc=${JSON.stringify(loc)} → ${t.split("\n")[1]} | calls: ${h.ALT.calls.at(-1)}`); }
