// WhatsApp webhook without APP_SECRET (the worker then accepts unsigned POSTs — same as v7.3) + a client connected to Altegio.
// In v7.3 a forged message could only create a lead; in v7.4 it creates REAL records, and the per-IP limit does not apply.
import { mk, show, D1, D2, J } from "./lib.mjs";
const h = await mk({ env: { ALTEGIO_LOC_ALT: "4350", WA_TOKEN: "wat", PHONE_NUMBER_ID: "111", WA_CLIENT: "alt" } }); // no APP_SECRET
const _log = console.log; console.log = (...a) => { if (!/^(guard|altegio|gemini|WA)/.test(String(a[0]))) _log(...a); };
const names = ["Арсен", "Бекзат", "Виктор", "Галым", "Дамир", "Нурлан", "Олжас", "Павел"], tms = ["10:00", "11:00", "13:00", "09:30", "10:00", "11:00", "13:00", "09:30"];
for (let i = 0; i < 8; i++) {
  h.gemini = ["Записала.\n" + h.tag(names[i], "Мужская стрижка", "любой", D1, tms[i])];
  const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "forged" + i, from: "7701555000" + i, type: "text", text: { body: `${names[i]}, мужская стрижка завтра в ${tms[i]}` } }] } }] }] });
  const r = await h.call("/", { method: "POST", body }); await Promise.all(h.pending);
}
_log("unsigned POST / accepted; real records created in Altegio: " + h.ALT.records.length + " (web chat would stop one IP at 5)");
_log("phones used: " + h.ALT.records.map(r => r.phone).join(", "));
_log("limit counters: " + JSON.stringify([...h.mem.keys()].filter(k => k.startsWith("bk:4350:all")).map(k => k + "=" + h.mem.get(k))));
