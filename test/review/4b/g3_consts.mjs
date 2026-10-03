// G. constants and pure helpers that must be identical in main and dev for clients without Altegio
import * as dev from "./worker.x.mjs";
import * as main from "./worker.main.x.mjs";
const same = (n, a, b) => console.log(`${a === b ? "same" : "DIFF"}  ${n}`);
for (const k of ["HANDOFF", "ATTACK", "JOKE", "STOP"]) same(k, String(main[k]), String(dev[k]));
for (const id of Object.keys(main.CLIENTS)) same("CLIENTS." + id, JSON.stringify(main.CLIENTS[id]), JSON.stringify(dev.CLIENTS[id]));
console.log("clients only in dev:", Object.keys(dev.CLIENTS).filter(k => !main.CLIENTS[k]).join(", "));
const phones = ["87011234567", "+7 (701) 123-45-67", "7011234567", "8 701 123 45 67", "+996555123456", "", null, "77011234567", "+7 495 123 45 67", "8(701)1234567 доб 5"];
same("normPhone", JSON.stringify(phones.map(main.normPhone)), JSON.stringify(phones.map(dev.normPhone)));
same("findPhone", JSON.stringify(phones.map(x => main.findPhone(x || ""))), JSON.stringify(phones.map(x => dev.findPhone(x || ""))));
same("maskPhones", JSON.stringify(phones.map(x => main.maskPhones(x || ""))), JSON.stringify(phones.map(x => dev.maskPhones(x || ""))));
const now = Date.UTC(2026, 9, 5, 6, 30);
for (const id of Object.keys(main.CLIENTS)) for (let d = 0; d < 9; d++) { const t = now + d * 86400e3 + d * 3711e3; if (JSON.stringify(main.freeSlots(main.CLIENTS[id], t)) !== JSON.stringify(dev.freeSlots(dev.CLIENTS[id], t))) console.log("DIFF freeSlots", id, d); }
console.log("freeSlots compared for 6 clients × 9 days");
const esc = ['<a href="x">&\'', null, 5];
same("esc", JSON.stringify(esc.map(main.esc)), JSON.stringify(esc.map(dev.esc)));
