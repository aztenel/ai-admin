// Сценарий C из s10_race.mjs отдельно — чтобы сравнить текущую версию и версию до исправления 2f31e6f.
import { chat, tag, title, check, summary, ALT, leads, env, G } from "./harness.mjs";
env.ALTEGIO_LOC_ALT = "4003"; G.delay = 50;
title("чат 1 переносит запись (DELETE в Altegio идёт 300 мс), чат 2 в это время создаёт запись — версия: " + (process.env.WORKER || "текущая (dev)"));
await chat("y1", "Марат, +7 705 111 22 33, мужская стрижка завтра в 10:00", "Записала.\n" + tag("Марат", "10:00"), { quiet: true });
ALT.delDelay = 300;
G.fn = body => { const last = body.contents.at(-1).parts[0].text; return /Перенесите/.test(last) ? "Переношу.\n[ОТМЕНА]\n" + tag("Марат", "13:00") : "Записала.\n" + tag("Олжас", "11:00"); };
const p1 = chat("y1", "Перенесите на 13:00", undefined, { quiet: true });
await new Promise(s => setTimeout(s, 100));
const p2 = chat("y2", "Олжас, +7 705 222 22 33, мужская стрижка завтра в 11:00", undefined, { quiet: true });
const [r1, r2] = await Promise.all([p1, p2]);
console.log("   чат 1:", r1.reply, "\n   чат 2:", r2.reply);
console.log("   на /leads:", JSON.stringify(leads().map(l => `${l.name} ${l.time.slice(-5)} ${l.status || "активна"}`)));
check("заявка Олжаса (чат 2) есть на /leads", leads().some(l => l.name === "Олжас"));
summary();
