// Вне основной зоны проверки (входной слой), но влияет на запись: язык, «позовите человека», скрытие цифр.
import { chat, tag, title, check, summary, ALT, TG, env, G, prof } from "./harness.mjs";
env.ALTEGIO_LOC_ALT = "4801";

title("1. английское «men's haircut» распознаётся как казахский (слово men в списке detectLang, worker.js:357)");
let d = await chat("i1", "Hi! Timur, +7 702 800 00 01, a men's haircut tomorrow at 10:00 please", "You're booked.\n" + tag("Timur", "10:00"));
console.log("   пометка языка в подсказке ИИ:", JSON.stringify((G.calls.at(-1).systemInstruction.parts[0].text.match(/ЯЗЫК:[^\n]*/) || ["(нет — русский)"])[0]));
check("клиенту, который пишет по-английски, ответ на английском", /You're booked/.test(d.reply), d.reply);
d = await chat("i1b", "Hi! Timur, +7 702 800 00 02, a haircut tomorrow at 11:00 please", "You're booked.\n" + tag("Timur", "11:00"), { quiet: true });
console.log("   контроль без слова men:", d.reply);

title("2. «Можно записать человека…» / «Нужно двух человек записать» → срабатывает «позовите администратора», бот замолкает на 2 часа");
for (const t of ["Можно записать человека на стрижку завтра в 10:00?", "Нужно двух человек записать на завтра", "Хочу записать человека на 11:00"]) {
  const sid = "i2" + t.length; TG.length = 0;
  d = await chat(sid, t, "Да, конечно. Как зовут?", { quiet: true });
  console.log(`   «${t}» → ${d.handoff ? "ПЕРЕДАЧА АДМИНИСТРАТОРУ, бот на паузе: " + d.reply : "бот отвечает сам: " + d.reply}`);
}

title("3. телефон и время через пробел: цифры склеиваются и скрываются как «ИИН/карта»");
d = await chat("i3", "Тимур +7 702 800 00 03 10:00 завтра мужская стрижка", "Оставьте, пожалуйста, номер телефона.", { quiet: true });
console.log("   ИИ увидел: «" + G.calls.at(-1).contents.at(-1).parts[0].text + "» | телефон в профиле:", JSON.stringify(prof("i3").phone));
summary();
