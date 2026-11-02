// Проверка бизнес-логики клиентов перед кампаниями (31.10.2026, требования владельца): границы дней по Астане, отказ клиента и новое
// подтверждённое согласие, неподтверждённые согласия из файла, один контакт из Altegio + файла + вручную, отменённые и перенесённые
// записи, «ещё не проверено», справочник клиентов Altegio за пределами 2 лет. Всё на заглушках, номера вымышленные.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { CLIENTS } from "../../src/config/builtin-clients.js";
import { syncStep, syncDry } from "../../src/services/contacts/sync.js";
import { altProbe } from "../../src/services/contacts/probe.js";
import { altMs } from "../../src/services/contacts/normalize.js";
import { contactsSegments, contactsList, contactsCard, contactsStatus, contactsConsent, contactsLift, contactsAdd, contactsRestrict, contactsImport, contactsImportConfirm, optIn } from "../../src/services/contacts/index.js";

const skip = sqliteOk ? false : "node:sqlite есть только в Node 22+";
const W = CLIENTS.winchester, NOW = Date.now(); // часы обвязки: 3 октября 2026, 12:00 по Астане
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok" };
const INST = { id: "7105000077", token: "ga-tok-w" };
const day = n => new Date(NOW - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
let rid = 0;
const rec = (phone, at, o = {}) => ({ id: o.id || ++rid, datetime: at, deleted: !!o.del, attendance: o.att ?? 1, staff: { id: 1, name: o.staff || "Тони" }, client: { id: o.cid || 1, phone, name: o.name ?? "Клиент" }, services: [{ id: 1, title: "Мужская стрижка" }] });
const prod = (extra = {}) => { const d = d1With("production"); return { d, s: mk({ ...ENV, DB: d.db, ...extra }) }; };
async function full(env) { let r; for (let i = 0; i < 6; i++) { r = await syncStep(env, W, Date.now()); if (r.initial.done) return r; } return r; }
const seg = async (env, id, t = Date.now()) => (await contactsSegments(env, W, t)).segments.find(x => x.id === id);
const idOf = (d, phone) => d.raw.prepare("select id from contacts where phone = ?").get(phone).id;

test("даты по Астане: граница суток не по UTC, время без пояса — по Астане, «был N дней назад» считает сервер", { skip }, async () => {
  net.reset(); rid = 0;
  assert.equal(altMs("2026-10-02 23:30:00"), Date.parse("2026-10-02T23:30:00+05:00"), "без пояса — Астана");
  net.altJournal = [
    rec("+77000000901", "2026-10-02T23:30:00+05:00"),                    // вчера поздно вечером (по UTC — тоже 2-е)
    rec("+77000000902", "2026-10-03T00:10:00+05:00"),                    // сегодня сразу после полуночи (по UTC ещё 2-е!)
    rec("+77000000903", "2026-09-12T23:59:00+05:00"),                    // ровно 21 день — «Пора на стрижку»
    rec("+77000000904", "2026-09-13T00:01:00+05:00"),                    // 20 дней (по UTC — 12-е, был бы 21)
    rec("+77000000905", "2026-10-04T00:30:00+05:00", { att: 0 })         // завтра в 00:30 (по UTC — ещё сегодня): запись впереди
  ];
  const { s } = prod();
  await full(s.env);
  const items = (await contactsList(s.env, W, Date.now(), {})).items, by = Object.fromEntries(items.map(x => [x.phone.slice(-2), x]));
  assert.equal(by["01"].daysAgo, 1); assert.equal(by["02"].daysAgo, 0);
  assert.equal(by["03"].daysAgo, 21); assert.equal(by["04"].daysAgo, 20);
  assert.ok(by["05"].nextBookingAt > NOW && by["05"].daysAgo === null);
  const pora = await contactsList(s.env, W, Date.now(), { seg: "pora" });
  assert.deepEqual(pora.items.map(x => x.phone.slice(-2)), ["03"], "21 день по Астане — в сегменте, 20 — нет");
  assert.equal((await seg(s.env, "zapis")).count, 1);
});

test("отказ клиента: «стоп» — это и отказ в согласии; снять нельзя ни владельцу, ни устным «да»; клиент сам написал — можно", { skip }, async () => {
  net.reset();
  const d = d1With("production"), s = mk({ ...ENV, DB: d.db, GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token });
  await s.gaText("winchester", INST, "77000000911", "стоп", { idMessage: "R-1" });
  const id = idOf(d, "77000000911");
  let card = await contactsCard(s.env, W, Date.now(), id);
  assert.equal(card.consent.marketing.state, "denied"); assert.equal(card.consent.marketing.evidence, "client_stop"); assert.equal(card.consent.marketing.confirmed, true);
  const r = card.restrictions.find(x => x.active);
  assert.equal(r.byClient, true); assert.equal(r.canLift, false); assert.match(r.liftHint, /нового подтверждённого согласия/);
  assert.equal(card.consentRules.chatAvailable, false); assert.equal(card.consentRules.oralAllowed, false); assert.ok(card.consentRules.refusedAt > 0);
  await assert.rejects(contactsLift(s.env, W, Date.now(), { id, rid: r.id, reason: "владелец решил" }, "owner", true), e => e.code === "consent");
  await assert.rejects(contactsConsent(s.env, W, Date.now(), { id, purpose: "marketing", state: "granted", evidence: "oral" }, "owner"), e => e.code === "consent");
  await assert.rejects(contactsConsent(s.env, W, Date.now(), { id, purpose: "marketing", state: "granted", evidence: "chat" }, "owner"), e => e.code === "consent" && /не писал/.test(e.message));
  await assert.rejects(contactsConsent(s.env, W, Date.now(), { id, purpose: "marketing", state: "granted", evidence: "document", evidenceRef: "анкета", givenAt: day(30) }, "owner"), e => e.code === "consent" && /раньше отказа/.test(e.message));
  // обычное сообщение и отрицания после «стопа» — не согласие (находки проверки безопасности 31.10.2026)
  net.ai = ["Хорошо!"];
  await s.gaText("winchester", INST, "77000000911", "а на завтра есть время?", { idMessage: "R-1b" });
  await s.gaText("winchester", INST, "77000000911", "не согласен", { idMessage: "R-1c" });
  await s.gaText("winchester", INST, "77000000911", "не хочу получать рассылку", { idMessage: "R-1d" });
  assert.equal((await contactsCard(s.env, W, Date.now(), id)).consentRules.chatAvailable, false);
  await assert.rejects(contactsConsent(s.env, W, Date.now(), { id, purpose: "marketing", state: "granted", evidence: "chat" }, "owner"), e => e.code === "consent");
  // клиент сам написал «присылайте» — подтверждение в переписке
  await s.gaText("winchester", INST, "77000000911", "присылайте акции снова, пожалуйста", { idMessage: "R-2" });
  card = await contactsCard(s.env, W, Date.now(), id);
  assert.equal(card.consentRules.chatAvailable, true);
  await contactsConsent(s.env, W, Date.now(), { id, purpose: "marketing", state: "granted", evidence: "chat" }, "staff");
  card = await contactsCard(s.env, W, Date.now(), id);
  assert.equal(card.consent.marketing.confirmed, true); assert.match(card.consent.marketing.evidenceRef, /сообщение клиента .*«присылайте акции снова/);
  assert.equal(card.restrictions.find(x => x.active).canLift, true);
  await contactsLift(s.env, W, Date.now(), { id, rid: r.id, reason: "клиент сам попросил присылать" }, "owner", true);
  assert.equal(s.kv.mem.get("optout:winchester:77000000911"), undefined);
  // технический запрет (поставил человек) снимается с причиной, без нового согласия
  const x = await contactsAdd(s.env, W, Date.now(), { phone: "+77000000912", name: "Т" }, "staff");
  await contactsRestrict(s.env, W, Date.now(), { id: x.id, kind: "marketing_optout", reason: "администратор попросил подождать" }, "staff");
  const rr = (await contactsCard(s.env, W, Date.now(), x.id)).restrictions.find(y => y.active);
  assert.equal(rr.byClient, false); assert.equal(rr.canLift, true);
  await contactsLift(s.env, W, Date.now(), { id: x.id, rid: rr.id, reason: "подождали" }, "owner", true);
});

test("импорт согласий: из файла — «не подтверждено», рекламы нет; кто сам отказывался — «да» из файла не пишется; подтвердили — можно", { skip }, async () => {
  net.reset();
  const d = d1With("production"), s = mk({ ...ENV, DB: d.db, GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token });
  await s.gaText("winchester", INST, "77000000922", "отписаться", { idMessage: "I-1" });
  const csv = "Телефон;Имя;Согласие\n+77000000921;Арман;да\n+77000000922;Ерлан;да\n+77000000923;Олжас;нет\n";
  const pv = await contactsImport(s.env, W, Date.now(), new TextEncoder().encode(csv), "файл.csv", "owner");
  assert.match(pv.consentNote, /не подтверждено/);
  const r = await contactsImportConfirm(s.env, W, Date.now(), { id: pv.id, consentBasis: "анкета в салоне" }, "owner");
  assert.deepEqual([r.consents, r.consentsUnconfirmed, r.consentsSkipped], [2, 1, 1]);
  const a = idOf(d, "77000000921");
  let card = await contactsCard(s.env, W, Date.now(), a);
  assert.equal(card.consent.marketing.state, "granted"); assert.equal(card.consent.marketing.confirmed, false); assert.equal(card.consent.marketing.evidence, "import");
  assert.ok(card.canMarket.reasons.some(x => /не подтверждено/.test(x)));
  assert.equal((await seg(s.env, "all")).ready, 0);
  assert.equal((await contactsCard(s.env, W, Date.now(), idOf(d, "77000000922"))).consent.marketing.state, "denied", "отказ клиента остался");
  await contactsConsent(s.env, W, Date.now(), { id: a, purpose: "marketing", state: "granted", evidence: "oral", basis: "подтвердил в салоне" }, "staff");
  card = await contactsCard(s.env, W, Date.now(), a);
  assert.equal(card.consent.marketing.confirmed, true); assert.equal(card.canMarket.ok, true);
  assert.equal((await seg(s.env, "all")).ready, 1);
});

test("один человек из Altegio, Excel и вручную — один контакт: источники, имя, история согласий и запреты сохраняются", { skip }, async () => {
  net.reset(); rid = 0;
  const { d, s } = prod();
  const m = await contactsAdd(s.env, W, Date.now(), { phone: "8 (700) 000-09-31", name: "Записал администратор" }, "staff");
  await contactsConsent(s.env, W, Date.now(), { id: m.id, purpose: "marketing", state: "granted", evidence: "oral", basis: "в салоне" }, "staff");
  await contactsRestrict(s.env, W, Date.now(), { id: m.id, kind: "full_block", reason: "просил не писать вообще" }, "staff");
  const pv = await contactsImport(s.env, W, Date.now(), new TextEncoder().encode("Телефон;Имя\n+7 700 000 09 31;Из файла\n"), "база.csv", "owner");
  assert.equal(pv.counts.update, 1, "дубль по номеру — обновится, не новый");
  await contactsImportConfirm(s.env, W, Date.now(), { id: pv.id }, "owner");
  net.altJournal = [rec("77000000931", `${day(30)}T12:00:00+05:00`, { name: "Арман Сейтов", cid: 5551 })];
  await full(s.env);
  assert.equal(d.raw.prepare("select count(*) n from contacts").get().n, 1);
  const card = await contactsCard(s.env, W, Date.now(), m.id);
  assert.deepEqual(card.contact.sources.map(x => x.source).sort(), ["altegio", "import", "manual"]);
  assert.equal(card.contact.name, "Арман Сейтов", "имя из Altegio (новее)"); assert.equal(card.contact.altegioId, "5551");
  assert.equal(card.contact.visits, 1);
  assert.equal(card.restrictions.filter(x => x.active).length, 1, "запрет «не писать вообще» на месте");
  assert.equal(card.consentHistory.length, 1);
  assert.equal(card.canMarket.ok, false);
});

test("отменённая и пропавшая запись: клиент не возвращается в рекламу сразу — пауза 14 дней; перенос — без паузы; нашлась — пауза снята", { skip }, async () => {
  net.reset(); rid = 0;
  const { d, s } = prod();
  const past = (p, n) => rec(p, `${day(n)}T12:00:00+05:00`), fut = (p, n, o) => rec(p, `${day(-n)}T15:00:00+05:00`, { att: 0, ...o });
  const a1 = fut("77000000941", 3), b1 = fut("77000000942", 4), c1 = fut("77000000943", 5);
  net.altJournal = [past("77000000941", 25), past("77000000942", 25), past("77000000943", 25), a1, b1, c1];
  await full(s.env);
  for (const p of ["77000000941", "77000000942", "77000000943"]) await contactsConsent(s.env, W, Date.now(), { id: idOf(d, p), purpose: "marketing", state: "granted", evidence: "oral", basis: "в салоне" }, "staff");
  assert.equal((await seg(s.env, "pora")).ready, 0, "все записаны — рекламы нет");
  a1.deleted = true;                                      // отменили в Altegio (запись отдаётся удалённой)
  net.altJournal.splice(net.altJournal.indexOf(b1), 1);   // удалили — запись пропала из журнала
  c1.datetime = `${day(-20)}T15:00:00+05:00`;             // перенесли на 20 дней вперёд — та же запись
  await syncStep(s.env, W, Date.now(), { force: true });
  const rows = d.raw.prepare("select c.phone, r.until_at, r.reason from restrictions r join contacts c on c.id = r.contact_id where r.kind = 'cooldown' and r.lifted_at is null order by c.phone").all();
  assert.deepEqual(rows.map(x => x.phone), ["77000000941", "77000000942"]);
  assert.match(rows[0].reason, /отменена/); assert.match(rows[1].reason, /пропала/);
  assert.equal(Math.round((rows[0].until_at - Date.now()) / 86400e3), 14);
  assert.equal((await seg(s.env, "pora")).ready, 0, "отменили — всё равно пауза, а перенёсший записан");
  const card = await contactsCard(s.env, W, Date.now(), idOf(d, "77000000941"));
  assert.ok(card.canMarket.reasons.some(x => /пауза до/.test(x)));
  assert.equal(card.restrictions.find(x => x.kind === "cooldown").untilAt > Date.now(), true);
  // пропавшая запись нашлась (её перенесли за край окна и обратно) — пауза снята
  net.altJournal.push(b1);
  await syncStep(s.env, W, Date.now() + 16 * 60e3, { force: true });
  assert.equal(d.raw.prepare("select count(*) n from restrictions where kind = 'cooldown' and lifted_at is null").get().n, 1);
  // через 15 дней пауза кончилась сама — по времени, а не потому, что запись исчезла
  assert.equal((await seg(s.env, "all", Date.now() + 15 * 86400e3)).ready >= 1, true);
});

test("«ещё не проверено» — не успех: на черновике без данных проверки серые, а не зелёные", { skip }, async () => {
  net.reset();
  const s = mk({ ...ENV, DB: d1With("preview").db, STAGE: "preview" });
  const st = await contactsStatus(s.env, W, Date.now(), true), lv = Object.fromEntries(st.checks.map(c => [c.id, c.level]));
  for (const id of ["initial", "directory", "fresh", "probe", "visits", "stale", "orphans", "sweep"]) assert.equal(lv[id], "unknown", id);
  assert.ok(st.checks.filter(c => c.level === "unknown").every(c => c.hint), "у каждой серой — пояснение");
  assert.equal(lv.issues, "ok", "расхождений «стопа» нет — это проверено");
});

test("справочник клиентов Altegio: вся база, а не только журнал за 2 года — давние клиенты в «Больше 90 дней», флаг рассылок, скрытые номера", { skip }, async () => {
  net.reset(); rid = 0;
  net.altJournal = [rec("77000000951", `${day(10)}T12:00:00+05:00`, { cid: 1 })];
  net.altClients = [
    { id: 1, name: "Арман", surname: "С.", phone: "+77000000951", first_visit_date: day(400), last_visit_date: day(10), visits_count: 12, nl: true },
    ...Array.from({ length: 449 }, (_, i) => ({ id: 2 + i, name: "Давний " + i, phone: "+7700001" + String(i).padStart(4, "0"), first_visit_date: day(1500), last_visit_date: day(800 + i), visits_count: 2, nl: i < 5 })),
    { id: 900, name: "Скрытый", phone: "+7 707 XXX-X7-44", last_visit_date: day(900) }
  ];
  net.altClientsNoVisits = true; // Altegio не принял visits_count — справочник читается без него
  const { d, s } = prod();
  await full(s.env);
  for (let i = 0; i < 4; i++) await syncStep(s.env, W, Date.now() + (i + 1) * 16 * 60e3, { force: true });
  assert.equal(d.raw.prepare("select count(*) n from contacts").get().n, 450, "вся база, без скрытого номера");
  const st = await contactsStatus(s.env, W, Date.now(), true);
  assert.equal(st.sync.directory.done, true); assert.equal(st.sync.directory.total, 451); assert.equal(st.sync.directory.masked, 1);
  assert.equal(st.checks.find(c => c.id === "directory").level, "ok");
  assert.equal((await seg(s.env, "ushli")).count, 449, "не были больше 2 лет — в «Больше 90 дней»");
  assert.equal((await seg(s.env, "bez")).count, 0, "давние клиенты — не «без визитов»");
  assert.equal(d.raw.prepare("select count(*) n from contacts where alt_newsletter = 1").get().n, 6);
  const card = await contactsCard(s.env, W, Date.now(), idOf(d, "77000000951"));
  assert.equal(card.contact.newsletter, true); assert.equal(card.contact.name, "Арман С.");
  assert.equal(card.contact.daysAgo, 10);
  assert.ok(!card.canMarket.ok, "флаг Altegio — не подтверждённое согласие");
  // проверка без записи и проба полей видят справочник; в базу черновика ничего не пишут
  const pd = d1With("preview"), ps = mk({ ...ENV, DB: pd.db, STAGE: "preview" });
  const dry = await syncDry(ps.env, W, Date.now());
  assert.ok(dry.summary.some(l => /Справочник клиентов Altegio: всего 451/.test(l)), dry.summary.join("\n"));
  assert.ok(dry.summary.some(l => /больше 2 лет назад — 450/.test(l)), dry.summary.join("\n")); // 449 давних и скрытый номер
  assert.ok(dry.summary.some(l => /Разрешили рассылки .*: 6/.test(l)), dry.summary.join("\n"));
  const pr = await altProbe(ps.env, W, Date.now());
  assert.ok(pr.summary.some(l => /Справочник клиентов: всего 451/.test(l)), pr.summary.join("\n"));
  assert.ok(pr.summary.some(l => /is_newsletter_allowed: 6 клиентов/.test(l)), pr.summary.join("\n"));
  // всё выше — только чтение Altegio: GET и поиск клиентов; «Добавить клиента» (POST /clients/{локация}) не звали (30.10.2026 звали)
  assert.deepEqual(net.alt.filter(x => !/^GET /.test(x) && !/^POST \/locations\/\d+\/clients\/search$/.test(x)), []);
  assert.deepEqual(net.altCreated, []);
  assert.ok(net.alt.some(x => /^POST \/locations\/\d+\/clients\/search$/.test(x)), "справочник — поиском");
  assert.equal(pd.raw.prepare("select count(*) n from contacts").get().n, 0, "в черновик — только числа");
  assert.ok(!/7700001|Давний|Арман/.test(JSON.stringify(pr) + JSON.stringify(pd.raw.prepare("select details from events").all())), "без имён и номеров");
});

test("запрет поставил человек, потом клиент сам написал «стоп»: отказ записан, снять без нового согласия нельзя (находка проверки безопасности)", { skip }, async () => {
  net.reset();
  const d = d1With("production"), s = mk({ ...ENV, DB: d.db, GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token });
  const x = await contactsAdd(s.env, W, Date.now(), { phone: "+77000000961", name: "Т" }, "staff");
  await contactsRestrict(s.env, W, Date.now(), { id: x.id, kind: "marketing_optout", reason: "администратор попросил подождать" }, "staff");
  await s.gaText("winchester", INST, "77000000961", "стоп", { idMessage: "S-1" });
  await s.gaText("winchester", INST, "77000000961", "стоп", { idMessage: "S-1" }); // повтор вебхука — второго отказа нет
  const card = await contactsCard(s.env, W, Date.now(), x.id);
  assert.equal(card.consentHistory.filter(c => c.evidence === "client_stop").length, 1);
  const r = card.restrictions.find(y => y.active);
  assert.equal(r.source, "admin"); assert.equal(r.canLift, false, "клиент отказался позже — без его согласия не снять");
  await assert.rejects(contactsLift(s.env, W, Date.now(), { id: x.id, rid: r.id, reason: "подождали" }, "owner", true), e => e.code === "consent");
});

test("явное «да» клиента — только сообщение целиком без отрицаний (находка проверки безопасности 31.10.2026)", () => {
  for (const t of ["да", "Да!", "согласен", "Я согласна, спасибо", "присылайте акции снова, пожалуйста", "Здравствуйте, можно писать", "старт", "иә", "хочу получать акции"]) assert.equal(optIn(t), true, t);
  for (const t of ["не согласен", "не хочу получать рассылку", "согласен, но не присылайте", "нет", "да не надо", "а на завтра есть время?", "стоп", "присылайте, но не часто", "можно писать? нет, не надо", "согласен на стрижку завтра в 15:00"]) assert.equal(optIn(t), false, t);
});
