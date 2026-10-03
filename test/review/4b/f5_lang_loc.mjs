// F. detectLang drives the language of code-generated booking answers; ALTEGIO_LOC typo.
import { mk, D1 } from "./lib.mjs";
const h = await mk(); const log = h.quiet();
h.loc(9971);
const tag = h.tag("Азамат", "Мужская стрижка", "любой", D1, "11:00");
let n = 0;
for (const text of ["Azamat +7 701 997 10 01", "Azamat, 87019971002, zapishi na zavtra v 11", "ok, Kaspi Gold. Азамат 87019971003", "men Azamat, 87019971004, erteng 11-ge jazylamyn", "Азамат, 87019971005"]) {
  h.loc(9971 + (++n)); h.gemini = ["Хочу стрижку завтра в 11", "Записала вас.\n" + tag];
  h.gemini = ["Записала вас.\n" + tag];
  const d = await h.chat("alt", "lg" + n, text);
  log(`client: ${text}\n   reply: ${d.reply}\n   language instruction to the LLM: ${(h.sys().match(/ЯЗЫК:[^\n]*/) || ["(none — Russian)"])[0]}`);
}
log("\n--- ALTEGIO_LOC_BARBER with a typo («56O» with the letter O)");
h.env.ALTEGIO_LOC_BARBER = "56O"; h.ALT.calls.length = 0;
h.gemini = ["Здравствуйте!"]; await h.chat("barber", "typo1", "Есть время завтра?");
log("Altegio calls:", h.ALT.calls.length, "| prompt has the Altegio block:", /Запись в расписание \(важнее/.test(h.sys()), "| windows offered to the LLM:", (h.sys().match(/Свободные окна для записи \(других нет\):\n(- [^\n]*)/) || [, "-"])[1]);
const page = await (await h.call("/altegio?key=lk&c=barber")).text();
log("/altegio?c=barber:", (page.match(/<pre>([\s\S]*?)<\/pre>/) || [, ""])[1].split("\n").slice(0, 2).join(" | "));
process.exit(0);
