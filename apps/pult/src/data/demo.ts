// Демо-режим: вымышленные компании для показа пульта и проверки вида. Включается только явно (VITE_PULT_DATA=demo, адрес /demo
// или ?demo) и никогда не подменяет настоящие данные. Номера — заведомо несуществующие (+7 700 000 …), люди и переписки придуманы.
// ?staff в адресе — вид сотрудника компании (без кнопок владельца: «Обновить базу», автосценарий, «Снять сигнал Meta»).
// Рассылки, база клиентов и автосценарий — data/demo-campaigns.ts.
import type {
  BotState,
  Channel,
  ChannelReport,
  ChatRequest,
  ConversationDetail,
  ConversationRef,
  ConversationSummary,
  InboxSnapshot,
  Lead,
  Message,
  ReplyState,
  Workspace,
} from "@/model/types";
import { ApiError } from "./errors";
import { createDemoCampaigns } from "./demo-campaigns";
import type { DataSource } from "./source";

const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;
const wait = (ms = 260) => new Promise((r) => setTimeout(r, ms + Math.random() * 160));

type Conv = {
  ref: ConversationRef;
  name?: string;
  profileName?: string;
  phone?: string;
  messages: Message[];
  attention?: { reason: string; label: string; since?: number };
  bot: BotState;
  unread?: number;
  bookings?: string[];
  pending?: string[];
  requests?: ChatRequest[];
  /** Окно WhatsApp 24 ч закрыто (клиент давно не писал). */
  windowClosed?: boolean;
};
type Fixture = { ws: Workspace; payment?: string; convs: Conv[]; done: Lead[] };

function build(now: number): Fixture[] {
  let n = 0;
  const id = () => `m${++n}`;
  const msg = (from: Message["from"], text: string, ago: number, extra?: Partial<Message>): Message => ({ id: id(), from, text, at: now - ago, ...extra });

  // как у Winchester: основной номер — Meta (шаблоны, рассылки по базе), номер бота — Green-API (только ответы, без рассылок)
  const barberChannels: Channel[] = [
    { id: "wa", kind: "wa_cloud", name: "Основной номер", phone: "+77000001234", health: { level: "ok", text: "подключён" } },
    { id: "ga", kind: "green_api", name: "Номер бота", phone: "+77000005678", health: { level: "ok", text: "подключён" } },
    { id: "web", kind: "web", name: "" },
  ];
  const barber: Fixture = {
    ws: { id: "demo", name: "Демо Барбер", botOff: false, branches: [], channels: barberChannels, capabilities: { booking: true, campaigns: true } },
    payment: "Оплата через Kaspi: +7 700 000 12 34 (Демо Барбер). В комментарии укажите имя и время записи.",
    convs: [
      {
        ref: { channelId: "wa", externalId: "77000482715" },
        phone: "+77000482715",
        unread: 2,
        attention: { reason: "human", label: "Просит человека", since: now - 9 * MIN },
        bot: { state: "active" },
        messages: [
          msg("contact", "Здравствуйте, сколько стоит стрижка с бородой?", 31 * MIN),
          msg("bot", "Здравствуйте! Стрижка и оформление бороды — от 9 000 ₸, около полутора часов. У мастера Армана — 10 800 ₸. Записать вас?", 31 * MIN),
          msg("contact", "К Арману можно сегодня после 18:00?", 27 * MIN),
          msg("bot", "Сегодня у Армана свободно 19:00 и 20:30. Какое время выбираете?", 27 * MIN),
          msg("contact", "Мне нужен человек, это срочно. Хочу прийти вдвоём с сыном", 9 * MIN),
          msg("bot", "Передала ваш вопрос администратору — он ответит здесь в ближайшее время.", 9 * MIN),
        ],
      },
      {
        ref: { channelId: "ga", externalId: "77000316492" },
        name: "Самат Жумабеков",
        phone: "+77000316492",
        unread: 1,
        attention: { reason: "req", label: "Просит перенести запись", since: now - 22 * MIN },
        bot: { state: "active" },
        bookings: ["завтра, 11:00 — мужская стрижка, мастер Арман"],
        requests: [{ id: "rq-samat", kind: "change", name: "Самат", service: "Мужская стрижка → завтра, 15:30", time: "завтра, 11:00", note: "Перенести на 15:30, утром не успевает" }],
        messages: [
          msg("contact", "Добрый день! Я записан на завтра в 11:00, можно перенести на 15:30?", 23 * MIN),
          msg("bot", "Добрый день, Самат! Передала просьбу администратору — он подтвердит перенос здесь.", 22 * MIN),
        ],
      },
      {
        ref: { channelId: "ga", externalId: "77000263958" },
        name: "Ерлан",
        phone: "+77000263958",
        bot: { state: "paused", until: now + 1 * HOUR + 40 * MIN },
        messages: [
          msg("contact", "Скиньте адрес, пожалуйста, не могу найти вход", 26 * MIN),
          msg("operator", "Ерлан, вход со стороны парковки, вторая дверь слева. Ждём вас!", 20 * MIN, { via: "phone" }),
          msg("contact", "Спасибо, нашёл 👍", 18 * MIN),
        ],
      },
      {
        ref: { channelId: "wa", externalId: "77000263958" },
        name: "Ерлан",
        phone: "+77000263958",
        bot: { state: "active" },
        bookings: ["сегодня, 17:00 — мужская стрижка, мастер Данияр"],
        messages: [
          msg("contact", "Запишите на сегодня к Данияру, после 16:00", 3 * HOUR),
          msg("bot", "Сегодня у Данияра свободно 16:30 и 17:00. Какое время удобно?", 3 * HOUR),
          msg("contact", "17:00", 3 * HOUR - 2 * MIN),
          msg("bot", "Записала: сегодня в 17:00, мужская стрижка у Данияра. Напомню за 2 часа до визита.", 3 * HOUR - 2 * MIN),
        ],
      },
      {
        ref: { channelId: "ga", externalId: "77000120344" },
        name: "Алия",
        phone: "+77000120344",
        unread: 1,
        attention: { reason: "media", label: "Прислала фото", since: now - 41 * MIN },
        bot: { state: "active" },
        messages: [
          msg("contact", "Хочу вот такую стрижку сыну, сможете?", 42 * MIN),
          msg("contact", "[фото]", 41 * MIN, { media: { kind: "image" } }),
          msg("bot", "Фото получила, но рассмотреть его не могу — передала администратору, он ответит.", 41 * MIN),
        ],
      },
      {
        ref: { channelId: "wa", externalId: "77000473066" },
        name: "Динара Абдрахманова-Сейтказиева",
        phone: "+77000473066",
        bot: { state: "active" },
        messages: [
          msg("contact", "Сәлеметсіз бе! Ертең таңертең бос уақыт бар ма?", 58 * MIN),
          msg("bot", "Сәлеметсіз бе! Ертең 10:00, 11:30 және 12:15 бос. Қай уақыт ыңғайлы?", 58 * MIN),
          msg("contact", "11:30 болады, рахмет", 55 * MIN),
          msg("bot", "Жазып қойдым: ертең 11:30, ер адамдар шаш қию. Келуіңізден 2 сағат бұрын еске саламын.", 55 * MIN),
        ],
        bookings: ["завтра, 11:30 — мужская стрижка"],
      },
      {
        ref: { channelId: "web", externalId: "s-7f3a91" },
        bot: { state: "active" },
        messages: [
          msg("contact", "А детей стрижёте? Сыну 6 лет", 2 * HOUR),
          msg("bot", "Да, детская стрижка — 4 000 ₸, около 40 минут. Подобрать время?", 2 * HOUR),
        ],
      },
      {
        ref: { channelId: "wa", externalId: "77000550219" },
        name: "Тимур",
        phone: "+77000550219",
        bot: { state: "stopped" },
        messages: [
          msg("bot", "Тимур, напоминаем: сегодня в 12:00 мужская стрижка у Армана. Ждём вас!", 5 * HOUR),
          msg("contact", "стоп", 4 * HOUR),
          msg("bot", "Поняла, больше не буду присылать напоминания и рассылки. Напишите «старт», если передумаете.", 4 * HOUR),
        ],
      },
      {
        ref: { channelId: "ga", externalId: "77000553311" },
        name: "Ботагоз",
        phone: "+77000553311",
        attention: { reason: "call", label: "Ждёт звонка", since: now - 2 * HOUR - 10 * MIN },
        bot: { state: "active" },
        requests: [{ id: "rq-botagoz", kind: "callback", name: "Ботагоз", service: "Подарочный сертификат", time: "", note: "Перезвонить после 14:00" }],
        messages: [
          msg("contact", "Хочу купить подарочный сертификат мужу, перезвоните мне после 14:00", 2 * HOUR + 11 * MIN),
          msg("bot", "Передала администратору, он перезвонит вам после 14:00.", 2 * HOUR + 10 * MIN),
        ],
      },
      {
        ref: { channelId: "wa", externalId: "77000664912" },
        name: "Данияр",
        phone: "+77000664912",
        bot: { state: "active" },
        windowClosed: true,
        bookings: ["15 октября — стрижка и борода, мастер Арман (прошла)"],
        messages: [
          msg("contact", "Запишите на 15-е к Арману в 19:00", 3 * DAY),
          msg("bot", "Записала: 15 октября в 19:00, стрижка и оформление бороды у Армана.", 3 * DAY),
          msg("bot", "Данияр, спасибо, что были у нас! Оцените визит, пожалуйста: ссылка на отзыв в 2ГИС.", 2 * DAY + 20 * HOUR),
        ],
      },
      {
        ref: { channelId: "wa", externalId: "77000340018" },
        name: "Руслан",
        phone: "+77000340018",
        bot: { state: "paused", until: now + 9 * HOUR },
        messages: [
          msg("contact", "Почему так дорого? В соседнем барбершопе дешевле", 5 * HOUR + 30 * MIN),
          msg("bot", "Понимаю. Передала администратору — он расскажет, что входит в стоимость.", 5 * HOUR + 30 * MIN),
          msg("operator", "Руслан, в стоимость входят мытьё головы, укладка и горячее полотенце. Для первого визита сделаем скидку 10% — записать вас?", 5 * HOUR),
        ],
      },
    ],
    done: [
      { id: "l-old1", kind: "cancel", name: "Нурлан", phone: "+77000902135", service: "Детская стрижка", time: "вчера, 19:00", note: "Отменил администратор, клиенту сообщено", status: "выполнена", channelId: "wa", at: now - 26 * HOUR },
      { id: "l-old2", kind: "lead", name: "Канат", phone: "+77000144089", service: "Бритьё опасной бритвой", time: "16 октября, 15:30", note: "", status: "выполнена", channelId: "ga", at: now - 2 * DAY },
    ],
  };

  const serviceChannels: Channel[] = [
    { id: "abay-bot", kind: "wa_cloud", name: "ИИ-администратор", phone: "+77000002020", branchId: "abay", health: { level: "ok", text: "подключён" } },
    { id: "abay-main", kind: "green_api", name: "Абая — основной", phone: "+77000002121", branchId: "abay", health: { level: "ok", text: "подключён" } },
    { id: "mega-main", kind: "green_api", name: "Mega — основной", phone: "+77000003131", branchId: "mega", health: { level: "warn", text: "не привязан — отсканируйте QR-код" } },
    { id: "web", kind: "web", name: "" },
  ];
  const service: Fixture = {
    ws: {
      id: "demo-service",
      name: "Демо Сервис",
      botOff: false,
      branches: [
        { id: "abay", name: "Абая, 52", address: "пр. Абая, 52" },
        { id: "mega", name: "ТРЦ Mega", address: "ТРЦ Mega Silk Way, 2 этаж" },
      ],
      channels: serviceChannels,
      capabilities: { booking: false, campaigns: true },
    },
    convs: [
      {
        ref: { channelId: "abay-bot", externalId: "77000810011" },
        name: "Арман",
        phone: "+77000810011",
        unread: 1,
        attention: { reason: "lead", label: "Новая заявка", since: now - 14 * MIN },
        bot: { state: "active" },
        requests: [{ id: "rq-arman", kind: "lead", name: "Арман", service: "Замена дисплея iPhone 13", time: "сегодня до 18:00", note: "Оригинал, 52 000 ₸" }],
        messages: [
          msg("contact", "Сколько стоит замена экрана на iPhone 13?", 18 * MIN),
          msg("bot", "Замена дисплея iPhone 13: копия — 28 000 ₸, оригинал — 52 000 ₸, около часа. Оставить заявку?", 18 * MIN),
          msg("contact", "Да, оригинал. Сегодня успеете?", 15 * MIN),
          msg("bot", "Оставила заявку на сегодня. Мастер подтвердит время в этом чате.", 14 * MIN),
        ],
      },
      {
        ref: { channelId: "mega-main", externalId: "77000820022" },
        name: "Жанар",
        phone: "+77000820022",
        bot: { state: "paused", until: now + 50 * MIN },
        messages: [
          msg("contact", "Мой Samsung уже готов? Сдавала в понедельник", 70 * MIN),
          msg("operator", "Жанар, добрый день! Да, готов — можно забрать до 21:00.", 65 * MIN),
        ],
      },
      {
        ref: { channelId: "abay-main", externalId: "77000830033" },
        name: "Олжас",
        phone: "+77000830033",
        unread: 2,
        attention: { reason: "human", label: "Просит человека", since: now - 6 * MIN },
        bot: { state: "active" },
        messages: [
          msg("contact", "Принимаете старый телефон в зачёт нового?", 8 * MIN),
          msg("bot", "Оценку старого телефона делает мастер на месте. Передала ваш вопрос — он ответит здесь.", 7 * MIN),
          msg("contact", "iPhone 11, 128 ГБ, без царапин", 6 * MIN),
        ],
      },
      {
        ref: { channelId: "web", externalId: "s-11c0de" },
        bot: { state: "active" },
        messages: [
          msg("contact", "Есть защитные стёкла на Redmi Note 13?", 3 * HOUR),
          msg("bot", "Да, есть: 3 500 ₸, поклейка бесплатно. Филиалы: пр. Абая, 52 и ТРЦ Mega Silk Way.", 3 * HOUR),
        ],
      },
    ],
    done: [],
  };

  const empty: Fixture = {
    ws: {
      id: "demo-empty",
      name: "Новая компания",
      botOff: false,
      branches: [],
      channels: [{ id: "ga", kind: "green_api", name: "Основной WhatsApp", phone: "+77000009999", health: { level: "ok", text: "подключён" } }],
      capabilities: { booking: null, campaigns: false },
    },
    convs: [],
    done: [],
  };
  return [barber, service, empty];
}

const keyOf = (r: ConversationRef) => `${r.channelId}:${r.externalId}`;
const digits = (s?: string) => String(s || "").replace(/\D/g, "");

export function createDemoSource(): DataSource {
  const fx = build(Date.now());
  const role = () => (new URLSearchParams(location.search).has("staff") ? "staff" : "owner") as "owner" | "staff";
  const campaigns = createDemoCampaigns(role);
  const find = (ws: string) => {
    const f = fx.find((x) => x.ws.id === ws);
    if (!f) throw new ApiError("Нет доступа к этому клиенту.", 403);
    return f;
  };
  const conv = (ws: string, ref: ConversationRef) => {
    const c = find(ws).convs.find((x) => keyOf(x.ref) === keyOf(ref));
    if (!c) throw new ApiError("Чат не найден.", 404);
    return c;
  };
  const bot = (f: Fixture, c: Conv): BotState => (f.ws.botOff ? { state: "off" } : c.bot.state === "paused" && c.bot.until <= Date.now() ? { state: "active" } : c.bot);
  const reply = (f: Fixture, c: Conv): ReplyState => {
    const ch = f.ws.channels.find((x) => x.id === c.ref.channelId);
    if (ch?.kind === "web") return { allowed: false, reason: "web", text: "Это чат с сайта — ответить в него нельзя. Позвоните клиенту, если он оставил номер." };
    if (c.windowClosed) return { allowed: false, reason: "window", text: "Клиент писал больше 24 часов назад — WhatsApp не даёт написать первым. Позвоните ему или дождитесь сообщения." };
    const lastIn = [...c.messages].reverse().find((m) => m.from === "contact");
    return { allowed: true, closesAt: ch?.kind === "wa_cloud" && lastIn ? lastIn.at + DAY : undefined };
  };
  const summary = (f: Fixture, c: Conv): ConversationSummary => {
    const last = c.messages.at(-1);
    const lastIn = [...c.messages].reverse().find((m) => m.from === "contact");
    return {
      key: keyOf(c.ref),
      ref: c.ref,
      contact: { key: digits(c.phone) || `web:${c.ref.externalId}`, name: c.name, phone: c.phone },
      lastAt: last?.at || 0,
      lastInboundAt: lastIn?.at,
      preview: last ? (last.media ? "Фото" : last.text) : "",
      previewFrom: last?.from ?? null,
      attention: c.attention ?? null,
      bot: bot(f, c),
      hasBooking: !!c.bookings?.length,
      unreadCount: c.unread || 0,
      unread: !!c.unread,
    };
  };
  const detail = (f: Fixture, c: Conv): ConversationDetail => ({
    key: keyOf(c.ref),
    ref: c.ref,
    contact: { key: digits(c.phone) || `web:${c.ref.externalId}`, name: c.name, profileName: c.profileName, phone: c.phone },
    messages: c.messages.map((m) => ({ ...m })),
    attention: c.attention ?? null,
    bot: bot(f, c),
    bookings: c.bookings || [],
    pending: c.pending || [],
    bookedNote: "",
    requests: c.requests || [],
    reply: reply(f, c),
    payment: f.payment,
  });

  return {
    mode: "demo",
    async session() {
      await wait(80);
      const q = new URLSearchParams(location.search).get("c");
      return { role: role(), workspaceId: fx.some((f) => f.ws.id === q) ? q : "demo" };
    },
    async workspaces() {
      return fx.map((f) => ({ id: f.ws.id, name: f.ws.name, kind: f.ws.id === "demo" ? "Барбершоп" : f.ws.id === "demo-service" ? "Ремонт и продажа телефонов" : "Без чатов" }));
    },
    async inbox(ws): Promise<InboxSnapshot> {
      await wait(380);
      const f = find(ws);
      const conversations = f.convs.map((c) => summary(f, c)).sort((a, b) => b.lastAt - a.lastAt);
      return { workspace: structuredClone(f.ws), conversations, truncated: null, now: Date.now() };
    },
    async channelReport(ws): Promise<ChannelReport> {
      await wait(700);
      const f = find(ws);
      const idOf = (ch: "main" | "bot") => f.ws.channels.find((c) => c.kind === (ch === "bot" ? "green_api" : "wa_cloud"))?.id;
      return { channels: structuredClone(f.ws.channels), optouts: f.ws.id === "demo" ? 3 : 0, campaigns: campaigns.rows(f.ws.id, idOf), owner: role() === "owner" };
    },
    async conversation(ws, ref) {
      await wait(220);
      const f = find(ws), c = conv(ws, ref);
      c.unread = 0;
      return detail(f, c);
    },
    async send(ws, ref, text) {
      await wait(450);
      const f = find(ws), c = conv(ws, ref);
      const r = reply(f, c);
      if (!r.allowed) throw new ApiError(r.text, 409);
      c.messages.push({ id: `op${Date.now()}`, from: "operator", text, at: Date.now() });
      if (c.bot.state === "active" || c.bot.state === "paused") c.bot = { state: "paused", until: Date.now() + 2 * HOUR };
      delete c.attention;
      return detail(f, c);
    },
    async act(ws, ref, act) {
      await wait(300);
      const f = find(ws), c = conv(ws, ref);
      if (act === "pause") c.bot = { state: "paused", until: Date.now() + 12 * HOUR };
      else if (act === "resume") {
        if (c.bot.state === "stopped") throw new ApiError("Клиент сам попросил не писать ему автоматически. Бот вернётся, когда клиент напишет «старт».", 409);
        c.bot = { state: "active" };
        delete c.attention;
      } else if (act === "resolve") {
        if (c.requests?.length) throw new ApiError("В чате есть невыполненная просьба клиента (отмена, перенос, заявка или звонок). Нажмите «Сделано» в карточке — тогда чат закроется сам.", 409);
        delete c.attention;
      } else if (act === "forget") {
        c.messages = [];
        c.requests = [];
        c.bookings = [];
        delete c.attention;
      }
      return detail(f, c);
    },
    async complete(ws, ref, leadId, text) {
      await wait(400);
      const f = find(ws), c = conv(ws, ref);
      const q = c.requests?.find((x) => x.id === leadId);
      if (!q) throw new ApiError("Заявка не найдена.", 404);
      if (text) {
        if (!reply(f, c).allowed) throw new ApiError("Сообщение не отправлено: клиенту сейчас нельзя написать.", 409);
        c.messages.push({ id: `op${Date.now()}`, from: "operator", text, at: Date.now() });
        c.bot = { state: "paused", until: Date.now() + 10 * MIN };
      }
      c.requests = c.requests!.filter((x) => x.id !== leadId);
      f.done.unshift({ id: q.id, kind: q.kind, name: q.name, phone: c.phone || "", service: q.service, time: q.time, note: "Выполнено в пульте", status: "выполнена", channelId: c.ref.channelId, at: Date.now() });
      delete c.attention;
      return detail(f, c);
    },
    async leads(ws) {
      await wait(300);
      const f = find(ws);
      const open: Lead[] = f.convs.flatMap((c) =>
        (c.requests || []).map((q) => ({ id: q.id, kind: q.kind, name: q.name, phone: c.phone || "", service: q.service, time: q.time, note: q.note, status: "", channelId: c.ref.channelId, at: c.attention?.since || c.messages.at(-1)?.at || 0 })),
      );
      return [...open, ...f.done];
    },
    ...campaigns.api,
    externalUrl() {
      return null;
    },
  };
}
