// Независимые проверки трёх P0 из аудита перед сдачей Winchester (31.10.2026). Отчёт Codex и его 27 проверок в репозиторий не
// попали — здесь те же дефекты воспроизведены заново, по описанию: (A) двойная отправка со второго номера (Green-API) при
// одновременных запросах, в одном и двух экземплярах Worker; (B) черновик (STAGE=preview) не должен писать клиентам, менять
// вебхук Green-API и записи Altegio; (C) общий инстанс Green-API — только компании, за которой он закреплён.
// Каждая проверка описывает правильное поведение и до исправления падала. Всё на заглушках: внешние сервисы подменены.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { net, mk, mkKV, gaPass } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";
import { sendGreen } from "../../src/services/channels/greenapi.js";
import { sendWA } from "../../src/services/channels/meta.js";
import { sendTemplate } from "../../src/services/integrations/meta/templates.js";
import { gaRoute } from "../../src/services/integrations/greenapi/webhook.js";
import { gaCall } from "../../src/services/integrations/greenapi/client.js";
import { altCall } from "../../src/services/integrations/altegio/client.js";
import { altDry } from "../../src/services/booking/book.js";
import { siteConf } from "../../src/services/sitebook/config.js";
import { CLIENTS } from "../../src/config/builtin-clients.js";

const skip = sqliteOk ? false : "нужна D1 на node:sqlite (Node 22+)";
const INST = { id: "7105000077", token: "ga-tok-w" };
const GA_W = { GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
const META_W = { WA_TOKEN_WINCHESTER: "tok-w", APP_SECRET_WINCHESTER: "sec-w", PHONE_NUMBER_ID_WINCHESTER: "900333" };
const sends = () => net.ga.filter(x => x.op === "sendMessage");
const uploads = () => net.ga.filter(x => x.op === "sendFileByUpload");
const login = async s => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" }); return b; };
const sendText = (b, id, text, rid, extra = {}) => b.post("/api/inbox/send", { c: "winchester", ch: "ga", id, text, ...(rid ? { rid } : {}), ...extra });
const sendFile = (b, id, rid) => {
  const fd = new FormData();
  fd.set("file", new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], { type: "image/png" }), "photo.png");
  if (rid) fd.set("rid", rid);
  return b.go(`/api/inbox/send-file?c=winchester&ch=ga&id=${id}`, { method: "POST", body: fd });
};
// Настоящий KV отвечает за 10–50 мс, а запись видна в других местах сети не сразу. Заглушка отвечает мгновенно — без задержки
// одновременные запросы не перекрываются, и дефект не виден. Задержка — только у отметок отправки (snd:).
const LAG = 20;
const lag = () => new Promise(r => setTimeout(r, LAG));
/** KV с задержкой чтения отметок отправки (как настоящий) */
function slowKV(shared) {
  return { ...shared, get: async (k, ...x) => { if (k.startsWith("snd:")) await lag(); return shared.get(k, ...x); } };
}
/** KV второго экземпляра Worker: переписка общая, а отметки отправки (snd:) он ещё не видит — KV согласован не сразу */
function staleKV(shared) {
  const own = mkKV();
  return { ...shared, get: async k => { if (k.startsWith("snd:")) { await lag(); return own.api.get(k); } return shared.get(k); }, put: (k, v, o) => (k.startsWith("snd:") ? own.api.put(k, v, o) : shared.put(k, v, o)), delete: k => (k.startsWith("snd:") ? own.api.delete(k) : shared.delete(k)) };
}
/** Другой экземпляр Worker — другая память: всё, что send.js держит в памяти процесса, забыто */
const isolate = async () => { const m = await import("../../src/services/inbox/send.js"); if (typeof m.sendOnceReset === "function") m.sendOnceReset(); };
/** Два экземпляра Worker Winchester с общей D1 и общей перепиской. */
async function twoWorkers(extra = {}) {
  net.reset(); await isolate();
  const d = sqliteOk ? d1With("production") : null;
  const a = mk({ ...GA_W, ...(d ? { DB: d.db } : {}), ...extra });
  a.env.KV = slowKV(a.kv.api);
  const bEnv = mk({ ...GA_W, ...(d ? { DB: d.db } : {}), ...extra, KV: staleKV(a.kv.api) });
  const from = "770000009" + String(Math.floor(Math.random() * 90) + 10);
  await a.gaText("winchester", INST, from, "Здравствуйте, можно на завтра?");
  return { a, bEnv, d, from, ba: await login(a), bb: await login(bEnv) };
}

// ===================== A. Двойная отправка (P0-1) =====================

test("A1 два экземпляра Worker, одно нажатие (тот же rid) одновременно: Green-API получает одно сообщение", { skip }, async () => {
  const { ba, bb, from } = await twoWorkers();
  const [r1, r2] = await Promise.all([sendText(ba, from, "Да, на 15:00", "rid-A1-0001"), sendText(bb, from, "Да, на 15:00", "rid-A1-0001")]);
  assert.equal(sends().length, 1, "клиенту ушло " + sends().length);
  assert.ok([r1.status, r2.status].includes(200));
});

test("A2 один экземпляр, двойное нажатие одновременно (тот же rid): одно сообщение", { skip }, async () => {
  const { ba, from } = await twoWorkers();
  await Promise.all([sendText(ba, from, "Да", "rid-A2-0001"), sendText(ba, from, "Да", "rid-A2-0001"), sendText(ba, from, "Да", "rid-A2-0001")]);
  assert.equal(sends().length, 1);
});

test("A3 файл: два экземпляра, тот же rid одновременно — одна загрузка в Green-API", { skip }, async () => {
  const { ba, bb, from } = await twoWorkers();
  await Promise.all([sendFile(ba, from, "rid-A3-0001"), sendFile(bb, from, "rid-A3-0001")]);
  assert.equal(uploads().length, 1);
});

test("A4 KV не принимает отметку (сбой) и экземпляр перезапущен: повтор того же rid не отправляет второй раз", { skip }, async () => {
  const { a, bb, from, ba } = await twoWorkers();
  a.kv.fail.put = k => k.startsWith("snd:");
  assert.equal((await sendText(ba, from, "Ок", "rid-A4-0001")).status, 200);
  await isolate();
  const r = await sendText(bb, from, "Ок", "rid-A4-0001");
  assert.equal(sends().length, 1, "второй экземпляр отправил повторно");
  assert.ok(r.status === 200 || r.status === 409);
});

test("A5 второй номер без rid: отказ до обращения к Green-API, причина понятна", { skip }, async () => {
  const { ba, from } = await twoWorkers();
  const r = await sendText(ba, from, "Без номера отправки");
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "rid");
  assert.equal(sends().length, 0);
});

test("A6 нет базы D1 у адреса: отправка со второго номера отклоняется до Green-API (503, понятная причина)", async () => {
  net.reset();
  const s = mk({ ...GA_W }), b = await login(s), from = "77000000961";
  await s.gaText("winchester", INST, from, "Здравствуйте");
  const r = await sendText(b, from, "Ответ", "rid-A6-0001");
  assert.equal(r.status, 503);
  const j = await r.json();
  assert.equal(j.code, "nodb"); assert.match(j.error, /не отправлено/i);
  assert.equal(sends().length, 0);
  const c = await (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${from}`)).json();
  assert.equal(c.canSend, false, "пульт знает заранее, что отправить нельзя");
  assert.match(String(c.sendOff || ""), /баз/i);
});

test("A7 D1 есть, но не отвечает: отказ до Green-API (503), а не отправка «на удачу»", { skip }, async () => {
  const { d, ba, from } = await twoWorkers();
  d.ctl.fail = sql => /send_claims/.test(sql);
  const r = await sendText(ba, from, "Ответ", "rid-A7-0001");
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, "nodb");
  assert.equal(sends().length, 0);
});

test("A8 Green-API принял, но связь оборвалась до ответа: «не знаем», и повтор того же rid в другом экземпляре не отправляет", { skip }, async () => {
  const { ba, bb, from } = await twoWorkers();
  net.gaReply = rec => { if (rec.op === "sendMessage") throw new Error("socket hang up"); return null; };
  const j1 = await (await sendText(ba, from, "Да", "rid-A8-0001")).json();
  assert.equal(j1.ok, true); assert.match(j1.warn || "", /Не знаем, ушло ли/);
  net.gaReply = null; await isolate();
  const j2 = await (await sendText(bb, from, "Да", "rid-A8-0001")).json();
  assert.equal(sends().length, 1, "повтор ушёл клиенту");
  assert.match(j2.warn || "", /Не знаем, ушло ли/);
});

test("A9 Green-API ответил 500: «не знаем», повтор того же rid — без второй отправки", { skip }, async () => {
  const { ba, from } = await twoWorkers();
  net.gaReply = rec => rec.op === "sendMessage" ? new Response("{}", { status: 500 }) : null;
  await sendText(ba, from, "Да", "rid-A9-0001");
  net.gaReply = null; await isolate();
  await sendText(ba, from, "Да", "rid-A9-0001");
  assert.equal(sends().length, 1);
});

test("A10 отправка ушла, а отметку итога записать не удалось: повтор того же rid не отправляет", { skip }, async () => {
  const { d, ba, bb, from } = await twoWorkers();
  d.ctl.fail = sql => /^\s*update\s+send_claims/i.test(sql);
  await sendText(ba, from, "Да", "rid-A10-001");
  d.ctl.fail = null; await isolate();
  const r = await sendText(bb, from, "Да", "rid-A10-001");
  assert.equal(sends().length, 1);
  assert.notEqual(r.status, 500, "сбой, а не понятный ответ");
});

test("A11 Green-API отказал (400, ничего не ушло): «Повторить» с тем же rid отправляет снова", { skip }, async () => {
  const { ba, from } = await twoWorkers();
  net.gaReply = rec => rec.op === "sendMessage" ? new Response(JSON.stringify({ message: "Instance account is expired" }), { status: 400 }) : null;
  assert.equal((await sendText(ba, from, "Да", "rid-A11-001")).status, 409);
  net.gaReply = null;
  assert.equal((await sendText(ba, from, "Да", "rid-A11-001")).status, 200);
  assert.equal(sends().length, 2);
});

test("A12 разные rid — разные сообщения; тот же rid в другом чате — своё сообщение", { skip }, async () => {
  const { a, ba, from } = await twoWorkers();
  const other = "77000000999";
  await a.gaText("winchester", INST, other, "Привет");
  await sendText(ba, from, "Раз", "rid-A12-001");
  await sendText(ba, from, "Два", "rid-A12-002");
  await sendText(ba, other, "Раз", "rid-A12-001");
  assert.equal(sends().length, 3);
});

const doneLead = async (a, from, id) => a.kv.api.put("leads:winchester", JSON.stringify([{ id, kind: "change", name: "Клиент", phone: "", service: "Стрижка", time: "завтра 15:00", at: new Date().toISOString() }]));
const done = (b, from, lead, text, rid) => b.post("/api/inbox/act", { c: "winchester", ch: "ga", id: from, act: "done", lead, text, ...(rid ? { rid } : {}) });

test("A13 «Отправить клиенту и закрыть» — двойное нажатие в двух экземплярах: одно сообщение", { skip }, async () => {
  const { a, ba, bb, from } = await twoWorkers();
  await doneLead(a, from, "L-A13");
  await Promise.all([done(ba, from, "L-A13", "Перенесли на 16:00, ждём вас", "dn-LA13-xyz1"), done(bb, from, "L-A13", "Перенесли на 16:00, ждём вас", "dn-LA13-xyz1")]);
  assert.equal(sends().length, 1, "клиенту ушло " + sends().length);
});

test("A14 «Отправить клиенту и закрыть» со второго номера без rid — отказ до Green-API", { skip }, async () => {
  const { a, ba, from } = await twoWorkers();
  await doneLead(a, from, "L-A14");
  const r = await done(ba, from, "L-A14", "Готово");
  assert.equal(r.status, 400); assert.equal((await r.json()).code, "rid");
  assert.equal(sends().length, 0);
});

// ===================== B. Черновик изолирован (P0-2) =====================

/** Черновик Winchester: свой номер Green-API и Meta, D1 черновика */
async function preview(extra = {}) {
  net.reset();
  const d = sqliteOk ? d1With("preview") : null;
  const s = mk({ STAGE: "preview", ...GA_W, ...META_W, ...(d ? { DB: d.db } : {}), ...extra }), b = await login(s), from = "77000000971";
  await s.gaText("winchester", INST, from, "Здравствуйте");
  return { s, b, from, d };
}
const noOut = () => { assert.equal(net.ga.filter(x => !/^(getStateInstance|getSettings|downloadFile|lastIncomingMessages|lastOutgoingMessages)$/.test(x.op)).length, 0, "ушло в Green-API: " + net.ga.map(x => x.op)); assert.equal(net.graph.filter(g => g.body).length, 0, "ушло в Meta"); assert.equal(net.wz.filter(x => x.method !== "GET").length, 0, "ушло в Wazzapo"); };

test("B1 черновик: ответ из пульта со второго номера — 409 «тестовая версия», в Green-API ничего", async () => {
  const { b, from } = await preview();
  const r = await sendText(b, from, "Ответ", "rid-B1-0001");
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, "preview");
  noOut();
});

test("B2 черновик: файл из пульта — 409, загрузки нет", async () => {
  const { b, from } = await preview();
  const r = await sendFile(b, from, "rid-B2-0001");
  assert.equal(r.status, 409); assert.equal((await r.json()).code, "preview");
  noOut();
});

test("B3 черновик: ответ с основного номера (Meta) — 409, в Meta ничего", async () => {
  const { s, b } = await preview();
  const from = "77000000972";
  await s.kv.api.put(`h:wa:winchester:${from}`, JSON.stringify({ n: 1, turns: [{ role: "user", text: "Здравствуйте", t: Date.now() }], profile: { li: Date.now(), pn: "900333" } }));
  net.graph.length = 0;
  const r = await b.post("/api/inbox/send", { c: "winchester", ch: "wa", id: from, text: "Ответ", rid: "rid-B3-0001" });
  assert.equal(r.status, 409); assert.equal((await r.json()).code, "preview");
  noOut();
});

test("B4 черновик: в переписке пульт заранее знает, что отправка выключена (canSend, canFiles — нет, причина есть)", async () => {
  const { b, from } = await preview();
  const c = await (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${from}`)).json();
  assert.equal(c.canSend, false); assert.equal(c.canFiles, false);
  assert.match(String(c.sendOff || ""), /тестов/i);
});

test("B5 черновик: «Настроить Green-API» не меняет вебхук настоящего номера (409, setSettings не вызывается)", async () => {
  const { b } = await preview();
  const r = await b.post("/api/launch/ga", { c: "winchester" });
  assert.equal(r.status, 409); assert.equal((await r.json()).code, "preview");
  assert.equal(net.ga.filter(x => x.op === "setSettings").length, 0);
});

test("B6 черновик: пробная рассылка на свой номер не уходит (409), даже с основного номера", async () => {
  const { b } = await preview();
  const r = await b.post("/api/bc/test", { c: "winchester", name: "Проба", tpl: "promo_october", lang: "ru", text: "Здравствуйте, {{1}}! Чтобы не получать сообщения, ответьте СТОП", params: "{имя}", to: "+7 701 123 45 67" });
  assert.equal(r.status, 409); assert.equal((await r.json()).code, "preview");
  noOut();
});

test("B7 черновик: BC_DEV_REAL больше не открывает запуск рассылки", async () => {
  net.reset();
  const META = { WA_TOKEN_BARBER: "tok-barber", APP_SECRET_BARBER: "sec-barber", PHONE_NUMBER_ID_BARBER: "900222" };
  const s = mk({ STAGE: "preview", BC_DEV_REAL: "1", ...META }), own = await login(s);
  const c = await (await own.post("/api/bc/create", { c: "barber", name: "Октябрь", tpl: "promo_october", lang: "ru", text: "Здравствуйте, {{1}}! Чтобы не получать сообщения, ответьте СТОП", params: "{имя}", recipients: "+7 701 111 00 01, Арман", cap: 100, from: 10, to: 20, consent: true })).json();
  assert.equal(c.ok, true, JSON.stringify(c));
  const r = await own.post("/api/bc/act", { c: "barber", id: c.b.id, act: "start" });
  assert.equal(r.status, 409);
});

test("B8 черновик: фоновая задача выходит до любых внешних действий и чтения хранилища", async () => {
  const { s } = await preview();
  net.reset();
  const before = { ...s.kv.ops };
  await s.cron(Date.now());
  assert.deepEqual(s.kv.ops, before, "фоновая задача черновика читала или писала KV");
  noOut();
  assert.equal(net.alt.length, 0, "фоновая задача черновика ходила в Altegio");
});

test("B9 черновик: бот второго номера не отвечает клиенту наружу (вход принимается, Green-API sendMessage — нет)", async () => {
  net.reset();
  const inst = { id: "7105000001", token: "ga-tok-barber" };
  const s = mk({ STAGE: "preview", GA_ID_BARBER: inst.id, GA_TOKEN_BARBER: inst.token, BOT_GA_BARBER: "1" });
  net.ai = ["Здравствуйте! Стрижка стоит 6 000 ₸."];
  const r = await s.gaText("barber", inst, "77000000973", "Сколько стоит стрижка?");
  assert.equal(r.status, 200);
  assert.ok(s.hist("ga", "barber", "77000000973"), "переписка сохранена");
  noOut();
});

test("B10 черновик: прямой вызов отправки (Green-API, Meta, шаблон) отклоняется на нижнем уровне", async () => {
  net.reset();
  const env = { STAGE: "preview", ...GA_W, ...META_W, KV: mkKV().api };
  const g = await sendGreen(env, "77000000974@c.us", "Привет", gaRoute(env, "winchester"), true);
  assert.equal(g.ok, false); assert.equal(g.code, "ga:preview");
  const x = await gaCall(gaRoute(env, "winchester"), "setSettings", { webhookUrl: "https://evil.test/ga" });
  assert.equal(x.ok, false);
  const w = await sendWA(env, "77000000974", "Привет", { client: "winchester", pnid: "900333", quiet: true });
  assert.equal(w.ok, false); assert.equal(w.code, "preview");
  const t = await sendTemplate(env, "77000000974", { tpl: "promo", lang: "ru", params: [] }, "", { client: "winchester", pnid: "900333" });
  assert.equal(t.ok, false);
  noOut();
});

test("B11 черновик: запись в Altegio не создаётся и не удаляется даже прямым вызовом; проверка времени (book_check) работает", async () => {
  net.reset();
  const env = { STAGE: "preview", ALTEGIO_PARTNER: "p", KV: mkKV().api };
  await assert.rejects(altCall(env, "POST", "/book_record/133486", { phone: "77000000975" }), e => e.code === "preview" || /тестов/i.test(e.message));
  await assert.rejects(altCall(env, "DELETE", "/user/records/1/abc"), e => e.code === "preview" || /тестов/i.test(e.message));
  assert.equal(net.alt.filter(x => /book_record|DELETE/.test(x)).length, 0, net.alt.join());
  await altCall(env, "POST", "/book_check/133486", { appointments: [] }).catch(() => {});
  assert.ok(net.alt.some(x => /book_check/.test(x)), "проверка времени не запрещена");
});

test("B13 черновик: «Отправить клиенту и закрыть» — 409, сообщения нет", async () => {
  const { s, b, from } = await preview();
  await doneLead(s, from, "L-B13");
  const r = await done(b, from, "L-B13", "Перенесли", "dn-LB13-xyz1");
  assert.equal(r.status, 409); assert.equal((await r.json()).code, "preview");
  noOut();
});

test("B12 черновик: бот Winchester — всегда «проверка без записи», запись с сайта — всегда без записи", () => {
  const c = CLIENTS.winchester;
  assert.equal(altDry({ STAGE: "preview", ALTEGIO_DRY_WINCHESTER: "0" }, c), true);
  assert.equal(altDry({ ALTEGIO_DRY_WINCHESTER: "0" }, c), false, "боевой сайт — как настроено");
  const sc = siteConf({ STAGE: "preview", SITE_BOOKING_WINCHESTER: "1", ALTEGIO_PARTNER: "p", ALTEGIO_LOC_WINCHESTER: "133486", LEADS_KEY: "k" }, c);
  assert.ok(sc && sc.mode !== "live", "на черновике запись с сайта не пишет в Altegio: " + (sc && sc.mode));
});

// ===================== C. Чужой общий инстанс Green-API (P0-3) =====================

const SHARED_BARBER = { GA_ID: "7105009999", GA_TOKEN: "ga-tok-shared", GA_CLIENT: "barber" };
async function sharedForeign() {
  net.reset();
  const d = sqliteOk ? d1With("production") : null;
  const s = mk({ ...SHARED_BARBER, ...(d ? { DB: d.db } : {}) }), b = await login(s), from = "77000000981";
  await s.kv.api.put(`h:ga:winchester:${from}`, JSON.stringify({ n: 1, turns: [{ role: "user", text: "Привет", t: Date.now(), mid: "IN-C1", m: { k: "image", id: "IN-C1" } }], profile: {} }));
  return { s, b, from };
}

test("C1 общий инстанс закреплён за другой компанией: ответ Winchester через него не уходит", async () => {
  const { b, from } = await sharedForeign();
  const r = await sendText(b, from, "Ответ", "rid-C1-0001");
  assert.notEqual(r.status, 200);
  assert.equal(sends().length, 0, "сообщение ушло с номера чужой компании");
});

test("C2 то же для файла", async () => {
  const { b, from } = await sharedForeign();
  const r = await sendFile(b, from, "rid-C2-0001");
  assert.notEqual(r.status, 200);
  assert.equal(uploads().length, 0);
});

test("C3 то же для скачивания файла: downloadFile чужого инстанса не вызывается", async () => {
  const { b, from } = await sharedForeign();
  await b.go(`/api/inbox/media?c=winchester&ch=ga&id=${from}&mid=IN-C1`);
  assert.equal(net.ga.filter(x => x.op === "downloadFile").length, 0);
});

test("C4 в переписке пульт не предлагает отправку через чужой инстанс", async () => {
  const { b, from } = await sharedForeign();
  const c = await (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${from}`)).json();
  assert.equal(c.canSend, false); assert.equal(c.canFiles, false);
});

test("C5 sendGreen без номера клиента не подставляет общий инстанс", async () => {
  net.reset();
  const r = await sendGreen({ ...SHARED_BARBER, KV: mkKV().api }, "77000000982@c.us", "Привет", undefined, true);
  assert.equal(r.ok, false); assert.equal(sends().length, 0);
});

test("C6 общий инстанс, закреплённый за этой же компанией, работает (контроль)", { skip }, async () => {
  net.reset();
  const d = d1With("production");
  const s = mk({ GA_ID: "7105009999", GA_TOKEN: "ga-tok-shared", GA_CLIENT: "winchester", DB: d.db }), b = await login(s), from = "77000000983";
  await s.kv.api.put(`h:ga:winchester:${from}`, JSON.stringify({ n: 1, turns: [{ role: "user", text: "Привет", t: Date.now() }], profile: {} }));
  const r = await sendText(b, from, "Ответ", "rid-C6-0001");
  assert.equal(r.status, 200, await r.text());
  assert.equal(sends().length, 1); assert.equal(sends()[0].inst, "7105009999");
});

test("C7 в коде отправки нет запасного «|| gaShared(env)»: тексты, файлы, скачивание, напоминания, пульт", () => {
  for (const f of ["src/controllers/inbox.js", "src/services/inbox/send.js", "src/services/inbox/media.js", "src/services/reminders/send.js", "src/services/channels/greenapi.js"]) {
    const src = readFileSync(new URL("../../" + f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\|\|\s*gaShared\(env\)/, f);
  }
});
