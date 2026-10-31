// @ts-check
// Каталог сервисных сценариев S01–S18 (ТЗ Winchester v2.0 §4, v3.0, 31.10.2026): только сервисные сообщения, не маркетинг.
// mode — как сценарий работает сейчас: auto — уходит сам по журналу Altegio со второго номера (services/reminders/journal.js) после
// одобрения текста владельцем (svtpl:<клиент>, db/kv/reminders.js); reply — ответ в переписке (бот или администратор, сам не уходит);
// task — только задача администратору; off — не подключено (нет данных в Altegio или нужно решение человека). cat — рубрика в пульте.
// Тексты: ru/kk (+ en у напоминаний и отзыва) — встроенные варианты b1, b2… (ru[i], kk[i], en[i]); владелец добавляет свои варианты
// (u…) и выбирает действующий (svtpl:<клиент>:var). Одобрение — у действующего варианта и его версии: изменили текст или выбрали
// другой вариант — нужно одобрить заново. v — версия встроенных текстов: изменили их в коде — подняли v (31.10.2026: v 2, тексты
// переписаны простым языком, без тире-разделителей). Переменные: {имя} {дата} {время} {мастер} {услуга} {услуга и мастер} {адрес}
// {ссылка} {компания}; [[ … ]] — кусок пропадает, если в нём пустая переменная. Тексты коротко и без обещаний, которых нет в Altegio.
// Казахские тексты носителем не проверены.
/** @import { Client } from "../../lib/types.js" */

/**
 * @typedef {{ id: string, title: string, trigger: string, mode: "auto" | "reply" | "task" | "off", channel: string, auto?: string, cat: string,
 *   note?: string, v: number, vars: string[], ru: string[], kk: string[], en?: string[] }} Scenario
 * @typedef {{ id: string, ru: string, kk: string, en?: string, v: number, builtin: boolean, at?: number, by?: string }} Variant
 */

/** рубрики сервисных сообщений в пульте */
export const SV_CATS = [
  { id: "booking", label: "Запись" }, { id: "remind", label: "Напоминания" }, { id: "change", label: "Изменения" },
  { id: "late", label: "Опоздания и неявки" }, { id: "after", label: "После визита" }, { id: "tasks", label: "Ошибки и задачи" },
];
/** переменные, которые можно вставлять в свой текст */
export const SV_VARS = ["имя", "дата", "время", "мастер", "услуга", "услуга и мастер", "адрес", "ссылка", "компания"];

/** @type {Scenario[]} */
export const SCENARIOS = [
  { id: "S01", title: "Подтверждение новой записи", cat: "booking", auto: "s01", mode: "auto", channel: "второй номер", v: 2,
    trigger: "Запись появилась в журнале Altegio не через бота (администратор, сайт, онлайн-запись). Уходит в течение 3 часов, с 10:00 до 21:00",
    note: "Выключено. Включает владелец, текст уходит только после его одобрения",
    vars: ["имя", "дата", "время", "услуга", "мастер", "адрес"],
    ru: ["Здравствуйте[[, {имя}]]! Вы записаны в {компания} на {дата} в {время}.[[ Услуга: {услуга}.]][[ Мастер: {мастер}.]][[ Адрес: {адрес}.]] Если нужно перенести или отменить, напишите сюда."],
    kk: ["Сәлеметсіз бе[[, {имя}]]! Сіз {компания} барбершопына жазылдыңыз: {дата}, сағат {время}.[[ Қызмет: {услуга}.]][[ Шебер: {мастер}.]][[ Мекенжай: {адрес}.]] Ауыстыру немесе болдырмау керек болса, осында жазыңыз."] },
  { id: "S02", title: "Запись с сайта без WhatsApp", cat: "booking", mode: "auto", channel: "второй номер", v: 1,
    trigger: "Запись с сайта появляется в журнале Altegio, и подтверждение уходит так же, как у новой записи. На сайте клиент видит «Вы записаны», Altegio может прислать SMS",
    note: "Отдельного текста нет: используется подтверждение новой записи", vars: [], ru: [], kk: [] },
  { id: "S03", title: "Напоминание накануне", cat: "remind", auto: "d1", mode: "auto", channel: "второй номер", v: 2,
    trigger: "Накануне в 18:00, если запись сделана раньше чем за час до этого и клиент ещё не пришёл",
    vars: ["имя", "время", "услуга", "мастер"],
    ru: ["Напоминаем: завтра в {время} ждём вас в {компания}.[[ {услуга и мастер}.]] Если планы изменились, напишите сюда.",
      "Здравствуйте[[, {имя}]]! Ждём вас завтра в {время} в {компания}.[[ {услуга и мастер}.]] Если не получается прийти, напишите сюда."],
    kk: ["Еске саламыз: ертең сағат {время} {компания} барбершопында күтеміз.[[ {услуга и мастер}.]] Жоспарыңыз өзгерсе, осында жазыңыз.",
      "Сәлеметсіз бе[[, {имя}]]! Ертең сағат {время} {компания} барбершопында күтеміз.[[ {услуга и мастер}.]] Келе алмасаңыз, осында жазыңыз."],
    en: ["Reminder: we're expecting you tomorrow at {время} at {компания}.[[ {услуга и мастер}.]] If your plans change, just write here.",
      "Hello[[, {имя}]]! We're expecting you tomorrow at {время} at {компания}.[[ {услуга и мастер}.]] If you can't make it, write here."] },
  { id: "S04", title: "Напоминание за 2 часа", cat: "remind", auto: "h2", mode: "auto", channel: "второй номер", v: 2,
    trigger: "За 2 часа до записи, только с 10:00 до 21:00 и если запись сделана раньше чем за 4 часа",
    vars: ["время", "услуга", "мастер", "адрес"],
    ru: ["Ждём вас сегодня в {время} в {компания}.[[ {услуга и мастер}.]][[ Адрес: {адрес}.]] Если опаздываете или не сможете прийти, напишите сюда."],
    kk: ["Бүгін сағат {время} {компания} барбершопында күтеміз.[[ {услуга и мастер}.]][[ Мекенжай: {адрес}.]] Кешіксеңіз немесе келе алмасаңыз, осында жазыңыз."],
    en: ["We're expecting you today at {время} at {компания}.[[ {услуга и мастер}.]][[ Address: {адрес}.]] If you're running late or can't make it, write here."] },
  { id: "S05", title: "Клиент спрашивает время записи", cat: "remind", mode: "reply", channel: "переписка", v: 2,
    trigger: "Клиент спрашивает, во сколько он записан. Отвечает администратор по журналу Altegio (бот выключен)",
    vars: ["дата", "время", "услуга", "мастер"],
    ru: ["Вы записаны на {дата} в {время}.[[ {услуга и мастер}.]]"], kk: ["Сіз {дата}, сағат {время} жазылғансыз.[[ {услуга и мастер}.]]"] },
  { id: "S06", title: "Перенос подтверждён", cat: "change", auto: "s06", mode: "auto", channel: "второй номер", v: 2,
    trigger: "В Altegio изменились время, мастер или услуга записи (номер записи тот же). Старые напоминания отменяются, новые уходят по новому времени",
    note: "Сообщение о переносе уходит, только если владелец включит его и одобрит текст. Старые напоминания отменяются всегда",
    vars: ["дата", "время", "услуга", "мастер"],
    ru: ["Ваша запись в {компания} перенесена на {дата}, {время}.[[ {услуга и мастер}.]] Если что-то не так, напишите сюда."],
    kk: ["{компания} барбершопындағы жазылуыңыз ауыстырылды: {дата}, сағат {время}.[[ {услуга и мастер}.]] Бірдеңе дұрыс болмаса, осында жазыңыз."] },
  { id: "S07", title: "Отмена по просьбе клиента", cat: "change", mode: "reply", channel: "переписка", v: 2,
    trigger: "Администратор отменил запись в Altegio и отвечает клиенту (кнопка «Сделано» у просьбы)",
    vars: [], ru: ["Вашу запись отменили. Если захотите записаться снова, напишите сюда."], kk: ["Жазылуыңыз тоқтатылды. Қайта жазылғыңыз келсе, осында жазыңыз."] },
  { id: "S08", title: "Мастер не выйдет", cat: "change", mode: "off", channel: "администратор", v: 1,
    trigger: "Altegio не сообщает о болезни мастера. Администратор сам решает, кому и что предложить",
    note: "Не подключено: перенос и предложение другого мастера делает только человек", vars: [], ru: [], kk: [] },
  { id: "S09", title: "Клиент опаздывает", cat: "late", mode: "task", channel: "администратор", v: 2,
    trigger: "Клиент пишет «опаздываю». Чат попадает в «Нужен ответ», администратор предупреждает мастера",
    vars: [], ru: ["Спасибо, что предупредили! Передадим мастеру."], kk: ["Ескерткеніңізге рахмет! Шеберге жеткіземіз."] },
  { id: "S10", title: "Клиент подтвердил, что придёт", cat: "remind", mode: "reply", channel: "переписка", v: 1,
    trigger: "Клиент ответил «приду» на напоминание. В Altegio отметку ставит администратор",
    vars: [], ru: ["Отлично, ждём вас!"], kk: ["Тамаша, сізді күтеміз!"] },
  { id: "S11", title: "Клиент не пришёл", cat: "late", mode: "task", channel: "администратор", v: 1,
    trigger: "В Altegio отмечено «не пришёл». Администратору ставится задача в чате, клиенту ничего не уходит",
    vars: [], ru: [], kk: [] },
  { id: "S12", title: "Просьба об отзыве", cat: "after", auto: "rv", mode: "auto", channel: "второй номер", v: 2,
    trigger: "Через 3 часа после начала визита, только с отметкой «пришёл». Одному клиенту не чаще раза в 60 дней",
    vars: ["имя", "ссылка"],
    ru: ["Спасибо, что были у нас в {компания}! Будем рады вашему отзыву: {ссылка}\nЕсли что-то не понравилось, напишите сюда, мы разберёмся.",
      "Здравствуйте[[, {имя}]]! Спасибо за визит в {компания}. Если всё понравилось, оставьте, пожалуйста, отзыв: {ссылка}\nЕсли что-то было не так, напишите сюда."],
    kk: ["{компания} барбершопына келгеніңізге рахмет! Пікір қалдырсаңыз, қуанамыз: {ссылка}\nБірдеңе ұнамаса, осында жазыңыз, біз шешеміз.",
      "Сәлеметсіз бе[[, {имя}]]! {компания} барбершопына келгеніңізге рахмет. Бәрі ұнаса, пікір қалдырыңызшы: {ссылка}\nБірдеңе дұрыс болмаса, осында жазыңыз."],
    en: ["Thank you for visiting {компания}! We'd be grateful for a review: {ссылка}\nIf something wasn't right, write here and we'll sort it out.",
      "Hello[[, {имя}]]! Thank you for visiting {компания}. If you liked it, please leave a review: {ссылка}\nIf something wasn't right, write here."] },
  { id: "S13", title: "Благодарность после визита", cat: "after", mode: "off", channel: "второй номер", v: 1,
    trigger: "Благодарность уже есть в просьбе об отзыве. Отдельно не отправляется, чтобы не писать дважды",
    vars: [], ru: [], kk: [] },
  { id: "S14", title: "Записали двух человек", cat: "booking", mode: "auto", channel: "второй номер", v: 1,
    trigger: "У каждой записи свой номер в Altegio: подтверждения и напоминания уходят отдельно по каждой записи",
    note: "Отдельного текста нет: используются подтверждение и напоминания", vars: [], ru: [], kk: [] },
  { id: "S15", title: "Перенос в последний час", cat: "change", mode: "task", channel: "администратор", v: 1,
    trigger: "Просьба о переносе меньше чем за час до записи уходит администратору. Само ничего не переносится",
    vars: [], ru: [], kk: [] },
  { id: "S16", title: "Ошибка или конфликт в Altegio", cat: "tasks", mode: "task", channel: "администратор", v: 1,
    trigger: "Altegio отказал или не ответил. Заявка администратору и сообщение в Telegram, клиенту не пишем, что всё готово",
    vars: [], ru: [], kk: [] },
  { id: "S17", title: "Изменились часы работы", cat: "change", mode: "off", channel: "администратор", v: 1,
    trigger: "Список затронутых записей и текст готовит администратор",
    note: "Не подключено: записи выбирает человек", vars: [], ru: [], kk: [] },
  { id: "S18", title: "Сообщение не ушло", cat: "tasks", mode: "task", channel: "администратор", v: 1,
    trigger: "Green-API отказал. При временных сбоях до 3 попыток, потом задача администратору в чате и сообщение в Telegram. Если неизвестно, ушло ли, повтора нет",
    vars: [], ru: [], kk: [] },
];
/** вид в очереди → сценарий */
export const KIND_SC = /** @type {Record<string, string>} */ ({ s01: "S01", d1: "S03", h2: "S04", rv: "S12", s06: "S06" });
/** @param {string} id */
export const scenario = id => SCENARIOS.find(x => x.id === id) || null;

/** встроенные и свои варианты текста сценария. own — svtpl:<клиент>:var @param {Scenario} sc @param {Record<string, any>} [own] @returns {Variant[]} */
export function variantsOf(sc, own) {
  const builtin = sc.ru.map((ru, i) => ({ id: "b" + (i + 1), ru, kk: sc.kk[i] || sc.kk[0] || "", ...(sc.en && sc.en.length ? { en: sc.en[i] || sc.en[0] } : {}), v: sc.v, builtin: true }));
  const mine = ((own && own[sc.id] && Array.isArray(own[sc.id].list)) ? own[sc.id].list : [])
    .filter(/** @param {any} x */ x => x && /^u[a-z0-9]{2,20}$/.test(String(x.id)) && x.ru)
    .map(/** @param {any} x */ x => ({ id: String(x.id), ru: String(x.ru), kk: String(x.kk || ""), v: +x.v || 1, builtin: false, at: +x.at || 0, by: String(x.by || "") }));
  return [...builtin, ...mine];
}
/** действующий вариант (выбран владельцем; нет такого — первый встроенный) @param {Scenario} sc @param {Record<string, any>} [own] @returns {Variant | null} */
export function activeOf(sc, own) {
  const all = variantsOf(sc, own), want = own && own[sc.id] && own[sc.id].active;
  return all.find(x => x.id === want) || all[0] || null;
}
/** одобрение подходит этому варианту: тот же вариант и та же версия (одобрение до вариантов — первого встроенного)
 *  @param {any} a запись одобрения { v, at, var? } @param {Variant | null} x */
export const approvalFits = (a, x) => !!(a && x && String(a.var || "b1") === x.id && +a.v === x.v);
/** действующий вариант, если он одобрен владельцем; иначе null — сообщение не уходит
 *  @param {Scenario} sc @param {Record<string, any>} approvals @param {Record<string, any>} [own] */
export function approvedVariant(sc, approvals, own) {
  const x = activeOf(sc, own);
  return x && approvalFits(approvals && approvals[sc.id], x) ? x : null;
}

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
  const master = lang === "kk" ? "шебер" : lang === "en" ? "barber" : "мастер";
  return {
    компания: String(c.name || ""), имя: firstName(b.name), дата: dayText(b.date, lang), время: String(b.time || ""),
    услуга: String(b.services || ""), мастер: String(b.staffName || ""),
    // «Мужская стрижка, мастер Айдос» — отдельной фразой; нет услуги — «Мастер Айдос»
    "услуга и мастер": [b.services, b.staffName ? `${master} ${b.staffName}` : ""].filter(Boolean).join(", ").replace(/^\p{Ll}/u, ch => ch.toUpperCase()), адрес: addrOf(c), ссылка: String(c.review || ""),
  };
}
/** подстановка: {переменная}; [[ … ]] пропадает, если в нём пустая переменная @param {string} text @param {Record<string, string>} vars */
export function render(text, vars) {
  const sub = (/** @type {string} */ s) => s.replace(/\{([^{}]+)\}/g, (_, k) => String(vars[k] ?? ""));
  return sub(String(text).replace(/\[\[([\s\S]*?)\]\]/g, (_, part) => /\{([^{}]+)\}/.test(part) && [...part.matchAll(/\{([^{}]+)\}/g)].some(m => !String(vars[m[1]] ?? "")) ? "" : part));
}
/** текст сообщения вида k (d1, h2, rv, s01, s06) на языке чата; нет текста на этом языке — по-русски. vt — вариант текста (действующий
 *  одобренный, approvedVariant); без него — первый встроенный. → { sc, v, lang, text, variant } или null
 *  @param {Client} c @param {string} k @param {any} b @param {any} [lang] @param {Variant | null} [vt] */
export function svText(c, k, b, lang, vt) {
  const sc = scenario(KIND_SC[k] || "S12");
  if (!sc) return null;
  const x = vt || variantsOf(sc)[0];
  if (!x) return null;
  const want = lang === "kk" || lang === "en" ? lang : "ru", own = want !== "ru" ? String((/** @type {any} */ (x))[want] || "") : "";
  const use = own ? want : "ru"; // своего текста на языке чата нет — по-русски
  return { sc: sc.id, v: x.v, lang: use, variant: x.id, text: render(own || x.ru, svVars(c, b, use)) };
}
/** каталог для пульта: сценарии с рубрикой, варианты текста (какой действует, какой одобрен), предпросмотр действующего на
 *  вымышленной записи @param {Client} c @param {Record<string, any>} approvals @param {string} sampleDate @param {Record<string, any>} [own] */
export function svCatalog(c, approvals, sampleDate, own) {
  const sample = { name: "Арман", date: sampleDate, time: "15:00", services: "Мужская стрижка", staffName: "Данияр" };
  const cats = /** @type {Record<string, string>} */ (Object.fromEntries(SV_CATS.map(x => [x.id, x.label])));
  return SCENARIOS.map(x => {
    const a = approvals && approvals[x.id], act = activeOf(x, own), ok = !!(x.auto && approvalFits(a, act));
    const variants = variantsOf(x, own).map(y => ({ id: y.id, ru: y.ru, kk: y.kk, active: !!act && y.id === act.id, approved: !!x.auto && approvalFits(a, y), v: y.v, builtin: y.builtin }));
    return { id: x.id, title: x.title, cat: x.cat, catLabel: cats[x.cat] || "", trigger: x.trigger, mode: x.mode, channel: x.channel, note: x.note || "", v: act ? act.v : x.v, vars: x.vars, kind: x.auto || "",
      approved: ok, approvedAt: ok ? +a.at || 0 : 0, active: act ? act.id : "", variants,
      preview: { ru: act ? render(act.ru, svVars(c, sample, "ru")) : "", kk: act && act.kk ? render(act.kk, svVars(c, sample, "kk")) : "" } };
  });
}
