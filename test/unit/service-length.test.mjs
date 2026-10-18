// Помещается ли услуга во время мастера (живой показ Winchester, 18.10.2026). Журнал Тони на завтра: записи 10:00–11:00,
// 11:30–12:30, 13:00–14:00, 17:30–21:00. Бот предлагал 11:00 и 12:30 на стрижку (1 ч), 17:00 на «Отец и сын» (1 ч 30 мин) и
// говорил «16:30 свободно» на Premium (1 ч 30 мин), а «премиум» в Altegio записан латиницей. Теперь код сам считает, с какого времени
// помещается услуга каждой длительности, говорит, почему нельзя, и предлагает ближайшее время; запись на такое время не уходит в Altegio.
// Заглушка Altegio — как настоящий: без услуги — свободные начала сеткой 30 мин, с услугой — только начала, где она помещается.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, D1 } from "../harness.mjs";
import { fitStarts, askedTimes, busyFrom, nearest, gridStep } from "../../src/services/booking/fit.js";
import { altServiceWanted } from "../../src/services/booking/pick.js";
import { withDurations } from "../../src/services/booking/fit.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";
import { altDiag } from "../../src/controllers/altegio.js";

const ENV = { ALTEGIO_PARTNER: "partner-key", ALTEGIO_TRIAL_WINCHESTER: "0" }; // веб-чат с ближайшими днями (у Winchester веб-чат — пробный, следующий месяц)
const FREE = {
  31: ["11:00", "12:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00"], // Тони
  32: ["10:00", "10:30", "11:00", "11:30", "12:00", "18:00", "18:30", "19:00", "19:30", "20:00", "20:30"] // Айдос: занят 12:30–18:00
};
const SV = [
  { id: 201, title: "Мужская стрижка", category_id: 1, price_min: 7000, price_max: 7000, active: 1, seance_length: 3600 },
  { id: 202, title: "Мужская стрижка", category_id: 2, price_min: 9000, price_max: 9000, active: 1, seance_length: 3600 },
  { id: 203, title: "Комплекс «Отец и сын»", category_id: 1, price_min: 10000, price_max: 10000, active: 1, seance_length: 5400 },
  { id: 204, title: "Комплекс «Отец и сын»", category_id: 2, price_min: 14000, price_max: 14000, active: 1, seance_length: 5400 },
  { id: 205, title: "Комплекс «Premium»", category_id: 1, price_min: 12000, price_max: 12000, active: 1, seance_length: 5400 },
  { id: 206, title: "Комплекс «Premium»", category_id: 2, price_min: 13000, price_max: 13000, active: 1, seance_length: 5400 },
  { id: 207, title: "Моделирование бороды", category_id: 1, price_min: 4500, price_max: 4500, active: 1, seance_length: 1800 }];
const CHEF = new Set(["202", "204", "206"]), LEN = Object.fromEntries(SV.map(x => [String(x.id), x.seance_length / 60]));
const W = {
  services: SV, category: [{ id: 1, title: "Барберы" }, { id: 2, title: "Шеф-барбер" }],
  staff: [{ id: 31, name: "Тони", bookable: true, specialization: "шеф-барбер" }, { id: 32, name: "Айдос", bookable: true, specialization: "барбер" }],
  dates: [D1], times: {},
  timesFor: (staff, date, sids) => {
    const who = staff === "0" ? ["31", "32"] : [staff];
    const lists = who.map(id => {
      const free = FREE[id] || [];
      if (!sids.length) return free;
      if (sids.some(s => CHEF.has(s) !== (id === "31"))) return null; // эту услугу мастер не оказывает
      return fitStarts(free, Math.max(...sids.map(s => LEN[s])), 30);
    });
    if (staff !== "0" && lists[0] === null) return { error: 422 };
    return [...new Set(lists.filter(Boolean).flat())].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  }
};
const prompt = () => JSON.stringify(net.gemini.at(-1));

test("помощники: сетка, помещается ли, с какого времени занято, ближайшее, время из сообщения", () => {
  assert.equal(gridStep([FREE[31]]), 30);
  assert.deepEqual(fitStarts(FREE[31], 90, 30), ["14:00", "14:30", "15:00", "15:30", "16:00"]);
  assert.deepEqual(fitStarts(FREE[31], 60, 30), ["14:00", "14:30", "15:00", "15:30", "16:00", "16:30"]);
  assert.equal(busyFrom(FREE[31], "16:30", 30), "17:30");
  assert.deepEqual(nearest(fitStarts(FREE[31], 90, 30), "16:30", 2), ["15:30", "16:00"]);
  for (const [t, want] of [["премиум в 16 30", "16:30"], ["в 12 30 запишу на отец и сын", "12:30"], ["16.30", "16:30"], ["в 5 вечера", "17:00"], ["в 17ч к нему", "17:00"], ["есть время завтра в 12?", "12:00"]])
    assert.deepEqual(askedTimes(t), [want], t);
  for (const t of ["19.10 можно?", "2 человека", "стоит 14 000 тг", "на 2 часа", "мне 25 лет"]) assert.deepEqual(askedTimes(t), [], t);
});

test("услуга узнаётся по-русски и латиницей, без слова «комплекс»; считается последняя названная", () => {
  const base = [{ id: 1, title: "Мужская стрижка" }, { id: 2, title: "Комплекс «Premium»" }, { id: 3, title: "Комплекс «Отец и сын»" }];
  assert.deepEqual(altServiceWanted(base, "премиум в 16 30").map(x => x.id), [2]);
  assert.deepEqual(altServiceWanted(base, "отец и сын стрижка").map(x => x.id), [3]);
  assert.deepEqual(altServiceWanted(base, "сколько стоит мужская стрижка \n а теперь premium").map(x => x.id), [2]);
});

test("Premium к Тони на 16:30: не помещается — в 17:30 занято, ближайшее 15:30 или 16:00", async () => {
  net.reset(); net.altData = () => W;
  const s = mk(ENV);
  await s.chat("winchester", "fit-1", "премиум к тони завтра в 16 30", ["Подскажу."]);
  const p = prompt(); net.altData = null;
  assert.ok(/1 ч 30 мин — нельзя: в 17:30 у мастера уже занято; ближайшее подходящее — 15:30 или 16:00/.test(p), p.slice(p.indexOf("Проверка длительности"), p.indexOf("Проверка длительности") + 1500));
  assert.ok(/1 ч — можно/.test(p), "на часовую стрижку 16:30 подходит");
});

test("стрижка у Тони: 11:00 и 12:30 не предлагаются (через полчаса — запись), 17:00 — тоже", async () => {
  net.reset(); net.altData = () => W;
  const s = mk(ENV);
  await s.chat("winchester", "fit-2", "у Тони завтра в 12 свободно?", ["Подскажу."]);
  const p = prompt(); net.altData = null;
  const line = (p.match(/· 1 ч \(Мужская стрижка.*?\)\): ([^\\]+)/) || [])[1] || "";
  assert.equal(line, "14:00, 14:30, 15:00, 15:30, 16:00, 16:30", p.slice(p.indexOf("Проверка длительности"), p.indexOf("Проверка длительности") + 900));
  assert.ok(/12:00, [^.]*1 ч — нельзя: в 12:00 мастер уже занят; ближайшее подходящее — 14:00/.test(p), "в 12 у Тони занято — ближайшее 14:00");
});

test("мастер не назван: «Отец и сын» в 17:00 — ни у одного мастера не помещается, ближайшее — 16:00 или 18:00", async () => {
  net.reset(); net.altData = () => W;
  const s = mk(ENV);
  await s.chat("winchester", "fit-3", "можно завтра в 17 на отец и сын?", ["Подскажу."]);
  const p = prompt(); net.altData = null;
  assert.ok(/1 ч 30 мин — нельзя: ни у одного мастера не помещается; ближайшее подходящее — 16:00 или 18:00/.test(p), p.slice(p.indexOf("Клиент назвал"), p.indexOf("Клиент назвал") + 600));
});

test("запись Premium к Тони на 16:30 не уходит в Altegio: бот говорит, что не поместится, и предлагает ближайшее", async () => {
  net.reset(); net.altData = () => W;
  const s = mk(ENV);
  const r = await s.chat("winchester", "fit-4", "запишите на премиум к Тони завтра в 16:30, Азамат, +7 701 123 45 67",
    [`Записала вас.\n[ЗАЯВКА] Имя: Азамат; Телефон: +77011234567; Услуга: Комплекс «Premium» (Шеф-барбер); Мастер: Тони; Дата: ${D1}; Время: 16:30`]);
  net.altData = null;
  assert.ok(/На 16:30 не получится: услуга идёт 1 ч 30 мин, а дальше у мастера Тони уже занято\. Ближайшее подходящее время: 15:00, 15:30, 16:00/.test(r.reply), r.reply);
  assert.ok(!net.alt.some(x => /^POST /.test(x)), "в Altegio ничего не отправлено: " + net.alt.filter(x => /^POST /.test(x)).join(" | "));
});

test("запись Premium к Тони на 16:00 проходит проверку длительности", async () => {
  net.reset(); net.altData = () => W;
  const s = mk(ENV);
  const r = await s.chat("winchester", "fit-5", "запишите на премиум к Тони завтра в 16:00, Азамат, +7 701 123 45 67",
    [`Записала вас.\n[ЗАЯВКА] Имя: Азамат; Телефон: +77011234567; Услуга: Комплекс «Premium» (Шеф-барбер); Мастер: Тони; Дата: ${D1}; Время: 16:00`]);
  net.altData = null;
  assert.ok(!/не получится/.test(r.reply), r.reply);
  assert.ok(net.alt.some(x => /^POST \/book_record\//.test(x)), "запись в Altegio создана (у Winchester с 19.10.2026 запись настоящая): " + net.alt.join(" | "));
});

test("ИИ назвал «16:30 свободно» на Premium — ответ переписывается; не исправил — бот отвечает сам с ближайшим временем", async () => {
  net.reset(); net.altData = () => W;
  const s = mk(ENV);
  const r = await s.chat("winchester", "fit-6", "премиум к тони завтра в 16 30 можно?",
    ["Да, завтра у Тони в 16:30 свободно! Как вас зовут?", "Да, в 16:30 можно записаться."]);
  net.altData = null;
  assert.ok(/На 16:30 не получится: услуга идёт 1 ч 30 мин, а дальше у мастера Тони уже занято\. Ближайшее подходящее время: 15:30, 16:00/.test(r.reply), r.reply);
  assert.ok(/время 16:30: услуга «Комплекс «Premium»/.test(JSON.stringify(net.gemini.at(-1))), "второй запрос к ИИ объясняет, почему нельзя");
});

test("ИИ отвечает правильно («16:30 не поместится, можно в 16:00») — ответ не трогается", async () => {
  net.reset(); net.altData = () => W;
  const s = mk(ENV);
  const r = await s.chat("winchester", "fit-7", "премиум к тони завтра в 16 30 можно?",
    ["Premium идёт 1 ч 30 мин, в 16:30 не поместится — дальше у мастера занято. Можно в 16:00 или в 15:30. Как вас зовут?"]);
  net.altData = null;
  assert.ok(/в 16:30 не поместится/.test(r.reply) && /16:00/.test(r.reply), r.reply);
  assert.equal(net.gemini.length, 1, "ИИ спрошен один раз");
});

test("«на стрижку» без точного названия — проверяется как «Мужская стрижка»: 12:30 у Тони не предлагается, бот называет услугу", async () => {
  net.reset(); net.altData = () => W;
  const s = mk(ENV);
  const r = await s.chat("winchester", "fit-8", "хочу на стрижку к тони завтра в 12:30",
    ["Да, завтра у Тони в 12:30 свободно! Как вас зовут?", "Да, 12:30 подходит, записать?"]);
  net.altData = null;
  assert.ok(/считай, что это «Мужская стрижка» \(1 ч\)/.test(JSON.stringify(net.gemini[0])), "ИИ знает, какую услугу предполагать");
  assert.equal(r.reply, "На 12:30 не получится: «Мужская стрижка» идёт 1 ч, а дальше у мастера Тони уже занято. Ближайшее подходящее время: 14:00, 14:30. Какое подойдёт?");
});

test("«постричься» и время без услуги — тоже стрижка; «борода» (30 мин) в 12:30 — можно, ответ не трогается", async () => {
  for (const [id, text] of [["fit-9", "можно постричься у тони завтра в 11?"], ["fit-10", "у тони завтра в 11 свободно?"]]) {
    net.reset(); net.altData = () => W;
    const r = await mk(ENV).chat("winchester", id, text, ["Да, в 11:00 у Тони свободно.", "Да, в 11:00 можно."]);
    net.altData = null;
    assert.ok(/^На 11:00 не получится: «Мужская стрижка» идёт 1 ч/.test(r.reply), text + " → " + r.reply);
  }
  net.reset(); net.altData = () => W;
  const r = await mk(ENV).chat("winchester", "fit-11", "бороду поправить у тони завтра в 12:30 можно?", ["Да, в 12:30 у Тони можно, моделирование бороды идёт 30 минут. Как вас зовут?"]);
  net.altData = null;
  assert.ok(/^Да, в 12:30 у Тони можно/.test(r.reply), r.reply);
  assert.equal(net.gemini.length, 1, "ИИ спрошен один раз");
});

// Живая проверка 18.10.2026 21:30 после e54cc5b: «к тони на завтра премиум» → «с 14:00 до 16:30»; «в 16:30 запишите» → «в 16:30 у Тони
// свободно». Длительность из Altegio не та (Premium как стрижка — 1 ч) или не приходит совсем — код считал Premium часовой услугой.
// Теперь длительность — из кода (altegio.durations у Winchester), Altegio — только где у мастера занято.
for (const [name, bad] of [["в Altegio у Premium 1 ч", x => x.id === 205 || x.id === 206 ? { ...x, seance_length: 3600 } : x], ["Altegio длительность не присылает", ({ seance_length, ...x }) => x]]) {
  test(`${name}: «премиум к Тони на завтра» — без 16:30; «в 16:30 запишите» — не получится, ближайшее 15:30 или 16:00`, async () => {
    net.reset(); const W2 = { ...W, services: SV.map(bad) }; net.altData = () => W2;
    const s = mk(ENV);
    await s.chat("winchester", "fit-live", "привет", ["Здравствуйте! Чем могу помочь?"]);
    const r1 = await s.chat("winchester", "fit-live", "к тони на завтра премиум",
      ["Комплекс «Premium» у Тони стоит 13 000 ₸ и занимает 1 ч 30 мин. Завтра у Тони есть свободное время с 14:00 до 16:30 ✂️ Какое время вам удобно?",
       "Комплекс «Premium» у Тони стоит 13 000 ₸ и занимает 1 ч 30 мин. Завтра у Тони можно начать с 14:00 до 16:00 ✂️ Какое время вам удобно?"]);
    assert.ok(/1 ч 30 мин \(Комплекс «Отец и сын».*?Premium.*?\)\): 14:00, 14:30, 15:00, 15:30, 16:00(?!,)/.test(JSON.stringify(net.gemini.at(-1))), "в подсказке Premium — 1 ч 30 мин");
    assert.ok(/с 14:00 до 16:00/.test(r1.reply), r1.reply);
    const r2 = await s.chat("winchester", "fit-live", "в 16:30 запишмте пожалуйста",
      ["Завтра, в понедельник, в 16:30 у Тони свободно ✂️ Комплекс «Premium» занимает 1 ч 30 мин. На чьё имя оформить запись?",
       "Завтра в 16:30 у Тони свободно. На чьё имя оформить запись?"]);
    net.altData = null;
    assert.equal(r2.reply, "На 16:30 не получится: услуга идёт 1 ч 30 мин, а дальше у мастера Тони уже занято. Ближайшее подходящее время: 15:30, 16:00. Какое подойдёт?");
  });
}

test("длительность из кода: каждая услуга Winchester узнаётся по названию из Altegio; чего нет в таблице — как в Altegio", () => {
  const T = CLIENTS.winchester.altegio.durations;
  const want = { "Комплекс «Premium» (Шеф-барбер)": 90, "Премиум": 90, "Мужская стрижка (Барберы)": 60, "Детская стрижка": 30, "Моделирование бороды": 30,
    "Комплекс «Отец и сын»": 90, "Химическая завивка": 60, "Перманентная укладка Down perm": 30, "Камуфляж седины Kondor": 30, "Камуфляж бороды Kondor": 30,
    "Окантовка + укладка": 30, "SPA-процедура для лица": 30, "Восковое удаление лишних волос": 5, "Глиняная маска": 15, "Черная маска": 15, "Перкуссионный массаж": 10, "Стрижка машинкой": 45 };
  for (const [title, m] of Object.entries(want)) assert.equal(withDurations([{ title, minutes: 45 }], T)[0].minutes, m, title);
});

test("/altegio: длительность из кода и из Altegio, время мастера по длительностям — как считает бот", async () => {
  net.reset(); const W2 = { ...W, services: SV.map(x => x.id === 206 ? { ...x, seance_length: 3600 } : x) }; net.altData = () => W2;
  const out = await altDiag(mk(ENV).env, "winchester", "", "");
  net.altData = null;
  assert.ok(/Комплекс «Premium» \(Шеф-барбер\) — от 13 000 ₸, 1 ч 30 мин \(из кода; в Altegio — 1 ч\)/.test(out), out);
  assert.ok(/Тони: свободные начала — 11:00, 12:30, 14:00/.test(out) && /· 1 ч 30 мин \([^\n]*Premium[^\n]*\): 14:00, 14:30, 15:00, 15:30, 16:00\n/.test(out), out);
});
