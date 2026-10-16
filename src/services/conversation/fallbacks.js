// @ts-check
// Готовые фразы, которые бот говорит без ИИ: сбой ИИ, защита заменила ответ, согласие на обработку данных, голосовое и файлы.
// До 16.10.2026 они были только по-русски: клиент, писавший по-казахски или по-английски, получал ответ на чужом языке.
// Фраза паспорта c.safe написана владельцем по-русски, перевести её нельзя — для kk/en общая фраза с телефоном из неё же.
/** @import { Env } from "../../lib/types.js" */

/** @param {string} lang @param {string} ru @param {string} kk @param {string} en */
const pick = (lang, ru, kk, en) => lang === "kk" ? kk : lang === "en" ? en : ru;

/** телефон, который владелец вписал в фразу паспорта («уточните у администратора: +7 700 505 05 03») @param {any} c */
const phoneOf = c => ((String((c && c.safe) || "").match(/\+?\d[\d ()-]{8,}\d/) || [])[0] || "").trim();

/** «точно скажет администратор» на языке клиента @param {any} c @param {string} lang @returns {string} */
export function safeText(c, lang) {
  if (lang !== "kk" && lang !== "en") return c.safe;
  const ph = phoneOf(c);
  return pick(lang, "", `Мұны әкімші нақтылап береді${ph ? ": " + ph : ""}.`, `The administrator will confirm this for you${ph ? ": " + ph : ""}.`);
}

/** заготовка вместо ответа ИИ, который не прошёл защиту @param {any} c @param {string} lang @returns {string} */
export function safeAsk(c, lang) {
  return c.booking === "none"
    ? `${safeText(c, lang)} ${pick(lang, "Оставьте, пожалуйста, имя и телефон — администратор свяжется с вами.", "Атыңыз бен телефон нөміріңізді қалдырыңызшы — әкімші сізбен хабарласады.", "Please leave your name and phone number — the administrator will contact you.")}`
    : `${safeText(c, lang)} ${pick(lang, "Подобрать вам удобное время?", "Ыңғайлы уақыт таңдап берейін бе?", "Shall I find a convenient time for you?")}`;
}

/** ИИ не ответил @param {string} lang */
export const fallbackText = lang => pick(lang, "Спасибо за сообщение! Администратор ответит вам в ближайшее время.", "Хабарламаңызға рахмет! Әкімші сізге жақын арада жауап береді.", "Thank you for your message! The administrator will reply to you shortly.");
/** ИИ не успел (таймаут) @param {string} lang */
export const cutOffText = lang => pick(lang, "Извините, связь прервалась. Повторите, пожалуйста, вопрос?", "Кешіріңіз, байланыс үзіліп қалды. Сұрағыңызды қайталап жібересіз бе?", "Sorry, the connection dropped. Could you repeat your question, please?");

/** согласие на обработку данных (первое сообщение в WhatsApp). CONSENT_TEXT владельца — как есть @param {Env} env @param {any} c @param {string=} lang */
export function consentText(env, c, lang = "ru") {
  if (env.CONSENT_TEXT) return env.CONSENT_TEXT.replace("{name}", c.name);
  return pick(lang,
    `Вам отвечает AI-ассистент «${c.name}». Продолжая переписку, вы соглашаетесь на обработку ваших данных для записи. Позвать администратора — напишите «администратор».`,
    `Сізге «${c.name}» AI-көмекшісі жауап береді. Хат алмасуды жалғастыра отырып, жазылу үшін деректеріңізді өңдеуге келісесіз. Әкімшіні шақыру үшін «әкімші» деп жазыңыз.`,
    `You are chatting with the AI assistant of “${c.name}”. By continuing, you agree to the processing of your data for booking. To reach the administrator, write “administrator”.`);
}

/** ответ на голосовое, фото, файл, геолокацию, стикер @param {string} kind @param {string} lang */
export function mediaReply(kind, lang) {
  if (kind === "audio") return pick(lang, "Я пока не умею слушать голосовые — напишите, пожалуйста, текстом. Сообщение передала администратору.", "Мен әзірге дауыстық хабарламаны тыңдай алмаймын — мәтінмен жазыңызшы. Хабарламаны әкімшіге бердім.", "I can't listen to voice messages yet — please write your question as text. I've passed your message to the administrator.");
  if (kind === "sticker") return pick(lang, "Чем могу помочь? Напишите, пожалуйста, вопрос текстом.", "Немен көмектесе аламын? Сұрағыңызды мәтінмен жазыңызшы.", "How can I help? Please write your question as text.");
  if (kind === "location" || kind === "contact") return pick(lang, "Спасибо, передала администратору. Чем ещё могу помочь?", "Рахмет, әкімшіге бердім. Тағы немен көмектесе аламын?", "Thank you, I've passed it to the administrator. How else can I help?");
  return pick(lang, "Спасибо, файл получила и передала администратору. Напишите, пожалуйста, текстом, чем помочь?", "Рахмет, файлды алып, әкімшіге бердім. Немен көмектесу керек екенін мәтінмен жазыңызшы.", "Thank you, I've received the file and passed it to the administrator. Please write as text how I can help.");
}
