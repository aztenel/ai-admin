// Мелкие проверки: (а) дата вида 2026-13-45 в ветке «лимит»; (б) Telegram «завис» — когда заявка попадает в KV.
import { chat, tag, title, check, summary, ALT, TG, env, G, leads, mem, call, iso } from "./harness.mjs";

env.ALTEGIO_LOC_ALT = "4901";
title("а. превышен лимит + ИИ дал невозможную дату «2026-13-45»");
mem.set(`bk:4901:all:${iso(Date.now())}`, "60");
let d = await chat("sc1", "Ринат, +7 709 777 22 33, мужская стрижка", "Записала.\n" + tag("Ринат", "10:00", { date: "2026-13-45" }));
check("в тексте клиенту и в заявке нет undefined/NaN", !/undefined|NaN/.test(d.reply + JSON.stringify(d.lead)), d.reply);

env.ALTEGIO_LOC_ALT = "4902";
title("б. Telegram не отвечает (запрос висит): сохранена ли заявка в KV через 300 мс? — версия: " + (process.env.WORKER ? "main 7.3" : "текущая (dev)"));
const realFetch = globalThis.fetch;
globalThis.fetch = (u, init) => String(u).includes("api.telegram.org") ? new Promise(() => {}) : realFetch(u, init);
G.queue = ["Забронировала вас на завтра в 12:00. Администратор подтвердит запись.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: мужская стрижка; Время: завтра, 12:00"];
const p = call("/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "10.99.0.1" }, body: JSON.stringify({ c: "barber", sid: "sc2", text: "Азамат, 8 777 123 45 67, стрижка завтра в 12:00" }) });
await Promise.race([p, new Promise(s => setTimeout(s, 300))]);
check("заявка обычного клиента (барбершоп) уже лежит в KV, хотя уведомление зависло", leads("barber").some(l => l.name === "Азамат"), "заявки в KV нет: сохранение стоит после уведомления");
summary();
process.exit(0);
