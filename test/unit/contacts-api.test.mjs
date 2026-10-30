// Этап 1 D1 (31.10.2026): API базы контактов (/api/contacts/*). Права (гость, сотрудник, чужая компания, только владелец), боевой сайт
// без базы, ручное добавление и дубли, импорт CSV (UTF-8 и Windows-1251), .xlsx и вставки из Excel с предпросмотром, повторным
// «Загрузить» и отменой, согласия и запреты с историей, снятие только с причиной, «стоп» из прежнего хранилища, поиск по-русски,
// сегменты и «можно ли писать рекламу». Номера вымышленные (+7 700 000 xx xx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { net, mk } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { xlsxRows } from "../../src/lib/xlsx.js";
import { csvRows, decodeText } from "../../src/lib/table.js";

const skip = sqliteOk ? false : "node:sqlite есть только в Node 22+";
const OWNER = "owner-key-123456", STAFF_W = "staff-key-winch-0001", STAFF_B = "staff-key-barber-0001";
const ENV = { KEY_WINCHESTER: STAFF_W, KEY_BARBER: STAFF_B };

async function login(s, key) {
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `key=${encodeURIComponent(key)}&next=%2Finbox` });
  assert.ok(b.cookie);
  return b;
}
const get = async (b, path) => { const r = await b.go(path); return { status: r.status, j: await r.json() }; };
const post = async (b, path, body) => { const r = await b.post(path, body); return { status: r.status, j: await r.json() }; };

// минимальный .xlsx: общие строки, номер числом в «научном» виде, имя строкой
function xlsx(rows) {
  const strings = [], cell = (v, ref) => typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${strings.push(v) - 1}</v></c>`;
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, String.fromCharCode(65 + j) + (i + 1))).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const files = { "xl/workbook.xml": `<workbook><sheets><sheet name="Лист1" sheetId="1" r:id="rId1"/></sheets></workbook>`, "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst>${strings.map(s => `<si><t>${s.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</t></si>`).join("")}</sst>`, "xl/worksheets/sheet1.xml": sheet };
  const parts = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), data = deflateRawSync(raw), nm = Buffer.from(name), h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nm, data); central.push(c, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
const cp1251 = s => Buffer.from([...s].map(ch => { const i = "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя".indexOf(ch); return i >= 0 ? 0xC0 + i : ch.charCodeAt(0); }));
async function upload(b, c, name, bytes) {
  const fd = new FormData(); fd.set("c", c); fd.set("file", new Blob([bytes]), name);
  const r = await b.go("/api/contacts/import", { method: "POST", body: fd });
  return { status: r.status, j: await r.json() };
}

test("чтение таблиц: .xlsx (номер числом 7.7E10, общие строки), CSV с «;» и кавычками, Windows-1251", async () => {
  const rows = await xlsxRows(new Uint8Array(xlsx([["Телефон", "Имя"], [77000000901, "Арман"], ["8 700 000 09 02", "Ерлан «Кузнец»"]])));
  assert.deepEqual(rows, [["Телефон", "Имя"], ["77000000901", "Арман"], ["8 700 000 09 02", "Ерлан «Кузнец»"]]);
  const sci = await xlsxRows(new Uint8Array(xlsx([[7.7000000903e10, "Иван"]])));
  assert.equal(sci[0][0], "77000000903");
  assert.deepEqual(csvRows('Телефон;Имя\n"+7 700 000 09 04";"Петров; Пётр"\n\n'), [["Телефон", "Имя"], ["+7 700 000 09 04", "Петров; Пётр"]]);
  assert.equal(decodeText(cp1251("Имя;Телефон")), "Имя;Телефон");
  assert.equal(decodeText(new TextEncoder().encode("﻿Имя")), "Имя");
});

test("права: гость — 401, сотрудник — свои данные без синхронизации и снятия запретов, чужая компания — 403; боевой сайт без базы", { skip }, async () => {
  net.reset();
  const s = mk({ ...ENV, DB: d1With("preview").db, STAGE: "preview" });
  assert.equal((await s.browser().go("/api/contacts/status?c=winchester")).status, 401);
  const own = await login(s, OWNER), st = await login(s, STAFF_W), other = await login(s, STAFF_B);
  assert.equal((await get(st, "/api/contacts/status?c=winchester")).j.ready, true);
  assert.equal((await get(other, "/api/contacts/status?c=winchester")).status, 403);
  for (const [p, b] of [["/api/contacts/sync", { mode: "test" }], ["/api/contacts/probe", {}], ["/api/contacts/stops", { action: "sweep" }], ["/api/contacts/lift", { id: "x", rid: 1, reason: "просил" }]])
    assert.equal((await post(st, p, { c: "winchester", ...b })).status, 403, p);
  assert.equal((await post(own, "/api/contacts/sync", { c: "winchester", mode: "test" })).status, 200);
  const r = await st.go("/api/contacts/add", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ c: "winchester", phone: "+77000000911" }) });
  assert.equal(r.status, 403, "чужой сайт");
  const p = mk(ENV), po = await login(p, OWNER);
  const ps = await get(po, "/api/contacts/status?c=winchester");
  assert.equal(ps.j.ready, false); assert.match(ps.j.why, /ещё не подключена/);
  const pl = await get(po, "/api/contacts/list?c=winchester");
  assert.equal(pl.status, 503); assert.equal(pl.j.ready, false);
});

test("добавление вручную, дубль, поиск по-русски и по номеру; согласие и запрет с историей; снятие — только с причиной", { skip }, async () => {
  net.reset();
  const d = d1With("preview"), s = mk({ ...ENV, DB: d.db, STAGE: "preview" });
  const own = await login(s, OWNER), st = await login(s, STAFF_W);
  assert.equal((await post(st, "/api/contacts/add", { c: "winchester", phone: "12345" })).j.field, "phone");
  const a = await post(st, "/api/contacts/add", { c: "winchester", phone: "8 700 000 09 21", name: "Арман Сейтов" });
  assert.equal(a.status, 200); assert.equal(a.j.created, true);
  const dup = await post(own, "/api/contacts/add", { c: "winchester", phone: "+7 (700) 000-09-21", name: "Другое" });
  assert.equal(dup.j.created, false); assert.equal(dup.j.id, a.j.id);
  assert.equal((await get(st, "/api/contacts/list?c=winchester&q=" + encodeURIComponent("АРМАН"))).j.total, 1);
  assert.equal((await get(st, "/api/contacts/list?c=winchester&q=" + encodeURIComponent("8 700 000 09 21"))).j.total, 1);
  const li = (await get(st, "/api/contacts/list?c=winchester")).j;
  assert.equal(li.items[0].phone, "+7 700 *** ** 21", "в списке — маской");
  assert.deepEqual(li.items[0].sources, ["manual"]);
  // согласие: без основания «да» нельзя; история сохраняется
  assert.equal((await post(st, "/api/contacts/consent", { c: "winchester", id: a.j.id, purpose: "marketing", state: "granted", basis: "" })).j.field, "basis");
  await post(st, "/api/contacts/consent", { c: "winchester", id: a.j.id, purpose: "marketing", state: "granted", basis: "анкета в салоне" });
  await post(st, "/api/contacts/consent", { c: "winchester", id: a.j.id, purpose: "marketing", state: "denied", basis: "передумал" });
  let card = (await get(st, "/api/contacts/card?c=winchester&id=" + a.j.id)).j;
  assert.equal(card.contact.phone, "+7 700 000 09 21", "в карточке — полностью");
  assert.equal(card.consent.marketing.state, "denied");
  assert.deepEqual(card.consentHistory.map(x => x.state), ["denied", "granted"]);
  // запрет вручную: в D1 и зеркало в KV
  assert.equal((await post(st, "/api/contacts/restrict", { c: "winchester", id: a.j.id, kind: "full_block", reason: "" })).j.field, "reason");
  await post(st, "/api/contacts/restrict", { c: "winchester", id: a.j.id, kind: "full_block", reason: "попросил по телефону не писать вообще" });
  assert.ok(s.kv.mem.get("optout:winchester:77000000921"));
  card = (await get(st, "/api/contacts/card?c=winchester&id=" + a.j.id)).j;
  const rr = card.restrictions.find(x => x.kind === "full_block");
  assert.ok(rr.active && /не писать вообще/.test(card.canMarket.reasons.join(";")));
  assert.equal((await post(own, "/api/contacts/lift", { c: "winchester", id: a.j.id, rid: rr.id, reason: "" })).j.field, "reason");
  assert.equal((await post(own, "/api/contacts/lift", { c: "winchester", id: a.j.id, rid: rr.id, reason: "сам попросил снова присылать" })).status, 200);
  assert.equal(s.kv.mem.get("optout:winchester:77000000921"), undefined, "запретов не осталось — зеркало снято");
  card = (await get(st, "/api/contacts/card?c=winchester&id=" + a.j.id)).j;
  const lifted = card.restrictions.find(x => x.id === rr.id);
  assert.equal(lifted.active, false); assert.equal(lifted.liftedBy, "owner"); assert.match(lifted.liftReason, /снова присылать/);
  assert.ok(card.events.some(e => /Запрет снят/.test(e.text)));
  assert.equal((await post(own, "/api/contacts/lift", { c: "winchester", id: a.j.id, rid: rr.id, reason: "ещё раз" })).status, 404, "уже снят");
});

test("«стоп» только в прежнем хранилище KV виден в карточке и закрывает рекламу; снятие переносит его в D1 и снимает", { skip }, async () => {
  net.reset();
  const d = d1With("preview"), s = mk({ ...ENV, DB: d.db, STAGE: "preview" }), own = await login(s, OWNER);
  const a = await post(own, "/api/contacts/add", { c: "winchester", phone: "+77000000931", name: "Данияр" });
  await post(own, "/api/contacts/consent", { c: "winchester", id: a.j.id, purpose: "marketing", state: "granted", basis: "в переписке" });
  const seg = async () => (await get(own, "/api/contacts/segments?c=winchester")).j.segments.find(x => x.id === "all");
  assert.equal((await seg()).ready, 1);
  await s.kv.api.put("optout:winchester:77000000931", String(Date.now()));
  assert.equal((await seg()).ready, 0, "«стоп» в KV — нельзя (запрещено, если запрещено хоть где-то)");
  let card = (await get(own, "/api/contacts/card?c=winchester&id=" + a.j.id)).j;
  assert.equal(card.restrictions[0].id, 0); assert.match(card.restrictions[0].reason, /прежнем хранилище/);
  assert.equal((await post(own, "/api/contacts/lift", { c: "winchester", id: a.j.id, rid: 0, reason: "написал «старт»" })).status, 200);
  assert.equal(s.kv.mem.get("optout:winchester:77000000931"), undefined);
  card = (await get(own, "/api/contacts/card?c=winchester&id=" + a.j.id)).j;
  assert.equal(card.restrictions.length, 1); assert.equal(card.restrictions[0].source, "kv_migration"); assert.equal(card.restrictions[0].active, false);
  assert.equal((await seg()).ready, 1);
  // KV не читается — список и числа не отдаются (не показываем «можно» тому, кто мог просить не писать)
  s.kv.fail.list = () => true;
  assert.equal((await get(own, "/api/contacts/segments?c=winchester")).status, 503);
});

test("импорт: CSV с дублями и неверными номерами → предпросмотр, «Загрузить» один раз, согласия только с основанием, запреты не снимаются", { skip }, async () => {
  net.reset();
  const d = d1With("preview"), s = mk({ ...ENV, DB: d.db, STAGE: "preview" }), st = await login(s, STAFF_W);
  const old = await post(st, "/api/contacts/add", { c: "winchester", phone: "+77000000941", name: "" });
  await post(st, "/api/contacts/add", { c: "winchester", phone: "+77000000942", name: "Тимур" });
  await post(st, "/api/contacts/restrict", { c: "winchester", id: old.j.id, kind: "marketing_optout", reason: "стоп по телефону" });
  const csv = "Телефон;Имя;Согласие на рассылку\n+7 700 000 09 41;Нурлан;да\n87000000942;Тимур;\n+7 700 000 09 43;Олжас;нет\n+7 700 000 09 43;Олжас дубль;да\n12345;Кто-то;да\n;Без номера;\n";
  const pv = await upload(st, "winchester", "база.csv", new TextEncoder().encode(csv));
  assert.equal(pv.status, 200, JSON.stringify(pv.j));
  assert.deepEqual(pv.j.counts, { new: 1, update: 1, same: 1, dup: 1, invalid: 2 });
  assert.equal(pv.j.hasConsent, true);
  assert.ok(pv.j.rows.every(r => !/7000000094/.test(r.phone)), "в предпросмотре — маской");
  assert.equal(d.raw.prepare("select count(*) n from contacts").get().n, 2, "предпросмотр ничего не добавил");
  const ok = await post(st, "/api/contacts/import/confirm", { c: "winchester", id: pv.j.id, consentBasis: "анкета в салоне, октябрь 2026" });
  assert.deepEqual(ok.j, { ok: true, created: 1, updated: 1, consents: 2 });
  assert.equal((await post(st, "/api/contacts/import/confirm", { c: "winchester", id: pv.j.id })).status, 409, "второе «Загрузить» — ничего");
  assert.equal(d.raw.prepare("select count(*) n from contacts").get().n, 3);
  assert.equal(d.raw.prepare("select name from contacts where phone = '77000000941'").get().name, "Нурлан");
  assert.equal(d.raw.prepare("select count(*) n from restrictions where lifted_at is null").get().n, 1, "запрет остался");
  assert.equal(d.raw.prepare("select count(*) n from import_rows").get().n, 0, "строки предпросмотра удалены");
  assert.deepEqual(d.raw.prepare("select state, basis from consents order by id").all().map(x => x.state + ":" + x.basis), ["granted:анкета в салоне, октябрь 2026", "denied:анкета в салоне, октябрь 2026"]);
  // без основания согласия не ставятся
  const pv2 = await upload(st, "winchester", "ещё.csv", new TextEncoder().encode("Телефон;Согласие\n+77000000944;да\n"));
  assert.equal((await post(st, "/api/contacts/import/confirm", { c: "winchester", id: pv2.j.id })).j.consents, 0);
  // отмена
  const pv3 = await upload(st, "winchester", "отмена.csv", new TextEncoder().encode("+77000000945\n"));
  assert.equal((await post(st, "/api/contacts/import/discard", { c: "winchester", id: pv3.j.id })).j.ok, true);
  assert.equal((await post(st, "/api/contacts/import/confirm", { c: "winchester", id: pv3.j.id })).status, 409);
  assert.equal(d.raw.prepare("select count(*) n from contacts where phone = '77000000945'").get().n, 0);
});

test("импорт: .xlsx, CSV в Windows-1251, вставка из Excel; старый .xls и файл без номеров — понятная ошибка", { skip }, async () => {
  net.reset();
  const d = d1With("preview"), s = mk({ ...ENV, DB: d.db, STAGE: "preview" }), own = await login(s, OWNER);
  const x = await upload(own, "winchester", "клиенты.xlsx", xlsx([["Имя", "Телефон"], ["Арман", 77000000951], ["Ерлан", "8 700 000 09 52"]]));
  assert.equal(x.status, 200, JSON.stringify(x.j)); assert.equal(x.j.counts.new, 2);
  const w = await upload(own, "winchester", "excel.csv", cp1251("Имя;Телефон\r\nДамир;+77000000953\r\n"));
  assert.equal(w.j.counts.new, 1);
  await post(own, "/api/contacts/import/confirm", { c: "winchester", id: w.j.id });
  assert.equal(d.raw.prepare("select name from contacts where phone = '77000000953'").get().name, "Дамир", "кириллица из Windows-1251");
  const t = await post(own, "/api/contacts/import", { c: "winchester", text: "Ильяс\t+7 700 000 09 54\nМарат\t+7 700 000 09 55" });
  assert.equal(t.j.counts.new, 2); assert.equal(t.j.columns.phone, 1);
  const xls = await upload(own, "winchester", "старый.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]));
  assert.equal(xls.status, 400); assert.match(xls.j.error, /\.xlsx или \.csv/);
  const none = await post(own, "/api/contacts/import", { c: "winchester", text: "просто текст\nбез номеров" });
  assert.equal(none.status, 400); assert.match(none.j.error, /колонку с номерами/);
});
