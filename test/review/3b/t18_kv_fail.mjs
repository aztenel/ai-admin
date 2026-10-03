// KV write fails right after Altegio created the record (KV: 1 write/second per key, daily write quota on the free plan).
// The limit counters (altCount) are written between book_record and saving the chat state.
import { mk, show, D1, D2, J } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4180" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
const D = h.dataFor("4180"); D.consume = true; D.times = { 0: ["10:00", "11:00"], 11: ["10:00", "11:00"], 12: [] };
const leads = async () => JSON.parse((await h.KV.get("leads:alt")) || "[]");

h.gemini = ["Завтра свободно в 10:00. Как вас зовут?"];
await h.chat("alt", "k1", "Мужская стрижка завтра в 10:00");
// the counter key of the whole location was written less than a second ago by another client's booking → KV answers 429
h.kvFail = k => k.startsWith("bk:4180:all:");
h.gemini = ["Записала.\n" + h.tag("Тимур", "Мужская стрижка", "любой", D1, "10:00")];
let res = await h.call("/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "10.77.0.1" }, body: JSON.stringify({ c: "alt", sid: "k1", text: "Тимур, +7 702 111 22 55" }) }).then(async r => ({ status: r.status, body: await r.text() }), e => ({ thrown: String(e) }));
_log("1) booking message → worker result: " + JSON.stringify(res).slice(0, 200));
_log("   records in Altegio: " + h.ALT.records.length + " | Telegram: " + JSON.stringify(h.calls.tg.map(x => x.split("\n")[0])) + " | leads saved: " + (await leads()).length);
const hist = JSON.parse(await h.KV.get("h:web:alt:k1"));
_log("   chat state: n=" + hist.n + ", bookings in profile: " + JSON.stringify(hist.profile.bookings || null) + ", last turn: " + hist.turns.at(-1).text.slice(0, 60));

h.kvFail = null; // KV is fine again; the browser showed «Нет связи, попробуйте ещё раз» and the client repeats
h.gemini = ["Записала.\n" + h.tag("Тимур", "Мужская стрижка", "любой", D1, "10:00")];
let d = await h.chat("alt", "k1", "Тимур, +7 702 111 22 55");
_log("2) client repeats → " + d.reply);
h.gemini = ["Записала.\n" + h.tag("Тимур", "Мужская стрижка", "любой", D1, "11:00")];
d = await h.chat("alt", "k1", "Тогда в 11:00");
_log("3) client picks another time → " + d.reply);
_log("   records in Altegio for this client: " + h.ALT.records.map(r => r.fullname + " " + r.appointments[0].datetime.slice(11, 16)).join(", ") + " | deleted: " + h.ALT.deleted.length);
_log("   leads saved: " + (await leads()).map(l => l.time + " / " + l.note).join(" ; "));
