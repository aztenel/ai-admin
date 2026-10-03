// production today has no ALTEGIO_PARTNER secret: what does the hidden client /?c=alt do after the merge?
import { mk } from "./lib.mjs";
const h = await mk(); const log = h.quiet();
delete h.env.ALTEGIO_PARTNER; delete h.env.ALTEGIO_LOC_ALT;
h.gemini = ["Сейчас не вижу расписание. Оставьте, пожалуйста, имя и телефон — администратор перезвонит."];
const d = await h.chat("alt", "np1", "Есть время завтра?");
log("reply:", d.reply, "\nTelegram:", JSON.stringify(h.calls.tg), "\nAltegio calls:", h.ALT.calls.length);
const p = await (await h.call("/altegio?key=lk")).text();
log("/altegio:", (p.match(/<pre>([\s\S]*?)<\/pre>/) || [, ""])[1].replace(/\n/g, " | "));
process.exit(0);
