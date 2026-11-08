// @ts-check
// «Автоматические сообщения» со второго номера (задание владельца 02.11.2026): одиннадцать сценариев (с ТЗ v4 08.11.2026 — бонусы), у каждого свой выключатель, текст,
// время отправки, счётчики и журнал. Сервисные — то, что нужно для конкретной записи (подтверждение, напоминания, перенос, отмена,
// благодарность и отзыв после визита, начислено и списано бонусов: без рекламы, согласия на рекламу не нужно — только не «стоп»). Рекламные (день рождения,
// реактивация, кампании) — только с подтверждённым согласием на рекламу и не чаще раза в 30 дней; рекламу под видом сервисного
// сообщения не шлём. Всё выключено по умолчанию (msgset:<клиент>, db/kv/automsg.js); рекламу со второго номера дополнительно держит
// запрет gaNoBroadcast в коде (Winchester) — его снимает только решение владельца, не переключатель.
// Здесь — только описание и проверка настроек (чистые функции); отправка — services/reminders/journal.js и ./marketing.js.
/** @import { Client } from "../../lib/types.js" */
import { STOP_RU, STOP_KK } from "../broadcast/library.js";

/**
 * @typedef {{ key: string, label: string, kind: "minutes" | "hours" | "days" | "time" | "choice" | "count", min?: number, max?: number, step?: number,
 *   options?: { v: string, label: string }[], when?: { key: string, is: string } }} Field
 * @typedef {{ id: string, group: "service" | "marketing", title: string, kind: string, sc?: string, fields: Field[], def: Record<string, any>,
 *   who: string }} AutoDef
 */

/** @type {AutoDef[]} */
export const AUTO = [
  { id: "confirm", group: "service", title: "Подтверждение записи", kind: "s01", sc: "S01", def: { delay: 0 },
    who: "Клиенту, которого записали в Altegio: администратор, сайт, онлайн-запись. Кроме записей через бота в переписке.",
    fields: [{ key: "delay", label: "Через сколько минут после записи (0 — сразу)", kind: "minutes", min: 0, max: 60, step: 5 }] },
  { id: "remind24", group: "service", title: "Напоминание за 24 часа", kind: "d1", sc: "S03", def: { mode: "24h", eve: "18:00" },
    who: "Каждому клиенту с записью на завтра, если он записался раньше чем за сутки.",
    fields: [{ key: "mode", label: "Когда", kind: "choice", options: [{ v: "24h", label: "За 24 часа до визита" }, { v: "eve", label: "Накануне в выбранное время" }] },
      { key: "eve", label: "Время накануне", kind: "time", when: { key: "mode", is: "eve" } }] },
  { id: "remind3", group: "service", title: "Напоминание за 3 часа", kind: "h2", sc: "S04", def: { hours: 3 },
    who: "Каждому клиенту в день визита, если он записался заранее.",
    fields: [{ key: "hours", label: "За сколько часов до визита", kind: "hours", min: 1, max: 6 }] },
  { id: "move", group: "service", title: "Перенос записи", kind: "s06", sc: "S06", def: {},
    who: "Клиенту, у которого в Altegio изменили время, мастера или услугу записи.", fields: [] },
  { id: "cancel", group: "service", title: "Отмена записи", kind: "cx", sc: "S07", def: {},
    who: "Клиенту, чью будущую запись удалили в Altegio.", fields: [] },
  { id: "review", group: "service", title: "Благодарность за визит и отзыв", kind: "rv", sc: "S12", def: { hours: 1, gap: 0 },
    who: "Клиенту, у которого в Altegio отмечено «пришёл»: благодарность, «Контроль качества» Altegio и отзыв в 2ГИС. Без рекламы.",
    fields: [{ key: "hours", label: "Через сколько часов после окончания визита (0 — сразу)", kind: "hours", min: 0, max: 24 },
      { key: "gap", label: "Одному клиенту не чаще раза в … дней (0 — после каждого визита)", kind: "days", min: 0, max: 90 }] },
  { id: "bonusIn", group: "service", title: "Начислено бонусов", kind: "bi", sc: "S19", def: {},
    who: "Клиенту, которому Altegio начислил бонусы на карту лояльности за визит. Нужно право «Лояльность» у сотрудника, чей ключ журнала в системе.",
    fields: [] },
  { id: "bonusOut", group: "service", title: "Списано бонусов", kind: "bo", sc: "S20", def: {},
    who: "Клиенту, который оплатил визит бонусами с карты лояльности Altegio.", fields: [] },
  { id: "birthday", group: "marketing", title: "Поздравление с днём рождения", kind: "bd", def: { time: "11:00" },
    who: "Клиентам из Altegio, у кого сегодня день рождения, если у них есть согласие на рекламу и они не писали «стоп». Не записанным и не бывшим меньше 14 дней назад. Раз в год.",
    fields: [{ key: "time", label: "Во сколько отправлять", kind: "time" }] },
  { id: "reactivate", group: "marketing", title: "Реактивация клиентов", kind: "ra", def: { days: 45, time: "12:00", cap: 20 },
    who: "Клиентам, которые не были выбранное число дней и не записаны, если у них есть согласие на рекламу и они не писали «стоп».",
    fields: [{ key: "days", label: "Сколько дней не были", kind: "days", min: 21, max: 90 }, { key: "time", label: "Во сколько отправлять", kind: "time" },
      { key: "cap", label: "Не больше сообщений в день", kind: "count", min: 1, max: 50 }] },
  { id: "campaigns", group: "marketing", title: "Маркетинговые кампании", kind: "", def: {},
    who: "Рассылки по базе клиентов со второго номера: черновик и проверка — в «Маркетинге», только тем, кто дал согласие на рекламу.", fields: [] },
];
/** @param {string} id */
export const autoDef = id => AUTO.find(x => x.id === id) || null;
/** вид в очереди журнала → сценарий @param {string} k */
export const autoOfKind = k => AUTO.find(x => x.kind && x.kind === k) || null;
export const KIND_IDS = /** @type {Record<string, string>} */ (Object.fromEntries(AUTO.filter(x => x.kind).map(x => [x.kind, x.id])));

// тексты рекламных сценариев по умолчанию: коротко, без обещаний, которых нет (скидок, подарков), с отказом в конце
const BD_RU = "{{client.first_name}}, с днём рождения! Желаем вам хорошего года. Будем рады видеть вас в {{company.name}}.";
const BD_KK = "{{client.first_name}}, туған күніңіз құтты болсын! Сізге жақсы жыл тілейміз. Сізді {{company.name}} барбершопында көргенге қуаныштымыз.";
// реактивация — прежняя тема «Давно не были» библиотеки (до 02.11.2026 бралась оттуда; библиотека теперь — утверждённые тексты рассылок)
const RA_RU = "Здравствуйте, {{client.first_name}}! Давно вас не видели в {{company.name}}. Будем рады записать вас снова: {{booking.url}}";
const RA_KK = "Сәлеметсіз бе, {{client.first_name}}! Сізді {{company.name}} барбершопында көптен бері көрмедік. Қайта жазылсаңыз, қуанамыз: {{booking.url}}";
/** @type {Record<string, { ru: string, kk: string }>} */
export const MK_TEXT = {
  birthday: { ru: BD_RU + "\n\n" + STOP_RU, kk: BD_KK + "\n\n" + STOP_KK },
  reactivate: { ru: RA_RU + "\n\n" + STOP_RU, kk: RA_KK + "\n\n" + STOP_KK },
};

export const WIN_DEF = { from: 10, to: 21 };
export const CAP_DEF = 150;
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Настройки сценариев компании с тем, что по умолчанию: всё выключено, время — из AUTO.def, часы отправки и предел за сутки — из c.jr
 * (паспорт компании), пока владелец не изменил их в пульте. raw — msgset:<клиент> как лежит в KV.
 * @param {Client} c @param {Record<string, any>} raw
 */
export function autoSettings(c, raw) {
  const jr = (c && c.jr) || {}, r = raw && typeof raw === "object" ? raw : {};
  const win = r.win && +r.win.from >= 0 && +r.win.to > +r.win.from ? { from: +r.win.from, to: +r.win.to } : { from: +jr.from || WIN_DEF.from, to: +jr.to || WIN_DEF.to };
  const s = /** @type {Record<string, { on: boolean, at: number, by: string, t: Record<string, any> }>} */ ({});
  for (const d of AUTO) {
    const x = r.s && r.s[d.id] && typeof r.s[d.id] === "object" ? r.s[d.id] : {};
    const t = { ...d.def };
    for (const f of d.fields) if (x.t && x.t[f.key] != null && !fieldBad(f, x.t[f.key])) t[f.key] = f.kind === "time" || f.kind === "choice" ? String(x.t[f.key]) : +x.t[f.key];
    s[d.id] = { on: x.on === true, at: +x.at || 0, by: String(x.by || ""), t };
  }
  const tx = /** @type {Record<string, { ru: string, kk: string, v: number, at: number, by: string }>} */ ({});
  for (const id of Object.keys(MK_TEXT)) {
    const x = r.tx && r.tx[id] && typeof r.tx[id] === "object" && r.tx[id].ru ? r.tx[id] : null;
    tx[id] = x ? { ru: String(x.ru), kk: String(x.kk || ""), v: +x.v || 1, at: +x.at || 0, by: String(x.by || "") } : { ...MK_TEXT[id], v: 0, at: 0, by: "" };
  }
  const test = r.test && /^\d{10,15}$/.test(String(r.test.p || "")) ? { p: String(r.test.p), at: +r.test.at || 0, by: String(r.test.by || "") } : null;
  return { s, tx, win, cap: +r.cap >= 1 ? +r.cap : +jr.cap || CAP_DEF, test };
}

/** что не так со значением поля ("" — годится) @param {Field} f @param {any} v */
export function fieldBad(f, v) {
  if (f.kind === "time") return HM.test(String(v ?? "")) ? "" : `${f.label}: время вида 11:00.`;
  if (f.kind === "choice") return (f.options || []).some(o => o.v === String(v)) ? "" : `${f.label}: выберите из списка.`;
  const n = +v;
  if (!Number.isInteger(n) || n < (f.min ?? 0) || n > (f.max ?? 1e6)) return `${f.label}: целое число от ${f.min} до ${f.max}.`;
  if (f.step && n % f.step) return `${f.label}: число, кратное ${f.step}.`;
  return "";
}
/**
 * Новое время сценария: только поля этого сценария, каждое проверено; время рекламного сценария — в часы отправки.
 * → { t } или { error } @param {AutoDef} d @param {any} input @param {{ from: number, to: number }} win @param {Record<string, any>} cur
 */
export function timingPatch(d, input, win, cur) {
  if (!input || typeof input !== "object") return { error: "Нет настроек времени." };
  const t = { ...cur };
  for (const [k, v] of Object.entries(input)) {
    const f = d.fields.find(x => x.key === k);
    if (!f) return { error: `У сценария «${d.title}» нет настройки «${String(k).slice(0, 20)}».` };
    const bad = fieldBad(f, v);
    if (bad) return { error: bad };
    t[k] = f.kind === "time" || f.kind === "choice" ? String(v) : +v;
  }
  for (const f of d.fields) {
    if (f.kind !== "time" || !t[f.key]) continue;
    const h = +String(t[f.key]).slice(0, 2);
    if (h < win.from || h >= win.to) return { error: `${f.label}: в часы отправки, с ${win.from}:00 до ${win.to}:00.` };
  }
  return { t };
}
/** часы отправки и предел за сутки → { win, cap } или { error } @param {any} b @param {{ from: number, to: number }} win @param {number} cap */
export function windowPatch(b, win, cap) {
  const out = { win: { ...win }, cap };
  if (b.window != null) {
    const from = +(b.window && b.window.from), to = +(b.window && b.window.to);
    if (!Number.isInteger(from) || from < 8 || from > 12) return { error: "Начало отправки — целый час с 8 до 12." };
    if (!Number.isInteger(to) || to < 17 || to > 22) return { error: "Конец отправки — целый час с 17 до 22." };
    out.win = { from, to };
  }
  if (b.cap != null) {
    const n = +b.cap;
    if (!Number.isInteger(n) || n < 10 || n > 300) return { error: "Предел за сутки — целое число от 10 до 300." };
    out.cap = n;
  }
  return out;
}

/** «18:00» → «18:00»; часы окна → «с 10:00 до 21:00» @param {{ from: number, to: number }} w */
const winText = w => `с ${w.from}:00 до ${w.to}:00`;
/**
 * Когда уходит — простыми словами (для пульта).
 * @param {AutoDef} d @param {Record<string, any>} t @param {{ from: number, to: number }} w
 */
export function timingText(d, t, w) {
  switch (d.id) {
    case "confirm": return `${+t.delay ? `Через ${t.delay} мин после записи` : "Сразу после записи, в течение 1–2 минут"}, ${winText(w)}. Не позже чем за час до визита.`;
    case "remind24": return t.mode === "eve" ? `Накануне визита в ${t.eve}.` : `За 24 часа до визита. Если это время раньше ${w.from}:00 или позже ${w.to}:00 — в ближайшее время отправки накануне.`;
    case "remind3": return `За ${t.hours} ч до визита, если это время ${winText(w)}.`;
    case "move": return `В течение 15 минут после переноса в Altegio, ${winText(w)}. Если запись меняют несколько раз подряд — одно сообщение с последним временем.`;
    case "cancel": return `В течение 15 минут после отмены в Altegio, ${winText(w)}. Только о будущих записях.`;
    case "review": return `${+t.hours ? `Через ${t.hours} ч после окончания визита` : "Сразу после окончания визита"}, когда в Altegio стоит «пришёл» (ждём до 3 часов), ${winText(w)}. Позже — утром следующего дня. ${+t.gap ? `Одному клиенту — не чаще раза в ${t.gap} дн.` : "После каждого визита."}`;
    case "bonusIn": case "bonusOut": return `В течение 1–2 минут после оплаты визита в Altegio, ${winText(w)}. Позже — утром следующего дня.`;
    case "birthday": return `В день рождения в ${t.time}.`;
    case "reactivate": return `Через ${t.days} дней после последнего визита, в ${t.time}. Не больше ${t.cap} сообщений в день.`;
    default: return "Когда владелец запустит рассылку.";
  }
}
