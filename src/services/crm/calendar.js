// @ts-check
// Календарь (ТЗ v2.0 §6, v3.0 31.10.2026): этот месяц с 1-го числа и весь следующий, по Астане. По каждому дню отдельно —
// сервисные (напоминания и отзывы в очереди по видам) и реклама (автосценарий «Пора на стрижку»: кто в этот день дойдёт до N дней
// с визита, кому можно, почему остальным нельзя). Только числа, без номеров. Прошедшие дни месяца — без плана рекламы (null):
// прошедшие рассылки — в списке рассылок. Реклама — по свежему снимку и правилам «только с согласием, 30 дней между рекламой».
// Это план, а не обещание отправки: в день отправки всё проверяется ещё раз (sender.js). Снимок читается один раз (crmView).
/** @import { Env, Client } from "../../lib/types.js" */
import { isoDay, local } from "../../lib/time.js";
import { crmView } from "./segments.js";
import { autoGet } from "./auto.js";
import { serviceInfo } from "../reminders/info.js";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
/** @param {string} s ГГГГ-ММ-ДД */
const dayNo = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400e3;

/** @param {Env} env @param {Client} c @param {number} now */
export async function calendarOf(env, c, now) {
  const L = local(now), y = L.getUTCFullYear(), m = L.getUTCMonth(), today = isoDay(now), t0 = dayNo(today);
  const days = /** @type {string[]} */ ([]);
  for (let t = Date.UTC(y, m, 1), end = Date.UTC(y, m + 2, 0); t <= end; t += 86400e3) days.push(new Date(t).toISOString().slice(0, 10));
  const month = [0, 1].map(k => { const d = new Date(Date.UTC(y, m + k, 1)); return { id: d.toISOString().slice(0, 7), label: MONTHS[d.getUTCMonth()] }; });
  /** @type {Record<string, any>} */
  const out = Object.fromEntries(days.map(d => [d, { date: d, wd: new Date(dayNo(d) * 86400e3).getUTCDay(), past: d < today, today: d === today,
    service: { total: 0, kinds: /** @type {Record<string, number>} */ ({}) }, marketing: null }]));
  // сервисные: очередь по дням отправки (часы Астаны)
  try {
    const s = await serviceInfo(env, c, now);
    for (const x of (s && s.queue) || []) {
      const cell = out[isoDay(+x.at || 0)];
      if (!cell) continue;
      cell.service.total++; cell.service.kinds[x.k] = (cell.service.kinds[x.k] || 0) + 1;
    }
  } catch (e) { console.log("calendar service", String(e).slice(0, 100)); }
  // реклама: кто в день k (0 — сегодня) наберёт ровно N дней с визита; прошедшие дни — без плана
  /** @type {any} */ let auto = null, at = 0;
  if (c.crm) {
    try {
      auto = await autoGet(env, c.id);
      const view = await crmView(env, c, now);
      at = view.snap ? view.snap.at : 0;
      for (const d of days) {
        const k = dayNo(d) - t0;
        if (k < 0) continue;
        const cand = view.rows.filter(x => x.d + k === auto.days), why = /** @type {Record<string, number>} */ ({});
        for (const x of cand) if (x.why) why[x.why] = (why[x.why] || 0) + 1;
        const ok = cand.filter(x => !x.why).length;
        out[d].marketing = { candidates: cand.length, allowed: ok, planned: auto.on && auto.tpl ? Math.min(ok, auto.cap) : 0, excluded: why };
      }
    } catch (e) { console.log("calendar crm", String(e).slice(0, 100)); }
  }
  return { today, weekday0: L.getUTCDay(), from: days[0], to: days[days.length - 1], month,
    auto: auto ? { on: !!auto.on, days: auto.days, cap: auto.cap, tpl: !!auto.tpl } : null, baseAt: at, days: days.map(d => out[d]) };
}
