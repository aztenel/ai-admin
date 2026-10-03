// Проверки новых частей на заглушках: история чата для пульта, WhatsApp на несколько клиентов, паспорт бота, вход, страница владельца, пульт чатов.
// Запуск: node test/platform.mjs (его же запускает test/smoke.mjs в конце). SHOW=1 — показать все проверки.
import { mk, net, ok, section, T, D1, D2, wait } from "./harness.mjs";

const text = (from, body) => ({ from, type: "text", text: { body } });
const echo = b => "Ответ на: " + b.contents.at(-1).parts[0].text;

// ====== 1. История чата и вебхук WhatsApp (один номер на воркер, как раньше)
section("история чата и вебхук");
{
  const S = mk({ WA_TOKEN: "wat", PHONE_NUMBER_ID: "111", WA_CLIENT: "barber", APP_SECRET: "sec" });
  const o = { secret: "sec", names: { "77010000001": "Айдос" } };
  net.reset(); net.ai = [echo];
  await S.waPost("/", [text("77010000001", "Привет"), text("77010000002", "Сколько стоит стрижка?"), text("77010000001", "А борода сколько?")], o);
  const a = S.sentTo("77010000001"), b = S.sentTo("77010000002");
  ok("вебхук с тремя сообщениями: ответ получили оба клиента, первому — на оба его сообщения по порядку", a.filter(x => /^Ответ на/.test(x)).join("|") === "Ответ на: Привет|Ответ на: А борода сколько?" && b.some(x => x === "Ответ на: Сколько стоит стрижка?"), JSON.stringify([a, b]));
  ok("отправка идёт с общего номера и общим токеном", net.graph.every(g => g.url.includes("/111/messages") && g.auth === "Bearer wat"), JSON.stringify(net.graph.map(g => [g.url, g.auth])));
  let h = S.hist("wa", "barber", "77010000001"), m = S.kv.meta.get("h:wa:barber:77010000001");
  ok("у реплик в истории есть время", h.turns.length === 4 && h.turns.every(t => t.t > 0), JSON.stringify(h.turns));
  ok("метаданные ключа истории — строка списка чатов: имя из WhatsApp, кто писал последним, начало реплики, время", m && m.nm === "Айдос" && m.d === "b" && /Ответ на: А борода/.test(m.s) && m.li > 0 && m.t > 0 && !m.nd, JSON.stringify(m));
  ok("имя из профиля WhatsApp запомнено отдельно от имени для записи", h.profile.waName === "Айдос" && !h.profile.name, JSON.stringify(h.profile));

  // повтор того же вебхука (Meta шлёт повторно при задержке ответа) — второго ответа нет
  const n0 = net.graph.length;
  await S.waPost("/", [], { secret: "sec", raw: JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "wamid.in.1", from: "77010000001", type: "text", text: { body: "Привет" } }] } }] }] }) });
  ok("повторная доставка того же сообщения — без второго ответа", net.graph.length === n0);

  // голосовое
  net.reset();
  await S.waPost("/", { from: "77010000001", type: "audio", audio: { id: "MEDIA1", mime_type: "audio/ogg" } }, o);
  h = S.hist("wa", "barber", "77010000001"); m = S.kv.meta.get("h:wa:barber:77010000001");
  const tv = h.turns.at(-2), tb = h.turns.at(-1);
  ok("голосовое: в истории реплика клиента с номером файла и ответ бота; чат помечен для администратора", tv.role === "user" && /голосовое/.test(tv.text) && tv.m && tv.m.id === "MEDIA1" && tv.m.k === "audio" && tb.role === "model" && /не умею слушать/.test(tb.text) && m.nd === "media" && h.profile.need.why === "media", JSON.stringify([tv, tb, m]));
  ok("голосовое: администратору ушло уведомление, клиенту — просьба написать текстом", net.tg.some(x => /Голосовое/.test(x.text)) && S.sentTo("77010000001").some(x => /не умею слушать/.test(x)));
  // фото с подписью: подпись обрабатывается как сообщение
  net.reset(); net.ai = [echo];
  await S.waPost("/", { from: "77010000001", type: "image", image: { id: "MEDIA2", mime_type: "image/jpeg", caption: "Хочу такую стрижку" } }, o);
  h = S.hist("wa", "barber", "77010000001");
  ok("фото с подписью: в истории и фото, и подпись, бот отвечает на подпись", h.turns.at(-3).m.id === "MEDIA2" && h.turns.at(-2).text === "Хочу такую стрижку" && h.turns.at(-1).text === "Ответ на: [клиент прислал фото]\nХочу такую стрижку", JSON.stringify(h.turns.slice(-3)));

  // «позовите администратора» → пауза; сообщения клиента на паузе остаются в истории
  net.reset();
  await S.waText("/", "77010000001", "Позовите администратора", o);
  m = S.kv.meta.get("h:wa:barber:77010000001");
  ok("«позовите администратора»: чат помечен «просит администратора», пауза видна в метаданных", m.nd === "human" && m.pu > Date.now(), JSON.stringify(m));
  net.reset();
  await S.waText("/", "77010000001", "Вы тут?", o);
  h = S.hist("wa", "barber", "77010000001");
  ok("на паузе бот молчит, а сообщение клиента остаётся в истории (администратор увидит его в пульте)", S.sentTo("77010000001").length === 0 && h.turns.at(-1).role === "user" && h.turns.at(-1).text === "Вы тут?" && S.kv.meta.get("h:wa:barber:77010000001").d === "u", JSON.stringify(h.turns.slice(-2)));
  ok("…и пересылается администратору в Telegram", net.tg.some(x => /Клиент пишет, бот в этом чате молчит/.test(x.text)));

  // «стоп» → постоянная отметка для рассылок; «старт» её снимает
  net.reset();
  await S.waText("/", "77010000003", "Здравствуйте", o); await S.waText("/", "77010000003", "стоп", o);
  ok("«стоп»: постоянная отметка optout без срока хранения", S.kv.mem.has("optout:barber:77010000003") && !S.kv.ttl.has("optout:barber:77010000003") && S.kv.meta.get("h:wa:barber:77010000003").st === 1);
  await S.waText("/", "77010000003", "старт", o);
  ok("«старт»: отметка снята", !S.kv.mem.has("optout:barber:77010000003"));

  // длинный разговор: хранится 60 реплик, в ИИ уходит не больше 24
  net.reset(); net.ai = ["Хорошо."];
  for (let i = 0; i < 34; i++) await S.waText("/", "77010000004", "Вопрос номер " + i, o);
  h = S.hist("wa", "barber", "77010000004");
  ok("длинный разговор: в хранилище 60 последних реплик, в ИИ — не больше 24", h.turns.length === 60 && net.gemini.at(-1).contents.length <= 24 && h.turns.at(-2).text === "Вопрос номер 33", JSON.stringify([h.turns.length, net.gemini.at(-1).contents.length]));

  // реплики одной стороны подряд (клиент писал, пока бот молчал) в ИИ уходят склеенными
  S.kv.mem.set("h:wa:barber:77010000005", JSON.stringify({ n: 3, turns: [{ role: "user", text: "Первое" }, { role: "model", text: "Ответ" }, { role: "user", text: "Второе" }, { role: "user", text: "Третье" }], profile: {} }));
  net.reset(); net.ai = ["Хорошо."];
  await S.waText("/", "77010000005", "Четвёртое", o);
  const cs = net.gemini.at(-1).contents;
  ok("подряд идущие реплики клиента склеены для ИИ", cs.length === 3 && cs[2].role === "user" && cs[2].parts[0].text === "Второе\nТретье\nЧетвёртое", JSON.stringify(cs));

  // всплеск: 15 сообщений в одном запросе — на 12 бот отвечает, остальные сохранены для администратора
  net.reset(); net.ai = [echo];
  await S.waPost("/", Array.from({ length: 15 }, (_, i) => text("7702000" + String(1000 + i), "Здравствуйте " + i)), { secret: "sec" });
  const answered = Array.from({ length: 15 }, (_, i) => S.sentTo("7702000" + String(1000 + i)).some(x => /^Ответ на/.test(x)));
  const tail = S.hist("wa", "barber", "77020001014");
  ok("всплеск из 15 сообщений: 12 получили ответ, 3 сохранены в чатах с пометкой, администратор предупреждён один раз", answered.filter(Boolean).length === 12 && tail && tail.turns.at(-1).text === "Здравствуйте 14" && tail.profile.need.why === "limit"
    && net.tg.filter(x => /пришло сразу 15 сообщений/.test(x.text)).length === 1, JSON.stringify([answered, tail, net.tg.map(x => x.text.slice(0, 60))]));

  // подпись Meta обязательна, когда задан APP_SECRET
  net.reset();
  const r = await S.waPost("/", text("77010000009", "Привет"), { secret: "wrong" });
  ok("запрос с неверной подписью отклонён", r.status === 403 && net.graph.length === 0);
}

if (process.argv[1] && process.argv[1].endsWith("platform.mjs")) {
  console.log(`\nНовые части: прошло ${T.pass}, не прошло ${T.fail}`);
  process.exit(T.fail ? 1 : 0);
}
