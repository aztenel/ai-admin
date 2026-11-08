// @ts-check
// Сообщения о бонусах со второго номера (ТЗ Winchester v4, 08.11.2026): «Начислено бонусов: N / Доступно: M» и «Списано бонусов: N.
// Итоговый баланс: M.», как уведомления Altegio, которые получали клиенты Winchester. Правила начисления не повторяем: читаем готовые
// операции карты лояльности из деталей визита Altegio (loyalty_transactions) и баланс карты клиента (loyalty/client_cards) — проба
// 08.11.2026 на настоящем Altegio Winchester: тип карты «Бонусы», у клиентов карты с balance, в деталях визита — операции с amount,
// is_loyalty_withdraw, card_id. Только чтение (altRead).
// Когда смотрим: запись с отметкой «пришёл» и номером визита, визит не раньше 8 часов назад. Изменилась подпись оплаты записи
// (оплата, отметка, last_change_date) — смотрим детали сразу (быстрый проход журнала раз в минуту видит изменённые записи); операций
// ещё нет — смотрим ещё раз не чаще раза в 15 минут (полное чтение журнала), пока не пройдёт 8 часов.
// Одна операция — одно сообщение: в очередь — с номером операции (версия), отметки rms: и D1 send_claims по нему. Операции старше 3 часов
// и сделанные до включения сценария — не сообщаем (задним числом не шлём). Вживую не проверено.
/** @import { Env, Client } from "../../lib/types.js" */
import { local, TZ } from "../../lib/time.js";
import { altRead } from "../integrations/altegio/client.js";
import { jrbnLoad, jrbnSave } from "../../db/kv/reminders.js";
import { atLocal } from "./plan.js";

const LOOK_MS = 8 * 3600e3;   // визит начался не раньше 8 часов назад: оплата бывает и после конца визита
const AGAIN_MS = 15 * 60e3;   // операций нет — смотрим снова не чаще раза в 15 минут
const OLD_MS = 3 * 3600e3;    // операция старше 3 часов — не сообщаем (журнал долго не читали, сценарий только включили)
const MAX_READ = 10;          // деталей визита за один проход: у Altegio 5 запросов в секунду на всех

/** время операции: «2026-11-08 13:30:00» (Астана) или с поясом; не разобрать — 0 @param {any} s */
export function txTime(s) {
  const x = String(s || "").trim(), m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?(.*)$/.exec(x);
  if (!m) return 0;
  if (/^(Z|[+-]\d{2}:?\d{2})$/.test(m[4].trim())) {
    const tz = m[4].trim().replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
    const t = Date.parse(`${m[1]}T${m[2]}${m[3] || ":00"}${tz}`);
    return Number.isFinite(t) ? t : 0;
  }
  return atLocal(m[1], m[2]);
}

/** операции бонусной карты из деталей визита (чистая функция): без скидок, сертификатов, абонементов и возвратов, сумма не 0
 *  @param {any} details @returns {{ id: string, amount: number, out: boolean, card: string, at: number }[]} */
export function bonusTx(details) {
  const list = details && Array.isArray(details.loyalty_transactions) ? details.loyalty_transactions : [];
  const out = [];
  for (const t of list) {
    if (!t || typeof t !== "object" || !(+t.card_id > 0) || !(+t.id > 0)) continue;
    if (t.is_discount === true || +t.is_discount === 1 || +t.certificate_id > 0 || +t.abonement_id > 0 || +t.original_transaction_id > 0) continue;
    const a = +t.amount;
    if (!Number.isFinite(a) || Math.round(Math.abs(a)) === 0) continue;
    out.push({ id: String(t.id), amount: Math.round(Math.abs(a)), out: t.is_loyalty_withdraw === true || +t.is_loyalty_withdraw === 1 || a < 0, card: String(t.card_id), at: txTime(t.created_date) });
  }
  return out;
}

/** подпись оплаты записи: изменилась — смотрим детали визита @param {any} r */
const sigOf = r => [r.attendance, r.visit_attendance, r.visit_id, r.paid_full, r.payment_status, r.last_change_date].map(x => String(x ?? "")).join("|");
/** ближайшее время отправки: сейчас или начало часов отправки (вечером — утром) @param {any} o @param {number} now */
function sendAt(o, now) {
  const L = local(now), h = L.getUTCHours();
  if (h >= o.from && h < o.to) return now;
  return Date.UTC(L.getUTCFullYear(), L.getUTCMonth(), L.getUTCDate() + (h >= o.to ? 1 : 0), o.from - TZ, 0);
}

/**
 * Новые операции по бонусам в записях журнала → задачи очереди { k: "bi" | "bo", rec, v (версия записи), tx, am, bal, … }.
 * list — записи, которые только что прочитали (полное чтение или изменённые за 10 минут), с разбором jrRec: { r, v }; full — полное чтение (можно смотреть снова
 * записи без операций). Сценарий выключен — ничего. Altegio не дал прав на «Лояльность» — в журнал решений не чаще раза в 6 часов.
 * @param {Env} env @param {Client} c @param {any} o @param {{ r: any, v: any }[]} list @param {number} now @param {{ user: string, loc: number, full: boolean }} ctx
 * @param {(x: any, st: string, why: string) => void} log
 */
export async function bonusScan(env, c, o, list, now, ctx, log) {
  if (!o.bi && !o.bo) return [];
  const st = await jrbnLoad(env, c.id), before = JSON.stringify(st), add = /** @type {any[]} */ ([]);
  for (const [id, x] of Object.entries(st)) if (!x || typeof x !== "object" || now - (+x.t || 0) > 2 * 86400e3) delete st[id];
  const enabled = (/** @type {string} */ id) => (o.set && o.set.s[id] ? +o.set.s[id].at || 0 : 0);
  /** @type {Map<string, any[] | null>} */ const cards = new Map();
  let reads = 0;
  for (const { r, v } of list) {
    if (!v || v.att !== 1 || !(+r.visit_id > 0)) continue;
    const t = atLocal(v.date, v.time);
    if (t > now + 3600e3 || now - t > LOOK_MS) continue;
    const sig = sigOf(r), was = st[v.id];
    if (was && was.s === sig && (was.tx.length || !ctx.full || now - (+was.c || 0) < AGAIN_MS)) continue;
    if (reads >= MAX_READ) break;
    reads++;
    /** @type {any} */ let d;
    try { d = await altRead(env, "GET", `/visit/details/${ctx.loc}/${v.id}/${+r.visit_id}`, null, ctx.user); }
    catch (/** @type {any} */ e) {
      const s = +(e && e.status) || 0;
      if (s === 403 && now - (+(st._err && st._err.at) || 0) > 6 * 3600e3) {
        st._err = { at: now, t: now };
        log({ ...v, rec: v.id, k: o.bi ? "bi" : "bo" }, "skipped", "Altegio не дал прочитать бонусы: у сотрудника, чей ключ журнала в системе, нет права «Лояльность»");
      }
      console.log("jr bonus details", c.id, s || String(e).slice(0, 120));
      // не смотрим эту запись каждую минуту: снова — при полном чтении через 15 минут (Altegio принимает 5 запросов в секунду на всех)
      st[v.id] = { s: sig, tx: was && Array.isArray(was.tx) ? was.tx : [], c: now, t };
      continue;
    }
    const known = new Set(was && Array.isArray(was.tx) ? was.tx : []), txs = bonusTx(d), fresh = txs.filter(x => !known.has(x.id));
    st[v.id] = { s: sig, tx: [...known, ...fresh.map(x => x.id)].slice(-20), c: now, t };
    for (const x of fresh) {
      const k = x.out ? "bo" : "bi", on = o[k], sid = x.out ? "bonusOut" : "bonusIn", base = { rec: v.id, v: v.v, p: v.p, n: v.n, date: v.date, time: v.time, staff: v.staff, svc: v.svc, k };
      if (!on) continue;
      const at = x.at || now;
      if (now - at > OLD_MS) { log({ ...base, at }, "skipped", "операция с бонусами была больше 3 часов назад: задним числом не пишем"); continue; }
      if (enabled(sid) > at) { log({ ...base, at }, "skipped", "сценарий включили позже операции с бонусами"); continue; }
      let bal = /** @type {number | undefined} */ (undefined);
      const cid = r.client && r.client.id ? String(r.client.id) : "";
      if (cid) {
        if (!cards.has(cid)) {
          try { const got = await altRead(env, "GET", `/loyalty/client_cards/${encodeURIComponent(cid)}`, null, ctx.user); cards.set(cid, Array.isArray(got) ? got : []); }
          catch (e) { console.log("jr bonus cards", c.id, String(e).slice(0, 120)); cards.set(cid, null); }
        }
        const cs = (cards.get(cid) || []).filter(y => y && typeof y === "object"), card = cs.find(y => String(y.id) === x.card) || (cs.length === 1 ? cs[0] : null);
        if (card && Number.isFinite(+card.balance)) bal = +card.balance;
      }
      add.push({ ...base, tx: x.id, am: x.amount, ...(bal !== undefined ? { bal } : {}), at: sendAt(o, now) });
    }
  }
  if (JSON.stringify(st) !== before) { try { await jrbnSave(env, c.id, st); } catch (e) { console.log("jr bonus state", String(e)); } }
  return add;
}
