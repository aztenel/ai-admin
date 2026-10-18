// Altegio (план проверки модулей, модуль 4, 16.10.2026): режим «проверка без записи» (altegio.dry) у Winchester.
// В веб-чате это показ для владельца: «Записала вас… (Это показ…)». Но номер WhatsApp Winchester — настоящий: клиент, которому
// бот написал «Записала», придёт, а записи в журнале нет. В WhatsApp в этом режиме запись уходит администратору. Всё на заглушках.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, D1, ALT_GRID } from "../harness.mjs";

const ENV = { ALTEGIO_PARTNER: "partner-key", WA_TOKEN_WINCHESTER: "tok-w", APP_SECRET_WINCHESTER: "sec-w", BOT_WA_WINCHESTER: "1", ALTEGIO_DRY_WINCHESTER: "1", ALTEGIO_TRIAL_WINCHESTER: "0" }; // режим «без записи» включён переменной: у Winchester с 19.10.2026 запись настоящая // бот в WhatsApp Winchester по умолчанию выключен (wa-off.test.mjs)
const AI = `Записала.\n[ЗАЯВКА] Имя: Тимур; Телефон: указан; Услуга: Мужская стрижка; Мастер: любой; Дата: ${D1}; Время: 10:00`;
const reset = () => { net.reset(); net.altGone = []; net.altBusy = false; net.altCheckBusy = false; net.altGetFail = 0; net.altGetPlain = false; net.altJournalFail = 0; net.altData = ALT_GRID; }; // Winchester считает длительность — расписание сеткой, как настоящее

test("WhatsApp, режим без записи: клиенту не пишем «Записала» — запись передана администратору, в Telegram всё для записи вручную", async () => {
  reset(); net.ai = [AI];
  const s = mk(ENV);
  await s.waText("/wa/winchester", "77000000094", "Тимур, мужская стрижка завтра в 10:00", { secret: "sec-w" });
  const out = s.sentTo("77000000094").join("\n");
  assert.ok(!/Записала вас/.test(out) && !/Это показ/.test(out), out);
  assert.ok(/администратор/i.test(out) && /10:00/.test(out), out);
  assert.equal(net.altRecords.length, 0, "в журнал ничего не записано");
  assert.ok(net.alt.some(a => /book_check/.test(a)), "окно проверено в Altegio: " + JSON.stringify(net.alt));
  const tg = net.tg.map(t => t.text || "").join("\n");
  assert.ok(/вручную/.test(tg) && /Тимур/.test(tg) && /10:00/.test(tg), tg);
  const h = s.hist("wa", "winchester", "77000000094");
  assert.equal(h.profile.need && h.profile.need.why, "lead", "чат ждёт администратора");
  assert.ok(!(h.profile.bookings || []).length, "в чате нет записи, которой нет в журнале");
});

test("веб-чат, режим без записи: показ для владельца остаётся как был", async () => {
  reset(); net.ai = [AI];
  const s = mk({ ALTEGIO_PARTNER: "partner-key", ALTEGIO_DRY_WINCHESTER: "1", ALTEGIO_TRIAL_WINCHESTER: "0" });
  const r = await s.chat("winchester", "dry-web", "Тимур, +7 700 000 00 95, мужская стрижка завтра в 10:00");
  assert.ok(/Записала вас/.test(r.reply) && /Это показ/.test(r.reply), r.reply);
});

test("пульт: администратор записал клиента вручную и нажал «Сделано» — бот больше не считает заявку ждущей администратора", async () => {
  reset(); net.ai = [AI];
  const s = mk(ENV), from = "77000000096";
  await s.waText("/wa/winchester", from, "Тимур, мужская стрижка завтра в 10:00", { secret: "sec-w" });
  const lid = s.hist("wa", "winchester", from).profile.pend[0].leadId;
  const own = s.browser();
  await own.go("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "key=owner-key-123456&next=%2Finbox" });
  const r = await own.post("/api/inbox/act", { c: "winchester", ch: "wa", id: from, act: "done", lead: lid, text: "Тимур, записал вас на завтра в 10:00 ✂️" });
  assert.equal(r.status, 200, await r.text());
  const p = s.hist("wa", "winchester", from).profile;
  assert.ok(!(p.pend || []).some(x => x.leadId === lid), "заявка больше не ждёт администратора: " + JSON.stringify(p.pend));
  assert.ok(/подтвердил|записал/i.test(p.booked || "") && /10:00/.test(p.booked || ""), "бот знает, что администратор записал клиента: " + p.booked);
  net.ai = ["Да, всё в силе 👌"];
  await s.waText("/wa/winchester", from, "Я записан на завтра?", { secret: "sec-w" });
  const last = s.sentTo(from).pop();
  assert.ok(!/у администратора/.test(last), last);
});
