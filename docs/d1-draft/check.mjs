// Проверка черновика схемы D1 на SQLite (node:sqlite, Node 22+): идемпотентный «стоп», захват задачи, send_key,
// дневной предел, двойное одобрение, планы запросов. Запуск: node --no-warnings docs/d1-draft/check.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
db.exec(readFileSync(new URL("./0001_messaging.sql", import.meta.url), "utf8"));
const now = 1793400000000, ws = "winchester";
db.prepare("insert into contacts(id,ws,phone,created_at,updated_at) values(?,?,?,?,?)").run("c1", ws, "77000000101", now, now);
// 1) STOP twice -> one active restriction; migration twice -> one row
const stop = db.prepare("insert into restrictions(ws,contact_id,kind,channel,reason,source,actor,legacy_key,created_at) values(?,?,?,?,?,?,?,?,?) on conflict do nothing returning id");
const r1 = stop.all(ws,"c1","marketing_optout","","STOP","kv_migration","migration","optout:winchester:77000000101",now);
const r2 = stop.all(ws,"c1","marketing_optout","","STOP","chat_stop","webhook",null,now+1);
const r3 = stop.all(ws,"c1","marketing_optout","","STOP","kv_migration","migration","optout:winchester:77000000101",now+2);
console.log("restriction inserts:", r1.length, r2.length, r3.length, "rows:", db.prepare("select count(*) n from restrictions").get().n);
// 2) job claim: only one of two claimers gets it
db.prepare("insert into jobs(ws,kind,job_key,contact_id,record_id,due_at,late_at,created_at) values(?,?,?,?,?,?,?,?)").run(ws,"reminder_d1","d1:501:1793450000000","c1","501",now-1000,now+3600e3,now);
const claim = db.prepare("update jobs set state='claimed', claim_token=?1, claimed_at=?2 where id = (select id from jobs where ws=?3 and state='queued' and due_at<=?2 order by due_at limit 1) and state='queued' returning id, claim_token");
console.log("claim A:", JSON.stringify(claim.all("A", now, ws)), "claim B:", JSON.stringify(claim.all("B", now, ws)));
// 3) send_key dedupe
const send = db.prepare("insert into outbound(ws,send_key,job_id,channel,contact_id,purpose,text_hash,state,created_at) values(?,?,?,?,?,?,?,?,?) on conflict(send_key) do nothing returning id");
console.log("send 1:", send.all(ws,"d1:501:1793450000000",1,"ga:7105","c1","service","h","sending",now).length, "send 2:", send.all(ws,"d1:501:1793450000000",1,"ga:7105","c1","service","h","sending",now).length);
// 4) daily cap reservation
const reserve = db.prepare("insert into sender_daily(ws,channel,day,marketing) values(?1,?2,?3,1) on conflict(ws,channel,day) do update set marketing = marketing + 1 where marketing < ?4 returning marketing");
const got = []; for (let i = 0; i < 4; i++) got.push(reserve.all(ws,"ga:7105","2026-11-01",2).map(r=>r.marketing)[0] ?? "cap");
console.log("reserve with cap 2:", got.join(","));
// 5) optimistic approve
db.prepare("insert into campaigns(id,ws,channel,name,texts,window_from,window_to,daily_cap,created_by,created_at,updated_at,state) values('k1',?,?,?,?,?,?,?,?,?,?,'ready')").run(ws,"ga:7105","Пора",'["a"]',11,20,15,"owner",now,now);
const appr = db.prepare("update campaigns set state='approved', approved_by=?, approved_at=?, version=version+1 where id='k1' and state='ready' and version=? returning version");
console.log("approve twice:", appr.all("owner",now,1).length, appr.all("staff",now,1).length);
// 6) query plans use indexes
for (const q of ["select id from jobs where ws='winchester' and state='queued' and due_at<=1 order by due_at limit 1",
  "select kind from restrictions where ws='winchester' and contact_id='c1' and lifted_at is null",
  "select id from contacts where ws='winchester' and last_visit_at between 1 and 2 and next_booking_at is null"])
  console.log("plan:", db.prepare("explain query plan " + q).all().map(r => r.detail).join(" | "));
