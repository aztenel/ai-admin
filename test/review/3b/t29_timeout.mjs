// altCall timeout: Altegio never answers (black hole). Expect ~8 s, then «Altegio не отвечает» mode.
import { mk, show, D1, D2, J } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4290" } });
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini)/.test(String(a[0]))) _log(...a); };
const blackhole = (p, m, init) => new Promise((_, rej) => { init.signal.addEventListener("abort", () => rej(new Error("aborted"))); });
h.ALT.hook = blackhole;
h.gemini = ["Сейчас не вижу расписание. Оставьте, пожалуйста, имя и телефон — администратор перезвонит."];
let t0 = Date.now(); let d = await h.chat("alt", "to1", "Есть время завтра?");
_log(`1) all Altegio calls hang → ${Date.now() - t0} ms | reply: ${d.reply} | TG: ${JSON.stringify(h.calls.tg.map(x => x.split("\n").slice(0, 2).join(" / ")))}`);
// only book_times of one day hangs
h.env.ALTEGIO_LOC_ALT = "4291"; h.ALT.hook = (p, m, init) => p.startsWith(`/book_times/4291/0/${D1}`) ? blackhole(p, m, init) : null;
h.gemini = ["Завтра свободного времени нет, могу предложить послезавтра в 10:00."]; t0 = Date.now(); d = await h.chat("alt", "to2", "Есть время завтра?");
_log(`2) only tomorrow's book_times hangs → ${Date.now() - t0} ms | windows: ${(h.sys().match(/Свободные окна для записи[^\n]*\n((?:- [^\n]*\n?)+)/) || ["", ""])[1].trim()}`);
// book_record hangs (record may or may not exist in Altegio)
h.env.ALTEGIO_LOC_ALT = "4292"; h.calls.tg.length = 0;
h.ALT.hook = (p, m, init) => { if (p.startsWith("/book_record/")) { h.ALT.records.push(JSON.parse(init.body)); return blackhole(p, m, init); } return null; };
h.gemini = ["Записала.\n" + h.tag("Тимур", "Мужская стрижка", "любой", D1, "10:00")]; t0 = Date.now();
d = await h.chat("alt", "to3", "Тимур, +7 702 800 22 33, мужская стрижка завтра в 10:00");
_log(`3) book_record: Altegio got the request and created the record, the answer never came → ${Date.now() - t0} ms\n   reply: ${d.reply}\n   lead note: ${d.lead && d.lead.note}\n   TG: ${JSON.stringify(h.calls.tg)}\n   records that reached Altegio: ${h.ALT.records.length}`);
process.exit(0);
