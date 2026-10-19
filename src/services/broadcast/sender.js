// @ts-check — перенесено из worker.js как есть (REFACTORING.md, фаза 1)
// Рассылки: маршрут отправки (bcRoute), сообщения Green-API, сведения о номере Meta, порция отправки (bcTick), список идущих рассылок (bcRun).
/** @import { Env } from "../../lib/types.js" */
import { clean } from "../../lib/text.js";
import { TZ, local, hhmm, isoDay } from "../../lib/time.js";
import { kvRetry } from "../../db/kv/retry.js";
import { bcChunkKey, bcPut, bcGet } from "../../db/kv/broadcasts.js";
import { bcmAdd, autoLoad } from "../../db/kv/crm.js";
import { logSafe } from "../../lib/phone.js";
import { CLIENTS } from "../../config/builtin-clients.js";
import { GRAPH, BC_CHUNK, BC_SLOT, BC_DAY, CRM_FRESH_BC } from "../../config/constants.js";
import { hStr } from "../schedule/slots.js";
import { notify } from "../integrations/telegram/client.js";
import { gaRoute } from "../integrations/greenapi/webhook.js";
import { gaCall, gaCode, gaWhy, gaKind } from "../integrations/greenapi/client.js";
import { waCreds } from "../integrations/meta/client.js";
import { sendTemplate } from "../channels/templates.js";
import { wzOn, wzHealth } from "../channels/wazzapo.js";
import { sendGreen } from "../channels/greenapi.js";
import { BC_HINT, BC_TEMP, BC_ACCOUNT, BC_PARAM, bcWhy } from "./errors.js";
import { bcOptouts } from "./segments.js";
import { crmView } from "../crm/segments.js";
import { bcHold, bcHoldFor, bcFrom, bcHoldEdit, GA_STATE_TEXT, GA_STATE_BAD } from "./holds.js";
// ================= РАССЫЛКИ: шаблоны WhatsApp по списку клиентов =================
// Написать клиенту первым официальный WhatsApp разрешает только шаблоном, который одобрила Meta. Рассылка = шаблон + список номеров.
// Через Green-API (обычный WhatsApp клиента по QR-коду, b.ch = "ga") уходит обычный текст. Такой номер WhatsApp блокирует за массовые рассылки, поэтому:
// по одному сообщению с паузой 30–150 секунд, не больше 300 в сутки (по умолчанию 50), в конце строка «ответьте СТОП»; перед каждым сообщением
// проверяется, что номер привязан и не ограничен; запуск — только при настроенном вебхуке (иначе «стоп» клиентов не дойдёт до бота).
// Отправляет фоновая задача (cron, раз в минуту — одна порция): страницу после запуска можно закрыть. Если фон не работает, страница предложит отправить порцию вручную.
// Правила: тем, кто написал «стоп» или запретил рекламу в самом WhatsApp, не шлём; номер в списке — один раз; есть предел на 24 часа и часы отправки;
// при ошибках Meta и при её сигналах (шаблон приостановлен, аккаунт ограничен) рассылка сама встаёт на паузу и сообщает в Telegram.
// Порция сначала отмечается отправленной и только потом уходит: при сбое часть клиентов не получит сообщение, зато никто не получит его дважды.
// Ключи: bc:<клиент>:<id> — рассылка; bcr:<клиент>:<id>:<k> — получатели, по 250; bcrun — что сейчас идёт; bcq:<клиент> — сколько отправлено за сутки;
// bchold:<клиент> — сигнал Meta «остановиться» (ga — сигнал Green-API: номер заблокирован или ограничен); bcf:<клиент>:<день> — недоставленные; bclast:<клиент> — текст последней рассылки (его видит ИИ и пульт);
// bcq:<клиент>:ga — сколько отправлено за сутки с номера Green-API; bcm:<клиент>:<день> — кому в этот день ушёл шаблон Meta (сегменты базы клиентов
// Altegio 14 дней таким не пишут, services/crm/segments.js)
/** @param {number} ms @param {number} now */
export const bcAt = (ms, now) => { const d = local(ms), t = hhmm(d); return isoDay(ms) === isoDay(now) ? "в " + t : isoDay(ms) === isoDay(now + 86400e3) ? "завтра в " + t : `${d.getUTCDate()}.${String(d.getUTCMonth() + 1).padStart(2, "0")} в ${t}`; };
/** @param {Env} env @param {string} cid @param {any} ch @returns {Record<string, any>} */
export const bcRoute = (env, cid, ch) => { // с какого номера и каким токеном уходят шаблоны (ch = "ga" — номер Green-API клиента)
  const up = cid.toUpperCase();
  // gaNoBroadcast — номер Green-API только для ответов бота: рассылка с неофициального номера — прямой путь к блокировке (Winchester, 18.10.2026)
  if (ch === "ga" && CLIENTS[cid] && CLIENTS[cid].gaNoBroadcast) return { error: "Рассылки с номера бота (Green-API) у этой компании выключены: номер только отвечает клиентам. Рассылки — с официального номера шаблонами Meta." };
  if (ch === "ga") { const ga = gaRoute(env, cid); return ga ? { ga, quiet: true } : { error: `Green-API у этого клиента не подключён: в Cloudflare нужны переменная GA_ID_${up} и секрет GA_TOKEN_${up} (номер и токен инстанса из кабинета Green-API).` }; }
  if (env["WA_TOKEN_" + up]) { const pnid = env["PHONE_NUMBER_ID_" + up] || CLIENTS[cid].waPhoneId || ""; return pnid ? { client: cid, pnid, quiet: true } : { error: "В паспорте бота не указан «Phone number ID» — без него рассылку не отправить (страница «Мои боты» → Изменить)." }; }
  if (env.WA_TOKEN && env.PHONE_NUMBER_ID && env.WA_CLIENT === cid) return env.APP_SECRET ? { quiet: true } : { error: "Для рассылок нужен секрет APP_SECRET (App secret приложения Meta) в Cloudflare: без него бот не может доверять сигналам Meta об отказах и жалобах." };
  return { error: `WhatsApp этого клиента не подключён: в Cloudflare нет секрета WA_TOKEN_${up}.` };
};
// рассылка через Green-API: обычный текст. Предел в сутки — до 300 (по умолчанию 50), между сообщениями 30–150 секунд
export const GA_CAP = [50, 300], GA_GAP = [30e3, 150e3], GA_MSG_MAX = 1500, GA_CAPTION_MAX = 1000;
export const GA_STOP_LINE = "Чтобы не получать сообщения, ответьте СТОП";
// текст как написал администратор (переводы строк сохраняются); в конце — строка «ответьте СТОП», если про «стоп» в тексте ничего нет
/** @param {any} src */
export function bcGaMsg(src) {
  const t = String(src || "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u2060\ufeff\u00ad]/g, "").replace(/\t/g, " ").replace(/[ ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return !t ? "" : /(^|[^а-яёa-z])(стоп|stop)([^а-яёa-z]|$)/i.test(t) ? t : t + "\n\n" + GA_STOP_LINE;
}
/** @param {any} b @param {any} name */
export const bcGaText = (b, name) => String(b.msg || "").replace(/\{\s*(имя|name)\s*\}/gi, name || b.fallback || "уважаемый клиент");
/** @param {string} u */
const bcFileName = u => { let n = ""; try { n = decodeURIComponent(new URL(u).pathname.split("/").pop() || ""); } catch (e) {} n = n.replace(/[^\p{L}\p{N}._-]/gu, "").slice(-60); return /\.[a-z0-9]{2,5}$/i.test(n) ? n : "image.jpg"; };
/** @param {Env} env @param {string} digits @param {any} b @param {any} name @param {any} r */
export async function bcSendGa(env, digits, b, name, r) {
  const text = bcGaText(b, name), chatId = digits + "@c.us";
  if (!b.img) return sendGreen(env, chatId, text, r, true);
  const x = await gaCall(r, "sendFileByUrl", { chatId, urlFile: b.img, fileName: bcFileName(b.img), caption: text.slice(0, 1024) }); // картинка с подписью
  return x.ok ? { ok: true, id: String(x.j.idMessage || "") } : { ok: false, status: x.status, code: gaCode(x), error: clean((x.j && x.j.message) || x.text || "", 160) };
}
// сведения о номере из Meta: качество и предел получателей за 24 часа
/** @param {Env} env @param {any} route */
export async function bcHealth(env, route) {
  const cr = waCreds(env, route);
  if (route && wzOn(env, route.client)) return wzHealth(env, cr.token, cr.pnid); // номер через партнёра Meta Wazzapo
  const get = async (/** @type {string} */ f) => { const r = await fetch(`${GRAPH}/${cr.pnid}?fields=${f}`, { headers: { authorization: "Bearer " + cr.token } }); let j = /** @type {any} */ ({}); try { j = await r.json(); } catch (e) {} return r.ok ? j : { error: { code: +(j.error && j.error.code) || r.status } }; };
  try {
    let j = await get("display_phone_number,verified_name,quality_rating,whatsapp_business_manager_messaging_limit"); // у старых версий API предел лежит в другом поле
    if (j.error && j.error.code === 100) j = await get("display_phone_number,verified_name,quality_rating,messaging_limit_tier");
    if (j.error && j.error.code === 100) j = await get("display_phone_number,verified_name,quality_rating");
    if (j.error) return { error: `Meta не отдала сведения о номере (код ${j.error.code}${BC_HINT[j.error.code] ? ": " + BC_HINT[j.error.code] : ""}).` };
    const tier = String(j.whatsapp_business_manager_messaging_limit || j.messaging_limit_tier || ""), m = /TIER_(\d+)(K)?/i.exec(tier);
    return { phone: clean(j.display_phone_number || "", 24), name: clean(j.verified_name || "", 60), quality: String(j.quality_rating || "").toUpperCase(), limit: m ? +m[1] * (m[2] ? 1000 : 1) : /UNLIMITED/i.test(tier) ? -1 : 0 };
  } catch (e) { return { error: "Meta не отвечает — сведения о номере получить не удалось." }; }
}
// список рассылок, которые сейчас идут: по нему работает фоновая отправка. false — не записался (запуск без него не отправит ничего)
/** @param {Env} env @param {string} cid @param {string} id @param {boolean} on @returns {Promise<boolean>} */
export async function bcRun(env, cid, id, on) {
  try {
    await kvRetry(async () => {
      const cur = JSON.parse((await env.KV.get("bcrun")) || "[]") || [], rest = cur.filter(/** @param {any} x */ x => !(x.c === cid && x.id === id));
      if (on) rest.push({ c: cid, id });
      if (JSON.stringify(rest) !== JSON.stringify(cur)) await env.KV.put("bcrun", JSON.stringify(rest.slice(-40)));
    });
    return true;
  } catch (e) { console.log("bcrun", String(e)); return false; }
}
// получатели рассылки с номера from, n человек (части bcr: по BC_CHUNK)
/** @param {Env} env @param {string} cid @param {string} id @param {number} from @param {number} n @returns {Promise<any[]>} */
async function bcRange(env, cid, id, from, n) {
  const out = [];
  for (let k = Math.floor(from / BC_CHUNK); n > 0 && k <= Math.floor((from + n - 1) / BC_CHUNK); k++) {
    const ch = JSON.parse((await env.KV.get(bcChunkKey(cid, id, k))) || "[]");
    for (let i = 0; i < ch.length; i++) { const at = k * BC_CHUNK + i; if (at >= from && at < from + n) out.push(ch[i]); }
  }
  return out;
}
// когда отправлять нельзя: вне часов отправки или после временного отказа Meta → { note, till }
/** @param {any} b @param {number} now */
export function bcWait(b, now) {
  if (b.retryAt > now) return { note: `${b.retryWhy || bcFrom(b) + " временно не принимает сообщения"} — повторю ${bcAt(b.retryAt, now)}.`, till: b.retryAt };
  const n = local(now), hr = n.getUTCHours() + n.getUTCMinutes() / 60;
  if (hr >= b.from && hr < b.to) return null;
  const day0 = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - TZ * 3600e3, till = day0 + b.from * 3600e3 + (hr >= b.to ? 86400e3 : 0);
  return { note: `Отправка идёт с ${hStr(b.from)} до ${hStr(b.to)} по Астане. Продолжу ${bcAt(till, now)}.`, till };
}
// одна порция рассылки → { b, state, did }: state — running, wait, busy, paused, done, stopped; did — были ли отправки.
// gaBusy — с номера Green-API этого клиента в эту минуту уже ушло сообщение (другой рассылкой): ждём следующей минуты
/** @param {Env} env @param {string} cid @param {string} id @param {any} gaBusy @returns {Promise<Record<string, any>>} */
export async function bcTick(env, cid, id, gaBusy) {
  const now = Date.now(), lk = `bcl:${cid}:${id}`, token = Math.random().toString(36).slice(2);
  let b = await bcGet(env, cid, id);
  if (!b) return { error: "Рассылка не найдена." };
  if (b.status !== "running") return { b, state: b.status };
  const ga = b.ch === "ga";
  if (ga && gaBusy) return { b, state: "busy" };
  /** @param {string} text */
  const tell = async text => { try { await notify(env, text, cid); } catch (e) { console.log("bc tg", String(e)); } };
  // рассылка автосценария «Пора на стрижку» — только в день создания (находки проверки 19.10.2026): не успела — назавтра её получателям
  // уже не «ровно N дней», а с новой рассылкой автосценария за день ушло бы больше его предела. Останавливаем сразу, как стало ясно,
  // что сегодня не уйдёт (часы закончились, предел номера — до завтра), а не в полночь; выключил владелец автосценарий — тоже стоп
  /** @param {string} why @param {string} tg */
  const stopAuto = async (why, tg) => {
    b.status = "stopped"; b.note = "Остановлена: " + why; delete b.waitNote; delete b.waitTill; delete b.retryAt; delete b.retryWhy;
    await bcPut(env, cid, b); await bcRun(env, cid, id, false);
    if (tg) await tell(`⏹ Автосценарий «${b.name}» — ${CLIENTS[cid].name}\n${tg}\nОтправлено ${b.sent} из ${b.total}.`);
    return { b, state: "stopped" };
  };
  const LATE = "в день создания уйти не успела (часы отправки закончились, предел номера за сутки или пауза) — завтра автосценарий соберёт новый список.",
    LATE_TG = "Не успел отправить всем в день создания: закончились часы отправки, предел номера за сутки занят или рассылка стояла на паузе. Остальным завтра уже не «ровно N дней» — автосценарий соберёт новый список.";
  if (b.by === "auto") {
    if (isoDay(b.created) < isoDay(now)) return stopAuto(LATE, LATE_TG);
    const a = await autoLoad(env, cid);
    if (!a || !a.on) return stopAuto("автосценарий выключен.", "");
  }
  /** @param {any} w */
  const waitFor = async w => {
    if (b.by === "auto" && isoDay(w.till) > isoDay(b.created)) return stopAuto(LATE, LATE_TG);
    if (b.waitNote !== w.note) { b.waitNote = w.note; b.waitTill = w.till; try { await bcPut(env, cid, b); } catch (e) { console.log("bc save", String(e)); } } return { b, state: "wait" };
  };
  /** @param {string} note */
  const stopFor = async note => {
    note = logSafe(note); // текст ошибки Meta/Wazzapo может содержать номер получателя — заметку видят сотрудники и Telegram (находка проверки 19.10.2026)
    b.status = "paused"; b.note = note; delete b.waitNote; delete b.waitTill; delete b.retryAt; delete b.retryWhy;
    await bcPut(env, cid, b); await bcRun(env, cid, id, false);
    await tell(`⚠️ Рассылка «${b.name}» остановлена — ${CLIENTS[cid].name}\n${note}\nОтправлено ${b.sent} из ${b.total}. Когда причина устранена, нажмите «Продолжить» на странице рассылок.`);
    return { b, state: "paused" };
  };
  const w = bcWait(b, now); if (w) return waitFor(w);
  if (ga && b.nextAt > now) return { b, state: "wait" }; // пауза между сообщениями Green-API: хранилище не пишем
  const route = bcRoute(env, cid, b.ch);
  if (route.error) return stopFor(route.error);
  const hold = bcHoldFor(await bcHold(env, cid), b);
  if (hold) return stopFor(`Сигнал от ${bcFrom(b)}: ${hold.why}. Рассылка остановлена, чтобы не навредить номеру.`);
  // предел на 24 часа — общий для всех рассылок клиента с этого номера: Meta считает получателей за скользящие сутки; у номера Green-API свой счётчик
  const qk = "bcq:" + cid + (ga ? ":ga" : "");
  /** @type {Record<string, any>} */
  let q = {}; try { q = JSON.parse((await env.KV.get(qk)) || "{}") || {}; } catch (e) {}
  const slot = Math.floor(now / BC_SLOT), live = Object.keys(q).filter(k => +k > slot - BC_DAY && +q[k] > 0), used = live.reduce((a, k) => a + +q[k], 0);
  if (used >= b.cap) { const till = (Math.min(...live.map(Number)) + BC_DAY) * BC_SLOT; return waitFor({ note: `За последние 24 часа отправлено ${used} — это предел (${b.cap}). Продолжу ${bcAt(till, now)}.`, till }); }
  if (ga) { // перед каждым сообщением: номер привязан, WhatsApp его не ограничил
    const s = await gaCall(route.ga, "getStateInstance", null, 10000), state = s.ok ? String(s.j.stateInstance || "") : "";
    if (GA_STATE_BAD[state]) {
      const why = GA_STATE_BAD[state];
      try { await bcHoldEdit(env, cid, h => { h.ga = { at: now, why }; }); } catch (e) { console.log("bchold", String(e)); }
      return stopFor(`Сигнал от Green-API: ${why}. Рассылка остановлена, чтобы не навредить номеру.`);
    }
    if (state === "notAuthorized") return stopFor(`${GA_STATE_TEXT.notAuthorized}, потом нажмите «Продолжить».`);
    if (s.status === 401 || s.status === 403) return stopFor(`Green-API не пускает: ${gaWhy({ code: "ga:" + s.status }, route.ga)}.`);
    if (state !== "authorized") { // телефон не на связи, инстанс перезапускается или Green-API не ответил — повторить через 10 минут
      b.tmp = (b.tmp || 0) + 1;
      if (b.tmp >= 6) return stopFor(`Больше часа не получается отправить: ${GA_STATE_TEXT[state] || "Green-API не отвечает"}.`);
      b.retryAt = now + 600e3; b.retryWhy = GA_STATE_TEXT[state] || "Green-API не отвечает";
      return waitFor(bcWait(b, now));
    }
  }
  // замок: две отправки одной рассылки одновременно идти не должны
  if (await env.KV.get(lk)) return { b, state: "busy" };
  try { await env.KV.put(lk, token, { expirationTtl: 60 }); } catch (e) { return { b, state: "busy" }; } // замок только что ставили или снимали — значит, отправка шла секунду назад
  if ((await env.KV.get(lk)) !== token) return { b, state: "busy" };
  let sentNow = 0, did = false;
  const marked = /** @type {string[]} */ ([]); // кому шаблон ушёл (или мог уйти) в этой порции — отметка «писали маркетинг»
  try {
    b = (await bcGet(env, cid, id)) || b; // после замка читаем заново
    if (b.status !== "running") return { b, state: b.status };
    if (b.cur) { // прошлая порция оборвалась: кто из неё получил сообщение — неизвестно, повторно её не шлём
      b.unsure = (b.unsure || 0) + b.cur[1];
      // шаблон мог уйти любому из неё — отметка «писали маркетинг» всем: иначе следующая рассылка по базе или автосценарий напишут второй раз (находка проверки 19.10.2026)
      if (!ga) { try { await bcmAdd(env, cid, isoDay(now), (await bcRange(env, cid, id, b.cur[0], b.cur[1])).map(x => String(x[0]))); } catch (e) { console.log("bcm", String(e).slice(0, 120)); } }
      delete b.cur;
    }
    // Green-API: одно сообщение за раз (смотрим до 25 человек вперёд, чтобы пропустить попросивших не писать); Meta — порция
    const batch = ga ? 25 : Math.max(1, Math.min(Math.round(+env.BC_BATCH) || 20, 200)), take = Math.min(batch, ga ? b.total - b.pos : b.cap - used, b.total - b.pos);
    const from = b.pos, items = take > 0 ? await bcRange(env, cid, id, from, take) : [];
    if (take > 0 && !items.length) return await stopFor("Список получателей не читается из хранилища — попробуйте «Продолжить» через несколько минут.");
    const stop = take > 0 ? await bcOptouts(env, cid) : new Set();
    // рассылка по базе Altegio: исключения — ещё раз перед отправкой, по свежему снимку и отметкам bcm:, а не только при создании (находка
    // проверки 19.10.2026): две рассылки по пересекающимся сегментам или ручная «Пора на стрижку» и автосценарий иначе пишут одному
    // человеку два платных шаблона; кто записался или пришёл после создания рассылки — тоже не получит. Старая база — пауза: не видно, кто записался
    const no = new Set();
    if (b.src === "crm" && take > 0) {
      const view = await crmView(env, CLIENTS[cid], now);
      if (!view.snap || now - view.snap.at > CRM_FRESH_BC) return await stopFor("База клиентов из Altegio не обновлялась больше 3 дней — по ней не видно, кто уже записался. Обновите базу в разделе сегментов и нажмите «Продолжить».");
      for (const x of view.rows) if (x.why && x.why !== "stop") no.add(x.p);
      for (const p of view.marked || []) no.add(p);
      for (const p of view.futOnly || []) no.add(p);
    }
    if (ga) { const j = items.findIndex(x => !stop.has(x[0])); if (j >= 0) items.length = j + 1; }
    // порция отмечается отправленной до отправки: если дальше что-то сорвётся, повторно она не уйдёт
    b.pos = from + items.length; b.last = now; delete b.waitNote; delete b.waitTill; delete b.retryAt; delete b.retryWhy;
    if (items.length) { b.cur = [from, items.length]; await bcPut(env, cid, b); }
    const t0 = Date.now();
    let done = 0, halt = null;
    for (const [digits, name] of items) {
      if (Date.now() - t0 > 35e3) break; // остаток — в следующую минуту
      if (stop.has(digits)) { b.skipped++; done++; continue; }
      if (no.has(digits)) { b.excl = (b.excl || 0) + 1; done++; continue; }
      did = true;
      const r = ga ? await bcSendGa(env, digits, b, name, route.ga) : await sendTemplate(env, digits, b, name, route);
      if (r.ok) { b.sent++; sentNow++; done++; b.streak = 0; b.tmp = 0; if (!ga) marked.push(digits); continue; }
      if (!ga && r.code === 0) marked.push(digits); // связь оборвалась — шаблон мог уйти: второй раз за 14 дней такому клиенту не пишем
      const kind = ga ? gaKind(r.code) : r.code === 0 ? "net" : BC_TEMP.has(r.code) || r.status >= 500 ? "temp" : BC_ACCOUNT.has(r.code) || (BC_PARAM.has(r.code) && b.stuck !== from + done) ? "stop" : "one";
      if (kind === "temp" || kind === "stop") { // получатель ни при чём: он возвращается в очередь
        if (!ga && BC_PARAM.has(r.code)) b.stuck = from + done;
        halt = { kind, r }; break;
      }
      b.failed++; done++;
      b.fails = b.fails || {}; b.fails[r.code] = (b.fails[r.code] || 0) + 1;
      if ((b.bad = b.bad || []).length < 300) b.bad.push([digits, r.code]);
      if (r.code === 131050) { try { await env.KV.put(`optout:${cid}:${digits}`, "meta:" + now); } catch (e) {} } // человек запретил рекламу в WhatsApp — больше ему не шлём
      if (kind === "net") { halt = { kind: "temp", r }; break; } // связь оборвалась (сообщение могло уйти) — пауза на 10 минут
      b.streak = (b.streak || 0) + 1;
      if (b.streak >= 5) { halt = { kind: "streak", r }; break; }
    }
    b.pos = from + done; delete b.cur;
    if (ga && did) b.nextAt = now + GA_GAP[0] + Math.floor(Math.random() * (GA_GAP[1] - GA_GAP[0])); // следующее сообщение — через 30–150 секунд
    if (halt && halt.kind === "temp") { b.tmp = (b.tmp || 0) + 1; if (b.tmp < 6) b.retryAt = now + 600e3; }
    if (sentNow) { // учёт отправленного за сутки
      try { const nq = /** @type {Record<string, any>} */ ({}); for (const k of live) nq[k] = q[k]; nq[slot] = (+nq[slot] || 0) + sentNow; await env.KV.put(qk, JSON.stringify(nq), { expirationTtl: 2 * 86400 }); } catch (e) { console.log("bcq", String(e)); }
    }
    // отметка «писали маркетинг» — раз за порцию, а не за каждое сообщение (KV пишет ключ не чаще раза в секунду). Только шаблоны Meta и
    // Wazzapo: с номера Green-API маркетинг по базе не уходит. Сбой отметки рассылку не останавливает — в журнал без номеров
    if (marked.length) { try { await bcmAdd(env, cid, isoDay(now), marked); } catch (e) { console.log("bcm", String(e).slice(0, 120)); } }
    if (halt && (halt.kind !== "temp" || b.tmp >= 6)) {
      const why = ga ? gaWhy(halt.r, route.ga) : bcWhy(halt.r);
      return await stopFor(halt.kind === "streak" ? `Пять сообщений подряд не отправились (${why}).` : halt.kind === "temp" ? `${bcFrom(b)} больше часа не принимает сообщения (${why}).` : `${ga ? "Green-API отклонил" : "Meta отклонила"} отправку (${why}).`);
    }
    if (b.pos >= b.total) {
      b.status = "done"; b.doneAt = now;
      await bcPut(env, cid, b); await bcRun(env, cid, id, false);
      await tell(`📣 Рассылка «${b.name}» завершена — ${CLIENTS[cid].name}\nОтправлено: ${b.sent} из ${b.total}.${b.skipped ? `\nПропущено (просили не писать): ${b.skipped}.` : ""}${b.excl ? `\nПропущено (уже записались, были недавно или им уже писали): ${b.excl}.` : ""}${b.failed ? `\nНе отправлено из-за ошибок: ${b.failed}.` : ""}${b.unsure ? `\nНеизвестно (сбой во время отправки): до ${b.unsure}.` : ""}`);
      return { b, state: "done", did };
    }
    await bcPut(env, cid, b);
    return { b, state: b.retryAt > now ? "wait" : "running", did };
  } finally { try { await env.KV.delete(lk); } catch (e) {} }
}
