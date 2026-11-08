// Демо «Автоматических сообщений» (часть демо-данных раздела «Рассылки», data/demo-campaigns.ts): одиннадцать сценариев, как у сервера
// (src/services/automsg/catalog.js), тексты — как встроенные на сервере (src/services/reminders/templates.js). Всё выключено.
// «Демо Барбер» — как Winchester: второй номер, журнал Altegio, реклама со второго номера закрыта (запрет снимает только решение
// владельца). Проверка на свой номер в демо не уходит — показываем текст, который пришёл бы. Номера и клиенты вымышленные.
// Правила и тексты ошибок повторяют сервер, чтобы пульт вёл себя одинаково.
import type { AutoMessages, AutoMsgAudience, AutoMsgField, AutoMsgLogItem, AutoMsgPatch, AutoMsgScenario, AutoMsgTestResult } from "@/model/campaigns";
import type { Role } from "@/model/types";
import { ApiError } from "./errors";

type Def = { id: string; group: "service" | "marketing"; title: string; kind: string; who: string; def: Record<string, string | number>; fields: AutoMsgField[]; ru?: string; kk?: string; vars?: string[] };

const STOP_RU = "Если такие сообщения больше не нужны, напишите «стоп».";
const STOP_KK = "Мұндай хабарламалар керек болмаса, «стоп» деп жазыңыз.";
const MK_VARS = ["client.first_name", "staff.name", "service.name", "visit.days_since", "company.name", "booking.url", "company.address"];
const DEFS: Def[] = [
  { id: "confirm", group: "service", title: "Подтверждение записи", kind: "s01", def: { delay: 0 },
    who: "Клиенту, которого записали в Altegio: администратор, сайт, онлайн-запись. Кроме записей через бота в переписке.",
    fields: [{ key: "delay", label: "Через сколько минут после записи (0 — сразу)", kind: "minutes", min: 0, max: 60, step: 5 }],
    vars: ["имя", "дата", "время", "услуга", "мастер", "адрес"],
    ru: "Здравствуйте[[, {имя}]]! Вы записаны в {компания} на {дата} в {время}.[[ Услуга: {услуга}.]][[ Мастер: {мастер}.]][[ Адрес: {адрес}.]] Если нужно перенести или отменить, напишите сюда.",
    kk: "Сәлеметсіз бе[[, {имя}]]! Сіз {компания} барбершопына жазылдыңыз: {дата}, сағат {время}.[[ Қызмет: {услуга}.]][[ Шебер: {мастер}.]][[ Мекенжай: {адрес}.]] Ауыстыру немесе болдырмау керек болса, осында жазыңыз." },
  { id: "remind24", group: "service", title: "Напоминание за 24 часа", kind: "d1", def: { mode: "24h", eve: "18:00" },
    who: "Каждому клиенту с записью на завтра, если он записался раньше чем за сутки.",
    fields: [
      { key: "mode", label: "Когда", kind: "choice", options: [{ v: "24h", label: "За 24 часа до визита" }, { v: "eve", label: "Накануне в выбранное время" }] },
      { key: "eve", label: "Время накануне", kind: "time", when: { key: "mode", is: "eve" } },
    ],
    vars: ["имя", "время", "услуга", "мастер"],
    ru: "Напоминаем: завтра в {время} ждём вас в {компания}.[[ {услуга и мастер}.]] Если планы изменились, напишите сюда.",
    kk: "Еске саламыз: ертең сағат {время} {компания} барбершопында күтеміз.[[ {услуга и мастер}.]] Жоспарыңыз өзгерсе, осында жазыңыз." },
  { id: "remind3", group: "service", title: "Напоминание за 3 часа", kind: "h2", def: { hours: 3 }, who: "Каждому клиенту в день визита, если он записался заранее.",
    fields: [{ key: "hours", label: "За сколько часов до визита", kind: "hours", min: 1, max: 6 }],
    vars: ["время", "услуга", "мастер", "адрес"],
    ru: "Ждём вас сегодня в {время} в {компания}.[[ {услуга и мастер}.]][[ Адрес: {адрес}.]] Если опаздываете или не сможете прийти, напишите сюда.",
    kk: "Бүгін сағат {время} {компания} барбершопында күтеміз.[[ {услуга и мастер}.]][[ Мекенжай: {адрес}.]] Кешіксеңіз немесе келе алмасаңыз, осында жазыңыз." },
  { id: "move", group: "service", title: "Перенос записи", kind: "s06", def: {}, fields: [], who: "Клиенту, у которого в Altegio изменили время, мастера или услугу записи.",
    vars: ["дата", "время", "услуга", "мастер"],
    ru: "Ваша запись в {компания} перенесена на {дата}, {время}.[[ {услуга и мастер}.]] Если что-то не так, напишите сюда.",
    kk: "{компания} барбершопындағы жазылуыңыз ауыстырылды: {дата}, сағат {время}.[[ {услуга и мастер}.]] Бірдеңе дұрыс болмаса, осында жазыңыз." },
  { id: "cancel", group: "service", title: "Отмена записи", kind: "cx", def: {}, fields: [], who: "Клиенту, чью будущую запись удалили в Altegio.",
    vars: ["имя", "дата", "время", "услуга", "мастер"],
    ru: "Здравствуйте[[, {имя}]]! Ваша запись в {компания} на {дата} в {время} отменена.[[ {услуга и мастер}.]] Если захотите записаться снова, напишите сюда.",
    kk: "Сәлеметсіз бе[[, {имя}]]! {компания} барбершопындағы {дата}, сағат {время} жазылуыңыз тоқтатылды.[[ {услуга и мастер}.]] Қайта жазылғыңыз келсе, осында жазыңыз." },
  { id: "review", group: "service", title: "Благодарность за визит и отзыв", kind: "rv", def: { hours: 1, gap: 0 },
    who: "Клиенту, у которого в Altegio отмечено «пришёл»: благодарность, «Контроль качества» Altegio и отзыв в 2ГИС. Без рекламы.",
    fields: [{ key: "hours", label: "Через сколько часов после окончания визита (0 — сразу)", kind: "hours", min: 0, max: 24 },
      { key: "gap", label: "Одному клиенту не чаще раза в … дней (0 — после каждого визита)", kind: "days", min: 0, max: 90 }],
    vars: ["имя", "мастер", "услуга", "оценка", "площадка", "ссылка"],
    ru: "[[{имя}, ]]благодарим за визит!\n[[Ваш мастер {мастер} порадуется отзыву о своей работе\n]][[Услуга: {услуга}\n]][[\nКонтроль качества: {оценка}]][[\n{площадка}: {ссылка}]]",
    kk: "[[{имя}, ]]келгеніңізге рахмет!\n[[Шеберіңіз {мастер} жұмысы туралы пікіріңізге қуанады\n]][[Қызмет: {услуга}\n]][[\nСапаны бақылау: {оценка}]][[\n{площадка}: {ссылка}]]" },
  { id: "bonusIn", group: "service", title: "Начислено бонусов", kind: "bi", def: {}, fields: [],
    who: "Клиенту, которому Altegio начислил бонусы на карту лояльности за визит. Нужно право «Лояльность» у сотрудника, чей ключ журнала в системе.",
    vars: ["сколько", "баланс"], ru: "Начислено бонусов: {сколько}[[\nДоступно: {баланс}]]", kk: "Бонус есептелді: {сколько}[[\nҚолжетімді: {баланс}]]" },
  { id: "bonusOut", group: "service", title: "Списано бонусов", kind: "bo", def: {}, fields: [],
    who: "Клиенту, который оплатил визит бонусами с карты лояльности Altegio.",
    vars: ["сколько", "баланс"], ru: "Списано бонусов: {сколько}.[[\nИтоговый баланс: {баланс}.]]", kk: "Бонус есептен шығарылды: {сколько}.[[\nҚорытынды баланс: {баланс}.]]" },
  { id: "birthday", group: "marketing", title: "Поздравление с днём рождения", kind: "bd", def: { time: "11:00" },
    who: "Клиентам из Altegio, у кого сегодня день рождения, если они дали подтверждённое согласие на рекламу. Раз в год.",
    fields: [{ key: "time", label: "Во сколько отправлять", kind: "time" }], vars: MK_VARS,
    ru: `{{client.first_name}}, с днём рождения! Желаем вам хорошего года. Будем рады видеть вас в {{company.name}}.\n\n${STOP_RU}`,
    kk: `{{client.first_name}}, туған күніңіз құтты болсын! Сізге жақсы жыл тілейміз. Сізді {{company.name}} барбершопында көргенге қуаныштымыз.\n\n${STOP_KK}` },
  { id: "reactivate", group: "marketing", title: "Реактивация клиентов", kind: "ra", def: { days: 45, time: "12:00", cap: 20 },
    who: "Клиентам, которые не были выбранное число дней и не записаны, если они дали подтверждённое согласие на рекламу.",
    fields: [
      { key: "days", label: "Сколько дней не были", kind: "days", min: 21, max: 90 },
      { key: "time", label: "Во сколько отправлять", kind: "time" },
      { key: "cap", label: "Не больше сообщений в день", kind: "count", min: 1, max: 50 },
    ],
    vars: MK_VARS,
    ru: `Здравствуйте, {{client.first_name}}! Давно вас не видели в {{company.name}}. Будем рады записать вас снова: {{booking.url}}\n\n${STOP_RU}`,
    kk: `Сәлеметсіз бе, {{client.first_name}}! Сізді {{company.name}} барбершопында көптен бері көрмедік. Қайта жазылсаңыз, қуанамыз: {{booking.url}}\n\n${STOP_KK}` },
  { id: "campaigns", group: "marketing", title: "Маркетинговые кампании", kind: "", def: {}, fields: [],
    who: "Рассылки по базе клиентов со второго номера: черновик и проверка — в «Маркетинге», только тем, кто дал согласие на рекламу." },
];
const SV_VARS = ["имя", "дата", "время", "мастер", "услуга", "услуга и мастер", "адрес", "ссылка", "площадка", "компания", "детали", "оценка", "сколько", "баланс"];
const MK_LOCK = "Реклама со второго номера выключена: массовые сообщения с обычного WhatsApp — главная причина блокировок. Включает владелец отдельным решением.";
const CAMP_LOCK = "Запуск рассылок со второго номера выключен. Его включает владелец отдельным решением. Черновики, одобрение и проверка на ваш номер — в «Маркетинге».";
const NO_JR = "У компании нет автоматических сообщений по журналу Altegio.";
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms + Math.random() * 120));

/** Когда уходит — словами (как timingText сервера). */
function timingText(id: string, t: Record<string, string | number>, w: { from: number; to: number }): string {
  const win = `с ${w.from}:00 до ${w.to}:00`;
  switch (id) {
    case "confirm": return `${+t.delay ? `Через ${t.delay} мин после записи` : "Сразу после записи, в течение 1–2 минут"}, ${win}. Не позже чем за час до визита.`;
    case "remind24": return t.mode === "eve" ? `Накануне визита в ${t.eve}.` : `За 24 часа до визита. Если это время раньше ${w.from}:00 или позже ${w.to}:00 — в ближайшее время отправки накануне.`;
    case "remind3": return `За ${t.hours} ч до визита, если это время ${win}.`;
    case "move": return `В течение 15 минут после переноса в Altegio, ${win}. Если запись меняют несколько раз подряд — одно сообщение с последним временем.`;
    case "cancel": return `В течение 15 минут после отмены в Altegio, ${win}. Только о будущих записях.`;
    case "review": return `${+t.hours ? `Через ${t.hours} ч после окончания визита` : "Сразу после окончания визита"}, когда в Altegio стоит «пришёл» (ждём до 3 часов), ${win}. Позже — утром следующего дня. ${+t.gap ? `Одному клиенту — не чаще раза в ${t.gap} дн.` : "После каждого визита."}`;
    case "bonusIn": case "bonusOut": return `В течение 1–2 минут после оплаты визита в Altegio, ${win}. Позже — утром следующего дня.`;
    case "birthday": return `В день рождения в ${t.time}.`;
    case "reactivate": return `Через ${t.days} дней после последнего визита, в ${t.time}. Не больше ${t.cap} сообщений в день.`;
    default: return "Когда владелец запустит рассылку.";
  }
}
/** Что не так со значением поля ("" — годится): как fieldBad сервера. */
function fieldBad(f: AutoMsgField, v: unknown): string {
  if (f.kind === "time") return HM.test(String(v ?? "")) ? "" : `${f.label}: время вида 11:00.`;
  if (f.kind === "choice") return (f.options || []).some((o) => o.v === String(v)) ? "" : `${f.label}: выберите из списка.`;
  const n = Number(v);
  if (!Number.isInteger(n) || n < (f.min ?? 0) || n > (f.max ?? 1e6)) return `${f.label}: целое число от ${f.min} до ${f.max}.`;
  if (f.step && n % f.step) return `${f.label}: число, кратное ${f.step}.`;
  return "";
}
/** Подстановка, как у сервера: {переменная}; [[ … ]] пропадает, если в нём пустая переменная. */
function svRender(text: string, vars: Record<string, string>): string {
  const sub = (s: string) => s.replace(/\{([^{}]+)\}/g, (_, k: string) => vars[k] ?? "");
  return sub(text.replace(/\[\[([\s\S]*?)\]\]/g, (_, part: string) => ([...part.matchAll(/\{([^{}]+)\}/g)].some((m) => !(vars[m[1]] ?? "")) ? "" : part))).replace(/^\p{Ll}/u, (ch) => ch.toUpperCase());
}
function svCheck(t: string): string {
  if (t.length > 600) return "Текст длиннее 600 знаков.";
  for (const m of t.matchAll(/\{([^{}]*)\}/g)) if (!SV_VARS.includes(m[1])) return `Неизвестная вставка {${m[1].slice(0, 30)}}. Можно: ${SV_VARS.map((x) => "{" + x + "}").join(", ")}.`;
  if (/[{}]/.test(t.replace(/\{[^{}]*\}/g, ""))) return "Фигурные скобки ставьте только у вставок, например {время}.";
  if (/[[\]]/.test(t.replace(/\[\[[\s\S]*?\]\]/g, ""))) return "Уберите квадратные скобки: впишите настоящий текст.";
  return "";
}
function mkCheck(ru: string, kk: string): string {
  if (!ru.trim()) return "Нужен текст на русском.";
  if (!/стоп/i.test(ru)) return "Добавьте в конце, как отказаться: " + STOP_RU;
  if (kk.trim() && !/стоп/i.test(kk)) return "В казахском тексте тоже нужен отказ: «стоп» деп жазыңыз.";
  if (/[[\]]/.test(ru + kk)) return "Уберите [скобки]: впишите настоящий текст.";
  const bad = [...(ru + kk).matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1]).find((k) => !MK_VARS.includes(k));
  return bad ? `Неизвестная вставка {{${bad}}}. Вставки добавляйте кнопками над полем.` : "";
}

type Sc = { on: boolean; at: number; by: string; t: Record<string, string | number> };
type Ws = { name: string; jr: boolean; locked: boolean; phone: string; s: Record<string, Sc>; tx: Record<string, { ru: string; kk: string; v: number; own: boolean }>; win: { from: number; to: number }; cap: number; test: string; log: (AutoMsgLogItem & { id: string })[] };

export function createDemoAutoMsg(role: () => Role) {
  const now0 = Date.now();
  const make = (name: string, jr: boolean, phone: string): Ws => ({
    name,
    jr,
    locked: true,
    phone,
    s: Object.fromEntries(DEFS.map((d) => [d.id, { on: false, at: 0, by: "", t: { ...d.def } }])),
    tx: Object.fromEntries(DEFS.filter((d) => d.ru).map((d) => [d.id, { ru: d.ru || "", kk: d.kk || "", v: d.group === "service" ? 2 : 0, own: false }])),
    win: { from: 10, to: 21 },
    cap: 150,
    test: "",
    // журнал — как было бы у живой компании: напоминание отменилось (запись перенесли), просьба об отзыве ждала отметки «пришёл»
    log: jr
      ? [
          { id: "remind3", at: now0 - 3 * 3600e3, state: "cancelled", why: "запись перенесена", name: "Самат", phone: "+7 700 *** ** 04", date: "", time: "11:00" },
          { id: "review", at: now0 - 26 * 3600e3, state: "skipped", why: "в Altegio нет отметки «пришёл», об отзыве не просим", name: "Канат", phone: "+7 700 *** ** 05", date: "", time: "18:00" },
        ]
      : [],
  });
  const all: Record<string, Ws> = { demo: make("Демо Барбер", true, "+7 700 000 56 78"), "demo-service": make("Демо Сервис", false, "+7 700 000 21 21"), "demo-empty": make("Новая компания", false, "") };
  const find = (ws: string) => {
    const w = all[ws];
    if (!w) throw new ApiError("Нет доступа к этому клиенту.", 403);
    return w;
  };
  const owner = () => role() === "owner";
  const ownerOnly = () => {
    if (!owner()) throw new ApiError("Менять автоматические сообщения и проверять их может только владелец.", 403);
  };
  const tomorrow = () => {
    const d = new Date(Date.now() + 5 * 3600e3 + 86400e3);
    return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
  };
  const sample = (w: Ws, lang: "ru" | "kk"): Record<string, string> => ({
    компания: w.name, имя: "Арман", дата: tomorrow(), время: "15:00", услуга: "Мужская стрижка", мастер: "Данияр",
    "услуга и мастер": `Мужская стрижка, ${lang === "kk" ? "шебер" : "мастер"} Данияр`, адрес: "Астана, улица Примерная, 1", ссылка: "https://2gis.kz/astana/firm/70000000000000001",
    площадка: "2ГИС", детали: "(ссылка на запись из Altegio)", оценка: "(ссылка на оценку визита из Altegio)", сколько: "400", баланс: "1200",
  });
  const mkSample: Record<string, string> = { "client.first_name": "Арман", "staff.name": "Данияр", "service.name": "Мужская стрижка", "visit.days_since": "45", "booking.url": "https://example.kz", "company.address": "Астана, улица Примерная, 1" };
  const textOf = (w: Ws, d: Def, lang: "ru" | "kk") => {
    const x = w.tx[d.id];
    if (!x) return "";
    const t = (lang === "kk" && x.kk) || x.ru;
    return d.group === "service" ? svRender(t, sample(w, lang)) : t.replace(/\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g, (_, k: string) => (k === "company.name" ? w.name : mkSample[k] ?? ""));
  };
  const add = (w: Ws, id: string, state: string, why: string) => w.log.push({ id, at: Date.now(), state, why, name: "владелец", phone: "", date: "", time: "" });

  return {
    async autoMessages(ws: string): Promise<AutoMessages> {
      await wait(320);
      const w = find(ws);
      const ready = { preview: false, master: w.jr ? "" : NO_JR, sender: w.phone ? "" : "Второй номер (Green-API) не подключён." };
      const scenarios: AutoMsgScenario[] = DEFS.map((d) => {
        const s = w.s[d.id], x = w.tx[d.id];
        const locked = d.id === "campaigns" ? CAMP_LOCK : d.group === "marketing" && w.locked ? MK_LOCK : "";
        const on = d.id === "campaigns" ? false : s.on;
        const why = !on ? "" : locked || ready.master || ready.sender || "";
        return {
          id: d.id, group: d.group, title: d.title, who: d.who, on, live: on && !why, why, locked, at: s.at, by: s.by, timing: { ...s.t }, fields: d.fields,
          timingText: timingText(d.id, s.t, w.win),
          text: x ? { ru: x.ru, kk: x.kk, v: x.v, ...(d.group === "service" ? { variant: x.own ? "u1" : "b1" } : {}), own: x.own, approved: true, vars: d.vars || [] } : null,
          preview: x ? textOf(w, d, "ru") : "",
          counts: { today: { sent: 0, failed: 0, skipped: 0 }, week: { sent: 0, failed: 0, skipped: 0 } },
          log: w.log.filter((l) => l.id === d.id).slice(-20).reverse().map(({ id: _id, ...l }) => l),
          ...(d.id === "reactivate" ? { audience: w.jr ? { total: 3, allowed: 1, why: { noconsent: 2 }, base: true } : null } : {}),
        };
      });
      return {
        workspace: { id: ws, name: w.name },
        owner: owner(),
        stage: "production",
        now: Date.now(),
        master: { on: w.jr, why: ready.master },
        sender: { ready: !!w.phone, phone: w.phone, why: ready.sender },
        altegio: { ready: w.jr, why: w.jr ? "" : "Не подключён журнал Altegio: без него сервисные сообщения не знают о записях." },
        db: "",
        hold: null,
        window: { ...w.win },
        cap: w.cap,
        marketing: { allowed: !w.locked, why: w.locked ? MK_LOCK : "" },
        test: w.test ? { phone: owner() ? w.test : w.test.replace(/^(\+7 \d{3}) \d{3} \d\d/, "$1 *** **") } : null,
        scenarios,
      };
    },
    async autoMessageSet(ws: string, p: AutoMsgPatch): Promise<void> {
      await wait(260);
      const w = find(ws);
      ownerOnly();
      if ("testPhone" in p) {
        const raw = p.testPhone.trim(), d = raw.replace(/\D/g, "");
        const ph = d.length === 11 && /^[78]/.test(d) ? "7" + d.slice(1) : d.length === 10 && d[0] === "7" ? "7" + d : "";
        if (raw && !ph) throw new ApiError("Номер для проверки — полностью, например +7 701 123 45 67.", 400);
        w.test = ph ? `+7 ${ph.slice(1, 4)} ${ph.slice(4, 7)} ${ph.slice(7, 9)} ${ph.slice(9)}` : "";
        return;
      }
      if (!w.jr) throw new ApiError("У компании нет автоматических сообщений.", 404);
      if (!("id" in p)) {
        const from = p.window ? Number(p.window.from) : w.win.from, to = p.window ? Number(p.window.to) : w.win.to, cap = p.cap ?? w.cap;
        if (!Number.isInteger(from) || from < 8 || from > 12) throw new ApiError("Начало отправки — целый час с 8 до 12.", 400);
        if (!Number.isInteger(to) || to < 17 || to > 22) throw new ApiError("Конец отправки — целый час с 17 до 22.", 400);
        if (!Number.isInteger(cap) || cap < 10 || cap > 300) throw new ApiError("Предел за сутки — целое число от 10 до 300.", 400);
        w.win = { from, to };
        w.cap = cap;
        return;
      }
      const d = DEFS.find((x) => x.id === p.id);
      if (!d) throw new ApiError("Сценарий не найден.", 404);
      const s = w.s[d.id];
      if ("on" in p) {
        if (d.id === "campaigns") throw new ApiError("Рассылки запускаются в «Маркетинге», здесь их не включают.", 409, false, { code: "locked" });
        if (p.on && d.group === "marketing" && w.locked) throw new ApiError(MK_LOCK, 409, false, { code: "locked" });
        Object.assign(s, { on: p.on, at: Date.now(), by: "владелец" });
        add(w, d.id, p.on ? "on" : "off", `${p.on ? "включил" : "выключил"} владелец`);
        return;
      }
      if (p.timing) {
        const t = { ...s.t };
        for (const [k, v] of Object.entries(p.timing)) {
          const f = d.fields.find((x) => x.key === k);
          if (!f) throw new ApiError(`У сценария «${d.title}» нет настройки «${k.slice(0, 20)}».`, 400);
          const bad = fieldBad(f, v);
          if (bad) throw new ApiError(bad, 400);
          t[k] = f.kind === "time" || f.kind === "choice" ? String(v) : Number(v);
        }
        for (const f of d.fields) {
          if (f.kind !== "time" || !t[f.key]) continue;
          const h = Number(String(t[f.key]).slice(0, 2));
          if (h < w.win.from || h >= w.win.to) throw new ApiError(`${f.label}: в часы отправки, с ${w.win.from}:00 до ${w.win.to}:00.`, 400);
        }
        s.t = t;
        add(w, d.id, "edit", `время: ${timingText(d.id, t, w.win)}`);
      }
      if (p.text) {
        const x = w.tx[d.id];
        if (!x) throw new ApiError("У этого сценария нет своего текста.", 400);
        const ru = p.text.ru.trim(), kk = (p.text.kk || "").trim();
        if (!ru) throw new ApiError("Нужен текст на русском.", 400);
        const bad = d.group === "service" ? svCheck(ru) || (kk ? svCheck(kk) : "") : mkCheck(ru, kk);
        if (bad) throw new ApiError(bad, 400);
        w.tx[d.id] = { ru, kk, v: x.v + 1, own: true };
        add(w, d.id, "edit", "текст сообщения");
      }
    },
    async autoMessageTest(ws: string, id: string, lang: "ru" | "kk"): Promise<AutoMsgTestResult> {
      await wait(300);
      const w = find(ws), d = DEFS.find((x) => x.id === id);
      ownerOnly();
      if (!d || d.id === "campaigns") throw new ApiError("Проверку рассылки отправляют из мастера рассылки в «Маркетинге».", 400);
      const text = textOf(w, d, lang);
      if (!w.test) throw new ApiError("Сначала укажите номер для проверки (ваш номер) вверху раздела.", 409, false, { code: "notest", preview: text });
      // демо ничего не отправляет: как тестовая версия — текст, который пришёл бы
      throw new ApiError("Это демо: проверка на ваш номер не отправляется. Ниже текст, который пришёл бы.", 409, false, { code: "preview", preview: text });
    },
    async autoMessageAudience(ws: string, id: "birthday" | "reactivate"): Promise<AutoMsgAudience> {
      await wait(500);
      const w = find(ws);
      ownerOnly();
      if (!w.jr) throw new ApiError("Altegio не ответил — попробуйте через минуту.", 503);
      const day = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
      return id === "birthday" ? { id, total: 1, allowed: 0, day, at: Date.now() } : { id, allowed: 1, day, at: Date.now() };
    },
    /** Номер для проверки — для пробы рассылки со второго номера (как на сервере: только он). */
    testPhone: (ws: string) => all[ws]?.test || "",
    /** Включён ли сценарий вида k (s01, d1, h2, s06, cx, rv) — для очереди «Ближайшие» в демо. */
    kindOn: (ws: string, k: string) => {
      const w = all[ws], d = DEFS.find((x) => x.kind === k);
      return !!(w && d && w.s[d.id]?.on);
    },
  };
}
