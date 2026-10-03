// A/D. altSnapshot: partial failures, 404 on book_times, named master, asked times, softTimes, cache; and what the client sees end-to-end.
import { mk, D1, D2, D3, J, sv } from "./lib.mjs";
const h = await mk(); const log = h.quiet();
const part = (s, from, to) => { const i = s.indexOf(from); const j = to ? s.indexOf(to, i) : -1; return i < 0 ? "(not in prompt)" : s.slice(i, j < 0 ? undefined : j).trim(); };
const slotsBlock = () => part(h.sys(), "Свободные окна для записи", "ПРАВИЛА (они важнее");
const altBlock = () => part(h.sys(), "Запись в расписание (важнее");
let n = 0;
const ask = async (loc, text, llm = "Чем могу помочь?") => { h.env.ALTEGIO_LOC_ALT = String(loc); h.gemini = [llm]; h.calls.tg.length = 0; const d = await h.chat("alt", "s" + (++n), text); return d; };

log("######## 1. three bookable dates; the named master is free ONLY on the third one");
h.loc(9101, d => { d.dates = [D1, D2, D3]; d.timesByDate = { [D1]: { 0: ["10:00", "11:00"], 11: [], 12: ["10:00", "11:00"] }, [D2]: { 0: ["12:00"], 11: [], 12: ["12:00"] }, [D3]: { 0: ["14:00", "15:00"], 11: ["14:00", "15:00"], 12: [] } }; });
await ask(9101, "Хочу к Арману на стрижку");
log(slotsBlock()); log("…"); log(part(h.sys(), "Если клиент хочет именно к мастеру"));
log("book_times calls:", h.ALT.calls.filter(x => /book_times/.test(x)).join(" | "));

log("\n######## 2. book_times answers 404 for every date (book_services, book_staff, book_dates are fine)");
h.ALT.calls.length = 0;
h.loc(9102, d => { d.timesHook = () => J({ success: false, data: null, meta: { message: "Not found" } }, 404); });
let d = await ask(9102, "Здравствуйте, хочу записаться на стрижку завтра", "К сожалению, свободного времени сейчас нет. Оставьте, пожалуйста, имя и номер телефона — администратор перезвонит.");
log(slotsBlock()); log("reply:", d.reply); log("admin notifications:", JSON.stringify(h.calls.tg));
d = await ask(9102, "Азамат, +7 701 555 11 22", "Спасибо! Администратор перезвонит вам."); // new chat on purpose: phone in the first message
log("reply 2:", d.reply); log("admin notifications:", JSON.stringify(h.calls.tg));

log("\n######## 3. the location does not exist (everything 404)");
h.loc(9103, d => { d.missing = true; });
d = await ask(9103, "Есть время завтра?", "Сейчас не вижу расписание. Оставьте, пожалуйста, имя и телефон.");
log(slotsBlock()); log("reply:", d.reply); log("admin notifications:", JSON.stringify(h.calls.tg));

log("\n######## 4. one of two dates fails with 500");
h.loc(9104, d => { d.timesHook = (staff, date) => date === D1 ? J({ success: false, meta: { message: "Server error" } }, 500) : null; });
d = await ask(9104, "Есть время завтра в 10?");
log(slotsBlock()); log("admin notifications:", JSON.stringify(h.calls.tg));

log("\n######## 5. named master: his times fail (500) on both days, common times are fine");
h.loc(9105, d => { d.timesHook = (staff) => staff === "11" ? J({ success: false, meta: { message: "Server error" } }, 500) : null; });
d = await ask(9105, "Хочу к Арману завтра");
log(slotsBlock()); log("…"); log(part(h.sys(), "Если клиент хочет именно к мастеру")); log(part(h.sys(), "\nК. ")); log("admin notifications:", JSON.stringify(h.calls.tg));

log("\n######## 6. named master: one of his two days fails");
h.loc(9106, d => { d.timesHook = (staff, date) => staff === "11" && date === D2 ? J({ success: false, meta: { message: "Server error" } }, 500) : null; });
await ask(9106, "Хочу к Арману завтра"); log(part(h.sys(), "Если клиент хочет именно к мастеру"));

log("\n######## 7. dense day (5-minute grid): the time the client asked for is shown although the list is thinned");
h.loc(9107, d => { const t = []; for (let m = 540; m <= 1255; m += 5) t.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`); d.times = { 0: t, 11: t, 12: t }; });
await ask(9107, "Можно завтра в 17:35 или в 9 15?"); log(slotsBlock());

log("\n######## 8. no bookable dates at all");
h.loc(9108, d => { d.dates = []; });
d = await ask(9108, "Есть время?", "Свободного времени пока нет. Оставьте имя и телефон — администратор перезвонит."); log(slotsBlock()); log("reply:", d.reply);

log("\n######## 9. master with bookable:false + namesakes + staff with 2-letter name");
h.loc(9109, d => { d.staff = [{ id: 11, name: "Арман", bookable: false, specialization: "топ-барбер" }, { id: 12, name: "Ян", bookable: true }, { id: 13, name: "Айгерим", bookable: true, specialization: "стилист" }, { id: 14, name: "Айгерим", bookable: true, specialization: "барбер" }]; d.times = { 0: ["10:00"], 11: [], 12: ["10:00"], 13: ["10:00"], 14: [] }; });
await ask(9109, "Хочу к Арману"); log(part(h.sys(), "- Мастера", "\n")); log(part(h.sys(), "Если клиент хочет именно к мастеру"));
await ask(9109, "Хочу к Яну"); log("client names «Ян»:", part(h.sys(), "Если клиент хочет именно к мастеру"), "|", part(h.sys(), "\nК. "));

log("\n######## 10. cache: how many Altegio requests per message");
h.loc(9110); h.ALT.calls.length = 0;
await ask(9110, "Привет"); log("cold:", h.ALT.calls.length, h.ALT.calls.map(x => x.replace(/\?.*/, "")).join(" | "));
h.ALT.calls.length = 0; await ask(9110, "Хочу к Арману"); log("warm + named master:", h.ALT.calls.length, h.ALT.calls.join(" | "));
h.ALT.calls.length = 0; await ask(9110, "Привет ещё раз"); log("warm:", h.ALT.calls.length);

log("\n######## 11. the whole Altegio part of the prompt (for section D)");
h.loc(9111, d => { d.services.push(sv(104, "Стрижка + борода", 9000, 90)); });
await ask(9111, "Здравствуйте"); log(part(h.sys(), "Факты (других не существует)", "ПРАВИЛА (они важнее")); log(altBlock());
