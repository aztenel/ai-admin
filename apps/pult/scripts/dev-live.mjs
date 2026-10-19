// Новый пульт на НАСТОЯЩЕМ коде бота, без сети: сервер бота из test/devserver.mjs (память вместо KV, заглушки Meta, Green-API,
// Telegram и «ИИ») + Vite с пультом по адресу /app/. Запросы /api/*, /login и т. п. Vite передаёт серверу бота — как будет на сайте.
// У компании «Демо Дент» (c=dent) два номера: Meta Cloud API (wa) и Green-API (ga). Сообщения «клиентов» приходят вебхуками.
//   npm run dev:live            → http://127.0.0.1:5174/app/?c=dent , вход ключом owner-key-123456
//   ещё сообщение клиента:      curl -X POST http://127.0.0.1:<порт бота>/_wa -d '{"c":"dent","from":"77001110001","text":"Привет"}'
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const { start, OWNER } = await import(new URL("../../../test/devserver.mjs", import.meta.url).href);

// номер Green-API компании «Демо Дент»: тот же способ, что в test/harness.mjs (gaText, пароль вебхука — HMAC токена)
const GA = { id: "1101000001", token: "ga-token-dent" };
const bot = await start(+(process.env.BOT_PORT || 0), {
  WA_TOKEN_DENT: "tok-dent",
  APP_SECRET_DENT: "sec-dent",
  PHONE_NUMBER_ID_DENT: "900111",
  GA_ID_DENT: GA.id,
  GA_TOKEN_DENT: GA.token,
});
const { S } = bot;

// переписки: два номера одной компании, один клиент пишет на оба
const wa = (from, text, name) => S.waText("/wa/dent", from, text, { secret: "sec-dent", pnid: "900111", names: { [from]: name || "" } });
const ga = (from, text, name) => S.gaText("dent", GA, from, text, { name: name || "" });
await wa("77001110001", "Здравствуйте, сколько стоит чистка зубов?", "Айгерим");
await wa("77001110001", "Позовите администратора, пожалуйста", "Айгерим");
await wa("77001110002", "Есть рассрочка на имплант?");
await ga("77001110003", "Добрый день! Можно записаться на завтра?", "Данияр");
await ga("77001110001", "Это Айгерим, продублирую сюда: нужен администратор", "Айгерим");
await S.chat("dent", "web-guest-1", "Будет больно удалять зуб мудрости?");

const vite = await createServer({
  root,
  base: "/app/",
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  server: {
    host: "127.0.0.1",
    port: +(process.env.PORT || 5174),
    strictPort: true,
    proxy: Object.fromEntries(["/api", "/login", "/logout", "/studio", "/broadcast", "/launch", "/leads", "/inbox"].map((p) => [p, { target: bot.url }])),
  },
});
await vite.listen();
console.log(`Бот на заглушках: ${bot.url}\nНовый пульт:      http://127.0.0.1:${vite.config.server.port}/app/?c=dent  (ключ входа: ${OWNER})`);
