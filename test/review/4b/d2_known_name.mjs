// D. After a callback request the placeholder «имя не указано» becomes the client's name in the profile and in the prompt line «Уже известно о клиенте».
import { mk, D1 } from "./lib.mjs";
const h = await mk(); const log = h.quiet();
const D = h.loc(9901, d => { d.dates = []; });
h.gemini = ["Свободного времени пока нет. Администратор перезвонит вам."];
let d = await h.chat("alt", "kn", "+7 701 990 10 01, хочу на стрижку");
log("1) reply:", d.reply, "| lead name:", d.lead && d.lead.name);
log("   profile.name in KV:", JSON.parse(h.mem.get("h:web:alt:kn")).profile.name);
// next day the schedule has free time again (new location number = fresh cache, same chat)
D.dates = [D1]; h.env.ALTEGIO_LOC_ALT = "9901"; (await import("./worker.x.mjs")); // cache of the real worker is separate; wait for TTL instead:
const realNow = Date.now; Date.now = () => realNow() + 11 * 60e3; // 11 minutes later: base and dates caches expired
h.gemini = ["Записала вас.\n" + h.tag("имя не указано", "Мужская стрижка", "любой", D1, "11:00")];
d = await h.chat("alt", "kn", "Запишите на мужскую стрижку завтра в 11:00");
log("2) prompt:", (h.sys().match(/Уже известно о клиенте:[^\n]*/) || [""])[0]);
log("   reply:", d.reply, "| record sent to Altegio:", JSON.stringify(h.ALT.records.map(r => ({ fullname: r.fullname, phone: r.phone }))));
process.exit(0);
