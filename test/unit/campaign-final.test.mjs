// Финальное ТЗ рассылок Winchester (02.11.2026): 28 утверждённых текстов в 7 категориях — слово в слово, без переменных, тире и
// пометок; имя в приветствии ставит система («Добрый день! 👋🏻» → «Добрый день, Азамат! 👋🏻»), без имени или с сомнительным —
// приветствие как есть; черновик второго номера из библиотеки — один и тот же текст в проверке, пробе и отправке; строка «стоп» —
// только по выбору владельца; запуск — только когда владелец снял запрет (GA_BROADCAST_<ID> = 1), и только после подтверждения
// итоговой аудитории и текста; итоги рассылки — выбрано, допущено, ушло, доставлено, прочитано, ответили, хотят записаться, записались
// после, отказались, ошибки; цифры базы за 90 дней. Всё на заглушках (журнал — net.altJournal, Green-API — net.ga). Номера вымышленные.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, gaPass } from "../harness.mjs";
import { LIBRARY, CATS, STOP_RU, baseOf } from "../../src/services/broadcast/library.js";
import { render, greetName } from "../../src/services/broadcast/render.js";
import { crmBuild as crmBuild0 } from "../../src/services/crm/snapshot.js";
import { grantSnap, consentSkip } from "../consent.mjs";
import { consentAdd } from "../../src/db/d1/rights.js";
import { bcTick } from "../../src/services/broadcast/sender.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";

// утверждённая редакция из ТЗ: номер, название, категория, текст
const APPROVED = [
  ["W01", "Знакомые лица", "Тёплое возвращение", "Добрый день! 👋🏻\n\nWinchester работает с 2019 года, и за это время у нас появилось много знакомых гостей. Всегда приятно видеть вас снова 🖤✂️\n\nЕсли захотите освежить стрижку, будем рады помочь с записью 😊"],
  ["W02", "Свои люди", "Тёплое возвращение", "Здравствуйте! 🤝\n\nВ Winchester особенно приятно встречать знакомых гостей. Хороший барбершоп для нас не только про стрижку, но и про атмосферу, в которую хочется возвращаться 💈🖤\n\nБудем рады новой встрече! Подобрать вам удобное время? 😊"],
  ["W03", "Рады видеть снова", "Тёплое возвращение", "Добрый день! 👋🏻\n\nИногда для хорошего настроения достаточно свежей стрижки и немного времени для себя ✂️😎\n\nЕсли захотите обновить образ, заглядывайте в Winchester. Поможем с записью! 💈"],
  ["W04", "Без лишних поводов", "Тёплое возвращение", "Здравствуйте! 😊\n\nДля хорошей стрижки не нужен особенный повод. Иногда просто хочется выглядеть аккуратно и чувствовать себя увереннее 😎✂️\n\nКогда будет такое настроение, заглядывайте к нам. Подберём удобное время! 🖤"],
  ["W05", "Стрижка уже отросла?", "Пора обновить стрижку", "Добрый день! 👋🏻\n\nВолосы растут незаметно, а свежая стрижка сразу меняет впечатление 😏✂️\n\nЕсли уже задумывались освежить образ, будем рады видеть вас в Winchester. Записать на удобное время? 💈"],
  ["W06", "Свежий образ", "Пора обновить стрижку", "Здравствуйте! 💈\n\nЗнакомое ощущение, когда выходишь из барбершопа со свежей стрижкой и всё снова выглядит как надо 😎🔥\n\nМожет, пора повторить? Поможем подобрать удобное время в Winchester! ✂️"],
  ["W07", "Порядок в деталях", "Пора обновить стрижку", "Добрый день! 👋🏻\n\nАккуратная стрижка делает весь образ собраннее. Иногда достаточно одного визита, чтобы снова выглядеть отлично ✂️🖤\n\nЕсли хочется освежиться, будем рады помочь. Записать вас? 😊"],
  ["W08", "Хорошее чувство", "Пора обновить стрижку", "Здравствуйте! 🤝\n\nЗнакомое чувство, когда после барбершопа смотришь в зеркало и думаешь: «Вот теперь отлично!» 😎💈\n\nБудем рады видеть вас снова. Подобрать удобное время для стрижки? ✂️"],
  ["W09", "Давно не виделись", "Давно не виделись", "Добрый день! 👋🏻\n\nДавно не виделись в Winchester! Надеемся, у вас всё отлично 😊🖤\n\nЕсли захотите обновить стрижку или просто уделить немного времени себе, будем рады новой встрече. Помочь с записью? 💈"],
  ["W10", "Помним наших гостей", "Давно не виделись", "Здравствуйте! 🤝\n\nЗа годы работы Winchester мы поняли одну вещь: особенно приятно, когда к нам возвращаются знакомые гости 🖤✂️\n\nБудем рады снова видеть вас в кресле нашего барбера. Когда вам было бы удобно заглянуть? 😊"],
  ["W11", "Пора освежиться", "Давно не виделись", "Добрый день! 👋🏻\n\nВ повседневных делах легко забыть уделить время себе. А свежая стрижка отлично помогает немного переключиться 😎💈\n\nЕсли давно собирались к барберу, будем рады вас видеть в Winchester! ✂️"],
  ["W12", "Двери открыты", "Давно не виделись", "Здравствуйте! 😊\n\nWinchester работает с 2019 года. За это время многое изменилось, но одно осталось прежним: мы всегда рады нашим гостям 🖤💈\n\nЕсли захотите снова заглянуть на стрижку, просто напишите. Подберём удобное время! ✂️"],
  ["W13", "Ваш привычный ритм", "Постоянные клиенты", "Добрый день! 👋🏻\n\nХорошая стрижка со временем становится приятной привычкой. Особенно когда нашёл своего барбера и знаешь, какого результата ждать 💈🖤\n\nБудем рады вашей следующей записи. Подобрать время? 😊"],
  ["W14", "Знакомое кресло", "Постоянные клиенты", "Здравствуйте! 😎\n\nИногда приятно просто прийти в знакомое место, довериться своему мастеру и выйти со свежей стрижкой ✂️💈\n\nВ Winchester всегда рады вашему возвращению. Когда вам удобно заглянуть? 🤝"],
  ["W15", "Стиль в порядке", "Постоянные клиенты", "Добрый день! 👋🏻\n\nУхоженный образ складывается из мелочей. А регулярная стрижка помогает поддерживать его без лишних усилий 😎🔥\n\nЕсли хотите записаться на следующую стрижку в Winchester, напишите нам. Подберём время! ✂️"],
  ["W16", "Хорошие традиции", "Постоянные клиенты", "Здравствуйте! 🤝\n\nУ каждого есть свои хорошие привычки. Найти время для себя и привести стрижку в порядок тоже одна из них 🖤💈\n\nБудем рады новой встрече в Winchester. Помочь с записью? 😊✂️"],
  ["W17", "Как вам у нас?", "После первого визита", "Добрый день! 👋🏻\n\nСпасибо, что однажды выбрали Winchester! Надеемся, после стрижки у вас остались хорошие впечатления 😊💈\n\nЕсли захотите заглянуть снова, будем рады новой встрече. С удовольствием поможем с записью! 🖤"],
  ["W18", "Продолжим знакомство", "После первого визита", "Здравствуйте! 🤝\n\nПервый визит в барбершоп это только начало. Хочется, чтобы вы нашли место, куда приятно возвращаться за хорошей стрижкой ✂️🖤\n\nБудем рады снова видеть вас в Winchester. Подобрать удобное время? 😊"],
  ["W19", "Ваш следующий образ", "После первого визита", "Добрый день! 👋🏻\n\nПосле первой стрижки можно сохранить понравившийся образ или попробовать что-нибудь новое 😎🔥\n\nНаши мастера с удовольствием помогут с обоими вариантами. Хотите записаться в Winchester? 💈"],
  ["W20", "Будем рады снова", "После первого визита", "Здравствуйте! 😊\n\nРады, что вы уже знакомы с Winchester! Мы стараемся, чтобы после каждого визита оставались не только аккуратная стрижка, но и хорошее настроение 🖤✂️\n\nЕсли захотите прийти снова, напишите нам. Подберём удобное время! 💈"],
  ["W21", "Начало недели", "Поводы заглянуть", "Добрый день! 👋🏻\n\nНовая неделя, новые планы. Хороший повод привести в порядок не только дела, но и свой образ 😎✂️\n\nЕсли планировали освежить стрижку, будем рады видеть вас в Winchester. Подобрать время? 💈"],
  ["W22", "Перед выходными", "Поводы заглянуть", "Здравствуйте! 🔥\n\nВыходные приятнее встречать, когда и настроение, и стрижка на высоте 😎💈\n\nЕсли собирались заглянуть к барберу, будем рады вас видеть. Помочь с записью? ✂️"],
  ["W23", "Осеннее обновление", "Поводы заглянуть", "Добрый день! 🍂\n\nСмена сезона отличный повод немного обновить привычный образ. Иногда достаточно свежей стрижки, чтобы почувствовать перемены 😎✂️\n\nМастера Winchester будут рады вас видеть. Записать на удобное время? 🖤"],
  ["W24", "Перед важными планами", "Поводы заглянуть", "Здравствуйте! 👋🏻\n\nВстреча, мероприятие или просто насыщенная неделя. Гораздо приятнее, когда знаешь, что выглядишь отлично 😎💈\n\nЕсли хотите заранее освежить стрижку, будем рады помочь в Winchester! ✂️🖤"],
  ["W25", "Маленькое обновление", "Стиль и настроение", "Добрый день! 👋🏻\n\nНе обязательно кардинально менять образ, чтобы выглядеть по-новому. Иногда достаточно просто освежить привычную стрижку ✂️😎\n\nВ Winchester с удовольствием поможем. Подобрать время для визита? 🖤"],
  ["W26", "Время для себя", "Стиль и настроение", "Здравствуйте! 😊\n\nМежду работой и повседневными делами важно находить немного времени для себя. Стрижка у хорошего барбера отличный способ переключиться 💈🖤\n\nБудем рады вас видеть в Winchester. Помочь с записью? ✂️"],
  ["W27", "Уверенность в деталях", "Стиль и настроение", "Добрый день! 🤝\n\nКогда стрижка аккуратная, даже привычный образ выглядит иначе. Небольшая деталь, которую замечаешь и сам, и окружающие 😎🔥\n\nЕсли захотите обновиться, мастера Winchester будут рады помочь. Подобрать время? 💈"],
  ["W28", "Особенное отношение", "Стиль и настроение", "Здравствуйте! 👋🏻\n\nWinchester работает с 2019 года. И всё это время для нас важно одно: чтобы каждый гость чувствовал себя желанным и уходил довольным 🖤💈\n\nЕсли захотите снова доверить нам свою стрижку, будем очень рады. Записать вас? 😊✂️"]
];

const crmBuild = async (env, c, at, only) => { const r = await crmBuild0(env, c, at); await grantSnap(env, c.id, only); return r; };
const W = CLIENTS.winchester, OWNER = "owner-key-123456", STAFF_W = "staff-key-winch-0001";
const INST = { id: "7105000081", token: "ga-tok-w81" };
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", KEY_WINCHESTER: STAFF_W, GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
const ON = { ...ENV, GA_BROADCAST_WINCHESTER: "1" };
const NOW = Date.now();
const day = n => new Date(NOW - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
let rid = 900;
const rec = (phone, n, o = {}) => ({ id: ++rid, datetime: `${day(n)}T12:00:00+05:00`, deleted: false, attendance: n > 0 ? 1 : 0, staff: { id: 1, name: o.staff || "Тони" },
  client: { id: +String(phone).replace(/\D/g, "").slice(-6), phone, name: o.name ?? "Клиент" }, services: [{ id: 1, title: "Мужская стрижка" }] });
const ph = i => "+7700000" + String(i).padStart(4, "0");
const dg = i => ph(i).slice(1);
const gaSent = () => net.ga.filter(x => x.op === "sendMessage").map(x => ({ to: String(x.body.chatId).replace("@c.us", ""), text: x.body.message }));
const W05 = LIBRARY.find(x => x.id === "W05");
const DRAFT = { c: "winchester", ch: "ga", name: "Стрижка отросла", tplId: "W05", lang: "ru", segment: "pora", cap: 50, from: 10, to: 20, consent: true };
const hook = (s, body) => s.call(`/ga/winchester?t=${gaPass("winchester", INST)}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ instanceData: { idInstance: +INST.id, wid: "77000000077@c.us" }, timestamp: Math.floor(Date.now() / 1000), ...body }) });

async function login(s, key) {
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${encodeURIComponent(key)}&next=%2Fapp%2F` });
  assert.ok(b.cookie, "вход ключом " + key.slice(0, 9));
  return b;
}
// «Пора на стрижку»: 901 — Азамат, 902 — «Клиент» (не имя), 904 — «стоп»
async function base(env = ENV) {
  net.reset();
  net.altJournal = [rec(ph(901), 25, { name: "Азамат" }), rec(ph(902), 30, { name: "Клиент" }), rec(ph(904), 28, { name: "Ерлан" })];
  // вебхук номера ведёт в этот бот (иначе запуск рассылки отказывает: «стоп» клиентов не дошёл бы)
  net.gaSettings[INST.id] = { webhookUrl: `https://bot.test/ga/winchester?t=${gaPass("winchester", INST)}`, incomingWebhook: "yes", outgoingWebhook: "yes" };
  const s = mk(env);
  await crmBuild(s.env, W, NOW);
  await s.kv.api.put(`optout:winchester:${dg(904)}`, "1");
  return s;
}
const tickAll = async (s, id) => {
  for (let i = 0; i < 6; i++) {
    const b = s.kv.json("bc:winchester:" + id);
    if (b.status !== "running") break;
    if (b.nextAt) { b.nextAt = Date.now() - 1; s.kv.mem.set("bc:winchester:" + id, JSON.stringify(b)); }
    await bcTick(s.env, "winchester", id);
  }
};

test("28 утверждённых текстов: слово в слово, 7 категорий по 4, свои номера, без переменных, тире и пометок, одобрены владельцем", () => {
  assert.equal(LIBRARY.length, 28);
  assert.deepEqual(CATS.map(x => x.label), ["Тёплое возвращение", "Пора обновить стрижку", "Давно не виделись", "Постоянные клиенты", "После первого визита", "Поводы заглянуть", "Стиль и настроение"]);
  assert.equal(new Set(LIBRARY.map(x => x.id)).size, 28, "номера не повторяются");
  for (const [i, [id, title, cat, text]] of APPROVED.entries()) {
    const x = LIBRARY[i];
    assert.deepEqual({ id: x.id, title: x.title, cat: CATS.find(k => k.id === x.cat).label, ru: x.ru }, { id, title, cat, ru: text }, id);
    assert.ok(!/[{}[\]]|\{\{|—|персонализ|\{имя\}/i.test(x.ru + x.title), `${id}: без переменных, скобок, тире и пометок`);
    assert.equal(x.approved, true, id); assert.equal(x.kk, "", id);
  }
  for (const k of CATS) assert.equal(LIBRARY.filter(x => x.cat === k.id).length, 4, k.label);
  assert.equal(baseOf(W).length, 28); assert.equal(baseOf(CLIENTS.barber).length, 0, "тексты называют Winchester — другим компаниям их нет");
});

test("имя в приветствии: «Добрый день! 👋🏻» → «Добрый день, Азамат! 👋🏻»; без имени и с сомнительным — как есть; второй раз не добавляется; эмодзи и абзацы целы", () => {
  for (const x of LIBRARY) {
    const r = render(x.ru, { "client.first_name": "Азамат" }), first = x.ru.split("\n")[0], rest = x.ru.slice(first.length);
    const g = first.match(/^(Добрый день|Здравствуйте)(!.*)$/u);
    assert.ok(g, `${x.id}: приветствие в начале: ${first}`);
    assert.equal(r.text, `${g[1]}, Азамат${g[2]}${rest}`, x.id);
    assert.equal(r.blocked, false, x.id);
    assert.equal(greetName(r.text, "Азамат"), r.text, `${x.id}: второй раз не добавляется`);
    assert.equal(render(r.text, { "client.first_name": "Азамат" }).text, r.text, `${x.id}: и при повторной сборке`);
    for (const n of ["", null, "Клиент", "Без имени", "User", "Бро", "Ли", "+7 701 000 00 01", "Ерлан должник", "Ааа"]) assert.equal(render(x.ru, { "client.first_name": n }).text, x.ru, `${x.id}: «${n}» — без имени`);
  }
  assert.equal(render(APPROVED[0][3], { "client.first_name": "АЗАМАТ" }).text.split("\n")[0], "Добрый день, Азамат! 👋🏻");
  assert.equal(render(APPROVED[1][3], { "client.first_name": "Ахметова Айгерим" }).text.split("\n")[0], "Здравствуйте, Айгерим! 🤝");
  assert.equal(render(APPROVED[22][3], { "client.first_name": "Ерлан-Али" }).text.split("\n")[0], "Добрый день, Ерлан-Али! 🍂");
  // уже есть обращение, приветствие не в начале, «Здравствуйте дорогие…» — не трогаем; соединитель эмодзи цел
  for (const t of ["Здравствуйте, Арман! 🤝", "Мы рады вам. Добрый день!", "Здравствуйте дорогие гости 😊"]) assert.equal(render(t, { "client.first_name": "Азамат" }).text, t);
  assert.equal(render("Привет 🙋‍♂️\n\nЖдём", { "client.first_name": "Азамат" }).text, "Привет, Азамат 🙋‍♂️\n\nЖдём");
});

test("библиотека в пульте: 28 текстов в 7 категориях, одобрены; правка — новая версия и одобрить заново; копия; прежние темы M01–M28 не всплывают; у барбершопа стартовых нет", async () => {
  net.reset();
  const s = mk({ KEY_WINCHESTER: STAFF_W }), own = await login(s, OWNER), staff = await login(s, STAFF_W);
  // правки прежней библиотеки в хранилище (до 02.11.2026) — не показываются и не дублируют тексты
  await s.kv.api.put("mtpl:winchester", JSON.stringify({ M01: { id: "M01", ru: "Старый текст", approved: true, v: 2 } }));
  let r = await (await own.go("/api/bc/templates?c=winchester")).json();
  assert.deepEqual(r.counts, { total: 28, approved: 28, review: 0, facts: 0, archived: 0 });
  assert.deepEqual(r.cats.map(x => x.label), CATS.map(x => x.label));
  assert.deepEqual(r.items.map(x => x.id), LIBRARY.map(x => x.id), "ровно 28, по порядку, без M01");
  assert.ok(r.items.every(x => x.status === "approved" && !/\{\{/.test(x.ru)), "одобрены, без переменных");
  assert.equal((await (await own.go("/api/bc/templates?c=winchester")).json()).items.length, 28, "второе чтение — те же 28");
  // правка: новая версия, одобрение снимается; одобрить — снова; «стоп» в своём тексте не обязателен
  const edited = W05.ru.replace("Записать на удобное время?", "Подобрать удобное время?");
  r = await (await own.post("/api/bc/templates", { c: "winchester", id: "W05", ru: edited, op: "Владелец" })).json();
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.item.ru, edited); assert.equal(r.item.approved, false); assert.equal(r.item.v, 2); assert.equal(r.item.history.length, 1);
  r = await (await own.post("/api/bc/templates", { c: "winchester", id: "W05", approved: true })).json();
  assert.equal(r.item.approved, true); assert.equal(r.item.v, 2);
  assert.equal((await staff.post("/api/bc/templates", { c: "winchester", id: "W06", approved: false })).status, 403, "править — только владелец");
  // копия: свой текст, тот же текст, не одобрен
  r = await (await own.post("/api/bc/templates/action", { c: "winchester", id: "W09", action: "duplicate" })).json();
  assert.equal(r.ok, true); assert.equal(r.item.custom, true); assert.equal(r.item.ru, LIBRARY.find(x => x.id === "W09").ru); assert.equal(r.item.title, "Давно не виделись (копия)"); assert.equal(r.item.cat, "lapsed");
  r = await (await own.post("/api/bc/templates", { c: "winchester", title: "Своё", cat: "warm", ru: "Добрый день! Ждём вас в Winchester 😊" })).json();
  assert.equal(r.ok, true, JSON.stringify(r));
  const list = await (await staff.go("/api/bc/templates?c=winchester")).json();
  assert.equal(list.counts.total, 30); assert.equal(list.items.find(x => x.id === "W05").ru, edited);
  // барбершоп: стартовых текстов нет (они про Winchester)
  assert.equal((await (await own.go("/api/bc/templates?c=barber")).json()).counts.total, 0);
});

test("черновик из библиотеки: в проверке, пробе и рассылке — тот же утверждённый текст; имя — в приветствии; «стоп» — только если владелец добавил", { skip: consentSkip }, async () => {
  const s = await base(), own = await login(s, OWNER);
  let d = await (await own.post("/api/bc/check", DRAFT)).json();
  assert.equal(d.ok, true, JSON.stringify(d)); assert.equal(d.tplId, "W05"); assert.equal(d.text, W05.ru, "текст — слово в слово, без приписок");
  assert.equal(d.valid, 2);
  const tail = W05.ru.slice(W05.ru.indexOf("\n"));
  assert.deepEqual(d.samples.map(x => x.text).sort(), [`Добрый день! 👋🏻${tail}`, `Добрый день, Азамат! 👋🏻${tail}`].sort());
  assert.ok(!/СТОП|стоп/.test(JSON.stringify(d.samples)), "строки «стоп» нет");
  // владелец добавил строку отказа: она в тексте и в каждом примере
  d = await (await own.post("/api/bc/check", { ...DRAFT, stop: true })).json();
  assert.equal(d.text, W05.ru + "\n\n" + STOP_RU); assert.ok(d.samples.every(x => x.text.endsWith("\n\n" + STOP_RU)), JSON.stringify(d.samples));
  // проба себе: тот же текст на вымышленном клиенте
  assert.equal((await own.post("/api/msg/auto", { c: "winchester", testPhone: "+7 700 000 09 97" })).status, 200);
  const t = await (await own.post("/api/bc/test", { ...DRAFT, rid: "rid-final-0001" })).json();
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.deepEqual(gaSent(), [{ to: "77000000997", text: `Добрый день, Айгерим! 👋🏻${tail}` }]); assert.equal(t.preview, gaSent()[0].text);
  // черновик: текст и выбранная аудитория сохранены
  const c = await (await own.post("/api/bc/create", DRAFT)).json();
  assert.equal(c.ok, true, JSON.stringify(c));
  const b = s.kv.json("bc:winchester:" + c.b.id);
  assert.equal(b.msg, W05.ru); assert.equal(b.tplId, "W05"); assert.equal(b.total, 2); assert.ok(b.sel >= 2, JSON.stringify(b)); assert.equal(b.stop, undefined);
});

test("запуск: запрет держит (владельцу — как включить); с разрешением — сначала итоговая аудитория и текст, отправка только с согласием; итоги рассылки", { skip: consentSkip }, async () => {
  // запрет: черновик есть, запуск — 409 ga_off, владельцу — как включить
  let s = await base(), own = await login(s, OWNER);
  let c = await (await own.post("/api/bc/create", DRAFT)).json();
  let st = await (await own.post("/api/bc/act", { c: "winchester", id: c.b.id, act: "start" })).json();
  assert.equal(st.code, "ga_off"); assert.match(st.how, /GA_BROADCAST_WINCHESTER = 1/);
  const l = await (await own.go("/api/bc/list?c=winchester")).json();
  assert.match(l.ga.bcOff, /выключен/); assert.match(l.ga.bcHow, /GA_BROADCAST_WINCHESTER/);
  // разрешение владельца: переменная GA_BROADCAST_WINCHESTER = 1. Сотрудник не запускает
  s = await base(ON); own = await login(s, OWNER);
  const sw = await login(s, STAFF_W);
  c = await (await own.post("/api/bc/create", DRAFT)).json();
  assert.equal((await (await own.go("/api/bc/list?c=winchester")).json()).ga.bcOff, "");
  assert.equal((await sw.post("/api/bc/act", { c: "winchester", id: c.b.id, act: "start" })).status, 403);
  // без подтверждения — итоговая аудитория и точный текст, ничего не ушло
  let r = await own.post("/api/bc/act", { c: "winchester", id: c.b.id, act: "start" });
  st = await r.json();
  assert.equal(r.status, 409); assert.equal(st.final.n, 2); assert.equal(st.final.text, W05.ru); assert.match(st.final.sample, /^Добрый день/);
  assert.match(st.confirm, /получат 2 из 2/); assert.equal(s.kv.json("bc:winchester:" + c.b.id).status, "ready"); assert.deepEqual(gaSent(), []);
  // аудитория изменилась (902 написал «стоп») — подтверждение со старым числом не проходит
  await s.kv.api.put(`optout:winchester:${dg(902)}`, "1");
  r = await own.post("/api/bc/act", { c: "winchester", id: c.b.id, act: "start", sure: true, n: 2 });
  st = await r.json(); assert.equal(r.status, 409); assert.equal(st.final.n, 1);
  r = await own.post("/api/bc/act", { c: "winchester", id: c.b.id, act: "start", sure: true, n: 1, op: "Владелец" });
  assert.equal(r.status, 200, await r.clone().text());
  await tickAll(s, c.b.id);
  const tail = W05.ru.slice(W05.ru.indexOf("\n"));
  assert.deepEqual(gaSent(), [{ to: dg(901), text: `Добрый день, Азамат! 👋🏻${tail}` }], "только тому, у кого согласие и нет «стопа»; текст — подтверждённый");
  const h = (await s.hist(`h:ga:winchester:${dg(901)}`)) || s.kv.json(`h:ga:winchester:${dg(901)}`);
  const turn = h.turns.find(x => x.bc === c.b.id);
  assert.ok(turn && turn.text === `Добрый день, Азамат! 👋🏻${tail}`, "в переписке — тот же текст");
  // отчёты Green-API, ответ «хочу записаться» и «записался после» (будущая запись в свежей базе Altegio)
  for (const x of ["delivered", "read"]) await hook(s, { typeWebhook: "outgoingMessageStatus", chatId: dg(901) + "@c.us", idMessage: turn.mid, status: x, sendByApi: true });
  await s.gaText("winchester", INST, dg(901), "Можно записаться на завтра?");
  await s.settle();
  net.altJournal.push(rec(ph(901), -3, { name: "Азамат" }));
  await crmBuild(s.env, W, Date.now(), []);
  const g = await (await own.go(`/api/bc/get?c=winchester&id=${c.b.id}`)).json();
  assert.deepEqual(g.results, { selected: g.results.selected, admitted: 2, sent: 1, unsure: 0, failed: 0, skipped: 1, delivered: 1, read: 1, replied: 1, want: 1, booked: 1, refused: 0, window: 14, reports: true });
  assert.ok(g.results.selected >= 2);
  assert.ok(!JSON.stringify(g.results).includes(dg(901)), "номеров в итогах нет");
});

test("отказ после рассылки считается; тестовая версия не запускает и с разрешением; запуск на время — не раньше назначенного", { skip: consentSkip }, async () => {
  let s = await base(ON), own = await login(s, OWNER);
  let c = await (await own.post("/api/bc/create", DRAFT)).json();
  const at = Date.now() + 2 * 3600e3;
  let r = await own.post("/api/bc/act", { c: "winchester", id: c.b.id, act: "start", sure: true, n: 2, at });
  assert.equal(r.status, 200, await r.clone().text());
  let b = s.kv.json("bc:winchester:" + c.b.id);
  assert.equal(b.status, "running"); assert.equal(b.at, at);
  await bcTick(s.env, "winchester", c.b.id);
  assert.deepEqual(gaSent(), [], "до назначенного времени — ничего");
  assert.match(s.kv.json("bc:winchester:" + c.b.id).waitNote, /Запланирована/);
  b = s.kv.json("bc:winchester:" + c.b.id); b.at = Date.now() - 1; s.kv.mem.set("bc:winchester:" + c.b.id, JSON.stringify(b));
  await tickAll(s, c.b.id);
  assert.equal(gaSent().length, 2);
  await s.gaText("winchester", INST, dg(902), "стоп");
  await s.settle();
  const g = await (await own.go(`/api/bc/get?c=winchester&id=${c.b.id}`)).json();
  assert.equal(g.results.sent, 2); assert.equal(g.results.refused, 1, JSON.stringify(g.results));
  // тестовая версия: запуск — 409 preview и с разрешением владельца
  const p = mk({ ...ON, STAGE: "preview" }), pown = await login(p, OWNER);
  p.kv.mem.set("crm:winchester:snap", s.kv.mem.get("crm:winchester:snap")); p.env.DB = s.env.DB;
  const pc = await (await pown.post("/api/bc/create", DRAFT)).json();
  assert.equal((await (await pown.post("/api/bc/act", { c: "winchester", id: pc.b.id, act: "start", sure: true, n: 2 })).json()).code, "preview");
});

test("цифры базы за 90 дней: всего, номера корректны, постоянные, один раз, 30–60 и 61–90 дней, будущая запись, разрешили рекламу, отказались, без подтверждённого разрешения", { skip: consentSkip }, async () => {
  net.reset();
  net.altJournal = [
    rec(ph(911), 10, { name: "Арман" }), rec(ph(911), 40), rec(ph(911), 70), // постоянный: 3 визита, последний 10 дней назад
    rec(ph(912), 45, { name: "Данияр" }), // один раз, 30–60
    rec(ph(913), 75, { name: "Ерлан" }), // один раз, 61–90
    rec(ph(914), 20, { name: "Тимур" }), rec(ph(914), -5), // будущая запись
    rec(ph(915), 33, { name: "Айдос" }), // «стоп»
    rec(ph(916), 50, { name: "Нурлан" }), // отказ от рекламы
    { ...rec("+7 707 XXX-X7-44", 12), client: { id: 5, phone: "+7 707 XXX-X7-44", name: "Скрыт" } },
  ];
  const s = mk(ENV), own = await login(s, OWNER);
  await crmBuild(s.env, W, NOW, [dg(911), dg(912)]); // согласие на рекламу — у двоих
  await s.kv.api.put(`optout:winchester:${dg(915)}`, "1");
  await consentAdd(s.env.DB, "winchester", { contactId: await (async () => { const { contactAdd } = await import("../../src/db/d1/contacts.js"); const x = await contactAdd(s.env.DB, "winchester", { id: "c916", phone: dg(916), name: "", search: dg(916), at: 1, actor: "owner" }); return (x && x.id) || "c916"; })(),
    purpose: "marketing", state: "denied", basis: "сказал администратору", source: "manual", actor: "owner", evidence: "oral", confirmed: 1, at: Date.now() });
  const m = (await (await own.go("/api/crm/segments?c=winchester")).json()).metrics;
  assert.deepEqual(m, { total: 7, valid: 6, invalid: 1, regular: 1, once: 5, d30_60: 3, d61_90: 1, booked: 1, marketing: 2, refused: 2, noperm: 2 }, JSON.stringify(m));
});
