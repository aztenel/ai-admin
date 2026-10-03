// Tag line with a "[" inside (the LLM copies the phone placeholder «[телефон указан]» literally) — client with Altegio and client without.
import { mk, D1 } from "./lib.mjs";
const h = await mk(); const log = h.quiet();
h.loc(9601);
const altTag = `[ЗАЯВКА] Имя: Азамат; Телефон: [телефон указан]; Услуга: Мужская стрижка; Мастер: любой; Дата: ${D1}; Время: 11:00`;
log("=== client WITH Altegio (alt)");
for (let i = 1; i <= 3; i++) {
  h.gemini = ["Записала вас: мужская стрижка, завтра в 11:00.\n" + altTag];
  const d = await h.chat("alt", "br1", i === 1 ? "Азамат, +7 701 600 10 01, мужская стрижка завтра в 11:00, мастер любой" : "Мужская стрижка");
  log(`  turn ${i}: reply: ${d.reply} | lead: ${!!d.lead} | records in Altegio: ${h.ALT.records.length}`);
}
log("  what the LLM receives as the client's message:", JSON.stringify(h.calls.gemini.at(-1).contents[0].parts[0].text));
log("\n=== client WITHOUT Altegio (dent)");
h.gemini = ["Забронировала вас на завтра в 10:00. Администратор подтвердит запись.\n[ЗАЯВКА] Имя: Азамат; Телефон: [телефон указан]; Услуга: чистка; Время: завтра, 10:00"];
h.calls.tg.length = 0;
const d = await h.chat("dent", "br2", "Азамат, +7 701 600 10 02, чистка завтра в 10:00");
log(`  reply: ${d.reply}\n  lead: ${JSON.stringify(d.lead)} | leads in KV: ${h.leads("dent").length} | admin notified: ${JSON.stringify(h.calls.tg)}`);
process.exit(0);
