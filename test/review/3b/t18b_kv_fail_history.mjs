// Variant: the LAST KV write (chat state, worker.js L995) fails after the record was created — e.g. two messages of one chat
// processed within the same second (WhatsApp users often send 2–3 short messages in a row; KV allows 1 write/sec per key).
import { mk, show, D1, D2, J } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4181" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
const D = h.dataFor("4181"); D.consume = true; D.times = { 0: ["10:00", "11:00"], 11: ["10:00", "11:00"], 12: [] };
h.gemini = ["Завтра свободно в 10:00. Как вас зовут?"]; await h.chat("alt", "k2", "Мужская стрижка завтра в 10:00");
h.kvFail = k => k === "h:web:alt:k2";
h.gemini = ["Записала.\n" + h.tag("Тимур", "Мужская стрижка", "любой", D1, "10:00")];
const res = await h.call("/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "10.77.0.2" }, body: JSON.stringify({ c: "alt", sid: "k2", text: "Тимур, +7 702 111 22 66" }) }).then(async r => ({ status: r.status, body: (await r.text()).slice(0, 80) }), e => ({ thrown: String(e) }));
_log("booking message → " + JSON.stringify(res) + " | records in Altegio: " + h.ALT.records.length + " | lead saved: " + JSON.parse(h.mem.get("leads:alt") || "[]").length + " | TG: " + h.calls.tg.length);
h.kvFail = null;
h.gemini = ["Записала.\n" + h.tag("Тимур", "Мужская стрижка", "любой", D1, "10:00")];
const d = await h.chat("alt", "k2", "Тимур, +7 702 111 22 66");
_log("client repeats → " + d.reply + " | bookings known to the chat: " + JSON.stringify((JSON.parse(h.mem.get("h:web:alt:k2")).profile.bookings || []).length));
