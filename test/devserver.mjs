// Локальный сервер для проверки страниц в настоящем браузере: весь бот работает на заглушках (память вместо KV, «ИИ» по простым правилам,
// Telegram, Meta и Altegio — подменены). Сеть не нужна. Запуск: node test/devserver.mjs [порт]  →  http://127.0.0.1:8787/studio?key=owner-key-123456
// Сообщение «клиента WhatsApp» можно прислать так: POST /_wa { "c": "kairat", "from": "77051110001", "text": "Привет", "name": "Данияр" }
// Фоновая задача (в Cloudflare она идёт раз в минуту сама): POST /_cron — отправляет очередную порцию рассылки
import http from "node:http";
import { mk, net, worker, D1 } from "./harness.mjs";

export const OWNER = "owner-key-123456";
export function start(port = 0, envExtra = {}) {
  const S = mk({ ALTEGIO_PARTNER: "partner-key", ...envExtra });
  // «ИИ» для ручной проверки: отвечает по фактам из подсказки и оформляет заявку, когда в сообщении есть имя, телефон и время
  net.ai = [body => {
    const sys = body.systemInstruction.parts[0].text, u = body.contents.at(-1).parts[0].text, low = u.toLowerCase();
    const alt = sys.includes("Запись в расписание");
    const time = (u.match(/\b(\d{1,2}:\d{2})\b/) || [])[1], name = (u.match(/^([А-ЯЁA-Z][а-яёa-z]+)[,\s]/) || [])[1];
    if (/отмен|не смогу|не приду/.test(low)) return alt ? `Передаю администратору, он подтвердит.\n[ОТМЕНА]` : "Передала администратору, он подтвердит отмену.\n[ОТМЕНА]";
    if (/перенес/.test(low) && time && alt) return `Передаю администратору.\n[ОТМЕНА]\n[ЗАЯВКА] Имя: ${name || "Клиент"}; Телефон: указан; Услуга: Мужская стрижка; Мастер: любой; Дата: ${D1}; Время: ${time}`;
    if (time && name) return alt ? `Записала.\n[ЗАЯВКА] Имя: ${name}; Телефон: указан; Услуга: Мужская стрижка; Мастер: любой; Дата: ${D1}; Время: ${time}`
      : `Забронировала вас на завтра в ${time}. Администратор подтвердит запись.\n[ЗАЯВКА] Имя: ${name}; Телефон: указан; Услуга: стрижка; Время: завтра, ${time}`;
    const price = (sys.match(/—\s*(?:от\s*)?(\d[\d ]*\d) ₸/) || [])[1];
    if (/стоит|цена|сколько/.test(low)) return price ? `Стоимость от ${price} ₸. Записать вас?` : "Точную стоимость подскажет администратор. Записать вас?";
    return "Здравствуйте! Подскажу цены и запишу вас. Что вас интересует?";
  }];
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks), url = `http://${req.headers.host}${req.url}`;
      if (req.method === "POST" && req.url === "/_wa") { // прислать сообщение «от клиента WhatsApp»
        const b = JSON.parse(body.toString() || "{}"), up = String(b.c).toUpperCase();
        S.env["WA_TOKEN_" + up] = S.env["WA_TOKEN_" + up] || "tok-" + b.c; S.env["APP_SECRET_" + up] = S.env["APP_SECRET_" + up] || "sec-" + b.c;
        const msg = b.media ? { from: b.from, type: "audio", audio: { id: b.media, mime_type: "audio/ogg" } } : { from: b.from, type: "text", text: { body: b.text } };
        const r = await S.waPost("/wa/" + b.c, msg, { secret: S.env["APP_SECRET_" + up], pnid: "900111", names: { [b.from]: b.name || "" } });
        res.writeHead(r.status, { "content-type": "application/json" }); res.end(JSON.stringify({ status: r.status, sent: S.sentTo(b.from) })); return;
      }
      if (req.method === "POST" && req.url === "/_cron") { await S.cron(); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return; } // «прошла минута»: фоновая задача (рассылки)
      const headers = {}; for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
      if (!headers["cf-connecting-ip"]) headers["cf-connecting-ip"] = "127.0.0.1";
      const pending = [];
      const r = await worker.fetch(new Request(url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body, redirect: "manual" }), S.env, { waitUntil: p => pending.push(p) });
      await Promise.allSettled(pending);
      const out = {}; r.headers.forEach((v, k) => { out[k] = k === "set-cookie" ? v.replace(/;\s*Secure/i, "") : v; }); // по http cookie с пометкой Secure браузер не сохранит
      res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }); res.end("devserver: " + String((e && e.stack) || e)); }
  });
  return new Promise(resolve => server.listen(port, "127.0.0.1", () => resolve({ S, server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` })));
}

if (process.argv[1] && process.argv[1].endsWith("devserver.mjs")) {
  const d = await start(+process.argv[2] || 8787);
  console.log(`Бот на заглушках: ${d.url}/studio?key=${OWNER}\nВитрина: ${d.url}/   ·   остановить — Ctrl+C`);
}
