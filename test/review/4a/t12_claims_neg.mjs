// Дыры в altFlat / ALT_NEG: слово «не …» или условное слово перед утверждением «съедает» само утверждение.
import { chat, mem, ALT, TG, days, env, LOG, internals } from "./h.mjs";
const X = await internals();
const { D1 } = days();
LOG.quiet = true;
const norm = s => String(s || "").replace(/\s+/g, " ").trim();
const seed = (sid, book) => {
  const profile = { phone: "+77021112233", name: "Тимур" };
  if (book) Object.assign(profile, { bookings: [{ name: "Тимур", date: D1, time: "10:00", services: "Мужская стрижка", staffName: "", loc: 2001, record_id: 555001, record_hash: "hash555001", leadId: "seedlead1" }], leadId: "seedlead1" });
  mem.set(`h:web:alt:${sid}`, JSON.stringify({ n: 2, turns: [{ role: "user", text: "Здравствуйте" }, { role: "model", text: "Здравствуйте! Чем помочь?" }], profile }));
};
const CASES = [
  // [есть запись в чате?, клиент, ИИ]
  [false, "Тимур, завтра в 10:00", "Не переживайте, записала вас на завтра в 10:00."],
  [false, "Тимур, завтра в 10:00", "Не волнуйтесь, записала вас на завтра в 10:00!"],
  [false, "Тимур, завтра в 10:00", "Не проблема, забронировала вам 10:00 на завтра."],
  [true, "Отмените мою запись", "Не переживайте, отменила вашу запись."],
  [true, "Отмените мою запись", "Не беспокойтесь, отменила."],
  [true, "Перенесите мою запись на 13:00", "Не вопрос, перенесла на 13:00."],
  [false, "Тимур, завтра в 10:00", "Чтобы вам было удобно, я уже всё сделала и записала вас на 10:00."],
  [false, "Тимур, завтра в 10:00", "Когда вы написали я сразу записала вас на 10:00."],
  [false, "Timur, tomorrow at 10:00", "Not a problem, booked you for 10:00 tomorrow."],
  [false, "Timur, tomorrow at 10:00", "Tomorrow afternoon you're booked at 15:00."],
  [true, "Cancel my booking please", "Not to worry, cancelled it for you."],
];
let n = 0, passed = 0;
for (const [book, u, a] of CASES) {
  const sid = "q" + (++n); seed(sid, book);
  const r = await chat(sid, u, a);
  const same = norm(r.reply) === norm(a); if (same) passed++;
  console.log(` ${same ? "[ДОШЛО]   " : "[заменено]"} ${book ? "(запись в чате есть) " : "(записи нет) "}клиент: «${u}» | ИИ: «${a}»${same ? "" : "\n            бот: «" + r.reply + "»"}  | altFlat → «${X.altFlat(a).trim()}»`);
}
console.log(`\nложных утверждений дошло до клиента: ${passed} из ${CASES.length}; в Altegio за это время создано ${ALT.records.length}, удалено ${ALT.deleted.length}`);
