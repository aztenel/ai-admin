// Вымышленные данные проверочного экрана (номера как в /demo, к настоящим клиентам отношения не имеют).
export type Who = "client" | "bot" | "admin" | "event";
export type Msg = { id: string; who: Who; text: string; at: string };
export type Stage = "wait" | "bot" | "booked" | "done";
export type Conv = {
  id: string;
  phone: string;
  name?: string;
  channel: "WhatsApp" | "Сайт";
  stage: Stage;
  reason: string;
  urgent?: boolean;
  at: string;
  unread: number;
  owner: "Бот" | "Айгерим";
  /** Ближайшая запись из CRM (Altegio) — для правой панели. */
  booking?: string;
  /** Сколько раз уже был. */
  visits?: number;
  messages: Msg[];
};

export const STAGES: { id: Stage; name: string; accent: "amber" | "violet" | "emerald" | "slate" }[] = [
  { id: "wait", name: "Ждут ответа", accent: "amber" },
  { id: "bot", name: "Ведёт бот", accent: "violet" },
  { id: "booked", name: "Запись / заявка", accent: "emerald" },
  { id: "done", name: "Готово", accent: "slate" },
];

export const CONVS: Conv[] = [
  {
    id: "c1", phone: "+7 701 048 27 15", channel: "WhatsApp", stage: "wait", urgent: true,
    reason: "Просит человека", at: "16:37", unread: 2, owner: "Бот",
    messages: [
      { id: "1", who: "client", text: "Здравствуйте, сколько стоит стрижка с бородой?", at: "16:15" },
      { id: "2", who: "bot", text: "Стрижка + борода — от 9 000 ₸, около 1,5 часа. У Армана на 20% дороже (10 800 ₸). Записать вас?", at: "16:15" },
      { id: "3", who: "client", text: "К Арману можно сегодня после 18:00?", at: "16:19" },
      { id: "4", who: "bot", text: "Сегодня у Армана свободно 19:00 и 20:30. Какое время выбираете?", at: "16:19" },
      { id: "5", who: "client", text: "Мне нужен человек, это срочно", at: "16:37" },
      { id: "6", who: "event", text: "Бот передал чат администратору", at: "16:37" },
    ],
  },
  {
    id: "c2", phone: "+7 705 031 64 92", channel: "WhatsApp", stage: "wait",
    reason: "Недоволен ценой", at: "16:23", unread: 1, owner: "Бот",
    messages: [
      { id: "1", who: "client", text: "Почему так дорого? У других дешевле", at: "16:23" },
      { id: "2", who: "event", text: "Бот не уверен в ответе — нужен администратор", at: "16:23" },
    ],
  },
  {
    id: "c3", phone: "+7 707 026 39 58", name: "Ерлан", channel: "WhatsApp", stage: "wait",
    reason: "Отмена записи", at: "15:46", unread: 1, owner: "Бот",
    booking: "Завтра, 11:00 · Мужская стрижка · Арман", visits: 4,
    messages: [
      { id: "1", who: "client", text: "Не смогу прийти завтра", at: "15:45" },
      { id: "2", who: "bot", text: "Передала просьбу администратору, он подтвердит отмену.", at: "15:46" },
    ],
  },
  {
    id: "c4", phone: "+7 778 512 40 03", channel: "Сайт", stage: "bot",
    reason: "Спрашивает про детскую стрижку", at: "16:41", unread: 0, owner: "Бот",
    messages: [
      { id: "1", who: "client", text: "А детей стрижёте? Сыну 6 лет", at: "16:40" },
      { id: "2", who: "bot", text: "Да, детская стрижка — 4 000 ₸, около 40 минут. Подобрать время?", at: "16:41" },
    ],
  },
  {
    id: "c5", phone: "+7 747 300 18 66", channel: "WhatsApp", stage: "bot",
    reason: "Выбирает время", at: "16:12", unread: 0, owner: "Бот",
    messages: [
      { id: "1", who: "client", text: "Есть окно в субботу утром?", at: "16:10" },
      { id: "2", who: "bot", text: "В субботу свободно 10:00, 11:30 и 12:15. Какое удобно?", at: "16:12" },
    ],
  },
  {
    id: "c6", phone: "+7 702 664 91 20", name: "Данияр", channel: "WhatsApp", stage: "booked",
    reason: "Стрижка + борода · завтра 19:00 · Арман", at: "14:05", unread: 0, owner: "Бот",
    booking: "Завтра, 19:00 · Стрижка + борода · Арман", visits: 2,
    messages: [
      { id: "1", who: "client", text: "Запишите на завтра к Арману в 19:00", at: "14:03" },
      { id: "2", who: "bot", text: "Записала: завтра в 19:00, стрижка + борода у Армана. Напомню за 2 часа.", at: "14:05" },
      { id: "3", who: "event", text: "Запись создана в Altegio", at: "14:05" },
    ],
  },
  {
    id: "c7", phone: "+7 775 120 77 41", channel: "Сайт", stage: "booked",
    reason: "Заявка: камуфляж седины", at: "13:20", unread: 0, owner: "Айгерим",
    messages: [
      { id: "1", who: "client", text: "Хочу камуфляж седины, сколько по времени?", at: "13:18" },
      { id: "2", who: "bot", text: "Около 30 минут, 6 000 ₸. Оставила заявку, администратор подтвердит время.", at: "13:20" },
    ],
  },
  {
    id: "c8", phone: "+7 701 555 02 19", name: "Тимур", channel: "WhatsApp", stage: "done",
    reason: "Спасибо, всё понятно", at: "12:02", unread: 0, owner: "Бот", visits: 7,
    messages: [
      { id: "1", who: "client", text: "До скольки работаете?", at: "12:00" },
      { id: "2", who: "bot", text: "Сегодня до 21:00, без перерыва.", at: "12:01" },
      { id: "3", who: "client", text: "Спасибо, всё понятно", at: "12:02" },
    ],
  },
];

// ---- экраны «Записи», «Рассылки», «Клиенты», «Бот» (тоже вымышленные) ----
export type Booking = {
  id: string; day: "today" | "tomorrow"; time: string; client: string; phone: string;
  service: string; master: string; price: number; source: "бот" | "администратор";
  status: "ждём" | "пришёл" | "отменяет" | "новая";
};
export const BOOKINGS: Booking[] = [
  { id: "b1", day: "today", time: "10:00", client: "Тимур", phone: "+7 701 555 02 19", service: "Мужская стрижка", master: "Арман", price: 9000, source: "администратор", status: "пришёл" },
  { id: "b2", day: "today", time: "12:30", client: "Алихан", phone: "+7 705 410 22 87", service: "Стрижка + борода", master: "Данияр", price: 9000, source: "бот", status: "пришёл" },
  { id: "b3", day: "today", time: "17:00", client: "Руслан", phone: "+7 777 230 61 04", service: "Камуфляж седины", master: "Арман", price: 7200, source: "бот", status: "ждём" },
  { id: "b4", day: "today", time: "19:00", client: "Нурлан", phone: "+7 708 902 13 55", service: "Детская стрижка", master: "Данияр", price: 4000, source: "бот", status: "ждём" },
  { id: "b5", day: "tomorrow", time: "11:00", client: "Ерлан", phone: "+7 707 026 39 58", service: "Мужская стрижка", master: "Арман", price: 9000, source: "бот", status: "отменяет" },
  { id: "b6", day: "tomorrow", time: "15:30", client: "Самат", phone: "+7 776 144 08 90", service: "Бритьё опасной бритвой", master: "Данияр", price: 6000, source: "администратор", status: "ждём" },
  { id: "b7", day: "tomorrow", time: "19:00", client: "Данияр", phone: "+7 702 664 91 20", service: "Стрижка + борода", master: "Арман", price: 10800, source: "бот", status: "новая" },
];

export type Broadcast = {
  id: string; name: string; kind: "auto" | "once"; when: string; audience: string;
  sent?: number; delivered?: number; read?: number; replied?: number; status: string;
};
export const BROADCASTS: Broadcast[] = [
  { id: "r1", name: "Напоминание о записи", kind: "auto", when: "за 2 часа до визита", audience: "все записи через бота", status: "включено" },
  { id: "r2", name: "Просьба об отзыве (2ГИС)", kind: "auto", when: "через 3 часа после визита", audience: "все записи через бота", status: "включено" },
  { id: "r3", name: "−20% в будни до 14:00", kind: "once", when: "14 октября, 11:00", audience: "не были дольше 30 дней", sent: 120, delivered: 112, read: 87, replied: 9, status: "отправлена" },
  { id: "r4", name: "Новый мастер Данияр", kind: "once", when: "2 октября, 12:00", audience: "все клиенты", sent: 340, delivered: 318, read: 241, replied: 17, status: "отправлена" },
  { id: "r5", name: "Подарочные сертификаты к Новому году", kind: "once", when: "—", audience: "все клиенты", status: "черновик" },
];

export type Client = { id: string; name: string; phone: string; visits: number; last: string; master: string; optout?: boolean };
export const CLIENTS: Client[] = [
  { id: "k1", name: "Тимур", phone: "+7 701 555 02 19", visits: 7, last: "сегодня", master: "Арман" },
  { id: "k2", name: "Ерлан", phone: "+7 707 026 39 58", visits: 4, last: "3 недели назад", master: "Арман" },
  { id: "k3", name: "Данияр", phone: "+7 702 664 91 20", visits: 2, last: "месяц назад", master: "Арман" },
  { id: "k4", name: "Алихан", phone: "+7 705 410 22 87", visits: 11, last: "сегодня", master: "Данияр" },
  { id: "k5", name: "Руслан", phone: "+7 777 230 61 04", visits: 3, last: "2 месяца назад", master: "Арман", optout: true },
  { id: "k6", name: "Нурлан", phone: "+7 708 902 13 55", visits: 1, last: "впервые сегодня", master: "Данияр" },
  { id: "k7", name: "Самат", phone: "+7 776 144 08 90", visits: 5, last: "неделю назад", master: "Данияр" },
  { id: "k8", name: "Без имени", phone: "+7 701 048 27 15", visits: 0, last: "ещё не был", master: "—" },
];

export const PASSPORT: { label: string; value: string }[] = [
  { label: "Название", value: "Барбершоп «Демо»" },
  { label: "Адрес", value: "Астана, ул. Примерная, 40, 1 этаж" },
  { label: "График", value: "Пн–Вс 10:00–21:00, без перерыва" },
  { label: "Мастера", value: "Арман (+20% к цене), Данияр" },
  { label: "Услуги", value: "Мужская стрижка — 7 500 ₸ · Стрижка + борода — 9 000 ₸ · Детская — 4 000 ₸ · Камуфляж седины — 6 000 ₸ · Бритьё — 6 000 ₸" },
  { label: "Оплата Kaspi", value: "по номеру +7 700 *** ** 40" },
  { label: "Отзывы", value: "ссылка на карточку в 2ГИС" },
];

export const BOT_SWITCHES: { id: string; label: string; hint: string; on: boolean }[] = [
  { id: "answer", label: "Бот отвечает клиентам", hint: "WhatsApp и чат на сайте. Выключите — все сообщения придут администратору.", on: true },
  { id: "book", label: "Бот сам записывает в Altegio", hint: "Свободное время берётся из журнала, запись создаётся сразу.", on: true },
  { id: "cancel", label: "Бот сам отменяет и переносит", hint: "Пока выключено: просьба об отмене уходит администратору.", on: false },
  { id: "remind", label: "Напоминание за 2 часа", hint: "Только для записей, созданных ботом.", on: true },
  { id: "review", label: "Просьба об отзыве", hint: "Через 3 часа после визита, со ссылкой на 2ГИС.", on: true },
];

/** Свободное время по дням, начиная с сегодня (в настоящем пульте — из Altegio). */
export const FREE_SLOTS: string[][] = [
  ["17:30", "19:00", "20:30"],
  ["10:00", "12:30", "15:00", "17:00", "20:00"],
  ["11:00", "13:30", "16:00", "18:30"],
  ["10:30", "12:00", "14:30", "19:30"],
  ["12:00", "15:30", "18:00"],
  ["10:00", "11:30", "13:00", "16:30", "18:00", "19:30"],
  ["11:00", "14:00", "17:00"],
];
