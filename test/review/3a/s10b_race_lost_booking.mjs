// Самый обыденный вариант гонки: клиент в WhatsApp пишет два сообщения подряд. Первое создаёт запись,
// второе («спасибо, жду») начато до того, как первое сохранило историю, а закончено позже — и затирает её.
import { chat, showState, tag, title, check, summary, ALT, TG, days, env, G, call, mem, pending, WA } from "./harness.mjs";
import { createHmac } from "node:crypto";
Object.assign(env, { WA_TOKEN: "wat", PHONE_NUMBER_ID: "111", WA_CLIENT: "alt", APP_SECRET: "sec", ALTEGIO_LOC_ALT: "4011" });
const waMsg = async (id, text) => {
  const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id, from: "77015550101", type: "text", text: { body: text } }] } }] }] });
  return call("/", { method: "POST", body, headers: { "x-hub-signature-256": "sha256=" + createHmac("sha256", "sec").update(body).digest("hex") } });
};
const flush = async () => { await Promise.all(pending); pending.length = 0; };
const waProf = () => JSON.parse(mem.get("h:wa:alt:77015550101")).profile;
G.delay = 150; // ИИ думает 150 мс (в жизни 1–3 с)
G.fn = body => { const last = body.contents.at(-1).parts[0].text;
  if (/Тимур/.test(last)) return "Записала вас.\n" + tag("Тимур", "10:00");
  if (/спасибо/i.test(last)) return "Пожалуйста! Чем ещё помочь?";
  if (/Отмените/.test(last)) return "Отменяю.\n[ОТМЕНА]";
  if (/записан/.test(last)) return "Да, вы записаны на завтра в 10:00.";
  return "Как вас зовут?"; };

title("1. «Мужская стрижка завтра в 10:00» → бот спрашивает имя");
await waMsg("m1", "Мужская стрижка завтра в 10:00"); await flush();
title("2. клиент отвечает двумя сообщениями подряд: «Тимур» и через 50 мс «спасибо заранее»");
WA.length = 0;
await waMsg("m2", "Тимур"); await new Promise(s => setTimeout(s, 50)); await waMsg("m3", "спасибо заранее"); await flush();
console.log("   ответы в WhatsApp:", JSON.stringify(WA.map(x => x.text.body)));
console.log("   в Altegio создано:", JSON.stringify(ALT.records.map(r => `№${r.id} ${r.fullname} ${r.appointments[0].datetime.slice(0, 16)}`)));
console.log("   в состоянии чата bookings:", JSON.stringify(waProf().bookings || []), "| история:", JSON.stringify(JSON.parse(mem.get("h:wa:alt:77015550101")).turns.map(t => t.text.slice(0, 40))));
check("запись, созданная в Altegio, числится в чате", (waProf().bookings || []).length === 1, "запись №" + ALT.records[0]?.id + " создана, клиенту сказано «Записала вас…», но в состоянии чата её нет — второе сообщение затёрло историю");

title("3. позже: «Я точно записан?»");
WA.length = 0; await waMsg("m4", "Я точно записан?"); await flush();
console.log("   ответ:", JSON.stringify(WA.map(x => x.text.body)));
title("4. «Отмените мою запись»");
WA.length = 0; TG.length = 0; await waMsg("m5", "Отмените мою запись"); await flush();
console.log("   ответ:", JSON.stringify(WA.map(x => x.text.body)), "| удалено в Altegio:", JSON.stringify(ALT.deleted), "| Telegram:", JSON.stringify(TG.map(x => x.split("\n")[0])));
check("клиент может отменить свою запись из чата", ALT.deleted.length === 1, "бот считает, что этой записи «нет в этом чате»");
summary();
