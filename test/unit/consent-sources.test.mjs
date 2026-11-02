// Разрешения на рекламу без Altegio (задание владельца 02.11.2026): запуск рассылки не зависит от того, внесено ли согласие в Altegio —
// разрешение живёт в нашей базе D1 и может прийти откуда угодно: клиент сам написал «да» в WhatsApp (сервер находит его сообщение),
// письменно или в WhatsApp на телефоне салона (карточка: где хранится и дата), списком из файла, если владелец подтвердил, что клиенты
// сами дали разрешение (где и когда). Подтверждённые отказы и «стоп» сохраняются: «да» из файла их не отменяет — ни «стоп» клиента
// (в D1 или в прежнем KV), ни отказ из Altegio («не получает массовые уведомления»), ни прежнее «нет». Отсутствующее согласие не
// становится согласием. Сотрудник подтвердить список не может. Затем вся цепочка: база за 90 дней → 28 утверждённых текстов → тест на
// свой номер → подтверждение владельца → отправка только разрешённым через Green-API → ответ клиента в пульте. Ничего не уходит само.
// Всё на заглушках (журнал — net.altJournal, Green-API — net.ga), номера вымышленные (+7 700 000 11 xx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, gaPass } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { CLIENTS } from "../../src/config/builtin-clients.js";
import { crmBuild } from "../../src/services/crm/snapshot.js";
import { bcTick } from "../../src/services/broadcast/sender.js";
import { LIBRARY, CATS } from "../../src/services/broadcast/library.js";
import { restrictionAdd } from "../../src/db/d1/rights.js";
import { dayStart } from "../../src/services/contacts/normalize.js";
import { tableColumns } from "../../src/lib/table.js";

const skip = sqliteOk ? false : "база согласий D1 — node:sqlite есть только в Node 22+";
const W = CLIENTS.winchester, OWNER = "owner-key-123456", STAFF_W = "staff-key-winch-0001";
const INST = { id: "7105000091", token: "ga-tok-w91" };
const ENV = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", KEY_WINCHESTER: STAFF_W, GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
const ON = { ...ENV, GA_BROADCAST_WINCHESTER: "1" };
const NOW = Date.now(); // часы обвязки: 3 октября 2026, 12:00 по Астане
const day = n => new Date(NOW - n * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
let rid = 1100;
const rec = (phone, n, o = {}) => ({ id: ++rid, datetime: `${day(n)}T12:00:00+05:00`, deleted: false, attendance: n > 0 ? 1 : 0, staff: { id: 1, name: "Тони" },
  client: { id: +String(phone).replace(/\D/g, "").slice(-6), phone, name: o.name ?? "Клиент" }, services: [{ id: 1, title: "Мужская стрижка" }] });
const ph = i => "+7700000" + String(i).padStart(4, "0");
const dg = i => ph(i).slice(1);
const gaSent = () => net.ga.filter(x => x.op === "sendMessage").map(x => ({ to: String(x.body.chatId).replace("@c.us", ""), text: x.body.message }));
const hook = (s, body) => s.call(`/ga/winchester?t=${gaPass("winchester", INST)}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ instanceData: { idInstance: +INST.id, wid: "77000000077@c.us" }, timestamp: Math.floor(Date.now() / 1000), ...body }) });

// клиенты (визит N дней назад): 1101–1104 — с разрешением из разных мест; 1105 — писал «стоп»; 1106 — «стоп» в прежнем KV; 1107 —
// в Altegio «не получает массовые уведомления»; 1108 — «нет» в файле; 1109 — «да» из файла без подтверждения; 1110 — разрешения нет;
// 1111 — разрешение есть, но был 120 дней назад (вне базы за 90 дней); 1112 — разрешение есть, но уже записан
const PEOPLE = [[1101, "Азамат", 40], [1102, "Ерлан", 50], [1103, "Данияр", 45], [1104, "Тимур", 60], [1105, "Олжас", 35], [1106, "Нурлан", 30], [1107, "Марат", 70],
  [1108, "Ильяс", 25], [1109, "Самат", 55], [1110, "Руслан", 65], [1111, "Бауыржан", 120], [1112, "Алибек", 40]];
const FILE = "Телефон;Имя;Согласие на рассылку\n" + [[1101, "да"], [1102, "да"], [1105, "да"], [1106, "да"], [1107, "да"], [1108, "нет"], [1111, "да"], [1112, "да"]]
  .map(([i, c]) => `+7 700 000 ${String(i).slice(0, 2)} ${String(i).slice(2)};${PEOPLE.find(x => x[0] === i)[1]};${c}`).join("\n") + "\n";

async function login(s, key) {
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${encodeURIComponent(key)}&next=%2Fapp%2F` });
  assert.ok(b.cookie, "вход ключом " + key.slice(0, 9));
  return b;
}
const post = async (b, path, body) => { const r = await b.post(path, body); return { status: r.status, j: await r.json() }; };
const idOf = (d, i) => d.raw.prepare("select id from contacts where phone = ?").get(dg(i))?.id;
const consentsOf = (d, i) => d.raw.prepare("select s.state, s.confirmed, s.evidence, s.evidence_ref, s.basis, s.given_at from consents s join contacts c on c.id = s.contact_id where c.phone = ? and s.purpose = 'marketing' order by s.id").all(dg(i));

/** база Winchester: журнал за 90+ дней, снимок, отказы до загрузки файла (как в жизни: они уже были) */
async function base(env = ENV) {
  net.reset();
  net.altJournal = [...PEOPLE.map(([i, name, n]) => rec(ph(i), n, { name })), rec(ph(1112), -3, { name: "Алибек" })];
  net.gaSettings[INST.id] = { webhookUrl: `https://bot.test/ga/winchester?t=${gaPass("winchester", INST)}`, incomingWebhook: "yes", outgoingWebhook: "yes" };
  const d = d1With("production"), s = mk({ ...env, DB: d.db });
  await crmBuild(s.env, W, NOW);
  // 1105 сам написал «стоп» на второй номер (D1 + KV), 1106 — «стоп» только в прежнем хранилище KV
  await s.gaText("winchester", INST, dg(1105), "стоп");
  await s.settle();
  await s.kv.api.put(`optout:winchester:${dg(1106)}`, "1");
  // 1107: в Altegio у клиента выключены массовые уведомления — так его записывает синхронизация справочника
  const own = await login(s, OWNER);
  const m = await post(own, "/api/contacts/add", { c: "winchester", phone: ph(1107), name: "Марат" });
  await restrictionAdd(s.env.DB, "winchester", { contactId: m.j.id, kind: "marketing_optout", reason: "Altegio: клиент не получает массовые уведомления", source: "altegio", actor: "sync", legacyKey: "altegio_nomass:" + dg(1107), at: NOW - 86400e3 });
  return { s, d, own, st: await login(s, STAFF_W) };
}
/** список разрешений из файла: владелец подтверждает, что клиенты сами разрешили (где и когда) */
async function importList(b, text, confirm) {
  const pv = await post(b, "/api/contacts/import", { c: "winchester", text });
  assert.equal(pv.status, 200, JSON.stringify(pv.j));
  return { pv: pv.j, r: await post(b, "/api/contacts/import/confirm", { c: "winchester", id: pv.j.id, ...confirm }) };
}
const ATTEST = { consentBasis: "клиенты сами написали «да» в WhatsApp на телефоне салона", consentConfirmed: true, consentGivenAt: "2026-09-15" };

test("разрешения не из Altegio: список с подтверждением владельца — подтверждены; «стоп», отказ в Altegio и «нет» остаются; сотрудник подтвердить не может", { skip }, async () => {
  const { s, d, own, st } = await base();
  // предпросмотр говорит, что «да» из файла учтутся, только если владелец подтвердит
  const pv0 = await post(own, "/api/contacts/import", { c: "winchester", text: FILE });
  assert.equal(pv0.j.hasConsent, true); assert.match(pv0.j.consentNote, /владелец/);
  await post(own, "/api/contacts/import/discard", { c: "winchester", id: pv0.j.id });
  // сотрудник: подтвердить нельзя (403), ничего не записано, предпросмотр остаётся — владелец может загрузить
  const sp = await post(st, "/api/contacts/import", { c: "winchester", text: FILE });
  const denied = await post(st, "/api/contacts/import/confirm", { c: "winchester", id: sp.j.id, ...ATTEST });
  assert.equal(denied.status, 403); assert.match(denied.j.error, /только владелец/);
  assert.equal(d.raw.prepare("select count(*) n from consents where evidence <> 'client_stop'").get().n, 0, "ничего не записано");
  // владелец: нужны «где» и дата; дата из будущего — нельзя
  for (const [bad, field] of [[{ consentBasis: "" }, "consentBasis"], [{ consentGivenAt: "" }, "consentGivenAt"], [{ consentGivenAt: "2027-01-01" }, "consentGivenAt"]]) {
    const r = await post(own, "/api/contacts/import/confirm", { c: "winchester", id: sp.j.id, ...ATTEST, ...bad });
    assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.j.field, field);
  }
  const r = await post(own, "/api/contacts/import/confirm", { c: "winchester", id: sp.j.id, ...ATTEST });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  // «да» записано 1101, 1102, 1111, 1112; «нет» — 1108; пропущены 1105 («стоп»), 1106 («стоп» в KV), 1107 (отказ в Altegio). 1105 уже
  // в базе (его «стоп» создал карточку без имени) — у него обновится имя
  assert.deepEqual(r.j, { ok: true, created: 6, updated: 1, consents: 5, consentsConfirmed: 4, consentsUnconfirmed: 0, consentsSkipped: 3 });
  const given = dayStart("2026-09-15");
  for (const i of [1101, 1102, 1111, 1112]) {
    const [c] = consentsOf(d, i);
    assert.deepEqual([c.state, c.confirmed, c.evidence, c.given_at], ["granted", 1, "document", given], "подтверждено владельцем: " + i);
    assert.match(c.evidence_ref, /файл/); assert.match(c.basis, /WhatsApp на телефоне салона/);
  }
  for (const i of [1105, 1106, 1107]) assert.ok(!consentsOf(d, i).some(c => c.state === "granted"), "отказ остался: " + i);
  assert.deepEqual(consentsOf(d, 1105).map(c => c.state), ["denied"], "«стоп» клиента — отказ, «да» из файла не записано");
  assert.deepEqual(consentsOf(d, 1108).map(c => `${c.state}:${c.confirmed}`), ["denied:1"]);
  // запреты не сняты: «стоп» (D1 и KV) и отказ из Altegio на месте
  assert.equal(d.raw.prepare("select count(*) n from restrictions where lifted_at is null and kind = 'marketing_optout'").get().n, 2);
  assert.equal(s.kv.mem.has(`optout:winchester:${dg(1105)}`) && s.kv.mem.has(`optout:winchester:${dg(1106)}`), true);
  // карточка: «Есть, подтверждено», рекламу можно; у отказавшегося в Altegio — нельзя, с причиной
  const card = await (await own.go(`/api/contacts/card?c=winchester&id=${idOf(d, 1101)}`)).json();
  assert.equal(card.consent.marketing.confirmed, true); assert.equal(card.canMarket.ok, true, JSON.stringify(card.canMarket));
  const alt = await (await own.go(`/api/contacts/card?c=winchester&id=${idOf(d, 1107)}`)).json();
  assert.equal(alt.canMarket.ok, false); assert.ok(alt.canMarket.reasons.some(x => /Altegio/.test(x)), JSON.stringify(alt.canMarket));
  // без подтверждения владельца — как раньше: «да» из файла не подтверждено (и у сотрудника, и у владельца)
  const { r: plain } = await importList(st, `Телефон;Согласие\n${ph(1109)};да\n`, { consentBasis: "анкета в салоне" });
  assert.deepEqual(plain.j, { ok: true, created: 1, updated: 0, consents: 1, consentsConfirmed: 0, consentsUnconfirmed: 1, consentsSkipped: 0 });
  assert.deepEqual(consentsOf(d, 1109).map(c => `${c.state}:${c.confirmed}:${c.evidence}`), ["granted:0:import"]);
  // повторный файл с подтверждением не отменяет прежнее «нет» 1108 и «стоп» 1105
  const { r: again } = await importList(own, `Телефон;Согласие\n${ph(1108)};да\n${ph(1105)};да\n`, ATTEST);
  assert.deepEqual([again.j.consentsConfirmed, again.j.consentsSkipped], [0, 2]);
  assert.deepEqual(consentsOf(d, 1108).map(c => c.state), ["denied"]);
});

test("вся цепочка: база за 90 дней → 28 текстов → тест на свой номер → подтверждение владельца → отправка только разрешённым через Green-API → ответ в пульте", { skip }, async () => {
  const { s, d, own, st } = await base(ON);
  // разрешения из разных мест: файл (владелец подтвердил), «да» клиента в WhatsApp (переписка второго номера), WhatsApp на телефоне салона
  assert.equal((await importList(own, FILE, ATTEST)).r.j.consentsConfirmed, 4);
  await importList(st, `Телефон;Имя;Согласие\n${ph(1109)};Самат;да\n${ph(1110)};Руслан;\n${ph(1103)};Данияр;\n${ph(1104)};Тимур;\n`, { consentBasis: "анкета" });
  await s.gaText("winchester", INST, dg(1103), "Присылайте акции, спасибо");
  await s.settle();
  let r = await post(st, "/api/contacts/consent", { c: "winchester", id: idOf(d, 1103), purpose: "marketing", state: "granted", evidence: "chat" });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  r = await post(st, "/api/contacts/consent", { c: "winchester", id: idOf(d, 1104), purpose: "marketing", state: "granted", evidence: "document", evidenceRef: "WhatsApp на телефоне администратора", givenAt: "2026-09-20", basis: "написал «да, присылайте»" });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual(gaSent(), [], "отметки разрешений ничего не отправляют");

  // 1. база за 90 дней: 11 клиентов (1111 был 120 дней назад — его нет), рекламу можно 4 (1112 уже записан). Разрешений в базе
  // согласий — 6 (и у 1111, и у 1112), но рассылка идёт только по базе за 90 дней и по правилам
  const segs = await (await own.go("/api/crm/segments?c=winchester")).json();
  assert.equal(segs.clients, 11); assert.equal(segs.ok, 4); assert.equal(segs.metrics.total, 11, JSON.stringify(segs.metrics));
  assert.equal(segs.consent.n, 6);
  const davno = segs.segments.find(x => x.id === "davno"); // 36–60 дней: 1101–1104, 1109, 1112
  assert.deepEqual([davno.total, davno.n], [6, 4], JSON.stringify(davno));

  // 2. 28 утверждённых текстов в 7 категориях
  const lib = await (await own.go("/api/bc/templates?c=winchester")).json();
  const w = lib.items.filter(x => /^W\d\d$/.test(x.id));
  assert.equal(w.length, 28); assert.equal(lib.cats.length, CATS.length); assert.ok(w.every(x => x.status === "approved"), "все одобрены");
  const W09 = LIBRARY.find(x => x.id === "W09"), tail = W09.ru.slice(W09.ru.indexOf("\n"));
  const DRAFT = { c: "winchester", ch: "ga", name: "Давно не виделись", tplId: "W09", lang: "ru", segment: "all", cap: 50, from: 10, to: 20, consent: true };

  // 3. тест на свой номер: только номер владельца, ни одному клиенту
  assert.equal((await post(own, "/api/msg/auto", { c: "winchester", testPhone: "+7 700 000 09 97" })).status, 200);
  const t = await post(own, "/api/bc/test", { ...DRAFT, rid: "rid-chain-0001" });
  assert.equal(t.j.ok, true, JSON.stringify(t.j));
  assert.deepEqual(gaSent(), [{ to: "77000000997", text: `Добрый день, Айгерим! 👋🏻${tail}` }]);

  // 4. проверка: получат 4, причины остальных — словами и числами
  const chk = await post(own, "/api/bc/check", DRAFT);
  assert.equal(chk.j.ok, true, JSON.stringify(chk.j)); assert.equal(chk.j.valid, 4); assert.equal(chk.j.funnel.allowed, 4);
  assert.equal(chk.j.funnel.segment, 11);
  const why = Object.fromEntries(chk.j.funnel.consent.map(x => [x.code, x.n]));
  assert.deepEqual(why, { stop: 2, denied: 2, unconfirmed: 1, noconsent: 1 }, JSON.stringify(chk.j.funnel));
  assert.equal(chk.j.funnel.rules.find(x => x.code === "fut")?.n, 1, "уже записан — правило, а не разрешение");

  // 5. черновик и одобрение владельцем — ещё не запуск: ничего не ушло
  const c = (await post(own, "/api/bc/create", DRAFT)).j;
  assert.equal(c.ok, true, JSON.stringify(c)); assert.equal(s.kv.json("bc:winchester:" + c.b.id).total, 4);
  assert.equal((await post(own, "/api/bc/act", { c: "winchester", id: c.b.id, act: "approve" })).status, 200);
  assert.equal((await post(st, "/api/bc/act", { c: "winchester", id: c.b.id, act: "start", sure: true, n: 4 })).status, 403, "сотрудник не запускает");
  r = await post(own, "/api/bc/act", { c: "winchester", id: c.b.id, act: "start" });
  assert.equal(r.status, 409); assert.equal(r.j.final.n, 4); assert.equal(r.j.final.text, W09.ru);
  for (let i = 0; i < 3; i++) await s.cron();
  assert.equal(gaSent().length, 1, "без подтверждения владельца — только тест себе");

  // 6. подтверждение владельца → отправка через Green-API только разрешённым
  r = await post(own, "/api/bc/act", { c: "winchester", id: c.b.id, act: "start", sure: true, n: 4, op: "Владелец" });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  for (let i = 0; i < 6; i++) {
    const b = s.kv.json("bc:winchester:" + c.b.id);
    if (b.status !== "running") break;
    if (b.nextAt) { b.nextAt = Date.now() - 1; s.kv.mem.set("bc:winchester:" + c.b.id, JSON.stringify(b)); }
    await bcTick(s.env, "winchester", c.b.id);
  }
  const sent = gaSent().slice(1);
  assert.deepEqual(sent.map(x => x.to).sort(), [1101, 1102, 1103, 1104].map(dg));
  assert.deepEqual(sent.find(x => x.to === dg(1101)).text, `Добрый день, Азамат! 👋🏻${tail}`, "имя в приветствии, текст — утверждённый");
  for (const i of [1105, 1106, 1107, 1108, 1109, 1110, 1111, 1112]) assert.ok(!sent.some(x => x.to === dg(i)), "не ушло: " + i);
  assert.equal(s.kv.json("bc:winchester:" + c.b.id).status, "done");

  // 7. ответ клиента — в пульте: в переписке и в очереди «Ответы на рассылки»; бот второго номера не отвечает сам
  const turn = s.kv.json(`h:ga:winchester:${dg(1102)}`).turns.find(x => x.bc === c.b.id);
  for (const x of ["delivered", "read"]) await hook(s, { typeWebhook: "outgoingMessageStatus", chatId: dg(1102) + "@c.us", idMessage: turn.mid, status: x, sendByApi: true });
  await s.gaText("winchester", INST, dg(1102), "Здравствуйте! Можно записаться на субботу?");
  await s.settle();
  const chat = await (await own.go(`/api/inbox/chat?c=winchester&ch=ga&id=${dg(1102)}`)).json();
  assert.deepEqual([chat.turns.at(-1).r, chat.turns.at(-1).x], ["u", "Здравствуйте! Можно записаться на субботу?"]);
  assert.ok(chat.turns.some(x => x.x === `Добрый день, Ерлан! 👋🏻${tail}` && x.st === "read"), "в переписке — сообщение рассылки с галочками: " + JSON.stringify(chat.turns));
  assert.ok(chat.need, "ждёт ответа");
  const list = await (await own.go("/api/inbox/list?c=winchester&v=2")).json();
  const row = list.chats.find(x => x.id === dg(1102));
  assert.ok(row && row.nd && row.s === "Здравствуйте! Можно записаться на субботу?", "чат в очереди «Нужен ответ»: " + JSON.stringify(row));
  assert.equal(s.kv.json(`h:ga:winchester:${dg(1102)}`).profile.need.src.k, "bc", "раздел «Ответы на рассылки»");
  assert.equal(gaSent().length, 5, "в ответ клиенту сам бот ничего не отправил");
  const g = await (await own.go(`/api/bc/get?c=winchester&id=${c.b.id}`)).json();
  assert.equal(g.results.sent, 4); assert.equal(g.results.delivered, 1); assert.equal(g.results.read, 1); assert.equal(g.results.replied, 1); assert.equal(g.results.want, 1);
});

test("«Клиенты»: отказ из Altegio («не получает массовые уведомления») — рекламу нельзя и в карточке, и в числах сегментов, как у рассылки", { skip }, async () => {
  const { d, own } = await base();
  await importList(own, `Телефон;Согласие\n${ph(1101)};да\n`, ATTEST);
  // отказ в Altegio поставили после согласия (сняли галочку массовых уведомлений): согласие есть, но рекламу нельзя
  await restrictionAdd(d.db, "winchester", { contactId: idOf(d, 1101), kind: "marketing_optout", reason: "Altegio: клиент не получает массовые уведомления", source: "altegio", actor: "sync", legacyKey: "altegio_nomass:" + dg(1101), at: NOW });
  const card = await (await own.go(`/api/contacts/card?c=winchester&id=${idOf(d, 1101)}`)).json();
  assert.equal(card.consent.marketing.confirmed, true);
  assert.equal(card.canMarket.ok, false, JSON.stringify(card.canMarket)); assert.ok(card.canMarket.reasons.some(x => /Altegio/.test(x)));
  const segs = await (await own.go("/api/contacts/segments?c=winchester")).json();
  assert.equal(segs.segments.find(x => x.id === "all").ready, 0, JSON.stringify(segs.segments[0]));
});

// находки независимой проверки 02.11.2026 (до исправления — красные):
// 1) колонка согласия выбиралась по слову «рассыл»/«соглас» — первой подходящей: «Отказ от рассылки: да» или «Согласие на обработку
//    персональных данных: да» с подтверждением владельца становились разрешением на рекламу;
// 2) прежнее «нет» из файла снималось: после него «не известно» в карточке или «да» без подтверждения — и список владельца проходил;
// 3) отказ от сервисных сообщений не мешал «да» на рекламу из списка;
// 4) дата разрешений «2026-02-31», «0026-11-02», «2026-00-00» принималась (сдвигалась на другой день или в 1926 год)
test("находка 1: колонка отказа, согласия на обработку данных или две колонки согласия — не разрешение на рекламу; «да» и «нет» видны до загрузки", { skip }, async () => {
  const ph2 = s => s.replace(/\D/g, "").length >= 10 ? s : "";
  const col = head => { const c = tableColumns([head, ["+77000001101", ...head.slice(1).map(() => "да")]], ph2); return c.consent < 0 ? "" : head[c.consent]; };
  for (const bad of ["Отказ от рассылки", "Запрет рассылки", "Не согласен", "No consent", "Исключить из рассылок", "Отписался от рассылки", "Согласие на обработку персональных данных", "Согласие ПДн", "Стоп-лист"])
    assert.equal(col(["Телефон", bad]), "", "не согласие на рекламу: " + bad);
  for (const good of ["Согласие", "Согласие на рассылку", "Разрешил рекламу", "Рассылка", "Подписка", "Consent", "Келісім"]) assert.equal(col(["Телефон", good]), good, "согласие: " + good);
  assert.equal(col(["Телефон", "Согласие на обработку персональных данных", "Согласие на рассылку"]), "Согласие на рассылку", "обработка данных — мимо, рассылка — она");
  assert.equal(col(["Телефон", "Согласие на рассылку", "Согласие на рекламу"]), "", "две колонки согласия — ни одной: непонятно, какая");

  const { d, own } = await base();
  // согласие на обработку данных «да», на рассылку «нет» — с подтверждением владельца рекламы нет, «нет» записано
  let pv = await post(own, "/api/contacts/import", { c: "winchester", text: `Телефон;Имя;Согласие на обработку персональных данных;Согласие на рассылку\n${ph(1101)};Азамат;да;нет\n${ph(1102)};Ерлан;да;да\n` });
  assert.equal(pv.j.columns.consent, "Согласие на рассылку"); assert.deepEqual(pv.j.consentCounts, { yes: 1, no: 1 });
  let r = await post(own, "/api/contacts/import/confirm", { c: "winchester", id: pv.j.id, ...ATTEST });
  assert.deepEqual([r.j.consentsConfirmed, r.j.consents], [1, 2], JSON.stringify(r.j));
  assert.deepEqual(consentsOf(d, 1101).map(c => c.state), ["denied"]);
  // «Отказ от рассылки: да» — не согласие: колонки согласия нет, предупреждение, ничего не записано
  pv = await post(own, "/api/contacts/import", { c: "winchester", text: `Телефон;Отказ от рассылки\n${ph(1109)};да\n` });
  assert.equal(pv.j.hasConsent, false); assert.match(pv.j.consentWarn, /Отказ от рассылки/);
  r = await post(own, "/api/contacts/import/confirm", { c: "winchester", id: pv.j.id, ...ATTEST });
  assert.equal(r.j.consents, 0); assert.deepEqual(consentsOf(d, 1109), []);
  // две колонки согласия — ни одна не читается, предупреждение называет обе
  pv = await post(own, "/api/contacts/import", { c: "winchester", text: `Телефон;Согласие на рассылку;Согласие на рекламу\n${ph(1110)};да;да\n` });
  assert.equal(pv.j.hasConsent, false); assert.match(pv.j.consentWarn, /Согласие на рассылку.*Согласие на рекламу/);
});

test("находки 2–4: прежнее «нет» (и после «не известно» или «да» без подтверждения), отказ от сервисных и несуществующая дата — список владельца не проходит", { skip }, async () => {
  const { d, own, st } = await base();
  // «нет» из файла, потом сотрудник — «да» без подтверждения (1101) и «не известно» в карточке (1102)
  await importList(st, `Телефон;Согласие\n${ph(1101)};нет\n${ph(1102)};нет\n`, { consentBasis: "анкета" });
  await importList(st, `Телефон;Согласие\n${ph(1101)};да\n`, { consentBasis: "анкета" });
  assert.equal((await post(st, "/api/contacts/consent", { c: "winchester", id: idOf(d, 1102), purpose: "marketing", state: "unknown", basis: "не помнит" })).status, 200);
  // отказ от сервисных сообщений (1103)
  await post(own, "/api/contacts/add", { c: "winchester", phone: ph(1103), name: "Данияр" });
  assert.equal((await post(st, "/api/contacts/consent", { c: "winchester", id: idOf(d, 1103), purpose: "service", state: "denied", basis: "просил не писать" })).status, 200);
  const { r } = await importList(own, `Телефон;Согласие\n${ph(1101)};да\n${ph(1102)};да\n${ph(1103)};да\n`, ATTEST);
  assert.deepEqual([r.j.consentsConfirmed, r.j.consentsSkipped], [0, 3], JSON.stringify(r.j));
  for (const i of [1101, 1102, 1103]) assert.ok(!consentsOf(d, i).some(c => c.state === "granted" && c.confirmed), "отказ остался: " + i);
  // несуществующая или слишком старая дата — 400 (поле даты)
  const pv = await post(own, "/api/contacts/import", { c: "winchester", text: `Телефон;Согласие\n${ph(1104)};да\n` });
  for (const bad of ["2026-02-31", "0026-11-02", "2026-00-00", "2026-13-01"]) {
    const x = await post(own, "/api/contacts/import/confirm", { c: "winchester", id: pv.j.id, ...ATTEST, consentGivenAt: bad });
    assert.equal(x.status, 400, bad); assert.equal(x.j.field, "consentGivenAt");
  }
  // и в карточке («Письменное согласие») — так же
  await post(own, "/api/contacts/import/discard", { c: "winchester", id: pv.j.id });
  await post(own, "/api/contacts/add", { c: "winchester", phone: ph(1104), name: "Тимур" });
  const x = await post(own, "/api/contacts/consent", { c: "winchester", id: idOf(d, 1104), purpose: "marketing", state: "granted", evidence: "document", evidenceRef: "WhatsApp на телефоне салона", givenAt: "2026-02-31" });
  assert.equal(x.status, 400); assert.equal(x.j.field, "givenAt");
});
