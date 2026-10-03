// Time buttons (chips) shown under the code-generated answers.
import { mk, show, D1 } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4260" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
// Арман is free at 11:00 and 13:00 only; 10:00 is free for another master
h.gemini = ["Записала вас к Арману завтра в 10:00.\n" + h.tag("Тимур", "Мужская стрижка", "Арман", D1, "10:00")];
let d = await h.chat("alt", "ch1", "Тимур, +7 702 111 66 33, стрижка к Арману завтра в 10:00");
_log("reply: " + d.reply + "\nbuttons: " + JSON.stringify(d.offer.map(x => "В " + x)));
// the client taps the first button
h.gemini = ["Записала вас к Арману завтра в 10:00.\n" + h.tag("Тимур", "Мужская стрижка", "Арман", D1, "10:00")];
d = await h.chat("alt", "ch1", "В 10:00");
_log("client taps «В 10:00» → reply: " + d.reply + "\nbuttons: " + JSON.stringify(d.offer.map(x => "В " + x)));
// noop / yours answers mention the existing booking time → button for a time the client already has
h.gemini = ["Записала.\n" + h.tag("Марат", "Мужская стрижка", "любой", D1, "13:00")];
d = await h.chat("alt", "ch2", "Марат, +7 702 111 66 34, мужская стрижка завтра в 13:00");
h.gemini = ["Вы записаны на завтра."]; d = await h.chat("alt", "ch2", "Я точно записан?");
_log("\n«Я точно записан?» → reply: " + d.reply + "\nbuttons: " + JSON.stringify(d.offer.map(x => "В " + x)));
