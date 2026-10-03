// Список заявок leads:<клиент> — один ключ KV на всю компанию. Два РАЗНЫХ чата сохраняют заявки почти одновременно.
// KV отвечает не мгновенно: чтение 20 мс, запись 60 мс (в жизни 10–200 мс).
import { chat, tag, title, check, summary, ALT, TG, G, days, leads, env, mem, KVFAIL, LOG } from "./h.mjs";
LOG.quiet = true;
env.ALTEGIO_LOC_ALT = "4501";
const slots = ["9:30", "10:00", "11:00", "13:00", "15:00", "16:00"];
KVFAIL.delayGet = 20; KVFAIL.delayPut = 60;
G.fn = b => { const t = b.contents.at(-1).parts[0].text; const m = t.match(/Клиент(\d+)/); return "Записала.\n" + tag("Клиент" + m[1], slots[+m[1] % 6], { date: +m[1] < 6 ? days().D1 : days().D2 }).replace("Имя: Клиент", "Имя: Гость"); };

title("8 чатов разных клиентов записываются в одну и ту же секунду (старты с шагом 15 мс)");
const ps = [];
for (let i = 0; i < 8; i++) { ps.push(chat("lr" + i, `Клиент${i}, +7 702 555 00 0${i}, стрижка`, undefined)); await new Promise(s => setTimeout(s, 15)); }
const rs = await Promise.all(ps);
KVFAIL.delayGet = 0; KVFAIL.delayPut = 0;
const made = ALT.records.length, onList = leads().length;
console.log(`   в Altegio создано записей: ${made}; на /leads заявок: ${onList}; уведомлений в Telegram «Новая запись»: ${TG.filter(t => /Новая запись/.test(t)).length}`);
check("все созданные записи есть на /leads", onList === made, `потеряно на /leads: ${made - onList}`);
summary();
