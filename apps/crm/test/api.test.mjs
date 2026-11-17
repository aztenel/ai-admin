// Проверки сервера CRM на базе в памяти: вход, лиды, оценка, повторы номеров, касания, «Сегодня», воронка, выгрузка.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { openD1 } from "./d1.mjs";

const KEY = "owner-key-for-tests-123";
const ORIGIN = "https://crm.example";

function mk(env = {}) {
  const db = openD1(), e = { DB: db, CRM_KEY: KEY, ...env };
  let jar = "";
  const call = async (path, { method = "GET", body, headers = {}, cookie = true } = {}) => {
    const h = { ...headers };
    if (body !== undefined && !("content-type" in h)) h["content-type"] = "application/json";
    if (method !== "GET" && !("origin" in h)) h.origin = ORIGIN;
    if (cookie && jar) h.cookie = jar;
    const r = await worker.fetch(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), e);
    const sc = r.headers.get("set-cookie");
    if (sc) jar = sc.split(";")[0];
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await r.arrayBuffer()); // метку UTF-8 в начале выгрузки не теряем
    let j = null; try { j = JSON.parse(text); } catch (err) {}
    return { status: r.status, j, text, headers: r.headers };
  };
  const login = async () => { const r = await call("/api/login", { method: "POST", body: { key: KEY } }); assert.equal(r.status, 200); };
  return { db, call, login, forget: () => { jar = ""; } };
}
const lead = (over = {}) => ({ name: "Barber One", phones: "+7 701 111 22 33", city: "Астана", niche: "Барбершоп", reviews: 380, rating: "4,9", masters: 6, ig_followers: 12000, ig_alive: 1, impression: 3, ...over });

test("без входа данные не отдаются; неверный ключ — отказ; после 10 неудач — пауза", async () => {
  const s = mk();
  assert.equal((await s.call("/api/leads")).status, 401);
  assert.equal((await s.call("/api/export.csv")).status, 401);
  for (let i = 0; i < 10; i++) assert.equal((await s.call("/api/login", { method: "POST", body: { key: "wrong-key-" + i } })).status, 403);
  const blocked = await s.call("/api/login", { method: "POST", body: { key: KEY } });
  assert.equal(blocked.status, 429, "верный ключ после 10 неудач тоже ждёт");
});

test("вход: cookie защищённая, подделанная не проходит; без ключа или с коротким ключом CRM закрыта", async () => {
  const s = mk();
  const r = await s.call("/api/login", { method: "POST", body: { key: KEY } });
  assert.match(r.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await s.call("/api/me")).status, 200);
  const forged = await s.call("/api/me", { cookie: false, headers: { cookie: "crm=" + (Date.now() + 1e9) + ".AAAA" } });
  assert.equal(forged.status, 401);
  const old = await s.call("/api/me", { cookie: false, headers: { cookie: "crm=1.AAAA" } });
  assert.equal(old.status, 401);
  for (const k of ["", "short"]) assert.equal((await mk({ CRM_KEY: k }).call("/api/login", { method: "POST", body: { key: k } })).status, 503);
});

test("запрос с чужого сайта и не-JSON отклоняются", async () => {
  const s = mk(); await s.login();
  assert.equal((await s.call("/api/leads", { method: "POST", body: lead(), headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await s.call("/api/leads", { method: "POST", body: "name=x", headers: { "content-type": "application/x-www-form-urlencoded" } })).status, 415);
  assert.equal((await s.call("/api/leads")).j.total, 0);
});

test("новый лид: оценка и буква считаются на сервере, рейтинг «4,9» понимается, Instagram «@имя» — в ссылку", async () => {
  const s = mk(); await s.login();
  const r = await s.call("/api/leads", { method: "POST", body: lead({ instagram: "@barber.one", gis_url: "2gis.kz/astana/firm/1" }) });
  assert.equal(r.status, 201);
  const l = r.j.lead;
  assert.equal(l.grade, "A"); assert.equal(l.score, 95); assert.equal(l.rating, 4.9); assert.equal(l.stage, "new");
  assert.equal(l.instagram, "https://instagram.com/barber.one"); assert.equal(l.gis_url, "https://2gis.kz/astana/firm/1");
  assert.equal((await s.call("/api/leads", { method: "POST", body: { phones: "+7 700 000 00 00" } })).status, 400, "без названия нельзя");
  assert.equal((await s.call("/api/leads", { method: "POST", body: lead({ name: "X", phones: "", rating: 9 }) })).j.field, "rating");
  assert.equal((await s.call("/api/leads", { method: "POST", body: lead({ name: "X", phones: "", gis_url: "javascript:alert(1)" }) })).status, 400);
});

test("повтор номера: 8 701… и +7 701… — один лид; force создаёт второй", async () => {
  const s = mk(); await s.login();
  await s.call("/api/leads", { method: "POST", body: lead() });
  const dup = await s.call("/api/leads", { method: "POST", body: lead({ name: "Другой", phones: "8 (701) 111-22-33" }) });
  assert.equal(dup.status, 409); assert.equal(dup.j.dup.name, "Barber One");
  assert.equal((await s.call("/api/leads", { method: "POST", body: lead({ name: "Другой", phones: "87011112233", force: true }) })).status, 201);
  assert.equal((await s.call("/api/leads")).j.total, 2);
});

test("список: поиск по-русски без учёта регистра, по номеру, фильтры по букве, этапу и городу, сортировка по оценке", async () => {
  const s = mk(); await s.login();
  await s.call("/api/leads", { method: "POST", body: lead({ name: "Барбершоп Тигр", address: "Кабанбай батыра 18" }) });
  await s.call("/api/leads", { method: "POST", body: lead({ name: "Old Boy", phones: "+7 705 000 00 01", city: "Алматы", reviews: 40, masters: 2, ig_followers: 100, ig_alive: 0, impression: 1 }) });
  await s.call("/api/leads", { method: "POST", body: { name: "Без данных", phones: "+7 705 000 00 02" } });
  const q = async p => (await s.call("/api/leads?" + p)).j;
  assert.equal((await q("q=" + encodeURIComponent("тигр"))).total, 1);
  assert.equal((await q("q=" + encodeURIComponent("КАБАНБАЙ"))).total, 1);
  assert.equal((await q("q=" + encodeURIComponent("705 000"))).total, 2);
  assert.equal((await q("q=" + encodeURIComponent("100%"))).total, 0, "знаки шаблона LIKE — обычный текст");
  assert.equal((await q("grade=A")).total, 1);
  assert.equal((await q("grade=")).total, 1, "без буквы — «мало данных»");
  assert.equal((await q("city=" + encodeURIComponent("Алматы"))).total, 1);
  const all = await q("sort=score");
  assert.deepEqual(all.items.map(x => x.name), ["Барбершоп Тигр", "Old Boy", "Без данных"]);
  assert.equal((await q("stage=work")).total, 0);
  assert.equal((await s.call("/api/leads?stage=nope")).status, 400);
  const me = (await s.call("/api/me")).j;
  assert.deepEqual(me.cities.sort(), ["Алматы", "Астана"]);
});

test("касание: «не дозвонился» сам ставит перезвон через 2 часа; встреча требует время; предоплата — сумму", async () => {
  const s = mk(); await s.login();
  const id = (await s.call("/api/leads", { method: "POST", body: lead() })).j.lead.id;
  const t = (path, body) => s.call(`/api/leads/${id}/touch`, { method: "POST", body });
  assert.equal((await t("", {})).status, 400);
  const nd = (await t("", { result: "nd" })).j.lead;
  assert.equal(nd.stage, "nd"); assert.equal(nd.next_what, "Перезвонить");
  assert.ok(Math.abs(nd.next_at - (Date.now() + 2 * 3600e3)) < 5000);
  assert.equal((await t("", { result: "meet" })).j.field, "meet_at");
  const at = Date.now() + 3600e3;
  const meet = (await t("", { result: "meet", meet_at: at, note: "Владелец Ерлан", next_at: at, next_what: "Приехать" })).j.lead;
  assert.equal(meet.stage, "meet"); assert.equal(meet.meet_at, at); assert.equal(meet.next_what, "Приехать");
  const meet2 = (await t("", { result: "meet", meet_at: at })).j.lead;
  assert.equal(meet2.next_at, null, "встреча без отдельного шага снимает старый перезвон");
  assert.equal((await t("", { result: "paid" })).j.field, "prepay");
  const paid = (await t("", { result: "paid", prepay: "170 000", price: 340000 })).j.lead;
  assert.equal(paid.stage, "paid"); assert.equal(paid.prepay, 170000); assert.equal(paid.price, 340000); assert.equal(paid.next_at, null);
  const full = (await s.call("/api/leads/" + id)).j;
  assert.deepEqual(full.touches.map(x => x.stage), ["paid", "meet", "meet", "nd", "new"]);
  assert.equal(full.touches[2].note, "Владелец Ерлан");
  assert.equal((await t("", { result: "hack" })).status, 400);
});

test("«Сегодня»: встречи, просроченные перезвоны, новые по оценке и счётчики дня", async () => {
  const s = mk(); await s.login();
  const now = Date.now(), d = new Date(now); d.setHours(0, 0, 0, 0);
  const from = d.getTime(), to = from + 864e5;
  const mkLead = async (name, phone, over = {}) => (await s.call("/api/leads", { method: "POST", body: lead({ name, phones: phone, ...over }) })).j.lead.id;
  const a = await mkLead("Встреча сегодня", "+7 701 000 00 01"), b = await mkLead("Перезвон просрочен", "+7 701 000 00 02");
  await mkLead("Новый слабый", "+7 701 000 00 03", { reviews: 5, masters: 1, impression: 1 });
  await mkLead("Новый сильный", "+7 701 000 00 04");
  await s.call(`/api/leads/${a}/touch`, { method: "POST", body: { result: "meet", meet_at: Math.min(to - 1000, now + 60e3) } });
  await s.call(`/api/leads/${b}/touch`, { method: "POST", body: { result: "cb", next_at: now - 3600e3, next_what: "Позвонить Ерлану" } });
  const r = (await s.call(`/api/today?from=${from}&to=${to}&week=${from}`)).j;
  assert.deepEqual(r.meetToday.map(x => x.name), ["Встреча сегодня"]);
  assert.deepEqual(r.overdue.map(x => x.name), ["Перезвон просрочен"]);
  assert.deepEqual(r.fresh.map(x => x.name), ["Новый сильный", "Новый слабый"]);
  assert.equal(r.freshTotal, 2); assert.equal(r.due, 2);
  assert.deepEqual(r.stats, { calls: 2, lpr: 1, meets: 1, prepayWeek: 0 });
  assert.equal((await s.call("/api/today")).status, 400);
});

test("правка: оценка пересчитывается, этап вручную пишется в историю, закрытый этап снимает следующий шаг", async () => {
  const s = mk(); await s.login();
  const id = (await s.call("/api/leads", { method: "POST", body: lead({ reviews: 10, masters: 1, ig_followers: 50, ig_alive: 0, impression: 1 }) })).j.lead.id;
  assert.equal((await s.call("/api/leads/" + id)).j.lead.grade, "C");
  const up = (await s.call("/api/leads/" + id, { method: "PATCH", body: { reviews: 400, masters: 8, impression: 3, ig_alive: 1, lpr_name: "Ерлан" } })).j.lead;
  assert.equal(up.grade, "A"); assert.equal(up.lpr_name, "Ерлан"); assert.equal(up.name, "Barber One", "поля, которых нет в запросе, не тронуты");
  await s.call(`/api/leads/${id}/touch`, { method: "POST", body: { result: "cb", next_at: Date.now() + 1e6 } });
  const lost = (await s.call("/api/leads/" + id, { method: "PATCH", body: { stage: "lost" } })).j.lead;
  assert.equal(lost.stage, "lost"); assert.equal(lost.next_at, null);
  assert.equal((await s.call("/api/leads/" + id)).j.touches[0].kind, "stage");
  assert.equal((await s.call("/api/leads/" + id, { method: "PATCH", body: { name: "" } })).status, 400);
  assert.equal((await s.call("/api/leads?q=" + encodeURIComponent("ерлан"))).j.total, 1, "имя ЛПР ищется");
});

test("воронка, удаление и выгрузка в CSV", async () => {
  const s = mk(); await s.login();
  const a = (await s.call("/api/leads", { method: "POST", body: lead({ name: '=Формула; "кавычки"' }) })).j.lead.id;
  const b = (await s.call("/api/leads", { method: "POST", body: lead({ name: "Второй", phones: "+7 701 000 00 09" }) })).j.lead.id;
  await s.call(`/api/leads/${a}/touch`, { method: "POST", body: { result: "nd" } });
  await s.call(`/api/leads/${a}/touch`, { method: "POST", body: { result: "meet", meet_at: Date.now() + 1e6 } });
  await s.call(`/api/leads/${a}/touch`, { method: "POST", body: { result: "paid", prepay: 170000, price: 340000 } });
  const f = (await s.call("/api/funnel")).j;
  assert.deepEqual(f.byStage, { new: 1, paid: 1 });
  assert.deepEqual(f.calls, { calls: 2, reach: 1, calls7: 2, meets: 1 });
  assert.deepEqual(f.paid, { n: 1, prepay: 170000, price: 340000 });
  const csv = await s.call("/api/export.csv");
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.ok(csv.text.startsWith("﻿name;niche;city"));
  assert.ok(csv.text.includes(`"'=Формула; ""кавычки"""`), "формула обезврежена, кавычки и «;» экранированы");
  assert.equal((await s.call("/api/leads/" + b, { method: "DELETE", body: {} })).status, 200);
  assert.equal((await s.call("/api/leads/" + b)).status, 404);
  assert.equal((await s.call("/api/leads")).j.total, 1);
  assert.equal((await s.call("/api/leads", { method: "POST", body: lead({ name: "Снова", phones: "+7 701 000 00 09" }) })).status, 201, "номер удалённого лида свободен");
  await s.call("/api/logout", { method: "POST", body: {} });
  assert.equal((await s.call("/api/leads")).status, 401);
});
