// Языки: тексты, которые бот даёт сам (altSay), на русском, казахском и английском. Нет ли undefined / null / пустых мест.
import { chat, showState, tag, title, check, summary, ALT, TG, days, prof, leads, env } from "./harness.mjs";
const { D1, D2 } = days();
const BAD = /undefined|null|\[object|NaN|: \.|, \.|\(\)|:\s*$/;
const seen = [];
let loc = 4200, n = 0;
const next = () => { env.ALTEGIO_LOC_ALT = String(++loc); ALT.records.length = 0; ALT.deleted.length = 0; n++; return "g" + n; };
const U = {
  ru: { book: "Тимур, +7 702 300 00 NN, мужская стрижка завтра в 10:00", more: "ещё запишите сына Алихана на 11:00", cancel: "Отмените запись", move: "Перенесите на 13:00", ask: "я записан?" },
  kk: { book: "Сәлеметсіз бе, атым Тимур, +7 702 300 00 NN, ертең сағат 10:00-ге шаш қиюға жазыңызшы", more: "ұлым Алиханды да сағат 11:00-ге жазыңызшы", cancel: "Жазбамды болдырмаңызшы", move: "Жазбамды сағат 13:00-ге ауыстырыңызшы", ask: "мен жазылдым ба, әлде қалай?" },
  en: { book: "Hello, I am Timur, +7 702 300 00 NN, a haircut tomorrow at 10:00 please", more: "please also book Alikhan, my son, at 11:00", cancel: "Please cancel the booking", move: "Please move the booking to 13:00", ask: "do I have a booking?" }
};
for (const lang of ["ru", "kk", "en"]) {
  const u = U[lang], rec = (what, r) => { seen.push([lang, what, r.reply]); return r; };
  const book = (sid, i) => chat(sid, u.book.replace("NN", String(10 + n * 3 + i)), "Записала.\n" + tag("Тимур", "10:00"), { quiet: true });
  let sid = next();
  rec("booked", await book(sid, 0));
  rec("have (повтор той же заявки)", await chat(sid, u.ask, "Записала.\n" + tag("Тимур", "10:00"), { quiet: true }));
  rec("yours (ИИ: «вы записаны» без строки)", await chat(sid, u.ask, lang === "en" ? "You are booked." : lang === "kk" ? "Сіз жазылдыңыз." : "Вы записаны.", { quiet: true }));
  rec("noop (ИИ: «отменила» без строки)", await chat(sid, u.cancel, lang === "en" ? "I've cancelled your booking." : lang === "kk" ? "Жазбаңызды болдырмадым." : "Отменила вашу запись.", { quiet: true }));
  rec("booked + also", await chat(sid, u.more, "Записала.\n" + tag("Алихан", "11:00", { service: "Детская стрижка" }), { quiet: true }));
  rec("which", await chat(sid, u.cancel, "Отменяю.\n[ОТМЕНА]", { quiet: true }));
  rec("cancelOk", await chat(sid, u.cancel, "Отменяю.\n[ОТМЕНА] Имя: Алихан", { quiet: true }));
  rec("moved", await chat(sid, u.move, "Переношу.\n[ОТМЕНА]\n" + tag("Тимур", "13:00"), { quiet: true }));
  ALT.delFail = 500;
  rec("movedAdmin (DELETE 500)", await chat(sid, u.move, "Переношу.\n[ОТМЕНА]\n" + tag("Тимур", "11:00"), { quiet: true }));
  rec("cancelAdmin (DELETE 500)", await chat(sid, u.cancel, "Отменяю.\n[ОТМЕНА]", { quiet: true }));
  ALT.delFail = 0;
  rec("cancelAdmin (нет записи в чате)", await chat(sid, u.cancel, "Отменяю.\n[ОТМЕНА]", { quiet: true }));
  rec("booked + oldAdmin (перенос, прежней записи нет в чате)", await chat(sid, u.move, "Переношу.\n[ОТМЕНА]\n" + tag("Тимур", "09:30", { date: D2 }), { quiet: true }));

  sid = next();
  rec("confirm (ИИ: «записала» без строки)", await chat(sid, u.book.replace("NN", "77"), lang === "en" ? "You are booked for tomorrow." : lang === "kk" ? "Сізді жаздым." : "Записала вас на завтра.", { quiet: true }));
  rec("service", await chat(sid, u.book.replace("NN", "77"), "Записала.\n" + tag("Тимур", "10:00", { service: "Маникюр" }), { quiet: true }));
  rec("staff", await chat(sid, u.book.replace("NN", "77"), "Записала.\n" + tag("Тимур", "10:00", { staff: "Светлана" }), { quiet: true }));
  rec("date", await chat(sid, u.book.replace("NN", "77"), "Записала.\n" + tag("Тимур", "10:00", { date: "2026-11-20" }), { quiet: true }));
  rec("taken (есть другое время)", await chat(sid, u.book.replace("NN", "77"), "Записала.\n" + tag("Тимур", "12:00"), { quiet: true }));
  ALT.times = { 0: ["10:00"], 11: [], 12: [] };
  { const s2 = next(); rec("taken (другого времени нет, мастер назван)", await chat(s2, u.book.replace("NN", "78"), "Записала.\n" + tag("Тимур", "10:00", { staff: "Арман" }), { quiet: true })); }
  ALT.times = null;
  sid = next();
  ALT.needCode = true;
  rec("admin (Altegio требует код из SMS)", await chat(sid, u.book.replace("NN", "79"), "Записала.\n" + tag("Тимур", "10:00"), { quiet: true }));
  rec("pending (повтор)", await chat(sid, u.ask, "Записала.\n" + tag("Тимур", "10:00"), { quiet: true }));
  rec("pending (ИИ: «записала» без строки)", await chat(sid, u.ask, lang === "en" ? "You are booked." : lang === "kk" ? "Сізді жаздым." : "Записала вас.", { quiet: true }));
  ALT.needCode = false;
  sid = next();
  await chat(sid, u.book.replace("NN", "80"), "Записала.\n" + tag("Тимур", "10:00"), { quiet: true });
  ALT.taken = true;
  rec("taken + keepOld (перенос на занятое)", await chat(sid, u.move, "Переношу.\n[ОТМЕНА]\n" + tag("Тимур", "11:00"), { quiet: true }));
  ALT.taken = false; ALT.postFail = 500;
  rec("admin + keepOld (перенос, Altegio 500)", await chat(sid, u.move, "Переношу.\n[ОТМЕНА]\n" + tag("Тимур", "13:00"), { quiet: true }));
  ALT.postFail = 0;
  sid = next();
  rec("нет имени", await chat(sid, u.book.replace("NN", "81"), "Записала.\n" + tag("тест", "10:00"), { quiet: true }));
  sid = next();
  rec("нет телефона", await chat(sid, lang === "en" ? "I am Timur, haircut tomorrow at 10:00 please" : lang === "kk" ? "Атым Тимур, ертең сағат 10:00-ге шаш қиюға жазыңызшы" : "Тимур, мужская стрижка завтра в 10:00", "Записала.\n" + tag("Тимур", "10:00"), { quiet: true }));
}
const cyr = s => (s.match(/[а-яё]/gi) || []).length, lat = s => (s.match(/[a-z]/gi) || []).length;
for (const lang of ["ru", "kk", "en"]) {
  title("язык клиента: " + lang);
  for (const [l, what, reply] of seen.filter(x => x[0] === lang)) {
    const flags = [];
    if (BAD.test(reply)) flags.push("ПУСТОЕ МЕСТО/undefined");
    if (lang === "en" && cyr(reply) > lat(reply)) flags.push("ответ не на английском");
    if (lang === "kk" && !/[әғқңөұүһі]/i.test(reply)) flags.push("ответ не на казахском");
    console.log(`   ${flags.length ? "[!] " + flags.join("; ") + " " : "    "}${what}: ${reply}`);
  }
}
const bad = seen.filter(x => BAD.test(x[2]));
console.log("\nответов с undefined/null/пустым местом:", bad.length);
