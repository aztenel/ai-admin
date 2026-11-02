// Тестовый стенд ai-admin-test (docs/runbooks/winchester-go-live.md §6, решение владельца 01.11.2026): живая проверка второго номера
// Winchester на запасном номере владельца. Здесь — чего стенд не может сделать случайно: написать кому-то, кроме того, кто сам
// написал на тестовый номер; обратиться к Altegio, Telegram, ИИ или Meta; поменять вебхук чужого инстанса; отправить рассылку или
// напоминание; ответить ботом. Worker запускается ровно с тем, что владелец задаст на стенде: Green-API тестового инстанса, свой ключ
// входа, KV и D1 стенда; ключи, которые заглушки ставят по умолчанию (ИИ, Telegram, Meta), стираются. Номера вымышленные.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { net, mk } from "../harness.mjs";
import { sqliteOk, d1With } from "../d1.mjs";

const skip = sqliteOk ? false : "нужна D1 на node:sqlite (Node 22+)";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIR = resolve(ROOT, "deploy/test-stand");
// JSONC: комментарии // вне строк (как в d1-schema.test.mjs)
const jsonc = f => JSON.parse(readFileSync(resolve(ROOT, f), "utf8").replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*/g, (m, s) => s || ""));
const PROD_D1 = "ea1610ed-d342-41ca-8170-40ffe81feb41"; // боевая D1 ai-admin — подключается правкой docs/runbooks/winchester-go-live-d1.patch
const INST = { id: "7105000077", token: "ga-tok-stand" };
const B = "77000007701"; // номер Б — «клиент», пишет на тестовый номер А
/** ровно то, что владелец задаст на стенде (go-live §6), и переменные из настроек стенда (переписки Winchester в D1);
 *  undefined стирает ключи, которые mk() ставит по умолчанию */
const standEnv = db => ({ GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token, GA_URL_WINCHESTER: "https://7105.api.greenapi.com", DB: db,
  ...jsonc("deploy/test-stand/wrangler.jsonc").vars,
  GEMINI_KEY: undefined, MODEL: undefined, TG_TOKEN: undefined, TG_CHAT: undefined, VERIFY_TOKEN: undefined });
const gaOps = op => net.ga.filter(x => x.op === op);
const sends = () => gaOps("sendMessage").concat(gaOps("sendFileByUpload"));
/** наружу — только Green-API тестового инстанса */
const outside = () => ({ tg: net.tg.length, ai: net.gemini.length, altegio: net.alt.length, meta: net.graph.length, wazzapo: net.wz.length, other: net.other.length,
  otherInstances: net.ga.filter(x => String(x.inst) !== INST.id).length });
const QUIET = { tg: 0, ai: 0, altegio: 0, meta: 0, wazzapo: 0, other: 0, otherInstances: 0 };

async function stand() {
  net.reset();
  const d = d1With("production"), s = mk(standEnv(d.db)), b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fapp%2F" });
  return { s, b, d };
}

test("настройки стенда: свой Worker, тот же код, свои KV и D1, без cron и черновиков; из переменных — только переписки в D1", () => {
  const st = jsonc("deploy/test-stand/wrangler.jsonc"), w = jsonc("wrangler.jsonc");
  assert.equal(st.name, "ai-admin-test", "имя Worker в панели Cloudflare должно быть ровно таким");
  assert.equal(resolve(DIR, st.main), resolve(ROOT, w.main), "тот же worker.js, что у боевого сайта");
  assert.ok(existsSync(resolve(DIR, st.main)));
  assert.equal(st.compatibility_date, w.compatibility_date, "та же версия среды Cloudflare");
  assert.equal(st.keep_vars, true, "выкладка не стирает переменные, заданные в панели");
  assert.equal(st.workers_dev, true);
  assert.deepEqual(st.triggers, { crons: [] }, "без фоновой задачи: ни напоминаний, ни рассылок, ни синхронизации");
  for (const k of ["previews", "routes", "route", "env", "services", "queues", "r2_buckets", "durable_objects", "assets"]) assert.ok(!(k in st), "в настройках стенда нет " + k);
  // переписки Winchester на стенде — в D1 (01.11.2026, после замера «до» владельца); ключи и токены — только в панели Cloudflare
  assert.deepEqual(st.vars, { CHAT_STORE_WINCHESTER: "d1" }, "в настройках стенда — только хранилище переписок Winchester");
  assert.deepEqual(st.kv_namespaces.map(x => x.binding), ["KV"]);
  assert.deepEqual(st.d1_databases.map(x => x.binding), ["DB"]);
  const used = [...w.kv_namespaces, ...w.previews.kv_namespaces].map(x => x.id).concat(w.previews.d1_databases.map(x => x.database_id), PROD_D1);
  assert.ok(!used.includes(st.kv_namespaces[0].id), "KV стенда — не боевое и не черновиков");
  assert.ok(!used.includes(st.d1_databases[0].database_id), "D1 стенда — не боевая и не черновиков");
  // KV и D1 стенда созданы 01.11.2026 (до того в id стояли нули — выкладка не прошла бы): KV — 32 знака, D1 — UUID
  assert.match(st.kv_namespaces[0].id, /^(?!0+$)[0-9a-f]{32}$/);
  assert.match(st.d1_databases[0].database_id, /^(?!0{8}-)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(!["ai-admin", "ai-admin-dev"].includes(st.d1_databases[0].database_name));
  assert.equal(resolve(DIR, st.d1_databases[0].migrations_dir), resolve(ROOT, "migrations"), "те же миграции 0001–0006");
});

test("входящее с номера Б — чат второго номера в пульте, бот молчит; ответ уходит один раз и только Б", { skip }, async () => {
  const { s, b, d } = await stand();
  await s.gaText("winchester", INST, B, "Здравствуйте, сколько стоит стрижка?", { idMessage: "IN-ST-1" });
  assert.equal(sends().length, 0, "бот на втором номере не отвечает");
  assert.equal(d.raw.prepare("select count(*) n from chat_messages where ws = 'winchester' and ch = 'ga' and chat = ?").get(B).n, 1, "переписка стенда — в D1");
  const list = await (await b.go("/api/inbox/list?c=winchester&v=2")).json();
  assert.ok((list.chats || []).some(x => x.ch === "ga" && x.id === B), JSON.stringify(list.chats));
  const c = await (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${B}`)).json();
  assert.equal(c.canSend, true, String(c.sendOff || ""));
  assert.ok(c.need, "чат ждёт ответа администратора");
  const reply = () => b.post("/api/inbox/send", { c: "winchester", ch: "ga", id: B, text: "Здравствуйте! Это проверка пульта", rid: "stand-rid-0001" });
  assert.equal((await reply()).status, 200);
  assert.equal((await reply()).status, 200, "двойное «Отправить» — ответ без второй отправки");
  assert.equal(sends().length, 1, "Б получил одно сообщение");
  assert.equal(sends()[0].body.chatId, B + "@c.us");
  assert.equal(String(sends()[0].inst), INST.id, "с тестового инстанса");
  // пульт отвечает только в существующий чат: на номер, который не писал, отправить нельзя
  const other = await b.post("/api/inbox/send", { c: "winchester", ch: "ga", id: "77000007702", text: "Проверка", rid: "stand-rid-0002" });
  assert.equal(other.status, 404);
  assert.equal(sends().length, 1);
  assert.deepEqual(outside(), QUIET, "ни Telegram, ни ИИ, ни Altegio, ни Meta, ни других инстансов");
});

test("«Настроить Green-API» меняет вебхук только тестового инстанса и только на адрес стенда", { skip }, async () => {
  const { b } = await stand();
  const r = await b.post("/api/launch/ga", { c: "winchester" });
  assert.equal(r.status, 200, await r.clone().text());
  const set = gaOps("setSettings");
  assert.equal(set.length, 1);
  assert.equal(String(set[0].inst), INST.id);
  assert.match(String(set[0].body.webhookUrl), /^https:\/\/bot\.test\/ga\/winchester\?t=/, "адрес — тот, с которого нажали (стенд)");
  // у других компаний на стенде Green-API нет: кнопка отвечает отказом и ничего не вызывает
  for (const c of ["barber", "dent", "alt"]) {
    const x = await b.post("/api/launch/ga", { c });
    assert.ok([403, 404, 409].includes(x.status), c + ": " + x.status);
  }
  assert.equal(gaOps("setSettings").length, 1);
  assert.deepEqual(outside(), QUIET);
});

test("рассылки и пробная отправка со второго номера закрыты, запись с сайта выключена, Altegio не вызывается", { skip }, async () => {
  const { b } = await stand();
  const created = await (await b.post("/api/bc/create", { c: "winchester", ch: "ga", name: "Проба", text: "Здравствуйте, {имя}!", fallback: "", recipients: "77000007703, Арман\n77000007704, Ерлан", cap: 50, from: 10, to: 20, consent: true })).json();
  assert.ok(created && created.b && created.b.id, JSON.stringify(created));
  const start = await b.post("/api/bc/act", { c: "winchester", id: created.b.id, act: "start" });
  assert.equal(start.status, 409);
  assert.equal((await start.json()).code, "ga_off");
  // пробная отправка — только на номер для проверки из настроек владельца (02.11.2026); на стенде его нет — не уходит, номер из запроса не слушаем
  const probe = await b.post("/api/bc/test", { c: "winchester", ch: "ga", name: "Проба", tplId: "W05", lang: "ru", segment: "pora", cap: 50, from: 10, consent: true, to: "+7 700 000 77 05" });
  assert.equal(probe.status, 409, "пробная отправка без номера для проверки закрыта");
  const cat = await b.go("/api/site/winchester/catalog", { headers: { origin: "https://winchester.kz" } });
  assert.equal(cat.status, 503, "без ключа Altegio запись с сайта на стенде выключена");
  assert.equal(sends().length, 0);
  assert.deepEqual(outside(), QUIET);
});

test("фоновая задача стенда никому не пишет: cron в настройках нет, а если запустить — пусто", { skip }, async () => {
  const { s } = await stand();
  await s.gaText("winchester", INST, B, "Добрый день", { idMessage: "IN-ST-2" });
  // ночь (снимок базы), 10:00 (качество номера), 11:00 (автосценарий), 18:00 (напоминания накануне) по Астане (UTC+5)
  for (const h of [23, 5, 6, 13]) await s.cron(Date.UTC(2026, 10, 2, h, 0, 0));
  assert.equal(sends().length, 0, "ни напоминаний, ни рассылок");
  assert.equal(gaOps("setSettings").length, 0, "вебхук не меняется");
  assert.deepEqual(outside(), QUIET);
});
