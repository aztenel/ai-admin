// @ts-check
// Ближайшая запись клиента в Altegio — в карточке чата (ТЗ v2.0 §1 п. 2, §7): номер записи, дата и время по Астане, мастер, услуги,
// состояние и откуда запись. Только чтение журнала (GET /records). Журнал локации на 30 дней вперёд читается раз в 3 минуты на
// экземпляр Worker и раскладывается по номерам — открытие чата не делает отдельных запросов к Altegio (у него 5 запросов в секунду).
/** @import { Env, Client } from "../../lib/types.js" */
import { isoDay } from "../../lib/time.js";
import { normPhone } from "../../lib/phone.js";
import { altRecordsRange } from "../integrations/altegio/records-api.js";
import { altText } from "../integrations/altegio/client.js";
import { altUserKey } from "../booking/journal.js";
import { altLoc } from "../booking/book.js";

const TTL = 180e3;
/** @type {Map<string, { at: number, byPhone: Map<string, any[]>, pending?: Promise<any> }>} */
const cache = new Map();

// откуда запись: сайт (наша форма пишет пометку), онлайн-запись Altegio, бот, администратор
/** @param {any} r */
function sourceOf(r) {
  const cm = String(r.comment || "");
  if (/winchester\.kz|с сайта/i.test(cm)) return "сайт";
  if (/ПРОБНАЯ|бот|AI-администратор/i.test(cm)) return "бот";
  if (r.online === true || r.online === 1) return "онлайн-запись";
  return "администратор";
}
/** @param {any} r */
const stateOf = r => (+r.attendance === 1 || +r.visit_attendance === 1 ? "пришёл" : +r.attendance === -1 ? "не пришёл" : +r.confirmed === 1 ? "подтверждена" : "ожидается");

/** Записи клиента от 2 часов назад и дальше, ближайшие первыми. null — журнала нет (нет ключа или локации).
 *  @param {Env} env @param {Client} c @param {string} phone @param {number} now */
export async function bookingCard(env, c, phone, now) {
  const user = altUserKey(env, c), loc = altLoc(env, c), want = normPhone(phone).slice(1);
  if (!user || !loc || !want) return null;
  const key = `${c.id}:${loc}`;
  let e = cache.get(key);
  if (!e || now - e.at > TTL) {
    if (e && e.pending) await e.pending;
    else {
      const job = altRecordsRange(env, user, loc, isoDay(now - 86400e3), isoDay(now + 30 * 86400e3), 6).then(r => {
        /** @type {Map<string, any[]>} */
        const byPhone = new Map();
        for (const x of r.list) {
          if (!x || x.deleted === true || x.deleted === 1 || !x.client) continue;
          const p = normPhone(String(x.client.phone ?? "")).slice(1); if (!p) continue;
          const dt = String(x.datetime || "");
          const v = { id: String(x.id), at: Date.parse(dt) || 0, date: dt.slice(0, 10), time: dt.slice(11, 16), staff: altText((x.staff && x.staff.name) || "", 40),
            services: (Array.isArray(x.services) ? x.services : []).map(/** @param {any} s */ s => altText(s && s.title, 60)).filter(Boolean).join(", "),
            minutes: Math.round((+x.seance_length || +x.length || 0) / 60) || undefined, state: stateOf(x), source: sourceOf(x) };
          byPhone.set(p, [...(byPhone.get(p) || []), v]);
        }
        cache.set(key, { at: Date.now(), byPhone });
      }).finally(() => { const c2 = cache.get(key); if (c2) delete c2.pending; });
      cache.set(key, { at: e ? e.at : 0, byPhone: e ? e.byPhone : new Map(), pending: job });
      await job;
    }
    e = cache.get(key);
  }
  return ((e && e.byPhone.get(want)) || []).filter(x => x.at > now - 2 * 3600e3).sort((a, b) => a.at - b.at).slice(0, 3);
}
/** для тестов */
export const bookingCardReset = () => cache.clear();
