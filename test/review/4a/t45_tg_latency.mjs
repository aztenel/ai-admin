// Ответ клиенту ждёт Telegram: уведомления шлются по одному ДО возврата ответа (и до отправки ответа в WhatsApp).
import { chat, tag, title, check, summary, ALT, TG, TGCFG, days, env, LOG, wa, waOn, WA } from "./h.mjs";
LOG.quiet = true;
env.ALTEGIO_LOC_ALT = "4901"; env.TG_CHAT = "1,2"; // два получателя: владелец и администратор
TGCFG.hang = 2000; // Telegram отвечает за 2 с (при зависании бот ждёт до 6 с на каждое сообщение)
title("веб-чат: три записи в одном ответе, Telegram отвечает за 2 с, получателей двое");
let t0 = performance.now();
let r = await chat("tl1", "трое, +7 702 111 22 33", "Записала.\n" + tag("Тимур", "9:30") + "\n" + tag("Алихан", "10:00") + "\n" + tag("Данияр", "11:00"));
let ms = Math.round(performance.now() - t0);
console.log(`   ответ клиенту через ${ms} мс (ИИ и Altegio в заглушках отвечают мгновенно); уведомлений: ${r.tg.length}`);
check("ответ клиенту не ждёт Telegram (меньше 3 с)", ms < 3000, ms + " мс");
title("WhatsApp: то же — ответ клиенту уходит только после всех уведомлений (обработка идёт в waitUntil: у Cloudflare на это около 30 с)");
waOn("alt"); env.ALTEGIO_LOC_ALT = "4902";
await wa("77073334455", "Здравствуйте", "Здравствуйте!");
t0 = performance.now();
await wa("77073334455", "трое", "Записала.\n" + tag("Тимур", "9:30") + "\n" + tag("Алихан", "10:00") + "\n" + tag("Данияр", "11:00"));
ms = Math.round(performance.now() - t0);
console.log(`   сообщение клиенту в WhatsApp отправлено через ${ms} мс`);
check("ответ в WhatsApp не ждёт Telegram (меньше 3 с)", ms < 3000, ms + " мс");
summary();
