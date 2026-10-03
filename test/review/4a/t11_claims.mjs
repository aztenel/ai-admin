// Ложные утверждения ИИ («записала», «отменила», «перенесла») БЕЗ служебной строки: что доходит до клиента.
// В расписании при этом ничего не меняется. Дошло без изменений = клиенту сказали неправду.
import { chat, mem, ALT, TG, days, env, LOG } from "./h.mjs";
import { CLAIMS } from "./corpus.mjs";
const { D1 } = days();
LOG.quiet = true;
const norm = s => String(s || "").replace(/\s+/g, " ").trim();
let n = 0, locN = 0;
const seed = (sid, kind) => {
  const profile = { phone: "+77021112233", name: "Тимур" };
  const turns = [{ role: "user", text: "Здравствуйте" }, { role: "model", text: "Здравствуйте! Чем помочь?" }];
  if (kind === "book") Object.assign(profile, { bookings: [{ name: "Тимур", date: D1, time: "10:00", services: "Мужская стрижка", staffName: "", loc: +env.ALTEGIO_LOC_ALT, record_id: 555001, record_hash: "hash555001", leadId: "seedlead1" }], leadId: "seedlead1" });
  mem.set(`h:web:alt:${sid}`, JSON.stringify({ n: 2, turns, profile }));
};
async function run(list, kind, down) {
  env.ALTEGIO_LOC_ALT = down ? String(2950 + (++locN)) : "2001";
  const rows = [];
  for (const it of list) {
    const sid = "k" + (++n);
    seed(sid, kind);
    ALT.down = !!down;
    const rec0 = ALT.records.length, del0 = ALT.deleted.length;
    const r = await chat(sid, it.u, it.a);
    ALT.down = false;
    rows.push({ it, r, passed: norm(r.reply) === norm(it.a), changed: ALT.records.length !== rec0 || ALT.deleted.length !== del0 });
  }
  return rows;
}
const show = (name, rows) => {
  const bad = rows.filter(x => x.passed);
  console.log(`\n##### ${name}: ложное утверждение дошло до клиента без изменений — ${bad.length} из ${rows.length}`);
  for (const x of rows) {
    const tgs = (x.r.tg || []).filter(t => !/Altegio не отвечает/.test(t));
    console.log(` ${x.passed ? "[ДОШЛО]  " : "[заменено]"} клиент: «${x.it.u}» | ИИ: «${x.it.a}»` + (x.passed ? "" : `\n            бот: «${x.r.reply}»`)
      + (x.r.cancel ? ` | cancel=true` : "") + (tgs.length ? ` | Telegram: ${JSON.stringify(tgs.map(t => t.split("\n")[0]))}` : (x.passed ? " | администратору — ничего" : "")) + (x.r.guard ? ` (guard=${x.r.guard})` : "") + (x.changed ? " | !!! расписание изменилось" : ""));
  }
};
const book = CLAIMS.filter(x => x.k === "book"), change = CLAIMS.filter(x => x.k !== "book");
show("«ЗАПИСАЛА» · записи в чате нет · Altegio работает", await run(book, "none"));
show("«ОТМЕНИЛА / ПЕРЕНЕСЛА» · в чате ЕСТЬ запись (завтра 10:00) · Altegio работает", await run(change, "book"));
show("«ОТМЕНИЛА / ПЕРЕНЕСЛА» · записи в чате НЕТ (клиент записывался по телефону) · Altegio работает", await run(change, "none"));
show("«ЗАПИСАЛА» · Altegio недоступен · телефон известен", await run(book, "none", true));
show("«ОТМЕНИЛА / ПЕРЕНЕСЛА» · Altegio недоступен · в чате ЕСТЬ запись", await run(change, "book", true));
