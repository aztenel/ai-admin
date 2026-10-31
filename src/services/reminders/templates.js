// @ts-check
// Каталог сервисных сценариев S01–S18 (ТЗ Winchester v2.0 §4, 31.10.2026): только сервисные сообщения, не маркетинг.
// mode — как сценарий работает сейчас: auto — уходит сам по журналу Altegio со второго номера (services/reminders/journal.js) после
// одобрения текста владельцем (svtpl:<клиент>, db/kv/reminders.js); reply — ответ в переписке (бот или администратор, сам не уходит);
// task — только задача администратору; off — не подключено (нет данных в Altegio или нужно решение человека).
// Тексты: ru/kk (+ en у старых напоминаний), по несколько вариантов; v — версия: изменили текст — подняли v, прежнее одобрение
// к новой версии не подходит. Переменные: {имя} {дата} {время} {мастер} {услуга} {услуга и мастер} {адрес} {ссылка} {компания};
// [[ … ]] — кусок пропадает, если в нём пустая переменная. Тексты коротко и без обещаний, которых нет в Altegio.
// Казахские тексты носителем не проверены.
/** @import { Client } from "../../lib/types.js" */

/**
 * @typedef {{ id: string, title: string, trigger: string, mode: "auto" | "reply" | "task" | "off", channel: string, auto?: string,
 *   note?: string, v: number, vars: string[], ru: string[], kk: string[], en?: string[] }} Scenario
 */

/** @type {Scenario[]} */
export const SCENARIOS = [
  { id: "S01", title: "Новая запись — подтверждение", auto: "s01", mode: "auto", channel: "второй номер", v: 1,
    trigger: "Запись появилась в журнале Altegio не через бота (администратор, сайт, онлайн-запись) — в течение 3 часов, с 10:00 до 21:00",
    note: "Выключено: включает владелец, текст — после его одобрения",
    vars: ["имя", "дата", "время", "услуга и мастер", "адрес"],
    ru: ["Здравствуйте[[, {имя}]]! Вы записаны в «{компания}» на {дата} в {время}[[ — {услуга и мастер}]].[[ Адрес: {адрес}.]] Если нужно перенести или отменить — напишите сюда."],
    kk: ["Сәлеметсіз бе[[, {имя}]]! Сіз «{компания}» барбершопына {дата} сағат {время}-ге жазылдыңыз[[ — {услуга и мастер}]].[[ Мекенжай: {адрес}.]] Ауыстыру не болдырмау керек болса, осында жазыңыз."] },
  { id: "S02", title: "Запись с сайта без WhatsApp", mode: "auto", channel: "второй номер", v: 1,
    trigger: "Запись с сайта winchester.kz появляется в журнале Altegio — подтверждение уходит как S01; на сайте клиент видит «Вы записаны», Altegio может прислать SMS",
    note: "Отдельного текста нет — через S01", vars: [], ru: [], kk: [] },
  { id: "S03", title: "Напоминание накануне", auto: "d1", mode: "auto", channel: "второй номер", v: 1,
    trigger: "Накануне в 18:00, если запись сделана раньше чем за час до этого; клиент ещё не пришёл",
    vars: ["время", "услуга и мастер"],
    ru: ["Напоминаем: завтра в {время} вас ждут в «{компания}»[[ — {услуга и мастер}]]. Если планы изменились, напишите сюда."],
    kk: ["Еске салу: «{компания}» сізді ертең сағат {время}-де күтеді[[ — {услуга и мастер}]]. Жоспарыңыз өзгерсе, осында жазыңыз."],
    en: ["Reminder: «{компания}» is expecting you tomorrow at {время}[[ — {услуга и мастер}]]. If your plans change, just write here."] },
  { id: "S04", title: "Напоминание за 2 часа", auto: "h2", mode: "auto", channel: "второй номер", v: 1,
    trigger: "За 2 часа до записи, только с 10:00 до 21:00 и если запись сделана раньше чем за 4 часа",
    vars: ["время", "услуга и мастер", "адрес"],
    ru: ["Ждём вас сегодня в {время} в «{компания}»[[ ({услуга и мастер})]].[[ Адрес: {адрес}.]] Если опаздываете или не сможете прийти — напишите сюда."],
    kk: ["«{компания}» сізді бүгін сағат {время}-де күтеді[[ ({услуга и мастер})]].[[ Мекенжай: {адрес}.]] Кешіксеңіз немесе келе алмасаңыз, осында жазыңыз."],
    en: ["We're expecting you today at {время} at «{компания}»[[ ({услуга и мастер})]].[[ Address: {адрес}.]] If you're running late or can't make it, write here."] },
  { id: "S05", title: "«Напомните моё время»", mode: "reply", channel: "переписка", v: 1,
    trigger: "Клиент спрашивает, во сколько он записан: отвечает администратор по журналу Altegio (бот выключен)",
    vars: ["дата", "время", "услуга и мастер"],
    ru: ["Вы записаны на {дата} в {время}[[ — {услуга и мастер}]]."], kk: ["Сіз {дата} сағат {время}-ге жазылғансыз[[ — {услуга и мастер}]]."] },
  { id: "S06", title: "Перенос подтверждён", auto: "s06", mode: "auto", channel: "второй номер", v: 1,
    trigger: "Время, мастер или услуга записи изменились в Altegio (тот же номер записи): старые напоминания отменяются, новые — по новому времени",
    note: "Отдельное сообщение «перенесли» — только если владелец включит и одобрит текст; старые напоминания отменяются всегда",
    vars: ["дата", "время", "услуга и мастер"],
    ru: ["Ваша запись в «{компания}» перенесена: {дата} в {время}[[ — {услуга и мастер}]]. Если что-то не так — напишите сюда."],
    kk: ["«{компания}» жазылуыңыз ауыстырылды: {дата} сағат {время}[[ — {услуга и мастер}]]. Бірдеңе дұрыс болмаса, осында жазыңыз."] },
  { id: "S07", title: "Отмена по просьбе клиента", mode: "reply", channel: "переписка", v: 1,
    trigger: "Администратор отменил запись в Altegio и отвечает клиенту (кнопка «Сделано» у просьбы)",
    vars: [], ru: ["Вашу запись отменили. Если захотите записаться снова — напишите."], kk: ["Жазылуыңыз болдырылмады. Қайта жазылғыңыз келсе, жазыңыз."] },
  { id: "S08", title: "Мастер не выйдет", mode: "off", channel: "администратор", v: 1,
    trigger: "Altegio не сообщает о болезни мастера: администратор сам решает, кому и что предложить",
    note: "Не подключено: сам перенос и предложение другого мастера — только человек", vars: [], ru: [], kk: [] },
  { id: "S09", title: "Клиент опаздывает", mode: "task", channel: "администратор", v: 1,
    trigger: "Клиент пишет «опаздываю» — чат в «Нужен ответ», администратор предупреждает мастера",
    vars: [], ru: ["Спасибо, что предупредили! Передали мастеру."], kk: ["Ескерткеніңізге рахмет! Шеберге жеткіздік."] },
  { id: "S10", title: "Клиент подтвердил, что придёт", mode: "reply", channel: "переписка", v: 1,
    trigger: "Клиент ответил «приду» на напоминание; в Altegio отметка не ставится — это делает администратор",
    vars: [], ru: ["Отлично, ждём вас!"], kk: ["Тамаша, сізді күтеміз!"] },
  { id: "S11", title: "Клиент не пришёл", mode: "task", channel: "администратор", v: 1,
    trigger: "В Altegio отмечено «не пришёл» — задача администратору в чате, клиенту ничего не уходит",
    vars: [], ru: [], kk: [] },
  { id: "S12", title: "Просьба об отзыве", auto: "rv", mode: "auto", channel: "второй номер", v: 1,
    trigger: "Через 3 часа после начала визита, только с отметкой «пришёл»; одному клиенту — не чаще раза в 60 дней",
    vars: ["ссылка"],
    ru: ["Спасибо, что были у нас в «{компания}»! Будем благодарны за отзыв: {ссылка}\nЕсли что-то не понравилось — напишите сюда, передадим администратору."],
    kk: ["Бізге келгеніңізге рахмет! «{компания}» туралы пікір қалдырсаңыз, қуанамыз: {ссылка}\nБірдеңе ұнамаса, осында жазыңыз — әкімшіге жеткіземіз."],
    en: ["Thank you for visiting «{компания}»! We'd be grateful for a review: {ссылка}\nIf something wasn't right, write here and we'll pass it to the administrator."] },
  { id: "S13", title: "Благодарность после визита", mode: "off", channel: "второй номер", v: 1,
    trigger: "Благодарность уже в тексте просьбы об отзыве (S12) — отдельно не отправляется, чтобы не писать дважды",
    vars: [], ru: [], kk: [] },
  { id: "S14", title: "Записали двух человек", mode: "auto", channel: "второй номер", v: 1,
    trigger: "У каждой записи свой номер в Altegio: подтверждения и напоминания — отдельно по каждой записи",
    note: "Отдельного текста нет — через S01, S03, S04", vars: [], ru: [], kk: [] },
  { id: "S15", title: "Перенос в последний час", mode: "task", channel: "администратор", v: 1,
    trigger: "Просьба о переносе меньше чем за час до записи — администратору; само ничего не переносится",
    vars: [], ru: [], kk: [] },
  { id: "S16", title: "Ошибка или конфликт в Altegio", mode: "task", channel: "администратор", v: 1,
    trigger: "Altegio отказал или не ответил — заявка администратору и Telegram; клиенту не пишем, что всё готово",
    vars: [], ru: [], kk: [] },
  { id: "S17", title: "Изменились часы работы", mode: "off", channel: "администратор", v: 1,
    trigger: "Список затронутых записей и текст готовит администратор",
    note: "Не подключено: нужен выбор записей человеком", vars: [], ru: [], kk: [] },
  { id: "S18", title: "Сообщение не ушло", mode: "task", channel: "администратор", v: 1,
    trigger: "Green-API отказал: до 3 попыток при временных сбоях, потом задача администратору в чате и Telegram; «неизвестно, ушло ли» — без повтора",
    vars: [], ru: [], kk: [] },
];
/** вид в очереди → сценарий */
export const KIND_SC = /** @type {Record<string, string>} */ ({ s01: "S01", d1: "S03", h2: "S04", rv: "S12", s06: "S06" });
/** @param {string} id */
export const scenario = id => SCENARIOS.find(x => x.id === id) || null;

const MONTHS = {
  ru: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
  kk: ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};
/** «2026-10-20» → «20 октября» / «20 қазан» / «October 20». @param {string} iso @param {string} lang */
export function dayText(iso, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return "";
  const d = +m[3], mo = (/** @type {any} */ (MONTHS))[lang] || MONTHS.ru, name = mo[+m[2] - 1];
  return lang === "en" ? `${name} ${d}` : `${d} ${name}`;
}
/** имя для обращения — первое слово, только буквы (из Altegio бывает «Арман К.», «89771», «клиент»). @param {any} n */
export function firstName(n) {
  const w = String(n || "").trim().split(/\s+/)[0] || "";
  return /^[\p{L}-]{2,30}$/u.test(w) && !/^(клиент|гость|client)$/i.test(w) ? w : "";
}
/** адрес компании: из паспорта или блока сайта @param {Client} c */
export const addrOf = c => String((c && (c.address || (c.site && c.site.address))) || "");

/** переменные сообщения о записи. b — { name, date, time, services, staffName } @param {Client} c @param {any} b @param {string} lang */
export function svVars(c, b, lang) {
  b = b || {};
  return {
    компания: String(c.name || ""), имя: firstName(b.name), дата: dayText(b.date, lang), время: String(b.time || ""),
    услуга: String(b.services || ""), мастер: String(b.staffName || ""),
    "услуга и мастер": [b.services, b.staffName].filter(Boolean).join(" · "), адрес: addrOf(c), ссылка: String(c.review || ""),
  };
}
/** подстановка: {переменная}; [[ … ]] пропадает, если в нём пустая переменная @param {string} text @param {Record<string, string>} vars */
export function render(text, vars) {
  const sub = (/** @type {string} */ s) => s.replace(/\{([^{}]+)\}/g, (_, k) => String(vars[k] ?? ""));
  return sub(String(text).replace(/\[\[([\s\S]*?)\]\]/g, (_, part) => /\{([^{}]+)\}/.test(part) && [...part.matchAll(/\{([^{}]+)\}/g)].some(m => !String(vars[m[1]] ?? "")) ? "" : part));
}
/** текст сообщения вида k (d1, h2, rv, s01, s06) на языке чата; нет текста на этом языке — по-русски.
 *  → { sc, v, lang, text } или null @param {Client} c @param {string} k @param {any} b @param {any} [lang] @param {number} [variant] */
export function svText(c, k, b, lang, variant = 0) {
  const sc = scenario(KIND_SC[k] || "S12");
  if (!sc) return null;
  const want = lang === "kk" || lang === "en" ? lang : "ru", list = (/** @type {any} */ (sc))[want] && (/** @type {any} */ (sc))[want].length ? (/** @type {any} */ (sc))[want] : sc.ru;
  const use = list === sc.ru ? "ru" : want;
  if (!list.length) return null;
  return { sc: sc.id, v: sc.v, lang: use, text: render(list[Math.min(variant, list.length - 1)], svVars(c, b, use)) };
}
/** каталог для пульта: сценарии, одобрение текущей версии, предпросмотр на вымышленной записи @param {Client} c @param {Record<string, any>} approvals @param {string} sampleDate */
export function svCatalog(c, approvals, sampleDate) {
  const sample = { name: "Арман", date: sampleDate, time: "15:00", services: "Мужская стрижка", staffName: "Мастер" };
  return SCENARIOS.map(x => {
    const a = approvals && approvals[x.id], ok = !!(a && +a.v === x.v);
    return { id: x.id, title: x.title, trigger: x.trigger, mode: x.mode, channel: x.channel, note: x.note || "", v: x.v, vars: x.vars, kind: x.auto || "",
      approved: x.auto ? ok : false, approvedAt: ok ? +a.at || 0 : 0, variants: { ru: x.ru.length, kk: x.kk.length },
      preview: { ru: x.ru.length ? render(x.ru[0], svVars(c, sample, "ru")) : "", kk: x.kk.length ? render(x.kk[0], svVars(c, sample, "kk")) : "" } };
  });
}
