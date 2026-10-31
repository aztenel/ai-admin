// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 1); типы добавим отдельным шагом
// История чата в KV (один ключ на чат): TTL, метаданные для списка пульта, запись, дописывание реплик, слияние профиля.
/** @import { Env, Profile, Hist } from "../../lib/types.js" */
import { HIST_KEEP } from "../../config/constants.js";
import { snip } from "../../lib/text.js";
import { kvRetry } from "./retry.js";

// история чата с паузой («стоп» — 30 дней) живёт не меньше, чем сама пауза
/** @param {Profile | null | undefined} prof */
export const histTtl = prof => Math.max(7 * 86400, prof && prof.pausedUntil > Date.now() ? Math.ceil((prof.pausedUntil - Date.now()) / 1000) + 86400 : 0);
// ---- история чата: один ключ на чат — { n, turns: [{ role, text, t, by?, m? }], profile }.
// В ИИ уходят последние MAX_TURNS реплик, хранится HIST_KEEP: их видит администратор в пульте чатов.
// Метаданные ключа — строка списка чатов в пульте (весь список читается одним запросом KV.list, без чтения самих чатов)
/** @param {Hist | Record<string, any> | null | undefined} h */
export function histMeta(h) {
  const p = (h && h.profile) || {}, ts = (h && h.turns) || [], last = ts[ts.length - 1] || null, now = Date.now();
  /** @type {Record<string, any>} */
  const m = { t: now };
  if (p.li) m.li = p.li;
  if (last) { m.s = snip(last.text, 70); m.d = last.role === "user" ? "u" : last.by === "admin" ? "a" : "b"; }
  const nm = p.name || p.waName; if (nm) m.nm = snip(nm, 40);
  if (p.phone) m.ph = String(p.phone).slice(0, 20);
  if (p.need && p.need.why) { m.nd = String(p.need.why).slice(0, 12); if (p.need.tp) m.tp = String(p.need.tp).slice(0, 8); if (p.need.src && p.need.src.k) m.rs = String(p.need.src.k).slice(0, 4); }
  if (p.as && p.as.n) m.as = snip(p.as.n, 32); // кто ведёт чат (имя сотрудника с устройства, ТЗ v2.0 §2.5)
  if (p.done) m.dn = 1;                         // «Готово»: сотрудник закрыл чат, клиент больше не писал
  if (last && last.role !== "user" && last.st) m.ls = String(last.st).slice(0, 10); // статус нашего последнего сообщения — галочки в списке
  if (p.pausedUntil > now) m.pu = p.pausedUntil;
  if (p.stop) m.st = 1;
  const bk = (p.bookings || []).length + (p.pend || []).length; if (bk) m.bk = bk;
  return m;
}
/** @param {any} store @param {string} key @param {Hist | Record<string, any>} h */
export async function putHist(store, key, h) { await store.put(key, JSON.stringify(h), { expirationTtl: histTtl(h.profile), metadata: histMeta(h) }); }
// дописать реплики в историю чата помимо think(): голосовое или фото клиента, ответ администратора из пульта. n растёт — think(), который в это время отвечает в том же чате, сольёт свои изменения с этими
/** @param {any} store @param {string} key @param {any[] | undefined} add @param {((profile: Profile, h: Hist) => void) | undefined} [patch] @returns {Promise<Hist>} */
export async function logTurns(store, key, add, patch) {
  return kvRetry(async () => {
    const h = JSON.parse((await store.get(key)) || "null") || { n: 0, turns: [], profile: {} };
    h.profile = h.profile || {}; h.turns = (h.turns || []).concat(add || []).slice(-HIST_KEEP); h.n = (h.n || 0) + 1;
    if (patch) patch(h.profile, h);
    await putHist(store, key, h);
    return h;
  });
}
// два сообщения одного чата обработаны одновременно: к состоянию, которое успело сохраниться (cur), добавляем то, что изменило это сообщение.
// base — профиль, каким его увидело это сообщение в начале: поле, которое оно не меняло, берём из cur (иначе отмена из соседнего сообщения откатится)
/** @param {Profile} cur @param {Profile} mine @param {Profile | null | undefined} base @param {any[]} added @param {any[]} removed @param {any[] | null | undefined} [droppedPend] @returns {Profile} */
export function mergeProfile(cur, mine, base, added, removed, droppedPend) {
  const out = { ...cur }, same = /** @param {any} a @param {any} b */ (a, b) => JSON.stringify(a) === JSON.stringify(b), goneIds = new Set(removed), noPend = new Set(droppedPend || []);
  for (const k of new Set([...Object.keys(mine), ...Object.keys(base || {})])) {
    if (k === "bookings" || k === "pend" || (base && same(mine[k], base[k]))) continue;
    if (k in mine) out[k] = mine[k]; else delete out[k];
  }
  const list = (cur.bookings || []).filter(/** @param {any} b */ b => !goneIds.has(b.leadId));
  for (const b of added) if (!list.some(/** @param {any} x */ x => x.leadId === b.leadId)) list.push(b);
  if (list.length || cur.bookings || mine.bookings) out.bookings = list;
  const pend = [...(cur.pend || []), ...(mine.pend || [])].filter(p => !noPend.has(p.key));
  if (pend.length || cur.pend || mine.pend) out.pend = pend.filter((p, i) => pend.findIndex(q => q.key === p.key) === i).slice(-5);
  if ((cur.pausedUntil || 0) > (out.pausedUntil || 0)) out.pausedUntil = cur.pausedUntil;
  return out;
}
/** @param {Env} env @param {string} hk */
export async function readHist(env, hk) { return JSON.parse((await env.KV.get(hk)) || "null"); }

// ---- «Очистить память бота» (пульт). Cloudflare KV согласован не сразу: там, где принят вебхук (Green-API — в другом месте сети, чем пульт),
// до ~60 с читается копия чата до очистки — бот отвечал по ней и записывал её обратно, очистка пропадала навсегда (живая проверка владельца
// 19.10.2026, Winchester, номер бота: «бот не может забыть меня, сколько раз бы я не очищал»). Поэтому время очистки лежит ещё и отдельным
// ключом fg:…, который пишет только очистка: старая копия чата его не затирает, и при следующем чтении очистка применяется снова (applyForget).
// Ответ на сообщение, пришедшее в эту минуту в другое место сети, KV исправить не может — нужна база с согласованным чтением (REFACTORING.md)
export const FORGET_KEEP = ["li", "waName", "stop", "pn"]; // окно WhatsApp, имя из профиля WhatsApp, «стоп», номер компании
// что очистка оставляет: «стоп» — вместе с его паузой. Без паузы бот снова отвечал человеку, который просил не писать (проверка исправления
// 19.10.2026; так же удаление данных — erase.js, а «Вернуть бота» при «стопе» отказывает)
/** @param {Record<string, any>} p @returns {Record<string, any>} */
const forgetKeep = p => {
  /** @type {Record<string, any>} */
  const o = {};
  for (const k of FORGET_KEEP) if (p[k] !== undefined) o[k] = p[k];
  if (p.stop && p.pausedUntil) o.pausedUntil = p.pausedUntil;
  return o;
};
/** @param {string} hk */
export const forgetKey = hk => "fg:" + String(hk).replace(/^h:/, "");
/** @param {any} store @param {string} hk @returns {Promise<number>} время последней очистки чата, 0 — не очищали или не прочиталось */
export async function readForgot(store, hk) {
  try { return +((await store.get(forgetKey(hk))) || 0) || 0; } catch (e) { console.log("forgot read", String(e)); return 0; }
}
/** @param {any} store @param {string} hk @param {number} at @returns {Promise<Hist>} */
export async function forgetChat(store, hk, at) {
  const h = await logTurns(store, hk, [], (pr, all) => { all.turns = []; const keep = forgetKeep(pr); for (const k of Object.keys(pr)) delete pr[k]; Object.assign(pr, keep, { forgot: at }); }); // forgot: старые заявки этого чата бот в чат не возвращает
  // ключ живёт дольше любой копии чата (история со «стопом» — 31 день)
  try { await store.put(forgetKey(hk), String(at), { expirationTtl: 32 * 86400 }); } catch (e) { console.log("forgot mark", String(e)); }
  return h;
}
// копию чата записал тот, кто об очистке at ещё не знал: применяем её к копии. До очистки забываем всё; после — остаются слова клиента и
// администратора, напоминания и записи, сделанные уже после очистки (они настоящие), а ответы бота — нет: их писали по старой памяти
// («у Тони Premium не помещается… к другому мастеру?»). Возвращает, изменилась ли копия
/** @param {any} h @param {number} at @returns {boolean} */
export function applyForget(h, at) {
  const p = (h && h.profile) || {};
  if (!h || !(at > (p.forgot || 0))) return false;
  const turns = h.turns || [], late = /** @param {any} x @param {any} ts */ (x, ts) => !!x && ts >= at;
  // в копии нет ничего до очистки — чат истёк (7 дней, а отметка живёт 32) и начат заново, например ответом администратора с телефона:
  // забывать нечего, а пауза и «ждёт ответа» в нём настоящие (проверка исправления 19.10.2026)
  if (turns.every(/** @param {any} t */ t => late(t, t && t.t)) && ["bookings", "pend"].every(k => (p[k] || []).every(/** @param {any} x */ x => late(x, x && x.at)))) {
    p.forgot = at; h.profile = p; return false;
  }
  h.turns = turns.filter(/** @param {any} t */ t => late(t, t && t.t) && (t.role === "user" || t.by || t.rm));
  const np = forgetKeep(p);
  for (const k of ["bookings", "pend"]) { const v = (p[k] || []).filter(/** @param {any} x */ x => late(x, x && x.at)); if (v.length) np[k] = v; }
  // человек ответил клиенту уже после очистки (телефон, пульт) — его пауза настоящая: бот не отвечает поверх него
  if (p.pausedUntil && h.turns.some(/** @param {any} t */ t => t.by)) np.pausedUntil = Math.max(p.pausedUntil, np.pausedUntil || 0);
  if (p.need && late(p.need, p.need.at)) np.need = p.need; // «ждёт ответа», поднятое после очистки
  np.forgot = at;
  h.profile = np;
  return true;
}
// пока сообщение обрабатывалось, память чата очистили: к очищенному чату (cur) от сообщения добавляем только поля, которые очистка оставляет
/** @param {Profile} cur @param {Profile} mine @param {Profile | null | undefined} base @returns {Profile} */
export function keepAfterForget(cur, mine, base) {
  /** @type {Record<string, any>} */
  const out = { ...cur }, b = base || {}, m = /** @type {Record<string, any>} */ (mine);
  for (const k of FORGET_KEEP) {
    if (JSON.stringify(m[k]) === JSON.stringify(b[k])) continue;
    if (k in m) out[k] = k === "li" ? Math.max(m.li || 0, out.li || 0) : m[k]; else delete out[k];
  }
  // «стоп» или «старт» этого сообщения — вместе с паузой «стопа» (у очищенного чата пауза бывает только от «стопа», см. forgetKeep)
  if (JSON.stringify(m.stop) !== JSON.stringify(b.stop)) {
    if (m.stop && m.pausedUntil) out.pausedUntil = Math.max(m.pausedUntil, out.pausedUntil || 0);
    else if (!m.stop && cur.stop) delete out.pausedUntil;
  }
  return out;
}
