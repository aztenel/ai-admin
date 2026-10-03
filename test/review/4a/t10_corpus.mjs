// Ложные срабатывания фильтра утверждений (ALT_CLAIM / ALT_CHANGE / altFlat) на обычных ответах ИИ — через настоящий /api/chat.
// Состояния чата: «нет записи», «есть запись» (Тимур, завтра 10:00), «заявка у администратора (pend)», «Altegio недоступен».
import { chat, mem, ALT, TG, days, env, LOG, G, altReset } from "./h.mjs";
import { CORPUS, BORDER } from "./corpus.mjs";
const { D1 } = days();
LOG.quiet = true;
const norm = s => String(s || "").replace(/\s+/g, " ").trim();
let n = 0, locN = 0;
const seed = (sid, kind) => {
  const profile = { phone: "+77021112233", name: "Тимур" };
  const turns = [{ role: "user", text: "Здравствуйте" }, { role: "model", text: "Здравствуйте! Чем помочь?" }];
  if (kind === "book") Object.assign(profile, { bookings: [{ name: "Тимур", date: D1, time: "10:00", services: "Мужская стрижка", staffName: "", loc: 2001, record_id: 555001, record_hash: "hash555001", leadId: "seedlead1" }], leadId: "seedlead1" });
  if (kind === "pend") Object.assign(profile, { pend: [{ key: `${D1}|11:00|тимур`, name: "Тимур", maybe: false, service: "Мужская стрижка", date: D1, time: "11:00", raw: "", leadId: "seedlead2" }], adminLeads: 1, leadId: "seedlead2" });
  if (kind !== "none") mem.set(`h:web:alt:${sid}`, JSON.stringify({ n: 2, turns, profile }));
};
async function run(list, kind, down) {
  const rows = [];
  env.ALTEGIO_LOC_ALT = down ? String(2900 + (++locN)) : "2001"; // новая локация — в памяти воркера для неё нет кэша расписания
  for (const it of list) {
    const sid = "c" + (++n);
    seed(sid, kind);
    ALT.down = !!down;
    const r = await chat(sid, it.u, it.a);
    ALT.down = false;
    rows.push({ it, r, replaced: norm(r.reply) !== norm(it.a) });
  }
  return rows;
}
const show = (name, rows) => {
  const bad = rows.filter(x => x.replaced), guard = rows.filter(x => x.r.guard);
  console.log(`\n##### ${name}: заменено ${bad.length} из ${rows.length}` + (guard.length ? ` (сработала защита checkReply: ${guard.length} — см. ниже, это не фильтр утверждений)` : ""));
  for (const x of bad) {
    const tgs = (x.r.tg || []).filter(t => !/Altegio не отвечает/.test(t));
    console.log(` [${x.it.g}] клиент: «${x.it.u}»\n      ИИ:  «${x.it.a}»\n      бот: «${x.r.reply}»` + (x.r.cancel ? `\n      !!! cancel=true cancelDone=${x.r.cancelDone}` : "") + (x.r.lead ? `\n      !!! lead: ${x.r.lead.service} / ${x.r.lead.time}` : "")
      + (tgs.length ? `\n      !!! Telegram администратору: ${JSON.stringify(tgs.map(t => t.split("\n")[0]))}` : "") + (x.r.guard ? `\n      (guard=${x.r.guard})` : ""));
  }
  return bad;
};
const res = {};
res.none = show("ОБЫЧНЫЕ ответы · в чате нет записи", await run(CORPUS, "none"));
res.book = show("ОБЫЧНЫЕ ответы · в чате есть запись (завтра 10:00)", await run(CORPUS, "book"));
res.pend = show("ОБЫЧНЫЕ ответы · у клиента заявка у администратора (pend)", await run(CORPUS, "pend"));
res.downNone = show("ОБЫЧНЫЕ ответы · Altegio недоступен, записи нет, телефон известен", await run(CORPUS, "phone", true));
res.downBook = show("ОБЫЧНЫЕ ответы · Altegio недоступен, запись есть", await run(CORPUS, "book", true));
const b1 = show("СПОРНЫЕ («в процессе») · нет записи", await run(BORDER, "none"));
const b2 = show("СПОРНЫЕ («в процессе») · есть запись", await run(BORDER, "book"));

console.log(`\n===== ИТОГ: обычных ответов в корпусе ${CORPUS.length}`);
for (const [k, v] of Object.entries(res)) console.log(`  ${k}: заменено ${v.length}; из них с cancel=true или уведомлением администратору: ${v.filter(x => x.r.cancel || (x.r.tg || []).some(t => !/Altegio не отвечает/.test(t))).length}`);
const any = new Set(Object.values(res).flatMap(v => v.map(x => x.it.a)));
console.log(`  ответов, заменённых хотя бы в одном состоянии: ${any.size} из ${CORPUS.length}`);
