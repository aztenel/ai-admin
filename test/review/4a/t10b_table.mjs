// Сводная таблица по корпусу: какой обычный ответ чем заменён в каждом состоянии (Altegio работает).
import { chat, mem, ALT, TG, days, env, LOG } from "./h.mjs";
import { CORPUS, BORDER } from "./corpus.mjs";
const { D1 } = days();
LOG.quiet = true;
const norm = s => String(s || "").replace(/\s+/g, " ").trim();
let n = 0;
const seed = (sid, kind) => {
  const profile = { phone: "+77021112233", name: "Тимур" };
  if (kind === "book") Object.assign(profile, { bookings: [{ name: "Тимур", date: D1, time: "10:00", services: "Мужская стрижка", staffName: "", loc: 2001, record_id: 555001, record_hash: "hash555001", leadId: "seedlead1" }], leadId: "seedlead1" });
  if (kind === "pend") Object.assign(profile, { pend: [{ key: `${D1}|11:00|тимур`, name: "Тимур", maybe: false, service: "Мужская стрижка", date: D1, time: "11:00", raw: "", leadId: "seedlead2" }], adminLeads: 1, leadId: "seedlead2" });
  if (kind !== "none") mem.set(`h:web:alt:${sid}`, JSON.stringify({ n: 2, turns: [{ role: "user", text: "Здравствуйте" }, { role: "model", text: "Здравствуйте! Чем помочь?" }], profile }));
};
const kindOf = r => r.guard ? "guard" : /^(Почти готово|Almost done|Дайын дерлік)/.test(r.reply) ? "«Почти готово…»" : /(Ваша заявка у администратора|Your request is with|Өтініміңіз әкімшіде)/.test(r.reply) ? "«Ваша заявка у администратора…»"
  : /(В расписании пока ничего не изменилось|Nothing has changed|Кестеде әзірге)/.test(r.reply) ? "«В расписании пока ничего не изменилось…»" : /(Сейчас у вас есть запись|You currently have a booking|Қазір сізде жазба бар)/.test(r.reply) ? "часть ответа вырезана + «Сейчас у вас есть запись…»"
  : /(Передала администратору, он подтвердит отмену|passed this to the administrator|Әкімшіге бердім)/.test(r.reply) ? "«Передала администратору, он подтвердит отмену» + cancel=true + уведомление администратору" : "другое: " + r.reply.slice(0, 60);
const res = new Map();
for (const kind of ["none", "book", "pend"]) for (const it of CORPUS) {
  const sid = "tb" + (++n); seed(sid, kind);
  const r = await chat(sid, it.u, it.a);
  if (norm(r.reply) !== norm(it.a)) { if (!res.has(it.a)) res.set(it.a, { it, by: {} }); res.get(it.a).by[kind] = kindOf(r) + (r.cancel && !/cancel=true/.test(kindOf(r)) ? " [cancel=true]" : ""); }
}
console.log(`обычных ответов в корпусе: ${CORPUS.length}; заменено хотя бы в одном состоянии: ${res.size}`);
let i = 0;
for (const { it, by } of res.values()) console.log(`${++i}. [${it.g}] клиент: «${it.u}»\n   ИИ: «${it.a}»\n   нет записи: ${by.none || "— (дошёл как есть)"}\n   есть запись: ${by.book || "— (дошёл как есть)"}\n   заявка у администратора: ${by.pend || "— (дошёл как есть)"}`);
