// Сбой записи/чтения KV (лимит «1 запись ключа в секунду» → 429, суточная квота записей, разовый сбой) после того, как запись в Altegio уже создана.
import { chat, showState, tag, title, check, summary, ALT, TG, days, prof, leads, env, KVFAIL, call, mem } from "./harness.mjs";
const { D1 } = days();
process.on("unhandledRejection", e => { console.log("   UNHANDLED REJECTION:", String(e)); });

async function rawChat(sid, text, ip) {
  try {
    const res = await call("/api/chat", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ c: "alt", sid, text }) });
    return { status: res.status, body: (await res.text()).slice(0, 300) };
  } catch (e) { return { thrown: String(e) }; }
}
import { G } from "./harness.mjs";

// ---------- A. падает запись счётчика лимита (bk:…) — сразу после создания записи в Altegio
env.ALTEGIO_LOC_ALT = "3201";
title("A. KV.put падает на счётчике лимитов bk:* (например, 429: тот же ключ bk:<локация>:all пишут два чата в одну секунду)");
KVFAIL.put = k => k.startsWith("bk:3201:all");
G.queue = ["Записала.\n" + tag("Тимур", "10:00")]; TG.length = 0;
let r = await rawChat("k1", "Тимур, +7 702 111 22 33, мужская стрижка завтра в 10:00", "10.50.0.1");
console.log("   ответ /api/chat:", JSON.stringify(r));
console.log("   Telegram:", JSON.stringify(TG.map(x => x.split("\n")[0])));
showState("k1");
check("think() не бросает исключение (клиент получает ответ)", !r.thrown && r.status === 200, JSON.stringify(r));
check("запись, созданная в Altegio, числится в чате (profile.bookings)", (prof("k1")?.bookings || []).length === 1, "история чата не сохранена: " + JSON.stringify(prof("k1")));
check("заявка сохранена на /leads", leads().some(l => l.name === "Тимур"), "заявок: " + leads().length);
KVFAIL.put = null;
title("A2. клиент не получил ответа и повторяет то же сообщение");
G.queue = ["Записала.\n" + tag("Тимур", "10:00")];
r = await rawChat("k1", "Тимур, +7 702 111 22 33, мужская стрижка завтра в 10:00", "10.50.0.1");
console.log("   ответ /api/chat:", r.body);
showState("k1");
check("второй записи в Altegio на то же время нет", ALT.records.length === 1, "в Altegio записей: " + ALT.records.length);

// ---------- B. падает сохранение истории чата (последний put в think)
env.ALTEGIO_LOC_ALT = "3202"; ALT.records.length = 0; TG.length = 0;
title("B. KV.put падает на истории чата h:web:alt:<sid>");
KVFAIL.put = k => k.startsWith("h:web:alt:k2");
G.queue = ["Записала.\n" + tag("Марат", "11:00")];
r = await rawChat("k2", "Марат, +7 705 111 22 33, мужская стрижка завтра в 11:00", "10.50.0.2");
console.log("   ответ /api/chat:", JSON.stringify(r));
console.log("   в Altegio записей:", ALT.records.length, "| Telegram:", JSON.stringify(TG.map(x => x.split("\n")[0])), "| заявок Марата на /leads:", leads().filter(l => l.name === "Марат").length);
check("think() не бросает исключение при сбое сохранения истории", !r.thrown && r.status === 200, JSON.stringify(r));
KVFAIL.put = null;

// ---------- C. падает чтение заявок (leads:alt) в addLead — после создания записи
env.ALTEGIO_LOC_ALT = "3203"; ALT.records.length = 0; TG.length = 0;
title("C. KV.get падает на leads:alt (чтение заявок внутри addLead, запись в Altegio уже создана)");
KVFAIL.get = k => k === "leads:alt";
G.queue = ["Записала.\n" + tag("Олжас", "13:00")];
r = await rawChat("k3", "Олжас, +7 705 222 22 33, мужская стрижка завтра в 13:00", "10.50.0.3");
console.log("   ответ /api/chat:", JSON.stringify(r));
console.log("   в Altegio записей:", ALT.records.length, "| Telegram:", JSON.stringify(TG.map(x => x.split("\n")[0])));
showState("k3");
check("think() не бросает исключение при сбое чтения заявок", !r.thrown && r.status === 200, JSON.stringify(r));
check("администратор узнал о созданной записи", TG.some(x => /Новая запись/.test(x)), "Telegram пуст — запись в Altegio есть, а о ней не знает никто");
KVFAIL.get = null;

// ---------- D. падает сохранение заявок (leads:alt) — это место защищено try/catch
env.ALTEGIO_LOC_ALT = "3204"; ALT.records.length = 0; TG.length = 0;
title("D. KV.put падает на leads:alt (сохранение заявок)");
KVFAIL.put = k => k === "leads:alt";
G.queue = ["Записала.\n" + tag("Ринат", "09:30")];
r = await rawChat("k4", "Ринат, +7 709 777 22 33, мужская стрижка завтра в 9:30", "10.50.0.4");
console.log("   ответ /api/chat:", r.status, r.body.slice(0, 120));
check("сбой сохранения заявок не роняет think(), запись числится в чате", !r.thrown && r.status === 200 && (prof("k4")?.bookings || []).length === 1);
KVFAIL.put = null;
summary();
