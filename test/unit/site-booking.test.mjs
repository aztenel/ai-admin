// Онлайн-запись на сайте winchester.kz (21.10.2026): своя форма вместо виджета Altegio. API /api/site/<клиент>/<действие> — каталог
// (мастера, услуги по ключу, цены у каждого мастера), ближайшее время, открытые дни, свободное время с учётом длительности услуг,
// запись (book_check, затем book_record — только в режиме «1»). Altegio — заглушка с расписанием Winchester (test/fixtures/winchester-altegio.mjs).
// Часы проверок: суббота, 3.10.2026, 12:00 по Астане; «день n» — n дней после.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { net, mk, D0 } from "../harness.mjs";
import { altCache } from "../../src/services/integrations/altegio/booking-api.js";
import { svKey } from "../../src/services/sitebook/config.js";
import * as siteBase from "../../src/services/sitebook/base.js";
import { readFileSync, readdirSync } from "node:fs";
import { winchesterAlt, W, WS, dayN } from "../fixtures/winchester-altegio.mjs";

const SITE = "https://winchester.kz", OWNER_KEY = "owner-key-123456", PHONE = "+77071234567";
let LOC = 7400;
const reset = (data = winchesterAlt()) => { net.reset(); Object.assign(net, { altGone: [], altBusy: false, altCheckBusy: false }); net.altData = () => data; altCache.clear(); siteBase.siteCache.clear(); LOC++; return data; };
let ipN = 0;
const newIp = () => `10.9.${Math.floor(++ipN / 250)}.${ipN % 250}`;
let ridN = 0;
const rid = () => `rid${Date.now().toString(36)}x${(++ridN).toString(36).padStart(8, "0")}`;
// метка формы: та же подпись, что у сервера (HMAC ключа владельца), выданная ageMs назад
const ftOf = (ageMs = 10000, c = "winchester", key = OWNER_KEY) => { const ms = Date.now() - ageMs; return ms + "." + createHmac("sha256", key).update(`site:${c}:${ms}`).digest("base64url").slice(0, 22); };
// «сайт»: окружение и запросы с источником winchester.kz (origin: null — без заголовка Origin)
function site(extra = {}) {
  const s = mk({ ALTEGIO_PARTNER: "partner-key", ALTEGIO_LOC_WINCHESTER: String(LOC), ...extra });
  const ip = newIp();
  const hd = (o = {}) => { const h = { "cf-connecting-ip": o.ip || ip }; const or = o.origin === undefined ? SITE : o.origin; if (or) h.origin = or; return h; };
  s.get = (act, q = "", o = {}) => s.call(`/api/site/${o.c || "winchester"}/${act}${q ? "?" + q : ""}`, { method: o.method || "GET", headers: hd(o) });
  s.getJ = async (act, q, o) => { const r = await s.get(act, q, o); return { r, j: await r.json() }; };
  s.book = async (b = {}, o = {}) => {
    const body = typeof b === "string" ? b : JSON.stringify({ staff: W.AIDOS, any: false, services: ["мужская-стрижка", "глиняная-маска"], date: dayN(1), time: "12:00",
      name: "Азамат", phone: PHONE, comment: "", website: "", ft: ftOf(), rid: rid(), ...b });
    const r = await s.call(`/api/site/winchester/book`, { method: "POST", headers: { ...hd(o), "content-type": "application/json" }, body });
    return { r, j: await r.json() };
  };
  return s;
}
const cors = r => r.headers.get("access-control-allow-origin");
const records = () => net.alt.filter(x => /^POST \/book_record\//.test(x));
const checks = () => net.alt.filter(x => /^POST \/book_check\//.test(x));
// подмена ответа Altegio на book_record (как liveAlt в live-test-19-10): handler(n) → Response | бросает (нет связи)
async function withRecord(handler, fn) {
  const real = globalThis.fetch; let n = 0;
  globalThis.fetch = async (u, init = {}) => {
    if (/api\.alteg\.io\/api\/v1\/book_record\//.test(String(u)) && (init.method || "GET") === "POST") { n++; net.alt.push("POST /book_record/ (подмена)"); return handler(n, init); }
    return real(u, init);
  };
  try { return await fn(() => n); } finally { globalThis.fetch = real; }
}
const altErr = (code, msg = "error") => new Response(JSON.stringify({ success: false, data: null, meta: { message: msg, ...(code < 500 ? { errors: [{ code, message: msg }] } : {}) } }), { status: code < 500 ? 422 : code, headers: { "content-type": "application/json" } });

test("ключ услуги: строчные, ё → е, без скобок, кавычек и слова «комплекс»", () => {
  const pairs = [["Мужская стрижка", "мужская-стрижка"], ["Комплекс \"PREMIUM\"", "premium"], ["Комплекс Отец и сын", "отец-и-сын"], ["Окантовка + Укладка", "окантовка-укладка"],
    ["SPA-процедура для лица", "spa-процедура-для-лица"], ["Перманентная укладка (Down perm)", "перманентная-укладка"], ["Камуфляж седины (Kondor)", "камуфляж-седины"], ["Чёрная маска", "черная-маска"],
    ["Комплекс: Отец и сын", "отец-и-сын"], ["«Комплекс» PREMIUM", "premium"]];
  for (const [t, k] of pairs) assert.equal(svKey(t), k, t);
});

test("каталог: свой сайт и источники, мастера, цены у каждого мастера, длительности, группы; номеров услуг Altegio наружу нет", async () => {
  reset();
  const s = site();
  assert.equal((await s.get("catalog", "", { c: "nope" })).status, 404);
  const rb = await s.get("catalog", "", { c: "barber" });
  assert.equal(rb.status, 404); assert.equal(cors(rb), null);
  const ev = await s.get("catalog", "", { origin: "https://evil.example" });
  assert.equal(ev.status, 403); assert.equal(cors(ev), null); assert.equal((await ev.json()).code, "origin");
  const { r, j } = await s.getJ("catalog");
  assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(cors(r), SITE); assert.match(r.headers.get("vary") || "", /Origin/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const www = await s.get("catalog", "", { origin: "https://www.winchester.kz" });
  assert.equal(www.status, 200); assert.equal(cors(www), "https://www.winchester.kz");
  const plain = await s.get("catalog", "", { origin: null });
  assert.equal(plain.status, 200); assert.equal(cors(plain), null);
  assert.equal(j.ok, true); assert.equal(j.mode, "dry");
  assert.equal(j.company.name, "Winchester"); assert.equal(j.company.tel, "+77005050503"); assert.equal(j.company.wa, "77066940608"); assert.equal(j.company.hours, "ежедневно 10:00–21:00");
  assert.equal(j.today, D0); assert.match(j.now, /^\d{2}:\d{2}$/); assert.equal(j.days, 30); assert.equal(j.step, 30); assert.equal(j.maxServices, 5);
  assert.match(j.ft, /^\d{13}\.[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(j.staff.map(m => m.id), [W.TONI, W.AIDOS, W.AIDYN, W.ALISHER, W.RUSLAN]);
  const toni = j.staff[0], alisher = j.staff.find(m => m.id === W.ALISHER);
  assert.equal(toni.name, "Тони"); assert.equal(toni.full, "Тони (Рауан М.)"); assert.equal(toni.role, "Шеф-барбер"); assert.equal(toni.rating, 5); assert.equal(toni.reviews, 249);
  assert.equal(alisher.rating, null); assert.equal(alisher.reviews, null); // рейтинга ещё нет — не «0 звёзд»
  const sv = Object.fromEntries(j.services.map(x => [x.key, x]));
  assert.equal(sv["мужская-стрижка"].by[W.TONI].price, 9000); assert.equal(sv["мужская-стрижка"].by[W.AIDOS].price, 7000);
  assert.deepEqual(sv["мужская-стрижка"].price, { from: 7000, to: 9000 });
  assert.equal(sv["мужская-стрижка"].min, 60);
  assert.ok(!toni.services.includes("химическая-завивка") && !sv["химическая-завивка"].by[W.TONI]);
  assert.ok(toni.services.includes("перманентная-укладка") && j.staff[1].services.includes("перманентная-укладка") && !j.staff[2].services.includes("перманентная-укладка"));
  assert.equal(sv["детская-стрижка"].by[W.AIDYN].min, 45); assert.equal(sv["детская-стрижка"].by[W.AIDOS].min, 30); assert.equal(sv["детская-стрижка"].by[W.TONI].min, 30);
  assert.equal(sv["детская-стрижка"].min, 30);
  assert.equal(sv.premium.min, 90); assert.equal(sv.premium.by[W.TONI].min, 90); assert.equal(sv.premium.name, "Premium");
  assert.equal(sv.premium.desc, "Стрижка, SPA для лица, глиняная маска, перкуссионный массаж");
  assert.equal(sv["перманентная-укладка"].name, "Down Perm"); assert.equal(sv["камуфляж-бороды"].name, "Камуфляж бороды Kondor"); assert.equal(sv["отец-и-сын"].name, "Отец и сын");
  assert.equal(sv["глиняная-маска"].name, "Глиняная маска"); assert.equal(sv["глиняная-маска"].min, 15);
  assert.equal(j.services.length, 15); // старые строки прайса (их нет ни у одного мастера) не видны: одна «Мужская стрижка»
  assert.deepEqual(j.groups.map(g => g.title), ["Стрижки", "Борода и камуфляж", "Комплексы", "Дополнительные процедуры"]);
  assert.deepEqual(j.groups[2].keys, ["premium", "отец-и-сын"]);
  const text = JSON.stringify(j);
  for (const id of [...Object.values(WS), 13023865, 13023820, 13023843]) assert.ok(!text.includes(String(id)), "номер услуги Altegio в ответе: " + id);
});

test("каталог: Premium — 90 мин при любой длительности в Altegio; услуга вне групп — «Другие услуги» в конце", async () => {
  const d = reset();
  d.lenFor = (staff, id) => +id === WS.PREMIUM_CHEF || +id === WS.PREMIUM ? 3600 : undefined;
  const sf = d.servicesFor;
  d.servicesFor = staff => String(staff) === String(W.AIDOS) ? [...sf(staff), { id: 13099999, title: "Тонирование бороды", category_id: 13023815, price_min: 3000, price_max: 3500, active: 1, seance_length: 1200 }] : sf(staff);
  const { j } = await site().getJ("catalog");
  const sv = Object.fromEntries(j.services.map(x => [x.key, x]));
  assert.equal(sv.premium.min, 90); assert.equal(sv.premium.by[W.AIDOS].min, 90);
  assert.deepEqual(j.groups.at(-1), { title: "Другие услуги", keys: ["тонирование-бороды"] });
  assert.deepEqual(sv["тонирование-бороды"].by[W.AIDOS], { price: 3000, max: 3500, min: 20 });
});

test("SITE_ORIGINS_<ID> заменяет список сайтов целиком", async () => {
  reset();
  const s = site({ SITE_ORIGINS_WINCHESTER: "http://127.0.0.1:5555, javascript:alert(1)" });
  assert.equal((await s.get("catalog")).status, 403);
  const r = await s.get("catalog", "", { origin: "http://127.0.0.1:5555" });
  assert.equal(r.status, 200); assert.equal(cors(r), "http://127.0.0.1:5555");
});

test("предзапрос OPTIONS: 204 и заголовки для своего сайта; чужой сайт — 403 без CORS", async () => {
  reset();
  const s = site();
  const r = await s.get("book", "", { method: "OPTIONS" });
  assert.equal(r.status, 204); assert.equal(cors(r), SITE);
  assert.equal(r.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS"); assert.equal(r.headers.get("access-control-allow-headers"), "content-type");
  assert.equal(r.headers.get("access-control-max-age"), "600"); assert.equal(r.headers.get("access-control-allow-credentials"), null);
  const e = await s.get("book", "", { method: "OPTIONS", origin: "https://evil.example" });
  assert.equal(e.status, 403); assert.equal(cors(e), null);
  const n = await s.get("nope", "", { method: "OPTIONS" });
  assert.equal(n.status, 404); assert.equal(cors(n), SITE);
  const noOrigin = await s.get("book", "", { method: "OPTIONS", origin: null });
  assert.equal(noOrigin.status, 403);
  const m = await s.get("book"); // GET на запись — 405 с Allow
  assert.equal(m.status, 405); assert.equal(m.headers.get("allow"), "POST, OPTIONS"); assert.equal(cors(m), SITE);
  const noOriginPost = await s.book({}, { origin: null });
  assert.equal(noOriginPost.r.status, 403); assert.equal(noOriginPost.j.code, "origin");
});

test("запись выключена: SITE_BOOKING_<ID>=0 или нет ключа Altegio — 503 off на всех действиях, к Altegio не обращаемся", async () => {
  reset();
  for (const s of [site({ SITE_BOOKING_WINCHESTER: "0" }), site({ ALTEGIO_PARTNER: "" })]) {
    for (const [act, q] of [["catalog", ""], ["nearest", ""], ["dates", "staff=0&services=premium"], ["times", "staff=0&services=premium"]]) {
      const { r, j } = await s.getJ(act, q);
      assert.equal(r.status, 503, act); assert.equal(j.code, "off"); assert.equal(cors(r), SITE); assert.match(j.error, /\+7 700 505 05 03/);
    }
    const b = await s.book();
    assert.equal(b.r.status, 503); assert.equal(b.j.code, "off");
  }
  assert.deepEqual(net.alt, []);
});

test("открытые дни: выходные мастера исключены, «любой» — объединение; неизвестная услуга и услуга не у этого мастера — 400", async () => {
  reset();
  const s = site();
  const { j } = await s.getJ("dates", `staff=${W.TONI}&services=${encodeURIComponent("мужская-стрижка")}`);
  assert.equal(j.ok, true, JSON.stringify(j)); assert.equal(j.from, D0); assert.equal(j.to, dayN(29));
  assert.ok(j.dates.length > 20 && j.dates.every(d => new Date(d + "T00:00:00Z").getUTCDay() !== 5), JSON.stringify(j.dates)); // у Тони выходной — пятница
  assert.ok(j.dates.every(d => d >= D0 && d <= dayN(29)));
  const aidos = (await s.getJ("dates", `staff=${W.AIDOS}&services=premium`)).j;
  assert.ok(aidos.dates.every(d => ![1, 2].includes(new Date(d + "T00:00:00Z").getUTCDay())));
  const any = (await s.getJ("dates", "staff=0&services=premium")).j;
  assert.equal(any.dates.length, 30); // у Алишера выходных нет
  const bad = await s.getJ("dates", "staff=0&services=nope");
  assert.equal(bad.r.status, 400); assert.equal(bad.j.code, "bad_request"); assert.equal(bad.j.field, "services");
  const notHis = await s.getJ("dates", `staff=${W.TONI}&services=${encodeURIComponent("химическая-завивка")}`);
  assert.equal(notHis.r.status, 400); assert.equal(notHis.j.field, "services"); assert.equal(notHis.j.error, "Эту услугу нельзя записать к выбранному мастеру.");
  const six = await s.getJ("dates", `staff=0&services=${encodeURIComponent("мужская-стрижка,глиняная-маска,черная-маска,spa-процедура-для-лица,перкуссионный-массаж,моделирование-бороды")}`);
  assert.equal(six.r.status, 400); assert.equal(six.j.error, "Не больше 5 услуг за один визит.");
  const empty = await s.getJ("dates", "staff=0&services=");
  assert.equal(empty.r.status, 400); assert.equal(empty.j.error, "Выбери хотя бы одну услугу.");
  const nobody = await s.getJ("dates", `staff=999&services=premium`);
  assert.equal(nobody.r.status, 400); assert.equal(nobody.j.field, "staff");
  // химическая завивка у Айдоса есть, у Тони нет: «любой» — только барберы, которые её делают
  const perm = (await s.getJ("dates", `staff=0&services=${encodeURIComponent("химическая-завивка")}`)).j;
  assert.equal(perm.ok, true); assert.ok(net.alt.some(x => x.includes(`book_dates/${LOC}?staff_id=${W.ALISHER}`)) && !net.alt.some(x => x.includes(`book_dates/${LOC}?staff_id=${W.AIDYN}&service_ids%5B%5D=${WS.PERM}`)));
});

test("свободное время: длительность услуг, сетка, прошедшее время, первый день со временем, «любой мастер», следующий день", async () => {
  const d = reset();
  const s = site();
  const t1 = (await s.getJ("times", `staff=${W.TONI}&services=premium&date=${dayN(1)}`)).j;
  assert.equal(t1.ok, true, JSON.stringify(t1)); assert.equal(t1.date, dayN(1));
  const times = t1.slots.map(x => x.time);
  assert.ok(!times.includes("16:30") && times.includes("15:00") && times.includes("18:30") && !times.includes("17:00"), times.join(" ")); // у Тони запись в 17:30 — Premium (1 ч 30 мин) на 16:30 не помещается
  assert.deepEqual(t1.slots.find(x => x.time === "15:00"), { time: "15:00", end: "16:30", staff: W.TONI, price: 13000, min: 90 });
  // день 0 (сегодня, 12:00): ничего раньше 12:30
  const t0 = (await s.getJ("times", `staff=${W.AIDOS}&services=${encodeURIComponent("мужская-стрижка")}&date=${D0}`)).j;
  assert.ok(t0.slots.length && t0.slots.every(x => x.time >= "12:30"), JSON.stringify(t0.slots));
  // время не по сетке Altegio («12:05») убираем
  const tf = d.timesFor;
  d.timesFor = (staff, date, sids) => { const r = tf(staff, date, sids); return String(staff) === String(W.ALISHER) && Array.isArray(r) ? [...r, "12:05", "20:40"].sort() : r; };
  altCache.clear();
  const tg = (await s.getJ("times", `staff=${W.ALISHER}&services=${encodeURIComponent("глиняная-маска")}&date=${dayN(1)}`)).j;
  assert.ok(tg.slots.length && tg.slots.every(x => /:(00|30)$/.test(x.time)), JSON.stringify(tg.slots.map(x => x.time)));
  d.timesFor = tf; altCache.clear();
  // «любой мастер» + стрижка: у каждого времени — барбер за 7 000, а не шеф за 9 000
  const ta = (await s.getJ("times", `staff=0&services=${encodeURIComponent("мужская-стрижка")}&date=${dayN(1)}`)).j;
  assert.ok(ta.slots.length > 10 && ta.slots.every(x => x.staff !== W.TONI && x.price === 7000 && x.min === 60), JSON.stringify(ta.slots));
  assert.ok(ta.slots.some(x => x.time === "10:00" && x.staff !== W.AIDOS)); // у Айдоса 10:00–12:00 занято
  // следующий открытый день: у Тони выходной в пятницу (день 6)
  const tn = (await s.getJ("times", `staff=${W.TONI}&services=premium&date=${dayN(5)}`)).j;
  assert.equal(tn.next, dayN(7));
  // день, который мастер не работает, — пустой список
  const off = (await s.getJ("times", `staff=${W.TONI}&services=premium&date=${dayN(6)}`)).j;
  assert.deepEqual(off.slots, []); assert.equal(off.date, dayN(6));
});

test("свободное время без даты: первый открытый день, где время есть", async () => {
  reset(winchesterAlt({ busy: [{ staff: W.TONI, day: 0, from: "10:00", to: "21:00" }] }));
  const { j } = await site().getJ("times", `staff=${W.TONI}&services=${encodeURIComponent("мужская-стрижка")}`);
  assert.equal(j.date, dayN(1), JSON.stringify(j)); assert.equal(j.slots[0].time, "10:00"); assert.equal(j.next, dayN(2));
});

test("запись в режиме проверки (по умолчанию): book_check без book_record, заявка «запишите вручную», номер наружу и в журнал — маской", async () => {
  reset();
  const s = site();
  const logs = [], orig = console.log;
  console.log = (...a) => logs.push(a.map(String).join(" "));
  let res;
  try { res = await s.book({ comment: "Позвоните, пожалуйста: 8 701 555 44 33" }); } finally { console.log = orig; }
  const { r, j } = res;
  assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(cors(r), SITE);
  assert.equal(j.mode, "dry"); assert.equal(j.booking.id, null); assert.equal(j.booking.phone, "+7 707 *** ** 67");
  assert.deepEqual(j.booking.staff, { id: W.AIDOS, name: "Айдос", role: "Барбер" });
  assert.equal(j.booking.total, 9000); assert.equal(j.booking.min, 75); assert.equal(j.booking.end, "13:15"); assert.equal(j.booking.time, "12:00");
  assert.deepEqual(j.booking.services.map(x => [x.key, x.price, x.min]), [["мужская-стрижка", 7000, 60], ["глиняная-маска", 2000, 15]]);
  assert.equal(checks().length, 1); assert.equal(records().length, 0);
  const lead = s.leads("winchester").at(-1);
  assert.equal(lead.source, "Winchester · сайт"); assert.equal(lead.phone, PHONE); assert.equal(lead.name, "Азамат");
  assert.equal(lead.service, "Мужская стрижка + Глиняная маска (мастер Айдос)"); assert.match(lead.time, /^04\.10 \(вс\) 12:00–13:15$/);
  assert.match(lead.note, /режиме проверки/); assert.ok(!lead.altegio);
  assert.ok([...s.kv.mem.keys()].some(k => k.startsWith("lead:winchester:")), "заявка ещё и отдельным ключом");
  const tg = net.tg.map(m => m.text).join("\n");
  assert.match(tg, /Заявка с сайта — запишите вручную — Winchester/); assert.match(tg, /Мастер: Айдос\n/); assert.match(tg, /Телефон: \+7 707 123 45 67/);
  assert.match(tg, /Услуги: Мужская стрижка 7 000 ₸ \+ Глиняная маска 2 000 ₸/); assert.match(tg, /итого 9 000 ₸/); assert.ok(!/Номер записи/.test(tg));
  assert.ok(!logs.join("\n").includes("77071234567") && !logs.join("\n").includes("87015554433"), logs.join("\n"));
  assert.equal(+s.kv.json(`bk:${LOC}:${PHONE}:${D0}`), 1); // режим проверки тоже тратит предел (иначе — спам заявками)
});

test("журнал сервера без номера: сбой сохранения заявки пишется маской", async () => {
  reset();
  const s = site();
  s.kv.fail.put = k => k.startsWith("leads:") || k.startsWith("lead:");
  const logs = [], orig = console.log;
  console.log = (...a) => logs.push(a.map(String).join(" "));
  let res;
  try { res = await s.book(); } finally { console.log = orig; }
  assert.equal(res.r.status, 200, JSON.stringify(res.j)); // сбой хранилища ответ клиенту не ломает
  assert.ok(logs.length && !logs.join("\n").includes("77071234567"), logs.join("\n"));
});

test("настоящая запись (SITE_BOOKING_<ID>=1): book_check, затем book_record строкой прайса мастера; предел номера; номер записи в Telegram", async () => {
  reset();
  const s = site({ SITE_BOOKING_WINCHESTER: "1" });
  const a = await s.book({ staff: W.TONI, time: "15:00", comment: "Без машинки" });
  assert.equal(a.r.status, 200, JSON.stringify(a.j)); assert.equal(a.j.mode, "live"); assert.equal(a.j.booking.id, 777001);
  const iC = net.alt.findIndex(x => /^POST \/book_check\//.test(x)), iR = net.alt.findIndex(x => /^POST \/book_record\//.test(x));
  assert.ok(iC >= 0 && iR > iC, net.alt.join(" | "));
  const rec = net.altRecords[0], ap = rec.appointments[0];
  assert.deepEqual(ap.services, [WS.CUT_CHEF, WS.MASK]); assert.equal(ap.staff_id, W.TONI); assert.equal(ap.datetime, `${dayN(1)}T15:00:00+05:00`);
  assert.match(rec.comment, /сайт/); assert.match(rec.comment, /Без машинки/); assert.equal(rec.fullname, "Азамат"); assert.equal(rec.phone, PHONE);
  assert.equal(a.j.booking.total, 11000);
  const raw = JSON.stringify(a.j);
  assert.ok(!/hash/i.test(raw) && !raw.includes("hash777001"), raw);
  assert.equal(+s.kv.json(`bk:${LOC}:${PHONE}:${D0}`), 1);
  const lead = s.leads("winchester").at(-1);
  assert.equal(lead.altegio.record_id, 777001); assert.match(lead.note, /Записан онлайн с сайта/);
  assert.equal(lead.src, "site"); assert.equal(lead.altegio.record_hash, undefined); // кода записи в заявке нет: бот запись с сайта не отменяет сам (находка 8)
  const tg = net.tg.map(m => m.text).join("\n");
  assert.match(tg, /✅ Запись с сайта — Winchester/); assert.match(tg, /Номер записи в Altegio: 777001/); assert.match(tg, /Комментарий: «Без машинки»/);
  const b = await s.book({ staff: W.AIDOS, time: "12:00", phone: "+77011112233" });
  assert.equal(b.r.status, 200, JSON.stringify(b.j));
  assert.deepEqual(net.altRecords[1].appointments[0].services, [WS.CUT, WS.MASK]);
});

test("«любой мастер»: назначенный занят — записан другой барбер по той же цене; свободен только шеф (дороже) — «время заняли»", async () => {
  reset();
  const s = site();
  const ta = (await s.getJ("times", `staff=0&services=${encodeURIComponent("мужская-стрижка")}&date=${dayN(1)}`)).j;
  const slot = ta.slots.find(x => x.time === "12:00");
  assert.ok(slot && slot.price === 7000 && slot.staff !== W.TONI, JSON.stringify(ta.slots));
  net.altBusy = true;
  const busyAt = (staff, time = "12:00") => net.altRecords.push({ phone: "+77000000001", fullname: "Гость", appointments: [{ id: 1, services: [WS.CUT], staff_id: staff, datetime: `${dayN(1)}T${time}:00+05:00` }] });
  busyAt(slot.staff);
  const ok = await s.book({ staff: slot.staff, any: true, services: ["мужская-стрижка"], time: "12:00" });
  assert.equal(ok.r.status, 200, JSON.stringify(ok.j));
  assert.ok(ok.j.booking.staff.id !== slot.staff && ok.j.booking.staff.id !== W.TONI && ok.j.booking.total === 7000 && ok.j.booking.any === true, JSON.stringify(ok.j.booking));
  assert.match(net.tg.map(m => m.text).join("\n"), /клиент выбрал «любой мастер»/);
  for (const m of [W.AIDOS, W.AIDYN, W.ALISHER, W.RUSLAN]) if (m !== slot.staff) busyAt(m);
  altCache.clear();
  const no = await s.book({ staff: slot.staff, any: true, services: ["мужская-стрижка"], time: "12:00" });
  assert.equal(no.r.status, 409, JSON.stringify(no.j)); assert.equal(no.j.code, "taken");
  assert.ok(Array.isArray(no.j.slots) && no.j.slots.every(x => x.time !== "12:00"));
});

test("время заняли (book_check отказал): 409 taken и свежие варианты на тот же день, book_record нет", async () => {
  reset();
  const s = site({ SITE_BOOKING_WINCHESTER: "1" });
  net.altCheckBusy = true;
  const { r, j } = await s.book();
  assert.equal(r.status, 409, JSON.stringify(j)); assert.equal(j.code, "taken"); assert.equal(j.error, "Это время только что заняли. Выбери другое.");
  assert.ok(j.slots.length > 0 && j.slots.length <= 6 && j.slots.every(x => x.staff === W.AIDOS && x.time !== "12:00" && x.price === 9000), JSON.stringify(j.slots));
  assert.equal(records().length, 0);
});

test("ошибки book_record: 433 — taken, 437 — overlap, 438 — service, 431 дважды — телефон, 500 и обрыв — unknown (один раз), повтор того же rid — тот же ответ", async () => {
  for (const [code, http, want] of [[433, 409, "taken"], [437, 409, "overlap"], [438, 409, "service"]]) {
    reset();
    const s = site({ SITE_BOOKING_WINCHESTER: "1" });
    await withRecord(() => altErr(code), async () => {
      const { r, j } = await s.book();
      assert.equal(r.status, http, code + " " + JSON.stringify(j)); assert.equal(j.code, want);
      assert.equal(cors(r), SITE);
    });
  }
  reset();
  { const s = site({ SITE_BOOKING_WINCHESTER: "1" });
    await withRecord(() => altErr(431, "Неверный формат телефона"), async n => {
      const { r, j } = await s.book();
      assert.equal(r.status, 400, JSON.stringify(j)); assert.equal(j.code, "bad_request"); assert.equal(j.field, "phone"); assert.equal(n(), 2); // altRecord сам повторил номер без «+»
    }); }
  for (const fail of [() => altErr(500, "Server error"), () => { throw new TypeError("fetch failed"); }]) {
    reset();
    const s = site({ SITE_BOOKING_WINCHESTER: "1" });
    await withRecord(fail, async n => {
      const id = rid();
      const { r, j } = await s.book({ rid: id });
      assert.equal(r.status, 502, JSON.stringify(j)); assert.equal(j.code, "unknown"); assert.match(j.error, /Не записывайся повторно/);
      assert.equal(n(), 1);
      assert.match(net.tg.map(m => m.text).join("\n"), /⚠️ Запись с сайта: Altegio не ответил — проверьте журнал/);
      assert.match(s.leads("winchester").at(-1).note, /могла создаться/);
      const before = net.alt.length;
      const again = await s.book({ rid: id });
      assert.equal(again.r.status, 502); assert.deepEqual(again.j, j); assert.equal(net.alt.length, before); assert.equal(n(), 1);
    });
  }
  reset();
  { const s = site({ SITE_BOOKING_WINCHESTER: "1" });
    await withRecord(() => altErr(434, "Клиент в чёрном списке"), async () => {
      const { r, j } = await s.book();
      assert.equal(r.status, 502); assert.equal(j.code, "refused"); assert.ok(!/чёрн|черн/i.test(j.error)); // отказ — заявка администратору (находка 5)
      assert.match(net.tg.map(m => m.text).join("\n"), /Онлайн-запись с сайта не прошла/);
    }); }
});

test("проверка полей: имя, телефон, услуги, комментарий, день, время, размер тела", async () => {
  reset();
  const s = site();
  const ip = () => ({ ip: newIp() }); // попытки с одного адреса ограничены 8 в час — здесь каждая со своего
  const bad = async (b, field, text) => {
    const { r, j } = await s.book(b, ip());
    assert.equal(r.status, 400, JSON.stringify(b) + " " + JSON.stringify(j)); assert.equal(j.code, "bad_request"); assert.equal(j.field, field, JSON.stringify(j));
    if (text) assert.equal(j.error, text);
    assert.equal(cors(r), SITE);
  };
  await bad({ name: "" }, "name", "Проверь имя: только буквы, от 2 до 60 знаков.");
  await bad({ name: "12345" }, "name");
  await bad({ name: "А".repeat(61) }, "name");
  await bad({ phone: "+7 7172 12 34 56" }, "phone", "Нужен номер мобильного Казахстана: +7 7XX XXX XX XX.");
  await bad({ phone: "+7 600 123 45 67" }, "phone");
  await bad({ services: ["мужская-стрижка", "глиняная-маска", "черная-маска", "spa-процедура-для-лица", "перкуссионный-массаж", "моделирование-бороды"] }, "services", "Не больше 5 услуг за один визит.");
  await bad({ services: [] }, "services", "Выбери хотя бы одну услугу.");
  await bad({ services: ["мужская-стрижка", "мужская-стрижка"] }, "services");
  await bad({ staff: W.TONI, services: ["химическая-завивка"] }, "services", "Эту услугу нельзя записать к выбранному мастеру.");
  await bad({ staff: 0 }, "staff", "Выбери мастера.");
  await bad({ comment: "к".repeat(151) }, "comment", "Комментарий — не длиннее 150 знаков.");
  await bad({ date: dayN(35) }, "date", "Выбери другой день.");
  await bad({ staff: W.AIDOS, date: dayN(2) }, "date"); // понедельник — выходной Айдоса
  await bad({ time: "9:5" }, "time", "Выбери время.");
  await bad({ rid: "short" }, "body", "Не получилось прочитать заявку. Обнови страницу и попробуй ещё раз.");
  await bad(JSON.stringify({ rid: rid(), comment: "x".repeat(5000) }), "body");
  await bad("{не json", "body");
  // имя с дефисом и апострофом, номер с 8 — подходят
  const okName = await s.book({ name: "  Анна-Мария   О’Нил ", phone: "8 (707) 123-45-67" }, ip());
  assert.equal(okName.r.status, 200, JSON.stringify(okName.j)); assert.equal(okName.j.booking.name, "Анна-Мария О’Нил");
  assert.equal(records().length, 0);
});

test("защита: ловушка website, метка формы моложе 4 с, старше 3 ч, поддельная подпись", async () => {
  reset();
  const s = site();
  const spam = await s.book({ website: "http://spam.example" });
  assert.equal(spam.r.status, 400); assert.equal(spam.j.code, "spam"); assert.match(spam.j.error, /\+7 700 505 05 03/);
  assert.deepEqual(net.alt, []);
  const fast = await s.book({ ft: ftOf(1000) });
  assert.equal(fast.r.status, 400); assert.equal(fast.j.code, "too_fast"); assert.ok(fast.j.retry >= 1 && fast.j.retry <= 4, JSON.stringify(fast.j));
  const old = await s.book({ ft: ftOf(3 * 3600e3 + 60e3) });
  assert.equal(old.r.status, 409); assert.equal(old.j.code, "expired");
  const forged = await s.book({ ft: ftOf(10000, "winchester", "wrong-key-000") });
  assert.equal(forged.r.status, 400); assert.equal(forged.j.code, "bad_request"); assert.equal(forged.j.field, "body");
  const other = await s.book({ ft: ftOf(10000, "barber") }); // метка другого клиента
  assert.equal(other.j.field, "body");
  assert.deepEqual(net.alt, []);
  // метка из каталога подписана тем же ключом и годится через 4 с
  const cat = (await s.getJ("catalog")).j;
  const [ms] = cat.ft.split(".");
  const re = ms + "." + createHmac("sha256", OWNER_KEY).update(`site:winchester:${ms}`).digest("base64url").slice(0, 22);
  assert.equal(cat.ft, re);
});

test("пределы: 4-я запись с номера за день (общий счётчик с ботом), устройство, день сайта, 9-я попытка за час с IP", async () => {
  reset();
  const s = site();
  await s.kv.api.put(`bk:${LOC}:${PHONE}:${D0}`, "3"); // три записи бота с этого номера сегодня
  const p = await s.book({}, { ip: newIp() });
  assert.equal(p.r.status, 429, JSON.stringify(p.j)); assert.equal(p.j.code, "limit"); assert.equal(p.j.field, "phone"); assert.match(p.j.error, /С этого номера/);
  const ip = newIp();
  await s.kv.api.put(`bk:${LOC}:${ip}:${D0}`, "15");
  const i = await s.book({ phone: "+77011110001" }, { ip });
  assert.equal(i.j.code, "limit"); assert.equal(i.j.field, "ip");
  await s.kv.api.put(`bk:${LOC}:site:${D0}`, "15"); // у сайта свой предел дня (находка 2)
  const d = await s.book({ phone: "+77011110002" }, { ip: newIp() });
  assert.equal(d.j.code, "limit"); assert.equal(d.j.field, "day"); assert.match(d.j.error, /заполнена/);
  assert.equal(checks().length, 0);
  const one = newIp();
  for (let k = 0; k < 8; k++) { const r = await s.book({ name: "1" }, { ip: one }); assert.equal(r.j.code, "bad_request", "попытка " + (k + 1)); }
  const ninth = await s.book({}, { ip: one });
  assert.equal(ninth.r.status, 429); assert.equal(ninth.j.code, "rate"); assert.ok(ninth.j.retry > 0 && ninth.j.retry <= 3600);
});

test("предел чтения: больше 90 запросов в минуту с одного адреса — 429", async () => {
  reset();
  const s = site(), ip = newIp();
  let last;
  for (let k = 0; k < 91; k++) last = await s.get("catalog", "", { ip });
  assert.equal(last.status, 429); assert.equal((await last.json()).code, "rate"); assert.equal(cors(last), SITE);
});

test("двойное нажатие: два одновременных запроса с одним rid — одна запись", async () => {
  reset();
  const s = site({ SITE_BOOKING_WINCHESTER: "1" });
  const id = rid();
  const [a, b] = await Promise.all([s.book({ rid: id }), s.book({ rid: id })]);
  assert.equal(records().length, 1, net.alt.join(" | "));
  const codes = [a, b].map(x => x.r.status).sort();
  assert.ok(codes[0] === 200 && (codes[1] === 200 || (codes[1] === 409 && [a, b].some(x => x.j.code === "in_progress"))), JSON.stringify([a.j, b.j]));
});

test("кэш каталога: второй запрос к Altegio не ходит; Altegio недоступен — 502 altegio с CORS", async () => {
  const d = reset();
  const s = site();
  await s.get("catalog");
  const n = net.alt.length;
  assert.ok(n >= 7, net.alt.join(" | ")); // мастера, все услуги, услуги каждого из пяти мастеров
  await s.get("catalog");
  assert.equal(net.alt.length, n);
  d.down = true; altCache.clear(); siteBase.siteCache.clear();
  const { r, j } = await s.getJ("catalog");
  assert.equal(r.status, 502); assert.equal(j.code, "altegio"); assert.equal(cors(r), SITE);
});

test("сбой внутри (хранилище бросает) — 500 server с CORS", async () => {
  reset();
  const s = site();
  s.kv.fail.get = () => true;
  const { r, j } = await s.book();
  assert.equal(r.status, 500, JSON.stringify(j)); assert.equal(j.code, "server"); assert.equal(cors(r), SITE);
});

test("ближайшее время у мастеров: до 3 времён, сбой у одного мастера — null", async () => {
  const d = reset();
  const tf = d.timesFor;
  d.timesFor = (staff, date, sids) => String(staff) === String(W.RUSLAN) ? { error: 500 } : tf(staff, date, sids);
  const { r, j } = await site().getJ("nearest");
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.deepEqual(j.staff[W.TONI], { date: D0, times: ["15:00", "15:30", "16:00"] }); // сегодня у Тони 12:00–15:00 занято
  assert.equal(j.staff[W.RUSLAN], null);
  for (const m of [W.AIDOS, W.AIDYN, W.ALISHER]) assert.ok(j.staff[m] && j.staff[m].times.length === 3 && j.staff[m].times.every(t => /^\d{2}:\d{2}$/.test(t)), JSON.stringify(j.staff[m]));
});

// ======== Находки проверки 21.10.2026 (сервер): сначала повтор, потом исправление
const resetAll = reset;
// KV с задержкой, как по сети (проба П4): чтение, запись и удаление — по 15 мс
const slowKV = s => {
  const kv = s.env.KV, g = kv.get, p = kv.put, d = kv.delete, w = () => new Promise(r => setTimeout(r, 15));
  kv.get = async (...a) => { await w(); return g(...a); }; kv.put = async (...a) => { await w(); return p(...a); }; kv.delete = async (...a) => { await w(); return d(...a); };
};
const hourKey = ip => `sbh:${LOC}:${ip}:${new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 13)}`;
const FIVE = ["15:00", "16:00", "17:00", "18:00", "19:00"];

test("находка 1: одновременные запросы не обходят предел адреса за сутки (остаток 1 из 15) — одна запись, счётчик 15", async () => {
  resetAll();
  const s = site({ SITE_BOOKING_WINCHESTER: "1" }), ip = newIp();
  slowKV(s);
  await s.env.KV.put(`bk:${LOC}:${ip}:${D0}`, "14");
  const res = await Promise.all(FIVE.map((t, i) => s.book({ staff: W.ALISHER, services: ["мужская-стрижка"], time: t, phone: "+7701555000" + i }, { ip })));
  assert.equal(net.altRecords.length, 1, res.map(x => x.r.status + "/" + (x.j.code || "ok")).join(" "));
  assert.equal(res.filter(x => x.r.status === 200).length, 1);
  assert.ok(res.filter(x => x.r.status !== 200).every(x => x.r.status === 429 && x.j.code === "limit" && x.j.field === "ip"), JSON.stringify(res.map(x => x.j)));
  assert.equal(await s.env.KV.get(`bk:${LOC}:${ip}:${D0}`), "15");
});

test("находка 1: одновременные запросы не обходят 8 попыток в час с адреса (остаток 1)", async () => {
  resetAll();
  const s = site({ SITE_BOOKING_WINCHESTER: "1" }), ip = newIp();
  slowKV(s);
  await s.env.KV.put(hourKey(ip), "7");
  const res = await Promise.all(FIVE.map((t, i) => s.book({ staff: W.ALISHER, services: ["мужская-стрижка"], time: t, phone: "+7701555100" + i }, { ip })));
  assert.equal(net.altRecords.length, 1, res.map(x => x.r.status + "/" + (x.j.code || "ok")).join(" "));
  assert.equal(res.filter(x => x.r.status === 429 && x.j.code === "rate").length, 4);
  assert.equal(await s.env.KV.get(hourKey(ip)), "8");
});

test("находка 1: одновременные удачные записи с разных адресов — счётчик дня сайта без потерь", async () => {
  resetAll();
  const s = site({ SITE_BOOKING_WINCHESTER: "1" });
  slowKV(s);
  const res = await Promise.all(FIVE.slice(0, 3).map((t, i) => s.book({ staff: W.ALISHER, services: ["мужская-стрижка"], time: t, phone: "+7701555200" + i }, { ip: newIp() })));
  assert.ok(res.every(x => x.r.status === 200), JSON.stringify(res.map(x => x.j)));
  assert.equal(await s.env.KV.get(`bk:${LOC}:site:${D0}`), "3");
});

test("находка 2: у сайта свой предел дня (15) — бот и сайт не закрывают запись друг другу", async () => {
  resetAll();
  const s = site();
  await s.env.KV.put(`bk:${LOC}:all:${D0}`, "25"); // бот исчерпал свой предел локации
  const a = await s.book({ staff: W.ALISHER, services: ["мужская-стрижка"], time: "15:00" });
  assert.equal(a.r.status, 200, JSON.stringify(a.j));
  assert.equal(await s.env.KV.get(`bk:${LOC}:all:${D0}`), "25"); // предел бота сайт не тратит
  assert.equal(await s.env.KV.get(`bk:${LOC}:site:${D0}`), "1");
  await s.env.KV.put(`bk:${LOC}:site:${D0}`, "15");
  const b = await s.book({ staff: W.ALISHER, services: ["мужская-стрижка"], time: "16:00", phone: "+77011110009" }, { ip: newIp() });
  assert.equal(b.r.status, 429); assert.equal(b.j.code, "limit"); assert.equal(b.j.field, "day");
});

test("находка 3: наборы услуг не умножают запросы к Altegio (открытые дни — по мастеру), кэш бота не сбрасывается", async () => {
  resetAll();
  const s = site();
  await s.getJ("catalog");
  altCache.set("base:" + LOC, { at: Date.now(), v: { services: [], staff: [] } }); // кэш бота
  const keys = ["мужская-стрижка", "детская-стрижка", "окантовка-укладка", "моделирование-бороды", "камуфляж-бороды", "камуфляж-седины", "premium", "отец-и-сын",
    "spa-процедура-для-лица", "восковое-удаление-лишних-волос", "глиняная-маска", "черная-маска", "перкуссионный-массаж"];
  const combos = [];
  for (let a = 0; a < keys.length && combos.length < 78; a++) for (let b = a + 1; b < keys.length && combos.length < 78; b++) combos.push([keys[a], keys[b]]);
  const before = net.alt.length;
  for (const c of combos) await s.getJ("dates", `staff=0&services=${encodeURIComponent(c.join(","))}`);
  const dates = net.alt.slice(before).filter(x => /book_dates/.test(x));
  assert.ok(dates.length <= 5, `book_dates: ${dates.length}`);
  assert.ok(altCache.has("base:" + LOC), "кэш бота сброшен");
  // время всех мастеров на 30 дней: ключей кэша не больше, чем мастеров × дней — кэш бота на месте (очередь к Altegio здесь не проверяем)
  const G = siteBase.GATE, rate = G.rate;
  G.rate = 1e6;
  try { for (let i = 0; i < 30; i++) await s.getJ("times", `staff=0&services=${encodeURIComponent("глиняная-маска")}&date=${dayN(i)}`, { ip: newIp() }); }
  finally { G.rate = rate; }
  assert.ok(altCache.has("base:" + LOC), "кэш бота сброшен временем");
  // ключи кэша сайта — с id клиента (находка 10)
  assert.ok(siteBase.siteCache && siteBase.siteCache.size > 0 && [...siteBase.siteCache.keys()].every(k => k.includes(":winchester:")), JSON.stringify(siteBase.siteCache && [...siteBase.siteCache.keys()]));
});

test("находка 3: запросы сайта к Altegio идут не чаще предела; очередь длиннее нескольких секунд — 429 rate с CORS", async () => {
  resetAll();
  const s = site();
  await s.getJ("catalog");
  const G = siteBase.GATE, keep = { ...G };
  Object.assign(G, { burst: 2, rate: 0.001, wait: 300 });
  try {
    const before = net.alt.length;
    let last;
    for (let i = 1; i <= 6 && !(last && last.r.status === 429); i++) last = await s.getJ("times", `staff=${W.ALISHER}&services=${encodeURIComponent("глиняная-маска")}&date=${dayN(i)}`);
    assert.equal(last.r.status, 429, JSON.stringify(last.j)); assert.equal(last.j.code, "rate"); assert.equal(cors(last.r), SITE);
    assert.ok(net.alt.length - before <= 3, net.alt.slice(before).join(" | "));
  } finally { Object.assign(G, keep); }
});

test("находка 4: «любой мастер» — назначенного заняли, пробуем свободного в это время барбера той же цены", async () => {
  const busy = [{ staff: W.AIDYN, day: 1, from: "15:00", to: "16:00" }, { staff: W.RUSLAN, day: 1, from: "15:00", to: "16:00" }, { staff: W.ALISHER, day: 1, from: "10:00", to: "14:00" }];
  resetAll(winchesterAlt({ busy }));
  const s = site({ SITE_BOOKING_WINCHESTER: "1" });
  const t = (await s.getJ("times", `staff=0&services=${encodeURIComponent("мужская-стрижка")}&date=${dayN(1)}`)).j;
  const slot = t.slots.find(x => x.time === "15:00");
  assert.equal(slot.staff, W.AIDOS, JSON.stringify(slot));
  net.altBusy = true; net.altRecords.push({ phone: "+77001112233", appointments: [{ staff_id: W.AIDOS, datetime: `${dayN(1)}T15:00:00+05:00`, services: [WS.CUT] }] });
  const b = await s.book({ staff: W.AIDOS, any: true, services: ["мужская-стрижка"], time: "15:00" });
  assert.equal(b.r.status, 200, JSON.stringify(b.j)); assert.equal(b.j.booking.staff.id, W.ALISHER); assert.equal(b.j.booking.total, 7000);
});

test("находка 4: «время заняли» у «любого мастера» — то же время у другого мастера тоже в вариантах", async () => {
  resetAll();
  const s = site();
  await s.getJ("times", `staff=0&services=${encodeURIComponent("мужская-стрижка")}&date=${dayN(1)}`);
  net.altCheckBusy = true; // book_check отказывает всем кандидатам
  const b = await s.book({ staff: W.AIDOS, any: true, services: ["мужская-стрижка"], time: "15:00" });
  net.altCheckBusy = false;
  assert.equal(b.j.code, "taken", JSON.stringify(b.j));
  assert.ok(b.j.slots.some(x => x.time === "15:00"), JSON.stringify(b.j.slots));
});

test("находка 5: отказ book_record (434, 432, почта) — заявка сохраняется и без Telegram, ответ «заявка у администратора», повтор не нужен", async () => {
  for (const [code, msg] of [[434, "Клиент в чёрном списке"], [432, "SMS code required"]]) {
    resetAll();
    const s = site({ SITE_BOOKING_WINCHESTER: "1", TG_TOKEN: "" });
    await withRecord(() => altErr(code, msg), async n => {
      const id = rid();
      const { r, j } = await s.book({ rid: id });
      assert.equal(j.code, "refused", JSON.stringify(j)); assert.equal(r.status, 502); assert.match(j.error, /администратор/); assert.ok(!/чёрн|черн|SMS/i.test(j.error));
      const lead = s.leads("winchester").at(-1);
      assert.ok(lead && /не прошла/.test(lead.note) && lead.phone === PHONE, JSON.stringify(lead));
      const again = await s.book({ rid: id });
      assert.deepEqual(again.j, j); assert.equal(n(), 1);
    });
  }
});

test("находка 6: тело больше 4 КБ в байтах (кириллица, без content-length; поток по частям) — 400 body", async () => {
  resetAll();
  const s = site();
  const big = await s.book({ pad: "я".repeat(2100) }); // 2 100 знаков, ≈ 4,3 КБ
  assert.equal(big.r.status, 400, JSON.stringify(big.j)); assert.equal(big.j.field, "body");
  const chunk = new TextEncoder().encode(" ".repeat(1024));
  let sent = 0;
  const stream = new ReadableStream({ pull(c) { if (sent++ < 64) c.enqueue(chunk); else c.close(); } });
  const r = await s.call(`/api/site/winchester/book`, { method: "POST", headers: { origin: SITE, "cf-connecting-ip": newIp(), "content-type": "application/json" }, body: stream, duplex: "half" });
  assert.equal(r.status, 400); assert.equal((await r.json()).field, "body");
  assert.ok(sent < 64, "тело дочитано целиком: " + sent);
  assert.deepEqual(net.alt, []);
});

test("находка 7: ловушка и поддельная метка отсекаются до чтения хранилища", async () => {
  resetAll();
  const s = site();
  const g0 = s.kv.ops.get;
  await s.book({ website: "http://spam.example" });
  await s.book({ ft: ftOf(10000, "winchester", "wrong-key-000") });
  await s.book({ ft: "123" });
  assert.equal(s.kv.ops.get, g0);
});

test("находка 8: запись с сайта бот в WhatsApp не присваивает — она чужая, отмена только через администратора", async () => {
  resetAll();
  const INST = { id: "7105000099", token: "ga-tok-site" };
  const s = site({ SITE_BOOKING_WINCHESTER: "1", GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token });
  const from = PHONE.slice(1);
  const b = await s.book({ staff: W.AIDOS, services: ["мужская-стрижка"], time: "15:00" });
  assert.equal(b.r.status, 200, JSON.stringify(b.j));
  // журнал не читается (нет ключа пользователя): клиент в WhatsApp просит то же время — бот находит заявку сайта
  net.ai = [`Вы записаны.\n[ЗАЯВКА] Имя: Азамат; Телефон: —; Услуга: Мужская стрижка; Мастер: Айдос; Дата: ${dayN(1)}; Время: 15:00`];
  await s.gaText("winchester", INST, from, "Азамат, стрижка к Айдосу завтра в 15:00");
  const books = (s.hist("ga", "winchester", from) || { profile: {} }).profile.bookings || [];
  assert.ok(books.every(x => !x.record_hash && x.leadId == null), JSON.stringify(books));
  assert.equal(net.altRecords.length, 1);
  net.ai = [`Отменила.\n[ОТМЕНА] Имя: Азамат; Дата: ${dayN(1)}; Время: 15:00`];
  await s.gaText("winchester", INST, from, "Отмените мою запись на завтра в 15:00");
  assert.ok(!net.alt.some(x => /^DELETE /.test(x)), net.alt.join(" | "));
});

test("находка 11: сервис записи с сайта не ходит в KV сам — только через db/kv", () => {
  const dir = new URL("../../src/services/sitebook/", import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.ok(!/\bKV\.(get|put|delete|list)\(/.test(src), f);
  }
});

test("находка 13: ответ не дольше срока формы — перед book_record проверяем время, поздно — «расписание не отвечает», запись не создаём", async () => {
  resetAll();
  const s = site({ SITE_BOOKING_WINCHESTER: "1" });
  const B = siteBase.BUDGET;
  assert.ok(B && B.record > 0, "нет срока ответа");
  const keep = { ...B };
  Object.assign(B, { record: 0, cands: 0 });
  try {
    const { r, j } = await s.book();
    assert.equal(r.status, 502, JSON.stringify(j)); assert.equal(j.code, "altegio");
    assert.equal(records().length, 0);
  } finally { Object.assign(B, keep); }
});

test("находка 8 формы: «Ближайший день» у пустого дня — день, где есть свободное время, а не просто рабочий", async () => {
  resetAll(winchesterAlt({ busy: [1, 2, 3, 4].map(d => ({ staff: W.ALISHER, day: d, from: "10:00", to: "21:00" })) }));
  const { j } = await site().getJ("times", `staff=${W.ALISHER}&services=${encodeURIComponent("глиняная-маска")}&date=${dayN(1)}`);
  assert.deepEqual(j.slots, []); assert.equal(j.next, dayN(5), JSON.stringify(j));
});
