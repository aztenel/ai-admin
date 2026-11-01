/**
 * Строки интерфейса. Сейчас только русский; казахский и английский добавляются
 * ещё одним словарём с теми же ключами (тип `UI` не даст забыть строку)
 * и страницами в src/pages/kk/, src/pages/en/ (см. README.md, «Локализация»).
 */
export const languages = { ru: "Русский" } as const;
export type Lang = keyof typeof languages;
export const defaultLang: Lang = "ru";

const ru = {
  "nav.services": "Услуги",
  "nav.work": "Работы",
  "nav.about": "О студии",
  "nav.contacts": "Контакты",
  "nav.menu": "Меню",
  "nav.close": "Закрыть меню",
  "nav.main": "Основная навигация",
  "cta.discuss": "Обсудить проект",
  "cta.work": "Посмотреть работу",
  "skip": "Перейти к содержанию",
  "footer.privacy": "Политика конфиденциальности",
  "footer.owner": "Сайт принадлежит",
};
export type UI = typeof ru;
export const ui: Record<Lang, UI> = { ru };

export const t = (key: keyof UI, lang: Lang = defaultLang) => ui[lang][key];

/** Путь с учётом языка: у основного языка префикса нет. */
export const localePath = (path: string, lang: Lang = defaultLang) => (lang === defaultLang ? path : `/${lang}${path}`);

export const nav = (lang: Lang = defaultLang) => [
  { href: localePath("/services/", lang), label: t("nav.services", lang) },
  { href: localePath("/cases/winchester/", lang), label: t("nav.work", lang), match: "/cases/" },
  { href: localePath("/about/", lang), label: t("nav.about", lang) },
  { href: localePath("/contacts/", lang), label: t("nav.contacts", lang) },
];
