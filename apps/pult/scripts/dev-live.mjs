// Новый пульт на НАСТОЯЩЕМ коде бота, без сети: сервер бота из test/devserver.mjs (память вместо KV, заглушки Meta, Green-API,
// Altegio, Telegram и «ИИ») + Vite с пультом по адресу /app/. Запросы /api/*, /login и т. п. Vite передаёт серверу бота — как будет на сайте.
// Две компании, у каждой два номера: Meta Cloud API (wa, «основной номер») и Green-API (ga, «номер бота»):
//   winchester — как настоящий Winchester: база клиентов из журнала Altegio (вымышленная, 40 клиентов), рассылки с номера бота
//                выключены кодом (gaNoBroadcast), ключ сотрудника staff-key-winch-0001; три записи через бота на номере бота —
//                в очереди 8 напоминаний и просьб об отзыве (вкладка «Сервисные · номер бота»), 2 ушли за 3 дня;
//   dent       — «Демо Дент»: без базы; сервер разрешает рассылки с номера бота (вебхук Green-API настроен), но пульт их не создаёт
//                (решение владельца 19.10.2026: маркетинг — только с основного номера); маркетинг — вставленным списком.
//   npm run dev:live            → адреса и ключи — в выводе; владелец входит ключом owner-key-123456
//   фоновая отправка рассылок:  curl -X POST http://127.0.0.1:<порт пульта>/_cron   (или на порт бота — «прошла минута»)
//   ещё сообщение клиента:      curl -X POST http://127.0.0.1:<порт бота>/_wa -d '{"c":"dent","from":"77001110001","text":"Привет"}'
// Раздел «Клиенты» (/api/contacts/*): база D1 — как у черновика ai-admin-dev, но в памяти (test/d1.mjs на node:sqlite, Node 22+;
// на Node 20 базы нет — раздел покажет «База клиентов ещё не подключена»), STAGE=preview: настоящий Altegio черновик читает только
// проверкой без записи, для экрана — «Тестовые клиенты» в «Синхронизации» (scripts/e2e-contacts.mjs).
// Часы бота — как в проверках (test/clock.mjs): 3 октября 2026, 12:00 по Астане и дальше; даты журнала считаются от них.
// Номера — вымышленные +7 700 000 xx xx (база) и +7 700 111 xx xx (чаты); имена придуманы.
// Из другого скрипта (scripts/e2e-campaigns.mjs): const d = await startDevLive({ port }) → { app, bot, S, OWNER, STAFF_W, close }.
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

// номера Green-API: тот же способ, что в test/harness.mjs (gaText, пароль вебхука — HMAC токена)
const GA = { id: "1101000001", token: "ga-token-dent" };
const GAW = { id: "1101000002", token: "ga-token-winch" };
export const STAFF_W = "staff-key-winch-0001";

/** Поднять бота на заглушках и Vite с пультом. port — порт пульта (0 — любой свободный), botPort — порт бота. */
export async function startDevLive({ port = +(process.env.PORT || 5174), botPort = +(process.env.BOT_PORT || 0) } = {}) {
  // бот и заглушки грузятся здесь, а не при импорте: test/harness.mjs подменяет часы (test/clock.mjs) для всего процесса
  const { start, OWNER } = await import(new URL("../../../test/devserver.mjs", import.meta.url).href);
  const { net, gaPass } = await import(new URL("../../../test/harness.mjs", import.meta.url).href);
  const { sqliteOk, d1With } = await import(new URL("../../../test/d1.mjs", import.meta.url).href);
  const bot = await start(botPort, {
    ...(sqliteOk ? { DB: d1With("preview").db, STAGE: "preview" } : {}),
    WA_TOKEN_DENT: "tok-dent",
    APP_SECRET_DENT: "sec-dent",
    PHONE_NUMBER_ID_DENT: "900111",
    GA_ID_DENT: GA.id,
    GA_TOKEN_DENT: GA.token,
    // Winchester: номер Meta, номер Green-API, ключ журнала Altegio (заглушка принимает только usr-tok), ключ сотрудника
    WA_TOKEN_WINCHESTER: "tok-winch",
    APP_SECRET_WINCHESTER: "sec-winch",
    PHONE_NUMBER_ID_WINCHESTER: "900333",
    GA_ID_WINCHESTER: GAW.id,
    GA_TOKEN_WINCHESTER: GAW.token,
    ALTEGIO_USER_WINCHESTER: "usr-tok",
    REMIND_GA_WINCHESTER: "1", // напоминания по журналу Altegio со второго номера включены (на сервере по умолчанию выключены)
    KEY_WINCHESTER: STAFF_W,
  });
  const { S } = bot;

  // вебхуки Green-API ведут в этого бота: без этого рассылку с номера бота не запустить (бот не увидел бы «стоп»)
  for (const [c, inst] of [["dent", GA], ["winchester", GAW]]) net.gaSettings[inst.id] = { webhookUrl: `${bot.url}/ga/${c}?t=${gaPass(c, inst)}`, incomingWebhook: "yes" };
  // сведения о номерах Meta: у Winchester качество высокое и предел 1000, у «Дента» — среднее и 250 (видно оба вида плашки)
  net.graphReply = (url, init) => {
    if ((init.method && init.method !== "GET") || !url.includes("fields=")) return null;
    const w = url.includes("/900333?");
    return new Response(JSON.stringify({ display_phone_number: w ? "+7 700 000 00 99" : "+7 700 000 00 11", verified_name: w ? "Winchester" : "Демо Дент",
      quality_rating: w ? "GREEN" : "YELLOW", whatsapp_business_manager_messaging_limit: w ? "TIER_1K" : "TIER_250" }), { headers: { "content-type": "application/json" } });
  };

  // журнал входящих второго номера Winchester (сверка «стопов», services/contacts/stops.js): «стоп» от тестового клиента, который не
  // пришёл вебхуком, и обычное сообщение — кнопка «Сверить «стопы» по Green-API» находит первый
  net.gaReply = (rec) => rec.op === "lastIncomingMessages" && rec.inst === GAW.id ? new Response(JSON.stringify([
    { type: "incoming", idMessage: "DEV-IN-1", timestamp: Math.floor(Date.now() / 1000) - 600, typeMessage: "textMessage", chatId: "77000001012@c.us", textMessage: "стоп" },
    { type: "incoming", idMessage: "DEV-IN-2", timestamp: Math.floor(Date.now() / 1000) - 300, typeMessage: "textMessage", chatId: "77000001013@c.us", textMessage: "А на завтра есть время?" }
  ]), { headers: { "content-type": "application/json" } }) : null;

  // журнал Altegio Winchester: 40 вымышленных клиентов (≈ 70 записей), визиты 5–95 дней назад, у части — будущая запись, один скрытый номер, неявки
  const NOW = Date.now(); // часы бота (test/clock.mjs)
  const day = (n) => new Date(NOW - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
  const NAMES = ["Арман", "Данияр", "Ерлан", "Тимур", "Нурлан", "Самат", "Асхат", "Бекзат", "Дастан", "Ильяс", "Канат", "Мади", "Олжас", "Руслан", "Санжар", "Азамат", "Алихан", "Жандос", "Марат", "Ринат"];
  const MASTERS = ["Арман", "Данияр", "Ерлан"];
  const SERVICES = ["Мужская стрижка", "Стрижка и борода", "Оформление бороды", "Детская стрижка"];
  let rid = 0;
  const rec = (phone, name, n, o = {}) => ({ id: ++rid, datetime: `${day(n)}T${o.at || "12:00"}:00+05:00`, deleted: false, attendance: o.att ?? 1,
    staff: { id: 1 + MASTERS.indexOf(o.staff), name: o.staff }, client: { id: 5000 + rid, phone, name }, services: [{ id: 1, title: o.svc || SERVICES[0] }] });
  const journal = [];
  for (let i = 1; i <= 40; i++) {
    const phone = "+7700000" + String(2000 + i), name = i % 9 === 0 ? "" : NAMES[(i * 7) % NAMES.length], staff = MASTERS[i % 3], svc = SERVICES[(i * 5) % 4];
    const last = 5 + ((i * 37) % 91); // 5–95 дней назад
    const visits = 1 + (i % 4); // 1–4 визита, раз в 3–5 недель
    for (let k = 0; k < visits; k++) {
      const n = last + k * (21 + (i % 3) * 7);
      if (n <= 95) journal.push(rec(phone, name, n, { staff, svc, att: i % 17 === 0 && k === 0 ? -1 : 1 }));
    }
    if (i % 11 === 0) journal.push(rec(phone, name, -(2 + (i % 5)), { staff, svc, att: 0 })); // будущая запись — в рассылки не попадёт
  }
  journal.push(rec("+7 700 XXX-X0-44", "Скрытый номер", 30, { staff: "Арман" })); // ключ журнала без права видеть телефоны — номер скрыт
  net.altJournal = journal;
  await S.kv.api.put("optout:winchester:77000002005", "1"); // просил не писать

  // Winchester, вкладка «Сервисные · номер бота»: три записи из журнала Altegio (с 30.10.2026 у Winchester напоминания — по всем записям
  // журнала со второго номера, без бота: services/reminders/journal.js). Очередь jrq:winchester строит тот же код (jrPlan) — накануне
  // в 18:00, за 2 часа (с 10 до 21), отзыв через 3 часа. Все — впереди по часам бота, фоновая задача (/_cron) их не отправит; записей
  // нет в net.altJournal — чтение журнала фоновой задачей их не трогает (а база клиентов не меняется). Плюс вчерашняя запись,
  // по которой напоминание и отзыв уже ушли (отметки попытки rms: и удачной отправки rmok: живут 3 дня) — «Отправлено за 3 дня: 2»;
  // ещё одна попытка не удалась (только rms:) — её не считаем. Номера — вымышленные +7 700 000 11 0x.
  const { jrPlan } = await import(new URL("../../../src/services/reminders/journal.js", import.meta.url).href);
  const { jrqSave } = await import(new URL("../../../src/db/kv/reminders.js", import.meta.url).href);
  const { putHist } = await import(new URL("../../../src/db/kv/chats.js", import.meta.url).href);
  const { CLIENTS } = await import(new URL("../../../src/config/builtin-clients.js", import.meta.url).href);
  const madeAt = NOW - 3600e3; // записались час назад
  const booked = [
    { id: "77000001101", name: "Арман", day: -1, time: "12:00", svc: "Мужская стрижка", staff: "Данияр" },
    { id: "77000001102", name: "", day: -2, time: "16:30", svc: "Стрижка и борода", staff: "Ерлан" },
    { id: "77000001103", name: "Тимур", day: 0, time: "17:00", svc: "Оформление бороды", staff: "Арман" },
  ];
  for (const [i, b] of booked.entries()) {
    const hk = `h:ga:winchester:${b.id}`;
    const rec = { name: b.name || "Клиент", date: day(b.day), time: b.time, services: b.svc, staffName: b.staff, record_id: 9101 + i, record_hash: `dev${9101 + i}`, at: madeAt };
    const turns = [
      { role: "user", text: `Здравствуйте! Можно записаться: ${b.svc.toLowerCase()}, ${b.time}?`, t: madeAt - 60e3 },
      { role: "model", text: `Записала вас на ${b.time} к мастеру ${b.staff} ✂️`, t: madeAt },
    ];
    await putHist(S.kv.api, hk, { n: 2, turns, profile: { ...(b.name ? { name: b.name } : {}), bookings: [rec] } });
  }
  const jrRecs = booked.map((b, i) => ({ id: 9101 + i, datetime: `${day(b.day)}T${b.time}:00+05:00`, deleted: false, attendance: 0, create_date: new Date(madeAt).toISOString(),
    staff: { id: 1, name: b.staff }, client: { id: 9101 + i, phone: "+" + b.id, name: b.name }, services: [{ id: 1, title: b.svc }] }));
  await jrqSave(S.env, "winchester", jrPlan(CLIENTS.winchester, jrRecs, NOW));
  for (const k of ["rms:winchester:9100:d1", "rms:winchester:9100:rv", "rmok:winchester:9100:d1", "rmok:winchester:9100:rv", "rms:winchester:9099:d1"])
    await S.kv.api.put(k, "1", { expirationTtl: 3 * 86400 });

  // переписки: два номера одной компании, один клиент пишет на оба
  const wa = (from, text, name) => S.waText("/wa/dent", from, text, { secret: "sec-dent", pnid: "900111", names: { [from]: name || "" } });
  const ga = (from, text, name) => S.gaText("dent", GA, from, text, { name: name || "" });
  await wa("77001110001", "Здравствуйте, сколько стоит чистка зубов?", "Айгерим");
  await wa("77001110001", "Позовите администратора, пожалуйста", "Айгерим");
  await wa("77001110002", "Есть рассрочка на имплант?");
  await ga("77001110003", "Добрый день! Можно записаться на завтра?", "Данияр");
  await ga("77001110001", "Это Айгерим, продублирую сюда: нужен администратор", "Айгерим");
  await S.chat("dent", "web-guest-1", "Будет больно удалять зуб мудрости?");
  // Winchester: на основном номере бот молчит (waOff) — сообщение ждёт администратора
  await S.waText("/wa/winchester", "77001112001", "Здравствуйте! Есть свободное время сегодня вечером?", { secret: "sec-winch", pnid: "900333", names: { "77001112001": "Ерлан" } });

  const vite = await createServer({
    root,
    base: "/app/",
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    server: {
      host: "127.0.0.1",
      port,
      strictPort: !!port,
      // /_cron — «прошла минута» (фоновая отправка рассылок), чтобы проверке хватало одного адреса
      proxy: Object.fromEntries(["/api", "/login", "/logout", "/studio", "/broadcast", "/launch", "/leads", "/inbox", "/_cron"].map((p) => [p, { target: bot.url }])),
    },
  });
  await vite.listen();
  const addr = vite.httpServer?.address();
  const app = `http://127.0.0.1:${addr && typeof addr === "object" ? addr.port : port}/app/`;
  const close = async () => {
    await vite.close();
    await new Promise((r) => bot.server.close(() => r(undefined)));
  };
  return { app, bot, S, OWNER, STAFF_W, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { app, bot, OWNER } = await startDevLive();
  console.log(`Бот на заглушках: ${bot.url}   (фоновая отправка рассылок: curl -X POST ${bot.url}/_cron)
Новый пульт:
  Winchester (база клиентов, номер бота без рассылок): ${app}?c=winchester   владелец: ${OWNER}   сотрудник: ${STAFF_W}
  Демо Дент (без базы, рассылка списком):             ${app}?c=dent   владелец: ${OWNER}`);
}
