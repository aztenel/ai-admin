// @ts-check
// Записи клиента и журнал Altegio: удалена ли запись, забыть удалённые, записи чата из журнала.
/** @import { Env, Client, Profile } from "../../lib/types.js" */
import { altCall, altText } from "../integrations/altegio/client.js";
import { altJournal } from "../integrations/altegio/journal-api.js";
import { ALT_GONE_AGE } from "../../config/constants.js";
import { altBase, altTimes } from "../integrations/altegio/booking-api.js";
import { hm, TZ, isoDay, hhmm, local } from "../../lib/time.js";
import { lowE } from "../../lib/text.js";
import { svTrim } from "../../lib/names.js";


// Удалена ли запись в Altegio (администратор удалил её прямо в журнале или клиента там отменили).
// true — удалена; false — на месте; null — не знаем (тогда запись считаем существующей). b — { record_id, record_hash, date, time, staffName, loc }
let altNoGet = false; // Altegio не даёт читать запись (405) — больше не спрашиваем
/** @param {Env} env @param {Record<string, any>} b @param {any} loc @param {number} nowMs @returns {Promise<boolean | null>} */
export async function altIsGone(env, b, loc, nowMs) {
  let g = null;
  // 1) спрашиваем саму запись
  if (b.record_hash && !altNoGet) {
    try {
      const d = await altCall(env, "GET", `/user/records/${b.record_id}/${b.record_hash}`);
      if (d && (d.deleted === true || d.deleted === 1)) g = true;
      else if (d && typeof d === "object" && "deleted" in d) g = false; // Altegio прямо сказал: запись на месте
      const sn = d && !Array.isArray(d) && d.staff && typeof d.staff === "object" ? altText(d.staff.name, 60) : "";
      if (!b.staffName && sn) b.staffName = sn; // запись к «любому» мастеру: узнаём, к кому её поставили
    } catch (/** @type {any} */ e) {
      if (e && e.status === 405) altNoGet = true; // вживую 10 октября: чтение записи ключом разработчика — 405 MethodNotAllowed
      else if (e && e.status === 404 && /не\s*найден|not\s*found|не\s*существ|удал/i.test(e.message || "")) g = true; else console.log("alt check", b.record_id, String(e));
    }
  }
  // 2) прямого ответа нет (ошибка или ответ без поля deleted) — смотрим время мастера: запись занимает его время,
  // а если оно снова свободно — записи нет. Мастер записи неизвестен (старая запись к «любому») — время должно быть свободно у всех мастеров
  // Вживую 10 октября (/altegio, пробная запись к мастеру): пока запись есть, время мастера «занято» и проверка записи (book_check) не проходит (422);
  // после удаления — «свободно» и проходит. Удалённой считаем запись, только если сходятся оба признака и запись создана больше 5 минут назад
  // (demo7 и demo10: в настоящем чате проверка ошибалась — причина не выяснена). Поэтому выключена; включает Text ALTEGIO_SLOT_CHECK = 1.
  // Надёжный путь — журнал Altegio (ALTEGIO_USER_<ID>, altJournal): с ним эта проверка не нужна
  if (g === null && b.record_hash && (b.loc || loc) && env.ALTEGIO_SLOT_CHECK === "1" && !(b.at && nowMs - b.at < ALT_GONE_AGE)) {
    try {
      const L = b.loc || loc, base = await altBase(env, L, nowMs), t0 = hm(b.time);
      const st = b.staffName ? base.staff.filter(/** @param {any} m */ m => lowE(m.base) === lowE(b.staffName) || lowE(m.name) === lowE(b.staffName)).slice(0, 1) : base.staff.length <= 12 ? base.staff : [];
      if (st.length) {
        const fr = await Promise.all(st.map(/** @param {any} m */ m => altTimes(env, L, m.id, b.date, [], nowMs, true)));
        let free = fr.every(/** @param {any} list */ list => list.some(/** @param {any} t */ t => t.time === t0));
        // второй признак — пробная проверка записи на это же время к этому же мастеру (если мастер и услуги известны)
        const svIds = String(b.services || "").split(" + ").map(/** @param {string} x */ x => (base.services.find(/** @param {any} v */ v => svTrim(v.title) === svTrim(x)) || {}).id);
        if (free && st.length === 1 && b.staffName && svIds.length && svIds.every(Boolean)) {
          const slot = fr[0].find(/** @param {any} t */ t => t.time === t0);
          try { await altCall(env, "POST", `/book_check/${L}`, { appointments: [{ id: 1, services: svIds, staff_id: st[0].id, datetime: slot.datetime || `${b.date}T${t0.padStart(5, "0")}:00+0${TZ}:00` }] }); }
          catch (e) { free = false; }
        }
        if (free) g = true;
      }
    } catch (e) { console.log("alt check times", b.record_id, String(e)); }
  }
  return g;
}

// Удалилась ли запись, когда Altegio не ответил на её удаление (перенос на пересекающееся время, проверка 19.10.2026: удаление дошло,
// ответ — нет; бот говорил «прежняя запись остаётся», а записи уже не было). Сначала сама запись (altIsGone; вживую чтение записи ключом
// разработчика бывает недоступно — 405), потом журнал по номеру клиента (ключ пользователя). true — удалена, false — на месте, null — не узнать
/** @param {Env} env @param {Record<string, any>} b @param {any} loc @param {number} nowMs @param {string} user @param {string} phone @returns {Promise<boolean | null>} */
export async function altGoneSure(env, b, loc, nowMs, user, phone) {
  let g = null;
  try { g = await altIsGone(env, b, loc, nowMs); } catch (e) { console.log("alt gone", String(e)); }
  if (g !== null || !user || !phone) return g;
  try { const j = await altJournal(env, user, loc, phone, nowMs); return j ? !j.some(x => String(x.record_id) === String(b.record_id)) : null; }
  catch (e) { console.log("alt gone journal", String(e)); return null; }
}

// Записи этого чата, которые удалили прямо в Altegio: бот о них забывает. Сбой связи — запись остаётся
/** @param {Env} env @param {Profile} prof @param {number} nowMs @param {any} loc */
export async function altPrune(env, prof, nowMs, loc) {
  const today = isoDay(nowMs), nowT = hhmm(local(nowMs));
  const list = (prof.bookings || []).filter(/** @param {any} b */ b => b && b.record_id && b.date >= today && !(b.date === today && b.time <= nowT));
  if (!list.length) return 0;
  /** @type {any[]} */
  const gone = [];
  let filled = 0;
  for (const b of list.slice(0, 4)) { // обычно одна-две записи
    const had = b.staffName;
    if (await altIsGone(env, b, loc, nowMs)) gone.push(b);
    if (!had && b.staffName) filled++;
  }
  if (!gone.length) return filled;
  prof.bookings = (prof.bookings || []).filter(/** @param {any} b */ b => !gone.includes(b));
  if (!prof.bookings.length) delete prof.bookings;
  if (prof.req && !(prof.bookings || []).some(/** @param {any} b */ b => b.rq)) delete prof.req; // просьба об отмене выполнена — записи больше нет
  prof.altGone = gone.filter(/** @param {any} b */ b => b.leadId != null).map(/** @param {any} b */ b => b.leadId).slice(0, 8); // заявки этих записей think() пометит «удалена в Altegio»
  return gone.length; // текст «Уже известно о клиенте» (profile.booked) пересчитывает think() — сразу после bookedText
}

// записи чата = записи из журнала; пометки бота (просьба об отмене, заявка, код записи) переносим по номеру записи.
// Записи, которых в журнале больше нет, — удалены в Altegio: их заявки помечаются «отменена»
/** @param {Profile} prof @param {any[]} list @param {number} nowMs */
export function altFromJournal(prof, list, nowMs) {
  const today = isoDay(nowMs), old = (prof.bookings || []).filter(/** @param {any} b */ b => b && b.date >= today), byId = new Map(old.filter(/** @param {any} b */ b => b.record_id).map(/** @param {any} b */ b => [String(b.record_id), b]));
  prof.bookings = list.map(j => { const o = byId.get(String(j.record_id)); return o ? { ...o, ...j, name: o.name || j.name } : j; });
  const ids = new Set(list.map(j => String(j.record_id)));
  const gone = old.filter(/** @param {any} b */ b => b.record_id && !ids.has(String(b.record_id)));
  if (!prof.bookings.length) delete prof.bookings;
  if (prof.req && !(prof.bookings || []).some(/** @param {any} b */ b => b.rq)) delete prof.req;
  const lids = gone.filter(/** @param {any} b */ b => b.leadId != null).map(/** @param {any} b */ b => b.leadId);
  if (lids.length) prof.altGone = [...new Set([...(prof.altGone || []), ...lids])].slice(-8);
  return gone.length;
}

// ---- журнал Altegio (ключ пользователя салона ALTEGIO_USER_<ID>): записи клиента бот берёт из CRM, а не из своей памяти.
// Вживую 10 октября (пробная локация): вход логином и паролем → user_token, GET /records/<локация> отдаёт записи с полями
// id, datetime, staff, client (с телефоном), services, deleted, attendance. Без ключа пользователя — прежний режим (память чата)
/** @param {Env} env @param {Client} c */
export const altUserKey = (env, c) => String(env["ALTEGIO_USER_" + String(c.id).toUpperCase()] || "").trim();
