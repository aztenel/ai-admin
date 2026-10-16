// Altegio (план проверки модулей, модуль 4, 16.10.2026): режим «проверка без записи» (altegio.dry) у Winchester.
// В веб-чате это показ для владельца: «Записала вас… (Это показ…)». Но номер WhatsApp Winchester — настоящий: клиент, которому
// бот написал «Записала», придёт, а записи в журнале нет. В WhatsApp в этом режиме запись уходит администратору. Всё на заглушках.
import { test } from "node:test";
import assert from "node:assert/strict";
import { net, mk, D1 } from "../harness.mjs";

const ENV = { ALTEGIO_PARTNER: "partner-key", WA_TOKEN_WINCHESTER: "tok-w", APP_SECRET_WINCHESTER: "sec-w" };
const AI = `Записала.\n[ЗАЯВКА] Имя: Тимур; Телефон: указан; Услуга: Мужская стрижка; Мастер: любой; Дата: ${D1}; Время: 10:00`;
const reset = () => { net.reset(); net.altGone = []; net.altBusy = false; net.altCheckBusy = false; net.altGetFail = 0; net.altGetPlain = false; net.altJournalFail = 0; net.altData = null; };

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
  const s = mk({ ALTEGIO_PARTNER: "partner-key" });
  const r = await s.chat("winchester", "dry-web", "Тимур, +7 700 000 00 95, мужская стрижка завтра в 10:00");
  assert.ok(/Записала вас/.test(r.reply) && /Это показ/.test(r.reply), r.reply);
});
