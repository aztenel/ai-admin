// After a booking the slot disappears from Altegio's free list. The guard then rejects any LLM reply that
// mentions the client's OWN booking time (unless the client typed that time himself).
import { mk, show, D1 } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4002" } });
const D = h.dataFor("4002");
D.consume = true;                      // a booked slot is no longer free (only one master was free at 09:30)
D.times = { 0: ["09:30", "10:00", "11:00"], 11: ["10:00", "11:00"], 12: ["09:30"] };
const _log = console.log; const logs = []; console.log = (...a) => { if (/^(guard|altegio|gemini)/.test(String(a[0]))) logs.push(a.join(" ")); else _log(...a); };

h.gemini = ["Ближайшее время — завтра в 9:30. Подойдёт? Как вас зовут и ваш номер телефона?"];
let d = await h.chat("alt", "o1", "Здравствуйте, нужна мужская стрижка на ближайшее время");
show("1 bot", d.reply);
h.gemini = [`Записала вас: мужская стрижка, завтра в 9:30.\n` + h.tag("Азамат", "Мужская стрижка", "любой", D1, "09:30")];
d = await h.chat("alt", "o1", "Да, подходит. Азамат, +7 777 123 45 67");
show("2 bot (booking)", { reply: d.reply, lead: !!d.lead, records: h.ALT.records.length });

// (a) client asks an unrelated question; the LLM politely repeats the booking time
h.gemini = ["Наш адрес: Астана, ул. Примерная, 40. Ждём вас завтра в 9:30!"];
d = await h.chat("alt", "o1", "Спасибо! А какой у вас адрес?");
show("3 bot (address question)", { reply: d.reply, guard: d.guard, offer: d.offer });

// (b) client asks about his own booking
h.gemini = ["Вы записаны на мужскую стрижку завтра, в воскресенье, в 9:30."];
d = await h.chat("alt", "o1", "Напомните, на сколько я записан?");
show("4 bot (when am I booked?)", { reply: d.reply, guard: d.guard, offer: d.offer });
show("prompt 'known' line", (h.sys().match(/Уже известно о клиенте:[^\n]*/) || [""])[0]);
show("worker logs", logs);

// (c) the client believes the canned answer and picks one of the offered times → second real record
h.gemini = [`Записала вас: мужская стрижка, завтра в 10:00.\n` + h.tag("Азамат", "Мужская стрижка", "любой", D1, "10:00")];
d = await h.chat("alt", "o1", "Странно. Тогда давайте в 10:00");
show("5 bot (client picks the offered time)", { reply: d.reply, recordsInAltegio: h.ALT.records.map(r => r.fullname + " " + r.appointments[0].datetime.slice(11, 16)) });

// control: the same question when the client typed the time himself → passes
const h2sid = "o2"; D.times = { 0: ["09:30", "10:00", "11:00"], 11: ["10:00", "11:00"], 12: ["09:30"] };
h.gemini = [`Записала вас.\n` + h.tag("Данияр", "Мужская стрижка", "любой", D1, "11:00")];
d = await h.chat("alt", h2sid, "Данияр, +7 777 123 45 00, мужская стрижка завтра в 11:00");
h.gemini = ["Вы записаны на мужскую стрижку завтра, в воскресенье, в 11:00."];
d = await h.chat("alt", h2sid, "Напомните, на сколько я записан?");
show("control (client typed 11:00 himself)", { reply: d.reply, guard: d.guard });
