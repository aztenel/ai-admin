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
export const BRAND = "BOT FLOW";

export const legal = {
  /**
   * Наименование ИП ровно как в уведомлении о начале деятельности (с QR-кодом)
   * или в талоне о регистрации: тот же регистр, те же буквы (латиница/кириллица).
   * Сейчас — со слов владельца, со документом НЕ сверено (`nameVerified: false`).
   */
  name: "ИП BOT FLOW",
  nameVerified: false,
  /** Организационно-правовая форма полностью — для политики конфиденциальности. */
  form: "Индивидуальный предприниматель",
  country: "Республика Казахстан",
  /** ИИН/БИН ИП из того же документа. Публиковать только по решению владельца. */
  bin: "",
  /** Юридический адрес буква в букву как в документе (и как в форме Meta). По решению владельца. */
  address: "",
  /**
   * Документ о регистрации — как он называется в самом документе, с датой, например
   * «Уведомление о начале деятельности в качестве индивидуального предпринимателя от 01.01.2025».
   * Необязательно; выводится строкой «Регистрация» в сведениях о компании.
   */
  registration: "",
};

export const contacts = {
  /** Почта на своём домене предпочтительнее: Meta может прислать код подтверждения на неё. */
  email: "",
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
  tagline: "Студия разработки программного обеспечения в Казахстане",
  description:
    "Проектируем и разрабатываем сайты и веб-приложения, CRM и ERP, интеграции и AI-автоматизацию для компаний в Казахстане.",
  locale: "ru_RU",
  lang: "ru",
  /** Редакция политики конфиденциальности. */
  privacyUpdated: "1 ноября 2026 года",
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
export function legalRows() {
  const rows: { label: string; value: string }[] = [{ label: "Наименование", value: legal.name }];
  if (legal.bin) rows.push({ label: "ИИН/БИН", value: legal.bin });
  rows.push({ label: "Страна регистрации", value: legal.country });
  if (legal.address) rows.push({ label: "Юридический адрес", value: legal.address });
  if (legal.registration) rows.push({ label: "Регистрация", value: legal.registration });
  return rows;
}

/**
 * Кто стоит за сайтом — одной фразой. Без «X — коммерческое обозначение X»:
 * бренд и название ИП сейчас совпадают, и такая фраза читалась как опечатка.
 */
export const ownerLine = () => `Владелец сайта и исполнитель услуг: ${legal.name}, ${legal.country}.`;
