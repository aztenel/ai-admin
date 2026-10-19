// Живая проверка владельца 19.10.2026: пробный веб-чат Winchester (вошёл как владелец), настоящий Altegio, пробные записи — в днях
// следующего месяца. Его слова: «у определённого барбера выходной, его нет в расписании на это время — бот помечает как есть, а когда
// клиент просит записать, говорит, что барбер не свободен»; «переносить пробные не может, говорит — уже есть запись»; «пн 12ч Рауан,
// хочу ещё на 15ч к Рауану Отец и сын — бот не может записать и просит прийти в другое время». Каждый случай сначала повторён здесь
// (на заглушках), потом исправлен. Вживую после правки не проверено.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, D1, D2 } from "../harness.mjs";
import { altCache } from "../../src/services/integrations/altegio/booking-api.js";
import { altTrialDates } from "../../src/services/booking/book.js";
import { checkReply } from "../../src/services/conversation/guard.js";
import { hash } from "../../src/lib/crypto.js";
import { altOther } from "../../src/services/booking/people.js";

const NOV = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]; // пн, вт, ср, чт следующего месяца (часы проверок — суббота, 3 октября 2026)
const MON = NOV[0];
const hm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, mn = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const grid = (from, to) => { const o = []; for (let m = from * 60; m <= to * 60; m += 30) o.push(hm(m)); return o; };
const DAY = grid(10, 20.5);
// прайс как у Winchester: стрижка в двух строках (барберы — 7 000 ₸, шеф-барбер Тони — 9 000 ₸), борода, «Отец и сын» (1 ч 30 мин по таблице длительностей)
const SV = [
  { id: 201, title: "Мужская стрижка", category_id: 1, price_min: 7000, price_max: 7000, active: 1 },
  { id: 202, title: "Мужская стрижка", category_id: 1, price_min: 9000, price_max: 9000, active: 1 },
  { id: 207, title: "Моделирование бороды", category_id: 1, price_min: 4500, price_max: 4500, active: 1 },
  { id: 209, title: "Комплекс «Отец и сын»", category_id: 1, price_min: 12000, price_max: 12000, active: 1 }];
const LEN = { 201: 60, 202: 60, 207: 30, 209: 90 }, svLen = sids => Math.max(30, ...sids.map(s => LEN[s] || 30));
const STAFF = [{ id: 31, name: "Тони", bookable: true }, { id: 32, name: "Рауан", bookable: true }, { id: 33, name: "Айдос", bookable: true }, { id: 34, name: "Айдын", bookable: true }];
// Altegio как вживую: свободные начала мастера сеткой 30 мин; запись занимает мастера на всю длительность услуги; с услугой — только начала,
// с которых мастер свободен всю её длительность; строку прайса другого мастера (шеф-барбер / барберы) мастер не оказывает.
// work(мастер, день) — рабочее время мастера ([] — выходной: его нет в расписании)
const W = (work = () => DAY, dates = [D1, ...NOV]) => {
  const busy = (st, d) => net.altRecords.flatMap((r, i) => { const a = (r.appointments || [])[0] || {};
    if (net.altDeleted.includes(String(777001 + i)) || (net.altGone || []).includes(String(777001 + i)) || String(a.staff_id) !== st || !String(a.datetime || "").startsWith(d)) return [];
    const s = mn(String(a.datetime).slice(11, 16)); return [[s, s + svLen((a.services || []).map(String))]]; });
  const free = (st, d) => { const b = busy(st, d); return work(st, d).filter(t => !b.some(([s, e]) => mn(t) >= s && mn(t) < e)); };
  const fits = (t, m) => { const set = new Set(t.map(mn)); return t.filter(x => { for (let k = 30; k < m; k += 30) if (!set.has(mn(x) + k)) return false; return true; }); };
  const wrong = (st, sids) => sids.some(s => (s === "201" && st === "31") || (s === "202" && st !== "31"));
  return { services: SV, category: [{ id: 1, title: "Мужские стрижки и бритьё" }], staff: STAFF, dates, times: {},
    timesFor: (st, d, sids) => {
      if (st === "0") return [...new Set(STAFF.filter(x => !wrong(String(x.id), sids)).flatMap(x => fits(free(String(x.id), d), svLen(sids))))].sort();
      if (wrong(st, sids)) return { error: 422 };
      return sids.length ? fits(free(st, d), svLen(sids)) : free(st, d);
    } };
};
let LOC = 7400;
const reset = data => { net.reset(); Object.assign(net, { altGone: [], altBusy: false, altCheckBusy: false, altJournalFail: 0 }); net.altData = () => data; altCache.clear(); LOC++; };
const env = extra => ({ ALTEGIO_PARTNER: "partner-key", ALTEGIO_USER_WINCHESTER: "usr-tok", ALTEGIO_LOC_WINCHESTER: String(LOC), ...extra });
const ownerChat = async (s, sid, text) => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Finbox" }); return (await b.post("/api/chat", { c: "winchester", sid, text })).json(); };
const tag = (name, svc, staff, date, time) => `[ЗАЯВКА] Имя: ${name}; Телефон: —; Услуга: ${svc}; Мастер: ${staff}; Дата: ${date}; Время: ${time}`;
const sys = (i = -1) => net.gemini.at(i).systemInstruction.parts[0].text;
const posts = () => net.alt.filter(x => /^POST \/book_record\//.test(x)).length, dels = () => net.alt.filter(x => /^DELETE /.test(x)).length;
// следующее сообщение пришло через 2+ минуты (кэш дней пробы, ALT_TTL) или на другой экземпляр Worker — как было у владельца вживую
const later = () => altCache.clear();
const TRIAL_NOTE = "ПРОБНАЯ запись (проверка AI-администратора) — можно удалить";

// ---- 1. Свои пробные записи бота закрывали день: после «пн 12:00» понедельник пропадал из пробных дней
test("пробный чат: «пн 12:00 к Рауану», потом «ещё на 15:00 к Рауану Отец и сын» — вторая запись создаётся", async () => {
  reset(W());
  const s = mk(env()), sid = "lt-second";
  net.ai = [`Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", MON, "12:00")}`];
  const r1 = await ownerChat(s, sid, "Азамат, +7 700 000 12 34, стрижка к Рауану в понедельник 2 ноября в 12:00");
  assert.ok(posts() === 1 && net.altRecords[0].comment === TRIAL_NOTE, r1.reply + " | " + JSON.stringify(net.altRecords[0]));
  later();
  net.ai = [`Записала.\n${tag("Азамат", "Комплекс «Отец и сын»", "Рауан", MON, "15:00")}`];
  const r2 = await ownerChat(s, sid, "Хочу ещё на 15:00 к Рауану Отец и сын");
  assert.ok(sys().includes(`(${MON}): `), "понедельник остаётся в свободных окнах пробного чата");
  assert.equal(posts(), 2, r2.reply);
  assert.ok(/Записала/.test(r2.reply) && net.altRecords[1].appointments[0].datetime.startsWith(MON + "T15:00") && net.altRecords[1].appointments[0].services[0] === 209, r2.reply);
});

test("пробный чат: пробную запись переносят на другое время того же дня — переносится (новая создана, старая удалена)", async () => {
  reset(W());
  const s = mk(env()), sid = "lt-move";
  net.ai = [`Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", MON, "12:00")}`];
  await ownerChat(s, sid, "Азамат, +7 700 000 12 34, стрижка к Рауану в понедельник 2 ноября в 12:00");
  later();
  net.ai = [`Перенесла.\n[ОТМЕНА] Имя: Азамат; Дата: ${MON}; Время: 12:00\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", MON, "15:00")}`];
  const r = await ownerChat(s, sid, "Перенесите мою запись на 15:00");
  assert.ok(/Перенесла вашу запись/.test(r.reply), r.reply);
  assert.ok(posts() === 2 && dels() === 1 && net.altRecords[1].appointments[0].datetime.startsWith(MON + "T15:00"), net.alt.join(" | "));
});

test("пробные дни: пробные записи бота день не закрывают; запись живого клиента закрывает — и рядом с пробной, и сделанная ботом", async () => {
  reset(W());
  const s = mk(env());
  const rec = (d, t, comment) => net.altRecords.push({ phone: "+77000009999", fullname: "Клиент", ...(comment == null ? {} : { comment }), appointments: [{ id: 1, services: [201], staff_id: 32, datetime: `${d}T${t}:00+05:00` }] });
  rec(NOV[0], "12:00", TRIAL_NOTE); rec(NOV[0], "16:00", "");          // пн: проба бота и запись клиента — закрыт
  rec(NOV[1], "12:00", TRIAL_NOTE); rec(NOV[1], "14:00", TRIAL_NOTE);  // вт: только пробы бота — открыт
  rec(NOV[2], "12:00", "Запись через AI-администратора");              // ср: живая запись через бота (WhatsApp) — закрыт
  const c = { id: "winchester", altegio: { trialNextMonth: true } };
  assert.deepEqual(await altTrialDates(s.env, c, LOC, Date.now()), [NOV[1], NOV[3]]);
  // пометка — только целиком: начало «ПРОБНАЯ запись» у записи администратора день не открывает; журнал без поля comment — день закрыт
  reset(W());
  rec(NOV[0], "12:00", "ПРОБНАЯ запись"); rec(NOV[1], "12:00", null);
  assert.deepEqual(await altTrialDates(s.env, c, LOC, Date.now()), [NOV[2], NOV[3]]);
});

// ---- 2. Мастер не работает в этот день или в это время, а бот называет его свободным: «Свободные окна» — время, когда свободен хоть кто-то
const SAYS_FREE = /Тони[^.!?\n]*15:00[^.!?\n]*(свобод|можно)/;
const tonyOffMon = (st, d) => st === "31" && d === MON ? [] : DAY;

test("у Тони выходной в понедельник: в подсказке выходной назван прямо; «у Тони в понедельник в 15:00 свободно» защита не пропускает", async () => {
  reset(W(tonyOffMon));
  const s = mk(env());
  net.ai = ["Да, у Тони в понедельник, 2 ноября, в 15:00 свободно ✂️ Как вас зовут?"]; // ИИ повторяет ошибку и после переспроса — отвечает код
  const r = await ownerChat(s, "lt-off-1", "Хочу к Тони на стрижку в понедельник в 15:00");
  assert.ok(/\(2026-11-02\): у мастера Тони в этот день нет свободного времени/.test(sys(0)), sys(0).slice(sys(0).indexOf("Проверка длительности"), sys(0).indexOf("Проверка длительности") + 500));
  assert.ok(net.gemini.length >= 2 && !SAYS_FREE.test(r.reply) && /Тони/.test(r.reply), r.reply);
});

test("мастер не назван: в подсказке видно, кто свободен в названное время, — Тони с выходным среди них нет", async () => {
  reset(W(tonyOffMon));
  const s = mk(env());
  net.ai = ["В понедельник, 2 ноября, в 15:00 есть время 💈 К кому записать?"];
  await ownerChat(s, "lt-off-2", "Есть время на стрижку в понедельник в 15:00?");
  const line = (sys(0).match(/\n- 15:00, понедельник[^\n]*/) || [""])[0];
  assert.ok(/свободны: Рауан, Айдос, Айдын/.test(line) && !/Тони/.test(line), "строка о 15:00 в понедельник: " + line);
  assert.ok(/\(2026-11-02\):[^\n]*нет свободного времени весь день у мастеров: Тони/.test(sys(0)), sys(0).slice(sys(0).indexOf("Проверка длительности"), sys(0).indexOf("Проверка длительности") + 400));
});

test("мастер не назван, ИИ называет свободным Тони в его выходной — защита не пропускает; другого мастера в это время — пропускает", async () => {
  reset(W(tonyOffMon));
  let s = mk(env());
  net.ai = ["Да, в понедельник, 2 ноября, в 15:00 у Тони свободно 💈 Записать?"];
  const r = await ownerChat(s, "lt-off-3", "Есть время на стрижку в понедельник в 15:00?");
  assert.ok(net.gemini.length >= 2 && !SAYS_FREE.test(r.reply), r.reply);
  reset(W(tonyOffMon));
  s = mk(env());
  net.ai = ["Да, в понедельник, 2 ноября, в 15:00 у Рауана свободно 💈 Записать?"];
  await ownerChat(s, "lt-off-4", "Есть время на стрижку в понедельник в 15:00?");
  assert.equal(net.gemini.length, 1, "верный ответ защита не трогает");
});

test("Тони в понедельник работает до 13:30: «к Тони в понедельник в 15:00 можно» не проходит, «во вторник в 15:00» — проходит", async () => {
  const short = (st, d) => st === "31" && d === MON ? grid(10, 13.5) : DAY;
  reset(W(short));
  let s = mk(env());
  net.ai = ["Да, к Тони в понедельник, 2 ноября, в 15:00 можно ✂️ Как вас зовут?"];
  let r = await ownerChat(s, "lt-off-5", "Можно к Тони в понедельник в 15:00 на стрижку?");
  assert.ok(net.gemini.length >= 2 && !SAYS_FREE.test(r.reply), r.reply);
  reset(W(short));
  s = mk(env());
  net.ai = ["Да, к Тони во вторник, 3 ноября, в 15:00 можно ✂️ Как вас зовут?"];
  r = await ownerChat(s, "lt-off-6", "Можно к Тони во вторник в 15:00 на стрижку?");
  assert.equal(net.gemini.length, 1, "верный ответ защита не трогает: " + r.reply);
});

test("клиент назвал Тони, ИИ предлагает другого мастера или «любого свободного» — защита ответ не переписывает", async () => {
  for (const [i, say] of ["У Тони в понедельник выходной. Могу записать к Айдосу в понедельник в 15:00 — подойдёт?",
    "У Тони в понедельник выходной. В понедельник в 15:00 могу записать к любому свободному мастеру — подойдёт?"].entries()) {
    reset(W(tonyOffMon));
    const s = mk(env());
    net.ai = [say];
    await ownerChat(s, "lt-off-7" + i, "Хочу к Тони на стрижку в понедельник в 15:00");
    assert.equal(net.gemini.length, 1, say);
  }
});

test("номер бота (не пробный режим): клиент день не называл, ИИ «у Тони завтра в 15:00 свободно», а завтра у Тони выходной — не проходит", async () => {
  const INST = { id: "7105000077", token: "ga-tok-lt" };
  reset(W((st, d) => st === "31" && d === D1 ? [] : DAY));
  const s = mk(env({ GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token })), from = "77000000401";
  net.ai = ["Да, у Тони завтра в 15:00 свободно ✂️ Как вас зовут?"];
  await s.gaText("winchester", INST, from, "Можно к Тони в 15:00 на стрижку?");
  const sent = net.ga.filter(x => x.op === "sendMessage" && x.body && x.body.chatId === from + "@c.us").map(x => x.body.message);
  assert.ok(net.gemini.length >= 2 && sent.length && !SAYS_FREE.test(sent.at(-1)), JSON.stringify(sent));
});

// ---- 3. Пробный чат сверх пределов: заявка администратору «запишите вручную» для пробной записи (с любым набранным номером) —
// администратор живого бизнеса мог записать в журнал выдуманного клиента. Пределы остаются, ответ — мягкий отказ без заявки
test("пробный чат: предел пробных записей за сутки исчерпан — записи нет и заявки администратору нет", async () => {
  reset(W());
  const s = mk(env());
  await s.env.KV.put(`bk:${LOC}:trial:2026-10-03`, "5");
  net.ai = [`Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", NOV[1], "12:00")}`];
  const r = await ownerChat(s, "lt-limit", "Азамат, +7 700 000 12 34, стрижка к Рауану 3 ноября в 12:00");
  assert.equal(posts(), 0, r.reply);
  assert.ok(!net.tg.some(m => /запишите вручную|Заявка без записи|превышен лимит/.test(m.text)) && !s.leads("winchester").length, JSON.stringify(net.tg.map(m => m.text)));
  assert.ok(/тестов/i.test(r.reply) && /предел/i.test(r.reply), r.reply);
});

test("пробный чат: предел отмен и переносов исчерпан — перенос не уходит администратору, пробная запись остаётся", async () => {
  reset(W());
  const s = mk(env()), sid = "lt-cx";
  net.ai = [`Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", MON, "12:00")}`];
  await ownerChat(s, sid, "Азамат, +7 700 000 12 34, стрижка к Рауану в понедельник 2 ноября в 12:00");
  await s.env.KV.put(`bk:${LOC}:cx:trial:${hash("h:web:winchester:" + sid)}:2026-10-03`, "3"); // предел пробного чата — на чат (раздел 6)
  net.ai = [`Перенесла.\n[ОТМЕНА] Имя: Азамат; Дата: ${MON}; Время: 12:00\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", MON, "15:00")}`];
  const r = await ownerChat(s, sid, "Перенесите мою запись на 15:00");
  assert.ok(posts() === 1 && dels() === 0, net.alt.join(" | "));
  assert.ok(!net.tg.some(m => /сделайте в Altegio/.test(m.text)) && !s.leads("winchester").some(l => /Перенести запись/.test(l.service)), JSON.stringify(net.tg.map(m => m.text)));
  assert.ok(/тестов/i.test(r.reply) && /12:00/.test(r.reply), r.reply);
});

// ---- 4. Находки проверки правки (19.10.2026, три проверяющих агента): защита «мастер и время» (fitWho) отклоняла верные ответы,
// пропускала перечень мастеров, а пробный чат всё ещё слал администратору заявки по пробам и по записям, которых в чате нет
const D3 = new Date(Date.parse(D1 + "T00:00:00Z") + 2 * 86400e3).toISOString().slice(0, 10);
const GA = { id: "7105000066", token: "ga-tok-lt2" };
const gaEnv = () => env({ GA_ID_WINCHESTER: GA.id, GA_TOKEN_WINCHESTER: GA.token });
const gaSent = to => net.ga.filter(x => x.op === "sendMessage" && x.body && x.body.chatId === to + "@c.us").map(x => x.body.message);
const gaStep = async (s, from, text, ai) => { net.ai = Array.isArray(ai) ? ai : [ai]; const n0 = gaSent(from).length; await s.gaText("winchester", GA, from, text); return gaSent(from).slice(n0).join(" || "); };
const cxLine = (name, date, time) => `[ОТМЕНА] Имя: ${name}; Дата: ${date}; Время: ${time}`;
const other = (staff, date, time, svc = 201) => net.altRecords.push({ phone: "+77000009999", fullname: "Другой клиент", comment: "", appointments: [{ id: 1, services: [svc], staff_id: staff, datetime: `${date}T${time}:00+05:00` }] });
const guestChat = async (s, sid, text) => (await s.browser().post("/api/chat", { c: "winchester", sid, text })).json();
const ADMIN_TG = /запишите вручную|Заявка без записи|могла создаться|нет в этом чате|отмените её вручную|сделайте в Altegio/;
const adminTg = () => net.tg.map(m => m.text || "").filter(t => ADMIN_TG.test(t));

test("номер бота: стрижка 12:00 к Рауану → «ещё на 15:00 Отец и сын» → перенос стрижки с 12:00 на 14:00 — переносится (длительность — не от «Отца и сына»)", async () => {
  for (const [i, say] of [`Перенесла вашу запись к Рауану на завтра в 14:00 ✂️\n${cxLine("Азамат", D1, "12:00")}\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", D1, "14:00")}`,
    `Перенесла вашу запись к Рауану с 12:00 на 14:00 ✂️\n${cxLine("Азамат", D1, "12:00")}\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", D1, "14:00")}`].entries()) {
    reset(W(() => DAY, [D1, D2, D3]));
    const s = mk(gaEnv()), from = "7700000060" + i;
    await gaStep(s, from, "Азамат, к Рауану завтра в 12:00", `Записала вас к Рауану на завтра в 12:00 ✂️\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", D1, "12:00")}`);
    later();
    await gaStep(s, from, "Хочу ещё на 15:00 к Рауану Отец и сын", `Записала: «Отец и сын» к Рауану, завтра в 15:00 👨‍👦\n${tag("Азамат", "Комплекс «Отец и сын»", "Рауан", D1, "15:00")}`);
    assert.equal(posts(), 2, net.alt.join(" | "));
    later(); net.gemini.length = 0;
    const r = await gaStep(s, from, "Перенесите, пожалуйста, запись с 12:00 на 14:00", [say, "К сожалению, завтра в 14:00 у Рауана нет свободного времени."]);
    assert.equal(net.gemini.length, 1, "ответ ИИ не переписывается: " + r);
    assert.ok(/Перенесла вашу запись/.test(r) && posts() === 3 && dels() === 1, r + " | " + net.alt.join(" | "));
  }
});

test("номер бота: после записи «Отец и сын» вопрос о переносе стрижки на 14:00 без служебных строк — не переписывается", async () => {
  reset(W(() => DAY, [D1, D2, D3]));
  const s = mk(gaEnv()), from = "77000000611";
  await gaStep(s, from, "Азамат, к Рауану завтра в 12:00", `Записала вас к Рауану на завтра в 12:00 ✂️\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", D1, "12:00")}`);
  later();
  await gaStep(s, from, "Хочу ещё на 15:00 к Рауану Отец и сын", `Записала: «Отец и сын» к Рауану, завтра в 15:00 👨‍👦\n${tag("Азамат", "Комплекс «Отец и сын»", "Рауан", D1, "15:00")}`);
  later(); net.gemini.length = 0;
  const r = await gaStep(s, from, "Перенесите, пожалуйста, стрижку с 12:00 на 14:00", "Завтра в 14:00 у Рауана можно — перенести вашу стрижку на это время?");
  assert.equal(net.gemini.length, 1, r);
});

test("защита «мастер и время»: время из строки [ЗАЯВКА] не судит — запись проверяет расписание с услугой из строки", () => {
  // у Рауана завтра занято 15:00–16:30; клиент последним назвал «Отец и сын» (1 ч 30 мин), а переносят стрижку на 14:00
  const fitWho = { need: 90, step: 30, long: "1 ч 30 мин", service: "Отец и сын", named: "32", staff: STAFF.map(x => ({ ...x, base: x.name })), lists: { 32: { [D1]: [...grid(10, 14.5), ...grid(16.5, 20.5)] } }, days: [D1] };
  const ctx = { nowMs: Date.now(), slots: [], extraTimes: new Set(["14:00"]), softTimes: new Set(), durations: new Set([30, 60, 90]), fitWho };
  const c = { facts: "", hours: [], name: "Winchester" }, say = "Перенесла вашу запись к Рауану на завтра в 14:00 ✂️";
  assert.match(String(checkReply(c, say, "", ctx).why), /у мастера Рауан/, "без строки [ЗАЯВКА] время судится");
  assert.equal(checkReply(c, say, "", ctx, `${say}\n${cxLine("Азамат", D1, "12:00")}\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", D1, "14:00")}`).why, null);
});

test("конец промежутка («по 17:00», «до 17:00», «17:00-ге дейін») и часы работы со словом «ждём» — не предложение времени мастера", async () => {
  const cases = [
    [() => { other(32, D1, "17:00"); other(32, D1, "14:00"); }, "Ертең Рауанға шаш алуға бола ма?", "Ертең Рауан 15:00-ден 17:00-ге дейін бос ✂️ Қай уақыт ыңғайлы?"],
    [() => other(32, D1, "17:00"), "Рауан завтра свободен после обеда?", "Да, завтра Рауан свободен с 14:00, можно прийти до 17:00 ✂️ Во сколько удобно?"],
    [() => other(32, D1, "17:00"), "Рауан завтра свободен после обеда?", "Да, завтра у Рауана свободно с 15:00 по 17:00 ✂️ Во сколько удобно?"],
    [() => other(32, D1, "10:00"), "Хочу к Рауану завтра. Во сколько вы открываетесь?", "Завтра ждём вас с 10:00 до 21:00 ✂️\nУ Рауана завтра свободно в 15:00 и 16:00 — во сколько удобно?"],
    [() => { for (const d of [D1, D2, D3]) other(32, d, "10:00"); }, "Хочу к Рауану. Во сколько вы открываетесь?", "Мы работаем ежедневно с 10:00 до 21:00, ждём вас! У Рауана завтра свободно в 15:00 и 16:00 — во сколько удобно?"]];
  for (const [i, [setup, text, say]] of cases.entries()) {
    reset(W(() => DAY, [D1, D2, D3])); setup();
    const s = mk(gaEnv()), from = "7700000062" + i;
    const r = await gaStep(s, from, text, say);
    assert.equal(net.gemini.length, 1, say + " → " + r);
  }
});

test("день из фразы не среди проверенных («послезавтра», когда прочитано только «завтра»; ошибка Altegio у другого мастера) — мастера по другим дням не судим", async () => {
  // номер бота: прочитано только «завтра», у Тони завтра выходной, послезавтра свободен
  reset(W((st, d) => st === "31" && d === D1 ? [] : DAY, [D1, D2]));
  let s = mk(gaEnv());
  const r = await gaStep(s, "77000000630", "Можно завтра на стрижку в 15:00?", "Завтра в 15:00 могу записать вас к Рауану. Послезавтра в 15:00 свободен и Тони — как удобнее?");
  assert.equal(net.gemini.length, 1, r);
  // пробный чат: Altegio ответил ошибкой на время Рауана в понедельник; Тони в понедельник работает, во вторник и среду — выходной
  const data = W((st, d) => st === "31" && d !== MON ? [] : DAY), tf = data.timesFor;
  data.timesFor = (st, d, sids) => st === "32" && d === MON && !sids.length ? { error: 500 } : tf(st, d, sids);
  reset(data);
  s = mk(env());
  net.ai = ["Да, у Тони в понедельник, 2 ноября, в 15:00 свободно ✂️ Как вас зовут?"];
  const r2 = await ownerChat(s, "lt-r2", "Есть время на стрижку в понедельник в 15:00?");
  assert.ok(!sys(0).slice(sys(0).indexOf("Проверка длительности")).includes("(2026-11-02)"), "понедельника нет в «Проверке длительности»: время Рауана не прочитано");
  assert.equal(net.gemini.length, 1, r2.reply);
});

test("у Тони выходной: «к другим мастерам», «к любому свободному», «Тони не работает» и клиент сменил Тони на «любого» — ответ не переписывается", async () => {
  for (const [i, say] of ["У Тони в понедельник, 2 ноября, выходной. В понедельник в 15:00 есть свободное время у других барберов — записать?",
    "У Тони в понедельник, 2 ноября, выходной, но в 15:00 могу записать вас к любому свободному мастеру — подойдёт?",
    "Тони в понедельник не работает, в 15:00 свободны другие мастера — записать к кому-то из них?"].entries()) {
    reset(W(tonyOffMon));
    const s = mk(env());
    net.ai = [say];
    await ownerChat(s, "lt-neg" + i, "Хочу к Тони на стрижку в понедельник в 15:00");
    assert.equal(net.gemini.length, 1, say);
  }
  reset(W(tonyOffMon));
  const s = mk(env()), sid = "lt-neg-any";
  net.ai = ["У Тони в понедельник, 2 ноября, выходной. Могу записать к Айдосу в понедельник в 15:00 — подойдёт?"];
  await ownerChat(s, sid, "Хочу к Тони на стрижку в понедельник в 15:00");
  net.gemini.length = 0; net.ai = ["Хорошо, в понедельник, 2 ноября, в 15:00 есть свободное время — как вас зовут?"];
  const r = await ownerChat(s, sid, "Тогда к любому мастеру, кто свободен в 15:00");
  assert.equal(net.gemini.length, 1, r.reply);
});

test("перечень мастеров («свободны Тони, Рауан и Айдос», столбиком) с Тони в его выходной — защита не пропускает", async () => {
  for (const [i, say] of ["В понедельник, 2 ноября, в 15:00 свободны Тони, Рауан и Айдос 💈 К кому записать?",
    "В понедельник, 2 ноября, в 15:00 свободны мастера:\n• Тони\n• Рауан\n• Айдос\nК кому записать?"].entries()) {
    reset(W(tonyOffMon));
    const s = mk(env());
    net.ai = [say, "В понедельник, 2 ноября, в 15:00 свободны Рауан и Айдос 💈 К кому записать?"];
    const r = await ownerChat(s, "lt-list" + i, "Есть время на стрижку в понедельник в 15:00? Кто из мастеров свободен?");
    assert.ok(net.gemini.length >= 2 && !/Тони/.test(r.reply), r.reply);
  }
});

test("пробный чат, гость: отмена и перенос записи, которой нет в чате, — без заявки и без сообщения администратору", async () => {
  reset(W());
  let s = mk(env());
  net.ai = [`Отменила.\n${cxLine("Азамат", NOV[1], "15:00")}`];
  let r = await guestChat(s, "lt-nosuch-a", "Отмените мою запись на 3 ноября в 15:00, Азамат, мой номер +7 700 000 12 34");
  assert.ok(!s.leads("winchester").length && !adminTg().length, JSON.stringify(net.tg.map(m => m.text)));
  assert.ok(/тестов/i.test(r.reply) && !/администратор/i.test(r.reply), r.reply);
  reset(W());
  s = mk(env());
  net.ai = [`Перенесла.\n${cxLine("Азамат", NOV[1], "15:00")}\n[ЗАЯВКА] Имя: Азамат; Телефон: +77000001234; Услуга: Мужская стрижка (7 000 ₸); Мастер: Рауан; Дата: ${NOV[1]}; Время: 17:00`];
  r = await guestChat(s, "lt-nosuch-b", "Перенесите мою запись с 15:00 на 17:00 3 ноября, Азамат, +7 700 000 12 34");
  assert.ok(!s.leads("winchester").length && !adminTg().length && !net.tg.length, JSON.stringify(net.tg.map(m => m.text)));
  assert.ok(/тестов/i.test(r.reply) && !/администратор/i.test(r.reply), r.reply);
});

test("пробный чат: Altegio не принял пробу (ошибка сервера у гостя, код из SMS у владельца, нет даты) — заявки «запишите вручную» нет", async () => {
  const real = globalThis.fetch;
  const failPost = (re, status, body) => { globalThis.fetch = async (u, init = {}) => re.test(String(u)) && (init.method || "GET") === "POST" ? new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }) : real(u, init); };
  const ask = `Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", NOV[1], "12:00")}`, text = "Азамат, +7 700 000 12 34, стрижка к Рауану 3 ноября в 12:00";
  try {
    // гость, показ без записи: book_check ответил 500 — такая проверка запись не создаёт, сообщать некому и не о чем
    reset(W()); let s = mk(env());
    failPost(/\/book_check\//, 500, { success: false, data: null, meta: { message: "Server error" } });
    net.ai = [ask];
    let r = await guestChat(s, "lt-fail-a", text);
    assert.ok(!s.leads("winchester").length && !net.tg.length, r.reply + " | " + JSON.stringify(net.tg.map(m => m.text)));
    assert.ok(/тестов/i.test(r.reply) && !/администратор/i.test(r.reply), r.reply);
    // владелец: локация требует код из SMS (432) — запись не создана
    reset(W()); s = mk(env());
    failPost(/\/book_record\//, 422, { success: false, data: null, meta: { message: "Confirmation code required", code: 432 } });
    net.ai = [ask];
    r = await ownerChat(s, "lt-fail-b", text);
    assert.ok(!s.leads("winchester").length && !adminTg().length, r.reply + " | " + JSON.stringify(net.tg.map(m => m.text)));
    assert.ok(/тестов/i.test(r.reply), r.reply);
    // владелец: сбой сервера на настоящей пробе — запись могла создаться: владельцу — «ПРОБНАЯ, проверьте журнал», без заявки
    reset(W()); s = mk(env());
    failPost(/\/book_record\//, 502, { success: false, data: null, meta: { message: "Bad gateway" } });
    net.ai = [ask];
    r = await ownerChat(s, "lt-fail-c", text);
    assert.ok(!s.leads("winchester").length && !net.tg.some(m => /запишите вручную/.test(m.text)), JSON.stringify(net.tg.map(m => m.text)));
    assert.ok(net.tg.some(m => /ПРОБНАЯ/.test(m.text) && /проверьте журнал/.test(m.text)), JSON.stringify(net.tg.map(m => m.text)));
  } finally { globalThis.fetch = real; }
  // гость: ИИ не указал дату в строке
  reset(W()); const s = mk(env());
  net.ai = ["Записала вас.\n[ЗАЯВКА] Имя: Азамат; Телефон: —; Услуга: Мужская стрижка (7 000 ₸); Мастер: Рауан; Дата: —; Время: 12:00"];
  const r = await guestChat(s, "lt-fail-d", "Азамат, +7 700 000 12 34, стрижка к Рауану в 12:00");
  assert.ok(!s.leads("winchester").length && !net.tg.length, r.reply + " | " + JSON.stringify(net.tg.map(m => m.text)));
});

// ---- 5. Перенос своей записи на время, которое с ней пересекается. Живая проверка владельца 19.10.2026: «пн 12:00 к Рауану» → «на 12:30»
// (или к другому мастеру на пересекающееся время) — бот отвечал «не получится» или «уже есть запись»: проверка длительности считала
// 12:00–13:00 занятым самой переносимой записью, а новая запись создавалась до удаления старой — Altegio отвечал 433/437.
// Altegio здесь как вживую: при создании записи время мастера занято записью на всю длительность услуги (433), у клиента с тем же номером
// уже есть пересекающаяся запись у другого мастера (437). fail(appointment) — код, которым Altegio откажет этой попытке (0 — как обычно)
const digits = s => String(s || "").replace(/\D/g, "");
const liveRecs = () => net.altRecords.map((r, i) => ({ r, id: String(777001 + i), a: (r.appointments || [])[0] || {} })).filter(x => !net.altDeleted.includes(x.id) && !(net.altGone || []).includes(x.id));
const spanOf = a => { const s = mn(String(a.datetime).slice(11, 16)); return [s, s + svLen((a.services || []).map(String))]; };
const journal = () => liveRecs().map(x => `${String(x.a.datetime).slice(0, 16).replace("T", " ")} ${STAFF.find(s => s.id === x.a.staff_id).name}`).sort().join("; ");
// F — сбои по запросу (раздел 7): F.post(appointment, n), F.del(id, n), F.times(path, n) → код ответа | "net" (нет ответа) |
// "net-done" (Altegio сделал, но ответ не дошёл). Запись, которой уже нет (удалена администратором или ботом), DELETE отвечает 404
const altErr = (code, msg) => new Response(JSON.stringify({ success: false, data: null, meta: { message: msg, ...(code < 500 ? { errors: [{ code, message: msg }] } : {}) } }), { status: code < 500 ? 422 : code, headers: { "content-type": "application/json" } });
async function liveAlt(fn, F = {}) {
  const real = globalThis.fetch, n = { post: 0, del: 0, times: 0 };
  globalThis.fetch = async (u, init = {}) => {
    const path = String(u).replace("https://api.alteg.io/api/v1", ""), method = init.method || "GET";
    if (/^\/book_record\//.test(path) && method === "POST") {
      const b = JSON.parse(init.body), a = b.appointments[0], d = String(a.datetime).slice(0, 10), [s, e] = spanOf(a), f = F.post ? F.post(a, ++n.post) : 0;
      if (f === "net") { net.alt.push(`POST ${path} → нет ответа`); throw new TypeError("fetch failed"); }
      const near = liveRecs().filter(x => String(x.a.datetime).startsWith(d) && (([s2, e2]) => s < e2 && s2 < e)(spanOf(x.a)));
      const code = (typeof f === "number" && f) || (near.some(x => String(x.a.staff_id) === String(a.staff_id)) ? 433 : near.some(x => digits(x.r.phone) === digits(b.phone)) ? 437 : 0);
      if (code) {
        net.alt.push(`POST ${path} → ${code}`);
        return altErr(code, code === 437 ? "У клиента уже есть запись, которая пересекается с этим временем" : code === 433 ? "Выбранное время занято" : "Server error");
      }
      if (f === "net-done") { await real(u, init); net.alt[net.alt.length - 1] += " → создана, ответ не дошёл"; throw new TypeError("fetch failed"); }
    }
    let m;
    if ((m = path.match(/^\/user\/records\/(\d+)\/\w+/)) && method === "DELETE") {
      if (net.altDeleted.includes(m[1]) || (net.altGone || []).includes(m[1])) { net.alt.push(`DELETE ${path} → 404`); return new Response(JSON.stringify({ success: false, data: null, meta: { message: "Запись не найдена" } }), { status: 404, headers: { "content-type": "application/json" } }); }
      const f = F.del ? F.del(m[1], ++n.del) : 0;
      if (f === "net") { net.alt.push(`DELETE ${path} → нет ответа`); throw new TypeError("fetch failed"); }
      if (f === "net-done") { await real(u, init); net.alt[net.alt.length - 1] += " → удалена, ответ не дошёл"; throw new TypeError("fetch failed"); }
      if (typeof f === "number" && f) { net.alt.push(`DELETE ${path} → ${f}`); return altErr(f, "Server error"); }
    }
    if (/^\/book_times\//.test(path)) {
      const f = F.times ? F.times(path, ++n.times) : 0;
      if (f === "net") { net.alt.push(`GET ${path} → нет ответа`); throw new TypeError("fetch failed"); }
      if (typeof f === "number" && f) { net.alt.push(`GET ${path} → ${f}`); return altErr(f, "Server error"); }
    }
    const o = F.other && /api\.alteg\.io/.test(String(u)) ? F.other(path, method) : 0; // любой другой запрос к Altegio (чтение записи, журнал)
    if (o) { net.alt.push(`${method} ${path} → ${o}`); return altErr(o, "Server error"); }
    return real(u, init);
  };
  try { return await fn(); } finally { globalThis.fetch = real; }
}
const strictAlt = (fn, fail = () => 0) => liveAlt(fn, { post: fail });
// порядок действий в Altegio: P — запись создана, x — Altegio отказал, D — запись удалена
const order = () => net.alt.filter(x => /^(POST \/book_record\/|DELETE )/.test(x)).map(x => x.startsWith("DELETE") ? "D" : / → \d+$/.test(x) ? "x" : "P").join("");
const moveTo = (staff, date, from, to, svc = "Мужская стрижка (7 000 ₸)") => `Перенесла вашу запись к ${staff === "Тони" ? "Тони" : "Рауану"} на ${to} ✂️\n${cxLine("Азамат", date, from)}\n${tag("Азамат", svc, staff, date, to)}`;
// пробный веб-чат владельца или номер бота (Green-API, живая запись): send(текст, ответ ИИ) → ответ клиенту.
// У веб-чата — свой адрес на чат: с одного адреса он принимает не больше 30 сообщений в минуту (tooMany), а сообщений в этом файле больше
let IPN = 0;
const chatFor = (s, trial, id) => {
  if (!trial) return (text, ai) => gaStep(s, id, text, ai);
  const ip = `10.19.${++IPN}.1`; let b = null;
  return async (text, ai) => {
    if (!b) { b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Finbox" }); }
    net.ai = [ai];
    return (await (await b.post("/api/chat", { c: "winchester", sid: id, text }, { "cf-connecting-ip": ip })).json()).reply;
  };
};
const firstBook = (trial, day) => trial ? ["Азамат, +7 700 000 12 34, стрижка к Рауану в понедельник 2 ноября в 12:00", `Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", day, "12:00")}`]
  : ["Азамат, к Рауану завтра в 12:00", `Записала вас к Рауану на завтра в 12:00 ✂️\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", day, "12:00")}`];

test("пробный чат: перенос «пн 12:00 к Рауану» на 12:30 (пересекается со своей же записью) — сначала удаляется прежняя, потом создаётся новая", async () => {
  reset(W());
  await strictAlt(async () => {
    const s = mk(env()), send = chatFor(s, true, "lt-ov-1");
    await send(...firstBook(true, MON));
    later(); net.gemini.length = 0;
    const r = await send("Перенесите мою запись на 12:30", moveTo("Рауан", MON, "12:00", "12:30"));
    // подсказка: при переносе время своей записи у Рауана считается свободным — на 12:30 стрижка «можно»
    const line = (sys(0).match(/\n- 12:30, понедельник[^\n]*/) || [""])[0];
    assert.ok(/1 ч — можно/.test(line), "строка о 12:30: " + line);
    assert.equal(net.gemini.length, 1, "ответ ИИ защита не переписывает: " + r);
    assert.ok(/Перенесла вашу запись/.test(r), r);
    assert.equal(order(), "PDP", net.alt.join(" | "));
    assert.equal(journal(), `${MON} 12:30 Рауан`);
    assert.equal(net.altRecords.at(-1).comment, TRIAL_NOTE);
  });
});

test("номер бота: перенос на пересекающееся время — у того же мастера (12:00 → 12:30) и к другому мастеру (Тони, 13:00): прежняя удаляется первой", async () => {
  reset(W(() => DAY, [D1, D2, D3]));
  await strictAlt(async () => {
    const s = mk(gaEnv()), send = chatFor(s, false, "77000000701");
    await send(...firstBook(false, D1));
    later(); net.gemini.length = 0;
    let r = await send("Перенесите мою запись на 12:30", moveTo("Рауан", D1, "12:00", "12:30"));
    assert.equal(net.gemini.length, 1, "ответ ИИ защита не переписывает: " + r);
    assert.ok(/Перенесла вашу запись/.test(r), r);
    assert.equal(order(), "PDP", net.alt.join(" | "));
    assert.equal(journal(), `${D1} 12:30 Рауан`);
    // к другому мастеру на время, которое пересекается с записью у Рауана (12:30–13:30): новая запись первой — Altegio ответил бы 437
    later();
    r = await send("Перенесите к Тони на 13:00", moveTo("Тони", D1, "12:30", "13:00", "Мужская стрижка (9 000 ₸)"));
    assert.ok(/Перенесла вашу запись/.test(r), r);
    assert.equal(order(), "PDPDP", net.alt.join(" | "));
    assert.equal(journal(), `${D1} 13:00 Тони`);
    assert.ok(!s.leads("winchester").some(l => /Перенести|вручную|не удался/.test(l.service + " " + (l.note || ""))), JSON.stringify(s.leads("winchester")));
  });
});

test("номер бота: три записи в чате (предел активных — 3), перенос одной на пересекающееся время — предел не превышен", async () => {
  reset(W(() => DAY, [D1, D2, D3]));
  await strictAlt(async () => {
    const s = mk(gaEnv()), send = chatFor(s, false, "77000000702");
    await send(...firstBook(false, D1));
    await send("Ещё запишите меня к Айдосу на 15:00", `Записала.\n${tag("Азамат", "Моделирование бороды", "Айдос", D1, "15:00")}`);
    await send("И ещё к Айдыну на 17:00", `Записала.\n${tag("Азамат", "Моделирование бороды", "Айдын", D1, "17:00")}`);
    assert.equal(liveRecs().length, 3, net.alt.join(" | "));
    later();
    const r = await send("Перенесите стрижку на 12:30", moveTo("Рауан", D1, "12:00", "12:30"));
    assert.ok(/Перенесла вашу запись/.test(r), r);
    assert.equal(journal(), `${D1} 12:30 Рауан; ${D1} 15:00 Айдос; ${D1} 17:00 Айдын`);
  });
});

test("перенос без пересечения (12:00 → 15:00) — прежний порядок: сначала новая запись, потом удаление старой", async () => {
  for (const trial of [false, true]) {
    const day = trial ? MON : D1;
    reset(W(() => DAY, trial ? [D1, ...NOV] : [D1, D2, D3]));
    await strictAlt(async () => {
      const s = mk(trial ? env() : gaEnv()), send = chatFor(s, trial, trial ? "lt-ov-safe" : "77000000703");
      await send(...firstBook(trial, day));
      later();
      const r = await send("Перенесите мою запись на 15:00", moveTo("Рауан", day, "12:00", "15:00"));
      assert.ok(/Перенесла вашу запись/.test(r), r);
      assert.equal(order(), "PPD", (trial ? "пробный: " : "номер бота: ") + net.alt.join(" | "));
    });
  }
});

test("перенос на пересекающееся время, Altegio не принял новое время — прежняя запись сразу создаётся снова (тот же мастер, услуга, пометка)", async () => {
  for (const trial of [false, true]) {
    const day = trial ? MON : D1;
    reset(W(() => DAY, trial ? [D1, ...NOV] : [D1, D2, D3]));
    let once = true; // новое время 12:30 Altegio отклоняет один раз (его успели занять), прежнее 12:00 принимает
    await strictAlt(async () => {
      const s = mk(trial ? env() : gaEnv()), send = chatFor(s, trial, trial ? "lt-ov-back" : "77000000704");
      await send(...firstBook(trial, day));
      later();
      const tg0 = net.tg.length;
      let r = await send("Перенесите мою запись на 12:30", moveTo("Рауан", day, "12:00", "12:30"));
      assert.ok(!/Перенесла/.test(r) && /Прежняя запись остаётся/.test(r), r);
      assert.equal(order(), "PDxP", net.alt.join(" | "));
      assert.equal(journal(), `${day} 12:00 Рауан`);
      assert.equal(net.altRecords.at(-1).comment, trial ? TRIAL_NOTE : "Запись через AI-администратора");
      assert.deepEqual(net.altRecords.at(-1).appointments[0].services, [201]);
      // заявка одна — самой записи (с новым номером и пометкой о неудачном переносе), просьб администратору нет
      const leads = s.leads("winchester");
      assert.ok(leads.length === 1 && leads[0].altegio.record_id === 777002 && /создана заново/.test(leads[0].note) && !leads[0].status, JSON.stringify(leads));
      if (trial) assert.equal(net.tg.length, tg0, "пробный чат: без сообщений администратору " + JSON.stringify(net.tg.slice(tg0)));
      // в чате запись — с новым номером: отмена удаляет именно её
      later();
      r = await send("Отмените запись", `Отменила.\n${cxLine("Азамат", day, "12:00")}`);
      assert.match(net.alt.filter(x => x.startsWith("DELETE")).at(-1), /\/user\/records\/777002\//);
      assert.equal(journal(), "");
    }, a => once && String(a.datetime).includes("T12:30") ? (once = false, 433) : 0);
  }
});

test("перенос на пересекающееся время не удался и прежнюю запись вернуть не вышло — клиенту честно, администратору заявка (в пробном чате — без заявки)", async () => {
  for (const [trial, code] of [[false, 433], [false, 502], [true, 433]]) {
    const day = trial ? MON : D1, from = "77000000705";
    reset(W(() => DAY, trial ? [D1, ...NOV] : [D1, D2, D3]));
    let down = false; // после первой записи Altegio не принимает ни одной новой
    await strictAlt(async () => {
      const s = mk(trial ? env() : gaEnv()), send = chatFor(s, trial, trial ? "lt-ov-lost" : from);
      await send(...firstBook(trial, day));
      later(); down = true;
      const tg0 = net.tg.length, logs = [], log0 = console.log;
      console.log = (...a) => { logs.push(a.join(" ")); };
      let r;
      try { r = await send("Перенесите мою запись на 12:30", moveTo("Рауан", day, "12:00", "12:30")); } finally { console.log = log0; }
      const what = `${trial ? "пробный" : "номер бота"}, ${code}: `;
      // 502 — новая запись могла создаться: прежнюю второй раз не создаём (была бы лишняя запись)
      assert.equal(order(), code === 502 ? "PDx" : "PDxx", what + net.alt.join(" | "));
      assert.equal(journal(), "", what);
      assert.ok(!/Перенесла|Прежняя запись остаётся/.test(r) && /не получилось|не удалось/i.test(r) && /12:00/.test(r), what + r);
      assert.ok(!logs.some(l => l.includes(from) || l.includes("7000001234")), what + "номер в журнале: " + logs.join(" | "));
      if (trial) {
        assert.ok(/тестов/i.test(r) && !/администратор/i.test(r), what + r);
        assert.ok(!s.leads("winchester").some(l => /Перенос|вручную/.test(l.service + " " + (l.note || ""))) && net.tg.length === tg0, what + JSON.stringify(net.tg.slice(tg0)));
      } else {
        assert.ok(/администратор/i.test(r), what + r);
        const lead = s.leads("winchester").find(l => /Перенос не удался/.test(l.service + " " + (l.note || "")));
        assert.ok(lead && /12:30/.test(lead.time + " " + lead.note) && (code !== 502 || /могла создаться/i.test(lead.note)), what + JSON.stringify(s.leads("winchester")));
        assert.ok(net.tg.slice(tg0).some(m => /Перенос не удался/.test(m.text)), what + JSON.stringify(net.tg.slice(tg0).map(m => m.text)));
      }
    }, a => down ? code : 0);
  }
});

// ---- 6. Пробный чат: предел отмен и переносов (3 в сутки) был общим на все пробные чаты локации («trial»): владелец, проверяя бота,
// упирался в него после трёх попыток где угодно (живая проверка 19.10.2026). Теперь — на чат; живые пределы (с номера) прежние
test("пробный чат: предел отмен и переносов — на чат: отмены в других чатах владельца не мешают, в одном чате четвёртый перенос — мягкий отказ", async () => {
  reset(W());
  const s = mk(env());
  for (let i = 0; i < 3; i++) {
    const t = `${10 + i * 2}:00`, send = chatFor(s, true, "lt-cx-" + i);
    await send(`Азамат, +7 700 000 12 34, стрижка к Тони во вторник 3 ноября в ${t}`, `Записала.\n${tag("Азамат", "Мужская стрижка (9 000 ₸)", "Тони", NOV[1], t)}`);
    await send("Отмените запись", `Отменила.\n${cxLine("Азамат", NOV[1], t)}`);
  }
  assert.equal(dels(), 3, net.alt.join(" | "));
  const sid = "lt-cx-new", send = chatFor(s, true, sid);
  await send("Азамат, +7 700 000 12 34, стрижка к Рауану в среду 4 ноября в 12:00", `Записала.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", NOV[2], "12:00")}`);
  let prev = "12:00";
  for (const to of ["15:00", "16:00", "17:00"]) {
    const r = await send(`Перенесите на ${to}`, moveTo("Рауан", NOV[2], prev, to));
    assert.ok(/Перенесла вашу запись/.test(r), to + ": " + r);
    prev = to;
  }
  const p0 = posts(), tg0 = net.tg.length;
  const r = await send("Перенесите на 18:00", moveTo("Рауан", NOV[2], "17:00", "18:00"));
  assert.ok(posts() === p0 && /тестов/i.test(r) && /17:00/.test(r), r);
  assert.ok(!net.tg.slice(tg0).some(m => /сделайте в Altegio/.test(m.text)) && !s.leads("winchester").some(l => /Перенести запись/.test(l.service)), JSON.stringify(net.tg.slice(tg0)));
});

// ---- 7. Находки проверки переноса на пересекающееся время (19.10.2026, проверяющий «живой» Altegio): прежняя запись удалена первой,
// а дальше Altegio отказал или не ответил. Каждый случай сначала повторён здесь, потом исправлен
const afterDel = pat => { const i = net.alt.findIndex(x => x.startsWith("DELETE")); return i < 0 ? [] : net.alt.slice(i + 1).filter(x => pat.test(x)); };
const leadsAll = s => s.leads("winchester").map(l => `${l.service} | ${l.time} | ${l.status || "-"} | ${l.note || ""}`).join("\n");
const tgFrom = n => net.tg.slice(n).map(m => m.text || "");

test("перенос на пересекающееся время: после удаления прежней book_times не отвечает — прежняя сразу создаётся снова, без book_times (раньше — 4 × 8 с ожидания)", async () => {
  for (const trial of [false, true]) {
    const day = trial ? MON : D1;
    reset(W(() => DAY, trial ? [D1, ...NOV] : [D1, D2, D3]));
    let deleted = false;
    await liveAlt(async () => {
      const s = mk(trial ? env() : gaEnv()), send = chatFor(s, trial, trial ? "lt-s7" : "77000000807");
      await send(...firstBook(trial, day));
      later(); const tg0 = net.tg.length;
      const r = await send("Перенесите мою запись на 12:30", moveTo("Рауан", day, "12:00", "12:30"));
      const what = (trial ? "пробный: " : "номер бота: ") + net.alt.join(" | ");
      assert.equal(journal(), `${day} 12:00 Рауан`, what);
      assert.ok(afterDel(/book_times/).length <= 1, "после удаления — не больше одного обращения к book_times (каждое — до 8 с): " + what);
      assert.ok(!/Перенесла/.test(r) && !/уже снята|уже удалена/.test(r), r);
      assert.ok(!tgFrom(tg0).some(t => /остался без записи/.test(t)), JSON.stringify(tgFrom(tg0)));
    }, { del: () => { deleted = true; return 0; }, times: () => deleted ? "net" : 0 });
  }
});

test("перенос на пересекающееся время: прежняя создана снова, но ответ Altegio не дошёл (или 502) — не «клиент остался без записи», а «возможно, создана заново»", async () => {
  for (const [trial, how] of [[false, "net-done"], [false, 502], [true, "net-done"]]) {
    const day = trial ? MON : D1, what = `${trial ? "пробный" : "номер бота"}, ${how}: `;
    reset(W(() => DAY, trial ? [D1, ...NOV] : [D1, D2, D3]));
    await liveAlt(async () => {
      const s = mk(trial ? env() : gaEnv()), send = chatFor(s, trial, trial ? "lt-s3" : "77000000803");
      await send(...firstBook(trial, day));
      later(); const tg0 = net.tg.length;
      const r = await send("Перенесите мою запись на 12:30", moveTo("Рауан", day, "12:00", "12:30"));
      assert.ok(/заново/.test(r) && !/Администратор свяжется с вами и запишет/.test(r), what + r);
      assert.ok(!tgFrom(tg0).some(t => /остался без записи/.test(t)), what + JSON.stringify(tgFrom(tg0)));
      if (!trial) {
        assert.ok(/возможно, создана заново/.test(leadsAll(s)) && !/вернуть прежнюю не удалось/.test(leadsAll(s)), what + leadsAll(s));
        assert.ok(tgFrom(tg0).some(t => /проверьте журнал/.test(t)), what + JSON.stringify(tgFrom(tg0)));
      }
    }, { post: (a, n) => String(a.datetime).includes("T12:30") ? 433 : n > 1 && String(a.datetime).includes("T12:00") ? how : 0 });
  }
});

test("перенос стрижки на 12:30, а в 13:00 у клиента борода у другого мастера — прежнюю не удаляем (Altegio ответил бы 437), отказ сразу", async () => {
  reset(W(() => DAY, [D1, D2, D3]));
  await strictAlt(async () => {
    const s = mk(gaEnv()), send = chatFor(s, false, "77000000801");
    await send(...firstBook(false, D1));
    await send("Ещё бороду к Айдосу на 13:00", `Записала.\n${tag("Азамат", "Моделирование бороды", "Айдос", D1, "13:00")}`);
    later(); const tg0 = net.tg.length;
    const r = await send("Перенесите стрижку на 12:30", moveTo("Рауан", D1, "12:00", "12:30"));
    assert.equal(order(), "PP", net.alt.join(" | "));
    assert.ok(/пересекается/.test(r) && /Прежняя запись остаётся/.test(r), r);
    assert.equal(net.tg.length, tg0, JSON.stringify(tgFrom(tg0)));
    assert.ok(![...s.kv.mem.keys()].some(k => /:cx:/.test(k)), "предел отмен не тратится");
  });
});

test("удаление прежней записи перед переносом без ответа: удалилась — перенос идёт дальше; на месте — «остаётся»; не узнать — без «остаётся»", async () => {
  for (const trial of [false, true]) {
    const day = trial ? MON : D1, tag0 = trial ? "пробный: " : "номер бота: ";
    // удалилась, ответ не дошёл
    reset(W(() => DAY, trial ? [D1, ...NOV] : [D1, D2, D3]));
    await liveAlt(async () => {
      const s = mk(trial ? env() : gaEnv()), send = chatFor(s, trial, trial ? "lt-s2a" : "77000000802");
      await send(...firstBook(trial, day));
      later();
      const r = await send("Перенесите мою запись на 12:30", moveTo("Рауан", day, "12:00", "12:30"));
      assert.ok(/Перенесла вашу запись/.test(r), tag0 + r + " | " + net.alt.join(" | "));
      assert.equal(journal(), `${day} 12:30 Рауан`, tag0);
    }, { del: () => "net-done" });
    // не удалилась: запись на месте
    reset(W(() => DAY, trial ? [D1, ...NOV] : [D1, D2, D3]));
    await liveAlt(async () => {
      const s = mk(trial ? env() : gaEnv()), send = chatFor(s, trial, trial ? "lt-s2b" : "77000000812");
      await send(...firstBook(trial, day));
      later();
      const r = await send("Перенесите мою запись на 12:30", moveTo("Рауан", day, "12:00", "12:30"));
      assert.ok(/Прежняя запись остаётся/.test(r) && !/Перенесла/.test(r), tag0 + r);
      assert.equal(journal(), `${day} 12:00 Рауан`, tag0);
    }, { del: () => "net" });
    // не узнать: ни сама запись, ни журнал не читаются — «остаётся» не говорим, в заявке нет «прежняя запись не отменена»
    reset(W(() => DAY, trial ? [D1, ...NOV] : [D1, D2, D3]));
    let deleted = false;
    await liveAlt(async () => {
      const s = mk(trial ? env() : gaEnv()), send = chatFor(s, trial, trial ? "lt-s2c" : "77000000822");
      await send(...firstBook(trial, day));
      later();
      const r = await send("Перенесите мою запись на 12:30", moveTo("Рауан", day, "12:00", "12:30"));
      assert.ok(!/Прежняя запись остаётся|Пробная запись остаётся/.test(r) && /могла/.test(r), tag0 + r + " | " + net.alt.join(" | "));
      if (!trial) assert.ok(!/прежняя запись не отменена/.test(leadsAll(s)) && /могла удалиться/.test(leadsAll(s)), leadsAll(s));
      else assert.ok(!s.leads("winchester").some(l => /вручную|Перенос/.test(l.service + " " + (l.note || ""))), leadsAll(s));
    }, { del: () => { deleted = true; return "net-done"; }, other: (path, method) => deleted && method === "GET" && /^\/(user\/)?records\//.test(path) ? 500 : 0 });
  }
});

test("прежнюю запись уже удалил администратор (DELETE — 404), новое время занято — удалённую администратором запись бот не создаёт снова", async () => {
  reset(W(() => DAY, [D1, D2, D3]));
  await strictAlt(async () => {
    const s = mk(gaEnv()), send = chatFor(s, false, "77000000804");
    await send(...firstBook(false, D1));
    net.altGone.push("777001"); net.altJournalFail = 500; // удалена прямо в Altegio; журнал в этот раз не прочитался — запись ещё в чате
    later(); const tg0 = net.tg.length;
    const r = await send("Перенесите мою запись на 12:30", moveTo("Рауан", D1, "12:00", "12:30"));
    assert.equal(order(), "PDx", net.alt.join(" | "));
    assert.equal(journal(), "");
    assert.ok(!/Прежняя запись остаётся/.test(r) && /уже нет/.test(r), r);
    assert.ok(!tgFrom(tg0).some(t => /создана заново/.test(t)), JSON.stringify(tgFrom(tg0)));
  }, a => String(a.datetime).includes("T12:30") ? 433 : 0);
});

// ---- 8. Находки проверки пробного чата (19.10.2026): из пробного веб-чата всё ещё уходили заявки и звонки администратору живого бизнеса —
// по номеру, который набрал посетитель. Пути были и раньше, но правка обещала: пробный чат администратора не зовёт
const guestFor = (s, id) => { const ip = `10.20.${++IPN}.1`, b = s.browser(); return async (text, ai) => { net.ai = Array.isArray(ai) ? ai : [ai]; return (await (await b.post("/api/chat", { c: "winchester", sid: id, text }, { "cf-connecting-ip": ip })).json()).reply; }; };
const ADMIN_ANY = /запишите вручную|Заявка без записи|Перезвоните|изменить запись|свяжется с ним|запишите клиента сами|пообещал/i;
const noAdmin = (s, tg0, what) => {
  const leads = s.leads("winchester").filter(l => !/записан в Altegio, №|проверка без записи/.test(l.note || ""));
  assert.ok(!leads.length, what + " заявки: " + leadsAll(s));
  assert.ok(!tgFrom(tg0).some(t => ADMIN_ANY.test(t)), what + " Telegram: " + JSON.stringify(tgFrom(tg0)));
};
const askT = `Записала вас.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", NOV[1], "12:00")}`, askText = "Азамат, +7 700 000 12 34, стрижка к Рауану 3 ноября в 12:00";

test("пробный чат: журнал пробных дней не читается (расписание «недоступно») — ни заявки «запишите вручную», ни звонка администратору", async () => {
  for (const who of ["гость", "владелец"]) {
    reset(W()); net.altJournalFail = 401; // ключ пользователя Altegio перестал действовать
    const s = mk(env()), send = who === "гость" ? guestFor(s, "lt-d-" + who) : chatFor(s, true, "lt-d-" + who);
    const r = await send(askText, askT);
    noAdmin(s, 0, who + ":");
    assert.ok(/тестов/i.test(r) && !/администратор/i.test(r), who + ": " + r);
  }
  reset(W()); net.altJournalFail = 401;
  const s = mk(env()), r = await guestFor(s, "lt-d-cb")("Хочу записаться на стрижку, мой номер +7 700 000 12 34", "Сейчас расписание недоступно, но мы обязательно поможем 😊");
  noAdmin(s, 0, "только номер:");
  assert.ok(!/администратор/i.test(r), r);
});

test("пробный чат: нет пробных дней, ИИ дважды «записал» без строки, ИИ пообещал звонок — без заявок «перезвоните» администратору", async () => {
  // все открытые дни следующего месяца — с записями живых клиентов: ответ «нет пробных дней» остаётся, звонка нет
  reset(W());
  for (const d of NOV) other(33, d, "18:00");
  let s = mk(env()), r = await guestFor(s, "lt-cb-none")(askText, askT);
  noAdmin(s, 0, "нет дней:");
  assert.ok(/тестовом чате/.test(r) && /свободных дней/.test(r), r);
  // ИИ второй раз «записал» без служебной строки
  reset(W()); s = mk(env());
  let send = guestFor(s, "lt-cb-stuck");
  await send(askText, "Записала вас к Рауану на 3 ноября в 12:00 ✂️");
  r = await send("Так записали?", "Да, записала вас к Рауану на 3 ноября в 12:00 ✂️");
  noAdmin(s, 0, "не оформилась:");
  assert.ok(/тестов/i.test(r) && !/администратор/i.test(r), r);
  // ИИ пообещал, что администратор свяжется
  reset(W()); s = mk(env());
  r = await guestFor(s, "lt-cb-promise")("Здравствуйте, я Азамат, +7 700 000 12 34. Есть вопрос по ценам на комплексы", "Администратор свяжется с вами и всё расскажет 😊");
  noAdmin(s, 0, "обещание:");
  assert.ok(/тестов/i.test(r), r);
});

test("пробный чат: «поменяйте мастера на это же время» — без просьбы администратору изменить запись (и у гостя, и у владельца)", async () => {
  for (const who of ["гость", "владелец"]) {
    reset(W());
    const s = mk(env()), send = who === "гость" ? guestFor(s, "lt-chg-" + who) : chatFor(s, true, "lt-chg-" + who);
    await send(askText, askT);
    const tg0 = net.tg.length;
    const r = await send("Можно поменять мастера на Айдоса на это же время?", `Хорошо, меняю мастера на Айдоса.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Айдос", NOV[1], "12:00")}`);
    noAdmin(s, tg0, who + ":");
    assert.ok(/тестов/i.test(r) && /12:00/.test(r) && !/администратор/i.test(r), who + ": " + r);
  }
});

test("пробный чат: предел пробных записей — на сегодня (5 на локацию) «попробуйте завтра», в чате (3 активные) — «отмените одну»", async () => {
  reset(W());
  let s = mk(env());
  await s.env.KV.put(`bk:${LOC}:trial:2026-10-03`, "5");
  let r = await chatFor(s, true, "lt-lim-day")(askText, askT);
  assert.ok(posts() === 0 && /завтра/.test(r) && !/Отмените одну/.test(r), r);
  reset(W());
  s = mk(env());
  const send = chatFor(s, true, "lt-lim-act");
  const rs = [];
  for (const t of ["10:00", "12:00", "14:00"]) rs.push(await send(`Азамат, +7 700 000 12 34, запишите ещё к Рауану 3 ноября на ${t}`, `Записала.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", NOV[1], t)}`));
  assert.equal(posts(), 3, rs.join(" | ") + " | " + net.alt.join(" | "));
  r = await send("Азамат, +7 700 000 12 34, и ещё к Рауану 3 ноября на 16:00", `Записала.\n${tag("Азамат", "Мужская стрижка (7 000 ₸)", "Рауан", NOV[1], "16:00")}`);
  assert.ok(posts() === 3 && /Отмените одну/.test(r), r);
});

// ---- 9. Находки проверки защиты «мастер и время» (19.10.2026, проверяющий ответов ИИ): верные ответы, где о занятом мастере сказано
// «нет свободного времени», «уже есть запись», «кроме Тони», отклонялись (лишний вызов ИИ, а потом — неверный ответ кода «не получится»);
// неверные — столбик под заголовком, день в прошлом предложении, «к сожалению» про другого мастера, казахские падежи — проходили
const D1only = [D1];
const GUARD = [
  // верные ответы — защита пропускает с первого раза (Тони завтра занят в 15:00–16:00 или выходной в понедельник)
  { id: "C1", ok: true, trial: true, work: tonyOffMon, text: "Хочу к Тони на стрижку в понедельник в 15:00", ai: "У Тони в понедельник, 2 ноября, в 15:00 нет свободного времени. Могу записать к Рауану на это время — подойдёт?" },
  { id: "C3", ok: true, busy: true, text: "Можно к Тони завтра в 15:00?", ai: "В 15:00 у Тони уже есть запись. Свободно в 16:00 или 16:30 — какое время удобнее?" },
  { id: "C4", ok: true, busy: true, text: "Можно к Тони завтра в 15:00?", ai: "Тонидің ертең 15:00-де бос уақыты жоқ. 16:00 немесе 16:30 бос — қайсысы ыңғайлы?" },
  { id: "C5", ok: true, busy: true, text: "Можно к Тони завтра в 15:00?", ai: "Toni has no free time tomorrow at 15:00. 16:00 or 16:30 are free — which suits you?" },
  { id: "C6", ok: true, busy: true, text: "Можно к Тони завтра в 15:00?", ai: "У Тони завтра на 15:00 окна нет, ближайшее свободное — 16:00. Записать?" },
  { id: "C11", ok: true, busy: true, text: "Есть время завтра в 15:00 на стрижку?", ai: "Завтра в 15:00 свободны все мастера, кроме Тони. К кому записать?" },
  { id: "C13", ok: true, busy: true, text: "Можно к Тони завтра в 15:00?", ai: "Завтра в 15:00 Тони не сможет, но свободен Рауан — записать к нему?" },
  { id: "C22", ok: true, busy: true, text: "Можно к Тони завтра в 15:00?", ai: "Вместо Тони завтра в 15:00 могу записать вас к Рауану — подойдёт?" },
  { id: "N1", ok: true, busy: true, text: "Есть время завтра в 15:00 на стрижку?", ai: "Завтра в 15:00 у Тони уже есть запись, но свободен Рауан — записать к нему?" },
  { id: "N2", ok: true, busy: true, text: "Есть время завтра в 15:00 на стрижку?", ai: "Завтра в 15:00 у Тони нет свободного времени, свободны Рауан, Айдос и Айдын. К кому записать?" },
  { id: "N3", ok: true, busy: true, text: "Есть время завтра в 15:00 на стрижку?", ai: "Завтра в 15:00 Тони не сможет, свободен Рауан — записать к нему?" },
  { id: "N5", ok: true, busy: true, text: "Ертең 15:00-де шаш алуға бола ма?", ai: "Ертең 15:00-де Тонидің бос уақыты жоқ, Рауанға жазуға болады — жазайын ба?" },
  { id: "N6", ok: true, busy: true, text: "Any free time tomorrow at 15:00 for a haircut?", ai: "Tomorrow at 15:00 Toni has no free slots, but Rauan is free — shall I book him?" },
  { id: "N7", ok: true, work: st => st === "31" ? grid(10, 13.5) : DAY, text: "Есть время завтра в 15:00 на стрижку?", ai: "Завтра Тони работает только до обеда, а в 15:00 могу записать вас к Рауану — подойдёт?" },
  { id: "C12", ok: true, busy: true, text: "Можно к Тони завтра в 15:00?", ai: "Тони завтра в 15:00 занят, а Рауан свободен — записать к нему?" },
  // клиент назвал Тони, у Тони завтра выходной, другой мастер свободен (номер бота: раньше fitBad судил всё по времени Тони)
  { id: "A1", ok: true, work: (st, d) => st === "31" && d === D1 ? [] : DAY, dates: [D1, D2, D3], text: "Хочу к Тони на стрижку завтра в 15:00", ai: "У Тони завтра выходной. Могу записать к Айдосу завтра в 15:00 — подойдёт?" },
  { id: "A2", ok: true, work: (st, d) => st === "31" && d === D1 ? [] : DAY, dates: [D1, D2, D3], text: "Хочу к Тони на стрижку завтра в 15:00", ai: "У Тони завтра выходной, но в 15:00 свободен Айдос — записать к нему?" },
  { id: "A3", ok: true, work: (st, d) => st === "31" && d === D1 ? [] : DAY, dates: [D1, D2, D3], text: "Хочу к Тони на стрижку завтра в 15:00", ai: "Тони завтра не работает. Завтра в 15:00 есть время у других барберов — записать?" },
  // неверные ответы — защита переписывает
  { id: "W1", ok: false, busy: true, text: "Есть время завтра в 15:00 на стрижку?", ai: "Завтра свободно:\n15:00 — Тони, Рауан\n16:00 — Айдос\nК кому записать?" },
  { id: "W1b", ok: false, busy: true, text: "Есть время завтра на стрижку?", ai: "Завтра свободное время у мастеров:\nТони — 15:00\nРауан — 16:00\nК кому записать?" },
  { id: "W2", ok: false, busy: true, text: "Можно к Рауану завтра в 15:00?", ai: "К сожалению, Рауан завтра не работает, но в 15:00 свободен Тони — записать к нему?" },
  { id: "W2b", ok: false, busy: true, work: st => st === "32" ? [] : DAY, text: "Есть время завтра в 15:00 на стрижку?", ai: "К сожалению, у Рауана завтра выходной, но в 15:00 свободен Тони — записать к нему?" },
  // (у Айдоса в понедельник — пробная запись: живая закрыла бы понедельник для пробного чата)
  { id: "W2c", ok: false, trial: true, work: tonyOffMon, setup: () => net.altRecords.push({ phone: "+77000009998", fullname: "Проба", comment: TRIAL_NOTE, appointments: [{ id: 1, services: [201], staff_id: 33, datetime: `${MON}T15:00:00+05:00` }] }), text: "Хочу к Тони на стрижку в понедельник в 15:00", ai: "У Тони в понедельник выходной. Могу записать к Айдосу в понедельник, 2 ноября, в 15:00 — подойдёт?" },
  { id: "W3", ok: false, trial: true, work: tonyOffMon, text: "Есть время на стрижку в понедельник?", ai: "В понедельник, 2 ноября, есть время. В 15:00 свободен Тони — записать?" },
  { id: "W4", ok: false, busy: true, text: "Ертең 15:00-де бос уақыт бар ма?", ai: "Ертең 15:00-де Тониде бос уақыт бар — жазайын ба?" },
  { id: "W5", ok: false, busy: true, text: "Есть время завтра в 15:00?", ai: "Завтра в 15:00 Тони свободен, а Рауан занят — записать к Тони?" },
  { id: "N8", ok: false, trial: true, work: tonyOffMon, text: "Есть время на стрижку в понедельник?", ai: "В понедельник, 2 ноября, свободно:\n• Тони — 15:00, 16:00\n• Рауан — 12:00\nК кому записать?" },
  // клиент назвал Тони (у него завтра выходной) без дня, ИИ предлагает Айдоса, а у Айдоса в 15:00 запись: время Айдоса раньше не читалось
  { id: "F7", ok: false, work: (st, d) => st === "31" && d === D1 ? [] : DAY, dates: [D1, D2, D3], setup: () => other(33, D1, "15:00"), text: "Хочу к Тони на стрижку в 15:00", ai: "У Тони завтра выходной. Завтра в 15:00 свободен Айдос — записать к нему?" }];
let GN = 0;
const guardRun = async k => {
  reset(W(k.work || (() => DAY), k.trial ? undefined : k.dates || D1only));
  if (k.busy) other(31, D1, "15:00");
  if (k.setup) k.setup();
  const s = mk(k.trial ? env() : gaEnv());
  if (k.trial) return { s, reply: await chatFor(s, true, "lt-g-" + ++GN)(k.text, k.ai) }; // свой адрес на чат: веб-чат принимает не больше 30 сообщений в минуту с адреса
  return { s, reply: await gaStep(s, "7700000" + String(7100 + ++GN), k.text, [k.ai]) };
};

test("защита «мастер и время»: верные ответы о занятом мастере («нет свободного», «кроме», «вместо», kk, en, другой мастер) — с первого раза", async () => {
  const bad = [];
  for (const k of GUARD.filter(x => x.ok)) { const { reply } = await guardRun(k); if (net.gemini.length !== 1) bad.push(`${k.id}: ${k.ai} → ${reply}`); }
  assert.deepEqual(bad, []);
});

test("защита «мастер и время»: неверные ответы (столбик под заголовком, день раньше, «к сожалению» о другом, kk-падеж, непрочитанный мастер) — переписываются", async () => {
  const bad = [];
  for (const k of GUARD.filter(x => !x.ok)) { const { reply } = await guardRun(k); if (net.gemini.length < 2) bad.push(`${k.id}: ${k.ai} → ${reply}`); }
  assert.deepEqual(bad, []);
});

test("ответ кода после отклонения «свободен Тони» (клиент мастера не выбирал): не «на 15:00 не получится», а кто свободен в 15:00", async () => {
  const { reply } = await guardRun({ busy: true, text: "Есть время завтра в 15:00 на стрижку?", ai: "Завтра в 15:00 свободен Тони — записать к нему?" });
  assert.ok(net.gemini.length >= 2, reply);
  assert.ok(!/не получится/.test(reply) && /Рауан/.test(reply) && /Тони/.test(reply), reply);
});

test("готовые фразы: длительность услуги на казахском и английском — не по-русски («1 ч 30 мин»)", async () => {
  const { altSay } = await import("../../src/services/booking/replies.js");
  const b = { reason: "taken", long: "1 ч 30 мин", time: "16:30", free: ["15:00"], staffName: "Тони" };
  assert.match(altSay("en", b), /1 h 30 min/);
  assert.match(altSay("kk", b), /1 сағ 30 мин/);
  assert.match(altSay("ru", b), /1 ч 30 мин/);
});

// ---- 10. Находки проверки повседневных диалогов (19.10.2026, проверяющие «номер бота», «пробный чат», «защита ответа»): после записи бот
// называл своё же время клиента «не получится — уже занято»; перенос без слов о переносе («а можно на 15:30?») упирался в свою же запись;
// сын с того же номера на то же время терялся; предел пробных записей мешал переносу и показу; «Отец и сын» читалось как родство;
// показ у гостя слал администратору «Новая запись в Altegio»; верное «у Тони нет времени, завтра можно в 11:00» и «свободен Рауан — да» переписывались
const ST7 = "Мужская стрижка (7 000 ₸)";
const gaBook = (s, from, t = "15:00") => gaStep(s, from, `Здравствуйте, запишите к Рауану на завтра в ${t}, Азамат`, `Записала вас: стрижка к Рауану, завтра в ${t} ✂️\n${tag("Азамат", ST7, "Рауан", D1, t)}`);
const NO_FIT = /не получится|болмайды|won['’]t work|уже занято/;

test("номер бота: после записи «завтра в 15:00 к Рауану» ответ о своей записи («ждём вас», «вы записаны», kk, «отменить запись в 15:00?») — не «не получится»", async () => {
  const cases = [["15:00", "Спасибо! А сколько будет стоить?", "Стрижка у Рауана — 7 000 ₸ ✂️ Ждём вас завтра в 15:00!"],
    ["15:00", "я точно записан?", "Да, вы записаны к Рауану на завтра в 15:00 ✂️"],
    ["15:00", "Мен қашан жазылдым?", "Сіз ертең сағат 15:00-ге Рауанға жазылдыңыз ✂️"],
    ["15:00", "отмените запись пожалуйста", "Отменить вашу запись к Рауану на завтра в 15:00? 🙌"],
    ["13:00", "Я записан на завтра в 13:00?", "Да, вы записаны к Рауану на завтра в 13:00 ✂️"],
    ["13:00", "А адрес какой?", "Наш адрес — в карточке компании 💈 Ваша запись — завтра в 13:00 у Рауана."]];
  const bad = [];
  for (const [i, [t, text, ai]] of cases.entries()) {
    reset(W(() => DAY, [D1, D2, D3]));
    const s = mk(gaEnv()), from = "7700000090" + i;
    await gaBook(s, from, t);
    later(); net.gemini.length = 0;
    const r = await gaStep(s, from, text, ai);
    if (net.gemini.length !== 1 || NO_FIT.test(r)) bad.push(`${text} → [ИИ ×${net.gemini.length}] ${r}`);
  }
  assert.deepEqual(bad, []);
});

test("номер бота: своя запись в 15:00 у Рауана, «а можно на 15:30?», «давайте к Рауану в 15:30», «Перенести?» → «да» — перенос, а не «у мастера занято»", async () => {
  const mv = moveTo("Рауан", D1, "15:00", "15:30");
  const ask = "Да, у Рауана завтра в 15:30 свободно ✂️ Перенести вашу запись с 15:00 на 15:30?";
  for (const [i, steps] of [[["а можно на 15:30?", mv]], [["давайте к Рауану в 15:30", mv]], [["а можно на 15:30?", ask], ["да", mv]], [["можно к Рауану на 15:30?", ask], ["да", mv]]].entries()) {
    reset(W(() => DAY, [D1, D2, D3]));
    await strictAlt(async () => {
      const s = mk(gaEnv()), from = "7700000091" + i;
      await gaBook(s, from);
      let r = "";
      for (const [text, ai] of steps) {
        later(); net.gemini.length = 0;
        r = await gaStep(s, from, text, ai);
        assert.equal(net.gemini.length, 1, `${i}: ${text} → ${r}`);
        if (/15:30/.test(text)) assert.ok(/\n- 15:30, завтра[^\n]*1 ч — можно/i.test(sys(0)), `${i}: в подсказке 15:30 у Рауана свободно (своя запись переносится): ` + (sys(0).match(/\n- 15:30, завтра[^\n]*/i) || [""])[0]);
      }
      assert.ok(/Перенесла вашу запись/.test(r), i + ": " + r);
      assert.equal(order(), "PDP", i + ": " + net.alt.join(" | "));
      assert.equal(journal(), `${D1} 15:30 Рауан`);
    });
  }
  // ещё одна запись на это время — по-прежнему занято: «ещё» — не перенос
  reset(W(() => DAY, [D1, D2, D3]));
  const s = mk(gaEnv()), from = "77000000919";
  await gaBook(s, from);
  later(); net.gemini.length = 0;
  await gaStep(s, from, "а можно ещё на 15:30 бороду?", "Уточню время 🙌");
  const line = (sys(0).match(/\n- 15:30, завтра[^\n]*/i) || [""])[0];
  assert.ok(/1 ч — нельзя/.test(line), "ещё одна запись: 15:30 занято своей записью — " + line);
});

test("один номер, двое на одно время к разным мастерам («меня к Рауану, сына к Айдосу»): Altegio 437 — сын не теряется (заявка администратору с его именем; в пробном чате — честный отказ)", async () => {
  const two = (day, who2 = "Айдос") => `Записала: вас к Рауану и Алихана к ${who2 === "Айдос" ? "Айдосу" : who2}, в 15:00 ✂️\n${tag("Азамат", ST7, "Рауан", day, "15:00")}\n${tag("Алихан", ST7, who2, day, "15:00")}`;
  // одним сообщением и вторым сообщением, номер бота
  for (const [i, second] of [false, true].entries()) {
    reset(W(() => DAY, [D1, D2, D3]));
    await strictAlt(async () => {
      const s = mk(gaEnv()), from = "7700000092" + i;
      let r;
      if (!second) r = await gaStep(s, from, "Запишите меня и сына завтра в 15:00: меня к Рауану, сына к Айдосу. Я Азамат, сын Алихан", two(D1));
      else {
        await gaBook(s, from);
        later();
        r = await gaStep(s, from, "А сына можно к Айдосу тоже на 15:00? Алихан", `Записала Алихана к Айдосу на завтра в 15:00 ✂️\n${tag("Алихан", ST7, "Айдос", D1, "15:00")}`);
      }
      assert.equal(order(), "Px", net.alt.join(" | "));
      assert.ok(/Алихан/.test(r) && !/Выберите, пожалуйста, другое время/.test(r), r);
      const lead = s.leads("winchester").find(l => l.name === "Алихан");
      assert.ok(lead && /15:00/.test(lead.time) && /437|один номер/.test(lead.note || ""), leadsAll(s));
      assert.ok(net.tg.some(m => /запишите вручную/.test(m.text) && /Алихан/.test(m.text)), JSON.stringify(net.tg.map(m => m.text)));
    });
  }
  // пробный чат владельца: заявки нет, но клиент знает, что Алихан не записан
  reset(W());
  await strictAlt(async () => {
    const s = mk(env()), send = chatFor(s, true, "lt-twin");
    const r = await send("Азамат, +7 700 000 12 34. Меня и сына в понедельник 2 ноября в 15:00: меня к Рауану, сына Алихана к Айдосу", two(MON));
    assert.equal(order(), "Px", net.alt.join(" | "));
    assert.ok(/Алихан/.test(r) && /тестов|один номер/.test(r), r);
    noAdmin(s, 0, "пробный:");
  });
});

test("пробный чат: предел пробных записей на сегодня исчерпан — перенос пробной записи (12:30, 15:00, другой день) и показ у гостя проходят", async () => {
  reset(W());
  await strictAlt(async () => {
    const s = mk(env()), send = chatFor(s, true, "lt-dl-move");
    await send(...firstBook(true, MON));
    await s.env.KV.put(`bk:${LOC}:trial:2026-10-03`, "5");
    later();
    let r = await send("Перенесите мою запись на 12:30", moveTo("Рауан", MON, "12:00", "12:30"));
    assert.ok(/Перенесла вашу запись/.test(r), r);
    later();
    r = await send("Перенесите мою запись на 15:00", moveTo("Рауан", MON, "12:30", "15:00"));
    assert.ok(/Перенесла вашу запись/.test(r), r);
    later();
    r = await send("Перенесите мою запись на вторник 3 ноября в 15:00", `Перенесла ✂️\n${cxLine("Азамат", MON, "15:00")}\n${tag("Азамат", ST7, "Рауан", NOV[1], "15:00")}`);
    assert.ok(/Перенесла вашу запись/.test(r), r);
    assert.equal(journal(), `${NOV[1]} 15:00 Рауан`);
  });
  // гость: показ без записи (только book_check) — предел пробных записей его не касается
  reset(W());
  const s = mk(env());
  await s.env.KV.put(`bk:${LOC}:trial:2026-10-03`, "5");
  const r = await guestFor(s, "lt-dl-guest")(askText, askT);
  assert.ok(/Записала/.test(r) && /показ/.test(r) && !/предел/.test(r), r);
});

test("«Отец и сын» — название услуги, а не родство: «Отец и сын перенесите на 17:00» переносит, «отмените Отец и сын» отменяет без лишнего «да»", async () => {
  const rec = { name: "Азамат", date: D1, time: "15:00", services: "Комплекс «Отец и сын»", staffName: "Рауан" };
  const o = { nowMs: Date.now(), services: SV.map(x => x.title), staff: STAFF, owner: "Азамат" };
  assert.equal(altOther(rec, "Отец и сын перенесите на 17:00", o, "move"), "");
  assert.equal(altOther(rec, "перенесите отца и сына на 17:00", o, "move"), "");
  assert.equal(altOther(rec, "отмените Отец и сын", o, ""), "");
  assert.equal(altOther(rec, "перенесите запись сына", o, "move"), "человек", "родство без названия услуги — по-прежнему другой человек");
  assert.equal(altOther({ ...rec, services: "Мужская стрижка" }, "перенесите отца и сына", { ...o, services: [] }, "move"), "человек", "у компании без такой услуги — родство");
  const OS = "Комплекс «Отец и сын»";
  for (const trial of [false, true]) {
    const day = trial ? MON : D1;
    reset(W(() => DAY, trial ? [D1, ...NOV] : [D1, D2, D3]));
    await strictAlt(async () => {
      const s = mk(trial ? env() : gaEnv()), send = chatFor(s, trial, trial ? "lt-fs" : "77000000930");
      await send(...firstBook(trial, day));
      later();
      await send("Хочу ещё на 15:00 к Рауану Отец и сын", `Записала: «Отец и сын» к Рауану в 15:00 👨‍👦\n${tag("Азамат", OS, "Рауан", day, "15:00")}`);
      later(); const tg0 = net.tg.length;
      let r = await send("Отец и сын перенесите на 17:00", moveTo("Рауан", day, "15:00", "17:00", OS));
      assert.ok(/Перенесла вашу запись/.test(r), (trial ? "пробный: " : "номер бота: ") + r);
      later();
      r = await send("отмените Отец и сын", `Отменила.\n${cxLine("Азамат", day, "17:00")}`);
      assert.ok(/Отменила/.test(r) && !/«да»/.test(r), (trial ? "пробный: " : "номер бота: ") + r);
      assert.equal(journal(), `${day} 12:00 Рауан`);
      assert.ok(!tgFrom(tg0).some(t => /которой нет в этом чате|сделайте в Altegio/.test(t)), JSON.stringify(tgFrom(tg0)));
    });
  }
});

test("пробный чат, гость (показ без записи): запись, перенос и отмена — без заявок и без сообщений администратору", async () => {
  reset(W());
  const s = mk(env()), send = guestFor(s, "lt-show");
  let r = await send(askText, askT);
  assert.ok(/Записала/.test(r) && /показ/.test(r), r);
  later();
  r = await send("Перенесите мою запись на 12:30", moveTo("Рауан", NOV[1], "12:00", "12:30"));
  assert.ok(/Перенесла/.test(r), r);
  later();
  r = await send("Перенесите на среду 4 ноября в 15:00", `Перенесла ✂️\n${cxLine("Азамат", NOV[1], "12:30")}\n${tag("Азамат", ST7, "Рауан", NOV[2], "15:00")}`);
  assert.ok(/Перенесла/.test(r), r);
  later();
  r = await send("Отмените запись", `Отменила.\n${cxLine("Азамат", NOV[2], "15:00")}`);
  assert.ok(/Отменила/.test(r), r);
  assert.equal(posts() + dels(), 0, net.alt.join(" | "));
  assert.equal(leadsAll(s), "");
  assert.deepEqual(net.tg.map(m => m.text), []);
});

test("клиент выбрал Тони, у Тони завтра нет времени: «у Тони нет свободного времени, завтра можно в 11:00 или 13:00 — к кому записать?» — не переписывается", async () => {
  const bad = [];
  for (const [i, say] of ["У Тони завтра нет свободного времени. Завтра можно в 11:00 или 13:00 — к кому из мастеров записать?",
    "Тони завтра весь день занят. Могу предложить ближайшее: завтра в 11:00 или в 13:00. Записать к Айдосу?"].entries()) {
    reset(W((st, d) => st === "31" && d === D1 ? [] : DAY, [D1, D2, D3]));
    const s = mk(gaEnv()), r = await gaStep(s, "7700000094" + i, "Хочу к Тони завтра", say);
    if (net.gemini.length !== 1) bad.push(say + " → " + r);
  }
  assert.deepEqual(bad, []);
  // неверное по-прежнему переписывается: время Тони названо прямо
  reset(W((st, d) => st === "31" && d === D1 ? [] : DAY, [D1, D2, D3]));
  const s = mk(gaEnv()), r = await gaStep(s, "77000000949", "Хочу к Тони завтра", "У Тони завтра свободно в 11:00 или 13:00 — какое время удобно?");
  assert.ok(net.gemini.length >= 2, r);
});

test("ИИ предложил другого мастера («в это время свободен Рауан — записать к нему?»), клиент «Да» — «завтра в 15:00 можно» без имени не судится по Тони", async () => {
  const offer = "У Тони завтра в 15:00 уже есть запись, но в это время свободен Рауан — записать к нему?";
  // в одном ответе, части разделены эмодзи
  reset(W(() => DAY, D1only)); other(31, D1, "15:00");
  let s = mk(gaEnv());
  let r = await gaStep(s, "77000000950", "Можно к Тони завтра в 15:00?", "У Тони завтра в 15:00 занято 🙏 В это время свободен Рауан. Записать вас к нему на 15:00?");
  assert.equal(net.gemini.length, 1, r);
  // следующим сообщением
  reset(W(() => DAY, D1only)); other(31, D1, "15:00");
  s = mk(gaEnv());
  await gaStep(s, "77000000951", "Можно к Тони завтра в 15:00?", offer);
  later(); net.gemini.length = 0;
  r = await gaStep(s, "77000000951", "Да, давайте", "Отлично, завтра в 15:00 можно ✂️ Как вас зовут?");
  assert.ok(net.gemini.length === 1 && !NO_FIT.test(r), r);
  // пробный чат (у Тони в понедельник в 15:00 — пробная запись: живая закрыла бы понедельник)
  reset(W());
  net.altRecords.push({ phone: "+77000009998", fullname: "Проба", comment: TRIAL_NOTE, appointments: [{ id: 1, services: [202], staff_id: 31, datetime: `${MON}T15:00:00+05:00` }] });
  s = mk(env());
  const send = chatFor(s, true, "lt-swap");
  await send("Можно к Тони в понедельник в 15:00?", "У Тони в понедельник, 2 ноября, в 15:00 уже есть запись, но свободен Рауан — записать к нему?");
  later(); net.gemini.length = 0;
  r = await send("Да", "Отлично, в понедельник, 2 ноября, в 15:00 можно ✂️ Как вас зовут и ваш номер телефона?");
  assert.ok(net.gemini.length === 1 && !NO_FIT.test(r), r);
  // а «к Тони на 15:00» после этого по-прежнему переписывается
  reset(W(() => DAY, D1only)); other(31, D1, "15:00");
  s = mk(gaEnv());
  await gaStep(s, "77000000952", "Можно к Тони завтра в 15:00?", offer);
  later(); net.gemini.length = 0;
  r = await gaStep(s, "77000000952", "Да, давайте", "Отлично, к Тони завтра в 15:00 можно ✂️ Как вас зовут?");
  assert.ok(net.gemini.length >= 2, r);
});
