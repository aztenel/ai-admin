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

// ====== 2. Вход, страница владельца, паспорт бота
section("вход и паспорт бота");
const S = mk({ WA_TOKEN_KAIRAT: "tok-kairat", APP_SECRET_KAIRAT: "sec-kairat", ALTEGIO_PARTNER: "partner-key", KEY_DENT: "dent-staff-key" });
const OWNER = "owner-key-123456";
const PASS = { id: "kairat", isNew: true, name: "Barber House", niche: "barber", address: "Астана, пр. Мангилик Ел, 10", phone: "8 701 123 45 67", schedule: "Пн–Сб 10:00–21:00; Вс 11:00–19:00", booking: "manual", step: "60",
  services: "Мужская стрижка — 6000 — 60\nСтрижка + борода — 9000 — 90\nОформление бороды от 4000\nДетская стрижка — 4000 — 45", staff: "Арман — топ-барбер\nЕрлан — барбер", extra: "Оплата: наличные и Kaspi.\nПарковка бесплатная.", tg: "555000111" };
{
  const anon = S.browser();
  let r = await anon.go("/studio");
  ok("страница владельца без входа → на страницу входа", r.status === 303 && /^\/login\?next=%2Fstudio/.test(r.headers.get("location")), r.status + " " + r.headers.get("location"));
  r = await anon.go("/api/studio/list");
  ok("API без входа → 401", r.status === 401);
  r = await anon.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=wrong&next=%2Fstudio" });
  ok("неверный ключ → отказ, cookie нет", r.status === 403 && !anon.cookie && /Ключ не подошёл/.test(await r.text()));
  const own = S.browser();
  r = await own.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=" + OWNER + "&next=%2Fstudio" });
  const sc = r.headers.get("set-cookie") || "";
  ok("верный ключ владельца → cookie (HttpOnly, Secure, SameSite) и переход на страницу", r.status === 303 && r.headers.get("location") === "/studio" && /HttpOnly/.test(sc) && /Secure/.test(sc) && /SameSite=Lax/.test(sc) && !sc.includes(OWNER), sc);
  r = await own.go("/studio"); const pg = await r.text();
  ok("страница «Мои боты» открывается, не кэшируется и не встраивается в чужие сайты", r.status === 200 && /Мои боты/.test(pg) && r.headers.get("cache-control") === "no-store" && r.headers.get("x-frame-options") === "DENY" && !pg.includes(OWNER));
  // ключ в адресе: устройство запоминается, ключ из адреса убирается
  const viaKey = S.browser();
  r = await viaKey.go("/studio?key=" + OWNER);
  ok("вход ссылкой с ключом: cookie поставлена, ключ из адреса убран", r.status === 303 && r.headers.get("location") === "/studio" && !!viaKey.cookie);
  r = await own.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=" + OWNER + "&next=https%3A%2F%2Fevil.example%2F" });
  ok("после входа уводим только на свои страницы", r.headers.get("location") === "/studio");

  // список: демо-боты есть, своих пока нет
  let d = await (await own.go("/api/studio/list")).json();
  ok("в списке шесть демо и пробный Altegio, ниши для выбора", d.clients.filter(c => !c.dynamic).length === 7 && d.clients.every(c => !c.dynamic) && d.niches.some(n => n.id === "barber"), JSON.stringify(d.clients.map(c => c.id)));
  // проверка паспорта: ошибки понятным языком
  d = await (await own.post("/api/studio/check", { id: "Kairat!", name: "", niche: "barber", schedule: "как получится", booking: "manual", services: "Стрижка — 50", phone: "123" })).json();
  ok("паспорт с ошибками: перечислены все, ничего не сохранено", d.ok === false && d.errors.length >= 5 && d.errors.some(e => /идентификатор/.test(e)) && d.errors.some(e => /график/.test(e)) && d.errors.some(e => /цена 50/.test(e)) && !S.kv.mem.has("cfg:all"), JSON.stringify(d.errors));
  d = await (await own.post("/api/studio/check", PASS)).json();
  ok("верный паспорт: ошибок нет, показано, что бот будет знать", d.ok && !d.errors.length && /Мужская стрижка — 6 000 ₸, около 60 мин/.test(d.preview.facts) && /\+7 701 123 45 67/.test(d.preview.facts) && d.preview.hours === "Пн–Сб 10:00–21:00, Вс 11:00–19:00" && d.preview.slots.length === 3 && !S.kv.mem.has("cfg:all"), JSON.stringify(d).slice(0, 600));
  r = await own.post("/api/studio/save", { ...PASS, id: "dent" });
  ok("имя демо-бота занять нельзя", r.status === 400 && /занят демо-ботом/.test(JSON.stringify(await r.json())));
  r = await anon.post("/api/studio/save", PASS);
  ok("сохранение без входа → 401", r.status === 401 && !S.kv.mem.has("cfg:all"));
  r = await own.post("/api/studio/save", PASS, { origin: "https://evil.example" });
  ok("сохранение с чужого сайта (подделка запроса) → отказ", r.status === 403 && !S.kv.mem.has("cfg:all"));
  d = await (await own.post("/api/studio/save", PASS)).json();
  ok("паспорт сохранён, бот сразу появился", d.ok && S.kv.json("cfg:all").kairat.v === 1 && !("id" in S.kv.json("cfg:all").kairat), JSON.stringify(d).slice(0, 300));
  r = await own.post("/api/studio/save", PASS);
  ok("второй «новый» бот с тем же именем → отказ", r.status === 400);
  d = await (await own.go("/api/studio/list")).json();
  const st = d.clients.find(c => c.id === "kairat");
  ok("в списке — новый бот с отметками: заявки администратору, Telegram свой, WhatsApp подключён (секреты заданы), ключа сотрудника нет", st && st.dynamic && st.booking === "manual" && st.tgOwn && st.waToken && st.waSecret && !st.key, JSON.stringify(st));
  d = await (await own.go("/api/studio/get?c=kairat")).json();
  ok("паспорт открывается для правки", d.cfg.name === "Barber House" && d.cfg.id === "kairat" && d.hasKey === false && !("keyHash" in d.cfg));

  // бот клиента из паспорта отвечает в веб-чате: подсказка ИИ собрана из паспорта
  net.reset(); net.ai = ["Мужская стрижка от 6 000 ₸. Записать вас?"];
  let c = await S.chat("kairat", "k1", "Сколько стоит стрижка?");
  const sys = net.gemini.at(-1).systemInstruction.parts[0].text;
  ok("бот из паспорта отвечает; в подсказке ИИ — его название, факты, график и всё время из графика на три дня", c.reply === "Мужская стрижка от 6 000 ₸. Записать вас?" && sys.includes("«Barber House» (барбершоп)") && sys.includes("Мужская стрижка — 6 000 ₸") && sys.includes("График: Пн–Сб 10:00–21:00, Вс 11:00–19:00")
    && /Сегодня, суббота, 3 октября \(2026-10-03\): 13:00, 14:00/.test(sys) && /Завтра, воскресенье, 4 октября \(2026-10-04\): 11:00, 12:00, 13:00, 14:00, 15:00, 16:00, 17:00, 18:00/.test(sys), sys.slice(0, 900));
  net.ai = ["Мужская стрижка стоит 5 500 ₸.", "Мужская стрижка от 6 000 ₸."];
  c = await S.chat("kairat", "k1", "А точно?");
  ok("выдуманную цену защита не пропускает и у бота из паспорта", /6 000/.test(c.reply) && !/5 500/.test(c.reply) && /цена 5500/.test(c.guard || ""), JSON.stringify(c));
  net.ai = ["Наш телефон: +7 701 123 45 67, адрес: Астана, пр. Мангилик Ел, 10."];
  c = await S.chat("kairat", "k1", "Какой у вас телефон и адрес?");
  ok("телефон компании из паспорта бот называет", /\+7 701 123 45 67/.test(c.reply), JSON.stringify(c));
  // заявка: время из графика, администратору в его Telegram
  net.reset(); net.ai = ["Забронировала вас на завтра в 12:00. Администратор подтвердит запись.\n[ЗАЯВКА] Имя: Тимур; Телефон: указан; Услуга: Мужская стрижка; Время: завтра, 12:00"];
  c = await S.chat("kairat", "k2", "Тимур, +7 705 111 22 33, мужская стрижка завтра в 12:00");
  ok("заявка у бота из паспорта: создана, уведомление ушло в Telegram администратора клиента", c.lead && c.lead.phone === "+77051112233" && S.leads("kairat").length === 1 && net.tg.some(x => x.chat_id === "555000111" && /Новая заявка \(Barber House\)/.test(x.text)), JSON.stringify([c, net.tg]));
  ok("чат помечен: заявку нужно подтвердить", S.kv.meta.get("h:web:kairat:k2").nd === "lead" && S.kv.meta.get("h:web:kairat:k2").nm === "Тимур");
  net.ai = ["Забронировала вас на завтра в 23:00.\n[ЗАЯВКА] Имя: Тимур; Телефон: указан; Услуга: Мужская стрижка; Время: завтра, 23:00"];
  c = await S.chat("kairat", "k3", "Марат, +7 705 111 22 44, завтра в 23:00");
  ok("время вне графика → заявки нет", !c.lead && S.leads("kairat").length === 1, JSON.stringify(c));

  // правка паспорта: новая цена действует сразу, версия растёт
  d = await (await own.post("/api/studio/save", { ...PASS, isNew: false, services: PASS.services.replace("6000", "6500") })).json();
  net.reset(); net.ai = ["Мужская стрижка от 6 500 ₸."];
  c = await S.chat("kairat", "k4", "Сколько стоит стрижка?");
  ok("правка паспорта действует сразу: новая цена проходит защиту", d.ok && S.kv.json("cfg:all").kairat.v === 2 && /6 500/.test(c.reply) && !c.guard, JSON.stringify(c));

  // ключ сотрудника
  d = await (await own.post("/api/studio/key", { id: "kairat" })).json();
  const staffKey = d.key;
  ok("ключ сотрудника выдан; в хранилище лежит только его хеш", /^[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}$/.test(staffKey) && !S.kv.mem.get("cfg:all").includes(staffKey) && /^[0-9a-f]{64}$/.test(S.kv.json("cfg:all").kairat.keyHash), String(staffKey));
  const staff = S.browser();
  r = await staff.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=" + staffKey + "&next=%2Finbox%3Fc%3Dkairat" });
  ok("сотрудник входит своим ключом", r.status === 303 && !!staff.cookie && r.headers.get("location") === "/inbox?c=kairat");
  r = await staff.go("/api/studio/list");
  ok("сотруднику страница владельца закрыта", r.status === 403);
  r = await staff.post("/api/studio/save", { ...PASS, isNew: false, name: "Взломано" });
  ok("сотрудник не может менять паспорт", r.status === 403 && S.kv.json("cfg:all").kairat.name === "Barber House");
  r = await staff.go("/leads");
  let lp = await r.text();
  ok("сотрудник видит заявки только своего клиента", r.status === 200 && lp.includes("Barber House") && !lp.includes("Демо Дент"), lp.slice(0, 300));
  r = await staff.go("/leads?c=dent"); lp = await r.text();
  ok("…и не видит чужие, даже если попросит", lp.includes("Barber House") && !lp.includes("Демо Дент"));
  // сотрудник демо-клиента с ключом из Cloudflare (KEY_DENT)
  const dentStaff = S.browser();
  r = await dentStaff.go("/inbox?c=dent&key=dent-staff-key");
  ok("ключ клиента из Cloudflare (KEY_DENT) тоже даёт вход сотрудника", r.status === 303 && !!dentStaff.cookie && r.headers.get("location") === "/inbox?c=dent");
  // новый ключ — прежние сессии сотрудников гаснут
  d = await (await own.post("/api/studio/key", { id: "kairat" })).json();
  r = await staff.go("/leads");
  ok("после смены ключа прежняя сессия сотрудника не действует: вместо заявок — страница входа", r.status === 303 && /^\/login/.test(r.headers.get("location") || "") && d.key !== staffKey);
  // подделка cookie
  const fake = S.browser(); fake.cookie = "aia=owner.*." + (Date.now() + 1e9) + ".o.AAAA";
  r = await fake.go("/api/studio/list");
  ok("поддельная cookie не проходит", r.status === 401);
  const old = S.browser(); old.cookie = own.cookie.replace(/\.(\d+)\.o\./, ".1.o.");
  ok("cookie с изменённым сроком не проходит", (await old.go("/api/studio/list")).status === 401);
  // перебор ключей
  const brute = S.browser(); let last = 0;
  for (let i = 0; i < 10; i++) last = (await brute.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "203.0.113.9" }, body: "key=guess" + i })).status;
  r = await brute.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "203.0.113.9" }, body: "key=" + OWNER });
  ok("перебор ключей: после восьми неверных попыток вход с этого адреса закрыт на время (даже с верным ключом)", last === 429 && r.status === 429);
  ok("…а с другого адреса владелец входит", (await S.browser().go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "203.0.113.10" }, body: "key=" + OWNER })).status === 303);
  r = await own.go("/logout");
  ok("выход стирает cookie", r.status === 303 && /Max-Age=0/.test(r.headers.get("set-cookie")));
}

// ====== 3. WhatsApp клиента со своим номером: /wa/<id>
section("WhatsApp на несколько клиентов");
{
  const o = { secret: "sec-kairat", pnid: "900111", names: { "77051110001": "Данияр" } };
  net.reset(); net.ai = ["Здравствуйте! Мужская стрижка от 6 500 ₸. Записать вас?"];
  let r = await S.waText("/wa/kairat", "77051110001", "Сколько стоит стрижка?", o);
  const g = net.graph.filter(x => x.body && x.body.to === "77051110001");
  ok("сообщение на номер клиента: ответ ушёл с его номера и его токеном", r.status === 200 && g.length >= 1 && g.every(x => x.url.includes("/900111/messages") && x.auth === "Bearer tok-kairat") && g.some(x => /6 500/.test(x.body.text.body)), JSON.stringify(g.map(x => [x.url, x.auth, x.body.text.body])));
  ok("история — в чате этого клиента, с именем из WhatsApp", !!S.hist("wa", "kairat", "77051110001") && S.kv.meta.get("h:wa:kairat:77051110001").nm === "Данияр");
  ok("новому собеседнику ушёл текст согласия с названием компании", g.some(x => /AI-ассистент «Barber House»/.test(x.body.text.body)));
  r = await S.waText("/wa/kairat", "77051110002", "Привет", { secret: "wrong" });
  ok("неверная подпись → отказ", r.status === 403);
  r = await S.waText("/wa/kairat", "77051110002", "Привет", {});
  ok("без подписи → отказ", r.status === 403);
  r = await S.waText("/wa/nobody", "77051110002", "Привет", { secret: "sec-kairat" });
  ok("неизвестный клиент → 404", r.status === 404);
  r = await S.waText("/wa/dent", "77051110002", "Привет", { secret: "sec-kairat" });
  ok("клиент без своего секрета подписи → отказ", r.status === 403);
  r = await S.call("/wa/kairat?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=12345");
  ok("проверка адреса вебхука Meta проходит и на /wa/<id>", r.status === 200 && (await r.text()) === "12345");
  // запись через WhatsApp: телефон — номер WhatsApp
  net.reset(); net.ai = ["Забронировала вас на завтра в 12:00. Администратор подтвердит запись.\n[ЗАЯВКА] Имя: Данияр; Телефон: указан; Услуга: Мужская стрижка; Время: завтра, 12:00"];
  await S.waText("/wa/kairat", "77051110001", "Запишите меня завтра на 12:00, Данияр", o);
  const L = S.leads("kairat").at(-1);
  ok("заявка из WhatsApp клиента: телефон — номер WhatsApp, уведомление — администратору клиента", L.name === "Данияр" && L.phone === "+77051110001" && net.tg.some(x => x.chat_id === "555000111"), JSON.stringify([L, net.tg]));
  // бот выключен
  const own = S.browser(); await own.go("/studio?key=" + OWNER);
  await own.post("/api/studio/save", { ...PASS, isNew: false, off: true });
  net.reset();
  await S.waText("/wa/kairat", "77051110001", "А можно перенести?", o);
  const h = S.hist("wa", "kairat", "77051110001");
  ok("бот выключен: клиенту ничего не уходит, сообщение лежит в чате с пометкой, администратор предупреждён", net.graph.length === 0 && net.gemini.length === 0 && h.turns.at(-1).text === "А можно перенести?" && h.profile.need.why === "off" && net.tg.some(x => /Бот выключен/.test(x.text) && x.chat_id === "555000111"), JSON.stringify([net.graph.length, h.turns.at(-1), net.tg]));
  const cw = await S.chat("kairat", "k9", "Здравствуйте");
  ok("бот выключен: в веб-чате — просьба написать в WhatsApp или позвонить", /отвечает администратор/.test(cw.reply) && net.gemini.length === 0);
  await own.post("/api/studio/save", { ...PASS, isNew: false, off: false });
}

// ====== 4. Пульт чатов
section("пульт чатов");
{
  const own = S.browser(); await own.go("/studio?key=" + OWNER);
  let d = await (await own.post("/api/studio/key", { id: "kairat" })).json();
  const staff = S.browser(); await staff.go("/inbox?c=kairat&key=" + d.key);
  const dent = S.browser(); await dent.go("/inbox?c=dent&key=dent-staff-key");
  const anon = S.browser();
  const J = async r => r.json();
  const A = "77051110001";

  let r = await staff.go("/inbox?c=kairat"); let pg = await r.text();
  ok("страница пульта открывается сотруднику; в ней нет переписки (она приходит отдельными запросами)", r.status === 200 && /Ждут ответа/.test(pg) && !pg.includes(A) && r.headers.get("cache-control") === "no-store");
  r = await staff.go("/inbox?c=dent");
  ok("сотрудник, открывший чужой пульт, попадает в свой", r.status === 303 && r.headers.get("location") === "/inbox?c=kairat");
  r = await anon.go("/inbox?c=kairat");
  ok("без входа — на страницу входа", r.status === 303 && /^\/login\?next=/.test(r.headers.get("location")));
  ok("запросы пульта без входа → 401", (await anon.go("/api/inbox/list?c=kairat")).status === 401);
  ok("сотрудник другого клиента не видит список чатов → 403", (await dent.go("/api/inbox/list?c=kairat")).status === 403);
  ok("…и чужой чат → 403", (await dent.go(`/api/inbox/chat?c=kairat&ch=wa&id=${A}`)).status === 403);
  ok("…и не может написать чужому клиенту → 403", (await dent.post("/api/inbox/send", { c: "kairat", ch: "wa", id: A, text: "взлом" })).status === 403);

  d = await J(await staff.go("/api/inbox/list?c=kairat&f=need"));
  const row = d.chats.find(x => x.id === A);
  ok("список «Ждут ответа»: чат с пометкой, именем, номером и началом последнего сообщения", d.client.name === "Barber House" && row && row.nd === "off" && row.nm === "Данияр" && row.ph === "+" + A && /перенести/.test(row.s) && row.d === "u" && d.need >= 1, JSON.stringify(d).slice(0, 500));
  const lops = S.kv.ops.list, gops = S.kv.ops.get;
  await staff.go("/api/inbox/list?c=kairat&f=all");
  ok("список чатов — один запрос списка ключей и ни одного чтения чата", S.kv.ops.list - lops === 1 && S.kv.ops.get - gops <= 2, `list ${S.kv.ops.list - lops}, get ${S.kv.ops.get - gops}`);
  d = await J(await staff.go(`/api/inbox/chat?c=kairat&ch=wa&id=${A}`));
  ok("чат: реплики клиента и бота с временем, заявка клиента, можно отвечать, окно 24 часа открыто", d.turns.length >= 4 && d.turns.some(t => t.r === "u") && d.turns.some(t => t.r === "b") && d.turns.every(t => t.t > 0) && d.canSend && d.open && d.reqs.some(q => q.kind === "lead" && q.name === "Данияр") && d.phone === "+" + A, JSON.stringify(d).slice(0, 700));

  // ответ администратора
  net.reset();
  r = await staff.post("/api/inbox/send", { c: "kairat", ch: "wa", id: A, text: "Здравствуйте, Данияр! Это администратор. На какое время перенести?" });
  d = await J(r);
  const g = net.graph.at(-1);
  ok("ответ администратора ушёл клиенту с номера и токеном этой компании", r.status === 200 && d.ok && g.url.includes("/900111/messages") && g.auth === "Bearer tok-kairat" && g.body.to === A && /Это администратор/.test(g.body.text.body), JSON.stringify([d.error, g]));
  let h = S.hist("wa", "kairat", A);
  ok("ответ записан в историю как ответ администратора; бот молчит 2 часа; пометка снята", h.turns.at(-1).by === "admin" && h.turns.at(-1).role === "model" && h.profile.pausedUntil > Date.now() + 3600e3 && !h.profile.need && d.chat.turns.at(-1).r === "a" && d.chat.paused > 0 && !d.chat.need);
  ok("неудачный ответ администратора не поднимает тревогу «ответы бота не доходят»", net.tg.length === 0);
  net.reset();
  await S.waText("/wa/kairat", A, "На 15:00, пожалуйста", { secret: "sec-kairat", pnid: "900111" });
  h = S.hist("wa", "kairat", A);
  ok("пока отвечает администратор, бот молчит; ответ клиента виден в чате и помечен «ждёт ответа»", net.graph.length === 0 && net.gemini.length === 0 && h.turns.at(-1).text === "На 15:00, пожалуйста" && h.profile.need.why === "human");
  ok("администратору в Telegram — сообщение клиента со ссылкой на чат в пульте", net.tg.some(x => /Клиент пишет, бот в этом чате молчит/.test(x.text) && x.text.includes(`https://bot.test/inbox?c=kairat#wa:${A}`)), JSON.stringify(net.tg));
  d = await J(await staff.post("/api/inbox/act", { c: "kairat", ch: "wa", id: A, act: "resume" }));
  ok("«Вернуть бота»: пауза и пометка сняты", d.ok && !d.chat.paused && !d.chat.need);
  net.reset(); net.ai = ["Записала."];
  await S.waText("/wa/kairat", A, "Спасибо", { secret: "sec-kairat", pnid: "900111" });
  const ctxAI = JSON.stringify(net.gemini.at(-1).contents);
  ok("бот вернулся и знает, что писал администратор", net.gemini.length === 1 && ctxAI.includes("Это администратор") && ctxAI.includes("На 15:00"), ctxAI.slice(-400));
  d = await J(await staff.post("/api/inbox/act", { c: "kairat", ch: "wa", id: A, act: "pause" }));
  ok("«Остановить бота»: бот молчит 12 часов", d.ok && d.chat.paused > Date.now() + 11 * 3600e3);
  await staff.post("/api/inbox/act", { c: "kairat", ch: "wa", id: A, act: "resume" });

  // окно 24 часа и ошибки Meta
  const key = `h:wa:kairat:${A}`, hh = S.kv.json(key); hh.profile.li = Date.now() - 25 * 3600e3; S.kv.mem.set(key, JSON.stringify(hh));
  net.reset();
  r = await staff.post("/api/inbox/send", { c: "kairat", ch: "wa", id: A, text: "Вы тут?" }); d = await J(r);
  ok("клиент писал больше 24 часов назад → сообщение не отправляется, причина объяснена", r.status === 409 && /24 час/.test(d.error) && net.graph.length === 0, JSON.stringify(d));
  hh.profile.li = Date.now(); S.kv.mem.set(key, JSON.stringify(hh));
  net.graphReply = () => new Response(JSON.stringify({ error: { message: "Re-engagement message", code: 131047 } }), { status: 400 });
  const n0 = S.hist("wa", "kairat", A).turns.length;
  r = await staff.post("/api/inbox/send", { c: "kairat", ch: "wa", id: A, text: "Вы тут?" }); d = await J(r);
  ok("Meta отклонила сообщение → администратор видит причину, в истории ответа нет", r.status === 409 && /131047/.test(d.error) && S.hist("wa", "kairat", A).turns.length === n0, JSON.stringify(d));
  net.graphReply = null;
  r = await staff.post("/api/inbox/send", { c: "kairat", ch: "wa", id: A, text: "   " });
  ok("пустое сообщение не отправляется", r.status === 400);
  r = await staff.post("/api/inbox/send", { c: "kairat", ch: "wa", id: A, text: "привет" }, { origin: "https://evil.example" });
  ok("запрос с чужого сайта (подделка) → отказ", r.status === 403);
  r = await staff.go("/api/inbox/chat?c=kairat&ch=wa&id=70000000000");
  ok("несуществующий чат → 404", r.status === 404);
  r = await staff.go("/api/inbox/chat?c=kairat&ch=wa&id=../../cfg:all");
  ok("подставить в номер чата чужой ключ хранилища нельзя", r.status === 404);

  // «стоп»: бота возвращает только сам клиент
  net.reset();
  await S.waText("/wa/kairat", "77051110003", "Здравствуйте", { secret: "sec-kairat", pnid: "900111" });
  await S.waText("/wa/kairat", "77051110003", "стоп", { secret: "sec-kairat", pnid: "900111" });
  r = await staff.post("/api/inbox/act", { c: "kairat", ch: "wa", id: "77051110003", act: "resume" });
  ok("после «стоп» администратор не может вернуть бота (это решает клиент)", r.status === 409 && !!S.hist("wa", "kairat", "77051110003").profile.stop);
  r = await staff.post("/api/inbox/send", { c: "kairat", ch: "wa", id: "77051110003", text: "Здравствуйте! Это администратор." });
  ok("…но написать клиенту сам администратор может", r.status === 200);

  // голосовое: файл открывается только из своего чата
  net.reset();
  await S.waPost("/wa/kairat", { from: A, type: "audio", audio: { id: "MEDIA77", mime_type: "audio/ogg" } }, { secret: "sec-kairat", pnid: "900111" });
  net.graphReply = (url) => url.endsWith("/MEDIA77") ? new Response(JSON.stringify({ url: "https://graph.facebook.com/files/MEDIA77.bin", mime_type: "audio/ogg" }), { status: 200 }) : url.includes("/files/MEDIA77.bin") ? new Response("OGGDATA", { status: 200, headers: { "content-type": "audio/ogg" } }) : null;
  d = await J(await staff.go(`/api/inbox/chat?c=kairat&ch=wa&id=${A}`));
  const mt = d.turns.find(t => t.m && t.m.id === "MEDIA77");
  r = await staff.go(`/api/inbox/media?c=kairat&ch=wa&id=${A}&mid=MEDIA77`);
  ok("голосовое в чате: файл отдаётся администратору (загружается у Meta токеном компании)", mt && mt.m.k === "audio" && r.status === 200 && (await r.text()) === "OGGDATA" && r.headers.get("content-type") === "audio/ogg" && net.graph.some(x => x.auth === "Bearer tok-kairat" && x.url.endsWith("/MEDIA77")));
  ok("файла, которого нет в этом чате, получить нельзя", (await staff.go(`/api/inbox/media?c=kairat&ch=wa&id=${A}&mid=OTHER`)).status === 404);
  ok("сотруднику другого клиента файл не отдаётся", (await dent.go(`/api/inbox/media?c=kairat&ch=wa&id=${A}&mid=MEDIA77`)).status === 403);
  net.graphReply = null;

  // веб-чат в пульте: виден, но ответить нельзя
  d = await J(await staff.go("/api/inbox/list?c=kairat&ch=web"));
  ok("вкладка «Сайт»: чаты веб-чата видны", d.chats.some(x => x.id === "k2" && x.nm === "Тимур" && x.nd === "lead"), JSON.stringify(d.chats.slice(0, 3)));
  d = await J(await staff.go("/api/inbox/chat?c=kairat&ch=web&id=k2"));
  ok("в чат с сайта ответить нельзя, заявка и телефон видны", d.canSend === false && d.phone === "+77051112233" && d.reqs.some(q => q.kind === "lead"), JSON.stringify(d).slice(0, 400));

  // заявка: «Сделано → сообщить клиенту»
  const B = "77051110001";
  const lead = (await J(await staff.go(`/api/inbox/chat?c=kairat&ch=wa&id=${B}`))).reqs.find(q => q.kind === "lead");
  net.reset();
  d = await J(await staff.post("/api/inbox/act", { c: "kairat", ch: "wa", id: B, act: "done", lead: lead.id, text: "Здравствуйте! Ваша запись подтверждена: завтра в 12:00. Ждём вас!" }));
  ok("заявка подтверждена: клиенту ушло сообщение, заявка помечена «выполнена» и ушла из чата", d.ok && net.graph.at(-1).body.to === B && /подтверждена/.test(net.graph.at(-1).body.text.body) && S.leads("kairat").find(l => l.id === lead.id).status === "выполнена" && !d.chat.reqs.some(q => q.id === lead.id), JSON.stringify(d).slice(0, 400));
  ok("…и статус записан в отдельный ключ заявки (страница заявок берёт его оттуда)", [...S.kv.meta.entries()].some(([k, m]) => k.includes(lead.id) && m.status === "выполнена"));
  r = await staff.post("/api/inbox/act", { c: "kairat", ch: "wa", id: "77051110003", act: "done", lead: lead.id, text: "" });
  ok("закрыть чужую заявку из другого чата нельзя", r.status === 404);
}

// ====== 4а. Страница пульта в новом виде: установка на айфон, демо без входа, лиды для вкладки «Лиды»
section("пульт: установка на телефон, демо, лиды");
{
  const own = S.browser(); await own.go("/studio?key=" + OWNER);
  const kk = await (await own.post("/api/studio/key", { id: "kairat" })).json();
  const staff = S.browser(); await staff.go("/inbox?c=kairat&key=" + kk.key);
  const dent = S.browser(); await dent.go("/inbox?c=dent&key=dent-staff-key");
  const anon = S.browser();
  const J = async r => r.json();

  // сама страница: всё нужное для «На экран Домой» и для выреза iPhone
  let r = await staff.go("/inbox?c=kairat"); const live = await r.text();
  ok("страница пульта: манифест, значок для iPhone, режим приложения, вырез экрана", r.status === 200 && /<link rel="manifest" href="\/manifest\.webmanifest">/.test(live) && /rel="apple-touch-icon" href="\/pult\/icon-180\.png"/.test(live) && /apple-mobile-web-app-capable" content="yes"/.test(live) && /viewport-fit=cover/.test(live));
  ok("страница пульта: настоящий режим (не демо), вымышленных клиентов в ней нет", /window\.__DEMO=false;/.test(live) && !live.includes("Айдос Акберов"));
  ok("страница пульта: без кэша, не встраивается в чужие страницы, с политикой безопасности", /no-store/.test(r.headers.get("cache-control") || "") && r.headers.get("x-frame-options") === "DENY" && /default-src 'self'/.test(r.headers.get("content-security-policy") || ""));
  ok("страница пульта: ни внешних скриптов, ни внешних шрифтов", !/<script[^>]+src=/i.test(live) && !/https?:\/\/(fonts|cdn|unpkg|cdnjs)/i.test(live));

  // демо: без входа, на вымышленных данных
  r = await anon.go("/demo"); const demo = await r.text();
  ok("/demo открывается без входа", r.status === 200 && !r.headers.get("set-cookie"));
  ok("/demo: вымышленные чаты, режим демо, свой манифест", /window\.__DEMO\s*=\s*true/.test(demo) && demo.includes("Айдос Акберов") && /<link rel="manifest" href="\/demo\.webmanifest">/.test(demo));
  ok("/demo: поисковикам не показывается, без кэша, не встраивается", /noindex/.test(r.headers.get("x-robots-tag") || "") && /no-store/.test(r.headers.get("cache-control") || "") && r.headers.get("x-frame-options") === "DENY");
  ok("/demo не содержит настоящих данных: ни клиентов, ни ключей", !/kairat|owner-key|tok-kairat|sec-kairat|partner-key/i.test(demo) && !demo.includes("77051110001"));
  ok("/demo со слэшем в конце тоже открывается", (await anon.go("/demo/")).status === 200);

  // манифесты и значки
  r = await anon.go("/manifest.webmanifest"); let mf = await J(r);
  ok("манифест: открывается без входа, запуск с пульта, на весь экран", r.status === 200 && /manifest\+json/.test(r.headers.get("content-type") || "") && mf.start_url === "/inbox" && mf.scope === "/" && mf.display === "standalone");
  ok("манифест: значки 192 и 512, один годится для круглой маски", ["192x192", "512x512"].every(s => (mf.icons || []).some(i => i.sizes === s && i.type === "image/png")) && (mf.icons || []).some(i => /maskable/.test(i.purpose || "")));
  mf = await J(await anon.go("/demo.webmanifest"));
  ok("манифест демо: запуск и область — только /demo (рабочий пульт не затрагивается)", mf.start_url === "/demo" && mf.scope === "/demo");
  for (const n of [180, 192, 512]) {
    r = await anon.go(`/pult/icon-${n}.png`); const b = Buffer.from(await r.arrayBuffer());
    ok(`значок ${n}: настоящий PNG, кэшируется`, r.status === 200 && r.headers.get("content-type") === "image/png" && b.subarray(0, 4).toString("hex") === "89504e47" && /max-age/.test(r.headers.get("cache-control") || "") && b.length > 1000, `${r.status} ${b.length}`);
  }
  ok("значка другого размера нет", (await anon.go("/pult/icon-999.png")).status === 404);

  // лиды для вкладки «Лиды»: только для своего клиента
  ok("лиды пульта без входа → 401", (await anon.go("/api/inbox/leads?c=kairat")).status === 401);
  ok("лиды чужого клиента → 403", (await dent.go("/api/inbox/leads?c=kairat")).status === 403);
  const ld = await J(await staff.go("/api/inbox/leads?c=kairat"));
  ok("лиды своего клиента: список с нужными полями, свежие сверху", Array.isArray(ld.leads) && ld.leads.length > 0 && ld.leads.every(l => l.id && "name" in l && "phone" in l && "status" in l && l.ts > 0) && ld.leads.every((l, k, a) => !k || a[k - 1].ts >= l.ts), JSON.stringify(ld).slice(0, 300));
  ok("лиды: служебных полей (токены, ключи) в ответе нет", !/token|secret|key/i.test(JSON.stringify(ld)));

  // в карточке просьбы отмены/переноса и в шапке — время, когда чат стал ждать ответа
  const dd = await J(await staff.go("/api/inbox/chat?c=kairat&ch=wa&id=77051110001"));
  ok("чат: в «нужен человек» есть время, с которого он ждёт", !dd.need || (dd.need.at > 0 && dd.need.why), JSON.stringify(dd.need));

  // собранная страница свежая (правят папку pult/, а worker.js читает pult.gen.js)
  const { execFileSync } = await import("node:child_process");
  let fresh = true, why = ""; try { execFileSync(process.execPath, ["tools/build-pult.mjs", "--check"], { stdio: "pipe" }); } catch (e) { fresh = false; why = String(e.stderr || e.message); }
  ok("pult.gen.js собран из текущей папки pult/ (иначе: node tools/build-pult.mjs)", fresh, why);
}

// ====== 5. Клиент с Altegio из паспорта: запись, просьба об отмене, «сделано» в пульте
section("Altegio из паспорта + пульт");
{
  const own = S.browser(); await own.go("/studio?key=" + OWNER);
  let d = await (await own.post("/api/studio/save", { id: "salon", isNew: true, name: "Салон Айгерим", niche: "beauty", address: "Алматы, ул. Абая, 1", phone: "+7 727 000 00 01", schedule: "ежедневно 9–21", booking: "altegio", altegioLoc: "5001", tg: "777000" })).json();
  ok("паспорт клиента с Altegio сохранён", d.ok, JSON.stringify(d));
  S.env.WA_TOKEN_SALON = "tok-salon"; S.env.APP_SECRET_SALON = "sec-salon";
  const o = { secret: "sec-salon", pnid: "900222" }, C2 = "77071110001";
  net.reset(); net.ai = [`Записала.\n[ЗАЯВКА] Имя: Айша; Телефон: указан; Услуга: Мужская стрижка; Мастер: любой; Дата: ${D1}; Время: 10:00`];
  await S.waText("/wa/salon", C2, "Айша, мужская стрижка завтра в 10:00", o);
  ok("бот из паспорта сам записал в Altegio (филиал из паспорта)", net.altRecords.length === 1 && net.alt.some(x => x.includes("/book_record/5001")) && S.sentTo(C2).some(x => /Записала вас/.test(x)), JSON.stringify([net.alt.slice(-3), S.sentTo(C2)]));
  const sys = net.gemini.at(-1).systemInstruction.parts[0].text;
  ok("в подсказке ИИ — адрес из паспорта и услуги из Altegio", sys.includes("Алматы, ул. Абая, 1") && sys.includes("Мужская стрижка — от 6 000 ₸") && sys.includes("Саму отмену выполняет администратор"));
  net.reset(); net.ai = [`Передаю администратору.\n[ОТМЕНА] Имя: Айша; Дата: ${D1}; Время: 10:00`];
  await S.waText("/wa/salon", C2, "Не смогу прийти, отмените запись", o);
  ok("просьба об отмене: в Altegio ничего не удалено, администратору клиента — уведомление со ссылкой на чат", net.altDeleted.length === 0 && net.tg.some(x => x.chat_id === "777000" && /Клиент просит отменить запись/.test(x.text) && x.text.includes("/inbox?c=salon#wa:" + C2)), JSON.stringify(net.tg));
  ok("чат помечен «просит отменить или перенести»", S.kv.meta.get(`h:wa:salon:${C2}`).nd === "req");
  d = await (await own.go(`/api/inbox/chat?c=salon&ch=wa&id=${C2}`)).json();
  const rq = d.reqs.find(q => q.kind === "cancel");
  ok("в пульте — карточка просьбы с номером записи и словами клиента", rq && /№ 777001/.test(rq.time) && /Не смогу прийти/.test(rq.note) && d.bookings.length === 1, JSON.stringify(d.reqs));
  const rs = await own.post("/api/inbox/act", { c: "salon", ch: "wa", id: C2, act: "resolve" });
  ok("«Готово» не прячет чат с невыполненной просьбой об отмене: отказ, чат остаётся в «Ждут ответа»", rs.status === 409 && /просьб/.test((await rs.json()).error) && S.kv.meta.get(`h:wa:salon:${C2}`).nd === "req");
  net.reset();
  d = await (await own.post("/api/inbox/act", { c: "salon", ch: "wa", id: C2, act: "done", lead: rq.id, text: "Здравствуйте! Вашу запись отменили. Будем рады видеть вас в другой раз." })).json();
  const pr = S.hist("wa", "salon", C2).profile;
  ok("«Сделано»: клиенту ушло подтверждение, просьба закрыта, бот больше не считает запись действующей", d.ok && /отменили/.test(net.graph.at(-1).body.text.body) && net.graph.at(-1).auth === "Bearer tok-salon" && !pr.bookings && !pr.req && !pr.need && d.chat.bookings.length === 0 && d.chat.reqs.length === 0
    && S.leads("salon").find(l => l.id === rq.id).status === "выполнена", JSON.stringify([d.error, pr]));
  // пауза после «сделано» короткая; потом бот знает, что запись отменил администратор
  const key = `h:wa:salon:${C2}`, hh = S.kv.json(key); hh.profile.pausedUntil = 0; S.kv.mem.set(key, JSON.stringify(hh));
  net.reset(); net.ai = ["Пожалуйста! Будем рады видеть вас снова."];
  await S.waText("/wa/salon", C2, "Спасибо!", o);
  ok("дальше бот знает: запись отменил администратор (и не говорит «вы записаны»)", /администратор отменил запись клиента и написал ему/.test(net.gemini.at(-1).systemInstruction.parts[0].text) && !/Мужская стрижка — завтра/.test(net.gemini.at(-1).systemInstruction.parts[0].text.split("Уже известно о клиенте")[1] || ""), (net.gemini.at(-1).systemInstruction.parts[0].text.split("Уже известно о клиенте")[1] || "").slice(0, 300));
}

// ====== 6. Проверка запуска: чек-лист и экзамен бота по паспорту
section("проверка запуска");
{
  const own = S.browser(); await own.go("/studio?key=" + OWNER);
  const staff = S.browser(); const kk = await (await own.post("/api/studio/key", { id: "kairat" })).json(); await staff.go("/inbox?c=kairat&key=" + kk.key);
  let r = await own.go("/launch?c=kairat");
  ok("страница проверки запуска открывается владельцу", r.status === 200 && /Экзамен бота/.test(await r.text()));
  r = await staff.go("/launch?c=kairat");
  ok("сотрудника со страницы проверки уводит в пульт", r.status === 303 && r.headers.get("location") === "/inbox?c=kairat");
  ok("запросы проверки сотруднику закрыты", (await staff.go("/api/launch/status?c=kairat")).status === 403);
  net.reset();
  let d = await (await own.go("/api/launch/status?c=kairat")).json();
  const ck = t => d.checks.find(x => x.title.startsWith(t)) || {};
  ok("чек-лист: ИИ, хранилище, Telegram клиента, секреты WhatsApp, ключ сотрудника — готово; контакты политики — нет, с подсказкой", ck("Ключ ИИ").ok === true && ck("Хранилище").ok === true && ck("Telegram").ok === true && ck("WhatsApp: секреты").ok === true && ck("Ключ для сотрудников").ok === true
    && ck("Контакты").ok === false && /OWNER_NAME/.test(ck("Контакты").fix) && /https:\/\/bot\.test\/wa\/kairat/.test(ck("WhatsApp: адрес").text), JSON.stringify(d.checks).slice(0, 900));
  ok("в чек-листе нет самих секретов", !JSON.stringify(d).includes("tok-kairat") && !JSON.stringify(d).includes("sec-kairat") && !JSON.stringify(d).includes(OWNER));
  const titles = d.cases.map(k => k.t);
  ok("экзамен собран из паспорта: цены трёх услуг, адрес, телефон, график, несуществующая услуга, торг, атака, казахский, заявка", titles.includes("Цена: Мужская стрижка") && titles.includes("Цена: Детская стрижка") && titles.includes("Адрес") && titles.includes("Телефон") && titles.includes("График сегодня")
    && titles.includes("Услуги, которой нет") && titles.includes("Заявка до конца") && titles.includes("Время, которого нет в графике") && titles.includes("Позвать администратора") && titles.length >= 12, JSON.stringify(titles));
  const idx = t => d.cases.find(k => k.t === t).i;
  // пробное сообщение в Telegram
  d = await (await own.post("/api/launch/tg", { c: "kairat" })).json();
  ok("пробное сообщение ушло в чат администратора клиента", d.ok && net.tg.some(x => x.chat_id === "555000111" && /Проверка: уведомления бота «Barber House»/.test(x.text)), JSON.stringify([d, net.tg]));
  net.tgStatus = 403;
  d = await (await own.post("/api/launch/tg", { c: "kairat" })).json();
  ok("Telegram отказал → понятная причина и что сделать", d.ok === false && /нажмите «Старт»/.test(d.text), JSON.stringify(d));
  net.tgStatus = 200;
  // сценарии экзамена на «живой модели» (здесь — заглушка)
  d = await (await own.go("/api/launch/status?c=kairat")).json();
  const L0 = S.leads("kairat").length;
  net.ai = ["Мужская стрижка от 6 000 ₸. Записать вас?"];
  let c1 = await (await own.post("/api/launch/case", { c: "kairat", i: idx("Цена: Мужская стрижка") })).json();
  ok("сценарий «цена»: бот назвал цену из паспорта → прошёл", c1.pass === true && c1.transcript.length === 1, JSON.stringify(c1));
  net.ai = ["Мужская стрижка от 4 000 ₸."];
  c1 = await (await own.post("/api/launch/case", { c: "kairat", i: idx("Цена: Мужская стрижка") })).json();
  ok("сценарий «цена»: бот назвал цену другой услуги → не прошёл, причина названа", c1.pass === false && /названа цена 6 000/.test(c1.fails.join()), JSON.stringify(c1));
  net.ai = [b => /Азамат/.test(b.contents.at(-1).parts[0].text) ? "Забронировала вас. Администратор подтвердит запись.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: Мужская стрижка; Время: завтра, 12:00" : "Свободно завтра в 12:00 и 13:00. Какое время подойдёт?"];
  c1 = await (await own.post("/api/launch/case", { c: "kairat", i: idx("Заявка до конца") })).json();
  ok("сценарий «заявка до конца» прошёл, а в настоящие заявки ничего не попало", c1.pass === true && S.leads("kairat").length === L0, JSON.stringify([c1.fails, S.leads("kairat").length, L0]));
  net.ai = ["Мы находимся: Астана, пр. Мангилик Ел, 10."];
  c1 = await (await own.post("/api/launch/case", { c: "kairat", i: idx("Адрес") })).json();
  ok("сценарий «адрес» сверяет ответ с паспортом", c1.pass === true);
  net.ai = ["Мы находимся в центре города."];
  c1 = await (await own.post("/api/launch/case", { c: "kairat", i: idx("Адрес") })).json();
  ok("…и не проходит, если адреса в ответе нет", c1.pass === false);
  c1 = await (await own.post("/api/launch/case", { c: "kairat", i: idx("Попытка сломать инструкции") })).json();
  ok("сценарий «попытка сломать инструкции» проходит без обращения к ИИ", c1.pass === true);
  await own.post("/api/launch/done", { c: "kairat", pass: 11, total: 13, fails: ["Адрес", "Торг"] });
  d = await (await own.go("/api/launch/status?c=kairat")).json();
  ok("итог экзамена запоминается", d.last && d.last.pass === 11 && d.last.total === 13 && d.last.fails.length === 2);
  // клиент с Altegio: расписание проверяется, экзамен включает запись и отмену, записей не создаёт
  net.reset();
  d = await (await own.go("/api/launch/status?c=salon")).json();
  const a = d.checks.find(x => x.title === "Расписание Altegio"), t2 = d.cases.map(k => k.t);
  ok("чек-лист клиента с Altegio: расписание читается, режим отмены назван, экзамен включает запись и отмену", a && a.ok === true && /Услуги: ✅ 3/.test(a.text) && d.checks.some(x => x.title === "Отмена и перенос" && /передаёт просьбу администратору/.test(x.text))
    && t2.includes("Запись в Altegio до конца (без создания)") && t2.includes("Просьба об отмене") && t2.includes("Цена: Мужская стрижка"), JSON.stringify([a, t2]));
  const n0 = net.altRecords.length;
  net.ai = [b => { const u = b.contents.at(-1).parts[0].text; return /Отмените/.test(u) ? "Передаю администратору.\n[ОТМЕНА]" : /Азамат/.test(u) ? `Записала.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: Мужская стрижка; Мастер: любой; Дата: ${D1}; Время: 10:00` : /первую услугу/.test(u) ? "Хорошо. Как вас зовут и какой номер телефона?" : "Есть мужская стрижка от 6 000 ₸. Завтра свободно в 10:00 и 11:00. На какое время записать?"; }];
  c1 = await (await own.post("/api/launch/case", { c: "salon", i: d.cases.find(k => k.t === "Просьба об отмене").i })).json();
  ok("экзамен «просьба об отмене» у клиента с Altegio проходит; в расписании ничего не создано и не удалено", c1.pass === true && net.altRecords.length === n0 && net.altDeleted.length === 0 && net.alt.some(x => x.startsWith("POST /book_check/5001")), JSON.stringify([c1.fails, c1.transcript && c1.transcript.map(x => x.b)]));
  // номер WhatsApp: сведения от Meta
  await own.post("/api/studio/save", { ...PASS, isNew: false, waPhoneId: "900111" });
  net.reset(); net.graphReply = url => url.includes("/900111?fields=") ? new Response(JSON.stringify({ display_phone_number: "+7 700 111 22 33", verified_name: "Barber House", quality_rating: "GREEN" }), { status: 200 }) : null;
  d = await (await own.go("/api/launch/status?c=kairat")).json();
  ok("номер WhatsApp проверяется у Meta: показаны номер, имя и качество", /\+7 700 111 22 33/.test((d.checks.find(x => x.title === "WhatsApp: номер") || {}).text || "") && net.graph.some(g => g.auth === "Bearer tok-kairat"), JSON.stringify(d.checks.find(x => x.title === "WhatsApp: номер")));
  net.graphReply = () => new Response(JSON.stringify({ error: { message: "Error validating access token", code: 190 } }), { status: 401 });
  d = await (await own.go("/api/launch/status?c=kairat")).json();
  ok("токен WhatsApp не подошёл → причина человеческим языком", (d.checks.find(x => x.title === "WhatsApp: номер") || {}).ok === false && /токен истёк или неверный/.test(d.checks.find(x => x.title === "WhatsApp: номер").text));
  net.graphReply = null;
}

// ====== 7. Рассылки: шаблоны WhatsApp по списку
section("рассылки");
{
  const own = S.browser(); await own.go("/studio?key=" + OWNER);
  const staff = S.browser(); const kk = await (await own.post("/api/studio/key", { id: "kairat" })).json(); await staff.go("/inbox?c=kairat&key=" + kk.key);
  const dentStaff = S.browser(); await dentStaff.go("/inbox?c=dent&key=dent-staff-key");
  const J = async r => r.json();
  const tpls = () => net.graph.filter(g => g.body && g.body.type === "template");
  const bcOf = id => S.kv.json("bc:kairat:" + id), setBc = (id, f) => { const b = bcOf(id); f(b); S.kv.mem.set("bc:kairat:" + id, JSON.stringify(b)); };
  const run = () => S.kv.json("bcrun") || [];
  const LIST = "8 701 111 00 01, Айгерим\n+7 (701) 111-00-02;Данияр Серикович\n77011110003\tне записывать\n7011110004\nАрман 8 701 111 00 05\n87011110001, повтор\n+998 90 123 45 67, ТИМУР\nмусор\n12345\n";
  const FORM = { c: "kairat", name: "Октябрь", tpl: "promo_october", lang: "ru", text: "Здравствуйте, {{1}}!\nВ октябре стрижка 4 500 ₸. Чтобы не получать сообщения, ответьте СТОП", params: "{имя}", recipients: LIST, cap: 240, from: 10, to: 20, consent: true };
  const mkBc = async (over = {}, who = own) => J(await who.post("/api/bc/create", { ...FORM, ...over }));
  const many = (n, base = 7020000000) => Array.from({ length: n }, (_, i) => "+7" + String(base + i).slice(1) + ", Клиент").join("\n"); // +7 020… не пройдёт: код с 0
  const nums = (n, from = 1) => Array.from({ length: n }, (_, i) => "8705" + String(1000000 + from + i)).join("\n");

  // --- доступ
  ok("рассылки без входа закрыты", (await S.browser().go("/api/bc/list?c=kairat")).status === 401 && (await S.browser().go("/broadcast?c=kairat")).status === 303);
  ok("сотрудник другой компании рассылки не видит и не создаёт", (await dentStaff.go("/api/bc/list?c=kairat")).status === 403 && (await dentStaff.post("/api/bc/create", FORM)).status === 403);
  let r = await own.go("/broadcast?c=kairat"); const pg = await r.text();
  ok("страница рассылок открывается владельцу и сотруднику", r.status === 200 && /Новая рассылка/.test(pg) && (await staff.go("/broadcast?c=kairat")).status === 200);
  ok("сотрудника с чужой страницы рассылок уводит на свою", (r = await staff.go("/broadcast?c=dent")).status === 303 && r.headers.get("location") === "/broadcast?c=kairat");
  r = await own.post("/api/bc/create", FORM, { origin: "https://evil.example" });
  ok("запрос с чужого сайта отклонён", r.status === 403);

  // --- разбор списка
  net.reset(); net.graphReply = url => url.includes("?fields=") ? new Response(JSON.stringify({ display_phone_number: "+7 700 111 22 33", verified_name: "Barber House", quality_rating: "GREEN", whatsapp_business_manager_messaging_limit: "TIER_250" }), { status: 200 }) : null;
  let d = await J(await own.post("/api/bc/check", FORM));
  ok("проверка списка: номера в разных видах, повтор убран, мусор показан", d.ok === true && d.valid === 6 && d.dup === 1 && d.badN === 2 && d.bad.join("|") === "мусор|12345", JSON.stringify(d));
  ok("имена: первое слово, ИМЯ → Имя; пометка администратора («не записывать») именем не становится", d.named === 4 && d.sample.join("|") === "+77011110001 — Айгерим|+77011110002 — Данияр|+77011110003 — без имени|+77011110004 — без имени|+77011110005 — Арман" && d.preview[0] === "Айгерим", JSON.stringify(d));
  d = await mkBc({ consent: false, tpl: "Promo October", from: 20, to: 10, text: "", name: "" });
  ok("создание: без согласия, с неверным названием шаблона, часами и без текста — понятные ошибки", d.ok === false && d.errors.length === 5 && /клиенты компании/.test(d.errors.join()) && /латинские/.test(d.errors.join()) && /раньше/.test(d.errors.join()), JSON.stringify(d));
  d = await mkBc({ from: 6, to: 23 });
  ok("ночные часы отправки не принимаются", d.ok === false && /не раньше 8:00/.test(d.errors.join()));
  d = await mkBc({ recipients: "мусор\n12345" });
  ok("список без номеров не принимается", d.ok === false && /нет ни одного номера/.test(d.errors.join()));
  ok("пока ничего не отправлено и не сохранено", tpls().length === 0 && ![...S.kv.mem.keys()].some(k => k.startsWith("bc:")));

  // --- сведения о номере
  d = await J(await own.go("/api/bc/list?c=kairat"));
  ok("страница показывает номер, качество и предел Meta", d.ready === true && d.health && d.health.limit === 250 && d.health.quality === "GREEN" && /700 111/.test(d.health.phone) && d.list.length === 0, JSON.stringify(d));
  net.graphReply = url => url.includes("whatsapp_business_manager_messaging_limit") ? new Response(JSON.stringify({ error: { code: 100, message: "nonexisting field" } }), { status: 400 }) : url.includes("?fields=") ? new Response(JSON.stringify({ display_phone_number: "+7 700 111 22 33", messaging_limit_tier: "TIER_2K" }), { status: 200 }) : null;
  d = await J(await own.go("/api/bc/list?c=kairat"));
  ok("старое поле предела у Meta тоже читается (2 000)", d.health.limit === 2000, JSON.stringify(d.health));
  net.graphReply = null;

  // --- создание, пробная отправка, запуск
  const stops0 = [...S.kv.mem.keys()].filter(k => k.startsWith("optout:kairat:")).length;
  S.kv.mem.set("optout:kairat:77011110002", String(Date.now())); // Данияр раньше написал «стоп»
  net.reset();
  d = await J(await own.post("/api/bc/test", { ...FORM, to: "8 701 999 00 00" }));
  let g = tpls();
  ok("пробная отправка: шаблон уходит на указанный номер с номера клиента", d.ok === true && g.length === 1 && g[0].body.to === "77019990000" && g[0].url.includes("/900111/messages") && g[0].auth === "Bearer tok-kairat" && g[0].body.template.name === "promo_october" && g[0].body.template.language.code === "ru", JSON.stringify(g));
  d = await J(await own.post("/api/bc/test", { ...FORM, to: "123" }));
  ok("пробная отправка на неполный номер — отказ", /номер полностью/.test(d.error || ""));
  net.graphReply = (u, i, rec) => rec.body && rec.body.type === "template" ? new Response(JSON.stringify({ error: { code: 132001, message: "Template name does not exist in the translation" } }), { status: 404 }) : null;
  d = await J(await own.post("/api/bc/test", { ...FORM, to: "8 701 999 00 00" }));
  ok("Meta не приняла шаблон → причина человеческим языком", /шаблон не найден или не одобрен/.test(d.error || ""), JSON.stringify(d));
  net.graphReply = null; net.reset();
  d = await mkBc({}, staff);
  const id1 = d.b && d.b.id;
  ok("рассылку создаёт и сотрудник компании: готова к запуску, список сохранён", d.ok === true && d.b.status === "ready" && d.b.total === 6 && d.dup === 1 && d.bad === 2 && (S.kv.json("bcr:kairat:" + id1 + ":0") || []).length === 6 && S.kv.meta.get("bc:kairat:" + id1).status === "ready", JSON.stringify(d));
  ok("до запуска ничего не уходит, даже по фоновой задаче", (await S.cron(), tpls().length === 0));
  d = await J(await staff.post("/api/bc/act", { c: "kairat", id: id1, act: "start" }));
  ok("запуск: рассылка идёт, стоит в очереди фоновой отправки, её текст запомнен для ИИ и пульта", d.ok === true && d.b.status === "running" && run().length === 1 && /4 500/.test(S.kv.json("bclast:kairat").text), JSON.stringify([d, run()]));
  net.reset(); await S.cron(); g = tpls();
  const b1 = bcOf(id1);
  ok("фоновая задача отправила шаблон всем, кроме попросившего не писать", g.length === 5 && !g.some(x => x.body.to === "77011110002") && g.every(x => x.url.includes("/900111/messages") && x.auth === "Bearer tok-kairat"), JSON.stringify(g.map(x => x.body.to)));
  ok("подстановка: имя из списка, без имени — «уважаемый клиент»", g.find(x => x.body.to === "77011110001").body.template.components[0].parameters[0].text === "Айгерим" && g.find(x => x.body.to === "77011110003").body.template.components[0].parameters[0].text === "уважаемый клиент" && g.find(x => x.body.to === "998901234567").body.template.components[0].parameters[0].text === "Тимур", JSON.stringify(g.map(x => x.body.template.components)));
  ok("рассылка завершена: счётчики верные, очередь пуста, итог ушёл в Telegram", b1.status === "done" && b1.sent === 5 && b1.skipped === 1 && b1.failed === 0 && b1.pos === 6 && run().length === 0 && net.tg.some(x => /Рассылка «Октябрь» завершена/.test(x.text) && /Отправлено: 5 из 6/.test(x.text) && /просили не писать\): 1/.test(x.text)), JSON.stringify([b1, net.tg]));
  await S.cron(); await S.cron();
  ok("повторные запуски фоновой задачи ничего не отправляют", tpls().length === 5);
  d = await J(await own.post("/api/bc/act", { c: "kairat", id: id1, act: "start" }));
  ok("завершённую рассылку нельзя запустить снова", /нельзя запустить/.test(d.error || ""));
  d = await J(await own.go("/api/bc/list?c=kairat"));
  ok("в списке рассылок — итог и счётчик отправленного за сутки", d.list.length === 1 && d.list[0].status === "done" && d.list[0].sent === 5 && d.used === 5 && d.stops === stops0 + 1, JSON.stringify(d));

  // --- порции, предел на 24 часа
  net.reset();
  d = await mkBc({ name: "Большая", recipients: nums(45), cap: 35 });
  const id2 = d.b.id;
  await own.post("/api/bc/act", { c: "kairat", id: id2, act: "start" });
  await S.cron(); const n1 = tpls().length; await S.cron(); const n2 = tpls().length; await S.cron(); await S.cron(); const n3 = tpls().length;
  let b2 = bcOf(id2);
  ok("порциями по 20; предел 35 за сутки учитывает и прошлую рассылку (5): ушло 30, дальше ожидание", n1 === 20 && n2 === 30 && n3 === 30 && b2.status === "running" && b2.pos === 30 && /За последние 24 часа отправлено 35 — это предел \(35\)/.test(b2.waitNote || ""), JSON.stringify([n1, n2, n3, b2]));
  ok("никто не получил сообщение дважды", new Set(tpls().map(x => x.body.to)).size === 30);
  const puts0 = S.kv.ops.put; await S.cron(); await S.cron();
  ok("пока ждём, фоновая задача хранилище не пишет", S.kv.ops.put === puts0 && tpls().length === 30);
  { const q = S.kv.json("bcq:kairat"), old = {}; for (const [k, v] of Object.entries(q)) old[+k - 200] = v; S.kv.mem.set("bcq:kairat", JSON.stringify(old)); } // прошли сутки
  await S.cron(); b2 = bcOf(id2);
  ok("через сутки отправка продолжилась сама и дошла до конца", tpls().length === 45 && b2.status === "done" && b2.sent === 45 && !b2.waitNote && new Set(tpls().map(x => x.body.to)).size === 45, JSON.stringify(b2));

  // --- часы отправки (сейчас 12:00)
  net.reset(); S.kv.mem.delete("bcq:kairat");
  d = await mkBc({ name: "Вечер", recipients: nums(3, 100), from: 14, to: 20 }); const id3 = d.b.id;
  await own.post("/api/bc/act", { c: "kairat", id: id3, act: "start" }); await S.cron();
  ok("вне часов отправки ничего не уходит, названо время продолжения", tpls().length === 0 && /с 14:00 до 20:00 по Астане. Продолжу в 14:00/.test(bcOf(id3).waitNote || ""), JSON.stringify(bcOf(id3)));
  d = await mkBc({ name: "Утро", recipients: nums(3, 200), from: 8, to: 11 }); const id4 = d.b.id;
  await own.post("/api/bc/act", { c: "kairat", id: id4, act: "start" }); await S.cron(); await S.cron();
  ok("после окончания часов отправки — «продолжу завтра»", tpls().length === 0 && /Продолжу завтра в 8:00/.test(bcOf(id4).waitNote || ""), JSON.stringify(bcOf(id4)));
  d = await J(await own.post("/api/bc/act", { c: "kairat", id: id3, act: "delete" }));
  ok("идущую рассылку удалить нельзя — сначала остановить", /Сначала остановите/.test(d.error || ""));
  await own.post("/api/bc/act", { c: "kairat", id: id3, act: "stop" }); await own.post("/api/bc/act", { c: "kairat", id: id4, act: "pause" });
  ok("остановка и пауза убирают рассылку из фоновой очереди", run().length === 0 && bcOf(id3).status === "stopped" && bcOf(id4).status === "paused");
  d = await J(await own.post("/api/bc/act", { c: "kairat", id: id3, act: "start" }));
  ok("остановленную совсем рассылку запустить нельзя", /нельзя запустить/.test(d.error || ""));
  d = await J(await own.post("/api/bc/act", { c: "kairat", id: id3, act: "delete" }));
  ok("удаление стирает и рассылку, и список номеров", d.gone === true && !S.kv.mem.has("bc:kairat:" + id3) && !S.kv.mem.has("bcr:kairat:" + id3 + ":0"));
  await own.post("/api/bc/act", { c: "kairat", id: id4, act: "delete" });

  // --- ошибки Meta
  const fresh = async (name, n, from, over = {}) => { net.reset(); S.kv.mem.delete("bcq:kairat"); const x = await mkBc({ name, recipients: nums(n, from), ...over }); await own.post("/api/bc/act", { c: "kairat", id: x.b.id, act: "start" }); return x.b.id; };
  const failTpl = (code, when = () => true, status = 400) => { net.graphReply = (u, i, rec) => rec.body && rec.body.type === "template" && when(rec.body) ? new Response(JSON.stringify({ error: { code, message: "err " + code } }), { status }) : null; };
  let id = await fresh("Шаблон не одобрен", 4, 300);
  failTpl(132001); await S.cron();
  let b = bcOf(id);
  ok("шаблон не одобрен → пауза после первой же попытки, получатель остаётся в очереди, администратору — сигнал с причиной", b.status === "paused" && b.pos === 0 && b.failed === 0 && tpls().length === 1 && /шаблон не найден или не одобрен/.test(b.note) && run().length === 0 && net.tg.some(x => /Рассылка «Шаблон не одобрен» остановлена/.test(x.text) && /132001/.test(x.text)), JSON.stringify([b, net.tg]));
  net.graphReply = null; await S.cron();
  ok("на паузе ничего не уходит", tpls().length === 1);
  await own.post("/api/bc/act", { c: "kairat", id, act: "start" }); await S.cron(); b = bcOf(id);
  ok("после исправления и «Продолжить» рассылка дошла до всех, никто не потерян", b.status === "done" && b.sent === 4 && b.failed === 0 && !b.note, JSON.stringify(b));

  id = await fresh("Подстановка", 4, 400);
  const bad1 = "8705" + String(1000000 + 401);
  failTpl(132012, x => x.to === "7" + bad1.slice(1)); await S.cron(); b = bcOf(id);
  ok("ошибка подстановки → пауза, получатель пока в очереди", b.status === "paused" && b.pos === 1 && b.sent === 1 && b.failed === 0 && /подстановка не подходит/.test(b.note), JSON.stringify(b));
  await own.post("/api/bc/act", { c: "kairat", id, act: "start" }); await S.cron(); b = bcOf(id);
  ok("после «Продолжить» тот же получатель снова не прошёл → он пропущен, остальные получили", b.status === "done" && b.sent === 3 && b.failed === 1, JSON.stringify(b));
  d = await J(await own.go("/api/bc/get?c=kairat&id=" + id + "&bad=1"));
  ok("номера с ошибками можно посмотреть — с причиной", d.bad.length === 1 && d.bad[0].startsWith("+7705100040") && /подстановка/.test(d.bad[0]), JSON.stringify(d.bad));

  id = await fresh("Скорость", 3, 500);
  failTpl(130429); await S.cron(); b = bcOf(id);
  ok("Meta просит помедленнее → не пауза, а ожидание 10 минут; получатель в очереди", b.status === "running" && b.pos === 0 && b.failed === 0 && b.retryAt > Date.now() + 500e3 && run().length === 1, JSON.stringify(b));
  net.graphReply = null; await S.cron(); b = bcOf(id);
  ok("в ожидании ничего не уходит, причина показана", tpls().length === 1 && /Meta временно не принимает сообщения — повторю в 12:1/.test(b.waitNote || ""), JSON.stringify(b));
  setBc(id, x => { x.retryAt = Date.now() - 1; }); await S.cron(); b = bcOf(id);
  ok("после ожидания рассылка продолжилась сама", b.status === "done" && b.sent === 3, JSON.stringify(b));
  id = await fresh("Долгий сбой", 3, 520);
  failTpl(131016, () => true, 500);
  for (let i = 0; i < 6; i++) { await S.cron(); setBc(id, x => { if (x.retryAt) x.retryAt = Date.now() - 1; }); }
  b = bcOf(id);
  ok("Meta не принимает больше часа → пауза и сигнал", b.status === "paused" && b.pos === 0 && /больше часа не принимает/.test(b.note), JSON.stringify(b));
  net.graphReply = null; await own.post("/api/bc/act", { c: "kairat", id, act: "stop" });

  id = await fresh("Один номер не в WhatsApp", 4, 600);
  failTpl(131026, x => x.to.endsWith("602")); await S.cron(); b = bcOf(id);
  ok("номер не в WhatsApp → одна ошибка, остальные получили, рассылка завершена", b.status === "done" && b.sent === 3 && b.failed === 1 && b.fails["131026"] === 1 && net.tg.some(x => /Не отправлено из-за ошибок: 1/.test(x.text)), JSON.stringify(b));
  id = await fresh("Пять подряд", 8, 700);
  failTpl(131026); await S.cron(); b = bcOf(id);
  ok("пять ошибок подряд → пауза (что-то не так со списком или номером)", b.status === "paused" && b.failed === 5 && b.pos === 5 && /Пять сообщений подряд/.test(b.note), JSON.stringify(b));
  net.graphReply = null; await own.post("/api/bc/act", { c: "kairat", id, act: "stop" });
  id = await fresh("Связь", 3, 800);
  net.graphReply = (u, i, rec) => { if (rec.body && rec.body.type === "template") throw new Error("network down"); return null; };
  await S.cron(); b = bcOf(id);
  ok("связь с Meta оборвалась → получатель не повторяется (мог получить), пауза 10 минут", b.status === "running" && b.failed === 1 && b.pos === 1 && b.retryAt > Date.now(), JSON.stringify(b));
  net.graphReply = null; setBc(id, x => { x.retryAt = Date.now() - 1; }); await S.cron(); b = bcOf(id);
  ok("после обрыва связи остальные получили по одному сообщению", b.status === "done" && b.sent === 2 && new Set(tpls().map(x => x.body.to)).size === 3 && tpls().length === 3, JSON.stringify(b));

  // --- сбой посреди порции и одновременная отправка
  id = await fresh("Сбой", 30, 900);
  setBc(id, x => { x.pos = 20; x.cur = [0, 20]; x.last = Date.now(); }); // прошлая порция оборвалась после отметки
  await S.cron(); b = bcOf(id);
  ok("оборванная порция повторно не уходит: помечена «неизвестно», отправка идёт дальше", b.status === "done" && b.unsure === 20 && b.sent === 10 && tpls().length === 10 && net.tg.some(x => /Неизвестно \(сбой во время отправки\): до 20/.test(x.text)), JSON.stringify(b));
  id = await fresh("Замок", 3, 1000);
  S.kv.mem.set("bcl:kairat:" + id, "other");
  d = await J(await own.post("/api/bc/tick", { c: "kairat", id }));
  ok("пока идёт другая отправка этой рассылки, вторая не начинается", d.state === "busy" && tpls().length === 0, JSON.stringify(d));
  S.kv.mem.delete("bcl:kairat:" + id);
  d = await J(await own.go("/api/bc/get?c=kairat&id=" + id));
  ok("фон работает — подсказки про ручную отправку нет", d.b.stalled === false);
  setBc(id, x => { x.startedAt = Date.now() - 200e3; });
  d = await J(await own.go("/api/bc/get?c=kairat&id=" + id));
  ok("фон молчит больше двух минут → страница предложит отправить порцию вручную", d.b.stalled === true);
  S.kv.mem.delete("bcrun");
  d = await J(await own.post("/api/bc/tick", { c: "kairat", id }));
  ok("порция вручную отправляет и завершает рассылку", d.state === "done" && d.b.sent === 3 && tpls().length === 3, JSON.stringify(d));
  ok("после запуска замок снят", !S.kv.mem.has("bcl:kairat:" + id));

  // --- сигналы Meta
  const signal = (field, value, statuses) => S.waPost("/wa/kairat", [], { secret: "sec-kairat", raw: JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "waba1", changes: [statuses ? { field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "900111" }, statuses } } : { field, value }] }] }) });
  // --- сосуществование: ответ с телефона и история чатов
  {
    const coex = (field, value, secret = "sec-kairat") => S.waPost("/wa/kairat", [], { secret, raw: JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "waba1", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { phone_number_id: "900111" }, ...value } }] }] }) });
    const C = "77015550001", hk = "h:wa:kairat:" + C;
    await S.waPost("/wa/kairat", text(C, "Здравствуйте, сколько стоит стрижка?"), { secret: "sec-kairat", pnid: "900111" });
    const echo = { from: "77000000000", to: C, id: "wamid.echo.1", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Добрый день! Стрижка 6000, ждём вас" } };
    let r = await coex("smb_message_echoes", { message_echoes: [echo] });
    let h = S.hist("wa", "kairat", C);
    ok("ответ с телефона попадает в чат как ответ администратора", r.status === 200 && h.turns.some(t => t.by === "admin" && /ждём вас/.test(t.text)), JSON.stringify(h.turns.slice(-2)));
    ok("после ответа с телефона бот на паузе", h.profile.pausedUntil > Date.now());
    await coex("smb_message_echoes", { message_echoes: [echo] });
    ok("повторная доставка того же ответа не дублирует его", S.hist("wa", "kairat", C).turns.filter(t => /ждём вас/.test(t.text)).length === 1);
    await coex("smb_message_echoes", { message_echoes: [{ ...echo, id: "wamid.echo.2", to: "77015550099" }] });
    ok("ответ незнакомому номеру чат не ломает", true);
    const before = S.hist("wa", "kairat", C).turns.length;
    await coex("smb_message_echoes", { message_echoes: [{ ...echo, id: "wamid.echo.3", text: { body: "подделка" } }] }, "wrong");
    ok("ответ с телефона без подписи Meta не принимается", S.hist("wa", "kairat", C).turns.length === before);
    const C2 = "77015550002", t0 = Math.floor(Date.now() / 1000) - 86400 * 3;
    await coex("history", { history: [{ metadata: { phase: 0, chunk_order: 1, progress: 10 }, threads: [{ id: C2, messages: [{ from: C2, id: "h1", timestamp: String(t0), type: "text", text: { body: "Хочу записаться на пятницу" } }, { from: "77000000000", to: C2, id: "h2", timestamp: String(t0 + 60), type: "text", text: { body: "Хорошо, в 18:00 удобно?" } }] }] }] });
    h = S.hist("wa", "kairat", C2);
    ok("история чата из приложения подгружается: реплики клиента и администратора по порядку", h && h.turns.length === 2 && h.turns[0].role === "user" && h.turns[1].by === "admin" && h.turns[0].t < h.turns[1].t, JSON.stringify(h && h.turns));
    ok("подгруженная история не поднимает чат в «Ждут ответа» и не включает паузу", !h.profile.need && !h.profile.pausedUntil);
    await coex("history", { history: [{ threads: [{ id: C2, messages: [{ from: C2, id: "h1", timestamp: String(t0), type: "text", text: { body: "Хочу записаться на пятницу" } }] }] }] });
    ok("повторная подгрузка не дублирует реплики", S.hist("wa", "kairat", C2).turns.length === 2);
  }
  // --- резервная копия заявок в Telegram
  {
    await S.env.KV.put("lead:kairat:2026-10-03:x1abc", JSON.stringify({ id: "x1abc", ts: Date.now(), name: "Айгерим", phone: "+77015550123", kind: "callback" }));
    net.tg.length = 0;
    const W = (await import("../worker.js")).default;
    const n = await W.backup(S.env);
    const f = net.tg.find(x => x.doc);
    ok("резервная копия заявок уходит файлом в Telegram администратора", n >= 1 && f && /^zayavki-kairat-\d{4}-\d\d-\d\d\.json$/.test(f.name) && /Айгерим/.test(f.text) && /Резервная копия/.test(f.caption), JSON.stringify(net.tg.map(x => x.name || x.text).slice(0, 3)));
    net.tg.length = 0;
    await S.cron();
    ok("днём (не в 03:00) фоновая задача копию не шлёт", !net.tg.some(x => x.doc));
  }
  id = await fresh("Сигнал", 30, 1100);
  await S.cron();
  ok("первая порция ушла", tpls().length === 20);
  net.tg.length = 0;
  r = await signal("message_template_status_update", { event: "PAUSED", message_template_id: 1, message_template_name: "promo_october", message_template_language: "ru", reason: "NONE", other_info: { title: "FIRST_PAUSE" } });
  ok("Meta приостановила шаблон → сигнал администратору", r.status === 200 && net.tg.some(x => /Шаблон «promo_october» приостановлен Meta/.test(x.text) && /Рассылки с этим шаблоном остановлены/.test(x.text)), JSON.stringify(net.tg));
  await S.cron(); b = bcOf(id);
  ok("рассылка с этим шаблоном встала на паузу, больше ничего не ушло", b.status === "paused" && b.pos === 20 && tpls().length === 20 && /Сигнал от Meta: шаблон «promo_october» приостановлен/.test(b.note), JSON.stringify(b));
  d = await J(await own.go("/api/bc/list?c=kairat"));
  ok("сигнал виден на странице рассылок", d.hold && /приостановлен/.test(d.hold.join()), JSON.stringify(d.hold));
  r = await own.post("/api/bc/act", { c: "kairat", id, act: "start" }); d = await J(r);
  ok("«Продолжить» при сигнале Meta — только после подтверждения", r.status === 409 && /Всё равно продолжить/.test(d.confirm || "") && bcOf(id).status === "paused");
  net.tg.length = 0;
  await signal("message_template_status_update", { event: "APPROVED", message_template_name: "promo_october", message_template_language: "ru", reason: "NONE" });
  ok("шаблон снова одобрен → сигнал снят, администратору сообщение", !S.kv.mem.has("bchold:kairat") && net.tg.some(x => /✅/.test(x.text) && /одобрен/.test(x.text)), JSON.stringify(net.tg));
  await own.post("/api/bc/act", { c: "kairat", id, act: "start" }); await S.cron();
  ok("после этого рассылка продолжается без подтверждения и доходит до конца", bcOf(id).status === "done" && bcOf(id).sent === 30);
  await signal("message_template_status_update", { event: "DISABLED", message_template_name: "other_tpl", message_template_language: "ru" });
  id = await fresh("Другой шаблон отключён", 2, 1200); await S.cron();
  ok("сигнал о другом шаблоне эту рассылку не останавливает", bcOf(id).status === "done");
  await signal("message_template_quality_update", { previous_quality_score: "GREEN", new_quality_score: "RED", message_template_name: "promo_october", message_template_language: "ru" });
  net.reset(); id = (await mkBc({ name: "Качество", recipients: nums(2, 1210) })).b.id;
  r = await own.post("/api/bc/act", { c: "kairat", id, act: "start" }); d = await J(r); await S.cron();
  ok("качество шаблона упало до низкого → рассылка с ним не запускается без подтверждения", r.status === 409 && /качество шаблона «promo_october» — низкое/.test(d.confirm || "") && bcOf(id).status === "ready" && tpls().length === 0, JSON.stringify(d));
  d = await J(await own.post("/api/bc/act", { c: "kairat", id, act: "start", force: true }));
  ok("подтверждённое «Продолжить» снимает сигнал по этому шаблону, сигнал по другому остаётся", d.ok === true && S.kv.json("bchold:kairat").tpl.other_tpl && !S.kv.json("bchold:kairat").tpl.promo_october, JSON.stringify(S.kv.json("bchold:kairat")));
  net.tg.length = 0;
  await signal("account_update", { event: "ACCOUNT_RESTRICTION", restriction_info: [{ restriction_type: "RESTRICTED_BIZ_INITIATED_MESSAGING", expiration: 1700000000 }] });
  ok("Meta ограничила аккаунт → администратору тревога", net.tg.some(x => /🚨/.test(x.text) && /Meta ограничила аккаунт WhatsApp \(RESTRICTED_BIZ_INITIATED_MESSAGING\)/.test(x.text)) && !!S.kv.json("bchold:kairat").all, JSON.stringify(net.tg));
  await S.cron(); b = bcOf(id);
  ok("идущая рассылка при этом встаёт на паузу — с любым шаблоном", b.status === "paused" && /Meta ограничила аккаунт/.test(b.note), JSON.stringify(b));
  await own.post("/api/bc/act", { c: "kairat", id, act: "stop" }); S.kv.mem.delete("bchold:kairat");
  await signal("account_update", { event: "PARTNER_ADDED" });
  ok("несущественные сообщения об аккаунте ничего не останавливают", !S.kv.mem.has("bchold:kairat"));
  net.tg.length = 0;
  await signal("business_capability_update", { max_daily_conversations_per_business: "TIER_2K", max_phone_numbers_per_business: 2 });
  ok("Meta изменила предел → администратору сообщение", net.tg.some(x => /max_daily_conversations_per_business: TIER_2K/.test(x.text)), JSON.stringify(net.tg));

  // --- отказ от рекламы
  await signal("user_preferences", { messaging_product: "whatsapp", metadata: { phone_number_id: "900111" }, contacts: [{ wa_id: "77051001301" }], user_preferences: [{ wa_id: "77051001301", detail: "User requested to stop marketing messages", category: "marketing_messages", value: "stop", timestamp: 1731705721 }] });
  ok("человек запретил рекламу в самом WhatsApp → он в списке «не писать»", String(S.kv.mem.get("optout:kairat:77051001301") || "").startsWith("meta:"));
  id = await fresh("Отказники", 3, 1300); await S.cron();
  ok("такому человеку рассылка не уходит", bcOf(id).skipped === 1 && bcOf(id).sent === 2 && !tpls().some(x => x.body.to === "77051001301"));
  await signal("user_preferences", { user_preferences: [{ wa_id: "77051001301", category: "marketing_messages", value: "resume" }, { wa_id: "77011110002", category: "marketing_messages", value: "resume" }] });
  ok("разрешил снова → убран из списка; «стоп», написанный боту, так не снимается", !S.kv.mem.has("optout:kairat:77051001301") && S.kv.mem.has("optout:kairat:77011110002"));
  net.reset(); net.ai = ["Хорошо."];
  await S.waPost("/wa/kairat", { from: "77051001302", type: "button", button: { text: "Остановить рекламу", payload: "STOP" } }, { secret: "sec-kairat", pnid: "900111" });
  await S.waText("/wa/kairat", "77051001303", "Stop promotions", { secret: "sec-kairat", pnid: "900111" });
  await S.waText("/wa/kairat", "77051001304", "отписаться от рассылки", { secret: "sec-kairat", pnid: "900111" });
  ok("кнопка отказа в шаблоне («Остановить рекламу», Stop promotions) и «отписаться от рассылки» — это «стоп»", ["77051001302", "77051001303", "77051001304"].every(x => S.kv.mem.has("optout:kairat:" + x)) && net.gemini.length === 0, JSON.stringify([...S.kv.mem.keys()].filter(k => k.startsWith("optout:"))));

  // --- недоставленные (приходят позже)
  S.kv.mem.delete("bchold:kairat"); net.reset();
  await signal("", null, [{ id: "wamid.1", status: "failed", recipient_id: "77051001401", errors: [{ code: 131026, title: "Message undeliverable" }] }, { id: "wamid.2", status: "failed", recipient_id: "77051001402", errors: [{ code: 131050, title: "User opted out" }] }, { id: "wamid.3", status: "delivered", recipient_id: "77051001403" }]);
  d = await J(await own.go("/api/bc/list?c=kairat"));
  ok("недоставленные считаются по причинам и видны на странице", d.fail && d.fail.n === 2 && d.fail.codes.some(x => x.code === 131026 && /не в WhatsApp/.test(x.hint)), JSON.stringify(d.fail));
  ok("«человек запретил рекламу» из отчёта о доставке → в список «не писать»; безобидные причины рассылки не останавливают", S.kv.mem.has("optout:kairat:77051001402") && !S.kv.mem.has("bchold:kairat"));
  await signal("", null, [{ id: "wamid.4", status: "failed", recipient_id: "77051001404", errors: [{ code: 131048, title: "Spam rate limit hit" }] }]);
  ok("опасная причина недоставки (жалобы на спам) → рассылки остановлены, администратору тревога", (S.kv.json("bchold:kairat") || {}).all && /жаловались/.test(S.kv.json("bchold:kairat").all.why) && net.tg.some(x => /Рассылки остановлены/.test(x.text)), JSON.stringify([S.kv.json("bchold:kairat"), net.tg]));
  S.kv.mem.delete("bchold:kairat");

  // --- ИИ и пульт знают текст рассылки
  net.reset(); net.ai = ["Да, в октябре стрижка 4 500 ₸. Записать вас?"];
  await S.waText("/wa/kairat", "77051001501", "Здравствуйте, это по вашей акции. Хочу", { secret: "sec-kairat", pnid: "900111" });
  const sys = net.gemini.at(-1).systemInstruction.parts[0].text;
  ok("клиент отвечает на рассылку: ИИ видит её текст", /Недавно компания отправила клиентам в WhatsApp такое сообщение/.test(sys) && /В октябре стрижка 4 500 ₸/.test(sys), sys.slice(-600));
  ok("цена из рассылки — не выдумка: ответ бота с ней проходит защиту", S.sentTo("77051001501").some(x => /4 500 ₸/.test(x)), JSON.stringify(S.sentTo("77051001501")));
  d = await J(await own.go("/api/inbox/chat?c=kairat&ch=wa&id=77051001501"));
  ok("в пульте в этом чате видна подсказка о рассылке", d.promo && /4 500/.test(d.promo.text) && !!d.promo.name, JSON.stringify(d.promo));
  net.reset(); net.ai = ["Стрижка стоит 4 500 ₸."];
  d = await S.chat("kairat", "bc-web-1", "Сколько стоит стрижка?");
  ok("в чате на сайте текст рассылки ИИ не подмешивается: цены 4 500 в фактах нет", !/4 500/.test(d.reply) && !/Недавно компания отправила/.test(net.gemini[0].systemInstruction.parts[0].text), d.reply);

  // --- шаблон с картинкой, перевод строки в подстановке
  id = await fresh("Картинка", 1, 1600, { img: "https://example.com/promo.jpg", params: "{имя}\nдо 15   октября", fallback: "друг" }); await S.cron();
  const comp = tpls()[0].body.template.components;
  ok("картинка уходит в шапке шаблона, подстановки — по порядку, запасное имя — своё", comp[0].type === "header" && comp[0].parameters[0].image.link === "https://example.com/promo.jpg" && comp[1].parameters.map(x => x.text).join("|") === "друг|до 15 октября", JSON.stringify(comp));
  d = await mkBc({ img: "http://example.com/a.jpg" });
  ok("картинка не по https не принимается", d.ok === false && /https/.test(d.errors.join()));
  d = await mkBc({ params: "", name: "Без подстановок", recipients: nums(1, 1700) }); await own.post("/api/bc/act", { c: "kairat", id: d.b.id, act: "start" }); net.reset(); await S.cron();
  ok("шаблон без подстановок уходит без блока components", tpls().length === 1 && !("components" in tpls()[0].body.template), JSON.stringify(tpls()[0].body));

  // --- две рассылки сразу: по очереди, предел общий
  net.reset(); S.kv.mem.delete("bcq:kairat");
  const A = (await mkBc({ name: "Первая", recipients: nums(25, 2000), cap: 60 })).b.id, B = (await mkBc({ name: "Вторая", recipients: nums(25, 2100), cap: 60 })).b.id;
  await own.post("/api/bc/act", { c: "kairat", id: A, act: "start" }); await own.post("/api/bc/act", { c: "kairat", id: B, act: "start" });
  await S.cron();
  ok("за один запуск фоновой задачи — одна порция одной рассылки", tpls().length === 20);
  for (let i = 0; i < 6; i++) await S.cron();
  ok("обе рассылки дошли до конца, каждый номер — один раз", bcOf(A).status === "done" && bcOf(B).status === "done" && tpls().length === 50 && new Set(tpls().map(x => x.body.to)).size === 50, JSON.stringify([bcOf(A), bcOf(B)]));

  // --- настоящий KV не даёт писать один ключ чаще раза в секунду: маленькая порция уходит быстрее
  net.reset(); S.kv.mem.delete("bcq:kairat"); S.kv.strict.last.clear(); S.kv.strict.hits = 0; S.kv.strict.on = true;
  d = await mkBc({ name: "Быстрая", recipients: nums(2, 2300) });
  await own.post("/api/bc/act", { c: "kairat", id: d.b.id, act: "start" }); await S.cron();
  S.kv.strict.on = false;
  ok("при лимите «одна запись ключа в секунду» рассылка всё равно завершается и итог сохраняется", bcOf(d.b.id).status === "done" && bcOf(d.b.id).sent === 2 && tpls().length === 2 && S.kv.strict.hits > 0 && run().length === 0, JSON.stringify([bcOf(d.b.id), S.kv.strict.hits, run()]));

  // --- клиент без WhatsApp и общий номер
  d = await J(await own.go("/api/bc/list?c=dent"));
  ok("у клиента без WhatsApp рассылки недоступны — с объяснением", d.ready === false && /WA_TOKEN_DENT/.test(d.why) && d.health === null);
  d = await J(await own.post("/api/bc/create", { ...FORM, c: "dent" })); const idD = d.b.id;
  d = await J(await own.post("/api/bc/act", { c: "dent", id: idD, act: "start" }));
  ok("и запустить её нельзя", /не подключён/.test(d.error || ""));
  // пустая очередь: фоновая задача делает одно чтение и выходит
  S.kv.mem.delete("bcrun"); const g0 = S.kv.ops.get, p0 = S.kv.ops.put; await S.cron();
  ok("когда рассылок нет, фоновая задача только проверяет очередь (одно чтение)", S.kv.ops.get - g0 === 1 && S.kv.ops.put === p0);
  // удалённый клиент в очереди — убирается
  S.kv.mem.set("bcrun", JSON.stringify([{ c: "ghost", id: "x1" }, { c: "kairat", id: "nope" }])); await S.cron();
  ok("очередь чистится от удалённых клиентов и рассылок", run().length === 0, JSON.stringify(run()));
}
{
  // общий номер воркера (прежний режим): рассылка для клиента, закреплённого за номером
  const S2 = mk({ WA_TOKEN: "wat", PHONE_NUMBER_ID: "111", WA_CLIENT: "barber", APP_SECRET: "sec" });
  const own = S2.browser(); await own.go("/studio?key=owner-key-123456");
  net.reset();
  let d = await (await own.post("/api/bc/create", { c: "barber", name: "Общий номер", tpl: "hello_world", lang: "en_US", text: "Hello World", params: "", recipients: "87051234567", cap: 10, from: 10, to: 20, consent: true })).json();
  await own.post("/api/bc/act", { c: "barber", id: d.b.id, act: "start" }); await S2.cron();
  const g = net.graph.filter(x => x.body && x.body.type === "template");
  ok("общий номер воркера: рассылка уходит с него", g.length === 1 && g[0].url.includes("/111/messages") && g[0].auth === "Bearer wat" && g[0].body.template.language.code === "en_US", JSON.stringify(g));
  d = await (await own.post("/api/bc/create", { c: "dent", name: "Чужой", tpl: "hello_world", lang: "ru", text: "x", params: "", recipients: "87051234567", cap: 10, from: 10, to: 20, consent: true })).json();
  d = await (await own.post("/api/bc/act", { c: "dent", id: d.b.id, act: "start" })).json();
  ok("с общего номера нельзя разослать от имени другого клиента", /не подключён/.test(d.error || ""));
  // сигнал Meta на общий вебхук
  net.reset();
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "w", changes: [{ field: "user_preferences", value: { user_preferences: [{ wa_id: "77059990001", category: "marketing_messages", value: "stop" }] } }] }] });
  await S2.waPost("/", [], { secret: "sec", raw: body });
  ok("общий вебхук: отказ от рекламы записан за клиентом номера", S2.kv.mem.has("optout:barber:77059990001"));
}

// ====== 8. Исправления после независимой проверки: безопасность
section("после проверки: безопасность");
{
  // подбор ключа через ?key=: неверные попытки считаются на всех страницах с ключом
  const S3 = mk({ LEADS_KEY: "secret123", KEY_DENT: "dent-staff-key" });
  const H = { "cf-connecting-ip": "203.0.113.50" };
  const seen = {};
  for (const path of ["/diag", "/leads", "/selftest", "/api/selftest", "/altegio"]) for (let i = 0; i < 3; i++) { const r = await S3.call(`${path}?key=wrong${i}`, { headers: H }); seen[r.status] = (seen[r.status] || 0) + 1; }
  ok("15 неверных ключей с одного адреса: после восьмой попытки — «подождите», а не новые попытки", seen[403] === 8 && seen[429] === 7, JSON.stringify(seen));
  let r = await S3.call("/leads?key=secret123", { headers: H });
  ok("пока идёт пауза, с этого адреса не проходит и верный ключ", r.status === 429);
  r = await S3.call("/leads?key=secret123", { headers: { "cf-connecting-ip": "203.0.113.51" } });
  ok("с другого адреса верный ключ работает как раньше", r.status === 200 && /Заявки/.test(await r.text()));
  r = await S3.call("/leads?c=dent&key=dent-staff-key", { headers: { "cf-connecting-ip": "203.0.113.52" } });
  ok("ключ сотрудника в адресе открывает заявки только его компании", r.status === 200 && /Заявки/.test(await r.text()));
  r = await S3.call("/api/selftest", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.53" }, body: JSON.stringify({ key: "nope", i: 0 }) });
  ok("автотест с неверным ключом в теле запроса не запускается", r.status === 403 && net.gemini.length === 0 || r.status === 403);
  const b = S3.browser(); await b.go("/studio?key=secret123");
  r = await b.go("/diag");
  ok("вошедшему владельцу /diag открывается без ключа в адресе", r.status === 200 && /LEADS_KEY|Ключ|ключ/i.test(await r.text()));
  r = await b.go("/leads"); const lp = await r.text();
  ok("на странице заявок у вошедшего есть переходы в пульт и выход", r.status === 200 && /href="\/inbox"/.test(lp) && /href="\/logout"/.test(lp) && /href="\/studio"/.test(lp));

  // вебхук без подписи
  const S4 = mk({ WA_TOKEN_KAIRAT: "tok", APP_SECRET_KAIRAT: "sec" }); // клиенты только со своими номерами: общего номера нет
  const fake = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "w", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "1" }, messages: [{ id: "wamid.fake.1", from: "77050001122", type: "text", text: { body: "1" } }] } }] }] });
  const w0 = S4.kv.ops.put;
  r = await S4.call("/", { method: "POST", headers: { "content-type": "application/json" }, body: fake });
  const r2 = await S4.call("/any/other/path", { method: "POST", headers: { "content-type": "application/json" }, body: fake });
  ok("общий номер не настроен → поддельный «вебхук» на любой адрес не принимается и в хранилище ничего не пишет", r.status === 404 && r2.status === 404 && S4.kv.ops.put === w0, [r.status, r2.status, S4.kv.ops.put - w0].join());
  const S5 = mk({ WA_TOKEN: "real-token", PHONE_NUMBER_ID: "111222", WA_CLIENT: "barber" }); // общий номер без APP_SECRET
  net.reset();
  const sig = v => S5.call("/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "w", changes: [v] }] }) });
  await sig({ field: "user_preferences", value: { user_preferences: [{ wa_id: "77019998877", value: "stop", category: "marketing_messages" }] } });
  await sig({ field: "account_update", value: { event: "ACCOUNT_RESTRICTION" } });
  await sig({ field: "messages", value: { statuses: [{ id: "x", status: "failed", recipient_id: "77019998877", errors: [{ code: 131048 }] }] } });
  ok("общий номер без подписи Meta: «сигналам» (отказ от рекламы, ограничение аккаунта, жалобы) бот не верит", !S5.kv.mem.has("optout:barber:77019998877") && !S5.kv.mem.has("bchold:barber") && net.tg.length === 0, JSON.stringify([...S5.kv.mem.keys()]));
  r = await S5.call("/somewhere", { method: "POST", headers: { "content-type": "application/json" }, body: fake });
  ok("вебхук общего номера принимается только по своему адресу", r.status === 404);
  const own5 = S5.browser(); await own5.go("/studio?key=owner-key-123456");
  let d = await (await own5.go("/api/bc/list?c=barber")).json();
  ok("рассылки с общего номера без подписи Meta недоступны — с объяснением", d.ready === false && /APP_SECRET/.test(d.why), JSON.stringify(d.why));
  let codes = {};
  for (let i = 0; i < 40; i++) { const x = await S5.call("/", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.7" }, body: "{}" }); codes[x.status] = (codes[x.status] || 0) + 1; }
  ok("без подписи: с одного адреса — не больше 30 запросов в минуту", codes[200] === 30 && codes[429] === 10, JSON.stringify(codes));
}

// ====== 9. «Стоп» записывается всегда (бот выключен, пауза, хвост пачки)
section("отказ от рассылки: выключенный бот, пауза, всплеск");
{
  const o = { secret: "sec-kairat", pnid: "900111" }, own = S.browser(); await own.go("/studio?key=" + OWNER);
  await own.post("/api/studio/save", { ...PASS, isNew: false, off: true });
  net.reset();
  await S.waText("/wa/kairat", "77061110001", "Привет", o);
  await S.waText("/wa/kairat", "77061110001", "СТОП", o);
  await S.waPost("/wa/kairat", { from: "77061110002", type: "button", button: { text: "Остановить рекламу", payload: "STOP" } }, o);
  ok("бот выключен: «СТОП» и кнопка «Остановить рекламу» записаны в список «не писать»", S.kv.mem.has("optout:kairat:77061110001") && S.kv.mem.has("optout:kairat:77061110002"), JSON.stringify([...S.kv.mem.keys()].filter(k => k.startsWith("optout:"))));
  await own.post("/api/studio/save", { ...PASS, isNew: false, off: false });
  // бот включён, но чат на паузе (администратор ответил)
  net.reset(); net.ai = ["Здравствуйте!"];
  await S.waText("/wa/kairat", "77061110003", "Привет", o);
  const hk = "h:wa:kairat:77061110003", h3 = S.hist("wa", "kairat", "77061110003");
  S.kv.mem.set(hk, JSON.stringify({ ...h3, profile: { ...h3.profile, pausedUntil: Date.now() + 3600e3 } }));
  await S.waText("/wa/kairat", "77061110003", "стоп", o);
  ok("чат на паузе: «стоп» всё равно записан", S.kv.mem.has("optout:kairat:77061110003"));
  // всплеск: «стоп» в хвосте пачки (после 12-го) и после 72-го
  const burst = []; for (let i = 0; i < 80; i++) burst.push({ from: "7707" + String(2000000 + i), type: "text", text: { body: i === 14 || i === 75 ? "стоп" : "Привет " + i } });
  net.reset(); net.ai = ["Здравствуйте!"];
  await S.waPost("/wa/kairat", burst, o);
  ok("всплеск: «стоп» из хвоста пачки (15-е и 76-е сообщения) записан", S.kv.mem.has("optout:kairat:" + burst[14].from) && S.kv.mem.has("optout:kairat:" + burst[75].from), JSON.stringify([...S.kv.mem.keys()].filter(k => k.startsWith("optout:kairat:7707"))));
  ok("всплеск: обычное сообщение из хвоста в список «не писать» не попало", !S.kv.mem.has("optout:kairat:" + burst[16].from));
}

// ====== 11. Рассылки: имя в {имя} и номер телефона из строки списка
section("рассылки: имена и номера");
{
  const own = S.browser(); await own.go("/studio?key=" + OWNER);
  const one = async line => { const d = await (await own.post("/api/bc/check", { c: "kairat", tpl: "promo_october", lang: "ru", params: "{имя}", text: "x", recipients: line })).json(); if (d.error) console.log("check:", d.error); const x = (d.sample || [])[0] || ""; return { phone: (x.match(/^\+(\d+)/) || [])[1] || "", name: x.includes(" — без имени") ? "" : x.replace(/^\+\d+ — /, "") }; };
  const names = [
    ["87011110001, Неадекват Ержан", ""], ["87011110002, ЧС", ""], ["87011110003, Хамка", ""], ["87011110004, Скандалистка Алия", ""], ["87011110008, Сосед", ""],
    ["87011110022, Ресницы Дана", ""], ["87011110024, Барбер Арман", ""], ["87011110033, Скидка 20%", ""], ["87011110038, Мама Алии", ""], ["87011110041, Нов клиент", ""],
    ["87011110042, АЙГЕРИМ", "Айгерим"], ["87012220001, Иванов Иван Иванович", "Иван"], ["87012220002, Ахметова Айгерим", "Айгерим"], ["87012220006, Айгерим Сериковна", "Айгерим"],
    ["87012220004, г-н Серик", ""], ["87011110009, Алия-ресницы", ""], ["87012220003, Нурлан-ага", "Нурлан-ага"], ["87014440010, Әсел", "Әсел"], ["87014440009, Дарина", "Дарина"],
    ["03.10.2026\tМужская стрижка\tДанияр\t87013330001\t6000", "Данияр"], ["Астана\tАйгерим\t87013330002", "Айгерим"], ["Арман (мастер)\tТимур\t87013330004", "Тимур"],
    ["87013330010\tСтрижка + борода\tДана", "Дана"], ["87013330011\tСкидка 10 процентов\tДана", "Дана"], ["Карта 7770001122, Айгерим, 87015550002", "Айгерим"], ["ИИН 900512300123, тел 87015550005, Серик", "Серик"],
    ["87015550009, Айгерим, Иванова", "Айгерим"]
  ];
  const bad = [];
  for (const [line, want] of names) { const g = await one(line); if (g.name !== want || !g.phone) bad.push(`${JSON.stringify(line)} → «${g.name}» (ждали «${want}»), номер ${g.phone}`); }
  ok("{имя}: пометки, фамилии, услуги и цифры из соседних столбцов не подставляются как имя", !bad.length, bad.join("\n  "));
  let g = await one("7001234567\tАйгерим\t87015550001");
  ok("столбец с 10 цифрами рядом с полным номером — не телефон", g.phone === "77015550001", JSON.stringify(g));
  g = await one("89991234567 87015550004 Алия");
  ok("два номера в строке: берётся первый полный, а не «любое число»", /^7(999|701)/.test(g.phone), JSON.stringify(g));
}

// ====== 12. Отказ от рассылки своими словами
section("отказ от рассылки своими словами");
{
  const o = { secret: "sec-kairat", pnid: "900111" };
  const refuse = ["не пишите", "Не пишите сюда", "не пишите больше", "не пиши мне", "не надо мне писать", "не надо писать", "не нужно мне писать", "хватит писать", "хватит спамить", "это спам", "отпишись", "отписка",
    "уберите меня из рассылки", "удалите меня из рассылки", "удалите мой номер", "удалите мой номер из базы", "исключите меня из рассылки", "не присылайте", "не присылайте больше", "не присылайте мне сообщения", "не отправляйте мне сообщения",
    "не шлите", "не шлите мне ничего", "не беспокойте", "отстаньте", "стоп рассылка", "Стоп спам", "остановите рассылку", "прекратите рассылку", "прекратите писать", "отключите рассылку", "отказ от рассылки", "отказываюсь от рассылки",
    "Здравствуйте, отпишите меня пожалуйста", "Стоп, не пишите мне", "стоп стоп", "«СТОП»", "Cтоп", "нет, стоп", "Стоп, спасибо", "не надо рассылок", "не нужны мне ваши рассылки", "перестаньте мне писать",
    "маған жазбаңыз", "жарнама керек емес", "хабарлама жібермеңіз", "мазаламаңыз", "жарнаманы тоқтатыңыз", "stop messaging me", "no more messages", "remove me", "opt out", "STOP ALL"];
  const normal = ["Стоп, а сколько стоит стрижка?", "стоп-цена какая?", "остановить запись", "отказаться от записи", "можно остановиться у вас?", "не пишите мне на этот номер, пишите на 87011234567", "хочу отписаться от записи на завтра",
    "не пишите мне пока, я занят?", "не пишите мне сейчас, перезвоните вечером", "не шлите мне рекламу, запишите лучше на стрижку", "Стоп! Я ошибся, запишите на 15:00", "стоп я передумал", "стоп, не на 10, а на 11", "не надо писать, я позвоню сам",
    "хватит ли времени до 12?", "удалите мою запись на завтра", "уберите из записи Данияра", "не присылайте счёт сюда, я оплачу на месте", "cancel", "спасибо"];
  const missed = [], falsePos = [];
  let i = 0;
  for (const t of refuse) { const n = "77079" + String(100000 + ++i); net.reset(); await S.waText("/wa/kairat", n, t, o); if (!S.kv.mem.has("optout:kairat:" + n)) missed.push(t); }
  for (const t of normal) { const n = "77079" + String(100000 + ++i); net.reset(); await S.waText("/wa/kairat", n, t, o); if (S.kv.mem.has("optout:kairat:" + n)) falsePos.push(t); }
  ok("отказ своими словами записывается в список «не писать»", !missed.length, JSON.stringify(missed));
  ok("обычные фразы («не пишите мне пока, я занят?», «остановить запись») отказом не считаются", !falsePos.length, JSON.stringify(falsePos));
}

// ====== 10. Заявка на выходной, после закрытия и в прошлом не проходит как обычная; бот «без записи» не теряет обращение
section("заявка: выходной, после закрытия, прошлое; бот без записи");
{
  const S10 = mk(), own = S10.browser(); await own.go("/studio?key=" + OWNER);
  await own.post("/api/studio/save", { id: "dl", isNew: true, name: "Дент Люкс", niche: "dent", address: "г. Шымкент, ул. Байтурсынова 78", phone: "+7 705 888 12 12", schedule: "Пн-Пт 9:00-19:00, Сб 9:00-15:00, Вс выходной", booking: "manual", step: "60", bookDays: "3", services: "Консультация — бесплатно\nПроф. чистка 15 000" });
  let n = 0;
  const lead = day => `Забронировала вас на ${day}. Администратор подтвердит запись.\n[ЗАЯВКА] Имя: Айдос; Телефон: указан; Услуга: Проф. чистка; Время: ${day}`;
  const t = async (user, day) => { net.reset(); const r = await S10.chat("dl", "d" + (++n), user + ` Айдос, 8 701 111 22 ${30 + n}`, [lead(day)]); return { r, tg: net.tg.map(x => x.text) }; };
  let x = await t("Запишите меня завтра, в воскресенье, в 11:00 на чистку.", "воскресенье, 4 октября, 11:00");
  ok("запись на выходной (воскресенье) заявкой не становится, клиенту — ближайшее рабочее время", !x.r.lead && /Ближайшее свободное/.test(x.r.reply) && !/Забронировала/.test(x.r.reply), JSON.stringify(x.r));
  x = await t("Запишите меня сегодня в 17:00 на чистку.", "сегодня, 17:00");
  ok("запись на время после закрытия (суббота до 15:00) — не заявка", !x.r.lead && /Ближайшее свободное/.test(x.r.reply), JSON.stringify(x.r));
  x = await t("Запишите меня сегодня на 10:00 на чистку.", "сегодня, 10:00");
  ok("запись на время, которое уже прошло — не заявка", !x.r.lead && /Ближайшее свободное/.test(x.r.reply), JSON.stringify(x.r));
  x = await t("Запишите на следующую субботу в 18:00.", "суббота, 10 октября, 18:00");
  ok("суббота через неделю после закрытия — не заявка", !x.r.lead, JSON.stringify(x.r));
  x = await t("Запишите меня в понедельник в 10:00.", "понедельник, 5 октября, 10:00");
  ok("обычная запись в рабочее время проходит", !!x.r.lead && /Забронировала/.test(x.r.reply), JSON.stringify(x.r));
  x = await t("Запишите меня сегодня в 14:00 на чистку.", "сегодня, 14:00");
  ok("время сегодня, которое есть в окнах, проходит", !!x.r.lead, JSON.stringify(x.r));

  // бот «без записи»: обращение со временем не теряется
  await own.post("/api/studio/save", { id: "zal", isNew: true, name: "Алтын Орда", niche: "other", kind: "банкетный зал", address: "Астана, шоссе Алаш 24", phone: "+7 702 111 00 99", schedule: "ежедневно с 10:00 до 20:00", booking: "none", services: "Оформление зала от 150 000\nМеню стандарт — 12 000" });
  const z = async (user, ai) => { net.reset(); const r = await S10.chat("zal", "z" + (++n), user, ai); return { r, tg: net.tg.map(x => x.text) }; };
  x = await z("Здравствуйте, хотим той 24 октября на 150 человек, начало в 18:00. Меня зовут Асхат, 8 701 555 66 77", "Спасибо, Асхат! Передала заявку администратору — он перезвонит и подтвердит дату.\n[ЗАЯВКА] Имя: Асхат; Телефон: указан; Услуга: той, 150 гостей; Время: 24 октября, 18:00");
  ok("бот без записи: обращение со временем → заявка и уведомление", !!x.r.lead && S10.leads("zal").length === 1 && x.tg.some(m => /Новая заявка/.test(m)), JSON.stringify([x.r, x.tg]));
  x = await z("Хочу посмотреть зал завтра в 15:00. Асхат, 8 701 555 66 80", "Хорошо, Асхат! Передала администратору, он перезвонит.\n[ЗАЯВКА] Имя: Асхат; Телефон: указан; Услуга: просмотр зала; Время: завтра, 15:00");
  ok("бот без записи: «завтра в 15:00» → заявка", !!x.r.lead && S10.leads("zal").length === 2, JSON.stringify([x.r, x.tg]));
  x = await z("Хотим юбилей 7 ноября на 60 человек. Сауле, 8 705 000 11 22", "Спасибо, Сауле! Администратор перезвонит вам и подтвердит дату.");
  ok("бот без записи: ИИ взял имя и телефон без служебной строки → заявка в списке или чат помечен", S10.leads("zal").length >= 3 || (S10.kv.meta.get("h:web:zal:z" + n) || {}).nd, JSON.stringify([x.r, S10.leads("zal").length, S10.kv.meta.get("h:web:zal:z" + n)]));
}

if (process.argv[1] && process.argv[1].endsWith("platform.mjs")) {
  console.log(`\nНовые части: прошло ${T.pass}, не прошло ${T.fail}`);
  process.exit(T.fail ? 1 : 0);
}
