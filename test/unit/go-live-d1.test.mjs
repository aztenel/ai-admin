// Подключение боевой базы D1 ai-admin (docs/runbooks/winchester-go-live.md), проверено на локальной копии с отметкой production.
// Боевая база сейчас пустая (проверено чтением 01.11.2026: только служебная таблица Cloudflare _cf_KV). Порядок из инструкции:
// миграции 0001–0005 → отметка meta.stage = 'production' → привязка DB (docs/runbooks/winchester-go-live-d1.patch) → выкладка.
// Здесь — что будет на каждом шаге: до миграций пульт честно пишет «не настроена», после — второй номер отправляет ровно один раз;
// повтор миграций и отметки ничего не меняет; чужая отметка не перезаписывается; база черновиков получает только 0005 и 0006, данные целы.
// Те же команды настоящим wrangler (локальная копия, --local) — в инструкции, раздел «Что уже проверено».
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { net, mk } from "../harness.mjs";
import { sqliteOk, openD1, migrate, d1With, MIGRATIONS } from "../d1.mjs";
import { d1Status, d1Ready } from "../../src/db/d1/status.js";
import { sendDbOff, NO_SETUP } from "../../src/services/inbox/send.js";

const skip = sqliteOk ? false : "нужна D1 на node:sqlite (Node 22+)";
const ROOT = new URL("../../", import.meta.url);
const RUNBOOK = readFileSync(new URL("docs/runbooks/winchester-go-live.md", ROOT), "utf8");
const PATCH = new URL("docs/runbooks/winchester-go-live-d1.patch", ROOT);
const PROD_ID = "ea1610ed-d342-41ca-8170-40ffe81feb41", DEV_ID = "ecfe6f12-469b-440b-bd40-362f83a04e26";
// отметка окружения — та же строка, что в инструкции (проверяется ниже): ON CONFLICT — второй запуск ничего не меняет,
// а чужую отметку (preview) не перезаписывает — её покажет /diag/storage
const STAGE_SQL = "INSERT INTO meta (k, v) VALUES ('stage', 'production') ON CONFLICT(k) DO NOTHING";
const ALL = ["0001_messaging.sql", "0002_contacts_sync.sql", "0003_consent_evidence.sql", "0004_demo_source.sql", "0005_send_claims.sql", "0006_chat_storage.sql"];
const INST = { id: "7105000066", token: "ga-tok-golive" };
const GA_W = { GA_ID_WINCHESTER: INST.id, GA_TOKEN_WINCHESTER: INST.token };
const sends = () => net.ga.filter(x => x.op === "sendMessage");
const login = async s => {
  const b = s.browser();
  await b.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fadmin" });
  return b;
};
/** боевая база, какой её видит Cloudflare сейчас: пустая, со служебной таблицей */
const emptyProd = () => { const d = openD1(); d.raw.exec("CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB)"); return d; };

test("инструкция и правка привязки: та же отметка, та же боевая база; черновики остаются на своей", () => {
  assert.ok(RUNBOOK.includes(STAGE_SQL), "в инструкции та же команда отметки, что проверена здесь");
  for (const f of ALL) assert.ok(RUNBOOK.includes(f), "в инструкции названа миграция " + f);
  const patch = readFileSync(PATCH, "utf8"), plus = patch.split("\n").filter(l => l.startsWith("+") && !l.startsWith("+++"));
  assert.ok(plus.some(l => l.includes(PROD_ID) && l.includes('"binding": "DB"') && l.includes('"database_name": "ai-admin"')), "правка подключает DB → ai-admin");
  assert.ok(!plus.some(l => l.includes(DEV_ID)), "правка не трогает базу черновиков");
  assert.ok(!/^[+-]\s*"previews"/m.test(patch), "блок previews не меняется");
  // правка ложится на текущие файлы: wrangler.jsonc или проверку схемы изменили — правку нужно собрать заново
  let git = true;
  try { execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: fileURLToPath(ROOT), stdio: "ignore" }); } catch (e) { git = false; }
  if (git) execFileSync("git", ["apply", "--check", fileURLToPath(PATCH)], { cwd: fileURLToPath(ROOT), stdio: "pipe" });
});

test("привязку выложили раньше миграций: пульт пишет «не настроена», Green-API не вызывается", { skip }, async () => {
  const d = emptyProd();
  const st = await d1Status({ DB: d.db });
  assert.equal(st.ok, false); assert.equal(st.stage, null); assert.deepEqual(st.migrations, []);
  assert.equal(await sendDbOff({ DB: d.db }, Date.now()), NO_SETUP);
  net.reset();
  const s = mk({ ...GA_W, DB: d.db }), b = await login(s), from = "77000006601";
  await s.gaText("winchester", INST, from, "Здравствуйте");
  const r = await b.post("/api/inbox/send", { c: "winchester", ch: "ga", id: from, text: "Ответ", rid: "golive-rid-0001" });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, "nosetup");
  assert.equal(sends().length, 0);
});

test("миграции и отметка по инструкции: база своя, второй номер отправляет один раз; повтор шагов ничего не меняет", { skip }, async () => {
  const d = emptyProd();
  assert.deepEqual(migrate(d.raw), ALL, "как wrangler d1 migrations apply ai-admin --remote");
  d.raw.exec(STAGE_SQL);
  const st = await d1Status({ DB: d.db });
  assert.deepEqual({ ...st, ms: 0 }, { want: "production", bound: true, ok: true, stage: "production", migrations: ALL, tables: 25, ms: 0 });
  assert.equal(await d1Ready({ DB: d.db }, 1), d.db, "боевой сайт (без STAGE) пользуется базой");
  // ответ проверки помнится минуту на экземпляр (status.js); у черновика и боевого сайта разные экземпляры — здесь через минуту
  assert.equal(await d1Ready({ STAGE: "preview", DB: d.db }, 61_002), null, "черновик с боевой базой — нет");

  net.reset();
  const s = mk({ ...GA_W, DB: d.db }), b = await login(s), from = "77000006602";
  await s.gaText("winchester", INST, from, "Можно завтра в 15:00?");
  const chat = await (await b.go(`/api/inbox/chat?c=winchester&ch=ga&id=${from}`)).json();
  assert.equal(chat.canSend, true, JSON.stringify(chat.sendOff || ""));
  const send = () => b.post("/api/inbox/send", { c: "winchester", ch: "ga", id: from, text: "Да, записали вас на 15:00", rid: "golive-rid-0002" });
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200, "повтор того же нажатия — ответ без второй отправки");
  assert.equal(sends().length, 1, "клиенту ушло одно сообщение");
  const html = await (await b.go("/diag/storage")).text();
  assert.match(html, /боевой сайт/);
  assert.match(html, /отметка базы: production — совпадает ✅/);
  assert.match(html, /миграции: 0001_messaging\.sql, 0002_contacts_sync\.sql, 0003_consent_evidence\.sql, 0004_demo_source\.sql, 0005_send_claims\.sql, 0006_chat_storage\.sql; таблиц: 25/);
  assert.ok(!html.includes(from), "номеров на странице нет");

  const rows = () => d.raw.prepare("select count(*) n from send_claims").get().n;
  assert.equal(rows(), 1);
  assert.deepEqual(migrate(d.raw), [], "повтор миграций: «No migrations to apply»");
  d.raw.exec(STAGE_SQL);
  assert.equal(d.raw.prepare("select v from meta where k = 'stage'").get().v, "production");
  assert.equal(rows(), 1, "отметки отправки на месте");
});

test("команда отметки не перезаписывает чужую отметку: база с отметкой preview остаётся закрытой для боевого сайта", { skip }, async () => {
  const d = d1With("preview");
  d.raw.exec(STAGE_SQL);
  assert.equal(d.raw.prepare("select v from meta where k = 'stage'").get().v, "preview");
  assert.equal(await d1Ready({ DB: d.db }, 1), null, "/diag/storage покажет «preview ❌ — база чужая»");
});

test("база черновиков (0001–0004 с данными) получает только 0005 и 0006; контакты, источники и согласия на месте", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "golive-")), src = fileURLToPath(MIGRATIONS);
  for (const f of readdirSync(src).filter(f => f < "0005")) copyFileSync(join(src, f), join(dir, f));
  const { raw } = openD1();
  assert.deepEqual(migrate(raw, pathToFileURL(dir + "/")), ALL.slice(0, 4));
  raw.exec("insert into meta (k, v) values ('stage', 'preview')");
  const t = 1790000000000;
  raw.prepare("insert into contacts (id, ws, phone, name, created_at, updated_at) values (?, 'winchester', ?, ?, ?, ?)").run("c-golive-1", "77000006603", "Вымышленный клиент", t, t);
  raw.prepare("insert into contact_sources (contact_id, ws, source, external_id, first_seen, last_seen) values (?, 'winchester', 'demo', '', ?, ?)").run("c-golive-1", t, t);
  const count = () => ["contacts", "contact_sources", "meta"].map(n => raw.prepare(`select count(*) n from ${n}`).get().n);
  const before = count();
  assert.deepEqual(migrate(raw), ["0005_send_claims.sql", "0006_chat_storage.sql"], "применяются только новые миграции");
  assert.deepEqual(count(), before, "данные не тронуты");
  assert.ok(raw.prepare("select name from sqlite_master where type = 'table' and name = 'send_claims'").get());
});
