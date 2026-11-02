// @ts-check
// Библиотека рекламных текстов второго номера Winchester (финальное ТЗ рассылок, 02.11.2026): 28 текстов в 7 категориях — утверждённая
// владельцем редакция, слово в слово (W01–W28). Переменных в текстах нет: имя добавляет система при подготовке отправки
// (render.js → greetName: «Добрый день! 👋🏻» → «Добрый день, Азамат! 👋🏻»), без имени — приветствие как есть. Тексты одобрены
// владельцем заранее; правка владельцем — новая версия, её одобряют заново. Свои тексты, копии и архив — как раньше.
// Тексты лежат в коде, в хранилище — только правки владельца по номеру текста: повторная выкладка дублей не создаёт. Правки прежних
// тем M01–M28 (до 02.11.2026) не показываются: тех тем больше нет. Тексты называют Winchester — у других компаний стартовых текстов нет.
// Строки «стоп» в утверждённых текстах нет: добавить её к рассылке — выбор владельца в мастере (create.js, STOP_RU), и тогда она
// видна в предпросмотре. Одобрение — решение о тексте; одобрено не значит отправлено: запуск — отдельный шаг и отдельные запреты.
/** @import { Env, Client } from "../../lib/types.js" */
import { clean, snip } from "../../lib/text.js";
import { maskPhone } from "../../lib/phone.js";
import { libRead, libSave } from "../../db/kv/library.js";
import { VARS, cleanText, toCanonical, textIssues, render, dataFor, normName, BRACKETS_ISSUE } from "./render.js";
import { crmSegSpec, crmView, crmPeople, crmWhyText } from "../crm/segments.js";

/** @typedef {{ id: string, title: string, cat: string, seg: string, who: string, goal: string, needs: string[], check: string, ru: string, kk: string,
 *   kkChecked: boolean, custom?: boolean, archived?: boolean, approved?: boolean, approvedAt?: number, approvedBy?: string, from?: string,
 *   v?: number, at?: number, by?: string, history?: any[] }} LibItem */

export const CATS = [
  { id: "warm", label: "Тёплое возвращение", seg: "all", who: "Все клиенты базы" },
  { id: "refresh", label: "Пора обновить стрижку", seg: "pora", who: "Были 21–35 дней назад" },
  { id: "lapsed", label: "Давно не виделись", seg: "davno", who: "Не были больше месяца" },
  { id: "regular", label: "Постоянные клиенты", seg: "postoyannye", who: "3 визита и больше за 90 дней" },
  { id: "first", label: "После первого визита", seg: "novye", who: "Были один раз" },
  { id: "occasions", label: "Поводы заглянуть", seg: "all", who: "Все клиенты базы" },
  { id: "style", label: "Стиль и настроение", seg: "all", who: "Все клиенты базы" },
];
const CAT_IDS = new Set(CATS.map(x => x.id));
export const STOP_RU = "Если такие сообщения больше не нужны, напишите «стоп».";
export const STOP_KK = "Мұндай хабарламалар керек болмаса, «стоп» деп жазыңыз.";
// утверждённая редакция: одобрена владельцем в ТЗ 02.11.2026
export const APPROVED_AT = Date.UTC(2026, 10, 2, 12), APPROVED_BY = "Владелец (утверждённая редакция)";

/** @param {string} id @param {string} title @param {string} cat @param {string} ru @returns {LibItem} */
const T = (id, title, cat, ru) => { const k = /** @type {any} */ (CATS.find(x => x.id === cat));
  return { id, title, cat, seg: k.seg, who: k.who, goal: k.label, needs: [], check: "", ru, kk: "", kkChecked: false, approved: true, approvedAt: APPROVED_AT, approvedBy: APPROVED_BY }; };

/** @type {LibItem[]} */
export const LIBRARY = [
  // Тёплое возвращение
  T("W01", "Знакомые лица", "warm", "Добрый день! 👋🏻\n\nWinchester работает с 2019 года, и за это время у нас появилось много знакомых гостей. Всегда приятно видеть вас снова 🖤✂️\n\nЕсли захотите освежить стрижку, будем рады помочь с записью 😊"),
  T("W02", "Свои люди", "warm", "Здравствуйте! 🤝\n\nВ Winchester особенно приятно встречать знакомых гостей. Хороший барбершоп для нас не только про стрижку, но и про атмосферу, в которую хочется возвращаться 💈🖤\n\nБудем рады новой встрече! Подобрать вам удобное время? 😊"),
  T("W03", "Рады видеть снова", "warm", "Добрый день! 👋🏻\n\nИногда для хорошего настроения достаточно свежей стрижки и немного времени для себя ✂️😎\n\nЕсли захотите обновить образ, заглядывайте в Winchester. Поможем с записью! 💈"),
  T("W04", "Без лишних поводов", "warm", "Здравствуйте! 😊\n\nДля хорошей стрижки не нужен особенный повод. Иногда просто хочется выглядеть аккуратно и чувствовать себя увереннее 😎✂️\n\nКогда будет такое настроение, заглядывайте к нам. Подберём удобное время! 🖤"),
  // Пора обновить стрижку
  T("W05", "Стрижка уже отросла?", "refresh", "Добрый день! 👋🏻\n\nВолосы растут незаметно, а свежая стрижка сразу меняет впечатление 😏✂️\n\nЕсли уже задумывались освежить образ, будем рады видеть вас в Winchester. Записать на удобное время? 💈"),
  T("W06", "Свежий образ", "refresh", "Здравствуйте! 💈\n\nЗнакомое ощущение, когда выходишь из барбершопа со свежей стрижкой и всё снова выглядит как надо 😎🔥\n\nМожет, пора повторить? Поможем подобрать удобное время в Winchester! ✂️"),
  T("W07", "Порядок в деталях", "refresh", "Добрый день! 👋🏻\n\nАккуратная стрижка делает весь образ собраннее. Иногда достаточно одного визита, чтобы снова выглядеть отлично ✂️🖤\n\nЕсли хочется освежиться, будем рады помочь. Записать вас? 😊"),
  T("W08", "Хорошее чувство", "refresh", "Здравствуйте! 🤝\n\nЗнакомое чувство, когда после барбершопа смотришь в зеркало и думаешь: «Вот теперь отлично!» 😎💈\n\nБудем рады видеть вас снова. Подобрать удобное время для стрижки? ✂️"),
  // Давно не виделись
  T("W09", "Давно не виделись", "lapsed", "Добрый день! 👋🏻\n\nДавно не виделись в Winchester! Надеемся, у вас всё отлично 😊🖤\n\nЕсли захотите обновить стрижку или просто уделить немного времени себе, будем рады новой встрече. Помочь с записью? 💈"),
  T("W10", "Помним наших гостей", "lapsed", "Здравствуйте! 🤝\n\nЗа годы работы Winchester мы поняли одну вещь: особенно приятно, когда к нам возвращаются знакомые гости 🖤✂️\n\nБудем рады снова видеть вас в кресле нашего барбера. Когда вам было бы удобно заглянуть? 😊"),
  T("W11", "Пора освежиться", "lapsed", "Добрый день! 👋🏻\n\nВ повседневных делах легко забыть уделить время себе. А свежая стрижка отлично помогает немного переключиться 😎💈\n\nЕсли давно собирались к барберу, будем рады вас видеть в Winchester! ✂️"),
  T("W12", "Двери открыты", "lapsed", "Здравствуйте! 😊\n\nWinchester работает с 2019 года. За это время многое изменилось, но одно осталось прежним: мы всегда рады нашим гостям 🖤💈\n\nЕсли захотите снова заглянуть на стрижку, просто напишите. Подберём удобное время! ✂️"),
  // Постоянные клиенты
  T("W13", "Ваш привычный ритм", "regular", "Добрый день! 👋🏻\n\nХорошая стрижка со временем становится приятной привычкой. Особенно когда нашёл своего барбера и знаешь, какого результата ждать 💈🖤\n\nБудем рады вашей следующей записи. Подобрать время? 😊"),
  T("W14", "Знакомое кресло", "regular", "Здравствуйте! 😎\n\nИногда приятно просто прийти в знакомое место, довериться своему мастеру и выйти со свежей стрижкой ✂️💈\n\nВ Winchester всегда рады вашему возвращению. Когда вам удобно заглянуть? 🤝"),
  T("W15", "Стиль в порядке", "regular", "Добрый день! 👋🏻\n\nУхоженный образ складывается из мелочей. А регулярная стрижка помогает поддерживать его без лишних усилий 😎🔥\n\nЕсли хотите записаться на следующую стрижку в Winchester, напишите нам. Подберём время! ✂️"),
  T("W16", "Хорошие традиции", "regular", "Здравствуйте! 🤝\n\nУ каждого есть свои хорошие привычки. Найти время для себя и привести стрижку в порядок тоже одна из них 🖤💈\n\nБудем рады новой встрече в Winchester. Помочь с записью? 😊✂️"),
  // После первого визита
  T("W17", "Как вам у нас?", "first", "Добрый день! 👋🏻\n\nСпасибо, что однажды выбрали Winchester! Надеемся, после стрижки у вас остались хорошие впечатления 😊💈\n\nЕсли захотите заглянуть снова, будем рады новой встрече. С удовольствием поможем с записью! 🖤"),
  T("W18", "Продолжим знакомство", "first", "Здравствуйте! 🤝\n\nПервый визит в барбершоп это только начало. Хочется, чтобы вы нашли место, куда приятно возвращаться за хорошей стрижкой ✂️🖤\n\nБудем рады снова видеть вас в Winchester. Подобрать удобное время? 😊"),
  T("W19", "Ваш следующий образ", "first", "Добрый день! 👋🏻\n\nПосле первой стрижки можно сохранить понравившийся образ или попробовать что-нибудь новое 😎🔥\n\nНаши мастера с удовольствием помогут с обоими вариантами. Хотите записаться в Winchester? 💈"),
  T("W20", "Будем рады снова", "first", "Здравствуйте! 😊\n\nРады, что вы уже знакомы с Winchester! Мы стараемся, чтобы после каждого визита оставались не только аккуратная стрижка, но и хорошее настроение 🖤✂️\n\nЕсли захотите прийти снова, напишите нам. Подберём удобное время! 💈"),
  // Поводы заглянуть
  T("W21", "Начало недели", "occasions", "Добрый день! 👋🏻\n\nНовая неделя, новые планы. Хороший повод привести в порядок не только дела, но и свой образ 😎✂️\n\nЕсли планировали освежить стрижку, будем рады видеть вас в Winchester. Подобрать время? 💈"),
  T("W22", "Перед выходными", "occasions", "Здравствуйте! 🔥\n\nВыходные приятнее встречать, когда и настроение, и стрижка на высоте 😎💈\n\nЕсли собирались заглянуть к барберу, будем рады вас видеть. Помочь с записью? ✂️"),
  T("W23", "Осеннее обновление", "occasions", "Добрый день! 🍂\n\nСмена сезона отличный повод немного обновить привычный образ. Иногда достаточно свежей стрижки, чтобы почувствовать перемены 😎✂️\n\nМастера Winchester будут рады вас видеть. Записать на удобное время? 🖤"),
  T("W24", "Перед важными планами", "occasions", "Здравствуйте! 👋🏻\n\nВстреча, мероприятие или просто насыщенная неделя. Гораздо приятнее, когда знаешь, что выглядишь отлично 😎💈\n\nЕсли хотите заранее освежить стрижку, будем рады помочь в Winchester! ✂️🖤"),
  // Стиль и настроение
  T("W25", "Маленькое обновление", "style", "Добрый день! 👋🏻\n\nНе обязательно кардинально менять образ, чтобы выглядеть по-новому. Иногда достаточно просто освежить привычную стрижку ✂️😎\n\nВ Winchester с удовольствием поможем. Подобрать время для визита? 🖤"),
  T("W26", "Время для себя", "style", "Здравствуйте! 😊\n\nМежду работой и повседневными делами важно находить немного времени для себя. Стрижка у хорошего барбера отличный способ переключиться 💈🖤\n\nБудем рады вас видеть в Winchester. Помочь с записью? ✂️"),
  T("W27", "Уверенность в деталях", "style", "Добрый день! 🤝\n\nКогда стрижка аккуратная, даже привычный образ выглядит иначе. Небольшая деталь, которую замечаешь и сам, и окружающие 😎🔥\n\nЕсли захотите обновиться, мастера Winchester будут рады помочь. Подобрать время? 💈"),
  T("W28", "Особенное отношение", "style", "Здравствуйте! 👋🏻\n\nWinchester работает с 2019 года. И всё это время для нас важно одно: чтобы каждый гость чувствовал себя желанным и уходил довольным 🖤💈\n\nЕсли захотите снова доверить нам свою стрижку, будем очень рады. Записать вас? 😊✂️"),
];
const BASE = new Map(LIBRARY.map(x => [x.id, x]));
const BRACKET = /[[\]]/;
const CUSTOM_MAX = 150;

/** ссылка на запись: своя (bookingUrl, site.url) или первый https-адрес сайта компании; нет — "" (вставка не сработает) @param {Client} c */
export const bookingUrl = c => String((c && (c.bookingUrl || (c.site && c.site.url))) || ((c && c.site && c.site.origins) || []).find(/** @param {string} o */ o => /^https:\/\//.test(o)) || "");
/** данные компании для вставок @param {Client} c */
export const companyOf = c => ({ name: String((c && c.name) || ""), url: bookingUrl(c), address: String((c && (c.address || (c.site && c.site.address))) || "") });
/** вставки для чипов редактора: примеры — данные этой компании @param {Client} c */
export function varsOf(c) {
  const co = companyOf(c), own = /** @type {Record<string, string>} */ ({ "company.name": co.name, "booking.url": co.url, "company.address": co.address });
  return VARS.map(x => ({ ...x, sample: own[x.key] || x.sample }));
}

/** статус текста: approved — одобрен владельцем; facts — нужны настоящие данные ([скобки]); review — ждёт решения владельца @param {LibItem} x */
const statusOf = x => x.approved ? "approved" : BRACKET.test(x.ru) || BRACKET.test(x.kk || "") ? "facts" : "review";
/** @param {LibItem} x */
function pub(x) {
  const ru = toCanonical(x.ru), kk = toCanonical(x.kk || ""), facts = BRACKET.test(ru) || BRACKET.test(kk);
  const item = { ...x, ru, kk, kkChecked: false, approved: !!x.approved && !facts, archived: !!x.archived, custom: !!x.custom, v: +(x.v || 1), at: +(x.at || 0), by: String(x.by || ""),
    needs: Array.isArray(x.needs) ? x.needs : [], history: (x.history || []).slice(-5) };
  return { ...item, status: statusOf(item) };
}

/** стартовые тексты компании: утверждённые тексты называют Winchester — другим компаниям их не показываем @param {Client} c @returns {LibItem[]} */
export const baseOf = c => c && (c.id === "winchester" || /** @type {any} */ (c).brand === "winchester") ? LIBRARY : [];
/** Библиотека компании: стартовые тексты с правками владельца и свои тексты. @param {Env} env @param {Client} c */
export async function libraryOf(env, c) {
  const own = await libRead(env, c.id);
  // у стартовых тем рубрика, для кого, что проверить и какие данные нужны — всегда из кода; текст и одобрение — владельца
  const base = baseOf(c).map(x => { const o = own[x.id] || {}; return pub({ ...x, ...o, id: x.id, cat: x.cat, seg: x.seg, who: x.who, goal: x.goal, needs: x.needs, check: x.check, custom: false }); });
  const custom = Object.values(own).filter(x => x && x.custom && !BASE.has(x.id)).map(x => pub(/** @type {LibItem} */ (x)));
  return [...base, ...custom];
}
/** числа для шапки: всего (без архива), одобрено, ждёт проверки (вместе с «нужны данные»), нужны данные, в архиве @param {any[]} items */
export function libCounts(items) {
  const live = items.filter(x => !x.archived);
  return { total: live.length, approved: live.filter(x => x.status === "approved").length, review: live.filter(x => x.status !== "approved").length,
    facts: live.filter(x => x.status === "facts").length, archived: items.length - live.length };
}

/**
 * Правка или новый текст (только владелец — проверяет контроллер). Старые вставки ({имя}) переводятся в новые. Изменили текст
 * одобренного — одобрение снимается. Одобрить нельзя, пока в тексте [скобки] или неизвестная вставка.
 * @param {Env} env @param {Client} c @param {any} b { id?, title, ru, kk, cat?, who?, goal?, check?, approved? } @param {string} who @param {number} now
 * @returns {Promise<{ ok: true, item: any } | { ok: false, error: string }>}
 */
export async function librarySave(env, c, b, who, now) {
  const own = await libRead(env, c.id), all = await libraryOf(env, c);
  const id = b.id ? String(b.id).slice(0, 16) : "U" + now.toString(36).toUpperCase();
  const cur = all.find(x => x.id === id);
  if (b.id && !cur) return { ok: false, error: "Такого текста нет." };
  if (!cur && Object.values(own).filter(x => x && x.custom).length >= CUSTOM_MAX) return { ok: false, error: "Своих текстов слишком много. Уберите лишние в архив и используйте копии." };
  const ru = cleanText(toCanonical(b.ru ?? (cur ? cur.ru : "")), 1000), kk = cleanText(toCanonical(b.kk ?? (cur ? cur.kk : "")), 1000);
  const title = clean(String(b.title ?? (cur ? cur.title : "")), 80);
  if (!ru || !title) return { ok: false, error: "Нужны название и текст на русском." };
  const bad = [...textIssues(ru), ...(kk ? textIssues(kk) : [])].filter(x => x !== BRACKETS_ISSUE);
  if (bad.length) return { ok: false, error: bad[0] + ". Вставки добавляйте кнопками над полем." };
  const changed = !cur || ru !== cur.ru || kk !== cur.kk;
  const approved = b.approved === true ? true : b.approved === false ? false : changed ? false : !!(cur && cur.approved);
  if (approved && (BRACKET.test(ru) || BRACKET.test(kk))) return { ok: false, error: "Сначала впишите настоящие данные вместо [скобок], потом одобряйте." };
  const was = own[id] || {}, v0 = cur ? cur.v : 0, v = changed ? v0 + 1 : v0 || 1;
  const custom = !cur || cur.custom;
  /** @type {LibItem} */
  const item = { ...(cur || {}), ...was, id, title, ru, kk, kkChecked: false, approved, v, at: now, by: snip(who, 32), custom, archived: !!(cur && cur.archived),
    cat: custom ? (CAT_IDS.has(String(b.cat ?? (cur && cur.cat))) ? String(b.cat ?? (cur && cur.cat)) : "personal") : String(cur && cur.cat),
    who: custom ? clean(String(b.who ?? (cur ? cur.who : "")), 80) : String(cur && cur.who), goal: clean(String(b.goal ?? (cur ? cur.goal : "")), 120),
    check: custom ? clean(String(b.check ?? (cur ? cur.check : "")), 200) : String(cur && cur.check), seg: String((cur && cur.seg) || "all"),
    needs: custom ? (cur ? cur.needs : []) : [],
    history: [...(was.history || []), ...(cur && changed ? [{ v: cur.v, at: cur.at || 0, by: cur.by || "", ru: cur.ru, kk: cur.kk, approved: !!cur.approved }] : [])].slice(-10) };
  if (approved && !(cur && cur.approved && !changed)) { item.approvedAt = now; item.approvedBy = snip(who, 32); }
  if (!approved) { delete item.approvedAt; delete item.approvedBy; }
  // у стартовых тем рубрику и прочее берём из кода — в хранилище только текст, одобрение и история
  const { status, ...keep } = /** @type {any} */ (item);
  if (!custom) for (const k of ["cat", "who", "check", "needs", "seg", "kkChecked"]) delete keep[k];
  await libSave(env, c.id, { ...own, [id]: keep });
  return { ok: true, item: pub(item) };
}

/**
 * Копия, архив и возврат из архива (только владелец). Копия — свой текст с тем же содержанием, не одобрен.
 * @param {Env} env @param {Client} c @param {any} b { id, action: "duplicate" | "archive" | "restore" } @param {string} who @param {number} now
 * @returns {Promise<{ ok: true, item: any } | { ok: false, error: string, status?: number }>}
 */
export async function libraryAction(env, c, b, who, now) {
  const own = await libRead(env, c.id), all = await libraryOf(env, c), id = String(b.id || "").slice(0, 16), cur = all.find(x => x.id === id);
  if (!cur) return { ok: false, error: "Такого текста нет.", status: 404 };
  if (b.action === "duplicate") {
    if (Object.values(own).filter(x => x && x.custom).length >= CUSTOM_MAX) return { ok: false, error: "Своих текстов слишком много. Уберите лишние в архив." };
    const nid = "U" + now.toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
    /** @type {LibItem} */
    const item = { id: nid, title: snip(cur.title + " (копия)", 80), cat: cur.cat, seg: cur.seg, who: cur.who, goal: cur.goal, needs: cur.needs, check: cur.check,
      ru: cur.ru, kk: cur.kk, kkChecked: false, custom: true, approved: false, archived: false, v: 1, at: now, by: snip(who, 32), from: cur.id, history: [] };
    await libSave(env, c.id, { ...own, [nid]: item });
    return { ok: true, item: pub(item) };
  }
  if (b.action === "archive" || b.action === "restore") {
    const archived = b.action === "archive", was = own[id] || {};
    await libSave(env, c.id, { ...own, [id]: { ...was, id, archived, at: now, by: snip(who, 32) } });
    return { ok: true, item: pub({ ...cur, archived, at: now, by: snip(who, 32) }) };
  }
  return { ok: false, error: "Неизвестное действие.", status: 400 };
}

// вымышленный клиент для примера, когда в сегменте нет никого с согласием (или базы нет)
export const DEMO = { phone: "", name: "Арман", staff: "Данияр", svc: "Мужская стрижка", d: 28 };
/**
 * Пример текста на 3–5 клиентах сегмента с согласием (номера маской) или на вымышленном клиенте; noName — тот же текст без имени.
 * @param {Env} env @param {Client} c @param {any} b { id?, text?, lang, segment? } @param {number} now
 * @returns {Promise<{ ok: true, lang: string, demo: boolean, list: { to: string, name: string, text: string, issues: string[] }[], noName: { text: string }, missing: string[], blocked: boolean, issues: string[] } | { ok: false, error: string, status: number }>}
 */
export async function libraryPreview(env, c, b, now) {
  const lang = b.lang === "kk" ? "kk" : "ru";
  const item = b.id ? (await libraryOf(env, c)).find(x => x.id === String(b.id).slice(0, 16)) : null;
  if (b.id && !item) return { ok: false, error: "Такого текста нет.", status: 404 };
  const own = b.text != null && String(b.text).trim() ? b.text : "";
  const text = cleanText(toCanonical(own || (item ? (lang === "kk" && item.kk) || item.ru : "")), 1000);
  if (!text) return { ok: false, error: "Нет текста.", status: 400 };
  let sp = crmSegSpec(b.segment || (item && item.seg !== "staff" ? item.seg : "all"));
  if (sp.errors.length) sp = crmSegSpec("all");
  // пример — на клиентах сегмента, и на тех, кому реклама сейчас не уйдёт (нет согласия, был недавно): у каждого — уйдёт ли и почему
  // (02.11.2026: при нуле согласий предпросмотр был только на вымышленном клиенте). Сначала — те, кому уйдёт. Отказавшихся («стоп»,
  // запрет, отказ от рекламы) в примере нет: их имя в рекламном тексте не показываем (в списке клиентов они видны со статусом)
  /** @type {any[]} */ let people = [];
  try {
    const all = (crmPeople(await crmView(env, c, now), sp.id, { days: sp.days, from: sp.from, to: sp.to, staff: sp.staff }) || []).filter(x => !x.st.stopped && !x.st.refused);
    people = [...all.filter(x => !x.why), ...all.filter(x => x.why)].slice(0, 5);
  }
  catch (e) { console.log("lib preview", String(e).slice(0, 100)); }
  const demo = !people.length, co = companyOf(c), sample = demo ? [DEMO] : people;
  const one = (/** @type {any} */ x, /** @type {any} */ name) => render(text, dataFor({ name, staff: x.staff, svc: x.svc, d: x.d }, co));
  const list = sample.map(x => { const r = one(x, x.name); return { to: x.phone ? maskPhone(x.phone) : "пример", name: normName(x.name), text: r.text, issues: r.issues,
    ...(demo ? {} : { allowed: !x.why, why: crmWhyText(x) }) }; });
  const top = one(sample[0], sample[0].name);
  return { ok: true, lang, demo, list, noName: { text: one(sample[0], "").text }, missing: top.missing, blocked: top.blocked, issues: top.issues };
}
