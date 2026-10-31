// Подстановка данных клиента в рекламный текст (services/broadcast/render.js, ТЗ Winchester v3.0, 31.10.2026): имя — единственная
// необязательная вставка (нет имени — обращение убирается без «, !»), без мастера, услуги, даты визита, ссылки или адреса текст не
// уходит, [скобки] — не вписанные условия, значения не разбираются второй раз (имя «{{booking.url}}» — просто текст), в готовом
// тексте нет { } [ ]. Имена и номера — вымышленные.
import { test } from "node:test";
import assert from "node:assert/strict";
import { render, normName, dataFor, toCanonical, textIssues, usedVars, VARS, LEGACY } from "../../src/services/broadcast/render.js";

const CO = { name: "Winchester", url: "https://winchester.kz", address: "Астана, проспект Кабанбай Батыра, 18" };
const full = (o = {}) => dataFor({ name: "Арман", staff: "Тони", svc: "Мужская стрижка", d: 28, ...o }, CO);
const N = "{{client.first_name}}";

// [шаблон, данные, ожидаемый текст, blocked, пропущенные вставки]
const CASES = [
  // имя есть
  [`Здравствуйте, ${N}!`, full(), "Здравствуйте, Арман!", false, []],
  [`${N}, добрый день!`, full(), "Арман, добрый день!", false, []],
  // имени нет: обращение убирается аккуратно
  [`Здравствуйте, ${N}!`, full({ name: "" }), "Здравствуйте!", false, []],
  [`${N}, добрый день!`, full({ name: "" }), "Добрый день!", false, []],
  [`${N}! Ждём вас.`, full({ name: "" }), "Ждём вас.", false, []],
  [`Добрый день, ${N}. Прошло {{visit.days_since}} дней.`, full({ name: null }), "Добрый день. Прошло 28 дней.", false, []],
  [`Спасибо, ${N}, что выбираете {{company.name}}!`, full({ name: "" }), "Спасибо, что выбираете Winchester!", false, []],
  [`Здравствуйте ${N}! Ждём вас`, full({ name: "" }), "Здравствуйте! Ждём вас", false, []],
  [`Привет, ${N} 👋 Как дела?`, full({ name: "" }), "Привет 👋 Как дела?", false, []],
  [`Ждём ${N} в гости`, full({ name: "" }), "Ждём в гости", false, []],
  [`Здравствуйте, ${N}!\nЖдём вас.`, full({ name: "" }), "Здравствуйте!\nЖдём вас.", false, []],
  [`Хорошо. ${N}, ждём вас!`, full({ name: "" }), "Хорошо. Ждём вас!", false, []],
  // в базе не имя — без обращения
  [`Здравствуйте, ${N}!`, full({ name: "Без имени" }), "Здравствуйте!", false, []],
  [`Здравствуйте, ${N}!`, full({ name: "Клиент" }), "Здравствуйте!", false, []],
  [`Здравствуйте, ${N}!`, full({ name: "+7 701 000 00 01" }), "Здравствуйте!", false, []],
  [`Здравствуйте, ${N}!`, full({ name: "arman@example.kz" }), "Здравствуйте!", false, []],
  [`Здравствуйте, ${N}!`, full({ name: "-" }), "Здравствуйте!", false, []],
  [`Здравствуйте, ${N}!`, full({ name: "А" }), "Здравствуйте!", false, []],
  [`Здравствуйте, ${N}!`, full({ name: "Ерлан должник" }), "Здравствуйте!", false, []],
  // двойное имя, регистр, дефис
  [`Здравствуйте, ${N}!`, full({ name: "Арман Ерланович" }), "Здравствуйте, Арман!", false, []],
  [`Здравствуйте, ${N}!`, full({ name: "Ахметова Айгерим" }), "Здравствуйте, Айгерим!", false, []],
  [`Здравствуйте, ${N}!`, full({ name: "АРМАН" }), "Здравствуйте, Арман!", false, []],
  [`Здравствуйте, ${N}!`, full({ name: "арман" }), "Здравствуйте, Арман!", false, []],
  [`Здравствуйте, ${N}!`, full({ name: "Ерлан-Али" }), "Здравствуйте, Ерлан-Али!", false, []],
  // нет мастера, услуги, ссылки, даты визита — не отправлять
  [`Записать к мастеру {{staff.name}}?`, full({ staff: "" }), "Записать к мастеру …?", true, ["staff.name"]],
  [`Как прошла {{service.name}}?`, full({ svc: null }), "Как прошла …?", true, ["service.name"]],
  [`Прошло {{visit.days_since}} дней.`, full({ d: null }), "Прошло … дней.", true, ["visit.days_since"]],
  [`Прошло {{visit.days_since}} дней.`, full({ d: "много" }), "Прошло … дней.", true, ["visit.days_since"]],
  [`Прошло {{visit.days_since}} дней.`, full({ d: 0 }), "Прошло 0 дней.", false, []],
  [`Запись: {{booking.url}}`, dataFor({ name: "Арман" }, { name: "X" }), "Запись: …", true, ["booking.url"]],
  [`Адрес: {{company.address}}.`, full(), "Адрес: Астана, проспект Кабанбай Батыра, 18.", false, []],
  // [скобки] — условия не вписаны
  [`Сегодня у мастера {{staff.name}} есть время: [время]. Записать вас?`, full(), "Сегодня у мастера Тони есть время: …. Записать вас?", true, []],
  [`До [дата] скидка`, full(), "До … скидка", true, []],
  // старые вставки
  [`{имя}, прошло {дней} дней. {мастер} ждёт: {ссылка}`, full({ name: "Арман Сейтов" }), "Арман, прошло 28 дней. Тони ждёт: https://winchester.kz", false, []],
  [`{{ имя }}, {компания} {адрес}`, full({ name: "" }), "Winchester Астана, проспект Кабанбай Батыра, 18", false, []],
  // подстановка не разбирается второй раз
  [`Здравствуйте, ${N}! Ссылка: {{booking.url}}`, full({ name: "{{booking.url}}" }), "Здравствуйте! Ссылка: https://winchester.kz", false, []],
  [`Мастер {{staff.name}}.`, full({ staff: "Тони}} {{booking.url}}" }), "Мастер Тони booking.url.", false, []],
  [`Мастер {{staff.name}}.`, full({ staff: "[время] {x}" }), "Мастер время x.", false, []],
  // неизвестная вставка и одинарные скобки — не отправлять
  [`Привет, ${N}. {{foo.bar}}`, full(), "Привет, Арман. …", true, []],
  [`Привет, {мастера}!`, full(), "Привет, …!", true, []],
  // казахский
  [`${N}, сәлеметсіз бе! {{staff.name}} шеберге жазып қояйық па?`, full({ name: "" }), "Сәлеметсіз бе! Тони шеберге жазып қояйық па?", false, []],
  [`Сәлеметсіз бе, ${N}! Соңғы келгеніңізге {{visit.days_since}} күн болды.`, full({ name: "айгерім" }), "Сәлеметсіз бе, Айгерім! Соңғы келгеніңізге 28 күн болды.", false, []],
  // управляющие символы и знаки направления текста убираются
  [`Здравствуйте,‮ ${N}!\u0007`, full(), "Здравствуйте, Арман!", false, []],
];

test(`подстановка: ${CASES.length} сочетаний (имя, не имя, регистр, нет мастера, скобки, старые вставки, повторный разбор, kk)`, () => {
  for (const [tpl, data, want, blocked, missing] of CASES) {
    const r = render(tpl, data);
    assert.equal(r.text, want, `шаблон: ${JSON.stringify(tpl)}`);
    assert.equal(r.blocked, blocked, `blocked: ${JSON.stringify(tpl)} → ${JSON.stringify(r)}`);
    assert.deepEqual(r.missing, missing, `missing: ${JSON.stringify(tpl)}`);
    assert.ok(!/[{}[\]]/.test(r.text), `в тексте нет скобок: ${r.text}`);
    assert.ok(!/,\s*[!?.]|\s{2,}|^\s|\s$|Здравствуйте, !/.test(r.text), `без «, !» и двойных пробелов: ${JSON.stringify(r.text)}`);
    if (blocked) assert.ok(r.issues.length > 0, "у заблокированного — причина");
  }
});

test("причины по-человечески: нет мастера в истории, впишите условия вместо [скобок], неизвестная вставка", () => {
  assert.deepEqual(render("Мастер {{staff.name}}", full({ staff: "" })).issues, ["Нет мастера в истории"]);
  assert.deepEqual(render("[время]", full()).issues, ["Впишите условия вместо [скобок]"]);
  assert.match(render("{{x.y}}", full()).issues[0], /^Неизвестная вставка: x\.y$/);
  assert.deepEqual(render("", full()), { text: "", missing: [], blocked: true, issues: ["Пустой текст"] });
  const long = render("а".repeat(1200), full());
  assert.equal(long.text.length, 1000); assert.equal(long.blocked, true, "обрезанный текст не отправляем");
});

test("имя: normName", () => {
  const T = { "Арман Ерланович": "Арман", "АРМАН": "Арман", "арман": "Арман", "Ерлан-Али": "Ерлан-Али", "ерлан-али": "Ерлан-Али", "Арман К.": "Арман",
    "Данияр Серикович Ахметов": "Данияр", "John": "John", "МакКартни": "МакКартни", "«Айгерим»": "Айгерим",
    "": "", "Без имени": "", "без имени": "", "Клиент": "", "Гость": "", "нет": "", "-": "", "—": "", "87010000001": "", "a@b.kz": "", "А": "", "...": "",
    "Иванов": "", "Абвгдеёжзийклмнопрстуфхцчш": "", "Тест": "", "{{booking.url}}": "", "Арман}}": "", "Не указано": "" };
  for (const [raw, want] of Object.entries(T)) assert.equal(normName(raw), want, raw);
  assert.equal(normName(null), ""); assert.equal(normName(undefined), "");
});

test("старые вставки → новые; список вставок и проблем текста", () => {
  assert.equal(toCanonical("{имя} {{ имя }} {{ Staff.Name }} {name} {мастер} {услуга} {дней} {компания} {ссылка}"),
    "{{client.first_name}} {{client.first_name}} {{staff.name}} {{client.first_name}} {{staff.name}} {{service.name}} {{visit.days_since}} {{company.name}} {{booking.url}}");
  assert.deepEqual(usedVars("{имя}, {{staff.name}} {{staff.name}}"), ["client.first_name", "staff.name"]);
  assert.deepEqual(textIssues("[x] {{a.b}} {мастера}"), ["Впишите условия вместо [скобок]", "Неизвестная вставка: a.b", "Неизвестная вставка: мастера"]);
  assert.deepEqual(textIssues("Здравствуйте, {{client.first_name}}! {{booking.url}}"), []);
  assert.deepEqual(VARS.map(x => x.label), ["Имя клиента", "Мастер", "Услуга", "Дней после визита", "Название барбершопа", "Ссылка на запись", "Адрес"]);
  for (const k of Object.values(LEGACY)) assert.ok(VARS.some(x => x.key === k), k);
});
