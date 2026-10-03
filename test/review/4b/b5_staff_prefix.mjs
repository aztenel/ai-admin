// B. staff whose Altegio name starts with a position word («Барбер Арман», «Мастер Анна»), 2-letter names, names with initials.
import * as W from "./worker.x.mjs";
const J = (o) => new Response(JSON.stringify(o));
let cur = [];
globalThis.fetch = async u => /book_staff/.test(String(u)) ? J({ success: true, data: cur }) : J({ success: true, data: { services: [], category: [] } });
let id = 0, loc = 7400; const M = (name, spec = "") => ({ id: ++id, name, specialization: spec, bookable: true });
const show = async (staff, rows, texts) => {
  cur = staff; const b = await W.altBase({ ALTEGIO_PARTNER: "k" }, ++loc, Date.now());
  console.log(`\nstaff as shown to the LLM: ${b.staff.map(m => m.name).join(", ")}`);
  for (const raw of rows) { const r = W.altPickStaff(b.staff, raw); console.log(`  Мастер: «${raw}» → ${!r ? "ASK" : r.any ? "ANY" : r.staff.name}`); }
  for (const t of texts) { const r = W.altNamed(b.staff, t); console.log(`  client: «${t}» → named master block: ${r ? r.name : "none"}`); }
};
await show([M("Барбер Арман"), M("Барбер Ерлан"), M("Топ-барбер Даурен")], ["Арман", "Арману", "Барбер Арман", "к барберу Арману", "Даурен", "Топ-барбер Даурен"], ["Хочу к Арману", "к Даурену завтра", "к барберу Ерлану"]);
await show([M("Мастер Анна"), M("Стилист Мария"), M("Ян"), M("Ли")], ["Анна", "Мастер Анна", "Мария", "Ян", "Яну", "Ли"], ["к Анне", "к Марии", "к Яну", "к Ли"]);
await show([M("Нурсултан А."), M("Нурсултан Б."), M("Айгерим С"), M("Айгерим Т")], ["Нурсултан А.", "Нурсултан А", "Нурсултан", "Айгерим С", "Айгерим С."], ["к Нурсултану А", "к Айгерим Т"]);
