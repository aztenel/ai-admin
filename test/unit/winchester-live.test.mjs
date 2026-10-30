// Winchester: настоящая запись в журнал Altegio (19.10.2026, с разрешения Кайрата) и условия владельца:
// бот создаёт, отменяет и переносит только свои записи; записи администраторов и мастеров только видит — просьбы о них передаёт администратору;
// пределы от спама; пробные записи (веб-чат и /altegio) — только в следующем месяце, в дни без записей; веб-чат не видит журнал по набранному номеру.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, D1 } from "../harness.mjs";
import { altCache } from "../../src/services/integrations/altegio/booking-api.js";
import { altDiag } from "../../src/controllers/altegio.js";

const INST = { id: "7105000088", token: "ga-tok-live" };
const ENV = { ALTEGIO_PARTNER: "partner-key", ALTEGIO_USER_WINCHESTER: "usr-tok", GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token, BOT_GA_WINCHESTER: "1" }; // бот на втором номере выключен с 30.10.2026 — здесь проверяем его самого
const NOV = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]; // следующий месяц (часы тестов — 3 октября 2026)
const GRID = ["10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00"];
// одна услуга в двух строках прайса и одной категории: у шеф-барбера (Тони) — 9 000 ₸, у барберов — 7 000 ₸
const SV = [
  { id: 201, title: "Мужская стрижка", category_id: 1, price_min: 7000, price_max: 7000, active: 1 },
  { id: 202, title: "Мужская стрижка", category_id: 1, price_min: 9000, price_max: 9000, active: 1 },
  { id: 207, title: "Моделирование бороды", category_id: 1, price_min: 4500, price_max: 4500, active: 1 }];
const CHEF = new Set(["202"]);
const W = (dates = [D1, ...NOV]) => ({
  services: SV, category: [{ id: 1, title: "Мужские стрижки и бритьё" }],
  staff: [{ id: 31, name: "Тони", bookable: true }, { id: 32, name: "Айдос", bookable: true }], dates, times: {},
  timesFor: (staff, date, sids) => {
    if (staff === "0") return GRID;
    if (sids.length && sids.some(s => s !== "207" && CHEF.has(s) !== (staff === "31"))) return { error: 422 }; // чужую строку прайса мастер не оказывает
    return GRID;
  }
});
let LOC = 7100;
const reset = (data = W()) => { net.reset(); Object.assign(net, { altGone: [], altBusy: false, altCheckBusy: false, altJournalFail: 0 }); net.altData = () => data; altCache.clear(); LOC++; };
const env = extra => ({ ...ENV, ALTEGIO_LOC_WINCHESTER: String(LOC), ...extra });
const gaSent = to => net.ga.filter(x => x.op === "sendMessage" && x.body && x.body.chatId === to + "@c.us").map(x => x.body.message);
const tag = (name, svc, staff, date, time) => `[ЗАЯВКА] Имя: ${name}; Телефон: —; Услуга: ${svc}; Мастер: ${staff}; Дата: ${date}; Время: ${time}`;
// запись, которую администратор сделал прямо в Altegio (в журнале есть, бот её не создавал)
const adminRecord = (phone, time, staff = 32) => net.altRecords.push({ phone: "+" + phone, fullname: "Азамат", appointments: [{ id: 1, services: [201], staff_id: staff, datetime: `${D1}T${time}:00+05:00` }] });

test("одинаковые названия различаются ценой: «Мужская стрижка (7 000 ₸)» и «(9 000 ₸)» вместо «№1» и «№2»", async () => {
  reset();
  const out = await altDiag(mk(env()).env, "winchester", "", "");
  assert.ok(/Мужская стрижка \(7 000 ₸\) — от 7 000 ₸/.test(out) && /Мужская стрижка \(9 000 ₸\) — от 9 000 ₸/.test(out) && !/№1/.test(out), out);
});

test("номер бота: запись создаётся по-настоящему (book_record), клиенту «Записала»", async () => {
  reset();
  const s = mk(env()), from = "77000000201";
  net.ai = [`Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Айдос", D1, "11:00")}`];
  await s.gaText("winchester", INST, from, "Азамат, мужская стрижка к Айдосу завтра в 11:00");
  assert.ok(net.alt.some(x => /^POST \/book_record\//.test(x)), net.alt.join(" | "));
  assert.ok(gaSent(from).some(t => /Записала вас/.test(t)), JSON.stringify(gaSent(from)));
});

test("строка прайса не того мастера: «Мужская стрижка (7 000 ₸)» к Тони записывается строкой шеф-барбера", async () => {
  reset();
  const s = mk(env()), from = "77000000202";
  net.ai = [`Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Тони", D1, "11:00")}`];
  await s.gaText("winchester", INST, from, "Азамат, мужская стрижка к Тони завтра в 11:00");
  const rec = net.altRecords.at(-1);
  assert.ok(rec && rec.appointments[0].services[0] === 202 && rec.appointments[0].staff_id === 31, JSON.stringify(rec) + " " + JSON.stringify(gaSent(from)));
});

test("запись администратора: отмену бот не делает — просьба администратору, DELETE в Altegio нет", async () => {
  reset();
  const s = mk(env()), from = "77000000203";
  adminRecord(from, "12:00");
  net.ai = [`Отменила.\n[ОТМЕНА] Имя: Азамат; Дата: ${D1}; Время: 12:00`];
  await s.gaText("winchester", INST, from, "Отмените, пожалуйста, мою запись на завтра в 12:00");
  assert.ok(!net.alt.some(x => /^DELETE /.test(x)), "чужую запись бот не удаляет: " + net.alt.join(" | "));
  assert.ok(gaSent(from).some(t => /администратор/i.test(t)), JSON.stringify(gaSent(from)));
  assert.ok(net.tg.some(m => /Клиент просит отменить запись — сделайте в Altegio/.test(m.text) && /делал администратор/.test(m.text)), JSON.stringify(net.tg.map(m => m.text)));
});

test("запись администратора: перенос бот не делает — новой записи нет, просьба администратору с новым временем", async () => {
  reset();
  const s = mk(env()), from = "77000000204";
  adminRecord(from, "12:00");
  const before = net.altRecords.length;
  net.ai = [`Перенесла.\n[ОТМЕНА] Имя: Азамат; Дата: ${D1}; Время: 12:00\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Айдос", D1, "14:00")}`];
  await s.gaText("winchester", INST, from, "Перенесите мою запись с 12:00 на 14:00");
  assert.equal(net.altRecords.length, before, "новой записи нет: " + net.alt.join(" | "));
  assert.ok(!net.alt.some(x => /^DELETE /.test(x)), net.alt.join(" | "));
  assert.ok(net.tg.some(m => /перенести запись — сделайте в Altegio/.test(m.text) && /14:00/.test(m.text)), JSON.stringify(net.tg.map(m => m.text)));
  assert.ok(gaSent(from).some(t => /перенос/i.test(t)), JSON.stringify(gaSent(from)));
});

test("свою запись бот отменяет сам (DELETE в Altegio)", async () => {
  reset();
  const s = mk(env()), from = "77000000205";
  net.ai = [`Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Айдос", D1, "11:00")}`];
  await s.gaText("winchester", INST, from, "Азамат, мужская стрижка к Айдосу завтра в 11:00");
  net.ai = [`Отменила.\n[ОТМЕНА] Имя: Азамат; Дата: ${D1}; Время: 11:00`];
  await s.gaText("winchester", INST, from, "Отмените мою запись на завтра в 11:00");
  assert.ok(net.alt.some(x => /^DELETE \/user\/records\//.test(x)), net.alt.join(" | "));
});

test("предел отмен и переносов: после трёх переносов за сутки четвёртый делает администратор (новой записи нет)", async () => {
  reset();
  const s = mk(env()), from = "77000000206", times = ["10:00", "11:00", "12:00", "13:00", "14:00"];
  net.ai = [`Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Айдос", D1, times[0])}`];
  await s.gaText("winchester", INST, from, `Азамат, мужская стрижка к Айдосу завтра в ${times[0]}`);
  for (let i = 1; i < times.length; i++) {
    net.ai = [`Перенесла.\n[ОТМЕНА] Имя: Азамат; Дата: ${D1}; Время: ${times[i - 1]}\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Айдос", D1, times[i])}`];
    await s.gaText("winchester", INST, from, `Перенесите мою запись с ${times[i - 1]} на ${times[i]}`);
  }
  assert.equal(net.alt.filter(x => /^POST \/book_record\//.test(x)).length, 4, "запись и три переноса: " + net.alt.join(" | "));
  assert.equal(net.alt.filter(x => /^DELETE /.test(x)).length, 3, net.alt.join(" | "));
  assert.ok(net.tg.some(m => /перенести запись — сделайте в Altegio/.test(m.text) && /много отмен/.test(m.text)), JSON.stringify(net.tg.map(m => m.text)));
});

test("предел активных записей: четвёртая запись из чата не создаётся — заявка администратору", async () => {
  reset();
  const s = mk(env()), from = "77000000207";
  const names = ["Азамат", "Ерлан", "Данияр", "Тимур"];
  for (const [i, t] of ["10:00", "11:00", "12:00", "13:00"].entries()) {
    net.ai = [`Записала.\n${tag(names[i], "Мужская стрижка (7 000 ₸)", "Айдос", D1, t)}`];
    await s.gaText("winchester", INST, from, `Ещё запишите ${names[i]}, стрижка к Айдосу завтра в ${t}`);
  }
  assert.equal(net.alt.filter(x => /^POST \/book_record\//.test(x)).length, 3, net.alt.join(" | "));
  assert.ok(net.tg.some(m => /превышен лимит/.test(m.text)), JSON.stringify(net.tg.map(m => m.text)));
});

test("веб-чат: записи из журнала по набранному номеру не читаются (чужой номер — чужие записи)", async () => {
  reset();
  const s = mk(env({ ALTEGIO_TRIAL_WINCHESTER: "0" }));
  adminRecord("77000000208", "12:00");
  net.ai = ["Подскажу."];
  await s.chat("winchester", "web-other", "Мой номер +7 700 000 02 08, какие у меня записи?");
  assert.ok(!net.alt.some(x => /^GET \/records\//.test(x) && /start_date=2026-10-03/.test(x)), net.alt.join(" | "));
  assert.ok(!/12:00/.test(JSON.stringify(net.gemini.at(-1)).split("Уже известно о клиенте")[1] || ""), "чужая запись в подсказку ИИ не попала");
});

test("веб-чат (пробный): только дни следующего месяца без записей в журнале", async () => {
  reset();
  net.altRecords.push({ phone: "+77000000999", fullname: "Клиент", appointments: [{ id: 1, services: [201], staff_id: 32, datetime: `${NOV[0]}T10:00:00+05:00` }] });
  const s = mk(env());
  net.ai = ["Подскажу."];
  await s.chat("winchester", "web-trial", "Есть время на стрижку?");
  const p = JSON.stringify(net.gemini.at(-1));
  assert.ok(/тестовый чат/.test(p), "ИИ знает, что чат пробный");
  assert.ok(p.includes(NOV[1]) && !p.includes(`(${NOV[0]})`) && !p.includes(`(${D1})`), "ближайшие дни и день с записью не предлагаются");
  net.ai = [`Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Айдос", D1, "11:00")}`];
  const r = await s.chat("winchester", "web-trial", "Азамат, +7 701 555 44 33, стрижка к Айдосу завтра в 11:00");
  assert.ok(!net.alt.some(x => /^POST \/book_record\//.test(x)), "на ближайший день пробный чат не записывает: " + r.reply);
});

test("/altegio: пробная запись — в следующем месяце, в день без записей", async () => {
  reset();
  net.altRecords.push({ phone: "+77000000999", fullname: "Клиент", appointments: [{ id: 1, services: [201], staff_id: 32, datetime: `${NOV[0]}T10:00:00+05:00` }] });
  const s = mk(env());
  const out = await altDiag(s.env, "winchester", "", "+7 701 555 44 33");
  const made = net.altRecords.at(-1);
  assert.ok(made && made.appointments[0].datetime.startsWith(NOV[1]), out);
  assert.ok(/Пробная запись: создана/.test(out) && /Удаление пробной записи: ✅/.test(out), out);
});

test("/altegio: в следующем месяце нет дня без записей — пробную запись не делаем", async () => {
  reset(W([D1, NOV[0]]));
  net.altRecords.push({ phone: "+77000000999", fullname: "Клиент", appointments: [{ id: 1, services: [201], staff_id: 32, datetime: `${NOV[0]}T10:00:00+05:00` }] });
  const before = net.altRecords.length;
  const out = await altDiag(mk(env()).env, "winchester", "", "+7 701 555 44 33");
  assert.equal(net.altRecords.length, before, out);
  assert.ok(/пробу не делаю/.test(out), out);
});

// ---- найдено проверкой 19.10.2026 (злоупотребления и логика) — каждое сначала повторено, потом исправлено
const ownerChat = async (s, sid, text) => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Finbox" }); return (await b.post("/api/chat", { c: "winchester", sid, text })).json(); };

test("«вместо Азамата запишите Ерлана» по кругу: перенос на другого человека — с обычными пределами, записей не больше трёх", async () => {
  reset();
  const s = mk(env()), from = "77000000301";
  net.ai = [`Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Айдос", D1, "10:00")}`];
  await s.gaText("winchester", INST, from, "Азамат, мужская стрижка к Айдосу завтра в 10:00");
  for (const [n, t] of [["Ерлан", "11:00"], ["Данияр", "12:00"], ["Тимур", "13:00"], ["Серик", "14:00"], ["Бахыт", "15:00"]]) {
    net.ai = [`Хорошо.\n[ОТМЕНА] Имя: Азамат; Дата: ${D1}; Время: 10:00\n${tag(n, "Мужская стрижка (7 000 ₸)", "Айдос", D1, t)}`];
    await s.gaText("winchester", INST, from, `Вместо Азамата запишите ${n}а к Айдосу завтра в ${t}`);
  }
  assert.ok(net.alt.filter(x => /^POST \/book_record\//.test(x)).length <= 3, net.alt.join(" | "));
  assert.ok(net.tg.some(m => /превышен лимит/.test(m.text)), JSON.stringify(net.tg.map(m => m.text)));
});

test("«сброс» не обнуляет предел переносов: счётчик — в хранилище по номеру", async () => {
  reset();
  const s = mk(env()), from = "77000000302", times = ["10:00", "11:00", "12:00", "13:00", "14:00"];
  net.ai = [`Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Айдос", D1, times[0])}`];
  await s.gaText("winchester", INST, from, `Азамат, мужская стрижка к Айдосу завтра в ${times[0]}`);
  for (let i = 1; i < times.length; i++) {
    if (i === 3) await s.gaText("winchester", INST, from, "сброс");
    net.ai = [`Перенесла.\n[ОТМЕНА] Имя: Азамат; Дата: ${D1}; Время: ${times[i - 1]}\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Айдос", D1, times[i])}`];
    await s.gaText("winchester", INST, from, `Перенесите мою запись с ${times[i - 1]} на ${times[i]}`);
  }
  assert.ok(net.alt.filter(x => /^DELETE /.test(x)).length <= 3, net.alt.join(" | "));
});

test("две записи администратора: «да» на «Отменить запись в 12:00?» передаёт администратору именно 12:00", async () => {
  reset();
  const s = mk(env()), from = "77000000303";
  adminRecord(from, "10:00"); adminRecord(from, "12:00", 31);
  net.ai = [`Отменю.\n[ОТМЕНА] Имя: Ерлан; Дата: ${D1}; Время: 12:00`];
  await s.gaText("winchester", INST, from, "Отмените запись на 12:00");
  net.ai = ["Хорошо."];
  await s.gaText("winchester", INST, from, "Да");
  const req = net.tg.filter(m => /Клиент просит отменить запись — сделайте в Altegio/.test(m.text));
  assert.ok(req.length && req.every(m => /12:00/.test(m.text) && !/10:00/.test(m.text)), JSON.stringify(net.tg.map(m => m.text)));
});

test("пробный веб-чат: посетитель без входа — показ без записи; владелец — настоящая запись с пометкой «пробная», живые пределы не тратятся", async () => {
  reset();
  const s = mk(env());
  net.ai = [`Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Айдос", NOV[0], "11:00")}`];
  const r1 = await s.chat("winchester", "trial-anon", "Азамат, +7 701 555 44 33, стрижка к Айдосу 2 ноября в 11:00");
  assert.ok(!net.alt.some(x => /^POST \/book_record\//.test(x)) && /показ/i.test(r1.reply), r1.reply);
  net.ai = [`Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Айдос", NOV[0], "11:00")}`];
  const r2 = await ownerChat(s, "trial-owner", "Азамат, +7 701 555 44 33, стрижка к Айдосу 2 ноября в 11:00");
  const rec = net.altRecords.at(-1);
  assert.ok(rec && /ПРОБНАЯ/.test(rec.comment), r2.reply + " " + JSON.stringify(rec));
  assert.ok(net.tg.some(m => /Пробная запись в Altegio/.test(m.text)), JSON.stringify(net.tg.map(m => m.text)));
  assert.equal(await s.env.KV.get(`bk:${LOC}:all:2026-10-03`), null, "живой предел локации не тронут");
});

test("перенос записи администратора, где имя в журнале другое: новой записи нет — просьба администратору", async () => {
  reset();
  const s = mk(env()), from = "77000000304";
  net.altRecords.push({ phone: "+" + from, fullname: "Клиент Winchester", appointments: [{ id: 1, services: [201], staff_id: 32, datetime: `${D1}T12:00:00+05:00` }] });
  const before = net.altRecords.length;
  net.ai = [`Перенесла.\n[ОТМЕНА] Имя: Ерлан; Дата: ${D1}; Время: 12:30\n${tag("Ерлан", "Мужская стрижка (7 000 ₸)", "Айдос", D1, "14:00")}`];
  await s.gaText("winchester", INST, from, "Меня зовут Ерлан, перенесите мою запись на 14:00");
  assert.equal(net.altRecords.length, before, net.alt.join(" | "));
  assert.ok(s.leads("winchester").some(l => /Перенести запись/.test(l.service)) || net.tg.some(m => /перенести запись/i.test(m.text)), JSON.stringify(net.tg.map(m => m.text)));
});

test("пробный режим без ключа журнала: дней для пробы нет — запись не создаётся ни на какой день", async () => {
  reset();
  const s = mk(env({ ALTEGIO_USER_WINCHESTER: "" }));
  net.ai = [`Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Айдос", NOV[0], "11:00")}`];
  const r = await ownerChat(s, "trial-nokey", "Азамат, +7 701 555 44 33, стрижка к Айдосу 2 ноября в 11:00");
  assert.ok(!net.alt.some(x => /^POST \/book_(record|check)\//.test(x)), net.alt.join(" | "));
  assert.ok(!net.tg.some(m => /запишите вручную/.test(m.text)), "и заявки «запишите вручную» тоже нет: " + r.reply);
});

test("просьба администратору о переносе: другое новое время — новая просьба, а не тихий повтор", async () => {
  reset();
  const s = mk(env()), from = "77000000305";
  adminRecord(from, "12:00");
  for (const t of ["14:00", "15:00"]) {
    net.ai = [`Передала.\n[ОТМЕНА] Имя: Азамат; Дата: ${D1}; Время: 12:00\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Айдос", D1, t)}`];
    await s.gaText("winchester", INST, from, `Перенесите мою запись с 12:00 на ${t}`);
  }
  const reqs = net.tg.filter(m => /перенести запись — сделайте в Altegio/.test(m.text));
  assert.ok(reqs.some(m => /14:00/.test(m.text)) && reqs.some(m => /15:00/.test(m.text)), JSON.stringify(net.tg.map(m => m.text)));
});
