import { mk, show, D1 } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4001" } });
h.gemini = ["Мужская стрижка от 6 000 ₸. Завтра свободно в 10:00 и 11:00. Записать вас?"];
let d = await h.chat("alt", "p1", "Сколько стоит стрижка и когда можно прийти к Арману?");
show("reply", d);
show("system prompt", h.sys());
show("alt calls", h.ALT.calls);
