// @ts-check
// Определение языка сообщения клиента (ru / kk / en).
// Язык сообщения; prev — язык прошлых сообщений этого чата. Латиница сама по себе — не английский («Camry R16», «Kaspi», «Azamat», «privet»):
// английский — когда есть обычные английские слова, казахский — когда есть казахские. Имя или короткий ответ языка чата не меняют
const EN_WORDS = new Set("hi hello hey yes no not the an is are am do does did can could would will how much many what when where which who why for and or to at on in of with my me you your we it this that please thanks thank have has there any some today tomorrow time free available open book booking appointment haircut cut beard price cost need needed want cleaning teeth tooth good morning evening afternoon speak english men women kids child".split(" "));
const EN_STRONG = new Set("hello hi hey please thanks thank haircut appointment booking price tomorrow today how what when where which the english".split(" "));
const KK_LAT = /^(salem|salam|salemetsiz\w*|assalau\w*|aleikum|rakhmet|rahmet|raqmet|jaqsy|jaksy|zhaksy|joq|jok|zhok|ia|iya|qansha|kansha|turady|kerek|jazyl\w*|jazyp|qalay\w*|qalai\w*|sizde|bugin|erten|keledi|kelemin|kelsem|kelem|kelmeimin|emes|tis\w{0,3}|auyr\w+|qai|qay|kun|kuni|bos|saiyn|jumys|iste\w{3,}|saqal|sakal|shash|sagat|uaqyt|qashan|qaida|bola|bar|ma)$/;
const KK_CYR = /(^|[^а-яё])(салем|салам|саламатсыз\S*|салеметсиз\S*|рахмет|ракмет|жарайды|жаксы|жок|иа|канша|турады|керек|ертен|бугин|казир|сагат|уакыт|калай\S*|кайда|кашан|жазыл\S*|тис|шаш\s+кию)(?![а-яё])/i;
const RU_WORDS = /(^|[^а-яё])(и|в|на|не|что|как|это|или|но|для|мне|меня|я|вы|вас|вам|мы|у|к|с|по|за|есть|можно|хочу|нужно|надо|сколько|стоит|когда|где|завтра|сегодня|запишите|записать|записаться|запись|время|пожалуйста|спасибо|здравствуйте|привет|добрый|хорошо|отмените|перенесите|цена|адрес|мой|моя|мое|мои|ваш|ваша|этот|эта|номер|телефон|имя|зовут|буду|будет|приду|давайте|тогда|тоже|только|уже|еще|очень|сейчас|утром|вечером|нужен|нужна|понятно|отлично|ладно|стрижк[аиу]|ли|до|предоплат[аыу]|подойти|прийти|оплат[аыу]|стрижку|бород[аыу])(?![а-яё])/i;
const KK_CYR_G = new RegExp(KK_CYR.source, "gi"), RU_WORDS_G = new RegExp(RU_WORDS.source, "gi");
/** @param {string} t @param {string} [prev] */
export function detectLang(t, prev) {
  t = String(t || "");
  if (/[әғқңөұүһі]/i.test(t)) return "kk";
  const lat = (t.match(/[a-z]/gi) || []).length, cyr = (t.match(/[а-яё]/gi) || []).length;
  if (lat > cyr) {
    const w = (t.toLowerCase().match(/[a-z]+(?:['’][a-z]+)?/g) || []).map(x => x.replace(/['’]s$/, ""));
    const kk = w.filter(x => KK_LAT.test(x)).length, en = w.filter(x => EN_WORDS.has(x)).length;
    if (kk > 0 && kk >= en) return "kk"; // «men» — и казахское «я», и английское «мужской»: решают соседние слова
    if (en >= 2 || (en > 0 && (en === w.length || w.some(x => EN_STRONG.has(x))))) return "en";
    return prev || "ru";                 // марка, имя или русский текст латиницей («my hotim zapisatsya»)
  }
  if (cyr > 0) {
    const kkN = (t.match(KK_CYR_G) || []).length, ruN = (t.match(RU_WORDS_G) || []).length;
    if (kkN && kkN > ruN) return "kk"; // казахских слов больше, чем русских служебных: «Рахмет», «Салем, канша турады?»; «Салам, сколько стоит стрижка?» — по-русски
    if (prev === "kk" && !RU_WORDS.test(t)) return "kk"; // «Тимур Ахметов, +7…» после казахского сообщения — язык прежний
    return "ru";
  }
  return prev || "ru"; // цифры, «+», смайлик
}
