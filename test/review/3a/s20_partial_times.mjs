// Altegio не отдал время только на один из дней (разовый сбой). Что увидит ИИ?
import { chat, title, check, summary, ALT, TG, env, G, days } from "./harness.mjs";
const { D1, D2 } = days();
env.ALTEGIO_LOC_ALT = "4951"; ALT.timesFailFor = D1;
title("book_times на завтра отвечает 500, на послезавтра — работает");
const d = await chat("pt1", "Есть время завтра?", "Завтра свободного времени нет, могу предложить послезавтра в 10:00 или 11:00. Подойдёт?");
const sys = G.calls.at(-1).systemInstruction.parts[0].text;
console.log("   блок «Свободные окна» в подсказке ИИ:\n     " + sys.slice(sys.indexOf("Свободные окна для записи"), sys.indexOf("ПРАВИЛА")).trim().split("\n").join("\n     "));
console.log("   Telegram:", JSON.stringify(TG));
check("ИИ знает, что на завтра расписание не прочиталось (а не «свободного времени нет»)", /не (удалось|чита|вижу)|сбой|уточн/i.test(sys.slice(sys.indexOf("Свободные окна для записи"), sys.indexOf("ПРАВИЛА"))), "день просто пропал из списка — ИИ скажет клиенту, что завтра всё занято");
summary();
