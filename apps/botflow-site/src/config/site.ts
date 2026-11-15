/**
 * Единственное место, где хранятся бренд, юридические сведения и контакты.
 *
 * Правило: на сайт выводится только заполненное. Пустая строка = поля нет на сайте.
 * Ничего не вписывать «для вида»: Meta сверяет сайт с документами буква в букву
 * (опыт Winchester, октябрь 2026: отказ из-за кириллицы вместо латиницы в названии ИП).
 *
 * Что заполнить перед подачей в Meta — `npm run check:meta` и docs в README.md.
 */

/** Публичный бренд. Когда появится постоянное название — поменять только здесь. */
export const BRAND = "TAYVENO";

/** Боевой адрес сайта (сборка в Cloudflare Workers Builds берёт его, если SITE_URL не задан). */
export const PRODUCTION_URL = "https://tayveno.xyz";

export const legal = {
  /**
   * Наименование ИП буква в букву как в п. 3 уведомления о начале деятельности ИП
   * (с QR-кодом, подано 01.10.2026): латиница, заглавные только первые буквы.
   * Это же писать в форме Meta. Публичное название студии — BRAND (TAYVENO), оно не заменяет название ИП.
   */
  registeredName: "Bot Flow",
  /** Как называть в тексте: организационно-правовая форма + наименование из документа. */
  name: "ИП Bot Flow",
  /** Сверено владельцем и помощником с уведомлением 01.11.2026. */
  nameVerified: true,
  form: "Индивидуальный предприниматель",
  country: "Республика Казахстан",
  /** Город из адреса места нахождения в уведомлении (п. 6). */
  city: "Астана",
  /**
   * ИИН ИП (в уведомлении — ИИН физического лица) и полный адрес места нахождения (п. 6).
   * В документе адрес — квартира, то есть домашний адрес; ИИН — личный номер.
   * Публиковать только по решению владельца, буква в букву как в документе. В репозиторий без решения не вписывать.
   */
  bin: "",
  address: "",
  /** Документ о регистрации — как он назван в самом документе, с датой подачи. */
  registration: "Уведомление о начале деятельности в качестве индивидуального предпринимателя от 01.10.2026",
  /** Виды деятельности (ОКЭД) — п. 4 уведомления, в том же порядке и теми же словами. */
  activities: [
    "62013 Деятельность по управлению проектом в области информационных технологий",
    "62014 Деятельность в области разработки технической документации и системной архитектуры",
    "62012 Сопровождение программного обеспечения, программных продуктов, баз данных, интернет-ресурсов (сайтов), информационных систем",
    "62011 Деятельность в области разработки и тестирования программного кода",
    "62020 Консультационные услуги в области информационных технологий",
  ],
};

export const contacts = {
  /** Почта на своём домене предпочтительнее: Meta может прислать код подтверждения на неё. */
  email: "info@tayveno.xyz",
  /** Телефон в международном формате, например +7 700 000 00 00. */
  phone: "",
  /** Номер WhatsApp только цифрами, например 77000000000. */
  whatsapp: "",
  /** Имя пользователя Telegram без @. */
  telegram: "",
  /** Город для блока «Где мы находимся», если владелец решит его указать. */
  city: "",
};

/**
 * Форма на странице «Контакты». Включается переменной окружения сборки
 * PUBLIC_CONTACT_FORM=1, когда в Cloudflare Pages заданы TG_TOKEN и TG_CHAT
 * (сообщения из формы приходят в Telegram, см. functions/api/contact.ts).
 */
export const contactForm = {
  enabled: import.meta.env.PUBLIC_CONTACT_FORM === "1",
  endpoint: "/api/contact",
};

export const site = {
  brand: BRAND,
  /** Короткое описание деятельности: title главной, описание в поиске, Open Graph. */
  tagline: "Разработка и автоматизация бизнес-процессов в Казахстане",
  description:
    "Разрабатываем сайты, CRM и ERP, интеграции и AI-автоматизацию, подключаем WhatsApp Business Platform для компаний в Казахстане.",
  locale: "ru_RU",
  lang: "ru",
  /** Редакция политики конфиденциальности. */
  privacyUpdated: "11 ноября 2026 года",
};

/** Заполненные способы связи — в том порядке, в каком их показывать. */
export function contactChannels() {
  const list: { kind: string; label: string; value: string; href: string }[] = [];
  if (contacts.email) list.push({ kind: "email", label: "Почта", value: contacts.email, href: `mailto:${contacts.email}` });
  if (contacts.phone) list.push({ kind: "phone", label: "Телефон", value: contacts.phone, href: `tel:${contacts.phone.replace(/[^+\d]/g, "")}` });
  if (contacts.whatsapp) list.push({ kind: "whatsapp", label: "WhatsApp", value: `+${contacts.whatsapp}`, href: `https://wa.me/${contacts.whatsapp}` });
  if (contacts.telegram) list.push({ kind: "telegram", label: "Telegram", value: `@${contacts.telegram}`, href: `https://t.me/${contacts.telegram}` });
  return list;
}

/** Есть ли хоть один способ связаться: канал или включённая форма. */
export const canContact = () => contactChannels().length > 0 || contactForm.enabled;

/** Юридические строки для подвала и страниц — только заполненные. */
export function legalRows(full = true) {
  const rows: { label: string; value: string }[] = [
    { label: "Наименование ИП", value: legal.registeredName },
    { label: "Организационно-правовая форма", value: legal.form },
  ];
  if (legal.bin) rows.push({ label: "ИИН/БИН", value: legal.bin });
  rows.push({ label: "Страна", value: legal.country });
  if (full && legal.city && !legal.address) rows.push({ label: "Город", value: legal.city });
  if (legal.address) rows.push({ label: "Адрес места нахождения", value: legal.address });
  if (full && legal.registration) rows.push({ label: "Регистрация", value: legal.registration });
  return full ? rows : rows.filter((r) => r.label !== "Организационно-правовая форма");
}

/** Кто стоит за брендом — одной фразой: публичное название студии и ИП, которое оказывает услуги и владеет сайтом. */
export const ownerLine = () => `${BRAND} — публичное название студии. Владелец сайта и исполнитель услуг: ${legal.name}, ${legal.country}.`;
