// Проверки новых частей на заглушках: история чата для пульта, WhatsApp на несколько клиентов, паспорт бота, вход, страница владельца, пульт чатов.
// Запуск: node test/platform.mjs (его же запускает test/smoke.mjs в конце). SHOW=1 — показать все проверки.
import { mk, net, ok, section, T, D0, D1, D2, wait, ALT_DEFAULT } from "./harness.mjs";

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
  ok("на экране «Домой» демо и рабочий пульт подписаны по-разному", /apple-mobile-web-app-title" content="Пульт"/.test(live) && /apple-mobile-web-app-title" content="Пульт демо"/.test(demo) && mf.short_name === "Пульт демо", mf.short_name);
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
  { // модель Claude: чек-лист смотрит на ANTHROPIC_KEY, а не на GEMINI_KEY
    const S5 = mk({ MODEL: "claude-haiku-5-5", GEMINI_KEY: "" }), b5 = S5.browser(); await b5.go("/studio?key=" + OWNER);
    let dd = await (await b5.go("/api/launch/status?c=dent")).json(); let c5 = dd.checks.find(x => x.title.startsWith("Ключ ИИ")) || {};
    ok("модель Claude, ключа нет: в чек-листе «Ключ ИИ (Claude)» не готов, подсказка про ANTHROPIC_KEY", /Claude/.test(c5.title) && c5.ok === false && /ANTHROPIC_KEY/.test(c5.fix), JSON.stringify(c5));
    const S6 = mk({ MODEL: "claude-haiku-5-5", ANTHROPIC_KEY: "ak-x", GEMINI_KEY: "" }), b6 = S6.browser(); await b6.go("/studio?key=" + OWNER);
    dd = await (await b6.go("/api/launch/status?c=dent")).json(); c5 = dd.checks.find(x => x.title.startsWith("Ключ ИИ")) || {};
    ok("модель Claude, ключ задан: «Ключ ИИ (Claude)» готов, самого ключа в ответе нет", c5.ok === true && !JSON.stringify(dd).includes("ak-x"), JSON.stringify(c5)); }
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
  S.kv.mem.delete("bcrun"); S.kv.mem.delete("rmidx"); const g0 = S.kv.ops.get, p0 = S.kv.ops.put; await S.cron(); // запись в Altegio выше поставила напоминания — здесь проверяем пустые очереди
  ok("когда рассылок и напоминаний нет, фоновая задача только проверяет две очереди (два чтения, ни одной записи)", S.kv.ops.get - g0 === 2 && S.kv.ops.put === p0, S.kv.ops.get - g0);
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

// ====== Рассылки через Green-API: обычный WhatsApp клиента по QR-коду, обычный текст, по одному сообщению с паузой
section("рассылки через Green-API");
{
  const S3 = mk({ GA_ID_KAIRAT: "7105000001", GA_TOKEN_KAIRAT: "ga-tok-kairat", GA_URL_KAIRAT: "https://7105.api.greenapi.com" });
  const own = S3.browser(); await own.go("/studio?key=" + OWNER);
  await own.post("/api/studio/save", PASS);
  const J = async r => r.json();
  const sends = () => net.ga.filter(x => x.op === "sendMessage" || x.op === "sendFileByUrl");
  const to = x => String(x.body.chatId).replace("@c.us", "");
  const bcOf = id => S3.kv.json("bc:kairat:" + id), setBc = (id, f) => { const b = bcOf(id); f(b); S3.kv.mem.set("bc:kairat:" + id, JSON.stringify(b)); };
  const later = id => setBc(id, x => { if (x.nextAt) x.nextAt = Date.now() - 1; if (x.retryAt) x.retryAt = Date.now() - 1; }); // «прошло несколько минут»
  const all = async (id, max = 30) => { for (let i = 0; i < max && (bcOf(id) || {}).status === "running"; i++) { later(id); await S3.cron(); if (S3.kv.strict.on) await wait(1100); } }; // фоновая задача — пока рассылка идёт (строгий KV: запуски не чаще раза в секунду, как раз в минуту в Cloudflare)
  const run = () => S3.kv.json("bcrun") || [];
  const nums = (n, from = 1) => Array.from({ length: n }, (_, i) => "8705" + String(3000000 + from + i)).join("\n");
  const LIST = "8 701 222 00 01, Айгерим\n8 701 222 00 02\n+7 701 222 00 03; ДАНИЯР\n87012220001, повтор";
  const FORM = { c: "kairat", ch: "ga", name: "Октябрь", text: "Здравствуйте, {имя}!\nВ октябре стрижка 4 500 ₸.\n\nЖдём вас!", fallback: "", recipients: LIST, cap: 50, from: 10, to: 20, consent: true };
  const mkBc = async (over = {}) => J(await own.post("/api/bc/create", { ...FORM, ...over }));
  const start = id => own.post("/api/bc/act", { c: "kairat", id, act: "start" });
  const inst = { idInstance: 7105000001, wid: "77000000077@c.us", typeInstance: "whatsapp" };
  let hookPath = "/ga/kairat";
  const hook = (body, path = hookPath) => S3.call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let mid = 0;
  const incoming = (from, text) => ({ typeWebhook: "incomingMessageReceived", instanceData: inst, timestamp: Math.floor(Date.now() / 1000), idMessage: "IN" + (++mid), senderData: { chatId: from + "@c.us", sender: from + "@c.us", senderName: "Гость" }, messageData: { typeMessage: "textMessage", textMessageData: { textMessage: text } } });

  // --- страница рассылок и проверка запуска: номер Green-API клиента, вебхук одной кнопкой
  net.reset();
  let d = await J(await own.go("/api/bc/list?c=kairat"));
  ok("страница рассылок: номер Green-API клиента привязан, номер показан", d.ga && d.ga.ready === true && d.ga.state === "authorized" && /\+7 700 000 00 77/.test(d.ga.phone || ""), JSON.stringify(d.ga));
  ok("вебхук ещё не настроен — предупреждение: бот не узнает, кто ответил «стоп»", d.ga && d.ga.hook === false && /стоп/i.test(d.ga.warn || ""), JSON.stringify(d.ga));
  d = await J(await own.go("/api/launch/status?c=kairat"));
  const gaRow = t => d.checks.find(x => x.title === t);
  ok("проверка запуска: Green-API — номер привязан, вебхук не настроен (с подсказкой)", gaRow("WhatsApp (Green-API)") && gaRow("WhatsApp (Green-API)").ok === true && /\+7 700 000 00 77/.test(gaRow("WhatsApp (Green-API)").text) && gaRow("Green-API: вебхук") && gaRow("Green-API: вебхук").ok === false && /Настроить Green-API/.test(gaRow("Green-API: вебхук").fix), JSON.stringify(d.checks.filter(x => /Green/.test(x.title))));
  ok("у клиента на Green-API пункты Meta не красные", !d.checks.some(x => /^WhatsApp: /.test(x.title) && x.ok === false), JSON.stringify(d.checks.map(x => [x.title, x.ok])));
  let r = await own.post("/api/launch/ga", { c: "kairat" }); d = await J(r);
  const st = net.gaSettings["7105000001"] || {}, hu = new URL(st.webhookUrl || "https://x.invalid/");
  ok("«Настроить Green-API»: вебхук клиента и нужные уведомления включены", d.ok === true && hu.pathname === "/ga/kairat" && /^[a-f0-9]{32}$/.test(hu.searchParams.get("t") || "") && st.incomingWebhook === "yes" && st.outgoingMessageWebhook === "yes" && st.stateWebhook === "yes", JSON.stringify([d, st]));
  ok("токен Green-API в адрес вебхука не попадает", !String(st.webhookUrl).includes("ga-tok-kairat"));
  hookPath = hu.pathname + hu.search;
  d = await J(await own.go("/api/launch/status?c=kairat"));
  ok("после настройки вебхук отмечен как готовый", gaRow("Green-API: вебхук").ok === true, JSON.stringify(gaRow("Green-API: вебхук")));
  d = await J(await own.go("/api/bc/list?c=kairat"));
  ok("на странице рассылок предупреждения больше нет", d.ga.hook === true && !d.ga.warn, JSON.stringify(d.ga));

  // --- вебхук клиента: его бот отвечает с его номера
  net.reset(); net.ai = ["Здравствуйте! Мужская стрижка — 6 000 ₸. Записать вас?"];
  r = await hook(incoming("77012220009", "Сколько стоит стрижка?"));
  let rep = sends().filter(x => to(x) === "77012220009");
  ok("сообщение на номер Green-API клиента: отвечает его бот, с его номера", r.status === 200 && rep.length >= 1 && rep.every(x => x.inst === "7105000001" && x.token === "ga-tok-kairat" && x.url.startsWith("https://7105.api.greenapi.com/")) && rep.some(x => /6 000/.test(x.body.message)) && !!S3.hist("ga", "kairat", "77012220009"), JSON.stringify(net.ga.map(x => [x.op, x.url, x.body])));
  r = await hook(incoming("77012220009", "Привет"), "/ga/kairat?t=wrong");
  ok("вебхук с неверным паролем → отказ", r.status === 403);
  r = await hook(incoming("77012220009", "Привет"), "/ga/dent" + hu.search);
  ok("пароль вебхука одного клиента к другому не подходит", r.status === 403);
  net.reset();
  r = await hook({ ...incoming("77012220008", "Привет"), instanceData: { ...inst, idInstance: 999 } });
  ok("сообщение с чужого инстанса (адрес вставлен не туда) не обрабатывается", r.status === 200 && net.gemini.length === 0 && sends().length === 0);
  await hook({ typeWebhook: "outgoingMessageReceived", instanceData: inst, timestamp: Math.floor(Date.now() / 1000), idMessage: "OUT1", senderData: { chatId: "77012220009@c.us" }, messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "Добрый день, это администратор Арман" } } });
  let h = S3.hist("ga", "kairat", "77012220009");
  ok("ответ администратора с телефона: виден в пульте, бот в этом чате на паузе", h.profile.pausedUntil > Date.now() && h.turns.some(t => t.by === "admin" && /администратор Арман/.test(t.text)), JSON.stringify(h.turns.slice(-2)));

  // --- пульт: ответ уходит с номера клиента, отказ Green-API виден
  d = await J(await own.go("/api/inbox/list?c=kairat"));
  ok("в пульте — чат Green-API этого клиента", d.chats.some(x => x.ch === "ga" && x.id === "77012220009"), JSON.stringify(d.chats));
  net.reset();
  d = await J(await own.post("/api/inbox/send", { c: "kairat", ch: "ga", id: "77012220009", text: "Здравствуйте! Чем помочь?" }));
  ok("ответ из пульта уходит с номера Green-API клиента", d.ok === true && sends().length === 1 && sends()[0].inst === "7105000001" && to(sends()[0]) === "77012220009", JSON.stringify([d, net.ga]));
  net.gaReply = rec => rec.op === "sendMessage" ? new Response(JSON.stringify({ message: "Instance account is expired" }), { status: 400 }) : null;
  d = await J(await own.post("/api/inbox/send", { c: "kairat", ch: "ga", id: "77012220009", text: "Ещё раз" }));
  ok("Green-API не принял ответ → администратор видит причину, в переписку ответ не записан", /оплат/i.test(d.error || "") && !S3.hist("ga", "kairat", "77012220009").turns.some(t => t.text === "Ещё раз"), JSON.stringify(d));
  net.gaReply = null;

  // --- создание рассылки
  d = await J(await own.post("/api/bc/check", FORM));
  ok("проверка списка: номера, имена и само сообщение — с именем и строкой «СТОП»", d.ok === true && d.valid === 3 && d.dup === 1 && /^Здравствуйте, Айгерим!\nВ октябре стрижка 4 500 ₸\.\n\nЖдём вас!\n\nЧтобы не получать сообщения, ответьте СТОП$/.test(d.preview[0]), JSON.stringify(d));
  d = await mkBc({ text: "", cap: 500, from: 7, consent: false });
  ok("ошибки: без текста, предел больше 300, ночные часы, без согласия", d.ok === false && /текст сообщения/.test(d.errors.join()) && /300/.test(d.errors.join()) && /8:00/.test(d.errors.join()) && /клиенты компании/.test(d.errors.join()) && !/шаблон/.test(d.errors.join()), JSON.stringify(d));
  d = await mkBc({ text: "Акция! ".repeat(150), img: "https://example.com/a.jpg" });
  ok("с картинкой текст — не длиннее 1000 знаков (подпись к картинке)", d.ok === false && /1000/.test(d.errors.join()), JSON.stringify(d));
  d = await mkBc({ text: "Здравствуйте! Акция. Чтобы отписаться, напишите «стоп»." });
  ok("если про «стоп» в тексте уже есть — строка не добавляется второй раз", d.ok === true && !/ответьте СТОП/.test(d.b.msg), JSON.stringify(d.b));
  await own.post("/api/bc/act", { c: "kairat", id: d.b.id, act: "delete" });
  d = await mkBc();
  const id1 = d.b && d.b.id;
  ok("рассылка создана: через Green-API, готова к запуску", d.ok === true && d.b.ch === "ga" && d.b.status === "ready" && d.b.total === 3 && d.b.cap === 50, JSON.stringify(d));

  // --- пробная отправка себе
  net.reset();
  d = await J(await own.post("/api/bc/test", { ...FORM, to: "8 701 999 00 00" }));
  let g = sends();
  ok("пробная отправка: сообщение уходит на свой номер с номера клиента", d.ok === true && g.length === 1 && to(g[0]) === "77019990000" && g[0].inst === "7105000001" && /^Здравствуйте, Айгерим!/.test(g[0].body.message) && /ответьте СТОП$/.test(g[0].body.message), JSON.stringify([d, g]));

  // --- запуск: номер привязан, вебхук настроен
  net.reset(); net.gaState = "notAuthorized";
  r = await start(id1); d = await J(r);
  ok("номер отвязан от Green-API → запуск отклонён с объяснением", r.status === 409 && /QR/.test(d.error || "") && bcOf(id1).status === "ready", JSON.stringify(d));
  net.gaState = "authorized";
  const keep = net.gaSettings["7105000001"].webhookUrl; net.gaSettings["7105000001"].webhookUrl = "";
  r = await start(id1); d = await J(r);
  ok("вебхук не настроен → запуск отклонён: «стоп» клиентов не дойдёт до бота", r.status === 409 && /вебхук/i.test(d.error || "") && /стоп/i.test(d.error || "") && bcOf(id1).status === "ready", JSON.stringify(d));
  net.gaSettings["7105000001"].webhookUrl = keep;
  S3.kv.mem.set("optout:kairat:77012220002", String(Date.now())); // этот клиент раньше написал «стоп»
  r = await start(id1); d = await J(r);
  ok("запуск: рассылка идёт, её текст запомнен для ИИ и пульта", d.ok === true && d.b.status === "running" && run().length === 1 && /4 500/.test(S3.kv.json("bclast:kairat").text), JSON.stringify(d));

  // --- отправка: по одному сообщению с паузой, кроме тех, кто просил не писать
  net.reset(); await S3.cron();
  g = sends(); let b = bcOf(id1);
  ok("фоновая задача отправила одно сообщение — с номера клиента, с именем и строкой «СТОП»", g.length === 1 && g[0].inst === "7105000001" && g[0].token === "ga-tok-kairat" && to(g[0]) === "77012220001" && g[0].body.message === "Здравствуйте, Айгерим!\nВ октябре стрижка 4 500 ₸.\n\nЖдём вас!\n\nЧтобы не получать сообщения, ответьте СТОП" && b.sent === 1, JSON.stringify([g, b]));
  ok("перед отправкой проверено, что номер привязан", net.ga.some(x => x.op === "getStateInstance"));
  ok("следующее сообщение — не раньше чем через 30 секунд и не позже чем через 2,5 минуты", b.nextAt - Date.now() >= 25e3 && b.nextAt - Date.now() <= 150e3, String(b.nextAt - Date.now()));
  const puts0 = S3.kv.ops.put; await S3.cron();
  ok("пока пауза не прошла, ничего не уходит и хранилище не пишется", sends().length === 1 && S3.kv.ops.put === puts0);
  await all(id1);
  g = sends(); b = bcOf(id1);
  ok("остальным — по одному сообщению; попросивший не писать пропущен", g.length === 2 && !g.some(x => to(x) === "77012220002") && to(g[1]) === "77012220003" && /^Здравствуйте, Данияр!/.test(g[1].body.message) && b.status === "done" && b.sent === 2 && b.skipped === 1 && b.pos === 3, JSON.stringify([g.map(x => x.body), b]));
  ok("рассылка завершена, итог — в Telegram, очередь пуста", run().length === 0 && net.tg.some(x => /Рассылка «Октябрь» завершена/.test(x.text) && /Отправлено: 2 из 3/.test(x.text)), JSON.stringify(net.tg));
  d = await J(await own.go("/api/bc/list?c=kairat"));
  ok("в списке рассылок — итог; счётчик за сутки свой у номера Green-API", d.list.some(x => x.id === id1 && x.status === "done" && x.ch === "ga") && d.ga.used === 2 && d.used === 0 && !S3.kv.mem.has("bcq:kairat"), JSON.stringify([d.list, d.ga, d.used]));

  // --- без имени — запасное обращение; предел на 24 часа
  net.reset();
  d = await mkBc({ name: "Предел", recipients: nums(5), cap: 4 }); const idL = d.b.id;
  await start(idL); await all(idL);
  b = bcOf(idL); g = sends();
  ok("без имени в списке — «уважаемый клиент»", g.length && g.every(x => /^Здравствуйте, уважаемый клиент!/.test(x.body.message)), JSON.stringify(g.map(x => x.body.message)));
  ok("предел 4 за сутки учитывает прошлую рассылку (2): ушло 2, дальше ожидание", g.length === 2 && b.status === "running" && b.pos === 2 && /За последние 24 часа отправлено 4 — это предел \(4\)/.test(b.waitNote || ""), JSON.stringify([g.length, b]));
  { const q = S3.kv.json("bcq:kairat:ga"), old = {}; for (const [k, v] of Object.entries(q)) old[+k - 200] = v; S3.kv.mem.set("bcq:kairat:ga", JSON.stringify(old)); } // прошли сутки
  await all(idL); b = bcOf(idL);
  ok("через сутки отправка продолжилась сама и дошла до конца", b.status === "done" && b.sent === 5 && new Set(sends().map(to)).size === 5, JSON.stringify(b));

  // --- ошибки Green-API
  const fresh = async (name, n, from, over = {}) => { net.reset(); S3.kv.mem.delete("bcq:kairat:ga"); const x = await mkBc({ name, recipients: nums(n, from), ...over }); await start(x.b.id); return x.b.id; };
  const failSend = (status, body, when = () => true) => { net.gaReply = rec => (rec.op === "sendMessage" || rec.op === "sendFileByUrl") && when(rec) ? new Response(JSON.stringify(body), { status }) : null; };
  let id = await fresh("Тариф", 3, 100);
  failSend(466, { correspondentsStatus: { description: "correspondents quota exceeded" } }); await S3.cron(); b = bcOf(id);
  ok("466: кончился лимит тарифа Green-API → пауза, получатель в очереди, сигнал в Telegram", b.status === "paused" && b.pos === 0 && b.sent === 0 && /тариф/i.test(b.note) && run().length === 0 && net.tg.some(x => /Рассылка «Тариф» остановлена/.test(x.text)), JSON.stringify([b, net.tg]));
  net.gaReply = null; await start(id); await all(id); b = bcOf(id);
  ok("после «Продолжить» дошла до всех, никто не потерян", b.status === "done" && b.sent === 3 && b.failed === 0, JSON.stringify(b));
  id = await fresh("Токен", 2, 110);
  failSend(401, { message: "Unauthorized" }); await S3.cron(); b = bcOf(id);
  ok("401: неверный токен → пауза с подсказкой про GA_TOKEN_KAIRAT", b.status === "paused" && b.pos === 0 && /GA_TOKEN_KAIRAT/.test(b.note), JSON.stringify(b));
  net.gaReply = null; await own.post("/api/bc/act", { c: "kairat", id, act: "stop" });
  id = await fresh("Скорость", 2, 120);
  failSend(429, { message: "Too Many Requests" }); await S3.cron(); b = bcOf(id);
  ok("429: слишком часто → ожидание 10 минут, получатель в очереди", b.status === "running" && b.pos === 0 && b.retryAt > Date.now() + 500e3, JSON.stringify(b));
  net.gaReply = null; await S3.cron();
  ok("в ожидании ничего не уходит, причина показана", sends().length === 1 && /Green-API временно не принимает сообщения — повторю в /.test(bcOf(id).waitNote || ""), JSON.stringify(bcOf(id)));
  await all(id); b = bcOf(id);
  ok("после ожидания продолжила сама", b.status === "done" && b.sent === 2, JSON.stringify(b));
  id = await fresh("Номер с ошибкой", 3, 130);
  failSend(400, { message: "Validation failed. Details: 'chatId' is invalid" }, rec => to(rec) === "77053000131"); await all(id); b = bcOf(id);
  ok("400 «неверные данные» у одного номера: он пропущен, остальные получили", b.status === "done" && b.sent === 2 && b.failed === 1, JSON.stringify(b));
  d = await J(await own.go("/api/bc/get?c=kairat&id=" + id + "&bad=1"));
  ok("номер с ошибкой виден с причиной", d.bad.length === 1 && d.bad[0].startsWith("+77053000131") && /номер/.test(d.bad[0]), JSON.stringify(d.bad));
  id = await fresh("Пять подряд", 7, 140);
  failSend(400, { message: "Validation failed" }); await all(id); b = bcOf(id);
  ok("пять ошибок подряд → пауза", b.status === "paused" && b.failed === 5 && b.pos === 5 && /Пять сообщений подряд/.test(b.note), JSON.stringify(b));
  net.gaReply = null; await own.post("/api/bc/act", { c: "kairat", id, act: "stop" });
  id = await fresh("Связь", 2, 150);
  net.gaReply = rec => { if (rec.op === "sendMessage") throw new Error("network down"); return null; };
  await S3.cron(); b = bcOf(id);
  ok("связь с Green-API оборвалась → получатель не повторяется (мог получить), ожидание 10 минут", b.status === "running" && b.pos === 1 && b.failed === 1 && b.retryAt > Date.now(), JSON.stringify(b));
  net.gaReply = null; await all(id); b = bcOf(id);
  ok("после обрыва связи остальным — по одному сообщению", b.status === "done" && b.sent === 1 && sends().length === 2 && new Set(sends().map(to)).size === 2, JSON.stringify(b));

  // --- состояние номера перед отправкой
  id = await fresh("Отвязан", 2, 160);
  net.gaState = "notAuthorized"; await S3.cron(); b = bcOf(id);
  ok("номер отвязался от Green-API → пауза («отсканируйте QR»), ничего не ушло", b.status === "paused" && /QR/.test(b.note) && sends().length === 0, JSON.stringify(b));
  net.gaState = "authorized"; await own.post("/api/bc/act", { c: "kairat", id, act: "stop" });
  id = await fresh("Телефон выключен", 1, 170);
  net.gaState = "sleepMode"; await S3.cron(); b = bcOf(id);
  ok("телефон выключен или инстанс перезапускается → ожидание, а не пауза", b.status === "running" && b.retryAt > Date.now() && /телефон/.test(b.waitNote || "") && sends().length === 0, JSON.stringify(b));
  net.gaState = "authorized"; await all(id);
  ok("телефон включили — отправка продолжилась", bcOf(id).status === "done" && bcOf(id).sent === 1);

  // --- WhatsApp ограничил или заблокировал номер
  id = await fresh("Спам", 3, 180);
  await S3.cron();
  ok("первое сообщение ушло", sends().length === 1);
  net.tg.length = 0;
  r = await hook({ typeWebhook: "stateInstanceChanged", instanceData: inst, timestamp: Math.floor(Date.now() / 1000), stateInstance: "suspended" });
  ok("WhatsApp ограничил номер (сигнал Green-API) → тревога администратору", r.status === 200 && net.tg.some(x => /🚨/.test(x.text) && /ограничил/.test(x.text) && /Рассылки остановлены/.test(x.text)), JSON.stringify(net.tg));
  later(id); await S3.cron(); b = bcOf(id);
  ok("идущая рассылка встала на паузу, больше ничего не ушло", b.status === "paused" && sends().length === 1 && /ограничил/.test(b.note), JSON.stringify(b));
  d = await J(await own.go("/api/bc/list?c=kairat"));
  ok("сигнал виден на странице рассылок", d.ga.hold && /ограничил/.test(d.ga.hold), JSON.stringify(d.ga));
  r = await start(id); d = await J(r);
  ok("«Продолжить» после ограничения — только после подтверждения", r.status === 409 && /Всё равно продолжить/.test(d.confirm || "") && bcOf(id).status === "paused", JSON.stringify(d));
  d = await J(await own.post("/api/bc/act", { c: "kairat", id, act: "start", force: true }));
  ok("подтверждённое «Продолжить» снимает сигнал, отправка идёт дальше", d.ok === true && !(S3.kv.json("bchold:kairat") || {}).ga && bcOf(id).status === "running", JSON.stringify([d, S3.kv.json("bchold:kairat")]));
  await all(id);
  ok("рассылка дошла до конца", bcOf(id).status === "done" && bcOf(id).sent === 3);
  id = await fresh("Ограничен сейчас", 2, 190);
  net.tg.length = 0; net.gaState = "yellowCard"; await S3.cron(); b = bcOf(id);
  ok("ограничение видно и без вебхука: проверка перед отправкой → пауза, сигнал запомнен", b.status === "paused" && /ограничил/.test(b.note) && sends().length === 0 && !!(S3.kv.json("bchold:kairat") || {}).ga && net.tg.some(x => /остановлена/.test(x.text)), JSON.stringify([b, S3.kv.json("bchold:kairat")]));
  net.gaState = "authorized"; await own.post("/api/bc/act", { c: "kairat", id, act: "stop" }); S3.kv.mem.delete("bchold:kairat");
  net.tg.length = 0;
  await hook({ typeWebhook: "stateInstanceChanged", instanceData: inst, timestamp: Math.floor(Date.now() / 1000), stateInstance: "blocked" });
  ok("номер заблокирован WhatsApp → тревога и пометка", net.tg.some(x => /🚨/.test(x.text) && /заблокировал/.test(x.text)) && /заблокировал/.test(((S3.kv.json("bchold:kairat") || {}).ga || {}).why || ""), JSON.stringify([net.tg, S3.kv.json("bchold:kairat")]));
  S3.kv.mem.delete("bchold:kairat");
  net.tg.length = 0;
  await hook({ typeWebhook: "stateInstanceChanged", instanceData: inst, timestamp: Math.floor(Date.now() / 1000), stateInstance: "notAuthorized" });
  ok("номер отвязался → администратору сообщение «отсканируйте QR», рассылки не помечены опасными", net.tg.some(x => /QR/.test(x.text)) && !S3.kv.mem.has("bchold:kairat"), JSON.stringify(net.tg));
  S3.kv.mem.set("bchold:kairat", JSON.stringify({ all: { at: Date.now(), why: "Meta ограничила аккаунт WhatsApp" } }));
  id = await fresh("Meta не мешает", 1, 200); await all(id);
  ok("сигнал Meta не останавливает рассылку через Green-API", bcOf(id).status === "done" && bcOf(id).sent === 1, JSON.stringify(bcOf(id)));
  S3.kv.mem.delete("bchold:kairat");

  // --- недоставленные, «стоп» в ответ, ИИ знает текст рассылки
  net.reset();
  await hook({ typeWebhook: "outgoingMessageStatus", instanceData: inst, timestamp: Math.floor(Date.now() / 1000), idMessage: "GA1", status: "noAccount", chatId: "77053000201@c.us", sendByApi: true });
  await hook({ typeWebhook: "outgoingMessageStatus", instanceData: inst, timestamp: Math.floor(Date.now() / 1000), idMessage: "GA2", status: "delivered", chatId: "77053000202@c.us", sendByApi: true });
  d = await J(await own.go("/api/bc/list?c=kairat"));
  ok("недоставленные (у номера нет WhatsApp) считаются и видны на странице", d.fail && d.fail.n === 1 && d.fail.codes.some(x => /нет WhatsApp/.test(x.hint)), JSON.stringify(d.fail));
  net.reset(); net.ai = ["Хорошо."];
  await hook(incoming("77053000301", "СТОП"));
  ok("«стоп» в ответ на рассылку через Green-API → номер в списке «не писать» этого клиента", S3.kv.mem.has("optout:kairat:77053000301") && sends().some(x => to(x) === "77053000301"), JSON.stringify([...S3.kv.mem.keys()].filter(k => k.startsWith("optout:"))));
  id = await fresh("После стопа", 2, 300); await all(id);
  ok("ему рассылка больше не уходит", bcOf(id).skipped === 1 && bcOf(id).sent === 1 && !sends().some(x => to(x) === "77053000301"), JSON.stringify(bcOf(id)));
  net.reset(); net.ai = ["Да, в октябре стрижка 4 500 ₸. Записать вас?"];
  await hook(incoming("77053000401", "Здравствуйте, это по вашей акции"));
  const sys = net.gemini.at(-1).systemInstruction.parts[0].text;
  ok("клиент отвечает на рассылку в Green-API: ИИ видит её текст", /Недавно компания отправила клиентам в WhatsApp такое сообщение/.test(sys) && /В октябре стрижка 4 500 ₸/.test(sys), sys.slice(-500));

  // --- картинка
  id = await fresh("Картинка", 1, 500, { img: "https://example.com/promo.jpg" }); await S3.cron();
  g = sends();
  ok("с картинкой: уходит файлом по ссылке, текст — подписью", g.length === 1 && g[0].op === "sendFileByUrl" && g[0].body.urlFile === "https://example.com/promo.jpg" && g[0].body.fileName === "promo.jpg" && /^Здравствуйте, уважаемый клиент!/.test(g[0].body.caption) && /ответьте СТОП$/.test(g[0].body.caption), JSON.stringify(g));

  // --- две рассылки сразу: Green-API и Meta не мешают друг другу
  net.reset();
  const A = (await mkBc({ name: "Первая", recipients: nums(2, 600) })).b.id, B = (await mkBc({ name: "Вторая", recipients: nums(2, 700) })).b.id;
  await start(A); await start(B);
  for (let i = 0; i < 8; i++) { later(A); later(B); await S3.cron(); }
  ok("две рассылки Green-API по очереди дошли до конца, каждый номер — один раз", bcOf(A).status === "done" && bcOf(B).status === "done" && sends().length === 4 && new Set(sends().map(to)).size === 4, JSON.stringify([bcOf(A), bcOf(B)]));
  // пауза между сообщениями — не «фон молчит»
  id = (await mkBc({ name: "Пауза", recipients: nums(3, 800) })).b.id; await start(id); await S3.cron();
  setBc(id, x => { x.last = Date.now() - 170e3; x.startedAt = x.last; x.nextAt = Date.now() + 20e3; }); // отправили почти три минуты назад, следующее — через 20 секунд
  d = await J(await own.go("/api/bc/get?c=kairat&id=" + id));
  ok("пауза между сообщениями Green-API — не повод предлагать ручную отправку", d.b.stalled === false, JSON.stringify(d.b));
  setBc(id, x => { x.nextAt = Date.now() - 200e3; });
  d = await J(await own.go("/api/bc/get?c=kairat&id=" + id));
  ok("а если фон действительно молчит — предложит", d.b.stalled === true);
  await own.post("/api/bc/act", { c: "kairat", id, act: "stop" });
  // разные клиенты со своими номерами Green-API не ждут друг друга; с одного номера — не чаще одного сообщения в минуту
  S3.env.GA_ID_BARBER = "7105000002"; S3.env.GA_TOKEN_BARBER = "ga-tok-barber";
  await own.post("/api/launch/ga", { c: "barber" });
  net.reset(); S3.kv.mem.delete("bcq:kairat:ga");
  const K1 = (await mkBc({ name: "К1", recipients: nums(2, 900) })).b.id, K2 = (await mkBc({ name: "К2", recipients: nums(2, 910) })).b.id;
  const B1 = (await J(await own.post("/api/bc/create", { ...FORM, c: "barber", name: "Б1", recipients: nums(2, 920) }))).b.id;
  for (const [c, x] of [["kairat", K1], ["kairat", K2], ["barber", B1]]) await own.post("/api/bc/act", { c, id: x, act: "start" });
  await S3.cron();
  const by = inst => sends().filter(x => x.inst === inst).length;
  ok("за один запуск фоновой задачи: по одному сообщению с каждого номера Green-API", by("7105000001") === 1 && by("7105000002") === 1 && sends().length === 2, JSON.stringify(sends().map(x => [x.inst, to(x)])));
  delete S3.env.GA_ID_BARBER; delete S3.env.GA_TOKEN_BARBER;
}
{
  // общий номер Green-API воркера (GA_ID, GA_CLIENT): рассылка от клиента, за которым закреплён номер
  const S4 = mk({ GA_ID: "1101000001", GA_TOKEN: "ga-shared", GA_HOOK: "hook123", GA_CLIENT: "barber" });
  const own = S4.browser(); await own.go("/studio?key=" + OWNER);
  net.reset(); net.gaSettings["1101000001"] = { webhookUrl: "https://bot.test/ga?t=hook123", incomingWebhook: "yes" };
  let d = await (await own.go("/api/bc/list?c=barber")).json();
  ok("общий номер Green-API: рассылки доступны клиенту номера, вебхук узнан", d.ga && d.ga.ready === true && d.ga.hook === true, JSON.stringify(d.ga));
  d = await (await own.post("/api/bc/create", { c: "barber", ch: "ga", name: "Общий", text: "Привет, {имя}!", recipients: "87051234567, Арман", cap: 10, from: 10, to: 20, consent: true })).json();
  await own.post("/api/bc/act", { c: "barber", id: d.b.id, act: "start" }); await S4.cron();
  const g = net.ga.filter(x => x.op === "sendMessage");
  ok("сообщение ушло с общего номера", g.length === 1 && g[0].inst === "1101000001" && g[0].token === "ga-shared" && g[0].url.startsWith("https://api.green-api.com/") && /^Привет, Арман!/.test(g[0].body.message), JSON.stringify(g));
  d = await (await own.go("/api/bc/list?c=dent")).json();
  ok("для другого клиента общий номер Green-API недоступен", !d.ga);
  d = await (await own.post("/api/bc/create", { c: "dent", ch: "ga", name: "Чужой", text: "Привет", recipients: "87051234567", cap: 10, from: 10, to: 20, consent: true })).json();
  d = await (await own.post("/api/bc/act", { c: "dent", id: d.b.id, act: "start" })).json();
  ok("и запустить её нельзя — с объяснением", /Green-API/.test(d.error || "") && /GA_ID_DENT/.test(d.error || ""), JSON.stringify(d));
  net.tg.length = 0;
  await S4.call("/ga?t=hook123", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ typeWebhook: "stateInstanceChanged", instanceData: { idInstance: 1101000001 }, stateInstance: "blocked" }) });
  ok("общий вебхук: блокировка номера → тревога и пометка у клиента номера", net.tg.some(x => /заблокировал/.test(x.text)) && !!(S4.kv.json("bchold:barber") || {}).ga, JSON.stringify(net.tg));
}

// ====== Реквизиты для оплаты (Kaspi): текст из паспорта ставит код, а не ИИ
section("оплата: реквизиты Kaspi");
{
  const S5 = mk(), own = S5.browser(); await own.go("/studio?key=" + OWNER);
  const PAY = "Kaspi Gold: +7 701 555 44 33 (Кайрат К.)\nСсылка на оплату: https://pay.kaspi.kz/pay/abc123";
  let d = await (await own.post("/api/studio/save", { ...PASS, pay: "x".repeat(501) })).json();
  ok("реквизиты длиннее 500 знаков → ошибка паспорта", d.ok === false && d.errors.some(e => /реквизит/i.test(e)), JSON.stringify(d.errors));
  d = await (await own.post("/api/studio/save", { ...PASS, pay: PAY })).json();
  ok("паспорт с реквизитами сохраняется", d.ok === true, JSON.stringify(d));
  d = await (await own.go("/api/studio/get?c=kairat")).json();
  ok("реквизиты возвращаются в форму паспорта как есть", (d.cfg || {}).pay === PAY, JSON.stringify(d).slice(0, 300));
  const pg = await (await own.go("/studio")).text();
  ok("в форме паспорта есть поле реквизитов", /id="f_pay"/.test(pg) && /'pay'/.test(pg));

  // ИИ ставит метку — клиент получает реквизиты дословно, метки не видит
  let r = await S5.chat("kairat", "pay1", "Как можно оплатить?", "Оплатить можно переводом на Kaspi, реквизиты ниже.\n[РЕКВИЗИТЫ]");
  ok("метка [РЕКВИЗИТЫ] → реквизиты из паспорта дословно, метки в ответе нет", r.reply.includes(PAY) && !/РЕКВИЗИТ/.test(r.reply) && /^Оплатить можно/.test(r.reply), r.reply);
  const sys = net.gemini.at(-1).systemInstruction.parts[0].text;
  ok("в подсказке ИИ есть правило про [РЕКВИЗИТЫ], а самих номера и ссылки нет", /\[РЕКВИЗИТЫ\]/.test(sys) && !sys.includes("555 44 33") && !sys.includes("pay.kaspi.kz/pay/abc123"), sys.slice(-600));
  // клиент спрашивает про Kaspi, а ИИ метку забыл — реквизиты всё равно приходят
  r = await S5.chat("kairat", "pay2", "Куда скинуть предоплату на каспи?", "Предоплату можно перевести на Kaspi.");
  ok("вопрос про оплату без метки от ИИ → реквизиты всё равно добавлены", r.reply.includes(PAY), r.reply);
  r = await S5.chat("kairat", "pay3", "Kaspi реквизиттерін жіберіңізші", "Kaspi арқылы төлеуге болады.");
  ok("по-казахски («Kaspi реквизиттерін») → реквизиты добавлены", r.reply.includes(PAY), r.reply);
  // ИИ сам придумал номер — до клиента он не доходит, а настоящие реквизиты доходят
  r = await S5.chat("kairat", "pay4", "Скиньте номер для перевода", ["Переводите на Kaspi +7 777 000 11 22.", "Реквизиты для перевода ниже.\n[РЕКВИЗИТЫ]"]);
  ok("выдуманный ИИ номер не уходит клиенту, реквизиты из паспорта уходят", !/777 000 11 22/.test(r.reply) && r.reply.includes(PAY), r.reply);
  // обычный вопрос — реквизитов нет
  r = await S5.chat("kairat", "pay5", "Сколько стоит стрижка?", "Мужская стрижка — от 6000 ₸. Записать вас?");
  ok("обычный вопрос → реквизиты не добавляются", !r.reply.includes("555 44 33"), r.reply);
  // реквизиты уже в ответе (повтор) — второй раз не добавляются
  r = await S5.chat("kairat", "pay6", "Как оплатить через каспи?", "Вот реквизиты.\n[РЕКВИЗИТЫ]\n[РЕКВИЗИТЫ]");
  ok("две метки → реквизиты один раз", r.reply.split("555 44 33").length === 2, r.reply);
  // в истории чата (и в пульте) — то, что ушло клиенту
  const h = S5.hist("web", "kairat", "pay1");
  ok("в истории чата ответ бота с реквизитами", h && h.turns.at(-1).text.includes(PAY), JSON.stringify(h && h.turns.at(-1)));

  // пульт: реквизиты приходят в данных чата — кнопка «₸» вставляет их в ответ
  d = await (await own.go("/api/inbox/chat?c=kairat&ch=web&id=pay1")).json();
  ok("пульт: в данных чата есть реквизиты компании", d.pay === PAY, JSON.stringify(d).slice(0, 300));
  const kk = await (await own.post("/api/studio/key", { id: "kairat" })).json(), staff = S5.browser(); await staff.go("/inbox?c=kairat&key=" + kk.key);
  d = await (await staff.go("/api/inbox/chat?c=kairat&ch=web&id=pay1")).json();
  ok("пульт сотрудника: реквизиты тоже есть", d.pay === PAY, JSON.stringify(d).slice(0, 200));
  const pult = await (await own.go("/inbox?c=kairat")).text();
  ok("в пульте есть кнопка реквизитов", /id="pay"/.test(pult) && /Реквизиты/.test(pult));

  // без реквизитов в паспорте: метку ИИ клиенту не показываем, правила в подсказке нет
  await own.post("/api/studio/save", { ...PASS, isNew: false, pay: "" });
  S5.env.__force = 1; await S5.call("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  await new Promise(s => setTimeout(s, 5));
  r = await S5.chat("kairat", "pay7", "Как оплатить?", "Оплата наличными или Kaspi на месте.\n[РЕКВИЗИТЫ]");
  ok("реквизитов нет в паспорте → метка из ответа убрана, ничего не добавлено", !/РЕКВИЗИТ/.test(r.reply) && /Оплата наличными/.test(r.reply), r.reply);
  d = await (await own.go("/api/inbox/chat?c=kairat&ch=web&id=pay7")).json();
  ok("пульт без реквизитов: поля нет — кнопка скрыта", !d.pay, JSON.stringify(d).slice(0, 200));
}

// ====== Допродажи: «к стрижке — бороду», один раз и без давления
section("допродажи");
{
  const S6 = mk(), own = S6.browser(); await own.go("/studio?key=" + OWNER);
  let d = await (await own.post("/api/studio/check", { ...PASS, upsell: "Мужская стрижка → Педикюр" })).json();
  ok("допродажа с услугой, которой нет в списке → ошибка с названием", d.ok === false && d.errors.some(e => /допродаж/i.test(e) && /Педикюр/.test(e)), JSON.stringify(d.errors));
  d = await (await own.post("/api/studio/check", { ...PASS, upsell: Array.from({ length: 11 }, () => "Мужская стрижка → Оформление бороды").join("\n") })).json();
  ok("больше 10 допродаж → ошибка", d.ok === false && d.errors.some(e => /допродаж/i.test(e)), JSON.stringify(d.errors));
  d = await (await own.post("/api/studio/check", { ...PASS, upsell: "Мужская стрижка ничего" })).json();
  ok("строка без стрелки → ошибка с подсказкой формата", d.ok === false && d.errors.some(e => /допродаж/i.test(e) && /→/.test(e)), JSON.stringify(d.errors));
  d = await (await own.post("/api/studio/save", { ...PASS, upsell: "мужская стрижка -> оформление бороды\nДетская стрижка - Мужская стрижка" })).json();
  ok("паспорт с допродажами сохраняется (стрелка «->» и «-», регистр не важен)", d.ok === true, JSON.stringify(d));
  await S6.chat("kairat", "up1", "Хочу на мужскую стрижку", "Хорошо! На какой день вас записать?");
  const sys = net.gemini.at(-1).systemInstruction.parts[0].text;
  ok("в подсказке правило допродаж с парами из паспорта и названиями из списка услуг", /Допродажа/.test(sys) && sys.includes("Мужская стрижка → Оформление бороды") && sys.includes("Детская стрижка → Мужская стрижка") && /один раз/.test(sys) && /отказал/.test(sys), sys.slice(-700));
  const pg = await (await own.go("/studio")).text();
  ok("в форме паспорта есть поле допродаж", /id="f_upsell"/.test(pg) && /'upsell'/.test(pg));
  await own.post("/api/studio/save", { ...PASS, isNew: false, upsell: "" });
  await S6.chat("kairat", "up2", "Хочу на мужскую стрижку", "Хорошо! На какой день вас записать?");
  ok("без допродаж в паспорте правила в подсказке нет", !/Допродажа/.test(net.gemini.at(-1).systemInstruction.parts[0].text));
  // запись через Altegio: услуги не в паспорте — проверить названия нельзя, строки принимаются
  d = await (await own.post("/api/studio/check", { id: "salon2", isNew: true, name: "Салон", niche: "beauty", address: "Алматы", phone: "+7 727 000 00 02", schedule: "ежедневно 9–21", booking: "altegio", altegioLoc: "5002", upsell: "Маникюр → Покрытие гель-лаком" })).json();
  ok("Altegio: допродажи принимаются без сверки со списком услуг", d.ok === true, JSON.stringify(d.errors));
}

// ====== Дневная сводка в Telegram: раз в день, в час из паспорта (по умолчанию 21:00 по Астане)
section("дневная сводка");
{
  const S7 = mk(), own = S7.browser(); await own.go("/studio?key=" + OWNER);
  const at = (h, m, dayShift = 0) => Date.UTC(2026, 9, 3 + dayShift, h - 5, m); // местное время Астаны → мс
  let d = await (await own.post("/api/studio/check", { ...PASS, digest: "25" })).json();
  ok("час сводки вне 6–23 → ошибка паспорта", d.ok === false && d.errors.some(e => /сводк/i.test(e)), JSON.stringify(d.errors));
  d = await (await own.post("/api/studio/save", PASS)).json();
  ok("паспорт без часа сводки сохраняется (по умолчанию 21:00)", d.ok === true, JSON.stringify(d));
  await own.post("/api/studio/save", { ...PASS, id: "shop", name: "Phone Shop", tg: "555000222", digest: "off" });
  const pg = await (await own.go("/studio")).text();
  ok("в форме паспорта есть выбор времени сводки", /id="f_digest"/.test(pg) && /'digest'/.test(pg) && /не присылать/.test(pg));
  // события дня: чат на сайте, чат в WhatsApp, который ждёт ответа, заявки разных видов и одна вчерашняя
  await S7.chat("kairat", "dg1", "Привет", "Здравствуйте! Чем помочь?");
  const now = Date.now(), K = S7.env.KV;
  await K.put("h:ga:kairat:77011234567", JSON.stringify({ n: 1, turns: [{ role: "user", text: "Алло", t: now }], profile: { li: now } }), { metadata: { t: now, li: now, nd: "human" } });
  await K.put("h:ga:kairat:77019999999", JSON.stringify({ n: 1, turns: [], profile: {} }), { metadata: { t: now - 2 * 86400e3, li: now - 2 * 86400e3 } });
  const L = (id, x) => ({ id, ts: x.ts || now, name: "Клиент", phone: "+77011234567", service: "Стрижка", time: "завтра 11:00", ...x });
  await K.put("leads:kairat", JSON.stringify([L("a1", { altegio: { record_id: 5 } }), L("a2", {}), L("a3", { kind: "callback" }), L("a4", { kind: "cancel" }), L("a5", { kind: "change" }), L("a6", { ts: now - 86400e3 })]));
  net.reset();
  await S7.cron(at(12, 5));
  ok("в 12:05 сводки нет", !net.tg.length, JSON.stringify(net.tg));
  await S7.cron(at(21, 3));
  const tg = net.tg.map(x => x.text || ""), dg = tg.filter(x => /Сводка/.test(x));
  ok("в 21:03 — одна сводка, только по боту из паспорта (демо и выключенная сводка — без неё)", dg.length === 1 && /Barber House/.test(dg[0]) && net.tg.filter(x => /Сводка/.test(x.text || "")).every(x => String(x.chat_id) === "555000111"), JSON.stringify(net.tg));
  const t = dg[0] || "";
  ok("в сводке: чаты WhatsApp и сайта, записи Altegio, заявки, звонки, отмены и переносы, ждут ответа", /сегодня/.test(t) && /WhatsApp: 1/.test(t) && /сайт\S*: 1/.test(t) && /Altegio: 1/.test(t) && /[Зз]аявок[^:]*: 1/.test(t) && /перезвонить: 1/.test(t) && /отмен[^:]*: 2/.test(t) && /[Жж]дут ответа: 1/.test(t), t);
  ok("без SITE_URL — ссылки на пульт нет", !/https?:/.test(t), t);
  net.reset(); await S7.cron(at(21, 6));
  ok("повторный запуск в тот же вечер — второй сводки нет", !net.tg.some(x => /Сводка/.test(x.text || "")), JSON.stringify(net.tg));
  // утренняя сводка — за вчера, со ссылкой на пульт
  await own.post("/api/studio/save", { ...PASS, isNew: false, digest: "9" });
  S7.env.SITE_URL = "https://bot.example";
  net.reset(); await S7.cron(at(9, 1, 1));
  const m9 = (net.tg.find(x => /Сводка/.test(x.text || "")) || {}).text || "";
  ok("сводка в 9:00 — за вчерашний день, со ссылкой на пульт", /вчера/.test(m9) && /Altegio: 1/.test(m9) && m9.includes("https://bot.example/inbox?c=kairat"), m9);
  delete S7.env.TG_TOKEN; net.reset(); await S7.cron(at(9, 2, 2));
  ok("без Telegram сводка не отправляется и не падает", !net.tg.length);
  // пустой день — короткая сводка, что обращений не было
  S7.env.TG_TOKEN = "tgtoken"; await K.put("leads:kairat", "[]"); await K.delete("h:ga:kairat:77011234567"); await K.delete("h:web:kairat:dg1");
  net.reset(); await S7.cron(at(9, 3, 4));
  const m0 = (net.tg.find(x => /Сводка/.test(x.text || "")) || {}).text || "";
  ok("день без обращений → сводка «обращений не было»", /обращений не было/.test(m0), m0 || JSON.stringify(net.tg));
}

// ====== Напоминания о записи и просьба об отзыве: только о настоящих записях в Altegio, только в WhatsApp
section("напоминания и отзывы");
{
  const S8 = mk({ WA_TOKEN_SALON: "tok-salon", APP_SECRET_SALON: "sec-salon", ALTEGIO_PARTNER: "partner-key" }), own = S8.browser(); await own.go("/studio?key=" + OWNER);
  const at = (day, h, m) => { const [y, mo, d] = day.split("-").map(Number); return Date.UTC(y, mo - 1, d, h - 5, m); }; // местное время Астаны → мс
  const SALON = { id: "salon", isNew: true, name: "Салон Айгерим", niche: "beauty", address: "Алматы, ул. Абая, 1", phone: "+7 727 000 00 01", schedule: "ежедневно 9–21", booking: "altegio", altegioLoc: "5001", tg: "777000", review: "https://2gis.kz/almaty/firm/123/tab/reviews" };
  let d = await (await own.post("/api/studio/check", { ...SALON, review: "2gis.kz/almaty/firm/123" })).json();
  ok("ссылка на отзывы без https:// → ошибка паспорта", d.ok === false && d.errors.some(e => /отзыв/i.test(e)), JSON.stringify(d.errors));
  d = await (await own.post("/api/studio/save", SALON)).json();
  ok("паспорт со ссылкой на отзывы сохраняется", d.ok === true, JSON.stringify(d));
  const pg = await (await own.go("/studio")).text();
  ok("в форме паспорта есть напоминания и ссылка на отзывы", /id="f_remind"/.test(pg) && /id="f_review"/.test(pg) && /'remind'/.test(pg) && /'review'/.test(pg));
  const o = { secret: "sec-salon", pnid: "900222" }, book = async (who, name, day, time, text) => {
    const m = time === "10:00" ? "Ерлан" : "Арман"; // в заглушке Altegio в 10:00 свободен только Ерлан
    net.ai = [`Записала.\n[ЗАЯВКА] Имя: ${name}; Телефон: указан; Услуга: Мужская стрижка; Мастер: ${m}; Дата: ${day}; Время: ${time}`];
    await S8.waText("/wa/salon", who, text || `${name}, мужская стрижка к мастеру ${m}, ${time}`, o);
  };
  const C1 = "77071110011", C2 = "77071110012", C3 = "77071110013", C4 = "77071110014";
  net.reset(); await book(C1, "Айша", D1, "10:00");
  ok("запись в Altegio создана", net.altRecords.length === 1 && S8.sentTo(C1).some(x => /Записала вас/.test(x)), JSON.stringify(S8.sentTo(C1)));
  const q = S8.kv.json("rmq:salon") || [], kinds = q.map(x => x.k).sort().join();
  ok("в очереди три сообщения: накануне в 18:00, за 2 часа и просьба об отзыве", kinds === "d1,h2,rv" && q.find(x => x.k === "d1").at === at(D0, 18, 0) && q.find(x => x.k === "h2").at === at(D1, 8, 0) && q.find(x => x.k === "rv").at === at(D1, 13, 0), JSON.stringify(q));
  ok("клиент с очередью попал в общий список", (S8.kv.json("rmidx") || []).includes("salon"));

  // вторая запись, потом клиент просит её отменить — напоминаний по ней не будет
  await book(C2, "Ерлан", D1, "11:00");
  net.ai = [`Передала администратору, он подтвердит отмену.\n[ОТМЕНА] Имя: Ерлан; Дата: ${D1}; Время: 11:00`];
  await S8.waText("/wa/salon", C2, "Отмените, пожалуйста, мою запись на завтра", o);
  // третья запись, потом клиент пишет «стоп»
  await book(C3, "Данияр", D1, "13:00");
  await S8.waText("/wa/salon", C3, "стоп", o);

  net.reset(); await S8.cron(at(D0, 17, 30));
  ok("в 17:30 напоминаний ещё нет", !net.graph.length, JSON.stringify(net.graph.map(g => g.body)));
  net.reset(); await S8.cron(at(D0, 18, 1));
  const r1 = S8.sentTo(C1);
  ok("в 18:00 накануне — напоминание: «завтра», время, салон, услуга и мастер", r1.length === 1 && /завтра/.test(r1[0]) && /10:00/.test(r1[0]) && /Салон Айгерим/.test(r1[0]) && /Мужская стрижка/.test(r1[0]) && /Ерлан/.test(r1[0]), JSON.stringify(r1));
  ok("клиенту с просьбой об отмене и клиенту, написавшему «стоп», напоминаний нет", !S8.sentTo(C2).length && !S8.sentTo(C3).length, JSON.stringify(net.graph.map(g => [g.body.to, g.body.text && g.body.text.body])));
  const h1 = S8.hist("wa", "salon", C1);
  ok("напоминание видно в переписке (и ИИ его видит)", h1.turns.at(-1).role === "model" && /завтра/.test(h1.turns.at(-1).text), JSON.stringify(h1.turns.at(-1)));
  net.reset(); await S8.cron(at(D0, 18, 6));
  ok("второй раз то же напоминание не приходит", !S8.sentTo(C1).length);
  // клиент написал утром — окно WhatsApp открыто ещё сутки
  net.reset(); await S8.cron(at(D1, 8, 1));
  const r2 = S8.sentTo(C1);
  ok("за 2 часа — «сегодня», время и адрес", r2.length === 1 && /сегодня/.test(r2[0]) && /10:00/.test(r2[0]) && /ул\. Абая, 1/.test(r2[0]), JSON.stringify(r2));
  net.reset(); await S8.cron(at(D1, 13, 1));
  ok("отзыв через официальный WhatsApp — только в 24-часовом окне: клиент молчал больше суток → не отправлено", !S8.sentTo(C1).length, JSON.stringify(net.graph.map(g => g.body)));

  // обычный WhatsApp (Green-API): окна в 24 часа нет — просьба об отзыве уходит на следующий день
  S8.env.GA_ID_SALON = "7105000002"; S8.env.GA_TOKEN_SALON = "ga-tok-salon";
  await own.post("/api/launch/ga", { c: "salon" });
  const hu = new URL((net.gaSettings["7105000002"] || {}).webhookUrl || "https://x.invalid/"), gpath = hu.pathname + hu.search, inst = { idInstance: 7105000002, wid: "77000000078@c.us", typeInstance: "whatsapp" };
  let gm = 0; const gin = (from, text) => S8.call(gpath, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ typeWebhook: "incomingMessageReceived", instanceData: inst, timestamp: Math.floor(Date.now() / 1000), idMessage: "RIN" + (++gm), senderData: { chatId: from + "@c.us", sender: from + "@c.us", senderName: "Гость" }, messageData: { typeMessage: "textMessage", textMessageData: { textMessage: text } } }) });
  net.reset(); net.ai = [`Записала.\n[ЗАЯВКА] Имя: Мадина; Телефон: указан; Услуга: Мужская стрижка; Мастер: Ерлан; Дата: ${D1}; Время: 10:00`];
  await gin(C4, "Мадина, мужская стрижка к мастеру Ерлан, завтра 10:00");
  const q4 = (S8.kv.json("rmq:salon") || []).filter(x => x.id === C4);
  ok("Green-API: запись создана, в очереди напоминания и отзыв", net.altRecords.length === 1 && q4.map(x => x.k).sort().join() === "d1,h2,rv" && q4.every(x => x.ch === "ga"), JSON.stringify([q4, net.ga.filter(x => x.op === "sendMessage").map(x => x.body.message)]));
  net.reset(); await S8.cron(at(D1, 13, 1));
  const r4 = net.ga.filter(x => x.op === "sendMessage" && String(x.body.chatId) === C4 + "@c.us").map(x => x.body.message);
  ok("после визита — просьба об отзыве со ссылкой из паспорта (опоздавшие напоминания не ушли)", r4.length === 1 && r4[0].includes("https://2gis.kz/almaty/firm/123/tab/reviews") && /Спасибо/.test(r4[0]), JSON.stringify(r4));
  // устаревшее (фоновая задача не работала больше 3 часов) — не отправляем, из очереди убираем
  net.reset(); await S8.cron(at(D2, 12, 0));
  ok("сообщения, опоздавшие больше чем на 3 часа, не уходят; очередь пустеет", !net.graph.length && !(S8.kv.json("rmq:salon") || []).length && !(S8.kv.json("rmidx") || []).includes("salon"), JSON.stringify([net.graph.map(g => g.body), S8.kv.json("rmq:salon"), S8.kv.json("rmidx")]));

  // напоминания выключены в паспорте, ссылки на отзыв нет — очередь не создаётся
  await own.post("/api/studio/save", { ...SALON, isNew: false, remind: "off", review: "" });
  net.reset(); await book("77071110015", "Тимур", D1, "10:00");
  ok("напоминания выключены и нет ссылки на отзыв → ничего не запланировано", !(S8.kv.json("rmq:salon") || []).some(x => x.id === "77071110015"), JSON.stringify(S8.kv.json("rmq:salon")));
  // только накануне
  await own.post("/api/studio/save", { ...SALON, isNew: false, remind: "day", review: "" });
  net.reset(); await book("77071110016", "Асель", D1, "11:00");
  const q6 = (S8.kv.json("rmq:salon") || []).filter(x => x.id === "77071110016").map(x => x.k).join();
  ok("«только накануне» → одно напоминание", q6 === "d1", q6);
  // веб-чат: писать некуда — ничего не планируем
  const wc = await S8.chat("salon", "rmweb1", `Айгуль, +7 701 333 22 11, мужская стрижка ${D1} 10:00`, `Записала.\n[ЗАЯВКА] Имя: Айгуль; Телефон: указан; Услуга: Мужская стрижка; Мастер: любой; Дата: ${D1}; Время: 10:00`);
  ok("запись из чата на сайте: напоминаний нет (написать туда нельзя)", !(S8.kv.json("rmq:salon") || []).some(x => x.ch === "web"), JSON.stringify([wc.reply, S8.kv.json("rmq:salon")]));
}

// ====== Ремонт техники: предварительная оценка по прайсу «модель | работа | цена | срок»
section("оценка ремонта по прайсу");
{
  const S9 = mk(), own = S9.browser(); await own.go("/studio?key=" + OWNER);
  const REP = "iPhone 13 | замена экрана | 45000–60000 | 1 день\niPhone 13 | замена аккумулятора | 18000 | 2 часа\nSamsung A54 | замена экрана | от 30000 | 1–2 дня\nлюбая модель | диагностика | бесплатно | 30 минут\nRedmi Note 12 | замена разъёма зарядки | после диагностики |";
  const SHOP = { id: "shop", isNew: true, name: "Phone Shop", niche: "repair", address: "Актау, 14 мкр, дом 5", phone: "+7 701 000 00 09", schedule: "ежедневно 10–20", booking: "none", services: "Чехол силиконовый — 3000\nЗащитное стекло — от 2500", repairs: REP };
  let d = await (await own.go("/api/studio/list")).json();
  ok("в списке ниш есть «Ремонт и магазин техники»", d.niches.some(n => n.id === "repair" && /[Рр]емонт/.test(n.title)), JSON.stringify(d.niches));
  d = await (await own.post("/api/studio/check", { ...SHOP, repairs: "iPhone 13 замена экрана 45000" })).json();
  ok("строка прайса без «|» → ошибка с номером строки и подсказкой формата", d.ok === false && d.errors.some(e => /прайс ремонта, строка 1/.test(e) && /\|/.test(e)), JSON.stringify(d.errors));
  d = await (await own.post("/api/studio/check", { ...SHOP, repairs: "iPhone 13 | замена экрана |  | 1 день" })).json();
  ok("строка прайса без цены → ошибка", d.ok === false && d.errors.some(e => /прайс ремонта, строка 1/.test(e) && /цен/.test(e)), JSON.stringify(d.errors));
  d = await (await own.post("/api/studio/check", { ...SHOP, repairs: Array.from({ length: 301 }, (_, i) => `Модель ${i} | замена экрана | 20000 | 1 день`).join("\n") })).json();
  ok("больше 300 строк прайса → ошибка", d.ok === false && d.errors.some(e => /прайс ремонта/.test(e) && /300/.test(e)), JSON.stringify(d.errors));
  d = await (await own.post("/api/studio/check", { ...SHOP, repairs: Array.from({ length: 250 }, (_, i) => `Модель ${i} | замена экрана | 20000 | 1 день`).join("\n") })).json();
  ok("250 строк прайса (больше, чем 80 услуг) принимаются", d.ok === true, JSON.stringify(d.errors));
  d = await (await own.post("/api/studio/save", SHOP)).json();
  ok("паспорт магазина с прайсом ремонта сохраняется", d.ok === true, JSON.stringify(d));
  const pg = await (await own.go("/studio")).text();
  ok("в форме паспорта есть поле прайса ремонта", /id="f_repairs"/.test(pg) && /'repairs'/.test(pg));

  let r = await S9.chat("shop", "rp1", "Сколько стоит поменять экран на айфон 13?", "Замена экрана на iPhone 13 — от 45 000 до 60 000 ₸, около 1 дня. Это предварительная оценка: точную цену мастер скажет после бесплатной диагностики. Принесёте телефон?");
  ok("цена из прайса проходит защиту без изменений", !r.guard && /45 000/.test(r.reply) && /60 000/.test(r.reply), JSON.stringify(r));
  const sys = net.gemini.at(-1).systemInstruction.parts[0].text;
  ok("в подсказке — прайс ремонта строками и правило предварительной оценки", sys.includes("iPhone 13 | замена экрана | от 45 000 до 60 000 ₸ | 1 день") && sys.includes("Redmi Note 12 | замена разъёма зарядки | цену назовёт мастер после диагностики") && /предварительн/.test(sys) && /диагностик/.test(sys) && /модел/.test(sys), sys.slice(sys.indexOf("Прайс ремонта") - 10, sys.indexOf("Прайс ремонта") + 700));
  r = await S9.chat("shop", "rp2", "А экран на iPhone 14 сколько?", ["Замена экрана на iPhone 14 — 70 000 ₸.", "Цены на iPhone 14 в прайсе нет — мастер оценит его на бесплатной диагностике. Принесёте телефон?"]);
  ok("выдуманная цена (70 000, нет в прайсе) до клиента не доходит", !/70 000/.test(r.reply) && /диагностик/.test(r.reply) && /исправлено/.test(r.guard || ""), JSON.stringify(r));
  r = await S9.chat("shop", "rp3", "А экран на iPhone 15?", ["Замена экрана на iPhone 15 — 80 000 ₸.", "На iPhone 15 — 85 000 ₸."]);
  ok("магазин без записи: запасной ответ не предлагает «подобрать время», а просит имя и телефон", !/[Пп]одобрать вам удобное время/.test(r.reply) && /телефон/.test(r.reply) && !/80 000|85 000/.test(r.reply), r.reply);
  d = await (await own.go("/api/launch/status?c=shop")).json();
  ok("экзамен: есть сценарий «Оценка ремонта» по прайсу", (d.cases || []).some(k => /Оценка ремонта/.test(k.t)), JSON.stringify(d.cases));
}

// ====== Рассылки по сегментам: «давно не были» и «день рождения скоро» — по датам из списка
section("рассылки: сегменты");
{
  const SA = mk({ GA_ID_KAIRAT: "7105000009", GA_TOKEN_KAIRAT: "ga-tok-k9" }), own = SA.browser(); await own.go("/studio?key=" + OWNER);
  await own.post("/api/studio/save", PASS);
  const J = async r => r.json();
  const LIST = "Телефон; Имя; Последний визит; День рождения\n8 701 222 00 01; Айгерим; 01.08.2026; 12.10.1995\n8 701 222 00 02; Данияр; 25.09.2026; 05.03.1990\n8 701 222 00 03; Ерлан; ; \n+7 701 222 00 04, Мадина, 2026-06-15, 10.10";
  const BASE = { c: "kairat", ch: "ga", name: "Сегмент", text: "Здравствуйте, {имя}! Скучаем по вам — скидка 10% до конца недели.", recipients: LIST, cap: 50, from: 10, to: 20, consent: true };
  let d = await J(await own.post("/api/bc/check", BASE));
  ok("строка заголовка не считается ошибкой, все 4 номера на месте", d.valid === 4 && d.badN === 0, JSON.stringify(d));
  d = await J(await own.post("/api/bc/check", { ...BASE, seg: "idle", segDays: 30 }));
  ok("«не были больше 30 дней»: двое (Айгерим, Мадина), без даты визита — отсеян и посчитан", d.valid === 2 && d.sample.some(x => /Айгерим/.test(x)) && d.sample.some(x => /Мадина/.test(x)) && d.noDate === 1 && d.segOut === 2, JSON.stringify(d));
  d = await J(await own.post("/api/bc/check", { ...BASE, seg: "bday", segDays: 10 }));
  ok("«день рождения в ближайшие 10 дней»: Айгерим (12.10) и Мадина (10.10)", d.valid === 2 && d.sample.some(x => /Айгерим/.test(x)) && d.sample.some(x => /Мадина/.test(x)), JSON.stringify(d));
  d = await J(await own.post("/api/bc/check", { ...BASE, recipients: "8 701 222 00 05, Асель, 15.07.2026, 20.10.2000\n8 701 222 00 06, Тимур, 20.09.2026, 02.02.1988", seg: "bday", segDays: 20 }));
  ok("без заголовка: старая дата — день рождения, недавняя — визит", d.valid === 1 && /Асель/.test(d.sample[0] || ""), JSON.stringify(d));
  d = await J(await own.post("/api/bc/check", { ...BASE, recipients: "8 701 222 00 05, Асель, 15.07.2026, 20.10.2000\n8 701 222 00 06, Тимур, 20.09.2026, 02.02.1988", seg: "idle", segDays: 60 }));
  ok("без заголовка: «не были больше 60 дней» — только Асель", d.valid === 1 && /Асель/.test(d.sample[0] || ""), JSON.stringify(d));
  d = await J(await own.post("/api/bc/create", { ...BASE, seg: "idle", segDays: 0 }));
  ok("число дней сегмента вне 1–365 → ошибка", d.ok === false && d.errors.some(e => /дн/.test(e)), JSON.stringify(d));
  d = await J(await own.post("/api/bc/create", { ...BASE, seg: "idle", segDays: 30 }));
  ok("рассылка по сегменту создана только на двоих, сегмент записан", d.ok === true && d.b.total === 2 && /не были/.test(d.b.seg || ""), JSON.stringify(d));
  const pg = await (await own.go("/broadcast?c=kairat")).text();
  ok("на странице рассылок есть выбор сегмента", /id="f_seg"/.test(pg) && /id="f_segd"/.test(pg) && /день рождения/i.test(pg));
}

// ====== Живая проверка 10 октября: после просьбы об отмене вопрос «как оплатить?» получал ответ про отмену, а не про оплату
section("после просьбы об отмене — вопрос об оплате");
{
  const SB = mk({ WA_TOKEN_SALON: "tok-salon", APP_SECRET_SALON: "sec-salon", ALTEGIO_PARTNER: "partner-key" }), own = SB.browser(); await own.go("/studio?key=" + OWNER);
  const PAY = "Kaspi Gold: +7 701 555 44 33 (Кайрат К.)";
  await own.post("/api/studio/save", { id: "salon", isNew: true, name: "Салон Айгерим", niche: "beauty", address: "Алматы, ул. Абая, 1", phone: "+7 727 000 00 01", schedule: "ежедневно 9–21", booking: "altegio", altegioLoc: "5001", tg: "777000", pay: PAY });
  const o = { secret: "sec-salon", pnid: "900222" }, C = "77071110021";
  const say = async (text, ai) => { net.reset(); net.ai = Array.isArray(ai) ? ai : [ai]; await SB.waText("/wa/salon", C, text, o); const r = SB.sentTo(C); return r[r.length - 1] || ""; };
  await say("Азамат, мужская стрижка к Ерлану завтра в 10:00", `Записала.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: Мужская стрижка; Мастер: Ерлан; Дата: ${D1}; Время: 10:00`);
  ok("запись создана", net.altRecords.length === 1, JSON.stringify(net.altRecords));
  let r = await say("я передумал, отмените запись", `Передала администратору вашу просьбу об отмене.\n[ОТМЕНА] Имя: Азамат; Дата: ${D1}; Время: 10:00`);
  ok("просьба об отмене ушла администратору", /[Пп]ередала администратору/.test(r), r);
  // ИИ в ответе на вопрос об оплате снова пишет про отмену (неправду), но и отвечает на вопрос
  r = await say("как оплатить?", "Ваша запись отменена. Оплатить можно наличными или Kaspi на месте.");
  ok("вопрос об оплате: ответ про оплату сохранён, ложное «отменена» убрано, нет «напишите, что сделать»", /наличными/.test(r) && !/отменена/.test(r) && !/Напишите, что сделать/.test(r), r);
  ok("…и реквизиты из паспорта пришли", r.includes(PAY), r);
  r = await say("оставьте запись, как оплатить?", "Хорошо, запись оставляем. Оплатить можно наличными или Kaspi.");
  ok("«оставьте запись, как оплатить?»: администратор узнал, клиент получил и ответ про запись, и реквизиты", /администратор/i.test(r) && r.includes(PAY), r);
}

// ====== Живая проверка 10 октября (2): ИИ назвал реквизиты из переписки «ошибочными»; «Папа + Сын» записал как две услуги
section("подсказка: реквизиты в переписке и услуга на двоих");
{
  const SC = mk({ ALTEGIO_PARTNER: "partner-key" }), own = SC.browser(); await own.go("/studio?key=" + OWNER);
  await own.post("/api/studio/save", { id: "salon", isNew: true, name: "Салон Айгерим", niche: "beauty", address: "Алматы, ул. Абая, 1", phone: "+7 727 000 00 01", schedule: "ежедневно 9–21", booking: "altegio", altegioLoc: "5001", tg: "777000", pay: "Kaspi Gold: +7 701 555 44 33" });
  await SC.chat("salon", "pp1", "Как оплатить?", "Реквизиты ниже.\n[РЕКВИЗИТЫ]");
  const sys = net.gemini.at(-1).systemInstruction.parts[0].text;
  ok("правило оплаты: реквизиты в переписке верные, не называть их ошибочными и не отсылать к администратору", /верн/.test(sys) && /ошибочн/.test(sys) && /администратор/.test(sys.slice(sys.indexOf("Оплата"))), sys.slice(sys.indexOf("Оплата")));
  ok("правило записи: услуга на несколько человек («Папа + Сын») — одна запись, второго отдельно не записывать", /нескольких человек/.test(sys) && /одна запись/i.test(sys), sys.slice(sys.indexOf("Г. "), sys.indexOf("Д. ")));
}

// ====== Живая проверка 10 октября (3): записи удалили в Altegio, чат на телефоне очистили — бот всё равно «помнил» их
section("записи, удалённые в Altegio; очистка памяти бота");
{
  const SD = mk({ WA_TOKEN_SALON: "tok-salon", APP_SECRET_SALON: "sec-salon", ALTEGIO_PARTNER: "partner-key" }), own = SD.browser(); await own.go("/studio?key=" + OWNER);
  await own.post("/api/studio/save", { id: "salon", isNew: true, name: "Салон Айгерим", niche: "beauty", address: "Алматы, ул. Абая, 1", phone: "+7 727 000 00 01", schedule: "ежедневно 9–21", booking: "altegio", altegioLoc: "5001", tg: "777000" });
  const o = { secret: "sec-salon", pnid: "900222" }, C = "77071110031";
  const say = async (text, ai) => { net.ai = Array.isArray(ai) ? ai : [ai]; await SD.waText("/wa/salon", C, text, o); };
  net.reset(); net.altGone = [];
  await say("Азамат, мужская стрижка к Ерлану завтра в 10:00", `Записала.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: Мужская стрижка; Мастер: Ерлан; Дата: ${D1}; Время: 10:00`);
  const rec = String((SD.hist("wa", "salon", C).profile.bookings || [])[0]?.record_id || "");
  ok("запись создана и запомнена в чате", !!rec, JSON.stringify(SD.hist("wa", "salon", C).profile));
  await say("Сколько стоит борода?", "Оформление бороды — от 4 000 ₸.");
  ok("запись в Altegio на месте — бот её помнит", (SD.hist("wa", "salon", C).profile.bookings || []).length === 1 && /Мужская стрижка/.test(net.gemini.at(-1).systemInstruction.parts[0].text.split("Уже известно о клиенте")[1] || ""));
  net.altGone = [rec]; // администратор удалил запись прямо в Altegio
  await new Promise(s => setTimeout(s, 5));
  await say("Хочу комплекс завтра в 11:00", "На какое имя записать?");
  const sys = net.gemini.at(-1).systemInstruction.parts[0].text;
  ok("запись удалена в Altegio → бот её забыл: в подсказке её нет, в чате тоже", !(SD.hist("wa", "salon", C).profile.bookings || []).length && !/Мужская стрижка/.test(sys.split("Уже известно о клиенте")[1] || ""), JSON.stringify([SD.hist("wa", "salon", C).profile.bookings, (sys.split("Уже известно о клиенте")[1] || "").slice(0, 200)]));
  ok("проверка шла запросом чтения записи в Altegio", net.alt.some(x => x.startsWith("GET /user/records/" + rec + "/")), JSON.stringify(net.alt.slice(-6)));
  // Altegio не ответил (сбой) — запись не теряем
  net.altGone = []; net.reset();
  await say("Азамат, мужская стрижка к Ерлану послезавтра в 10:00", `Записала.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: Мужская стрижка; Мастер: Ерлан; Дата: ${D2}; Время: 10:00`);
  ok("новая запись создана", (SD.hist("wa", "salon", C).profile.bookings || []).length === 1);

  // записи моложе 5 минут по времени мастера не проверяются — «состариваем» записи чата
  const age = (id = C) => { const k = "h:wa:salon:" + id, v = SD.kv.json(k); for (const x of v.profile.bookings || []) x.at = (x.at || Date.now()) - 10 * 60e3; SD.kv.mem.set(k, JSON.stringify(v)); };

  // чтение записи этим ключом Altegio недоступно (как может быть вживую) — удалённую запись видно по освободившемуся времени мастера
  net.altBusy = true; net.altGetFail = 401; net.altGone = [];
  await say("Сколько стоит детская стрижка?", "Детская стрижка — от 4 000 ₸.");
  const rec2 = String((SD.hist("wa", "salon", C).profile.bookings || [])[0]?.record_id || "");
  ok("чтение записи недоступно, время мастера занято → запись бот помнит", !!rec2 && (SD.hist("wa", "salon", C).profile.bookings || []).length === 1, JSON.stringify(SD.hist("wa", "salon", C).profile.bookings));
  age();
  await say("А бритьё?", "Королевское бритьё — от 7 000 ₸.");
  ok("запись старше 5 минут, время мастера занято и проверка записи не проходит → запись бот помнит", (SD.hist("wa", "salon", C).profile.bookings || []).length === 1);
  net.altGone = [rec2]; // администратор удалил запись — время у Ерлана освободилось
  await say("А мужская?", "Мужская стрижка — от 6 000 ₸.");
  ok("время мастера освободилось → бот запись забыл", !(SD.hist("wa", "salon", C).profile.bookings || []).length, JSON.stringify([SD.hist("wa", "salon", C).profile.bookings, net.alt.slice(-5)]));
  // вживую 10 октября: клиент записался к «любому» мастеру, Altegio поставил Армана, а бот сказал «мастер не прикреплён»;
  // потом администратор удалил запись, а бот всё равно говорил «у вас запись на 14:00». Чтение записи — «успешно», но без поля deleted
  net.altGetFail = 0; net.altGetPlain = true; net.altGone = [];
  await say("Азамат, мужская стрижка завтра в 11:00, мастер любой", `Записала.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: Мужская стрижка; Мастер: любой; Дата: ${D1}; Время: 11:00`);
  let h3 = SD.hist("wa", "salon", C), b3 = (h3.profile.bookings || [])[0] || {};
  ok("«любой мастер»: бот сам выбрал мастера, у которого время свободно, и назвал его клиенту", b3.staffName === "Арман" && /мастер Арман/.test(h3.turns.at(-1).text) && net.altRecords.at(-1).appointments[0].staff_id === 11, JSON.stringify([b3, h3.turns.at(-1).text, net.altRecords.at(-1)]));
  await say("А кто у меня мастер?", "Ваш мастер — Арман.");
  ok("в подсказке ИИ у записи указан мастер", /Арман/.test((net.gemini.at(-1).systemInstruction.parts[0].text.split("Уже известно о клиенте")[1] || "").split("\n")[0]) && (SD.hist("wa", "salon", C).profile.bookings || []).length === 1);
  net.altGone = [String(b3.record_id)]; age();
  await say("Какие у меня записи на завтра?", "Записей нет.");
  const sys3 = net.gemini.at(-1).systemInstruction.parts[0].text;
  ok("чтение записи «успешно» без deleted, а время Армана освободилось → бот запись забыл, ИИ её не видит", !(SD.hist("wa", "salon", C).profile.bookings || []).length && !/Мужская стрижка/.test(sys3.split("Уже известно о клиенте")[1] || ""), JSON.stringify([SD.hist("wa", "salon", C).profile.bookings, (sys3.split("Уже известно о клиенте")[1] || "").slice(0, 200)]));
  // вживую 10 октября (demo6): память чата очистили, запись удалили в Altegio, клиент снова записывается на то же время —
  // бот нашёл старую заявку, вернул запись в чат и ответил «Вы уже записаны», в Altegio записи нет
  net.reset(); net.altBusy = true; net.altGetPlain = true; net.altGone = [];
  await say("Азамат, мужская стрижка завтра в 13:00, мастер любой", `Записала.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: Мужская стрижка; Мастер: любой; Дата: ${D1}; Время: 13:00`);
  const r4 = (SD.hist("wa", "salon", C).profile.bookings || [])[0] || {};
  ok("запись на 13:00 создана", !!r4.record_id && net.altRecords.length === 1, JSON.stringify(SD.hist("wa", "salon", C).profile.bookings));
  await own.post("/api/inbox/act", { c: "salon", ch: "wa", id: C, act: "forget" });
  net.altGone = [String(r4.record_id)];
  await say("Азамат, запишите к Арману завтра в 13:00", `Записала.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: Мужская стрижка; Мастер: Арман; Дата: ${D1}; Время: 13:00`);
  const h4 = SD.hist("wa", "salon", C), last4 = h4.turns.at(-1).text, oldLead = SD.leads("salon").find(l => l.altegio && String(l.altegio.record_id) === String(r4.record_id));
  ok("память очищена, запись удалена в Altegio → по старой заявке «Вы уже записаны» не отвечаем, создаём новую запись", net.altRecords.length === 2 && /Записала/.test(last4) && !/уже записаны/.test(last4) && (h4.profile.bookings || []).length === 1 && String(h4.profile.bookings[0].record_id) !== String(r4.record_id), JSON.stringify([last4, h4.profile.bookings, net.altRecords.length]));
  ok("после «Очистить память бота» старая заявка запись в чат не возвращает", !!oldLead, JSON.stringify(oldLead));
  // «Очистить память бота» обнуляет дневной предел записей этого номера (владелец проверяет бота со своего телефона)
  SD.kv.mem.set(`bk:5001:+${C}:${D0}`, "5");
  await own.post("/api/inbox/act", { c: "salon", ch: "wa", id: C, act: "forget" });
  ok("«Очистить память бота» — дневной предел записей номера заново", !SD.kv.mem.has(`bk:5001:+${C}:${D0}`));

  // старая запись к «любому» мастеру (мастер неизвестен), чтение записи недоступно: удалённой считаем, если время свободно у всех мастеров
  const C5 = "77071110032", say5 = async (text, ai) => { net.ai = [ai]; await SD.waText("/wa/salon", C5, text, o); }; // другой номер: у первого исчерпан дневной предел записей
  net.reset(); net.altGetPlain = false; net.altGetFail = 401; net.altGone = [];
    net.altData = () => ({ ...ALT_DEFAULT(), times: { 0: ["12:00"], 11: ["12:00"], 12: ["12:00"] } });
  await say5("Азамат, мужская стрижка завтра в 12:00, мастер любой", `Записала.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: Мужская стрижка; Мастер: любой; Дата: ${D1}; Время: 12:00`);
  const k5 = "h:wa:salon:" + C5, v5 = SD.kv.json(k5), r5 = (v5.profile.bookings || [])[0] || {};
  ok("запись на 12:00 к «любому» создана", !!r5.record_id, JSON.stringify([v5.profile, v5.turns.at(-1), net.altRecords]));
  r5.staffName = ""; SD.kv.mem.set(k5, JSON.stringify(v5)); // как запись, сделанная до 10 октября: мастер не известен
  await say5("Сколько стоит борода?", "Оформление бороды — от 4 000 ₸.");
  ok("мастер записи неизвестен, у одного мастера 12:00 занято → запись бот помнит", (SD.hist("wa", "salon", C5).profile.bookings || []).length === 1, JSON.stringify(SD.hist("wa", "salon", C5).profile.bookings));
  net.altGone = [String(r5.record_id)]; age(C5);
  await say5("А детская?", "Детская стрижка — от 4 000 ₸.");
  ok("мастер записи неизвестен, 12:00 свободно у всех мастеров → запись бот забыл", !(SD.hist("wa", "salon", C5).profile.bookings || []).length, JSON.stringify(SD.hist("wa", "salon", C5).profile.bookings));
  net.altData = null;
  // вживую 10 октября (demo7): запись к Арману на 12:00 есть, чтение записи ответило без deleted, а время мастера Altegio показал свободным —
  // бот решил, что запись удалили, и на «я записан или нет?» записывал заново (упёрся в предел — заявка администратору). Время мастера само по себе — не довод
  net.reset(); net.altBusy = false; net.altGetPlain = true; net.altGone = [];
  const C7 = "77071110037", say7 = async (text, ai) => { net.ai = [ai]; await SD.waText("/wa/salon", C7, text, o); };
  await say7("Азамат, мужская стрижка к Арману завтра в 11:00", `Записала.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: Мужская стрижка; Мастер: Арман; Дата: ${D1}; Время: 11:00`);
  await say7("я записан или нет?", `Да.\n[ЗАЯВКА] Имя: Азамат; Телефон: указан; Услуга: Мужская стрижка; Мастер: Арман; Дата: ${D1}; Время: 11:00`);
  const h7 = SD.hist("wa", "salon", C7);
  ok("чтение записи без deleted, время мастера «свободно» → запись бот помнит, второй раз не записывает", (h7.profile.bookings || []).length === 1 && net.altRecords.length === 1 && /уже записаны/.test(h7.turns.at(-1).text) && !(h7.profile.pend || []).length, JSON.stringify([h7.turns.at(-1).text, h7.profile.bookings, h7.profile.pend, net.altRecords.length]));
  // та же запись через 10 минут: время мастера «свободно», но пробная проверка записи не проходит — запись не забываем (нужны оба признака)
  { const k = "h:wa:salon:" + C7, v = SD.kv.json(k); for (const x of v.profile.bookings || []) x.at -= 10 * 60e3; SD.kv.mem.set(k, JSON.stringify(v)); }
  net.altCheckBusy = true;
  await say7("Спасибо", "Пожалуйста!");
  ok("время мастера «свободно», а проверка записи не проходит → запись бот помнит", (SD.hist("wa", "salon", C7).profile.bookings || []).length === 1);
  net.altCheckBusy = false;
  net.altBusy = false; net.altGetFail = 0; net.altGone = []; net.altGetPlain = false;
  // пульт: «Очистить память бота» — история и записи чата забыты, окно WhatsApp сохраняется
  let d = await (await own.post("/api/inbox/act", { c: "salon", ch: "wa", id: C, act: "forget" })).json();
  const h = SD.hist("wa", "salon", C);
  ok("пульт: «Очистить память бота» — переписка и записи бота забыты, окно WhatsApp сохранено", d.ok !== false && !d.error && h && !(h.turns || []).length && !(h.profile.bookings || []).length && !!h.profile.li, JSON.stringify([d.error, h]));
  const pult = await (await own.go("/inbox?c=salon")).text();
  ok("в меню чата есть «Очистить память бота»", /Очистить память бота/.test(pult));
}

if (process.argv[1] && process.argv[1].endsWith("platform.mjs")) {
  console.log(`\nНовые части: прошло ${T.pass}, не прошло ${T.fail}`);
  process.exit(T.fail ? 1 : 0);
}
