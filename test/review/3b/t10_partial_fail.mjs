// altSnapshot when only part of the Altegio calls fail.
import { mk, show, D1, D2, J } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4100" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
const windows = () => (h.sys().match(/Свободные окна для записи[^\n]*\n((?:- [^\n]*\n?)+)/) || ["", ""])[1].trim();
const master = () => (h.sys().match(/Свободное время мастера[^\n]*\n((?:- [^\n]*\n?)+)/) || ["", "(no master block)"])[0].trim();

_log("=== A. book_times for TOMORROW fails (HTTP 500), the day after is readable. Tomorrow really has 9:30, 10:00, 11:00, 13:00 free.");
h.env.ALTEGIO_LOC_ALT = "4101";
h.ALT.hook = (path) => path.startsWith(`/book_times/4101/0/${D1}`) ? J({ success: false, data: null, meta: { message: "Server error" } }, 500) : null;
h.gemini = ["К сожалению, на завтра свободного времени нет. Могу предложить послезавтра в 10:00. Подойдёт?"];
h.calls.tg.length = 0;
let d = await h.chat("alt", "pf1", "Есть время завтра?");
_log("prompt windows:\n" + windows());
_log("reply: " + d.reply + "\nTelegram notifications: " + JSON.stringify(h.calls.tg));

_log("\n=== B. named master: his times for tomorrow fail (500), the day after he has nothing free. Really he is free tomorrow 11:00, 13:00.");
h.env.ALTEGIO_LOC_ALT = "4102";
const D = h.dataFor("4102"); D.timesByDate = { [D2]: { 0: ["09:30"], 11: [], 12: ["09:30"] } };
h.ALT.hook = (path) => path.startsWith(`/book_times/4102/11/${D1}`) ? J({ success: false, data: null, meta: { message: "Server error" } }, 500) : null;
h.gemini = ["У Армана в ближайшие дни свободного времени нет. Могу записать к Ерлану. Подойдёт?"];
h.calls.tg.length = 0;
d = await h.chat("alt", "pf2", "Хочу к Арману завтра");
_log("prompt master block:\n" + master());
_log("reply: " + d.reply + "\nTelegram notifications: " + JSON.stringify(h.calls.tg));

_log("\n=== C. 429 on the first try of every book_times call, OK on retry (should work, +0.7 s)");
h.env.ALTEGIO_LOC_ALT = "4103"; const seen = new Set();
h.ALT.hook = (path) => { if (path.startsWith("/book_times/4103/") && !seen.has(path)) { seen.add(path); return J({ success: false, meta: { message: "Too Many Requests" } }, 429); } return null; };
h.gemini = ["Завтра свободно в 10:00. Записать?"];
let t0 = Date.now(); d = await h.chat("alt", "pf3", "Есть время завтра?");
_log(`prompt windows:\n${windows()}\n(took ${Date.now() - t0} ms)`);

_log("\n=== D. services readable, staff call fails (401)");
h.env.ALTEGIO_LOC_ALT = "4104";
h.ALT.hook = (path) => path.startsWith("/book_staff/4104") ? J({ success: false, data: null, meta: { message: "Authentication needed." } }, 401) : null;
h.gemini = ["Сейчас не вижу расписание. Оставьте имя и телефон."]; h.calls.tg.length = 0;
d = await h.chat("alt", "pf4", "Есть время завтра?");
_log("prompt has schedule rules: " + h.sys().includes("Запись в расписание") + " | windows: " + windows() + "\nTelegram: " + JSON.stringify(h.calls.tg));
