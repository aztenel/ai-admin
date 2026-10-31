// @ts-check
// Календарь на 14 дней (ТЗ v2.0 §6): по каждому дню отдельно — сервисные (напоминания и отзывы в очереди по видам) и реклама
// (автосценарий «Пора на стрижку»: кто в этот день дойдёт до N дней с визита, кому можно, почему остальным нельзя). Только числа,
// без номеров. Реклама — по свежему снимку и правилам «только с согласием, 30 дней между рекламой»; прошедшие рассылки — в списке
// рассылок. Это план, а не обещание отправки: в день отправки всё проверяется ещё раз (sender.js).
/** @import { Env, Client } from "../../lib/types.js" */
import { isoDay, local } from "../../lib/time.js";
import { crmView } from "./segments.js";
import { autoGet } from "./auto.js";
import { serviceInfo } from "../reminders/info.js";

const DAYS = 14;
/** @param {Env} env @param {Client} c @param {number} now */
export async function calendarOf(env, c, now) {
  const days = Array.from({ length: DAYS }, (_, k) => isoDay(now + k * 86400e3));
  /** @type {Record<string, any>} */
  const out = Object.fromEntries(days.map(d => [d, { date: d, service: { total: 0, kinds: /** @type {Record<string, number>} */ ({}) }, marketing: null }]));
  // сервисные: очередь по дням отправки (часы Астаны)
  try {
    const s = await serviceInfo(env, c, now);
    for (const x of (s && s.queue) || []) {
      const d = isoDay(+x.at || 0), cell = out[d];
      if (!cell) continue;
      cell.service.total++; cell.service.kinds[x.k] = (cell.service.kinds[x.k] || 0) + 1;
    }
  } catch (e) { console.log("calendar service", String(e).slice(0, 100)); }
  // реклама: кто в день k наберёт ровно N дней с визита
  /** @type {any} */ let auto = null, at = 0;
  if (c.crm) {
    try {
      auto = await autoGet(env, c.id);
      const view = await crmView(env, c, now);
      at = view.snap ? view.snap.at : 0;
      days.forEach((d, k) => {
        const cand = view.rows.filter(x => x.d + k === auto.days), why = /** @type {Record<string, number>} */ ({});
        for (const x of cand) if (x.why) why[x.why] = (why[x.why] || 0) + 1;
        const ok = cand.filter(x => !x.why).length;
        out[d].marketing = { candidates: cand.length, allowed: ok, planned: auto.on && auto.tpl ? Math.min(ok, auto.cap) : 0, excluded: why };
      });
    } catch (e) { console.log("calendar crm", String(e).slice(0, 100)); }
  }
  const n = local(now);
  return { today: isoDay(now), weekday0: n.getUTCDay(), auto: auto ? { on: !!auto.on, days: auto.days, cap: auto.cap, tpl: !!auto.tpl } : null, baseAt: at, days: days.map(d => out[d]) };
}
