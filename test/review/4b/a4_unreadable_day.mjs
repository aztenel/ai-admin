// A/D. One day is unreadable (book_times → 500), the other is fine. The prompt tells the LLM: «скажи, что уточнит администратор».
// Does anybody tell the administrator about THIS client?
import { mk, D1, D2, J } from "./lib.mjs";
const h = await mk(); const log = h.quiet();
h.loc(9701, d => { d.timesHook = (staff, date) => date === D1 ? J({ success: false, meta: { message: "Server error" } }, 500) : null; });
// first client of the 10-minute window
h.gemini = ["Расписание на завтра сейчас уточняется — администратор проверит и свяжется с вами. Либо могу предложить послезавтра в 10:00."];
let d = await h.chat("alt", "u1", "Азамат, +7 701 700 10 01. Запишите меня на мужскую стрижку завтра в 10:00");
log("prompt note:", (h.sys().match(/- Расписание на [^\n]*/) || [""])[0]);
log("client 1 → reply:", d.reply, "| lead:", d.lead, "| leads in KV:", h.leads("alt").length);
log("   Telegram:", JSON.stringify(h.calls.tg));
// second client within 10 minutes
h.calls.tg.length = 0;
d = await h.chat("alt", "u2", "Дана, +7 701 700 10 02. Запишите меня на мужскую стрижку завтра в 11:00");
log("client 2 → reply:", d.reply, "| lead:", d.lead, "| leads in KV:", h.leads("alt").length);
log("   Telegram:", JSON.stringify(h.calls.tg));
process.exit(0);
