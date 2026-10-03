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
  ok("после смены ключа прежняя сессия сотрудника не действует", r.status === 403 && d.key !== staffKey);
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

if (process.argv[1] && process.argv[1].endsWith("platform.mjs")) {
  console.log(`\nНовые части: прошло ${T.pass}, не прошло ${T.fail}`);
  process.exit(T.fail ? 1 : 0);
}
