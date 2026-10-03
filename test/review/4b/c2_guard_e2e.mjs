// C. end-to-end: what the client gets when a truthful working-hours answer is rejected (client «barber» with ALTEGIO_LOC_BARBER, hours 10:00–22:00).
// The stubbed LLM gives the same answer on the retry, as a model that is asked "when do you open" naturally would.
import { mk, D1, D2 } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_BARBER: "9950" } }); const log = h.quiet();
h.dataFor("9950").times = { 0: ["11:00", "13:00", "15:30"], 11: ["11:00", "13:00"], 12: ["15:30"] };
let n = 0;
const ask = async (c, user, llm) => { h.gemini = [llm, llm]; const d = await h.chat(c, "g" + (++n), user); log(`[${c}${c === "barber" ? " + Altegio" : ""}] client: ${user}\n   LLM  : ${llm}\n   reply: ${d.reply}   (guard: ${d.guard})\n`); };
await ask("barber", "Во сколько вы открываетесь?", "Мы открываемся в 10:00.");
await ask("barber", "До скольки вы работаете?", "Ежедневно до 22:00.");
await ask("barber", "Вы сейчас открыты?", "Сейчас мы закрыты, откроемся завтра в 10:00.");
await ask("barber", "Нешеге дейін жұмыс істейсіздер?", "Сағат 22:00-ге дейін жұмыс істейміз.");
await ask("barber", "Есть время завтра?", "Мастер работает завтра, есть время в 10:00 и в 11:00.");   // 10:00 is NOT free — passes
await ask("barber", "Есть время завтра?", "Свободно в 11:00, либо подходите к 12:30.");              // 12:30 is NOT free — passes
delete h.env.ALTEGIO_LOC_BARBER;
await ask("barber", "Во сколько вы открываетесь?", "Мы открываемся в 10:00.");                        // same client without Altegio (as in v7.3)
process.exit(0);
