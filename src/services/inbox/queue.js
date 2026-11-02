// @ts-check
// Очередь «Нужен ответ» (ТЗ v2.0 §2.1, 31.10.2026). В очередь попадает чат, где последнее значимое сообщение — от клиента и
// после него никто из людей не ответил. Исходящее (напоминание, рассылка, ответ с телефона) чат в очередь не ставит, а ответ
// человека — снимает. «Спасибо», «ок», смайлик, стикер в ответ на наше сообщение — не повод: раньше при выключенном боте
// каждое такое сообщение поднимало «Бот выключен — ждёт ответа», и очередь заполнялась чатами, где отвечать уже нечего.
// Тема входящего (запись, перенос, отмена, опоздание, «во сколько я записан») — пометка по словам, не решение ИИ: раздел
// «Записи и изменения». Ответ на напоминание или рассылку — когда наше автоматическое сообщение было последним в чате.
/** @import { Profile } from "../../lib/types.js" */

const norm = (/** @type {any} */ s) => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
// сообщение целиком — благодарность (на любое наше сообщение)
const THANKS = /^(спасибо|спс|спасибочки|благодарю|рахмет|рақмет|көп рахмет|үлкен рахмет|thanks?|thank you|thx)( (вам|большое|огромное|сізге|бір|сіз))*$/;
// «понятно / хорошо / ок» — не повод, если мы не задавали вопроса (на «Вам подходит 15:00?» «ок» — ответ, его надо записать)
const OKAY = /^(ок|окей|okay|ok|хорошо|хороше|харашо|ладно|понял|поняла|понятно|ясно|договорились|принято|отлично|супер|класс|жақсы|жарайды|түсінікті|келістік|болды|good|great|fine)( (спасибо|спс|рахмет|рақмет|thanks))?$/;
const PUNCT = /[\s.,!?…)(\-–—:;"'«»]+/g;
const ONLY_EMOJI = /^(?:[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}]|\+|\s)+$/u;

/** Сообщение — только подтверждение, отвечать на него не нужно. lastOut — наше последнее сообщение перед ним. @param {string} text @param {string} [lastOut] */
export function isAck(text, lastOut) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (ONLY_EMOJI.test(raw)) return true;
  // смайлики рядом со словами («Спасибо 👍») не мешают узнать благодарность
  const t = norm(raw).replace(/[\p{Extended_Pictographic}\u200d\ufe0f\u{1F3FB}-\u{1F3FF}]/gu, " ").replace(PUNCT, " ").replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (THANKS.test(t)) return true;
  return OKAY.test(t) && !/\?\s*\S{0,3}\s*$/.test(String(lastOut || ""));
}

// тема входящего: порядок важен — «не смогу прийти, перенесите» — перенос, «опаздываю на 10 минут» — опоздание
const TOPICS = /** @type {[string, RegExp][]} */ ([
  ["late", /опаздыва|опоздаю|опоздаем|задерж(усь|имся|иваюсь)|буду через \d|минут на \d+ позже|кешіг|кешігемін|running late|i'?ll be late/],
  ["move", /перенес|перенос|перезапи|другое время|другой день|пораньше|попозже|сдвин|передвин|ауыстыр|reschedul/],
  ["cancel", /отмен|не смогу прийти|не смогу подойти|не получится прийти|не приду|не придем|не прийду|бас тарт|келе алмаймын|cancel/],
  ["time", /во сколько (я|мы|у меня|мне)|на какое время|какое у меня время|напомните( мне)? время|когда (я|у меня) записан|сағат нешеде|қай уақытқа/],
  ["book", /запис|свободн|окошк|окно|есть время|есть место|можно (на|сегодня|завтра|в \d)|на сегодня|на завтра|жазыл|бос уақыт|бос орын|book/],
]);
/** @param {string} text @returns {string} */
export function topicOf(text) {
  const t = norm(text);
  for (const [k, re] of TOPICS) if (re.test(t)) return k;
  return "";
}

const REPLY_WINDOW = 7 * 86400e3;
/** Наше автоматическое сообщение, на которое клиент, похоже, отвечает: последнее перед ним в чате, без ответа человека после,
 *  не старше 7 дней. rm — напоминание или отзыв (reminders), bc — рассылка. @param {any[]} turns история ДО входящего @param {number} now */
export function replyTo(turns, now) {
  for (let i = (turns || []).length - 1; i >= 0; i--) {
    const x = turns[i];
    if (!x || x.role === "user") continue;
    if (x.by === "admin") return null; // после рассылки уже ответил человек — это обычная переписка
    if (x.rm || x.bc) return now - (+x.t || 0) <= REPLY_WINDOW ? { k: x.bc ? "bc" : "rm", id: String(x.bc || x.rm).slice(0, 40), at: +x.t || 0 } : null;
  }
  return null;
}

/**
 * Входящее сообщение клиента (бот молчит или занят человек): поднять «Нужен ответ» или нет. Меняет профиль.
 * Уже ждущий чат остаётся ждущим с прежним временем (сколько ждёт — с первого сообщения без ответа); «спасибо» его не снимает.
 * @param {Profile} p @param {any[]} turns история ДО входящего @param {{ text?: string, kind?: string, why: string, at: number }} msg
 */
export function inboundNeed(p, turns, msg) {
  delete p.done; // клиент написал снова — чат больше не «Готово»
  const lastOut = [...(turns || [])].reverse().find(x => x && x.role !== "user");
  const ack = msg.kind === "sticker" || msg.kind === "reaction" || (!msg.kind && isAck(msg.text || "", lastOut ? lastOut.text : ""));
  const src = replyTo(turns, msg.at);
  if (p.need) {
    if (!p.need.tp) { const tp = topicOf(msg.text || ""); if (tp) p.need.tp = tp; }
    return false;
  }
  if (ack) return false;
  /** @type {Record<string, any>} */
  const need = { at: msg.at, why: msg.why };
  const tp = topicOf(msg.text || ""); if (tp) need.tp = tp;
  if (src) need.src = src;
  p.need = need;
  return true;
}
