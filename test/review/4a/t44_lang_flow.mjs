// Полный путь на английском и казахском: запись, занято, перенос, отмена, заявка администратору — тексты без мусора.
import { chat, tag, title, check, summary, ALT, days, env, LOG } from "./h.mjs";
const { D1, D2 } = days();
const bad = s => /undefined|null|NaN|\[object|: \.|, \.|\(\)|  /.test(s);
let loc = 4800;
for (const [lang, msgs] of [["en", ["I'm Timur, +7 702 111 22 33, a men's haircut tomorrow at 10:00 please", "Please move my booking to 13:00 tomorrow", "Please move my booking to 11:00 tomorrow", "Please cancel my booking, thanks", "Book me again tomorrow at 15:00 please", "Which bookings do I have now, please?"]],
  ["kk", ["Мен Тимурмын, +7 702 111 22 44, ертең сағат 10:00-ге шаш қиюға жазыңызшы", "Жазбамды ертең сағат 13:00-ге ауыстырыңызшы", "Жазбамды ертең сағат 11:00-ге ауыстырыңызшы", "Жазбамды болдырмаңызшы, рақмет", "Ертең сағат 15:00-ге қайта жазыңызшы", "Қазір менде қандай жазбалар бар?"]]]) {
  title(lang); env.ALTEGIO_LOC_ALT = String(++loc); const sid = "lg" + lang; let r;
  r = await chat(sid, msgs[0], "ok\n" + tag("Timur", "10:00")); check("запись", !bad(r.reply), r.reply);
  r = await chat(sid, msgs[1], "ok\n[ОТМЕНА]\n" + tag("Timur", "13:00")); check("перенос", !bad(r.reply), r.reply);
  ALT.taken = true; r = await chat(sid, msgs[2], "ok\n[ОТМЕНА]\n" + tag("Timur", "11:00")); ALT.taken = false; check("перенос: занято", !bad(r.reply), r.reply);
  r = await chat(sid, msgs[3], "ok\n[ОТМЕНА]"); check("отмена", !bad(r.reply), r.reply);
  ALT.needCode = true; r = await chat(sid, msgs[4], "ok\n" + tag("Timur", "15:00")); ALT.needCode = false; check("заявка администратору", !bad(r.reply), r.reply);
  r = await chat(sid, msgs[5], lang === "en" ? "You're booked for tomorrow." : "Сіз ертеңге жазылдыңыз."); check("ложное «записаны» при заявке у администратора", !bad(r.reply), r.reply);
}
summary();
