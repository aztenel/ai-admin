// altCache: isolation between locations/clients, TTLs, staleness.
import { mk, show, D1, D2, J } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4170", ALTEGIO_LOC_BARBER: "4171" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
const windows = () => (h.sys().match(/Свободные окна для записи[^\n]*\n((?:- [^\n]*\n?)+)/) || ["", ""])[1].trim().split("\n")[0];
const svc = () => (h.sys().match(/Услуги для записи[^\n]*\n((?:  ·[^\n]*\n)+)/) || ["", ""])[1].trim().replace(/\n/g, " | ");
const callsSince = n => h.ALT.calls.slice(n).map(x => x.replace(/\?.*$/, "")).join(", ") || "(no Altegio calls — cache)";

_log("=== A. two clients, two locations, different data — does the cache mix them?");
const B = h.dataFor("4171"); B.services = [{ id: 901, title: "Королевское бритьё", category_id: 1, price_min: 7000, active: 1, seance_length: 2400 }]; B.staff = [{ id: 91, name: "Даурен", bookable: true }]; B.times = { 0: ["15:00", "17:00"], 91: ["15:00", "17:00"] };
h.gemini = ["Здравствуйте! Чем помочь?"];
await h.chat("alt", "c1", "Какие услуги?"); _log("alt    (4170): " + svc() + " || " + windows());
await h.chat("barber", "c2", "Какие услуги?"); _log("barber (4171): " + svc() + " || " + windows());
await h.chat("alt", "c3", "Какие услуги?"); _log("alt again    : " + svc() + " || " + windows());
_log("barber prompt keeps its own demo facts AND gets Altegio services: " + (h.calls.gemini.at(-2).systemInstruction.parts[0].text.includes("Королевское бритьё")));
// guard isolation: 15:00 is free only in 4171 (9:00/21:00/10:00/22:00 are config hours)
h.gemini = ["Могу записать вас завтра в 15:00.", "Могу записать вас завтра в 15:00."];
let d = await h.chat("alt", "c4", "Есть время?"); _log("alt: LLM offers 15:00 (free only in the other location) → " + (d.guard || "passed") );

_log("\n=== B. within TTL a second message makes no Altegio calls; data changed in Altegio is not seen for 120 s");
let n = h.ALT.calls.length;
h.gemini = ["Завтра свободно в 10:00. Записать?"];
await h.chat("alt", "c5", "Есть время завтра?"); _log("calls: " + callsSince(n));
h.dataFor("4170").times[0] = ["09:30", "11:00", "13:00"]; // 10:00 was taken in Altegio by someone else
n = h.ALT.calls.length;
d = await h.chat("alt", "c5", "Давайте в 10:00"); _log("after 10:00 was taken elsewhere: prompt still shows → " + windows() + " | guard: " + (d.guard || "passed") + " | calls: " + callsSince(n));

_log("\n=== C. booking attempt on the stale slot: fresh re-check must catch it; is the stale snapshot dropped afterwards?");
h.gemini = ["Записала.\n" + h.tag("Тимур", "Мужская стрижка", "любой", D1, "10:00")];
n = h.ALT.calls.length;
d = await h.chat("alt", "c5", "Тимур, +7 702 111 22 44");
_log("reply: " + d.reply + "\nrecords: " + h.ALT.records.length + " | calls: " + callsSince(n) + " | chips: " + JSON.stringify(d.offer));
h.gemini = ["Завтра свободно в 10:00 и 11:00. Какое время выбрать?"];
n = h.ALT.calls.length;
d = await h.chat("alt", "c5", "А что тогда свободно завтра?");
_log("next message: prompt → " + windows() + "\n  LLM again offers 10:00 → " + (d.guard || "PASSED the guard") + " | chips: " + JSON.stringify(d.offer) + " | calls: " + callsSince(n));

_log("\n=== D. after a successful booking the times cache of this location is dropped");
h.gemini = ["Записала.\n" + h.tag("Тимур", "Мужская стрижка", "любой", D1, "11:00")];
d = await h.chat("alt", "c5", "Тогда в 11:00"); n = h.ALT.calls.length;
h.gemini = ["Ждём вас!"]; await h.chat("alt", "c5", "Спасибо"); _log("booked: " + !!d.lead + " | next message calls: " + callsSince(n));

_log("\n=== E. /altegio clears the whole cache (all locations)");
n = h.ALT.calls.length; await h.call("/altegio?key=lk&loc=4999"); const afterDiag = h.ALT.calls.length;
h.gemini = ["Здравствуйте!"]; await h.chat("barber", "c6", "Привет"); _log("barber message after /altegio?loc=4999 → calls: " + callsSince(afterDiag));
