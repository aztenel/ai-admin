// @ts-check
// Демо-база черновика (ТЗ v3.0 P0 «Клиенты и тестовая база», 31.10.2026): 150 вымышленных клиентов, чтобы разделы «Клиенты»,
// «Рассылки» и «Календарь» можно было проверить без настоящих данных. Только черновик (STAGE=preview), только кнопкой владельца,
// никогда сама. Повторное нажатие сначала убирает прежнюю демо-базу, потом пишет заново — дублей нет.
// Что внутри (всё вымышленное, номера +7 700 000 60 00 … +7 700 000 61 49, мастера — не мастера Winchester):
//   журнал Altegio за ~180 дней (синтетический, в формате Altegio) → тот же путь записи, что у настоящего журнала: D1 (applyWindow:
//   контакты, записи, отмены с паузой, перенос — та же запись с новым временем, «не пришёл», скрытые и неверные номера) и снимок базы
//   для рассылок в KV (crmFold + crmSave, как у «Обновить базу»);
//   разрешения: подтверждённое согласие ≈45%, из файла (не подтверждено) ≈15% — настоящим импортом CSV, «стоп» ≈5% — тем же кодом,
//   что «стоп» из WhatsApp (D1 и KV), неоднозначный «стоп», полный запрет, отказ; источники: Altegio, импорт, вручную. Один номер —
//   один контакт: импорт и ручное добавление существующего номера дописывают источник, второго контакта нет;
//   три завершённые демо-рассылки за 30 дней (KV bc:, как настоящие, с demo: 1) с отчётами в D1 (ушло, доставлено, прочитано, не
//   дошло, ответили) и записями в Altegio после сообщения у части получателей — для «записались после».
// Отметки демо: источник контакта 'demo', записи 'demo-…', события и отправки 'demo:…' (ключи — с компанией или номером контакта в базе,
// без телефонов: ключ события общий на всю базу), рассылки demo: 1, снимок demo: 1.
// «Убрать демо-базу» удаляет только их (db/d1/demo.js) и демо-ключи KV.
/** @import { Env, Client } from "../../lib/types.js" */
import { isoDay } from "../../lib/time.js";
import { CRM_PAST_DAYS, CRM_FUTURE_DAYS } from "../../config/constants.js";
import { d1Ready, stageOf } from "../../db/d1/status.js";
import { contactsByPhones, recompute, contactAdd } from "../../db/d1/contacts.js";
import { consentStmts, restrictionAdd, auditAdd } from "../../db/d1/rights.js";
import { demoReady, demoSourceStmts, demoReports, demoMarkStmt, demoMark, demoCount, demoDelete } from "../../db/d1/demo.js";
import { campaignResults } from "../../db/d1/campaigns.js";
import { optoutPut, optoutDel, optoutPhones, kvKeys, syncerrDel } from "../../db/kv/optout.js";
import { crmSave, crmLoad, crmDrop, bcmAdd, bcmDrop } from "../../db/kv/crm.js";
import { bcPut, bcGet, bcChunksSave, bcList, bcDrop } from "../../db/kv/broadcasts.js";
import { crmFold } from "../crm/snapshot.js";
import { applyWindow, newId } from "./sync.js";
import { importPreview, importApply } from "./importer.js";
import { stopRecord } from "./stops.js";
import { dayOf, dayAdd, altMs, searchOf } from "./normalize.js";

export const DEMO_N = 150;
export const DEMO_FILE = "Демо: анкеты клиентов (вымышленные).csv";
const fail = (/** @type {string} */ code, /** @type {string} */ text) => Object.assign(new Error(text), { code });

// ---- вымышленные люди: имя × фамилия (казахские и русские), номера из запаса +7 700 000 60 00 … 61 49
const FIRST = ["Арман", "Ерлан", "Данияр", "Тимур", "Нурлан", "Азамат", "Санжар", "Олжас", "Бауыржан", "Максим", "Иван", "Алексей", "Ильяс", "Марат",
  "Аслан", "Бекзат", "Канат", "Роман", "Мадияр", "Ержан", "Дмитрий", "Сергей", "Асхат", "Нурбол", "Артём", "Жандос", "Алмас", "Павел"];
const SUR_KZ = ["Сейтов", "Жумабаев", "Абенов", "Нурланов", "Касымов", "Ахметов", "Омаров", "Бекенов", "Тулегенов", "Сарсенов", "Ибраев", "Есенов"];
const SUR_RU = ["Иванов", "Смирнов", "Кузнецов", "Попов", "Соколов", "Морозов", "Волков", "Лебедев", "Козлов", "Новиков"];
export const DEMO_MASTERS = ["Дамир", "Ерасыл", "Мирас", "Самат", "Евгений"];
export const DEMO_SERVICES = ["Мужская стрижка", "Борода", "Стрижка + борода", "Отец и сын", "Детская стрижка", "Premium"];
const SVC_W = [55, 10, 12, 7, 8, 8]; // доли услуг, %

/** Номер демо-клиента (цифры, как ключи optout:). @param {number} i 0…149 */
export const demoPhone = i => "7700000" + String(6000 + i);
/** Все номера демо-диапазона. */
export const demoPhones = () => Array.from({ length: DEMO_N }, (_, i) => demoPhone(i));
/** @param {number} i */
const fullName = i => `${FIRST[(i * 11) % FIRST.length]} ${i % 3 === 2 ? SUR_RU[(i * 3) % SUR_RU.length] : SUR_KZ[(i * 5) % SUR_KZ.length]}`;
const fmt = (/** @type {string} */ p) => `+${p[0]} ${p.slice(1, 4)} ${p.slice(4, 7)} ${p.slice(7, 9)} ${p.slice(9, 11)}`;
// предсказуемый «случай» на клиента: одна и та же база при каждом нажатии (сдвинута только к сегодняшнему дню)
/** @param {number} seed */
const rnd = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// кто есть кто (i — номер клиента 0…149): 0…139 — из журнала Altegio, 140…145 — только из файла, 146…149 — добавлены вручную
const JOURNAL = 140;
/** @param {number} i */
export const demoRole = i => ({
  journal: i < JOURNAL,
  futOnly: i < JOURNAL && i % 28 === 27,            // визита за 90 дней нет, а запись впереди
  future: i < JOURNAL && i % 7 === 3,               // будущая запись
  cancelled: i % 42 === 3,                          // будущую запись отменили в Altegio (пауза рекламы 14 дней)
  moved: i % 42 === 10,                             // будущую запись перенесли (та же запись, другое время)
  consent: i % 20 < 9 && i % 50 !== 38,             // подтверждённое согласие (≈45%; кто отказался — нет)
  fromFile: i % 20 >= 9 && i % 20 <= 11,            // согласие из анкеты-файла, не подтверждено (≈15%)
  stop: i % 20 === 12,                              // написал «стоп» (≈5%; ещё двое — после демо-рассылки)
  review: i % 50 === 13,                            // неоднозначный «стоп» — ждёт решения
  block: i === 33,                                  // полный запрет: не писать вообще
  denied: i % 50 === 38,                            // отказался устно
  shortName: i % 20 === 9 || i % 20 === 10,         // в Altegio только имя, в анкете — имя и фамилия (импорт обновит)
  recentConsent: i % 20 === 8,                      // согласие дали на днях (календарь: «дали согласие»)
});

// ---- демо-рассылки: три завершённые за 30 дней, разные сегменты и шаблоны (Meta, основной номер)
const CAMPAIGNS = [
  { id: "demo1", name: "Пора на стрижку · демо", segId: "pora", seg: "Пора на стрижку", tpl: "demo_pora_na_strizhku", ago: 26, hh: 11, take: 14, text: "Здравствуйте, {{1}}! Давно не виделись: запишитесь на стрижку, ссылка в профиле. Чтобы не получать сообщения, ответьте СТОП" },
  { id: "demo2", name: "Давно не были · демо", segId: "davno", seg: "Давно не были", tpl: "demo_davno_ne_byli", ago: 15, hh: 12, take: 14, text: "{{1}}, мы скучаем! Свободное время на этой неделе есть, запишитесь. Чтобы не получать сообщения, ответьте СТОП" },
  { id: "demo3", name: "Постоянным: Premium · демо", segId: "postoyannye", seg: "Постоянные", tpl: "demo_premium_postoyannym", ago: 6, hh: 11, take: 10, text: "{{1}}, для постоянных клиентов — комплекс Premium. Записаться можно в ответ на это сообщение. Чтобы не получать сообщения, ответьте СТОП" }
];
// черновик, который ждёт одобрения владельца (календарь: «ждёт одобрения»); на черновике сайта его запуск закрыт, как у любой рассылки
const DRAFT = { id: "demo4", name: "Свободное время на неделе · демо", segId: "all", seg: "Вся база", tpl: "demo_svobodnoe_vremya", take: 8,
  text: "{{1}}, на этой неделе есть свободное время у мастеров. Записаться можно в ответ на это сообщение. Чтобы не получать сообщения, ответьте СТОП" };
export const DEMO_CAMPAIGN_IDS = [...CAMPAIGNS.map(x => x.id), DRAFT.id];

/**
 * План демо-базы на этот момент (чистая функция): журнал (before — до переноса и отмен, after — как сейчас), файл анкет, кто добавлен
 * вручную, рассылки с получателями и отчётами. Даты — от now (по Астане).
 * @param {number} now
 */
export function demoPlan(now) {
  const today = dayOf(now);
  const iso = (/** @type {number} */ d, /** @type {number} */ h, /** @type {string} */ m) => `${dayAdd(today, d)}T${String(h).padStart(2, "0")}:${m}:00+05:00`;
  const after = /** @type {any[]} */ ([]), before = /** @type {any[]} */ ([]);
  let rid = 0;
  /** @param {number} i @param {any} o */
  const rec = (i, o) => ({ id: "demo-" + (++rid), datetime: o.dt, create_date: o.cd, deleted: !!o.del, attendance: o.att, client: { id: "demo-c" + i, name: o.name, phone: fmt(demoPhone(i)) },
    staff: { id: 900 + DEMO_MASTERS.indexOf(o.staff), name: o.staff }, services: [{ id: 990 + DEMO_SERVICES.indexOf(o.svc), title: o.svc }] });
  /** @param {any} r @param {any} [b] запись до изменений (перенос, отмена); без неё — та же */
  const put = (r, b) => { after.push(r); before.push(b || r); };
  for (let i = 0; i < JOURNAL; i++) {
    const R = demoRole(i), r = rnd(1000 + i), k = i % 14, name = R.shortName ? FIRST[(i * 11) % FIRST.length] : fullName(i), master = DEMO_MASTERS[i % 5];
    const [lo, hi] = R.futOnly ? [100, 150] : k === 0 ? [3, 13] : k === 1 ? [14, 20] : k <= 4 ? [21, 35] : k <= 7 ? [36, 60] : k <= 9 ? [61, 90] : k <= 11 ? [91, 175] : k === 12 ? [4, 30] : [7, 40];
    const L = lo + Math.floor(r() * (hi - lo + 1)), g = k === 12 ? 21 + Math.floor(r() * 8) : 21 + Math.floor(r() * 15), n = k === 12 ? 5 + Math.floor(r() * 3) : k === 13 || R.futOnly ? 1 : 1 + Math.floor(r() * 4);
    const svc = () => { let x = r() * 100; for (let s = 0; s < SVC_W.length; s++) { if ((x -= SVC_W[s]) < 0) return DEMO_SERVICES[s]; } return DEMO_SERVICES[0]; };
    for (let v = 0; v < n; v++) {
      const d = L + v * g;
      if (d > 180) break;
      const h = 10 + Math.floor(r() * 9), m = r() < 0.5 ? "00" : "30";
      put(rec(i, { dt: iso(-d, h, m), cd: iso(-d - 1 - Math.floor(r() * 5), 12, "00"), att: i % 13 === 4 && v === 1 ? -1 : 1, name, staff: r() < 0.8 ? master : DEMO_MASTERS[Math.floor(r() * 5)], svc: svc() }));
    }
    if (i % 17 === 6) put(rec(i, { dt: iso(-(L + 3), 15, "00"), cd: iso(-(L + 6), 11, "00"), att: 0, del: true, name, staff: master, svc: DEMO_SERVICES[0] })); // давняя отменённая запись
    if (R.future || R.futOnly) {
      const F = 1 + Math.floor(r() * 25), h = 11 + Math.floor(r() * 7);
      const b = rec(i, { dt: iso(F, h, "00"), cd: iso(-(1 + Math.floor(r() * 8)), 11, "00"), att: 0, name, staff: master, svc: svc() });
      if (R.moved) put({ ...b, datetime: iso(F + 2, Math.min(20, h + 1), "30") }, b);
      else if (R.cancelled) put({ ...b, deleted: true }, b);
      else put(b);
    }
  }
  // скрытые номера (у ключа журнала нет права видеть телефоны) и неверные — записи есть, контактов нет; перерыв мастера — без клиента
  for (let j = 0; j < 3; j++) put({ id: "demo-" + (++rid), datetime: iso(-(9 + j * 11), 13, "00"), create_date: iso(-(12 + j * 11), 10, "00"), attendance: 1, deleted: false, client: { id: "demo-m" + j, name: "Скрытый номер", phone: `+7 700 XXX-X6-${10 + j}` }, staff: { id: 900, name: DEMO_MASTERS[j] }, services: [{ id: 990, title: DEMO_SERVICES[0] }] });
  for (const [j, ph] of ["12345", "8 000 00"].entries()) put({ id: "demo-" + (++rid), datetime: iso(-(15 + j * 7), 16, "00"), create_date: iso(-(17 + j * 7), 10, "00"), attendance: 1, deleted: false, client: { id: "demo-b" + j, name: "Номер с ошибкой", phone: ph }, staff: { id: 901, name: DEMO_MASTERS[1] }, services: [{ id: 990, title: DEMO_SERVICES[0] }] });
  put({ id: "demo-" + (++rid), datetime: iso(-2, 14, "00"), deleted: false, staff: { id: 902, name: DEMO_MASTERS[2] }, services: [], comment: "перерыв" });

  // рассылки: получатели — клиенты журнала с подтверждённым согласием (каждый — в одной рассылке; согласие давнее, до рассылок).
  // Последняя — в этом месяце, если можно (календарь показывает месяц с 1-го числа)
  const pool = Array.from({ length: JOURNAL }, (_, i) => i).filter(i => { const R = demoRole(i); return R.consent && !R.recentConsent && !R.futOnly && !R.stop && !R.review && !R.block && !R.denied; });
  const dom = +today.slice(8, 10);
  const campaigns = CAMPAIGNS.map((C0, ci) => {
    const C = ci === 2 && dom > 1 ? { ...C0, ago: Math.min(C0.ago, dom - 1) } : C0;
    const send = altMs(iso(-C.ago, C.hh, "00")), who = pool.filter((_, j) => j % 4 === ci).slice(0, C.take);
    const people = who.map((i, j) => {
      const at = send + j * 60e3, failed = j % 11 === 5, delivered = !failed && j % 10 !== 7, read = delivered && j % 5 < 3, replied = delivered && j % 6 === 1;
      return { i, p: demoPhone(i), name: fullName(i), at, failed, delivered, read, replied, stop: replied && j === 13 && ci < 2, booked: !failed && j % 4 === 2, late: !failed && j % 9 === 4 };
    });
    for (const x of people) { // запись после сообщения: через 1–3 дня (в окне 14 дней); у части — через 18 дней (вне окна, не считается)
      const lag = x.booked ? 1 + (x.i % 3) : x.late && C.ago > 19 ? 18 : 0;
      if (!lag) continue;
      const made = Math.min(altMs(`${dayAdd(dayOf(x.at), lag)}T15:00:00+05:00`), now - 3600e3); // запись не создана «в будущем»
      if (made <= x.at) { x.booked = false; continue; }
      const dt = `${dayAdd(dayOf(made), 2 + (x.i % 5))}T14:00:00+05:00`, cd = new Date(made + 5 * 3600e3).toISOString().slice(0, 19) + "+05:00";
      put(rec(x.i, { dt, cd, att: altMs(dt) > now ? 0 : 1, name: demoRole(x.i).shortName ? FIRST[(x.i * 11) % FIRST.length] : fullName(x.i), staff: DEMO_MASTERS[x.i % 5], svc: C.segId === "postoyannye" ? "Premium" : DEMO_SERVICES[0] }));
    }
    return { ...C, send, people };
  });
  const used = new Set(campaigns.flatMap(C => C.people.map(x => x.i)));
  const draft = { ...DRAFT, people: pool.filter(i => !used.has(i)).slice(0, DRAFT.take).map(i => ({ i, p: demoPhone(i), name: fullName(i) })) };

  // анкеты-файл: согласие «да» у части (не подтверждено), новые люди без визитов, повтор номера и неверный номер — как в живом файле
  const table = [["Телефон", "Имя", "Согласие на рассылки"]];
  for (let i = 0; i < DEMO_N; i++) { const R = demoRole(i); if (R.fromFile || (i >= JOURNAL && i < 146)) table.push([fmt(demoPhone(i)), fullName(i), R.fromFile ? "да" : ""]); }
  table.push([fmt(demoPhone(140)), fullName(140), ""], ["12345", "Ошибка в номере", "да"]);
  const manual = [146, 147, 148, 149, 5]; // 5 — уже есть из журнала: ручное добавление второго контакта не создаёт
  return { after, before, table, manual, campaigns, draft, from: dayAdd(today, -185), to: dayAdd(today, 60) };
}

/** @param {Env} env @param {Client} c @param {number} now @returns {Promise<any>} */
async function dbFor(env, c, now) {
  if (stageOf(env) !== "preview") throw fail("preview", "Демо-база — только на черновике (тестовой версии). На боевом сайте её нет.");
  const db = await d1Ready(env, now);
  if (!db) throw fail("db", "База контактов не подключена.");
  if (!(await demoReady(db))) throw fail("setup", "В базе черновика нет миграции 0004 (источник «демо»). Примените миграции черновика, потом загрузите демо-базу.");
  return db;
}

/**
 * Загрузить демо-базу (только черновик, только владелец — проверяет контроллер). Прежняя демо-база сначала убирается.
 * @param {Env} env @param {Client} c @param {number} now
 */
export async function demoLoad(env, c, now) {
  const db = await dbFor(env, c, now), ws = c.id;
  await clearAll(env, db, c, now);
  const plan = demoPlan(now), phones = demoPhones();
  // 1. журнал Altegio тем же путём записи: двое суток назад (до переноса и отмен), потом сейчас — перенос и отмена видны как изменения
  await applyWindow(db, ws, plan.before, plan.from, plan.to, false, now - 2 * 86400e3, []);
  const st = await applyWindow(db, ws, plan.after, plan.from, plan.to, false, now, []);
  // 2. добавлены вручную: новый номер — новый контакт; номер, который уже есть, — тот же контакт (второго нет). У 149 — только имя:
  // анкета ниже дополнит фамилию и допишет источник «импорт» к «вручную»
  let manualNew = 0;
  for (const i of plan.manual) {
    const nm = i === 149 ? FIRST[(i * 11) % FIRST.length] : fullName(i);
    const r = await contactAdd(db, ws, { id: newId(), phone: demoPhone(i), name: nm, search: searchOf(nm, demoPhone(i)), actor: "owner", at: now - (10 + i % 7) * 86400e3 });
    if (r.created) manualNew++;
  }
  // 3. анкеты-файл — настоящим импортом (предпросмотр → «Загрузить»): согласия из файла «не подтверждены»
  const imp = await importPreview(db, ws, plan.table, { id: newId(), by: "owner", at: now - 3 * 86400e3, sourceName: DEMO_FILE });
  const ir = await importApply(db, ws, imp.id, { basis: "анкета в салоне (демо)", actor: "owner", at: now - 3 * 86400e3 });
  const ids = await contactsByPhones(db, ws, phones), idOf = (/** @type {number} */ i) => (ids.get(demoPhone(i)) || { id: "" }).id;
  // 4. отметка «демо» и согласия одной пачкой: подтверждённые (анкета, сообщение клиента, устно), отказ
  const list = [...demoSourceStmts(db, ws, phones, now)];
  let granted = 0, denied = 0;
  for (let i = 0; i < DEMO_N; i++) {
    const R = demoRole(i), id = idOf(i);
    if (!id) continue;
    if (R.consent) {
      const ev = ["document", "chat", "oral"][i % 3], given = R.recentConsent ? now - (1 + Math.floor(i / 20) % 5) * 86400e3 - 2 * 3600e3 : now - (45 + (i * 13) % 300) * 86400e3;
      list.push(...consentStmts(db, ws, { contactId: id, purpose: "marketing", state: "granted", basis: ev === "document" ? "письменное согласие (демо)" : ev === "chat" ? "клиент написал в WhatsApp (демо)" : "устно в салоне (демо)",
        source: "manual", actor: "owner", at: given + 3600e3, evidence: ev, evidenceRef: ev === "document" ? `анкета D-${100 + i} (демо)` : ev === "chat" ? "сообщение клиента «да, присылайте» (демо)" : null, confirmed: true, givenAt: given }));
      granted++;
    }
    if (R.denied) { const at = now - (2 + Math.floor(i / 50) * 3) * 86400e3; list.push(...consentStmts(db, ws, { contactId: id, purpose: "marketing", state: "denied", basis: "отказался устно (демо)", source: "manual", actor: "owner", at, evidence: "oral", confirmed: true, givenAt: at })); denied++; }
  }
  await db.batch(list);
  // 5. «стоп» — тем же кодом, что сообщение клиента «стоп» в WhatsApp (D1 и зеркало KV); неоднозначный — только D1; полный запрет — вручную
  let stops = 0, reviews = 0;
  for (let i = 0; i < DEMO_N; i++) {
    const R = demoRole(i);
    if (R.stop) { await stopRecord(env, { ws, phone: demoPhone(i), kind: "stop", source: "chat_stop", eventKey: `demo:${ws}:stop:${i}`, text: "стоп", at: now - (1 + Math.floor(i / 20) * 4) * 86400e3 - 3600e3 }); stops++; } // 1, 5, 9 … дней назад
    if (R.review) { await stopRecord(env, { ws, phone: demoPhone(i), kind: "review", source: "chat_stop", eventKey: `demo:${ws}:review:${i}`, text: "пока не пишите, я уезжаю", at: now - (2 + i % 9) * 86400e3 }); reviews++; }
    if (R.block && idOf(i)) { await restrictionAdd(db, ws, { contactId: idOf(i), kind: "full_block", reason: "просил не писать вообще (демо)", source: "admin", actor: "owner", at: now - 12 * 86400e3, eventKey: `demo:${ws}:block:${i}` }); await optoutPut(env, ws, demoPhone(i), String(now)); }
  }
  // 6. рассылки: KV (как настоящие, с demo: 1), отчёты и отправки — D1, отметки «писали рекламу» — KV bcm:
  const cr = await campaignsSave(env, db, c, plan, now);
  for (const x of cr.stops) { await stopRecord(env, { ws, phone: x.p, kind: "stop", source: "chat_stop", eventKey: x.key, text: "стоп", at: x.at }); stops++; }
  // 7. снимок базы для рассылок — как «Обновить базу»: журнал за 90 дней назад и 60 вперёд
  const from = isoDay(now - CRM_PAST_DAYS * 86400e3), to = isoDay(now + CRM_FUTURE_DAYS * 86400e3);
  const inRange = plan.after.filter(r => { const d = String(r.datetime || "").slice(0, 10); return d >= from && d <= to; }), f = crmFold(inRange, now);
  await crmSave(env, ws, { at: now, from, to, records: inRange.length, visits: f.visits, clients: f.list.length, masked: f.masked, bad: f.bad, att: f.att, cut: false, demo: 1, list: f.list, futOnly: f.futOnly });
  // 8. сводка клиентов на сейчас и отметка загрузки
  await recompute(db, ws, now, [...ids.values()].map(x => x.id));
  await db.batch([demoMarkStmt(db, ws, now, { campaigns: DEMO_CAMPAIGN_IDS, bcmDays: cr.days, contacts: DEMO_N })]);
  try { await auditAdd(db, ws, "owner", "demo_load", null, { contacts: DEMO_N }, now); } catch (e) {}
  const total = await demoCount(db, ws);
  return {
    contacts: total, bookings: st.bookings, campaigns: DEMO_CAMPAIGN_IDS.length,
    summary: [
      `Демо-база загружена: ${total} вымышленных клиентов (номера +7 700 000 60 00 … 61 49), записей Altegio ${st.bookings}: скрытых номеров ${st.masked}, с ошибкой ${st.bad}, отменённых ${st.deleted}, «не пришёл» ${st.missed}.`,
      `Разрешения: подтверждённое согласие — ${granted}, из анкеты-файла (не подтверждено) — ${ir.consentsUnconfirmed}, «стоп» — ${stops}, неоднозначный «стоп» — ${reviews}, полный запрет — 1, отказ — ${denied}.`,
      `Источники: журнал Altegio, анкеты-файл (новых ${ir.created}, обновлено ${ir.updated}), вручную — ${manualNew}; один номер — один контакт.`,
      `Рассылки за 30 дней: ${plan.campaigns.length} завершённых и черновик, который ждёт одобрения (все с пометкой «демо»); записались после сообщения (14 дней) — ${cr.booked}.`,
      "Это вымышленные люди: настоящим клиентам ничего не отправлено. «Убрать демо-базу» удаляет только их."
    ]
  };
}

/** Рассылки демо в KV и их отчёты в D1. → дни отметок bcm:, кто написал «стоп» после рассылки, сколько записались после (как в итогах рассылки).
 *  @param {Env} env @param {any} db @param {Client} c @param {ReturnType<typeof demoPlan>} plan @param {number} now */
async function campaignsSave(env, db, c, plan, now) {
  const ws = c.id, events = /** @type {any[]} */ ([]), sends = /** @type {any[]} */ ([]), days = /** @type {string[]} */ ([]), stops = /** @type {any[]} */ ([]);
  for (const C of plan.campaigns) {
    const ok = C.people.filter(x => !x.failed), bad = C.people.filter(x => x.failed), end = C.send + (C.people.length + 2) * 60e3;
    for (const x of C.people) {
      const ev = (/** @type {string} */ kind, /** @type {number} */ at) => events.push({ kind, bc: C.id, p: x.p, at, ch: "wa" });
      sends.push({ bc: C.id, p: x.p, at: x.at, ok: !x.failed, ch: "wa" });
      if (x.failed) { ev("failed", x.at + 20e3); continue; }
      ev("sent", x.at);
      if (x.delivered) ev("delivered", x.at + 40e3);
      if (x.read) ev("read", x.at + (1 + (x.i % 6)) * 3600e3);
      if (x.replied) ev("replied", x.at + (2 + (x.i % 18)) * 3600e3);
      if (x.stop) stops.push({ p: x.p, at: x.at + 4 * 3600e3, key: `demo:${ws}:stop:${C.id}:${x.i}` });
    }
    /** @type {Record<string, any>} */
    const b = { id: C.id, name: C.name, text: C.text, fallback: "уважаемый клиент", created: C.send - 3600e3, by: "owner", status: "done", total: C.people.length, pos: C.people.length,
      sent: ok.length, failed: bad.length, skipped: 0, cap: 240, from: 10, to: 20, src: "crm", seg: C.seg, segId: C.segId, crmAt: C.send - 3600e3, tpl: C.tpl, lang: "ru", params: ["{имя}"],
      startedAt: C.send, last: end, doneAt: end, approvedBy: "владелец", approvedAt: C.send - 600e3, demo: 1,
      ...(bad.length ? { fails: { 131026: bad.length }, bad: bad.map(x => [x.p, 131026]) } : {}) };
    await bcChunksSave(env, ws, C.id, C.people.map(x => [x.p, x.name]));
    await bcPut(env, ws, b);
    const day = isoDay(C.send);
    if (now - C.send < 31 * 86400e3) { await bcmAdd(env, ws, day, ok.map(x => x.p)); days.push(day); }
  }
  // черновик: сегмент «вся база», ждёт одобрения владельца — отчётов нет
  const D = plan.draft;
  await bcChunksSave(env, ws, D.id, D.people.map(x => [x.p, x.name]));
  await bcPut(env, ws, { id: D.id, name: D.name, text: D.text, fallback: "уважаемый клиент", created: now - 2 * 3600e3, by: "staff", status: "ready", total: D.people.length, pos: 0, sent: 0, failed: 0, skipped: 0,
    cap: 240, from: 10, to: 20, src: "crm", seg: D.seg, segId: D.segId, crmAt: now, tpl: D.tpl, lang: "ru", params: ["{имя}"], demo: 1 });
  await demoReports(db, ws, { events, sends });
  let booked = 0;
  for (const C of plan.campaigns) booked += (await campaignResults(db, ws, C.id, 14 * 86400e3)).booked;
  return { days, stops, booked };
}

/** Убрать демо: D1 (только демо-строки) и демо-ключи KV. @param {Env} env @param {any} db @param {Client} c @param {number} now */
async function clearAll(env, db, c, now) {
  const ws = c.id, phones = demoPhones(), mark = await demoMark(db, ws);
  const n = await demoDelete(db, ws, phones, DEMO_FILE, phones.map(p => `optout:${ws}:${p}`));
  // «стоп» и следы починки у демо-номеров (настоящие номера не трогаем)
  const set = new Set(phones);
  for (const p of await optoutPhones(env, ws)) if (set.has(p)) await optoutDel(env, ws, p);
  for (const k of await kvKeys(env, `syncerr:${ws}:`)) if (set.has(k.name.slice(`syncerr:${ws}:`.length))) await syncerrDel(env, k.name);
  // рассылки с пометкой «демо» и их получатели
  /** @type {Set<string>} */ const bcs = new Set(DEMO_CAMPAIGN_IDS);
  try { for (const r of await bcList(env, ws, 1000)) if (r.demo) bcs.add(String(r.id)); } catch (e) {}
  for (const id of bcs) { const b = await bcGet(env, ws, id); if (b && b.demo) await bcDrop(env, ws, id, +b.total || 0); }
  // отметки «писали рекламу»: убрать демо-номера (настоящие остаются)
  const days = new Set([...((mark && mark.info && mark.info.bcmDays) || []).map(String), ...Array.from({ length: 32 }, (_, i) => isoDay(now - i * 86400e3))]);
  for (const d of days) await bcmDrop(env, ws, d, set);
  // снимок базы — только если это снимок демо (настоящий, собранный «Обновить базу», не трогаем)
  const snap = await crmLoad(env, ws);
  if (snap && snap.demo) await crmDrop(env, ws);
  return n;
}

/** «Убрать демо-базу». @param {Env} env @param {Client} c @param {number} now */
export async function demoClear(env, c, now) {
  const db = await dbFor(env, c, now), n = await clearAll(env, db, c, now);
  try { await auditAdd(db, c.id, "owner", "demo_clear", null, { contacts: n }, now); } catch (e) {}
  return { contacts: n, summary: [n ? `Демо-база убрана: удалено ${n} вымышленных клиентов, их записи, согласия, запреты и демо-рассылки.` : "Демо-базы не было — убирать нечего.", "Настоящие данные не тронуты."] };
}

/** Загружена ли демо-база — для экрана «Клиенты». @param {any} db @param {string} ws @returns {Promise<{ demo: boolean, demoAt: number | null }>} */
export async function demoState(db, ws) {
  try { const m = await demoMark(db, ws); return { demo: !!m, demoAt: m ? m.at : null }; } catch (e) { return { demo: false, demoAt: null }; }
}
