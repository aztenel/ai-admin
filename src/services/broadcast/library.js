// @ts-check
// Библиотека рекламных текстов (ТЗ Winchester v2.0 §5, v3.0 31.10.2026): 28 стартовых тем M01–M28 на русском и казахском, вставки
// данных клиента (render.js), правка владельцем с историей версий, свои тексты, копии и архив.
// Тексты — как пишет живой администратор в WhatsApp: 1–3 коротких предложения, на «вы», без выдуманного («будни спокойнее»,
// «любимое кресло свободно», «мастер скучает», «обычно вы стрижётесь раз в месяц», ненастоящий VIP). Факты — только из данных:
// дни после визита, мастер и услуга последнего визита, название, ссылка на запись, адрес. Где нужны настоящие условия (свободное
// время, акция, праздник, новая услуга, дата), в тексте [квадратные скобки] и needs: такой текст нельзя одобрить, пока владелец
// не впишет настоящее (статус «Нужны данные»).
// Одобрение — решение владельца о тексте. Одобрено не значит отправлено: запуск рассылки — отдельный шаг и отдельные запреты.
// Одному человеку реклама — не чаще раза в 30 дней (crm/segments.js), библиотека на это не влияет.
// Казахские тексты — черновик: kkChecked всегда false, пока носитель языка не проверил.
/** @import { Env, Client } from "../../lib/types.js" */
import { clean, snip } from "../../lib/text.js";
import { maskPhone } from "../../lib/phone.js";
import { libRead, libSave } from "../../db/kv/library.js";
import { VARS, cleanText, toCanonical, textIssues, render, dataFor, normName, BRACKETS_ISSUE } from "./render.js";
import { crmPick, crmSegSpec } from "../crm/segments.js";

/** @typedef {{ id: string, title: string, cat: string, seg: string, who: string, goal: string, needs: string[], check: string, ru: string, kk: string,
 *   kkChecked: boolean, custom?: boolean, archived?: boolean, approved?: boolean, approvedAt?: number, approvedBy?: string, from?: string,
 *   v?: number, at?: number, by?: string, history?: any[] }} LibItem */

export const CATS = [
  { id: "invite", label: "Приглашения" }, { id: "lapsed", label: "Давно не были" }, { id: "slots", label: "Свободное время" },
  { id: "regular", label: "Постоянные клиенты" }, { id: "services", label: "Услуги" }, { id: "occasions", label: "Поводы" }, { id: "personal", label: "Персональные" },
];
const CAT_IDS = new Set(CATS.map(x => x.id));
export const STOP_RU = "Если такие сообщения больше не нужны, напишите «стоп».";
export const STOP_KK = "Мұндай хабарламалар керек болмаса, «стоп» деп жазыңыз.";
const HI = "Здравствуйте, {{client.first_name}}! ", HI_KK = "Сәлеметсіз бе, {{client.first_name}}! ";
const URL = "{{booking.url}}";
const SLOT_CHECK = "Впишите время, которое правда свободно в Altegio прямо сейчас. Отправляйте в тот же день, пока время не заняли.";

/** @param {string} id @param {string} title @param {string} cat @param {string} seg сегмент для примера @param {string} who @param {string} goal
 *  @param {string[]} needs @param {string} check @param {string} ru @param {string} kk @returns {LibItem} */
const L = (id, title, cat, seg, who, goal, needs, check, ru, kk) => ({ id, title, cat, seg, who, goal, needs, check, ru: ru + "\n\n" + STOP_RU, kk: kk + "\n\n" + STOP_KK, kkChecked: false });

/** @type {LibItem[]} */
export const LIBRARY = [
  L("M01", "Пора обновить стрижку", "invite", "pora", "Были 21–35 дней назад", "напомнить о стрижке", [], "Дни считаются сами по дате последнего визита в Altegio.",
    HI + "С последней стрижки прошло {{visit.days_since}} дней. Если пора обновить, запишитесь на удобное время: " + URL,
    HI_KK + "Соңғы шаш алдырғаныңызға {{visit.days_since}} күн болды. Жаңартқыңыз келсе, ыңғайлы уақытқа жазылыңыз: " + URL),
  L("M02", "Давно не были (30–45 дней)", "lapsed", "davno", "Не были 30–45 дней", "вернуть клиента", [], "Выберите в сегменте дни с 30 по 45.",
    HI + "Давно вас не видели в {{company.name}}. Будем рады записать вас снова: " + URL,
    HI_KK + "Сізді {{company.name}} барбершопында көптен бері көрмедік. Қайта жазылсаңыз, қуанамыз: " + URL),
  L("M03", "Давно не были (46–60 дней)", "lapsed", "davno", "Не были 46–60 дней", "вернуть клиента к его мастеру", [], "Мастер берётся из последнего визита. Если мастер больше не работает, этот текст не подходит.",
    HI + "С вашего визита в {{company.name}} прошло {{visit.days_since}} дней. Можем записать к мастеру {{staff.name}}, как в прошлый раз: " + URL,
    HI_KK + "{{company.name}} барбершопына соңғы келгеніңізге {{visit.days_since}} күн болды. Өткен жолғыдай {{staff.name}} шеберге жазып қоюға болады: " + URL),
  L("M04", "Давно не были (61–90 дней)", "lapsed", "uhodyat", "Не были 61–90 дней", "вернуть клиента", [], "Пишите мягко и один раз. Если клиент не ответил, второй раз не напоминайте.",
    HI + "С вашего последнего визита прошло {{visit.days_since}} дней. Если захотите к нам снова, записаться можно здесь: " + URL,
    HI_KK + "Соңғы келгеніңізге {{visit.days_since}} күн болды. Қайта келгіңіз келсе, осы жерден жазылуға болады: " + URL),
  L("M05", "Постоянному клиенту", "regular", "postoyannye", "3 и больше визитов за 90 дней", "поблагодарить и пригласить", [], "Только постоянным клиентам: сегмент «Постоянные».",
    "{{client.first_name}}, спасибо, что выбираете {{company.name}}! Когда будет удобно, записаться можно здесь: " + URL,
    "{{client.first_name}}, {{company.name}} барбершопын таңдағаныңызға рахмет! Ыңғайлы кезде осы жерден жазыла аласыз: " + URL),
  L("M06", "Любимый мастер сегодня", "slots", "staff", "Клиенты мастера, у которого сегодня есть время", "запись к своему мастеру сегодня", ["slot"], SLOT_CHECK + " Выберите сегмент «Мастер: …».",
    HI + "Сегодня у мастера {{staff.name}} есть свободное время: [время]. Записать вас?",
    HI_KK + "Бүгін {{staff.name}} шеберде бос уақыт бар: [уақыт]. Жазып қояйық па?"),
  L("M07", "Любимый мастер завтра", "slots", "staff", "Клиенты мастера, у которого завтра есть время", "запись к своему мастеру завтра", ["slot"], SLOT_CHECK + " Выберите сегмент «Мастер: …».",
    HI + "Завтра у мастера {{staff.name}} есть свободное время: [время]. Записать вас?",
    HI_KK + "Ертең {{staff.name}} шеберде бос уақыт бар: [уақыт]. Жазып қояйық па?"),
  L("M08", "Свободное окно сегодня", "slots", "pora", "Кому пора на стрижку", "заполнить свободное время сегодня", ["slot"], SLOT_CHECK,
    HI + "Сегодня освободилось время: [время]. Если хотите прийти, ответьте на это сообщение или запишитесь здесь: " + URL,
    HI_KK + "Бүгін бос уақыт шықты: [уақыт]. Келгіңіз келсе, осы хабарламаға жауап беріңіз немесе осында жазылыңыз: " + URL),
  L("M09", "Свободное окно завтра", "slots", "pora", "Кому пора на стрижку", "заполнить свободное время завтра", ["slot"], SLOT_CHECK,
    HI + "На завтра есть свободное время: [время]. Записать вас?",
    HI_KK + "Ертеңге бос уақыт бар: [уақыт]. Жазып қояйық па?"),
  L("M10", "Будний день", "invite", "all", "Все, кому можно писать", "запись на будни", [], "Отправляйте в начале недели.",
    HI + "Если вам удобнее прийти в будний день, выберите время здесь: " + URL,
    HI_KK + "Жұмыс күні келу ыңғайлы болса, уақытты осы жерден таңдаңыз: " + URL),
  L("M11", "Выходные", "invite", "all", "Все, кому можно писать", "запись на выходные заранее", [], "Отправляйте в среду или четверг, не в субботу.",
    HI + "Если планируете стрижку на выходные, лучше записаться заранее: " + URL,
    HI_KK + "Демалыс күндері шаш алдырғыңыз келсе, алдын ала жазылған дұрыс: " + URL),
  L("M12", "Стрижка и борода", "services", "all", "Все, кому можно писать", "стрижка и борода за один визит", [], "Проверьте, что обе услуги есть в прайсе и у мастеров есть на них время.",
    HI + "Стрижку и оформление бороды можно сделать за один визит. Запись: " + URL,
    HI_KK + "Шаш қию мен сақал түзеуді бір келгенде жасатуға болады. Жазылу: " + URL),
  L("M13", "Моделирование бороды", "services", "all", "Все, кому можно писать", "уход за бородой", [], "Проверьте, что услуга есть в прайсе.",
    HI + "Если хотите привести бороду в форму, запишитесь на моделирование бороды: " + URL,
    HI_KK + "Сақалыңызды ретке келтіргіңіз келсе, сақал үлгілеуге жазылыңыз: " + URL),
  L("M14", "Премиальный уход", "services", "postoyannye", "Постоянные клиенты", "премиальная услуга", ["service"], "Впишите услугу точно как в прайсе.",
    HI + "Рекомендуем попробовать [услуга из прайса] в {{company.name}}. Запись: " + URL,
    HI_KK + "{{company.name}} барбершопында [прайстағы қызмет] жасатып көруді ұсынамыз. Жазылу: " + URL),
  L("M15", "Перед праздником", "occasions", "all", "Все, кому можно писать", "запись до праздника", ["holiday"], "Впишите праздник. Отправляйте за 5–7 дней до него.",
    HI + "Скоро [праздник]. Если хотите подстричься к празднику, лучше записаться заранее: " + URL,
    HI_KK + "Жақында [мереке]. Мерекеге дейін шаш алдырғыңыз келсе, алдын ала жазылған дұрыс: " + URL),
  L("M16", "После праздника", "occasions", "all", "Все, кому можно писать", "вернуть после праздников", [], "Отправляйте только в первые дни после праздников.",
    HI + "Праздники позади. Если пора обновить стрижку, запишитесь на удобное время: " + URL,
    HI_KK + "Мерекелер артта қалды. Шашты жаңартатын уақыт болса, ыңғайлы уақытқа жазылыңыз: " + URL),
  L("M17", "Возвращение после перерыва", "lapsed", "uhodyat", "Не были больше 60 дней", "мягкое приглашение", [], "Пишите один раз, без напоминаний.",
    HI + "Будем рады снова видеть вас в {{company.name}}. Записаться можно здесь: " + URL,
    HI_KK + "Сізді {{company.name}} барбершопында қайта көруге қуаныштымыз. Жазылу осында: " + URL),
  L("M18", "Следующее посещение", "regular", "pora", "Кому пора на стрижку", "записаться наперёд", [], "Подходит тем, кто ходит регулярно.",
    HI + "Чтобы не искать время в последний момент, можно записаться на следующий визит заранее: " + URL,
    HI_KK + "Соңғы сәтте уақыт іздемеу үшін келесі келуге алдын ала жазылуға болады: " + URL),
  L("M19", "Ваша дата стрижки", "personal", "pora", "Кому пора на стрижку", "личное напоминание", [], "Мастер и дни берутся из последнего визита в Altegio.",
    HI + "С вашей последней стрижки у мастера {{staff.name}} прошло {{visit.days_since}} дней. Записаться снова можно здесь: " + URL,
    HI_KK + "{{staff.name}} шеберге соңғы келгеніңізге {{visit.days_since}} күн болды. Қайта жазылу осында: " + URL),
  L("M20", "После отзыва", "occasions", "all", "Только те, кто оставил отзыв", "поблагодарить за отзыв", ["review"], "Отправляйте только тем, кто правда оставил отзыв. Впишите, где.",
    HI + "Спасибо за ваш отзыв о {{company.name}} [где: в 2ГИС или в Google]. Будем рады видеть вас снова: " + URL,
    HI_KK + "{{company.name}} туралы [қай жерде: 2ГИС немесе Google] қалдырған пікіріңізге рахмет. Сізді қайта күтеміз: " + URL),
  L("M21", "Время у мастера", "slots", "staff", "Клиенты этого мастера", "свободное время конкретного мастера", ["slot"], SLOT_CHECK + " Выберите сегмент «Мастер: …».",
    HI + "У мастера {{staff.name}} есть свободное время: [день и время]. Записать вас?",
    HI_KK + "{{staff.name}} шеберде бос уақыт бар: [күні мен уақыты]. Жазып қояйық па?"),
  L("M22", "Мастер вернулся", "regular", "staff", "Клиенты этого мастера", "клиентам вернувшегося мастера", ["date"], "Только если мастер правда снова работает. Впишите дату и выберите сегмент «Мастер: …».",
    HI + "Мастер {{staff.name}} снова принимает в {{company.name}} с [дата]. Записаться можно здесь: " + URL,
    HI_KK + "{{staff.name}} шебер [күні] бастап {{company.name}} барбершопында қайта қабылдайды. Жазылу осында: " + URL),
  L("M23", "Новая услуга", "services", "all", "Все, кому можно писать", "рассказать о новой услуге", ["service"], "Впишите услугу точно как в прайсе. Только если она уже есть в записи.",
    HI + "В {{company.name}} появилась новая услуга: [услуга]. Записаться можно здесь: " + URL,
    HI_KK + "{{company.name}} барбершопында жаңа қызмет пайда болды: [қызмет]. Жазылу осында: " + URL),
  L("M24", "Акция", "occasions", "all", "Все, кому можно писать", "настоящая акция", ["offer"], "Впишите условия и срок настоящей акции. Администраторы должны знать о ней до отправки.",
    HI + "До [дата] в {{company.name}} действует [условия акции]. Запись: " + URL,
    HI_KK + "[күні] дейін {{company.name}} барбершопында [акция шарттары]. Жазылу: " + URL),
  L("M25", "Бронь на следующую неделю", "invite", "all", "Все, кому можно писать", "записаться на неделю вперёд", [], "Отправляйте в конце недели.",
    HI + "Можно уже сейчас записаться на следующую неделю и выбрать удобный день и время: " + URL,
    HI_KK + "Келесі аптаға қазір жазылып, ыңғайлы күн мен уақытты таңдауға болады: " + URL),
  L("M26", "VIP-приглашение", "personal", "postoyannye", "Несколько клиентов, которых выбрал владелец", "личное приглашение", ["personal"], "Напишите свой текст. Не обещайте того, чего нет на самом деле.",
    "{{client.first_name}}, [ваш личный текст]. Записаться можно здесь: " + URL,
    "{{client.first_name}}, [иесінің жеке мәтіні]. Жазылу осында: " + URL),
  L("M27", "На казахском", "invite", "all", "Клиенты, которые пишут по-казахски", "пригласить на родном языке", [], "Отправляйте казахский текст. Его ещё должен проверить носитель языка.",
    HI + "Ждём вас в {{company.name}}. Записаться можно здесь: " + URL,
    HI_KK + "Сізді {{company.name}} барбершопында күтеміз. Жазылу осында: " + URL),
  L("M28", "После долгого перерыва", "lapsed", "uhodyat", "Не были больше 60 дней", "очень мягкое приглашение", [], "Пишите один раз. Если клиент не ответил, больше не пишите.",
    "{{client.first_name}}, давно не виделись. Если захотите обновить стрижку, будем рады вам: " + URL,
    "{{client.first_name}}, көптен бері көріспедік. Шашыңызды жаңартқыңыз келсе, сізге қуанамыз: " + URL),
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

/** Библиотека компании: стартовые тексты с правками владельца и свои тексты. @param {Env} env @param {Client} c */
export async function libraryOf(env, c) {
  const own = await libRead(env, c.id);
  // у стартовых тем рубрика, для кого, что проверить и какие данные нужны — всегда из кода; текст и одобрение — владельца
  const base = LIBRARY.map(x => { const o = own[x.id] || {}; return pub({ ...x, ...o, id: x.id, cat: x.cat, seg: x.seg, who: x.who, goal: x.goal, needs: x.needs, check: x.check, custom: false }); });
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
  if (!/стоп/i.test(ru)) return { ok: false, error: "Добавьте в конце, как отказаться: " + STOP_RU };
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
  /** @type {any[]} */ let people = [];
  try { people = ((await crmPick(env, c, sp.id, now, { days: sp.days, from: sp.from, to: sp.to, staff: sp.staff })) || []).slice(0, 5); } catch (e) { console.log("lib preview", String(e).slice(0, 100)); }
  const demo = !people.length, co = companyOf(c), sample = demo ? [DEMO] : people;
  const one = (/** @type {any} */ x, /** @type {any} */ name) => render(text, dataFor({ name, staff: x.staff, svc: x.svc, d: x.d }, co));
  const list = sample.map(x => { const r = one(x, x.name); return { to: x.phone ? maskPhone(x.phone) : "пример", name: normName(x.name), text: r.text, issues: r.issues }; });
  const top = one(sample[0], sample[0].name);
  return { ok: true, lang, demo, list, noName: { text: one(sample[0], "").text }, missing: top.missing, blocked: top.blocked, issues: top.issues };
}
