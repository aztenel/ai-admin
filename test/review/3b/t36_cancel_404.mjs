// Borderline with the cancel state machine, but it is about reading Altegio's answers:
// any 404 on DELETE is treated as «record is already gone». Here book_record answers without record_hash,
// so the DELETE URL is /user/records/<id>/ (no hash) → 404 «route/record not found» → the client is told the record is cancelled.
import { mk, show, D1, D2, J } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4360" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
h.ALT.hook = (p, m, init) => {
  if (p.startsWith("/book_record/")) { h.ALT.records.push(JSON.parse(init.body)); return J({ success: true, data: [{ id: 1, record_id: 777001 }], meta: [] }, 201); } // no record_hash
  if (m === "DELETE") return /\/user\/records\/\d+\/\w+/.test(p) ? null : J({ success: false, data: null, meta: { message: "Not found" } }, 404);
  return null;
};
h.gemini = ["Записала.\n" + h.tag("Тимур", "Мужская стрижка", "любой", D1, "10:00")];
let d = await h.chat("alt", "c404", "Тимур, +7 702 111 44 55, мужская стрижка завтра в 10:00");
_log("booked: " + d.reply + " | note: " + d.lead.note);
h.calls.tg.length = 0;
h.gemini = ["Отменяю.\n[ОТМЕНА]"];
d = await h.chat("alt", "c404", "Отмените запись");
_log("cancel → reply: " + d.reply + " | cancelDone=" + d.cancelDone);
_log("DELETE call: " + h.ALT.calls.filter(x => x.startsWith("DELETE")).join(", ") + " | actually deleted in Altegio: " + h.ALT.deleted.length);
_log("Telegram: " + JSON.stringify(h.calls.tg));
