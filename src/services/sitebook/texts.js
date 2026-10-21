// @ts-check
// Онлайн-запись на сайте: тексты ответов клиенту (на «ты», как сам сайт Winchester) и уведомлений администратору в Telegram.
// Форма показывает error как есть, поэтому все тексты — здесь, в одном месте.
import { money } from "../../lib/money.js";
import { fmtPhone } from "../../lib/phone.js";

// {tel} — телефон из настроек сайта (site.phone)
/** @type {Record<string, [number, string]>} */
export const ERR = {
  not_found: [404, "Онлайн-запись не найдена."],
  origin: [403, "Запрос с другого сайта не принят."],
  method: [405, "Метод не поддерживается."],
  off: [503, "Онлайн-запись сейчас недоступна. Напиши нам в WhatsApp или позвони: {tel}."],
  rate: [429, "Слишком много запросов. Подожди немного и попробуй снова."],
  spam: [400, "Не получилось отправить заявку. Позвони нам: {tel}."],
  too_fast: [400, "Секунду — проверяем данные."],
  expired: [409, "Данные формы устарели — обновляем."],
  taken: [409, "Это время только что заняли. Выбери другое."],
  overlap: [409, "На этот номер уже есть запись в это время. Выбери другое время или позвони нам: {tel}."],
  service: [409, "Эту услугу сейчас нельзя записать онлайн. Выбери другую или напиши нам в WhatsApp."],
  in_progress: [409, "Заявка уже отправляется — подожди несколько секунд."],
  altegio: [502, "Расписание сейчас не отвечает. Попробуй через минуту или напиши нам в WhatsApp."],
  unknown: [502, "Расписание не ответило вовремя. Запись могла создаться — администратор проверит и свяжется с тобой. Не записывайся повторно."],
  refused: [502, "Онлайн-запись не прошла, но заявка у администратора — он свяжется с тобой и запишет. Повторно записываться не нужно."],
  server: [500, "Что-то пошло не так. Попробуй ещё раз или напиши нам в WhatsApp."]
};
/** @type {Record<string, string>} */
export const LIMIT = {
  phone: "С этого номера сегодня уже несколько записей. Чтобы записаться ещё, позвони нам: {tel}.",
  ip: "С этого устройства сегодня уже несколько записей. Позвони нам: {tel}.",
  day: "Онлайн-запись на сегодня заполнена. Напиши нам в WhatsApp или позвони: {tel}."
};
// bad_request: текст по полю (у services — по причине)
/** @type {Record<string, string>} */
export const FIELD = {
  name: "Проверь имя: только буквы, от 2 до 60 знаков.",
  phone: "Нужен номер мобильного Казахстана: +7 7XX XXX XX XX.",
  services: "Выбери хотя бы одну услугу.",
  servicesStaff: "Эту услугу нельзя записать к выбранному мастеру.",
  servicesMax: "Не больше {max} услуг за один визит.",
  servicesGone: "Эту услугу сейчас нельзя записать онлайн. Выбери другую или напиши нам в WhatsApp.",
  staff: "Выбери мастера.",
  date: "Выбери другой день.",
  time: "Выбери время.",
  comment: "Комментарий — не длиннее 150 знаков.",
  body: "Не получилось прочитать заявку. Обнови страницу и попробуй ещё раз."
};

/** @typedef {{ http: number, res: Record<string, any> }} Out */
// ответ-ошибка { ok: false, code, error, …extra } с кодом HTTP из таблицы
/** @param {string} code @param {{ phone?: string }} conf @param {Record<string, any>} [extra] @param {string} [text] @returns {Out} */
export function fail(code, conf, extra = {}, text) {
  const [http, t] = ERR[code] || ERR.server;
  return { http, res: { ok: false, code, error: (text || t).replace("{tel}", conf.phone || "").replace("{max}", String(extra.max || "")), ...extra } };
}
/** @param {string} field @param {{ phone?: string, maxServices?: number }} conf @param {string} [why] ключ FIELD, если не совпадает с полем @returns {Out} */
export const badField = (field, conf, why) => ({ http: 400, res: { ok: false, code: "bad_request", error: (FIELD[why || field] || FIELD.body).replace("{max}", String(conf.maxServices || 5)), field } });
/** @param {string} field @param {{ phone?: string }} conf @returns {Out} */
export const limitHit = (field, conf) => ({ http: 429, res: { ok: false, code: "limit", error: LIMIT[field].replace("{tel}", conf.phone || ""), field } });

const DOW = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
/** @param {string} date */
const dow = date => DOW[new Date(date + "T00:00:00Z").getUTCDay()];
// «22.10 (чт) 12:00–13:15» — время в заявке; «чт, 22 октября, 12:00–13:15» — в Telegram
/** @param {string} date @param {string} time @param {string} end */
export const leadWhen = (date, time, end) => `${date.slice(8, 10)}.${date.slice(5, 7)} (${dow(date)}) ${time}–${end}`;
/** @param {string} date @param {string} time @param {string} end */
export const tgWhen = (date, time, end) => `${dow(date)}, ${+date.slice(8, 10)} ${MON[+date.slice(5, 7) - 1]}, ${time}–${end}`;

/**
 * Сообщение администратору в Telegram о заявке с сайта. kind: "live" — записан в Altegio, "dry" — режим проверки (записать вручную),
 * "unknown" — Altegio не ответил (запись могла создаться), "fail" — Altegio отказал (why — причина)
 * @param {"live" | "dry" | "unknown" | "fail"} kind @param {string} company @param {Record<string, any>} b @param {string} [why]
 */
export function tgText(kind, company, b, why) {
  const head = kind === "live" ? `✅ Запись с сайта — ${company}`
    : kind === "dry" ? `📝 Заявка с сайта — запишите вручную — ${company}\nОнлайн-запись на сайте в режиме проверки: время свободно по Altegio, в журнал запись не создана.`
    : kind === "unknown" ? `⚠️ Запись с сайта: Altegio не ответил — проверьте журнал — ${company}\nЗапись могла создаться: не записывайте клиента второй раз, свяжитесь с ним.`
    : `⚠️ Онлайн-запись с сайта не прошла: ${why || "Altegio отказал"} — ${company}\nВ журнале записи нет — свяжитесь с клиентом и запишите вручную.`;
  return [head,
    `Мастер: ${b.staff.name}${b.any ? " (клиент выбрал «любой мастер»)" : ""}`,
    `Услуги: ${b.services.map(/** @param {any} x */ x => `${x.name} ${money(x.price)} ₸`).join(" + ")}`,
    `Когда: ${tgWhen(b.date, b.time, b.end)} · итого ${money(b.total)} ₸`,
    `Имя: ${b.name}`,
    `Телефон: ${fmtPhone(b.phone)}`,
    ...(b.comment ? [`Комментарий: «${b.comment}»`] : []),
    ...(kind === "live" && b.id ? [`Номер записи в Altegio: ${b.id}`] : [])].join("\n");
}
