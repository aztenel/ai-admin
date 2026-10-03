// Одновременные сообщения. KV не атомарен: think() читает историю в начале и пишет в конце (между ними — ИИ и Altegio, секунды).
import { chat, showState, tag, title, check, summary, ALT, TG, days, prof, leads, env, G, call, mem, pending, WA } from "./harness.mjs";
import { createHmac } from "node:crypto";
const { D1 } = days();

// ---------- A. два сообщения одного чата обрабатываются одновременно (двойное нажатие / два сообщения подряд в WhatsApp)
env.ALTEGIO_LOC_ALT = "4001";
G.delay = 50; // ИИ отвечает не мгновенно (в жизни 1–3 с) — за это время приходит второе сообщение
title("A. веб-чат: одно и то же сообщение пришло дважды одновременно (повтор запроса при плохой связи)");
G.queue = ["Записала.\n" + tag("Тимур", "10:00")];
const [a, b] = await Promise.all([
  chat("x1", "Тимур, +7 702 111 22 33, мужская стрижка завтра в 10:00", undefined, { quiet: true }),
  chat("x1", "Тимур, +7 702 111 22 33, мужская стрижка завтра в 10:00", undefined, { quiet: true })]);
console.log("   ответ 1:", a.reply, "\n   ответ 2:", b.reply);
showState("x1");
check("в Altegio одна запись", ALT.records.length === 1, "создано " + ALT.records.length);
check("все созданные записи числятся в чате", (prof("x1").bookings || []).length === ALT.records.length, `в чате ${prof("x1").bookings.length}, в Altegio ${ALT.records.length} — лишнюю из чата отменить нельзя`);

// ---------- B. WhatsApp: клиент шлёт два сообщения подряд, Meta доставляет их двумя вебхуками
env.ALTEGIO_LOC_ALT = "4002"; ALT.records.length = 0; ALT.deleted.length = 0;
Object.assign(env, { WA_TOKEN: "wat", PHONE_NUMBER_ID: "111", WA_CLIENT: "alt", APP_SECRET: "sec" });
const waMsg = async (id, text) => {
  const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id, from: "77011112233", type: "text", text: { body: text } }] } }] }] });
  const sig = "sha256=" + createHmac("sha256", "sec").update(body).digest("hex");
  return call("/", { method: "POST", body, headers: { "x-hub-signature-256": sig } });
};
title("B. WhatsApp: «Отмените запись» и «и сына тоже» двумя сообщениями подряд (два вебхука одновременно)");
G.queue = ["Записала.\n" + tag("Тимур", "10:00")]; await waMsg("w1", "Тимур, мужская стрижка завтра в 10:00"); await Promise.all(pending); pending.length = 0;
G.queue = ["Записала.\n" + tag("Алихан", "11:00", { service: "Детская стрижка" })]; await waMsg("w2", "И сына Алихана на детскую завтра в 11:00"); await Promise.all(pending); pending.length = 0;
const waProf = () => JSON.parse(mem.get("h:wa:alt:77011112233")).profile;
console.log("   в чате до отмен:", JSON.stringify(waProf().bookings.map(x => x.name + " " + x.time)));
WA.length = 0;
G.fn = body => { const last = body.contents.at(-1).parts[0].text; return /сына/.test(last) ? `Отменяю запись Алихана.\n[ОТМЕНА] Имя: Алихан` : `Отменяю вашу запись.\n[ОТМЕНА] Имя: Тимур`; };
await Promise.all([waMsg("w3", "Отмените мою запись"), waMsg("w4", "и сына тоже отмените")]);
await Promise.all(pending); pending.length = 0; G.fn = null;
console.log("   ответы в WhatsApp:", JSON.stringify(WA.map(x => x.text.body.slice(0, 80))));
console.log("   удалено в Altegio:", JSON.stringify(ALT.deleted), "| в чате после отмен:", JSON.stringify(waProf().bookings.map(x => x.name + " " + x.time)));
check("обе записи удалены в Altegio и обе убраны из чата", ALT.deleted.length === 2 && waProf().bookings.length === 0,
  `в Altegio удалено ${ALT.deleted.length}, а в чате всё ещё числится: ${JSON.stringify(waProf().bookings.map(x => x.name + " " + x.time))}`);
if (waProf().bookings.length) {
  const stale = waProf().bookings[0];
  title("B2. клиент передумал и снова просит записать " + stale.name + " на " + stale.time + " (эта запись в Altegio уже удалена)");
  WA.length = 0; const recN = ALT.records.length;
  G.queue = ["Записала.\n" + tag(stale.name, stale.time, { service: stale.services })];
  await waMsg("w5", `Всё-таки запишите ${stale.name} на ${stale.time}`); await Promise.all(pending); pending.length = 0;
  console.log("   ответ в WhatsApp:", JSON.stringify(WA.map(x => x.text.body)));
  check("клиенту не говорят «Вы уже записаны» про удалённую запись", ALT.records.length === recN + 1, "новая запись не создана; ответ: " + JSON.stringify(WA.map(x => x.text.body)));
}

// ---------- C. заявки на /leads: чтение в начале сообщения, запись в конце. Два чата одной компании одновременно.
env.ALTEGIO_LOC_ALT = "4003"; ALT.records.length = 0; ALT.deleted.length = 0; delete env.WA_CLIENT;
title("C. чат 1 переносит запись (DELETE в Altegio идёт 300 мс), чат 2 в это время создаёт запись");
await chat("y1", "Марат, +7 705 111 22 33, мужская стрижка завтра в 10:00", "Записала.\n" + tag("Марат", "10:00"), { quiet: true });
ALT.delDelay = 300;
G.fn = body => { const last = body.contents.at(-1).parts[0].text; return /Перенесите/.test(last) ? "Переношу.\n[ОТМЕНА]\n" + tag("Марат", "13:00") : "Записала.\n" + tag("Олжас", "11:00"); };
const p1 = chat("y1", "Перенесите на 13:00", undefined, { quiet: true });
await new Promise(s => setTimeout(s, 100));
const p2 = chat("y2", "Олжас, +7 705 222 22 33, мужская стрижка завтра в 11:00", undefined, { quiet: true });
const [r1, r2] = await Promise.all([p1, p2]); ALT.delDelay = 0; G.fn = null;
console.log("   чат 1:", r1.reply, "\n   чат 2:", r2.reply);
console.log("   на /leads:", JSON.stringify(leads().map(l => `${l.name} ${l.time.slice(-5)} ${l.status || "активна"}`)));
check("заявка Олжаса (чат 2) есть на /leads", leads().some(l => l.name === "Олжас"), "запись Олжаса создана в Altegio (№" + (ALT.records.find(r => r.fullname === "Олжас") || {}).id + "), но на /leads её нет — затёрта сохранением чата 1");
summary();
