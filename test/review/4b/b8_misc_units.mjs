// small unit checks: titles that differ only in characters svTrim removes; English guard loophole words.
import * as W from "./worker.x.mjs";
const J = o => new Response(JSON.stringify(o));
let SV = [];
globalThis.fetch = async u => /book_services/.test(String(u)) ? J({ success: true, data: { services: SV, category: [] } }) : /book_staff/.test(String(u)) ? J({ success: true, data: [] }) : J({ success: true, data: [] });
let loc = 7500;
for (const titles of [["Стрижка", "Стрижка."], ["Маникюр", "Маникюр!"], ["Стрижка «Бокс»", "Стрижка Бокс"], ["💅 Маникюр", "Маникюр"]]) {
  SV = titles.map((t, i) => ({ id: i + 1, title: t, price_min: 1000 * (i + 1), seance_length: 1800 }));
  const b = await W.altBase({ ALTEGIO_PARTNER: "k" }, ++loc, Date.now());
  console.log(`titles in the prompt: ${b.services.map(x => JSON.stringify(x.title)).join(", ")}`);
  for (const t of b.services.map(x => x.title)) { const r = W.altPickServices(b.services, t); console.log(`   LLM copies ${JSON.stringify(t)} → ${r ? "#" + r.map(x => x.id).join("+") : "ASK (never bookable)"}`); }
}
