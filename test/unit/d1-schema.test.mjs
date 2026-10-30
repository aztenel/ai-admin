// Этап 0 плана D1 (docs/architecture-cloudflare-d1.md, 31.10.2026): черновики отделены от боевых данных, миграции D1
// применяются на пустой базе, схема держит правила дублей и гонок, код не пользуется чужой базой, страница «Хранилища».
// Проверки схемы идут на node:sqlite (Node 22+); на Node 20 они пропускаются с пометкой, остальное работает везде.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { net, mk } from "../harness.mjs";
import { sqliteOk, openD1, migrate, d1With } from "../d1.mjs";
import { d1Status, d1Ready } from "../../src/db/d1/status.js";
import { kvGroup } from "../../src/db/kv/stats.js";

const NO_SQLITE = sqliteOk ? false : "node:sqlite есть только в Node 22+ — проверка схемы D1 пропущена";
// JSONC: комментарии // вне строк (в wrangler.jsonc адресов со // нет, но строки всё равно пропускаем)
const jsonc = f => JSON.parse(readFileSync(new URL("../../" + f, import.meta.url), "utf8").replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*/g, (m, s) => s || ""));
const PROD_KV = "29debedd4b844096b1c5c55eb30dd271";

test("черновики не подключены к боевым данным: своё KV, своя база D1, у боевого сайта D1 нет", () => {
  const w = jsonc("wrangler.jsonc"), p = w.previews;
  assert.deepEqual(w.kv_namespaces, [{ binding: "KV", id: PROD_KV }], "боевая привязка KV не менялась");
  assert.equal(w.d1_databases, undefined, "боевой сайт к D1 не подключён — только по решению владельца");
  assert.equal(w.vars, undefined, "переменные боевого сайта — только в панели (keep_vars)");
  assert.equal(p.vars.STAGE, "preview");
  assert.equal(p.kv_namespaces.length, 1);
  assert.equal(p.kv_namespaces[0].binding, "KV");
  assert.notEqual(p.kv_namespaces[0].id, PROD_KV, "черновик пишет в своё KV, не в боевое aiai");
  assert.deepEqual(p.d1_databases.map(d => [d.binding, d.database_name]), [["DB", "ai-admin-dev"]]);
  const m = jsonc("wrangler.preview-migrations.jsonc").d1_databases;
  assert.equal(m.length, 1);
  assert.equal(m[0].database_id, p.d1_databases[0].database_id, "миграции черновика — в ту же базу, что у черновика");
  assert.equal(m[0].database_name, "ai-admin-dev");
});

test("миграции: применяются на пустой базе, повтор пропускается, ошибка не оставляет половину схемы", { skip: NO_SQLITE }, () => {
  const { raw } = openD1();
  assert.deepEqual(migrate(raw), ["0001_messaging.sql"]);
  assert.deepEqual(migrate(raw), [], "второй запуск ничего не применяет (как wrangler d1 migrations apply)");
  const tables = raw.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").all().map(r => r.name);
  for (const t of ["meta", "contacts", "consents", "restrictions", "bookings", "campaigns", "campaign_recipients", "jobs", "outbound", "sender_daily", "events", "sync_issues", "audit", "d1_migrations"]) assert.ok(tables.includes(t), t);
  // та же миграция руками ещё раз — ошибка, и в транзакции ничего не меняется
  const sql = readFileSync(new URL("../../migrations/0001_messaging.sql", import.meta.url), "utf8");
  const before = raw.prepare("select count(*) n from sqlite_master").get().n;
  raw.exec("BEGIN");
  assert.throws(() => raw.exec("CREATE TABLE extra_probe (x); " + sql), /already exists/);
  raw.exec("ROLLBACK");
  assert.equal(raw.prepare("select count(*) n from sqlite_master").get().n, before);
});

test("схема держит правила: один «стоп», захват задачи, ключ отправки, unknown, предел номера, одно одобрение", { skip: NO_SQLITE }, () => {
  const { raw } = d1With("preview");
  const now = 1793400000000, ws = "winchester";
  raw.prepare("insert into contacts(id,ws,phone,created_at,updated_at) values(?,?,?,?,?)").run("c1", ws, "77000000101", now, now);
  assert.throws(() => raw.prepare("insert into contacts(id,ws,phone,created_at,updated_at) values(?,?,?,?,?)").run("c2", ws, "+7 700 000", now, now), /CHECK/);
  // «стоп» дважды и перенос из KV дважды — одна действующая строка
  const stop = raw.prepare("insert into restrictions(ws,contact_id,kind,channel,reason,source,actor,legacy_key,needs_review,created_at) values(?,?,?,?,?,?,?,?,?,?) on conflict do nothing returning id");
  const ins = [stop.all(ws, "c1", "marketing_optout", "", "STOP", "kv_migration", "migration", "optout:winchester:77000000101", 0, now),
    stop.all(ws, "c1", "marketing_optout", "", "STOP", "chat_stop", "webhook", null, 0, now + 1),
    stop.all(ws, "c1", "marketing_optout", "", "STOP", "kv_migration", "migration", "optout:winchester:77000000101", 0, now + 2)].map(r => r.length);
  assert.deepEqual(ins, [1, 0, 0]);
  // полный запрет — отдельное состояние, рядом с маркетинговым
  assert.equal(stop.all(ws, "c1", "full_block", "", "просил не писать вообще", "admin", "owner", null, 0, now).length, 1);
  assert.equal(raw.prepare("select count(*) n from restrictions where lifted_at is null").get().n, 2);
  // неоднозначный «стоп» — в очередь на решение
  raw.prepare("insert into contacts(id,ws,phone,created_at,updated_at) values(?,?,?,?,?)").run("c3", ws, "77000000103", now, now);
  stop.all(ws, "c3", "marketing_optout", "", "«пока не пишите»", "chat_stop", "webhook", null, 1, now);
  assert.deepEqual(raw.prepare("select contact_id from restrictions where ws=? and needs_review=1 and lifted_at is null").all(ws).map(r => r.contact_id), ["c3"]);
  // захват задачи: из двух одновременных — один
  raw.prepare("insert into jobs(ws,kind,job_key,contact_id,record_id,due_at,late_at,created_at) values(?,?,?,?,?,?,?,?)").run(ws, "reminder_d1", "d1:501:1793450000000", "c1", "501", now - 1000, now + 3600e3, now);
  const claim = raw.prepare("update jobs set state='claimed', claim_token=?1, claimed_at=?2 where id = (select id from jobs where ws=?3 and state='queued' and due_at<=?2 order by due_at limit 1) and state='queued' returning id");
  assert.equal(claim.all("A", now, ws).length, 1);
  assert.equal(claim.all("B", now, ws).length, 0);
  // ключ отправки: вторая попытка не создаёт строку
  const send = raw.prepare("insert into outbound(ws,send_key,job_id,channel,contact_id,purpose,text_hash,state,created_at) values(?,?,?,?,?,?,?,?,?) on conflict(send_key) do nothing returning id");
  const id = send.all(ws, "d1:501:1793450000000", 1, "ga:winchester", "c1", "service", "h1", "sending", now)[0].id;
  assert.equal(send.all(ws, "d1:501:1793450000000", 1, "ga:winchester", "c1", "service", "h1", "sending", now).length, 0);
  // unknown: сверку и решение нельзя записать отправленному; решение — только с тем, кто решил
  assert.throws(() => raw.prepare("update outbound set check_state='pending' where id=?").run(id), /CHECK/);
  raw.prepare("update outbound set state='unknown', unknown_at=?, check_state='pending' where id=?").run(now, id);
  assert.deepEqual(raw.prepare("select id from outbound where ws=? and state='unknown' and resolution is null").all(ws).map(r => r.id), [id]);
  assert.throws(() => raw.prepare("update outbound set resolution='sent' where id=?").run(id), /CHECK/);
  raw.prepare("update outbound set check_state='not_found', check_tries=1, checked_at=? where id=?").run(now, id);
  assert.equal(raw.prepare("select count(*) n from outbound where ws=? and state='unknown' and resolution is null").get(ws).n, 1, "сверка не нашла — ждёт человека, сам не повторяется");
  raw.prepare("update outbound set resolution='not_sent', resolved_by='owner', resolved_at=? where id=?").run(now, id);
  assert.equal(send.all(ws, "d1:501:1793450000000:r1", 1, "ga:winchester", "c1", "service", "h1", "sending", now).length, 1, "«отправить ещё раз» — новый ключ");
  // предел номера: резерв одной командой
  const reserve = raw.prepare("insert into sender_daily(ws,channel,day,marketing) values(?1,?2,?3,1) on conflict(ws,channel,day) do update set marketing = marketing + 1 where marketing < ?4 returning marketing");
  assert.deepEqual([0, 1, 2, 3].map(() => reserve.all(ws, "ga:winchester", "2026-11-01", 2).length), [1, 1, 0, 0]);
  // двойное «Одобрить» — одно одобрение
  raw.prepare("insert into campaigns(id,ws,channel,name,texts,window_from,window_to,daily_cap,created_by,created_at,updated_at,state) values('k1',?,?,?,?,?,?,?,?,?,?,'ready')").run(ws, "ga:winchester", "Пора", '["a"]', 11, 20, 15, "owner", now, now);
  const appr = raw.prepare("update campaigns set state='approved', approved_by=?, approved_at=?, version=version+1 where id='k1' and state='ready' and version=? returning version");
  assert.equal(appr.all("owner", now, 1).length, 1);
  assert.equal(appr.all("staff", now, 1).length, 0);
  // расхождение KV и D1: одна открытая строка на ключ, повтор сверки не плодит
  const issue = raw.prepare("insert into sync_issues(ws,kind,key,created_at) values(?,?,?,?) on conflict do update set attempts = attempts + 1 returning attempts");
  assert.deepEqual([issue.get(ws, "kv_write", "optout:winchester:77000000101", now).attempts, issue.get(ws, "kv_write", "optout:winchester:77000000101", now).attempts], [0, 1]);
  // горячие запросы идут по индексам
  for (const q of ["select id from jobs where ws='winchester' and state='queued' and due_at<=1 order by due_at limit 1",
    "select kind from restrictions where ws='winchester' and contact_id='c1' and lifted_at is null",
    "select id from outbound where ws='winchester' and state='unknown' and resolution is null order by unknown_at",
    "select id from contacts where ws='winchester' and last_visit_at between 1 and 2"])
    assert.ok(raw.prepare("explain query plan " + q).all().some(r => /USING (COVERING )?INDEX/.test(r.detail)), q);
});

test("код пользуется базой, только если это база своего окружения и миграции применены", { skip: NO_SQLITE }, async () => {
  const dev = d1With("preview");
  assert.deepEqual({ ...(await d1Status({ STAGE: "preview", DB: dev.db })), ms: 0 }, { want: "preview", bound: true, ok: true, stage: "preview", migrations: ["0001_messaging.sql"], tables: 22, ms: 0 });
  assert.equal(await d1Ready({ STAGE: "preview", DB: dev.db }, 1), dev.db);
  // боевой сайт с базой черновика — нет; черновик с боевой — нет
  assert.equal(await d1Ready({ DB: d1With("preview").db }, 1), null);
  assert.equal(await d1Ready({ STAGE: "preview", DB: d1With("production").db }, 1), null);
  const prod = d1With("production");
  assert.equal(await d1Ready({ DB: prod.db }, 1), prod.db, "боевой сайт со своей базой — да");
  // без отметки или без миграций — нет
  assert.equal(await d1Ready({ STAGE: "preview", DB: d1With(null).db }, 1), null);
  const empty = openD1();
  const s = await d1Status({ STAGE: "preview", DB: empty.db });
  assert.equal(s.ok, false); assert.deepEqual(s.migrations, []);
  // база не отвечает — ошибка в отчёте, не падение; через минуту проверка повторяется
  const flaky = d1With("preview");
  flaky.ctl.fail = () => true;
  assert.match((await d1Status({ STAGE: "preview", DB: flaky.db })).error, /Network connection lost/);
  assert.equal(await d1Ready({ STAGE: "preview", DB: flaky.db }, 1000), null);
  flaky.ctl.fail = null;
  assert.equal(await d1Ready({ STAGE: "preview", DB: flaky.db }, 30_000), null, "в пределах минуты — прежний ответ");
  assert.equal(await d1Ready({ STAGE: "preview", DB: flaky.db }, 61_001), flaky.db);
  assert.deepEqual(await d1Status({}), { want: "production", bound: false });
});

test("группы ключей KV: компания и канал видны, номера, даты и метки сессий — нет", () => {
  const isId = id => id === "winchester";
  assert.equal(kvGroup("h:wa:winchester:77001234567", isId), "h:wa:winchester:");
  assert.equal(kvGroup("optout:winchester:77001234567", isId), "optout:winchester:");
  assert.equal(kvGroup("lead:winchester:2026-10-30:ab12", isId), "lead:winchester:");
  assert.equal(kvGroup("session:abcdefghijklmnop", isId), "session:");
  assert.equal(kvGroup("seen:wamid.HBgM", isId), "seen:");
  assert.equal(kvGroup("bk:133486:site:77001234567:2026-10-30", isId), "bk:");
  assert.equal(kvGroup("cfg:all", isId), "cfg:");
  assert.equal(kvGroup("skeys", isId), "skeys");
  assert.equal(kvGroup("+77001234567", isId), "прочее");
  assert.equal(kvGroup("optout:winchester", isId), "optout:", "последняя часть ключа в группу не идёт");
});

test("/diag/storage: только владелец; черновик видит свою базу и группы ключей без номеров", { skip: NO_SQLITE }, async () => {
  net.reset();
  const dev = d1With("preview");
  const s = mk({ STAGE: "preview", DB: dev.db });
  await s.kv.api.put("optout:winchester:77000000101", "1");
  await s.kv.api.put("h:wa:winchester:77000000102", "{}");
  const anon = await s.browser().go("/diag/storage");
  assert.ok([302, 303, 401, 403].includes(anon.status), String(anon.status));
  const own = s.browser();
  await own.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fadmin" });
  const r = await own.go("/diag/storage");
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(html, /черновик \(Worker Previews/);
  assert.match(html, /отметка базы: preview — совпадает ✅/);
  assert.match(html, /миграции: 0001_messaging\.sql; таблиц: 22/);
  assert.match(html, /optout:winchester: 1/);
  assert.match(html, /есть чаты или «стоп» — проверьте, что это тестовые/);
  assert.ok(!/77000000101|77000000102/.test(html), "номеров на странице нет");
  // боевой сайт без базы: так и задумано
  const p = mk(), po = p.browser();
  await po.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Fadmin" });
  const html2 = await (await po.go("/diag/storage")).text();
  assert.match(html2, /боевой сайт/);
  assert.match(html2, /База D1: не подключена — так и задумано/);
});
