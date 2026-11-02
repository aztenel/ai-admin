// Находки независимого ревью PR №2 (01.11.2026): каждая проверка сначала воспроизводила дефект на коде PR, потом — исправление.
// F1 — база без миграции 0005: пульт обещал отправку, а причина отказа звучала как «база не отвечает».
// F2 — gaInfo считал вебхук «нашим», если он вёл на другой Worker (черновик и боевой сайт — один токен, один пароль вебхука).
// F3 — ответ Green-API 499/408 (обрыв, срок) считался отказом: «Повторить» с тем же rid отправлял второй раз.
// F5 — «Отправить клиенту и закрыть»: сообщение ушло, запись в переписку упала — повтор отвечал «dup» и не закрывал заявку.
// F7 — база записала отметку, но ответ до Worker не дошёл: сотруднику — «не отправлено», а повтор — «уже отправляется» и «не знаем».
// Браузерная часть F4 (старый пульт /inbox и новый /app/: тот же номер отправки после обрыва связи) — apps/pult/scripts/e2e-send-rid.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { net, mk, gaPass } from "../harness.mjs";
import { sqliteOk, d1With, openD1, migrate, MIGRATIONS } from "../d1.mjs";
import { gaInfo, gaCode, gaKind, gaUnsure } from "../../src/services/integrations/greenapi/client.js";
import { jrRun } from "../../src/services/reminders/journal.js";
import { atLocal } from "../../src/services/reminders/plan.js";
import { SCENARIOS } from "../../src/services/reminders/templates.js";
import { gaRoute } from "../../src/services/integrations/greenapi/webhook.js";
import { autoOn, legacyOn } from "../automsg.mjs";
import { CLIENTS } from "../../src/config/builtin-clients.js";

const skip = sqliteOk ? false : "нужна D1 на node:sqlite (Node 22+)";
const INST = { id: "7105000077", token: "ga-tok-w" };
const GA_W = { GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
const sends = () => net.ga.filter(x => x.op === "sendMessage");
const uploads = () => net.ga.filter(x => x.op === "sendFileByUpload");
const login = async s => { const b = s.browser(); await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" }); return b; };
const sendText = (b, id, text, rid) => b.post("/api/inbox/send", { c: "winchester", ch: "ga", id, text, rid });
const sendFile = (b, id, rid) => {
  const fd = new FormData();
  fd.set("file", new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], { type: "image/png" }), "photo.png");
  fd.set("rid", rid);
  return b.go(`/api/inbox/send-file?c=winchester&ch=ga&id=${id}`, { method: "POST", body: fd });
};
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const wait = ms => new Promise(r => setTimeout(r, ms));
/** Сайт Winchester со своей D1 (отметка production) и чатом второго номера */
async function site(db, extra = {}) {
  net.reset();
  const s = mk({ ...GA_W, DB: db, ...extra }), b = await login(s), from = "77000000" + String(100 + Math.floor(Math.random() * 800));
  await s.gaText("winchester", INST, from, "Здравствуйте, можно на завтра?");
  return { s, b, from };
}
/** База с миграциями только до 0004 (как ai-admin-dev сейчас), отметка production */
function d1Upto4() {
  const dir = mkdtempSync(join(tmpdir(), "mig4-"));
  for (const f of readdirSync(MIGRATIONS).filter(f => f < "0005")) copyFileSync(new URL(f, MIGRATIONS), join(dir, f));
  const d = openD1();
  migrate(d.raw, pathToFileURL(dir + "/"));
  d.raw.prepare("insert into meta(k, v) values ('stage', 'production')").run();
  return d;
}

// ---------- F1 ----------
test("F1 база без миграции 0005: пульт заранее пишет, что отправка не настроена; отправка — 503 «не настроено», не «база не отвечает»", { skip }, async () => {
  const d = d1Upto4();
  const { b, from } = await site(d.db);
  const c = await (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${from}`)).json();
  assert.equal(c.canSend, false, "пульт не должен обещать отправку");
  assert.equal(c.canFiles, false);
  assert.match(String(c.sendOff || ""), /не настроен/i);
  assert.doesNotMatch(String(c.sendOff || ""), /не отвечает/i, "это ошибка настройки, а не сбой связи");
  const r = await sendText(b, from, "Ответ", "rid-F1-000001"), j = await r.json();
  assert.equal(r.status, 503);
  assert.equal(j.code, "nosetup");
  assert.equal(sends().length, 0);
});

// ---------- F2 ----------
const DENT = { id: "7105000088", token: "ga-tok-d" };
const hookAt = (origin, c = "dent", inst = DENT) => `${origin}/ga/${c}?t=${gaPass(c, inst)}`;

test("F2 gaInfo: вебхук на другом адресе (черновик) — не «наш»; свой адрес и путь — «наш»; без адреса текущего Worker — не подтверждён", async () => {
  net.reset();
  const env = { GA_ID_DENT: DENT.id, GA_TOKEN_DENT: DENT.token };
  const r = gaRoute(env, "dent");
  net.gaSettings[DENT.id] = { webhookUrl: hookAt("https://dev-ai-admin.azikonps4.workers.dev"), incomingWebhook: "yes" };
  let g = await gaInfo(env, r, "https://ai-admin.azikonps4.workers.dev");
  assert.equal(g.hook, false, "вебхук ведёт на черновик — боевой сайт его не получает");
  assert.equal(g.other, "dev-ai-admin.azikonps4.workers.dev", "пульт может назвать, куда ведёт вебхук");
  g = await gaInfo(env, r, "https://dev-ai-admin.azikonps4.workers.dev");
  assert.equal(g.hook, true, "на своём адресе — настроен");
  g = await gaInfo(env, r);
  assert.equal(g.hook, false, "адрес текущего Worker неизвестен — не подтверждаем");
  net.gaSettings[DENT.id] = { webhookUrl: `https://ai-admin.azikonps4.workers.dev/ga/winchester?t=${gaPass("dent", DENT)}`, incomingWebhook: "yes" };
  assert.equal((await gaInfo(env, r, "https://ai-admin.azikonps4.workers.dev")).hook, false, "чужой путь — не наш");
  delete net.gaSettings[DENT.id];
});

test("F2 /api/bc/list и «Проверка запуска»: вебхук на другом Worker — предупреждение, а не «настроен»", async () => {
  net.reset();
  const s = mk({ GA_ID_DENT: DENT.id, GA_TOKEN_DENT: DENT.token }), b = await login(s);
  net.gaSettings[DENT.id] = { webhookUrl: hookAt("https://dev-ai-admin.azikonps4.workers.dev"), incomingWebhook: "yes" };
  let d = await (await b.go("/api/bc/list?c=dent")).json();
  assert.equal(d.ga.hook, false); assert.ok(d.ga.warn, "предупреждение о вебхуке");
  const st = await (await b.go("/api/launch/status?c=dent")).json();
  const hk = (st.checks || []).find(x => /вебхук/i.test(x.title || ""));
  assert.ok(hk, JSON.stringify(st.checks));
  assert.notEqual(hk.ok, true, JSON.stringify(hk));
  assert.match(JSON.stringify(hk), /dev-ai-admin\.azikonps4\.workers\.dev/, "названо, куда ведёт вебхук");
  // контроль: вебхук на этот Worker (адрес проверок — https://bot.test)
  net.gaSettings[DENT.id] = { webhookUrl: hookAt("https://bot.test"), incomingWebhook: "yes" };
  d = await (await b.go("/api/bc/list?c=dent")).json();
  assert.equal(d.ga.hook, true); assert.equal(d.ga.warn, "");
  delete net.gaSettings[DENT.id];
});

// ---------- F3 ----------
for (const code of [499, 408]) {
  test(`F3 Green-API ответил ${code} на текст: «не знаем, ушло ли», повтор того же rid — без второй отправки`, { skip }, async () => {
    const { b, from } = await site(d1With("production").db);
    net.gaReply = rec => rec.op === "sendMessage" ? J({ message: "Client Closed Request" }, code) : null;
    const r1 = await sendText(b, from, "Да", `rid-F3-${code}-01`), j1 = await r1.json();
    assert.equal(r1.status, 200); assert.match(j1.warn || "", /Не знаем, ушло ли/);
    net.gaReply = null;
    const j2 = await (await sendText(b, from, "Да", `rid-F3-${code}-01`)).json();
    assert.equal(sends().length, 1, "неизвестный результат сам не повторяется");
    assert.match(j2.warn || "", /Не знаем, ушло ли/);
  });
}
test("F3 Green-API ответил 499 на файл: «не знаем», повтор — без второй загрузки; подтверждённый отказ 400 — «Повторить» можно (контроль)", { skip }, async () => {
  const { b, from } = await site(d1With("production").db);
  net.gaReply = rec => rec.op === "sendFileByUpload" ? J({ message: "Client Closed Request" }, 499) : null;
  const j1 = await (await sendFile(b, from, "rid-F3-file-01")).json();
  assert.match(j1.warn || "", /Не знаем, ушло ли/);
  net.gaReply = null;
  await sendFile(b, from, "rid-F3-file-01");
  assert.equal(uploads().length, 1);
  net.gaReply = rec => rec.op === "sendFileByUpload" ? J({ message: "Bad Request" }, 400) : null;
  assert.equal((await sendFile(b, from, "rid-F3-file-02")).status, 409);
  net.gaReply = null;
  assert.equal((await sendFile(b, from, "rid-F3-file-02")).status, 200);
  assert.equal(uploads().length, 3);
});

// ---------- F5 ----------
test("F5 «Отправить клиенту и закрыть»: сообщение ушло, переписка не записалась — повтор с тем же rid закрывает заявку и пишет историю без второго сообщения и без дублей", { skip }, async () => {
  const { s, b, from } = await site(d1With("production").db);
  await s.env.KV.put("leads:winchester", JSON.stringify([{ id: "L-F5", kind: "change", name: "Клиент", phone: "", service: "Стрижка", time: "завтра 15:00", at: new Date().toISOString() }]));
  const body = { c: "winchester", ch: "ga", id: from, act: "done", lead: "L-F5", text: "Перенесли на 16:00", rid: "dn-LF5-abc123" };
  await wait(1100);
  s.kv.fail.put = k => k.startsWith("h:ga:winchester:");
  const r1 = await b.post("/api/inbox/act", body);
  s.kv.fail.put = null;
  assert.notEqual(r1.status, 200, "первый запрос упал после отправки");
  assert.equal(sends().length, 1);
  await wait(1100);
  const r2 = await b.post("/api/inbox/act", body);
  assert.equal(r2.status, 200);
  let h = s.hist("ga", "winchester", from);
  const mine = t => t.by === "admin" && t.text === "Перенесли на 16:00";
  assert.equal(h.turns.filter(mine).length, 1, "сообщение сотрудника — в истории один раз");
  assert.ok(h.profile.adminDid, "бот знает, что администратор выполнил просьбу");
  assert.equal((s.leads("winchester").find(l => l.id === "L-F5") || {}).status, "выполнена");
  assert.equal(sends().length, 1, "Green-API второй раз не вызывался");
  // ещё повтор — ни второго сообщения в истории, ни второй записи в журнале действий чата
  await wait(1100);
  assert.equal((await b.post("/api/inbox/act", body)).status, 200);
  h = s.hist("ga", "winchester", from);
  assert.equal(h.turns.filter(mine).length, 1);
  assert.equal((h.profile.audit || []).filter(a => a.a === "done").length, 1, "закрытие заявки в журнале чата один раз");
  assert.equal(sends().length, 1);
});

test("F5 два одновременных «Отправить клиенту и закрыть» с одним rid: одно сообщение клиенту, одна реплика в истории", { skip }, async () => {
  const { s, b, from } = await site(d1With("production").db);
  await s.env.KV.put("leads:winchester", JSON.stringify([{ id: "L-F5b", kind: "change", name: "Клиент", phone: "", service: "Стрижка", time: "завтра 15:00", at: new Date().toISOString() }]));
  await wait(1100);
  const body = { c: "winchester", ch: "ga", id: from, act: "done", lead: "L-F5b", text: "Готово, ждём вас", rid: "dn-LF5b-xyz1" };
  await Promise.all([b.post("/api/inbox/act", body), b.post("/api/inbox/act", body)]);
  const h = s.hist("ga", "winchester", from);
  assert.equal(sends().length, 1);
  assert.ok(h.turns.filter(t => t.by === "admin" && t.text === "Готово, ждём вас").length <= 1);
});

// ---------- F7 ----------
/** D1 записывает отметку, но ответ до Worker не доходит (один раз) */
function lostReply(d) {
  const real = d.db.batch;
  d.db.batch = async list => { const out = await real(list); if (list.some(x => /insert into send_claims/.test(x.sql))) { d.db.batch = real; throw new Error("D1_ERROR: Network connection lost."); } return out; };
}
test("F7 отметка записалась, ответ потерян, базу удалось поправить: «не ушло, повторите» — и повтор с тем же rid отправляет", { skip }, async () => {
  const d = d1With("production");
  const { b, from } = await site(d.db);
  lostReply(d);
  const r1 = await sendText(b, from, "Да", "rid-F7-000001"), j1 = await r1.json();
  assert.equal(r1.status, 503); assert.equal(j1.code, "nodb");
  assert.equal(sends().length, 0);
  const r2 = await sendText(b, from, "Да", "rid-F7-000001");
  assert.equal(r2.status, 200, "попытка освобождена: повтор отправляет, а не «уже отправляется»");
  assert.equal(sends().length, 1);
});

test("F7 отметка могла записаться, а база так и не ответила: сотрудник видит «результат неизвестен», а не «не отправлено»", { skip }, async () => {
  const d = d1With("production");
  const { b, from } = await site(d.db);
  lostReply(d);
  d.ctl.fail = sql => /^\s*update\s+send_claims/i.test(sql); // освободить попытку тоже не вышло
  const r1 = await sendText(b, from, "Да", "rid-F7-000002"), j1 = await r1.json();
  d.ctl.fail = null;
  assert.equal(r1.status, 503);
  assert.equal(j1.code, "claim_unknown");
  assert.match(j1.error, /неизвест/i);
  assert.doesNotMatch(j1.error, /не отправлено/i);
  assert.equal(sends().length, 0);
});

// F3 на уровне клиента Green-API (добавлена после исправления: классификацию разделяют рассылки и напоминания по журналу).
// Раньше 408 значил «стоп»: напоминание возвращалось в очередь и через 6 часов уходило ещё раз, а клиент мог его уже получить.
// 5xx — тоже «неизвестно» везде: в пульте, напоминаниях по журналу и рассылках (01.11.2026; раньше напоминания и рассылки на 5xx
// пробовали ещё раз — подробно в test/unit/ga-5xx.test.mjs)
test("F3 Green-API: 408, 499, 5xx, нет ответа — «неизвестно, второй раз не шлём» везде; 400, 401, 403, 429 — подтверждённый отказ", () => {
  for (const status of [0, 408, 499, 500, 502]) {
    assert.equal(gaKind(gaCode({ status })), "net", "код " + status);
    assert.equal(gaUnsure({ ok: false, status }), true, "код " + status);
  }
  for (const status of [400, 401, 403, 429, 466]) assert.equal(gaUnsure({ ok: false, status }), false, "код " + status);
  assert.equal(gaUnsure({ ok: false, status: 0, preview: true }), false, "черновик ничего не отправлял");
});

test("F3 напоминание по журналу: Green-API ответил 408 — второй раз не шлём, номер не ставим на паузу, в переписке «неизвестно»", async () => {
  net.reset();
  const W = { ALTEGIO_PARTNER: "partner-test", ALTEGIO_USER_WINCHESTER: "usr-tok", REMIND_GA_WINCHESTER: "1", ...GA_W };
  net.altJournal = [{ id: 9408, datetime: "2026-10-20T15:00:00+05:00", deleted: false, attendance: 0, create_date: "2026-10-18T12:00:00+05:00",
    staff: { id: 1, name: "Тони" }, client: { id: 1, phone: "+77000009408", name: "Клиент" }, services: [{ id: 1, title: "Мужская стрижка" }] }];
  const s = mk(W);
  await s.kv.api.put("svtpl:winchester", JSON.stringify(Object.fromEntries(SCENARIOS.filter(x => x.auto).map(x => [x.id, { v: x.v, at: 1 }]))));
  await autoOn(s, legacyOn(CLIENTS.winchester)); // сценарии включены в разделе «Автоматические сообщения» (по умолчанию выключены)
  await jrRun(s.env, atLocal("2026-10-19", "17:00"));
  net.gaReply = r => r.op === "sendMessage" ? new Response(JSON.stringify({ message: "Request Timeout" }), { status: 408 }) : null;
  await jrRun(s.env, atLocal("2026-10-19", "18:00"));
  net.gaReply = null;
  for (const t of ["18:01", "18:30", "20:00"]) await jrRun(s.env, atLocal("2026-10-19", t));
  assert.equal(sends().length, 1, "напоминание «накануне» — одна попытка");
  assert.equal(await s.kv.api.get("jrhold:winchester"), null, "номер не на паузе: 408 — не отказ номера");
  const h = s.hist("ga", "winchester", "77000009408");
  assert.ok(h && h.turns.some(t => t.st === "unknown"), JSON.stringify(h && h.turns));
});

